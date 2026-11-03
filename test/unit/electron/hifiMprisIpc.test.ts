import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, promises as fsPromises, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 钉住 MPRIS 的 IPC 接入点：只认主窗口、推来的状态逐项校验（不合规的当作不活动）、封面只收图片字节或 http(s) 原址、
// 封面文件只留当前这首、晚到的上一首封面不写、写和清理排队做、http(s) 原址由主进程下载而不挂到总线上；按键和登记成没成推回主窗口，
// Raise 把窗口拿到前面。

const require = createRequire(import.meta.url);
const ipc = require('../../../electron/hifi/mpris/mprisIpc.cjs') as {
    STATE_CHANNEL: string;
    ARTWORK_CHANNEL: string;
    COMMAND_CHANNEL: string;
    STATUS_CHANNEL: string;
    validateMprisState: (value: unknown) => Record<string, unknown>;
    validateArtwork: (value: unknown) => Record<string, unknown> | null;
    fileUrl: (filePath: string) => string;
    registerMprisIpc: (options: Record<string, unknown>) => { dispose: () => void };
    createArtworkFiles: (options: Record<string, unknown>) => {
        write: (image: { bytes: Buffer; extension: string }) => Promise<string>;
        clear: () => Promise<void>;
    };
};

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

const validState = (overrides: Record<string, unknown> = {}) => ({
    active: true,
    trackKey: 'local:1#a',
    title: '晴天',
    artists: ['周杰伦'],
    album: '叶惠美',
    durationSec: 269.5,
    status: 'Playing',
    positionSec: 10,
    atMs: 1000,
    seeked: false,
    ...overrides,
});

describe('validateMprisState', () => {
    it('keeps a valid state and cleans its text for D-Bus', () => {
        expect(ipc.validateMprisState(validState({ title: 'a\u0000b\nc', artists: ['x', '', 7, 'y'], durationSec: 0 }))).toEqual({
            ...validState(),
            title: 'a b c',
            artists: ['x', 'y'],
            durationSec: null,
        });
    });

    it('treats anything malformed as inactive', () => {
        for (const bad of [
            null,
            'x',
            { active: 'yes' },
            validState({ trackKey: '' }),
            validState({ trackKey: 'a\u0000' }),
            validState({ status: 'Buffering' }),
            validState({ positionSec: Number.NaN }),
            validState({ atMs: undefined }),
        ]) {
            expect(ipc.validateMprisState(bad)).toEqual({ active: false });
        }
    });
});

describe('validateArtwork', () => {
    it('takes image bytes of a known type, or an http(s) address', () => {
        expect(ipc.validateArtwork({ bytes: new Uint8Array(PNG), mimeType: 'image/png' })).toMatchObject({ extension: 'png' });
        expect(ipc.validateArtwork({ url: 'https://nd.example/rest/getCoverArt?id=1' })).toEqual({ url: 'https://nd.example/rest/getCoverArt?id=1' });
    });

    it('refuses other types, empty bytes and other schemes', () => {
        expect(ipc.validateArtwork({ bytes: new Uint8Array(PNG), mimeType: 'image/svg+xml' })).toBeNull();
        expect(ipc.validateArtwork({ bytes: new Uint8Array(0), mimeType: 'image/png' })).toBeNull();
        expect(ipc.validateArtwork({ url: 'file:///etc/passwd' })).toBeNull();
        expect(ipc.validateArtwork({ url: 'blob:x' })).toBeNull();
        expect(ipc.validateArtwork(null)).toBeNull();
    });
});

describe('fileUrl', () => {
    it('escapes each path segment', () => {
        expect(ipc.fileUrl('/home/a b/封面.png')).toBe('file:///home/a%20b/%E5%B0%81%E9%9D%A2.png');
    });
});

