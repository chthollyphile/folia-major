import { createHifiClock, MAX_EXTRAPOLATION_SEC, type HifiClockSync } from '../hifi/hifiClock';

// src/services/onlineMusic/externalClock.ts
// Keep coarse external-player samples monotonic across buffering/pause/resume, not just playing ticks.

/**
 * How fast a shown position that is ahead of the player runs while it lets the player catch up, as a
 * share of the player's own speed. The difference closes over twice its length, and the bar and the
 * lyrics keep moving the whole time instead of standing still until the player arrives.
 */
export const EXTERNAL_CATCH_UP_RATE = 0.5;
/**
 * The longest lead, in seconds, that is played out this way. A player answering from much further
 * behind is not catching up with the bar but saying the song is somewhere else, so the shown position
 * stands still for it as it always did rather than running on slowly for seconds.
 */
export const MAX_CATCH_UP_LEAD_SEC = 3;

/**
 * A position known to be ahead of the player, running on at its own slower speed from the moment it
 * was found there until the player has come up to it.
 */
type CatchUpLine = {
    startSec: number;
    startMs: number;
    /** How far ahead the player was: the line travels this much at the catch-up speed and then stops. */
    leadSec: number;
};

export function createExternalClock() {
    const clock = createHifiClock();
    let previousSample: { position: number; paused: boolean } | null = null;
    let catchUp: CatchUpLine | null = null;
    const catchUpSec = (nowMs: number) => catchUp === null
        ? 0
        : catchUp.startSec + Math.min(EXTERNAL_CATCH_UP_RATE * Math.max(0, nowMs - catchUp.startMs) / 1000, catchUp.leadSec);
    const read = (nowMs = performance.now()) => Math.max(clock.read(nowMs), catchUpSec(nowMs));
    const sync = (update: HifiClockSync & { samplePositionSec?: number; holdLimitSec?: number }) => {
        const rawPosition = update.samplePositionSec ?? update.positionSec;
        // Repeated SDK samples do not restart extrapolation or renew its stall timeout.
        if (update.holdBackward && previousSample?.position === rawPosition && previousSample.paused === update.paused) {
            if (update.durationSec !== undefined) setDuration(update.durationSec);
            return;
        }
        previousSample = { position: rawPosition, paused: update.paused };
        const nowMs = update.nowMs ?? performance.now();
        const shown = read(nowMs);
        clock.sync({ ...update, nowMs, holdBackward: false });
        const sampled = clock.read(nowMs);
        const duration = clock.state().durationSec;
        const boundedShown = duration === null ? shown : Math.min(shown, duration);
        const lag = boundedShown - sampled;
        // The route compensates up to one second of RPC age and extrapolates at most one more, and a
        // caller that knows the answer it waits for can be later still says how far past that the shown
        // position may be held: a spot the player took seconds to load.
        const holdLimitSec = update.holdLimitSec ?? 2 * MAX_EXTRAPOLATION_SEC;
        if (update.holdBackward && lag > 0 && lag <= holdLimitSec) {
            // A caller that says how far the bar may be held is holding it for a spot the player is
            // still loading: the song is playing, and the lead it has run up is played out at the
            // slower speed rather than stood still for. Everywhere else the shown position stands
            // where it is until the player's own answers catch up with it.
            const playsOut = update.holdLimitSec !== undefined && !update.paused && lag <= MAX_CATCH_UP_LEAD_SEC;
            if (update.holdLimitSec !== undefined && !update.paused && !playsOut) {
                console.debug('[ExternalClock] the player answered too far behind the shown position to catch up with it', {
                    leadSec: Number(lag.toFixed(2)), limitSec: MAX_CATCH_UP_LEAD_SEC,
                });
            }
            catchUp = playsOut
                ? { startSec: boundedShown, startMs: nowMs, leadSec: lag }
                : { startSec: boundedShown, startMs: nowMs, leadSec: 0 };
        } else {
            catchUp = null;
        }
    };
    const setDuration = (duration: number | null) => {
        clock.setDuration(duration);
        if (catchUp === null) return;
        const durationSec = clock.state().durationSec;
        if (durationSec !== null) catchUp = { ...catchUp, startSec: Math.min(catchUp.startSec, durationSec) };
    };
    return { read, sync, setDuration };
}
