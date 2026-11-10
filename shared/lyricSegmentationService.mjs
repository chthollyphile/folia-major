import { sendOpenAICompatibleRequest } from './openAICompatibleRequest.mjs';
import { budgetFor } from './ai/aiTasks.mjs';
import { runAttempts } from './ai/attemptRunner.mjs';
import { MAX_ERROR_BODY_CHARS, buildCompatibleBody, exhaustedByReasoning, withErrorHint } from './ai/compatibleBody.mjs';
import { getAiAdapter, resolveAiConnection } from './ai/providerRegistry.mjs';

// shared/lyricSegmentationService.mjs
// Server-side lyric word segmentation, shared by the Vercel edge handler and the Cloudflare
// Worker. Those two runtimes differ only in where the environment comes from, so they are thin
// adapters over this and the prompt module rather than a third and fourth copy of the plumbing —
// which is what the theme feature ended up with.
//
// The provider is chosen by whichever key the deployment configured, because unlike the desktop
// build there is no user-facing setting here: the web deployment owns the credentials.

import {
  SEGMENTATION_GEMINI_GENERATION_CONFIG,
  SEGMENTATION_JSON_SCHEMA,
  SEGMENTATION_MAX_OUTPUT_TOKENS,
  SEGMENTATION_SCHEMA_NAME,
  buildSegmentationSourcePrompt,
  buildSegmentationSystemPrompt,
  parseSegmentationResponse,
} from './lyricSegmentationPrompt.mjs';

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// An edge function has its own platform deadline, but a request with no signal can still burn the
// whole budget on one stalled upstream and return nothing useful. Failing at a deadline we chose
// produces an error the caller can show.
const DEFAULT_AI_TIMEOUT_MS = 120_000;

const timeoutSignal = (timeoutMs) => (
  typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined
);

const isAbort = (error) => error && (error.name === 'TimeoutError' || error.name === 'AbortError');

/** An address without its credentials and query: what a message may show of it. */
const addressForMessage = (rawUrl) => {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'the AI service';
  }
};

/** Thrown with an HTTP status so both adapters can map failures without re-deriving them. */
export class SegmentationRequestError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'SegmentationRequestError';
    this.status = status;
  }
}

const normalizeOpenAIChatCompletionsUrl = (rawUrl) => {
  const trimmedUrl = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmedUrl) {
    return DEFAULT_OPENAI_CHAT_COMPLETIONS_URL;
  }

  try {
    const parsed = new URL(trimmedUrl);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');

    if (!normalizedPath || normalizedPath === '/') {
      parsed.pathname = '/v1/chat/completions';
      return parsed.toString();
    }
    if (/\/v\d+$/.test(normalizedPath)) {
      parsed.pathname = `${normalizedPath}/chat/completions`;
      return parsed.toString();
    }
    parsed.pathname = normalizedPath;
    return parsed.toString();
  } catch {
    return trimmedUrl.replace(/\/+$/, '');
  }
};

const resolveTemperature = (value) => {
  const temperature = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
    ? temperature
    : DEFAULT_OPENAI_TEMPERATURE;
};

/** The provider's own message out of a raw error body, or the body itself when it is not JSON. */
const errorDetailOf = (rawText) => {
  try {
    const parsed = JSON.parse(rawText);
    const error = parsed && parsed.error;
    if (typeof error === 'string') return error;
    if (error && typeof error.message === 'string') return error.message;
    if (typeof parsed?.message === 'string') return parsed.message;
  } catch {
    // Leave non-JSON responses as-is.
  }
  return rawText.trim();
};

const readErrorDetail = async (response) => errorDetailOf(await response.text());

const extractContentText = (message) => {
  if (!message) return null;
  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new SegmentationRequestError(`Model refused request: ${message.refusal}`, 502);
  }
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((part) => part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    return text || null;
  }
  return null;
};

// `exhausted` is the runner's verdict (exhaustedByReasoning with the adapter, so a provider's own
// words for a cut-off answer count too), the same one it moved down on.
const describeEmpty = (choice, usage, model, exhausted) => {
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  if (exhausted) {
    const tokens = typeof reasoningTokens === 'number' ? ` (${reasoningTokens} tokens)` : '';
    const finishReason = choice?.finish_reason;
    const how = finishReason && finishReason !== 'length'
      ? `stopped while still reasoning${tokens} (finish_reason: ${finishReason})`
      : `used its entire output budget on reasoning${tokens}`;
    return `Model "${model}" ${how} and returned no answer. Configure a non-reasoning model for this deployment.`;
  }
  return `Model "${model}" returned an empty response`
    + `${choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : ''}.`;
};

/**
 * Sends one request, returning the outcome rather than throwing, so the ladder can decide.
 * Mirrors sendOpenAICompatible in electron/aiTextClient.cjs.
 */
const sendOpenAICompatible = async (apiUrl, apiKey, adapter, body, fetchImpl) => {
  let response;
  try {
    response = await sendOpenAICompatibleRequest({
      apiUrl,
      provider: adapter.id,
      rejectsFormat: adapter.rejectedParameter,
      body,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        signal: timeoutSignal(DEFAULT_AI_TIMEOUT_MS),
      },
      fetchImpl,
    });
  } catch (error) {
    if (isAbort(error)) {
      throw new SegmentationRequestError(`Request to ${addressForMessage(apiUrl)} timed out`, 504);
    }
    throw error;
  }

  if (!response.ok) {
    // errorText is for people; errorBody keeps error.param and error.code for the ladder.
    const rawText = await response.text();
    const detail = errorDetailOf(rawText);
    return {
      ok: false,
      status: response.status,
      errorText: `OpenAI compatible API error (${response.status})${detail ? `: ${detail}` : ''}`,
      errorBody: rawText.slice(0, MAX_ERROR_BODY_CHARS),
    };
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  return { ok: true, choice, usage: data.usage, content: extractContentText(choice && choice.message) };
};

