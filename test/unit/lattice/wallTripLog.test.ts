import { describe, expect, it } from 'vitest';
import { wallTripLine, type WallTrip } from '../../../src/components/app/lattice/wallTripLog';

// test/unit/lattice/wallTripLog.test.ts
// The one line a trip between the wall and a collection's page leaves in the log: what it says
// of a whole trip, and of one where a time never came.

const trip = (over: Partial<WallTrip> = {}): WallTrip => ({
    way: 'open', fromPress: true, committed: 41, frame: 78, takeoff: 43, landing: 505, ...over,
});

describe('wallTripLine', () => {
    it('gives the four times of a whole trip, from the press', () => {
        expect(wallTripLine(trip())).toBe(
            '[Lattice] Open from the wall: committed at 41 ms, first frame at 78 ms, flight from 43 to 505 ms (from the press)',
        );
    });

    it('says of a return with no press that its times are from the navigation', () => {
        expect(wallTripLine(trip({ way: 'return', fromPress: false, committed: 0, frame: 31, takeoff: null, landing: null }))).toBe(
            '[Lattice] Return to the wall: committed at 0 ms, first frame at 31 ms, no flight (from the navigation: no press was seen)',
        );
    });

    it('says what did not come', () => {
        expect(wallTripLine(trip({ committed: null, frame: null, landing: null }))).toBe(
            '[Lattice] Open from the wall: committed never, first frame not seen, flight from 43 ms, not landed (from the press)',
        );
    });
});
