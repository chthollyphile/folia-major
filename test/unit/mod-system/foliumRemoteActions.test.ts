import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FoliumRemoteActionDef, FoliumRemoteActionsContext } from '../../../src/mods/folium/contract';
import { FOLIUM_VERSION } from '../../../src/mods/folium/contract';
import { registerRemoteActions, remoteActionsRegistry, resolveRemoteActions, subscribeRemoteActions } from '../../../src/mods/folium/registries/remoteActions';
import { clearFoliumIssues, getFoliumIssues } from '../../../src/mods/runtime/status';

// test/unit/mod-system/foliumRemoteActions.test.ts
// A failure is read with getFoliumIssues: the status store itself is written at most once a second.
const MOD_IDS = ['mod-a', 'mod-b', 'broken', 'good', 'duplicate', 'sparse', 'unbounded', 'first', 'later', 'disabled'];
const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');
const context: FoliumRemoteActionsContext = Object.freeze({ song: null, state: 'paused' });
const action = (patch: Partial<FoliumRemoteActionDef> = {}): FoliumRemoteActionDef => ({
    id: 'like', label: { 'zh-CN': '点赞', en: 'Like' }, icon: 'thumbs-up', run: vi.fn(), ...patch,
});
const disposers = new Set<() => void>();
afterEach(() => {
    disposers.forEach(dispose => dispose()); disposers.clear();
    remoteActionsRegistry.list().forEach(entry => remoteActionsRegistry.unregister(entry.id));
    MOD_IDS.forEach(clearFoliumIssues);
    vi.restoreAllMocks();
});

