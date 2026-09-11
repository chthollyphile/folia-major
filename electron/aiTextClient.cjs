"use strict";

const { REASONING_SUPPRESSION_ATTEMPTS } = require('../shared/lyricSegmentationPrompt.cjs');

// electron/aiTextClient.cjs
// Provider-agnostic "send a system + user prompt, get JSON back" client for the main process.
//
// Every one of these helpers already existed inline in main.cjs, written for the single AI feature
// the app had (theme generation). Segmentation needs the same plumbing with a different schema, so
// it moves here rather than being copied: main.cjs is ~5400 lines and is explicitly off-limits for
// new feature logic (skills/file-modularization).
//
// The one behavioural rule worth restating: only `openai` itself accepts
// `response_format: json_schema`. DeepSeek and the long tail of OpenAI-compatible endpoints reject
// it, so they get `{ type: 'json_object' }` and the caller validates the shape instead.

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_MODEL = 'gpt-5.6-luna';
const DEEPSEEK_DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;
const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent';

// Nothing on this path had a deadline before. A base URL pointing at something unreachable — a
// local server that is not running, a proxy that black-holes the connection — left the renderer
// spinning forever with no error and no log, which is exactly how it presented in the wild.
const DEFAULT_AI_TIMEOUT_MS = 120_000;

/** AbortSignal that fires after `timeoutMs`, so a stalled request fails instead of hanging. */
const timeoutSignal = (timeoutMs) => {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
};

/** Turns an abort into a message that names the deadline rather than a bare "aborted". */
const describeFetchFailure = (error, timeoutMs, label) => {
  const name = error && error.name;
  if (name === 'TimeoutError' || name === 'AbortError') {
    return new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
  return error instanceof Error ? error : new Error(String(error));
};

function normalizeOpenAIChatCompletionsUrl(rawUrl) {
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
}

function resolveOpenAICompatibleModel(apiUrl, configuredModel) {
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
}

function detectOpenAICompatibleProvider(apiUrl, model) {
  const normalizedModel = model.trim().toLowerCase();
  if (normalizedModel.startsWith('deepseek-')) {
    return 'deepseek';
  }

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
}

function providerSupportsStructuredOutputs(provider) {
  return provider === 'openai';
}

/**
 * Remembers which rung of REASONING_SUPPRESSION_ATTEMPTS worked for an endpoint+model, so the
 * probing is paid once per process rather than on every batch. Keyed by both because one base URL
 * can serve models with completely different capabilities.
 */
const reasoningAttemptCache = new Map();

/** True when a 400 is the server rejecting the parameter we just added, not a real failure. */
const rejectsParameters = (errorText, params) => {
  const message = String(errorText).toLowerCase();
  return Object.keys(params).some(key => message.includes(key.toLowerCase()));
};

/**
 * True when the model answered nothing because reasoning consumed the whole budget. This is the
 * failure that looks like success: HTTP 200, tokens billed, `content` empty.
 */
const exhaustedByReasoning = (choice, usage) => {
  const reasoningTokens = usage
    && usage.completion_tokens_details
    && usage.completion_tokens_details.reasoning_tokens;
  const hasReasoning = Boolean(
    reasoningTokens || (choice && choice.message && choice.message.reasoning_content),
  );
  return hasReasoning && choice && choice.finish_reason === 'length';
};


function resolveOpenAICompatibleTemperature(value) {
  const temperature = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(temperature) && temperature >= 0 && temperature <= 2
    ? temperature
    : DEFAULT_OPENAI_TEMPERATURE;
}

function extractProviderErrorMessage(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = payload.error;
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && typeof error.message === 'string') {
    return error.message;
  }

  return typeof payload.message === 'string' ? payload.message : null;
}

async function formatOpenAICompatibleError(response) {
  const rawText = await response.text();
  let detail = rawText.trim();

  try {
    const parsed = JSON.parse(rawText);
    detail = extractProviderErrorMessage(parsed) || detail;
  } catch {
    // Leave non-JSON responses as-is.
  }

  return detail
    ? `OpenAI compatible API error (${response.status}): ${detail}`
    : `OpenAI compatible API error (${response.status}): ${response.statusText}`;
}

