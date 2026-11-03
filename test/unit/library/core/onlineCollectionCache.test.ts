import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/library/core/onlineCollectionCache.test.ts
// 在线集合曲目缓存：键的格式（前缀被歌词导出、缓存分类、加入歌单后的作废共同依赖）、
// 旧数据的解析、以及「什么时候能直接用缓存」。

const store = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => store.get(key) ?? null),
    saveToCache: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
    }),
}));

const {
    isOnlineTracksCacheValid,
    ONLINE_TRACKS_CACHE_SCHEMA_VERSION,
    parseCachedOnlineTracks,
    readOnlineTracksCache,
    resolveOnlineTracksCacheKey,
    resolveOnlineTracksCacheSuffix,
    resolveOnlineTracksTargetTime,
    writeOnlineTracksCache,
} = await import('@/library/core/collection/resource/onlineCollectionCache.service');

const track = (id: string) => ({ id, name: id, artists: [], album: { id: 0, name: '' }, durationMs: 1 } as SongResult);

describe('online tracks cache keys', () => {
    it('keeps playlist and cloud keys exactly as before', () => {
        expect(resolveOnlineTracksCacheSuffix({ type: 'playlist', id: 42 })).toBe('playlist_tracks_42');
        expect(resolveOnlineTracksCacheSuffix({ type: 'cloud', id: 'cloud' }, 7)).toBe('playlist_tracks_cloud_7');
        expect(resolveOnlineTracksCacheSuffix({ type: 'playlist', id: -100 })).toBe('playlist_tracks_cloud_anonymous');
        expect(resolveOnlineTracksCacheKey({ providerId: 'netease', type: 'playlist', id: 42 }))
            .toBe('online_provider_netease_playlist_tracks_42');
    });

    it('puts the type in front of the id for everything that is not a playlist', () => {
        expect(resolveOnlineTracksCacheSuffix({ type: 'album', id: 42 })).toBe('playlist_tracks_album_42');
        expect(resolveOnlineTracksCacheSuffix({ type: 'album', id: 42 }))
            .not.toBe(resolveOnlineTracksCacheSuffix({ type: 'playlist', id: 42 }));
        // 前缀不变：歌词导出与缓存分类按 `playlist_tracks_` 找它们。
        expect(resolveOnlineTracksCacheSuffix({ type: 'daily_recommendations', id: 'daily_recommendations' }))
            .toMatch(/^playlist_tracks_/);
    });

    it('takes the tracks update time first, then the collection update time', () => {
        expect(resolveOnlineTracksTargetTime({ tracksUpdatedAt: 2, updatedAt: 1 })).toBe(2);
        expect(resolveOnlineTracksTargetTime({ updatedAt: 1 })).toBe(1);
        expect(resolveOnlineTracksTargetTime({})).toBe(0);
    });
});

describe('online tracks cache entries', () => {
    beforeEach(() => store.clear());

    it('parses the current shape, the legacy bare array and nothing', () => {
        expect(parseCachedOnlineTracks({ tracks: [track('a')], snapshotTime: 5, schemaVersion: 5 }))
            .toEqual({ tracks: [track('a')], snapshotTime: 5, schemaVersion: 5 });
        expect(parseCachedOnlineTracks([track('a')])).toEqual({ tracks: [track('a')], snapshotTime: 0, schemaVersion: 0 });
        expect(parseCachedOnlineTracks(null)).toEqual({ tracks: [], snapshotTime: 0, schemaVersion: 0 });
    });

    it('is valid only for a snapshot of the same version and schema with a safe cursor', () => {
        const entry = { tracks: [track('a')], snapshotTime: 5, schemaVersion: ONLINE_TRACKS_CACHE_SCHEMA_VERSION, nextOffset: 150, hasMore: true };
        expect(isOnlineTracksCacheValid(entry, 5)).toBe(true);
        expect(isOnlineTracksCacheValid(entry, 6)).toBe(false);
        expect(isOnlineTracksCacheValid(entry, 0)).toBe(false);
        expect(isOnlineTracksCacheValid({ ...entry, schemaVersion: 4 }, 5)).toBe(false);
        expect(isOnlineTracksCacheValid({ ...entry, nextOffset: 0 }, 5)).toBe(false);
        expect(isOnlineTracksCacheValid({ ...entry, tracks: [], nextOffset: 0, hasMore: false }, 5)).toBe(true);
        expect(isOnlineTracksCacheValid({ ...entry, schemaVersion: 5 }, 5)).toBe(false);
    });

    it('writes a snapshot that reads back valid under the provider namespace', async () => {
        const collection = { providerId: 'netease', type: 'playlist', id: 9 } as const;
        await writeOnlineTracksCache(resolveOnlineTracksCacheKey(collection), [track('a')], 123);
        expect(store.get('online_provider_netease_playlist_tracks_9'))
            .toEqual({ tracks: [track('a')], snapshotTime: 123, schemaVersion: ONLINE_TRACKS_CACHE_SCHEMA_VERSION, nextOffset: 1, hasMore: false, total: undefined });
        expect(isOnlineTracksCacheValid(await readOnlineTracksCache(collection), 123)).toBe(true);
    });

    it('migrates a legacy unscoped entry into the provider namespace once', async () => {
        store.set('playlist_tracks_9', { tracks: [track('old')], snapshotTime: 1, schemaVersion: 5 });
        const entry = await readOnlineTracksCache({ providerId: 'netease', type: 'playlist', id: 9 });
        expect(entry.tracks).toEqual([track('old')]);
        expect(store.has('online_provider_netease_playlist_tracks_9')).toBe(true);
    });
});
