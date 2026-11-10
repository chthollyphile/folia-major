import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoliumRemoteActionDef, FoliumRemoteActionsContext } from '../../../src/mods/folium/contract';
import { registerRemoteActions, remoteActionsRegistry, subscribeRemoteActions } from '../../../src/mods/folium/registries/remoteActions';
import { clearFoliumIssues, getFoliumIssues } from '../../../src/mods/runtime/status';
import { createRemoteControlActionBridge } from '../../../src/services/remoteControlActions';
import { createRemoteActionActivation } from '../../../src/utils/remoteActionActivation';

// test/unit/remote/remoteControlActions.test.ts

const action = (id = 'vote', extra: Partial<FoliumRemoteActionDef> = {}): FoliumRemoteActionDef => ({
    id, label: { 'zh-CN': '点赞', en: 'Vote' }, icon: 'thumbs-up', run: vi.fn(), ...extra,
});

const source = (trackKey: string | null = 'track-a') => ({
    trackKey,
    context: {
        song: trackKey === null ? null : { id: trackKey, title: trackKey, artist: 'Artist', album: null, source: null, ref: null },
        state: 'playing',
    } as FoliumRemoteActionsContext,
});

afterEach(() => {
    [...remoteActionsRegistry.list()].forEach(entry => remoteActionsRegistry.unregister(entry.id));
    // The status store is written at most once a second; getFoliumIssues reads the record itself.
    ['test', 'one', 'two'].forEach(clearFoliumIssues);
    vi.restoreAllMocks();
});

