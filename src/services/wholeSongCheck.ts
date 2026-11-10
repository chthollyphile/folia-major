import type { SongResult } from '../types';
import { omni } from './onlineMusic/omni';

// src/services/wholeSongCheck.ts
//
// Whether a song's audio file is the whole song. A platform may answer a song with less than the
// song: a preview clip, for an account that may not play the whole of it. The clip plays as it
// comes, and neither it nor anything measured from it may be kept as the song's: playback takes a
// stored copy before it asks the platform, and automix takes a stored analysis before it measures
// again, so a clip kept once stood in for the song for good, also after the account could play the
// whole song.
//
// One rule for every writer of a song's audio to the media cache (the end-of-song writer, the
// automix analysis read: `mayStoreSongAudio`), for what is kept per song from the audio (the automix
// profile, the separated stems: `whyNotTheSong`, `whyNotTheSongPlayed`), and for playback taking a
// stored copy (`measureSongAudio`, in onlinePlayback.ts).

// Two shares of the song's stated length (`durationMs`), for two questions, kept apart because the
// stated length can be wrong: a platform may state another version's length.
// - Under NOT_THE_SONG_SHARE a file is not the song: a preview clip is about 30 s of a 3-5 minute
//   song. Only this is acted on against a file (a first copy refused, a stored copy deleted, an
//   analysis not kept), so it is set low: a whole song taken for a clip is lost, and offline its
//   deleted copy cannot play.
// - From WHOLE_SONG_SHARE a file is proven to be the whole song: what it takes to write over a copy
//   already on disk, which is kept unless something better is proven.
// In between, or where a length cannot be told, a file is neither: it is stored where there is no
// copy, does not write over one, and is not deleted.
const NOT_THE_SONG_SHARE = 0.5;
const WHOLE_SONG_SHARE = 0.9;
// How long a fetched file's header may take to give its play length before the file is stored.
const STORE_CEILING_MS = 5000;

const PREVIEW_CLIP = 'a preview clip, as its provider said';

/**
 * The play length of an audio file in seconds, read from its header by an element that never
 * sounds. Null where it cannot be told: no Audio here, a file the element cannot read, a header
 * that names no length, no answer within `ceilingMs`.
 */
const readPlayLength = (blob: Blob, ceilingMs: number): Promise<number | null> => {
    if (typeof Audio === 'undefined') return Promise.resolve(null);
    return new Promise(resolve => {
        const audio = new Audio();
        const url = URL.createObjectURL(blob);
        const finish = (seconds: number | null) => {
            clearTimeout(ceiling);
            audio.onloadedmetadata = null;
            audio.onerror = null;
            audio.removeAttribute('src');
            audio.load();
            URL.revokeObjectURL(url);
            resolve(seconds);
        };
        const ceiling = setTimeout(() => finish(null), ceilingMs);
        audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) ? audio.duration : null);
        audio.onerror = () => finish(null);
        audio.preload = 'metadata';
        audio.src = url;
    });
};

/**
 * A file held against its song (see the two shares above). 'clip': proven not to be the song.
 * 'whole': proven to be the whole song. 'unproven': neither, or a length cannot be told.
 */
export type SongAudioLength = {
    verdict: 'whole' | 'clip' | 'unproven';
    /** Seconds. */
    playLength: number | null;
    /** Seconds, from the song's `durationMs`. */
    statedLength: number | null;
};

const statedLengthOf = (song: SongResult): number | null => (song.durationMs > 0 ? song.durationMs / 1000 : null);

/** Holds a play length already known (a media element's, an analysis's) against `song`. */
const holdPlayLength = (song: SongResult, playLength: number | null): SongAudioLength => {
    const statedLength = statedLengthOf(song);
    const known = playLength !== null && Number.isFinite(playLength) && playLength > 0 ? playLength : null;
    const verdict = known === null || statedLength === null ? 'unproven'
        : known >= statedLength * WHOLE_SONG_SHARE ? 'whole'
            : known < statedLength * NOT_THE_SONG_SHARE ? 'clip' : 'unproven';
    return { verdict, playLength: known, statedLength };
};

/** Holds `blob` against `song`. A song that states no length has nothing to be held against: its file's header is not read. */
export const measureSongAudio = async (song: SongResult, blob: Blob, ceilingMs: number): Promise<SongAudioLength> => (
    holdPlayLength(song, statedLengthOf(song) === null ? null : await readPlayLength(blob, ceilingMs))
);

const inSeconds = (seconds: number | null): string => (seconds === null ? 'unknown' : `${seconds.toFixed(1)}s`);

/** The two lengths, as a log line gives them. */
export const describeSongAudioLength = ({ playLength, statedLength }: SongAudioLength): string => (
    `play length ${inSeconds(playLength)}, stated length ${inSeconds(statedLength)}`
);

/**
 * The half of the rule that needs no file: a URL its provider handed out as a preview clip. Asked
 * before a download, so that a clip is not fetched only to be refused.
 */
export const whyPreviewClip = (src: string | null | undefined): string | null => (
    src && omni.isPreviewAudioSource(src) ? PREVIEW_CLIP : null
);

/** Why a file of this length is not the song, for a log line. */
export const notTheSongWhy = (length: SongAudioLength) => `shorter than half the song: ${describeSongAudioLength(length)}`;

export type SongAudioStoreCheck = { store: true } | { store: false; why: string };

/**
 * Whether `blob`, fetched from `src`, may be stored as `song`'s audio. `writesOver`: a copy of the
 * song is on disk, and the file would take its place.
 * - A URL its provider handed out as a preview clip: never.
 * - A file proven not to be the song (under half its length): never, also where there is no copy.
 * - Any other file: where there is no copy, yes, as always. Over a copy, only one proven to be the
 *   whole song: nothing less proves it better than what is there.
 */
export const mayStoreSongAudio = async (
    song: SongResult,
    src: string,
    blob: Blob,
    writesOver: boolean,
): Promise<SongAudioStoreCheck> => {
    const preview = whyPreviewClip(src);
    if (preview) return { store: false, why: preview };
    const length = await measureSongAudio(song, blob, STORE_CEILING_MS);
    if (length.verdict === 'whole' || (length.verdict === 'unproven' && !writesOver)) return { store: true };
    return { store: false, why: length.verdict === 'clip' ? notTheSongWhy(length) : `not proven to be the whole song: ${describeSongAudioLength(length)}` };
};

/**
 * Why a result measured from `blob` (fetched from `src`, or read from the media cache: null) may not
 * be kept as `song`'s, or null where it may. The same rule as storing the file where there is no
 * copy: a URL marked as a preview clip, or a file under half the song's length, is not the song;
 * any other file is taken for it.
 */
export const whyNotTheSong = async (song: SongResult, src: string | null, blob: Blob): Promise<string | null> => {
    const preview = whyPreviewClip(src);
    if (preview) return preview;
    const length = await measureSongAudio(song, blob, STORE_CEILING_MS);
    return length.verdict === 'clip' ? notTheSongWhy(length) : null;
};

/** `whyNotTheSong` for audio whose play length is known already: what a deck played from `src`, or a stored analysis (`src` null). */
export const whyNotTheSongPlayed = (song: SongResult, src: string | null, playLength: number): string | null => {
    const preview = whyPreviewClip(src);
    if (preview) return preview;
    const length = holdPlayLength(song, playLength);
    return length.verdict === 'clip' ? notTheSongWhy(length) : null;
};
