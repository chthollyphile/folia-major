import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hooks/usePersonalFmModeController.test.ts
// 和 useProviderLogin.test.ts 同样的做法：仓库的 vitest 跑在 node 环境，没有 jsdom 也没有
// testing-library，为一个 hook 引进整套渲染依赖并不值得。被测 hook 用到 useCallback / useMemo / useRef，
// 就地复刻它们即可驱动真实实现。

// The nth ref of every render is the same one, as React keeps it: `render` starts the count again.
const refs = vi.hoisted(() => ({ slots: [] as Array<{ current: unknown }>, at: 0 }));
vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    // Effects run at once, each render: enough for one that only reacts to FM going off air.
    useEffect: (effect: () => void) => { effect(); },
    useMemo: (factory: () => unknown) => factory(),
    useRef: (current: unknown) => {
        refs.slots[refs.at] ??= { current };
        refs.at += 1;
        return refs.slots[refs.at - 1];
    },
}));

const omniMock = vi.hoisted(() => ({
    getPersonalFm: vi.fn(),
    getProviderCapabilities: vi.fn(() => ({ personalFmModes: true })),
}));
vi.mock('../../../src/services/onlineMusic/omni', () => ({ omni: omniMock }));
vi.mock('../../../src/hooks/usePersonalFmCatalog', async () => {
    const { DEFAULT_PERSONAL_FM_CATALOG } = await import('../../../src/services/onlineMusic/fmModes');
    return { usePersonalFmCatalog: () => DEFAULT_PERSONAL_FM_CATALOG, usePersonalFmStationCatalog: () => DEFAULT_PERSONAL_FM_CATALOG };
});

const storeMock = vi.hoisted(() => ({
    selection: { mode: 'DEFAULT', scene: null } as { mode: string; scene: string | null },
    setSelection: vi.fn(),
    setProviderSelection: vi.fn(),
    /** The extra radio on air, if any: its choice lives apart from the stored Personal FM mode. */
    station: null as null | { id: string; selection: { mode: string; scene: string | null } },
    setStationSelection: vi.fn(),
    /** Streams a card put on air for the provider; a mode switch from an earlier one is not put back over a later one. */
    run: 0,
    resetStationSelections: vi.fn(),
}));
vi.mock('../../../src/stores/usePersonalFmModeStore', () => ({
    selectProviderPersonalFm: (state: typeof storeMock) => state.selection,
    selectActiveStation: (state: typeof storeMock) => state.station,
    selectFmRun: (state: typeof storeMock) => state.run,
    usePersonalFmModeStore: Object.assign((selector: (state: typeof storeMock) => unknown) => selector(storeMock), { getState: () => storeMock }),
}));
vi.mock('../../../src/stores/useOnlineProviderAccountStore', () => ({
    useOnlineProviderAccountStore: Object.assign((selector: (state: { activeProviderId: string }) => unknown) => selector({ activeProviderId: 'netease' }),
        { getState: () => ({ activeProviderId: 'netease' }) }),
}));
const playbackMock = vi.hoisted(() => ({ isFmMode: true, playQueue: [] as unknown[] }));
vi.mock('../../../src/stores/usePlaybackStore', () => ({ usePlaybackStore: { getState: () => playbackMock } }));

const { usePersonalFmModeController } = await import('../../../src/hooks/usePersonalFmModeController');
const { useStatusMessageStore } = await import('../../../src/stores/useStatusMessageStore');
const { noteQueueStart } = await import('../../../src/components/app/playback/start/queueStarts');
const { noteWholeQueueWrite } = await import('../../../src/services/wholeQueueWrites');
const { takePersonalFmLanding } = await import('../../../src/components/app/playback/start/personalFmLanding');

const SONGS = [
    { id: 1, name: 'First' },
    { id: 2, name: 'Second' },
] as never[];

const CURRENT_SONG = { id: 99, name: 'On air' } as never;

const createController = (overrides: { isFmMode?: boolean; currentSong?: unknown } = {}) => {
    const playSong = vi.fn();
    /** One render of the hook, with the refs of the renders before it. */
    const render = () => {
        refs.at = 0;
        return usePersonalFmModeController({
            isFmMode: overrides.isFmMode ?? true,
            currentSong: (overrides.currentSong === undefined ? CURRENT_SONG : overrides.currentSong) as never,
            playSong,
            t: (_key: string, fallback?: string) => fallback ?? '',
        });
    };
    return { controller: render(), render, playSong };
};

