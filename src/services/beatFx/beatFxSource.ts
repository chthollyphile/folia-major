import type { SongResult } from '../../types';
import { mergeBeatFxEvents, type BeatFxEvent } from './clock';
import { getTrackBeatAccents, getTrackBeatGrid } from '../analysis/beatGrid';
import { getDrumHits, loadTrackDrumHits, setWantedDrumTrack } from '../analysis/drumHits';
import { BEAT_THIS_SAMPLE_RATE, canRunBeatThis } from '../analysis/beatThis';
import { decodeAtRate, readLocalTrackBytes, toMidSide } from '../analysis/trackAudio';
import { getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';
import { isCacheableAudioResponse } from '../playbackRecovery/mediaCacheGuard';
import { getPrefetchedData, isUrlValid } from '../prefetchService';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import type { PlaybackRepresentation } from '../../types/playbackRecovery';

// src/services/beatFx/beatFxSource.ts
// Where the beat FX get the playing track's beat list from.
//
// analysis/beatGrid.ts answers it: the list stored for this track by an earlier play, or the run of
// it already in flight, or a run now on the track's own bytes. The model is Beat This!'s small0
// (2.1M parameters, 4.7MB, packaged with the app), not automix's downloaded final0: the beat FX work
// on a fresh install, never wait on a download, and never read or share automix's lists.
//
// The bytes are what is already on this machine (analysis/trackAudio.ts): the playback
// representation, the media cache, the local file. An online track is only cached once played to the
// end, so one not cached yet is read once more from the stream URL its playback resolved (the
// prefetch entry for that very song, never another's): its beats arrive a few seconds into its first
// play instead of on its second (the user chose this over waiting, 2026-10-17). Only analysed, not
// cached: the media cache keeps its own rule of fully played tracks. Before playback has resolved
// that URL there are no bytes yet, and `retry` says so.
//
// The run is on the renderer's GPU only - small0 has no CPU path - so a machine whose GPU cannot take
// it gets no beats - and the visualizer its original picture - rather than a CPU inference competing
// with playback for the length of a track.
//
// The beats come with their accents (analysis/beatAccents.ts) when the list was stored with them. A
// list stored before accents existed answers at once without them - the beat FX as they were - and
// `accented` brings the same beats with accents once they are measured, for the caller to swap in.
//
// The track's drum hits (`loadBeatFxTrackDrums`, analysis/drumHits.ts: htdemucs' drum stem on the
// GPU, with htdemucs_gpu installed) are read on their own, from the same bytes, only when a live effect
// on screen plays them (时计's 仿真鼓面), as they cost the track's bytes and seconds of GPU. They no
// longer wait on the beats: a picture that plays only drum hits never runs beat_this.

export type BeatFxSourceKind = 'beat_this' | 'none';

export interface BeatFxTrackBeats {
    events: BeatFxEvent[];
    source: BeatFxSourceKind;
    /** Why there are no beats, when there are none. */
    note?: string;
    /** No beats only because the track's bytes are not to be had yet; worth asking again shortly. */
    retry?: boolean;
    /** The track's dynamics scale (0.45..1); 1 without accents. */
    trackScale: number;
    /** The same beats with accents, when these came without; null if they cannot be measured now. */
    accented?: Promise<BeatFxTrackBeats | null>;
}

const memory = new Map<string, Promise<BeatFxTrackBeats>>();

/** An online track's bytes from the stream URL its playback resolved, if there is a live one. */
const readStreamedTrackBytes = async (song: SongResult): Promise<ArrayBuffer | null> => {
    if (getPlaybackSourceRef(song).kind !== 'online') return null;
    const prefetched = getPrefetchedData(song);
    const url = prefetched?.audioUrl;
    if (!url || url === 'CACHED_IN_DB' || !isUrlValid(prefetched.audioUrlFetchedAt) || !/^https?:/.test(url)) return null;
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        // An error page or a cut-off download decoded would be stored as this track's beats.
        return isCacheableAudioResponse(response, blob) ? await blob.arrayBuffer() : null;
    } catch (error) {
        console.warn('[BeatFx] could not read the stream for beats', error);
        return null;
    }
};
const MAX_TRACKS = 24;

interface TrackBytes {
    bytes: ArrayBuffer | null;
    /** Why there are none, when there are none. */
    note?: string;
}

/** The track's bytes as `key` names them: the representation's, or the local copy, or its stream. */
const readTrackBytes = async (song: SongResult, representation: PlaybackRepresentation | null): Promise<TrackBytes> => {
    const found = await readLocalTrackBytes(song, { representation });
    let bytes = found && 'bytes' in found ? found.bytes : null;
    // A representation's bytes are what the key names; an online track's stream is read only
    // when there is none.
    if (!bytes && !representation) bytes = await readStreamedTrackBytes(song);
    if (bytes) return { bytes };
    return { bytes: null, note: found && 'skipped' in found ? found.skipped : 'track not cached yet, and no stream URL resolved' };
};

