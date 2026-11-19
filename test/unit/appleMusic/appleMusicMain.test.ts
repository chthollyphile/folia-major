import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CompanionClientModule from '../../../sources/appleMusic/main/companionClient.cjs';

// test/unit/appleMusic/appleMusicMain.test.ts — the source mod's main entry (sources/appleMusic/main/index.ts): what main.cjs
// gave the companion client before the move (the executable, the profile folder, the IPC channel, the pause when no window
// follows the player, the close at quit) now comes from api.*. The client is the real one; the companion process is a
// stand-in child on the parent channel. The paths are rooted ones, absolute on every system the tests run on.

class Child extends EventEmitter {
    connected = true;
    send = vi.fn((message: { id: string; operation: string }, callback: (error?: Error) => void) => {
        callback();
        queueMicrotask(() => this.emit('message', { id: message.id, ok: true, data: { operation: message.operation } }));
    });
    disconnect = vi.fn(() => { this.connected = false; this.emit('disconnect'); });
}

const harness = vi.hoisted(() => ({
    spawned: [] as Array<{ binary: string; args: string[]; child: unknown }>,
    makeChild: null as null | (() => unknown),
}));

vi.mock('../../../sources/appleMusic/main/companionClient.cjs', async () => {
    const actual = await vi.importActual<typeof CompanionClientModule>('../../../sources/appleMusic/main/companionClient.cjs');
    return {
        createCompanionClient: (options: Parameters<typeof actual.createCompanionClient>[0]) => actual.createCompanionClient({
            ...options,
            // The real pipe adapter is tested apart (nativeSpawn.test.ts): here the spawn hands the stand-in child out.
            createNativeChannel: () => (binary: string, args: string[]) => {
                const child = harness.makeChild!();
                harness.spawned.push({ binary, args, child });
                return child;
            },
        } as Parameters<typeof actual.createCompanionClient>[0]),
    };
});

const { default: activate } = await import('../../../sources/appleMusic/main/index');

type Handler = (...args: unknown[]) => unknown;

const launch = ({ nativePath = '/app/resources/apple-music/windows/FoliaAppleMusicCompanion.exe' }: { nativePath?: string | null } = {}) => {
    const rpc = new Map<string, Handler>();
    const beforeQuit: Handler[] = [];
    const beforeUnload: Handler[] = [];
    const orphaned: Handler[] = [];
    const api = {
        native: {
            path: vi.fn((name: string) => {
                if (nativePath === null) throw new Error(`native-unavailable:${name}`);
                return nativePath;
            }),
        },
        paths: { legacy: vi.fn((name: string) => `/userData/${name}`) },
        rpc: { handle: (name: string, handler: Handler) => { rpc.set(name, handler); } },
        onPlayersOrphaned: (handler: Handler) => { orphaned.push(handler); return () => {}; },
        onBeforeQuit: (handler: Handler) => {
            beforeQuit.push(handler);
            return () => { const at = beforeQuit.indexOf(handler); if (at >= 0) beforeQuit.splice(at, 1); };
        },
        onBeforeUnload: (handler: Handler) => { beforeUnload.push(handler); return () => {}; },
    };
    activate(api as never);
    return { api, rpc, beforeQuit, beforeUnload, orphaned };
};

beforeEach(() => {
    harness.spawned.length = 0;
    harness.makeChild = () => new Child();
});

describe('Apple Music main entry', () => {
    it('starts the companion the app ships, in the claimed profile folder, on the first request', async () => {
        const { api, rpc } = launch();
        expect(api.native.path).toHaveBeenCalledWith('apple-music-companion');
        expect(api.paths.legacy).toHaveBeenCalledWith('apple-music-companion');
        expect(harness.spawned).toHaveLength(0);
        await expect(rpc.get('request')!('accountStatus', {})).resolves.toMatchObject({ ok: true, data: { operation: 'accountStatus' } });
        expect(harness.spawned).toHaveLength(1);
        expect(harness.spawned[0].binary).toBe('/app/resources/apple-music/windows/FoliaAppleMusicCompanion.exe');
        expect(harness.spawned[0].args).toEqual(['--user-data-dir=/userData/apple-music-companion']);
    });

    it('refuses an operation outside the allowlist without starting anything', async () => {
        const { rpc } = launch();
        await expect(rpc.get('request')!('evaluate', { code: '1' })).resolves.toEqual({ ok: false, error: 'invalid-request' });
        expect(harness.spawned).toHaveLength(0);
    });

    it('answers runtime-unavailable where the app ships no companion', async () => {
        const { rpc } = launch({ nativePath: null });
        await expect(rpc.get('request')!('accountStatus', {})).resolves.toEqual({ ok: false, error: 'runtime-unavailable' });
        expect(harness.spawned).toHaveLength(0);
    });

    it('holds the quit only while a companion runs, and closes it then', async () => {
        const { rpc, beforeQuit } = launch();
        expect(beforeQuit).toHaveLength(0);
        await rpc.get('request')!('accountStatus', {});
        expect(beforeQuit).toHaveLength(1);
        const child = harness.spawned[0].child as Child;
        await beforeQuit[0]();
        expect(child.disconnect).toHaveBeenCalled();
        expect(beforeQuit).toHaveLength(0);

        // A companion that exits on its own lets the quit go too.
        await rpc.get('request')!('accountStatus', {});
        expect(beforeQuit).toHaveLength(1);
        (harness.spawned[1].child as Child).emit('exit');
        expect(beforeQuit).toHaveLength(0);
    });

    it('closes the companion when the source is turned off', async () => {
        const { rpc, beforeUnload } = launch();
        await rpc.get('request')!('accountStatus', {});
        const child = harness.spawned[0].child as Child;
        await beforeUnload[0]();
        expect(child.disconnect).toHaveBeenCalled();
    });

    it('pauses a running companion nobody follows, and does not start one to pause it', async () => {
        const { rpc, orphaned } = launch();
        orphaned[0]();
        await Promise.resolve();
        expect(harness.spawned).toHaveLength(0);

        await rpc.get('request')!('accountStatus', {});
        const child = harness.spawned[0].child as Child;
        orphaned[0]();
        await vi.waitFor(() => {
            expect(child.send).toHaveBeenCalledWith(expect.objectContaining({ operation: 'pause' }), expect.any(Function));
        });
    });
});
