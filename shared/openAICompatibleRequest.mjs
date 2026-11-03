// Shared OpenAI-compatible bounded request-shape negotiation. Which provider an endpoint is comes
// from shared/ai/providerRegistry.mjs (inferAiProviderFromUrl); callers pass its id as `provider`.

const capabilityCache = new Map();

const getCapabilities = (apiUrl, model) => {
  const key = JSON.stringify([apiUrl, model]);
  let capabilities = capabilityCache.get(key);
  if (!capabilities) {
    capabilities = {};
    capabilityCache.set(key, capabilities);
  }
  return capabilities;
};

export const resetOpenAICompatibleCapabilities = () => capabilityCache.clear();

const parseErrorPayload = (text) => {
  try {
    return JSON.parse(text.replace(/^OpenAI compatible API error \(\d+\):\s*/, ''));
  } catch {
    return null;
  }
};

const rejectionPattern = (parameter) => {
  const escaped = parameter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // A field may be named with its sub-path (GLM writes `thinking.type` for a rejected `thinking`).
  const named = `["'\`]${escaped}(?:[.[][^"'\`\\s]*)?["'\`]`;
  return new RegExp(
    `(?:unsupported|invalid|unknown|unrecognized|not allowed)\\s+(?:(?:parameter|argument|field)\\s*)?[:=]?\\s*["'\`]?${escaped}\\b`
      + `|\\b${escaped}\\b\\s+(?:is\\s+)?(?:unsupported|not supported|not allowed|unrecognized)`
      // GLM 1214: Parameter `x` is invalid.
      + `|\\bparameter\\s*${named}\\s+(?:is\\s+)?(?:invalid|unsupported|not supported|not allowed|unrecognized)`
      // OpenAI: Unsupported value: 'x' does not support 'none' with this model.
      + `|\\bunsupported value:\\s*${named}`
      // OpenAI: Unrecognized request argument supplied: x
      + `|\\bunrecognized request arguments? supplied:\\s*["'\`]?${escaped}\\b`
      + `|extra_forbidden[^\\r\\n]*\\bloc(?:ation)?\\s*[:=]\\s*["'\`]?${escaped}\\b`
      + `|\\bloc(?:ation)?\\s*[:=]\\s*["'\`]?${escaped}\\b[^\\r\\n]*extra_forbidden`,
    'i',
  );
};

/** `thinking.type` and `thinking[0]` name the `thinking` field as well. */
const namesParameter = (named, parameter) => typeof named === 'string'
  && (named === parameter || named.startsWith(`${parameter}.`) || named.startsWith(`${parameter}[`));

/**
 * True only when a 400/422 explicitly identifies the rejected request field.
 *
 * `text` should be the provider's raw error body: a formatted message keeps only `error.message`
 * and loses `error.param` and `error.code`, which are often the only place the field is named.
 * A formatted "OpenAI compatible API error (400): …" string is still accepted.
 */
export const rejectsOpenAICompatibleParameter = (status, text, parameter) => {
  if ((status !== 400 && status !== 422) || /rate.?limit|concurrency|quota/i.test(text)) return false;

  const payload = parseErrorPayload(text);
  if (payload && typeof payload === 'object') {
    const error = payload.error && typeof payload.error === 'object' ? payload.error : null;
    const exactParameter = error?.param ?? payload.param;
    if (namesParameter(exactParameter, parameter)) {
      const detail = `${error?.code ?? payload.code ?? ''} ${error?.message ?? payload.message ?? ''}`;
      return /unsupported|invalid|unknown|unrecognized|not allowed|extra_forbidden/i.test(detail);
    }

    if (Array.isArray(payload.detail)) {
      return payload.detail.some((issue) => Array.isArray(issue?.loc)
        && issue.loc.includes(parameter)
        && (issue.type === 'extra_forbidden' || /extra inputs are not permitted/i.test(issue.msg || '')));
    }

    const message = error?.message ?? payload.message;
    return typeof message === 'string' && rejectionPattern(parameter).test(message);
  }

  return rejectionPattern(parameter).test(text);
};

/**
 * Sends one OpenAI-compatible request and retries only explicit request-field rejections.
 * Feature policy stays in `body`: this layer never adds reasoning or thinking controls itself, and
 * never takes them away either. Reasoning fields (`thinking`, `reasoning_effort` and the like) are
 * the knobs of the adapter's attempts, and only the attempt runner (shared/ai/attemptRunner.mjs)
 * moves past a rejected one, to the next attempt the adapter wrote for that case.
 *
 * `rejectsFormat(status, text, field)` decides whether an error rejects `response_format`. It
 * defaults to the shared check, which needs the field named; an adapter passes its own when its
 * provider can reject it without naming anything (GLM's 1210). Since such an error may as well be
 * about another field, the format is only remembered as unsupported once a request without it
 * succeeds.
 */
export const sendOpenAICompatibleRequest = async ({
  apiUrl,
  provider,
  body,
  init,
  fetchImpl = fetch,
  rejectsFormat = rejectsOpenAICompatibleParameter,
}) => {
  const requestBody = { ...body };
  const capabilities = getCapabilities(apiUrl, requestBody.model);
  let droppedFormat = false;

  if (provider !== 'openai' && capabilities.responseFormat === false) delete requestBody.response_format;
  if (capabilities.tokenField === 'max_completion_tokens' && requestBody.max_tokens !== undefined) {
    requestBody.max_completion_tokens = requestBody.max_tokens;
    delete requestBody.max_tokens;
  }

  for (;;) {
    const response = await fetchImpl(apiUrl, { ...init, body: JSON.stringify(requestBody) });
    if (response.ok) {
      if (provider !== 'openai') {
        if (droppedFormat) capabilities.responseFormat = false;
        if (requestBody.max_completion_tokens !== undefined) capabilities.tokenField = 'max_completion_tokens';
        else if (requestBody.max_tokens !== undefined) capabilities.tokenField = 'max_tokens';
      }
      return response;
    }
    if (provider === 'openai' || (response.status !== 400 && response.status !== 422)) return response;

    const text = await response.clone().text();
    if (requestBody.response_format
      && (rejectsFormat(response.status, text, 'response_format')
        || rejectsFormat(response.status, text, 'json_schema'))) {
      delete requestBody.response_format;
      droppedFormat = true;
      console.info('[ai] endpoint rejected response_format; retrying without it');
      continue;
    }
    if (requestBody.max_tokens !== undefined
      && rejectsOpenAICompatibleParameter(response.status, text, 'max_tokens')) {
      requestBody.max_completion_tokens = requestBody.max_tokens;
      delete requestBody.max_tokens;
      console.info('[ai] endpoint rejected max_tokens; retrying with max_completion_tokens');
      continue;
    }
    return response;
  }
};
