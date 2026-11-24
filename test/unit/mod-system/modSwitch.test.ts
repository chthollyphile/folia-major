import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModRuntimeInfo, ModSetEnabledResult, ModSourceInfo } from '@/mods/types';

// test/unit/mod-system/modSwitch.test.ts
// The mods window's switch for a mod (src/mods/market/modSwitch.ts, isModOn in marketModel.ts): a source mod
// counts as on only when its sources are not all off in Settings → Sources, and its button switches those
// sources the way that page does, so the two places never disagree.

const switchSourceState = vi.fn<(sourceId: string, state: string) => Promise<{ ok: boolean; error?: string }>>(async () => ({ ok: true }));
const refresh = vi.fn(async () => {});

vi.mock('@/mods/runtime/sourceSwitches', () => ({
    switchSourceState: (sourceId: string, state: string) => switchSourceState(sourceId, state),
}));
vi.mock('@/mods/useModsStore', () => ({
    useModsStore: { getState: () => ({ refresh }) },
}));

const { switchModOn } = await import('@/mods/market/modSwitch');
const { isModOn, matchesModsQuery, buildModViewItems } = await import('@/mods/market/marketModel');
const { parseModsQuery } = await import('@/mods/market/modsQuery');

const source = (id: string, state: ModSourceInfo['state']): ModSourceInfo => ({
    id, localId: id, name: id, state, keepForMatching: false, takeover: false, requires: [],
});

const mod = (more: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'qishui',
    name: 'Qishui',
    version: '1.0.0',
    author: 'Folia',
    description: null,
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'builtin' } as ModRuntimeInfo['signature'],
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: true,
    clientUrl: null,
    tier: 'builtin',
    kind: 'source',
    sources: [source('qishui', 'enabled')],
    sourcesOff: false,
    ...more,
});

const okToggle = () => vi.fn(async (): Promise<ModSetEnabledResult> => ({ ok: true, mods: [] }));

beforeEach(() => {
    switchSourceState.mockClear();
    refresh.mockClear();
});

describe('isModOn', () => {
    it('a source mod whose sources are all off reads as off, though its own switch is on', () => {
        expect(isModOn(mod({ sourcesOff: true, status: 'disabled' }))).toBe(false);
        expect(isModOn(mod())).toBe(true);
        expect(isModOn(mod({ enabled: false }))).toBe(false);
    });

    it('the @enabled and @disabled filters follow it', () => {
        const items = buildModViewItems([mod({ sourcesOff: true, status: 'disabled' })], null, (id) => id);
        expect(matchesModsQuery(items[0], parseModsQuery('@enabled'))).toBe(false);
        expect(matchesModsQuery(items[0], parseModsQuery('@disabled'))).toBe(true);
    });
});

describe('switchModOn', () => {
    it('a mod without sources flips its own switch', async () => {
        const toggle = okToggle();
        await switchModOn(mod({ kind: 'standard', sources: [] }), false, toggle);
        expect(toggle).toHaveBeenCalledWith('qishui', false);
        expect(switchSourceState).not.toHaveBeenCalled();
    });

    it('turning a source mod off switches its sources off and leaves its own switch alone', async () => {
        const toggle = okToggle();
        const answer = await switchModOn(mod({ sources: [source('a', 'enabled'), source('b', 'matching'), source('c', 'disabled')] }), false, toggle);
        expect(answer.ok).toBe(true);
        expect(toggle).not.toHaveBeenCalled();
        expect(switchSourceState.mock.calls).toEqual([['a', 'disabled'], ['b', 'disabled']]);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('turning on a source mod whose sources are all off switches them on, without asking for its own switch', async () => {
        const toggle = okToggle();
        await switchModOn(mod({ sourcesOff: true, sources: [source('a', 'disabled'), source('b', 'disabled')] }), true, toggle);
        expect(toggle).not.toHaveBeenCalled();
        expect(switchSourceState.mock.calls).toEqual([['a', 'enabled'], ['b', 'enabled']]);
    });

    it('turning on a source mod whose own switch is off asks for it first, and stops when the user declines', async () => {
        const declined = vi.fn(async (): Promise<ModSetEnabledResult> => ({ ok: false, error: 'enable-declined', mods: [] }));
        const answer = await switchModOn(mod({ enabled: false, sourcesOff: true, sources: [source('a', 'disabled')] }), true, declined);
        expect(answer).toMatchObject({ ok: false, error: 'enable-declined' });
        expect(switchSourceState).not.toHaveBeenCalled();
    });

    it('turning on a disabled source mod whose sources are on leaves the sources as they are', async () => {
        const toggle = okToggle();
        await switchModOn(mod({ enabled: false, sources: [source('a', 'matching')] }), true, toggle);
        expect(toggle).toHaveBeenCalledWith('qishui', true);
        expect(switchSourceState).not.toHaveBeenCalled();
    });

    it('reports the first source that could not be switched', async () => {
        switchSourceState.mockResolvedValueOnce({ ok: false, error: 'source-not-found' });
        const answer = await switchModOn(mod({ sources: [source('a', 'enabled'), source('b', 'enabled')] }), false, okToggle());
        expect(answer).toMatchObject({ ok: false, error: 'source-not-found' });
        expect(switchSourceState).toHaveBeenCalledTimes(2);
    });
});
