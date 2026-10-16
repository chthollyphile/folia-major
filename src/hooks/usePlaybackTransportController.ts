import { captureExternalPlaybackBoundary } from '../services/externalPlaybackSession';
import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { PlayerState } from '../types';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';
import { setPlayerState } from '../stores/usePlaybackStore';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { currentTime } from '../stores/motionSignals';
import { markProgrammaticPause, playbackFade, type PlaybackFadeSettleReason } from '../services/playbackFade';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { getPlaybackFailureMessage, isPlaybackFailureStatus } from '../services/playbackRecovery/playbackFailurePolicy';
import type { OnlineRecoveryOptions, OnlineRecoveryResult, PlaybackFailure } from '../types/playbackFailure';

// src/hooks/usePlaybackTransportController.ts

type UsePlaybackTransportControllerParams = {
    stageActiveEntryKind: string | null;
    isNowPlayingStageActive: boolean;
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    setupAudioAnalyzer: () => void;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    shouldRefreshCurrentOnlineAudioSource: () => boolean;
    recoverOnlinePlaybackSource: (options: OnlineRecoveryOptions) => Promise<OnlineRecoveryResult>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    /**
     * Handles a pause that lands during an automix blend, returning true when it did.
     *
     * Mid-blend `audioRef` names the deck the next track is ARRIVING on, so the pause below would
     * stop a deck the listener cannot hear and leave the one they can hear playing on into the
     * next song - "I pressed pause and it jumped to the next track". This cancels the blend back
     * onto the deck still sounding the displayed track and pauses that, the same cancel a mid-blend
     * seek uses. Returns false (and the ordinary pause runs) when no blend is in flight.
     */
    pauseDuringTransition?: () => boolean;
    /** True while a blend is audible on the deck no control points at. Such a pause still needs the fade. */
    isTransitionAudible?: () => boolean;
};

