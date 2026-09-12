// Shared HTTP compatibility policy for Electron, Vercel and Worker requests.
const unsupportedFormats = new Set();
const unsupportedThinking = new Set();

export function resetOpenAICompatibilityCache() {
  unsupportedFormats.clear();
  unsupportedThinking.clear();
}

export function rejectsParameter(status, text, parameter) {
  if ((status !== 400 && status !== 422) || /rate.?limit|concurrency|quota/i.test(text)) return false;
  // Pydantic validation loc identifies the rejected field; input may contain unrelated fields.
  try {
    const payload = JSON.parse(text.replace(/^OpenAI compatible API error \(\d+\):\s*/, ''));
    if (Array.isArray(payload.detail)) {
      return payload.detail.some(issue => Array.isArray(issue.loc) && issue.loc.includes(parameter)
        && (issue.type === 'extra_forbidden' || /extra inputs are not permitted/i.test(issue.msg || '')));
    }
  } catch {
    // Plain-text gateways report the field and rejection together.
  }
  return /unsupported|not supported|does not support|invalid (?:parameter|argument)|unknown (?:parameter|argument)|unrecognized|not allowed|extra inputs are not permitted|extra_forbidden/i.test(text)
    && new RegExp(`\\b${parameter}\\b`, 'i').test(text);
}

export async function fetchOpenAICompatible(apiUrl, init, provider, fetchImpl = fetch) {
  const body = JSON.parse(init.body);
  // DeepSeek documents this switch; custom hosts are not assumed to implement it.
  // https://api-docs.deepseek.com/guides/thinking_mode/
  if (provider === 'deepseek') body.thinking = { type: 'disabled' };
  const cacheKey = JSON.stringify([apiUrl, body.model]);
  if (provider !== 'openai' && unsupportedFormats.has(cacheKey)) delete body.response_format;
  if (unsupportedThinking.has(cacheKey)) delete body.thinking;
  // Each retry removes one explicitly rejected capability. Successful/transport errors never retry.
  for (;;) {
    const response = await fetchImpl(apiUrl, { ...init, body: JSON.stringify(body) });
    if (response.ok || provider === 'openai' || (response.status !== 400 && response.status !== 422)) return response;
    const text = await response.text();
    if (body.response_format && (rejectsParameter(response.status, text, 'response_format')
      || rejectsParameter(response.status, text, 'json_schema'))) {
      delete body.response_format;
      unsupportedFormats.add(cacheKey);
      console.info('[ai] endpoint rejected response_format; retrying without it');
    } else if (body.thinking && rejectsParameter(response.status, text, 'thinking')) {
      delete body.thinking;
      unsupportedThinking.add(cacheKey);
      console.info('[ai] endpoint rejected thinking; retrying without it');
    } else if (body.max_tokens !== undefined && rejectsParameter(response.status, text, 'max_tokens')) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
      console.info('[ai] endpoint rejected max_tokens; retrying with max_completion_tokens');
    } else {
      // Keep an explicit output bound if neither token spelling is supported.
      return new Response(text, { status: response.status, statusText: response.statusText });
    }
  }
}
