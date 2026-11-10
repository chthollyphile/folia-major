import { REASONING_SUPPRESSION_ATTEMPTS } from '../lyricSegmentationPrompt.mjs';
import { rejectsOpenAICompatibleParameter } from '../openAICompatibleRequest.mjs';

// shared/ai/compatibleBody.mjs
// The OpenAI-compatible protocol's shared parts: the request body built from an adapter and an
// attempt, reading a reply for "reasoning ate the budget", the default "this parameter was
// rejected" check, the generic reasoning ladder and the generic model catalogue. Every adapter
// whose protocol is 'openai' uses these unless it says otherwise.

// The raw error body kept for deciding whether a parameter was rejected. Bounded, because a
// misconfigured URL can answer with a whole HTML page. The web routes use this one; the main
// process has its own copy in electron/ai/requestText.cjs, on the CommonJS side.
export const MAX_ERROR_BODY_CHARS = 16 * 1024;

/** The bare request: no reasoning parameter, budget for the answer only. */
export const PLAIN_ATTEMPTS = Object.freeze([
    Object.freeze({ label: 'plain', reasoningOff: true, params: Object.freeze({}), knobs: Object.freeze([]) }),
]);

/**
 * REASONING_SUPPRESSION_ATTEMPTS as attempts: the ladder for an endpoint nothing is known about.
 * The last rung sends nothing, for models whose reasoning cannot be switched off, so it budgets for
 * the reasoning and the answer; the earlier rungs expect no reasoning at all.
 */
export const GENERIC_REASONING_LADDER = Object.freeze(REASONING_SUPPRESSION_ATTEMPTS.map(({ params }, index, all) => Object.freeze({
    label: Object.keys(params).join('+') || 'plain',
    reasoningOff: index < all.length - 1,
    params,
    knobs: Object.freeze(Object.keys(params)),
})));

/**
 * The temperature this attempt sends, clamped to the adapter's range, or undefined when it sends
 * none: the adapter has no range (`temperature: null`), the attempt or the adapter's
 * `sendsTemperature` says no, or there is no usable value. An adapter's `temperatureRange(model)`
 * narrows the range for some of its models.
 */
