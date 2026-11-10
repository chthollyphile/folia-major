// shared/ai/deepseek.mjs
// DeepSeek (api.deepseek.com and its other subdomains). Every ask switches thinking off with both
// switches the current docs list, which also makes the temperature take effect again; plain JSON
// mode only, the cap in max_tokens. Sources in brackets are listed in shared/ai/SOURCES.md.

// deepseek-v4-flash is a legacy name DeepSeek only says it still accepts "for now". [DeepSeek·news261017][DeepSeek·pricing]
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-flash';

// Both switches are documented: `thinking: disabled` [DeepSeek·thinking_mode] and
// `reasoning_effort: 'none'` ("none disables thinking mode") [DeepSeek·chat]. Segmentation has
// sent both since before adapters (measured: 52 s down to 1 s), so neither is dropped. Either one
// rejected by name moves to the thinking switch alone (the runner, not the transport, decides),
// and the last attempt sends neither and leaves room to reason.
const ATTEMPTS = Object.freeze([
    Object.freeze({
        label: 'thinking=disabled+reasoning_effort=none',
        reasoningOff: true,
        params: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }), reasoning_effort: 'none' }),
        knobs: Object.freeze(['reasoning_effort', 'thinking']),
    }),
    Object.freeze({
        label: 'thinking=disabled',
        reasoningOff: true,
        params: Object.freeze({ thinking: Object.freeze({ type: 'disabled' }) }),
        knobs: Object.freeze(['thinking']),
    }),
    Object.freeze({ label: 'plain', reasoningOff: false, params: Object.freeze({}), knobs: Object.freeze([]) }),
]);

/** @type {import('./providerRegistry.mjs').AiAdapter} */
export const deepseekAdapter = {
    id: 'deepseek',
    label: 'DeepSeek',
    protocol: 'openai',
    hosts: ['api.deepseek.com'],
    hostSuffixes: ['.deepseek.com'],
    // DeepSeek's own spelling of its base URL; the request normaliser still adds /v1/chat/completions,
    // which is how it has always been requested. [DeepSeek·docs]
    endpoints: [{ id: 'default', baseUrl: 'https://api.deepseek.com' }],
    defaultModel: DEEPSEEK_DEFAULT_MODEL,
    recommendedModel: DEEPSEEK_DEFAULT_MODEL,
    // Only takes effect with thinking off, which every attempt but the last asks for. [DeepSeek·chat]
    temperature: { min: 0, max: 2 },
    stream: true,
    // Up to 393216. [DeepSeek·chat]
    tokenField: 'max_tokens',
    // The theme follows segmentation (thinking as low as it goes, which on an on/off switch is off):
    // thinking off is faster, lets the temperature work, and keeps JSON mode reliable; the
    // connection test sends the same switches so a pass means the real asks' switches are accepted.
    attempts() {
        return ATTEMPTS;
    },
    // JSON mode only, never json_schema. [DeepSeek·json_mode]
    responseFormat: () => ({ type: 'json_object' }),
    // GET {base}/models: `data[]` with the display name in `name`, one page. [DeepSeek·list-models]
    models: {
        rows: (json) => json.data,
        id: (row) => row.id,
        name: (row) => row.name,
        keep: () => true,
        next: () => null,
    },
    // [DeepSeek·news260424][DeepSeek·news260910][DeepSeek·news261017]
    retired: [
        /^deepseek-chat$/,
        /^deepseek-reasoner$/,
        /^deepseek-v4-flash(?:-|$)/,
    ].map((pattern) => ({ pattern, replacement: DEEPSEEK_DEFAULT_MODEL })),
};
