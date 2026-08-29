import type { Line } from '../../types';
import { isInterludeLine } from '../../utils/lyrics/parserCore';
import {
    alignEntry,
    barGrid,
    quantiseToMusic,
    snapToGrid,
    BEATS_PER_PHRASE,
    type Grid,
    type TempoRelation,
} from './musicalTime';
import {
    chooseTransitionStyle,
    CUT_LEAD_SEC,
    HEAD_BUDGET_SEC,
    type KeyRelation,
    type TransitionStyle,
} from './transitionChooser';
import type { TrackProfile } from './trackProfile';

// src/services/automix/transitionPlanner.ts
// Decides WHICH transition two songs get and HOW MUCH of the outgoing track it occupies. Pure -
// no audio, no DOM, no clock.
// The switch means "blend my song changes", so every song change gets one. The lyric timeline and the
// offline profiles only choose the kind and the length: where a vocal-free window can be proven, the
// handover lands in it; where it cannot, it still happens at the default length. The only 'hardCut'
// left is for a track whose end is genuinely unknowable, a missing fact and not a judgement.

export interface TransitionTrack {
    /** Seconds. Non-finite (live/unknown streams) leaves nothing to schedule against. */
    duration: number;
    /** Timed lyric lines when available; null for instrumentals or missing lyric files. */
    lines: Line[] | null;
    /** Offline measurement of the file, when it has been analysed. */
    profile?: TrackProfile | null;
    /**
     * Media time of the last moment this track is still singing, measured off its separated vocal.
     *
     * Outgoing side only, and null whenever it could not be measured: no separation in this build,
     * the window not ready yet, or a tail with no singing in it. `lastSungMoment` is the fallback
     * and the two are not equivalent - see there.
     */
    vocalEnd?: number | null;
    /**
     * The separated window the stem gesture holds for this end, in media time. Null if it has none.
     *
     * Two things at once, and deliberately the same field for both, because they are the same fact:
     * a window that exists is a voice the gesture can hold, and its extent is how long a blend it
     * can hold one across. Kept as an extent rather than as a boolean plus a length because the
     * planner has to answer both questions and a pair of fields would let them disagree.
     */
    separated?: { from: number; to: number } | null;
}

export type TransitionKind = 'hardCut' | 'fade';

export interface TransitionPlan {
    kind: TransitionKind;
    /** Which of the four joins this is. Decided here, realised by shapeBlend. */
    style: TransitionStyle;
    /** How the two keys sit together. Reported so a length can be argued with. */
    relation: KeyRelation;
    /** How the two tempos sit together. */
    tempo: TempoRelation;
    /**
     * Rate the OUTGOING deck runs at across the transition, to meet the incoming one's tempo.
     *
     * One, unless the two tempos are far enough apart to hear and close enough to reconcile. This
     * is the lever nothing else in the plan can stand in for: two tracks a tenth apart drift a beat
     * over six seconds of overlap, and no gain curve, band split or key rule touches that.
     */
    stretch: number;
    /** Mid and top correction for the incoming deck, so it arrives in the outgoing track's tone. */
    tiltDb: [number, number];
    /** The outgoing track is thrown into a delay as it leaves rather than simply stopping. */
    echoThrow: boolean;
    /** Seconds into the outgoing track where the incoming one starts and the fade begins. */
    outStart: number;
    /** Seconds into the incoming track to start playback from. */
    inStart: number;
    /**
     * How much of the outgoing track's tail this transition occupies, in seconds.
     *
     * For the three overlapping styles this is the crossfade itself. For a cut it is the room the
     * transition is given to place itself in - most of which is spent waiting, and whatever is not
     * waited out is cut off.
     */
    overlap: number;
    /** Shortest room this style can still work in, checked again when the incoming deck starts. */
    minOverlap: number;
    /** How the length was chosen. Surfaced in the console, not cosmetic. */
    reason: string;
    /**
     * Automix was asked for this one and had nothing to measure, so a crossfade answered instead.
     *
     * Absent on every plan either planner writes on purpose - a crossfade the listener chose has
     * not fallen back to anything, and neither has a measured `plainBlend`. Only `planForMode`
     * sets it, at the one branch where the mode selected and the strategy that ran disagree.
     *
     * Optional because it is the exception, and because everything downstream that does not care
     * should carry on not caring. What does care is anything claiming to the listener that automix
     * is at work: on a track dropped in by hand there has been no time to analyse anything, and a
     * transition that says otherwise is the setting lying about what it just did.
     */
    fellBack?: true;
    /**
     * Performance mode's build strength, 0.25 to 1, or null/absent when the mode is off.
     *
     * Strength ONLY - the layout needs the drum swap, which is planned against real audio inside
     * the session. Absent rather than zero when off, because zero is a strength this feature is not
     * allowed to have: a switch the listener flipped may not be talked out of doing the thing by
     * the same measurements that decide how hard to do it. See `chooseExpansionIntensity`.
     */
    expansion?: number | null;
}

