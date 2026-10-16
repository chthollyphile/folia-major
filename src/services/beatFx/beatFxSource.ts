import type { SongResult } from '../../types';
import { mergeBeatFxEvents, type BeatFxEvent } from './clock';
import { getTrackBeatGrid } from '../analysis/beatGrid';
import { BEAT_THIS_SAMPLE_RATE, canRunBeatThis } from '../analysis/beatThis';
import { decodeAtRate, readLocalTrackBytes, toMidSide } from '../analysis/trackAudio';
import { getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';
import type { PlaybackRepresentation } from '../../types/playbackRecovery';

// src/services/beatFx/beatFxSource.ts
// Where the beat FX get the playing track's beat list from.
//
// analysis/beatGrid.ts answers it: the list stored for this track by an earlier play, or the run of
// it already in flight, or a run now on the track's own bytes. The model is Beat This!'s small0
// (2.1M parameters, 4.7MB, packaged with the app), not automix's downloaded final0: the beat FX work
// on a fresh install, never wait on a download, and never read or share automix's lists.
//
// The bytes are only what is already on this machine (analysis/trackAudio.ts):
// the playback representation, the media cache, the local file. Never a download, so an online track
// gets its beats once it is cached, and a local one on its first play.
//
// The run is on the renderer's GPU only - small0 has no CPU path - so a machine whose GPU cannot take
// it gets no beats - and the visualizer its original picture - rather than a CPU inference competing
// with playback for the length of a track.

export type BeatFxSourceKind = 'beat_this' | 'none';

export interface BeatFxTrackBeats {
    events: BeatFxEvent[];
    source: BeatFxSourceKind;
    /** Why there are no beats, when there are none. */
    note?: string;
}

const memory = new Map<string, Promise<BeatFxTrackBeats>>();
const MAX_TRACKS = 24;

const resolveTrackBeats = async (
    song: SongResult,
    key: string,
    representation: PlaybackRepresentation | null,
): Promise<BeatFxTrackBeats> => {
    let note = 'beat_this returned no beats (no usable GPU, or a failed run)';
    let grid: Awaited<ReturnType<typeof getTrackBeatGrid>>;
    try {
        grid = await getTrackBeatGrid(key, async () => {
        // Asked before the read and the decode, which are seconds of work for nobody without one.
        if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
            note = 'no WebGPU in this renderer';
            return null;
        }
        const found = await readLocalTrackBytes(song, { representation });
        if (!found || !('bytes' in found)) {
            note = found?.skipped ?? 'track not cached yet';
            return null;
        }
        const buffer = await decodeAtRate(found.bytes, BEAT_THIS_SAMPLE_RATE);
        if (!buffer) {
            note = 'decode failed';
            return null;
        }
        return toMidSide(buffer).mid;
        }, { model: 'beat_this_small' });
    } catch (error) {
        // A throw here (a cache read, a worker, a GPU device lost mid-run) is "no beats" like any
        // other: answered, so the caller's frame falls back, and not remembered, so a later play retries.
        return { events: [], source: 'none', note: `beat lookup failed: ${String(error)}` };
    }
    if (grid?.beats.length) return { events: mergeBeatFxEvents(grid.beats, grid.downbeats), source: 'beat_this' };
    return { events: [], source: 'none', note: canRunBeatThis('beat_this_small') ? note : 'not the desktop app' };
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
