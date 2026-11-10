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
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
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