// Owns play and pause transport behavior across main playback and Stage lyric-only playback.
export function usePlaybackTransportController({
    stageActiveEntryKind,
    isNowPlayingStageActive,
    audioRef,
    audioContextRef,
    stageLyricsClockRef,
    setupAudioAnalyzer,
    syncOutputGain,
    getTargetPlaybackVolume,
    shouldRefreshCurrentOnlineAudioSource,
    recoverOnlinePlaybackSource,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    pauseDuringTransition,
    isTransitionAudible,
}: UsePlaybackTransportControllerParams) {
    // Read here rather than passed in: store fields, a module-level motion signal, or i18n.
    const { t } = useTranslation();
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const duration = usePlaybackStore(state => state.duration);
    const transportRevision = useRef(0);
    const wantsPlayback = useRef(false);
    useEffect(() => () => {
        transportRevision.current++;
        wantsPlayback.current = false;
    }, []);

    const resumePlayback = useCallback(async () => {
        if (isNowPlayingStageActive) {
            return;
        }
        const revision = ++transportRevision.current;
        wantsPlayback.current = true;

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            const currentSyntheticTime = getSyntheticStageLyricsTime();
            syncStageLyricsClock(currentSyntheticTime, duration, PlayerState.PLAYING, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(currentSyntheticTime);
            setPlayerState(PlayerState.PLAYING);
            return;
        }

        // A pause still fading out never reached the element, so there is nothing to start: turn
        // the fade around from the current gain instead of pressing play. A deck the export
        // controller already paused by hand takes the normal path below, which also retires the
        // pending pause.
        if (
            playbackFade.isFadingOut()
            && (!audioRef.current?.paused || isTransitionAudible?.())
            && playbackFade.cancelPendingPause()
        ) {
            setPlayerState(PlayerState.PLAYING);
            return;
        }

        const audio = audioRef.current;
        if (!audio) {
            return;
        }
        // A pause does not cancel source loading, but it must cancel an older
        // asynchronous resume. Store notifications alone cannot identify that
        // stale PLAYING event once a caller has already observed PAUSED.
        const sameSession = captureExternalPlaybackBoundary();
        const source = usePlaybackStore.getState().audioSrc;
        const isSameSource = () => sameSession() && audioRef.current === audio && usePlaybackStore.getState().audioSrc === source;
        const isCurrent = () => revision === transportRevision.current && isSameSource();
        // A pending refresh can still supply the source after a pause. Its autoplay
        // decision follows the latest transport intent, including a later resume.
        const shouldAutoplay = () => wantsPlayback.current && isSameSource();

        setupAudioAnalyzer();
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            try {
                await audioContextRef.current.resume();
            } catch (error) {
                if (!isCurrent()) return;
                throw error;
            }
        }
        if (!isCurrent()) return;

        syncOutputGain(getTargetPlaybackVolume(), 0);
        // A failed TTL refresh still falls back to the old URL below, as before. Its reason is kept
        // so that, should that play fail too, the message names it rather than a generic error.
        let refreshFailure: PlaybackFailure | null = null;
        if (shouldRefreshCurrentOnlineAudioSource()) {
            const refreshed = await recoverOnlinePlaybackSource({
                failedSrc: audio.currentSrc || audioSrc,
                resumeAt: audio.currentTime,
                autoplay: true,
                shouldAutoplay,
            });

            if (!isCurrent() || refreshed.status === 'recovered') {
                return;
            }
            refreshFailure = refreshed.status === 'failed' ? refreshed.failure : null;
        }

        // Silent first, ramped up once play() has really started. Null when the fade is off or
        // there is no Web Audio graph, and the two calls below are then no-ops. Only for an element
        // that is actually stopped: pressing play on one that is already sounding must not dip it.
        const fadeToken = audio.paused || audio.ended
            ? playbackFade.prepareFadeIn()
            : null;
        try {
            await audio.play();
            if (!isCurrent()) { playbackFade.abortFadeIn(fadeToken); return; }
            playbackFade.runFadeIn(fadeToken);
            setPlayerState(PlayerState.PLAYING);
            // Playback is back, so a leftover playback-failure toast goes too: its two buttons are
            // retry and skip, with no close control. Countdowns and every other toast stay.
            setStatusMsg(prev => (isPlaybackFailureStatus(prev) ? null : prev));
        } catch (error) {
            playbackFade.abortFadeIn(fadeToken);
            if (!isCurrent()) return;
            const recovered = await recoverOnlinePlaybackSource({
                failedSrc: audio.currentSrc || audioSrc,
                resumeAt: audio.currentTime,
                autoplay: true,
                shouldAutoplay,
            });

            if (!isCurrent() || recovered.status === 'recovered') {
                return;
            }

            if (!audio.paused && !audio.ended) {
                setPlayerState(PlayerState.PLAYING);
                return;
            }

            if (error instanceof DOMException && error.name === 'NotAllowedError') {
                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                setPlayerState(PlayerState.PAUSED);
                return;
            }

            const failure = recovered.status === 'failed' ? recovered.failure : refreshFailure;
            const failureMessage = failure ? getPlaybackFailureMessage(failure) : null;
            const text = failureMessage
                ? (failureMessage.params ? t(failureMessage.key, failureMessage.params) : t(failureMessage.key))
                : t('status.playbackError');
            // 已有带「重试 / 跳过」的常驻失败提示时保留它：它已写明原因，而且没有关闭按钮，「重试」是唯一的强制刷新入口。
            // 在出错的元素上按播放（play() 以 NotSupportedError 拒绝、刷新被按文件去重）或与 onError 共用同一个恢复任务时，
            // 这条 3 秒后消失的提示都会把它连同按钮一起盖掉。
            setStatusMsg(prev => (isPlaybackFailureStatus(prev) ? prev : { type: 'error', text }));
            setPlayerState(PlayerState.PAUSED);
            throw error;
        }
    }, [activePlaybackContext, audioContextRef, audioRef, audioSrc, currentTime, duration, getSyntheticStageLyricsTime, getTargetPlaybackVolume, isNowPlayingStageActive, isTransitionAudible, recoverOnlinePlaybackSource, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldRefreshCurrentOnlineAudioSource, stageActiveEntryKind, stageLyricsClockRef, syncOutputGain, syncStageLyricsClock, t]);

    const pausePlayback = useCallback(() => {
        if (isNowPlayingStageActive) {
            return;
        }
        transportRevision.current++;
        wantsPlayback.current = false;

        if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
            const currentSyntheticTime = getSyntheticStageLyricsTime();
            syncStageLyricsClock(currentSyntheticTime, duration, PlayerState.PAUSED, stageLyricsClockRef.current.startTimeSec);
            currentTime.set(currentSyntheticTime);
            setPlayerState(PlayerState.PAUSED);
            return;
        }

        const readCurrentSongKey = () => {
            const song = usePlaybackStore.getState().currentSong;
            return song ? getPlaybackSongKey(song) : null;
        };
        const songKeyAtPress = readCurrentSongKey();

        // Before the element is touched, because mid-blend `audioRef` is the wrong element to touch:
        // it names the deck the next track is arriving on. The cancel pauses the deck that is
        // actually sounding, so there is nothing left here but to settle the transport.
        // Returns whether a pause happened, so the caller knows to settle the transport.
        const settlePause = (reason: PlaybackFadeSettleReason = 'elapsed'): boolean => {
            if (pauseDuringTransition?.()) {
                // The cancel left the audio ref on the deck it just paused, and that deck's pause
                // event is as much a flush's as the plain path's below.
                if (reason === 'flushed' && audioRef.current) {
                    markProgrammaticPause(audioRef.current);
                }
                syncOutputGain(getTargetPlaybackVolume(), 0);
                return true;
            }

            if (!audioRef.current) {
                return false;
            }

            // A flush happens while a track change is in flight: its pause event arrives after the
            // new song has set its play intent, so it is marked and ignored by the pause handler.
            if (reason === 'flushed' && !audioRef.current.paused && !audioRef.current.ended) {
                markProgrammaticPause(audioRef.current);
            }
            audioRef.current.pause();
            syncOutputGain(getTargetPlaybackVolume(), 0);
            return true;
        };

        // Fade first, pause when the ramp is done. The whole of settlePause is deferred, so a
        // blend that is armed or running at that moment is still cancelled onto the right deck.
        // The transport reads PAUSED straight away; the element follows ~200ms later. Nothing to
        // fade (already paused, feature off, no Web Audio) pauses directly as before.
        const transitionAtPress = Boolean(isTransitionAudible?.());
        const isSounding = Boolean(audioRef.current && !audioRef.current.paused) || transitionAtPress;
        // Backstop for song changes that bypass playSong's own flush: a different song by the time
        // the fade ends means the pause was meant for the old one, and the new one must keep playing.
        // Not applied during a blend: an armed blend has already asked for the next song, so
        // `currentSong` moves to it a moment after the press without that being a change of mind -
        // and the pause still has to cancel the blend back onto the song the listener was hearing.
        const settleDeferredPause = (reason: PlaybackFadeSettleReason) => {
            const duringBlend = transitionAtPress || Boolean(isTransitionAudible?.());
            if (!duringBlend && readCurrentSongKey() !== songKeyAtPress) return;
            settlePause(reason);
        };
        if (isSounding && playbackFade.fadeOutThen(settleDeferredPause)) {
            setPlayerState(PlayerState.PAUSED);
            return;
        }

        if (settlePause()) {
            setPlayerState(PlayerState.PAUSED);
        }
    }, [activePlaybackContext, audioRef, audioSrc, currentTime, duration, getSyntheticStageLyricsTime, getTargetPlaybackVolume, isNowPlayingStageActive, isTransitionAudible, pauseDuringTransition, setPlayerState, stageActiveEntryKind, stageLyricsClockRef, syncOutputGain, syncStageLyricsClock]);

    return {
        resumePlayback,
        pausePlayback,
    };
}
