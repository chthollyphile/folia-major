import { PlayerState, type SongResult } from '@/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { makeSongCurrent } from '@/components/app/playback/currentSong';

// test/unit/playback/currentSongWatch.ts
// Shared by the current-song pins (currentSong*.test.ts). It records every write of the store's
// song, audio source, queue and cover in the order it happens, and next to each one the key of the
// song the player was last asked for, as it stands at that moment. A route's log therefore shows
// where the key moves among the store writes and the waits around them.
//
// The key is read through the ref the test hands in (the one `usePlaybackRuntimeRefs` returns), so
// the log does not depend on who writes it.
//
// A pin of the audio address hands in the two refs behind the address as well. Its log then also
// says, at each write of the address, which blob URL is the one to hand over next and when the
// address was fetched, and it takes the lines given to `detail` (a blob URL handed over or revoked,
// a service asked). Without those refs the log is the same as before.

type KeyRef = { readonly current: string | null };
type AddressRefs = {
    blobUrlRef: { current: string | null };
    currentOnlineAudioUrlFetchedAtRef: { current: number | null };
};

const WATCHED = [
    ['setCurrentSong', 'song', 'currentSong'],
    ['setAudioSrc', 'audio', 'audioSrc'],
    ['setPlayQueue', 'queue', 'playQueue'],
    ['setCachedCoverUrl', 'cover', 'cachedCoverUrl'],
] as const;

// The store's own setters, taken once, so a watch left behind by a failed test is never wrapped again.
const initialState = usePlaybackStore.getState();
const ownSetters = Object.fromEntries(WATCHED.map(([setter]) => [setter, initialState[setter]]));

const show = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(show).join(',')}]`;
    if (value && typeof value === 'object') return String((value as SongResult).name);
    return String(value);
};

/** Puts the store back to an empty main player with its own setters, and the key back to none. */
export const resetPlaybackStore = () => {
    makeSongCurrent(null);
    usePlaybackStore.setState({
        ...ownSetters,
        currentSong: null,
        audioSrc: null,
        lyrics: null,
        cachedCoverUrl: null,
        duration: 0,
        playerState: PlayerState.IDLE,
        currentLineIndex: -1,
        playQueue: [],
        activePlaybackContext: 'main',
        isFmMode: false,
    } as never);
};

/**
 * Starts recording. A line reads `song=B key=online:bodian:2`: the write, then the key at that
 * moment. `~` instead of `=` marks a write that was given a function (a patch of the song in place).
 */
export const watchCurrentSong = (keyRef: KeyRef, address?: AddressRefs) => {
    const log: string[] = [];
    const key = () => `key=${keyRef.current}`;
    const behindTheAddress = () => (
        address ? ` blobRef=${address.blobUrlRef.current} fetchedAt=${address.currentOnlineAudioUrlFetchedAtRef.current}` : ''
    );
    usePlaybackStore.setState(Object.fromEntries(WATCHED.map(([setter, label, field]) => [setter, (next: unknown) => {
        (ownSetters[setter] as (next: unknown) => void)(next);
        log.push(`${label}${typeof next === 'function' ? '~' : '='}${show(usePlaybackStore.getState()[field])} ${key()}${label === 'audio' ? behindTheAddress() : ''}`);
    }])) as never);
    return {
        log,
        /** A line that only a pin of the audio address records. */
        detail: (label: string) => {
            if (address) log.push(label);
        },
        /** A line for something that is not one of the watched writes: a wait, a lyrics write. */
        note: (label: string) => {
            log.push(`${label} | song=${show(usePlaybackStore.getState().currentSong)} ${key()}`);
        },
        /** Empties the log and hands back what was in it. */
        take: () => log.splice(0, log.length),
    };
};
