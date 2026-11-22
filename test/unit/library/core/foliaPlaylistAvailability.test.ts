import { describe, expect, it } from 'vitest';
import { filterPlayableFoliaEntries, resolveFoliaEntryAvailability } from '@/library/core/foliaPlaylist/foliaPlaylistAvailability';
import type { FoliaEntryAvailabilityDeps, FoliaPlaylistEntry } from '@/library/core/foliaPlaylist/foliaPlaylist.contract';
import type { SongResult } from '@/types';

// test/unit/library/core/foliaPlaylistAvailability.test.ts
// Folia 聚合歌单的条目：来源停用、卸载、本地歌不在、Navidrome 没配置时怎么判断。

const entry = (sourceRef: SongResult['sourceRef']): FoliaPlaylistEntry => ({
    key: 'k',
    song: { id: 1, name: 'n', artists: [], album: { id: 0, name: '' }, durationMs: 0, sourceRef },
    addedAt: 1,
});
const deps = (patch: Partial<FoliaEntryAvailabilityDeps> = {}): FoliaEntryAvailabilityDeps => ({
    hasLocalSong: () => true,
    isSourceRegistered: () => true,
    isSourceSwitchedOn: () => true,
    isNavidromeConfigured: () => true,
    ...patch,
});
const online = entry({ kind: 'online', providerId: 'lxmusic', mediaId: '1' });
const local = entry({ kind: 'local', mediaId: 'a' });
const navidrome = entry({ kind: 'navidrome', mediaId: 'n' });

describe('resolveFoliaEntryAvailability', () => {
    it('is available when the source of the entry is there', () => {
        for (const item of [online, local, navidrome]) {
            expect(resolveFoliaEntryAvailability(item, deps())).toEqual({ state: 'available' });
        }
    });

    it('tells a switched-off source from one that is not registered', () => {
        expect(resolveFoliaEntryAvailability(online, deps({ isSourceSwitchedOn: () => false, isSourceRegistered: () => false })))
            .toEqual({ state: 'source-off', sourceId: 'lxmusic' });
        expect(resolveFoliaEntryAvailability(online, deps({ isSourceRegistered: () => false })))
            .toEqual({ state: 'source-missing', sourceId: 'lxmusic' });
    });

    it('reports a local song that left the library and an unconfigured Navidrome', () => {
        expect(resolveFoliaEntryAvailability(local, deps({ hasLocalSong: id => id !== 'a' }))).toEqual({ state: 'local-missing' });
        expect(resolveFoliaEntryAvailability(navidrome, deps({ isNavidromeConfigured: () => false }))).toEqual({ state: 'navidrome-unconfigured' });
    });

    it('reads the source of an old snapshot that has no sourceRef', () => {
        const legacyLocal = {
            key: 'k',
            song: { id: 1, name: 'n', artists: [], album: { id: 0, name: '' }, durationMs: 0, isLocal: true, localRef: { songId: 'a' } } as SongResult,
            addedAt: 1,
        };
        expect(resolveFoliaEntryAvailability(legacyLocal, deps({ hasLocalSong: () => false }))).toEqual({ state: 'local-missing' });
    });

    it('keeps only the playable entries, in order', () => {
        const kept = filterPlayableFoliaEntries([online, local, navidrome], deps({ isSourceSwitchedOn: () => false }));
        expect(kept).toEqual([local, navidrome]);
    });
});
