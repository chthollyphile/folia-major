'use strict';

const { randomBytes: cryptoRandomBytes } = require('crypto');
const { Readable, pipeline } = require('stream');
const { inspect } = require('util');
const { createHifiError, sanitizeDetail } = require('./hifiErrors.cjs');

// 只听 127.0.0.1 的来源桥：mpv 凭随机令牌取音频，本地 File 按块向渲染端要，Navidrome 由主进程 fetch 后转给 mpv。

const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const TOKEN_PATTERN = /^\/([a-f0-9]{32})(?:\/|$)/;
// Navidrome 出错时常回 200 加 Subsonic 的 JSON / XML 错误体，代理或登录页回 HTML：都不是音频。
const REJECTED_CONTENT_TYPE = /json|xml|html/i;
const FORWARDED_REMOTE_HEADERS = [
    ['content-type', 'Content-Type'],
    ['content-length', 'Content-Length'],
    ['content-range', 'Content-Range'],
    ['accept-ranges', 'Accept-Ranges'],
];
// 只认可见 ASCII 的 MIME，渲染端传来的值不合规时 setHeader 会抛错。
const SAFE_MIME_TYPE = /^[\x21-\x7e][\x20-\x7e]{0,254}$/;
// Subsonic 的认证参数：u 用户名，t/s 令牌和盐，p 旧式密码，apiKey 是 OpenSubsonic 的密钥。
const CREDENTIAL_PARAMS = ['u', 't', 's', 'p', 'apiKey'];

const tokenLabel = token => token.slice(0, 8);

/**
 * 按源大小解析单个 `bytes=a-b | a- | -n`。null 表示整段回 200（没有 Range、多段 Range 或写错的 Range 都忽略），
 * `{ unsatisfiable: true }` 表示回 416。
 */
const parseRangeHeader = (value, size) => {
    if (typeof value !== 'string' || value.includes(',')) return null;
    const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(value);
    if (!match || (!match[1] && !match[2])) return null;
    if (!match[1]) {
        const suffix = Number(match[2]);
        if (suffix <= 0 || size <= 0) return { unsatisfiable: true };
        return { start: Math.max(size - suffix, 0), end: size - 1 };
    }
    const start = Number(match[1]);
    const last = match[2] ? Number(match[2]) : null;
    if (last !== null && last < start) return null;
    if (!Number.isSafeInteger(start) || start >= size) return { unsatisfiable: true };
    return { start, end: last === null ? size - 1 : Math.min(last, size - 1) };
};

const toUint8Array = data => {
    if (data instanceof Uint8Array) return data;
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return null;
};

const waitForDrain = res => new Promise(resolve => {
    const done = () => {
        res.off('drain', done);
        res.off('close', done);
        resolve();
    };
    res.on('drain', done);
    res.on('close', done);
});

const sendEmpty = (res, status, headers = {}) => {
    if (!res.headersSent) res.writeHead(status, { ...headers, 'Content-Length': '0' });
    res.end();
};

const cancelBody = response => {
    try {
        response?.body?.cancel().catch(() => {});
    } catch {
        // body 已被读过或已锁住，没有可释放的
    }
};

const credentialFragments = url => {
    try {
        const parsed = new URL(url);
        const values = CREDENTIAL_PARAMS.map(name => parsed.searchParams.get(name));
        return [parsed.search, parsed.username, parsed.password, ...values]
            .filter(value => typeof value === 'string' && value.length >= 3);
    } catch {
        return [];
    }
};

// 抛出的错原样交给日志；只有它的文字带着 stream 地址的查询串或凭据值时，换成去掉这些的副本。
const redactRemoteError = (error, url) => {
    const secrets = credentialFragments(url);
    if (!secrets.some(secret => inspect(error).includes(secret))) return error;
    const message = secrets.reduce((text, secret) => text.split(secret).join('***'), sanitizeDetail(error));
    const redacted = new Error(message);
    if (typeof error?.name === 'string') redacted.name = error.name;
    if (error?.code !== undefined) redacted.code = error.code;
    return redacted;
};