export const temperatureFor = (adapter, model, attempt, value) => {
    const range = adapter.temperature;
    if (!range || typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    const sends = attempt.sendTemperature
        ?? (typeof adapter.sendsTemperature === 'function' ? adapter.sendsTemperature(model, attempt) : true);
    const { min, max } = (typeof adapter.temperatureRange === 'function' && adapter.temperatureRange(model)) || range;
    return sends ? Math.min(max, Math.max(min, value)) : undefined;
};

/**
 * Chat-completions body for one attempt of an OpenAI-protocol adapter.
 *
 * The 'test' task is the bare "hello": one user message, no temperature, no JSON mode. The other
 * tasks send the system and user prompts, the clamped temperature and the adapter's response
 * format (plain JSON mode unless the adapter gives a schema-backed one). The token cap goes in the
 * adapter's `tokenField`; `stream` adds `stream: true` and the adapter's `streamExtras`.
 *
 * @param {{ tokenField: string, temperature: null | { min: number, max: number },
 *   sendsTemperature?: Function, streamExtras?: Record<string, unknown>,
 *   responseFormat?: (model: string, schema?: object, schemaName?: string) => object | undefined }} adapter
 * @param {{ task: string, model: string, attempt: { params: Record<string, unknown>, sendTemperature?: boolean },
 *   systemPrompt?: string, sourcePrompt: string, schema?: object, schemaName?: string,
 *   budget?: number, temperature?: number, stream?: boolean }} request
 */
export const buildCompatibleBody = (adapter, { task, model, attempt, systemPrompt, sourcePrompt, schema, schemaName, budget, temperature, stream }) => {
    const bare = task === 'test';
    const messages = bare
        ? [{ role: 'user', content: sourcePrompt }]
        : [{ role: 'system', content: systemPrompt }, { role: 'user', content: sourcePrompt }];
    const sentTemperature = bare ? undefined : temperatureFor(adapter, model, attempt, temperature);
    // Bounds the worst case. In plain JSON mode some providers (DeepSeek notably) can emit a long
    // run of whitespace before any content and keep going until the cap; with no cap set that is an
    // unbounded body read, which presents as a request that never finishes. A caller that knows how
    // big its answer should be passes a ceiling; truncation then fails as a JSON parse error with
    // the raw response logged, which is diagnosable, unlike a hang.
    const limit = budget ? { [adapter.tokenField]: budget } : {};
    // The bare flag plus only what the adapter asks for, to keep the surface other providers must
    // accept minimal.
    const streaming = stream === true ? { stream: true, ...(adapter.streamExtras ?? {}) } : {};
    const format = bare
        ? {}
        : { response_format: adapter.responseFormat?.(model, schema, schemaName) ?? { type: 'json_object' } };

    return {
        model,
        messages,
        ...(sentTemperature === undefined ? {} : { temperature: sentTemperature }),
        ...limit,
        ...attempt.params,
        ...streaming,
        ...format,
    };
};

/** Reasoning tokens the provider reported, if any. */
export const reasoningTokensOf = (usage) => {
    const details = usage && usage.completion_tokens_details;
    const tokens = details && details.reasoning_tokens;
    return typeof tokens === 'number' ? tokens : 0;
};

/**
 * True when the answer was cut off: finish_reason 'length', or one of the adapter's own
 * `truncationReasons` (MiMo stops a repeating answer with 'repetition_truncation').
 */
export const cutOff = (choice, adapter) => Boolean(choice) && (choice.finish_reason === 'length'
    || Boolean(adapter && adapter.truncationReasons && adapter.truncationReasons.includes(choice.finish_reason)));

/**
 * True when the model answered nothing because reasoning consumed the whole budget. This is the
 * failure that looks like success: HTTP 200, tokens billed, `content` empty. `adapter` adds its
 * own words for a cut-off answer (cutOff).
 */
export const exhaustedByReasoning = (choice, usage, adapter) => {
    const hasReasoning = Boolean(
        reasoningTokensOf(usage) || (choice && choice.message && choice.message.reasoning_content),
    );
    return hasReasoning && cutOff(choice, adapter);
};

/**
 * The default rejected-parameter check: a 400/422 whose raw error body names `knob`, by
 * `error.param` or by one of the wordings the shared detector knows.
 *
 * @param {number} status
 * @param {string} errorBody the provider's raw error body (a formatted error line also works)
 * @param {string} knob a top-level request field
 */
export const rejectsCompatibleParameter = (status, errorBody, knob) => (
    rejectsOpenAICompatibleParameter(status, String(errorBody ?? ''), knob)
);

/**
 * A failed send's outcome with the adapter's hint for that HTTP status (`errorHints`) added to the
 * displayed error line, for a status whose meaning the provider's own text leaves unclear (TokenHub's
 * 402). `errorBody` stays the provider's raw text; any other outcome comes back as it was.
 */
export const withErrorHint = (adapter, result) => {
    const hint = result && !result.ok && adapter.errorHints ? adapter.errorHints[result.status] : undefined;
    return hint && typeof result.errorText === 'string' ? { ...result, errorText: `${result.errorText} (${hint})` } : result;
};

/**
 * The model catalogue as most OpenAI-compatible servers return it: `data[]` with `id`, cursor
 * pages through `has_more` / `last_id`, and the `rows[]` / `total` page-number form some servers
 * use. Display names are read from whichever of the common fields is present.
 */
export const COMPATIBLE_MODEL_CATALOGUE = Object.freeze({
    rows: (json) => json.data ?? json.rows,
    id: (row) => row.id ?? row.modelCode,
    name: (row) => row.display_name ?? row.displayName ?? row.modelName,
    keep: () => true,
    next: (json, rows, page) => {
        if (json.has_more === true) {
            return { param: 'after', value: json.last_id ?? rows.at(-1)?.id };
        }
        if (Array.isArray(json.rows) && Number.isFinite(json.total) && (page + 1) * 100 < json.total) {
            return { param: 'pageNum', value: String(page + 2) };
        }
        return null;
    },
});
