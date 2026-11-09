import { useMemo } from 'react';
import type { PlaybackRoute } from '../../types/hifi';
import type { SongResult, StageLoopMode } from '../../types';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useHifiEngineStore } from '../../services/hifi/hifiEngine';
import { playbackKindOfSong } from '../../services/hifi/hifiEligibility';
import { hifiRouteFor } from '../../services/hifi/hifiPlayback';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { nextQueueIndex, queueIndexOf, queueLoopMode } from '../../utils/playbackNeighbors';

// src/components/hifi/useHifiAutomixGate.ts
// 智能过渡（automix / 交叉淡入淡出）要两个 <audio> deck 同时出声，mpv 不在这两个 deck 里：当前或下一首走 HiFi 时关掉它。

type RouteFor = (kind: 'local' | 'navidrome', songKey: string) => PlaybackRoute;

/** 这首歌按现在的设置会不会走 HiFi。在线歌曲和 Stage 推来的歌一律不会。 */
const routesHifi = (song: SongResult | null | undefined, routeFor: RouteFor): boolean => {
    if (!song) return false;
    const kind = playbackKindOfSong(song);
    if (kind !== 'local' && kind !== 'navidrome') return false;
    return routeFor(kind, getPlaybackSongKey(song)) === 'hifi';
};

export type HifiAutomixGateInput = {
    playbackRoute: PlaybackRoute;
    playQueue: SongResult[];
    currentSong: SongResult | null;
    loopMode: StageLoopMode;
    isFmMode: boolean;
};

/**
 * HiFi 是否挡住智能过渡：正在 HiFi 上放，或者当前这首、或下一首（和 handleNextTrack 同一套下标规则，私人 FM 按不循环）会走 HiFi。
 * 当前这首也算：它在载入、路线还没切过去的那一下，智能过渡不该趁机去混它。
 */
export const hifiBlocksAutomix = (
    { playbackRoute, playQueue, currentSong, loopMode, isFmMode }: HifiAutomixGateInput,
    routeFor: RouteFor = hifiRouteFor,
): boolean => {
    if (playbackRoute === 'hifi') return true;
    if (routesHifi(currentSong, routeFor)) return true;
    const nextIndex = nextQueueIndex(playQueue.length, queueIndexOf(playQueue, currentSong), queueLoopMode(loopMode, isFmMode));
    return nextIndex >= 0 && routesHifi(playQueue[nextIndex], routeFor);
};

// App 把它并进 useAutomixDecks 的 isEnabled。
export function useHifiAutomixGate(): boolean {
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);
    const playQueue = usePlaybackStore(state => state.playQueue);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const loopMode = useAudioSettingsStore(state => state.loopMode);
    // hifiRouteFor 自己读这些 store；订阅它们只是为了在设置、运行时或熔断变了时重新判一次。
    const enabled = useHifiSettingsStore(state => state.enabled);
    const navidrome = useHifiSettingsStore(state => state.navidrome);
    const supported = useHifiEngineStore(state => state.supported);
    const runtimeAvailable = useHifiEngineStore(state => state.runtime?.available === true);
    const circuitOpen = useHifiEngineStore(state => state.circuitOpen);

    return useMemo(() => {
        // 这几项挡住时 hifiRouteFor 一律答 web，不必逐首去问。
        if (playbackRoute !== 'hifi' && (!supported || !enabled || !runtimeAvailable || circuitOpen)) return false;
        return hifiBlocksAutomix({ playbackRoute, playQueue, currentSong, loopMode, isFmMode });
        // navidrome 不在函数体里，是 hifiRouteFor 读的。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [circuitOpen, currentSong, enabled, isFmMode, loopMode, navidrome, playQueue, playbackRoute, runtimeAvailable, supported]);
}
