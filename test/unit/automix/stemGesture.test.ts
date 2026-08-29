import { describe, expect, it } from 'vitest';
import {
    envelopeOf,
    fall,
    findSustain,
    incomingCurves,
    outgoingCurves,
    planStemHandover,
    lastVocalMoment,
    planVocalExit,
    rise,
    singsInWindow,
    CELL_SEC,
    REST_DB,
} from '@/services/automix/stemGesture';

// test/unit/automix/stemGesture.test.ts
// The round-eleven handover, checked where it can be checked without ears.
//
// What these tests can and cannot do is worth being explicit about. Whether this gesture SOUNDS
// good was settled by eight blind listening rounds with a planted noise control, and no assertion
// here re-opens that. What they protect is that the port still does what the harness did: the
// branch fires on the same evidence, the search stays free rather than snapped, and - the one that
// would be silent and total if it broke - every outgoing curve starts at unity, which is the
// property that lets a deck change over from its element to its stems without a step.

/** A window of envelope cells at a constant level, in the shape envelopeOf returns. */
const flat = (seconds: number, value: number): Float32Array =>
    new Float32Array(Math.round(seconds / CELL_SEC)).fill(value);

/** The same, with a quiet stretch cut into it. Also takes an envelope, so holes can be stacked. */
const withRest = (
    seconds: number | Float32Array, value: number, from: number, to: number, quiet: number,
) => {
    const out = typeof seconds === 'number' ? flat(seconds, value) : seconds;
    for (let c = Math.round(from / CELL_SEC); c < Math.round(to / CELL_SEC); c += 1) out[c] = quiet;
    return out;
};

/** Silence, one note held at a constant level, silence. */
const heldTail = (seconds: number, from: number, to: number) => {
    const out = flat(seconds, 1e-6);
    for (let c = Math.round(from / CELL_SEC); c < Math.round(to / CELL_SEC); c += 1) out[c] = 1;
    return out;
};

describe('envelopeOf', () => {
    it('measures one cell per 50ms and reads back the level that went in', () => {
        const samples = new Float32Array(44100).fill(0.5);
        const envelope = envelopeOf([samples], 44100);
        expect(envelope.length).toBe(Math.floor(1 / CELL_SEC));
        for (const cell of envelope) expect(cell).toBeCloseTo(0.5, 6);
    });

    it('sums channels rather than taking one, so a panned voice is not read as a quiet one', () => {
        // A voice hard left is exactly as present as one in the middle; reading channel 0 alone
        // would call the same performance loud or silent depending on the mix.
        const left = new Float32Array(4410).fill(0.8);
        const right = new Float32Array(4410);
        const [mono] = [envelopeOf([left, right], 44100)];
        expect(mono[0]).toBeCloseTo(0.4, 6);
    });
});

