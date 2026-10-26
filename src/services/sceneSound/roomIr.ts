import { kWeight } from '../automix/signalAnalysis';
import { ROOM_FORMAT, type RoomRequest } from './acousticsTypes';

// src/services/sceneSound/roomIr.ts
// What the renderer does with a room IR before it plays it: the one loudness gain, and the cache key a request
// is sent with. The reflections' bass cut is the acoustics process's (electron/acoustics/phonon.cjs
// DEFAULTS.bassCutoffHz), where the reflections are still apart from the direct sound. Pure functions; the IR is the 4-channel true-stereo
// layout of acousticsTypes.ts ([L->Lear, L->Rear, R->Lear, R->Rear]).

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
