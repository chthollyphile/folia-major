import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { getFromCache, removeFromCache, saveToCache } from '../services/db';
import { NowPlayingProvider } from '../services/nowPlayingProvider';
import { findLatestActiveLineIndex, hasRenderableLyrics } from '../utils/appPlaybackHelpers';
import { buildStageEntryKey, getStageLyricsTimelineBounds } from '../utils/appStageHelpers';
import { isStagePlaybackSong } from '../utils/appPlaybackGuards';
import {
    buildNowPlayingContentLoadKey,
    clampNowPlayingTimeSec,
    NOW_PLAYING_PROGRESS_POLL_INTERVAL_MS,
    NOW_PLAYING_PROGRESS_QUERY_URL,
    parseNowPlayingProgressResponseMs,
    resolveNowPlayingAnchorTime,
    shouldApplyNowPlayingProgressCorrection,
} from '../utils/nowPlayingClock';
import { buildNowPlayingLyricSource } from '../utils/lyrics/nowPlayingSource';
import {
    LyricData,
    NowPlayingConnectionStatus,
    NowPlayingLyricPayload,
    NowPlayingTrackSnapshot,
    PlayerState,
    SongResult,
    StageLyricsSession,
    StageMediaSession,
    StageSource,
    StageStatus,
    StatusMessage,
} from '../types';
import type {
    NowPlayingClockState,
    PlaybackSnapshot,
    StageLyricsClockState,
} from '../types/appPlayback';

// src/hooks/useStagePlaybackController.ts

type SetState<T> = Dispatch<SetStateAction<T>>;

type UseStagePlaybackControllerParams = {
    t: (key: string) => string;
    isDev: boolean;
    isElectronWindow: boolean;
    enableNowPlayingStage: boolean;
    activePlaybackContext: 'main' | 'stage';
    setActivePlaybackContext: SetState<'main' | 'stage'>;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    cachedCoverUrl: string | null;
    audioSrc: string | null;
    playQueue: SongResult[];
    isFmMode: boolean;
    playerState: PlayerState;
    duration: number;
    currentLineIndex: number;
    currentTime: MotionValue<number>;
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSongRef: MutableRefObject<number | null>;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    pendingResumeTimeRef: MutableRefObject<number | null>;
    lastAudioRecoverySourceRef: MutableRefObject<string | null>;
    currentOnlineAudioUrlFetchedAtRef: MutableRefObject<number | null>;
    setCurrentSong: SetState<SongResult | null>;
    setLyrics: (nextLyrics: LyricData | null) => void;
    setCachedCoverUrl: SetState<string | null>;
    setAudioSrc: SetState<string | null>;
    setPlayQueue: SetState<SongResult[]>;
    setIsFmMode: SetState<boolean>;
    setIsLyricsLoading: SetState<boolean>;
    setPlayerState: SetState<PlayerState>;
    setCurrentLineIndex: SetState<number>;
    setDuration: SetState<number>;
    setStatusMsg: SetState<StatusMessage | null>;
    navigateToPlayer: () => void;
};

type LoadPlaybackOptions = {
    autoplay?: boolean;
    resumeTime?: number;
    playerState?: PlayerState;
};

type NowPlayingDebugInfo = {
    lastQuerySource: 'idle' | 'progress' | 'pause-boundary' | 'resume-boundary' | 'poll';
    lastQueryStatus: 'idle' | 'pending' | 'applied' | 'skipped' | 'failed';
    lastResponseProgressMs: number | null;
    lastResponseRttMs: number | null;
    lastCandidateTimeSec: number | null;
    lastDisplayTimeSec: number | null;
    lastDriftSec: number | null;
    lastError: string | null;
};

