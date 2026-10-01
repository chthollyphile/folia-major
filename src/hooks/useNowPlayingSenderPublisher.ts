import { useCallback, useEffect, useRef, useState } from 'react';
import {
    NOW_PLAYING_SENDER_PROGRESS_INTERVAL_DEFAULT_SEC,
    NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC,
    type NowPlayingSenderPlayback,
    type NowPlayingSenderStatus,
} from '../types/nowPlayingSender';
import { buildNowPlayingSenderLyric, buildNowPlayingSenderTrack } from '../utils/nowPlayingSenderPayload';
import {
    selectDisplayCoverUrl,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplayPlayerState,
    selectDisplaySong,
    usePlaybackStore,
} from '../stores/usePlaybackStore';
import { PlayerState } from '../types';
import { currentTime } from '../stores/motionSignals';

// src/hooks/useNowPlayingSenderPublisher.ts
// Mode 1 "Now Playing 发送": mirrors the current track / lyrics / progress to the
// outbound Electron endpoint. Independent from Stage mode: it reacts to the normal
// playback store, not to a stage source, so enabling the sender never takes over
// playback or the visualizer.

// A seek shows up as a jump on the motion value; the threshold is generous enough that an
// ordinary frame's worth of drift between reports never trips it.
const SENDER_PLAYBACK_JUMP_THRESHOLD_SEC = 0.4;

// Mirrors the main-process default (electron/main.cjs DEFAULT_NOW_PLAYING_SENDER_PORT);
// only used before the first status round-trip or outside Electron.
const emptySenderStatus = (): NowPlayingSenderStatus => ({
    enabled: false,
    running: false,
    port: 9863,
    url: null,
    wsUrl: null,
    clientCount: 0,
    progressIntervalSec: NOW_PLAYING_SENDER_PROGRESS_INTERVAL_DEFAULT_SEC,
    error: null,
});

/** Folia's loop mode → the `repeatType` string now-playing clients read. */
const toNowPlayingSenderRepeatType = (loopMode: 'off' | 'all' | 'one'): NowPlayingSenderPlayback['repeatType'] => (
    loopMode === 'one' ? 'ONE' : loopMode === 'all' ? 'ALL' : 'NONE'
);

