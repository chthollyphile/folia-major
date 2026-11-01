import type { RefObject } from 'react';
import { PlayerState, type LyricData, type SongResult } from '../../types';
import type { OnlineProviderId } from '../../types/onlineMusic';
import type { LibraryProviderSwitchCleanupPort } from '../core/account/account.contract';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useCollectionNavigationStore } from '../../stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from '../../stores/useOnlineProviderAccountStore';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { clearPrefetchRuntime, refreshPrefetchAfterQueueEdit } from '../../services/prefetchService';
import { getOnlineProviderIdForSong } from '../../utils/appPlaybackGuards';
import { dropPlaysOfProvider, makeSongCurrent } from '../../components/app/playback/currentSong';
import { notePersonalFmEnded } from '../../components/app/playback/personalFmEndings';
import { forgetPlaybackCache, persistPlaybackCache } from '../../components/app/playback/persistPlaybackCache';
import { leaveHifiRoute } from '../../services/hifi/hifiPlayback';

// src/library/app/createLibraryAccountPort.ts
// 在线账户 controller 的播放器端口（照 createLibraryHomePort 的做法）。播放、歌词、上报、红心都按歌曲自己的平台走，
// 一个队列里可以混着几个平台、本地与 Navidrome 的歌：切到别的平台只放下跟着当前平台走的私人 FM 与集合导航，
// 退出一个平台只把它自己的歌移出去（正在放的是它的就停下）。
// 播放器的 DOM 与 automix 句柄只有 App 持有，经 getHost 现读；播放状态读写都走 usePlaybackStore 的最新值。

/** App 持有、端口按调用现读的播放器句柄。 */
export type LibraryAccountSwitchHost = {
    audioRef: RefObject<HTMLAudioElement | null>;
    automixRef: RefObject<{ abortTransition: () => void } | null>;
    shouldAutoPlay: RefObject<boolean>;
    /** App 的歌词写入（带过滤设置的那一个；停下时只传 null）。 */
    setLyrics: (lyrics: LyricData | null) => void;
    setIsLyricsLoading: (loading: boolean) => void;
};

const belongsTo = (providerId: OnlineProviderId) => (song: SongResult | null): boolean => (
    getOnlineProviderIdForSong(song) === providerId
);

/** 播放器里有没有这个平台的歌：正在放的那首，或者队列里的。 */
export const playerHoldsSongsOf = (providerId: OnlineProviderId): boolean => {
    const { currentSong, playQueue } = usePlaybackStore.getState();
    const ofProvider = belongsTo(providerId);
    return ofProvider(currentSong) || playQueue.some(ofProvider);
};

/**
 * 切到别的平台之前：私人 FM 是旧平台的电台，换了平台就不再往下补歌，退出 FM 模式，已经排进队列的歌留着当普通
 * 队列放；集合导航收起，回到新平台的首页。队列、正在放的歌、搜索都不动。
 */
export const leaveProviderForSwitch = (previousProviderId: OnlineProviderId, nextProviderId: OnlineProviderId): void => {
    const playback = usePlaybackStore.getState();
    const endedFm = playback.isFmMode;
    if (endedFm) {
        // Counted, so that a play started before the switch does not turn FM back on (personalFmEndings.ts).
        notePersonalFmEnded();
        playback.setIsFmMode(false);
    }
    useCollectionNavigationStore.getState().clear();
    console.info(`[ProviderChange] ${previousProviderId} -> ${nextProviderId}: the queue stays${endedFm ? ', Personal FM ended' : ''}`);
};

/** 停掉正在放的那首：声音、歌、歌词、封面都清掉，播放器回到空闲。队列不在这里动。 */
const stopCurrentSong = (host: LibraryAccountSwitchHost): void => {
    const playback = usePlaybackStore.getState();
    // Stops any deck still fading out in the background: this path clears the active deck
    // only, and a tail left running would have no control pointing at it any more.
    host.automixRef.current?.abortTransition();
    const audio = host.audioRef.current;
    audio?.pause();
    audio?.removeAttribute('src');
    audio?.load();
    // On the HiFi route the sound is not in <audio>: mpv stops, the exclusive device is let go and the
    // route goes back to web (nothing happens off that route).
    leaveHifiRoute('provider sign-out');
    if (playback.audioSrc?.startsWith('blob:')) URL.revokeObjectURL(playback.audioSrc);
    playback.setAudioSrc(null);
    makeSongCurrent(null);
    host.setLyrics(null);
    playback.setCachedCoverUrl(null);
    // A load that this cuts short never clears these two itself.
    host.setIsLyricsLoading(false);
    host.shouldAutoPlay.current = false;
    playback.setPlayerState(PlayerState.IDLE);
};

/**
 * 退出一个平台：它的歌移出队列，正在放的是它的就停下，别的歌照旧。私人 FM 放的是它的电台（它是当前平台）时一起
 * 退出；打开着它的集合时收起集合导航。存着的会话跟着改，下次启动不再把它的歌带回来。还在路上的这个平台的播放
 * 作废（dropPlaysOfProvider），别的平台、本地与 Navidrome 的播放照旧。当前歌还在时按新队列重新预取。
 */
export const dropProviderSongs = (host: LibraryAccountSwitchHost, providerId: OnlineProviderId): void => {
    const playback = usePlaybackStore.getState();
    const ofProvider = belongsTo(providerId);
    const stopsCurrent = ofProvider(playback.currentSong);
    const previousQueue = playback.playQueue;
    const remaining = previousQueue.filter(song => !ofProvider(song));
    const removed = previousQueue.length - remaining.length;
    // A play of this platform still on its way would show its song and write its queue back.
    dropPlaysOfProvider(providerId);
    if (stopsCurrent) stopCurrentSong(host);
    if (removed > 0) playback.setPlayQueue(remaining);
    if (playback.isFmMode && providerId === useOnlineProviderAccountStore.getState().activeProviderId) {
        notePersonalFmEnded();
        playback.setIsFmMode(false);
    }
    if (stopsCurrent || removed > 0) {
        const current = usePlaybackStore.getState().currentSong;
        if (current) {
            // The neighbours of the song that plays on changed: prefetch and the automix analysis follow the new queue.
            refreshPrefetchAfterQueueEdit(current, previousQueue, remaining, useAudioSettingsStore.getState().audioQuality);
        } else {
            // Nothing plays: what was prefetched was this song's neighbours, fetched with this platform's sign-in.
            clearPrefetchRuntime();
        }
        // With nothing current the next launch starts from the first song left, or from nothing.
        const savedSong = current ?? remaining[0] ?? null;
        void (savedSong ? persistPlaybackCache(savedSong, remaining) : forgetPlaybackCache());
    }
    const navigation = useCollectionNavigationStore.getState();
    if (navigation.snapshot?.stack.some(collection => collection.source === 'online' && collection.providerId === providerId)) {
        navigation.clear();
    }
    console.info(`[ProviderChange] signed out of ${providerId}: ${removed} queued song(s) removed${stopsCurrent ? ', the current song stopped' : ''}`);
};

export const createLibraryAccountSwitchCleanupPort = (
    getHost: () => LibraryAccountSwitchHost,
): LibraryProviderSwitchCleanupPort => ({
    leaveProvider: leaveProviderForSwitch,
    holdsSongsOf: playerHoldsSongsOf,
    dropSongsOf: (providerId: OnlineProviderId) => dropProviderSongs(getHost(), providerId),
});
