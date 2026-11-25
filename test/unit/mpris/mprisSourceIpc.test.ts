import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// 钉住系统媒体会话的 IPC 接入点：只认主窗口、start 可以重复调但只建一个读数器、stop 停掉它、
// 快照和连接状态推回主窗口。

const require = createRequire(import.meta.url);
const ipc = require('../../../electron/mpris/mprisSourceIpc.cjs') as {
    START_CHANNEL: string;
    STOP_CHANNEL: string;
    STATE_CHANNEL: string;
    STATUS_CHANNEL: string;
    registerMprisSourceIpc: (options: Record<string, unknown>) => {
        dispose: () => void;
        isRunning: () => boolean;
    };
};

const createHarness = ({ trusted = true } = {}) => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const sent: Array<[string, unknown]> = [];
    const window = {
        isDestroyed: () => false,
        webContents: {
            isDestroyed: () => false,
            send: (channel: string, payload: unknown) => sent.push([channel, payload]),
        },
    };
    type FakeReader = {
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        callbacks: { onSnapshot: (snapshot: unknown) => void; onStatus: (status: unknown) => void };
    };
    const readers: FakeReader[] = [];
    const createReader = (callbacks: { onSnapshot: (snapshot: unknown) => void; onStatus: (status: unknown) => void }) => {
        const reader = { start: vi.fn(), stop: vi.fn(), callbacks };
        readers.push(reader);
        return reader;
    };
    const api = ipc.registerMprisSourceIpc({
        ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(channel, handler) },
        isTrustedSender: () => trusted,
        getMainWindow: () => window,
        createReader,
    });
    return { handlers, sent, readers, api };
};

describe('registerMprisSourceIpc', () => {
    it('creates one reader, starts it on every start, and stops it with stop', () => {
        const { handlers, readers } = createHarness();
        handlers.get(ipc.START_CHANNEL)?.({});
        handlers.get(ipc.START_CHANNEL)?.({});
        expect(readers).toHaveLength(1);
        expect(readers[0].start).toHaveBeenCalledTimes(2);

        handlers.get(ipc.STOP_CHANNEL)?.({});
        expect(readers[0].stop).toHaveBeenCalledTimes(1);
    });

    it('forwards snapshots and status to the main window', () => {
        const { handlers, readers, sent } = createHarness();
        handlers.get(ipc.START_CHANNEL)?.({});
        const snapshot = { players: [], activeBusName: null, sampledAtMs: 1 };
        readers[0].callbacks.onSnapshot(snapshot);
        readers[0].callbacks.onStatus({ listening: true, error: null });
        expect(sent).toEqual([
            [ipc.STATE_CHANNEL, snapshot],
            [ipc.STATUS_CHANNEL, { listening: true, error: null }],
        ]);
    });

    it('rejects a renderer that is not the main window', () => {
        const { handlers } = createHarness({ trusted: false });
        expect(() => handlers.get(ipc.START_CHANNEL)?.({})).toThrow(/Untrusted/);
    });
});
