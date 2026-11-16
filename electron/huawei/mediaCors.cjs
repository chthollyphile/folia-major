// electron/huawei/mediaCors.cjs
// Scope CORS to issued Huawei Music audio URLs and known Huawei/CDN cover and lyric hosts.

function createHuaweiMediaPolicy({ now = Date.now } = {}) {
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
    const knownHost = hostname => (
        (hostname.endsWith('.dbankcdn.cn') && hostname.length > '.dbankcdn.cn'.length)
    || (hostname.endsWith('.tingmall.com') && hostname.length > '.tingmall.com'.length)
    || (hostname.endsWith('.kuke.com') && hostname.length > '.kuke.com'.length)
    );
    const allows = details => {
        if (!['media', 'xhr', 'image'].includes(details.resourceType) || !['GET', 'HEAD', 'OPTIONS'].includes(details.method)) return false;
        const url = normalize(details.url);
        if (!url) return false;
        const expiry = issuedUrls.get(url.href);
        if (expiry > now()) return true;
        if (expiry !== undefined) issuedUrls.delete(url.href);
        if (!knownHost(url.hostname)) return false;
        // Audio and covers share these hosts. Allow only things that look like media or pictures,
        // so a random document fetch to the same CDN is not handed CORS for this app's origin.
        if (/\.(mp3|flac|m4a|m4a|aac|ogg|wav)(?:$|\/)/i.test(url.pathname)) return true;
        if (/\.(jpe?g|png|webp|gif|avif)(?:$|\/)/i.test(url.pathname)) return true;
        const contentType = Object.entries(details.responseHeaders || {})
            .find(([name]) => name.toLowerCase() === 'content-type')?.[1];
        const type = String(Array.isArray(contentType) ? contentType[0] : contentType || '');
        if (details.resourceType === 'image') return /^image\//i.test(type);
        return /^(?:audio|video)\//i.test(type);
    };
    return {
        register,
        allows,
        followRedirect(details) {
            if (allows(details)) register(details.redirectURL);
        },
    };
}

module.exports = { createHuaweiMediaPolicy };
