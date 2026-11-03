import { anthropicAdapter } from './anthropic.mjs';
import { customAdapter } from './custom.mjs';
import { deepseekAdapter } from './deepseek.mjs';
import { DEFAULT_GEMINI_MODEL, geminiAdapter } from './gemini.mjs';
import { glmAdapter } from './glm.mjs';
import { kimiAdapter } from './kimi.mjs';
import { mimoAdapter } from './mimo.mjs';
import { DEFAULT_OPENAI_MODEL, openaiAdapter } from './openai.mjs';
import { qwenAdapter } from './qwen.mjs';
import { tencentcloudAdapter } from './tencentcloud.mjs';

// shared/ai/providerRegistry.mjs
// The one registry of AI providers, shared by the desktop main process, the web serverless routes
// and the settings form (through src/services/aiText.ts). Each provider is one pure adapter file
// named after its id; this file lists them, infers which one a URL belongs to, and resolves the
// stored settings into one connection. Adding a provider: its adapter file, one line in ADAPTERS,
// and `options.aiProvider_<id>` in the three locale files. The adapters cite their sources as
// `[Provider·page]`; shared/ai/SOURCES.md lists where each one points.
//
// Stored settings keep their published names. AI_PROVIDER is 'gemini' or 'openai', and 'openai'
// now means "any connection other than Gemini": which provider that is comes from the host of
// OPENAI_API_URL, worked out on every read (nothing is migrated or written back).

/** @typedef {import('./aiTasks.mjs').AiTask} AiTask */

/**
 * One request shape. The runner starts at the first attempt and moves to the next only when one of
 * this attempt's knobs is rejected by name, or when reasoning used up the budget.
 *
 * @typedef {{
 *   label: string,                    // for log lines, e.g. 'thinking=disabled', 'effort=low'
 *   reasoningOff: boolean,            // true: the model should not think, so the budget covers the answer only (aiTasks.budgetFor)
 *   params: Record<string, unknown>,  // OpenAI-compatible and Anthropic: top-level body fields; Gemini: the content of thinkingConfig
 *   knobs: string[],                  // move on when one of these top-level fields is rejected ('thinking.type' counts as 'thinking')
 *   sendTemperature?: boolean,        // overrides the adapter's sendsTemperature for this attempt
 * }} AiAttempt
 */

/**
 * What an adapter's buildBody receives for one attempt. `budget` is budgetFor's result (undefined:
 * no cap); `temperature` is the user's setting before the adapter's range is applied.
 *
 * @typedef {{
 *   task: AiTask,
 *   model: string,
 *   attempt: AiAttempt,
 *   systemPrompt?: string,
 *   sourcePrompt: string,
 *   schema?: object,                  // JSON Schema (OpenAI-compatible, Anthropic)
 *   schemaName?: string,
 *   geminiSchema?: object,            // Gemini's uppercase schema dialect
 *   budget?: number,
 *   temperature?: number,
 *   stream?: boolean,
 * }} AiBodyRequest
 */

/**
 * How to list a provider's models (electron/ai/modelDiscovery.cjs is the generic shell that
 * fetches, pages, bounds and redacts). The default address is `<API base>/models`.
 *
 * @typedef {{
 *   path?: string,                                  // absolute path on the API origin, replacing `<base>/models`
 *   query?: Record<string, string>,                 // added to the first page's address
 *   rows(json: any): any[] | undefined,             // the model rows of one page; not an array means a malformed catalogue
 *   id(row: any): unknown,                          // a leading 'models/' is stripped by the shell
 *   name(row: any): unknown,                        // display name; the id when not a string
 *   keep(row: any, id: string): boolean,            // false drops non-chat models and the like
 *   next?(json: any, rows: any[], page: number): { param: string, value: unknown } | null,   // the next page's query parameter, or null on the last page; an empty value is malformed
 * }} AiModelCatalogue
 */

