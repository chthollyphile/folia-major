import { describe, expect, it } from 'vitest';
import { analyseTrack, keyFromChroma, measureEdges } from '@/services/automix/trackProfile';
import { LUFS_OFFSET_DB } from '@/services/automix/signalAnalysis';

// test/unit/automix/trackProfile.test.ts

const RATE = 22050;

const silence = (seconds: number) => new Float32Array(Math.round(seconds * RATE));

const tone = (seconds: number, hz: number, amplitude = 0.5) => {
    const samples = new Float32Array(Math.round(seconds * RATE));
    for (let index = 0; index < samples.length; index += 1) {
        samples[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / RATE);
    }
    return samples;
};

const join = (...parts: Float32Array[]) => {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Float32Array(total);
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
};

/** A chroma vector whose tonic sits at `key`, built from the template the detector matches on. */
const chromaFor = (key: number, weights: readonly number[]) =>
    Array.from({ length: 12 }, (_, pitchClass) => weights[((pitchClass - key) % 12 + 12) % 12]);

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

describe('keyFromChroma', () => {
    it('rotates the template the right way round', () => {
        // The one thing worth pinning: an off-by-one in the rotation still produces a confident
        // answer, just a consistently wrong one, and every key decision downstream inherits it.
        expect(keyFromChroma(chromaFor(0, MAJOR))).toMatchObject({ key: 0, major: true });
        expect(keyFromChroma(chromaFor(7, MAJOR))).toMatchObject({ key: 7, major: true });
        expect(keyFromChroma(chromaFor(2, MINOR))).toMatchObject({ key: 2, major: false });
    });

    it('reports no confidence when every key fits equally badly', () => {
        expect(keyFromChroma(new Array(12).fill(1)).confidence).toBe(0);
    });
});

/** Splits a stereo pair the way profileService does, so the test feeds what production feeds. */
const midSide = (left: Float32Array, right: Float32Array) => {
    const mid = new Float32Array(left.length);
    const side = new Float32Array(left.length);
    for (let index = 0; index < left.length; index += 1) {
        mid[index] = (left[index] + right[index]) / 2;
        side[index] = (left[index] - right[index]) / 2;
    }
    return { mid, side };
};

/** Sums signals into one channel. */
const mix = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts[0].length);
    for (const part of parts) {
        for (let index = 0; index < out.length; index += 1) out[index] += part[index];
    }
    return out;
};

describe('analyseTrack, finding the voice', () => {
    // A stereo mix with the two hands panned apart, and a centred tone arriving partway through.
    // Panned content lands equally in mid and side and cancels to nothing; the centred tone lands
    // only in mid and survives. That difference is the whole mechanism.
    const INTRO_SEC = 6;
    const buildTrack = (vocalHz = 500) => {
        const leftOnly = join(tone(INTRO_SEC, 700, 0.4), tone(6, 700, 0.4));
        const rightOnly = join(tone(INTRO_SEC, 1100, 0.4), tone(6, 1100, 0.4));
        const centred = join(silence(INTRO_SEC), tone(6, vocalHz, 0.4));
        return midSide(mix(leftOnly, centred), mix(rightOnly, centred));
    };

    it('reports where the centred sound starts, not where the track starts', async () => {
        const { mid, side } = buildTrack();
        const profile = await analyseTrack(mid, RATE, { side });

        expect(profile?.leadIn).toBeCloseTo(0, 1);
        expect(profile?.vocalStart).toBeCloseTo(INTRO_SEC, 0);
    });

    it('answers null for a mono file, where there is nothing to cancel', async () => {
        // Every measurement below the vocal band still works; only this one cannot be made.
        const { mid } = buildTrack();
        const profile = await analyseTrack(mid, RATE, { side: null });

        expect(profile?.vocalStart).toBeNull();
        expect(profile?.loudness).toBeLessThan(0);
    });

    it('answers null when nothing centred ever arrives', async () => {
        const leftOnly = tone(12, 700, 0.4);
        const rightOnly = tone(12, 1100, 0.4);
        const { mid, side } = midSide(leftOnly, rightOnly);

        expect((await analyseTrack(mid, RATE, { side }))?.vocalStart).toBeNull();
    });

    it('ignores centred content outside the vocal band', async () => {
        // A centred bass line is not a voice. Without the band limit it reads as one, and every
        // track with a bass guitar reports its intro as zero seconds.
        const { mid, side } = buildTrack(80);

        expect((await analyseTrack(mid, RATE, { side }))?.vocalStart).toBeNull();
    });
});

