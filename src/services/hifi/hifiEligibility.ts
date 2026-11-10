import type { SongResult } from '../../types';
import type { PlaybackRoute } from '../../types/hifi';
import { isLocalPlaybackSong, isNavidromePlaybackSong, isStagePlaybackSong } from '../../utils/appPlaybackGuards';

// src/services/hifi/hifiEligibility.ts
// 一首歌该走哪套引擎：只有本地曲库和（开了开关的）Navidrome 走 mpv，其余一律留在 Web 引擎。

export type PlaybackKind = 'local' | 'navidrome' | 'online' | 'stage';

export type HifiRouteContext = {
    /** 桌面版且 preload 暴露了 window.electron.hifi。 */
    supported: boolean;
    /** 设置里开了 HiFi。 */
    enabled: boolean;
    /** 设置里允许 Navidrome 走 HiFi。 */
    navidromeEnabled: boolean;
    /** 找到了可用的 mpv。 */
    runtimeAvailable: boolean;
    /** 本次会话 mpv 连续崩溃，熔断后整段会话回落 Web。 */
    circuitOpen: boolean;
    /** 这首歌在本次会话里 HiFi 起播失败过，已回落 Web。 */
    forcedWeb: boolean;
};

/** Stage 先判：Stage 推来的歌可能也带着 isLocal 之类的字段，但它的声音不归播放器管。 */
export const playbackKindOfSong = (song: SongResult): PlaybackKind => {
    if (isStagePlaybackSong(song)) return 'stage';
    if (isLocalPlaybackSong(song)) return 'local';
    if (isNavidromePlaybackSong(song)) return 'navidrome';
    return 'online';
};

export const resolvePlaybackRoute = (kind: PlaybackKind, context: HifiRouteContext): PlaybackRoute => {
    if (!context.supported || !context.enabled || !context.runtimeAvailable) return 'web';
    if (context.circuitOpen || context.forcedWeb) return 'web';
    if (kind === 'local') return 'hifi';
    if (kind === 'navidrome') return context.navidromeEnabled ? 'hifi' : 'web';
    return 'web';
};