describe('remote mod-action bridge', () => {
    it('does no source work or native command routing without registrations', async () => {
        const readSource = vi.fn(() => source());
        const bridge = createRemoteControlActionBridge(readSource);
        expect(bridge.read()).toBeUndefined();
        expect(await bridge.activate({ type: 'next' })).toBe(false);
        expect(await bridge.activate({ type: 'toggle-like' })).toBe(false);
        expect(readSource).not.toHaveBeenCalled();
        bridge.dispose();
    });

    it('publishes localized, serializable presentation with stable tickets across refreshes', () => {
        let count = 2;
        registerRemoteActions('test', { id: 'actions', actions: () => [action('vote', { count, pressed: true, tone: 'alert' })] });
        const bridge = createRemoteControlActionBridge(() => source());
        const first = bridge.read()!;
        expect(first.items[0]).toMatchObject({
            id: 'test:actions:vote', label: { 'zh-CN': '点赞', en: 'Vote' }, count: 2, pressed: true, tone: 'alert',
        });
        expect(first.items[0]).not.toHaveProperty('run');
        expect(first.items[0]).not.toHaveProperty('epoch');
        expect(first.items[0]).not.toHaveProperty('scope');
        expect(structuredClone(first)).toEqual(first);
        expect(bridge.read()).toBe(first);
        count = 3;
        const second = bridge.read()!;
        expect(second.revision).toBeGreaterThan(first.revision);
        expect(second.items[0].handle).toBe(first.items[0].handle);
        expect(first.items[0].count).toBe(2);
        bridge.dispose();
    });

    it('executes both rapid clicks from one snapshot even when the first invalidates its count', async () => {
        let count = 0;
        const handle = registerRemoteActions('test', {
            id: 'actions',
            actions: () => [action('vote', { count, run: () => { count++; handle.invalidate(); } })],
        });
        const bridge = createRemoteControlActionBridge(() => source());
        const unsubscribe = subscribeRemoteActions(() => bridge.read());
        try {
            const first = bridge.read()!;
            const command = createRemoteActionActivation(first, first.items[0]);
            expect(await Promise.all([bridge.activate(command), bridge.activate(command)])).toEqual([true, true]);
            expect(count).toBe(2);
            expect(bridge.read()!.revision).toBeGreaterThan(first.revision);
        } finally { unsubscribe(); bridge.dispose(); }
    });

    it('does not invalidate another button when one action refreshes the presentation', async () => {
        let count = 0;
        const other = vi.fn();
        const handle = registerRemoteActions('test', {
            id: 'actions', actions: () => [
                action('vote', { count, run: () => { count++; handle.invalidate(); } }),
                action('stop', { scope: 'session', run: other }),
            ],
        });
        const bridge = createRemoteControlActionBridge(() => source());
        const snapshot = bridge.read()!;
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[0]))).toBe(true);
        bridge.read();
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[1]))).toBe(true);
        expect(other).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('checks the latest disabled state and removed actions before a remote refresh arrives', async () => {
        const run = vi.fn();
        let disabled = false;
        let visible = true;
        registerRemoteActions('test', { id: 'actions', actions: () => visible ? [action('vote', { disabled, run })] : [] });
        const bridge = createRemoteControlActionBridge(() => source());
        const snapshot = bridge.read()!;
        const command = createRemoteActionActivation(snapshot, snapshot.items[0]);
        disabled = true;
        expect(await bridge.activate(command)).toBe(false);
        disabled = false;
        visible = false;
        expect(await bridge.activate(command)).toBe(false);
        expect(run).not.toHaveBeenCalled();
        expect(bridge.read()).toBeUndefined();
        bridge.dispose();
    });

    it('resolves the current callback rather than retaining the snapshot callback', async () => {
        const oldRun = vi.fn();
        const newRun = vi.fn();
        let run = oldRun;
        registerRemoteActions('test', { id: 'actions', actions: () => [action('vote', { run })] });
        const bridge = createRemoteControlActionBridge(() => source());
        const snapshot = bridge.read()!;
        run = newRun;
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[0]))).toBe(true);
        expect(oldRun).not.toHaveBeenCalled();
        expect(newRun).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('keeps the registration ticket when the same action reappears after an empty result', async () => {
        let visible = true;
        const run = vi.fn();
        registerRemoteActions('test', { id: 'actions', actions: () => visible ? [action('vote', { run })] : [] });
        const bridge = createRemoteControlActionBridge(() => source());
        const first = bridge.read()!;
        const command = createRemoteActionActivation(first, first.items[0]);
        visible = false;
        expect(bridge.read()).toBeUndefined();
        expect(await bridge.activate(command)).toBe(false);
        visible = true;
        const restored = bridge.read()!;
        expect(restored.items[0].handle).toBe(first.items[0].handle);
        expect(restored.revision).toBeGreaterThan(first.revision);
        expect(await bridge.activate(command)).toBe(true);
        expect(run).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('rejects old track clicks while keeping session actions valid across songs', async () => {
        const trackRun = vi.fn();
        const sessionRun = vi.fn();
        let current = source();
        registerRemoteActions('test', { id: 'actions', actions: () => [
            action('vote', { run: trackRun }), action('stop', { scope: 'session', run: sessionRun }),
        ] });
        const bridge = createRemoteControlActionBridge(() => current);
        const first = bridge.read()!;
        current = source('track-b');
        bridge.read();
        expect(await bridge.activate(createRemoteActionActivation(first, first.items[0]))).toBe(false);
        expect(await bridge.activate(createRemoteActionActivation(first, first.items[1]))).toBe(true);
        const second = bridge.read()!;
        expect(await bridge.activate(createRemoteActionActivation(second, second.items[0]))).toBe(true);
        expect(trackRun).toHaveBeenCalledOnce();
        expect(sessionRun).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('disables track actions without a song while allowing session actions', async () => {
        const trackRun = vi.fn();
        const sessionRun = vi.fn();
        registerRemoteActions('test', { id: 'actions', actions: () => [
            action('vote', { run: trackRun }), action('stop', { scope: 'session', run: sessionRun }),
        ] });
        const bridge = createRemoteControlActionBridge(() => source(null));
        const snapshot = bridge.read()!;
        expect(snapshot.items.map(item => item.disabled)).toEqual([true, false]);
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[0]))).toBe(false);
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[1]))).toBe(true);
        expect(trackRun).not.toHaveBeenCalled();
        expect(sessionRun).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('rejects disabled-owner and re-registered same-id tickets without needing a publish', async () => {
        const oldRun = vi.fn();
        const newRun = vi.fn();
        registerRemoteActions('test', { id: 'actions', actions: () => [action('vote', { run: oldRun })] });
        const bridge = createRemoteControlActionBridge(() => source());
        const first = bridge.read()!;
        const command = createRemoteActionActivation(first, first.items[0]);
        remoteActionsRegistry.unregisterAll('test');
        expect(await bridge.activate(command)).toBe(false);
        registerRemoteActions('test', { id: 'actions', actions: () => [action('vote', { run: newRun })] });
        expect(await bridge.activate(command)).toBe(false);
        const second = bridge.read()!;
        expect(second.items[0].handle).not.toBe(first.items[0].handle);
        expect(await bridge.activate(createRemoteActionActivation(second, second.items[0]))).toBe(true);
        expect(oldRun).not.toHaveBeenCalled();
        expect(newRun).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('invalidates tickets on disposal and never accepts a previous bridge epoch', async () => {
        const run = vi.fn();
        registerRemoteActions('test', { id: 'actions', actions: () => [action('vote', { run })] });
        const previous = createRemoteControlActionBridge(() => source());
        const first = previous.read()!;
        const command = createRemoteActionActivation(first, first.items[0]);
        previous.dispose();
        expect(previous.read()).toBeUndefined();
        expect(await previous.activate(command)).toBe(false);
        const current = createRemoteControlActionBridge(() => source());
        current.read();
        expect(await current.activate(command)).toBe(false);
        expect(run).not.toHaveBeenCalled();
        current.dispose();
    });

    it('isolates an action rejection and records the owning mod problem', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const valid = vi.fn();
        registerRemoteActions('test', { id: 'actions', actions: () => [
            action('broken', { run: () => Promise.reject(new Error('remote failure')) }),
            action('valid', { run: valid }),
        ] });
        const bridge = createRemoteControlActionBridge(() => source());
        const snapshot = bridge.read()!;
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[0]))).toBe(false);
        expect(getFoliumIssues('test')).toEqual([
            expect.objectContaining({ message: 'remote failure' }),
        ]);
        expect(await bridge.activate(createRemoteActionActivation(snapshot, snapshot.items[1]))).toBe(true);
        expect(valid).toHaveBeenCalledOnce();
        bridge.dispose();
    });

    it('isolates owners with identical local ids and rejects unknown handles', async () => {
        const firstRun = vi.fn();
        const secondRun = vi.fn();
        registerRemoteActions('one', { id: 'actions', actions: () => [action('vote', { run: firstRun })] });
        registerRemoteActions('two', { id: 'actions', actions: () => [action('vote', { run: secondRun })] });
        const bridge = createRemoteControlActionBridge(() => source());
        const snapshot = bridge.read()!;
        const first = createRemoteActionActivation(snapshot, snapshot.items[0]);
        const second = createRemoteActionActivation(snapshot, snapshot.items[1]);
        remoteActionsRegistry.unregisterAll('one');
        expect(await bridge.activate(first)).toBe(false);
        expect(await bridge.activate(second)).toBe(true);
        expect(await bridge.activate({ ...second, handle: 'unknown' })).toBe(false);
        expect(firstRun).not.toHaveBeenCalled();
        expect(secondRun).toHaveBeenCalledOnce();
        bridge.dispose();
    });
});
