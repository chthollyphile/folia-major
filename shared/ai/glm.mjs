import { rejectsCompatibleParameter } from './compatibleBody.mjs';

// shared/ai/glm.mjs
// Zhipu GLM: open.bigmodel.cn in China and Z.ai (api.z.ai) internationally. A Coding Plan address
// typed into the custom URL is still recognised by its host. Reasoning is set per model family,
// the temperature is clamped to 0..1, the cap is max_tokens, the answer comes in plain JSON mode,
// and GLM's own error codes count as rejected parameters. There is no documented model listing,
// so the form offers suggested models. Sources in brackets are listed in shared/ai/SOURCES.md.

// On both sites, and `none` switches its thinking off. [Z.ai·chat-completion]
const DEFAULT_GLM_MODEL = 'glm-5.2';

const EFFORT_NONE = Object.freeze({
    label: 'reasoning_effort=none',
    reasoningOff: true,
    params: Object.freeze({ reasoning_effort: 'none' }),
    knobs: Object.freeze(['reasoning_effort']),
});
const EFFORT_LOW = Object.freeze({
    label: 'reasoning_effort=low',
    reasoningOff: false,
    params: Object.freeze({ reasoning_effort: 'low' }),
    knobs: Object.freeze(['reasoning_effort']),
});
const THINKING_OFF = Object.freeze({
    label: 'thinking=disabled',
    reasoningOff: true,
    params: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }) }),
    knobs: Object.freeze(['thinking']),
});
// GLM-4 models do not think: nothing reasoning-related, the answer's budget only.
const NOT_THINKING = Object.freeze({ label: 'plain', reasoningOff: true, params: Object.freeze({}), knobs: Object.freeze([]) });
// The last resort for a model we do not know: nothing reasoning-related, with room to reason.
const LAST_RESORT = Object.freeze({ label: 'plain', reasoningOff: false, params: Object.freeze({}), knobs: Object.freeze([]) });

// Forced thinking: switching it off is an error, and the standard endpoint takes only low, high
// and max. If an endpoint (a Coding Plan one, say) rejects even low, the next attempt sends
// nothing. [Z.ai·glm-5.3][BigModel·thinking-mode][Z.ai·chat-completion]
const ALWAYS_THINKS = /^glm-5\.3(?:-|$)/;
// `none` skips thinking; its low and medium are mapped to high, so the theme is switched off too.
// The `thinking` switch is documented for it as well, and is tried when an endpoint rejects the
// level. [Z.ai·thinking-mode][Z.ai·chat-completion]
const EFFORT_SWITCH = /^glm-5\.2$/;
// The `thinking` switch. [BigModel·thinking-mode]
const THINKING_SWITCH = /^glm-(?:5(?:\.1)?(?:-|$)|4\.[567])/;
// The GLM-4 series has no thinking at all.
const NO_THINKING = /^glm-4(?:-|$)/;

/**
 * Reasoning per model family, the same for every ask (off where it can be, else the
 * lowest level). Any other model starts with the `thinking` switch, moves to the low level when
 * that is rejected (or does not stop the reasoning), and finally sends nothing.
 */
const attemptsFor = (_task, model) => {
    const name = String(model ?? '').trim().toLowerCase();
    if (ALWAYS_THINKS.test(name)) {
        return [EFFORT_LOW, LAST_RESORT];
    }
    if (EFFORT_SWITCH.test(name)) {
        return [EFFORT_NONE, THINKING_OFF, LAST_RESORT];
    }
    if (THINKING_SWITCH.test(name)) {
        return [THINKING_OFF];
    }
    if (NO_THINKING.test(name)) {
        return [NOT_THINKING];
    }
    return [THINKING_OFF, EFFORT_LOW, LAST_RESORT];
};