beforeEach(() => {
    refs.slots.length = 0;
    playbackMock.isFmMode = true;
    playbackMock.playQueue = [];
    useStatusMessageStore.setState({ message: null });
    storeMock.selection = { mode: 'DEFAULT', scene: null };
    storeMock.station = null;
    storeMock.run = 0;
    storeMock.resetStationSelections.mockReset();
    storeMock.setStationSelection.mockReset();
    storeMock.setStationSelection.mockImplementation((_id, selection: { mode: string; scene: string | null }) => {
        if (storeMock.station) storeMock.station = { ...storeMock.station, selection };
        return selection;
    });
    storeMock.setSelection.mockReset();
    storeMock.setProviderSelection.mockReset();
    storeMock.setProviderSelection.mockImplementation((_id, selection) => storeMock.setSelection(selection));
    storeMock.setSelection.mockImplementation((selection: typeof storeMock.selection) => {
        storeMock.selection = selection;
        return selection;
    });
    omniMock.getPersonalFm.mockReset();
    omniMock.getPersonalFm.mockResolvedValue(SONGS);
});

describe('usePersonalFmModeController', () => {
    it('jumps straight to the first track of the new mode', async () => {
        const { controller, playSong } = createController();

        await controller.setPersonalFmSelection({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });

        expect(omniMock.getPersonalFm).toHaveBeenCalledWith({ mode: 'SCENE_RCMD', submode: 'SLEEP_HELP' });
        expect(playSong).toHaveBeenCalledWith(SONGS[0], SONGS, true);
    });

    it('only records the mode when Personal FM is not on air', async () => {
        const { controller, playSong } = createController({ isFmMode: false });

        await controller.setPersonalFmSelection({ mode: 'EXPLORE', scene: null });

        expect(storeMock.setSelection).toHaveBeenCalledWith({ mode: 'EXPLORE', scene: null });
        expect(omniMock.getPersonalFm).not.toHaveBeenCalled();
        expect(playSong).not.toHaveBeenCalled();
    });

    it('does not refetch when the same mode is picked again', async () => {
        storeMock.selection = { mode: 'EXPLORE', scene: null };
        const { controller, playSong } = createController();

        await controller.setPersonalFmSelection({ mode: 'EXPLORE', scene: null });

        expect(omniMock.getPersonalFm).not.toHaveBeenCalled();
        expect(playSong).not.toHaveBeenCalled();
    });

    it('keeps the current track when the new mode returns nothing', async () => {
        omniMock.getPersonalFm.mockResolvedValue([]);
        const { controller, playSong } = createController();

        await controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });

        expect(playSong).not.toHaveBeenCalled();
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error' });
        expect(storeMock.selection).toEqual({ mode: 'DEFAULT', scene: null });
    });

    it('puts the earlier mode back when the request fails', async () => {
        omniMock.getPersonalFm.mockRejectedValue(new Error('network'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { controller, playSong } = createController();

        await controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });

        expect(playSong).not.toHaveBeenCalled();
        expect(storeMock.selection).toEqual({ mode: 'DEFAULT', scene: null });
    });

    it('keeps a scene a home card stored while the request was in flight, though the mode returns nothing', async () => {
        let release!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const { controller } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });
        storeMock.selection = { mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' };
        release([] as never[]);
        await pending;
        expect(storeMock.selection).toEqual({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
    });

    it('puts back the mode from before an overtaken switch when the newer one returns nothing', async () => {
        let releaseFirst!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm
            .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; }))
            .mockResolvedValueOnce([]);
        const { controller, render, playSong } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });
        // The render after the first switch, which stored its mode.
        await render().setPersonalFmSelection({ mode: 'EXPLORE', scene: null });
        releaseFirst(SONGS);
        await pending;
        expect(playSong).not.toHaveBeenCalled();
        expect(storeMock.selection).toEqual({ mode: 'DEFAULT', scene: null });
    });

    it('hides itself when the active provider has no FM modes', () => {
        omniMock.getProviderCapabilities.mockReturnValueOnce({ personalFmModes: false });
        const { controller } = createController();
        expect(controller.isPersonalFmModeSupported).toBe(false);
    });

    it('leaves a playlist started while a mode request was in flight on air', async () => {
        let release!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const { controller, playSong } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });
        playbackMock.isFmMode = false;
        playbackMock.playQueue = ['a deliberately selected playlist'];
        release(SONGS);
        await pending;
        expect(playSong).not.toHaveBeenCalled();
    });

    /** A mode request held until `release`, with `during` run while it waits. */
    const switchWhile = async (during: () => void) => {
        let release!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const { controller, playSong } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });
        during();
        release(SONGS);
        await pending;
        return playSong;
    };

    it('still switches when the next song of the stream lands while the request is in flight', async () => {
        // Every landing writes the queue anew (the song with its address, a top-up after it).
        const playSong = await switchWhile(() => {
            playbackMock.playQueue = ['the same stream, written anew'];
        });
        expect(playSong).toHaveBeenCalledWith(SONGS[0], SONGS, true);
    });

    it('leaves a queue started while the request was in flight on air, even before FM was turned off', async () => {
        const playSong = await switchWhile(() => noteQueueStart());
        expect(playSong).not.toHaveBeenCalled();
    });

    it('leaves a queue replaced whole while the request was in flight as it is', async () => {
        const playSong = await switchWhile(() => noteWholeQueueWrite());
        expect(playSong).not.toHaveBeenCalled();
    });

    it('discards an older mode response after a newer mode has been picked', async () => {
        let release!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const { controller, playSong } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });
        await controller.setPersonalFmSelection({ mode: 'EXPLORE', scene: null });
        release(SONGS);
        await pending;
        expect(playSong).toHaveBeenCalledTimes(1);
    });
});

