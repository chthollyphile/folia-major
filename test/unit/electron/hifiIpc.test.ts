import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HifiLoadRequest, HifiReadResponse } from '../../../src/types/hifi';

// 钉住 HiFi 的 IPC 层：通道全集、只认主窗口、载荷校验、读请求按源的所属页面路由并只收那个页面的回应、10 秒超时。

type Handler = (event: unknown, ...args: unknown[]) => unknown;
type InstallOutcome = { ok: boolean; errorCode: string | null; version: string | null; executablePath: string | null };

const require = createRequire(import.meta.url);
const {
    INVOKE_CHANNELS,
    READ_RESULT_CHANNEL,
    registerHifiIpc,
    validateLoadRequest,
    validateEngineConfig,
    resolvePickedRuntimePath,
    isAllowedRuntimePath,
} = require('../../../electron/hifi/hifiIpc.cjs') as {
    INVOKE_CHANNELS: readonly string[];
    READ_RESULT_CHANNEL: string;
    registerHifiIpc: (options: Record<string, unknown>) => {
        requestRead: (ownerId: number | null, request: { sourceKey: string; offset: number; length: number }) => Promise<HifiReadResponse>;
        resolveRuntime: () => Promise<{ path: string; version: string | null } | null>;
        broadcastState: (state: unknown) => void;
        broadcastClock: (update: unknown) => void;
        broadcastError: (event: unknown) => void;
        broadcastInstallProgress: (progress: unknown) => void;
    };
    validateLoadRequest: (request: unknown) => HifiLoadRequest | null;
    validateEngineConfig: (config: unknown) => Record<string, unknown> | null;
    resolvePickedRuntimePath: (picked: string, platform: string) => string;
    isAllowedRuntimePath: (value: unknown, platform: string) => boolean;
};

// Linux 的 MPRIS 另在 electron/hifi/mpris/mprisIpc.cjs 登记，preload 也挂在 window.electron.hifi 下。
const { STATE_CHANNEL: MPRIS_STATE_CHANNEL, ARTWORK_CHANNEL: MPRIS_ARTWORK_CHANNEL } = require('../../../electron/hifi/mpris/mprisIpc.cjs') as {
    STATE_CHANNEL: string;
    ARTWORK_CHANNEL: string;
};

class FakeContents extends EventEmitter {
    sent: Array<[string, unknown]> = [];
    destroyed = false;

    constructor(public id: number) {
        super();
    }

    send(channel: string, payload: unknown) {
        this.sent.push([channel, payload]);
    }

    isDestroyed() {
        return this.destroyed;
    }

    destroy() {
        this.destroyed = true;
        this.emit('destroyed');
    }
}

const createWindow = (id: number) => {
    const webContents = new FakeContents(id);
    return { webContents, destroyed: false, isDestroyed() { return this.destroyed; } };
};

const status = (overrides: Record<string, unknown> = {}) => ({
    available: true,
    path: '/usr/bin/mpv',
    version: '0.41.0',
    source: 'system',
    errorCode: null,
    manualPathRejected: false,
    platform: 'linux',
    arch: 'x64',
    download: { supported: false, version: null, installedVersion: null, updateAvailable: false, installing: false },
    dopCapable: false,
    ...overrides,
});

