import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryHomePort } from '@/library/app/createLibraryHomePort';
import { createLibraryHomeActions } from '@/library/core/home/libraryHomeActions.service';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { selectProviderPersonalFm, usePersonalFmModeStore } from '@/stores/usePersonalFmModeStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '@/services/onlineMusic/fmModes';
import type { HomeSurfaceProps } from '@/components/app/home/homeSurfaceTypes';
import type { SongResult } from '@/types';
import { noteQueueStart } from '@/components/app/playback/start/queueStarts';
import { noteWholeQueueWrite } from '@/services/wholeQueueWrites';

// Card requests that lose their provider during either await must never request or play the new provider's stream.
const api = vi.hoisted(() => ({ getPersonalFm: vi.fn(), getPersonalFmCatalog: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: api }));
vi.mock('@/services/localMusicService', () => ({ importFolder: vi.fn(), resyncAllFolders: vi.fn(), LOCAL_MUSIC_SCAN_PROGRESS_EVENT: 'scan' }));
vi.mock('@/services/localPlaylistFileService', () => ({ importLocalPlaylistFile: vi.fn() }));
const selection = { mode: 'SCENE_RCMD' as const, scene: '33' };
const catalog = { ...DEFAULT_PERSONAL_FM_CATALOG, scenes: [{ id: '33', category: 'activity', labelKey: '', labelFallback: 'Driving', keywords: [] }] };
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
    usePersonalFmModeStore.setState({ catalogs: {}, providerSelections: {} });
    api.getPersonalFmCatalog.mockResolvedValue(catalog);
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