/**
 * One provider. Pure data and pure functions: no network, no storage.
 *
 * @typedef {{
 *   id: string,                                     // registry id = file name = `options.aiProvider_<id>`
 *   label: string,                                  // English name, only for sorting the presets (the form shows i18n)
 *   protocol: 'openai' | 'anthropic' | 'gemini',
 *   hosts: string[],                                // exact host names inferred as this provider
 *   hostSuffixes?: string[],                        // host suffixes starting with '.'
 *   endpoints: { id: string, baseUrl: string }[],   // sites; the first is the default, more than one shows a site picker (id → options.aiEndpoint_<id>)
 *   defaultModel: string | null,                    // used when the model is left blank; null: the user must choose
 *   recommendedModel?: string,                      // prefilled when switching to this preset
 *   suggestedModels?: string[],                     // offered when `models` is null or listing fails
 *   temperature: null | { min: number, max: number },   // null: never sent, and the form hides it
 *   sendsTemperature?(model: string, attempt: AiAttempt): boolean,
 *   temperatureRange?(model: string): { min: number, max: number } | undefined,   // narrower than `temperature` for some models
 *   stream: boolean,                                // whether the form offers the streaming switch
 *   streamExtras?: Record<string, unknown>,         // extra fields sent with stream: true
 *   tokenField: 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens',
 *   attempts(task: AiTask, model: string): AiAttempt[],
 *   responseFormat?(model: string, schema?: object, schemaName?: string): object | undefined,   // OpenAI-compatible only; default json_object
 *   buildBody?(request: AiBodyRequest): object,     // required for 'anthropic' and 'gemini'; 'openai' uses compatibleBody.buildCompatibleBody
 *   rejectedParameter?(status: number, errorBody: string, knob: string): boolean,   // default compatibleBody.rejectsCompatibleParameter; the OpenAI-compatible transport also asks it about response_format
 *   errorHints?: Record<number, string>,            // OpenAI-compatible only: a sentence added to the error line for these HTTP statuses
 *   truncationReasons?: string[],                   // OpenAI-compatible only: finish_reason values besides 'length' that mean the answer was cut off
 *   models: AiModelCatalogue | null,                // null: no listing request at all
 *   retired?: { pattern: RegExp, replacement: string }[],
 *   alwaysThinks?(model: string): boolean,
 * }} AiAdapter
 */

/**
 * What resolveAiConnection returns. `presetId` is what the form's provider picker shows;
 * `adapterId` is what the requests follow (the URL's host decides it).
 *
 * @typedef {{
 *   presetId: string,
 *   adapterId: string,
 *   protocol: 'openai' | 'anthropic' | 'gemini',
 *   apiUrl: string,
 *   model: string,
 * }} AiConnection
 */

/** @type {readonly AiAdapter[]} */
const ADAPTERS = Object.freeze([
    anthropicAdapter,
    deepseekAdapter,
    geminiAdapter,
    glmAdapter,
    kimiAdapter,
    mimoAdapter,
    openaiAdapter,
    qwenAdapter,
    tencentcloudAdapter,
    customAdapter,
]);

const BY_ID = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export { DEFAULT_GEMINI_MODEL, DEFAULT_OPENAI_MODEL };

/** The adapter registered under `id`, or undefined. */
export const getAiAdapter = (id) => BY_ID.get(id);

/** Every registered adapter, custom last. */
export const AI_ADAPTERS = ADAPTERS;

/**
 * What the settings form lists: one preset per adapter, sorted by English name, custom last.
 * `baseUrl` is the default site's; `listsModels` is false for a provider with no listing request,
 * whose model picker offers `suggestedModels` and manual entry only; `temperaturePerModel` is true
 * when some of the provider's models are not sent the temperature, or only a narrower range of it.
 */
export const AI_PROVIDER_PRESETS = Object.freeze(ADAPTERS.map((adapter) => Object.freeze({
    id: adapter.id,
    label: adapter.label,
    protocol: adapter.protocol,
    baseUrl: adapter.endpoints[0]?.baseUrl ?? '',
    endpoints: adapter.endpoints,
    defaultModel: adapter.defaultModel,
    recommendedModel: adapter.recommendedModel,
    suggestedModels: adapter.suggestedModels,
    listsModels: adapter.models !== null,
    temperature: adapter.temperature,
    temperaturePerModel: typeof adapter.sendsTemperature === 'function' || typeof adapter.temperatureRange === 'function',
    stream: adapter.stream,
})).sort((left, right) => (left.id === 'custom' ? 1 : right.id === 'custom' ? -1 : left.label.localeCompare(right.label, 'en'))));