const validRequest = (overrides: Record<string, unknown> = {}) => ({
    trackKey: 'local:abc#f00d',
    songKey: 'local:abc',
    source: { kind: 'local', sourceKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', size: 1234, mimeType: 'audio/flac', fileName: 'Song.flac' },
    startSec: 0,
    paused: true,
    loopFile: false,
    ...overrides,
});

const validConfig = (overrides: Record<string, unknown> = {}) => ({
    mpvPath: null,
    audioDevice: 'auto',
    exclusive: true,
    dsdMode: 'pcm',
    softwareVolume: false,
    volume: 100,
    muted: false,
    ...overrides,
});

type HarnessOptions = Record<string, unknown> & { approvedPath?: unknown };

const createHarness = ({ approvedPath = null, ...overrides }: HarnessOptions = {}) => {
    const handlers = new Map<string, Handler>();
    // 主进程的 electron-store 里那一项。
    const approval = { value: approvedPath as unknown };
    const getApprovedMpvPath = vi.fn(() => approval.value);
    const setApprovedMpvPath = vi.fn((value: unknown) => {
        approval.value = value;
    });
    const logWarn = vi.fn();
    const ipcMain = { handle: vi.fn((channel: string, handler: Handler) => handlers.set(channel, handler)) };
    let mainWindow: ReturnType<typeof createWindow> | null = createWindow(1);
    const contents = new Map<number, FakeContents>();
    const register = (item: FakeContents) => contents.set(item.id, item);
    register(mainWindow.webContents);
    let cached: ReturnType<typeof status> | null = null;
    const runtime = {
        detect: vi.fn(async ({ manualPath }: { manualPath: string | null }) => {
            cached = status({ path: manualPath ?? '/usr/bin/mpv' });
            return cached;
        }),
        getCachedStatus: vi.fn(() => cached),
    };
    const session = {
        configure: vi.fn(async () => {}),
        listDevices: vi.fn(async () => [{ name: 'auto', description: 'Autoselect device', driver: 'auto', direct: false }]),
        load: vi.fn(async () => ({ ok: true, state: { status: 'paused' } })),
        play: vi.fn(async () => {}),
        pause: vi.fn(async () => {}),
        seek: vi.fn(async () => {}),
        stop: vi.fn(async () => {}),
        setLoopFile: vi.fn(async () => {}),
        preloadNext: vi.fn(async () => true),
        clearNext: vi.fn(async () => {}),
        getSnapshot: vi.fn(() => ({ status: 'idle', seq: 3 })),
    };
    const installer = {
        install: vi.fn(async (): Promise<InstallOutcome> => ({ ok: true, errorCode: null, version: '0.41.0', executablePath: '/data/mpv' })),
        cancel: vi.fn(),
    };
    const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/opt/mpv/bin/mpv'] })) };
    const outputProbe = { probe: vi.fn(async (): Promise<unknown> => ({ backend: 'pipewire', at: 1 })) };
    const onRuntimeChanged = vi.fn();
    let readCounter = 0;
    const api = registerHifiIpc({
        ipcMain,
        isTrustedSender: (event: { sender: { id: number } }) => Boolean(mainWindow && event.sender.id === mainWindow.webContents.id),
        session,
        runtime,
        installer,
        outputProbe,
        dialog,
        getMainWindow: () => mainWindow,
        webContentsFromId: (id: number) => contents.get(id),
        onRuntimeChanged,
        getApprovedMpvPath,
        setApprovedMpvPath,
        platform: 'linux',
        randomUUID: () => `read-${++readCounter}-0000-0000-0000-000000000000`,
        logInfo: () => {},
        logWarn,
        ...overrides,
    });
    const invokeAs = (senderId: number, channel: string, ...args: unknown[]) => {
        const handler = handlers.get(channel);
        if (!handler) throw new Error(`no handler for ${channel}`);
        return handler({ sender: { id: senderId } }, ...args);
    };
    return {
        api,
        handlers,
        session,
        runtime,
        installer,
        outputProbe,
        dialog,
        onRuntimeChanged,
        approval,
        setApprovedMpvPath,
        logWarn,
        contents,
        register,
        invoke: (channel: string, ...args: unknown[]) => invokeAs(1, channel, ...args),
        invokeAs,
        getMainWindow: () => mainWindow,
        setMainWindow: (win: ReturnType<typeof createWindow> | null) => {
            mainWindow = win;
            if (win) register(win.webContents);
        },
    };
};

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('hifi ipc: channels and trust', () => {
    it('registers exactly the HiFi channels', () => {
        const harness = createHarness();
        expect([...harness.handlers.keys()].sort()).toEqual([...INVOKE_CHANNELS, READ_RESULT_CHANNEL].sort());
        expect(INVOKE_CHANNELS).toEqual([
            'hifi:get-runtime-status',
            'hifi:detect-runtime',
            'hifi:pick-runtime-path',
            'hifi:install-runtime',
            'hifi:cancel-install',
            'hifi:configure',
            'hifi:list-devices',
            'hifi:load',
            'hifi:play',
            'hifi:pause',
            'hifi:seek',
            'hifi:stop',
            'hifi:set-loop-file',
            'hifi:preload-next',
            'hifi:clear-next',
            'hifi:get-snapshot',
            'hifi:probe-output',
        ]);
    });

    it('an untrusted sender gets null from the three getters and an exception everywhere else, and nothing runs', async () => {
        const harness = createHarness();
        await expect(Promise.resolve(harness.invokeAs(99, 'hifi:get-runtime-status'))).resolves.toBeNull();
        await expect(Promise.resolve(harness.invokeAs(99, 'hifi:get-snapshot'))).resolves.toBeNull();
        await expect(Promise.resolve(harness.invokeAs(99, 'hifi:probe-output'))).resolves.toBeNull();
        expect(harness.outputProbe.probe).not.toHaveBeenCalled();
        const args: Record<string, unknown[]> = {
            'hifi:configure': [validConfig()],
            'hifi:load': [validRequest()],
            'hifi:seek': [3],
            'hifi:set-loop-file': [true],
            'hifi:preload-next': [validRequest()],
        };
        for (const channel of INVOKE_CHANNELS) {
            if (channel === 'hifi:get-runtime-status' || channel === 'hifi:get-snapshot' || channel === 'hifi:probe-output') continue;
            expect(() => harness.invokeAs(99, channel, ...(args[channel] ?? [])), channel).toThrow(/Untrusted renderer/);
        }
        for (const method of Object.values(harness.session)) expect(method).not.toHaveBeenCalled();
        expect(harness.runtime.detect).not.toHaveBeenCalled();
        expect(harness.installer.install).not.toHaveBeenCalled();
        expect(harness.dialog.showOpenDialog).not.toHaveBeenCalled();
    });

    it('trusted calls reach the session; load and preload carry the sender as owner', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:load', validRequest())).resolves.toMatchObject({ ok: true });
        expect(harness.session.load).toHaveBeenCalledWith(validRequest(), { ownerId: 1 });
        await expect(harness.invoke('hifi:preload-next', validRequest())).resolves.toBe(true);
        expect(harness.session.preloadNext).toHaveBeenCalledWith(validRequest(), { ownerId: 1 });
        await expect(harness.invoke('hifi:play')).resolves.toBeUndefined();
        await harness.invoke('hifi:pause');
        await harness.invoke('hifi:seek', 12.5);
        await harness.invoke('hifi:stop');
        await harness.invoke('hifi:set-loop-file', true);
        await harness.invoke('hifi:clear-next');
        expect(harness.session.seek).toHaveBeenCalledWith(12.5);
        expect(harness.session.setLoopFile).toHaveBeenCalledWith(true);
        for (const method of ['play', 'pause', 'stop', 'clearNext'] as const) expect(harness.session[method]).toHaveBeenCalledTimes(1);
        await expect(Promise.resolve(harness.invoke('hifi:get-snapshot'))).resolves.toEqual({ status: 'idle', seq: 3 });
        await expect(harness.invoke('hifi:list-devices')).resolves.toHaveLength(1);
    });

    it('probe-output hands back what the PipeWire probe read, on Linux only', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:probe-output')).resolves.toEqual({ backend: 'pipewire', at: 1 });
        expect(harness.outputProbe.probe).toHaveBeenCalledTimes(1);
        // 渲染端传什么都不交给探测器：流名由主进程定。
        await harness.invoke('hifi:probe-output', { streamName: 'evil' });
        expect(harness.outputProbe.probe).toHaveBeenLastCalledWith();

        harness.outputProbe.probe.mockResolvedValueOnce(null);
        await expect(harness.invoke('hifi:probe-output')).resolves.toBeNull();

        for (const platform of ['win32', 'darwin']) {
            const other = createHarness({ platform });
            await expect(other.invoke('hifi:probe-output'), platform).resolves.toBeNull();
            expect(other.outputProbe.probe, platform).not.toHaveBeenCalled();
        }
        const withoutProbe = createHarness({ outputProbe: null });
        await expect(withoutProbe.invoke('hifi:probe-output')).resolves.toBeNull();
    });

    it('probe-output answers null and logs when the probe throws', async () => {
        const harness = createHarness();
        harness.outputProbe.probe.mockRejectedValueOnce(new Error('boom'));
        await expect(harness.invoke('hifi:probe-output')).resolves.toBeNull();
        expect(harness.logWarn).toHaveBeenCalledWith('[HiFi] could not probe the PipeWire output', expect.any(Error));
    });

    it('list-devices answers [] when mpv cannot be started', async () => {
        const harness = createHarness();
        harness.session.listDevices.mockRejectedValueOnce(new Error('MPV_NOT_FOUND'));
        await expect(harness.invoke('hifi:list-devices')).resolves.toEqual([]);
    });
});

