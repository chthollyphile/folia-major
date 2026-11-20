import { takePersonalFmLanding } from '@/components/app/playback/start/personalFmLanding';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryHomePort } from '@/library/app/createLibraryHomePort';
import { createLibraryHomeActions } from '@/library/core/home/libraryHomeActions.service';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { selectActiveStation, selectProviderPersonalFm, usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import type { HomeSurfaceProps } from '@/components/app/home/homeSurfaceTypes';
import { PlayerState, type SongResult } from '@/types';
import { noteQueueStart } from '@/components/app/playback/start/queueStarts';
import { noteWholeQueueWrite } from '@/services/wholeQueueWrites';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

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
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};
const setup = () => {
    const play = vi.fn();
    const status = vi.fn();
    const resume = vi.fn(async () => {});
    const enter = vi.fn();
    const port = createLibraryHomePort(() => ({ localSongs: [], onRefreshLocalSongs: vi.fn(), onPlaySong: play, onResumePlayback: resume, onEnterPlaybackView: enter, onStatusMessage: status }) as unknown as HomeSurfaceProps);
    return { port, play, status, resume, enter, actions: createLibraryHomeActions(port) };
};
beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({ currentSong: null, playQueue: [], acceptedFmPlayback: null, transitionDisplay: null, isFmMode: false, playerState: PlayerState.PLAYING });
    useOnlineProviderAccountStore.setState({ activeProviderId: 'qishui' });
    usePersonalFmModeStore.setState({ catalogs: {}, providerSelections: {}, stations: {}, stationCatalogs: {}, fmRuns: {} });
    api.getPersonalFmCatalog.mockResolvedValue(catalog);
    api.getPersonalFmStationCatalog.mockResolvedValue(stationCatalog);
    api.getPersonalFm.mockResolvedValue(songs);
});
afterEach(() => { vi.restoreAllMocks(); });
describe('home radio provider binding', () => {
    it('routes a displayed preview ticket through Omni on every explicit start', async () => {
        const { actions, play } = setup();
        const card = { id: 'personal_fm', name: 'For you', type: 'radio', raw: {
            personalFm: selection, songPreview: { firstSong: songs[0], playbackToken: 'preview-1' },
        } };
        await actions.openOnlineCard(card, 'qishui', vi.fn());
        await actions.openOnlineCard(card, 'qishui', vi.fn());
        expect(api.getPersonalFm.mock.calls).toEqual([
            [{ mode: 'SCENE_RCMD', submode: '33', previewToken: 'preview-1' }],
            [{ mode: 'SCENE_RCMD', submode: '33', previewToken: 'preview-1' }],
        ]);
        expect(play).toHaveBeenCalledTimes(2);
    });

    it('continues the displayed accepted stream with its current song and original queue', async () => {
        const current = { id: 'current', sourceRef: { kind: 'online', providerId: 'qishui', mediaId: 'current' } } as SongResult;
        const earlier = { ...current, id: 'earlier', sourceRef: { kind: 'online', providerId: 'qishui', mediaId: 'earlier' } } as SongResult;
        const queue = [earlier, current];
        const accepted = { providerId: 'qishui', selection, songKeys: new Set(queue.map(getPlaybackSongKey)) };
        usePlaybackStore.setState({ currentSong: current, playQueue: queue, acceptedFmPlayback: accepted, isFmMode: true });
        const { actions, play, resume, enter } = setup();
        const card = { id: 'personal_fm', name: 'For you', type: 'radio', raw: {
            personalFm: selection, songPreview: { firstSong: earlier, currentSong: current, playbackToken: 'old-preview' },
        } };
        expect(await actions.openOnlineCard(card, 'qishui', vi.fn())).toEqual({ ok: true });
        expect(play).not.toHaveBeenCalled();
        expect(resume).not.toHaveBeenCalled();
        expect(enter).toHaveBeenCalledOnce();
        expect(usePlaybackStore.getState().acceptedFmPlayback).toBe(accepted);
        expect(api.getPersonalFm).not.toHaveBeenCalled();
        expect(api.getPersonalFmCatalog).not.toHaveBeenCalled();

        // A stale current-song face cannot claim an ordinary queue or fall back to the initial ticket.
        usePlaybackStore.setState({ acceptedFmPlayback: null, isFmMode: false });
        expect(await actions.openOnlineCard(card, 'qishui', vi.fn())).toEqual({ ok: false, reason: 'failed' });
        expect(play).not.toHaveBeenCalled();
        expect(api.getPersonalFm).not.toHaveBeenCalled();
    });

    it('silences a pending failed card after the accepted current stream was explicitly continued', async () => {
        const current = { id: 'current', sourceRef: { kind: 'online', providerId: 'qishui', mediaId: 'current' } } as SongResult;
        const queue = [current];
        usePlaybackStore.setState({ currentSong: current, playQueue: queue, acceptedFmPlayback: {
            providerId: 'qishui', selection, songKeys: new Set(queue.map(getPlaybackSongKey)),
        } });
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const { actions, play, status } = setup();
        const earlier = actions.openOnlineCard({ id: 'personal_fm', name: 'For you', type: 'radio', raw: {
            personalFm: familiar, songPreview: { playbackToken: 'other-preview' },
        } }, 'qishui', vi.fn());
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        const continued = setup();
        await continued.actions.openOnlineCard({ id: 'personal_fm', name: 'For you', type: 'radio', raw: {
            personalFm: selection, songPreview: { currentSong: current },
        } }, 'qishui', vi.fn());
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        pending.reject(new Error('superseded card failed'));
        await earlier;
        expect(play).not.toHaveBeenCalled();
        expect(continued.play).not.toHaveBeenCalled();
        expect(continued.resume).not.toHaveBeenCalled();
        expect(selected()).toEqual(selection);
        expect(status).not.toHaveBeenCalled();
        expect(logged).not.toHaveBeenCalled();
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
        const { port, status } = setup();
        expect(await port.getPersonalFm(selection)).toEqual([]);
        expect(selected()).toEqual(explore);
        expect(status).toHaveBeenCalledExactlyOnceWith({ type: 'info', text: expect.any(String) });
    });

    it('does not show an empty-radio message for a request overtaken by a provider switch', async () => {
        const pending = deferred<SongResult[]>();
        api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const { port, status } = setup();
        const result = port.getPersonalFm();
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
        pending.resolve([]);
        expect(await result).toEqual([]);
        expect(status).not.toHaveBeenCalled();
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
    it.each(['catalogue', 'songs'] as const)('silences a rejected %s request after any superseding action', async stage => {
        for (const supersede of ['card', 'queue', 'replacement', 'provider'] as const) {
            useOnlineProviderAccountStore.setState({ activeProviderId: 'qishui' });
            api.getPersonalFmCatalog.mockResolvedValue(catalog);
            api.getPersonalFm.mockResolvedValue(songs);
            const pending = deferred<never>();
            if (stage === 'catalogue') api.getPersonalFmCatalog.mockReturnValueOnce(pending.promise);
            else api.getPersonalFm.mockReturnValueOnce(pending.promise);
            const { actions, play, status } = setup();
            const open = (choice = selection as typeof selection | typeof familiar) => actions.openOnlineCard({
                id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: choice },
            }, 'qishui', vi.fn());
            const earlier = open();
            if (stage === 'catalogue') await vi.waitFor(() => expect(api.getPersonalFmCatalog).toHaveBeenCalled());
            else await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
            if (supersede === 'card') await open(familiar);
            else if (supersede === 'queue') noteQueueStart();
            else if (supersede === 'replacement') noteWholeQueueWrite();
            else useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
            const keptSelection = selected();
            const playCalls = play.mock.calls.length;
            const statusCalls = status.mock.calls.length;
            const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
            pending.reject(new Error(`${stage} failed after ${supersede}`));
            await earlier;
            expect(play).toHaveBeenCalledTimes(playCalls);
            expect(status).toHaveBeenCalledTimes(statusCalls);
            expect(logged).not.toHaveBeenCalled();
            expect(selected()).toEqual(keptSelection);
            logged.mockRestore();
            api.getPersonalFmCatalog.mockClear();
            api.getPersonalFm.mockClear();
        }
    });
    it.each(['catalogue', 'songs'] as const)('reports the current rejected %s request and keeps the previous selection', async stage => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const pending = deferred<never>();
        if (stage === 'catalogue') api.getPersonalFmCatalog.mockReturnValueOnce(pending.promise);
        else api.getPersonalFm.mockReturnValueOnce(pending.promise);
        const { actions, play, status } = setup();
        const result = actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        if (stage === 'catalogue') await vi.waitFor(() => expect(api.getPersonalFmCatalog).toHaveBeenCalled());
        else await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalled());
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        pending.reject(new Error('active request failed'));
        expect(await result).toEqual({ ok: false, reason: 'failed' });
        expect(play).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledExactlyOnceWith({ type: 'error', text: expect.any(String) });
        expect(logged).toHaveBeenCalledTimes(1);
        expect(selected()).toEqual(explore);
    });
    it('restores the original selection when the newest catalogue fails after an older scene was applied', async () => {
        usePersonalFmModeStore.setState({ providerSelections: { qishui: explore } });
        const earlierSongs = deferred<SongResult[]>();
        const latestCatalog = deferred<typeof catalog>();
        api.getPersonalFm.mockReturnValueOnce(earlierSongs.promise);
        api.getPersonalFmCatalog.mockResolvedValueOnce(catalog).mockReturnValueOnce(latestCatalog.promise);
        const { actions, play, status } = setup();
        const open = () => actions.openOnlineCard({ id: 'scene-33', name: 'Driving', type: 'radio', raw: { personalFm: selection } }, 'qishui', vi.fn());
        const earlier = open();
        await vi.waitFor(() => expect(api.getPersonalFm).toHaveBeenCalledTimes(1));
        expect(selected()).toEqual(selection);
        const latest = open();
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        latestCatalog.reject(new Error('latest catalogue failed'));
        expect(await latest).toEqual({ ok: false, reason: 'failed' });
        expect(selected()).toEqual(explore);
        expect(status).toHaveBeenCalledExactlyOnceWith({ type: 'error', text: expect.any(String) });
        earlierSongs.resolve(songs);
        await earlier;
        expect(play).not.toHaveBeenCalled();
        expect(logged).toHaveBeenCalledTimes(1);
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
