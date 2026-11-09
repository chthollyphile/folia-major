import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../../../../types';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../../../utils/appPlaybackGuards';
import { getProviderSongMetadata } from '../../../../services/onlineMusic/songMetadata';
import { isPlaybackReportReady, sendPlaybackReport } from '../../../../services/onlineMusic/playbackReportGate';
import { omni } from '../../../../services/onlineMusic/omni';
import { PlaybackListenTracker } from '../../../../utils/playbackListenTracker';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getObservedMedia } from '../../../../services/hifi/hifiMediaShim';

// src/components/app/playback/bridges/usePlaybackReporter.ts
// Turns real playback of a track of a provider that takes them into one listening report (听歌打卡).
//
// Everything here is written against one failure mode: reporting a play that did not happen. The
// duration comes from PlaybackListenTracker, which only counts audio it saw advance; the rate comes
// from playbackReportGate; and the eligibility below refuses any song its provider cannot vouch
// for (`omni.canReportPlayback`).

type UsePlaybackReporterParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    /** Changes when automix hands playback to the other deck, so the listeners follow it. */
    activeDeck: string;
};

type ScrobbleCandidate = {
    songKey: string;
    mediaId: string;
    totalSeconds: number;
};

/** What the tracker needs of the song, or null when its provider takes no report of it. */
const resolveScrobbleCandidate = (song: SongResult | null): ScrobbleCandidate | null => {
    if (!song || !omni.canReportPlayback(song)) return null;

    return {
        songKey: getPlaybackSongKey(song),
        mediaId: getPlaybackSourceRef(song).mediaId,
        totalSeconds: getProviderSongMetadata(song).durationMs / 1000,
    };
};

export const usePlaybackReporter = ({
    audioRef,
    currentSong,
    activeDeck,
}: UsePlaybackReporterParams): void => {
    const enabled = useAudioSettingsStore(state => state.neteaseScrobbleEnabled);
    // On the HiFi route the listeners go on the HiFi media shim rather than a deck.
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);
    const trackerRef = useRef<PlaybackListenTracker | null>(null);
    const sessionSongRef = useRef<SongResult | null>(null);

    if (!trackerRef.current) {
        trackerRef.current = new PlaybackListenTracker();
    }

    useEffect(() => {
        const tracker = trackerRef.current;
        if (!tracker) return;

        /** Closes the open session and, if it earned one, sends its report. */
        const settle = () => {
            const song = sessionSongRef.current;
            const report = tracker.settle();
            tracker.clear();
            sessionSongRef.current = null;
            if (!song || !report) return;
            // Checked here rather than when the session opened, because a listener can sign out
            // during the very track that would otherwise be reported.
            if (!isPlaybackReportReady(song)) return;

            void sendPlaybackReport(song, {
                playedSeconds: report.playedSeconds,
                totalSeconds: report.totalSeconds || undefined,
                quality: useAudioSettingsStore.getState().audioQuality,
            });
        };

        /** Opens a session for the song the app is on, when that song may be reported at all. */
        const openSession = (song: SongResult | null) => {
            const candidate = resolveScrobbleCandidate(song);
            if (!song || !candidate || !isPlaybackReportReady(song)) return;
            tracker.start(candidate);
            sessionSongRef.current = song;
        };

        // Switching the feature off must not bank the play that was in progress: the listener asked
        // for nothing to be reported, and a settle here would report one last time.
        if (!enabled) {
            tracker.clear();
            sessionSongRef.current = null;
            return;
        }

        // The song changed under an open session, so the previous one is over. This is also the path
        // an automix handover takes: the queue advances when the blend STARTS, and the outgoing
        // deck's `ended` never reaches the listeners below.
        if (tracker.getSongKey() !== (currentSong ? getPlaybackSongKey(currentSong) : null)) {
            settle();
            openSession(currentSong);
        }

        const audioElement = getObservedMedia(audioRef.current);
        if (!audioElement) return;

        const handleTimeUpdate = () => {
            if (audioElement.paused || audioElement.ended) return;
            if (tracker.handleProgress(audioElement.currentTime || 0).restarted) {
                // Loop-one, or a replay by hand: bank the first listen before counting the second.
                const song = sessionSongRef.current;
                settle();
                openSession(song);
            }
        };

        const handleEnded = () => settle();

        // No `pagehide` settle. `sendPlaybackReport` reaches the network through an async hop
        // (`getApiBase`) and a plain `fetch`, neither of which survives an unloading page or a
        // destroyed renderer - it would clear the session, lose the listen to a bfcache restore, and
        // still send nothing. The track playing when the app closes goes unreported, which is the
        // safe direction, and saying so beats a listener that promises what it cannot do.
        audioElement.addEventListener('timeupdate', handleTimeUpdate);
        audioElement.addEventListener('ended', handleEnded);

        return () => {
            audioElement.removeEventListener('timeupdate', handleTimeUpdate);
            audioElement.removeEventListener('ended', handleEnded);
        };
        // `activeDeck` is here because `audioRef` names a different element after an automix swap and
        // these listeners are bound to the element itself. That swap happens at ARM time, before the
        // outgoing track really ends, so its last few seconds go uncounted - an under-report of the
        // blend's length, which is the safe direction for a feature that writes to a real account.
        // `playbackRoute` moves them between a deck and the HiFi media shim.
    }, [audioRef, activeDeck, currentSong, enabled, playbackRoute]);
};