describe('registerMprisIpc', () => {
    let dir: string;
    let handlers: Record<string, (event: unknown, ...args: unknown[]) => unknown>;
    let sent: Array<[string, unknown]>;
    let window: Record<string, unknown>;
    let trusted: boolean;
    let connection: ReturnType<typeof fakeConnection>;
    let fetchArtwork: ReturnType<typeof vi.fn>;

    const fakeConnection = () => {
        let handler: ((message: Record<string, unknown>) => unknown) | null = null;
        const signals: Array<{ body: unknown[] }> = [];
        return {
            signals,
            uniqueName: ':1.1',
            call: vi.fn(async ({ member }: { member: string }) => ({ signature: 'u', body: [member === 'RequestName' ? 1 : 1] })),
            emitSignal: (signal: { body: unknown[] }) => { signals.push(signal); },
            onMethodCall: (next: typeof handler) => { handler = next; },
            onClose: () => {},
            isClosed: () => false,
            close: vi.fn(),
            invoke: (iface: string, member: string, signature = '', body: unknown[] = []) => handler!({ path: '/org/mpris/MediaPlayer2', interface: iface, member, signature, body }),
        };
    };

    const flush = async () => {
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
    };

    beforeEach(() => {
        vi.spyOn(console, 'info').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        dir = mkdtempSync(path.join(os.tmpdir(), 'folia-mpris-'));
        handlers = {};
        sent = [];
        trusted = true;
        connection = fakeConnection();
        fetchArtwork = vi.fn(async () => ({ bytes: Buffer.from([...PNG, 9]), extension: 'png' }));
        window = {
            isDestroyed: () => false,
            isMinimized: () => true,
            restore: vi.fn(),
            show: vi.fn(),
            focus: vi.fn(),
            webContents: { isDestroyed: () => false, send: (channel: string, payload: unknown) => sent.push([channel, payload]) },
        };
        ipc.registerMprisIpc({
            ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers[channel] = handler; } },
            isTrustedSender: () => trusted,
            getMainWindow: () => window,
            getArtworkDirectory: () => path.join(dir, 'mpris-artwork'),
            env: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/nowhere' },
            uid: 1000,
            connect: async () => connection,
            fetchArtwork,
        });
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('registers its two channels and refuses other windows', async () => {
        expect(Object.keys(handlers).sort()).toEqual([ipc.ARTWORK_CHANNEL, ipc.STATE_CHANNEL].sort());
        trusted = false;
        expect(() => handlers[ipc.STATE_CHANNEL]({}, validState())).toThrow(/Untrusted/);
        await flush();
        expect(connection.call).not.toHaveBeenCalled();
    });

    it('relays media keys to the main window and raises it', async () => {
        await handlers[ipc.STATE_CHANNEL]({}, validState());
        await flush();
        await connection.invoke('org.mpris.MediaPlayer2.Player', 'PlayPause');
        await connection.invoke('org.mpris.MediaPlayer2', 'Raise');
        expect(sent.filter(([channel]) => channel === ipc.COMMAND_CHANNEL)).toEqual([[ipc.COMMAND_CHANNEL, 'playpause']]);
        expect(window.restore).toHaveBeenCalled();
        expect(window.show).toHaveBeenCalled();
        expect(window.focus).toHaveBeenCalled();
    });

    it('writes the cover of the current track, private to the user, keeping only the latest', async () => {
        await handlers[ipc.STATE_CHANNEL]({}, validState());
        await flush();
        await handlers[ipc.ARTWORK_CHANNEL]({}, 'local:1#a', { bytes: new Uint8Array(PNG), mimeType: 'image/png' });
        await flush();
        const artworkDir = path.join(dir, 'mpris-artwork');
        const [first] = readdirSync(artworkDir);
        expect(first).toMatch(/^cover-[0-9a-f]{40}\.png$/);
        expect(readFileSync(path.join(artworkDir, first))).toEqual(PNG);
        // Windows has no unix permission bits; MPRIS only runs on Linux.
        if (process.platform !== 'win32') expect(statSync(path.join(artworkDir, first)).mode & 0o777).toBe(0o600);
        const metadata = (await connection.invoke('org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.mpris.MediaPlayer2.Player', 'Metadata'])) as {
            body: [{ value: Array<[string, { value: unknown }]> }];
        };
        expect(Object.fromEntries(metadata.body[0].value.map(([key, value]) => [key, value.value]))['mpris:artUrl'])
            .toBe(ipc.fileUrl(path.join(artworkDir, first)));

        await handlers[ipc.STATE_CHANNEL]({}, validState({ trackKey: 'local:2#b' }));
        // A late cover of the previous track is dropped.
        await handlers[ipc.ARTWORK_CHANNEL]({}, 'local:1#a', { bytes: new Uint8Array([...PNG, 0]), mimeType: 'image/png' });
        expect(readdirSync(artworkDir)).toEqual([first]);
        await handlers[ipc.ARTWORK_CHANNEL]({}, 'local:2#b', { bytes: new Uint8Array([...PNG, 1]), mimeType: 'image/png' });
        const files = readdirSync(artworkDir);
        expect(files).toHaveLength(1);
        expect(files[0]).not.toBe(first);

        await handlers[ipc.STATE_CHANNEL]({}, { active: false });
        await flush();
        await new Promise(resolve => setTimeout(resolve, 20));
        expect(existsSync(artworkDir) ? readdirSync(artworkDir) : []).toEqual([]);
    });

    it('tells the main window whether MPRIS is registered while HiFi plays', async () => {
        await handlers[ipc.STATE_CHANNEL]({}, validState());
        await flush();
        expect(sent).toContainEqual([ipc.STATUS_CHANNEL, { registered: true }]);
    });

    it('downloads an http(s) cover in main and never puts the address on the bus', async () => {
        const address = 'https://nd.example/rest/getCoverArt?id=1&u=me&t=secret&s=salt';
        await handlers[ipc.STATE_CHANNEL]({}, validState());
        await flush();
        await handlers[ipc.ARTWORK_CHANNEL]({}, 'local:1#a', { url: address });
        await flush();
        expect(fetchArtwork).toHaveBeenCalledWith(address);
        const metadata = (await connection.invoke('org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.mpris.MediaPlayer2.Player', 'Metadata'])) as {
            body: [{ value: Array<[string, { value: unknown }]> }];
        };
        const artUrl = Object.fromEntries(metadata.body[0].value.map(([key, value]) => [key, value.value]))['mpris:artUrl'] as string;
        expect(artUrl).toMatch(/^file:\/\//);
        expect(String(metadata.body[0].value.map(([, value]) => value.value))).not.toContain('secret');

        // A download that fails leaves no cover rather than the address.
        fetchArtwork.mockResolvedValueOnce(null);
        await handlers[ipc.ARTWORK_CHANNEL]({}, 'local:1#a', { url: address });
        const after = (await connection.invoke('org.freedesktop.DBus.Properties', 'Get', 'ss', ['org.mpris.MediaPlayer2.Player', 'Metadata'])) as {
            body: [{ value: Array<[string, { value: unknown }]> }];
        };
        expect(String(after.body[0].value.map(([, value]) => value.value))).not.toContain('nd.example');
    });
});

describe('createArtworkFiles', () => {
    it('runs writes and clears one after another, so a slower write never deletes the newer cover', async () => {
        const dir = mkdtempSync(path.join(os.tmpdir(), 'folia-mpris-files-'));
        try {
            let releaseFirst: () => void = () => {};
            const firstWritten = new Promise<void>(resolve => { releaseFirst = resolve; });
            let writes = 0;
            const fsImpl = {
                ...fsPromises,
                writeFile: async (...args: Parameters<typeof fsPromises.writeFile>) => {
                    writes += 1;
                    if (writes === 1) await firstWritten;
                    return fsPromises.writeFile(...args);
                },
            };
            const files = ipc.createArtworkFiles({ getDirectory: () => dir, fsImpl });
            const first = files.write({ bytes: Buffer.from([...PNG, 1]), extension: 'png' });
            const second = files.write({ bytes: Buffer.from([...PNG, 2]), extension: 'png' });
            releaseFirst();
            await first;
            const latest = await second;
            expect(readdirSync(dir)).toEqual([path.basename(latest)]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
