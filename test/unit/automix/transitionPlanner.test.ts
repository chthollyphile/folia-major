import { describe, expect, it } from 'vitest';
import type { Line } from '../../../src/types';
import { isInterludeLine, parseLRC } from '../../../src/utils/lyrics/parserCore';
import {
    AUTOMIX_DEFAULT_OVERLAP_SEC,
    AUTOMIX_MAX_OVERLAP_SEC,
    AUTOMIX_MIN_OVERLAP_SEC,
    planTransition,
    resolveOverlap,
    type TransitionTrack,
} from '../../../src/services/automix/transitionPlanner';
import { BEAT_CUT_SEC, shapeBlend } from '../../../src/services/automix/transitionChooser';
import { BEATS_PER_PHRASE } from '../../../src/services/automix/musicalTime';
import { makeProfile } from './trackProfileFixture';

const line = (startTime: number, endTime: number, fullText = 'la'): Line => ({
    words: [], startTime, endTime, fullText,
});

/**
 * The two ends come from two different places now, and the signature says so.
 *
 * `lines` decides the OUTGOING side - where the singing stopped. `intro` decides the INCOMING
 * side and is measured off the audio, so it arrives on the profile: omit it for a track that was
 * never analysed, pass null for one that was analysed but yielded no boundary.
 */
const track = (duration: number, lines: Line[] | null, intro?: number | null): TransitionTrack => ({
    duration,
    lines,
    profile: intro === undefined ? null : makeProfile({ sectionStart: intro }),
});

