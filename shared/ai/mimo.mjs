import { COMPATIBLE_MODEL_CATALOGUE } from './compatibleBody.mjs';

// shared/ai/mimo.mjs
// Xiaomi MiMo, pay-as-you-go (api.xiaomimimo.com). Every *.xiaomimimo.com host is recognised, the
// Token Plan one included, but Token Plan gets no site: like Qwen's Coding Plan it is for coding
// tools [MiMo·first-api-call].
//
// The mimo-v2.6 models think by default and take `thinking: { type: 'disabled' }` [MiMo·deep-thinking];
// a model not known to take it starts with the switch and falls back to sending nothing. The only
// token cap MiMo documents is `max_completion_tokens`, reasoning included [MiMo·openai-api].

/** One request shape whose knobs are exactly the parameters it sends. */
const attempt = (label, params, reasoningOff) => Object.freeze({
    label,
    reasoningOff,
    params: Object.freeze(params),
    knobs: Object.freeze(Object.keys(params)),
});

const THINKING_OFF = attempt('thinking=disabled', { thinking: { type: 'disabled' } }, true);
// Nothing reasoning-related: the model thinks at its default, so budget for it.
const THINKING_DEFAULT = attempt('plain', {}, false);

const OFF_ONLY = Object.freeze([THINKING_OFF]);
const UNKNOWN = Object.freeze([THINKING_OFF, THINKING_DEFAULT]);

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const mimoAdapter = {
    id: 'mimo',
    label: 'Xiaomi MiMo',
    protocol: 'openai',
    hosts: [],
    hostSuffixes: ['.xiaomimimo.com'],
    endpoints: [{ id: 'default', baseUrl: 'https://api.xiaomimimo.com/v1' }],
    // [MiMo·model]
    defaultModel: 'mimo-v2.6-flash',
    recommendedModel: 'mimo-v2.6-flash',
    // "between 0 and 1.5"; ignored while the model thinks, which these requests switch off
    // [MiMo·hyperparameters][MiMo·deep-thinking].
    temperature: { min: 0, max: 1.5 },
    stream: true,
    // max_tokens is not documented and might be ignored, leaving no cap at all [MiMo·openai-api].
    tokenField: 'max_completion_tokens',
    attempts(_task, model) {
        return /^mimo-v2\.6-/.test(String(model ?? '').trim().toLowerCase()) ? OFF_ONLY : UNKNOWN;
    },
    // [MiMo·structured-output]
    responseFormat: () => ({ type: 'json_object' }),
    // "repetition_truncation: if the model detects repetition": the answer stopped short, so it is
    // read the way 'length' is [MiMo·openai-api].
    truncationReasons: ['repetition_truncation'],
    // `GET /v1/models`: `data[]` with `id` and `owned_by`, no display name [MiMo·list-models]. The
    // speech models are not chat models.
    models: {
        ...COMPATIBLE_MODEL_CATALOGUE,
        keep: (_row, id) => !/tts|asr|audio/i.test(id),
    },
    // [MiMo·deprecate] Each retired id with the replacement MiMo names for it (the v2 ones were first
    // moved to v2.5, itself retired on 2026-10-21).
    retired: [
        { pattern: /^mimo-v2(?:\.5)?-pro(?:$|-\d)/, replacement: 'mimo-v2.6-pro' },
        { pattern: /^(?:mimo-v2\.5|mimo-v2-omni|mimo-v2-flash)(?:$|-\d)/, replacement: 'mimo-v2.6-flash' },
    ],
};