describe('hifi ipc: payload validation', () => {
    it('accepts a valid local and navidrome request, keeping only known fields', () => {
        expect(validateLoadRequest({ ...validRequest(), extra: 1 })).toEqual(validRequest());
        const navidrome = validRequest({
            trackKey: 'navidrome:tr-1#9a',
            songKey: 'navidrome:tr-1',
            source: { kind: 'navidrome', url: 'https://music.example.com/rest/stream?id=1&u=me&t=x&s=y&format=raw', fileName: 'a.flac' },
        });
        expect(validateLoadRequest(navidrome)).toEqual(navidrome);
    });

    it('rejects malformed requests', () => {
        const bad: unknown[] = [
            null,
            'load',
            validRequest({ trackKey: '' }),
            validRequest({ trackKey: 'a\nb' }),
            validRequest({ songKey: 'x'.repeat(257) }),
            validRequest({ startSec: Number.NaN }),
            validRequest({ startSec: -1 }),
            validRequest({ startSec: Number.POSITIVE_INFINITY }),
            validRequest({ paused: 'yes' }),
            validRequest({ loopFile: undefined }),
            validRequest({ source: { kind: 'local', sourceKey: '../etc', size: 1, mimeType: '', fileName: '' } }),
            validRequest({ source: { kind: 'local', sourceKey: 'k'.repeat(257), size: 1, mimeType: '', fileName: '' } }),
            validRequest({ source: { kind: 'local', sourceKey: 'abc', size: -1, mimeType: '', fileName: '' } }),
            validRequest({ source: { kind: 'local', sourceKey: 'abc', size: 1.5, mimeType: '', fileName: '' } }),
            validRequest({ source: { kind: 'local', sourceKey: 'abc', size: 1, mimeType: 'x'.repeat(4097), fileName: '' } }),
            validRequest({ source: { kind: 'navidrome', url: 'file:///etc/passwd', fileName: 'a' } }),
            validRequest({ source: { kind: 'navidrome', url: 'ftp://host/a', fileName: 'a' } }),
            validRequest({ source: { kind: 'navidrome', url: `https://h/${'a'.repeat(4096)}`, fileName: 'a' } }),
            validRequest({ source: { kind: 'online', url: 'https://h/a', fileName: 'a' } }),
        ];
        for (const request of bad) expect(validateLoadRequest(request), JSON.stringify(request)?.slice(0, 80)).toBeNull();
    });

    it('invalid load answers INVALID_REQUEST, invalid preload answers false, and neither reaches the session', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:load', validRequest({ startSec: 'soon' }))).resolves.toEqual({ ok: false, errorCode: 'INVALID_REQUEST' });
        await expect(harness.invoke('hifi:preload-next', { trackKey: 'x' })).resolves.toBe(false);
        expect(harness.session.load).not.toHaveBeenCalled();
        expect(harness.session.preloadNext).not.toHaveBeenCalled();
    });

    it('void calls throw INVALID_REQUEST on a bad payload', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:seek', Number.NaN)).rejects.toThrow(/INVALID_REQUEST/);
        await expect(harness.invoke('hifi:seek', -2)).rejects.toThrow(/INVALID_REQUEST/);
        await expect(harness.invoke('hifi:set-loop-file', 'inf')).rejects.toThrow(/INVALID_REQUEST/);
        await expect(harness.invoke('hifi:configure', validConfig({ volume: 101 }))).rejects.toThrow(/INVALID_REQUEST/);
        await expect(harness.invoke('hifi:configure', validConfig({ dsdMode: 'native' }))).rejects.toThrow(/INVALID_REQUEST/);
        expect(harness.session.seek).not.toHaveBeenCalled();
        expect(harness.session.setLoopFile).not.toHaveBeenCalled();
        expect(harness.session.configure).not.toHaveBeenCalled();
    });

    it('validates the engine config', () => {
        expect(validateEngineConfig(validConfig())).toEqual(validConfig());
        expect(validateEngineConfig(validConfig({ mpvPath: '   ' }))).toEqual(validConfig({ mpvPath: null }));
        for (const config of [
            validConfig({ mpvPath: 42 }),
            validConfig({ mpvPath: '/bin/mpv\u0000' }),
            validConfig({ audioDevice: 3 }),
            validConfig({ exclusive: 'yes' }),
            validConfig({ softwareVolume: 1 }),
            validConfig({ volume: Number.NaN }),
            validConfig({ volume: -1 }),
            validConfig({ muted: 'yes' }),
            validConfig({ muted: undefined }),
            [],
        ]) {
            expect(validateEngineConfig(config)).toBeNull();
        }
    });

    it('a device name mpv would never list becomes auto before it reaches the session; the rest of the config still applies', async () => {
        // ALSA 的 file 插件把 | 开头的文件名交给 shell 执行：主窗口里被注入的脚本不能借设备名跑命令。
        const hostile = 'alsa/file:|touch /tmp/x,raw';
        expect(validateEngineConfig(validConfig({ audioDevice: hostile, volume: 40 }))).toEqual(validConfig({ audioDevice: 'auto', volume: 40 }));
        for (const audioDevice of ['alsa/tee:hw,/tmp/x', 'pulse/$(id)', 'pipewire/a`b`', 'wasapi/"x"', 'x;y']) {
            expect(validateEngineConfig(validConfig({ audioDevice }))?.audioDevice, audioDevice).toBe('auto');
        }
        expect(validateEngineConfig(validConfig({ audioDevice: 'alsa/hw:CARD=D10,DEV=0' }))?.audioDevice).toBe('alsa/hw:CARD=D10,DEV=0');
        expect(validateEngineConfig(validConfig({ audioDevice: 'wasapi/{0.0.0.00000000}.{guid}' }))?.audioDevice).toBe('wasapi/{0.0.0.00000000}.{guid}');

        const harness = createHarness();
        await harness.invoke('hifi:configure', validConfig({ audioDevice: hostile, softwareVolume: true, volume: 40 }));
        expect(harness.session.configure).toHaveBeenLastCalledWith(validConfig({ audioDevice: 'auto', softwareVolume: true, volume: 40 }));
        expect(JSON.stringify(harness.session.configure.mock.calls)).not.toContain('|');
        expect(harness.logWarn).toHaveBeenCalledWith(expect.stringMatching(/^\[HiFi\] ignoring an audio device name mpv would not list/));
        // 音量一变渲染端就重发设置：同一个名字只记一次。
        await harness.invoke('hifi:configure', validConfig({ audioDevice: hostile, softwareVolume: true, volume: 41 }));
        const ignoredLines = () => harness.logWarn.mock.calls.filter(([line]) => String(line).includes('ignoring an audio device name'));
        expect(ignoredLines()).toHaveLength(1);
        await harness.invoke('hifi:configure', validConfig());
        await harness.invoke('hifi:configure', validConfig({ audioDevice: hostile }));
        expect(ignoredLines()).toHaveLength(2);
    });

    it('passes the app\'s mute through to the session, whatever software volume says', async () => {
        const harness = createHarness();
        await harness.invoke('hifi:configure', validConfig({ muted: true }));
        expect(harness.session.configure).toHaveBeenLastCalledWith(validConfig({ muted: true }));
        expect(validateEngineConfig(validConfig({ muted: true, softwareVolume: true, volume: 40 })))
            .toEqual(validConfig({ muted: true, softwareVolume: true, volume: 40 }));
        // 没带 muted 的旧载荷不猜：整条拒掉。
        const { muted: _muted, ...withoutMuted } = validConfig();
        await expect(harness.invoke('hifi:configure', withoutMuted)).rejects.toThrow(/INVALID_REQUEST/);
        expect(harness.session.configure).toHaveBeenCalledTimes(1);
    });
});