function createSourceBridge(options = {}) {
    const {
        http = require('http'),
        fetchFn = (...args) => globalThis.fetch(...args),
        requestRead,
        chunkSize = DEFAULT_CHUNK_SIZE,
        unknownSourceRetryMs = 250,
        unknownSourceGiveUpMs = 8000,
        randomBytes = cryptoRandomBytes,
        logInfo = (...args) => console.info(...args),
        logWarn = (...args) => console.warn(...args),
        now = () => Date.now(),
        setTimeoutFn = (callback, ms) => setTimeout(callback, ms),
    } = options;

    /** token → { kind: 'local', sourceKey, size, mimeType, ownerId } | { kind: 'remote', url, host } */
    const sources = new Map();
    const sourceErrors = new Map();
    /** token → 正在服务这个令牌的连接，撤销令牌时一并断开 */
    const activeConnections = new Map();
    let server = null;
    let startPromise = null;

    const delay = ms => new Promise(resolve => setTimeoutFn(resolve, ms));

    const port = () => {
        const address = server?.listening ? server.address() : null;
        return address && typeof address === 'object' ? address.port : null;
    };

    const allocateToken = entry => {
        let token = randomBytes(16).toString('hex');
        while (sources.has(token)) token = randomBytes(16).toString('hex');
        sources.set(token, entry);
        return token;
    };

    const buildUrl = (listeningPort, token, fileName) => {
        const name = typeof fileName === 'string' && fileName ? fileName : 'audio';
        return `http://127.0.0.1:${listeningPort}/${token}/${encodeURIComponent(name)}`;
    };

    const requirePort = () => {
        const listeningPort = port();
        if (listeningPort === null) throw createHifiError('LOAD_FAILED', 'source bridge is not listening');
        return listeningPort;
    };

    const registerLocal = ({ sourceKey, size, mimeType, fileName, ownerId } = {}) => {
        if (typeof sourceKey !== 'string' || !sourceKey || !Number.isSafeInteger(size) || size < 0) {
            throw createHifiError('INVALID_REQUEST', 'local source needs a sourceKey and a byte size');
        }
        const listeningPort = requirePort();
        const safeMimeType = typeof mimeType === 'string' && SAFE_MIME_TYPE.test(mimeType)
            ? mimeType
            : 'application/octet-stream';
        const token = allocateToken({ kind: 'local', sourceKey, size, mimeType: safeMimeType, ownerId });
        logInfo(`[HiFi] bridge registered local ${tokenLabel(token)} (${size} bytes, ${safeMimeType})`);
        return { token, url: buildUrl(listeningPort, token, fileName) };
    };

    const registerRemote = ({ url, fileName } = {}) => {
        let parsed = null;
        try {
            parsed = new URL(url);
        } catch {
            parsed = null;
        }
        if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
            throw createHifiError('INVALID_REQUEST', 'remote source URL must be http or https');
        }
        const listeningPort = requirePort();
        const token = allocateToken({ kind: 'remote', url: parsed.href, host: parsed.host });
        logInfo(`[HiFi] bridge registered remote ${tokenLabel(token)} host=${parsed.host}`);
        return { token, url: buildUrl(listeningPort, token, fileName) };
    };

    const revoke = token => {
        sources.delete(token);
        sourceErrors.delete(token);
        const connections = activeConnections.get(token);
        if (!connections) return;
        activeConnections.delete(token);
        for (const connection of connections) connection.cancel();
    };

    const revokeAll = () => {
        for (const token of [...sources.keys(), ...activeConnections.keys()]) revoke(token);
    };

    const getSourceError = token => sourceErrors.get(token) ?? null;

    // 令牌还登记着时才记错：撤销后的断流是我们自己断的，不算源的错。
    const recordError = (token, entry, code) => {
        if (sources.get(token) === entry && !sourceErrors.has(token)) sourceErrors.set(token, code);
    };

    // 同一个令牌后来有一次请求把它要的范围完整送到了（mpv 重连成功）：之前记的错作废，
    // 免得会话把一次已经恢复的断流当成这首歌放完时、或之后不相干的出错时的原因。
    const clearError = (token, entry) => {
        if (sources.get(token) === entry && sourceErrors.delete(token)) {
            logInfo(`[HiFi] bridge ${tokenLabel(token)} served a full request again, dropping the earlier error`);
        }
    };

    // 跟住一条 mpv 连接：响应发完、mpv 断开（seek 时会断）或令牌被撤销后 closed 为 true，之后不再写也不再拉。
    const watchConnection = (token, res, onGone = () => {}) => {
        const connection = {
            closed: false,
            cancel: () => {
                connection.closed = true;
                res.destroy();
            },
        };
        let connections = activeConnections.get(token);
        if (!connections) {
            connections = new Set();
            activeConnections.set(token, connections);
        }
        connections.add(connection);
        res.once('close', () => {
            connection.closed = true;
            connections.delete(connection);
            if (connections.size === 0 && activeConnections.get(token) === connections) activeConnections.delete(token);
            if (!res.writableFinished) onGone();
        });
        return connection;
    };

    // 向渲染端要一块；源不认识（窗口重建后还没重新登记那个 File）时每隔一会儿再问，过了期限才放弃。
    const readChunk = async (token, entry, offset, length, connection) => {
        let firstUnknownAt = null;
        for (;;) {
            let response;
            try {
                response = await requestRead(entry.ownerId, { sourceKey: entry.sourceKey, offset, length });
            } catch (error) {
                logWarn(`[HiFi] bridge ${tokenLabel(token)} local read threw at byte ${offset}`, error);
                return { status: 'failed' };
            }
            if (connection.closed) return { status: 'closed' };
            if (response?.status === 'ok') {
                const data = toUint8Array(response.data);
                return data ? { status: 'ok', data } : { status: 'failed' };
            }
            if (response?.status !== 'unknown-source') return { status: 'failed' };
            const at = now();
            if (firstUnknownAt === null) {
                firstUnknownAt = at;
                logInfo(`[HiFi] bridge ${tokenLabel(token)} renderer does not know the source yet, retrying`);
            }
            const remainingMs = unknownSourceGiveUpMs - (at - firstUnknownAt);
            if (remainingMs <= 0) return { status: 'unknown-source' };
            await delay(Math.min(unknownSourceRetryMs, remainingMs));
            if (connection.closed) return { status: 'closed' };
        }
    };

    // 把 [offset, endExclusive) 一块块从渲染端搬给 mpv；mpv 不读时等 drain，不往前多拉。返回失败原因或 null。
    const pumpLocal = async (token, entry, res, offset, endExclusive, connection) => {
        let position = offset;
        while (position < endExclusive && !connection.closed) {
            const length = Math.min(chunkSize, endExclusive - position);
            const result = await readChunk(token, entry, position, length, connection);
            if (result.status === 'closed' || connection.closed) return null;
            if (result.status !== 'ok') return { reason: result.status, offset: position };
            const data = result.data.byteLength > length ? result.data.subarray(0, length) : result.data;
            if (data.byteLength === 0) return { reason: 'empty read', offset: position };
            position += data.byteLength;
            if (!res.write(data)) await waitForDrain(res);
        }
        return null;
    };

    const serveLocal = async (token, entry, req, res) => {
        const { size } = entry;
        const range = parseRangeHeader(req.headers.range, size);
        if (range?.unsatisfiable) {
            sendEmpty(res, 416, { 'Content-Range': `bytes */${size}` });
            return;
        }
        const start = range ? range.start : 0;
        const end = range ? range.end : size - 1;
        const headers = {
            'Accept-Ranges': 'bytes',
            'Content-Type': entry.mimeType,
            'Content-Length': String(end - start + 1),
        };
        if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
        res.writeHead(range ? 206 : 200, headers);
        if (req.method === 'HEAD' || end < start) {
            res.end();
            return;
        }
        const connection = watchConnection(token, res);
        const failure = await pumpLocal(token, entry, res, start, end + 1, connection);
        if (connection.closed) return;
        if (failure) {
            // 头已经发了，只能断开连接让 mpv 看到截断；end-file 归因时读 getSourceError。
            recordError(token, entry, 'SOURCE_UNREACHABLE');
            logWarn(`[HiFi] bridge ${tokenLabel(token)} local read ${failure.reason} at byte ${failure.offset}, dropping the connection`);
            res.destroy();
            return;
        }
        res.once('finish', () => clearError(token, entry));
        res.end();
    };

    const serveRemote = async (token, entry, req, res) => {
        const label = tokenLabel(token);
        const controller = new AbortController();
        const connection = watchConnection(token, res, () => controller.abort());
        const headers = {};
        if (typeof req.headers.range === 'string') headers.Range = req.headers.range;
        let upstream;
        try {
            upstream = await fetchFn(entry.url, { method: req.method, headers, redirect: 'follow', signal: controller.signal });
        } catch (error) {
            if (connection.closed) return;
            recordError(token, entry, 'SOURCE_UNREACHABLE');
            logWarn(`[HiFi] bridge ${label} fetch from ${entry.host} failed`, redactRemoteError(error, entry.url));
            sendEmpty(res, 502);
            return;
        }
        if (connection.closed) {
            cancelBody(upstream);
            return;
        }
        const contentType = upstream.headers.get('content-type') || '';
        if (REJECTED_CONTENT_TYPE.test(contentType)) {
            cancelBody(upstream);
            recordError(token, entry, 'SOURCE_REJECTED');
            logWarn(`[HiFi] bridge ${label} ${entry.host} answered ${upstream.status} with ${contentType}, not audio`);
            sendEmpty(res, 502);
            return;
        }
        if (upstream.status >= 400) {
            cancelBody(upstream);
            recordError(token, entry, 'SOURCE_UNREACHABLE');
            logWarn(`[HiFi] bridge ${label} ${entry.host} answered ${upstream.status}`);
            sendEmpty(res, upstream.status);
            return;
        }
        const forwarded = {};
        for (const [name, header] of FORWARDED_REMOTE_HEADERS) {
            const value = upstream.headers.get(name);
            if (value !== null) forwarded[header] = value;
        }
        // fetch 已经解了压缩，上游的长度对不上解出来的字节，改走分块。
        const encoding = upstream.headers.get('content-encoding');
        if (encoding && encoding.toLowerCase() !== 'identity') delete forwarded['Content-Length'];
        res.writeHead(upstream.status, forwarded);
        if (req.method === 'HEAD' || !upstream.body) {
            cancelBody(upstream);
            res.end();
            return;
        }
        const body = Readable.fromWeb(upstream.body);
        let upstreamError = null;
        // mpv 断开时 pipeline 也会让 body 报错，那时 connection 已经 closed，不算上游的错。
        body.once('error', error => {
            if (!connection.closed) upstreamError = error;
        });
        const pipeError = await new Promise(resolve => pipeline(body, res, error => resolve(error ?? null)));
        if (upstreamError) {
            recordError(token, entry, 'SOURCE_UNREACHABLE');
            logWarn(`[HiFi] bridge ${label} stream from ${entry.host} broke off`, redactRemoteError(upstreamError, entry.url));
            return;
        }
        if (!pipeError && res.writableFinished) clearError(token, entry);
    };

    const handleRequest = (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            sendEmpty(res, 405, { Allow: 'GET, HEAD' });
            return;
        }
        const match = TOKEN_PATTERN.exec(req.url || '');
        const token = match ? match[1] : null;
        const entry = token ? sources.get(token) : undefined;
        if (!entry) {
            sendEmpty(res, 404);
            return;
        }
        const serve = entry.kind === 'local' ? serveLocal : serveRemote;
        serve(token, entry, req, res).catch(error => {
            logWarn(`[HiFi] bridge ${tokenLabel(token)} request failed`, entry.kind === 'remote' ? redactRemoteError(error, entry.url) : error);
            res.destroy();
        });
    };

    const start = () => {
        if (startPromise) return startPromise;
        const next = http.createServer(handleRequest);
        server = next;
        startPromise = new Promise((resolve, reject) => {
            const onError = error => {
                if (server === next) {
                    server = null;
                    startPromise = null;
                }
                logWarn('[HiFi] bridge failed to listen on 127.0.0.1', error);
                reject(error);
            };
            next.once('error', onError);
            next.listen(0, '127.0.0.1', () => {
                next.off('error', onError);
                if (server !== next) {
                    // 还没听上就被 stop 了
                    next.close();
                    resolve();
                    return;
                }
                next.on('error', error => logWarn('[HiFi] bridge server error', error));
                logInfo(`[HiFi] bridge listening on 127.0.0.1:${port()}`);
                resolve();
            });
        });
        return startPromise;
    };

    const stop = () => {
        revokeAll();
        const active = server;
        server = null;
        startPromise = null;
        if (!active?.listening) return Promise.resolve();
        return new Promise(resolve => {
            active.close(() => resolve());
            active.closeAllConnections?.();
            logInfo('[HiFi] bridge stopped');
        });
    };

    return {
        start,
        stop,
        port,
        registerLocal,
        registerRemote,
        revoke,
        revokeAll,
        getSourceError,
    };
}

module.exports = {
    createSourceBridge,
    parseRangeHeader,
};