/**
 * Walks the provider adapter's segmentation attempts instead of assuming what the deployment
 * configured. The base URL and model are env, so they can name anything: the provider is inferred
 * from the URL's host (only OpenAI-compatible ones here; anything else is the custom adapter, whose
 * attempts are the generic REASONING_SUPPRESSION_ATTEMPTS ladder), and the working shape is
 * discovered and then remembered by the shared runner. See the ladder's definition for the
 * measurements behind it.
 */
const runOpenAICompatible = async (lines, env, fetchImpl) => {
  const connection = resolveAiConnection({ ...env, AI_PROVIDER: 'openai' }, { protocols: ['openai'] });
  const adapter = getAiAdapter(connection.adapterId);
  const apiUrl = normalizeOpenAIChatCompletionsUrl(connection.apiUrl);
  const { model } = connection;
  const temperature = resolveTemperature(env.OPENAI_API_TEMPERATURE);
  const systemPrompt = buildSegmentationSystemPrompt();
  const sourcePrompt = buildSegmentationSourcePrompt(lines);

  return runAttempts({
    adapter,
    task: 'segmentation',
    url: apiUrl,
    model,
    attempts: adapter.attempts('segmentation', model),
    describeEmpty: (result) => describeEmpty(result.choice, result.usage, model, result.exhausted),
    fail: (message) => new SegmentationRequestError(message, 502),
    send: async (attempt) => {
      const body = buildCompatibleBody(adapter, {
        task: 'segmentation',
        model,
        attempt,
        systemPrompt,
        sourcePrompt,
        schema: SEGMENTATION_JSON_SCHEMA,
        schemaName: SEGMENTATION_SCHEMA_NAME,
        budget: budgetFor('segmentation', SEGMENTATION_MAX_OUTPUT_TOKENS, attempt),
        temperature,
      });
      const result = await sendOpenAICompatible(apiUrl, env.OPENAI_API_KEY, adapter, body, fetchImpl);
      return result.ok ? { ...result, exhausted: exhaustedByReasoning(result.choice, result.usage, adapter) } : withErrorHint(adapter, result);
    },
  });
};

const runGemini = async (lines, env, fetchImpl) => {
  let response;
  try {
    response = await fetchImpl(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSegmentationSystemPrompt() }] },
        contents: [{ parts: [{ text: buildSegmentationSourcePrompt(lines) }] }],
        generationConfig: SEGMENTATION_GEMINI_GENERATION_CONFIG,
      }),
      signal: timeoutSignal(DEFAULT_AI_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbort(error)) {
      throw new SegmentationRequestError('Request to Gemini timed out', 504);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new SegmentationRequestError(
      `Gemini API error (${response.status})${detail ? `: ${detail}` : ''}`,
      502,
    );
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const jsonText = Array.isArray(parts)
    ? parts.find((part) => part && typeof part.text === 'string')?.text
    : null;
  if (!jsonText) {
    throw new SegmentationRequestError('Model returned an empty response', 502);
  }
  return jsonText;
};

/** Guards the request body before any credential or network work happens. */
export const readSegmentationLines = (body) => {
  const lines = body && body.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new SegmentationRequestError('Missing lines', 400);
  }
  if (lines.length > 400) {
    throw new SegmentationRequestError('Too many lines', 400);
  }
  return lines.map((line) => String(line ?? ''));
};

/**
 * Segments the lines with whichever provider the deployment configured. Returns one boundary array
 * per input line, already validated to reproduce the input exactly.
 */
export const segmentLyricLines = async (lines, env, fetchImpl = fetch) => {
  const preferOpenAI = env.AI_PROVIDER === 'openai' || (!env.GEMINI_API_KEY && env.OPENAI_API_KEY);

  if (preferOpenAI && !env.OPENAI_API_KEY) {
    throw new SegmentationRequestError('OPENAI_API_KEY is not configured', 500);
  }
  if (!preferOpenAI && !env.GEMINI_API_KEY) {
    throw new SegmentationRequestError('GEMINI_API_KEY is not configured', 500);
  }

  const raw = preferOpenAI
    ? await runOpenAICompatible(lines, env, fetchImpl)
    : await runGemini(lines, env, fetchImpl);

  try {
    const { boundaries, rejections } = parseSegmentationResponse(raw, lines);
    if (rejections.length > 0) {
      console.warn(`[segment-lyrics] ${rejections.length}/${lines.length} lines rejected; first: ${rejections[0]}`);
    }
    return boundaries;
  } catch (error) {
    // The response is the only evidence of why a run was rejected, and it is gone once this
    // throws. Server logs are the one place a deployment can see it.
    console.error('[segment-lyrics] rejected model response:', String(raw).slice(0, 4000));
    throw new SegmentationRequestError(error instanceof Error ? error.message : String(error), 502);
  }
};
