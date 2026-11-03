// Scope media CORS to URLs actually issued by the bridge and Qishui's public image CDNs.
function createQishuiMediaPolicy({ now = Date.now } = {}) {
    const issued = new Map();
    const normalize = raw => { try { const url = new URL(raw); return url.protocol === 'https:' && !url.username && !url.password ? url : null; } catch { return null; } };
    const register = raw => {
        const url = normalize(raw);
        if (!url) return;
        issued.delete(url.href);
        issued.set(url.href, now() + 2 * 3600000);
        while (issued.size > 2048) issued.delete(issued.keys().next().value);
    };
    const allows = details => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(details.method) || !['media', 'xhr', 'image'].includes(details.resourceType)) return false;
        const url = normalize(details.url);
        if (!url) return false;
        if ((issued.get(url.href) || 0) > now()) return true;
        issued.delete(url.href);
        return ['image', 'xhr'].includes(details.resourceType)
            && /(?:^|\.)(?:byteimg\.com|douyinpic\.com|douyinstatic\.com|pstatp\.com)$/.test(url.hostname)
            && (details.resourceType === 'image' || /^image\//i.test(String(Object.entries(details.responseHeaders || {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] || '')));
    };
    return { register, allows, followRedirect(details) { if (allows(details)) register(details.redirectURL); } };
}
module.exports = { createQishuiMediaPolicy };
