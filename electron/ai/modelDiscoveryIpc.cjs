'use strict';

const { listAiModels } = require('./modelDiscovery.cjs');

// The discovery IPC reuses the completion path's saved-key endpoint check and optional system proxy.
function registerAiModelDiscovery({ ipcMain, aiCredentials, store, isTrustedMainWindowContents, fetchWithOptionalSystemProxy }) {
    ipcMain.handle('ai-list-models', async (event, payload) => {
        if (!isTrustedMainWindowContents(event.sender)) return { ok: false, errorKind: 'invalid' };
        if (!payload || typeof payload !== 'object'
            || !['gemini', 'openai'].includes(payload.provider)
            || (payload.presetId != null && typeof payload.presetId !== 'string')
            || (payload.apiKey != null && typeof payload.apiKey !== 'string')) {
            return { ok: false, errorKind: 'invalid' };
        }
        try {
            const resolved = aiCredentials.resolveTestApiKey(payload.provider, payload.apiKey, payload.apiUrl);
            if (resolved.error) return { ok: false, errorKind: 'config' };
            const useSystemProxy = typeof payload.useSystemProxy === 'boolean'
                ? payload.useSystemProxy : store.get('USE_SYSTEM_PROXY_FOR_AI') === true;
            return await listAiModels({ ...payload, apiKey: resolved.apiKey }, {
                customFetch: (url, options) => fetchWithOptionalSystemProxy(url, options, useSystemProxy),
            });
        } catch {
            // Transport errors can contain the request or credentials; return only a fixed failure kind.
            return { ok: false, errorKind: 'network' };
        }
    });
}

module.exports = { registerAiModelDiscovery };
