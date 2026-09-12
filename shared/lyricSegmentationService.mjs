import { fetchOpenAICompatible, rejectsParameter } from './openAICompatibility.mjs';
// shared/lyricSegmentationService.mjs
// Server-side lyric word segmentation, shared by the Vercel edge handler and the Cloudflare
// Worker. Those two runtimes differ only in where the environment comes from, so they are thin
// adapters over this and the prompt module rather than a third and fourth copy of the plumbing —
// which is what the theme feature ended up with.
//
// The provider is chosen by whichever key the deployment configured, because unlike the desktop
// build there is no user-facing setting here: the web deployment owns the credentials.

import {
  REASONING_SUPPRESSION_ATTEMPTS,
  SEGMENTATION_GEMINI_GENERATION_CONFIG,
  SEGMENTATION_JSON_SCHEMA,
  SEGMENTATION_MAX_OUTPUT_TOKENS,
  SEGMENTATION_SCHEMA_NAME,
  buildSegmentationSourcePrompt,
  buildSegmentationSystemPrompt,
  parseSegmentationResponse,
} from './lyricSegmentationPrompt.mjs';

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
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

const resolveOpenAICompatibleModel = (apiUrl, configuredModel) => {
  const trimmedModel = typeof configuredModel === 'string' ? configuredModel.trim() : '';
  if (trimmedModel) {
    return trimmedModel;
  }
  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return DEEPSEEK_DEFAULT_MODEL;
    }
  } catch {
    // Fall back to the generic OpenAI default when URL parsing fails.
  }
  return DEFAULT_OPENAI_MODEL;
};

const detectOpenAICompatibleProvider = (apiUrl, model) => {
  try {
    const hostname = new URL(apiUrl).hostname.toLowerCase();
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')) {
      return 'deepseek';
    }
    if (hostname === 'api.openai.com' || hostname.endsWith('.openai.com')) {
      return 'openai';
    }
  } catch {
    // Fall through to generic provider handling.
  }
  return 'generic';
};

const resolveTemperature = (value) => {
  const temperature = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
    ? temperature
    : DEFAULT_OPENAI_TEMPERATURE;
};

const readErrorDetail = async (response) => {
  const rawText = await response.text();
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

/** Remembers the successful suppression rung per endpoint and model. */
const reasoningAttemptCache = new Map();

const exhaustedByReasoning = (choice, usage) => {
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  const hasReasoning = Boolean(reasoningTokens || choice?.message?.reasoning_content);
  return hasReasoning && choice?.finish_reason === 'length';
};

const describeEmpty = (choice, usage, model) => {
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  if (exhaustedByReasoning(choice, usage)) {
    return `Model "${model}" used its entire output budget on reasoning (${reasoningTokens} tokens)`
      + ' and returned no answer. Configure a non-reasoning model for this deployment.';
  }
  return `Model "${model}" returned an empty response`
    + `${choice?.finish_reason ? ` (finish_reason: ${choice.finish_reason})` : ''}.`;
};

/**
 * Sends one request, returning the outcome rather than throwing, so the ladder can decide.
 * Mirrors sendOpenAICompatible in electron/aiTextClient.cjs.
 */
const sendOpenAICompatible = async (apiUrl, apiKey, body, fetchImpl) => {
  let response;
  try {
    response = await fetchOpenAICompatible(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: timeoutSignal(DEFAULT_AI_TIMEOUT_MS),
    }, detectOpenAICompatibleProvider(apiUrl, body.model), fetchImpl);
  } catch (error) {
    if (isAbort(error)) {
      throw new SegmentationRequestError(`Request to ${apiUrl} timed out`, 504);
    }
    throw error;
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    return {
      ok: false,
      status: response.status,
      errorText: `OpenAI compatible API error (${response.status})${detail ? `: ${detail}` : ''}`,
    };
  }

  const data = await response.json();
  const choice = data.choices && data.choices[0];
  return { ok: true, choice, usage: data.usage, content: extractContentText(choice && choice.message) };
};

/** Original segmentation suppression ladder, with HTTP capability fallbacks inside each rung. */
const runOpenAICompatible = async (lines, env, fetchImpl) => {
  const apiUrl = normalizeOpenAIChatCompletionsUrl(env.OPENAI_API_URL);
  const model = resolveOpenAICompatibleModel(apiUrl, env.OPENAI_API_MODEL);
  const provider = detectOpenAICompatibleProvider(apiUrl, model);
  const temperature = resolveTemperature(env.OPENAI_API_TEMPERATURE);

  const messages = [
    { role: 'system', content: buildSegmentationSystemPrompt() },
    { role: 'user', content: buildSegmentationSourcePrompt(lines) },
  ];

  // Only OpenAI itself accepts json_schema; everyone else rejects it and gets plain JSON mode.
  const responseFormat = provider === 'openai'
    ? {
      type: 'json_schema',
      json_schema: { name: SEGMENTATION_SCHEMA_NAME, strict: true, schema: SEGMENTATION_JSON_SCHEMA },
    }
    : { type: 'json_object' };

  const cacheKey = `${apiUrl}|${model}`;
  const learned = reasoningAttemptCache.get(cacheKey);
  const firstIndex = typeof learned === 'number' ? learned : 0;

  let lastEmpty = null;
  for (let index = firstIndex; index < REASONING_SUPPRESSION_ATTEMPTS.length; index += 1) {
    const { params } = REASONING_SUPPRESSION_ATTEMPTS[index];
    const isLastAttempt = index === REASONING_SUPPRESSION_ATTEMPTS.length - 1;
    const budget = isLastAttempt ? SEGMENTATION_MAX_OUTPUT_TOKENS * 4 : SEGMENTATION_MAX_OUTPUT_TOKENS;

    const result = await sendOpenAICompatible(apiUrl, env.OPENAI_API_KEY, {
      model,
      messages,
      temperature,
      [provider === 'openai' ? 'max_completion_tokens' : 'max_tokens']: budget,
      ...params,
      response_format: responseFormat,
    }, fetchImpl);

    if (!result.ok) {
      if (!isLastAttempt && Object.keys(params).some(key => rejectsParameter(result.status, result.errorText, key))) {
        continue;
      }
      throw new SegmentationRequestError(result.errorText, 502);
    }

    if (result.content) {
      reasoningAttemptCache.set(cacheKey, index);
      return result.content;
    }

    lastEmpty = result;
    if (!isLastAttempt && exhaustedByReasoning(result.choice, result.usage)) {
      continue;
    }
    break;
  }

  throw new SegmentationRequestError(
    describeEmpty(lastEmpty?.choice, lastEmpty?.usage, model),
    502,
  );
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