/**
 * Explains an empty completion instead of just reporting one.
 *
 * "Model returned an empty response" is true and useless. The case that actually happens is a
 * reasoning model spending its whole output budget on `reasoning_content` and never reaching the
 * answer, which looks identical from the outside — so say so, and name the parameter that fixes it.
 */
function describeEmptyCompletion(choice, usage, model) {
  const reasoningTokens = usage
    && usage.completion_tokens_details
    && usage.completion_tokens_details.reasoning_tokens;
  const finishReason = choice && choice.finish_reason;
  const hasReasoning = Boolean(
    reasoningTokens || (choice && choice.message && choice.message.reasoning_content),
  );

  if (hasReasoning && finishReason === 'length') {
    return `Model "${model}" used its entire output budget on reasoning`
      + `${reasoningTokens ? ` (${reasoningTokens} reasoning tokens)` : ''} and returned no answer.`
      + ' This is a reasoning model doing a mechanical task. Point the app at a non-reasoning model,'
      + ' or raise the token limit if the provider ignores reasoning_effort.';
  }
  if (finishReason === 'length') {
    return `Model "${model}" hit the output token limit before finishing its answer.`;
  }
  return `Model "${model}" returned an empty response`
    + `${finishReason ? ` (finish_reason: ${finishReason})` : ''}.`;
}

function extractResponseContentText(message) {
  if (!message) {
    return null;
  }

  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new Error(`Model refused request: ${message.refusal}`);
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((part) => part && typeof part === 'object')
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
    return text || null;
  }

  return null;
}

/** Parses a JSON object even when an OpenAI-compatible endpoint wraps it in a fence or prose. */
function parseAiJsonObject(input, requiredKeys = []) {
  const text = typeof input === 'string' ? input.trim() : '';

  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === '{') depth += 1;
      else if (char === '}' && --depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, index + 1));
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            && requiredKeys.every((key) => Object.hasOwn(parsed, key))) return parsed;
        } catch {
          break;
        }
      }
    }
  }

  const requirement = requiredKeys.length ? ` with required keys: ${requiredKeys.join(', ')}` : '';
  throw new Error(`AI response did not contain a valid JSON object${requirement}`);
}

/**
 * Chat-completions body for any OpenAI-compatible endpoint. `schema` and `schemaName` are only
 * used on providers that support structured outputs; everywhere else they are ignored and the
 * request falls back to plain JSON mode.
 */
function buildOpenAICompatibleRequestBody(model, provider, systemPrompt, sourcePrompt, temperature, schema, schemaName, maxTokens, extraParams) {
  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: sourcePrompt },
  ];

  // Bounds the worst case. In plain JSON mode some providers (DeepSeek notably) can emit a long
  // run of whitespace before any content and keep going until the cap; with no cap set that is an
  // unbounded body read, which presents as a request that never finishes. A caller that knows how
  // big its answer should be passes a ceiling; truncation then fails as a JSON parse error with
  // the raw response logged, which is diagnosable, unlike a hang.
  const limit = maxTokens ? { max_tokens: maxTokens } : {};
  const reasoning = extraParams || {};

  if (schema && schemaName && providerSupportsStructuredOutputs(provider)) {
    return {
      model,
      messages,
      temperature,
      ...limit,
      ...reasoning,
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      },
    };
  }

  return {
    model,
    messages,
    temperature,
    ...limit,
    ...reasoning,
    response_format: { type: 'json_object' },
  };
}