describe('hifi ipc: the manual mpv path', () => {
    it('configure uses a path only when it is the one picked in the file dialog; detection re-runs when it changes', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:pick-runtime-path')).resolves.toBe('/opt/mpv/bin/mpv');
        expect(harness.setApprovedMpvPath).toHaveBeenLastCalledWith('/opt/mpv/bin/mpv');
        // 选完还没 configure：检测仍按之前的（没有手动路径）。
        expect(harness.runtime.detect).not.toHaveBeenCalled();

        await harness.invoke('hifi:configure', validConfig({ mpvPath: '/opt/mpv/bin/mpv' }));
        expect(harness.session.configure).toHaveBeenCalledWith(validConfig({ mpvPath: '/opt/mpv/bin/mpv' }));
        // 实际用的路径变了：configure 当场重测。
        expect(harness.runtime.detect).toHaveBeenCalledTimes(1);
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: '/opt/mpv/bin/mpv' });
        // 缓存是按同一个路径测的：直接用。
        await expect(harness.invoke('hifi:get-runtime-status')).resolves.toMatchObject({ path: '/opt/mpv/bin/mpv' });
        await harness.invoke('hifi:configure', validConfig({ mpvPath: '/opt/mpv/bin/mpv', volume: 40 }));
        expect(harness.runtime.detect).toHaveBeenCalledTimes(1);
        await expect(harness.api.resolveRuntime()).resolves.toEqual({ path: '/opt/mpv/bin/mpv', version: '0.41.0' });
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: '/opt/mpv/bin/mpv' });
    });

    it('a path the dialog never returned is ignored with a warning, detection runs without it, and the approval stays', async () => {
        const harness = createHarness({ approvedPath: '/opt/mpv/bin/mpv' });
        await harness.invoke('hifi:configure', validConfig({ mpvPath: '/tmp/evil' }));
        expect(harness.session.configure).toHaveBeenLastCalledWith(validConfig({ mpvPath: null }));
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: null });
        expect(harness.runtime.detect.mock.calls.every(([options]) => options.manualPath !== '/tmp/evil')).toBe(true);
        expect(harness.logWarn).toHaveBeenCalledWith(expect.stringMatching(/^\[HiFi\] ignoring an mpv path .*\/tmp\/evil/));
        expect(harness.setApprovedMpvPath).not.toHaveBeenCalled();
        expect(harness.approval.value).toBe('/opt/mpv/bin/mpv');
        await expect(harness.api.resolveRuntime()).resolves.toEqual({ path: '/usr/bin/mpv', version: '0.41.0' });

        // 之后传回已批准的那个，照用。
        await harness.invoke('hifi:configure', validConfig({ mpvPath: '/opt/mpv/bin/mpv' }));
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: '/opt/mpv/bin/mpv' });
    });

    it('configure with mpvPath null clears the stored approval and detects without a manual path', async () => {
        const harness = createHarness({ approvedPath: '/opt/mpv/bin/mpv' });
        await harness.invoke('hifi:configure', validConfig({ mpvPath: null }));
        expect(harness.setApprovedMpvPath).toHaveBeenCalledWith(null);
        expect(harness.approval.value).toBeNull();
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: null });
        // 批准没了：同一个路径再传回来也不用。
        await harness.invoke('hifi:configure', validConfig({ mpvPath: '/opt/mpv/bin/mpv' }));
        await harness.api.resolveRuntime();
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: null });
    });

    it('the stored approval is used from startup, before the renderer has configured anything', async () => {
        const harness = createHarness({ approvedPath: '/opt/mpv/bin/mpv' });
        await expect(harness.invoke('hifi:get-runtime-status')).resolves.toMatchObject({ path: '/opt/mpv/bin/mpv' });
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: '/opt/mpv/bin/mpv' });
        // 渲染端随后推来同一个路径：没变，不重测。
        await harness.invoke('hifi:configure', validConfig({ mpvPath: '/opt/mpv/bin/mpv' }));
        expect(harness.runtime.detect).toHaveBeenCalledTimes(1);
    });

    it('a stored value that is not a usable path counts as no approval', async () => {
        for (const stored of [42, '', 'mpv', 'relative/mpv', '/bin/mpv\u0007']) {
            const harness = createHarness({ approvedPath: stored });
            await harness.invoke('hifi:get-runtime-status');
            expect(harness.runtime.detect, String(stored)).toHaveBeenLastCalledWith({ manualPath: null });
        }
        const harness = createHarness({ getApprovedMpvPath: () => { throw new Error('store is broken'); } });
        await harness.invoke('hifi:get-runtime-status');
        expect(harness.runtime.detect).toHaveBeenLastCalledWith({ manualPath: null });
    });

    it('overlapping implicit detections of one path share a probe; an install gets a probe of its own', async () => {
        const harness = createHarness();
        let finish: () => void = () => {};
        harness.runtime.detect.mockImplementationOnce(() => new Promise(resolve => {
            finish = () => resolve(status({ version: '0.40.0' }));
        }));
        const first = harness.invoke('hifi:get-runtime-status');
        const second = harness.api.resolveRuntime();
        expect(harness.runtime.detect).toHaveBeenCalledTimes(1);
        // 装完时那次旧探测还没回来：装完要的是一次新的。
        const installed = harness.invoke('hifi:install-runtime');
        for (let round = 0; round < 10; round += 1) await Promise.resolve();
        expect(harness.runtime.detect).toHaveBeenCalledTimes(2);
        finish();
        await expect(first).resolves.toMatchObject({ version: '0.40.0' });
        await expect(second).resolves.toEqual({ path: '/usr/bin/mpv', version: '0.40.0' });
        await expect(installed).resolves.toMatchObject({ ok: true, status: { version: '0.41.0' } });
    });

    it('Windows: a path on a network share is refused both from the dialog and from a stored approval', async () => {
        const unc = '\\\\server\\share\\mpv.exe';
        const picker = createHarness({ platform: 'win32' });
        for (const picked of [unc, '\\\\?\\UNC\\server\\share\\mpv.exe', '//server/share/mpv.exe', '\\\\.\\UNC\\server\\share\\mpv.exe']) {
            picker.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [picked] });
            await expect(picker.invoke('hifi:pick-runtime-path'), picked).resolves.toBeNull();
        }
        expect(picker.setApprovedMpvPath).not.toHaveBeenCalled();
        picker.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['C:\\Program Files\\mpv\\mpv.exe'] });
        await expect(picker.invoke('hifi:pick-runtime-path')).resolves.toBe('C:\\Program Files\\mpv\\mpv.exe');

        // 旧版本存下的 UNC 批准也不认，configure 传回同一个值也不用。
        const stored = createHarness({ platform: 'win32', approvedPath: unc });
        await stored.invoke('hifi:configure', validConfig({ mpvPath: unc }));
        await stored.api.resolveRuntime();
        expect(stored.runtime.detect.mock.calls.map(([options]) => options.manualPath)).toEqual([null]);
    });

    it('decides which paths may be run', () => {
        expect(isAllowedRuntimePath('/usr/local/bin/mpv', 'linux')).toBe(true);
        expect(isAllowedRuntimePath('/Applications/mpv.app/Contents/MacOS/mpv', 'darwin')).toBe(true);
        expect(isAllowedRuntimePath('C:\\mpv\\mpv.exe', 'win32')).toBe(true);
        expect(isAllowedRuntimePath('\\\\?\\C:\\mpv\\mpv.exe', 'win32')).toBe(true);
        expect(isAllowedRuntimePath('D:/tools/mpv.exe', 'win32')).toBe(true);
        for (const value of ['\\\\server\\share\\mpv.exe', '\\\\?\\UNC\\server\\share\\mpv.exe', '//server/share/mpv.exe', '\\\\.\\pipe\\x', 'C:mpv.exe', 'mpv.exe']) {
            expect(isAllowedRuntimePath(value, 'win32'), value).toBe(false);
        }
        for (const value of [null, 42, '', 'mpv', './mpv', '/bin/mpv\n', `/${'a'.repeat(4096)}`]) {
            expect(isAllowedRuntimePath(value, 'linux'), String(value).slice(0, 20)).toBe(false);
        }
    });
});

