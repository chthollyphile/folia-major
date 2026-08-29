import { describe, expect, it } from 'vitest';
import {
    aggregateChunks,
    beatsFromLogits,
    gridFromBeats,
    melSpectrogram,
    splitForModel,
    BEAT_THIS_FPS,
    BEAT_THIS_SAMPLE_RATE,
    MODEL_CHUNK_FRAMES,
    type ChunkPrediction,
} from '@/services/automix/beatThis';

// test/unit/automix/beatThis.test.ts
// The parts of the Beat This! pass that do not need the model.
//
// The real proof that this port is correct is not here and cannot be: it is thirty tracks of the
// user's own library run through both the official Python inference and this code, which agreed on
// beat and downbeat F-measure 1.0000 with a mean offset of 0.00ms and identical beat counts. What
// these tests protect is the plumbing either side of the network, where an off-by-one would move
// every beat by a frame and no test that only checks shapes would notice.

describe('melSpectrogram', () => {
    it('produces one frame per hop, centred like torch.stft', async () => {
        // Centred padding means frame 0 sits ON sample 0 rather than starting there, which is what
        // makes the model's output line up with the audio instead of trailing it by half a window.
        const mel = await melSpectrogram(new Float32Array(BEAT_THIS_SAMPLE_RATE));
        expect(mel.frames).toBe(Math.floor(BEAT_THIS_SAMPLE_RATE / 441) + 1);
        expect(mel.data.length).toBe(mel.frames * 128);
        expect(BEAT_THIS_FPS).toBe(50);
    });

    it('floors silence at the same place the checkpoint saw it', async () => {
        // log1p(1000 * 1e-10) - not zero. A different floor is a different input distribution.
        const mel = await melSpectrogram(new Float32Array(BEAT_THIS_SAMPLE_RATE));
        for (let index = 0; index < mel.data.length; index += 1) {
            expect(mel.data[index]).toBeCloseTo(Math.log1p(1000 * 1e-10), 12);
        }
    });

    it('puts a tone in the band it belongs to and nowhere else', async () => {
        const samples = new Float32Array(BEAT_THIS_SAMPLE_RATE);
        for (let index = 0; index < samples.length; index += 1) {
            samples[index] = Math.sin((2 * Math.PI * 440 * index) / BEAT_THIS_SAMPLE_RATE);
        }
        const mel = await melSpectrogram(samples);
        const middle = Math.floor(mel.frames / 2) * 128;
        let loudest = 0;
        for (let band = 1; band < 128; band += 1) {
            if (mel.data[middle + band] > mel.data[middle + loudest]) loudest = band;
        }
        // 440Hz on a 128-band Slaney scale from 30Hz to 11kHz lands in the low twenties. The exact
        // band is not the point; a tone landing at the top or the bottom would mean the filterbank
        // was built on the wrong scale, which is silent and total.
        expect(loudest).toBeGreaterThan(10);
        expect(loudest).toBeLessThan(40);
    });
});

describe('splitForModel / aggregateChunks', () => {
    /** A stand-in model that echoes each chunk's first mel band, so stitching can be checked. */
    const echo = (frames: number, data: Float32Array): Float32Array => {
        const out = new Float32Array(frames);
        for (let frame = 0; frame < frames; frame += 1) out[frame] = data[frame * 128];
        return out;
    };

    const roundTrip = (frames: number) => {
        // Every frame carries its own index, so a stitched frame that came from the wrong place
        // announces exactly where it came from.
        const data = new Float32Array(frames * 128);
        for (let frame = 0; frame < frames; frame += 1) data[frame * 128] = frame;
        const chunks = splitForModel({ data, frames });
        const predictions: ChunkPrediction[] = chunks.map(chunk => ({
            start: chunk.start,
            frames: chunk.frames,
            beat: echo(chunk.frames, chunk.data),
            downbeat: echo(chunk.frames, chunk.data),
        }));
        return { chunks, stitched: aggregateChunks(predictions, frames) };
    };

    it('never asks the model for more frames than the export accepts', () => {
        // A longer tensor does not degrade, it throws `invalid expand shape` from inside attention.
        for (const frames of [10, 1494, 1500, 1501, 4000, 12000]) {
            for (const chunk of splitForModel({ data: new Float32Array(frames * 128), frames })) {
                expect(chunk.frames).toBeLessThanOrEqual(MODEL_CHUNK_FRAMES);
                expect(chunk.data.length).toBe(chunk.frames * 128);
            }
        }
    });

    it('covers every frame of a long piece exactly once, in the right place', () => {
        const frames = 12000;
        const { stitched } = roundTrip(frames);
        for (let frame = 0; frame < frames; frame += 1) {
            expect(stitched.beat[frame]).toBe(frame);
        }
    });

    it('covers a piece shorter than one chunk', () => {
        const frames = 300;
        const { chunks, stitched } = roundTrip(frames);
        expect(chunks).toHaveLength(1);
        for (let frame = 0; frame < frames; frame += 1) {
            expect(stitched.beat[frame]).toBe(frame);
        }
    });

    it('covers a piece a few frames past one chunk, which is where the borders overlap most', () => {
        const frames = MODEL_CHUNK_FRAMES + 7;
        const { stitched } = roundTrip(frames);
        for (let frame = 0; frame < frames; frame += 1) {
            expect(stitched.beat[frame]).toBe(frame);
        }
    });
});

