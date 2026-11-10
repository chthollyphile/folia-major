"use strict";

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
//
// Which provider a connection is, and what each ask sends it, is decided by the adapters in
// shared/ai/ (providerRegistry.mjs resolves the settings, each adapter gives the request shapes,
// attemptRunner.mjs walks them). This file is the facade: it sends OpenAI-compatible and Gemini
// requests and runs the connection test; Anthropic is sent by ai/anthropicClient.cjs.

const DEFAULT_OPENAI_CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_OPENAI_TEMPERATURE = 0.7;
const { runAnthropicCompletion, runAnthropicConnectionTest } = require('./ai/anthropicClient.cjs');
const { MAX_ERROR_BODY_CHARS, describeFetchFailure, redactSecrets, redactUrl } = require('./ai/requestText.cjs');

/** A Gemini model from settings: `models/` dropped, `defaultModel` when blank, anything else refused. */
const resolveGeminiModel = (raw, defaultModel) => {
  const model = typeof raw === 'string' && raw.trim() ? raw.trim().replace(/^models\//, '') : defaultModel;
  if (!/^[\w.-]{1,256}$/.test(model)) throw new Error('Select a valid Gemini model in settings');
  return model;
};

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

// The shared AI modules (the provider registry and adapters, the attempt runner) are ESM; they are
// loaded once, on first use. Which of an adapter's attempts worked for an endpoint+model is
// remembered by the runner, so the probing is paid once per process rather than on every batch.
let aiModules = null;
const loadAiModules = () => {
  aiModules ??= Promise.all([
    import('../shared/ai/providerRegistry.mjs'),
    import('../shared/ai/attemptRunner.mjs'),
    import('../shared/ai/aiTasks.mjs'),
    import('../shared/ai/compatibleBody.mjs'),
    import('../shared/ai/gemini.mjs'),
  ]).then(([registry, runner, tasks, compatible, gemini]) => ({
    ...registry, ...runner, ...tasks, ...compatible, generateContentUrl: gemini.generateContentUrl,
  }));
  return aiModules;
};

/** The stored settings resolveAiConnection reads, from the store or the credential store's view. */
const connectionSettingsOf = (store) => ({
  AI_PROVIDER: store.get('AI_PROVIDER'),
  AI_PROVIDER_PRESET: store.get('AI_PROVIDER_PRESET'),
  OPENAI_API_URL: store.get('OPENAI_API_URL'),
  OPENAI_API_MODEL: store.get('OPENAI_API_MODEL'),
  GEMINI_API_MODEL: store.get('GEMINI_API_MODEL'),
});

/** The configured connection (see resolveAiConnection) and its adapter. */
async function resolveStoredConnection(store) {
  const ai = await loadAiModules();
  const connection = ai.resolveAiConnection(connectionSettingsOf(store));
  return { ai, connection, adapter: ai.getAiAdapter(connection.adapterId) };
}

/** Who made a generated theme, for its `provider` field: names the protocol, never the host. */
async function aiProviderLabel(store) {
  const { connection } = await resolveStoredConnection(store);
  if (connection.protocol === 'gemini') {
    return 'Google Gemini (Local)';
  }
  return connection.protocol === 'anthropic' ? 'Anthropic (Local)' : 'OpenAI Compatible (Local)';
}


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

/** The displayable error line for a failed response whose body has already been read. */
function formatOpenAICompatibleErrorText(response, rawText) {
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
 *
 * `exhausted` is the attempt runner's verdict (compatibleBody.exhaustedByReasoning with the
 * adapter, which also knows a provider's own words for a cut-off answer, such as MiMo's
 * repetition_truncation); without it, reasoning plus finish_reason 'length' is the test.
 */
function describeEmptyCompletion(choice, usage, model, exhausted) {
  const reasoningTokens = usage
    && usage.completion_tokens_details
    && usage.completion_tokens_details.reasoning_tokens;
  const finishReason = choice && choice.finish_reason;
  const hasReasoning = Boolean(
    reasoningTokens || (choice && choice.message && choice.message.reasoning_content),
  );

  if (exhausted ?? (hasReasoning && finishReason === 'length')) {
    const tokens = reasoningTokens ? ` (${reasoningTokens} reasoning tokens)` : '';
    const advice = ' This is a reasoning model doing a mechanical task. Point the app at a non-reasoning model,'
      + ' or raise the token limit if the provider ignores reasoning_effort.';
    if (finishReason && finishReason !== 'length') {
      return `Model "${model}" stopped while still reasoning${tokens} (finish_reason: ${finishReason}) and returned no answer.${advice}`;
    }
    return `Model "${model}" used its entire output budget on reasoning${tokens} and returned no answer.${advice}`;
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

/**
 * Incremental reader for an OpenAI-style SSE chat-completions stream (pure, no I/O).
 *
 * The result must still be structured JSON, so nothing is surfaced until the stream ends: this only
 * stitches `choices[0].delta.content` back into the same `{ choice, content }` shape a non-streamed
 * response produces, and the caller feeds that through the identical validation path. `push` takes
 * decoded text chunks of any size (lines may be split across chunks, line endings may be \n, \r\n or
 * \r); `finish` flushes the tail and returns the outcome. A mid-stream `{"error":...}` event throws.
 * `reasoning_content` is deliberately not appended to the answer, only remembered so an
 * "all budget spent on reasoning" completion is diagnosed the same way as in the non-streamed case.
 */
function createOpenAIStreamAccumulator() {
  let buffer = '';
  let content = '';
  let refusal = '';
  let reasoning = '';
  let finishReason = null;
  let usage;
  let model;
  let sawData = false;
  let done = false;
  // Lines that are not SSE fields at all. Some proxies ignore `stream: true` and answer with one
  // plain JSON body; this keeps that body so it can still be understood at the end.
  let foreign = '';

  const handleData = (payloadText) => {
    sawData = true;
    // Nothing after [DONE] belongs to the answer (some relays append usage or junk frames).
    if (done) {
      return;
    }
    if (payloadText === '[DONE]') {
      done = true;
      return;
    }
    let payload;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      return;
    }
    if (!payload || typeof payload !== 'object') {
      return;
    }
    if (payload.error) {
      throw new Error(`OpenAI compatible API error (stream): ${extractProviderErrorMessage(payload) || JSON.stringify(payload.error)}`);
    }
    if (payload.usage && typeof payload.usage === 'object') {
      usage = payload.usage;
    }
    if (typeof payload.model === 'string' && payload.model) {
      model = payload.model;
    }
    const choice = Array.isArray(payload.choices) ? payload.choices[0] : null;
    if (!choice) {
      return;
    }
    const delta = choice.delta;
    if (delta && typeof delta === 'object') {
      if (typeof delta.content === 'string') {
        content += delta.content;
      }
      if (typeof delta.refusal === 'string') {
        refusal += delta.refusal;
      }
      if (typeof delta.reasoning_content === 'string') {
        reasoning += delta.reasoning_content;
      }
    }
    if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
      finishReason = choice.finish_reason;
    }
  };

  const handleLine = (line) => {
    if (!line || line.startsWith(':')) {
      return;
    }
    if (line.startsWith('data:')) {
      handleData(line.slice(5).replace(/^ /, '').trim());
      return;
    }
    if (/^(event|id|retry)(:|$)/.test(line)) {
      return;
    }
    if (!sawData) {
      foreign += `${line}\n`;
    }
  };

  const drain = (final) => {
    const lines = buffer.split(/\r\n|\n|\r/);
    buffer = final ? '' : lines.pop();
    for (const line of lines) {
      handleLine(line);
    }
    if (final && buffer) {
      handleLine(buffer);
    }
  };

  return {
    push(text) {
      buffer += text;
      drain(false);
    },
    finish() {
      drain(true);

      if (!sawData && foreign.trim().startsWith('{')) {
        let parsed = null;
        try {
          parsed = JSON.parse(foreign);
        } catch {
          // Not JSON either; fall through to the empty-completion diagnosis.
        }
        if (parsed && parsed.error) {
          throw new Error(`OpenAI compatible API error (stream): ${extractProviderErrorMessage(parsed) || JSON.stringify(parsed.error)}`);
        }
        const choice = parsed && Array.isArray(parsed.choices) ? parsed.choices[0] : null;
        if (choice) {
          return { choice, usage: parsed.usage, model: typeof parsed.model === 'string' ? parsed.model : undefined, content: extractResponseContentText(choice.message), done: true };
        }
      }

      const message = { content };
      if (refusal) {
        message.refusal = refusal;
      }
      if (reasoning) {
        message.reasoning_content = reasoning;
      }
      const choice = { finish_reason: finishReason, message };
      return { choice, usage, model, content: extractResponseContentText(message), done };
    },
  };
}

/** Reads a fetch Response body through the accumulator above and returns the assembled outcome. */
async function readOpenAIStreamResponse(response) {
  const accumulator = createOpenAIStreamAccumulator();
  if (!response.body || typeof response.body.getReader !== 'function') {
    accumulator.push(await response.text());
    return accumulator.finish();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      accumulator.push(decoder.decode(value, { stream: true }));
    }
    accumulator.push(decoder.decode());
    return accumulator.finish();
  } catch (error) {
    // Stop pulling bytes from the connection once the outcome is already an error.
    reader.cancel().catch(() => {});
    throw error;
  }
}

