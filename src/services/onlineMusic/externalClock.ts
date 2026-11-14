import { createHifiClock, MAX_EXTRAPOLATION_SEC, type HifiClockSync } from '../hifi/hifiClock';

// src/services/onlineMusic/externalClock.ts
// The line the bar and the lyrics run on over a song another program is sounding. That player answers
// where it stands a few times a second, and every answer carries the age of the call and the jitter of
// the player's own clock: written down as they come, the line steps forward on one answer and stands
// still or steps back on the next. So the line is not re-based on a routine answer. It runs on from
// where it is shown, and the answer only bends its speed onto the player's own. A stop shows where the
// player stands, and a write the route makes itself puts the line where it says.

/** How long the line may run on without an answer before it stands: a player that stopped answering. */
export const EXTERNAL_MAX_EXTRAPOLATION_SEC = 3;
/** How far the line may lean on the player's own speed, either way. */
const MAX_RATE_BEND = 0.1;
/** A player further ahead of the line than this is somewhere else, and the line is put there. */
const ALIGN_BEHIND_SEC = 1;
/**
 * A line further ahead of the player than this is somewhere else, and is put back there. Up to it the
 * lead is a move the player took long to load, and it is run out slowly instead.
 */
const ALIGN_AHEAD_SEC = 10.5;
/** A lead past the jitter is run out faster, at up to half speed, so it does not linger for a minute. */
const JITTER_SEC = 1;
const MAX_LEAD_BEND = 0.5;
/** How much of a gap is taken per second of the song, before the rate is clamped to the bend. */
const EASE_PER_SEC = 2;

type Line = { atSec: number; atMs: number; rate: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

export function createExternalClock({ runOnSec = EXTERNAL_MAX_EXTRAPOLATION_SEC }: { runOnSec?: number } = {}) {
    const clock = createHifiClock();
    let previousSample: { position: number; paused: boolean } | null = null;
    let line: Line = { atSec: 0, atMs: 0, rate: 1 };
    /**
     * How long the line may run on without an answer. A way of playing that declared how long its own
     * moves take says so through the limit on the write (a move in flight), and that limit is the one
     * the line is given then; every other answer keeps the longer one a followed player is given.
     */
    let extrapolationSec = runOnSec;

    const lineSec = (nowMs: number) => line.atSec
        + line.rate * Math.min(Math.max(0, nowMs - line.atMs) / 1000, extrapolationSec);
    const read = (nowMs = performance.now()) => {
        const durationSec = clock.state().durationSec;
        const shown = lineSec(nowMs);
        return durationSec === null ? shown : Math.min(shown, durationSec);
    };
    const sync = (update: HifiClockSync & { samplePositionSec?: number; holdLimitSec?: number }) => {
        const rawPosition = update.samplePositionSec ?? update.positionSec;
        const nowMs = update.nowMs ?? performance.now();
        // Repeated SDK samples do not restart anything: the line goes on as it is.
        if (update.holdBackward && previousSample?.position === rawPosition && previousSample.paused === update.paused) {
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        previousSample = { position: rawPosition, paused: update.paused };
        const wasRunning = !clock.state().paused;
        // Read under the limit the line was given, before this write gives it its own.
        const shownSec = read(nowMs);
        // The limit the caller gave belongs to this write: a move in flight, a spot it knows the player
        // is on. Left out, the line is given the longer one of a followed player. A stop runs on from
        // nothing, which the pause branch below sets.
        extrapolationSec = update.maxExtrapolationSec ?? runOnSec;
        clock.sync({ ...update, nowMs, holdBackward: false });
        const positionSec = Number.isFinite(update.positionSec) ? update.positionSec : 0;
        const gap = shownSec - positionSec;
        // A stopped song shows where the player stands. The line is put on the player's own word and
        // stays there: a lead the bar had run up before the stop is not one a stopped song keeps, and a
        // stop that named a spot a little behind the line does not take the line back over.
        if (update.paused) {
            // A stopped song shows where the player put it and stands there: the line is given no run-on
            // and no speed, so nothing moves it off that spot.
            extrapolationSec = 0;
            const keepsLead = update.holdBackward && gap > 0 && gap <= (update.holdLimitSec ?? 2 * MAX_EXTRAPOLATION_SEC);
            line = { atSec: keepsLead ? shownSec : positionSec, atMs: nowMs, rate: 0 };
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        // A write the route makes itself - a move, a resume, the spot it knows the player is on - is the
        // line being put where it says, at once.
        if (!update.holdBackward) {
            line = { atSec: positionSec, atMs: nowMs, rate: 1 };
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        // A press that starts a stopped song goes on from the spot the line is showing at once, rather
        // than standing on it until an answer arrives: the song starts from where it was stopped, and
        // the answers that follow are a beat away at most and are bent onto below.
        // A player that is elsewhere, past what jitter or a slow move explains, puts the line there.
        if (gap < -ALIGN_BEHIND_SEC || gap > ALIGN_AHEAD_SEC) {
            line = { atSec: positionSec, atMs: nowMs, rate: 1 };
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        if (!wasRunning) {
            line = { atSec: shownSec, atMs: nowMs, rate: 1 + clamp(-gap * EASE_PER_SEC, -MAX_RATE_BEND, MAX_RATE_BEND) };
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        // A routine answer of a song that is playing bends the line's speed onto the player: slower
        // while the line is ahead of it, faster while it is behind, so jitter never steps or stops it.
        // A gap past the align limit is the player being elsewhere, and the line is put there.
        const bend = clamp(-gap * EASE_PER_SEC, gap > JITTER_SEC ? -MAX_LEAD_BEND : -MAX_RATE_BEND, MAX_RATE_BEND);
        line = { atSec: shownSec, atMs: nowMs, rate: 1 + bend };
        if (update.durationSec !== undefined) setDuration(update.durationSec);
    };
    const setDuration = (duration: number | null) => {
        clock.setDuration(duration);
        const durationSec = clock.state().durationSec;
        if (durationSec === null) return;
        if (line.atSec > durationSec) line = { ...line, atSec: durationSec };
    };
    return { read, sync, setDuration };
}