describe('analyseTrack, finding the structure', () => {
    const chord = (seconds: number, hz: readonly number[]) =>
        mix(...hz.map(one => tone(seconds, one, 0.3)));
    const VERSE = [261.6, 329.6, 392.0];   // C major
    const CHORUS = [293.7, 349.2, 440.0];  // D minor - a different set of pitch classes

    it('puts the first boundary where the music becomes a different thing', async () => {
        // Eight seconds of one harmony, then another. No level change, no tempo change and no
        // voice, so nothing but the self-similarity of the two halves marks the join.
        const profile = await analyseTrack(join(chord(8, VERSE), chord(14, CHORUS)), RATE);

        expect(profile?.sectionStart).toBeCloseTo(8, 0);
    });

    it('finds no boundary in music that never changes', async () => {
        // The checkerboard's two halves cancel exactly here, so what is left is float noise. A
        // sigma test on its own promotes that noise to a boundary; the flatness check is why not.
        expect((await analyseTrack(chord(22, VERSE), RATE))?.sectionStart).toBeNull();
    });

    it('reads a short intro as a short intro, not as the section after it', async () => {
        // The kernel used to refuse to score the first four seconds, and the failure mode of
        // refusing is not "no answer": the first boundary vanishes and the SECOND one is handed
        // over as `sectionStart`. A three-second intro reported seventeen seconds of room to blend
        // into - the shortest intros coming out as the longest, which is the one direction this
        // number is read in. The planner spends it as a ceiling, so being generous is being wrong.
        const short = await analyseTrack(
            join(chord(3, VERSE), chord(14, CHORUS), chord(14, VERSE)), RATE,
        );

        expect(short!.sectionStart).toBeCloseTo(3, 0);
    });

    it('places a boundary inside its bin rather than on its left edge', async () => {
        // The self-similarity matrix bins at one second and a peak is reported by its bin index, so
        // an unrefined boundary is floor(truth) - never late, never right. Half a second does not
        // sound like much until `quantiseToMusic` spends the ceiling in whole bars: a bar that
        // misses by a tenth of a second is not shortened, it is dropped.
        const profile = await analyseTrack(join(chord(8.5, VERSE), chord(14, CHORUS)), RATE);

        expect(profile!.sectionStart).toBeGreaterThan(8.15);
    });

    it('has nothing to say about a track too short to hold the kernel', async () => {
        expect((await analyseTrack(join(chord(2, VERSE), chord(2, CHORUS)), RATE))?.sectionStart)
            .toBeNull();
    });

    it('keeps every boundary, not only the first', async () => {
        // The first one answers "where does the intro end". The rest answer "where may a handover
        // go", which is the larger of the two questions and the one the outgoing track asks.
        const profile = await analyseTrack(
            join(chord(8, VERSE), chord(8, CHORUS), chord(10, VERSE)), RATE,
        );

        expect(profile!.sections.length).toBeGreaterThanOrEqual(2);
        expect(profile!.sections[0]).toBe(profile!.sectionStart);
        expect(profile!.sections.some(at => Math.abs(at - 16) <= 2)).toBe(true);
    });

    it('reads the two ends for their own key rather than averaging the whole track', async () => {
        // A song that modulates has more than one key, and a transition only ever touches twenty
        // seconds of it. Averaging four minutes to answer a question about twenty is a different
        // question, cheaply asked.
        const profile = await analyseTrack(join(chord(22, VERSE), chord(22, CHORUS)), RATE);

        expect(profile!.introKey.key).not.toBe(profile!.outroKey!.key);
        expect(profile!.introKey.confidence).toBeGreaterThan(0);
    });
});

