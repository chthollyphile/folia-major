import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModSourceStateRow } from '@/mods/types';

// test/unit/components/sourcesOnboarding.test.ts
// Folium 2.0 S8, the window's half of the start prompt's sources page (dev/folium/folium-2-plan.md §5.3): which rows
// it lists (built-in copies, never a takeover or a third-party source), what each tick means (ticked → enabled,
// unticked and kept for matching → matching, else disabled; none ticked included), and that the answer is read and
// handed over once, never in the web build.

const ipc = vi.hoisted(() => ({
    getSourceStates: vi.fn(),
    invokeAnswerSourcesOnboarding: vi.fn(),
    invokeSetSourceState: vi.fn(),
}));
vi.mock('@/mods/ipc', () => ipc);
vi.mock('@/mods/runtime/sourceSwitches', () => ({ stopPlaybackOfSources: vi.fn(async () => {}) }));

const row = (sourceId: string, extra: Partial<ModSourceStateRow> = {}): ModSourceStateRow => ({
    sourceId,
    modId: sourceId,
    tier: 'builtin',
    state: 'enabled',
    keepForMatching: false,
    takeover: false,
    loaded: true,
    mainState: 'ready',
    ...extra,
});

// The nine as a fresh install lists them: two kept for matching, one still registered by the host.
const NINE: ModSourceStateRow[] = [
    row('netease', { keepForMatching: true }),
    row('qq', { keepForMatching: true }),
    row('kugou'), row('bodian'), row('qishui'), row('spotify'), row('appleMusic'), row('fnmusic'),
    row('ytm', { modId: null, tier: 'host' }),
];

const load = async () => {
    vi.resetModules();
    return import('@/components/modal/playback-entry-view/sourcesOnboarding');
};

beforeEach(() => {
    ipc.getSourceStates.mockReset();
    ipc.invokeAnswerSourcesOnboarding.mockReset();
    ipc.invokeSetSourceState.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the rows the page lists', () => {
    it('lists the built-in copies and their overrides, never a takeover or a third-party source', async () => {
        const { pickOnboardingSources } = await load();
        const listed = pickOnboardingSources([
            ...NINE,
            row('folium.radio.station', { modId: 'radio', tier: 'user' }),
            row('kuwo', { modId: 'kuwo-mod', tier: 'user', takeover: true }),
            row('spotify', { tier: 'override' }),
        ]);
        expect(listed.map(source => source.sourceId)).toEqual([...NINE.map(source => source.sourceId), 'spotify']);
        expect(listed.filter(source => source.keepForMatching).map(source => source.sourceId)).toEqual(['netease', 'qq']);
    });

    it("carries each source's manifest name, since its mod does not run before the page is answered", async () => {
        const { pickOnboardingSources } = await load();
        const listed = pickOnboardingSources([
            row('kugou', { name: { 'zh-CN': '酷狗音乐', en: 'KuGou Music' }, loaded: false, mainState: 'none' }),
            row('ytm', { modId: null, tier: 'host', name: null }),
            row('bodian'),
        ]);
        expect(listed.map(source => source.name)).toEqual([{ 'zh-CN': '酷狗音乐', en: 'KuGou Music' }, null, null]);
    });
});

describe('a source that starts off', () => {
    it("carries the manifest's enableNotice, and is not ticked ahead of the listener: unticked means disabled", async () => {
        const { pickOnboardingSources, resolveSourcesOnboardingChoices } = await load();
        const notice = { en: 'Runs scripts you import.' };
        const sources = pickOnboardingSources([row('bodian'), row('lxmusic', { state: 'disabled', loaded: false, mainState: 'none', enableNotice: notice })]);
        expect(sources.map(source => source.enableNotice)).toEqual([null, notice]);
        expect(resolveSourcesOnboardingChoices(sources, new Set())).toEqual({ bodian: 'disabled', lxmusic: 'disabled' });
        expect(resolveSourcesOnboardingChoices(sources, new Set(['lxmusic']))).toEqual({ bodian: 'disabled', lxmusic: 'enabled' });
    });
});

