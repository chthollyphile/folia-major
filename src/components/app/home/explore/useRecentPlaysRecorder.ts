import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { SongResult } from '../../../../types';
import { navidromePlayAccount, noteSongListened, noteSongPlayed } from './recentPlays';
import { useOnlineProviderAccountStore } from '../../../../stores/useOnlineProviderAccountStore';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../../../utils/appPlaybackGuards';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { getObservedMedia, type ObservedMedia } from '../../../../services/hifi/hifiMediaShim';
import { getNavidromeConfig } from '../../../../services/navidromeService';

// src/components/app/home/explore/useRecentPlaysRecorder.ts
// Writes Folia's own record of the songs played here (recentPlays.ts). A song (of an online
// platform, a local file or a Navidrome server; not another app's on the stage) is reported in two ways, by how much of it has really sounded: as played after a few
// seconds, and as listened to after half of it (four minutes of a long one). Each further length
// of it that sounds after that is one more listening: a song on repeat, or taken back to its
// start, is listened to again without ever being another song.

/** A song skipped sooner than this was not played. */
export const RECENT_PLAY_SECONDS = 5;
/** A song is listened to once this share of it has sounded... */
const LISTENING_SHARE = 0.5;
/** ...or this much of it, where that is less. */
export const LISTENING_SECONDS_AT_MOST = 4 * 60;
/** The length taken for a song whose own is not known. */
export const USUAL_SONG_SECONDS = 4 * 60;
/** A step of the playing position larger than this is a seek, not sound. */
const MAX_STEP_SECONDS = 2;

type UseRecentPlaysRecorderParams = {
    audioRef: RefObject<HTMLAudioElement | null>;
    currentSong: SongResult | null;
    /** Changes when automix hands playback to the other deck, so the listener follows it. */
    activeDeck: string;
};

/**
 * Follows the position of whatever is playing and reports each time as much of it has sounded,
 * in seconds, as `dueAt` asks for the next report; both are handed how many reports were made
 * before. Paused time and seeks add nothing. Returns what stops the following.
 */
export const whenHeard = (audio: ObservedMedia, dueAt: (reports: number) => number, onHeard: (reports: number) => void): (() => void) => {
    let heard = 0;
    let reports = 0;
    let last = audio.currentTime || 0;
    function handleTimeUpdate() {
        const now = audio.currentTime || 0;
        const step = now - last;
        last = now;
        if (audio.paused || step <= 0 || step > MAX_STEP_SECONDS) return;
        heard += step;
        if (heard < dueAt(reports)) return;
        reports += 1;
        onHeard(reports - 1);
    }
    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => audio.removeEventListener('timeupdate', handleTimeUpdate);
};

// The length of the song in seconds: that of what is sounding where the element knows it, else
// what the catalogue says, else the usual one. Never less than twice what makes a song played: a
// listening is not due before the song is played, nor at every step for a length that is wrong.
const lengthOf = (audio: ObservedMedia, song: SongResult | null): number => {
    const sounding = audio.duration;
    const catalogued = Number(song?.durationMs) / 1000;
    const length = Number.isFinite(sounding) && sounding > 0 ? sounding
        : Number.isFinite(catalogued) && catalogued > 0 ? catalogued : USUAL_SONG_SECONDS;
    return Math.max(length, 2 * RECENT_PLAY_SECONDS);
};

export const useRecentPlaysRecorder = ({ audioRef, currentSong, activeDeck }: UseRecentPlaysRecorderParams): void => {
    // The song as it is when it has been heard: its details may be filled in while it plays, and
    // each time the app holds another object for the same song.
    const song = useRef(currentSong);
    song.current = currentSong;
    const songKey = currentSong ? getPlaybackSongKey(currentSong) : null;
    // On the HiFi route the song sounds through mpv, and its position is the HiFi media shim's.
    const playbackRoute = usePlaybackStore(state => state.playbackRoute);

    useEffect(() => {
        const audio = getObservedMedia(audioRef.current);
        if (!audio || !songKey) return undefined;
        // The first report is that the song was played, each one after it a listening. The length
        // is asked for each time: it may not be known yet when the song begins.
        const dueAt = (reports: number): number => {
            if (reports === 0) return RECENT_PLAY_SECONDS;
            const length = lengthOf(audio, song.current);
            return Math.min(length * LISTENING_SHARE, LISTENING_SECONDS_AT_MOST) + (reports - 1) * length;
        };
        return whenHeard(audio, dueAt, reports => {
            const heard = song.current;
            const source = heard ? getPlaybackSourceRef(heard) : null;
            if (!heard || !source || source.kind === 'stage') return;
            // The account at that moment: a listener can sign out or in during the song. A Navidrome
            // song's is the user at its server; a local file has none.
            const accountId = source.kind === 'online'
                ? String(useOnlineProviderAccountStore.getState().accounts[source.providerId]?.user?.id ?? '')
                : source.kind === 'navidrome' ? navidromePlayAccount(getNavidromeConfig()) : '';
            if (reports === 0) noteSongPlayed(heard, accountId);
            else noteSongListened(heard, accountId, lengthOf(audio, heard) * 1000, reports > 1);
        });
        // `activeDeck`: `audioRef` names another element after an automix swap; `playbackRoute`: the
        // HiFi media shim stands in for the deck.
    }, [audioRef, activeDeck, playbackRoute, songKey]);
};
