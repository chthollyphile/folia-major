// Shared HTTP compatibility policy for Electron, Vercel and Worker requests.
const unsupportedFormats = new Set();

export function rejectsParameter(status, text, parameter) {
  return status === 400
    && /unsupported|not supported|does not support|invalid (?:parameter|argument)|unknown (?:parameter|argument)|unrecognized|not allowed/i.test(text)
    && text.toLowerCase().includes(parameter.toLowerCase())
    && !/rate.?limit|concurrency|quota/i.test(text);
}

export async function fetchOpenAICompatible(apiUrl, init, provider, fetchImpl = fetch) {
  const body = JSON.parse(init.body);
  // DeepSeek documents this switch; custom hosts are not assumed to implement it.
  // https://api-docs.deepseek.com/guides/thinking_mode/
  if (provider === 'deepseek') body.thinking = { type: 'disabled' };
  const cacheKey = JSON.stringify([apiUrl, body.model]);
  if (provider !== 'openai' && unsupportedFormats.has(cacheKey)) delete body.response_format;
  // Each retry removes one explicitly rejected capability. Successful/transport errors never retry.
  for (;;) {
    const response = await fetchImpl(apiUrl, { ...init, body: JSON.stringify(body) });
    if (response.ok || provider === 'openai' || response.status !== 400) return response;
    const text = await response.text();
    if (body.response_format && (rejectsParameter(400, text, 'response_format')
      || rejectsParameter(400, text, 'json_schema'))) {
      delete body.response_format;
      unsupportedFormats.add(cacheKey);
      console.info('[ai] endpoint rejected response_format; retrying without it');
    } else if (body.max_tokens !== undefined && rejectsParameter(400, text, 'max_tokens')) {
      body.max_completion_tokens = body.max_tokens;
      delete body.max_tokens;
      console.info('[ai] endpoint rejected max_tokens; retrying with max_completion_tokens');
    } else {
      // Keep an explicit output bound if neither token spelling is supported.
      return new Response(text, { status: response.status, statusText: response.statusText });
    }
  }
}
