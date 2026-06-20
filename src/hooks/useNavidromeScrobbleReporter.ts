import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../types';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { resolveNavidromePlaybackCarrier } from '../utils/appPlaybackGuards';
import { NavidromeScrobbleSessionTracker } from '../utils/navidromeScrobble';

// src/hooks/useNavidromeScrobbleReporter.ts
// Bridges audio playback events to Navidrome scrobble/now-playing reports.

type UseNavidromeScrobbleReporterParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
};

export const useNavidromeScrobbleReporter = ({
    audioRef,
    currentSong,
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

        const durationMs = navidromeSong.duration || navidromeSong.dt || currentSong?.duration || currentSong?.dt || 0;
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
                const durationMs = navidromeSong.duration || navidromeSong.dt || currentSongRef.current?.duration || currentSongRef.current?.dt || 0;
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
    }, [audioRef]);
};