describe('planVocalExit', () => {
    it('cuts inside a real rest', () => {
        // A voice at the mix's own level, with a genuine hole in the middle of the window.
        const exit = planVocalExit(withRest(8, 1, 3, 4, 1e-6), flat(8, 1), 6);
        expect(exit.kind).toBe('rest');
        expect(exit.loudDb).toBeLessThanOrEqual(REST_DB);
        // Inside the hole, and half a second long - a cut, not a fade.
        expect(exit.from).toBeGreaterThanOrEqual(3 - 1e-9);
        expect(exit.to - exit.from).toBeCloseTo(0.5, 6);
    });

    it('recedes across the whole window when there is nowhere quiet to hide', () => {
        // The failure round ten measured: a fade needs somewhere to hide, and a voice that never
        // stops has none, so the exit becomes a long recede rather than a cut nobody can miss.
        const exit = planVocalExit(flat(8, 1), flat(8, 1), 6);
        expect(exit.kind).toBe('recede');
        expect(exit.from).toBeCloseTo(0.05, 6);
        expect(exit.to).toBeCloseTo(6, 6);
    });

    it('measures quiet against the mix, not against the vocal itself', () => {
        // The threshold is -30dB BELOW THE MIX, so the identical vocal envelope has to give
        // opposite branches under two different bands. The dip is only 20dB down on its own terms,
        // which is not a rest under a quiet mix and comfortably one under a loud mix.
        const vocals = withRest(8, 0.1, 3, 4, 0.01);
        expect(planVocalExit(vocals, flat(8, 1), 6).kind).toBe('rest');
        expect(planVocalExit(vocals, flat(8, 0.1), 6).kind).toBe('recede');
    });

    it('finds a rest that no beat grid would have landed on', () => {
        // Round eleven tried snapping the cut to the grid and measured it losing 16dB on a track
        // whose rest is barely half a second long. The search has to stay free, so a rest at an
        // arbitrary offset must still be found exactly.
        const exit = planVocalExit(withRest(8, 1, 2.35, 2.9, 1e-6), flat(8, 1), 6);
        expect(exit.kind).toBe('rest');
        // The LAST half-second that fits inside the 0.55s hole, which is 2.40s - an offset no beat
        // grid has a line on, which is the property under test.
        expect(exit.from).toBeCloseTo(2.40, 2);
        expect(exit.to).toBeLessThanOrEqual(2.9 + 1e-9);
    });

    it('takes the loudest moment in the half second, not the average', () => {
        // A syllable inside a pause makes that half second unusable. An average would hide it and
        // the cut would land on the one word the listener notices being taken away.
        const vocals = withRest(8, 1, 3, 4, 1e-6);
        vocals[Math.round(3.3 / CELL_SEC)] = 1;          // one loud cell inside the hole
        const exit = planVocalExit(vocals, flat(8, 1), 6);
        expect(exit.kind).toBe('rest');
        // The chosen half second must not contain that cell - on either side of it is fine.
        expect(exit.from > 3.3 || exit.to <= 3.3 + 1e-9).toBe(true);
    });

    it('will not cut in an early rest the singer comes back from', () => {
        // The swallowed-vocal case, at the shape it was reported in: a long window, a real hole
        // near the front, and the voice still going at the back. Quietest wins the search and
        // quietest is the wrong question - taking that rest ends the outgoing vocal fourteen
        // seconds before anything is due to replace it.
        const vocals = withRest(24, 1, 5.35, 6.35, 1e-6);
        const exit = planVocalExit(vocals, flat(24, 1), 20.65, 16.65);
        expect(exit.from).toBeGreaterThanOrEqual(16.65);
    });

    it('rides a note that is still sounding at the deadline out to its release', () => {
        // The 14.4s blend the listener reported: a 10.60s note released at 13.45s, and a fade that
        // began at 0.83s - two seconds before the note it was fading had even started. Both other
        // branches end the voice inside the note; only its release is free.
        const exit = planVocalExit(heldTail(14.4, 2.85, 13.45), flat(14.4, 1), 8.03, 5.37);
        expect(exit.kind).toBe('release');
        expect(exit.from).toBeCloseTo(13.45, 2);
        expect(exit.to - exit.from).toBeCloseTo(0.5, 6);
    });

    it('does not ride a note that never lets go inside the window', () => {
        // No release means nothing to ride to, and riding anyway would hand the decision to the
        // moment the deck stops rather than to the music. The ordinary deadline stands.
        const exit = planVocalExit(heldTail(14.4, 2.85, 14.4), flat(14.4, 1), 8.03, 5.37);
        expect(exit.kind).not.toBe('release');
        expect(exit.to).toBeCloseTo(8.03, 6);
    });

    it('does not ride a note the voice only takes up after it was due to leave', () => {
        // `findSustain` reports the LAST hold in the window, which is not always the one the exit
        // collides with. This note starts after the deadline: the voice is already gone, and
        // bringing it back to sing over the incoming one is the defect, not the fix.
        const exit = planVocalExit(heldTail(8.64, 5.5, 7.0), flat(8.64, 1), 5.11, 2.61);
        expect(exit.kind).not.toBe('release');
    });

    it('rides a note that releases just before the window closes', () => {
        // The same transition as above with the window it actually got - 13.62s, not 14.4s - and
        // this is the shape the bound was written blind to. The window is PLACED against where the
        // outgoing track stops singing, so its last held note ends near its end by construction:
        // here the singer lets go at 13.45s with 0.15s of window behind her. Asking for a full
        // half-second cut plus a guard after that refused the ride on the commonest case there is
        // and fell back to a recede beginning at 5.37s, which is the report of a voice leaving one
        // to two seconds early. The cut is clamped to the window instead.
        const exit = planVocalExit(heldTail(13.62, 2.85, 13.45), flat(13.62, 1), 8.03, 5.37);
        expect(exit.kind).toBe('release');
        expect(exit.from).toBeCloseTo(13.45, 2);
        expect(exit.to).toBeLessThanOrEqual(13.6 + 1e-9);
        expect(exit.to).toBeGreaterThan(exit.from);
    });

    it('does not ride a note out over a track in a clashing key', () => {
        // A held vowel is a sustained PITCH, and this is the one gesture that leaves a bare
        // interval hanging in front of the listener for seconds. A semitone or a tritone against
        // the incoming harmony beats, and no fader shape hides it - so the ride is the one place
        // the key has to be able to say no. Evidence AGAINST only: an unknown key still rides.
        const held = heldTail(14.4, 2.85, 13.45);
        expect(planVocalExit(held, flat(14.4, 1), 8.03, 5.37, CELL_SEC, false).kind)
            .not.toBe('release');
        expect(planVocalExit(held, flat(14.4, 1), 8.03, 5.37, CELL_SEC, true).kind)
            .toBe('release');
    });

    it('takes the last painless rest, not the deepest one', () => {
        // Two real holes in range, the earlier one deeper. Both are under the threshold, so both
        // are equally invisible AS AN EDIT - what separates them is the line sung in between, and
        // choosing the deeper one deletes it. That is the 吞了一句歌词 report.
        const vocals = withRest(withRest(12, 1, 2.0, 3.2, 1e-9), 1, 6.0, 7.2, 1e-4);
        const exit = planVocalExit(vocals, flat(12, 1), 9);
        expect(exit.kind).toBe('rest');
        expect(exit.from).toBeGreaterThanOrEqual(6.0 - 1e-9);
    });

    it('still finds the rest when the singer does not come back', () => {
        // The other half of the same bound: a voice that genuinely finishes early leaves every
        // later half-second at least as quiet, so nothing is given up by starting the search late.
        const vocals = withRest(24, 1, 5.35, 24, 1e-6);
        const exit = planVocalExit(vocals, flat(24, 1), 20.65, 16.65);
        expect(exit.kind).toBe('rest');
        expect(exit.loudDb).toBeLessThanOrEqual(REST_DB);
    });
});

