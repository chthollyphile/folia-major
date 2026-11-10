import { describe, expect, it } from 'vitest';
import { cinemaSeats } from '../../../src/components/scenes/cinema/cinemaAnchors';
import entry from '../../../src/components/scenes/cinema/entry';
import { checkSceneManifest } from '../../../src/components/scenes/definition';

// test/unit/scenes/cinemaAnchors.test.ts
// The hall's seats as the seat map and the seat camera read them, and its manifest.

describe('cinema seats', () => {
    it('gives every seat its own id and one preferred seat nobody sits in', () => {
        const seats = cinemaSeats();
        expect(new Set(seats.map(seat => seat.id)).size).toBe(seats.length);
        const preferred = seats.filter(seat => seat.preferred);
        expect(preferred).toHaveLength(1);
        expect(preferred[0].occupied).toBe(false);
        expect(seats.some(seat => seat.occupied)).toBe(true);
    });

    it('has a manifest the host takes', () => {
        expect(checkSceneManifest(entry.manifest)).toEqual([]);
    });
});
