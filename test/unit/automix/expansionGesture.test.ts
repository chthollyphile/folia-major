import { describe, expect, it } from 'vitest';
import {
    chooseExpansionIntensity,
    expansionMask,
    expansionStems,
    planExpansion,
    renderExpansion,
} from '../../../src/services/automix/expansionGesture';

// 120 BPM, four to the bar: a beat is 0.5s and a bar is 2s.
const BAR = 2;
const SAMPLE_RATE = 8000;

/** A ramp, so a read position can be recovered from the sample it produced. */
const ramp = (length: number) => Float32Array.from({ length }, (_, i) => i + 1);

describe('chooseExpansionIntensity', () => {
    // The one invariant the whole feature rests on. Performance mode is a switch the listener
    // flipped, so the measurement is only allowed to answer how hard - never whether. A zero here
    // would be a build that silently does not happen, which is indistinguishable from a bug.
    it('never returns nothing, however bad the evidence', () => {
        const cases = [
            {},
            { tailDb: -8, headDb: -30, startsHot: false },
            { tailDb: null, headDb: null, startsHot: null },
            { tailDb: Number.NaN, headDb: -6, startsHot: false },
            { tailDb: -6, headDb: -60, startsHot: false },
        ];
        for (const evidence of cases) {
            expect(chooseExpansionIntensity(evidence)).toBeGreaterThanOrEqual(0.25);
        }
    });

    it('goes harder when there is something to land on', () => {
        const quiet = chooseExpansionIntensity({ tailDb: -6, headDb: -12, startsHot: false });
        const loud = chooseExpansionIntensity({ tailDb: -12, headDb: -6, startsHot: true });
        expect(loud).toBeGreaterThan(quiet);
        expect(loud).toBe(1);
    });

    it('leaves the voice and the low end out until the top two steps', () => {
        expect(expansionStems(0.25)).toEqual(['drums']);
        expect(expansionStems(0.5)).toEqual(['drums']);
        expect(expansionStems(0.75)).toEqual(['drums', 'other']);
        expect(expansionStems(1)).not.toContain('bass');
        expect(expansionStems(1)).not.toContain('vocals');
    });
});

describe('planExpansion', () => {
    it('ends exactly on the swap, so the drop is the handover and not a new event', () => {
        const plan = planExpansion(1, 9, BAR, 20);
        expect(plan).not.toBeNull();
        expect(plan!.to).toBe(9);
        // 12 beats at 0.5s.
        expect(plan!.from).toBeCloseTo(3, 6);
    });

    // The correction a listening report bought. The first version's shallowest division was a whole
    // beat repeated two or three times, which is too few to read as an effect - so the ear called it
    // a rewind (reported as 倒带感 / 重播感, arriving BEFORE the rush, which is where the top of the
    // build is). Never repeat a slice long enough to be recognised as musical content.
    it('never repeats a whole beat, at any strength or tempo', () => {
        const beat = BAR / 4;
        for (const intensity of [0.25, 0.5, 0.75, 1]) {
            for (const swap of [1.5, 4, 9, 30]) {
                const plan = planExpansion(intensity, swap, BAR, 40);
                if (!plan) continue;
                for (const repeat of plan.repeats) {
                    expect(repeat.length).toBeLessThan(beat * 0.75);
                }
            }
        }
    });

    // Equal shares made it feel rushed (reported as 太快): a third of the gesture sat at the
    // fastest division, so there was no slow half for the fast part to be fast against.
    it('spends most of the build in the comfortable division', () => {
        const plan = planExpansion(0.75, 9, BAR, 20)!;
        const span = plan.to - plan.from;
        const slowest = plan.repeats[0].length;
        const inSlowest = plan.repeats
            .filter(repeat => Math.abs(repeat.length - slowest) < 1e-9)
            .reduce((total, repeat) => total + repeat.length, 0);
        expect(inSlowest / span).toBeGreaterThan(0.5);
    });

    it('tiles the build with no gap and no overlap', () => {
        const plan = planExpansion(1, 9, BAR, 20)!;
        let at = 0;
        for (const repeat of plan.repeats) {
            expect(repeat.at).toBeCloseTo(at, 6);
            at += repeat.length;
        }
        expect(at).toBeCloseTo(plan.to - plan.from, 6);
    });

    it('accelerates rather than resetting at each level boundary', () => {
        const plan = planExpansion(1, 9, BAR, 20)!;
        for (let i = 1; i < plan.repeats.length; i += 1) {
            expect(plan.repeats[i].rate).toBeGreaterThan(plan.repeats[i - 1].rate);
        }
        // Divisions really do shorten - that is what makes it sound like a build.
        expect(plan.repeats.at(-1)!.length).toBeLessThan(plan.repeats[0].length);
    });

    // The defect a listening report found by its symptom: "a very quiet roll". Levels took their
    // slice from wherever `levelStart` landed - 4.571 and 6.857 beats into the build - which on a
    // real kit is the decay between two hits. Measured on the 176 BPM demo: level two's source
    // slice peaked at 0.000 and level one's at 0.022, against level zero's 0.938. A beat-repeat of
    // silence is silence.
    it('takes every level from a beat, so a repeat has a transient in it', () => {
        for (const intensity of [0.5, 0.75, 1]) {
            for (const swap of [4, 9, 16]) {
                const plan = planExpansion(intensity, swap, BAR, 30)!;
                const beat = BAR / 4;
                for (const sourceAt of new Set(plan.repeats.map(repeat => repeat.sourceAt))) {
                    // Counted back from the swap, which is the end known to sit on a bar line.
                    const beatsBack = (plan.to - sourceAt) / beat;
                    expect(Math.abs(beatsBack - Math.round(beatsBack))).toBeLessThan(1e-9);
                }
            }
        }
    });

    it('shortens rather than moving the drop when the swap comes early', () => {
        const plan = planExpansion(1, 1.2, BAR, 20)!;
        expect(plan.to).toBe(1.2);
        expect(plan.from).toBe(0);
        expect(plan.reason).toContain('shortened');
    });

    it('declines only when there is genuinely no room, and says so', () => {
        expect(planExpansion(1, 0.2, BAR, 20)).toBeNull();
        expect(planExpansion(0.25, 0.4, BAR, 20)).not.toBeNull();
    });

    it('falls back to a quarter of the window when the tempo is unknown', () => {
        expect(planExpansion(0.5, 9, null, 20)).not.toBeNull();
    });
});