/**
 * One request. Returns the outcome instead of throwing, so the attempt runner can decide.
 * `adapter` is the provider's: its id says whether the transport may renegotiate the request
 * (OpenAI itself never is), and its rejected-parameter check reads its provider's errors about
 * response_format.
 */
async function sendOpenAICompatible({ apiUrl, apiKey, adapter, body, customFetch, timeoutMs }) {
  let response;
  try {
    const { sendOpenAICompatibleRequest } = await import('../shared/openAICompatibleRequest.mjs');
    response = await sendOpenAICompatibleRequest({
      apiUrl,
      provider: adapter.id,
      rejectsFormat: adapter.rejectedParameter,
      body,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: timeoutSignal(timeoutMs),
      },
      fetchImpl: customFetch,
    });
  } catch (error) {
    throw describeFetchFailure(error, timeoutMs, `Request to ${redactUrl(apiUrl)}`);
  }

  if (!response.ok) {
    // errorText is for people; errorBody keeps error.param and error.code for the ladder.
    const rawText = await response.text();
    return {
      ok: false,
      status: response.status,
      errorText: formatOpenAICompatibleErrorText(response, rawText),
      errorBody: rawText.slice(0, MAX_ERROR_BODY_CHARS),
    };
  }

  if (body && body.stream === true) {
    try {
      return { ok: true, status: response.status, ...(await readOpenAIStreamResponse(response)) };
    } catch (error) {
      throw describeFetchFailure(error, timeoutMs, `Reading the response from ${redactUrl(apiUrl)}`);
    }
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw describeFetchFailure(error, timeoutMs, `Reading the response from ${redactUrl(apiUrl)}`);
  }

  const choice = data.choices && data.choices[0];
  return {
    ok: true,
    status: response.status,
    choice,
    usage: data.usage,
    model: typeof data.model === 'string' ? data.model : undefined,
    content: extractResponseContentText(choice && choice.message),
  };
}