/** One request. Returns the outcome instead of throwing, so the ladder above can decide. */
async function sendOpenAICompatible({ apiUrl, apiKey, body, customFetch, timeoutMs }) {
  let response;
  try {
    response = await customFetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: timeoutSignal(timeoutMs),
    });
  } catch (error) {
    throw describeFetchFailure(error, timeoutMs, `Request to ${apiUrl}`);
  }

  if (!response.ok) {
    return { ok: false, status: response.status, errorText: await formatOpenAICompatibleError(response) };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw describeFetchFailure(error, timeoutMs, `Reading the response from ${apiUrl}`);
  }

  const choice = data.choices && data.choices[0];
  return { ok: true, choice, usage: data.usage, content: extractResponseContentText(choice && choice.message) };
}

/**
 * Raw JSON text from an OpenAI-compatible endpoint, using the user's configured connection.
 *
 * When `disableReasoning` is set this walks REASONING_SUPPRESSION_ATTEMPTS rather than assuming
 * anything about the provider, advancing on the two failures that mean "that rung does not apply
 * here": the server rejecting the parameter, and the model answering nothing because reasoning ate
 * the budget. Any other error is real and is reported immediately, so a bad key or a wrong model
 * name still fails on the first request instead of being retried three times.
 */
async function runOpenAICompatibleCompletion({ store, systemPrompt, sourcePrompt, schema, schemaName, customFetch, timeoutMs = DEFAULT_AI_TIMEOUT_MS, maxTokens, disableReasoning }) {
  const apiKey = store.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in settings');
  }

  const apiUrl = normalizeOpenAIChatCompletionsUrl(store.get('OPENAI_API_URL'));
  const model = resolveOpenAICompatibleModel(apiUrl, store.get('OPENAI_API_MODEL'));
  const temperature = resolveOpenAICompatibleTemperature(store.get('OPENAI_API_TEMPERATURE'));
  const provider = detectOpenAICompatibleProvider(apiUrl, model);

  const attempts = disableReasoning ? REASONING_SUPPRESSION_ATTEMPTS : [{ params: {} }];
  const cacheKey = `${apiUrl}|${model}`;
  const learned = disableReasoning ? reasoningAttemptCache.get(cacheKey) : 0;
  const firstIndex = typeof learned === 'number' ? learned : 0;

  let lastEmpty = null;
  for (let index = firstIndex; index < attempts.length; index += 1) {
    const { params } = attempts[index];
    const isLastAttempt = index === attempts.length - 1;
    // The final rung is for models whose reasoning cannot be turned off, so it needs room for the
    // reasoning AND the answer; the earlier rungs expect no reasoning at all.
    const budget = isLastAttempt && disableReasoning && maxTokens ? maxTokens * 4 : maxTokens;
    const body = buildOpenAICompatibleRequestBody(
      model, provider, systemPrompt, sourcePrompt, temperature, schema, schemaName, budget, params,
    );

    const described = Object.keys(params).length ? Object.keys(params).join('+') : 'plain';
    console.log(`[ai] POST ${apiUrl} model=${model} provider=${provider} reasoning=${described}`);
    const startedAt = Date.now();
    let result = await sendOpenAICompatible({ apiUrl, apiKey, body, customFetch, timeoutMs });

    const shouldRetryWithoutJsonMode = provider === 'generic' && body.response_format
      && ((result.ok && !result.content && !exhaustedByReasoning(result.choice, result.usage))
        || (!result.ok && result.status === 429 && /concurrency limit exceeded/i.test(result.errorText)));
    if (shouldRetryWithoutJsonMode) {
      console.log('[ai] generic JSON mode failed, retrying once without response_format');
      const fallbackBody = { ...body };
      delete fallbackBody.response_format;
      result = await sendOpenAICompatible({ apiUrl, apiKey, body: fallbackBody, customFetch, timeoutMs });
    }

    if (!result.ok) {
      // A rejected parameter is information, not a failure: this endpoint does not speak that
      // dialect, so move down the ladder. Everything else is the user's problem to see.
      if (!isLastAttempt && (result.status === 400 || result.status === 422) && rejectsParameters(result.errorText, params)) {
        console.log(`[ai] ${described} rejected by the endpoint, trying the next option`);
        continue;
      }
      throw new Error(result.errorText);
    }

    console.log(`[ai] ${apiUrl} answered in ${Date.now() - startedAt}ms`);

    if (result.content) {
      reasoningAttemptCache.set(cacheKey, index);
      return result.content;
    }

    lastEmpty = result;
    if (!isLastAttempt && exhaustedByReasoning(result.choice, result.usage)) {
      console.log(`[ai] ${described} did not stop the model reasoning, trying the next option`);
      continue;
    }
    break;
  }

  throw new Error(describeEmptyCompletion(
    lastEmpty && lastEmpty.choice,
    lastEmpty && lastEmpty.usage,
    model,
  ));
}

