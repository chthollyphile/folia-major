'use strict';

const http = require('http');
const https = require('https');
const { randomBytes } = require('crypto');
const { Readable } = require('stream');

// 桌面端的「局域网中继」。
//
// 音响只能拉 http 地址，而渲染层的播放地址可能是：
//   - 自定义协议（folia-fnmusic://、folia-ytm://、folia-spotify://），音响根本不认识；
//   - 需要 Referer / 特殊请求头的 CDN 直链，音响拉不到。
// 所以投送期间由主进程起一个只服务本次会话的 HTTP 网关，把这几类地址统一转成
// `http://<本机局域网 IPv4>:<port>/cast/<token>`，音响拉这个地址，主进程再去取源。
//
// 安全边界与安卓侧一致：只映射投送会话里显式登记过的那个地址，路径必须带本次会话的
// 随机 token；停止投送就关服务、清 token，本机其它文件一律不经这条口。

const CAST_PATH_PREFIX = '/cast/';
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;
const UPSTREAM_TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

const HOP_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

const pickForwardHeaders = range => {
    const headers = {
        // 部分 CDN 认 UA，给一个常见的播放器 UA 比空着稳。
        'User-Agent': 'Folia/1.0 (UPnP cast)',
        Accept: '*/*',
        'Accept-Encoding': 'identity',
    };
    if (range) headers.Range = range;
    return headers;
};

/** 跟随 3xx，把 Range 与必要头一路带过去。 */
const requestUpstream = (url, headers, redirects = 0) => new Promise((resolve, reject) => {
    let target;
    try {
        target = new URL(url);
    } catch {
        reject(new Error('源地址不合法'));
        return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        reject(new Error('只支持 http/https 源地址'));
        return;
    }
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(target, { headers, timeout: UPSTREAM_TIMEOUT_MS }, response => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400 && response.headers.location && redirects < MAX_REDIRECTS) {
            response.resume();
            const next = new URL(response.headers.location, target).toString();
            resolve(requestUpstream(next, headers, redirects + 1));
            return;
        }
        resolve(response);
    });
    request.on('timeout', () => request.destroy(new Error('源站超时')));
    request.on('error', reject);
});

const writeStreamingResponse = (res, response, isHead) => {
    const headers = {};
    for (const [name, value] of Object.entries(response.headers)) {
        if (HOP_HEADERS.has(name.toLowerCase())) continue;
        if (value === undefined) continue;
        headers[name] = value;
    }
    headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(response.statusCode || 502, headers);
    if (isHead) {
        response.resume();
        res.end();
        return;
    }
    response.pipe(res);
    response.on('error', () => res.destroy());
};

const writeResponse = async (res, response, isHead) => {
    const headers = {};
    response.headers.forEach((value, name) => {
        if (HOP_HEADERS.has(name)) return;
        headers[name] = value;
    });
    // 音响拉流不需要 CORS，但带上不碍事，也方便排查。
    headers['access-control-allow-origin'] = '*';
    res.writeHead(response.status || 502, headers);
    if (isHead || !response.body) {
        res.end();
        return;
    }
    const stream = Readable.fromWeb(response.body);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
};

/**
 * 起一个投送专用网关。
 *
 * resolveProtocol(url) 返回自定义协议的处理器（与 protocol.handle 注册的是同一个函数），
 * 找不到就返回 null：那种地址只能走 http(s) 直连。
 */
const createGateway = ({ resolveProtocol = () => null } = {}) => {
    /** token → { url } */
    const sources = new Map();
    let server = null;
    let port = 0;

    const handle = async (req, res) => {
        const rawPath = req.url || '/';
        const path = rawPath.split('?')[0];
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { 'Content-Length': 0, Connection: 'close' });
            res.end();
            return;
        }
        if (!path.startsWith(CAST_PATH_PREFIX)) {
            res.writeHead(404, { 'Content-Length': 0, Connection: 'close' });
            res.end();
            return;
        }
        const token = path.slice(CAST_PATH_PREFIX.length);
        if (!TOKEN_PATTERN.test(token) || !sources.has(token)) {
            // 没有本次会话的令牌：一律拒绝，别人扫到这个端口也拿不到任何东西。
            res.writeHead(403, { 'Content-Length': 0, Connection: 'close' });
            res.end();
            return;
        }
        const source = sources.get(token);
        const range = typeof req.headers.range === 'string' ? req.headers.range : undefined;
        const isHead = req.method === 'HEAD';

        const protocolHandler = resolveProtocol(source.url);
        if (protocolHandler) {
            try {
                const request = new Request(source.url, {
                    headers: range ? { range } : {},
                });
                const response = await protocolHandler(request);
                await writeResponse(res, response, isHead);
            } catch (error) {
                res.writeHead(502, { 'Content-Length': 0, Connection: 'close' });
                res.end();
                void error;
            }
            return;
        }

        try {
            const upstream = await requestUpstream(source.url, pickForwardHeaders(range));
            writeStreamingResponse(res, upstream, isHead);
        } catch {
            res.writeHead(502, { 'Content-Length': 0, Connection: 'close' });
            res.end();
        }
    };

    const start = () => new Promise((resolve, reject) => {
        if (server && server.listening) {
            resolve(port);
            return;
        }
        const created = http.createServer((req, res) => { void handle(req, res); });
        created.on('error', error => {
            server = null;
            port = 0;
            reject(error);
        });
        // 监听所有接口：音响要能连进来。对外只服务 /cast/<token>，见 handle()。
        created.listen(0, '0.0.0.0', () => {
            server = created;
            port = created.address().port;
            resolve(port);
        });
    });

    const stop = () => {
        sources.clear();
        const current = server;
        server = null;
        port = 0;
        if (!current) return;
        try { current.close(); } catch { /* 已关闭。 */ }
    };

    /** 登记一个源地址，返回本次会话的 token 与路径。 */
    const register = url => {
        const token = randomBytes(16).toString('hex');
        sources.set(token, { url });
        return { token, path: `${CAST_PATH_PREFIX}${token}` };
    };

    const getPort = () => port;

    return { start, stop, register, getPort };
};

module.exports = {
    createGateway,
    CAST_PATH_PREFIX,
};