/**
 * Raw JSON text from an OpenAI-compatible endpoint, using the user's configured connection.
 *
 * This walks the adapter's attempts for `task` through shared/ai/attemptRunner.mjs rather than
 * assuming anything about the provider, advancing on the two failures that mean "that rung does
 * not apply here": the server rejecting the parameter, and the model answering nothing because
 * reasoning ate the budget. Any other error is real and is reported immediately, so a bad key or a
 * wrong model name still fails on the first request instead of being retried three times.
 */
async function runOpenAICompatibleCompletion({ ai, adapter, connection, apiKey, task, systemPrompt, sourcePrompt, schema, schemaName, answerTokens, temperature, stream, customFetch, timeoutMs }) {
  const apiUrl = normalizeOpenAIChatCompletionsUrl(connection.apiUrl);
  const { model } = connection;

  return ai.runAttempts({
    adapter,
    task,
    url: apiUrl,
    model,
    attempts: adapter.attempts(task, model),
    log: (line) => console.log(line),
    describeEmpty: (result) => describeEmptyCompletion(result.choice, result.usage, model, result.exhausted),
    send: async (attempt) => {
      const body = ai.buildCompatibleBody(adapter, {
        task, model, attempt, systemPrompt, sourcePrompt, schema, schemaName,
        budget: ai.budgetFor(task, answerTokens, attempt), temperature, stream,
      });
      if (body.temperature !== undefined && body.temperature !== temperature) {
        console.log(`[ai] temperature ${temperature} is outside ${adapter.id}'s range, sending ${body.temperature}`);
      }

      console.log(`[ai] POST ${redactUrl(apiUrl)} model=${model} provider=${adapter.id} reasoning=${attempt.label}${stream ? ' stream=on' : ''}`);
      const startedAt = Date.now();
      const result = await sendOpenAICompatible({ apiUrl, apiKey, adapter, body, customFetch, timeoutMs });
      if (!result.ok) {
        return ai.withErrorHint(adapter, result);
      }
      console.log(`[ai] ${redactUrl(apiUrl)} answered in ${Date.now() - startedAt}ms`);
      return { ...result, exhausted: ai.exhaustedByReasoning(result.choice, result.usage, adapter) };
    },
  });
}