describe('planTransition', () => {
    it('aligns the entry on the beat grid, not on a bar line it cannot find', () => {
        // Both tracks are 120, so their beats coincide only if the entry is placed on one. The
        // profile has no downbeat at all, which is a third of a real library - and used to mean no
        // alignment whatsoever, leaving the incoming track at a random fraction of a beat.
        const grid = { bpm: 120, beatOffset: 0, downbeatOffset: null, headDownbeatOffset: null };
        const plan = planTransition(
            { duration: 100, lines: [line(10, 94)], profile: makeProfile(grid) },
            // 1.3s of leading silence, so the entry floor is 1.2 - deliberately not on a beat of a
            // 0.5s grid, which is what makes this test able to fail.
            {
                duration: 100,
                lines: null,
                profile: makeProfile({ ...grid, leadIn: 1.3, sectionStart: 4 }),
            },
            120,
        );
        expect(plan.kind).toBe('fade');
        // Locked means the two media clocks differ by a whole number of beats, which is exactly the
        // condition for every beat of one to land on a beat of the other.
        const apart = Math.abs(plan.inStart - plan.outStart) % 0.5;
        expect(Math.min(apart, 0.5 - apart)).toBeLessThan(0.011);
        // And on the BEAT grid, so the walk is at most one beat. On the bar grid it was up to four,
        // deleting up to 1.84s of the incoming track's opening to reach a line chosen by a vote
        // that measures at chance.
        expect(plan.inStart).toBeGreaterThanOrEqual(1.2);
        expect(plan.inStart).toBeLessThan(1.2 + 0.5);
    });

    it('lets the next track sing over an outro that has stopped singing', () => {
        // The two windows are proxies for ONE requirement - never two vocal lines at once - and
        // holding both as ceilings asked for a different, stricter thing: no voice inside the blend
        // at all. Once the overlap fits in the outgoing instrumental outro that side is silent for
        // its whole length, and a lone incoming vocal over a departing instrumental is the move,
        // not a collision.
        //
        // outro = 100 - 94 = 6s, intro = 4s. The outro alone bounds it; the 4s intro does not.
        const plan = planTransition(track(100, [line(10, 94)]), track(100, null, 4));
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBeGreaterThan(4);
        expect(plan.overlap).toBeLessThanOrEqual(6);
        expect(plan.inStart).toBe(0);
        // And it is not silent about having done so.
        expect(plan.reason).toContain('sings over the outgoing instrumental');
    });

    it('still holds the blend inside the intro when the outro cannot vouch for itself', () => {
        // The release above is earned by `tailRoom` binding. Without it there is nothing saying the
        // outgoing track has stopped singing, so the incoming window is the only thing standing
        // between the plan and two stacked vocals - and it has to keep binding.
        //
        // No lyrics for the outgoing track: the ordinary state of an instrumental, and of the log
        // line that reads `no lyrics for the outgoing track`.
        const blind = planTransition(track(100, null), track(100, null, 4));
        expect(blind.overlap).toBeLessThanOrEqual(4);
        expect(blind.reason).not.toContain('sings over the outgoing instrumental');

        // Singing to within a second of the end: measured, and measured as no room at all.
        const toTheEnd = planTransition(track(100, [line(10, 99.5)]), track(100, null, 4));
        expect(toTheEnd.overlap).toBeLessThanOrEqual(4);
    });

    it('gives a long instrumental outro to the blend instead of to the intro', () => {
        // The case as heard. A 34.42s instrumental outro into a track whose first section began
        // 2.92s in: the pair wanted 11.88s and the log said `capped by what the pair has room for
        // (2.92s)`, so the blend came out at 2.04s. Half a minute of nobody singing, and the blend
        // was refused all of it.
        const plan = planTransition(
            { duration: 200, lines: [line(10, 160)], profile: makeProfile({ duration: 200 }) },
            track(200, null, 2.92),
            120,
        );
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBeGreaterThan(8);
    });

    it('never starts the blend before the outgoing track has stopped singing', () => {
        // The floor that `anchor` claims to have and did not: it is written `Math.min(latest,
        // max(body, lastSung))`, so a long enough overlap drags `latest` in front of the last sung
        // line and the min quietly hands it back. The only thing holding it there was the ceiling,
        // and the ceiling took `min(tail, intro)` - which is NULL as soon as either side is
        // unmeasured. So an outgoing track with a known ten-second instrumental outro was blended
        // across its own last chorus whenever the incoming track had not been analysed yet.
        //
        // No profile on the incoming track, which is the ordinary state of the very first
        // transition after a cold start.
        const plan = planTransition(track(200, [line(10, 190)]), track(200, null), 120);
        expect(plan.kind).toBe('fade');
        expect(plan.outStart).toBeGreaterThanOrEqual(190);
    });

    it('does not stretch a blend just because the gap is generous', () => {
        // A 30s outro into a 30s intro is room, not an instruction. Spending it produced the
        // eight-second crossfade that reads as "the app is just fading" - the length comes from
        // the default, and the window is only ever allowed to shorten it.
        const plan = planTransition(track(100, [line(10, 70)]), track(100, null, 30));
        expect(plan.overlap).toBe(AUTOMIX_DEFAULT_OVERLAP_SEC);
        expect(plan.reason).not.toContain('capped by');
    });

    it('keeps a fast track to a musical length rather than the ceiling', () => {
        // The bug as heard: 185 BPM, a 26s outro into an 11s intro, and the blend took the whole
        // cap rather than a musical length. Eight bars of a fast track is short, and that is the
        // right answer - the window says where a handover MAY go, never how long one should be.
        const plan = planTransition(track(200, [line(10, 173.66)]), track(200, null, 11), 185);
        expect(plan.overlap).toBeCloseTo(BEATS_PER_PHRASE * 2 * 60 / 185, 2);
        expect(plan.overlap).toBeLessThan(AUTOMIX_MAX_OVERLAP_SEC);
    });

    it('still blends at the default length when the vocals leave no gap', () => {
        // Two songs that sing end to end. Placing the blend well is impossible here, but the
        // listener asked for blended song changes, so it blends anyway rather than quietly cutting.
        const plan = planTransition(track(100, [line(10, 99.8)]), track(100, null, 0.1));
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBe(AUTOMIX_DEFAULT_OVERLAP_SEC);
        expect(plan.reason).toContain('default');
    });

    it('blends two tracks off one album like any other pair', () => {
        // Album continuity used to veto this. The switch is the listener's answer to that question.
        const plan = planTransition(track(100, [line(10, 90)]), track(100, null, 10));
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBeGreaterThan(0);
    });

    it('takes the intro from the audio, so a credit block cannot report a zero-second one', () => {
        // Every online lyric source opens with a credit block and the three of them format it
        // three incompatible ways - QQ at 0/1/2s, Kugou spread evenly across the whole intro and
        // flush against the first sung line, NetEase all stacked on 0.000. Reading "the first
        // line" as "the first sung moment" gave an intro of zero on nearly every online track and
        // no timing rule can separate the three. The lyric file no longer gets asked.
        const creditBlock = [line(0, 1, '作词：someone'), line(1, 2, '作曲：someone'), line(9.81, 12, 'sung')];
        const plan = planTransition(track(100, [line(10, 80)]), track(100, creditBlock, 9.81));
        expect(plan.reason).toContain('intro 9.81s');
    });

    it('ignores blank interlude lines when locating the last sung moment', () => {
        // a trailing placeholder line must not read as singing, or the outro collapses to 5s
        const plan = planTransition(track(100, [line(10, 20), line(90, 95, '   ')]), track(100, null, 30));
        expect(plan.reason).toContain('outro 80s');
    });

    it('does not read the parser\'s own interlude placeholder as singing', () => {
        // Built through the real parser rather than by hand, and that matters: attachInterludes
        // inserts '......' lines the hand-built fixtures above have no idea about. Reading one as
        // a voice once vetoed every blend in the app while every unit test passed.
        const outgoing = parseLRC('[00:12.00]first sung line\n[00:20.00]last sung line');
        expect(isInterludeLine(outgoing.lines[0])).toBe(true);

        const plan = planTransition(track(100, outgoing.lines), track(100, null, 30));
        expect(plan.kind).toBe('fade');
        expect(plan.reason).toContain('outro 75s');
    });

    it('blends at the default length when a lyric timeline is missing', () => {
        // Local files, instrumentals, tracks whose lyrics failed to fetch: all still blend.
        const plan = planTransition(track(100, null), track(100, null, 10));
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBe(AUTOMIX_DEFAULT_OVERLAP_SEC);
        expect(plan.reason).toContain('no lyrics for the outgoing track');
    });

    it('separates a track nobody analysed from one with no voice in it', () => {
        // Both blend the same way; they are different answers to "why was there no window", and
        // one of them is a bug report waiting to happen while the other is an instrumental.
        expect(planTransition(track(100, [line(10, 90)]), track(100, null)).reason)
            .toContain('the incoming track was never analysed');
        expect(planTransition(track(100, [line(10, 90)]), track(100, null, null)).reason)
            .toContain('nothing measurable at the start of the incoming track');
    });

    it('says so when a lyric file exists but holds nothing sung', () => {
        // An instrumental interlude blends exactly like a track with no lyrics at all, but the two
        // mean different things when the question is why no vocal-free window could be proven.
        const plan = planTransition(track(100, [line(0, 4, '   ')]), track(100, null, 10));
        expect(plan.reason).toContain('nothing sung in the outgoing lyrics');
    });

    it('keeps the blend under a quarter of a very short track', () => {
        const plan = planTransition(track(12, null), track(100, null));
        expect(plan.kind).toBe('fade');
        expect(plan.overlap).toBe(3);
    });

    it('cuts only when the track is too short to fade across at all', () => {
        const plan = planTransition(track(2, null), track(100, null));
        expect(plan.kind).toBe('hardCut');
        expect(plan.reason).toContain('no room to fade');
    });

    it('measures the default blend in beats once a tempo is known', () => {
        // Five seconds is two bars of a ballad and nearly four of a fast track, so the same
        // number reads as leisurely on one song and frantic on the next. Eight bars does not.
        expect(planTransition(track(100, null), track(100, null), 90).overlap)
            .toBeCloseTo(BEATS_PER_PHRASE * 2 * 60 / 90, 2);
        expect(planTransition(track(100, null), track(100, null), 160).overlap)
            .toBeCloseTo(BEATS_PER_PHRASE * 2 * 60 / 160, 2);
    });

    it('trims a proven vocal-free window back to whole bars', () => {
        // A 3s gap is narrower than the phrase wanted, so it binds - and at 95 BPM it is four
        // beats and three quarters, so the blend takes the four rather than ending mid-pulse.
        const plan = planTransition(track(100, [line(10, 97)]), track(100, null, 3), 95);
        expect(plan.overlap).toBeCloseTo(4 * 60 / 95, 2);
        expect(plan.reason).toContain('capped by what the pair has room for');
    });

    it('never goes past the ceiling, however long the music would like to be', () => {
        // A phrase of a 30 BPM track is thirty-two seconds. The ceiling refuses it, and what comes
        // back is a shorter whole number of BARS rather than the ceiling itself - twenty-five
        // seconds is not a length any music has, and the point of counting in bars is lost if the
        // cap is allowed to be the answer.
        const overlap = planTransition(track(200, null), track(100, null), 30).overlap;
        expect(overlap).toBeLessThanOrEqual(AUTOMIX_MAX_OVERLAP_SEC);
        expect(overlap).toBeCloseTo(12 * 2, 2);
    });

    it('cuts when the outgoing duration is unknown', () => {
        expect(planTransition(track(NaN, [line(10, 90)]), track(100, [line(10, 90)])).kind).toBe('hardCut');
    });

    it('plans against the room still ahead of the playhead, not the whole tail', () => {
        // Nothing calls this on a schedule: a blend in flight blocks it for its own whole length,
        // and a duration that has not arrived blocks it too. So the FIRST look at a track can land
        // well after the point its own handover was due, and a length chosen from the whole tail
        // is then partly behind the playhead. Execution clamps it to what is left, and the blend
        // comes out short having been shaped for a length it never had - which is what the log
        // reported as "the next deck took more than its 1s of lead to start".
        //
        // 120 BPM over 100s: a phrase-and-a-half is 16s and the tail is wide open, so the
        // unbounded answer is a 16s blend starting at 84 - eight seconds into the past.
        const late = planTransition(track(100, null), track(100, null), 120, 90);
        expect(late.kind).toBe('fade');
        expect(late.outStart).toBeGreaterThanOrEqual(90);
        expect(late.outStart + late.overlap).toBeLessThanOrEqual(100 + 1e-6);
        // Still a whole number of beats, rather than the ten seconds that happen to be left.
        expect(late.overlap).toBe(8);
    });

    it('cuts rather than blends when the handover point is already behind the playhead', () => {
        const plan = planTransition(track(100, null), track(100, null), 120, 99.5);
        expect(plan.kind).toBe('hardCut');
    });
});