describe('renderExpansion', () => {
    it('fills the whole build and takes its material from before the swap', () => {
        const plan = planExpansion(0.5, 6, BAR, 20)!;
        const [out] = renderExpansion([ramp(20 * SAMPLE_RATE)], plan, SAMPLE_RATE);
        expect(out.length).toBe(Math.round((plan.to - plan.from) * SAMPLE_RATE));

        // Nothing may read past the swap: the build is made of what has already been heard.
        const swapSample = plan.to * SAMPLE_RATE;
        for (let i = 0; i < out.length; i += 1) expect(out[i]).toBeLessThanOrEqual(swapSample);

        // And it is not silence. The 2ms edges are the only zeros a repeat is allowed.
        const sounding = out.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
        expect(sounding / out.length).toBeGreaterThan(0.9);
    });

    it('repeats one slice rather than playing the material through', () => {
        // At 25% there is a single level, so every repeat loops the same slice - which means the
        // rendered build must revisit read positions the original audio only passes once.
        const plan = planExpansion(0.25, 6, BAR, 20)!;
        const [out] = renderExpansion([ramp(20 * SAMPLE_RATE)], plan, SAMPLE_RATE);
        const distinct = new Set(Array.from(out, value => Math.round(value)));
        expect(distinct.size).toBeLessThan(out.length * 0.75);
    });

    it('drags the tail backwards at the top strength and lands in a hole', () => {
        const plan = planExpansion(1, 9, BAR, 20)!;
        expect(plan.spinbackSec).toBeGreaterThan(0);
        const [out] = renderExpansion([ramp(20 * SAMPLE_RATE)], plan, SAMPLE_RATE);
        const spinFrom = out.length - Math.round(plan.spinbackSec * SAMPLE_RATE);
        // Reversed: read positions fall as time moves forward.
        expect(out[spinFrom + 200]).toBeLessThan(out[spinFrom + 10]);
        // And it is gone before the drop, so the incoming track arrives into silence.
        expect(out.at(-1)).toBe(0);
    });

    it('leaves no step at the edges of a repeat', () => {
        const plan = planExpansion(0.5, 6, BAR, 20)!;
        const [out] = renderExpansion([ramp(20 * SAMPLE_RATE)], plan, SAMPLE_RATE);
        for (const repeat of plan.repeats) {
            const start = Math.round(repeat.at * SAMPLE_RATE);
            expect(Math.abs(out[start])).toBeLessThan(Math.abs(out[start + 40]));
        }
    });
});

describe('expansionMask', () => {
    // The shipped handover must be unchanged by a sample anywhere outside the build, because it was
    // settled by eleven rounds of blind listening and this feature is not allowed to re-open it.
    it('silences the taken-over stem only for the length of the build', () => {
        const plan = planExpansion(0.5, 6, BAR, 20)!;
        const mask = expansionMask(20, plan);
        const at = (seconds: number) => mask[Math.round((seconds / 20) * (mask.length - 1))];
        expect(at(0)).toBe(1);
        expect(at(plan.from - 0.5)).toBe(1);
        expect(at((plan.from + plan.to) / 2)).toBe(0);
        expect(at(plan.to + 0.5)).toBe(1);
        expect(at(19)).toBe(1);
    });
});
