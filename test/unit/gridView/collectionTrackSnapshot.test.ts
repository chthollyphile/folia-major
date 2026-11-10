import { describe, expect, it } from 'vitest';
import { createCollectionTrackSnapshot, readCollectionTrackSnapshot } from '../../../src/library/core/collection/resource/collectionTrackSnapshot.service';

// test/unit/gridView/collectionTrackSnapshot.test.ts

const page = { items: [{ id: '1' }], nextOffset: 100, hasMore: true, total: 121 };

describe('collection track snapshots', () => {
    it('requires matching collection timestamps', () => {
        const cached = createCollectionTrackSnapshot(page, 1234);
        expect(readCollectionTrackSnapshot(cached, 1234)).toEqual(cached);
        expect(readCollectionTrackSnapshot(cached, 0)).toBeNull();
        expect(readCollectionTrackSnapshot(cached, 5678)).toBeNull();
    });

    it.each([5, 6])('invalidates schema %i instead of guessing progress from the track count', schemaVersion => {
        const cached = { ...createCollectionTrackSnapshot(page, 1234), schemaVersion };
        expect(readCollectionTrackSnapshot(cached, 1234)).toBeNull();
        expect(readCollectionTrackSnapshot(page.items, 1234)).toBeNull();
    });

    it('rejects snapshots with a missing or invalid cursor', () => {
        const cached = createCollectionTrackSnapshot(page, 1234);
        for (const nextOffset of [undefined, -1, 0, 1.5, NaN]) {
            expect(readCollectionTrackSnapshot({ ...cached, nextOffset }, 1234)).toBeNull();
        }
    });

    it('restores a completed empty collection without requesting another page', () => {
        const cached = createCollectionTrackSnapshot({ items: [], nextOffset: 0, hasMore: false, total: 0 }, 1234);
        expect(readCollectionTrackSnapshot(cached, 1234)).toMatchObject({ tracks: [], nextOffset: 0, hasMore: false });
    });
});
