import { kWeight } from '../automix/signalAnalysis';
import { ROOM_FORMAT, type RoomRequest } from './acousticsTypes';

// src/services/sceneSound/roomIr.ts
// What the renderer does with a room IR before it plays it: the reflections' bass cut, the one loudness
// gain, and the cache key a request is sent with. Pure functions; the IR is the 4-channel true-stereo
// layout of acousticsTypes.ts ([L->Lear, L->Rear, R->Lear, R->Rear]).

/**
 * Below this frequency (Hz) the hall's reflections fade out; the direct sound keeps its full bass. Ray tracing
 * cannot get a room's bass right (the wavelengths are the size of the room), so the reflections give it up
 * gently instead (2nd-order Butterworth). The user tunes it by ear (decision of 2026-10-26 20:04, item 2);
 * 200 is the prototype's value. 0 turns the cut off.
 */
export const REFLECTION_BASS_CUTOFF_HZ = 200;

/**
 * How long after a speaker's first sound counts as its direct sound and keeps its bass: the HRTF's length.
 * The first reflection reaches a seat in this hall later than that (the floor's path is metres longer).
 */
const DIRECT_SECONDS = 0.0025;
/** The edge between the direct part and the rest, so the split itself adds nothing. */
const DIRECT_TAPER_SECONDS = 0.001;
/** A speaker's first sound: the first sample above this share of its loudest. */
const ONSET_SHARE = 1e-3;

/** In-place 2nd-order Butterworth high-pass (RBJ cookbook), as the prototype's. */
const highPass = (x: Float32Array, hz: number, sampleRate: number) => {
    const w = 2 * Math.PI * hz / sampleRate;
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    const b0 = (1 + cos) / 2 / a0;
    const b1 = -(1 + cos) / a0;
    const a1 = -2 * cos / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < x.length; i += 1) {
        const y = b0 * x[i] + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y;
    }
};

/**
 * The IR with each speaker's reflections high-passed at `hz` and its direct sound left whole. Each speaker's
 * two channels share one window: full band from its first sound for DIRECT_SECONDS, then a short raised-cosine
 * hand-over to the high-passed rest. Returns new arrays.
 */
export const cutReflectionBass = (channels: readonly Float32Array[], sampleRate: number, hz = REFLECTION_BASS_CUTOFF_HZ): Float32Array[] => {
    if (!(hz > 0)) return channels.map(channel => Float32Array.from(channel));
    const keep = Math.round(DIRECT_SECONDS * sampleRate);
    const taper = Math.max(1, Math.round(DIRECT_TAPER_SECONDS * sampleRate));
    const out: Float32Array[] = [];
    for (let speaker = 0; speaker < channels.length; speaker += 2) {
        const pair = channels.slice(speaker, speaker + 2);
        let peak = 0;
        for (const channel of pair) for (const v of channel) peak = Math.max(peak, Math.abs(v));
        const onset = peak > 0 ? Math.min(...pair.map(channel => {
            const at = channel.findIndex(v => Math.abs(v) > peak * ONSET_SHARE);
            return at < 0 ? channel.length : at;
        })) : 0;
        // w = 1 up to the end of the direct sound, then down to 0 over the taper.
        const direct = (i: number) => {
            const t = i - onset - keep;
            if (t < 0) return 1;
            if (t >= taper) return 0;
            return 0.5 * (1 + Math.cos(Math.PI * t / taper));
        };
        for (const channel of pair) {
            const rest = Float32Array.from(channel, (v, i) => v * (1 - direct(i)));
            highPass(rest, hz, sampleRate);
            out.push(Float32Array.from(channel, (v, i) => v * direct(i) + rest[i]));
        }
    }
    return out;
};

/** Pink (-3 dB per octave) from white: the 3-pole approximation of R. Bristow-Johnson, as in most pink-noise generators. */
const pink = (x: Float32Array) => {
    const b = [0.049922035, -0.095993537, 0.050612699, -0.004408786];
    const a = [-2.494956002, 2.017265875, -0.522189400];
    const out = new Float32Array(x.length);
    let x1 = 0; let x2 = 0; let x3 = 0; let y1 = 0; let y2 = 0; let y3 = 0;
    for (let i = 0; i < x.length; i += 1) {
        const y = b[0] * x[i] + b[1] * x1 + b[2] * x2 + b[3] * x3 - a[0] * y1 - a[1] * y2 - a[2] * y3;
        x3 = x2; x2 = x1; x1 = x[i]; y3 = y2; y2 = y1; y1 = y;
        out[i] = y;
    }
    return out;
};

/** Room after the IR's end for the two filters' own tails to come out (their slowest pole fades in about 5 ms). */
const TAIL_SECONDS = 0.1;

/** K-weighted energy that pink noise through `channel` delivers, per unit of noise power. */
const pinkKEnergy = (channel: Float32Array, sampleRate: number) => {
    const padded = new Float32Array(channel.length + Math.round(TAIL_SECONDS * sampleRate));
    padded.set(channel);
    let sum = 0;
    for (const v of kWeight(pink(padded), sampleRate)) sum += v * v;
    return sum;
};

/**
 * The one gain that makes the room as loud as no room: K-weighted (the loudness weighting, BS.1770) energy of
 * independent pink noise on the left and right inputs, dry against through the IR. The prototype measured this
 * calibration within 0.1 LU of each song's own (REPORT.md P4; the same noise on both inputs was 1.5 LU off).
 * Taken from the default seat's IR only: every other seat plays with the same gain and keeps its physical
 * difference (decision of 2026-10-26 20:04, item 1).
 */
export const loudnessGain = (channels: readonly Float32Array[], sampleRate: number): number => {
    const impulse = new Float32Array(1);
    impulse[0] = 1;
    const dry = 2 * pinkKEnergy(impulse, sampleRate);
    const wet = channels.reduce((sum, channel) => sum + pinkKEnergy(channel, sampleRate), 0);
    return wet > 0 ? Math.sqrt(dry / wet) : 1;
};

const bytesOf = (array: ArrayBufferView) => new Uint8Array(array.buffer, array.byteOffset, array.byteLength);

/**
 * The request's cache key: SHA-256 over everything that shapes the IR, and ROOM_FORMAT. The same room, seat,
 * speakers and output give the same key in any session; any change gives another.
 */
export const roomRequestKey = async (request: Omit<RoomRequest, 'key'>): Promise<string> => {
    const head = JSON.stringify({
        format: ROOM_FORMAT,
        materials: request.materials,
        speakers: request.speakers,
        listener: request.listener,
        output: request.output,
        sampleRate: request.sampleRate,
        // Each array's length, so the arrays that follow cannot run into one another.
        meshes: request.meshes.map(mesh => [mesh.positions.length, mesh.indices.length, mesh.triangleMaterials.length]),
    });
    const parts = [new TextEncoder().encode(head), ...request.meshes.flatMap(mesh => [bytesOf(mesh.positions), bytesOf(mesh.indices), bytesOf(mesh.triangleMaterials)])];
    const all = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of parts) {
        all.set(part, at);
        at += part.length;
    }
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
    return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
};