// Keeps Stage / Now Playing state isolated from the main player snapshot.
export function useStagePlaybackController({
    t,
    isDev,
    isElectronWindow,
    enableNowPlayingStage,
    activePlaybackContext,
    setActivePlaybackContext,
    currentSong,
    lyrics,
    cachedCoverUrl,
    audioSrc,
    playQueue,
    isFmMode,
    playerState,
    duration,
    currentLineIndex,
    currentTime,
    audioRef,
    currentSongRef,
    shouldAutoPlayRef,
    pendingResumeTimeRef,
    lastAudioRecoverySourceRef,
    currentOnlineAudioUrlFetchedAtRef,
    setCurrentSong,
    setLyrics,
    setCachedCoverUrl,
    setAudioSrc,
    setPlayQueue,
    setIsFmMode,
    setIsLyricsLoading,
    setPlayerState,
    setCurrentLineIndex,
    setDuration,
    setStatusMsg,
    navigateToPlayer,
}: UseStagePlaybackControllerParams) {
    const [stageStatus, setStageStatus] = useState<StageStatus | null>(null);
    const [nowPlayingConnectionStatus, setNowPlayingConnectionStatus] = useState<NowPlayingConnectionStatus>('disabled');
    const [nowPlayingTrack, setNowPlayingTrack] = useState<NowPlayingTrackSnapshot | null>(null);
    const [nowPlayingLyricPayload, setNowPlayingLyricPayload] = useState<NowPlayingLyricPayload | null>(null);
    const [nowPlayingProgressMs, setNowPlayingProgressMs] = useState(0);
    const [nowPlayingProgressQuality, setNowPlayingProgressQuality] = useState<'precise' | 'coarse'>('coarse');
    const [nowPlayingPaused, setNowPlayingPaused] = useState(true);
    const [nowPlayingDebugInfo, setNowPlayingDebugInfo] = useState<NowPlayingDebugInfo>({
        lastQuerySource: 'idle',
        lastQueryStatus: 'idle',
        lastResponseProgressMs: null,
        lastResponseRttMs: null,
        lastCandidateTimeSec: null,
        lastDisplayTimeSec: null,
        lastDriftSec: null,
        lastError: null,
    });

    const mainPlaybackSnapshotRef = useRef<PlaybackSnapshot | null>(null);
    const stagePlaybackSnapshotRef = useRef<PlaybackSnapshot | null>(null);
    const lastLoadedStageEntryKeyRef = useRef<string | null>(null);
    const lastKnownMainSongRef = useRef<SongResult | null>(null);
    const lastKnownMainQueueRef = useRef<SongResult[]>([]);
    const stageLyricsClockRef = useRef<StageLyricsClockState>({
        startTimeSec: 0,
        endTimeSec: 0,
        baseTimeSec: 0,
        startedAtMs: null,
    });
    const nowPlayingClockRef = useRef<NowPlayingClockState>({
        baseTimeSec: 0,
        startedAtMs: null,
        durationSec: 0,
    });
    const nowPlayingProviderRef = useRef<NowPlayingProvider | null>(null);
    const nowPlayingContentLoadKeyRef = useRef<string | null>(null);
    const nowPlayingContentLoadRequestIdRef = useRef(0);
    const nowPlayingPreciseQueryRequestIdRef = useRef(0);
    const nowPlayingPausedRef = useRef(nowPlayingPaused);
    const lastNowPlayingPauseStateRef = useRef(nowPlayingPaused);
    const currentLineIndexRef = useRef(currentLineIndex);

    nowPlayingPausedRef.current = nowPlayingPaused;
    currentLineIndexRef.current = currentLineIndex;

    const stageActiveEntryKind = stageStatus?.activeEntryKind ?? null;
    const stageLyricsSession = stageStatus?.lyricsSession ?? null;
    const stageMediaSession = stageStatus?.mediaSession ?? null;
    const stageSource: StageSource | null = isElectronWindow
        ? (stageStatus?.modeEnabled ? (stageStatus?.source ?? 'stage-api') : null)
        : (enableNowPlayingStage ? 'now-playing' : null);
    const isNowPlayingStageActive = activePlaybackContext === 'stage' && stageSource === 'now-playing';

    const buildPlaybackSnapshot = useCallback((): PlaybackSnapshot => ({
        currentSong,
        lyrics,
        cachedCoverUrl,
        audioSrc,
        playQueue,
        isFmMode,
        playerState,
        currentTime: audioRef.current?.currentTime ?? currentTime.get(),
        duration,
        currentLineIndex,
    }), [audioRef, audioSrc, cachedCoverUrl, currentLineIndex, currentSong, currentTime, duration, isFmMode, lyrics, playQueue, playerState]);

    const applyPlaybackSnapshot = useCallback((snapshot: PlaybackSnapshot | null) => {
        pendingResumeTimeRef.current = snapshot ? Math.max(0, snapshot.currentTime) : null;
        shouldAutoPlayRef.current = snapshot?.playerState === PlayerState.PLAYING;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setCurrentSong(snapshot?.currentSong ?? null);
        setLyrics(snapshot?.lyrics ?? null);
        setCachedCoverUrl(snapshot?.cachedCoverUrl ?? null);
        setAudioSrc(snapshot?.audioSrc ?? null);
        setPlayQueue(snapshot?.playQueue ?? []);
        setIsFmMode(snapshot?.isFmMode ?? false);
        setIsLyricsLoading(false);
        setPlayerState(snapshot?.playerState ?? PlayerState.IDLE);
        setCurrentLineIndex(snapshot?.currentLineIndex ?? -1);
        currentTime.set(snapshot?.currentTime ?? 0);
        setDuration(snapshot?.duration ?? 0);
    }, [
        currentOnlineAudioUrlFetchedAtRef,
        currentTime,
        lastAudioRecoverySourceRef,
        pendingResumeTimeRef,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        shouldAutoPlayRef,
    ]);

    const clearPlaybackSurface = useCallback(() => {
        pendingResumeTimeRef.current = null;
        shouldAutoPlayRef.current = false;
        lastAudioRecoverySourceRef.current = null;
        currentOnlineAudioUrlFetchedAtRef.current = null;
        setCurrentSong(null);
        setLyrics(null);
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setPlayQueue([]);
        setIsFmMode(false);
        setIsLyricsLoading(false);
        setPlayerState(PlayerState.IDLE);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setDuration(0);
    }, [
        currentOnlineAudioUrlFetchedAtRef,
        currentTime,
        lastAudioRecoverySourceRef,
        pendingResumeTimeRef,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        shouldAutoPlayRef,
    ]);

    const clearMainPlaybackContext = useCallback(() => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
        }

        currentSongRef.current = null;
        mainPlaybackSnapshotRef.current = null;
        lastKnownMainSongRef.current = null;
        lastKnownMainQueueRef.current = [];
        clearPlaybackSurface();
    }, [audioRef, clearPlaybackSurface, currentSongRef]);

    const buildStagePlaybackSong = useCallback((session: StageMediaSession): SongResult => ({
        id: -Math.max(1, Math.floor(session.updatedAt || Date.now())),
        name: session.title || 'Stage Session',
        artists: [{ id: 0, name: session.artist || 'Stage' }],
        album: { id: 0, name: session.album || 'Stage', picUrl: session.coverArtUrl || session.coverUrl || undefined },
        duration: Math.max(0, Math.floor(session.durationMs || 0)),
        al: { id: 0, name: session.album || 'Stage', picUrl: session.coverArtUrl || session.coverUrl || undefined },
        ar: [{ id: 0, name: session.artist || 'Stage' }],
        dt: Math.max(0, Math.floor(session.durationMs || 0)),
        sourceType: 'cloud',
        isStage: true,
        stageData: session,
    } as SongResult), []);

    const resetStageLyricsClock = useCallback(() => {
        stageLyricsClockRef.current = {
            startTimeSec: 0,
            endTimeSec: 0,
            baseTimeSec: 0,
            startedAtMs: null,
        };
    }, []);

    const resetNowPlayingClock = useCallback(() => {
        nowPlayingClockRef.current = {
            baseTimeSec: 0,
            startedAtMs: null,
            durationSec: 0,
        };
    }, []);

    const syncStageLyricsClock = useCallback((timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec = 0) => {
        const safeStartTime = Math.max(0, startTimeSec);
        const safeEndTime = Math.max(safeStartTime, endTimeSec);
        const safeTime = Math.min(Math.max(timeSec, safeStartTime), safeEndTime);

        stageLyricsClockRef.current = {
            startTimeSec: safeStartTime,
            endTimeSec: safeEndTime,
            baseTimeSec: safeTime,
            startedAtMs: nextPlayerState === PlayerState.PLAYING ? performance.now() : null,
        };
    }, []);

    const getSyntheticStageLyricsTime = useCallback((nowMs = performance.now()) => {
        const clock = stageLyricsClockRef.current;
        if (clock.startedAtMs === null) {
            return Math.min(Math.max(clock.baseTimeSec, clock.startTimeSec), clock.endTimeSec);
        }

        const elapsedSeconds = Math.max(0, (nowMs - clock.startedAtMs) / 1000);
        return Math.min(Math.max(clock.baseTimeSec + elapsedSeconds, clock.startTimeSec), clock.endTimeSec);
    }, []);

    const syncNowPlayingClock = useCallback((progressSec: number, durationSec: number, paused: boolean) => {
        const safeDuration = Math.max(0, durationSec);
        if (isDev) {
            console.log('[NowPlaying][App] syncNowPlayingClock', {
                progressSec,
                durationSec,
                paused,
            });
        }
        nowPlayingClockRef.current = {
            baseTimeSec: Math.min(Math.max(progressSec, 0), safeDuration || progressSec),
            startedAtMs: paused ? null : performance.now(),
            durationSec: safeDuration,
        };
    }, [isDev]);

    const getNowPlayingDisplayTime = useCallback((nowMs = performance.now()) => {
        const clock = nowPlayingClockRef.current;
        if (clock.startedAtMs === null) {
            return Math.min(Math.max(clock.baseTimeSec, 0), clock.durationSec || clock.baseTimeSec);
        }

        const elapsedSeconds = Math.max(0, (nowMs - clock.startedAtMs) / 1000);
        const nextTime = clock.baseTimeSec + elapsedSeconds;
        return Math.min(Math.max(nextTime, 0), clock.durationSec || nextTime);
    }, []);

    const getNowPlayingDurationSec = useCallback(() => {
        return Math.max(0, (nowPlayingTrack?.durationMs ?? nowPlayingLyricPayload?.durationMs ?? 0) / 1000);
    }, [nowPlayingLyricPayload?.durationMs, nowPlayingTrack?.durationMs]);

    const syncNowPlayingDisplaySurface = useCallback((timeSec: number, nextLyrics: LyricData | null = lyrics) => {
        const durationSec = getNowPlayingDurationSec();
        const safeTime = clampNowPlayingTimeSec(timeSec, durationSec || timeSec);
        currentTime.set(safeTime);

        if (nextLyrics) {
            const foundIndex = findLatestActiveLineIndex(nextLyrics.lines, safeTime);
            if (foundIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = foundIndex;
                setCurrentLineIndex(foundIndex);
            }
        } else if (currentLineIndexRef.current !== -1) {
            currentLineIndexRef.current = -1;
            setCurrentLineIndex(-1);
        }
    }, [currentTime, getNowPlayingDurationSec, lyrics, setCurrentLineIndex]);

    const applyNowPlayingPreciseAnchor = useCallback((
        progressMs: number,
        paused: boolean,
        options: { rttMs?: number; onlyIfDrifted?: boolean; source: NowPlayingDebugInfo['lastQuerySource']; }
    ) => {
        const durationSec = getNowPlayingDurationSec();
        const candidateTimeSec = resolveNowPlayingAnchorTime({
            progressMs,
            rttMs: options.rttMs ?? 0,
            paused,
            durationSec: durationSec || undefined,
        });
        const displayTimeSec = getNowPlayingDisplayTime();
        const shouldApply = !options.onlyIfDrifted || shouldApplyNowPlayingProgressCorrection(displayTimeSec, candidateTimeSec);
        const driftSec = candidateTimeSec - displayTimeSec;

        setNowPlayingDebugInfo({
            lastQuerySource: options.source,
            lastQueryStatus: shouldApply ? 'applied' : 'skipped',
            lastResponseProgressMs: progressMs,
            lastResponseRttMs: options.rttMs ?? 0,
            lastCandidateTimeSec: candidateTimeSec,
            lastDisplayTimeSec: displayTimeSec,
            lastDriftSec: driftSec,
            lastError: null,
        });

        if (!shouldApply) {
            return false;
        }

        if (isDev) {
            console.log('[NowPlaying][App] Progress correction APPLIED', {
                source: options.source,
                paused,
                progressMs,
                rttMs: options.rttMs ?? 0,
                driftSec,
            });
        }

        syncNowPlayingClock(candidateTimeSec, Math.max(durationSec, candidateTimeSec), paused);
        if (isNowPlayingStageActive) {
            syncNowPlayingDisplaySurface(candidateTimeSec);
        }
        return true;
    }, [
        getNowPlayingDisplayTime,
        getNowPlayingDurationSec,
        isNowPlayingStageActive,
        syncNowPlayingClock,
        syncNowPlayingDisplaySurface,
    ]);

    const queryNowPlayingPreciseProgress = useCallback(async (
        paused: boolean,
        options: { onlyIfDrifted?: boolean; source: NowPlayingDebugInfo['lastQuerySource']; }
    ) => {
        const requestId = nowPlayingPreciseQueryRequestIdRef.current + 1;
        nowPlayingPreciseQueryRequestIdRef.current = requestId;
        const requestStartedAt = performance.now();
        setNowPlayingDebugInfo(current => ({
            ...current,
            lastQuerySource: options.source,
            lastQueryStatus: 'pending',
            lastError: null,
        }));

        try {
            const response = await fetch(NOW_PLAYING_PROGRESS_QUERY_URL, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json() as { progress?: unknown };
            const responseAt = performance.now();
            const progressMs = parseNowPlayingProgressResponseMs(payload.progress);
            if (progressMs === null) {
                throw new Error('Missing progress value');
            }

            if (nowPlayingPreciseQueryRequestIdRef.current !== requestId) {
                return false;
            }

            return applyNowPlayingPreciseAnchor(progressMs, paused, {
                rttMs: responseAt - requestStartedAt,
                onlyIfDrifted: options.onlyIfDrifted,
                source: options.source,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            setNowPlayingDebugInfo(current => ({
                ...current,
                lastQuerySource: options.source,
                lastQueryStatus: 'failed',
                lastError: message,
            }));
            console.warn('[NowPlaying] Failed to query precise progress', {
                source: options.source,
                paused,
                error: message,
            });
            return false;
        }
    }, [applyNowPlayingPreciseAnchor, isDev]);

    const buildStageLyricsPlaybackSong = useCallback((session: StageLyricsSession, lyricData: LyricData): SongResult => ({
        id: -Math.max(1, Math.floor(session.updatedAt || Date.now())),
        name: session.title || lyricData.title || 'Stage Lyrics',
        artists: [{ id: 0, name: session.artist || lyricData.artist || 'Stage' }],
        album: { id: 0, name: session.album || 'Stage', picUrl: undefined },
        duration: Math.max(0, Math.floor(getStageLyricsTimelineBounds(lyricData).endTimeSec * 1000)),
        al: { id: 0, name: session.album || 'Stage', picUrl: undefined },
        ar: [{ id: 0, name: session.artist || lyricData.artist || 'Stage' }],
        dt: Math.max(0, Math.floor(getStageLyricsTimelineBounds(lyricData).endTimeSec * 1000)),
        sourceType: 'cloud',
        isStage: true,
        stageData: session,
    } as SongResult), []);

    const buildNowPlayingLyricsSession = useCallback((track: NowPlayingTrackSnapshot | null, payload: NowPlayingLyricPayload): StageLyricsSession | null => {
        const lyricSource = buildNowPlayingLyricSource(payload);
        if (!lyricSource) {
            return null;
        }

        return {
            title: track?.title || payload.title || 'Now Playing',
            artist: track?.artist || payload.artist || 'Now Playing',
            album: track?.album || undefined,
            lyricSource,
            updatedAt: Date.now(),
        };
    }, []);

    const loadStageSessionIntoPlayback = useCallback(async (session: StageMediaSession | null, options: { autoplay?: boolean; } = {}) => {
        if (!session) {
            currentSongRef.current = null;
            resetStageLyricsClock();
            clearPlaybackSurface();
            return;
        }

        resetStageLyricsClock();
        const stageSong = buildStagePlaybackSong(session);
        shouldAutoPlayRef.current = options.autoplay ?? true;
        pendingResumeTimeRef.current = null;
        currentSongRef.current = stageSong.id;
        setIsLyricsLoading(false);
        let parsedLyrics: LyricData | null = null;
        if (session.lyricsText?.trim()) {
            try {
                parsedLyrics = await LyricParserFactory.parse({
                    type: 'local',
                    lrcContent: session.lyricsText,
                    formatHint: session.lyricsFormat || undefined,
                });
            } catch (error) {
                console.warn('[Stage] Failed to parse stage lyrics', error);
            }
        }
        setCurrentSong(stageSong);
        setLyrics(parsedLyrics);
        setCachedCoverUrl(session.coverArtUrl || session.coverUrl || null);
        setAudioSrc(session.audioSrc);
        setPlayQueue([]);
        setIsFmMode(false);
        setPlayerState(PlayerState.IDLE);
        setCurrentLineIndex(-1);
        currentTime.set(0);
        setDuration(Math.max(0, (session.durationMs || 0) / 1000));
    }, [
        buildStagePlaybackSong,
        clearPlaybackSurface,
        currentSongRef,
        currentTime,
        pendingResumeTimeRef,
        resetStageLyricsClock,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        shouldAutoPlayRef,
    ]);

    const loadStageLyricsIntoPlayback = useCallback(async (
        session: StageLyricsSession | null,
        options: LoadPlaybackOptions = {},
    ) => {
        if (!session) {
            currentSongRef.current = null;
            resetStageLyricsClock();
            clearPlaybackSurface();
            return;
        }

        let parsedLyrics: LyricData | null = null;
        try {
            parsedLyrics = await LyricParserFactory.parse(session.lyricSource as never);
        } catch (error) {
            console.warn('[Stage] Failed to parse stage lyrics session', error);
        }

        if (!hasRenderableLyrics(parsedLyrics)) {
            resetStageLyricsClock();
            clearPlaybackSurface();
            setStatusMsg({ type: 'error', text: t('status.playbackError') });
            return;
        }

        const { startTimeSec, endTimeSec } = getStageLyricsTimelineBounds(parsedLyrics);
        const nextPlayerState = options.playerState ?? ((options.autoplay ?? true) ? PlayerState.PLAYING : PlayerState.PAUSED);
        const initialTime = options.resumeTime ?? startTimeSec;
        const nextLineIndex = findLatestActiveLineIndex(parsedLyrics.lines, initialTime);
        const stageSong = buildStageLyricsPlaybackSong(session, parsedLyrics);

        clearPlaybackSurface();
        shouldAutoPlayRef.current = false;
        pendingResumeTimeRef.current = null;
        currentSongRef.current = stageSong.id;
        setCurrentSong(stageSong);
        setCachedCoverUrl(null);
        setAudioSrc(null);
        setPlayQueue([]);
        setIsFmMode(false);
        setIsLyricsLoading(false);
        setLyrics(parsedLyrics);
        currentTime.set(initialTime);
        setCurrentLineIndex(nextLineIndex);
        setDuration(endTimeSec);
        setPlayerState(nextPlayerState);
        syncStageLyricsClock(initialTime, endTimeSec, nextPlayerState, startTimeSec);
    }, [
        buildStageLyricsPlaybackSong,
        clearPlaybackSurface,
        currentSongRef,
        currentTime,
        pendingResumeTimeRef,
        resetStageLyricsClock,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        setPlayerState,
        setStatusMsg,
        shouldAutoPlayRef,
        syncStageLyricsClock,
        t,
    ]);

    const loadNowPlayingIntoPlayback = useCallback(async (
        track: NowPlayingTrackSnapshot | null,
        lyricPayload: NowPlayingLyricPayload | null,
        requestId: number,
    ) => {
        const durationSec = Math.max(0, (track?.durationMs ?? lyricPayload?.durationMs ?? 0) / 1000);
        if (isDev) {
            console.log('[NowPlaying][App] loadNowPlayingIntoPlayback', {
                durationSec,
                requestId,
                nowPlayingTrack: track,
                nowPlayingLyricPayload: lyricPayload,
            });
        }

        const nextLyricsSession = lyricPayload
            ? buildNowPlayingLyricsSession(track, lyricPayload)
            : null;

        let parsedLyrics: LyricData | null = null;
        if (nextLyricsSession) {
            try {
                parsedLyrics = await LyricParserFactory.parse(nextLyricsSession.lyricSource as never);
            } catch (error) {
                console.warn('[NowPlaying] Failed to parse now playing lyrics', error);
            }
        }

        if (nowPlayingContentLoadRequestIdRef.current !== requestId) {
            return;
        }

        const renderableLyrics = hasRenderableLyrics(parsedLyrics) ? parsedLyrics : null;
        const fallbackTitle = track?.title || lyricPayload?.title || 'Now Playing';
        const fallbackArtist = track?.artist || lyricPayload?.artist || 'Now Playing';
        const fallbackAlbum = track?.album || '';
        const fallbackCoverUrl = track?.coverUrl || null;
        const resolvedDurationSec = durationSec || (renderableLyrics ? getStageLyricsTimelineBounds(renderableLyrics).endTimeSec : 0);
        const fallbackSong: SongResult | null = (track || lyricPayload) ? ({
            id: -Math.max(1, Math.floor(Date.now())),
            name: fallbackTitle,
            artists: [{ id: 0, name: fallbackArtist }],
            album: { id: 0, name: fallbackAlbum || 'Now Playing', picUrl: fallbackCoverUrl || undefined },
            duration: Math.max(0, Math.floor(resolvedDurationSec * 1000)),
            al: { id: 0, name: fallbackAlbum || 'Now Playing', picUrl: fallbackCoverUrl || undefined },
            ar: [{ id: 0, name: fallbackArtist }],
            dt: Math.max(0, Math.floor(resolvedDurationSec * 1000)),
            sourceType: 'cloud',
            isStage: true,
        } as SongResult) : null;

        shouldAutoPlayRef.current = false;
        pendingResumeTimeRef.current = null;
        currentSongRef.current = fallbackSong?.id ?? null;
        setCurrentSong(fallbackSong);
        setCachedCoverUrl(fallbackCoverUrl);
        setAudioSrc(null);
        setPlayQueue([]);
        setIsFmMode(false);
        setIsLyricsLoading(false);
        setLyrics(renderableLyrics);
        setDuration(resolvedDurationSec);

        const displayTimeSec = clampNowPlayingTimeSec(getNowPlayingDisplayTime(), resolvedDurationSec);
        if (isNowPlayingStageActive) {
            syncNowPlayingDisplaySurface(displayTimeSec, renderableLyrics);
        } else {
            const nextLineIndex = renderableLyrics ? findLatestActiveLineIndex(renderableLyrics.lines, displayTimeSec) : -1;
            if (nextLineIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = nextLineIndex;
                setCurrentLineIndex(nextLineIndex);
            }
        }
    }, [
        buildNowPlayingLyricsSession,
        currentSongRef,
        getNowPlayingDisplayTime,
        isDev,
        isNowPlayingStageActive,
        pendingResumeTimeRef,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setLyrics,
        setPlayQueue,
        shouldAutoPlayRef,
        syncNowPlayingDisplaySurface,
    ]);

    const clearPersistedStagePlaybackCache = useCallback(async () => {
        const cachedLastSong = await getFromCache<SongResult>('last_song');
        const cachedLastQueue = await getFromCache<SongResult[]>('last_queue');
        const tasks: Promise<void>[] = [];

        if (isStagePlaybackSong(cachedLastSong)) {
            tasks.push(removeFromCache('last_song'));
        }

        if (cachedLastQueue?.some(queuedSong => isStagePlaybackSong(queuedSong))) {
            const sanitizedQueue = cachedLastQueue.filter(queuedSong => !isStagePlaybackSong(queuedSong));
            tasks.push(
                sanitizedQueue.length > 0
                    ? saveToCache('last_queue', sanitizedQueue)
                    : removeFromCache('last_queue'),
            );
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    }, []);

    const openStagePlayer = useCallback(async () => {
        if (activePlaybackContext === 'main') {
            mainPlaybackSnapshotRef.current = buildPlaybackSnapshot();
        } else {
            stagePlaybackSnapshotRef.current = buildPlaybackSnapshot();
        }

        if (stageSource === 'now-playing') {
            clearMainPlaybackContext();
            stagePlaybackSnapshotRef.current = null;
            setActivePlaybackContext('stage');
            if (nowPlayingTrack || nowPlayingLyricPayload) {
                const requestId = nowPlayingContentLoadRequestIdRef.current + 1;
                nowPlayingContentLoadRequestIdRef.current = requestId;
                void loadNowPlayingIntoPlayback(nowPlayingTrack, nowPlayingLyricPayload, requestId);
            }
            navigateToPlayer();
            if (!nowPlayingTrack && !nowPlayingLyricPayload) {
                setStatusMsg({ type: 'info', text: '等待本地 Now Playing 服务输入' });
            }
            return;
        }

        const savedStageSnapshot = stagePlaybackSnapshotRef.current;
        const savedStageEntryKey = lastLoadedStageEntryKeyRef.current;
        const nextStageEntryKey = buildStageEntryKey(stageActiveEntryKind, stageLyricsSession, stageMediaSession);
        setActivePlaybackContext('stage');

        if (savedStageSnapshot && savedStageEntryKey && savedStageEntryKey === nextStageEntryKey) {
            applyPlaybackSnapshot(savedStageSnapshot);
            if (stageActiveEntryKind === 'lyrics') {
                syncStageLyricsClock(
                    savedStageSnapshot.currentTime,
                    savedStageSnapshot.duration,
                    savedStageSnapshot.playerState,
                    stageLyricsClockRef.current.startTimeSec,
                );
            }
        } else if (stageActiveEntryKind === 'lyrics') {
            void loadStageLyricsIntoPlayback(stageLyricsSession, { autoplay: true });
        } else if (stageActiveEntryKind === 'media') {
            await loadStageSessionIntoPlayback(stageMediaSession, { autoplay: Boolean(stageMediaSession) });
        } else {
            await loadStageSessionIntoPlayback(null);
        }

        navigateToPlayer();
        if (!nextStageEntryKey) {
            setStatusMsg({ type: 'info', text: t('status.stageWaiting') || '等待外部 Stage 输入' });
        }
    }, [
        activePlaybackContext,
        applyPlaybackSnapshot,
        buildPlaybackSnapshot,
        clearMainPlaybackContext,
        loadNowPlayingIntoPlayback,
        loadStageLyricsIntoPlayback,
        loadStageSessionIntoPlayback,
        navigateToPlayer,
        nowPlayingLyricPayload,
        nowPlayingTrack,
        setActivePlaybackContext,
        setStatusMsg,
        stageActiveEntryKind,
        stageLyricsSession,
        stageMediaSession,
        stageSource,
        syncStageLyricsClock,
        t,
    ]);

    const leaveStagePlayback = useCallback(() => {
        if (activePlaybackContext !== 'stage') {
            return;
        }

        if (stageSource === 'now-playing') {
            stagePlaybackSnapshotRef.current = null;
            setActivePlaybackContext('main');
            clearMainPlaybackContext();
            return;
        }

        stagePlaybackSnapshotRef.current = buildPlaybackSnapshot();
        setActivePlaybackContext('main');
        applyPlaybackSnapshot(mainPlaybackSnapshotRef.current);
    }, [activePlaybackContext, applyPlaybackSnapshot, buildPlaybackSnapshot, clearMainPlaybackContext, setActivePlaybackContext, stageSource]);

    const interruptStagePlaybackForMainTransition = useCallback(() => {
        if (activePlaybackContext !== 'stage') {
            return null;
        }

        if (stageSource === 'now-playing') {
            stagePlaybackSnapshotRef.current = null;
            setActivePlaybackContext('main');
            clearMainPlaybackContext();
            return null;
        }

        const currentStageSnapshot = buildPlaybackSnapshot();
        const restoredMainSnapshot = mainPlaybackSnapshotRef.current;

        stagePlaybackSnapshotRef.current = currentStageSnapshot;
        setActivePlaybackContext('main');
        applyPlaybackSnapshot(restoredMainSnapshot);

        return restoredMainSnapshot;
    }, [activePlaybackContext, applyPlaybackSnapshot, buildPlaybackSnapshot, clearMainPlaybackContext, setActivePlaybackContext, stageSource]);

    const clearStagePlaybackSession = useCallback(() => {
        stagePlaybackSnapshotRef.current = null;
        lastLoadedStageEntryKeyRef.current = null;
    }, []);

    useEffect(() => {
        if (!window.electron?.getStageStatus) {
            return;
        }

        let disposed = false;

        const syncStageStatus = (nextStatus: StageStatus) => {
            if (!disposed) {
                setStageStatus(nextStatus);
            }
        };

        window.electron.getStageStatus().then(syncStageStatus).catch((error) => {
            console.warn('[Stage] Failed to load stage status', error);
        });

        const unsubscribeUpdated = window.electron.onStageSessionUpdated?.(syncStageStatus);
        const unsubscribeCleared = window.electron.onStageSessionCleared?.(syncStageStatus);

        return () => {
            disposed = true;
            unsubscribeUpdated?.();
            unsubscribeCleared?.();
        };
    }, []);

    useEffect(() => {
        if (stageSource !== 'now-playing') {
            nowPlayingProviderRef.current?.stop();
            nowPlayingProviderRef.current = null;
            nowPlayingContentLoadKeyRef.current = null;
            nowPlayingContentLoadRequestIdRef.current = 0;
            nowPlayingPreciseQueryRequestIdRef.current = 0;
            setNowPlayingConnectionStatus('disabled');
            setNowPlayingTrack(null);
            setNowPlayingLyricPayload(null);
            setNowPlayingProgressMs(0);
            setNowPlayingProgressQuality('coarse');
            setNowPlayingPaused(true);
            setNowPlayingDebugInfo({
                lastQuerySource: 'idle',
                lastQueryStatus: 'idle',
                lastResponseProgressMs: null,
                lastResponseRttMs: null,
                lastCandidateTimeSec: null,
                lastDisplayTimeSec: null,
                lastDriftSec: null,
                lastError: null,
            });
            resetNowPlayingClock();
            return;
        }

        const provider = new NowPlayingProvider({
            onConnectionStatusChange: setNowPlayingConnectionStatus,
            onTrack: setNowPlayingTrack,
            onLyric: setNowPlayingLyricPayload,
            onPauseState: setNowPlayingPaused,
            onProgress: ({ progressMs, quality }) => {
                setNowPlayingProgressMs(progressMs);
                setNowPlayingProgressQuality(quality);
            },
        });

        nowPlayingProviderRef.current = provider;
        provider.start();

        return () => {
            provider.stop();
            if (nowPlayingProviderRef.current === provider) {
                nowPlayingProviderRef.current = null;
            }
        };
    }, [resetNowPlayingClock, stageSource]);

    useEffect(() => {
        if (stageSource !== 'now-playing') {
            return;
        }

        if (nowPlayingProgressQuality !== 'precise') {
            return;
        }

        void applyNowPlayingPreciseAnchor(nowPlayingProgressMs, nowPlayingPausedRef.current, { source: 'progress' });
    }, [
        applyNowPlayingPreciseAnchor,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        stageSource,
    ]);

    useEffect(() => {
        if (activePlaybackContext === 'main') {
            mainPlaybackSnapshotRef.current = buildPlaybackSnapshot();
            lastKnownMainSongRef.current = currentSong;
            lastKnownMainQueueRef.current = playQueue;
        } else {
            stagePlaybackSnapshotRef.current = buildPlaybackSnapshot();
        }
    }, [activePlaybackContext, buildPlaybackSnapshot, currentSong, playQueue]);

    useEffect(() => {
        if (stageSource === 'now-playing') {
            lastLoadedStageEntryKeyRef.current = null;
            stagePlaybackSnapshotRef.current = null;
            return;
        }

        const nextStageEntryKey = buildStageEntryKey(stageActiveEntryKind, stageLyricsSession, stageMediaSession);
        if (!nextStageEntryKey) {
            lastLoadedStageEntryKeyRef.current = null;
            if (activePlaybackContext === 'stage') {
                void loadStageSessionIntoPlayback(null);
            } else {
                stagePlaybackSnapshotRef.current = null;
            }
            return;
        }

        if (activePlaybackContext === 'stage') {
            if (lastLoadedStageEntryKeyRef.current === nextStageEntryKey) {
                return;
            }
            lastLoadedStageEntryKeyRef.current = nextStageEntryKey;
            if (stageActiveEntryKind === 'lyrics') {
                void loadStageLyricsIntoPlayback(stageLyricsSession, { autoplay: true });
            } else {
                void loadStageSessionIntoPlayback(stageMediaSession, { autoplay: true });
            }
            return;
        }

        lastLoadedStageEntryKeyRef.current = nextStageEntryKey;
        stagePlaybackSnapshotRef.current = null;
    }, [
        activePlaybackContext,
        loadStageLyricsIntoPlayback,
        loadStageSessionIntoPlayback,
        stageActiveEntryKind,
        stageLyricsSession,
        stageMediaSession,
        stageSource,
    ]);

    useEffect(() => {
        if (stageSource !== 'now-playing' || activePlaybackContext !== 'stage') {
            return;
        }

        const nextContentLoadKey = buildNowPlayingContentLoadKey(nowPlayingTrack, nowPlayingLyricPayload);
        if (!nextContentLoadKey || nowPlayingContentLoadKeyRef.current === nextContentLoadKey) {
            return;
        }

        nowPlayingContentLoadKeyRef.current = nextContentLoadKey;
        const requestId = nowPlayingContentLoadRequestIdRef.current + 1;
        nowPlayingContentLoadRequestIdRef.current = requestId;
        void loadNowPlayingIntoPlayback(nowPlayingTrack, nowPlayingLyricPayload, requestId);
    }, [
        activePlaybackContext,
        buildNowPlayingContentLoadKey,
        loadNowPlayingIntoPlayback,
        nowPlayingLyricPayload,
        nowPlayingTrack,
        stageSource,
    ]);

    useEffect(() => {
        if (stageSource !== 'now-playing') {
            return;
        }

        const durationSec = getNowPlayingDurationSec();
        const displayTime = clampNowPlayingTimeSec(getNowPlayingDisplayTime(), durationSec || getNowPlayingDisplayTime());
        syncNowPlayingClock(displayTime, Math.max(durationSec, displayTime), nowPlayingPaused);

        if (isDev) {
            console.log('[NowPlaying][App] Syncing pause state into currentTime', {
                displayTime,
                nowPlayingPaused,
                durationSec,
            });
        }

        if (isNowPlayingStageActive) {
            syncNowPlayingDisplaySurface(displayTime);
        }
    }, [
        getNowPlayingDisplayTime,
        getNowPlayingDurationSec,
        isDev,
        isNowPlayingStageActive,
        nowPlayingLyricPayload,
        nowPlayingPaused,
        nowPlayingTrack,
        stageSource,
        syncNowPlayingClock,
        syncNowPlayingDisplaySurface,
    ]);

    useEffect(() => {
        if (stageSource !== 'now-playing') {
            lastNowPlayingPauseStateRef.current = nowPlayingPaused;
            return;
        }

        const pauseStateChanged = lastNowPlayingPauseStateRef.current !== nowPlayingPaused;
        lastNowPlayingPauseStateRef.current = nowPlayingPaused;
        if (!pauseStateChanged) {
            return;
        }

        if (!nowPlayingTrack && !nowPlayingLyricPayload && nowPlayingProgressMs === 0) {
            return;
        }

        void queryNowPlayingPreciseProgress(nowPlayingPaused, {
            source: nowPlayingPaused ? 'pause-boundary' : 'resume-boundary',
        });
    }, [
        nowPlayingLyricPayload,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingTrack,
        queryNowPlayingPreciseProgress,
        stageSource,
    ]);

    useEffect(() => {
        if (!isNowPlayingStageActive) {
            return;
        }

        syncNowPlayingDisplaySurface(getNowPlayingDisplayTime());
    }, [getNowPlayingDisplayTime, isNowPlayingStageActive, nowPlayingLyricPayload, nowPlayingTrack, syncNowPlayingDisplaySurface]);

    useEffect(() => {
        if (!isNowPlayingStageActive || nowPlayingPaused) {
            return;
        }

        const intervalId = window.setInterval(() => {
            void queryNowPlayingPreciseProgress(false, { onlyIfDrifted: true, source: 'poll' });
        }, NOW_PLAYING_PROGRESS_POLL_INTERVAL_MS);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [isNowPlayingStageActive, nowPlayingPaused, queryNowPlayingPreciseProgress]);

    useEffect(() => {
        if (activePlaybackContext === 'stage' && stageSource === 'now-playing') {
            return;
        }

        nowPlayingContentLoadRequestIdRef.current += 1;
        nowPlayingPreciseQueryRequestIdRef.current += 1;
    }, [activePlaybackContext, stageSource]);

    useEffect(() => {
        if (!isNowPlayingStageActive) {
            return;
        }

        const nextPlayerState = nowPlayingPaused ? PlayerState.PAUSED : PlayerState.PLAYING;
        setPlayerState(current => current === nextPlayerState ? current : nextPlayerState);
    }, [isNowPlayingStageActive, nowPlayingPaused, setPlayerState]);

    useEffect(() => {
        if (activePlaybackContext !== 'stage' || stageSource) {
            return;
        }

        stagePlaybackSnapshotRef.current = null;
        setActivePlaybackContext('main');
        clearMainPlaybackContext();
    }, [activePlaybackContext, clearMainPlaybackContext, setActivePlaybackContext, stageSource]);

    return {
        stageStatus,
        setStageStatus,
        stageSource,
        stageActiveEntryKind,
        stageLyricsSession,
        stageMediaSession,
        nowPlayingConnectionStatus,
        nowPlayingTrack,
        nowPlayingLyricPayload,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        nowPlayingPaused,
        nowPlayingDebugInfo,
        isNowPlayingStageActive,
        mainPlaybackSnapshotRef,
        stageLyricsClockRef,
        resetNowPlayingClock,
        syncStageLyricsClock,
        getSyntheticStageLyricsTime,
        syncNowPlayingClock,
        getNowPlayingDisplayTime,
        loadStageSessionIntoPlayback,
        clearPersistedStagePlaybackCache,
        openStagePlayer,
        leaveStagePlayback,
        interruptStagePlaybackForMainTransition,
        clearStagePlaybackSession,
    };
}