/** The saved Gemini key, or the error the window takes for a missing one. */
const requireGeminiKey = (store) => {
  const apiKey = store.get('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in settings');
  }
  return apiKey;
};

/**
 * One request to Gemini for one attempt, as the attempt runner expects it: an HTTP failure comes
 * back as `{ ok: false, status, errorText, errorBody }`, a failure to send or to read is thrown.
 *
 * With `timeoutMs` the request runs under that deadline, and a failure to send or to read says
 * what timed out; without it there is no deadline and a failure is handed on as it came. `log`
 * prints how long each step took.
 */
async function sendGemini({ apiKey, url, model, body, customFetch, timeoutMs, log = false }) {
  const timed = typeof timeoutMs === 'number';
  const failure = (error, label) => (timed ? describeFetchFailure(error, timeoutMs, label) : error);
  if (log) {
    console.log('[ai] POST ' + model);
  }
  const startedAt = Date.now();

  let response;
  try {
    response = await customFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      ...(timed ? { signal: timeoutSignal(timeoutMs) } : {}),
    });
  } catch (error) {
    throw failure(error, 'Request to Gemini');
  }
  if (log) {
    console.log(`[ai] gemini headers ${response.status} in ${Date.now() - startedAt}ms, reading body…`);
  }

  if (!response.ok) {
    const errText = await response.text();
    return {
      ok: false,
      status: response.status,
      errorText: `Gemini API error: ${response.status} ${response.statusText}${errText ? ` - ${errText}` : ''}`,
      errorBody: errText.slice(0, MAX_ERROR_BODY_CHARS),
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw failure(error, 'Reading the response from Gemini');
  }
  if (log) {
    console.log(`[ai] gemini body complete in ${Date.now() - startedAt}ms total`);
  }

  const candidate = data && data.candidates && data.candidates[0];
  const parts = candidate && candidate.content ? candidate.content.parts : null;
  return {
    ok: true,
    status: response.status,
    content: geminiAnswerText(parts),
    exhausted: geminiThinkingExhausted(candidate, data),
    candidate,
    data,
  };
}

/**
 * The answer text of a Gemini candidate: every text part except thought summaries (`thought: true`),
 * which only come back when asked for and are never part of the answer [Gemini·thinking].
 */