/**
 * Longest blend we ever ask for.
 *
 * This used to be eight seconds, with a comment claiming that past it a transition stops reading as one
 * song ending. That was a taste, not a measurement, and it was the binding constraint far more often
 * than anything measured: real logs carry a 63 second instrumental outro against an 8 second intro, a
 * pair with room for a proper mix, cut to eight by a constant.
 *
 * Twenty-five is where the OTHER limits start to bind instead - a quarter of a short track, the proven
 * vocal-free window, the phrase count the tempo produces. It was raised only once the two things that
 * make a long overlap survivable were built: loudness measured the way the ear hears it, and headroom
 * while both masters are stacked.
 */
export const AUTOMIX_MAX_OVERLAP_SEC = 25;
/** Floor for a blend to be one. Below this there is no time left to fade across, only a cut. */
export const AUTOMIX_MIN_OVERLAP_SEC = 0.8;
/**
 * The same floor for a cut, which needs far less.
 *
 * A cut only has to fit its own 40ms and leave a little either side; holding it to the crossfade's
 * floor would throw away every cut whose incoming deck happened to load slowly, and replace it
 * with the abrupt stop that floor exists to prevent.
 */
const AUTOMIX_MIN_CUT_ROOM_SEC = 0.15;
/** Used whenever neither the lyrics nor a tempo can point at a better length. */
export const AUTOMIX_DEFAULT_OVERLAP_SEC = 5;
/**
 * The length a blend really wants, in beats rather than seconds.
 *
 * A fixed number of seconds is the wrong unit: five seconds is two bars of a ballad and nearly four of
 * a fast track, so the same setting reads as leisurely on one song and frantic on the next.
 *
 * Two phrases - eight bars. Raised twice, from two bars to one phrase to here, and the reason it kept
 * being too short is worth writing down: the number is a CEILING that a chain of scales then multiplies
 * down, so setting it to what a good blend should be guarantees the typical blend is shorter than one.
 * Measured on real transitions the scales together land between a quarter and a half, so the default has
 * to be about twice the target for the target to be the common case. Eight bars against those scales
 * gives two to four bars, a mix; one phrase gave one to two, a fill.
 *
 * It stays a ceiling in the other sense too. Nothing here overrides how much room the pair actually has
 * - `ceiling` below is still the vocal-free tail, and a blend that has to be short still is.
 */
const AUTOMIX_DEFAULT_OVERLAP_BEATS = BEATS_PER_PHRASE * 2;

/**
 * How far a handover may be moved to land on a line of the outgoing track's grid.
 *
 * One beat. Enough to reach a beat from anywhere, and not enough to become a different handover: past
 * this the transition is no longer where the evidence put it, it is where the grid put it. It used to
 * have to cover the reach to a BAR line, up to two beats away and so often out of range - and a snap
 * that did not happen looks exactly like one that was not needed.
 */
const GRID_SNAP_BEATS = 1;
/**
 * How far a handover may be moved to land on a structural boundary instead.
 *
 * Two seconds, and it takes priority over the bar line because it is a stronger claim: a bar line
 * says the count restarts, a section boundary says the music does. The literature is consistent
 * that transitions placed on section edges are the ones listeners rate highest.
 */
const SECTION_SNAP_SEC = 2;

/**
 * Longest run at the end of a track a transition may take as being "the ending".
 *
 * Master padding is a second or two and a produced fade-out runs to five or six, so ten covers both
 * with room. Past it the measurement is not describing an ending any more: a minute of silence is the
 * gap before a hidden track, and a two-minute decay is an ambient outro somebody wrote on purpose.
 * Anchoring a handover in front of either would delete a part of the song.
 */
const MAX_TRIMMED_TAIL_SEC = 10;

const beatSec = (bpm: number | null | undefined) =>
    (bpm && Number.isFinite(bpm) && bpm > 0 ? 60 / bpm : null);

/**
 * The two ends of the outgoing track that are not its file's end.
 *
 * A blend is scheduled backwards from "the end of the track", and that was read off the media duration
 * - so both of these were being treated as music. Measured over two listening sessions, each on its own
 * accounts for a class of song change that arrives as silence:
 *
 * `sounding` - past it the file is digitally silent. Twenty-nine song changes, seven handed over below
 * -30 dBFS and four below -40, one 55 dB under the outgoing track's own level. Not quiet transitions:
 * the song had finished, and the listener heard a gap and then a fade-up.
 *
 * `body` - past it the track is decaying rather than playing. Fixing the first left five song changes
 * of which three still handed over at -23 to -26 dBFS, because the silence threshold is forty dB under
 * the track's PEAK, thirty under its music on a modern master. So a blend aimed at `sounding` runs its
 * whole length inside the decay. Aiming at `body` starts it while the outgoing track is still carrying
 * the song, and the decay then plays out underneath the incoming one instead of in place of it - which
 * is what `tailRide` was always for.
 *
 * Null on a head-only profile, the honest answer - the tail of an uncached track is not downloadable -
 * and then the file's own end is all there is to aim at, exactly as before.
 */
export const endsOf = (track: TransitionTrack) => {
    const profile = track.profile && !track.profile.partial ? track.profile : null;
    const back = (seconds: number | null | undefined) => (
        seconds !== null && seconds !== undefined && seconds > 0
            ? track.duration - Math.min(seconds, MAX_TRIMMED_TAIL_SEC)
            : track.duration
    );
    return { sounding: back(profile?.leadOut), body: back(profile?.bodyOut) };
};

