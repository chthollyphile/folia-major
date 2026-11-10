const { createQishuiApi, QISHUI_OPERATIONS } = require('qishui-music-api');
const { createSessionRepository } = require('./session.cjs');

// Electron owns persistence, the IPC allowlist and media registration; the package owns the protocol.
// Every request the package makes goes out without the browser session's cookies: Electron's net.fetch
// would otherwise send defaultSession's cookies and store the platform's Set-Cookie there. The account is
// carried by the package's own headers.
const withoutCookies = fetch => (fetch ? (url, options = {}) => fetch(url, { ...options, credentials: 'omit' }) : fetch);
function createQishuiApiBridge({ store, safeStorage, fetch, log = console.info, warn = console.warn,
    onAudioSource = () => {}, apiFactory = createQishuiApi }) {
    const sessions = createSessionRepository({ store, safeStorage, warn });
    const api = apiFactory({ deviceId: sessions.deviceId, sessions, fetch: withoutCookies(fetch), log });
    return {
        async request(operation, params = {}) {
            try {
                if (!QISHUI_OPERATIONS.includes(operation)) {
                    return { ok: false, error: { code: 'unsupported', message: 'Unsupported Qishui operation' } };
                }
                const result = await api.request(operation, params);
                if (result.ok && operation === 'audio' && result.data?.url) onAudioSource(result.data.url);
                return result;
            } catch (error) {
                // The error stays in the main process log; the renderer gets only the fixed sentence.
                warn('[Qishui] Bridge request failed', { operation }, error);
                return { ok: false, error: { code: 'invalid-response', message: 'Qishui operation failed' } };
            }
        },
    };
}
module.exports = { createQishuiApiBridge };
