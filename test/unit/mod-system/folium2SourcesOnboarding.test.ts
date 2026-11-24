import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    IPC, cleanHarness, clearModRecords, invoke, launch, modRecord, persisted, resetHarness, sourceManifest, writeMod,
} from './loaderHarness';

// test/unit/mod-system/folium2SourcesOnboarding.test.ts
// Folium 2.0 S8, the start prompt's sources page in the main process (dev/folium/folium-2-plan.md §5.3): a fresh
// profile is recorded as owing it, an upgraded one never is, and no source runs while it is owed; the one answer is checked entry by entry before anything
// is written (known built-in ids, the three states, 'matching' only for a built-in copy kept for matching), then
// written, recorded as answered and reloaded differentially; after that nothing is owed and a second answer is refused.

const ONBOARDING_KEY = 'mods.sourcesOnboarding';

beforeEach(() => {
    resetHarness();
    clearModRecords();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    cleanHarness();
    clearModRecords();
    vi.restoreAllMocks();
});

/* Two built-in copies kept for matching, one that is not, and a third-party source in the user's folder. */
const writeSources = () => {
    writeMod('builtin', sourceManifest('netease', [{ id: 'netease', keepForMatching: true }]), { main: true });
    writeMod('builtin', sourceManifest('qq', [{ id: 'qq', keepForMatching: true }]), { main: true });
    writeMod('builtin', sourceManifest('kugou', ['kugou']), { main: true });
};

const fresh = () => launch({ extra: { freshProfile: true } });

describe('which profile owes the sources page', () => {
    it('a fresh profile is recorded as owing it, and the source states say so', async () => {
        writeSources();
        fresh();
        expect(persisted.get(ONBOARDING_KEY)).toBe('pending');
        expect(await invoke(IPC.sourceStates)).toMatchObject({ ok: true, sourcesOnboarding: true });
    });

    it('runs no source until the page is answered, but lists them with their manifest names', async () => {
        writeSources();
        const system = fresh();
        expect(modRecord('netease')).toBeUndefined();
        expect(modRecord('kugou')).toBeUndefined();
        const answer = await invoke(IPC.sourceStates) as { sources: Array<{ sourceId: string; modId: string | null; loaded: boolean; name: unknown }> };
        const modRows = answer.sources.filter(row => row.modId !== null);
        expect(modRows.map(row => row.sourceId).sort()).toEqual(['kugou', 'netease', 'qq']);
        expect(answer.sources.every(row => !row.loaded)).toBe(true);
        expect(answer.sources.find(row => row.sourceId === 'kugou')?.name).toBe('kugou');
        // A reload asked for meanwhile (the panel, the master switch) does not start them either.
        system.loadAll();
        expect(modRecord('kugou')).toBeUndefined();
    });

    it('an upgraded profile never owes it: no record, every source enabled', async () => {
        writeSources();
        launch();
        expect(persisted.has(ONBOARDING_KEY)).toBe(false);
        const answer = await invoke(IPC.sourceStates) as { sourcesOnboarding: boolean; states: Record<string, string> };
        expect(answer.sourcesOnboarding).toBe(false);
        expect(Object.values(answer.states).every(state => state === 'enabled')).toBe(true);
        expect(await invoke(IPC.answerSourcesOnboarding, { kugou: 'disabled' })).toEqual({ ok: false, error: 'sources-onboarding-not-owed' });
        expect(persisted.get('mods.sourceStates')).toBeUndefined();
    });

    it('a record already there is kept: an answered page is not owed again', async () => {
        persisted.set(ONBOARDING_KEY, 'done');
        fresh();
        expect(persisted.get(ONBOARDING_KEY)).toBe('done');
        expect(await invoke(IPC.sourceStates)).toMatchObject({ sourcesOnboarding: false });
    });
});

