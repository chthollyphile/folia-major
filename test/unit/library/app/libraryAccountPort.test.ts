import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/library/app/libraryAccountPort.test.ts
// 平台换了时的播放器端口。队列可以混着几个平台、本地与 Navidrome 的歌：
// - 切到别的平台：退出私人 FM（排进队列的歌留着当普通队列）、收起集合导航；歌、队列、声音、存着的会话、搜索都不动；
// - 退出一个平台：只把它的歌移出队列；正在放的是它的就停下（automix 尾音、audio、blob 地址、还在取地址的播放、歌词、
//   封面、播放状态），别的歌照旧；只作废这个平台还在路上的播放；当前歌还在时按新队列重新预取；私人 FM 只在退的是
//   当前平台时结束；存着的会话跟着改；打开着它的集合时收起集合导航。App 的句柄按调用现读。
// HiFi 路线上的声音在 mpv 里：停下时也离开这条路线（服务是替身，只钉住停下叫了它、叫在清掉歌之前）。

const services = vi.hoisted(() => ({ clearPrefetchRuntime: vi.fn(), refreshPrefetchAfterQueueEdit: vi.fn() }));
vi.mock('@/services/prefetchService', () => services);
const playback = vi.hoisted(() => ({
    forgetPlaybackCache: vi.fn(async () => { }),
    persistPlaybackCache: vi.fn(async (_song: unknown, _queue: unknown) => { }),
}));
vi.mock('@/components/app/playback/persistPlaybackCache', () => playback);
// HiFi 路线的出口：mpv 停下、独占设备放开、路线切回 web；不在这条路线上时它自己什么都不做。
const hifi = vi.hoisted(() => ({ leaveHifiRoute: vi.fn(() => false) }));
vi.mock('@/services/hifi/hifiPlayback', () => ({ leaveHifiRoute: hifi.leaveHifiRoute }));

import { createLibraryAccountSwitchCleanupPort, type LibraryAccountSwitchHost } from '@/library/app/createLibraryAccountPort';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { startPlay } from '@/components/app/playback/currentSong';
import { personalFmEndingsSoFar } from '@/components/app/playback/personalFmEndings';
import { PlayerState, type SongResult } from '@/types';

const online = (id: string, providerId: string) => ({
    id,
    name: id,
    artists: [],
    album: { id: '', name: '' },
    sourceRef: { kind: 'online', providerId, mediaId: id },
}) as unknown as SongResult;
const local = (id: string) => ({
    id,
    name: id,
    artists: [],
    album: { id: '', name: '' },
    sourceRef: { kind: 'local', mediaId: id },
}) as unknown as SongResult;

const neteaseSong = online('n1', 'netease');
const neteaseSong2 = online('n2', 'netease');
const qqSong = online('q1', 'qq');
const localSong = local('l1');

const fakeAudio = () => ({ pause: vi.fn(), removeAttribute: vi.fn(), load: vi.fn() });

const makeHost = (overrides: Partial<LibraryAccountSwitchHost> = {}): LibraryAccountSwitchHost => ({
    audioRef: { current: null },
    automixRef: { current: null },
    shouldAutoPlay: { current: true },
    setLyrics: vi.fn(),
    setIsLyricsLoading: vi.fn(),
    ...overrides,
});

const neteaseCollection = { source: 'online', providerId: 'netease', type: 'playlist', id: 'p1', title: 'P' } as never;
const qqCollection = { source: 'online', providerId: 'qq', type: 'playlist', id: 'p2', title: 'Q' } as never;

describe('provider switch: the player stays', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePlaybackStore.setState({
            audioSrc: 'blob:old-track',
            currentSong: neteaseSong,
            playQueue: [neteaseSong, neteaseSong2],
            cachedCoverUrl: 'cover.png',
            isFmMode: true,
            playerState: PlayerState.PLAYING,
        });
        useCollectionNavigationStore.setState({ snapshot: { origin: 'home', stack: [neteaseCollection] } as never });
        useSearchNavigationStore.setState({ searchSourceTab: 'netease', searchQuery: 'kept', searchResults: [neteaseSong] as never });
    });

    it('ends Personal FM and closes the collection, and leaves the song, queue, sound, saved session and search alone', () => {
        const endingsBefore = personalFmEndingsSoFar();
        const audio = fakeAudio();
        const automix = { abortTransition: vi.fn() };
        const host = makeHost({ audioRef: { current: audio as unknown as HTMLAudioElement }, automixRef: { current: automix } });

        createLibraryAccountSwitchCleanupPort(() => host).leaveProvider('netease', 'qq');

        expect(usePlaybackStore.getState()).toMatchObject({
            audioSrc: 'blob:old-track',
            currentSong: neteaseSong,
            playQueue: [neteaseSong, neteaseSong2],
            cachedCoverUrl: 'cover.png',
            isFmMode: false,
            playerState: PlayerState.PLAYING,
        });
        expect(useCollectionNavigationStore.getState().snapshot).toBeNull();
        expect(useSearchNavigationStore.getState()).toMatchObject({ searchSourceTab: 'netease', searchQuery: 'kept' });
        expect(automix.abortTransition).not.toHaveBeenCalled();
        expect(audio.pause).not.toHaveBeenCalled();
        expect(hifi.leaveHifiRoute).not.toHaveBeenCalled();
        expect(playback.forgetPlaybackCache).not.toHaveBeenCalled();
        expect(playback.persistPlaybackCache).not.toHaveBeenCalled();
        expect(services.clearPrefetchRuntime).not.toHaveBeenCalled();
        // Counted, so that a play started before the switch does not turn FM back on.
        expect(personalFmEndingsSoFar()).toBe(endingsBefore + 1);
    });
});

