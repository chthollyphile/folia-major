import { rejectsCompatibleParameter } from './compatibleBody.mjs';

// shared/ai/attemptRunner.mjs
// Walks an adapter's attempts (request shapes) in order and remembers which one worked. It only
// orchestrates: building and sending each request is the caller's `send`, so the desktop (which
// can stream) and the web routes (which cannot) share the same rules.

/**
 * What `send(attempt, index)` resolves to. `errorBody` is the provider's raw error body (for the
 * rejected-parameter check), `errorText` the displayable line. `exhausted` is true when the model
 * answered nothing because reasoning used up the budget. Extra fields pass through untouched.
 *
 * @typedef {{
 *   ok: boolean,
 *   status?: number,
 *   errorText?: string,
 *   errorBody?: string,
 *   content?: string | null,
 *   exhausted?: boolean,
 *   [extra: string]: unknown,
 * }} AiSendResult
 */

// Learned attempt per adapter, task, URL and model. Only valid in this process or instance.
const learnedAttempts = new Map();

/** Forgets every learned attempt (tests). */
export const resetLearnedAttempts = () => learnedAttempts.clear();

/** The memory key: one URL can serve models with completely different capabilities. */
export const attemptCacheKey = ({ adapter, task, url, model }) => `${adapter.id}|${task}|${url}|${model}`;

// Only a malformed request can mean "this endpoint does not speak that parameter". 401, 403, 404,
// 429 and 5xx never move down, so a wrong key or model name fails on the first request instead of
// being retried once per attempt.
const MAY_REJECT_PARAMETER = new Set([400, 422]);

/**
 * Sends `attempts` in order, starting from the learned one, and returns the outcome of the last
 * request sent. It moves to the next attempt only when this one's knobs were rejected by name, or
 * when the model answered nothing because reasoning used up the budget; any other outcome, and
 * anything from the last attempt, is returned as it came.
 *
 * @param {{
 *   adapter: { id: string, rejectedParameter?: (status: number, errorBody: string, knob: string) => boolean },
 *   task: string,
 *   url: string,
 *   model: string,
 *   attempts: { label: string, knobs: string[] }[],
 *   send: (attempt: any, index: number) => Promise<AiSendResult>,
 *   cache?: Map<string, number> | null,
 *   log?: (line: string) => void,
 * }} options `cache: null` neither reads nor writes the memory.
 * @returns {Promise<{ result: AiSendResult, attempt: any, index: number }>}
 */
export async function walkAttempts({ adapter, task, url, model, attempts, send, cache = learnedAttempts, log }) {
    if (!attempts.length) {
        throw new Error(`No request shape for ${adapter.id} ${task}`);
    }
    const key = attemptCacheKey({ adapter, task, url, model });
    const learned = cache ? cache.get(key) : undefined;
    const rejected = adapter.rejectedParameter ?? rejectsCompatibleParameter;

    let index = Number.isInteger(learned) && learned < attempts.length ? learned : 0;
    for (;;) {
        const attempt = attempts[index];
        const isLast = index === attempts.length - 1;
        const result = await send(attempt, index);

        if (!result.ok) {
            // A rejected parameter is information, not a failure: this endpoint does not speak that
            // dialect, so move down. Everything else is the user's problem to see.
            const evidence = result.errorBody ?? result.errorText ?? '';
            if (!isLast && MAY_REJECT_PARAMETER.has(result.status)
                && attempt.knobs.some((knob) => rejected(result.status, evidence, knob))) {
                log?.(`[ai] ${attempt.label} rejected by the endpoint, trying the next option`);
                index += 1;
                continue;
            }
            return { result, attempt, index };
        }

        if (result.content) {
            cache?.set(key, index);
            return { result, attempt, index };
        }
        if (!isLast && result.exhausted) {
            log?.(`[ai] ${attempt.label} did not stop the model reasoning, trying the next option`);
            index += 1;
            continue;
        }
        return { result, attempt, index };
    }
}

/**
 * walkAttempts, then the answer text or a thrown error: the endpoint's own error line, or
 * `describeEmpty(result)` for an answer with no text. `fail(message, result)` builds the error.
 *
 * @param {Parameters<typeof walkAttempts>[0] & {
 *   describeEmpty: (result: AiSendResult) => string,
 *   fail?: (message: string, result: AiSendResult) => Error,
 * }} options
 * @returns {Promise<string>}
 */
export async function runAttempts({ describeEmpty, fail = (message) => new Error(message), ...walk }) {
    const { result } = await walkAttempts(walk);
    if (!result.ok) {
        throw fail(result.errorText ?? `Request failed (${result.status})`, result);
    }
    if (result.content) {
        return result.content;
    }
    throw fail(describeEmpty(result), result);
}
