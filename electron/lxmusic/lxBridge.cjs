// electron/lxmusic/lxBridge.cjs
// 洛雪（LX）音源的桌面端取数通道。
//
// 音源脚本与洛雪的公开接口会请求任意第三方主机，渲染进程有 CORS 限制，统一由主进程转发：
//   · IPC lx-fetch：一次性请求，返回 { ok, status, statusText, headers, bodyText }
//   · folia-lx://stream：音频流，透传 Range、带 CORS 头，<audio> 可以直接播（也能进 WebAudio 分析）
//
// 只放行 http(s) 公网主机：环回与私网地址一律拒绝，避免音源脚本把本机服务当跳板。

const http = require('node:http');
const https = require('node:https');
const { Readable } = require('node:stream');

const LX_STREAM_SCHEME = 'folia-lx';
const LX_STREAM_PRIVILEGED_SCHEME = {
    scheme: LX_STREAM_SCHEME,
    privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
    },
};

// 音源的服务器经常要先回源、签名，给足预算（脚本自己还有一层 timeout）。
const REQUEST_TIMEOUT_MS = 30000;

const PRIVATE_V4 = [
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^169\.254\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^0\./,
];

const isPrivateHost = (hostname) => {
    const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return true;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return true;
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true;
    return PRIVATE_V4.some((re) => re.test(host));
};

const resolveTarget = (raw) => {
    let url;
    try {
        url = new URL(String(raw || ''));
    } catch {
        throw new Error('invalid url');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol');
    if (isPrivateHost(url.hostname)) throw new Error('private host blocked');
    return url;
};

// 只留业务头：host/connection/origin 由本进程自己决定（cookie / referer 要保留，音源靠它们取流）。
const cleanHeaders = (raw) => {
    const headers = {};
    for (const [key, value] of Object.entries(raw || {})) {
        const name = String(key).toLowerCase();
        if (name === 'host' || name === 'connection' || name === 'origin') continue;
        if (typeof value === 'string' && value) headers[key] = value;
    }
    return headers;
};

const decodeBody = (payload) => {
    if (typeof payload?.bodyBase64 === 'string' && payload.bodyBase64) {
        return Buffer.from(payload.bodyBase64, 'base64');
    }
    if (typeof payload?.bodyText === 'string' && payload.bodyText) return payload.bodyText;
    return undefined;
};

const denied = (status) => new Response(null, {
    status,
    headers: { 'Access-Control-Allow-Origin': '*' },
});

// 流式转发：Range 透传给上游，回来时把 content-length / accept-ranges / content-range 带出来，
// 拖进度条、暂停后继续都靠这几个头。上游快照结束后才能 setTimtout(0)，否则暂停久了会掐断。
const forwardStream = (target, headers) => new Promise((resolve) => {
    const transport = target.protocol === 'https:' ? https : http;
    const upstream = transport.request(
        target,
        { method: 'GET', headers: { Accept: '*/*', ...headers }, timeout: 12000 },
        (up) => {
            upstream.setTimeout(0);
            const out = {
                'Content-Type': up.headers['content-type'] || 'application/octet-stream',
                'Access-Control-Allow-Origin': '*',
            };
            if (up.headers['content-length']) out['Content-Length'] = up.headers['content-length'];
            if (up.headers['accept-ranges']) out['Accept-Ranges'] = up.headers['accept-ranges'];
            if (up.headers['content-range']) out['Content-Range'] = up.headers['content-range'];
            resolve(new Response(Readable.toWeb(up), { status: up.statusCode || 200, headers: out }));
        },
    );
    upstream.on('timeout', () => {
        upstream.destroy(new Error(`上游请求超时（12s）: ${target.toString()}`));
    });
    upstream.on('error', (error) => {
        console.warn('[LxBridge] 上游请求失败:', error instanceof Error ? error.message : String(error));
        resolve(denied(502));
    });
    upstream.end();
});

const createLxBridge = () => {
    // IPC：一次性请求（洛雪的公开接口、音源脚本的 utils.request）。
    const handleFetch = async (payload = {}) => {
        let target;
        try {
            target = resolveTarget(payload.url);
        } catch (error) {
            return { ok: false, status: 0, error: error.message };
        }
        const method = String(payload.method || 'GET').toUpperCase();
        const init = { method, headers: cleanHeaders(payload.headers) };
        const body = decodeBody(payload);
        if (body !== undefined && method !== 'GET' && method !== 'HEAD') init.body = body;
        try {
            const response = await fetch(target.toString(), {
                ...init,
                redirect: 'follow',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const headers = {};
            for (const [key, value] of response.headers.entries()) headers[key] = value;
            return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                headers,
                bodyText: await response.text(),
            };
        } catch (error) {
            return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
        }
    };

    // protocol.handle('folia-lx')：只有 /stream 一个端点，目标地址与额外请求头都放在 query 里。
    const handleProtocolRequest = async (request) => {
        let u;
        try {
            u = new URL(request.url);
        } catch {
            return denied(400);
        }
        const endpoint = u.pathname === '/' || u.pathname === '' ? u.hostname : u.pathname.replace(/^\//, '');
        if (endpoint !== 'stream') return denied(404);
        let target;
        try {
            target = resolveTarget(u.searchParams.get('url'));
        } catch {
            return denied(403);
        }
        const headers = {};
        const encodedHeaders = u.searchParams.get('h');
        if (encodedHeaders) {
            try {
                Object.assign(headers, JSON.parse(Buffer.from(encodedHeaders, 'base64').toString('utf8')));
            } catch {
                // 头解析失败就当没带，照常请求
            }
        }
        const range = request.headers.get('range');
        if (range) headers.Range = range;
        return forwardStream(target, cleanHeaders(headers));
    };

    return { handleFetch, handleProtocolRequest };
};

module.exports = {
    createLxBridge,
    LX_STREAM_SCHEME,
    LX_STREAM_PRIVILEGED_SCHEME,
    isPrivateHost,
};
