import { aggregateChunks, beatsFromLogits, MODEL_CHUNK_FRAMES, type ChunkPrediction } from '../../src/services/automix/beatThis';

// dev/beat-this-wgsl/compare-songs.ts
// Second half of the whole-track check: for each track the harness wrote, stitches both logit sets
// (<name>.wgsl.f32 from the WGSL runtime, <name>.ort.f32 from ORT on the same chunks) with the app's
// own aggregateChunks + beatsFromLogits, and compares the beat and downbeat lists the way the
// README's 30-track gate does: F-measure at +-70 ms, mean offset of matched beats, beat counts.
//
//   npx rolldown dev/beat-this-wgsl/compare-songs.ts -o $OUT/compare.cjs -f cjs -p node && node $OUT/compare.cjs $OUT name...

const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');

const TOLERANCE = 0.07;

/** Greedy one-to-one matching within the tolerance; returns F-measure and mean |offset| of matches. */
const compare = (reference: number[], estimate: number[]) => {
    const used = new Set<number>();
    const offsets: number[] = [];
    for (const time of reference) {
        let best = -1;
        for (let index = 0; index < estimate.length; index += 1) {
            if (used.has(index) || Math.abs(estimate[index] - time) > TOLERANCE) continue;
            if (best < 0 || Math.abs(estimate[index] - time) < Math.abs(estimate[best] - time)) best = index;
        }
        if (best >= 0) {
            used.add(best);
            offsets.push(Math.abs(estimate[best] - time));
        }
    }
    const hits = offsets.length;
    const f = reference.length + estimate.length ? (2 * hits) / (reference.length + estimate.length) : 1;
    const meanMs = hits ? (offsets.reduce((a, b) => a + b, 0) / hits) * 1000 : 0;
    return { f, meanMs };
};

const [dir, ...names] = process.argv.slice(2);
const T = MODEL_CHUNK_FRAMES;
let allExact = true;
for (const name of names) {
    // chunkFrames: each chunk's real length when one is short (a track under 30 s); the files keep
    // the [chunks, 2, 1500] layout regardless, with the tail of a short chunk unused.
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${name}.meta.json`), 'utf8')) as { frames: number; starts: number[]; chunkFrames?: number[] };
    const grid = (file: string) => {
        const bytes = fs.readFileSync(path.join(dir, file));
        const logits = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
        const predictions: ChunkPrediction[] = meta.starts.map((start, index) => ({
            start,
            frames: meta.chunkFrames?.[index] ?? T,
            beat: logits.subarray(index * 2 * T, index * 2 * T + (meta.chunkFrames?.[index] ?? T)),
            downbeat: logits.subarray(index * 2 * T + T, index * 2 * T + T + (meta.chunkFrames?.[index] ?? T)),
        }));
        const track = aggregateChunks(predictions, meta.frames);
        return beatsFromLogits(track.beat, track.downbeat);
    };
    const ort = grid(`${name}.ort.f32`);
    const wgsl = grid(`${name}.wgsl.f32`);
    const beats = compare(ort.beats, wgsl.beats);
    const downbeats = compare(ort.downbeats, wgsl.downbeats);
    const exact = JSON.stringify(ort) === JSON.stringify(wgsl);
    allExact &&= exact;
    console.log(`${name}: beats ${wgsl.beats.length}/${ort.beats.length} F ${beats.f.toFixed(4)} offset ${beats.meanMs.toFixed(2)} ms | `
        + `downbeats ${wgsl.downbeats.length}/${ort.downbeats.length} F ${downbeats.f.toFixed(4)} offset ${downbeats.meanMs.toFixed(2)} ms | identical ${exact}`);
}
process.exit(allExact ? 0 : 1);