describe('beatsFromLogits', () => {
    const track = (frames: number, peaks: readonly number[]) => {
        const out = new Float32Array(frames).fill(-5);
        for (const peak of peaks) out[peak] = 3;
        return out;
    };

    it('reads a peak per beat and converts to seconds', () => {
        const grid = beatsFromLogits(track(500, [25, 50, 75, 100]), track(500, [25, 100]));
        expect(grid.beats).toEqual([0.5, 1, 1.5, 2]);
        expect(grid.downbeats).toEqual([0.5, 2]);
    });

    it('ignores a maximum that is not positive', () => {
        // The threshold IS zero - the model emits logits, and a negative maximum is the model
        // saying "no beat here", not "the quietest beat".
        const quiet = new Float32Array(200).fill(-5);
        quiet[100] = -1;
        expect(beatsFromLogits(quiet, quiet).beats).toEqual([]);
    });

    it('merges a beat the model fired on twice instead of reporting two', () => {
        const doubled = new Float32Array(200).fill(-5);
        doubled[100] = 3;
        doubled[101] = 3;
        const grid = beatsFromLogits(doubled, new Float32Array(200).fill(-5));
        expect(grid.beats).toHaveLength(1);
    });

    it('moves a downbeat onto its beat rather than leaving it a frame off', () => {
        // Two heads reading the same audio disagree by a frame often enough that this matters: a
        // bar line 20ms off its own beat makes every distance measured between the two grids wrong.
        const grid = beatsFromLogits(track(500, [50, 100]), track(500, [51]));
        expect(grid.downbeats).toEqual([1]);
    });
});

describe('gridFromBeats', () => {
    /** 120 BPM, four to the bar, starting a third of a second in. */
    const steady = (bars = 8, offset = 1 / 3) => {
        const beats: number[] = [];
        const downbeats: number[] = [];
        for (let beat = 0; beat < bars * 4; beat += 1) {
            const time = offset + beat * 0.5;
            beats.push(time);
            if (beat % 4 === 0) downbeats.push(time);
        }
        return { beats, downbeats };
    };

    it('reads back the tempo, the metre and both phases', () => {
        const grid = gridFromBeats(steady())!;
        expect(grid.bpm).toBeCloseTo(120, 6);
        expect(grid.beatsPerBar).toBe(4);
        // Phases are folded into one period / one bar, which is what `barGrid` takes.
        expect(grid.beatOffset).toBeCloseTo(1 / 3, 6);
        expect(grid.headDownbeatOffset).toBeCloseTo(1 / 3, 6);
        expect(grid.downbeatOffset).toBeCloseTo(1 / 3, 6);
    });

    it('counts three to the bar rather than assuming four', () => {
        const beats: number[] = [];
        const downbeats: number[] = [];
        for (let beat = 0; beat < 30; beat += 1) {
            beats.push(beat * 0.5);
            if (beat % 3 === 0) downbeats.push(beat * 0.5);
        }
        expect(gridFromBeats({ beats, downbeats })!.beatsPerBar).toBe(3);
    });

    it('is not moved by a beat the model missed', () => {
        // One dropped beat makes one interval twice the period. A mean would smear that across the
        // whole track; the median does not see it.
        const grid = steady();
        grid.beats.splice(9, 1);
        expect(gridFromBeats(grid)!.bpm).toBeCloseTo(120, 6);
    });

    it('declines rather than guessing from a handful of beats', () => {
        expect(gridFromBeats({ beats: [0, 0.5, 1], downbeats: [0] })).toBeNull();
    });

    it('leaves the outgoing tempo null on a partial profile', () => {
        // The tail of a head-only download describes the truncation, like every other tail field.
        expect(gridFromBeats(steady(40), { partial: true })!.outroBpm).toBeNull();
        expect(gridFromBeats(steady(40))!.outroBpm).toBeCloseTo(120, 6);
    });
});