function geminiAnswerText(parts) {
  if (!Array.isArray(parts)) {
    return null;
  }
  const text = parts
    .filter((part) => part && part.thought !== true && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
  return text || null;
}

/** Thinking tokens Gemini reported for the response, if any. */
function geminiThoughtsTokens(data) {
  const tokens = data && data.usageMetadata && data.usageMetadata.thoughtsTokenCount;
  return typeof tokens === 'number' ? tokens : 0;
}

/**
 * True when the cap was reached while the model was still thinking. Gemini counts thinking tokens
 * inside maxOutputTokens, so a MAX_TOKENS finish with thoughts reported means thinking ate the
 * budget [Gemini·thinking].
 */
function geminiThinkingExhausted(candidate, data) {
  return Boolean(candidate && candidate.finishReason === 'MAX_TOKENS' && geminiThoughtsTokens(data) > 0);
}

/**
 * Why a Gemini answer came back without text, in the caller's own words (`fallback`) unless there
 * is something more specific to say: thinking used the whole budget, the cap was reached, the
 * response stopped for another reason, or the prompt itself was blocked.
 */
function describeEmptyGeminiAnswer(result, model, fallback) {
  const finishReason = result.candidate && result.candidate.finishReason;
  if (result.exhausted) {
    return `Model "${model}" used its entire output budget on thinking`
      + ` (${geminiThoughtsTokens(result.data)} thinking tokens) and returned no answer.`;
  }
  if (finishReason === 'MAX_TOKENS') {
    return `Model "${model}" hit the output token limit before finishing its answer.`;
  }
  if (finishReason && finishReason !== 'STOP') {
    return `${fallback} (finishReason: ${finishReason})`;
  }
  const blockReason = result.data && result.data.promptFeedback && result.data.promptFeedback.blockReason;
  return blockReason ? `${fallback} (blockReason: ${blockReason})` : fallback;
}

/**
 * Raw JSON text from Gemini for one ask, using the selected model or the existing default for
 * older settings. `emptyMessage` is what an answer with no text fails with; `timeoutMs` and `log`
 * are as in sendGemini.
 */
async function runGeminiCompletion({ ai, store, task, systemPrompt, sourcePrompt, geminiSchema, answerTokens, customFetch, timeoutMs, log = false, emptyMessage }) {
  const apiKey = requireGeminiKey(store);
  const adapter = ai.getAiAdapter('gemini');
  const model = resolveGeminiModel(store.get('GEMINI_API_MODEL'), adapter.defaultModel);
  const url = ai.generateContentUrl(model);

  return ai.runAttempts({
    adapter,
    task,
    url,
    model,
    attempts: adapter.attempts(task, model),
    ...(log ? { log: (line) => console.log(line) } : {}),
    describeEmpty: (result) => describeEmptyGeminiAnswer(result, model, emptyMessage),
    send: (attempt) => sendGemini({
      apiKey,
      url,
      model,
      body: adapter.buildBody({
        task, model, attempt, systemPrompt, sourcePrompt, geminiSchema,
        budget: ai.budgetFor(task, answerTokens, attempt),
      }),
      customFetch,
      timeoutMs,
      log,
    }),
  });
}

/**
 * The theme ask on Gemini, already parsed. It keeps what it did while the 'generate-theme' handler
 * in main.cjs wrote this request itself (no log lines, its own message for an empty answer), but
 * it now sends the adapter's theme thinking level, caps the output at `answerTokens` plus room for
 * thinking, and runs under the same deadline as the other asks; it had none.
 */
async function runGeminiThemeCompletion({ store, systemPrompt, sourcePrompt, responseSchema, answerTokens, customFetch, timeoutMs = DEFAULT_AI_TIMEOUT_MS }) {
  const ai = await loadAiModules();
  return JSON.parse(await runGeminiCompletion({
    ai,
    store,
    task: 'theme',
    systemPrompt,
    sourcePrompt,
    geminiSchema: responseSchema,
    answerTokens,
    customFetch,
    timeoutMs,
    emptyMessage: 'Failed to generate theme JSON',
  }));
}

const JSON_TASKS = new Set(['segmentation', 'theme']);

/**
 * Runs one prompt through whichever provider the user configured and returns the raw JSON text.
 * Parsing is left to the caller so each feature can validate against its own contract.
 *
 * `task` ('segmentation' or 'theme') picks the adapter's request shapes; `answerTokens` is what the
 * answer itself needs, and attempts that cannot switch reasoning off get room for it on top
 * (shared/ai/aiTasks.mjs). `schema` is JSON Schema, `geminiSchema` the same in Gemini's dialect.
 */
async function runAiJsonCompletion({ store, task, systemPrompt, sourcePrompt, schema, schemaName, geminiSchema, answerTokens, customFetch, timeoutMs = DEFAULT_AI_TIMEOUT_MS }) {
  if (!JSON_TASKS.has(task)) {
    throw new Error(`Unknown AI task: ${task}`);
  }
  const { ai, connection, adapter } = await resolveStoredConnection(store);

  if (connection.protocol === 'gemini') {
    return runGeminiCompletion({
      ai, store, task, systemPrompt, sourcePrompt, geminiSchema, answerTokens, customFetch, timeoutMs,
      log: true,
      emptyMessage: 'Model returned an empty response',
    });
  }

  if (connection.presetId === 'custom' && !connection.apiUrl) {
    throw new Error('API URL is required for a custom AI provider');
  }
  const apiKey = store.get('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured in settings');
  }
  const temperature = resolveOpenAICompatibleTemperature(store.get('OPENAI_API_TEMPERATURE'));

  if (connection.protocol === 'anthropic') {
    return runAnthropicCompletion({
      adapter, task, apiUrl: connection.apiUrl, apiKey, model: connection.model,
      systemPrompt, sourcePrompt, schema, schemaName, answerTokens, temperature, customFetch, timeoutMs,
    });
  }
  return runOpenAICompatibleCompletion({
    ai, adapter, connection, apiKey, task, systemPrompt, sourcePrompt, schema, schemaName, answerTokens, temperature,
    stream: adapter.stream && store.get('OPENAI_API_STREAM') === true,
    customFetch,
    timeoutMs,
  });
}

