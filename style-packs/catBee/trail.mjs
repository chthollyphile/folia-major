import { createImprints } from '../lyricImprint/motion.mjs';
import { flightAt } from './flight.mjs';

// The bee chooses each glyph's birth neighborhood once; existing text never follows its current flight.
export function createTrail(ctx) {
    const planner = createImprints(ctx, {
        bounds: f => ({ left: f.width * .055, right: f.width * .945, top: f.height * .12, bottom: f.height * .47 }),
    });
    return (frame, program, flight) => planner(frame, program, { key: flight, at: time => {
        const point = flightAt(flight, time);
        return { x: point.x * frame.width, y: point.y * frame.height };
    } });
}
