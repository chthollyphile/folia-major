import { useCallback, useEffect, useRef, useState } from 'react';
import type { LyricData } from '../types';
import type {
    MprisConnectionStatus,
    MprisPlayerSnapshot,
    MprisSnapshot,
    MprisStatus,
    MprisTrack,
} from '../types/mpris';
import { resolveMprisLyrics } from '../services/mpris/mprisLyrics';
import { mprisLyricSignature, mprisPositionSec, mprisTrackFromPlayer, mprisTrackKey } from '../utils/mpris';

// src/hooks/useMprisSession.ts
// 订阅主进程推来的 MPRIS 快照，挑当前播放器，外推位置，并在曲目变化时找歌词。位置只进 ref，不每秒重绘。

type Clock = {
    positionSec: number;
    durationSec: number;
    anchoredAtMs: number;
    playing: boolean;
    rate: number;
};

export interface UseMprisSessionOptions {
    enabled: boolean;
}

export interface MprisSession {
    connectionStatus: MprisConnectionStatus;
    /** 至少收到过一份快照；为假时没有 track 只表示还没读到。 */
    hasSnapshot: boolean;
    track: MprisTrack | null;
    lyrics: LyricData | null;
    playerState: 'playing' | 'paused';
    getCurrentTimeSec: (nowMs?: number) => number;
}

const EMPTY_CLOCK: Clock = { positionSec: 0, durationSec: 0, anchoredAtMs: 0, playing: false, rate: 1 };
const LYRIC_CACHE_LIMIT = 50;