export const useNowPlayingSenderPublisher = ({
    isElectronWindow,
    loopMode,
    volume,
    isMuted,
}: {
    isElectronWindow: boolean;
    loopMode: 'off' | 'all' | 'one';
    volume: number;
    isMuted: boolean;
}) => {
    const [status, setStatus] = useState<NowPlayingSenderStatus>(() => emptySenderStatus());

    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    // The display layer, not the raw one: during an automix blend the raw store already names the
    // arriving track while the outgoing deck is still what anybody hears. Publishing the raw pair
    // would put the new cover and length on the wire first and correct them a beat later, which an
    // external overlay sees as a flicker.
    const currentSong = usePlaybackStore(selectDisplaySong);
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    const coverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const duration = usePlaybackStore(selectDisplayDuration);
    // Subscribed (not just read inside publishPlayback) so a pause/resume re-runs the effect that
    // publishes it immediately, instead of it riding along on the next heartbeat.
    const playerStateForSender = usePlaybackStore(selectDisplayPlayerState);

    const lastTrackKeyRef = useRef<string | null>(null);
    const lastLyricKeyRef = useRef<string | null>(null);
    const lastPublishedTimeSecRef = useRef(0);
    const lastPublishedAtMsRef = useRef(0);
    // Under Stage mode the playback store is a mirror of an external player, so broadcasting it
    // would misrepresent that player as Folia's own now-playing state.
    const isOwnPlayback = activePlaybackContext !== 'stage';

    const refreshStatus = useCallback(async () => {
        if (!isElectronWindow || !window.electron?.getNowPlayingSenderStatus) {
            const nextStatus = emptySenderStatus();
            setStatus(nextStatus);
            return nextStatus;
        }
        const nextStatus = await window.electron.getNowPlayingSenderStatus();
        setStatus(nextStatus);
        return nextStatus;
    }, [isElectronWindow]);

    useEffect(() => {
        void refreshStatus();
        return window.electron?.onNowPlayingSenderStatusChanged?.(nextStatus => setStatus(nextStatus));
    }, [refreshStatus]);

    const setEnabled = useCallback(async (enabled: boolean) => {
        if (!window.electron?.setNowPlayingSenderEnabled) {
            return emptySenderStatus();
        }
        const nextStatus = await window.electron.setNowPlayingSenderEnabled(enabled);
        setStatus(nextStatus);
        return nextStatus;
    }, []);

    const setProgressIntervalSec = useCallback(async (intervalSec: number) => {
        if (!window.electron?.setNowPlayingSenderProgressInterval) {
            return emptySenderStatus();
        }
        const nextStatus = await window.electron.setNowPlayingSenderProgressInterval(intervalSec);
        setStatus(nextStatus);
        return nextStatus;
    }, []);

    const publishPlayback = useCallback((isReplay = false) => {
        if (!window.electron?.publishNowPlayingSenderPlayback) {
            return;
        }
        const nowMs = Date.now();
        const timeSec = currentTime.get();
        lastPublishedTimeSecRef.current = timeSec;
        lastPublishedAtMsRef.current = nowMs;
        const playback: NowPlayingSenderPlayback = {
            progressMs: Math.max(0, Math.round(timeSec * 1000)),
            isPaused: selectDisplayPlayerState(usePlaybackStore.getState()) !== PlayerState.PLAYING,
            volumePercent: Math.round((isMuted ? 0 : volume) * 100),
            repeatType: toNowPlayingSenderRepeatType(loopMode),
            isReplay,
        };
        void window.electron.publishNowPlayingSenderPlayback(playback).catch(error => {
            console.warn('[NowPlayingSender] Failed to publish playback', error);
        });
    }, [isMuted, loopMode, volume]);

    // A ref so the event-driven publishes below can fire without becoming dependencies of the
    // heartbeat effect (which would re-arm the timer on every volume tick).
    const publishPlaybackRef = useRef(publishPlayback);
    useEffect(() => {
        publishPlaybackRef.current = publishPlayback;
    }, [publishPlayback]);

    const isSenderPublishingRef = useRef(false);
    const isSenderPublishing = status.enabled && isOwnPlayback;
    useEffect(() => {
        isSenderPublishingRef.current = isSenderPublishing;
    }, [isSenderPublishing]);

    // Every time the sender (re)starts, or Stage takes playback away and gives it back, the main
    // process has thrown its Track/Lyric caches away (`stop()` clears them). The renderer's dedupe
    // refs, unlike those, survive the round trip — so without this reset the first publication of
    // the new session is skipped as "already sent" and clients stay blank until the song changes.
    const publishSession = `${status.enabled ? 'on' : 'off'}:${isOwnPlayback ? 'own' : 'stage'}`;
    useEffect(() => {
        lastTrackKeyRef.current = null;
        lastLyricKeyRef.current = null;
    }, [publishSession]);

    // Track: publish on identity change only (title/artist/album/cover/duration).
    useEffect(() => {
        if (!status.enabled || !window.electron?.publishNowPlayingSenderTrack) {
            return;
        }
        if (!isOwnPlayback) {
            if (lastTrackKeyRef.current !== '__empty__') {
                lastTrackKeyRef.current = '__empty__';
                void window.electron.publishNowPlayingSenderTrack(null).catch(() => {});
            }
            return;
        }
        const built = buildNowPlayingSenderTrack({
            song: currentSong,
            lyrics,
            coverUrl,
            durationMs: duration * 1000,
        });
        if (!built) {
            if (lastTrackKeyRef.current !== '__empty__') {
                lastTrackKeyRef.current = '__empty__';
                void window.electron.publishNowPlayingSenderTrack(null).catch(() => {});
            }
            return;
        }
        if (built.key === lastTrackKeyRef.current) {
            return;
        }
        lastTrackKeyRef.current = built.key;
        void window.electron.publishNowPlayingSenderTrack(built.snapshot).catch(error => {
            console.warn('[NowPlayingSender] Failed to publish track', error);
        });
        // A new track's clock starts at zero; a client told only on the next heartbeat would
        // spend that interval drawing the previous song's position on the new song.
        publishPlaybackRef.current(false);
    }, [currentSong, lyrics, coverUrl, duration, status.enabled, isOwnPlayback]);

    // Lyric: publish on the parsed content, which is what actually changes per song.
    useEffect(() => {
        if (!status.enabled || !window.electron?.publishNowPlayingSenderLyric) {
            return;
        }
        if (!isOwnPlayback) {
            if (lastLyricKeyRef.current !== '__empty__') {
                lastLyricKeyRef.current = '__empty__';
                void window.electron.publishNowPlayingSenderLyric(null).catch(() => {});
            }
            return;
        }
        const payload = buildNowPlayingSenderLyric(lyrics);
        const key = payload ? JSON.stringify([payload.lrc, payload.karaokeLyric, payload.translatedLyric]) : '__empty__';
        if (key === lastLyricKeyRef.current) {
            return;
        }
        lastLyricKeyRef.current = key;
        void window.electron.publishNowPlayingSenderLyric(payload).catch(error => {
            console.warn('[NowPlayingSender] Failed to publish lyric', error);
        });
    }, [lyrics, status.enabled, isOwnPlayback]);

    // The user's heartbeat interval: a large value means a client extrapolates for longer, `0`
    // means never on a timer. The clock is still anchored on every playback event below, so a
    // zero interval costs accuracy only between those events, never the ability to stop
    // extrapolating at the moments that actually matter.
    const progressIntervalSec = Number.isFinite(status.progressIntervalSec) && status.progressIntervalSec >= 0
        ? Math.min(NOW_PLAYING_SENDER_PROGRESS_INTERVAL_MAX_SEC, status.progressIntervalSec)
        : NOW_PLAYING_SENDER_PROGRESS_INTERVAL_DEFAULT_SEC;

    // Progress heartbeat. A self-rescheduling timeout rather than `setInterval`, so dragging the
    // slider takes effect on the next tick instead of stacking timers of two different periods.
    // Reads through the ref: `publishPlayback` changes identity with volume and loop mode, and a
    // volume drag under a 0.1s interval would otherwise re-arm this timer on every notch.
    useEffect(() => {
        if (!status.enabled || !window.electron?.publishNowPlayingSenderPlayback) {
            return undefined;
        }

        // Enabled is not a replay: `PlayerProgressReplay` is reserved for an observed rewind
        // so a client does not reset its own playhead every time the sender is switched on.
        publishPlaybackRef.current(false);
        if (progressIntervalSec <= 0) {
            return undefined;
        }

        const intervalMs = Math.round(progressIntervalSec * 1000);
        let timerId: number | null = null;
        const schedule = () => {
            timerId = window.setTimeout(() => {
                timerId = null;
                publishPlaybackRef.current(false);
                schedule();
            }, intervalMs);
        };
        schedule();

        return () => {
            if (timerId !== null) {
                window.clearTimeout(timerId);
                timerId = null;
            }
        };
    }, [status.enabled, progressIntervalSec]);

    // Seek: a jump on the motion value is a position the heartbeat cannot have produced, so it
    // goes out immediately at any interval. Distinct from the heartbeat's expected position by
    // more than the threshold, whether playing or paused.
    useEffect(() => {
        if (!status.enabled || !window.electron?.publishNowPlayingSenderPlayback) {
            return undefined;
        }

        return currentTime.on('change', nextTime => {
            if (!isSenderPublishingRef.current) {
                return;
            }
            const expected = lastPublishedTimeSecRef.current
                + (Date.now() - lastPublishedAtMsRef.current) / 1000;
            if (Math.abs(nextTime - expected) >= SENDER_PLAYBACK_JUMP_THRESHOLD_SEC) {
                publishPlaybackRef.current(false);
            }
        });
    }, [status.enabled]);

    // Pause / resume: the played-paused bit is the one field a client cannot extrapolate, so it
    // is published the moment it flips rather than waiting for the next heartbeat.
    useEffect(() => {
        if (!status.enabled || !window.electron?.publishNowPlayingSenderPlayback) {
            return;
        }
        if (!isSenderPublishing) {
            return;
        }
        publishPlaybackRef.current(false);
    }, [status.enabled, isSenderPublishing, playerStateForSender]);

    return {
        nowPlayingSenderStatus: status,
        refreshNowPlayingSenderStatus: refreshStatus,
        setNowPlayingSenderEnabled: setEnabled,
        setNowPlayingSenderProgressIntervalSec: setProgressIntervalSec,
    };
};
