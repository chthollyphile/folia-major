'use strict';

// Native Messages API transport. The existing settings and credential slot still own this connection.
// Request bodies come from shared/ai/anthropic.mjs; this file only sends them, reads the reply and
// classifies failures, so a change to what Claude is asked lives in the adapter.
const { MAX_ERROR_BODY_CHARS, describeFetchFailure, redactSecrets, redactUrl } = require('./requestText.cjs');

const normalizeAnthropicMessagesUrl = (rawUrl) => {
    const url = new URL(rawUrl || 'https://api.anthropic.com/v1');
    let path = url.pathname.replace(/\/+$/, '').replace(/\/(?:messages|chat\/completions|models)$/, '');
    if (!path) path = '/v1';
    url.pathname = path + '/messages';
    return url.toString();
};

// 2023-06-01 stays: the 2026-10-21 version only removes temperature, top_p and top_k, which are
// never sent, so a later upgrade costs nothing [Anthropic·versioning].
const anthropicHeaders = (apiKey) => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
});

// The shared runner and budgets are ESM, loaded on first use.
const loadShared = () => Promise.all([
    import('../../shared/ai/attemptRunner.mjs'),
    import('../../shared/ai/aiTasks.mjs'),
]).then(([runner, tasks]) => ({ ...runner, ...tasks }));

/** The displayable line for a failed response: `error.type: error.message`, or the raw text [Anthropic·errors]. */
const describeAnthropicError = (status, rawText) => {
    let detail = rawText.trim();
    try {
        const error = JSON.parse(rawText)?.error;
        if (error && typeof error.message === 'string') {
            detail = typeof error.type === 'string' ? `${error.type}: ${error.message}` : error.message;
        }
    } catch {
        // Not JSON: show the text as it came.
    }
    return `Anthropic API error (${status})${detail ? `: ${detail}` : ''}`;
};

/**
 * Sends one Messages body. An HTTP failure comes back as `{ ok: false, status, errorText, errorBody }`
 * (both redacted; `errorText` names the provider's error type and message); an invalid model, a
 * failure to send or to read is thrown.
 *
 * A response is read by its stop_reason first [Anthropic·messages]: `refusal` carries no usable
 * answer (`refusal` holds stop_details' category and explanation); `max_tokens` means the answer,
 * if any, was cut off, so it is not handed on as content, and `exhausted` marks a cut made while
 * the model was still thinking. `text` is whatever text blocks there were, for the connection test.
 */
async function sendAnthropic({ apiUrl, apiKey, body, customFetch, timeoutMs = 120_000 }) {
    const model = typeof body?.model === 'string' ? body.model : '';
    if (!model || model.length > 256 || /[\s\u0000-\u001f\u007f]/.test(model)) {
        throw new Error('Select a valid Anthropic model in settings');
    }
    const url = normalizeAnthropicMessagesUrl(apiUrl);
    const signal = AbortSignal.timeout(timeoutMs);

    let response;
    try {
        response = await customFetch(url, {
            method: 'POST', redirect: 'error', headers: anthropicHeaders(apiKey), signal, body: JSON.stringify(body),
        });
    } catch (error) {
        throw describeFetchFailure(error, timeoutMs, `Request to ${redactUrl(url)}`);
    }

    if (!response.ok) {
        // errorText is for people; errorBody keeps the error type and message for the runner.
        // Provider bodies may echo the request, headers included, and this text reaches messages
        // and logs, so both are redacted before they go anywhere.
        const rawText = redactSecrets(await response.text().catch(() => ''), apiKey);
        return {
            ok: false,
            status: response.status,
            errorText: describeAnthropicError(response.status, rawText),
            errorBody: rawText.slice(0, MAX_ERROR_BODY_CHARS),
        };
    }

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw describeFetchFailure(error, timeoutMs, `Reading the response from ${redactUrl(url)}`);
    }
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('');
    const thought = blocks.some(block => block?.type === 'thinking' || block?.type === 'redacted_thinking');
    const stopReason = typeof data?.stop_reason === 'string' ? data.stop_reason : null;
    const cut = stopReason === 'max_tokens';
    const refused = stopReason === 'refusal';
    return {
        ok: true,
        status: response.status,
        model: typeof data?.model === 'string' ? data.model : model,
        stopReason,
        text,
        content: cut || refused ? null : text || null,
        exhausted: cut && thought,
        truncated: cut,
        ...(refused ? { refusal: data.stop_details && typeof data.stop_details === 'object' ? data.stop_details : {} } : {}),
    };
}

