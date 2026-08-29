import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../types';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';
import { NavidromeScrobbleSessionTracker } from '../utils/navidromeScrobble';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';

// src/hooks/useNavidromeScrobbleReporter.ts
// Bridges audio playback events to Navidrome scrobble/now-playing reports.

type UseNavidromeScrobbleReporterParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    /** Changes when automix hands playback to the other deck, so the listeners follow it. */
    activeDeck: string;
};

export const useNavidromeScrobbleReporter = ({
    audioRef,
    currentSong,
    activeDeck,
}: UseNavidromeScrobbleReporterParams): void => {
    const currentSongRef = useRef<SongResult | null>(currentSong);
    const trackerRef = useRef<NavidromeScrobbleSessionTracker | null>(null);

    currentSongRef.current = currentSong;

    if (!trackerRef.current) {
        trackerRef.current = new NavidromeScrobbleSessionTracker(({ kind, songId }) => {
            const config = getNavidromeConfig();
            if (!config) {
                return;
            }

            void navidromeApi.scrobble(config, songId, {
                submission: kind === 'submission',
                time: Date.now(),
            }).then((success) => {
                if (!success) {
                    console.warn('[Navidrome] scrobble report was rejected', { kind, songId });
                }
            }).catch((error) => {
                console.warn('[Navidrome] scrobble report failed', { kind, songId, error });
            });
        });
    }

    useEffect(() => {
        const tracker = trackerRef.current;
        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const songId = navidromeSong?.navidromeData?.id;

        if (!tracker || !songId) {
            tracker?.clearSession();
            return;
        }

        const durationMs = getProviderSongMetadata(navidromeSong).durationMs || getProviderSongMetadata(currentSong).durationMs;
        if (tracker.getCurrentSongId() !== songId) {
            tracker.startSession(songId, durationMs);
        }
    }, [currentSong]);

    useEffect(() => {
        const audioElement = audioRef.current;
        const tracker = trackerRef.current;
        if (!audioElement || !tracker) {
            return;
        }

        const ensureSessionFromCurrentSong = () => {
            const navidromeSong = resolveNavidromePlaybackCarrier(currentSongRef.current);
            const songId = navidromeSong?.navidromeData?.id;
            if (!songId) {
                tracker.clearSession();
                return false;
            }

            if (tracker.getCurrentSongId() !== songId) {
                const durationMs = getProviderSongMetadata(navidromeSong).durationMs
                    || getProviderSongMetadata(currentSongRef.current).durationMs;
                tracker.startSession(songId, durationMs);
            }
            return true;
        };

        const handlePlaybackStart = () => {
            if (!ensureSessionFromCurrentSong()) {
                return;
            }
            tracker.handlePlaybackStart(audioElement.currentTime || 0);
        };

        const handleProgress = () => {
            if (audioElement.paused || audioElement.ended || !ensureSessionFromCurrentSong()) {
                return;
            }
            tracker.handleProgress(audioElement.currentTime || 0);
        };

        const handleEnded = () => {
            if (!ensureSessionFromCurrentSong()) {
                return;
            }
            const endTime = Number.isFinite(audioElement.duration) ? audioElement.duration : audioElement.currentTime;
            tracker.handleProgress(endTime || 0);
            tracker.clearSession();
        };

        audioElement.addEventListener('play', handlePlaybackStart);
        audioElement.addEventListener('playing', handlePlaybackStart);
        audioElement.addEventListener('timeupdate', handleProgress);
        audioElement.addEventListener('ended', handleEnded);

        return () => {
            audioElement.removeEventListener('play', handlePlaybackStart);
            audioElement.removeEventListener('playing', handlePlaybackStart);
            audioElement.removeEventListener('timeupdate', handleProgress);
            audioElement.removeEventListener('ended', handleEnded);
        };
        // audioRef names a different element after an automix deck swap, and these listeners are
        // bound to the element itself rather than read through the ref, so they have to rebind.
        //
        // Known limitation: the swap happens at ARM time, up to AUTOMIX_ARM_LEAD_SEC before the
        // outgoing track actually ends, so this rebinds off it early. Its last few seconds of
        // `timeupdate` go unheard and its `ended` never fires here - the incoming track's
        // `startSession` simply supersedes it. This is only harmless because the submission threshold
        // (min(60s, duration/2)) is reached well before arm on any normal track, so the scrobble is
        // already committed by then. If that threshold rule ever changes, this becomes a silent
        // under-report and needs the exit track driven from the settle path instead of the active deck.
    }, [audioRef, activeDeck]);
};