describe('analyseTrack, the fields a transition reads', () => {
    const track = () => join(silence(0.5), tone(30, 220), silence(0.5));

    it('reports a tone as three shares that add up to one', async () => {
        // Shares rather than levels, because loudness is matched elsewhere. What is left after
        // that is the SHAPE, and a share is what a shape is.
        const profile = await analyseTrack(track(), RATE);

        expect(profile!.introTone).toHaveLength(3);
        expect(profile!.introTone.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 6);
        // 220Hz is under the first edge, so nearly all of it belongs to the low band.
        expect(profile!.introTone[0]).toBeGreaterThan(0.8);
        expect(profile!.outroTone).not.toBeNull();
    });

    it('states the bar length rather than leaving three files to assume it', async () => {
        expect((await analyseTrack(track(), RATE))!.beatsPerBar).toBe(4);
    });

    it('leaves every answer about the end null when only the head was read', async () => {
        const profile = await analyseTrack(track(), RATE, { partial: true });

        expect(profile!.outroKey).toBeNull();
        expect(profile!.outroTone).toBeNull();
        expect(profile!.outroBpm).toBeNull();
        expect(profile!.tailDb).toBeNull();
        // The head half is still answered - that is the whole point of reading a prefix.
        expect(profile!.introTone).toHaveLength(3);
        expect(profile!.headDb).toBeLessThan(0);
    });

    it('has no bar line to offer in music with no low end to read one from', async () => {
        // Naming a downbeat from a signal that carries no pattern would be inventing evidence, and
        // a wrong bar line is worse than none: everything downstream would land a beat out.
        expect((await analyseTrack(track(), RATE))!.downbeatOffset).toBeNull();
    });
});

describe('analyseTrack, the bar line at each end', () => {
    /**
     * A kick on the one, a tick above the bar-line band on the other three.
     *
     * Split that way on purpose. The downbeat vote reads the bottom 150Hz alone, so putting the
     * kick there and nothing else makes the low end carry the bar line by itself, while the ticks
     * keep a beat on every quarter for the tempo estimator to find. Four kicks to the bar - which
     * is what most dance music actually is - is a different test, and the one the harmonic vote
     * exists for.
     */
    const groove = (seconds: number, bpm: number, firstBeat: number) => {
        const samples = new Float32Array(Math.round(seconds * RATE));
        const kick = Math.round(0.09 * RATE);
        const tick = Math.round(0.03 * RATE);
        for (let beat = 0, at = firstBeat; at < seconds; beat += 1, at += 60 / bpm) {
            const start = Math.round(at * RATE);
            const [length, hz, level] = beat % 4 === 0 ? [kick, 60, 0.9] : [tick, 4000, 0.5];
            for (let index = 0; index < length && start + index < samples.length; index += 1) {
                samples[start + index] += level * (1 - index / length)
                    * Math.sin((2 * Math.PI * hz * index) / RATE);
            }
        }
        return samples;
    };

    /** Distance to the nearest line of a grid, which is a distance on a circle. */
    const offBy = (offset: number, target: number, bar: number) => {
        const gap = ((offset - target) % bar + bar) % bar;
        return Math.min(gap, bar - gap);
    };

    it('reads the head bar line off the head instead of walking one back from the end', async () => {
        // Four minutes at 128, dead steady - no ritardando, nothing exotic. The whole-track answer
        // is still wrong here, and that is the point: it is anchored on the last beat in the file
        // and folded back to zero through a period known to about a thousandth, so its error is
        // whatever a thousandth of the track's length comes to. Measured across this same groove at
        // 60s, 150s and 240s it went 0.10s, 0.24s, 0.38s - four fifths of a beat by the end, on the
        // one number the incoming side of every transition is entered on.
        const profile = await analyseTrack(groove(240, 128, 0.6), RATE);
        const beat = 60 / profile!.bpm!;

        expect(profile!.headDownbeatOffset).not.toBeNull();
        const head = offBy(profile!.headDownbeatOffset!, 0.6, beat * profile!.beatsPerBar);
        // A quarter beat is the loosest this can be and still mean anything; the head reading comes
        // in at about a sixth of one, and it does not grow with the track.
        expect(head).toBeLessThan(beat / 4);
        expect(head).toBeLessThan(offBy(profile!.downbeatOffset!, 0.6, beat * profile!.beatsPerBar));
    }, 30000);

    it('has nothing to say about a head with no bar line in it', async () => {
        expect((await analyseTrack(join(silence(0.5), tone(40, 220), silence(0.5)), RATE))!
            .headDownbeatOffset).toBeNull();
    });
});

