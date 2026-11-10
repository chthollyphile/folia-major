import { COMPATIBLE_MODEL_CATALOGUE, rejectsCompatibleParameter } from './compatibleBody.mjs';

// shared/ai/tencentcloud.mjs
// Tencent Cloud TokenHub. The China site's documentation names tencentmaas.com, the international
// account documentation (intl.cloud.tencent.com, tencentcloud.com; rechecked 2026-10-22) names
// tencentcloudmaas.com; both families are recognised, and the international site uses the latter.
// The retired lkeap and Hunyuan addresses are not claimed and fall back to custom [lkeap·115969]
// [hunyuan·111007].
//
// TokenHub resells other vendors' models under its own rules (its deepseek-v4 takes only
// low / high / max, for one), so this adapter follows TokenHub's own tables and never borrows the
// Kimi, GLM or DeepSeek adapters' rules. Thinking is switched off with TokenHub's uniform
// `thinking: { type: 'disabled' }` where its table allows it, turned down to `low` where it does
// not, and a model not in the table starts with the switch and falls back to sending nothing
// [TokenHub·deep-thinking].

/** One request shape whose knobs are exactly the parameters it sends. */
const attempt = (label, params, reasoningOff) => Object.freeze({
    label,
    reasoningOff,
    params: Object.freeze(params),
    knobs: Object.freeze(Object.keys(params)),
});

const THINKING_OFF = attempt('thinking=disabled', { thinking: { type: 'disabled' } }, true);
const EFFORT_LOW = attempt('effort=low', { reasoning_effort: 'low' }, false);
// Nothing reasoning-related: the model thinks at its default, so budget for it.
const THINKING_DEFAULT = attempt('plain', {}, false);

const OFF_ONLY = Object.freeze([THINKING_OFF]);
const EFFORT_ONLY = Object.freeze([EFFORT_LOW]);
const DEFAULT_ONLY = Object.freeze([THINKING_DEFAULT]);
const UNKNOWN = Object.freeze([THINKING_OFF, THINKING_DEFAULT]);

// [TokenHub·deep-thinking] Models whose thinking can be switched off. minimax-m3 takes only
// adaptive and disabled; minimax-m3.1-flash is not in the table and is left to the fallback.
const SWITCHES_OFF = /^(?:hy4-preview|hy3|deepseek.*|glm-5\.2|glm-5v-turbo|kimi-k2\.6|kimi-k2\.5|qwen3\.5-.+|minimax-m3(?:-\d.*)?)$/;
// "enabled（不支持关闭）" with low among their reasoning_effort values.
const TURNS_DOWN = /^(?:glm-5\.3.*|kimi-k3(?:-.+)?)$/;
// "enabled（不支持关闭）" with no reasoning_effort listed: nothing to send.
const ALWAYS_ON = /^(?:kimi-k2\.7-code.*|minimax-m2\.7|minimax-m2\.5)$/;

// [TokenHub·130079] Sampling support depends on the model: the Hunyuan, DeepSeek and Qwen models
// take 0–2, the GLM models 0–1; Kimi, MiniMax, MiMo and anything else get none.
const TAKES_TEMPERATURE = /^(?:hy|deepseek|qwen|glm)/;
const GLM_TEMPERATURE = Object.freeze({ min: 0, max: 1 });

// [TokenHub·131595] 400002 CodeInvalidParameter: "The request parameter <name> is invalid or
// missing." It names the field bare, which the shared check does not read as a rejection.
const rejectedInTokenHubWords = (errorBody, knob) => {
    const name = knob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\brequest parameter ["'\`]?${name}(?:[.[][^"'\`\\s]*)?["'\`]? is invalid\\b`, 'i').test(errorBody);
};

const lower = (model) => String(model ?? '').trim().toLowerCase();

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const tencentcloudAdapter = {
    id: 'tencentcloud',
    label: 'Tencent Cloud TokenHub',
    protocol: 'openai',
    hosts: [
        'tokenhub.tencentmaas.com',
        'tokenhub-intl.tencentmaas.com',
        'tokenhub.tencentmaas.cn',
        'tokenhub-intl.tencentmaas.cn',
        'tokenhub.tencentcloudmaas.com',
        'tokenhub-intl.tencentcloudmaas.com',
        'tokenhub-us.tencentcloudmaas.tech',
    ],
    endpoints: [
        { id: 'cn', baseUrl: 'https://tokenhub.tencentmaas.com/v1' },
        { id: 'global', baseUrl: 'https://tokenhub-intl.tencentcloudmaas.com/v1' },
    ],
    // TokenHub's own id, and one whose thinking can be switched off [TokenHub·models].
    defaultModel: 'deepseek-v4-flash',
    recommendedModel: 'deepseek-v4-flash',
    // The form shows the widest range; models outside TAKES_TEMPERATURE get none at all.
    temperature: { min: 0, max: 2 },
    sendsTemperature: (model) => TAKES_TEMPERATURE.test(lower(model)),
    temperatureRange: (model) => (lower(model).startsWith('glm') ? GLM_TEMPERATURE : undefined),
    stream: true,
    // The same as max_completion_tokens here, reasoning included [TokenHub·130079].
    tokenField: 'max_tokens',
    attempts(_task, model) {
        const name = lower(model);
        if (TURNS_DOWN.test(name)) {
            return EFFORT_ONLY;
        }
        if (ALWAYS_ON.test(name)) {
            return DEFAULT_ONLY;
        }
        return SWITCHES_OFF.test(name) ? OFF_ONLY : UNKNOWN;
    },
    // json_schema is documented, but how well each resold model keeps to it has not been checked
    // [TokenHub·130079].
    responseFormat: () => ({ type: 'json_object' }),
    rejectedParameter: (status, errorBody, knob) => rejectsCompatibleParameter(status, errorBody, knob)
        || ((status === 400 || status === 422) && rejectedInTokenHubWords(String(errorBody ?? ''), knob)),
    // [TokenHub·130079][TokenHub·131595] 402 is a model whose service is not activated: no free
    // quota and pay-as-you-go off (401007), the free quota used up (401008), or an account in arrears
    // (403004). The response's own text does not say where to fix it.
    errorHints: {
        402: 'TokenHub answers 402 when this model is not activated for the account: activate it (or enable pay-as-you-go) in the TokenHub console, and check the balance',
    },
    // `GET /v1/models`: `data[]` with `id`, `name` and `status` ('online', 'pre-offline', …)
    // [TokenHub·models-api]. Only online models are offered; a row without a status is kept.
    models: {
        ...COMPATIBLE_MODEL_CATALOGUE,
        name: (row) => row.name,
        keep: (row) => row.status === undefined || row.status === 'online',
    },
    alwaysThinks: (model) => TURNS_DOWN.test(model) || ALWAYS_ON.test(model),
};
