// shared/ai/gemini.mjs
// Google Gemini's native generateContent API. This file builds request bodies and the address;
// the main process sends them (sendGemini in electron/aiTextClient.cjs). Gemini is chosen by the
// AI_PROVIDER setting, never inferred from OPENAI_API_URL, so it claims no host: Gemini's
// OpenAI-compatible endpoint typed as a custom URL stays custom.
//
// Thinking goes in generationConfig.thinkingConfig, as either a thinkingLevel or a thinkingBudget,
// never both in one request [Gemini·thinking]. Which one, and how low, depends on the model: some
// switch thinking off with a zero budget, some only go down to 'minimal' or 'low', and a model
// nobody listed here walks from the lowest level to sending nothing.

export const DEFAULT_GEMINI_MODEL = 'gemini-3-flash-preview';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** The generateContent address for `model` (already validated by the caller). */
export const generateContentUrl = (model) => `${API_BASE}/models/${model}:generateContent`;

const THINKING_KNOBS = Object.freeze(['thinkingConfig']);

/** One request shape; `params` is the content of thinkingConfig (none sent when empty). */
const attempt = (label, reasoningOff, params) => Object.freeze({
    label,
    reasoningOff,
    params: Object.freeze(params),
    knobs: Object.keys(params).length ? THINKING_KNOBS : Object.freeze([]),
});

// A zero budget switches thinking off on the models that allow it. On gemini-3-flash-preview it is
// what SEGMENTATION_GEMINI_GENERATION_CONFIG measured (9.0 s down to 1.6 s for identical output),
// still accepted on Gemini 3 for backward compatibility [Gemini·thinking].
const BUDGET_OFF = attempt('thinkingBudget=0', true, { thinkingBudget: 0 });
// gemini-2.5-pro cannot stop thinking; 128 is the smallest budget it takes [Gemini·thinking].
const BUDGET_FLOOR = attempt('thinkingBudget=128', false, { thinkingBudget: 128 });
// "Close to no thinking", but the model may still think, so the budget leaves room for it
// [Gemini·3.6-flash][Gemini·3.5-flash-lite].
const LEVEL_MINIMAL = attempt('thinkingLevel=minimal', false, { thinkingLevel: 'minimal' });
const LEVEL_LOW = attempt('thinkingLevel=low', false, { thinkingLevel: 'low' });
// Nothing sent: the model thinks as much as it does by default.
const MODEL_DEFAULT = attempt('thinking=default', false, {});

/**
 * Per model family: `quiet` is what segmentation and the connection test send (thinking off, or as
 * low as it goes; the test uses the same switch so that a pass means segmentation's is accepted
 * too), `theme` what the theme sends (the lowest level that still thinks). Matched in order on the
 * lower-cased model name; the first match wins.
 */
const FAMILIES = Object.freeze([
    // Aliases follow whichever model Google points them at, so each keeps one more step to fall
    // back on (it costs a request only when the first is rejected): today 3.5-flash takes minimal
    // and 3.7-flash only low [Gemini·3.6-flash][Gemini·latest-model].
    { pattern: /^gemini-3\.5-flash$/, quiet: [LEVEL_MINIMAL, LEVEL_LOW], theme: [LEVEL_LOW, MODEL_DEFAULT] },
    { pattern: /^gemini-3\.7-flash$/, quiet: [LEVEL_LOW, MODEL_DEFAULT], theme: [LEVEL_LOW, MODEL_DEFAULT] },
    // The default model. Theme: thinkingLevel low (Gemini 3 speaks levels) [Gemini·thinking].
    { pattern: /^gemini-3-flash-preview/, quiet: [BUDGET_OFF], theme: [LEVEL_LOW] },
    // 3.5-flash is an alias; 3.1-flash-lite-preview is retired but still matched here [Gemini·3.6-flash][Gemini·3.5-flash-lite].
    { pattern: /^gemini-(?:3\.6-flash|3\.5-flash|3\.1-flash-lite)/, quiet: [LEVEL_MINIMAL], theme: [LEVEL_LOW] },
    // 'minimal' is an error on these; 'low' is their floor [Gemini·latest-model].
    { pattern: /^gemini-(?:3\.8-flash|3\.7-flash|3\.1-pro|4-)/, quiet: [LEVEL_LOW], theme: [LEVEL_LOW] },
    // Gemini 2.5 speaks budgets only. The theme keeps their default thinking [Gemini·thinking].
    { pattern: /^gemini-2\.5-flash/, quiet: [BUDGET_OFF], theme: [MODEL_DEFAULT] },
    { pattern: /^gemini-2\.5-pro/, quiet: [BUDGET_FLOOR], theme: [MODEL_DEFAULT] },
]);