describe('analyseTrack', () => {
    it('finds the silence at each end without being told what silence is', () => {
        // The threshold is relative to the track's own peak: an absolute dBFS floor would call a
        // quiet master silent from end to end.
        return analyseTrack(join(silence(1), tone(6, 220), silence(1)), RATE).then(profile => {
            expect(profile).not.toBeNull();
            expect(profile!.duration).toBeCloseTo(8, 1);
            expect(profile!.leadIn).toBeGreaterThan(0.8);
            expect(profile!.leadIn).toBeLessThan(1.1);
            expect(profile!.leadOut).toBeGreaterThan(0.8);
            expect(profile!.leadOut).toBeLessThan(1.1);
        });
    });

    it('calls a track that runs at one level from end to end hot at both ends', async () => {
        const profile = await analyseTrack(tone(8, 220), RATE);
        expect(profile!.startsHot).toBe(true);
        expect(profile!.endsHot).toBe(true);
        expect(profile!.outroSlope).toBeCloseTo(0, 1);
    });

    it('sees a fade-out as a fade-out', async () => {
        const fading = tone(12, 220);
        const from = Math.round(4 * RATE);
        for (let index = from; index < fading.length; index += 1) {
            fading[index] *= 1 - (index - from) / (fading.length - from);
        }
        const profile = await analyseTrack(fading, RATE);
        expect(profile!.endsHot).toBe(false);
        // Steep enough that the chooser reads it as produced rather than as a musical ending.
        expect(profile!.outroSlope).toBeLessThan(-1.5);
    });

    it('reads the tempo off a click track', async () => {
        // 120 BPM: one impulse every half second.
        const clicks = new Float32Array(24 * RATE);
        for (let beat = 0; beat * 0.5 < 24; beat += 1) {
            const at = Math.round(beat * 0.5 * RATE);
            for (let index = 0; index < 220 && at + index < clicks.length; index += 1) {
                clicks[at + index] = (1 - index / 220) * Math.sin((2 * Math.PI * 1000 * index) / RATE);
            }
        }
        const profile = await analyseTrack(clicks, RATE);
        expect(profile!.bpm).toBeGreaterThan(112);
        expect(profile!.bpm).toBeLessThan(128);
    });

    it('leaves the tail unknown rather than describing where the file was cut off', async () => {
        // A range request off the front of a file decodes as a short track. Everything about its
        // "end" is the truncation, so it has to come back null and not merely wrong.
        const profile = await analyseTrack(join(silence(1), tone(6, 220)), RATE, { partial: true });
        expect(profile!.partial).toBe(true);
        expect(profile!.leadIn).toBeGreaterThan(0.8);
        expect(profile!.startsHot).toBe(true);
        expect(profile!.endsHot).toBeNull();
        expect(profile!.leadOut).toBeNull();
        expect(profile!.outroSlope).toBeNull();
    });

    it('refuses to describe something too short to describe', async () => {
        expect(await analyseTrack(tone(0.5, 220), RATE)).toBeNull();
        expect(await analyseTrack(silence(4), RATE)).toBeNull();
    });
});