describe('what the ticks mean', () => {
    it('ticked → enabled; unticked and kept for matching → matching; any other unticked → disabled', async () => {
        const { pickOnboardingSources, resolveSourcesOnboardingChoices } = await load();
        const sources = pickOnboardingSources(NINE);
        expect(resolveSourcesOnboardingChoices(sources, new Set(['qq', 'spotify']))).toEqual({
            netease: 'matching', qq: 'enabled', kugou: 'disabled', bodian: 'disabled', qishui: 'disabled',
            spotify: 'enabled', appleMusic: 'disabled', fnmusic: 'disabled', ytm: 'disabled',
        });
    });

    it('none ticked: the two kept for matching are used only for matching, the other seven are disabled', async () => {
        const { pickOnboardingSources, resolveSourcesOnboardingChoices } = await load();
        const choices = resolveSourcesOnboardingChoices(pickOnboardingSources(NINE), new Set());
        expect(Object.entries(choices).filter(([, state]) => state === 'matching').map(([id]) => id)).toEqual(['netease', 'qq']);
        expect(Object.values(choices).filter(state => state === 'disabled')).toHaveLength(7);
    });
});

describe('reading and answering', () => {
    it('is owed only when the main process says so (never in the web build, which answers empty)', async () => {
        const module = await load();
        ipc.getSourceStates.mockResolvedValue({ states: {}, sources: [], hasSourceMods: false, sourcesOnboarding: false });
        await module.loadSourcesOnboarding();
        expect(module.useSourcesOnboardingStore.getState().status).toBe('none');
        await module.submitSourcesOnboarding();
        expect(ipc.invokeAnswerSourcesOnboarding).not.toHaveBeenCalled();
    });

    it('owed with no built-in source to list: answers with nothing, so the main process stops holding sources back', async () => {
        const module = await load();
        ipc.getSourceStates.mockResolvedValue({
            states: {}, sources: [row('folium.radio.station', { modId: 'radio', tier: 'user' })], hasSourceMods: true, sourcesOnboarding: true,
        });
        ipc.invokeAnswerSourcesOnboarding.mockResolvedValue({ ok: true, states: {}, sources: [] });
        await module.loadSourcesOnboarding();
        expect(module.useSourcesOnboardingStore.getState().status).toBe('none');
        expect(ipc.invokeAnswerSourcesOnboarding).toHaveBeenCalledWith({});
    });

    it('a source switched before the page closed answered it already: the ticks are written as switches', async () => {
        const module = await load();
        ipc.getSourceStates.mockResolvedValue({ states: {}, sources: [row('netease', { keepForMatching: true }), row('kugou')], hasSourceMods: true, sourcesOnboarding: true });
        ipc.invokeAnswerSourcesOnboarding.mockResolvedValue({ ok: false, error: 'sources-onboarding-not-owed' });
        ipc.invokeSetSourceState.mockResolvedValue({ ok: true, states: {}, sources: [] });
        await module.loadSourcesOnboarding();
        module.useSourcesOnboardingStore.getState().toggle('kugou');
        await module.submitSourcesOnboarding();
        expect(ipc.invokeSetSourceState.mock.calls).toEqual([['netease', 'matching'], ['kugou', 'enabled']]);
    });

    it('hands the ticks over once, as the main process wants them', async () => {
        const module = await load();
        ipc.getSourceStates.mockResolvedValue({ states: {}, sources: NINE, hasSourceMods: true, sourcesOnboarding: true });
        ipc.invokeAnswerSourcesOnboarding.mockResolvedValue({ ok: true, states: {}, sources: [] });
        await module.loadSourcesOnboarding();
        const store = module.useSourcesOnboardingStore;
        expect(store.getState().status).toBe('owed');
        expect(store.getState().sources).toHaveLength(9);
        store.getState().toggle('kugou');
        store.getState().toggle('ytm');
        store.getState().toggle('ytm');
        await module.submitSourcesOnboarding();
        expect(ipc.invokeAnswerSourcesOnboarding).toHaveBeenCalledTimes(1);
        expect(ipc.invokeAnswerSourcesOnboarding.mock.calls[0][0]).toMatchObject({ netease: 'matching', qq: 'matching', kugou: 'enabled', ytm: 'disabled' });
        expect(store.getState().status).toBe('none');
        await module.submitSourcesOnboarding();
        expect(ipc.invokeAnswerSourcesOnboarding).toHaveBeenCalledTimes(1);
    });
});
