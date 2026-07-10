import type { SyncedThemeRecord } from './syncTypes';

// src/services/sync/syncMerkle.ts
// Builds deterministic bucket summaries for theme sync diffing.

export const THEME_BUCKET_COUNT = 256;

export type ThemeBucketInput = Pick<SyncedThemeRecord, 'fingerprint' | 'updatedAt'>;

export const hashSyncString = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const getThemeBucketId = (fingerprint: string) => (
    hashSyncString(fingerprint) % THEME_BUCKET_COUNT
);

const createEmptyBucket = (bucketId: number) => ({
    bucketId,
    count: 0,
    hash: '0',
    updatedAt: null,
});

export const buildThemeBucketSummaries = (records: ThemeBucketInput[]) => {
    const buckets = Array.from({ length: THEME_BUCKET_COUNT }, (_, bucketId) => createEmptyBucket(bucketId));
    const hashesByBucket = new Uint32Array(THEME_BUCKET_COUNT);

    records.forEach((record) => {
        const bucketId = getThemeBucketId(record.fingerprint);
        const bucket = buckets[bucketId];
        bucket.count += 1;
        if (!bucket.updatedAt || Date.parse(record.updatedAt) > Date.parse(bucket.updatedAt)) {
            bucket.updatedAt = record.updatedAt;
        }
        hashesByBucket[bucketId] ^= hashSyncString(`${record.fingerprint}\u0000${record.updatedAt}`);
    });

    buckets.forEach((bucket, bucketId) => {
        bucket.hash = bucket.count > 0 ? String(hashesByBucket[bucketId]) : '0';
    });

    return buckets;
};