describe('hifi ipc: runtime', () => {

    it('resolveRuntime re-detects and hands the session a path, or null when nothing was found', async () => {
        const harness = createHarness();
        await expect(harness.api.resolveRuntime()).resolves.toEqual({ path: '/usr/bin/mpv', version: '0.41.0' });
        harness.runtime.detect.mockResolvedValueOnce(status({ available: false, path: null, version: null, errorCode: 'MPV_NOT_FOUND' }));
        await expect(harness.api.resolveRuntime()).resolves.toBeNull();
    });

    it('install runs the installer, then re-detects', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:install-runtime')).resolves.toMatchObject({ ok: true, errorCode: null, status: { available: true } });
        harness.installer.install.mockResolvedValueOnce({ ok: false, errorCode: 'INSTALL_CHECKSUM_MISMATCH', version: '0.41.0', executablePath: null });
        await expect(harness.invoke('hifi:install-runtime')).resolves.toMatchObject({ ok: false, errorCode: 'INSTALL_CHECKSUM_MISMATCH' });
        expect(harness.runtime.detect).toHaveBeenCalledTimes(2);
        await harness.invoke('hifi:cancel-install');
        expect(harness.installer.cancel).toHaveBeenCalledTimes(1);
    });

    it('pick-runtime-path opens a file dialog on the main window; cancel answers null and approves nothing', async () => {
        const harness = createHarness();
        await expect(harness.invoke('hifi:pick-runtime-path')).resolves.toBe('/opt/mpv/bin/mpv');
        expect(harness.dialog.showOpenDialog).toHaveBeenCalledWith(harness.getMainWindow(), { properties: ['openFile'] });
        harness.setApprovedMpvPath.mockClear();
        harness.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
        await expect(harness.invoke('hifi:pick-runtime-path')).resolves.toBeNull();
        expect(harness.setApprovedMpvPath).not.toHaveBeenCalled();
        expect(harness.approval.value).toBe('/opt/mpv/bin/mpv');
    });

    it('macOS: a picked mpv.app is approved as the executable inside it', async () => {
        const harness = createHarness({ platform: 'darwin' });
        harness.dialog.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/Applications/mpv.app'] });
        await expect(harness.invoke('hifi:pick-runtime-path')).resolves.toBe('/Applications/mpv.app/Contents/MacOS/mpv');
        expect(harness.approval.value).toBe('/Applications/mpv.app/Contents/MacOS/mpv');
    });

    it('a picked mpv.app on macOS resolves to the executable inside it', () => {
        expect(resolvePickedRuntimePath('/Applications/mpv.app', 'darwin')).toBe('/Applications/mpv.app/Contents/MacOS/mpv');
        expect(resolvePickedRuntimePath('/Applications/mpv.app/', 'darwin')).toBe('/Applications/mpv.app/Contents/MacOS/mpv');
        expect(resolvePickedRuntimePath('/opt/homebrew/bin/mpv', 'darwin')).toBe('/opt/homebrew/bin/mpv');
        expect(resolvePickedRuntimePath('C:\\mpv\\mpv.app', 'win32')).toBe('C:\\mpv\\mpv.app');
    });
});

