'use strict';

const net = require('net');
const {
    MESSAGE_TYPE,
    FLAG_NO_REPLY_EXPECTED,
    encodeMessage,
    messageLength,
    decodeMessage,
    parseBusAddress,
    authExternalLine,
} = require('./dbusWire.cjs');

// 连会话总线的最小客户端：unix 套接字、EXTERNAL 认证、Hello，之后收发方法调用、回应和信号。一条连接只给 MPRIS 用。

const BUS_NAME = 'org.freedesktop.DBus';
const BUS_PATH = '/org/freedesktop/DBus';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_AUTH_LINE_BYTES = 4096;

/** 对端回的错误，或者要回给对端的错误：name 是 D-Bus 的错误名。 */
class DbusError extends Error {
    constructor(name, message) {
        super(message || name);
        this.name = 'DbusError';
        this.dbusName = name;
    }
}

const connectSocket = (endpoint, netImpl) => new Promise((resolve, reject) => {
    // Node 在 Linux 上把以 \0 开头的路径当作抽象套接字。
    const socket = netImpl.connect({ path: endpoint.path ?? `\0${endpoint.abstract}` });
    const onError = error => {
        socket.destroy();
        reject(error);
    };
    socket.once('error', onError);
    socket.once('connect', () => {
        socket.removeListener('error', onError);
        resolve(socket);
    });
});

// 发认证行，读到 OK 后发 BEGIN。返回 OK 那一行之后已经收到的字节（正常是空的）。
const authenticate = (socket, uid, timeoutMs) => new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const finish = (error, rest) => {
        clearTimeout(timer);
        socket.removeListener('data', onData);
        socket.removeListener('error', onFail);
        socket.removeListener('close', onClose);
        if (error) reject(error);
        else resolve(rest);
    };
    const onData = chunk => {
        received = Buffer.concat([received, chunk]);
        const end = received.indexOf('\r\n');
        if (end < 0) {
            if (received.length > MAX_AUTH_LINE_BYTES) finish(new Error('D-Bus auth reply is too long'));
            return;
        }
        const line = received.toString('ascii', 0, end);
        if (!line.startsWith('OK ')) {
            finish(new Error(`D-Bus refused EXTERNAL auth: ${line}`));
            return;
        }
        socket.write('BEGIN\r\n');
        finish(null, received.subarray(end + 2));
    };
    const onFail = error => finish(error);
    const onClose = () => finish(new Error('D-Bus closed the connection during auth'));
    const timer = setTimeout(() => finish(new Error('D-Bus auth timed out')), timeoutMs);
    socket.on('data', onData);
    socket.once('error', onFail);
    socket.once('close', onClose);
    socket.write(authExternalLine(uid));
});

/**
 * 按地址里的顺序连第一个连得上的 unix 端点，认证、Hello。返回的连接：
 * - call({ destination, path, interface, member, signature, body }) → Promise<{ signature, body }>，对端回错误时 reject 一个 DbusError；
 * - emitSignal({ path, interface, member, signature, body })；
 * - onMethodCall(handler)：handler(message) 返回 { signature, body }（或 Promise），抛 DbusError 回对应的错误；
 * - onSignal(handler)、onClose(handler)、close()。
 */
