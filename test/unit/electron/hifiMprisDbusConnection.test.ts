import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 钉住会话总线客户端：对着本机一个假总线（unix 套接字）走完 EXTERNAL 认证和 Hello，方法调用的回应和错误、
// 对端调进来的方法（回应、D-Bus 错误、不要回应的不回）、发信号，以及总线断开时把等着的调用都 reject。

const require = createRequire(import.meta.url);
const wire = require('../../../electron/hifi/mpris/dbusWire.cjs') as {
    MESSAGE_TYPE: Record<string, number>;
    encodeMessage: (message: Record<string, unknown>) => Buffer;
    messageLength: (buffer: Buffer) => number | null;
    decodeMessage: (buffer: Buffer) => Record<string, unknown> & { body: unknown[]; serial: number };
};
const { connectBus, DbusError } = require('../../../electron/hifi/mpris/dbusConnection.cjs') as {
    connectBus: (options: { address: string; uid: number; timeoutMs?: number }) => Promise<{
        uniqueName: string | null;
        call: (message: Record<string, unknown>) => Promise<{ signature: string; body: unknown[] }>;
        emitSignal: (message: Record<string, unknown>) => void;
        onMethodCall: (handler: (message: Record<string, unknown>) => unknown) => void;
        onClose: (handler: (error: Error | null) => void) => void;
        isClosed: () => boolean;
        close: () => void;
    }>;
    DbusError: new (name: string, message?: string) => Error & { dbusName: string };
};

type Message = ReturnType<typeof wire.decodeMessage>;

/** 一个假总线：认证通过，回 Hello，其余的消息交给测试。 */
const startFakeBus = async (socketPath: string, { refuseAuth = false } = {}) => {
    const received: Message[] = [];
    const authLines: string[] = [];
    let client: net.Socket | null = null;
    let serial = 100;
    let onMessage: (message: Message) => void = () => {};
    const send = (message: Record<string, unknown>) => client!.write(wire.encodeMessage({ serial: ++serial, ...message }));

    const server = net.createServer(socket => {
        client = socket;
        let buffer = Buffer.alloc(0);
        let authed = false;
        socket.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (!authed) {
                const end = buffer.indexOf('\r\n');
                if (end < 0) return;
                const line = buffer.toString('ascii', 0, end);
                buffer = buffer.subarray(end + 2);
                authLines.push(line);
                if (line.includes('AUTH EXTERNAL')) socket.write(refuseAuth ? 'REJECTED EXTERNAL\r\n' : 'OK 0123456789abcdef0123456789abcdef\r\n');
                if (line === 'BEGIN') authed = true;
            }
            for (;;) {
                const length = wire.messageLength(buffer);
                if (length === null || buffer.length < length) return;
                const message = wire.decodeMessage(buffer.subarray(0, length));
                buffer = buffer.subarray(length);
                received.push(message);
                if (message.member === 'Hello') {
                    send({ type: wire.MESSAGE_TYPE.methodReturn, replySerial: message.serial, destination: ':1.42', signature: 's', body: [':1.42'] });
                } else {
                    onMessage(message);
                }
            }
        });
    });
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    return {
        received,
        authLines,
        send,
        setOnMessage: (handler: (message: Message) => void) => { onMessage = handler; },
        dropClient: () => client?.destroy(),
        close: () => new Promise<void>(resolve => {
            client?.destroy();
            server.close(() => resolve());
        }),
    };
};

let dir: string;
let socketPath: string;
let bus: Awaited<ReturnType<typeof startFakeBus>> | null = null;

beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'folia-dbus-'));
    socketPath = path.join(dir, 'bus');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    await bus?.close();
    bus = null;
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

const waitFor = async (check: () => boolean) => {
    for (let index = 0; index < 100 && !check(); index += 1) await new Promise(resolve => setTimeout(resolve, 5));
    expect(check()).toBe(true);
};

