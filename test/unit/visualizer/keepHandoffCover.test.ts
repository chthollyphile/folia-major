import { describe, expect, it } from 'vitest';
import { keepHandoffCover } from '@/components/visualizer/useHandoffCover';

// test/unit/visualizer/keepHandoffCover.test.ts
// The backdrop keys its background on the cover address. Seen in the app: the incoming song's cover
// came at two addresses at the start of a blend; a background keyed on the second one would drop the
// outgoing background mid-blend, and change again at the settle.

describe('keepHandoffCover', () => {
    it('keeps the first address the hand-off gave when the cover comes again at another', () => {
        const kept = keepHandoffCover(null, { seed: 'b', coverUrl: 'b-net.jpg' }, 'b');
        expect(keepHandoffCover(kept, { seed: 'b', coverUrl: 'b-cache.jpg' }, 'b')).toBe(kept);
        expect(kept).toEqual({ seed: 'b', coverUrl: 'b-net.jpg' });
    });

    it('keeps it after the settle while the incoming song is shown', () => {
        const kept = keepHandoffCover(null, { seed: 'b', coverUrl: 'b-net.jpg' }, 'b');
        expect(keepHandoffCover(kept, null, 'b')).toBe(kept);
    });

    it('drops it once another song is shown: a cancel back to the outgoing one, or the next song', () => {
        const kept = keepHandoffCover(null, { seed: 'b', coverUrl: 'b-net.jpg' }, 'b');
        expect(keepHandoffCover(kept, null, 'a')).toBeNull();
        expect(keepHandoffCover(kept, { seed: 'c', coverUrl: 'c.jpg' }, 'c')).toEqual({ seed: 'c', coverUrl: 'c.jpg' });
    });

    it('lets go of an object URL the song moved off once the blend is over', () => {
        // The player revokes the cached cover's object URL as it replaces it: a background mounted
        // again on the kept one would draw no cover for the rest of the song.
        const kept = keepHandoffCover(null, { seed: 'b', coverUrl: 'blob:b-1' }, 'b');
        expect(keepHandoffCover(kept, { seed: 'b', coverUrl: 'blob:b-2' }, 'b', 'blob:b-2')).toBe(kept);
        expect(keepHandoffCover(kept, null, 'b', 'blob:b-1')).toBe(kept);
        expect(keepHandoffCover(kept, null, 'b', 'blob:b-2')).toBeNull();
        const network = keepHandoffCover(null, { seed: 'b', coverUrl: 'b-net.jpg' }, 'b');
        expect(keepHandoffCover(network, null, 'b', 'blob:b-2')).toBe(network);
    });

    it('waits for an address while the incoming song has none yet', () => {
        expect(keepHandoffCover(null, { seed: 'b', coverUrl: null }, 'b')).toBeNull();
        expect(keepHandoffCover(null, null, 'a')).toBeNull();
    });
});