// GLM's business codes for a bad request, both with HTTP 400. 1210 "Invalid API parameter" names
// no parameter; 1214 names it in backticks, in English on Z.ai ("Parameter `x` is invalid")
// [Z.ai·api-code] and in Chinese on open.bigmodel.cn ("`x` 参数非法", docs.bigmodel.cn/cn/api/api-code).
const INVALID_PARAMETERS = '1210';
const INVALID_PARAMETER = '1214';

/** GLM's `{ error: { code, message } }`, from the raw body or a formatted error line; null otherwise. */
const glmErrorOf = (errorBody) => {
    try {
        const payload = JSON.parse(String(errorBody ?? '').replace(/^OpenAI compatible API error \(\d+\):\s*/, ''));
        const error = payload && typeof payload === 'object' ? payload.error : null;
        return error && typeof error === 'object' && error.code !== undefined
            ? { code: String(error.code), message: typeof error.message === 'string' ? error.message : '' }
            : null;
    } catch {
        return null;
    }
};

/** True when `message` names `knob` (or a sub-path of it, such as `thinking.type`) in backticks. */
const namesInBackticks = (message, knob) => {
    const escaped = knob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\`${escaped}(?:[.[][^\`]*)?\``).test(message);
};

/**
 * The shared check first (error.param and the English wordings, GLM 1214 on Z.ai included), then
 * GLM's codes: a 1214 that names the knob in either language, and a 1210, which names nothing, is
 * taken as a rejection of this attempt's knobs so the next attempt is tried; the runner logs the
 * move. A 1210 caused by something else then fails on the last attempt as it came. The transport
 * asks the same question about response_format, so a 1210 is first retried without JSON mode.
 */
const rejectedParameter = (status, errorBody, knob) => {
    if (rejectsCompatibleParameter(status, errorBody, knob)) {
        return true;
    }
    if (status !== 400) {
        return false;
    }
    const error = glmErrorOf(errorBody);
    if (!error) {
        return false;
    }
    return error.code === INVALID_PARAMETERS
        || (error.code === INVALID_PARAMETER && namesInBackticks(error.message, knob));
};

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const glmAdapter = {
    id: 'glm',
    label: 'Zhipu GLM',
    protocol: 'openai',
    hosts: ['open.bigmodel.cn', 'api.z.ai'],
    // Coding Plan endpoints are not presets; on these hosts they are still inferred as GLM. [Z.ai·overview][BigModel·overview]
    endpoints: [
        { id: 'cn', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' },
        { id: 'global', baseUrl: 'https://api.z.ai/api/paas/v4' },
    ],
    defaultModel: DEFAULT_GLM_MODEL,
    recommendedModel: DEFAULT_GLM_MODEL,
    // Offered instead of a listing (see `models` below); glm-4.7-flash is free on open.bigmodel.cn.
    suggestedModels: ['glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-4.7-flash'],
    // Within [0, 1]; a higher setting is clamped rather than sent. [Z.ai·concept-param][Z.ai·chat-completion]
    temperature: { min: 0, max: 1 },
    stream: true,
    // GLM has no max_completion_tokens. The transport only switches fields when max_tokens is
    // rejected by name, which GLM does not do. [Z.ai·chat-completion]
    tokenField: 'max_tokens',
    attempts: attemptsFor,
    // Plain JSON mode. Whether glm-5.3-flash takes it is contradictory in the docs; if it is
    // rejected, the transport drops response_format and retries. It reads the rejection with
    // rejectedParameter below, so a 1210 that names nothing gets that retry first; only when the
    // request still fails without the format does the runner take the 1210 as this attempt's
    // reasoning switch and move on. [Z.ai·struct-output][Z.ai·api-code]
    responseFormat: () => ({ type: 'json_object' }),
    rejectedParameter,
    // The model-centre list the settings PR read is not in either site's open API documentation,
    // answers a bad key with HTTP 200 and code 1001, and mixes in models that cannot chat; no
    // listing request is made and the form offers suggestedModels. [BigModel·openapi][Z.ai·openapi]
    models: null,
    alwaysThinks: (model) => ALWAYS_THINKS.test(model),
};