// ---------------------------------------------------------------------------------------------
// Connection test ("send hello, show the reply").
//
// Runs with the values currently in the settings form, not the saved ones, so none of this reads
// or writes the store. It goes through the same request senders as the real features
// (sendOpenAICompatible / customFetch), which is what makes a pass here mean the real calls work.
// ---------------------------------------------------------------------------------------------

const AI_TEST_TIMEOUT_MS = 30_000;
// Roomy enough that a model which still reasons a little can get to its reply; the reply itself is
// cut for display (AI_TEST_MAX_REPLY_CHARS), so a large budget costs nothing visible.
const AI_TEST_MAX_TOKENS = 512;
const AI_TEST_PROMPT = 'hello';
const AI_TEST_MAX_REPLY_CHARS = 500;
const AI_TEST_MAX_ERROR_CHARS = 500;
const AI_TEST_MAX_FIELD_CHARS = { apiKey: 1024, apiUrl: 2048, model: 256 };
const AI_TEST_MAX_PRESET_ID_CHARS = 64;

const truncateText = (text, limit) => (text.length > limit ? `${text.slice(0, limit)}…` : text);

/**
 * Validates and normalises the renderer-supplied payload. Returns `{ config }` or `{ error }`; it
 * never throws, since the IPC handler must hand a displayable result back either way.
 */
function validateAiConnectionTestInput(raw) {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Invalid request.' };
  }
  const provider = raw.provider;
  if (provider !== 'gemini' && provider !== 'openai') {
    return { error: 'Unknown AI provider.' };
  }
  const readString = (name) => {
    const value = raw[name];
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value !== 'string' || value.length > AI_TEST_MAX_FIELD_CHARS[name]) {
      return null;
    }
    return value.trim();
  };
  const apiKey = readString('apiKey');
  const apiUrl = provider === 'openai' ? readString('apiUrl') : '';
  const model = readString('model');
  // The form's preset only says what it shows (the URL's host still picks the adapter); a custom
  // one must name its own address.
  const presetId = raw.presetId ?? '';
  if (typeof presetId !== 'string' || presetId.length > AI_TEST_MAX_PRESET_ID_CHARS) {
    return { error: 'Unknown AI provider preset.' };
  }
  if (provider === 'gemini' && model && !/^(?:models\/)?[\w.-]{1,256}$/.test(model)) {
    return { error: 'Invalid Gemini model.' };
  }
  if (apiKey === null || apiUrl === null || model === null) {
    return { error: 'A setting value is too long or has the wrong type.' };
  }
  if (provider === 'openai' && presetId === 'custom' && !apiUrl) {
    return { error: 'API URL is required for a custom AI provider.' };
  }
  if (apiUrl) {
    let parsed;
    try {
      parsed = new URL(apiUrl);
    } catch {
      return { error: 'API URL is not a valid URL.' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: 'API URL must start with http:// or https://.' };
    }
  }
  return {
    config: {
      provider,
      presetId,
      apiKey,
      apiUrl,
      model,
      stream: provider === 'openai' && raw.stream === true,
    },
  };
}