// The fake bus listens on a unix socket in a temp folder: Windows (the dev machine) cannot, and MPRIS is Linux only.
describe.skipIf(process.platform === 'win32')('connectBus', () => {
    it('authenticates with EXTERNAL, says Hello and keeps the unique name', async () => {
        bus = await startFakeBus(socketPath);
        const connection = await connectBus({ address: `tcp:host=x;unix:path=${socketPath}`, uid: 1000 });
        expect(bus.authLines).toEqual(['\u0000AUTH EXTERNAL 31303030', 'BEGIN']);
        expect(connection.uniqueName).toBe(':1.42');
        expect(bus.received[0]).toMatchObject({ member: 'Hello', destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus' });
        connection.close();
    });

    it('fails when the bus refuses the auth, or nothing listens', async () => {
        bus = await startFakeBus(socketPath, { refuseAuth: true });
        await expect(connectBus({ address: `unix:path=${socketPath}`, uid: 1000 })).rejects.toThrow(/refused EXTERNAL/);
        await expect(connectBus({ address: `unix:path=${path.join(dir, 'none')}`, uid: 1000 })).rejects.toThrow();
        await expect(connectBus({ address: 'tcp:host=x', uid: 1000 })).rejects.toThrow(/no unix endpoint/);
    });

    it('resolves a call with its reply and rejects one with a D-Bus error', async () => {
        bus = await startFakeBus(socketPath);
        bus.setOnMessage(message => {
            if (message.member === 'RequestName') {
                bus!.send({ type: wire.MESSAGE_TYPE.methodReturn, replySerial: message.serial, signature: 'u', body: [1] });
            } else {
                bus!.send({ type: wire.MESSAGE_TYPE.error, replySerial: message.serial, errorName: 'org.freedesktop.DBus.Error.UnknownMethod', signature: 's', body: ['nope'] });
            }
        });
        const connection = await connectBus({ address: `unix:path=${socketPath}`, uid: 1000 });
        await expect(connection.call({ destination: 'org.freedesktop.DBus', path: '/org/freedesktop/DBus', interface: 'org.freedesktop.DBus', member: 'RequestName', signature: 'su', body: ['a.b', 4] }))
            .resolves.toEqual({ signature: 'u', body: [1] });
        await expect(connection.call({ destination: 'org.freedesktop.DBus', path: '/', member: 'Nope' }))
            .rejects.toMatchObject({ dbusName: 'org.freedesktop.DBus.Error.UnknownMethod', message: 'nope' });
        connection.close();
    });

    it('answers calls coming in: a return, a D-Bus error, nothing when no reply is wanted', async () => {
        bus = await startFakeBus(socketPath);
        const connection = await connectBus({ address: `unix:path=${socketPath}`, uid: 1000 });
        connection.onMethodCall(message => {
            if (message.member === 'Get') return { signature: 's', body: ['value'] };
            if (message.member === 'Fail') throw new DbusError('org.example.Error.Nope', 'no');
            return {};
        });
        const replies: Message[] = [];
        bus.setOnMessage(message => replies.push(message));
        bus.send({ type: wire.MESSAGE_TYPE.methodCall, sender: ':1.7', path: '/x', member: 'Get' });
        bus.send({ type: wire.MESSAGE_TYPE.methodCall, sender: ':1.7', path: '/x', member: 'Fail' });
        bus.send({ type: wire.MESSAGE_TYPE.methodCall, flags: 1, sender: ':1.7', path: '/x', member: 'Quiet' });
        bus.send({ type: wire.MESSAGE_TYPE.methodCall, sender: ':1.7', path: '/x', member: 'Last' });
        await waitFor(() => replies.length === 3);
        // The bus's Hello reply took serial 101: Get 102, Fail 103, Quiet 104, Last 105. Replies may come in any order.
        const replyTo = (callSerial: number) => replies.find(reply => reply.replySerial === callSerial);
        expect(replyTo(102)).toMatchObject({ type: wire.MESSAGE_TYPE.methodReturn, destination: ':1.7', body: ['value'] });
        expect(replyTo(103)).toMatchObject({ type: wire.MESSAGE_TYPE.error, errorName: 'org.example.Error.Nope', body: ['no'] });
        expect(replyTo(104)).toBeUndefined();
        expect(replyTo(105)).toMatchObject({ type: wire.MESSAGE_TYPE.methodReturn });

        connection.emitSignal({ path: '/x', interface: 'org.example', member: 'Changed', signature: 'x', body: [5n] });
        await waitFor(() => replies.length === 4);
        expect(replies.at(-1)).toMatchObject({ type: wire.MESSAGE_TYPE.signal, member: 'Changed', body: [5n] });
        connection.close();
    });

    it('rejects waiting calls and tells its listeners when the bus goes away', async () => {
        bus = await startFakeBus(socketPath);
        const connection = await connectBus({ address: `unix:path=${socketPath}`, uid: 1000 });
        const onClose = vi.fn();
        connection.onClose(onClose);
        const waiting = connection.call({ destination: 'org.freedesktop.DBus', path: '/', member: 'NeverAnswered' });
        await waitFor(() => bus!.received.length === 2);
        bus.dropClient();
        await expect(waiting).rejects.toThrow();
        await waitFor(() => onClose.mock.calls.length === 1);
        expect(connection.isClosed()).toBe(true);
        expect(() => connection.emitSignal({ path: '/x', interface: 'a.b', member: 'C' })).toThrow(/closed/);
    });
});
