import type { SongResult } from '../../types';
import type { PlaybackRepresentation } from '../../types/playbackRecovery';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { getCachedSongAudioBlob } from '../onlineMusic/resourceCache';
import { isCacheableAudioResponse } from '../playbackRecovery/mediaCacheGuard';
import { whyNotTheSong } from '../wholeSongCheck';

// src/services/analysis/trackAudio.ts
// A track's audio for analysis: the bytes that are already on this machine, and the decode to the
// rate a model wants.
//
// Three analysers read tracks - automix's profile (automix/profileService.ts), stem separation
// (automix/stems.ts) and 智能动感模式 (beatFx/beatFxSource.ts). This is the "where are this track's
// bytes" ladder of 智能动感模式, and of automix's profile for a local track with no URL; automix keeps
// its own ladders for the rest, which also weigh what the provider keeps and a copy that is not the
// whole song (wholeSongCheck.ts, 2026-10-17). A cached copy that is not the song is not read here
// either: beats measured off a clip would be stored as the song's. Downloading an online track is not on
// it (a library source that is merely served over http - Navidrome, a stage feed - is read): whether a
// track is worth bandwidth is each caller's question (only automix's profile ever says yes).
//
// The representation is passed in rather than looked up here. Callers that store a result under
// `getPlaybackAnalysisKey` must read the bytes of the representation that key names, and a
// transcode can register in the seconds between the two lookups - so they resolve both at once
// (`getPlaybackAnalysisTarget`) and hand the same representation over.

/** Where a local track's file is read from when no URL is in hand; App registers the real one. */
export type LocalTrackFileReader = (song: SongResult) => Promise<ArrayBuffer | null>;

let localFileReader: LocalTrackFileReader | null = null;

/**
 * Registers how to read a local track off its own file handle. App owns the local library, so it
 * resolves the song to its LocalSong and reads the handle; analysers only ever see bytes.
 */
export const registerLocalTrackFileReader = (reader: LocalTrackFileReader | null): void => {
    localFileReader = reader;
};

/** A blob: or file: URL, or any non-online source, is already on this machine: reading it is free. */
export const isLocalAudioUrl = (song: SongResult, audioUrl: string): boolean =>
    audioUrl.startsWith('blob:') || audioUrl.startsWith('file:') || getPlaybackSourceRef(song).kind !== 'online';

/**
 * The bytes, a reason there are none, or null when nothing local has them - the point at which a
 * caller that may download decides whether to.
 */
export type LocalTrackBytes = { bytes: ArrayBuffer } | { skipped: string } | null;

export interface LocalTrackBytesOptions {
    /** The representation the caller's key names; see the header. */
    representation: PlaybackRepresentation | null;
    /** A URL the caller already holds; read only when it is local. */
    audioUrl?: string | null;
    /** Overrides the registered local file reader, for a caller that was handed its own. */
    readLocalFile?: () => Promise<ArrayBuffer | null>;
}

/**
 * Reads a track's bytes from what is already here: the playback representation, the media cache,
 * a local URL, the local file's handle. Never an online track's download.
 */