describe('measureEdges', () => {
    // The live path samples at 25ms, which is the case that has to hold: the file path's own hop is
    // an order of magnitude finer, so a window sized in frames behaves differently at each.
    const HOP = 0.025;
    const levels = (...runs: { db: number; seconds: number }[]) =>
        runs.flatMap(run => new Array(Math.round(run.seconds / HOP)).fill(run.db));

    it('separates a track that stops at full level from one that decays out', () => {
        const stops = measureEdges(levels({ db: -12, seconds: 40 }), HOP);
        expect(stops).toMatchObject({ endsHot: true });
        expect(stops!.outroSlope).toBeCloseTo(0, 2);

        // A produced fade: the last ten seconds slide from full level down into the floor.
        const fade = Array.from({ length: Math.round(10 / HOP) }, (_, index) =>
            -12 - (index / (10 / HOP)) * 25);
        const fades = measureEdges([...levels({ db: -12, seconds: 30 }), ...fade], HOP);
        expect(fades).toMatchObject({ endsHot: false });
        // Steeper than the chooser's -1.5 dB/s threshold, which is what makes it a fade-out.
        expect(fades!.outroSlope).toBeLessThan(-1.5);
    });

    it('separates where a track stops holding its level from where it stops sounding', () => {
        // The two fixtures above, asked the question a handover actually needs. The silence floor
        // is forty dB under the PEAK, which on a real master is thirty under the music - so a blend
        // aimed at `soundingEnd` spends its whole length inside the decay. A track that stops dead
        // has one answer to both; a produced fade has two, and the gap between them is the fade.
        const stops = measureEdges(levels({ db: -12, seconds: 40 }), HOP)!;
        expect(stops.bodyEnd).toBeCloseTo(stops.soundingEnd, 6);

        const fade = Array.from({ length: Math.round(10 / HOP) }, (_, index) =>
            -12 - (index / (10 / HOP)) * 25);
        const fades = measureEdges([...levels({ db: -12, seconds: 30 }), ...fade], HOP)!;
        expect(fades.soundingEnd).toBeCloseTo(40, 1);
        // Some way into the fade the level drops far enough under the track's own average to stop
        // counting. Everything after it is decay a handover should play OVER rather than inside.
        expect(fades.bodyEnd).toBeGreaterThan(30);
        expect(fades.bodyEnd).toBeLessThan(36);
    });

    it('finds the sounding part between the silence at each end', () => {
        const edges = measureEdges(
            levels({ db: -90, seconds: 2 }, { db: -12, seconds: 30 }, { db: -90, seconds: 3 }),
            HOP,
        );
        expect(edges!.leadIn).toBeCloseTo(2, 1);
        expect(edges!.soundingEnd).toBeCloseTo(32, 1);
        // Averaged over the sounding part alone: the trailing silence must not drag it down.
        // Reported in LUFS, so the readings carry BS.1770's own -0.691 offset.
        expect(edges!.loudness).toBeCloseTo(-12 + LUFS_OFFSET_DB, 1);
        // Both ends of a level track are the level: the step is what these exist to measure.
        expect(edges!.headDb).toBeCloseTo(-12 + LUFS_OFFSET_DB, 1);
        expect(edges!.tailDb).toBeCloseTo(-12 + LUFS_OFFSET_DB, 1);
    });

    it('has no answer for silence, or for no readings at all', () => {
        expect(measureEdges(levels({ db: -90, seconds: 30 }), HOP)).toBeNull();
        expect(measureEdges([], HOP)).toBeNull();
        expect(measureEdges(levels({ db: -12, seconds: 30 }), 0)).toBeNull();
    });
});

describe('gridless', () => {
    // The marker crossfade mode leaves behind. It records that the model was never RUN, which is
    // why the caller passes it rather than the profile inferring it from a null grid: a track the
    // model ran on and could not grid must come out NOT gridless, or it gets re-measured forever.
    it('records what the caller was told, not whether a grid arrived', async () => {
        const audio = join(silence(1), tone(8, 220));

        expect((await analyseTrack(audio, RATE, { gridless: true }))?.gridless).toBe(true);
        expect((await analyseTrack(audio, RATE, { gridless: false }))?.gridless).toBe(false);
        // The case the inference-from-`grid` version got wrong: model ran, found nothing.
        expect((await analyseTrack(audio, RATE, { gridless: false, grid: null }))?.gridless).toBe(false);
    });
});
