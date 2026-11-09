'use strict';

const { StringDecoder } = require('string_decoder');
const { createHifiError, sanitizeDetail } = require('./hifiErrors.cjs');

// mpv JSON IPC 的客户端：在一条双工连接上一行一个 JSON 收发，按 request_id 配对回复，按 observe id 分发属性变化。

const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const MALFORMED_LINE_LOG_CHARS = 120;

/** 一行 mpv 输出解析成对象；空行、坏 JSON、不是对象的值都返回 null。 */
const parseMpvLine = line => {
    if (typeof line !== 'string') return null;
    const trimmed = line.trim();
    if (trimmed === '') return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

// JSON.stringify 会把字符串里的换行转义，参数里的换行拆不开这一行。
const encodeMpvCommand = (args, requestId) => `${JSON.stringify({ command: args, request_id: requestId })}\n`;

const createMpvIpcClient = ({
    socket,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logWarn = (...args) => console.warn(...args),
} = {}) => {
    if (!socket || typeof socket.write !== 'function' || typeof socket.on !== 'function') {
        throw new TypeError('HiFi mpv IPC client needs a duplex socket');
    }

    const decoder = new StringDecoder('utf8');
    const pending = new Map();
    const observedNames = new Map();
    const observeRequests = new Map();
    const eventListeners = new Set();
    const propertyListeners = new Map();
    const closeListeners = new Set();
    let buffered = '';
    let nextRequestId = 1;
    let nextObserveId = 1;
    let closed = false;
    let closeInfo = null;

    const callListener = (listener, ...args) => {
        try {
            listener(...args);
        } catch (error) {
            logWarn('[HiFi] ipc listener threw', error);
        }
    };

    const settle = (requestId, error, data) => {
        const entry = pending.get(requestId);
        if (!entry) return;
        pending.delete(requestId);
        clearTimeoutFn(entry.timer);
        if (error) entry.reject(error);
        else entry.resolve(data);
    };

    // 连接断了（mpv 退出、出错或我们自己关）：所有还在等的请求按 MPV_CRASHED 拒掉，onClose 只触发一次。
    const markClosed = (error, intentional) => {
        if (closed) return;
        closed = true;
        closeInfo = { intentional, error: error || null };
        const detail = intentional ? 'ipc closed' : error || 'ipc connection lost';
        for (const requestId of [...pending.keys()]) {
            settle(requestId, createHifiError('MPV_CRASHED', detail));
        }
        const listeners = [...closeListeners];
        closeListeners.clear();
        for (const listener of listeners) callListener(listener, closeInfo);
        eventListeners.clear();
        propertyListeners.clear();
    };

    const handleReply = message => {
        const entry = pending.get(message.request_id);
        if (!entry) return;
        if (message.error === 'success') {
            settle(message.request_id, null, message.data);
            return;
        }
        const mpvError = typeof message.error === 'string' ? message.error : 'unknown';
        const error = new Error(`mpv ${entry.name} failed: ${mpvError}`);
        error.mpvError = mpvError;
        settle(message.request_id, error);
    };

    const handleEvent = message => {
        for (const listener of [...eventListeners]) callListener(listener, message);
        if (message.event !== 'property-change') return;
        const name = observedNames.get(message.id);
        const listeners = name === undefined ? null : propertyListeners.get(name);
        if (!listeners) return;
        for (const listener of [...listeners]) callListener(listener, message.data);
    };

    const handleLine = line => {
        if (line.trim() === '') return;
        const message = parseMpvLine(line);
        if (!message) {
            logWarn('[HiFi] ipc ignored a malformed line', sanitizeDetail(line).slice(0, MALFORMED_LINE_LOG_CHARS));
            return;
        }
        if (typeof message.event === 'string') handleEvent(message);
        else if (typeof message.request_id === 'number') handleReply(message);
    };

    const consume = text => {
        buffered += text;
        let newlineIndex = buffered.indexOf('\n');
        while (newlineIndex !== -1 && !closed) {
            const line = buffered.slice(0, newlineIndex);
            buffered = buffered.slice(newlineIndex + 1);
            handleLine(line);
            newlineIndex = buffered.indexOf('\n');
        }
    };

    socket.on('data', chunk => {
        if (closed) return;
        consume(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    });
    socket.on('end', () => {
        if (closed) return;
        // mpv 总以换行收尾；万一最后一行没有换行，也先把它处理掉再判连接已断。
        consume(`${decoder.end()}\n`);
        markClosed(null, false);
    });
    socket.on('close', () => markClosed(null, false));
    // 'error' 的监听一直挂着：关掉之后迟到的 EPIPE 也不能变成未捕获的异常。
    socket.on('error', error => {
        if (closed) return;
        logWarn('[HiFi] ipc socket error', error);
        markClosed(error, false);
    });

    /** 发一条命令，回复 success 时得到 data；mpv 报错时 Error 的 `.mpvError` 是它的原文。 */
    const command = args => {
        if (closed) return Promise.reject(createHifiError('MPV_CRASHED', 'ipc closed'));
        if (!Array.isArray(args) || args.length === 0) {
            return Promise.reject(new TypeError('mpv command must be a non-empty array'));
        }
        const requestId = nextRequestId++;
        const name = String(args[0]);
        return new Promise((resolve, reject) => {
            const timer = setTimeoutFn(() => {
                if (!pending.has(requestId)) return;
                logWarn(`[HiFi] ipc ${name} timed out after ${requestTimeoutMs} ms`);
                settle(requestId, createHifiError('IPC_TIMEOUT', name));
            }, requestTimeoutMs);
            pending.set(requestId, { resolve, reject, timer, name });
            try {
                socket.write(encodeMpvCommand(args, requestId), error => {
                    if (error) settle(requestId, createHifiError('MPV_CRASHED', error));
                });
            } catch (error) {
                settle(requestId, createHifiError('MPV_CRASHED', error));
            }
        });
    };

    /** 订阅一个属性，得到这次分配的 observe id；同名属性只订阅一次，再调返回同一个 id。 */
    const observeProperty = name => {
        if (typeof name !== 'string' || name === '') {
            return Promise.reject(new TypeError('mpv property name must be a non-empty string'));
        }
        const existing = observeRequests.get(name);
        if (existing) return existing;
        const observeId = nextObserveId++;
        // 先登记 id 再发命令：mpv 订阅后马上推一次当前值，可能早于回复到达。
        observedNames.set(observeId, name);
        const request = command(['observe_property', observeId, name]).then(
            () => observeId,
            error => {
                observedNames.delete(observeId);
                observeRequests.delete(name);
                throw error;
            },
        );
        observeRequests.set(name, request);
        return request;
    };

    const onEvent = listener => {
        if (closed) return () => {};
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
    };

    /** 属性变化的回调；mpv 没带 data（属性暂不可用）时收到 undefined。 */
    const onPropertyChange = (name, listener) => {
        if (closed) return () => {};
        let listeners = propertyListeners.get(name);
        if (!listeners) {
            listeners = new Set();
            propertyListeners.set(name, listeners);
        }
        listeners.add(listener);
        return () => propertyListeners.get(name)?.delete(listener);
    };

    /** 连接断开时调一次，参数 { intentional, error }；已经断开时在下一个微任务里补调。 */
    const onClose = listener => {
        if (closed) {
            let active = true;
            queueMicrotask(() => {
                if (active) callListener(listener, closeInfo);
            });
            return () => { active = false; };
        }
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
    };

    // 主动关：先把写缓冲刷出去再半关（fd 模式下 mpv 读到 EOF 就退出），刷完再销毁。
    const close = () => {
        if (closed) return;
        markClosed(null, true);
        try {
            socket.end();
            if (socket.writableFinished) socket.destroy();
            else socket.once('finish', () => socket.destroy());
        } catch (error) {
            logWarn('[HiFi] ipc socket close failed', error);
        }
    };

    return {
        command,
        observeProperty,
        onEvent,
        onPropertyChange,
        onClose,
        close,
        isClosed: () => closed,
    };
};

/** Windows 上连 mpv 的命名管道：mpv 刚启动时管道还没建好，按间隔重试直到连上；signal 中止时不再重试。 */
const connectNamedPipe = (pipePath, {
    netModule = require('net'),
    attempts = 50,
    delayMs = 100,
    setTimeoutFn = setTimeout,
    signal = null,
} = {}) => new Promise((resolve, reject) => {
    const maxAttempts = Math.max(1, Math.floor(Number(attempts) || 1));
    let attempt = 0;

    const tryConnect = () => {
        if (signal?.aborted) {
            reject(createHifiError('MPV_SPAWN_FAILED', 'pipe connect aborted'));
            return;
        }
        attempt += 1;
        let socket;
        const retryOrFail = error => {
            if (attempt >= maxAttempts) {
                const failure = createHifiError('MPV_SPAWN_FAILED', error);
                failure.cause = error;
                reject(failure);
                return;
            }
            setTimeoutFn(tryConnect, delayMs);
        };
        try {
            socket = netModule.connect(pipePath);
        } catch (error) {
            retryOrFail(error);
            return;
        }
        const onConnect = () => {
            socket.removeListener('error', onError);
            if (signal?.aborted) {
                socket.destroy();
                reject(createHifiError('MPV_SPAWN_FAILED', 'pipe connect aborted'));
                return;
            }
            resolve(socket);
        };
        const onError = error => {
            socket.removeListener('connect', onConnect);
            socket.destroy();
            retryOrFail(error);
        };
        socket.once('connect', onConnect);
        socket.once('error', onError);
    };

    tryConnect();
});

module.exports = {
    DEFAULT_REQUEST_TIMEOUT_MS,
    parseMpvLine,
    encodeMpvCommand,
    createMpvIpcClient,
    connectNamedPipe,
};