describe('the answer', () => {
    it('refuses the whole answer when one entry is wrong, writing nothing', async () => {
        writeSources();
        writeMod('user', sourceManifest('radio', ['station']));
        fresh();
        const refusals: Array<[unknown, string]> = [
            [null, 'sources-onboarding-invalid'],
            [['kugou'], 'sources-onboarding-invalid'],
            [{ kugou: 'disabled', 'folium.radio.station': 'disabled' }, 'source-not-built-in:folium.radio.station'],
            [{ nowhere: 'enabled' }, 'source-not-built-in:nowhere'],
            [{ kugou: 'off' }, 'unknown-source-state:off'],
            // Only a built-in copy whose manifest keeps it for matching may be 'matching'.
            [{ netease: 'matching', kugou: 'matching' }, 'source-cannot-match-only:kugou'],
            // A short id the host still registers itself (no built-in mod here) has no manifest to keep it.
            [{ ytm: 'matching' }, 'source-cannot-match-only:ytm'],
        ];
        for (const [choices, error] of refusals) {
            expect(await invoke(IPC.answerSourcesOnboarding, choices)).toEqual({ ok: false, error });
        }
        expect(persisted.get('mods.sourceStates')).toBeUndefined();
        expect(persisted.get(ONBOARDING_KEY)).toBe('pending');
    });

    it('writes every state, records the page as answered and reloads only what changed', async () => {
        writeSources();
        fresh();
        expect(modRecord('kugou')).toBeUndefined();
        const answer = await invoke(IPC.answerSourcesOnboarding, {
            netease: 'matching', qq: 'enabled', kugou: 'disabled', ytm: 'disabled',
        }) as { ok: boolean; states: Record<string, string> };
        expect(answer.ok).toBe(true);
        expect(answer.states).toMatchObject({ netease: 'matching', qq: 'enabled', kugou: 'disabled', ytm: 'disabled' });
        expect(persisted.get('mods.sourceStates')).toEqual({ netease: 'matching', qq: 'enabled', kugou: 'disabled', ytm: 'disabled' });
        expect(persisted.get(ONBOARDING_KEY)).toBe('done');
        // The disabled one never ran; the enabled one and the one used only for matching start, main entries too.
        expect(modRecord('kugou')).toBeUndefined();
        expect(modRecord('qq')).toMatchObject({ activations: 1, deactivations: 0 });
        expect(modRecord('netease')).toMatchObject({ activations: 1, deactivations: 0 });

        expect(await invoke(IPC.sourceStates)).toMatchObject({ sourcesOnboarding: false });
        expect(await invoke(IPC.answerSourcesOnboarding, { kugou: 'enabled' })).toEqual({ ok: false, error: 'sources-onboarding-not-owed' });
        expect(persisted.get('mods.sourceStates')).toMatchObject({ kugou: 'disabled' });
    });

    it('a source switched while the page is still owed counts as the answer, so the sources run again', async () => {
        writeSources();
        fresh();
        expect(modRecord('kugou')).toBeUndefined();
        const answer = await invoke(IPC.setSourceState, 'netease', 'matching') as { ok: boolean };
        expect(answer.ok).toBe(true);
        expect(persisted.get(ONBOARDING_KEY)).toBe('done');
        // The one switched runs by its state; the ones nobody switched have no record and run enabled.
        expect(modRecord('netease')).toMatchObject({ activations: 1 });
        expect(modRecord('kugou')).toMatchObject({ activations: 1 });
        expect(await invoke(IPC.sourceStates)).toMatchObject({ sourcesOnboarding: false });
    });

    it('stays answered on the next start of the same profile', async () => {
        writeSources();
        fresh();
        await invoke(IPC.answerSourcesOnboarding, { kugou: 'disabled' });
        fresh();
        expect(persisted.get(ONBOARDING_KEY)).toBe('done');
        expect(await invoke(IPC.sourceStates)).toMatchObject({ sourcesOnboarding: false, states: expect.objectContaining({ kugou: 'disabled' }) });
    });
});