describe('hifi ipc: pushes and reads', () => {
    it('pushes go to the main window of the moment and skip a destroyed one', () => {
        const harness = createHarness();
        const first = harness.getMainWindow()!;
        harness.api.broadcastState({ seq: 1 });
        harness.api.broadcastClock({ seq: 1 });
        harness.api.broadcastError({ code: 'MPV_CRASHED' });
        harness.api.broadcastInstallProgress({ phase: 'downloading' });
        expect(first.webContents.sent.map(([channel]) => channel)).toEqual(['hifi:state', 'hifi:clock', 'hifi:error', 'hifi:install-progress']);

        // 窗口重建：mainWindow 换成新窗口，旧窗口还活着但收不到了。
        const rebuilt = createWindow(2);
        harness.setMainWindow(rebuilt);
        harness.api.broadcastState({ seq: 2 });
        expect(rebuilt.webContents.sent).toEqual([['hifi:state', { seq: 2 }]]);
        expect(first.webContents.sent).toHaveLength(4);

        rebuilt.destroyed = true;
        expect(() => harness.api.broadcastState({ seq: 3 })).not.toThrow();
        harness.setMainWindow(null);
        expect(() => harness.api.broadcastState({ seq: 4 })).not.toThrow();
    });

    it('sends a read to the owner page and accepts the answer only from that page', async () => {
        const harness = createHarness();
        const owner = harness.getMainWindow()!.webContents;
        const read = harness.api.requestRead(1, { sourceKey: 'src', offset: 1024, length: 4 });
        expect(owner.sent).toEqual([['hifi:read', { readId: 'read-1-0000-0000-0000-000000000000', sourceKey: 'src', offset: 1024, length: 4 }]]);

        const other = new FakeContents(5);
        harness.register(other);
        expect(() => harness.invokeAs(5, 'hifi:read-result', 'read-1-0000-0000-0000-000000000000', { status: 'ok', data: new Uint8Array([9, 9, 9, 9]) }))
            .toThrow(/Untrusted renderer/);
        // 多给的字节截掉。
        await harness.invokeAs(1, 'hifi:read-result', 'read-1-0000-0000-0000-000000000000', { status: 'ok', data: new Uint8Array([1, 2, 3, 4, 5]) });
        await expect(read).resolves.toEqual({ status: 'ok', data: new Uint8Array([1, 2, 3, 4]) });
        // 已经答过的 readId 再来一次：什么都不做。
        await expect(Promise.resolve(harness.invokeAs(1, 'hifi:read-result', 'read-1-0000-0000-0000-000000000000', { status: 'failed' }))).resolves.toBeUndefined();
    });

    it('keeps reading from the old window during a rebuild, then falls back to the new main window', async () => {
        const harness = createHarness();
        const oldContents = harness.getMainWindow()!.webContents;
        const rebuilt = createWindow(2);
        harness.setMainWindow(rebuilt);

        // 旧窗口还活着：仍然问它，它的回应照收（它不是主窗口了也一样）。
        const fromOld = harness.api.requestRead(1, { sourceKey: 'src', offset: 0, length: 2 });
        expect(oldContents.sent).toHaveLength(1);
        await harness.invokeAs(1, 'hifi:read-result', 'read-1-0000-0000-0000-000000000000', { status: 'ok', data: new Uint8Array([7, 7]) });
        await expect(fromOld).resolves.toMatchObject({ status: 'ok' });

        // 旧窗口在读的途中没了：这次读算 unknown-source，来源桥会再问。
        const interrupted = harness.api.requestRead(1, { sourceKey: 'src', offset: 2, length: 2 });
        oldContents.destroy();
        await expect(interrupted).resolves.toEqual({ status: 'unknown-source' });

        const fromNew = harness.api.requestRead(1, { sourceKey: 'src', offset: 2, length: 2 });
        expect(rebuilt.webContents.sent).toEqual([['hifi:read', expect.objectContaining({ sourceKey: 'src', offset: 2 })]]);
        await harness.invokeAs(2, 'hifi:read-result', 'read-3-0000-0000-0000-000000000000', { status: 'unknown-source' });
        await expect(fromNew).resolves.toEqual({ status: 'unknown-source' });
    });

    it('a read nobody answers fails after 10 s; with no page at all it is unknown-source', async () => {
        const harness = createHarness();
        const read = harness.api.requestRead(1, { sourceKey: 'src', offset: 0, length: 2 });
        await vi.advanceTimersByTimeAsync(9999);
        let settled = false;
        void read.then(() => {
            settled = true;
        });
        await Promise.resolve();
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(read).resolves.toEqual({ status: 'failed' });

        harness.setMainWindow(null);
        harness.contents.get(1)!.destroyed = true;
        await expect(harness.api.requestRead(1, { sourceKey: 'src', offset: 0, length: 2 })).resolves.toEqual({ status: 'unknown-source' });
    });

    it('a malformed answer counts as failed', async () => {
        const harness = createHarness();
        const read = harness.api.requestRead(1, { sourceKey: 'src', offset: 0, length: 2 });
        await harness.invokeAs(1, 'hifi:read-result', 'read-1-0000-0000-0000-000000000000', { status: 'ok', data: 'AAAA' });
        await expect(read).resolves.toEqual({ status: 'failed' });
        expect(() => harness.invokeAs(1, 'hifi:read-result', 42, { status: 'failed' })).toThrow(/INVALID_REQUEST/);
    });
});

