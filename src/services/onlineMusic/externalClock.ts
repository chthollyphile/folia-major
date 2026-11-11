import { createHifiClock, MAX_EXTRAPOLATION_SEC, type HifiClockSync } from '../hifi/hifiClock';

// Keep coarse external-player samples monotonic across buffering/pause/resume, not just playing ticks.
export function createExternalClock() {
    const clock = createHifiClock();
    let floor: number | null = null;
    let previousSample: { position: number; paused: boolean } | null = null;
    const read = (nowMs = performance.now()) => Math.max(clock.read(nowMs), floor ?? 0);
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
        floor = update.holdBackward && lag > 0 && lag <= holdLimitSec ? boundedShown : null;
    };
    const setDuration = (duration: number | null) => {
        clock.setDuration(duration);
        if (floor !== null && duration !== null && Number.isFinite(duration) && duration > 0) floor = Math.min(floor, duration);
    };
    return { read, sync, setDuration };
}
