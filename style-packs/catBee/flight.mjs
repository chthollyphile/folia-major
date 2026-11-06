import { clamp, rhythmAt } from './phrases.mjs';

// A bounded pursuit controller is baked once, then sampled by absolute time with cubic Hermite interpolation.
const limit = (x, y, max) => { const length = Math.hypot(x, y); const k = length > max ? max / length : 1; return { x: x * k, y: y * k }; };
export const FLIGHT = { idleSpeed: .028, maxSpeed: .30, maxAcceleration: .38, maxSamples: 60000 };

export function buildFlight(program, aspect = 16 / 9) {
    // Coordinates use the viewport short side, making velocity limits meaningful in both orientations.
    const sx = Math.max(1, aspect), sy = Math.max(1, 1 / aspect);
    // A deterministic pre-roll supplies real trajectory history when lyrics start at song time zero.
    const preRoll = 24, duration = Math.max(1, program.duration), total = duration + preRoll;
    const steps = Math.min(FLIGHT.maxSamples, Math.ceil(total * 60));
    const dt = total / steps, data = new Float64Array((steps + 1) * 4);
    let x = .32 * sx, y = .39 * sy, vx = 0, vy = 0, rate = 0, singing = 0;
    const phase = program.seed % 1000 / 157;
    data[0] = x; data[1] = y;
    for (let i = 1; i <= steps; i++) {
        const t = (i - .5) * dt - preRoll, signal = rhythmAt(program, t);
        rate += (signal.rate - rate) * (1 - Math.exp(-dt / .32));
        singing += (signal.active - singing) * (1 - Math.exp(-dt / .55));
        const idle = { x: (.5 + .22 * Math.sin(t * .17 + phase) + .035 * Math.sin(t * .41)) * sx,
            y: (.34 + .085 * Math.sin(t * .11 + phase * .7) + .025 * Math.sin(t * .31)) * sy };
        let goal = idle;
        if (signal.phrase) {
            const p = signal.progress, seed = signal.phrase.seed % 100 / 100;
            // A forward reading gesture is shared, while contour and pacing follow the phrase.
            goal = { x: (.18 + .64 * p) * sx, y: (.30 + .065 * Math.sin(p * Math.PI * 2 + seed * 2) + (signal.phrase.chorus ? -.035 : .025)) * sy };
        }
        const dx = goal.x - x, dy = goal.y - y, distance = Math.hypot(dx, dy) || 1;
        const speed = Math.min(FLIGHT.maxSpeed, FLIGHT.idleSpeed + singing * .095 + rate * .018);
        const alignment = Math.hypot(vx, vy) < .001 ? 1 : (vx * dx + vy * dy) / (Math.hypot(vx, vy) * distance);
        const cruise = speed * (.6 + .4 * clamp((alignment + 1) / 2));
        const desired = limit(dx * 2.4, dy * 2.4, cruise);
        const accel = limit((desired.x - vx) * 4, (desired.y - vy) * 4, FLIGHT.maxAcceleration);
        // Exponential response remains stable when very long tracks use a coarser bake step.
        const response = (1 - Math.exp(-4 * dt)) / 4;
        const nx = vx + accel.x * response, ny = vy + accel.y * response;
        x += (vx + nx) * .5 * dt; y += (vy + ny) * .5 * dt; vx = nx; vy = ny;
        // Soft boundary forces normally keep these guards inactive; prevent extreme-duration overshoot.
        const safeX = clamp(x, .10 * sx, .90 * sx), safeY = clamp(y, .15 * sy, .46 * sy);
        if (safeX !== x) { x = safeX; vx = 0; }
        if (safeY !== y) { y = safeY; vy = 0; }
        const offset = i * 4; data[offset] = x; data[offset + 1] = y; data[offset + 2] = vx; data[offset + 3] = vy;
    }
    return { data, dt, steps, duration, preRoll, sx, sy };
}

export function flightAt(flight, time, reduced = false) {
    if (reduced) return { x: .63, y: .43, vx: 0, vy: 0, speed: 0 };
    const sample = (clamp(time, -flight.preRoll, flight.duration) + flight.preRoll) / flight.dt;
    const index = Math.min(flight.steps - 1, Math.floor(sample)), p = sample - index, p2 = p * p, p3 = p2 * p;
    const { data, dt } = flight, a = index * 4, b = a + 4;
    const axis = j => {
        const start = data[a + j], end = data[b + j], v0 = data[a + j + 2], v1 = data[b + j + 2];
        return { position: (2 * p3 - 3 * p2 + 1) * start + (p3 - 2 * p2 + p) * dt * v0 + (-2 * p3 + 3 * p2) * end + (p3 - p2) * dt * v1,
            velocity: ((6 * p2 - 6 * p) * start + (3 * p2 - 4 * p + 1) * dt * v0 + (-6 * p2 + 6 * p) * end + (3 * p2 - 2 * p) * dt * v1) / dt };
    };
    const x = axis(0), y = axis(1);
    return { x: x.position / flight.sx, y: y.position / flight.sy, vx: x.velocity / flight.sx, vy: y.velocity / flight.sy, speed: Math.hypot(x.velocity, y.velocity) };
}
