import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { MotionValue } from 'framer-motion';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { getFromCache, removeFromCache, saveToCache } from '../services/db';
import { NowPlayingProvider } from '../services/nowPlayingProvider';
import { findLatestActiveLineIndex, hasRenderableLyrics } from '../utils/appPlaybackHelpers';
import { buildStageEntryKey, getStageLyricsTimelineBounds } from '../utils/appStageHelpers';
import { isStagePlaybackSong } from '../utils/appPlaybackGuards';
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
        progressMs: number,
        paused: boolean,
        options: { autoplay?: boolean; } = {},
    ) => {
        const nextPlayerState = paused
            ? PlayerState.PAUSED
            : ((options.autoplay ?? true) ? PlayerState.PLAYING : PlayerState.PAUSED);
        const durationSec = Math.max(0, (track?.durationMs ?? lyricPayload?.durationMs ?? 0) / 1000);
        const progressSec = Math.max(0, progressMs / 1000);
        if (isDev) {
            console.log('[NowPlaying][App] loadNowPlayingIntoPlayback', {
                options,
                nextPlayerState,
                durationSec,
                progressSec,
                nowPlayingTrack: track,
                nowPlayingLyricPayload: lyricPayload,
            });
        }

        const nextLyricsSession = lyricPayload
            ? buildNowPlayingLyricsSession(track, lyricPayload)
            : null;

        if (nextLyricsSession) {
            await loadStageLyricsIntoPlayback(nextLyricsSession, {
                autoplay: options.autoplay,
                resumeTime: progressSec,
                playerState: nextPlayerState,
            });
            setCachedCoverUrl(track?.coverUrl || null);
            syncNowPlayingClock(progressSec, Math.max(durationSec, progressSec), nextPlayerState !== PlayerState.PLAYING);
            return;
        }

        const fallbackSong: SongResult | null = track ? ({
            id: -Math.max(1, Math.floor(Date.now())),
            name: track.title || 'Now Playing',
            artists: [{ id: 0, name: track.artist || 'Now Playing' }],
            album: { id: 0, name: track.album || 'Now Playing', picUrl: track.coverUrl || undefined },
            duration: Math.max(0, Math.floor(track.durationMs || 0)),
            al: { id: 0, name: track.album || 'Now Playing', picUrl: track.coverUrl || undefined },
            ar: [{ id: 0, name: track.artist || 'Now Playing' }],
            dt: Math.max(0, Math.floor(track.durationMs || 0)),
            sourceType: 'cloud',
            isStage: true,
        } as SongResult) : null;

        clearPlaybackSurface();
        resetStageLyricsClock();
        shouldAutoPlayRef.current = false;
        pendingResumeTimeRef.current = null;
        currentSongRef.current = fallbackSong?.id ?? null;
        setCurrentSong(fallbackSong);
        setCachedCoverUrl(track?.coverUrl || null);
        setAudioSrc(null);
        setPlayQueue([]);
        setIsFmMode(false);
        setIsLyricsLoading(false);
        currentTime.set(progressSec);
        setCurrentLineIndex(-1);
        setDuration(durationSec);
        setPlayerState(nextPlayerState);
        syncNowPlayingClock(progressSec, durationSec, nextPlayerState !== PlayerState.PLAYING);
    }, [
        buildNowPlayingLyricsSession,
        clearPlaybackSurface,
        currentSongRef,
        currentTime,
        isDev,
        loadStageLyricsIntoPlayback,
        pendingResumeTimeRef,
        resetStageLyricsClock,
        setAudioSrc,
        setCachedCoverUrl,
        setCurrentLineIndex,
        setCurrentSong,
        setDuration,
        setIsFmMode,
        setIsLyricsLoading,
        setPlayQueue,
        setPlayerState,
        shouldAutoPlayRef,
        syncNowPlayingClock,
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
            await loadNowPlayingIntoPlayback(
                nowPlayingTrack,
                nowPlayingLyricPayload,
                nowPlayingProgressMs,
                nowPlayingPaused,
                { autoplay: true },
            );
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
        nowPlayingPaused,
        nowPlayingProgressMs,
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
            setNowPlayingConnectionStatus('disabled');
            setNowPlayingTrack(null);
            setNowPlayingLyricPayload(null);
            setNowPlayingProgressMs(0);
            setNowPlayingProgressQuality('coarse');
            setNowPlayingPaused(true);
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

        const durationSec = Math.max(0, (nowPlayingTrack?.durationMs ?? nowPlayingLyricPayload?.durationMs ?? 0) / 1000);
        const incomingTime = nowPlayingProgressMs / 1000;
        const displayTime = getNowPlayingDisplayTime();
        const nextTime = nowPlayingPaused && nowPlayingProgressQuality === 'coarse'
            ? Math.max(incomingTime, displayTime)
            : incomingTime;
        syncNowPlayingClock(nextTime, durationSec, nowPlayingPaused);
    }, [
        getNowPlayingDisplayTime,
        nowPlayingLyricPayload?.durationMs,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        nowPlayingTrack?.durationMs,
        stageSource,
        syncNowPlayingClock,
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

        void loadNowPlayingIntoPlayback(
            nowPlayingTrack,
            nowPlayingLyricPayload,
            nowPlayingProgressMs,
            nowPlayingPaused,
            { autoplay: true },
        );
    }, [
        activePlaybackContext,
        loadNowPlayingIntoPlayback,
        nowPlayingLyricPayload,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingTrack,
        stageSource,
    ]);

    useEffect(() => {
        if (activePlaybackContext !== 'stage' || stageSource) {
            return;
        }

        stagePlaybackSnapshotRef.current = null;
        setActivePlaybackContext('main');
        clearMainPlaybackContext();
    }, [activePlaybackContext, clearMainPlaybackContext, setActivePlaybackContext, stageSource]);

    useEffect(() => {
        if (!isNowPlayingStageActive) {
            return;
        }

        const incomingTime = Math.max(0, nowPlayingProgressMs / 1000);
        const displayTime = getNowPlayingDisplayTime();
        const nextTime = nowPlayingPaused && nowPlayingProgressQuality === 'coarse'
            ? Math.max(incomingTime, displayTime)
            : incomingTime;
        if (isDev) {
            console.log('[NowPlaying][App] Applying progress to currentTime', {
                nowPlayingProgressMs,
                nextTime,
                nowPlayingProgressQuality,
                nowPlayingPaused,
                displayTime,
                hasLyrics: Boolean(lyrics),
            });
        }
        currentTime.set(nextTime);

        if (lyrics) {
            const foundIndex = findLatestActiveLineIndex(lyrics.lines, nextTime);
            if (foundIndex !== currentLineIndex) {
                setCurrentLineIndex(foundIndex);
            }
        } else if (currentLineIndex !== -1) {
            setCurrentLineIndex(-1);
        }
    }, [
        currentLineIndex,
        currentTime,
        getNowPlayingDisplayTime,
        isDev,
        isNowPlayingStageActive,
        lyrics,
        nowPlayingPaused,
        nowPlayingProgressMs,
        nowPlayingProgressQuality,
        setCurrentLineIndex,
    ]);

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