describe('resolveOverlap', () => {
    const fadePlan = planTransition(track(100, [line(10, 94)]), track(100, null, 6));

    it('keeps the planned overlap when the track still has the room', () => {
        expect(fadePlan.overlap).toBe(5);
        expect(resolveOverlap(fadePlan, 10)).toBe(5);
    });

    it('shrinks to the time actually left when the incoming track was slow to load', () => {
        expect(resolveOverlap(fadePlan, 3.5)).toBe(3.5);
    });

    it('gives up rather than fading over a window that no longer exists', () => {
        expect(resolveOverlap(fadePlan, 0.4)).toBe(0);
    });

    it('never blends for a plan that was not a blend', () => {
        const cut = planTransition(track(NaN, [line(10, 90)]), track(100, [line(10, 90)]));
        expect(cut.kind).toBe('hardCut');
        expect(resolveOverlap(cut, 30)).toBe(0);
    });

    it('treats an unreadable remaining time as no room at all', () => {
        expect(resolveOverlap(fadePlan, NaN)).toBe(0);
    });
});

/**
 * A blend is aimed at where the MUSIC stops, not where the file does.
 *
 * Every one of these is the same invariant stated on a different path: `outStart + overlap` lands
 * on the last sounding moment. The number that used to sit there was the media duration, which on
 * a padded master is seconds of digital silence later - so the blend was scheduled into the
 * silence, and a listening session's worth of song changes handed over with the outgoing deck
 * below -40 dBFS. Not a quiet transition: the song had already finished.
 */
