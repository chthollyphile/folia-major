// sources/bodian/main/mediaCors.cjs
// Scope CORS to issued audio URLs, cached Kuwo audio and known Kuwo cover hosts.

function createBodianMediaPolicy({ now = Date.now } = {}) {
  const issuedUrls = new Map();
  const ttl = 2 * 60 * 60 * 1000;
  const normalize = value => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.hash = '';
      return url;
    } catch { return null; }
  };
  const register = value => {
    const url = normalize(value);
    if (!url) return;
    issuedUrls.delete(url.href);
    issuedUrls.set(url.href, now() + ttl);
    while (issuedUrls.size > 2048) issuedUrls.delete(issuedUrls.keys().next().value);
  };
  const allows = details => {
    if (!['media', 'xhr', 'image'].includes(details.resourceType) || !['GET', 'HEAD', 'OPTIONS'].includes(details.method)) return false;
    const url = normalize(details.url);
    if (!url) return false;
    const expiry = issuedUrls.get(url.href);
    if (expiry > now()) return true;
    if (expiry !== undefined) issuedUrls.delete(url.href);
    // Previously cached Kuwo audio URLs may be used before the provider issues a new URL this run.
    const knownHost = url.hostname === 'kuwo.cn' || url.hostname.endsWith('.kuwo.cn');
    const mediaPath = /\.(mp3|flac|m4a|aac|ogg|wav)(?:$|\/)/i.test(url.pathname);
    const contentType = Object.entries(details.responseHeaders || {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
    const imageHost = /^img\d+\.(?:kwcdn\.)?kuwo\.cn$/.test(url.hostname);
    if (imageHost && ['image', 'xhr'].includes(details.resourceType)
      && (/\.(?:jpe?g|png|webp|gif|avif)(?:$|\/)/i.test(url.pathname) || /^image\//i.test(String(contentType || '')))) return true;
    if (details.resourceType === 'image') return false;
    return knownHost && (url.hostname === 'bd-er.kuwo.cn' || mediaPath || /^audio\//i.test(String(contentType || '')));
  };
  return {
    register,
    allows,
    followRedirect(details) {
      if (allows(details)) register(details.redirectURL);
    },
  };
}

module.exports = { createBodianMediaPolicy };