/**
 * The connection the unsaved form values describe, resolved exactly as the saved settings are
 * (resolveAiConnection), so the test, model discovery and the real requests agree on the adapter.
 */
function resolveFormConnection(ai, config) {
  return ai.resolveAiConnection({
    AI_PROVIDER: config.provider,
    AI_PROVIDER_PRESET: config.presetId,
    OPENAI_API_URL: config.apiUrl,
    OPENAI_API_MODEL: config.model,
    GEMINI_API_MODEL: config.model,
  });
}

/** The adapter the unsaved form values would use (model discovery shares this with the test). */
async function resolveFormAdapter(config) {
  const ai = await loadAiModules();
  const connection = resolveFormConnection(ai, config);
  return { ai, connection, adapter: ai.getAiAdapter(connection.adapterId) };
}

/**
 * Sends "hello" with the given (unsaved) settings and reports what came back.
 *
 * Resolves to `{ ok, status?, durationMs, model?, text?, emptyReason?, error?, errorKind? }` and
 * does not throw: a failed connection is the expected output of this function. `emptyReason` marks
 * a connection that worked but produced no text ('reasoning' = the budget went on reasoning,
 * 'empty' = anything else), so the UI can report it as a success with a caveat, not a failure.
 *
 * Each protocol walks its adapter's 'test' attempts with nothing remembered, so a pass means the
 * reasoning switches the real asks send are accepted too.
 */
