const { createBodianApi, BODIAN_OPERATIONS } = require('bodian-music-api');
const { createSessionRepository } = require('./session.cjs');

// electron/bodian/bodianApiBridge.cjs

// Keep Electron persistence, IPC validation and media registration here; the package owns the protocol.
function createBodianApiBridge({ store, safeStorage, requestFactory, onAudioSource = () => {}, now = Date.now,
  warn = console.warn, apiFactory = createBodianApi }) {
  const sessions = createSessionRepository({ store, safeStorage, warn });
  const api = apiFactory({ deviceId: sessions.deviceId, sessions, requestFactory, now });
  return {
    async request(operation, params = {}) {
      try {
        if (!BODIAN_OPERATIONS.includes(operation)) {
          return { ok: false, error: { code: 'unsupported', message: 'Unsupported Bodian operation' } };
        }
        // The listener signs out: the stored session goes, also one this run could not read.
        if (operation === 'logout') sessions.clear({ signOut: true });
        // A session stored that this run cannot read is not answered as nobody: the renderer would
        // take the account for gone.
        if (operation === 'login_status' && sessions.unreadable()) {
          return { ok: false, error: { code: 'unavailable', message: 'The stored Bodian sign-in cannot be read now' } };
        }
        const result = await api.request(operation, params);
        if (result.ok && operation === 'audio' && result.data?.url) onAudioSource(result.data.url);
        return result;
      } catch {
        return { ok: false, error: { code: 'invalid-response', message: 'Bodian operation failed' } };
      }
    },
  };
}

module.exports = { createBodianApiBridge };
