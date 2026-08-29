// Renders performance mode's four strengths to WAV, so the gesture can be JUDGED rather than
// described. Uses the shipped planner and the shipped renderer - nothing here re-implements them.
//
//   npx tsx test/manual/expansion_demo.mts <outDir>
//
// The source is a synthetic 120 BPM kit rather than a real track: a demo built from one song is an
// argument about that song. What is being demonstrated is what the gesture DOES to a beat, and a
// beat with nothing else in it is the only place that is visible.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    planExpansion,
    renderExpansion,
} from '../../src/services/automix/expansionGesture';

const RATE = 44100;
// Tempo is an argument, and that is the point of this script existing twice.
//
// The gesture's deepest division is a fraction of a BEAT while "too short to read as rhythm" is a
// number of MILLISECONDS, so the floor slides with the tempo: an eighth of a beat is 63ms at 120
// and 41ms at 176. The file's own note says a roll past that stops being rhythm, and nothing in the
// planner enforces it in absolute time. Whether 41ms is a fast roll or a buzz is not answerable by
// reading either the code or the log - it needs the same build rendered at both tempos.
const BPM = Number(process.argv[3]) || 120;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
/** Where the drums change hands. Everything before it is what the build has to work with. */
const SWAP = BAR * 8;
const TOTAL = SWAP + BAR * 2;

const noise = (() => {
    let seed = 12345;
    return () => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return (seed / 0x3fffffff) - 1;
    };
})();

/** A kit, near enough: sine kick, noise snare, short noise hat. */
const kit = (): Float32Array => {
    const out = new Float32Array(Math.round(TOTAL * RATE));
    const hit = (at: number, build: (t: number) => number, length: number) => {
        const start = Math.round(at * RATE);
        const run = Math.round(length * RATE);
        for (let i = 0; i < run && start + i < out.length; i += 1) {
            out[start + i] += build(i / RATE);
        }
    };
    for (let beat = 0; beat * BEAT < TOTAL; beat += 1) {
        const at = beat * BEAT;
        const inBar = beat % 4;
        if (inBar === 0 || inBar === 2) {
            hit(at, t => Math.sin(2 * Math.PI * (55 - 20 * t / 0.18) * t) * Math.exp(-t / 0.055) * 0.9, 0.25);
        }
        if (inBar === 1 || inBar === 3) {
            hit(at, t => noise() * Math.exp(-t / 0.045) * 0.5, 0.2);
        }
        hit(at, t => noise() * Math.exp(-t / 0.012) * 0.16, 0.05);
        hit(at + BEAT / 2, t => noise() * Math.exp(-t / 0.012) * 0.16, 0.05);
    }
    return out;
};

/** 16-bit mono WAV. */
const wav = (samples: Float32Array): Buffer => {
    const bytes = Buffer.alloc(44 + samples.length * 2);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(36 + samples.length * 2, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(RATE, 24);
    bytes.writeUInt32LE(RATE * 2, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    // The data chunk's LENGTH, and it went missing for this script's entire life. Every WAV it
    // wrote carried a header saying it held zero seconds of audio, so every player opened them
    // silent - including the four-strength set handed over as this feature's listening material.
    // A file of the right size, with real samples in it, that no one can hear.
    bytes.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        bytes.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
    }
    return bytes;
};

/**
 * Reads one back and says whether it is playable, because the header above is hand-written and
 * being the right SIZE is not the same as being right. This is the check that was missing.
 */
const playable = (bytes: Buffer): string => {
    const declared = bytes.readUInt32LE(40);
    const actual = bytes.length - 44;
    let peak = 0;
    for (let i = 44; i + 1 < bytes.length; i += 2) peak = Math.max(peak, Math.abs(bytes.readInt16LE(i)));
    if (declared !== actual) return `BROKEN: header says ${declared} bytes, file holds ${actual}`;
    if (peak === 0) return 'BROKEN: silent';
    return `ok, peak ${(peak / 32767).toFixed(2)}`;
};

const outDir = process.argv[2] ?? '.';
mkdirSync(outDir, { recursive: true });
const source = kit();

// The control. Without a do-nothing arm the four strengths can be ranked against each other but
// not priced against leaving the transition alone - see the round-ten verdict.
const control = wav(source);
writeFileSync(join(outDir, `expansion-${BPM}bpm-00-control.wav`), control);
console.log(`control @ ${BPM} BPM : ${TOTAL.toFixed(2)}s, swap at ${SWAP.toFixed(2)}s - ${playable(control)}`);

for (const intensity of [0.25, 0.5, 0.75, 1]) {
    const plan = planExpansion(intensity, SWAP, BAR, TOTAL);
    if (!plan) {
        console.log(`${String(intensity * 100).padStart(3)}%               : no room`);
        continue;
    }
    const [built] = renderExpansion([source], plan, RATE);
    // Same substitution the session does: the stem the build took over is silenced across
    // [from, to) and the rendered material plays there instead.
    const mixed = Float32Array.from(source);
    const from = Math.round(plan.from * RATE);
    for (let i = 0; i < built.length && from + i < mixed.length; i += 1) mixed[from + i] = built[i];

    const name = `expansion-${BPM}bpm-${String(Math.round(intensity * 100)).padStart(2, '0')}.wav`;
    const bytes = wav(mixed);
    writeFileSync(join(outDir, name), bytes);
    // The shortest slice, printed, because it is the quantity being judged and it is not in
    // `plan.reason` - which counts levels and repeats and says nothing about how long one is.
    const shortest = Math.min(...plan.repeats.map(repeat => repeat.length));
    console.log(
        `${String(Math.round(intensity * 100)).padStart(3)}% ${name} : ${plan.reason}`
        + `, shortest slice ${(shortest * 1000).toFixed(0)}ms - ${playable(bytes)}`,
    );
}
