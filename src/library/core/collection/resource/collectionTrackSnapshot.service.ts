import type { CollectionSyncPage } from './onlineCollectionSync.service';

// src/library/core/collection/resource/collectionTrackSnapshot.service.ts
// Preserve upstream pagination separately from the number of visible, deduplicated tracks.

export const COLLECTION_TRACK_SNAPSHOT_SCHEMA_VERSION = 7;

export type CollectionTrackSnapshot<T> = {
    schemaVersion: number;
    snapshotTime: number;
    tracks: T[];
    nextOffset: number;
    hasMore: boolean;
    total?: number;
};

export const createCollectionTrackSnapshot = <T>(
    page: CollectionSyncPage<T>,
    snapshotTime: number,
): CollectionTrackSnapshot<T> => ({
    schemaVersion: COLLECTION_TRACK_SNAPSHOT_SCHEMA_VERSION,
    snapshotTime,
    tracks: page.items,
    nextOffset: page.nextOffset,
    hasMore: page.hasMore,
    total: page.total,
});

// Old schemas inferred progress from the row count and cannot safely resume sparse pages.
export const readCollectionTrackSnapshot = <T>(
    cached: unknown,
    targetTime: number,
): CollectionTrackSnapshot<T> | null => {
    if (!cached || typeof cached !== 'object' || targetTime <= 0) return null;
    const snapshot = cached as CollectionTrackSnapshot<T>;
    if (snapshot.schemaVersion !== COLLECTION_TRACK_SNAPSHOT_SCHEMA_VERSION || snapshot.snapshotTime !== targetTime
        || !Array.isArray(snapshot.tracks) || typeof snapshot.hasMore !== 'boolean'
        || !Number.isSafeInteger(snapshot.nextOffset) || snapshot.nextOffset < snapshot.tracks.length
        || (snapshot.hasMore && snapshot.nextOffset === 0)) return null;
    return snapshot;
};