describe('a blend aims at where the music stops', () => {
    const padded = (leadOut: number, lines: Line[] | null = null): TransitionTrack => ({
        duration: 100,
        lines,
        profile: makeProfile({ duration: 100, leadOut }),
    });

    it('starts the handover before the trailing silence rather than inside it', () => {
        const plan = planTransition(padded(5), track(100, null, 10), 120);
        expect(plan.outStart + plan.overlap).toBeCloseTo(95, 6);
        expect(plan.reason).toContain('skipped 5s of silence at the end');
    });

    it('does not count the silence as instrumental outro', () => {
        // Singing stops at 92 on a file whose last five seconds are empty: three seconds of music
        // to place a blend in, not eight. The longer number is somewhere with nothing in it.
        expect(planTransition(padded(5, [line(10, 92)]), track(100, null, 10), 120).reason)
            .toContain('outro 3s');
    });

    it('leaves a gap too long to be a tail where it is', () => {
        // Half a minute of silence is not how a song ends, it is what comes before a hidden track,
        // and aiming the handover in front of it would delete whatever follows.
        const plan = planTransition(padded(30), track(100, null, 10), 120);
        expect(plan.outStart + plan.overlap).toBeCloseTo(90, 6);
    });

    it('aims at the file end while only the head has been analysed', () => {
        // The tail of an uncached track is not downloadable, so leadOut stays null until the track
        // has been played out once. Null is not zero, and the file's end is all there is to aim at.
        const head: TransitionTrack = {
            duration: 100,
            lines: null,
            profile: makeProfile({ partial: true, leadOut: null, endsHot: null, outroSlope: null }),
        };
        const plan = planTransition(head, track(100, null, 10), 120);
        expect(plan.outStart + plan.overlap).toBeCloseTo(100, 6);
        expect(plan.reason).not.toContain('silence at the end');
    });

    it('starts the blend at the top of a fade-out rather than inside it', () => {
        // Trimming the silence alone still left three song changes out of five handing over at -23
        // to -26 dBFS, because the silence floor sits about thirty dB under the music: a blend
        // flush against it runs its whole length in the decay. Starting at the top of the decay
        // instead means the outgoing track is still carrying the song when the handover begins,
        // and the fade then plays out underneath the incoming one.
        const from: TransitionTrack = {
            duration: 100,
            // No lyrics, which is what makes this a test of the decay and nothing else: `anchor`
            // reads `min(latest, max(body, lastSung, at))`, so a sung line in here would be a
            // second thing setting the floor and the assertion could no longer say which one did.
            // It also keeps the blend short - an unmeasured outro is what the incoming window is
            // still allowed to bound - and a short blend is the only case the ride exists for. A
            // long one already begins in front of the decay, which is the same goal by other means.
            lines: null,
            profile: makeProfile({ duration: 100, leadOut: 1, bodyOut: 8 }),
        };
        const plan = planTransition(from, track(100, null, 6), 120);
        expect(plan.outStart).toBeCloseTo(92, 6);
        expect(plan.reason).toContain('to ride the fade-out');
    });

    // The requirement is that two VOICES never stack, and for a long time the code enforced a
    // proxy for it instead: the blend may not start before the outgoing track stops singing, full
    // stop. That is strictly stronger, and the difference is audible - it is what makes a
    // transition wait for the last song to finish and then hurry, because a track whose last line
    // ends two seconds before the file does had a two-second blend and nothing could lengthen it.
    //
    // These two pin the requirement itself, from both sides.
    it('blends back over the outgoing singing when the next track is provably silent', () => {
        const from: TransitionTrack = {
            duration: 100,
            lines: [line(10, 94)],
            profile: makeProfile({ duration: 100, leadOut: 0, bodyOut: 9 }),
        };
        // Six seconds of outro against a ten-second intro. The old rule took the smaller and gave
        // a six-second blend flush against 94s; the intro is what can actually vouch here.
        const plan = planTransition(from, track(100, null, 10), 120);

        expect(plan.outStart).toBeCloseTo(92, 6);
        // The assertion that matters, and the reason the one above is allowed to be 92: the whole
        // blend is over before the incoming track sings a note, so the outgoing voice inside it is
        // the ONLY voice inside it.
        expect(plan.inStart + plan.overlap).toBeLessThanOrEqual(10);
        expect(plan.reason).toContain('the outgoing track sings over');
    });

    it('never moves the blend back over the singing when neither track can vouch', () => {
        // Same outgoing track, but now the next one opens singing almost immediately. Nothing can
        // cover a longer blend, so the outgoing vocal is back to being the floor - which is the
        // case the old rule was right about, and it still holds.
        const from: TransitionTrack = {
            duration: 100,
            lines: [line(10, 94)],
            profile: makeProfile({ duration: 100, leadOut: 0, bodyOut: 9 }),
        };
        const plan = planTransition(from, track(100, null, 1), 120);

        expect(plan.outStart).toBeGreaterThanOrEqual(94);
        expect(plan.reason).not.toContain('BOTH tracks sing');
    });

    it('leaves a decay too long to be an ending where it is', () => {
        // A two-minute ambient outro is not how the song ends, it is the song. Riding all of it
        // would start the next track while this one still had a third of itself to play.
        const from: TransitionTrack = {
            // No lyrics, so the clamp is the only thing holding the anchor up. With a sung line at
            // 150s the vocal floor was doing that work and this assertion passed whether the clamp
            // fired or not - it could never have reached the eighty its own comment names.
            duration: 200,
            lines: null,
            profile: makeProfile({ duration: 200, leadOut: 0, bodyOut: 120 }),
        };
        // Ten seconds back from the end, which is where the clamp puts it - not eighty, which is
        // where a two-minute decay would put it if it were taken at its word.
        expect(planTransition(from, track(100, null, 6), 120).outStart).toBeCloseTo(190, 6);
    });

    it('places a cut before the silence too', () => {
        // A track that stops dead and is then padded is genuinely `endsHot` - the measurement runs
        // over the sounding part - so this is the cut path, which computes its own outStart.
        const from: TransitionTrack = {
            duration: 200,
            lines: null,
            profile: makeProfile({ endsHot: true, leadOut: 4 }),
        };
        const to: TransitionTrack = {
            duration: 200,
            lines: null,
            profile: makeProfile({ startsHot: true, leadIn: 0.8 }),
        };
        const plan = planTransition(from, to, 120);
        expect(plan.style).toBe('beatCut');
        expect(plan.outStart + plan.overlap).toBeCloseTo(196, 6);
    });
});