// Any other model (the gemini-*-latest aliases included): try the lowest level first, and move on
// only when the endpoint rejects the thinking config by name.
const UNKNOWN_QUIET = Object.freeze([LEVEL_MINIMAL, LEVEL_LOW, MODEL_DEFAULT]);
const UNKNOWN_THEME = Object.freeze([LEVEL_LOW, MODEL_DEFAULT]);

const familyOf = (model) => {
    const name = String(model ?? '').trim().toLowerCase();
    return FAMILIES.find(({ pattern }) => pattern.test(name));
};

// Ids in the catalogue that answer generateContent but are not for text: speech, images, the Live
// API, embeddings, attributed QA [Gemini·models-api].
const NOT_FOR_TEXT = /tts|image|live|embedding|aqa|native-audio/i;
// Only Gemini models are offered. The catalogue also lists Gemma (gemma-*), which answers
// generateContent but takes neither a system instruction ("Developer instruction is not enabled")
// nor JSON mode, both of which every ask but the test sends.
const GEMINI_MODEL = /^gemini-/i;

/** The message of a Gemini error body (`{ error: { message } }`), or the raw text. */
const errorMessageOf = (errorBody) => {
    const text = String(errorBody ?? '');
    try {
        const message = JSON.parse(text)?.error?.message;
        return typeof message === 'string' ? message : text;
    } catch {
        return text;
    }
};

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const geminiAdapter = {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'gemini',
    hosts: [],
    endpoints: [{ id: 'default', baseUrl: API_BASE }],
    // A preview without a published shutdown date; kept as the default (the stable 3.6-flash costs
    // three times as much) [Gemini·3-flash-preview][Gemini·3.6-flash].
    defaultModel: DEFAULT_GEMINI_MODEL,
    recommendedModel: DEFAULT_GEMINI_MODEL,
    // Never sent: ignored from 3.6 on, and later generations reject it [Gemini·3.6].
    temperature: null,
    stream: false,
    tokenField: 'maxOutputTokens',
    attempts(task, model) {
        const family = familyOf(model);
        if (task === 'theme') {
            return family ? family.theme : UNKNOWN_THEME;
        }
        return family ? family.quiet : UNKNOWN_QUIET;
    },
    /**
     * generateContent body for one attempt. `attempt.params` is the content of `thinkingConfig`
     * (sent only when not empty); `geminiSchema` is in Gemini's own uppercase schema dialect. The
     * cap counts thinking tokens too, so it is budgetFor's answer-plus-thinking figure [Gemini·thinking].
     *
     * @param {import('./providerRegistry.mjs').AiBodyRequest} request
     */
    buildBody({ task, attempt, systemPrompt, sourcePrompt, geminiSchema, budget }) {
        const limit = budget ? { maxOutputTokens: budget } : {};
        const thinking = Object.keys(attempt.params).length ? { thinkingConfig: { ...attempt.params } } : {};
        const contents = [{ parts: [{ text: sourcePrompt }] }];
        if (task === 'test') {
            return { contents, generationConfig: { ...limit, ...thinking } };
        }
        return {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents,
            generationConfig: {
                responseMimeType: 'application/json',
                ...(geminiSchema ? { responseSchema: geminiSchema } : {}),
                ...limit,
                ...thinking,
            },
        };
    },
    /**
     * Gemini names no parameter in its errors; a 400 whose message talks about thinking is about the
     * thinkingConfig this attempt sent (an unsupported level, a budget the model does not take).
     */
    rejectedParameter(status, errorBody, knob) {
        return status === 400 && knob === 'thinkingConfig' && /thinking/i.test(errorMessageOf(errorBody));
    },
    models: {
        // 1000 is the largest page the list call takes; nextPageToken continues it [Gemini·models-api].
        query: { pageSize: '1000' },
        rows: (json) => json.models,
        id: (row) => row.name,
        name: (row) => row.display_name ?? row.displayName ?? row.modelName,
        keep: (row, id) => Array.isArray(row.supportedGenerationMethods)
            && row.supportedGenerationMethods.includes('generateContent')
            && /^[\w.-]+$/.test(id)
            && GEMINI_MODEL.test(id)
            && !NOT_FOR_TEXT.test(id),
        next: (json) => (json.nextPageToken ? { param: 'pageToken', value: String(json.nextPageToken) } : null),
    },
    // Shut down or being shut down [Gemini·deprecations].
    retired: [
        { pattern: /^gemini-3-pro-preview/, replacement: DEFAULT_GEMINI_MODEL },
        { pattern: /^gemini-3\.1-flash-lite-preview/, replacement: DEFAULT_GEMINI_MODEL },
        { pattern: /^gemini-2\.0-flash/, replacement: DEFAULT_GEMINI_MODEL },
    ],
    /** A listed model whose segmentation request cannot switch thinking off. */
    alwaysThinks(model) {
        const family = familyOf(model);
        return Boolean(family && !family.quiet[0].reasoningOff);
    },
};