/**
 * Raw JSON text from Gemini. The model name is fixed here, matching the existing theme path: the
 * settings UI only exposes an API key for this provider, not a model field.
 */
async function runGeminiCompletion({ store, systemPrompt, sourcePrompt, responseSchema, generationConfig, customFetch, timeoutMs = DEFAULT_AI_TIMEOUT_MS, maxTokens }) {
  const apiKey = store.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in settings');
  }

  console.log('[ai] POST gemini-3-flash-preview');
  const startedAt = Date.now();

  let response;
  try {
    response = await customFetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: sourcePrompt }] }],
        // A caller with tuned settings (a thinking budget, a schema) passes the whole config;
        // otherwise it is assembled from the individual options.
        generationConfig: generationConfig ?? {
          responseMimeType: 'application/json',
          ...(responseSchema ? { responseSchema } : {}),
          ...(maxTokens ? { maxOutputTokens: maxTokens } : {}),
        },
      }),
      signal: timeoutSignal(timeoutMs),
    });
  } catch (error) {
    throw describeFetchFailure(error, timeoutMs, 'Request to Gemini');
  }
  console.log(`[ai] gemini headers ${response.status} in ${Date.now() - startedAt}ms, reading body…`);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${response.statusText}${errText ? ` - ${errText}` : ''}`);
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw describeFetchFailure(error, timeoutMs, 'Reading the response from Gemini');
  }
  console.log(`[ai] gemini body complete in ${Date.now() - startedAt}ms total`);

  const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content
    ? data.candidates[0].content.parts
    : null;
  const jsonText = Array.isArray(parts)
    ? (parts.find((part) => part && typeof part.text === 'string') || {}).text
    : null;
  if (!jsonText) {
    throw new Error('Model returned an empty response');
  }

  return jsonText;
}

/**
 * Runs one prompt through whichever provider the user configured and returns the raw JSON text.
 * Parsing is left to the caller so each feature can validate against its own contract.
 */
async function runAiJsonCompletion({ store, systemPrompt, sourcePrompt, schema, schemaName, geminiResponseSchema, geminiGenerationConfig, customFetch, timeoutMs, maxTokens, disableReasoning }) {
  const provider = store.get('AI_PROVIDER') || 'gemini';

  return provider === 'openai'
    ? runOpenAICompatibleCompletion({ store, systemPrompt, sourcePrompt, schema, schemaName, customFetch, timeoutMs, maxTokens, disableReasoning })
    : runGeminiCompletion({ store, systemPrompt, sourcePrompt, responseSchema: geminiResponseSchema, generationConfig: geminiGenerationConfig, customFetch, timeoutMs, maxTokens });
}

module.exports = {
  DEFAULT_AI_TIMEOUT_MS,
  DEEPSEEK_DEFAULT_MODEL,
  DEFAULT_OPENAI_CHAT_COMPLETIONS_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TEMPERATURE,
  buildOpenAICompatibleRequestBody,
  describeEmptyCompletion,
  detectOpenAICompatibleProvider,
  extractResponseContentText,
  formatOpenAICompatibleError,
  normalizeOpenAIChatCompletionsUrl,
  parseAiJsonObject,
  providerSupportsStructuredOutputs,
  resolveOpenAICompatibleModel,
  resolveOpenAICompatibleTemperature,
  runAiJsonCompletion,
};