describe('provider sign-out: only its own songs leave', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        usePlaybackStore.setState({
            audioSrc: 'blob:old-track',
            currentSong: neteaseSong,
            playQueue: [neteaseSong, qqSong, localSong, neteaseSong2],
            cachedCoverUrl: 'cover.png',
            isFmMode: false,
            playerState: PlayerState.PLAYING,
        });
        useCollectionNavigationStore.setState({ snapshot: null });
        useOnlineProviderAccountStore.setState({ activeProviderId: 'netease' });
    });

    it('stops the current song of that provider and takes its songs out of the queue', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const audio = fakeAudio();
        const automix = { abortTransition: vi.fn() };
        const setLyrics = vi.fn();
        const setIsLyricsLoading = vi.fn();
        const shouldAutoPlay = { current: true };
        const host = makeHost({
            audioRef: { current: audio as unknown as HTMLAudioElement },
            automixRef: { current: automix },
            shouldAutoPlay,
            setLyrics,
            setIsLyricsLoading,
        });

        createLibraryAccountSwitchCleanupPort(() => host).dropSongsOf('netease');

        expect(automix.abortTransition).toHaveBeenCalledTimes(1);
        expect(audio.pause).toHaveBeenCalledTimes(1);
        expect(hifi.leaveHifiRoute).toHaveBeenCalledTimes(1);
        expect(audio.removeAttribute).toHaveBeenCalledWith('src');
        expect(audio.load).toHaveBeenCalledTimes(1);
        expect(revoke).toHaveBeenCalledWith('blob:old-track');
        expect(setLyrics).toHaveBeenCalledWith(null);
        expect(setIsLyricsLoading).toHaveBeenCalledWith(false);
        expect(shouldAutoPlay.current).toBe(false);
        expect(usePlaybackStore.getState()).toMatchObject({
            audioSrc: null,
            currentSong: null,
            playQueue: [qqSong, localSong],
            cachedCoverUrl: null,
            playerState: PlayerState.IDLE,
        });
        expect(services.clearPrefetchRuntime).toHaveBeenCalledTimes(1);
        // Nothing is current any more: the next launch starts from the first song left.
        expect(playback.persistPlaybackCache).toHaveBeenCalledWith(qqSong, [qqSong, localSong]);
        expect(playback.forgetPlaybackCache).not.toHaveBeenCalled();
        revoke.mockRestore();
    });

    it('keeps playing a song of another provider, edits the queue and prefetches around the new one', () => {
        usePlaybackStore.setState({ currentSong: qqSong, isFmMode: true });
        const audio = fakeAudio();
        const host = makeHost({ audioRef: { current: audio as unknown as HTMLAudioElement } });

        createLibraryAccountSwitchCleanupPort(() => host).dropSongsOf('netease');

        expect(audio.pause).not.toHaveBeenCalled();
        expect(hifi.leaveHifiRoute).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState()).toMatchObject({
            audioSrc: 'blob:old-track',
            currentSong: qqSong,
            playQueue: [qqSong, localSong],
            playerState: PlayerState.PLAYING,
            // The radio was the active platform's, the one signed out of.
            isFmMode: false,
        });
        expect(services.refreshPrefetchAfterQueueEdit).toHaveBeenCalledWith(
            qqSong, [neteaseSong, qqSong, localSong, neteaseSong2], [qqSong, localSong], expect.anything(),
        );
        expect(services.clearPrefetchRuntime).not.toHaveBeenCalled();
        expect(playback.persistPlaybackCache).toHaveBeenCalledWith(qqSong, [qqSong, localSong]);
    });

    it('leaves the Personal FM of the active platform on when another platform is signed out of', () => {
        useOnlineProviderAccountStore.setState({ activeProviderId: 'qq' });
        usePlaybackStore.setState({ currentSong: qqSong, isFmMode: true });

        createLibraryAccountSwitchCleanupPort(() => makeHost()).dropSongsOf('netease');

        expect(usePlaybackStore.getState()).toMatchObject({ playQueue: [qqSong, localSong], isFmMode: true });
    });

    it('drops the plays of that provider still on their way, and only those', () => {
        const neteasePlay = startPlay('netease');
        const qqPlay = startPlay('qq');
        const localPlay = startPlay();
        // Each newer start overtakes the ones before it; read the answer the sign-out gives, not that.
        const neteaseShown = neteasePlay.onceShown;
        const qqShown = qqPlay.onceShown;

        createLibraryAccountSwitchCleanupPort(() => makeHost()).dropSongsOf('netease');

        expect(localPlay()).toBe(true);
        expect(neteaseShown()).toBe(false);
        // The qq play is overtaken by the local one, not dropped: abandoning that newer play gives it its yes back.
        localPlay.abandon();
        expect(qqShown()).toBe(true);
        expect(neteaseShown()).toBe(false);
    });

    it('forgets the saved session when nothing is left', () => {
        usePlaybackStore.setState({ currentSong: neteaseSong, playQueue: [neteaseSong, neteaseSong2] });

        createLibraryAccountSwitchCleanupPort(() => makeHost()).dropSongsOf('netease');

        expect(usePlaybackStore.getState()).toMatchObject({ currentSong: null, playQueue: [] });
        expect(playback.forgetPlaybackCache).toHaveBeenCalledTimes(1);
        expect(playback.persistPlaybackCache).not.toHaveBeenCalled();
    });

    it('touches nothing when the player holds none of its songs and it is not the active platform', () => {
        useOnlineProviderAccountStore.setState({ activeProviderId: 'qq' });
        usePlaybackStore.setState({ currentSong: qqSong, playQueue: [qqSong, localSong], isFmMode: true });
        const audio = fakeAudio();

        createLibraryAccountSwitchCleanupPort(() => makeHost({ audioRef: { current: audio as unknown as HTMLAudioElement } })).dropSongsOf('netease');

        expect(audio.pause).not.toHaveBeenCalled();
        expect(usePlaybackStore.getState()).toMatchObject({ currentSong: qqSong, playQueue: [qqSong, localSong], isFmMode: true });
        expect(services.clearPrefetchRuntime).not.toHaveBeenCalled();
        expect(playback.persistPlaybackCache).not.toHaveBeenCalled();
        expect(playback.forgetPlaybackCache).not.toHaveBeenCalled();
    });

    it('closes the collection navigation only when it shows a collection of that provider', () => {
        useCollectionNavigationStore.setState({ snapshot: { origin: 'home', stack: [qqCollection] } as never });
        createLibraryAccountSwitchCleanupPort(() => makeHost()).dropSongsOf('netease');
        expect(useCollectionNavigationStore.getState().snapshot).not.toBeNull();

        useCollectionNavigationStore.setState({ snapshot: { origin: 'home', stack: [qqCollection, neteaseCollection] } as never });
        createLibraryAccountSwitchCleanupPort(() => makeHost()).dropSongsOf('netease');
        expect(useCollectionNavigationStore.getState().snapshot).toBeNull();
    });

    it('reads the host on every call and leaves non-blob sources alone', () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        usePlaybackStore.setState({ audioSrc: 'https://example.test/a.mp3' });
        let host = makeHost();
        const port = createLibraryAccountSwitchCleanupPort(() => host);
        const laterAudio = fakeAudio();
        host = { ...host, audioRef: { current: laterAudio as unknown as HTMLAudioElement } };

        port.dropSongsOf('netease');

        expect(laterAudio.pause).toHaveBeenCalledTimes(1);
        expect(revoke).not.toHaveBeenCalled();
        revoke.mockRestore();
    });

    it('leaves the HiFi route before the song is cleared: mpv stops while the song is still the one shown', () => {
        let shownWhenLeft: unknown = 'not left';
        hifi.leaveHifiRoute.mockImplementationOnce(() => {
            shownWhenLeft = usePlaybackStore.getState().currentSong;
            return true;
        });

        createLibraryAccountSwitchCleanupPort(() => makeHost()).dropSongsOf('netease');

        expect(hifi.leaveHifiRoute).toHaveBeenCalledTimes(1);
        expect(shownWhenLeft).toBe(neteaseSong);
        expect(usePlaybackStore.getState().currentSong).toBeNull();
    });

    it('says whether the player holds songs of a provider: the one playing, or one in the queue', () => {
        const port = createLibraryAccountSwitchCleanupPort(() => { throw new Error('not read'); });
        expect(port.holdsSongsOf('netease')).toBe(true);
        usePlaybackStore.setState({ currentSong: localSong, playQueue: [qqSong] });
        expect(port.holdsSongsOf('qq')).toBe(true);
        expect(port.holdsSongsOf('netease')).toBe(false);
        usePlaybackStore.setState({ currentSong: null, playQueue: [] });
        expect(port.holdsSongsOf('qq')).toBe(false);
    });
});