describe('experimental remote.actions registry', () => {
    it('recognizes only the new opt-in without changing the stable Folium version', () => {
        const manifest = { id: 'sample', name: 'Sample', version: '1.0.0', folium: 1, client: 'client.mjs', experimental: ['remote.actions'] };
        expect(validateManifest(manifest).ok).toBe(true);
        expect(validateManifest({ ...manifest, experimental: ['remote.ui'] }).ok).toBe(false);
        expect(FOLIUM_VERSION).toEqual({ major: 1, minor: 8 });
    });

    it('namespaces actions by mod and group, keeping group order and complete locale maps', () => {
        const label = { 'zh-CN': '点赞', en: 'Like' };
        const actions = vi.fn(() => [action({ label })]);
        registerRemoteActions('mod-a', { id: 'room', order: 2, actions });
        registerRemoteActions('mod-a', { id: 'preview', order: 1, actions: () => [action({ scope: 'session' })] });
        registerRemoteActions('mod-b', { id: 'room', order: 2, actions: () => [action()] });
        const result = resolveRemoteActions(context);
        expect(actions).toHaveBeenCalledWith(context);
        expect(result.map(item => item.id)).toEqual(['mod-a:preview:like', 'mod-a:room:like', 'mod-b:room:like']);
        expect(result[1]).toMatchObject({ label, scope: 'track', tone: 'normal', disabled: false, pressed: false });
        expect(result[0].scope).toBe('session');
        label.en = 'Changed';
        expect(result[1].label.en).toBe('Like');
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result[1])).toBe(true);
        expect(Object.isFrozen(result[1].label)).toBe(true);
    });

    it('rejects invalid group definitions and duplicate registrations', () => {
        expect(() => registerRemoteActions('mod-a', { id: 'bad:id', actions: () => [] })).toThrow('id');
        expect(() => registerRemoteActions('mod-a', { id: 'bad', order: NaN, actions: () => [] })).toThrow('order');
        expect(() => registerRemoteActions('mod-a', { id: 'bad', actions: null! })).toThrow('function');
        registerRemoteActions('mod-a', { id: 'room', actions: () => [] });
        expect(() => registerRemoteActions('mod-a', { id: 'room', actions: () => [] })).toThrow('duplicate');
    });

    it('notifies registration, owned invalidation, removal, and no longer notifies after unsubscribe', () => {
        const changed = vi.fn();
        const unsubscribe = subscribeRemoteActions(changed); disposers.add(unsubscribe);
        const handle = registerRemoteActions('mod-a', { id: 'room', actions: () => [action()] });
        handle.invalidate(); handle.unregister(); handle.invalidate();
        expect(changed).toHaveBeenCalledTimes(3);
        unsubscribe();
        registerRemoteActions('mod-a', { id: 'room', actions: () => [action()] }).invalidate();
        expect(changed).toHaveBeenCalledTimes(3);
    });

    it('keeps an epoch across invalidations and revokes the old handle on same-id re-registration', async () => {
        const oldRun = vi.fn();
        const old = registerRemoteActions('mod-a', { id: 'room', actions: () => [action({ run: oldRun })] });
        const [before] = resolveRemoteActions(context);
        old.invalidate();
        expect(resolveRemoteActions(context)[0].epoch).toBe(before.epoch);
        remoteActionsRegistry.unregisterAll('mod-a');
        const next = registerRemoteActions('mod-a', { id: 'room', actions: () => [action()] });
        const changed = vi.fn(); disposers.add(subscribeRemoteActions(changed));
        old.invalidate(); old.unregister();
        expect(changed).not.toHaveBeenCalled();
        expect(remoteActionsRegistry.list()).toHaveLength(1);
        expect(resolveRemoteActions(context)[0].epoch).not.toBe(before.epoch);
        await expect(before.run()).rejects.toThrow('no longer active');
        expect(oldRun).not.toHaveBeenCalled();
        next.invalidate(); expect(changed).toHaveBeenCalledOnce();
    });

    it('cannot bind an old invalidate handle to a replacement created during registration notification', () => {
        let replace = true;
        const definition = { id: 'room', actions: () => [action()] };
        disposers.add(subscribeRemoteActions(() => {
            if (!replace) return;
            replace = false;
            remoteActionsRegistry.unregisterAll('mod-a');
            registerRemoteActions('mod-a', definition);
        }));
        const old = registerRemoteActions('mod-a', definition);
        const changed = vi.fn(); disposers.add(subscribeRemoteActions(changed));
        old.invalidate(); old.unregister();
        expect(changed).not.toHaveBeenCalled();
        expect(remoteActionsRegistry.list()).toHaveLength(1);
    });

    it.each([
        { id: 'not:local' }, { label: 'Like' }, { label: {} }, { label: { en: 1 } },
        { icon: 'not-a-lucide-icon' }, { run: undefined }, { disabled: 'yes' }, { pressed: 1 },
        { count: NaN }, { count: -1 }, { tone: 'custom' }, { scope: 'global' },
    ])('isolates malformed action fields %j', (patch) => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        registerRemoteActions('broken', { id: 'room', actions: () => [action(patch as Partial<FoliumRemoteActionDef>)] });
        registerRemoteActions('good', { id: 'room', actions: () => [action()] });
        expect(resolveRemoteActions(context).map(item => item.id)).toEqual(['good:room:like']);
        expect(getFoliumIssues('broken')).toHaveLength(1);
    });

    it('rejects duplicate ids, sparse arrays, and unbounded results without consuming them', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const enormous: FoliumRemoteActionDef[] = [];
        enormous.length = 2 ** 32 - 1;
        registerRemoteActions('duplicate', { id: 'room', actions: () => [action(), action()] });
        registerRemoteActions('sparse', { id: 'room', actions: () => new Array(2) });
        registerRemoteActions('unbounded', { id: 'room', actions: () => enormous });
        expect(resolveRemoteActions(context)).toEqual([]);
        expect(['duplicate', 'sparse', 'unbounded'].map((id) => getFoliumIssues(id).length)).toEqual([1, 1, 1]);
    });

    it('skips owners removed by another group and a group that removes itself while resolving', () => {
        const later = vi.fn(() => [action()]);
        registerRemoteActions('first', { id: 'room', actions: () => {
            remoteActionsRegistry.unregisterAll('later');
            remoteActionsRegistry.unregisterAll('first');
            return [action()];
        } });
        registerRemoteActions('later', { id: 'room', actions: later });
        expect(resolveRemoteActions(context)).toEqual([]);
        expect(later).not.toHaveBeenCalled();
    });

    it('blocks disabled callbacks and reports asynchronous failures without removing another group', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const run = vi.fn();
        registerRemoteActions('disabled', { id: 'room', actions: () => [action({ disabled: true, run })] });
        registerRemoteActions('broken', { id: 'room', actions: () => [action({ run: async () => { throw new Error('RPC failed'); } })] });
        const result = resolveRemoteActions(context);
        await expect(result[0].run()).rejects.toThrow('disabled'); expect(run).not.toHaveBeenCalled();
        await expect(result[1].run()).rejects.toThrow('RPC failed');
        expect(getFoliumIssues('broken').at(-1)?.message).toBe('RPC failed');
        expect(remoteActionsRegistry.list()).toHaveLength(2);
    });
});
