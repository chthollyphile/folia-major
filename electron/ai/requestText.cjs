'use strict';

// electron/ai/requestText.cjs
// What the main process's AI requests may show of themselves in messages and log lines: addresses
// and provider error text with credentials taken out, a bounded raw error body, and a failure to
// send or read described by what timed out. Shared by electron/aiTextClient.cjs (OpenAI-compatible,
// Gemini, the connection test) and electron/ai/anthropicClient.cjs, so every protocol redacts alike.

// The raw error body kept for deciding whether a parameter was rejected. Bounded, because a
// misconfigured URL can answer with a whole HTML page. The same as shared/ai/compatibleBody.mjs's,
// which the web routes use; that one is ESM, loaded only on first use here.
const MAX_ERROR_BODY_CHARS = 16 * 1024;

/** Address with credentials and query dropped, safe to put in a message even if the user pasted a key into it. */
const redactUrl = (rawUrl) => {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname}`;
    } catch {
        return '[invalid url]';
    }
};

/**
 * `text` with the key and anything that looks like an echoed credential replaced by `***`.
 * Servers sometimes echo the request back: the Authorization header, Anthropic's and Gemini's key
 * headers, a key in the query.
 */
const redactSecrets = (text, apiKey) => {
    let redacted = String(text);
    if (apiKey) {
        redacted = redacted.split(apiKey).join('***');
    }
    return redacted
        .replace(/(bearer\s+)[^\s"',;]+/gi, '$1***')
        .replace(/((?:x-api-key|x-goog-api-key)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1***')
        .replace(/([?&](?:key|api[_-]?key|token|access_token)=)[^&\s"']+/gi, '$1***');
};

/**
 * Turns an abort into an error that names the deadline (`<label> timed out after Ns`, named
 * TimeoutError) rather than a bare "aborted"; any other failure is handed on as an Error.
 */
const describeFetchFailure = (error, timeoutMs, label) => {
    const name = error && error.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
        const timedOut = new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`);
        timedOut.name = 'TimeoutError';
        return timedOut;
    }
    return error instanceof Error ? error : new Error(String(error));
};

module.exports = { MAX_ERROR_BODY_CHARS, describeFetchFailure, redactSecrets, redactUrl };
