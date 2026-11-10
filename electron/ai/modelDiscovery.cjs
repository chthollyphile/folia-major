'use strict';

const { normalizeOpenAIChatCompletionsUrl, resolveFormAdapter, validateAiConnectionTestInput } = require('../aiTextClient.cjs');
const { normalizeAnthropicMessagesUrl, anthropicHeaders } = require('./anthropicClient.cjs');

// Model discovery uses the same main-process credentials and proxy as completion requests.
// This is the generic shell (bounded pages and body size, no redirects, key redaction); where each
// provider lists its models, which rows count and how pages continue is the adapter's `models`
// description in shared/ai/.
const MAX_PAGES = 20;
const MAX_MODELS = 2000;
const MAX_BODY_BYTES = 2_000_000;

/** Stops reading oversized catalogues before allocating the complete response body. */
async function readCatalogue(response) {
    const reader = response.body?.getReader();
    if (!reader) throw new SyntaxError('Missing catalogue body');
    const decoder = new TextDecoder();
    let text = '';
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_BODY_BYTES) {
                await reader.cancel();
                throw new RangeError('Catalogue too large');
            }
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
    } finally {
        reader.releaseLock();
    }
    return JSON.parse(text);
}

/** The first catalogue page: `<API base>/models`, or the adapter's own path, plus its query. */
const modelListUrl = (adapter, apiUrl) => {
    const url = new URL(adapter.protocol === 'gemini' ? adapter.endpoints[0].baseUrl
        : adapter.protocol === 'anthropic' ? normalizeAnthropicMessagesUrl(apiUrl)
            : normalizeOpenAIChatCompletionsUrl(apiUrl));
    const { path, query } = adapter.models;
    url.pathname = path ?? url.pathname.replace(/\/(?:chat\/completions|messages|models)\/?$/, '') + '/models';
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value);
    return url;
};

const authHeaders = (protocol, apiKey) => (protocol === 'gemini' ? { 'x-goog-api-key': apiKey }
    : protocol === 'anthropic' ? anthropicHeaders(apiKey)
        : { Authorization: 'Bearer ' + apiKey });

const failure = (errorKind, status) => ({ ok: false, errorKind, ...(status ? { status } : {}) });

/**
 * Fetches bounded pages, normalises provider model ids, and never follows a server-supplied URL.
 * When the list cannot be had (no listing, an error, nothing usable in it), the adapter's
 * `suggestedModels` come back with the failure, so the form can still offer them beside manual entry.
 */
async function listAiModels(raw, { customFetch, timeoutMs = 30_000 } = {}) {
    const checked = validateAiConnectionTestInput({ ...raw, model: undefined });
    if (checked.error) return failure('invalid');
    const config = checked.config;
    if (!config.apiKey) return failure('config');
    const { adapter } = await resolveFormAdapter(config);
    const suggested = Array.isArray(adapter.suggestedModels) && adapter.suggestedModels.length
        ? { suggestedModels: [...adapter.suggestedModels] } : {};
    const result = await fetchCatalogue(adapter, config, { customFetch, timeoutMs });
    return result.ok ? result : { ...result, ...suggested };
}

/** The catalogue pages of one adapter, as listAiModels returns them (without the suggestions). */
async function fetchCatalogue(adapter, config, { customFetch, timeoutMs }) {
    const catalogue = adapter.models;
    // A provider without a usable listing: the form offers its suggested models instead.
    if (!catalogue) return failure('empty');
    const url = modelListUrl(adapter, config.apiUrl);
    const signal = AbortSignal.timeout(timeoutMs);
    const headers = authHeaders(adapter.protocol, config.apiKey);
    const models = new Map();
    const cursors = new Set();
    try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const response = await customFetch(url.toString(), { method: 'GET', headers, signal, redirect: 'error' });
            if (!response.ok) return failure(response.status === 401 || response.status === 403 ? 'auth' : 'http', response.status);
            const data = await readCatalogue(response);
            if (!data || typeof data !== 'object') return failure('invalid');
            const rows = catalogue.rows(data);
            if (!Array.isArray(rows)) return failure('invalid');
            for (const row of rows) {
                if (!row || typeof row !== 'object') continue;
                const rawId = catalogue.id(row);
                const id = typeof rawId === 'string' ? rawId.replace(/^models\//, '').trim() : '';
                if (!id || id.length > 256 || /[\u0000-\u001f]/.test(id)) continue;
                if (!catalogue.keep(row, id)) continue;
                // A reflected key must not cross IPC, and redacted ids would no longer identify a model.
                if (id.includes(config.apiKey)) continue;
                const name = catalogue.name(row) ?? id;
                models.set(id, { id, name: typeof name === 'string' ? name.split(config.apiKey).join('***').slice(0, 256) : id });
                if (models.size > MAX_MODELS) return failure('invalid');
            }
            const cursor = catalogue.next ? catalogue.next(data, rows, page) : null;
            if (!cursor) {
                return models.size ? { ok: true, models: [...models.values()] } : failure('empty');
            }
            if (typeof cursor.value !== 'string' || !cursor.value) return failure('invalid');
            url.searchParams.set(cursor.param, cursor.value);
            if (cursors.has(cursor.value) || page === MAX_PAGES - 1) return failure('invalid');
            cursors.add(cursor.value);
        }
    } catch (error) {
        return failure(signal.aborted ? 'timeout' : error instanceof SyntaxError || error instanceof RangeError ? 'invalid' : 'network');
    }
    return failure('invalid');
}

module.exports = { listAiModels, modelListUrl };
