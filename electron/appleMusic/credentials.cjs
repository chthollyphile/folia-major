// electron/appleMusic/credentials.cjs

function validateDeveloperToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 8192 || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error('developer-token-invalid');
  try {
    const [header, claims] = token.split('.').slice(0, 2).map(value => JSON.parse(Buffer.from(value, 'base64url')));
    if (header.alg !== 'ES256' || !Number.isFinite(claims.exp)) throw new Error();
    if (claims.exp * 1000 <= now + 60000) throw new Error('developer-token-expired');
    return token;
  } catch (error) {
    throw new Error(error.message === 'developer-token-expired' ? error.message : 'developer-token-invalid');
  }
}

module.exports = { validateDeveloperToken };