describe('hifi ipc: the preload bridge', () => {
    // preload.cjs 只 require('electron')：换成假的 contextBridge / ipcRenderer 原样执行，看 window.electron.hifi 的每个方法调到哪个通道。
    const loadPreloadHifi = () => {
        const source = readFileSync(path.resolve(__dirname, '../../../electron/preload.cjs'), 'utf8');
        const exposed: Record<string, any> = {};
        const ipcRenderer = {
            invoke: vi.fn(async () => undefined),
            send: vi.fn(),
            on: vi.fn(),
            removeListener: vi.fn(),
        };
        const electron = {
            contextBridge: { exposeInMainWorld: (key: string, api: unknown) => { exposed[key] = api; } },
            ipcRenderer,
            webUtils: { getPathForFile: () => '' },
        };
        new Function('require', source)((name: string) => {
            if (name !== 'electron') throw new Error(`preload required ${name}`);
            return electron;
        });
        return { hifi: exposed.electron.hifi as Record<string, (...args: unknown[]) => unknown>, ipcRenderer };
    };

    it('probeOutput invokes hifi:probe-output with no payload', async () => {
        const { hifi, ipcRenderer } = loadPreloadHifi();
        await hifi.probeOutput();
        expect(ipcRenderer.invoke).toHaveBeenCalledWith('hifi:probe-output');
        expect(ipcRenderer.invoke.mock.calls[0]).toHaveLength(1);
    });

    it('every invoke channel main registers is reachable from window.electron.hifi', async () => {
        const { hifi, ipcRenderer } = loadPreloadHifi();
        for (const method of Object.values(hifi)) await method(() => {}, () => {});
        const invoked = new Set((ipcRenderer.invoke.mock.calls as unknown as unknown[][]).map(call => call[0]));
        expect([...invoked].sort()).toEqual([...INVOKE_CHANNELS, READ_RESULT_CHANNEL, MPRIS_STATE_CHANNEL, MPRIS_ARTWORK_CHANNEL].sort());
    });
});