/**
 * The handoff between deciding a join and performing it.
 *
 * Both halves read correctly on their own and still disagreed between them: the planner asked for
 * a second and a half of room, and the shaper refuses to wait longer than the incoming track's own
 * leading silence, which on a commercial master is a fraction of that. So the planner asks for
 * what can actually be waited out, and these check the two ends still agree.
 */
describe('a join has to survive the step that performs it', () => {
    const runTogether = (leadIn: number) => ({
        from: {
            duration: 200,
            lines: null,
            profile: makeProfile({ endsHot: true }),
        },
        to: {
            duration: 200,
            lines: null,
            profile: makeProfile({ startsHot: true, leadIn }),
        },
    });

    /** What automixSession does at the instant the incoming deck starts. */
    const perform = (
        plan: ReturnType<typeof planTransition>,
        incomingLeadIn: number,
        grid: { nextBeatIn: number | null; periodSec: number | null } = { nextBeatIn: null, periodSec: null },
    ) => shapeBlend({
        style: plan.style,
        room: plan.overlap,
        overlap: plan.overlap,
        crossover: 0.5,
        ...grid,
        incomingLeadIn,
    });

    it('gives two tracks that run into each other something the listener can hear', () => {
        // These used to get a six-millisecond splice, on the grounds that the record already joins
        // them. It does - and a listener who switched blending on heard nothing happen, on two
        // thirds of the song changes of a continuous album. Every style left is an audible one.
        const { from, to } = runTogether(0.3);
        const plan = planTransition(from, to, 120);

        expect(plan.overlap).toBeGreaterThanOrEqual(AUTOMIX_MIN_OVERLAP_SEC);
        expect(perform(plan, 0.3).overlap).toBe(plan.overlap);
    });

    it('places a cut on a beat the incoming track can afford to wait for', () => {
        // 120 BPM is half a second a beat, and the wait comes out of the next track's own silence.
        const { from, to } = runTogether(0.8);
        const plan = planTransition(from, to, 120);
        expect(plan.style).toBe('beatCut');
        // Not CUT_LEAD_SEC: the room asked for is what the wait can actually be paid for.
        expect(plan.overlap).toBeLessThanOrEqual(0.85);

        const shaped = perform(plan, 0.8, { nextBeatIn: 0.2, periodSec: 0.5 });
        expect(shaped.style).toBe('beatCut');
        expect(shaped.hold).toBeCloseTo(0.7, 6);
        expect(shaped.overlap).toBe(BEAT_CUT_SEC);
    });
});