async function runAiConnectionTest(rawInput, { customFetch, timeoutMs = AI_TEST_TIMEOUT_MS, now = Date.now } = {}) {
  const validated = validateAiConnectionTestInput(rawInput);
  if (validated.error) {
    return { ok: false, durationMs: 0, errorKind: 'invalid', error: validated.error };
  }
  const { provider, apiKey, apiUrl: rawApiUrl, model: rawModel, stream } = validated.config;
  const startedAt = now();
  const finish = (result) => ({ durationMs: now() - startedAt, ...result });
  // Servers sometimes echo the request back: Authorization header, key headers, ?key=.
  const redact = (message) => redactSecrets(message, apiKey);
  const scrub = (message) => truncateText(redact(message), AI_TEST_MAX_ERROR_CHARS);
  const failure = (error, extra = {}) => finish({
    ok: false,
    error: scrub(error instanceof Error ? error.message : error),
    ...extra,
  });
  const reply = (text) => truncateText(redact(text), AI_TEST_MAX_REPLY_CHARS);

  if (!apiKey) {
    return finish({
      ok: false,
      errorKind: 'config',
      error: provider === 'gemini' ? 'GEMINI_API_KEY is not configured in settings' : 'OPENAI_API_KEY is not configured in settings',
    });
  }

  const { ai, connection, adapter } = await resolveFormAdapter(validated.config);

  if (connection.protocol === 'anthropic') {
    const outcome = await runAnthropicConnectionTest({
      adapter, apiUrl: rawApiUrl, apiKey, model: connection.model, prompt: AI_TEST_PROMPT,
      answerTokens: AI_TEST_MAX_TOKENS, customFetch, timeoutMs,
    });
    if (!outcome.ok) {
      return failure(outcome.error, { ...(outcome.status ? { status: outcome.status } : {}), errorKind: outcome.errorKind });
    }
    return finish({
      ok: true,
      status: outcome.status,
      model: outcome.model,
      text: outcome.text ? reply(outcome.text) : '',
      ...(outcome.emptyReason ? { emptyReason: outcome.emptyReason } : {}),
    });
  }

  if (connection.protocol === 'gemini') {
    const model = resolveGeminiModel(rawModel, adapter.defaultModel);
    const url = ai.generateContentUrl(model);
    console.log('[ai-test] POST ' + model);
    let outcome;
    try {
      outcome = await ai.walkAttempts({
        adapter,
        task: 'test',
        url,
        model,
        attempts: adapter.attempts('test', model),
        cache: null,
        log: (line) => console.log(line.replace(/^\[ai\]/, '[ai-test]')),
        send: (attempt) => sendGemini({
          apiKey,
          url,
          model,
          body: adapter.buildBody({
            task: 'test', model, attempt, sourcePrompt: AI_TEST_PROMPT,
            budget: ai.budgetFor('test', AI_TEST_MAX_TOKENS, attempt),
          }),
          customFetch,
          timeoutMs,
        }),
      });
    } catch (error) {
      return failure(error, {
        ...(error && error.status ? { status: error.status } : {}),
        errorKind: /timed out/.test(error && error.message) ? 'timeout' : 'network',
      });
    }
    const { result } = outcome;
    if (!result.ok) {
      return failure(result.errorText, { status: result.status, errorKind: 'http' });
    }
    const text = result.content || '';
    const modelName = result.data && typeof result.data.modelVersion === 'string' ? result.data.modelVersion : model;
    if (!text.trim()) {
      const reason = result.candidate && result.candidate.finishReason === 'MAX_TOKENS' ? 'reasoning' : 'empty';
      return finish({ ok: true, status: result.status, model: modelName, text: '', emptyReason: reason });
    }
    return finish({ ok: true, status: result.status, model: modelName, text: reply(text) });
  }

  const apiUrl = normalizeOpenAIChatCompletionsUrl(rawApiUrl);
  const { model } = connection;
  console.log(`[ai-test] POST ${redactUrl(apiUrl)} model=${model} provider=${adapter.id}${stream ? ' stream=on' : ''}`);

  // Each attempt is one "hello" with the adapter's test switches; a model that rejects them by name
  // moves to the next attempt, and a successful response with no answer is still reported below
  // with an emptyReason.
  let outcome;
  try {
    outcome = await ai.walkAttempts({
      adapter,
      task: 'test',
      url: apiUrl,
      model,
      attempts: adapter.attempts('test', model),
      cache: null,
      log: (line) => console.log(line.replace(/^\[ai\]/, '[ai-test]')),
      send: async (attempt) => {
        const result = await sendOpenAICompatible({
          apiUrl,
          apiKey,
          adapter,
          body: ai.buildCompatibleBody(adapter, {
            task: 'test', model, attempt, sourcePrompt: AI_TEST_PROMPT,
            budget: ai.budgetFor('test', AI_TEST_MAX_TOKENS, attempt), stream: adapter.stream && stream,
          }),
          customFetch,
          timeoutMs,
        });
        return result.ok ? { ...result, exhausted: ai.exhaustedByReasoning(result.choice, result.usage, adapter) } : ai.withErrorHint(adapter, result);
      },
    });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).split(apiUrl).join(redactUrl(apiUrl));
    return failure(message, { errorKind: /timed out/.test(message) ? 'timeout' : 'network' });
  }
  const { result } = outcome;
  if (!result.ok) {
    return failure(result.errorText.split(apiUrl).join(redactUrl(apiUrl)), { status: result.status, errorKind: 'http' });
  }

  const shownModel = result.model || model;
  const text = typeof result.content === 'string' ? result.content : '';
  if (!text.trim()) {
    return finish({
      ok: true,
      status: result.status,
      model: shownModel,
      text: '',
      emptyReason: result.exhausted ? 'reasoning' : 'empty',
    });
  }
  return finish({ ok: true, status: result.status, model: shownModel, text: reply(text) });
}

module.exports = {
  DEFAULT_AI_TIMEOUT_MS,
  DEFAULT_OPENAI_CHAT_COMPLETIONS_URL,
  DEFAULT_OPENAI_TEMPERATURE,
  aiProviderLabel,
  createOpenAIStreamAccumulator,
  describeEmptyCompletion,
  extractResponseContentText,
  normalizeOpenAIChatCompletionsUrl,
  resolveFormAdapter,
  resolveOpenAICompatibleTemperature,
  runAiConnectionTest,
  runAiJsonCompletion,
  runGeminiThemeCompletion,
  validateAiConnectionTestInput,
};