/**
 * A little of the incoming track's leading silence is kept rather than skipped.
 *
 * The measurement says where the file stops being silent, to within one analysis frame. Landing the
 * playhead exactly there risks starting inside the first transient instead of in front of it, and a
 * clipped attack is far more audible than a tenth of a second of silence.
 */
export const ENTRY_MARGIN_SEC = 0.1;

/** Seconds from a moment to the next line of a grid. */
const barPhase = (grid: Grid, seconds: number) =>
    ((grid.offset - seconds) % grid.period + grid.period) % grid.period;

/**
 * The grid a transition is aligned on. The BEAT grid - deliberately not the bar grid.
 *
 * A bar grid is the beat grid with three lines in four thrown away, and which three is decided by
 * `estimateDownbeat`, a vote between four candidates one beat apart. Measured against Beat This! over
 * thirty tracks from a real library, that vote answers on 12 and is right about half of those. Picking
 * the nearest line of a grid thinned by a coin flip cannot beat picking the nearest line of the whole
 * grid: it can only add the coin's error, and it makes the walk four times longer.
 *
 * Simulated over the 58 tempo-matched pairs those thirty tracks make, at 44100 - the rate the app
 * decodes at - measuring how far the incoming track enters from one of its OWN real beats:
 *
 *     bar line, else no alignment (what this did)   0.255 beats   15 of 58 inside an eighth
 *     the beat grid, both sides                     0.118         30 of 58
 *     no alignment at all                           0.250          -        <- chance
 *
 * The first row is chance, so the feature had never worked - and it was not free: reaching a bar line
 * walks the entry forward by up to a whole bar, deleting up to 2.14s of the incoming track's opening to
 * buy nothing. On the beat grid the same walk is at most 0.54s.
 *
 * Everything above was first measured at 22050, the rate the beat tracker is fed, and came out
 * differently enough to have justified a different change. Analysis has to be graded at the rate it
 * will actually run at.
 */
const entryGrid = (
    bpm: number | null | undefined,
    beatOffset: number | null | undefined,
) => barGrid(bpm, beatOffset, 1);

/** The closest of a set of moments, if one is close enough and lands somewhere usable. */
const nearestWithin = (
    moments: readonly number[] | null | undefined,
    target: number,
    tolerance: number,
    usable: (value: number) => boolean,
): number | null => {
    let best: number | null = null;
    for (const moment of moments ?? []) {
        if (Math.abs(moment - target) > tolerance || !usable(moment)) continue;
        if (best === null || Math.abs(moment - target) < Math.abs(best - target)) best = moment;
    }
    return best;
};

/**
 * Where the outgoing track stops singing, off the lyric file. The FALLBACK, not the answer.
 *
 * The END of a track only. Where the singing STARTS is measured from the audio instead - see
 * `vocalStart` in trackProfile - because a lyric file's opening is not the song's: every online source
 * prepends a credit block, and the three of them format it three incompatible ways. The end of the file
 * carries no such block, so the timeline is trustworthy there.
 *
 * Worth knowing how weak this is, because everything below treats it as a floor. Plain LRC carries no
 * end times - only line starts - so `endTime` on the last line is invented by the parser as
 * `startTime + 5`, flat, with no reference to the audio. A singer who holds the last line for nine
 * seconds is recorded as stopping after five, and the handover is placed four seconds inside her. Still
 * used, because a wrong number is better than none on the web build and on tracks whose tail was never
 * separated - but only when nothing measured the actual voice. See `vocalEnd`.
 *
 * Interlude placeholders are dropped, load-bearing rather than tidy: attachInterludes prepends a
 * '......' line at 0.5s to every track whose singing starts after 0:03. Blank lines go for the same
 * reason - some sources use those as the placeholder instead.
 */
const lastSungMoment = (lines: Line[] | null | undefined): number | null => {
    const sung = lines?.filter(line => line.fullText.trim().length > 0 && !isInterludeLine(line));
    return sung?.length ? sung[sung.length - 1].endTime : null;
};

export const hardCut = (reason: string): TransitionPlan => ({
    kind: 'hardCut',
    style: 'plainBlend',
    relation: 'unknown',
    tempo: 'unknown',
    stretch: 1,
    tiltDb: [0, 0],
    echoThrow: false,
    outStart: 0,
    inStart: 0,
    overlap: 0,
    minOverlap: AUTOMIX_MIN_OVERLAP_SEC,
    reason,
});

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * Picks how long a song change should overlap.
 *
 * Preferred window: where NEITHER track is singing - the outgoing instrumental outro against the
 * incoming instrumental intro. Two vocal lines stacked on each other is the one thing that makes a
 * crossfade sound wrong, and the lyric timeline states exactly where they are, so when it can prove
 * such a window the blend is placed inside it.
 *
 * When it cannot - no lyrics, or a track that sings to the last second - the blend still happens at
 * AUTOMIX_DEFAULT_OVERLAP_SEC. The listener switched this on; declining to blend and calling it good
 * taste would just be the feature not working.
 */