// The vocal windows are a CEILING again on a separated pair. The lift was tried and retracted: the
// gesture does hold the incoming vocal at absolute zero until `vocalIn`, but `vocalIn` is
// choreography - it scales with the window while the incoming singer does not - so removing the
// ceiling did not remove the collision, it inverted it into a muted incoming lead vocal. The
// argument, with its numbers, is at `singleVoiceRoom`.
describe('a separated pair is still bound by where the voices are', () => {
    // "I Will Always Love You" into "Past Lives", off a real log: a 25.7s blend capped to 3.6s by
    // the 4.56s where the incoming track's first section begins. That cap is the behaviour; the
    // round that removed it is what this block now guards against coming back.
    const wholeTail = { from: 243.5, to: 273.5 };
    const wholeHead = { from: 0, to: 30 };
    const ballad = (separated: { from: number; to: number } | null): TransitionTrack => ({
        duration: 273.5,
        lines: [line(10, 269.36)],
        profile: makeProfile({ duration: 273.5, leadOut: 5.02, bodyOut: 0, bpm: 65 }),
        vocalEnd: 268.66,
        separated,
    });
    const next = (separated: { from: number; to: number } | null): TransitionTrack => ({
        duration: 200,
        lines: null,
        profile: makeProfile({ sectionStart: 4.56, bpm: 76 }),
        separated,
    });

    it('plans a separated pair exactly as it plans an unseparated one', () => {
        const capped = planTransition(ballad(null), next(null), 65);
        const freed = planTransition(ballad(wholeTail), next(wholeHead), 65);

        expect(capped.overlap).toBeCloseTo(3.69, 2);
        expect(capped.reason).toContain('room for (4.56s)');
        expect(freed.overlap).toBeCloseTo(capped.overlap, 6);
        // Separation still changes what the log SAYS about the blend - the gesture is what will
        // actually move the two voices - it just no longer changes how long the blend is.
        expect(freed.reason).toContain('both voices held by the gesture');
    });

    // Dawn FM into Gasoline, off the log that reported the regression: the outgoing track sings to
    // its own last second, so only the incoming intro can vouch for anything, and it is 3.02s. With
    // the ceiling lifted this blend ran 15.36s and the gesture's choreography then held Gasoline's
    // own vocal stem at zero until 11.68s of it.
    it('still lets a short incoming intro cap a separated pair', () => {
        const singsToTheEnd: TransitionTrack = {
            duration: 96.9,
            lines: [line(10, 96.34)],
            profile: makeProfile({ duration: 96.9, leadOut: 0, bodyOut: 0, bpm: 125 }),
            vocalEnd: 96.34,
            separated: { from: 66.2, to: 96.2 },
        };
        const shortIntro: TransitionTrack = {
            duration: 200,
            lines: null,
            profile: makeProfile({ sectionStart: 3.02, bpm: 125 }),
            separated: { from: 0, to: 30 },
        };
        expect(planTransition(singsToTheEnd, shortIntro, 125).overlap).toBeLessThanOrEqual(3.02);
    });

    it('still bounds the blend by what the two windows can actually carry', () => {
        // The gesture refuses any window its stems do not cover, falling back to the master
        // crossfade - the one actuator that cannot hold a voice. So the separated extents bind
        // even where the vocal ceiling is wide open. Same pair with a 33s instrumental outro, so
        // `singleVoiceRoom` is not what is doing the work, and separation that began 8.5s before
        // the music stops.
        const outro = (separated: { from: number; to: number }): TransitionTrack => ({
            ...ballad(separated), vocalEnd: 240,
        });
        const roomy = planTransition(outro({ from: 240, to: 270 }), next(wholeHead), 65);
        const narrow = planTransition(outro({ from: 265, to: 295 }), next(wholeHead), 65);

        expect(narrow.overlap).toBeLessThan(roomy.overlap);
        expect(narrow.overlap).toBeLessThanOrEqual(8.5);
        expect(narrow.reason).toContain('both voices held by the gesture');
    });
});