/** "Model refused request", with the category and explanation stop_details gave, if any. */
const describeRefusal = (refusal) => {
    const category = typeof refusal.category === 'string' && refusal.category ? ` (${refusal.category})` : '';
    const explanation = typeof refusal.explanation === 'string' && refusal.explanation ? `: ${refusal.explanation}` : '';
    return `Model refused request${category}${explanation}`;
};

/** Why an answer came back with nothing usable in it: refused, thinking ate the budget, cut off, or empty. */
const describeEmptyAnswer = (result, model) => {
    if (result.refusal) {
        return describeRefusal(result.refusal);
    }
    if (result.exhausted) {
        return `Model "${model}" used its entire output budget on thinking and did not finish its answer.`
            + ' Choose a model that can switch thinking off, or one with a lower default effort.';
    }
    if (result.truncated) {
        return `Model "${model}" hit the output token limit before finishing its answer.`;
    }
    return `Model "${model}" returned an empty response${result.stopReason ? ` (stop_reason: ${result.stopReason})` : ''}.`;
};

/**
 * Raw JSON text for one ask (`task`), walking the adapter's attempts with the shared runner: a
 * thinking or effort field the model rejects by name moves to the next attempt, and so does an
 * answer cut off while the model was still thinking. The adapter decides what is sent; it never
 * sends temperature.
 */
async function runAnthropicCompletion({
    adapter, task, apiUrl, apiKey, model, systemPrompt, sourcePrompt, schema, schemaName,
    answerTokens, temperature, customFetch, timeoutMs,
}) {
    const { runAttempts, budgetFor } = await loadShared();
    const url = normalizeAnthropicMessagesUrl(apiUrl);
    return runAttempts({
        adapter,
        task,
        url,
        model,
        attempts: adapter.attempts(task, model),
        log: (line) => console.log(line),
        describeEmpty: (result) => describeEmptyAnswer(result, model),
        send: async (attempt) => {
            console.log(`[ai] POST ${redactUrl(url)} model=${model} provider=${adapter.id} reasoning=${attempt.label}`);
            const startedAt = Date.now();
            const result = await sendAnthropic({
                apiUrl,
                apiKey,
                body: adapter.buildBody({
                    task, model, attempt, systemPrompt, sourcePrompt, schema, schemaName,
                    budget: budgetFor(task, answerTokens, attempt), temperature,
                }),
                customFetch,
                timeoutMs,
            });
            if (result.ok) {
                console.log(`[ai] ${redactUrl(url)} answered in ${Date.now() - startedAt}ms stop_reason=${result.stopReason}`);
            }
            return result;
        },
    });
}

/**
 * The connection test's "hello" over the Messages API. Never throws; resolves to
 * `{ ok: true, status, model, text, emptyReason? }` or `{ ok: false, error, status?, errorKind }`,
 * unredacted beyond the key in error bodies (the caller redacts and truncates). A reply with no
 * text still passes, with `emptyReason` 'reasoning' when the cap cut it off and 'empty' otherwise,
 * as on the other protocols; a refusal fails with the provider's reason.
 */
async function runAnthropicConnectionTest({ adapter, apiUrl, apiKey, model, prompt, answerTokens, customFetch, timeoutMs }) {
    try {
        const { walkAttempts, budgetFor } = await loadShared();
        const { result } = await walkAttempts({
            adapter,
            task: 'test',
            url: normalizeAnthropicMessagesUrl(apiUrl),
            model,
            attempts: adapter.attempts('test', model),
            cache: null,
            log: (line) => console.log(line.replace(/^\[ai\]/, '[ai-test]')),
            send: (attempt) => sendAnthropic({
                apiUrl,
                apiKey,
                body: adapter.buildBody({ task: 'test', model, attempt, sourcePrompt: prompt, budget: budgetFor('test', answerTokens, attempt) }),
                customFetch,
                timeoutMs,
            }),
        });
        if (!result.ok) {
            return { ok: false, error: result.errorText, status: result.status, errorKind: 'http' };
        }
        if (result.refusal) {
            return { ok: false, error: describeRefusal(result.refusal), status: result.status, errorKind: 'http' };
        }
        if (!result.text.trim()) {
            return { ok: true, status: result.status, model: result.model, text: '', emptyReason: result.truncated ? 'reasoning' : 'empty' };
        }
        return { ok: true, status: result.status, model: result.model, text: result.text };
    } catch (error) {
        return { ok: false, error, errorKind: /Timeout|Abort/.test(error?.name) ? 'timeout' : 'network' };
    }
}

module.exports = { normalizeAnthropicMessagesUrl, anthropicHeaders, sendAnthropic, runAnthropicCompletion, runAnthropicConnectionTest };
