import { takePersonalFmLanding } from '@/components/app/playback/start/personalFmLanding';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryHomePort } from '@/library/app/createLibraryHomePort';
import { createLibraryHomeActions } from '@/library/core/home/libraryHomeActions.service';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { selectActiveStation, selectProviderPersonalFm, usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import type { HomeSurfaceProps } from '@/components/app/home/homeSurfaceTypes';
import type { SongResult } from '@/types';
import { noteQueueStart } from '@/components/app/playback/start/queueStarts';
import { noteWholeQueueWrite } from '@/services/wholeQueueWrites';

// Card requests that lose their provider during either await must never request or play the new provider's stream.
const api = vi.hoisted(() => ({ getPersonalFm: vi.fn(), getPersonalFmCatalog: vi.fn(), getPersonalFmStationCatalog: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: api }));
vi.mock('@/services/localMusicService', () => ({ importFolder: vi.fn(), resyncAllFolders: vi.fn(), LOCAL_MUSIC_SCAN_PROGRESS_EVENT: 'scan' }));
vi.mock('@/services/localPlaylistFileService', () => ({ importLocalPlaylistFile: vi.fn() }));
const selection = { mode: 'SCENE_RCMD' as const, scene: '33' };
const catalog = { ...DEFAULT_PERSONAL_FM_CATALOG, scenes: [{ id: '33', category: 'activity', labelKey: '', labelFallback: 'Driving', keywords: [] }] };
const stationCatalog = { ...catalog, modes: catalog.modes.filter(entry => entry.id === 'DEFAULT' || entry.id === 'SCENE_RCMD') };
const stationCard = { mode: 'DEFAULT' as const, scene: null, station: 'radio' };
const songs = [{ id: 's1' }] as SongResult[];
const explore = { mode: 'EXPLORE' as const, scene: null };
const familiar = { mode: 'FAMILIAR' as const, scene: null };
const selected = () => selectProviderPersonalFm(usePersonalFmModeStore.getState(), 'qishui');
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const setup = () => {
    const play = vi.fn();
    const port = createLibraryHomePort(() => ({ localSongs: [], onRefreshLocalSongs: vi.fn(), onPlaySong: play }) as unknown as HomeSurfaceProps);
    return { port, play, actions: createLibraryHomeActions(port) };
};
beforeEach(() => {
    vi.clearAllMocks();
    useOnlineProviderAccountStore.setState({ activeProviderId: 'qishui' });
    usePersonalFmModeStore.setState({ catalogs: {}, providerSelections: {}, stations: {}, stationCatalogs: {}, fmRuns: {} });
    api.getPersonalFmCatalog.mockResolvedValue(catalog);
    api.getPersonalFmStationCatalog.mockResolvedValue(stationCatalog);
    api.getPersonalFm.mockResolvedValue(songs);
});
describe('home radio provider binding', () => {
    it('only plays the latest FM click across independent home and Lattice ports', async () => {
        const olderSongs = deferred<SongResult[]>();
        const newerSongs = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(olderSongs.promise).mockReturnValueOnce(newerSongs.promise);
        const lattice = setup();
        const home = setup();
        lattice.play.mockImplementation(() => noteQueueStart());
        home.play.mockImplementation(() => noteQueueStart());
        const earlier = lattice.actions.openOnlineCard({ id: 'station-radio', name: 'For you', type: 'radio',
            raw: { personalFm: stationCard } }, 'qishui', vi.fn());
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        const latest = home.actions.playPersonalFm();
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(2));
        olderSongs.resolve(songs);
        await earlier;
        const accepted = [{ id: 'latest' }] as SongResult[];
        newerSongs.resolve(accepted);
        await latest;
        expect(lattice.play).not.toHaveBeenCalled();
        expect(home.play).toHaveBeenCalledExactlyOnceWith(accepted[0], accepted, true);
    });

    it.each(['empty songs', 'rejected catalogue'] as const)('restores the original mode across ports after the latest %s', async outcome => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const olderSongs = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(olderSongs.promise);
        const lattice = setup();
        const home = setup();
        const earlier = lattice.port.getPersonalFm(selection, 'qishui');
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        expect(selected()).toEqual(selection);
        if (outcome === 'rejected catalogue') {
            api.getPersonalFmCatalog.mockRejectedValueOnce(new Error('latest catalogue failed'));
            await expect(home.port.getPersonalFm(familiar, 'qishui')).rejects.toThrow('latest catalogue failed');
        } else {
            api.getPersonalFm.mockResolvedValueOnce([]);
            expect(await home.port.getPersonalFm(familiar, 'qishui')).toEqual([]);
        }
        olderSongs.resolve(songs);
        expect(await earlier).toEqual([]);
        expect(selected()).toEqual(explore);
    });

    it('silences an earlier port rejection after a newer port owns the radio request', async () => {
        const olderSongs = deferred<SongResult[]>();
        const newerSongs = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(olderSongs.promise).mockReturnValueOnce(newerSongs.promise);
        const lattice = setup();
        const home = setup();
        const earlier = lattice.port.getPersonalFm(stationCard, 'qishui');
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        const latest = home.port.getPersonalFm(undefined, 'qishui');
        olderSongs.reject(new Error('old request failed'));
        newerSongs.resolve(songs);
        await expect(earlier).resolves.toEqual([]);
        await expect(latest).resolves.toEqual(songs);
    });

    it.each(['queue', 'replacement', 'selection'] as const)('does not inherit an obsolete rollback mode across ports after a %s change', async change => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const earlier = setup().port.getPersonalFm(selection, 'qishui');
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        if (change === 'queue') noteQueueStart();
        else if (change === 'replacement') noteWholeQueueWrite();
        else usePersonalFmModeStore.getState().setProviderSelection('qishui', familiar);
        const keptSelection = selected();
        api.getPersonalFm.mockResolvedValueOnce([]);
        expect(await setup().port.getPersonalFm({ mode: 'DEFAULT', scene: null }, 'qishui')).toEqual([]);
        pending.resolve(songs);
        expect(await earlier).toEqual([]);
        expect(selected()).toEqual(keptSelection);
    });

    it('keeps a mode chosen while the newer port waits for its catalogue when that request is empty', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const olderSongs = deferred<SongResult[]>();
        const newerCatalog = deferred<typeof catalog>();
        api.getPersonalFm.mockReturnValueOnce(olderSongs.promise).mockResolvedValueOnce([]);
        api.getPersonalFmCatalog.mockResolvedValueOnce(catalog).mockReturnValueOnce(newerCatalog.promise);
        const earlier = setup().port.getPersonalFm(selection, 'qishui');
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        const latest = setup().port.getPersonalFm(familiar, 'qishui');
        const chosenElsewhere = { mode: 'DEFAULT' as const, scene: null };
        usePersonalFmModeStore.getState().setProviderSelection('qishui', chosenElsewhere);
        newerCatalog.resolve(catalog);
        expect(await latest).toEqual([]);
        olderSongs.resolve(songs);
        expect(await earlier).toEqual([]);
        expect(selected()).toEqual(chosenElsewhere);
    });

    it('keeps the active port request when a stale card names another provider', async () => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const earlier = setup().port.getPersonalFm(undefined, 'qishui');
        expect(await setup().port.getPersonalFm(selection, 'netease')).toEqual([]);
        pending.resolve(songs);
        expect(await earlier).toEqual(songs);
        expect(api.getPersonalFm).toHaveBeenCalledTimes(1);
    });

    it('restores the original mode when a newer port cannot obtain the station catalogue', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const earlier = setup().port.getPersonalFm(selection, 'qishui');
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        api.getPersonalFmStationCatalog.mockResolvedValueOnce(null);
        expect(await setup().port.getPersonalFm(stationCard, 'qishui')).toEqual([]);
        pending.resolve(songs);
        expect(await earlier).toEqual([]);
        expect(selected()).toEqual(explore);
    });

    it('routes a displayed preview ticket through Omni on every explicit start, playing the preview first', async () => {
        const { actions, play } = setup();
        const open = vi.fn();
        const card = { id: 'station-radio', name: 'For you', type: 'radio' as const,
            raw: { personalFm: stationCard, songPreview: { playbackToken: 'displayed-batch' } } };
        await actions.openOnlineCard(card, 'qishui', open);
        await actions.openOnlineCard(card, 'qishui', open);
        expect(api.getPersonalFm).toHaveBeenCalledTimes(2);
        expect(api.getPersonalFm).toHaveBeenLastCalledWith({ mode: 'DEFAULT', submode: null, station: 'radio', previewToken: 'displayed-batch' });
        expect(play).toHaveBeenCalledTimes(2);
        expect(play).toHaveBeenLastCalledWith(songs[0], songs, true);
        expect(open).not.toHaveBeenCalled();
    });

    it('discards songs from an earlier card while the newer scene is still loading', async () => {
        const first = deferred<SongResult[]>();
        const second = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const { actions, play } = setup();
        const open = () => actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        const earlier = open();
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        const latest = open();
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(2));
        first.resolve(songs);
        await earlier;
        expect(play).not.toHaveBeenCalled();
        const latestSongs = [{ id: 's2' }] as SongResult[];
        second.resolve(latestSongs);
        await latest;
        expect(play).toHaveBeenCalledExactlyOnceWith(latestSongs[0], latestSongs, true);
    });
    it('does not restore an earlier card when the latest scene returns no songs', async () => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
        const { actions, play } = setup();
        const open = () => actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const earlier = open();
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        await open();
        pending.resolve(songs);
        await earlier;
        expect(play).not.toHaveBeenCalled();
        // Neither card played its scene: the mode from before the first one is back.
        expect(selected()).toEqual(explore);
    });
    it('puts the earlier selection back when the scene returns no songs', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        api.getPersonalFm.mockResolvedValueOnce([]);
        const { port } = setup();
        expect(await port.getPersonalFm(selection)).toEqual([]);
        expect(selected()).toEqual(explore);
    });
    it('puts the earlier selection back when the songs fail to come', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        api.getPersonalFm.mockRejectedValueOnce(new Error('network'));
        const { port } = setup();
        await expect(port.getPersonalFm(selection)).rejects.toThrow('network');
        expect(selected()).toEqual(explore);
    });
    it('keeps a mode picked elsewhere while the scene was loading, though the scene returns nothing', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const { port } = setup();
        const result = port.getPersonalFm(selection);
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        usePersonalFmModeStore.getState().setProviderSelection('qishui', familiar);
        pending.resolve([]);
        expect(await result).toEqual([]);
        expect(selected()).toEqual(familiar);
    });
    it('discards an earlier catalogue before it can overwrite the newer selection', async () => {
        const pending = deferred<typeof catalog>();
        api.getPersonalFmCatalog.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(catalog);
        const { port } = setup();
        const earlier = port.getPersonalFm(selection);
        await port.getPersonalFm({ mode: 'DEFAULT', scene: null });
        pending.resolve(catalog);
        expect(await earlier).toEqual([]);
        expect(api.getPersonalFm).toHaveBeenCalledTimes(1);
        expect(usePersonalFmModeStore.getState().providerSelections.qishui).toEqual({ mode: 'DEFAULT', scene: null });
    });
    it('keeps a selected scene and starts its own stream when the provider stays put', async () => {
        const { port } = setup();
        expect(await port.getPersonalFm(selection)).toEqual(songs);
        expect(api.getPersonalFm).toHaveBeenCalledWith({ mode: 'SCENE_RCMD', submode: '33' });
    });
    it('abandons the scene before requesting songs if its catalogue returns after a provider switch', async () => {
        const pending = deferred<typeof catalog>();
        api.getPersonalFmCatalog.mockReturnValue(pending.promise);
        const { port } = setup();
        const result = port.getPersonalFm(selection);
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        pending.resolve(catalog);
        expect(await result).toEqual([]);
        expect(api.getPersonalFm).not.toHaveBeenCalled();
        expect(usePersonalFmModeStore.getState().providerSelections).toEqual({});
    });
    it('does not play a scene whose songs return after a provider switch', async () => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValue(pending.promise);
        const { actions, play } = setup();
        const result = actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        pending.resolve(songs);
        await result;
        expect(play).not.toHaveBeenCalled();
    });
    it.each([
        ['another queue started (a mode switch that played first, a playlist)', () => noteQueueStart()],
        ['the queue was replaced whole', () => noteWholeQueueWrite()],
    ])('does not play a scene whose songs return after %s', async (_what, during) => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValue(pending.promise);
        const { actions, play } = setup();
        const result = actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        during();
        pending.resolve(songs);
        await result;
        expect(play).not.toHaveBeenCalled();
    });
    it('does not reinterpret a stale card as belonging to the new provider', async () => {
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        const { actions, play } = setup();
        await actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        expect(api.getPersonalFmCatalog).not.toHaveBeenCalled();
        expect(api.getPersonalFm).not.toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
    });
});
describe('home radio stations', () => {
    const active = () => selectActiveStation(usePersonalFmModeStore.getState(), 'qishui');
    const otherSongs = [{ id: 'other' }] as SongResult[];
    /** The play landed: the queue is on air as FM, its first song current. */
    const land = (queue: SongResult[]) => {
        usePlaybackStore.setState({ isFmMode: true, currentSong: queue[0], playQueue: queue });
        takePersonalFmLanding(queue)?.();
    };
    /** A card clicked, its songs fetched and handed to the player (which may or may not land them). */
    const launch = async (port: ReturnType<typeof setup>['port'], card?: Parameters<typeof port.getPersonalFm>[0]) => {
        const got = await port.getPersonalFm(card);
        if (got.length > 0) port.playPersonalFm(got[0], got);
        return got;
    };
    beforeEach(() => {
        usePlaybackStore.setState({ isFmMode: false, currentSong: null, playQueue: [] });
    });
    it('starts a station with its own catalogue, and puts it on air once its songs play', async () => {
        const { port, play } = setup();
        await launch(port, stationCard);
        expect(api.getPersonalFmStationCatalog).toHaveBeenCalledWith('qishui', 'radio');
        expect(api.getPersonalFm).toHaveBeenCalledWith({ mode: 'DEFAULT', submode: null, station: 'radio' });
        expect(play).toHaveBeenCalledWith(songs[0], songs, true);
        // Not before the player took the songs.
        expect(active()).toBeNull();
        land(songs);
        expect(active()).toEqual({ id: 'radio', selection: { mode: 'DEFAULT', scene: null } });
    });
    it('keeps the stored Personal FM mode, and stores nothing of the station', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const { port } = setup();
        await launch(port, { mode: 'SCENE_RCMD', scene: '33', station: 'radio' });
        land(songs);
        expect(selected()).toEqual(explore);
        expect(usePersonalFmModeStore.getState().providerSelections).toEqual({ qishui: explore });
        expect(api.getPersonalFmCatalog).not.toHaveBeenCalled();
        expect(active()?.selection).toEqual({ mode: 'SCENE_RCMD', scene: '33' });
    });
    it('puts nothing on air when the provider has no such radio, or it returns no songs', async () => {
        const { port } = setup();
        api.getPersonalFmStationCatalog.mockResolvedValueOnce(null);
        expect(await launch(port, stationCard)).toEqual([]);
        expect(api.getPersonalFm).not.toHaveBeenCalled();
        api.getPersonalFm.mockResolvedValueOnce([]);
        expect(await launch(port, stationCard)).toEqual([]);
        land(otherSongs);
        expect(active()).toBeNull();
    });
    it('leaves the radio on air when its play was cancelled (a mod’s beforePlay)', async () => {
        const { port } = setup();
        await launch(port, stationCard);
        land(songs);
        // Another radio's songs come, but the player never takes them: the first radio still plays.
        api.getPersonalFm.mockResolvedValueOnce(otherSongs);
        await launch(port, { ...stationCard, station: 'radio2' });
        land([...songs, { id: 's9' } as SongResult]);
        expect(active()?.id).toBe('radio');
        // Nor does the Personal FM card take it off air when its play is cancelled.
        api.getPersonalFm.mockResolvedValueOnce(otherSongs);
        await launch(port);
        land([...songs, { id: 's10' } as SongResult]);
        expect(active()?.id).toBe('radio');
    });
    it('gives up the radio of a play when another queue starts before it lands', async () => {
        const { port } = setup();
        await launch(port, stationCard);
        noteQueueStart();
        // An overtaken play never invokes its landing callback.
        expect(active()).toBeNull();
    });
    it('ends the radio once the Personal FM, or a scene of it, plays', async () => {
        const { port } = setup();
        await launch(port, stationCard);
        land(songs);
        api.getPersonalFm.mockResolvedValueOnce(otherSongs);
        await launch(port, selection);
        expect(api.getPersonalFm).toHaveBeenLastCalledWith({ mode: 'SCENE_RCMD', submode: '33' });
        expect(active()?.id).toBe('radio');
        land(otherSongs);
        expect(active()).toBeNull();
    });
    it('does not put a radio on air for a card overtaken meanwhile', async () => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const { port } = setup();
        const result = launch(port, stationCard);
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        noteQueueStart();
        pending.resolve(songs);
        expect(await result).toEqual([]);
        land(songs);
        expect(active()).toBeNull();
    });
});