export function useMprisSession({ enabled }: UseMprisSessionOptions): MprisSession {
    const [connectionStatus, setConnectionStatus] = useState<MprisConnectionStatus>('idle');
    const [hasSnapshot, setHasSnapshot] = useState(false);
    const [track, setTrack] = useState<MprisTrack | null>(null);
    const [lyrics, setLyrics] = useState<LyricData | null>(null);
    const [playerState, setPlayerState] = useState<'playing' | 'paused'>('paused');

    const clockRef = useRef<Clock>(EMPTY_CLOCK);
    const hasSnapshotRef = useRef(false);
    const trackKeyRef = useRef<string | null>(null);
    // 快照每秒来一次；值没变就不 setState，避免 App 每秒重绘。
    const trackRef = useRef<MprisTrack | null>(null);
    const playerStateRef = useRef<'playing' | 'paused'>('paused');
    const lyricRequestRef = useRef(0);
    const lyricSignatureRef = useRef<string | null>(null);
    const lyricCacheRef = useRef(new Map<string, LyricData | null>());
    const mountedRef = useRef(true);

    /** 曲目变化时找歌词；换歌后晚到的结果丢掉。 */
    const resolveLyrics = useCallback(async (player: MprisPlayerSnapshot, signature: string, requestId: number) => {
        const nextLyrics = await resolveMprisLyrics(player);

        if (requestId !== lyricRequestRef.current) return;
        if (lyricCacheRef.current.size >= LYRIC_CACHE_LIMIT) lyricCacheRef.current.clear();
        lyricCacheRef.current.set(signature, nextLyrics);
        setLyrics(nextLyrics);
    }, []);

    const applySnapshot = useCallback((snapshot: MprisSnapshot) => {
        if (!mountedRef.current) return;
        if (!hasSnapshotRef.current) {
            hasSnapshotRef.current = true;
            setHasSnapshot(true);
        }
        const player = snapshot.players.find(candidate => candidate.busName === snapshot.activeBusName) ?? null;
        const nowMs = Date.now();

        if (!player) {
            clockRef.current = EMPTY_CLOCK;
            if (trackKeyRef.current !== null) {
                trackKeyRef.current = null;
                trackRef.current = null;
                lyricSignatureRef.current = null;
                lyricRequestRef.current += 1;
                setTrack(null);
                setLyrics(null);
                playerStateRef.current = 'paused';
                setPlayerState('paused');
            }
            return;
        }

        clockRef.current = {
            positionSec: mprisPositionSec(player, nowMs),
            durationSec: player.durationSec,
            anchoredAtMs: nowMs,
            playing: player.status === 'playing',
            rate: player.rate,
        };
        const nextPlayerState = player.status === 'playing' ? 'playing' : 'paused';
        if (playerStateRef.current !== nextPlayerState) {
            playerStateRef.current = nextPlayerState;
            setPlayerState(nextPlayerState);
        }

        const key = mprisTrackKey(player);
        if (key !== trackKeyRef.current) {
            trackKeyRef.current = key;
            const nextTrack = mprisTrackFromPlayer(player, key);
            trackRef.current = nextTrack;
            setTrack(nextTrack);
        } else {
            // 同一首歌：时长和封面可能晚到，补齐。
            const currentTrack = trackRef.current;
            if (currentTrack && (currentTrack.durationSec !== player.durationSec || currentTrack.artUrl !== player.artUrl)) {
                const nextTrack = { ...currentTrack, durationSec: player.durationSec, artUrl: player.artUrl };
                trackRef.current = nextTrack;
                setTrack(nextTrack);
            }
        }

        // 输入变了（换歌，或歌手/时长/自带歌词晚到）才重新找。
        const signature = mprisLyricSignature(player);
        if (signature !== lyricSignatureRef.current) {
            lyricSignatureRef.current = signature;
            // 缓存命中也要作废在飞的旧请求，否则旧结果会写到这首上。
            lyricRequestRef.current += 1;
            const requestId = lyricRequestRef.current;
            if (lyricCacheRef.current.has(signature)) {
                setLyrics(lyricCacheRef.current.get(signature) ?? null);
            } else {
                setLyrics(null);
                void resolveLyrics(player, signature, requestId);
            }
        }
    }, [resolveLyrics]);

    const applySnapshotRef = useRef(applySnapshot);
    applySnapshotRef.current = applySnapshot;

    useEffect(() => {
        mountedRef.current = true;
        if (!enabled) {
            hasSnapshotRef.current = false;
            setHasSnapshot(false);
            setConnectionStatus('idle');
            return undefined;
        }
        const api = window.electron?.mpris;
        if (window.electron?.platform !== 'linux' || !api) {
            setConnectionStatus('error');
            return undefined;
        }

        const unsubscribeState = api.onState(snapshot => applySnapshotRef.current(snapshot));
        const unsubscribeStatus = api.onStatus((status: MprisStatus) => {
            setConnectionStatus(status.listening ? 'listening' : status.error ? 'error' : 'idle');
        });
        void api.start().catch((error: unknown) => {
            console.warn('[MPRIS] could not start reading the session bus', error);
            setConnectionStatus('error');
        });

        return () => {
            unsubscribeState();
            unsubscribeStatus();
            void api.stop().catch(() => {});
            lyricRequestRef.current += 1;
            trackKeyRef.current = null;
            trackRef.current = null;
            lyricSignatureRef.current = null;
            clockRef.current = EMPTY_CLOCK;
            hasSnapshotRef.current = false;
            setHasSnapshot(false);
            setConnectionStatus('idle');
            setTrack(null);
            setLyrics(null);
            playerStateRef.current = 'paused';
            setPlayerState('paused');
        };
    }, [enabled]);

    useEffect(() => () => {
        mountedRef.current = false;
    }, []);

    const getCurrentTimeSec = useCallback((nowMs = Date.now()) => {
        const clock = clockRef.current;
        const elapsed = clock.playing ? Math.max(0, nowMs - clock.anchoredAtMs) / 1000 * clock.rate : 0;
        const position = clock.positionSec + elapsed;
        return clock.durationSec > 0 ? Math.min(clock.durationSec, Math.max(0, position)) : Math.max(0, position);
    }, []);

    return {
        connectionStatus,
        hasSnapshot,
        track,
        lyrics,
        playerState,
        getCurrentTimeSec,
    };
}
