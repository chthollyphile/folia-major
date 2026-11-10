import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 钉住 D-Bus 线上格式的最小实现：签名拆分、各类型的对齐和字节、消息拼拆（含大端的对端）、总线地址和认证行。
// 对照的字节：值的编组按规范手算；整条消息用 GLib（Gio.DBusMessage.to_blob）编出来的，我们编的也交给 GLib 解过。

const require = createRequire(import.meta.url);
const wire = require('../../../electron/hifi/mpris/dbusWire.cjs') as {
    MESSAGE_TYPE: Record<string, number>;
    splitSignature: (signature: string) => string[];
    variant: (signature: string, value: unknown) => { signature: string; value: unknown };
    marshal: (signature: string, values: unknown[]) => Buffer;
    encodeMessage: (message: Record<string, unknown>) => Buffer;
    messageLength: (buffer: Buffer) => number | null;
    decodeMessage: (buffer: Buffer) => Record<string, unknown> & { body: unknown[] };
    parseBusAddress: (address: unknown) => Array<{ path?: string; abstract?: string }>;
    sessionBusAddress: (env: Record<string, string | undefined>) => string | null;
    authExternalLine: (uid: number) => string;
};

const hex = (buffer: Buffer) => buffer.toString('hex');

describe('splitSignature', () => {
    it('splits into complete types, containers included', () => {
        expect(wire.splitSignature('sa{sv}as')).toEqual(['s', 'a{sv}', 'as']);
        expect(wire.splitSignature('a(yv)ox')).toEqual(['a(yv)', 'o', 'x']);
        expect(wire.splitSignature('')).toEqual([]);
    });

    it('refuses unknown or unclosed types', () => {
        expect(() => wire.splitSignature('z')).toThrow();
        expect(() => wire.splitSignature('(s')).toThrow();
        expect(() => wire.splitSignature('a')).toThrow();
    });
});

describe('marshal', () => {
    it('pads each value to its own alignment', () => {
        // y, then u at 4, then x at 8.
        expect(hex(wire.marshal('yux', [1, 2, 3n]))).toBe('01000000' + '02000000' + '0300000000000000');
        // b is four bytes; d is aligned to 8.
        expect(hex(wire.marshal('bd', [true, 1]))).toBe('01000000' + '00000000' + '000000000000f03f');
    });

    it('writes strings with a length and a NUL, signatures with a byte length', () => {
        expect(hex(wire.marshal('s', ['ab']))).toBe('02000000' + '616200');
        expect(hex(wire.marshal('g', ['as']))).toBe('02' + '617300');
        expect(hex(wire.marshal('s', ['晴']))).toBe('03000000' + 'e699b400');
    });

    it('does not count the padding before the first element in an array length', () => {
        // a{sv} with one entry "k" → variant u 7: length counts from the 8-aligned entry start.
        const bytes = wire.marshal('a{sv}', [[['k', wire.variant('u', 7)]]]);
        expect(hex(bytes)).toBe(
            '10000000' // length 16
            + '00000000' // pad to 8
            + '01000000' + '6b00' // "k"
            + '01' + '7500' // signature "u", ends at 17
            + '000000' // pad to 20
            + '07000000',
        );
    });

    it('takes a dict as pairs, a Map or a plain object', () => {
        const pairs = wire.marshal('a{su}', [[['a', 1], ['b', 2]]]);
        expect(wire.marshal('a{su}', [new Map([['a', 1], ['b', 2]])])).toEqual(pairs);
        expect(wire.marshal('a{su}', [{ a: 1, b: 2 }])).toEqual(pairs);
    });

    it('refuses NUL in a string and a variant of more than one type', () => {
        expect(() => wire.marshal('s', ['a\u0000b'])).toThrow();
        expect(() => wire.marshal('v', [wire.variant('ss', ['a', 'b'])])).toThrow();
        expect(() => wire.marshal('ss', ['a'])).toThrow();
    });
});

