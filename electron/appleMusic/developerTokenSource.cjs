const { validateDeveloperToken } = require('./credentials.cjs');

// electron/appleMusic/developerTokenSource.cjs

// Cache the application's signed JWT in memory, refreshing before expiration.
function createDeveloperTokenSource({ endpoint, fallback, fetchToken = fetch, now = Date.now }) {
  let cached;
  let pending;
  const expiresAt = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).exp * 1000;
  return async function resolve() {
    if (!endpoint) return fallback();
    if (cached && expiresAt(cached) > now() + 300000) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('developer-token-invalid');
        const response = await fetchToken(url.href, { signal: AbortSignal.timeout(10000), redirect: 'error', credentials: 'omit' });
        if (!response.ok) throw new Error('token-service-unavailable');
        const payload = await response.json();
        cached = validateDeveloperToken(payload.token, now());
        return cached;
      } catch (error) {
        if (cached && expiresAt(cached) > now() + 60000) return cached;
        const code = error.message;
        throw new Error(['developer-token-invalid', 'developer-token-expired'].includes(code) ? code : 'token-service-unavailable');
      }
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}
module.exports = { createDeveloperTokenSource };
