// src/types/mpris.ts
// 主进程（electron/mpris/）读到的 MPRIS 快照，渲染进程按这个形状用。

export type MprisPlaybackStatus = 'playing' | 'paused' | 'stopped';

/** 播放器在这一刻报的状态；位置是采样时刻的。 */
export interface MprisPlayerSnapshot {
    busName: string;
    identity: string;
    status: MprisPlaybackStatus;
    trackId: string | null;
    title: string;
    artists: string[];
    album: string;
    artUrl: string | null;
    durationSec: number;
    positionSec: number;
    rate: number;
    /** 播放器自带的歌词（xesam:asText），通常是 LRC；没有时为空串。 */
    lyricText: string;
    /** 主进程读到这份属性的时刻。 */
    sampledAtMs: number;
    /** 最近一次状态或曲目变化；位置不刷新。 */
    activeAtMs: number;
}

export interface MprisSnapshot {
    players: MprisPlayerSnapshot[];
    activeBusName: string | null;
    sampledAtMs: number;
}

/** 会话总线连接状态。 */
export interface MprisStatus {
    listening: boolean;
    error: string | null;
}

export type MprisConnectionStatus = 'idle' | 'listening' | 'error';

/** 当前播放器整理出的曲目。 */
export interface MprisTrack {
    /** 换播放器或换歌就变。 */
    key: string;
    busName: string;
    identity: string;
    title: string;
    artists: string[];
    artist: string;
    album: string;
    artUrl: string | null;
    durationSec: number;
}