describe('encodeMessage / decodeMessage', () => {
    // GLib 编的 Hello：头字段的顺序和我们的不同（path、interface、destination、member），顺序本身不要紧。
    const GLIB_HELLO = '6c01000100000000010000006e00000001016f00150000002f6f72672f667265656465736b746f702f444275730000000201'
        + '7300140000006f72672e667265656465736b746f702e444275730000000006017300140000006f72672e667265656465736b746f702e44'
        + '42757300000000030173000500000048656c6c6f000000';
    // GLib 编的大端方法回应：reply_serial 2，body (u 1)。
    const GLIB_BIG_ENDIAN_REPLY = '420200010000000400000003000000100801670001750000050175000000000200000001';

    it('reads a message GLib wrote', () => {
        const hello = Buffer.from(GLIB_HELLO, 'hex');
        expect(wire.messageLength(hello)).toBe(hello.length);
        expect(wire.decodeMessage(hello)).toMatchObject({
            type: wire.MESSAGE_TYPE.methodCall,
            serial: 1,
            path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus',
            destination: 'org.freedesktop.DBus',
            member: 'Hello',
            body: [],
        });
    });

    it('encodes Hello with every header field and the header padded to 8', () => {
        const hello = wire.encodeMessage({
            type: wire.MESSAGE_TYPE.methodCall,
            serial: 1,
            destination: 'org.freedesktop.DBus',
            path: '/org/freedesktop/DBus',
            interface: 'org.freedesktop.DBus',
            member: 'Hello',
        });
        expect(hex(hello.subarray(0, 12))).toBe('6c0100010000000001000000');
        expect(hello.length % 8).toBe(0);
        expect(wire.decodeMessage(hello)).toMatchObject(wire.decodeMessage(Buffer.from(GLIB_HELLO, 'hex')));
    });

    it('round-trips a signal with a body, ints as BigInt', () => {
        const message = wire.encodeMessage({
            type: wire.MESSAGE_TYPE.signal,
            flags: 1,
            serial: 9,
            path: '/org/mpris/MediaPlayer2',
            interface: 'org.freedesktop.DBus.Properties',
            member: 'PropertiesChanged',
            signature: 'sa{sv}as',
            body: ['org.mpris.MediaPlayer2.Player', [
                ['PlaybackStatus', wire.variant('s', 'Playing')],
                ['Metadata', wire.variant('a{sv}', [
                    ['mpris:length', wire.variant('x', 269500000n)],
                    ['xesam:artist', wire.variant('as', ['A', 'B'])],
                ])],
            ], []],
        });
        expect(wire.messageLength(message)).toBe(message.length);
        const decoded = wire.decodeMessage(message);
        expect(decoded).toMatchObject({ type: 4, flags: 1, serial: 9, member: 'PropertiesChanged', signature: 'sa{sv}as' });
        expect(decoded.body).toEqual(['org.mpris.MediaPlayer2.Player', [
            ['PlaybackStatus', { signature: 's', value: 'Playing' }],
            ['Metadata', { signature: 'a{sv}', value: [
                ['mpris:length', { signature: 'x', value: 269500000n }],
                ['xesam:artist', { signature: 'as', value: ['A', 'B'] }],
            ] }],
        ], []]);
    });

    it('waits for the whole message and reads a big-endian peer', () => {
        const little = wire.encodeMessage({
            type: wire.MESSAGE_TYPE.methodReturn, serial: 3, replySerial: 2, signature: 'u', body: [1],
        });
        expect(wire.messageLength(little.subarray(0, 10))).toBeNull();
        const big = Buffer.from(GLIB_BIG_ENDIAN_REPLY, 'hex');
        expect(wire.messageLength(big)).toBe(big.length);
        expect(wire.decodeMessage(big)).toMatchObject({ type: 2, serial: 3, replySerial: 2, signature: 'u', body: [1] });
        expect(wire.decodeMessage(little)).toMatchObject({ type: 2, serial: 3, replySerial: 2, signature: 'u', body: [1] });
    });

    it('refuses an unknown byte order', () => {
        expect(() => wire.messageLength(Buffer.alloc(16, 0x41))).toThrow();
    });
});

describe('bus address and auth', () => {
    it('keeps the unix endpoints, unescaped, in order', () => {
        expect(wire.parseBusAddress('unix:path=/run/user/1000/bus')).toEqual([{ path: '/run/user/1000/bus' }]);
        expect(wire.parseBusAddress('tcp:host=x,port=1;unix:abstract=/tmp/dbus-AbC,guid=1;unix:path=/a%20b')).toEqual([
            { abstract: '/tmp/dbus-AbC' },
            { path: '/a b' },
        ]);
        expect(wire.parseBusAddress('unix:tmpdir=/tmp')).toEqual([]);
        expect(wire.parseBusAddress(undefined)).toEqual([]);
    });

    it('falls back to $XDG_RUNTIME_DIR/bus', () => {
        expect(wire.sessionBusAddress({ DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x' })).toBe('unix:path=/x');
        expect(wire.sessionBusAddress({ XDG_RUNTIME_DIR: '/run/user/1000' })).toBe('unix:path=/run/user/1000/bus');
        expect(wire.sessionBusAddress({})).toBeNull();
    });

    it('sends a NUL and the uid in hex for EXTERNAL', () => {
        expect(wire.authExternalLine(1000)).toBe('\u0000AUTH EXTERNAL 31303030\r\n');
    });
});