describe('planStemHandover', () => {
    const bars = [0.5, 2.5, 4.5, 6.5];

    it('puts the drum swap on a bar line when one is in reach', () => {
        const plan = planStemHandover(8, 2, 2, bars, flat(8, 1), flat(8, 1));
        expect(bars).toContain(plan.swap);
        // The 42% target is 3.36s, and 2.5 is 0.86 from it against 4.5's 1.14.
        expect(plan.swap).toBe(2.5);
    });

    it('hands the bass over a bar after the drums, never at the same moment', () => {
        const plan = planStemHandover(8, 2, 2, bars, flat(8, 1), flat(8, 1));
        expect(plan.bassAt - plan.swap).toBeCloseTo(2, 6);
    });

    it('does not leave a long blend trailing behind its own handover', () => {
        // The 16.64s blend from a real session, at 115 BPM - a 2.08s bar. On the plain 42% target
        // the drums swapped at 6.99s and the bass at 9.07s, leaving 7.57s in which the outgoing
        // track had already given up its drums, its bass and its voice and was only residue. Every
        // blend in that session that sounded right left at most 1.1 bars behind the handover.
        const bar = 2.08;
        const windowSec = 16.64;
        const downbeats = Array.from({ length: 8 }, (_, index) => 0.4 + index * bar);
        const plan = planStemHandover(windowSec, bar, bar, downbeats, flat(windowSec, 1), flat(windowSec, 1));

        expect(windowSec - plan.bassAt).toBeLessThanOrEqual(2 * bar + 1e-9);
        // Moved LATER, not shortened: the extra length is spent before the handover, not after it.
        expect(plan.swap).toBeGreaterThan(0.42 * windowSec);
        expect(plan.bassAt - plan.swap).toBeCloseTo(bar, 6);
    });

    it('does not leave a long blend with neither track singing', () => {
        // The 23.52s blend the listener reported as swallowing both vocals, rebuilt from its own
        // log line: a 2s bar, the drum swap on the downbeat at 18.23s, the incoming voice due at
        // 20.15s - and a real -35dB rest at 5.35s that the outgoing singer came back from.
        //
        // The assertion is on the GAP rather than on where the cut went, because the gap is what
        // was audible. Two songs playing at once with neither one singing for fourteen seconds is
        // not heard as a misplaced edit; it is heard as both tracks being swallowed.
        const windowSec = 23.52;
        const downbeats = Array.from({ length: 12 }, (_, index) => 0.23 + index * 2);
        const vocals = withRest(windowSec, 1, 5.35, 6.35, 1e-6);
        const plan = planStemHandover(windowSec, 2, 1.92, downbeats, vocals, flat(windowSec, 1));

        expect(plan.swap).toBeCloseTo(18.23, 6);
        expect(plan.vocalIn - plan.exit.to).toBeLessThanOrEqual(0);
    });

    it('leaves a blend short enough to already land late exactly where it was', () => {
        // The bound is a `max` against the fraction, so it has to be inert here - 8s at a 2s bar
        // leaves 8 - 3 x 2 = 2s, well before the 42% target of 3.36s.
        const plan = planStemHandover(8, 2, 2, bars, flat(8, 1), flat(8, 1));
        expect(plan.swap).toBe(2.5);
    });

    it('still places a handover when the track has no bar lines at all', () => {
        // An unanalysed track must not lose the gesture; it loses only the placement.
        const plan = planStemHandover(8, null, null, [], flat(8, 1), flat(8, 1));
        expect(plan.swap).toBeCloseTo(0.42 * 8, 6);
        expect(plan.bassAt).toBeGreaterThan(plan.swap);
    });

    // `flat` has no rest anywhere, so the exit is always a recede - which is the arm under test.
    it('starts a recede near the beat change, never at the top of the window', () => {
        const plan = planStemHandover(8, 2, 2, bars, flat(8, 1), flat(8, 1));

        expect(plan.exit.kind).toBe('recede');
        // The original property, and it still holds: beginning at the FLOOR faded the voice out
        // against nothing - measured on a real window, it reached -38 dB before the incoming voice
        // had even entered, so the two songs never overlapped at all.
        expect(plan.exit.from).toBeGreaterThan(0.05);
        expect(plan.exit.to).toBeGreaterThan(plan.vocalIn);
        // `swap` is now a ceiling on the start rather than the start itself. It answers when the
        // fall may BEGIN; it never answered how fast the fall is, and on this window anchoring to
        // it alone left the voice 2.5s to get out in - see RECEDE_BARS.
        expect(plan.exit.from).toBeLessThanOrEqual(plan.swap + 1e-6);
    });

    it('never squeezes a recede down into a cut', () => {
        // A long bar in a short window drags `swap` up against the deadline; past that point the
        // fade would be shorter than the half second a cut takes, in a place already judged too
        // loud to cut in.
        const plan = planStemHandover(3, 8, 8, [], flat(3, 1), flat(3, 1));
        expect(plan.exit.to - plan.exit.from).toBeGreaterThanOrEqual(1);
    });

    // Rare by nature - most rests the search finds are at the separation's noise floor - and the
    // whole "it left too fast on a few songs" complaint lives in the marginal ones.
    it('cuts faster the quieter the rest is, so a marginal one is not taken mid-breath', () => {
        const deep = planVocalExit(withRest(8, 1, 3, 4, 1e-6), flat(8, 1), 6);
        // ~-32 dB against the mix: past the threshold, but only just.
        const marginal = planVocalExit(withRest(8, 1, 3, 4, 0.025), flat(8, 1), 6);

        expect(deep.kind).toBe('rest');
        expect(marginal.kind).toBe('rest');
        expect(deep.to - deep.from).toBeCloseTo(0.5, 6);
        expect(marginal.to - marginal.from).toBeGreaterThan(deep.to - deep.from);
    });

    it('keeps every move inside the window', () => {
        // A long bar against a short window used to push the bass swap past the end, where its
        // curve would never run and the bass would simply never change hands.
        const plan = planStemHandover(3, 8, 8, [], flat(3, 1), flat(3, 1));
        for (const at of [plan.swap, plan.bassAt, plan.vocalIn, plan.exit.to]) {
            expect(at).toBeLessThanOrEqual(3);
            expect(at).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('rise / fall', () => {
    it('keeps the harness shape, which dips slightly rather than holding constant power', () => {
        // Pinned deliberately. `fall` is cos(rise * pi/2), not sqrt(1 - rise^2), so the pair loses
        // 1.6dB of power at its midpoint. That is the shape eight listening rounds were scored
        // from, and the crossings it is used for are six milliseconds long. A future reader who
        // "corrects" this to equal power is changing the gesture, not fixing it - this test is here
        // to make that a deliberate act rather than a tidy-up.
        const power = [0.25, 0.5, 0.75].map(at => rise(0, 1, at) ** 2 + fall(0, 1, at) ** 2);
        // 10log10, not 20: these are already powers, not amplitudes.
        expect(10 * Math.log10(Math.min(...power))).toBeCloseTo(-1.57, 1);
    });

    it('are flat outside their own span', () => {
        expect(rise(2, 3, 1)).toBe(0);
        expect(rise(2, 3, 9)).toBe(1);
        expect(fall(2, 3, 1)).toBe(1);
        expect(fall(2, 3, 9)).toBeCloseTo(0, 12);
    });
});

describe('the curves a window is scheduled from', () => {
    const plan = planStemHandover(8, 2, 2, [0.5, 2.5, 4.5, 6.5], flat(8, 1), flat(8, 1));

    it('starts every outgoing stem at unity', () => {
        // THE changeover invariant. At the top of the window the deck crossfades from its media
        // element to these four buffers over eight milliseconds, and the four sum back to the mix
        // exactly - `other` is derived by subtraction for precisely that reason. If any curve
        // started anywhere but 1 the handover would be a level step on that stem, every time.
        for (const curve of Object.values(outgoingCurves(8, plan))) {
            expect(curve[0]).toBeCloseTo(1, 6);
        }
    });

    it('ends every outgoing stem at silence', () => {
        // The other end of the same invariant: the outgoing deck is stopped when the window ends,
        // and a stem still sounding at that moment is cut off rather than faded.
        for (const curve of Object.values(outgoingCurves(8, plan))) {
            expect(curve[curve.length - 1]).toBeCloseTo(0, 3);
        }
    });

    it('ends every incoming stem at unity, so the element can take the track back', () => {
        for (const curve of Object.values(incomingCurves(8, plan))) {
            expect(curve[curve.length - 1]).toBeCloseTo(1, 6);
        }
    });

    it('brings the incoming pad in before its own drums', () => {
        // Round ten's clearest single result: the one entry made to crash in with drums scored 3.0
        // against 7.0 for arriving quietly. The pad has to be established before the beat changes.
        const curves = incomingCurves(8, plan);
        const cell = (curve: Float32Array, at: number) =>
            curve[Math.round((at / 8) * (curve.length - 1))];
        expect(cell(curves.other, plan.swap - 0.3)).toBeGreaterThan(0.2);
        expect(cell(curves.drums, plan.swap - 0.3)).toBeCloseTo(0, 6);
    });

    it('swaps the drums fast enough to read as an edit', () => {
        // Six milliseconds. A drum kit that fades over half a second is two drum kits for half a
        // second, which is the muddle the stem handover exists to avoid.
        const curves = outgoingCurves(8, plan);
        const cell = (at: number) => curves.drums[Math.round((at / 8) * (curves.drums.length - 1))];
        expect(cell(plan.swap - 0.05)).toBeGreaterThan(0.9);
        expect(cell(plan.swap + 0.05)).toBeLessThan(0.1);
    });
});

describe('lastVocalMoment', () => {
    // Everything here is measured against the mix's median, so the mix is held flat and the vocal
    // moves: a level is only "singing" relative to what it is sitting in.
    const mix = flat(10, 0.5);

    it('reports where the singing stopped, rounded up rather than down', () => {
        const vocals = withRest(10, 0.3, 5, 10, 0.0001);
        // 5.0s where the voice was last above the floor, plus the tail the note decays over. The
        // direction is the assertion: a value under 5 would be a handover placed inside a singer.
        expect(lastVocalMoment(vocals, mix)).toBeCloseTo(5.3, 6);
    });

    it('returns null when nothing sings in the window', () => {
        expect(lastVocalMoment(flat(10, 0.0001), mix)).toBeNull();
    });

    it('ignores a leaked transient after the singing has stopped', () => {
        // Two cells of a cymbal that htdemucs put in the vocal row. Loud, and not a syllable.
        const vocals = withRest(10, 0.3, 5, 10, 0.0001);
        vocals[Math.round(8 / CELL_SEC)] = 0.9;
        vocals[Math.round(8 / CELL_SEC) + 1] = 0.9;
        expect(lastVocalMoment(vocals, mix)).toBeCloseTo(5.3, 6);
    });

    it('runs past the end of the window when the track sings to its last second', () => {
        // Deliberately past `10`: the caller clamps against the track, and a value that stopped at
        // the window edge would be indistinguishable from one that ended exactly there.
        expect(lastVocalMoment(flat(10, 0.3), mix)).toBeCloseTo(10.3, 6);
    });
});

describe('singsInWindow', () => {
    // The reference is the whole separated head, not the window being searched - a quiet intro
    // drags a window-local median down until the separation's own leakage clears the floor.
    const mix = flat(10, 0.5);

    it('finds a voice when the incoming track sings inside the window', () => {
        expect(singsInWindow(withRest(10, 0.0001, 4, 10, 0.3), mix)).toBe(true);
    });

    it('reports no voice when the incoming track does not sing inside the window', () => {
        // The half of this that is load-bearing, and the only half. An ordinary answer for a long
        // intro rather than a failure: it is what lets a window nobody is waiting for stay the
        // outgoing track's own ending.
        expect(singsInWindow(flat(10, 0.0001), mix)).toBe(false);
    });

    it('does not call two cells of leakage a voice', () => {
        // A hi-hat htdemucs filed under vocals, in a window with no singing in it at all. Taking
        // it would put a deadline on the outgoing voice on behalf of a singer who is not there.
        const vocals = flat(10, 0.0001);
        vocals[Math.round(2 / CELL_SEC)] = 0.9;
        vocals[Math.round(2 / CELL_SEC) + 1] = 0.9;
        expect(singsInWindow(vocals, mix)).toBe(false);
    });
});

describe('planStemHandover incoming voice', () => {
    const loud = (seconds: number) => flat(seconds, 0.5);

    it('holds the incoming voice back to meet a note being ridden out', () => {
        // The transition this was reported from, at its real numbers: a 10.6s note released at
        // 13.45s in a 14.22s window, with the choreography putting the incoming voice at 7.53s.
        // The ride reverses the last two steps of the handover - the outgoing voice now leaves
        // after the incoming one arrives - and six and a half seconds of two lead vocals is what
        // the listener heard as the next track coming in two to three seconds early.
        const plan = planStemHandover(
            14.22, 3.60, 2.16, [5.37], heldTail(14.22, 2.85, 13.45), loud(14.22),
        );
        expect(plan.exit.kind).toBe('release');
        expect(plan.vocalIn).toBeCloseTo(plan.exit.from - 2.16, 6);
        // One incoming bar of overlap plus the cut, not six and a half seconds of it.
        expect(plan.exit.to - plan.vocalIn).toBeLessThan(3);
    });

    it('never pulls the entry earlier than the choreography', () => {
        // `max`, and it is what makes this shippable without a listening round: across one full
        // session the four other rides sat at 1.3-2.3s of overlap and went unremarked, and every
        // one of them has its release close enough to the entry that a naive assignment would move
        // it EARLIER. Written this way the rule is inert on all four.
        const plan = planStemHandover(
            12, 2, 2, [], heldTail(12, 2, 8.6), loud(12),
        );
        expect(plan.exit.kind).toBe('release');
        expect(plan.vocalIn).toBeCloseTo(plan.swap + 2, 6);
    });

    it('leaves a blend with no held note on the choreography', () => {
        expect(planStemHandover(12, 2, 2, [], loud(12), loud(12)).vocalIn).toBeCloseTo(8, 6);
    });

    it('imposes no deadline when the incoming track does not sing in this window', () => {
        // A blend that fits entirely inside the next track's intro. The deadline exists to stop
        // two lead vocals stacking, so with only one voice in the room it is not a constraint that
        // has been relaxed - it is one that never applied. What it used to do was fade the outgoing
        // singer out from the handover to make room for nobody, which is the 压音 report.
        const plan = planStemHandover(12, 2, 2, [], loud(12), loud(12), { sings: false });
        expect(plan.exit.kind).toBe('recede');
        // The shortest honest release, landing on the window's own last sample - not a
        // four-second fade from the swap, and not stopping 0.4s short of the end either. Both of
        // those bounds are statements about a handover, and there is no handover here.
        expect(plan.exit.to).toBeCloseTo(12, 6);
        expect(plan.exit.from).toBeCloseTo(11.5, 6);
        expect(plan.exit.from).toBeGreaterThan(plan.swap);
    });

    it('keeps the deadline whenever the incoming track might sing', () => {
        // Absent means "assume it does", which is every window that existed before this did.
        const guard = planStemHandover(12, 2, 2, [], loud(12), loud(12));
        expect(planStemHandover(12, 2, 2, [], loud(12), loud(12), { sings: true }).exit.from)
            .toBeCloseTo(guard.exit.from, 6);
        expect(guard.exit.from).toBeCloseTo(guard.swap, 6);
    });

    it('passes a clashing key down to the exit rather than dropping it on the floor', () => {
        // The wiring, not the rule: `keysClash` is inverted on its way into `planVocalExit`, and an
        // inversion that went the wrong way would be silent and total - every clash would ride and
        // nothing else ever would.
        const held = heldTail(12, 2, 11.5);
        const ride = (keysClash: boolean) =>
            planStemHandover(12, 2, 2, [], held, loud(12), { keysClash }).exit.kind;
        expect(ride(false)).toBe('release');
        expect(ride(true)).not.toBe('release');
    });
});

describe('planStemHandover recede length', () => {
    // Loud throughout, so the exit search finds nowhere to cut and the recede branch is the one
    // under test.
    const loud = (seconds: number) => flat(seconds, 0.5);

    it('keeps the voice audible until the incoming one arrives', () => {
        // The property a two-bar floor on the fade was added to buy, and took away instead.
        // `fall` crosses -18dB - under the mix it sits in, gone - at 74.3% of whatever span it is
        // given, and the span's END is pinned at `hardEnd`. So stretching the start backwards moves
        // the moment the voice DISAPPEARS earlier, which is the complaint, not the cure.
        const plan = planStemHandover(12, 2, 2, [], loud(12), loud(12));
        expect(plan.exit.kind).toBe('recede');

        const audibleUntil = plan.exit.from + 0.743 * (plan.exit.to - plan.exit.from);
        expect(audibleUntil).toBeGreaterThanOrEqual(plan.vocalIn - 0.25);
    });

    it('never moves the start later than the swap, so windows that were long enough are untouched', () => {
        // A slow incoming bar already leaves the recede more than two of the outgoing track's, so
        // the floor must not fire: this is the `min` that keeps every blend that already worked.
        const plan = planStemHandover(20, 1, 3, [], loud(20), loud(20));
        expect(plan.exit.from).toBeCloseTo(plan.swap, 6);
    });
});

describe('findSustain', () => {
    const mix = flat(10, 0.5);
    // A held note: level, then a release. `withRest` builds the silence after it.
    const heldNote = (from: number, to: number, level = 0.4) => {
        const out = flat(10, 0.0001);
        for (let c = Math.round(from / CELL_SEC); c < Math.round(to / CELL_SEC); c += 1) out[c] = level;
        return out;
    };

    it('finds a held note and reports where it lets go', () => {
        const held = findSustain(heldNote(2, 6), mix);
        expect(held?.from).toBeCloseTo(2, 6);
        expect(held?.to).toBeCloseTo(6, 6);
    });

    it('ignores a sung phrase, which is what the rest search is already for', () => {
        // Four syllables with gaps. Nothing here is held, and calling it held would put the
        // sustain branch on top of every ordinary vocal line in the library.
        const phrase = flat(10, 0.0001);
        for (const at of [1, 2, 3, 4]) {
            for (let c = Math.round(at / CELL_SEC); c < Math.round((at + 0.4) / CELL_SEC); c += 1) {
                phrase[c] = 0.4;
            }
        }
        expect(findSustain(phrase, mix)).toBeNull();
    });

    it('keeps a note that swells as one note', () => {
        // Rising through the hold. Tracking the run's own peak rather than its first cell is what
        // stops a crescendo from reading as a new note every cell.
        const swell = flat(10, 0.0001);
        const first = Math.round(2 / CELL_SEC);
        const last = Math.round(6 / CELL_SEC);
        for (let c = first; c < last; c += 1) swell[c] = 0.2 + 0.2 * ((c - first) / (last - first));
        const held = findSustain(swell, mix);
        expect(held?.to).toBeCloseTo(6, 6);
    });

    it('closes a note that is still ringing when the window ends', () => {
        // The case the whole thing exists for, and the one an early return would drop: there is no
        // release inside the window, so there is no free moment to leave on.
        const held = findSustain(heldNote(4, 10), mix);
        expect(held?.to).toBeCloseTo(10, 6);
    });

    it('reports the last note, not the first', () => {
        const two = flat(10, 0.0001);
        for (let c = Math.round(1 / CELL_SEC); c < Math.round(3 / CELL_SEC); c += 1) two[c] = 0.4;
        for (let c = Math.round(5 / CELL_SEC); c < Math.round(8 / CELL_SEC); c += 1) two[c] = 0.4;
        expect(findSustain(two, mix)?.from).toBeCloseTo(5, 6);
    });
});