const claims = (adapter, hostname) => adapter.hosts.includes(hostname)
    || (adapter.hostSuffixes ?? []).some((suffix) => hostname.endsWith(suffix));

/**
 * The provider a URL belongs to, by its host name only (not userinfo, port or path; case
 * insensitive, so api.deepseek.com.evil.example is not DeepSeek). An empty URL is OpenAI's own,
 * as the request normaliser treats it; text that does not parse as a URL, and any host no adapter
 * claims, is 'custom'.
 */
export const inferAiProviderFromUrl = (rawUrl) => {
    const text = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!text) {
        return 'openai';
    }
    let hostname;
    try {
        hostname = new URL(text).hostname.toLowerCase().replace(/\.$/, '');
    } catch {
        return 'custom';
    }
    return ADAPTERS.find((adapter) => claims(adapter, hostname))?.id ?? 'custom';
};

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * The connection the stored settings describe, worked out the same way everywhere (desktop
 * requests, connection test, model listing, web routes, the settings form).
 *
 * The URL's host picks the adapter; the stored preset only decides what the form shows, and only
 * while it agrees with the URL (or is custom). The URL is never filled in from the preset: requests
 * must go where OPENAI_API_URL says, because that is the address the saved key is bound to
 * (electron/aiCredentialStore.cjs), and an empty one is OpenAI's own. `protocols` limits which protocols may be used (the web routes speak only
 * 'openai'); anything else falls back to custom. A blank model takes the adapter's default, or stays
 * blank when the adapter has none.
 *
 * @param {{ AI_PROVIDER?: string, AI_PROVIDER_PRESET?: string, OPENAI_API_URL?: string,
 *   OPENAI_API_MODEL?: string, GEMINI_API_MODEL?: string }} settings
 * @param {{ protocols?: string[] }} [options]
 * @returns {AiConnection}
 */
export const resolveAiConnection = (settings = {}, { protocols } = {}) => {
    if (settings.AI_PROVIDER !== 'openai') {
        return {
            presetId: 'gemini',
            adapterId: 'gemini',
            protocol: 'gemini',
            apiUrl: geminiAdapter.endpoints[0].baseUrl,
            model: trimmed(settings.GEMINI_API_MODEL) || DEFAULT_GEMINI_MODEL,
        };
    }

    const chosen = BY_ID.get(settings.AI_PROVIDER_PRESET);
    const preset = chosen && chosen.protocol !== 'gemini' ? chosen : undefined;
    const apiUrl = trimmed(settings.OPENAI_API_URL);
    const inferred = inferAiProviderFromUrl(apiUrl);
    const presetId = preset && (preset.id === 'custom' || preset.id === inferred) ? preset.id : inferred;

    let adapter = BY_ID.get(inferred) ?? customAdapter;
    if (protocols && !protocols.includes(adapter.protocol)) {
        adapter = customAdapter;
    }
    return {
        presetId,
        adapterId: adapter.id,
        protocol: adapter.protocol,
        apiUrl,
        model: trimmed(settings.OPENAI_API_MODEL) || (adapter.defaultModel ?? ''),
    };
};

/** The preset the settings form shows for these settings. */
export const resolveAiProviderPreset = (settings = {}) => {
    const { presetId } = resolveAiConnection(settings);
    return AI_PROVIDER_PRESETS.find((preset) => preset.id === presetId) ?? AI_PROVIDER_PRESETS[AI_PROVIDER_PRESETS.length - 1];
};

/** `{ replacement }` when `model` is retired on this provider, otherwise null. */
export const retiredModelHint = (id, model) => {
    const name = trimmed(model).toLowerCase();
    const rule = name ? BY_ID.get(id)?.retired?.find(({ pattern }) => pattern.test(name)) : undefined;
    return rule ? { model: trimmed(model), replacement: rule.replacement } : null;
};

/** True when this provider's `model` cannot switch thinking off. */
export const modelAlwaysThinks = (id, model) => {
    const adapter = BY_ID.get(id);
    return Boolean(adapter?.alwaysThinks && trimmed(model) && adapter.alwaysThinks(trimmed(model).toLowerCase()));
};