const connectBus = async ({ address, uid, netImpl = net, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
    const endpoints = parseBusAddress(address);
    if (endpoints.length === 0) throw new Error('D-Bus address has no unix endpoint');
    let socket = null;
    let lastError = null;
    for (const endpoint of endpoints) {
        try {
            socket = await connectSocket(endpoint, netImpl);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (!socket) throw lastError;

    let rest;
    try {
        rest = await authenticate(socket, uid, timeoutMs);
    } catch (error) {
        socket.destroy();
        throw error;
    }

    let serial = 0;
    let closed = false;
    let pending = Buffer.alloc(0);
    /** serial → { resolve, reject, timer } */
    const replies = new Map();
    let methodCallHandler = null;
    let signalHandler = null;
    const closeHandlers = [];

    const nextSerial = () => {
        serial = serial >= 0xffffffff ? 1 : serial + 1;
        return serial;
    };

    const send = message => {
        if (closed) throw new Error('D-Bus connection is closed');
        socket.write(encodeMessage({ ...message, serial: nextSerial() }));
    };

    const shutdown = error => {
        if (closed) return;
        closed = true;
        socket.destroy();
        for (const reply of replies.values()) {
            clearTimeout(reply.timer);
            reply.reject(error ?? new Error('D-Bus connection closed'));
        }
        replies.clear();
        for (const handler of closeHandlers) {
            try {
                handler(error ?? null);
            } catch (handlerError) {
                console.warn('[MPRIS] a D-Bus close listener threw', handlerError);
            }
        }
    };

    const answerCall = async message => {
        const wantsReply = (message.flags & FLAG_NO_REPLY_EXPECTED) === 0;
        try {
            if (!methodCallHandler) throw new DbusError('org.freedesktop.DBus.Error.UnknownObject', 'No objects here');
            const result = (await methodCallHandler(message)) ?? {};
            if (wantsReply && !closed) {
                send({
                    type: MESSAGE_TYPE.methodReturn,
                    flags: FLAG_NO_REPLY_EXPECTED,
                    replySerial: message.serial,
                    destination: message.sender,
                    signature: result.signature ?? '',
                    body: result.body ?? [],
                });
            }
        } catch (error) {
            const isDbusError = error instanceof DbusError;
            if (!isDbusError) console.warn('[MPRIS] a D-Bus method handler threw', { member: message.member }, error);
            if (wantsReply && !closed) {
                send({
                    type: MESSAGE_TYPE.error,
                    flags: FLAG_NO_REPLY_EXPECTED,
                    replySerial: message.serial,
                    destination: message.sender,
                    errorName: isDbusError ? error.dbusName : 'org.freedesktop.DBus.Error.Failed',
                    signature: 's',
                    body: [isDbusError ? error.message : 'Internal error'],
                });
            }
        }
    };

    const dispatch = message => {
        if (message.type === MESSAGE_TYPE.methodReturn || message.type === MESSAGE_TYPE.error) {
            const reply = replies.get(message.replySerial);
            if (!reply) return;
            replies.delete(message.replySerial);
            clearTimeout(reply.timer);
            if (message.type === MESSAGE_TYPE.error) {
                reply.reject(new DbusError(message.errorName ?? 'org.freedesktop.DBus.Error.Failed', String(message.body[0] ?? '')));
            } else {
                reply.resolve({ signature: message.signature, body: message.body });
            }
            return;
        }
        if (message.type === MESSAGE_TYPE.methodCall) {
            void answerCall(message);
            return;
        }
        if (message.type === MESSAGE_TYPE.signal && signalHandler) {
            try {
                signalHandler(message);
            } catch (error) {
                console.warn('[MPRIS] a D-Bus signal listener threw', error);
            }
        }
    };

    const onData = chunk => {
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        try {
            for (;;) {
                const length = messageLength(pending);
                if (length === null || pending.length < length) return;
                const message = decodeMessage(pending.subarray(0, length));
                pending = pending.subarray(length);
                dispatch(message);
            }
        } catch (error) {
            // 拆不开的字节流没法再对齐到下一条消息：断开。
            shutdown(error);
        }
    };

    socket.on('data', onData);
    socket.on('error', error => shutdown(error));
    socket.on('close', () => shutdown(null));
    if (rest.length > 0) onData(rest);

    const call = ({ destination, path, interface: iface, member, signature = '', body = [], timeoutMs: callTimeoutMs = timeoutMs }) => (
        new Promise((resolve, reject) => {
            if (closed) {
                reject(new Error('D-Bus connection is closed'));
                return;
            }
            const callSerial = nextSerial();
            const timer = setTimeout(() => {
                replies.delete(callSerial);
                reject(new Error(`D-Bus call ${member} timed out`));
            }, callTimeoutMs);
            replies.set(callSerial, { resolve, reject, timer });
            socket.write(encodeMessage({
                type: MESSAGE_TYPE.methodCall,
                serial: callSerial,
                destination,
                path,
                interface: iface,
                member,
                signature,
                body,
            }));
        })
    );

    const connection = {
        uniqueName: null,
        call,
        emitSignal: ({ path, interface: iface, member, signature = '', body = [] }) => send({
            type: MESSAGE_TYPE.signal,
            flags: FLAG_NO_REPLY_EXPECTED,
            path,
            interface: iface,
            member,
            signature,
            body,
        }),
        onMethodCall: handler => { methodCallHandler = handler; },
        onSignal: handler => { signalHandler = handler; },
        onClose: handler => { closeHandlers.push(handler); },
        isClosed: () => closed,
        close: () => shutdown(null),
    };

    try {
        const hello = await call({ destination: BUS_NAME, path: BUS_PATH, interface: BUS_NAME, member: 'Hello' });
        connection.uniqueName = hello.body[0] ?? null;
    } catch (error) {
        shutdown(error);
        throw error;
    }
    return connection;
};

module.exports = {
    BUS_NAME,
    BUS_PATH,
    DbusError,
    connectBus,
};