const resolveTrackBeats = async (
    song: SongResult,
    key: string,
    representation: PlaybackRepresentation | null,
): Promise<BeatFxTrackBeats> => {
    let note = 'beat_this returned no beats (no usable GPU, or a failed run)';
    let retry = false;
    let grid: Awaited<ReturnType<typeof getTrackBeatGrid>>;
    const readBytes = async () => {
        const read = await readTrackBytes(song, representation);
        if (!read.bytes) {
            note = read.note ?? note;
            retry = true;
        }
        return read.bytes;
    };
    const readMid = async () => {
        // Asked before the read and the decode, which are seconds of work for nobody without one.
        if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
            note = 'no WebGPU in this renderer';
            return null;
        }
        const bytes = await readBytes();
        if (!bytes) return null;
        const buffer = await decodeAtRate(bytes, BEAT_THIS_SAMPLE_RATE);
        if (!buffer) {
            note = 'decode failed';
            return null;
        }
        return toMidSide(buffer).mid;
    };
    try {
        grid = await getTrackBeatGrid(key, readMid, { model: 'beat_this_small' });
    } catch (error) {
        // A throw here (a cache read, a worker, a GPU device lost mid-run) is "no beats" like any
        // other: answered, so the caller's frame falls back, and not remembered, so a later play retries.
        return { events: [], source: 'none', note: `beat lookup failed: ${String(error)}`, trackScale: 1 };
    }
    if (grid?.beats.length) {
        const found = grid;
        if (found.accents) {
            return {
                events: mergeBeatFxEvents(found.beats, found.downbeats, found.accents),
                source: 'beat_this',
                trackScale: found.accents.trackScale,
            };
        }
        // Measured on a worker after the fact; a failure only leaves the beats as they are.
        const accented = getTrackBeatAccents(key, found, readMid)
            .then((accents): BeatFxTrackBeats | null => (accents
                ? {
                    events: mergeBeatFxEvents(found.beats, found.downbeats, accents),
                    source: 'beat_this',
                    trackScale: accents.trackScale,
                }
                : null))
            .catch(() => null);
        return { events: mergeBeatFxEvents(found.beats, found.downbeats), source: 'beat_this', trackScale: 1, accented };
    }
    if (!canRunBeatThis('beat_this_small')) return { events: [], source: 'none', note: 'not the desktop app', trackScale: 1 };
    return { events: [], source: 'none', note, trackScale: 1, ...(retry ? { retry } : {}) };
};

/**
 * The beat list for a track and the analysis key it belongs to, computed once per session and shared
 * by concurrent callers. The key and the representation whose bytes are read are resolved together,
 * so a transcode registering mid-analysis cannot file one's beats under the other's key.
 */
export const loadBeatFxTrackBeats = (song: SongResult): { key: string; beats: Promise<BeatFxTrackBeats> } => {
    const { key, representation } = getPlaybackAnalysisTarget(song);
    const existing = memory.get(key);
    if (existing) return { key, beats: existing };
    const pending = resolveTrackBeats(song, key, representation);
    memory.set(key, pending);
    while (memory.size > MAX_TRACKS) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        memory.delete(oldest);
    }
    // A failed lookup is not remembered, so a later play (e.g. once the track is cached) retries.
    void pending.then((result) => {
        if (result.source === 'none' && memory.get(key) === pending) memory.delete(key);
    });
    return { key, beats: pending };
};

/** How a drum hit lookup ended: hits to play, none for this track, or no bytes yet (ask again). */
export type BeatFxTrackDrums = 'hits' | 'none' | 'retry';

/**
 * Starts reading a track's drum hits (analysis/drumHits.ts) - from the cache, or separated now on the
 * GPU - for a live effect that plays them, under the same analysis key as its beats. 'hits' once
 * `getDrumHits` answers for the key; 'none' for a drumless track, no htdemucs_gpu or no WebGPU;
 * 'retry' when the bytes are not to be had yet (an online track whose stream URL playback has not
 * resolved). The track asked for is the one a separation may run for; the caller says when it is
 * left (`setWantedDrumTrack(null)`).
 */
export const loadBeatFxTrackDrums = (song: SongResult): { key: string; drums: Promise<BeatFxTrackDrums> } => {
    const { key, representation } = getPlaybackAnalysisTarget(song);
    setWantedDrumTrack(key);
    let missing = false;
    const readBytes = async () => {
        const read = await readTrackBytes(song, representation);
        if (!read.bytes) missing = true;
        return read.bytes;
    };
    const drums = loadTrackDrumHits(key, readBytes)
        .then((analysis): BeatFxTrackDrums => (analysis && getDrumHits(key) ? 'hits' : missing ? 'retry' : 'none'));
    return { key, drums };
};