export const planTransition = (
    from: TransitionTrack,
    to: TransitionTrack,
    /** Measured tempo of the outgoing track, when there is one. Sets the unit for the length. */
    bpm: number | null = null,
    /** Where the outgoing track is right now. Everything behind it is not room, it is history. */
    at: number = 0,
): TransitionPlan => {
    if (!Number.isFinite(from.duration) || from.duration <= 0) {
        return hardCut('outgoing duration unknown, nothing to schedule a fade against');
    }

    const choice = chooseTransitionStyle({
        from: from.profile ?? null,
        to: to.profile ?? null,
    });

    // Everything below is scheduled backwards from HERE, not from the end of the file.
    const { sounding: end, body } = endsOf(from);
    // How much of that is still AHEAD of the playhead, the only part a blend can be put in. The two used
    // to be the same number, because a plan was made while the track still had its whole tail in front
    // of it - but nothing looks at a track while a previous blend is still fading, and a duration that
    // arrives late blocks the look as well. So the first look can land after the handover point has gone
    // by, and a length chosen from the whole tail then loses the part behind us: the execution clamps
    // the blend to what is left and it comes out short, shaped for a length it never had.
    const left = Math.max(0, end - at);
    const trimmed = from.duration - end;
    const silence = trimmed > 0.05 ? `, skipped ${round(trimmed)}s of silence at the end` : '';
    // Said out loud when the cap decides the anchor instead of the measurement.
    //
    // `body` is what keeps a handover out of a track's decay, and `back()` clamps it to
    // MAX_TRIMMED_TAIL_SEC - so on a track whose music stops fifteen seconds early the blend still
    // begins five seconds inside the fade. That is the difference between "handed over while the song was
    // still playing" and "handed over into an empty room", impossible to tell apart afterwards from a
    // line that only reports the SILENCE it trimmed. The cap itself is deliberate - past ten seconds a
    // tail stops being an ending - so this reports rather than argues, and the tracks it names are the
    // evidence for whether ten is the right number.
    const decay = from.profile?.bodyOut ?? 0;
    const clipped = decay > MAX_TRIMMED_TAIL_SEC
        ? `, its last ${round(decay)}s is decay but only ${MAX_TRIMMED_TAIL_SEC}s of that may be trimmed`
        : '';

    // A cut does not want a length, it wants somewhere to stand: enough of the tail that the
    // incoming deck has finished loading inside it, and no more, because whatever is left over
    // when the handover lands is cut off.
    if (choice.style === 'beatCut') {
        // Never ask for more room than the cut can actually be placed in.
        //
        // Room is spent waiting, and the wait comes out of the incoming track's own leading silence -
        // shapeBlend will not spend a millisecond more than that. So asking for a second and a half of it
        // on a track that opens after a fifth of one produces a plan guaranteed to be thrown away.
        //
        // CUT_LEAD_SEC is what a deck starting cold would need; these decks have been buffering since the
        // top of the transition window, so the only thing still to pay for is the moment between letting
        // go and hearing it - which RELEASE_MARGIN_SEC already covers.
        const placeable = to.profile ? to.profile.leadIn + HEAD_BUDGET_SEC : CUT_LEAD_SEC;
        // A quarter of the MUSIC, not of the file: a track padded with silence has less of itself
        // to spend than its duration claims, and this is also what keeps the anchor off zero.
        const room = Math.min(CUT_LEAD_SEC, end / 4, placeable, left);
        if (room < AUTOMIX_MIN_CUT_ROOM_SEC) {
            // Which bound, because "too short" is a claim about the track and this is usually a
            // claim about when we looked.
            return hardCut(room === left
                ? `only ${round(left)}s of the outgoing track left to cut in`
                : `track too short to place a cut in (${round(end)}s)`);
        }
        // No `body` here, and that is what a cut IS: the styles that reach this branch were chosen
        // because the outgoing track is still at full level when it stops, so its body runs to the
        // last sounding frame and the two answers are the same one.
        return {
            kind: 'fade',
            style: choice.style,
            relation: choice.relation,
            tempo: choice.tempo.relation,
            // Nothing to lock to: a cut never has the two tracks sounding at once, so there is no
            // drift to remove and no reason to spend an artefact removing it.
            stretch: 1,
            tiltDb: [0, 0],
            echoThrow: choice.echoThrow,
            outStart: round(end - room),
            // Deliberately not the incoming track's lead-in, which is what every other style skips.
            // Here that silence is not waste, it is the budget: waiting is the only way to place a
            // cut on a beat, and the wait can only be paid for out of it.
            inStart: 0,
            overlap: round(room),
            minOverlap: AUTOMIX_MIN_CUT_ROOM_SEC,
            reason: `${choice.style} - ${choice.reason}${silence}`,
        };
    }

    const beat = beatSec(bpm);
    // The measurement outright when there is one, not the later of the two. Taking the max would read
    // like caution and is not: the lyric figure is a five-second constant, so `max` would let an
    // invented number push the floor past a measured one roughly half the time. A guess does not get a
    // vote against a measurement.
    const sungFrom = from.vocalEnd != null ? 'the vocal stem' : 'the lyric file';
    const lyricSung = lastSungMoment(from.lines);
    const lastSung = from.vocalEnd ?? lyricSung;
    // Printed only when both exist and they disagree by more than the margin the measurement was
    // rounded up by. This is the line that says whether replacing the lyric floor was worth doing:
    // if the two always agree, it was not, and nothing else in the log would ever reveal that.
    const sungGap = from.vocalEnd != null && lyricSung !== null
        && Math.abs(from.vocalEnd - lyricSung) > 0.5
        ? `, the lyric file said ${round(lyricSung)}s`
        : '';
    // Against the last sounding moment for the same reason: a lyric timeline that stops eight seconds
    // before a file that carries five seconds of silence has a three-second instrumental outro, not an
    // eight-second one, and only one of those numbers is somewhere to put a blend.
    const tail = lastSung === null ? null : Math.max(0, end - lastSung);  // instrumental outro
    // Measured off the audio, not read off the incoming lyric file. The two ends of a transition
    // are asymmetric: a lyric timeline's END is trustworthy, its BEGINNING is a credit block.
    //
    // The structural boundary, and ONLY it. `vocalStart` is measured and reported alongside but does not
    // get a vote, a measurement rather than a preference: across six real tracks it was exact on one
    // (Runaway, 17.46s against a first sung line at 17.5s), plausible on one, and near zero on three -
    // including an instrumental with no voice at all. Its errors all land on "the voice starts
    // immediately", the one answer that destroys the window. `sectionStart` came in EARLIER than the
    // true vocal entry on every track it could be checked against, and early is the harmless direction:
    // the blend is over before anyone sings.
    const intro = to.profile?.sectionStart ?? null;
    // TWO constraints, not one, and collapsing them into a single number was a hole rather than a
    // tidiness: `min(tail, intro)` is null the moment EITHER side is unmeasured, so not knowing one threw
    // away the other. An outgoing track with a known ten-second instrumental outro was therefore blended
    // across its own last chorus whenever the incoming track had not been analysed yet - the ordinary
    // state of the first transition after a cold start, precisely the case the vocal floor exists for.
    // It hid while blends were short: `anchor` is `min(latest, max(body, lastSung))`, and only a long
    // overlap drags `latest` in front of the last sung line for the min to hand it back. Each side bounds
    // the overlap on its own now, still bounded by the smaller of the two when both are known.
    //
    // How long a blend this side can GUARANTEE is free of its own voice, or null for "cannot say". Null
    // covers two situations on purpose, because they have the same consequence: a window never measured,
    // and one too small to blend inside - the second keeps the standing decision that a track singing to
    // its very last second is overlapped anyway rather than refused. Null rather than Infinity, which is
    // what this returned while the two rooms were combined with `min`: under a `min` the two read the
    // same; under the `max` below they are opposites, and "unmeasured" quietly claiming to vouch for an
    // unbounded blend is a 17-second error.
    const vouchFor = (window: number | null): number | null => (
        window !== null && window >= AUTOMIX_MIN_OVERLAP_SEC ? window : null
    );
    const tailRoom = vouchFor(tail);
    const introRoom = vouchFor(intro);
    // The two windows are proxies for ONE requirement, and `anchor` states it below: two vocal lines
    // stacked on each other is what makes an overlap sound wrong. Holding both as ceilings asks for
    // something stricter and different - no voice AT ALL inside the blend.
    //
    // When `tailRoom` binds, the overlap fits inside the outgoing track's instrumental outro, so that
    // side is silent by construction; an incoming vocal arriving over a departing instrumental is a
    // single voice, not a collision - it is the move. What holding both cost: a wanted 11.88s blend came
    // out at 2.04s on a pair whose outgoing track had a 34.42s instrumental outro, because the incoming
    // one's first section began 2.92s in - half a minute of nobody singing, refused. The mirror is the
    // same sentence with the tracks swapped: when the overlap fits inside the NEXT track's instrumental
    // intro, that side is silent, so the outgoing track may still be singing across it and there is still
    // one voice in the room.
    //
    // So the requirement is not "both ends have room", it is "ONE end can vouch for the whole blend" - a
    // max, not a min. What the asymmetry cost, severe because AUTOMIX_MIN_OVERLAP_SEC is 0.8: a track
    // whose last line ends two seconds before the file did had `tailRoom` = 2, so every blend out of it
    // was two seconds long and flush against the end, however long the next intro was - the song
    // finished, then the next arrived, exactly the "it dodges the problem" the listener reports. Both
    // small is still both small; that one is the music's fault. And when NEITHER side can vouch there is
    // no ceiling at all - not a ceiling of zero: the cold start, and the track that sings to its own last
    // second. Both were the old Infinity.
    //
    // And it does NOT lift because the gesture holds both voices. That was tried, and is retracted. The
    // argument was that the gesture holds the incoming vocal at absolute zero until `vocalIn`, so where
    // the two voices sit in the files stops being a constraint. Both halves are true and the conclusion
    // still does not follow, because `vocalIn` is CHOREOGRAPHY - one incoming bar after the drums change
    // hands, `SWAP_TARGET * overlap + bar` - so it scales with the window while where the incoming track
    // starts singing does not. Removing the ceiling does not remove the collision, it inverts it: instead
    // of two voices at once, the fader is still down when the incoming singer opens her mouth.
    //
    // Measured, on the album the ceiling was removed against. Dawn FM into Gasoline: `intro` is 3.02s, so
    // this used to cap the blend there; without the cap it ran 15.36s, putting `vocalIn` at 11.68s
    // against a first section at 3.02s and a first sung cell measured off the incoming vocal stem at
    // 6.25s. Five to nine seconds of Gasoline's own voice held at zero - and the lyric pane turns the
    // page when the blend STARTS, so the words were already scrolling. The listener's verdict on
    // seventeen transitions with this ceiling was 「几乎没有感受到任何断点」; on the same album without
    // it, 「连的特别差」. The transition that motivated the lift is real and is not what the lift bought:
    // a 25.7s blend capped to 3.6s is a short blend, and short blends are what those seventeen were. The
    // cost of the cap is bounded and dull; the cost of removing it is a muted lead vocal.
    //
    // What survives is the half above: EITHER side may vouch, rather than the outgoing one always. That
    // half is free, because the direction it opens up is a long incoming intro, and a long intro is
    // silence - no voice there for a late `vocalIn` to mute.
    const voicesGated = Boolean(from.separated && to.separated);
    const singleVoiceRoom = tailRoom === null && introRoom === null
        ? Infinity
        : Math.max(tailRoom ?? 0, introRoom ?? 0);

    // Where the incoming track is allowed to start from, hoisted above the ceiling because the
    // ceiling now depends on it. Its own explanation is at `inStart`, which still does the walk.
    const entryFloor = Math.min(
        MAX_TRIMMED_TAIL_SEC,
        Math.max(0, (to.profile?.leadIn ?? 0) - ENTRY_MARGIN_SEC),
    );
    /**
     * The longest blend the two separated windows can actually carry.
     *
     * Lifting the vocal ceiling is a promise that the gesture will run, and the gesture refuses any
     * window its stems do not cover at both ends - falling back to the master crossfade, the ONE actuator
     * that cannot hold a voice. So a lifted ceiling with no bound here buys a long blend by promising
     * something, then breaks the promise and leaves the long blend behind: two vocals stacked for twenty
     * seconds, worse than the short blend it replaced.
     *
     * The two ends bind for different reasons. Behind: the blend ends at `end` at the latest, so its
     * whole length has to sit between there and the first separated sample - a track with ten seconds of
     * trailing silence has ten fewer seconds of usable window than its length suggests. Ahead: the
     * incoming window has to cover the entry as well as the blend, and the entry can be up to
     * MAX_TRIMMED_TAIL_SEC in. A beat of slack for the alignment walk, which only moves the entry later
     * and by less than one.
     *
     * Not a constant, and could not be: it is 30 minus two things measured off this particular pair.
     */
    const gestureRoom = from.separated && to.separated
        ? Math.max(0, Math.min(
            end - from.separated.from,
            to.separated.to - entryFloor - (beat ?? 0),
        ))
        : Infinity;

    // One phrase of the outgoing track, then scaled by everything measured about the pair: longer when
    // the keys sit together, when the tempos are locked, when the tail wants riding, or when there is a
    // level step for the ear to walk across; shorter when they clash, when the tempos are too far apart
    // to hold, or when the next track opens at full tilt. A clash is not removed, it is denied the time
    // to be noticed.
    const wanted = (beat === null ? AUTOMIX_DEFAULT_OVERLAP_SEC : beat * AUTOMIX_DEFAULT_OVERLAP_BEATS)
        * choice.lengthScale;

    // Everything that can bind, in one number - and it is a CEILING, not the length.
    //
    // The distinction is the whole of why this reads as a mix rather than a fade. The proven window
    // answers "where may a handover go", not "how long should one be", and spending all of it conflates
    // the two: a track with a 26s outro into an 11s intro would take the whole ceiling. What sets the
    // length is the music - a phrase of it, scaled by the evidence - and the ceiling only shortens that.
    const ceiling = Math.min(
        AUTOMIX_MAX_OVERLAP_SEC,
        // Quarter-length cap so a very short track is not half crossfade.
        end / 4,
        singleVoiceRoom,
        // Only binds on a separated pair, and only because that pair asked for the long blend.
        gestureRoom,
        // Only ever binds when the planning itself was late - see `left`.
        left,
    );
    // Quantised last, so a blend forced into a narrow gap still comes out as a whole number of
    // phrases, bars or beats rather than as the gap.
    const overlap = quantiseToMusic(Math.min(wanted, ceiling), beat, ceiling);

    // Only a genuinely tiny ceiling can land here now that the scales are floored - and the message has
    // to name WHICH ceiling, because the one it used to print was the track's own length, the single
    // quantity that is almost never the reason. A 187 second track logged itself as "too short to fade
    // across (186.73s)", which reads as a fact about the track and was a fact about three length
    // penalties multiplying together.
    if (overlap < AUTOMIX_MIN_OVERLAP_SEC) {
        // WHICH end ran out, because the two are fixed by opposite things: a short outro is the outgoing
        // song, a short intro is the incoming one, and naming the wrong one sends the next person looking
        // at the wrong track.
        //
        // The LARGER of the two, which reads backwards until you remember what the ceiling now is: only
        // one side has to be silent, so the side that offered more room is the one the blend was measured
        // against. Naming the smaller would point at a track that was never the constraint.
        const bound = ceiling === left
            ? `only ${round(left)}s of the outgoing track left`
            : Number.isFinite(singleVoiceRoom) && singleVoiceRoom <= end / 4
            ? singleVoiceRoom === tailRoom
                ? `only ${round(singleVoiceRoom)}s after the outgoing track stops singing`
                : `only ${round(singleVoiceRoom)}s before the next track sings`
            : `a ${round(end)}s track leaves only ${round(end / 4)}s to fade across`;
        return hardCut(`no room to fade - ${bound}`);
    }

    // Each end fails for its own reason and they want telling apart: the outgoing side can only
    // fail on its lyric file, the incoming side only on its analysis.
    const outroMissing = from.lines?.length
        ? 'nothing sung in the outgoing lyrics'
        : 'no lyrics for the outgoing track';
    const introMissing = to.profile
        ? 'nothing measurable at the start of the incoming track'
        : 'the incoming track was never analysed';
    const window = tail === null
        ? outroMissing
        : intro === null
            ? introMissing
            : `outro ${round(tail)}s, intro ${round(intro)}s`;
    // Which bound, and what was asked for - because the two bounds are heard as opposite things. A
    // ceiling means the pair had no room for more; a scale means we CHOSE to be short. The old message
    // said the first whenever either happened, and it was usually the second: a 63s outro against a 32s
    // intro logged itself as "capped by what the pair has room for" while the real binder was a 0.6 for
    // an incoming track that starts at full level.
    const length = `${beat === null ? 'default' : `${round(overlap / beat)} beats`}`
        + (overlap >= wanted - 0.05 ? ''
            : ceiling < wanted - 0.05
                ? ceiling === left
                    ? `, wanted ${round(wanted)}s, capped by the ${round(left)}s left of this track`
                    : `, wanted ${round(wanted)}s, capped by what the pair has room for (${round(ceiling)}s)`
                : `, wanted ${round(wanted)}s, rounded down to the grid`);
    // Three clauses, and the order between them is the whole decision.
    //
    // Latest: where the blend sits when the track just stops - flush against the last sounding moment.
    // Body: the top of the decay, taken instead when the decay starts earlier, so the handover happens
    // while the outgoing track is still carrying the song rather than fifteen dB into its own fade-out.
    // Floor: never before the singing stopped, because two vocal lines stacked on each other is the one
    // thing that makes an overlap sound wrong, and moving the anchor earlier is exactly the way to cause it.
    const latest = end - overlap;
    // `at` for the same reason it bounds the ceiling: a handover cannot be placed in the part of
    // the track that has already played. Safe against `latest` because the ceiling has already
    // kept the overlap inside what is left, so `latest` is never behind the playhead either.
    const anchor = Math.min(latest, Math.max(body, lastSung ?? 0, at));
    const rode = latest - anchor;
    const fadeOut = rode > 0.05 ? `, started ${round(rode)}s early to ride the fade-out` : '';

    // Everything above decides WHERE a handover belongs by level and by voice. The two below move
    // it onto a line the music itself draws, but only within a beat or two - past that it would no
    // longer be the handover the evidence chose, only the one the grid preferred.
    const lowest = Math.min(anchor, latest);
    const withinRange = (value: number) => value >= lowest - 1e-6 && value <= latest + 1e-6;

    // A structural boundary first, because it is the stronger claim: a bar line says the count
    // restarts, a section edge says the music does.
    const boundary = nearestWithin(from.profile?.sections, anchor, SECTION_SNAP_SEC, withinRange);
    const grid = entryGrid(bpm, from.profile?.beatOffset);
    const snapped = snapToGrid(boundary ?? anchor, grid, beat === null ? 0 : beat * GRID_SNAP_BEATS);
    const outStart = withinRange(snapped) ? snapped : boundary ?? anchor;
    const placed = boundary !== null
        ? ', on a section edge'
        : Math.abs(outStart - anchor) > 0.01 ? ', on a beat' : '';

    // Where the incoming track is started from. Two separate reasons to move it off zero, and they
    // compose: its own leading silence is not music and should not be faded through, and once that is
    // skipped the entry can be walked forward to whichever of its beats lands on one of the outgoing
    // track's. That second half is the part a gain curve can never stand in for - two tracks a third of a
    // beat apart stay a third of a beat apart however the levels move.
    const inStart = alignEntry(
        entryFloor,
        // The SAME phase estimator as the outgoing side above, and that is the whole point.
        //
        // A head-measured phase is a better description of the incoming track's first thirty seconds -
        // graded against Beat This! it is 18 of 28 inside an eighth of a beat against 13 of 30 for the
        // whole-track one extrapolated there. Substituting it here makes the ENTRY worse, 0.246 against
        // 0.118, and that is not a contradiction: `alignEntry` returns a DIFFERENCE between two grids, and
        // a difference is blind to any bias the two share. Two estimates made the same way carry the same
        // bias and it cancels; mixing in a better one on a single side breaks the cancellation and leaves
        // its bias behind. Same shape as the balance correction, which measured the incoming track with
        // one kind of loudness and the outgoing track with another. Both sides of a comparison have to be
        // the same measurement before either is allowed to be a good one.
        entryGrid(to.profile?.bpm, to.profile?.beatOffset),
        // In WALL seconds, not the outgoing track's own: if it is being bent to meet the incoming
        // tempo, its bars arrive that much sooner than its media clock says they will.
        grid === null ? null : barPhase(grid, outStart) / choice.tempo.stretch,
    );

    const key = choice.relation === 'unknown' ? '' : `, ${choice.relation} keys`;
    // Four of the five joins are decided on how the OUTGOING track ends, and a head-only profile knows
    // nothing about that - so they cannot be reached and every song change comes out as an overlap. Worth
    // saying out loud: without it the log reads as "these two songs wanted an overlap" when what happened
    // is that nothing else was ever on the table.
    const outgoingTail = !from.profile
        ? ', outgoing never analysed'
        : from.profile.partial ? ', outgoing tail not analysed' : '';

    // The percentage, always, when a pair is left unbent. "Too far apart to hold" was a verdict with
    // its evidence withheld: it read the same at 11% and at 60%, and the first of those turned out
    // to be a threshold set wrong rather than a pair of tracks that could not be mixed.
    const apart = Math.round(Math.abs(choice.tempo.ratio - 1) * 100);
    const bend = choice.tempo.stretch !== 1
        ? `, outgoing bent ${((choice.tempo.stretch - 1) * 100).toFixed(1)}% onto the next tempo`
        : choice.tempo.relation === 'drifting' ? `, tempos ${apart}% apart, left to drift`
            : choice.tempo.relation === 'far' ? `, tempos ${apart}% apart, too far to overlap` : '';
    const entry = inStart > 0.05 ? `, entering the next track at ${round(inStart)}s` : '';
    // The floor under every placement above, and WHERE IT CAME FROM. Named because the two sources are
    // not the same kind of thing - one is measured off the voice, the other a constant the lyric parser
    // made up - and a log that prints the number without its provenance reads as though the placement
    // were evidence-based on every track, which it was not.
    const sung = lastSung === null
        ? ', nothing says where the singing stops'
        : `, sung to ${round(lastSung)}s off ${sungFrom}${sungGap}`;
    // Which voice is actually inside the blend, now that the ceiling permits either one - and the one
    // place a blend is allowed past a measured window, so it says so. A listener who hears the next vocal
    // arrive while the last track is still audible should be able to find from the log whether that was
    // intended.
    //
    // The pair matters more than either half: `both` is the collision the whole rule exists to prevent,
    // and it should be unreachable - the ceiling is the room ONE side can vouch for, so a blend
    // containing two voices means a window was measured wrong rather than that a bound was relaxed. It
    // prints loudest because it is the line that would say so.
    const nextSings = intro !== null && inStart + overlap > intro;
    const outgoingSings = lastSung !== null && outStart < lastSung;
    // On a separated pair both voices are held by the gesture, so "sings" here would be reporting
    // what is in the FILES rather than what will be heard - and the two stopped being the same
    // thing. The gesture's own log says when each voice actually moves.
    const sungOver = voicesGated
        ? ', both voices held by the gesture'
        : nextSings && outgoingSings
            ? ', BOTH tracks sing inside this blend'
            : nextSings
                ? ', the next track sings over the outgoing instrumental'
                : outgoingSings
                    ? ', the outgoing track sings over the next one\'s intro'
                    : '';

    return {
        kind: 'fade',
        style: choice.style,
        relation: choice.relation,
        tempo: choice.tempo.relation,
        stretch: choice.tempo.stretch,
        tiltDb: choice.tiltDb,
        echoThrow: choice.echoThrow,
        outStart: round(outStart),
        inStart: round(inStart),
        overlap: round(overlap),
        minOverlap: AUTOMIX_MIN_OVERLAP_SEC,
        // The style's own reason, which used to be computed here and then dropped on this branch
        // only - so the log said how long a blend was and never why that length. The scales live in
        // the choice, so without it a 1.95s blend and a 5.85s one read as the same decision.
        reason: `${choice.style} ${round(overlap)}s ${length} - ${choice.reason}`
            + ` (${window}${sungOver}${key}${outgoingTail}${sung}${silence}${clipped}${fadeOut}${placed}${bend}${entry})`,
    };
};

/**
 * Second and final gate, run at the instant the incoming deck actually starts.
 *
 * The plan is made a few seconds before the incoming track has loaded, so by the time it plays the
 * outgoing track may have less left than planned (slow URL resolve, cold buffer). Fading over a window
 * that no longer exists would leave the blend truncated mid-curve, which sounds like a dropout - clamp
 * to what is really there and take the clean cut if that is no longer a blend.
 */
export const resolveOverlap = (plan: TransitionPlan, remainingSec: number): number => {
    if (plan.kind !== 'fade' || !Number.isFinite(remainingSec)) return 0;
    const overlap = Math.min(plan.overlap, remainingSec);
    return overlap >= plan.minOverlap ? round(overlap) : 0;
};