export const readLocalTrackBytes = async (
    song: SongResult,
    { representation, audioUrl, readLocalFile }: LocalTrackBytesOptions,
): Promise<LocalTrackBytes> => {
    if (representation) {
        try {
            const response = await fetch(representation.url);
            // An evicted transcode answers 404 with a text body. Decoding that would be stored as a
            // permanent "unsupported" verdict for a track that is merely no longer cached - and the
            // original's bytes are not what the key names, so there is no falling through either.
            if (!response.ok) throw new Error(`representation responded ${response.status}`);
            return { bytes: await response.arrayBuffer() };
        } catch (error) {
            console.warn('[Analysis] could not read the playback representation', error);
            return { skipped: 'the playback representation could not be read' };
        }
    }

    const cached = await getCachedSongAudioBlob(song);
    if (cached) {
        const notTheSong = await whyNotTheSong(song, null, cached);
        if (notTheSong) return { skipped: `the copy in the media cache is ${notTheSong}` };
        return { bytes: await cached.arrayBuffer() };
    }

    if (audioUrl && isLocalAudioUrl(song, audioUrl)) {
        try {
            const response = await fetch(audioUrl);
            if (!response.ok) throw new Error(`local source responded ${response.status}`);
            // A blob: or file: URL is the file itself. Anything else here is a library server over
            // http, and an expired token there answers an error page: decoded, that would be
            // remembered as a track that cannot be analysed for the rest of the session.
            if (!audioUrl.startsWith('blob:') && !audioUrl.startsWith('file:')) {
                const blob = await response.blob();
                if (!isCacheableAudioResponse(response, blob)) return { skipped: 'the library server did not answer with audio' };
                return { bytes: await blob.arrayBuffer() };
            }
            return { bytes: await response.arrayBuffer() };
        } catch (error) {
            console.warn('[Analysis] could not read a local track', error);
            return { skipped: 'the local file could not be read' };
        }
    }

    // A local track with no URL in hand - the next-up head (prefetch skips local files), or any
    // track whose blob: URL belongs to a deck rather than to us. Its file is read off its handle.
    // A caller's own reader is asked whatever the source; it knows which songs it can read.
    const read = readLocalFile ?? (() => readLocalTrackFile(song));
    if (!readLocalFile && !canReadLocalTrackFile(song)) return null;
    const bytes = await read();
    return bytes ? { bytes } : { skipped: 'not cached, and no file or URL to read it from' };
};

const canReadLocalTrackFile = (song: SongResult): boolean =>
    Boolean(localFileReader) && getPlaybackSourceRef(song).kind === 'local';

/** A local track's file, read off its own handle (the registered reader); null for any other song. */
export const readLocalTrackFile = async (song: SongResult): Promise<ArrayBuffer | null> => (
    canReadLocalTrackFile(song) ? localFileReader!(song) : null
);

/**
 * Decodes straight to an analysis rate.
 *
 * decodeAudioData resamples to the context's own sample rate, so a context created at 22.05kHz
 * does the downsampling in the decoder - no render pass, no resampler here, and a four-minute
 * track lands as ~10MB of floats instead of ~80MB.
 */
export const decodeAtRate = async (bytes: ArrayBuffer, sampleRate: number): Promise<AudioBuffer | null> => {
    if (typeof window === 'undefined') return null;
    const OfflineContext = window.OfflineAudioContext
        || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!OfflineContext) return null;
    try {
        return await new OfflineContext(1, 1, sampleRate).decodeAudioData(bytes);
    } catch (error) {
        console.warn('[Analysis] could not decode a track', error);
        return null;
    }
};

/**
 * Splits a decode into mid and side.
 *
 * Mid - (L+R)/2 - is the mono sum every other measurement wants. Side - (L-R)/2 - is what is left
 * when the two channels cancel: everything the mix placed off-centre. Keeping it is what makes a voice
 * findable - lead vocals are panned dead centre on essentially every commercial master, so they live
 * almost entirely in mid and almost not at all in side. Cancelling one against the other is the same
 * arithmetic karaoke machines have used to drop the lead vocal for decades.
 *
 * Null side for a mono file: no two channels to cancel, so the question cannot be asked.
 */
export const toMidSide = (buffer: AudioBuffer): { mid: Float32Array; side: Float32Array | null } => {
    const left = buffer.getChannelData(0);
    if (buffer.numberOfChannels < 2) return { mid: Float32Array.from(left), side: null };

    const right = buffer.getChannelData(1);
    const mid = new Float32Array(buffer.length);
    const side = new Float32Array(buffer.length);
    for (let index = 0; index < mid.length; index += 1) {
        mid[index] = (left[index] + right[index]) / 2;
        side[index] = (left[index] - right[index]) / 2;
    }
    return { mid, side };
};