describe('usePersonalFmModeController with an extra radio on air', () => {
    const onAir = (selection = { mode: 'DEFAULT', scene: null as string | null }) => {
        storeMock.station = { id: 'radio', selection };
    };

    it('shows the choice of the radio, and offers modes without the provider flag', () => {
        onAir({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
        storeMock.selection = { mode: 'EXPLORE', scene: null };
        omniMock.getProviderCapabilities.mockReturnValueOnce({ personalFmModes: false });
        const { controller } = createController();
        expect(controller.personalFmSelection).toEqual({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
        expect(controller.isPersonalFmModeSupported).toBe(true);
        expect(controller.personalFmStation).toBe('radio');
    });

    it('keeps to the stored Personal FM mode when FM is not on air', () => {
        onAir({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
        const { controller } = createController({ isFmMode: false });
        expect(controller.personalFmSelection).toEqual({ mode: 'DEFAULT', scene: null });
        expect(controller.personalFmStation).toBeNull();
    });

    it('keeps the radio mode until its new batch lands', async () => {
        onAir();
        const { controller, playSong } = createController();

        await controller.setPersonalFmSelection({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });

        expect(storeMock.setStationSelection).not.toHaveBeenCalled();
        expect(storeMock.station?.selection).toEqual({ mode: 'DEFAULT', scene: null });
        expect(storeMock.setProviderSelection).not.toHaveBeenCalled();
        expect(omniMock.getPersonalFm).toHaveBeenCalledWith({ mode: 'SCENE_RCMD', submode: 'SLEEP_HELP', station: 'radio' });
        expect(playSong).toHaveBeenCalledWith(SONGS[0], SONGS, true);
        takePersonalFmLanding(SONGS)?.();
        expect(storeMock.setStationSelection).toHaveBeenCalledWith('netease', { mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
    });

    it('keeps the original radio mode when beforePlay cancels the batch', async () => {
        onAir();
        const { controller } = createController();
        await controller.setPersonalFmSelection({ mode: 'FAMILIAR', scene: null });
        expect(storeMock.station?.selection).toEqual({ mode: 'DEFAULT', scene: null });
        expect(storeMock.setStationSelection).not.toHaveBeenCalled();
        takePersonalFmLanding(SONGS);
    });

    it('puts the earlier choice of the radio back when the mode returns nothing', async () => {
        onAir();
        omniMock.getPersonalFm.mockResolvedValue([]);
        const { controller, playSong } = createController();

        await controller.setPersonalFmSelection({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });

        expect(playSong).not.toHaveBeenCalled();
        expect(storeMock.station?.selection).toEqual({ mode: 'DEFAULT', scene: null });
    });

    it('does not play the songs of a radio that went off air meanwhile', async () => {
        onAir();
        let release!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const { controller, playSong } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
        storeMock.station = null;
        release(SONGS);
        await pending;
        expect(playSong).not.toHaveBeenCalled();
    });
});

describe('usePersonalFmModeController across streams', () => {
    it('does not put the mode of an earlier stream back over the one a card put on air meanwhile', async () => {
        // A radio on air in FAMILIAR; a switch in it waits for its songs.
        storeMock.station = { id: 'radio', selection: { mode: 'FAMILIAR', scene: null } };
        let release!: (songs: typeof SONGS) => void;
        omniMock.getPersonalFm
            .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
            .mockResolvedValueOnce([]);
        const { controller, render } = createController();
        const pending = controller.setPersonalFmSelection({ mode: 'EXPLORE', scene: null });
        // The Personal FM card plays meanwhile: a new stream, with its own stored mode.
        noteQueueStart();
        storeMock.station = null;
        storeMock.run = 1;
        // A switch in the Personal FM that brings nothing puts back the Personal FM's own mode, not the radio's.
        await render().setPersonalFmSelection({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
        expect(storeMock.selection).toEqual({ mode: 'DEFAULT', scene: null });
        release(SONGS);
        await pending;
        expect(storeMock.selection).toEqual({ mode: 'DEFAULT', scene: null });
    });


});
