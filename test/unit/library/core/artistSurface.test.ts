import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import type { LibraryArtistSnapshot } from '@/library/core/artist/artist.contract';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import {
    ARTIST_SURFACE_ACTION_SOURCES,
    artistAlbumEntryKey,
    artistEntryPane,
    artistSessionKey,
    artistSongEntryKey,
    resolveArtistCapabilities,
    resolveArtistSurfaceActions,
    resolveOfferedArtistActions,
} from '@/library/core/artist/artistSurface';
import { LIBRARY_ARTIST_ACTION_IDS } from '@/library/core/suite/librarySuites';
import { useLibraryArtistSurfaceStore } from '@/library/core/artist/useLibraryArtistSurfaceStore';
import type { LibraryArtistSurfaceHandle } from '@/library/core/artist/artist.contract';

// test/unit/library/core/artistSurface.test.ts
// 歌手页的纯规则（P4.2）：会话键与条目键、能力（只看快照与描述）、命令面板发布「能力 ∩ 声明」，
// 以及 artist surface 的注册槽（旧实例晚卸载不注销新实例）。

const song = (id: number): SongResult => ({ id, name: `Song ${id}`, artists: [], album: { id: 1, name: 'A' }, duration: 1000 } as unknown as SongResult);

const snapshot = (overrides: Partial<LibraryArtistSnapshot> = {}): LibraryArtistSnapshot => ({
    key: 'online:p:artist:1',
    status: 'ready',
    detail: { name: 'Artist' },
    topSongs: [song(1), song(2)],
    albums: [{ id: 'al-1', name: 'One' }],
    albumSync: { state: 'none' },
    error: null,
    hint: 'urgent',
    ...overrides,
});

const online = { source: 'online' as const };
const local = { source: 'local' as const, entityId: 'artist-entity' };
const counts = { playableTopSongCount: 2, queueableTopSongCount: 2 };
const ALL_DECLARED = { actions: LIBRARY_ARTIST_ACTION_IDS, extraActions: [] };

describe('artist session and entry keys', () => {
    it('keys the session by the resource (the host stack layer), falling back to the descriptor', () => {
        const descriptor = { source: 'online', providerId: 'p', type: 'artist', id: 7, name: 'X' } as LibraryCollectionDescriptor;
        expect(artistSessionKey(descriptor, { key: 'online:p:artist:7' })).toBe('online:p:artist:7');
        expect(artistSessionKey(descriptor, null)).toBe('online:p:artist:7');
        // 本地歌手的描述 id 在 catalog 就绪后会被改写：资源的 key 才是稳定的那个。
        const localDescriptor = { source: 'local', type: 'artist', id: 'rewritten', name: 'L' } as LibraryCollectionDescriptor;
        expect(artistSessionKey(localDescriptor, { key: 'local:artist:original' })).toBe('local:artist:original');
    });

    it('gives songs and albums keys any suite can resolve back to a pane', () => {
        const songKey = artistSongEntryKey(song(3));
        expect(songKey.startsWith('song:')).toBe(true);
        expect(artistEntryPane(songKey)).toBe('songs');
        expect(artistAlbumEntryKey({ id: 42 })).toBe('album:42');
        expect(artistEntryPane('album:42')).toBe('albums');
        expect(artistEntryPane(null)).toBeNull();
        expect(artistEntryPane('intro')).toBeNull();
    });
});

describe('artist capabilities', () => {
    it('offers playing, queueing and opening once the artist is ready', () => {
        const capabilities = resolveArtistCapabilities({ collection: online, snapshot: snapshot(), ...counts });
        for (const action of ['play', 'enqueue', 'play-scope', 'enqueue-scope', 'filter', 'reload', 'open-album', 'open-artist'] as const) {
            expect(capabilities[action], action).toMatchObject({ supported: true, enabled: true });
        }
        expect(capabilities['resume-sync'].supported).toBe(false);
        expect(capabilities['edit-entity'].supported).toBe(false);
    });

    it('greys the top-song actions out while loading and when nothing is playable', () => {
        const loading = resolveArtistCapabilities({
            collection: online,
            snapshot: snapshot({ status: 'loading', detail: null, topSongs: [], albums: [] }),
            playableTopSongCount: 0,
            queueableTopSongCount: 0,
        });
        expect(loading['play-scope']).toMatchObject({ supported: true, enabled: false, reason: 'loading' });
        expect(loading.reload).toMatchObject({ supported: true, enabled: false, reason: 'loading' });
        expect(loading['open-album'].enabled).toBe(false);

        const unplayable = resolveArtistCapabilities({ collection: online, snapshot: snapshot(), playableTopSongCount: 0, queueableTopSongCount: 0 });
        expect(unplayable['play-scope']).toMatchObject({ enabled: false, reason: 'empty' });
        expect(unplayable['enqueue-scope']).toMatchObject({ enabled: false, reason: 'empty' });
        expect(resolveArtistCapabilities({ collection: online, snapshot: null, playableTopSongCount: 0, queueableTopSongCount: 0 }).play.reason).toBe('loading');
    });

    it('reloads online and Navidrome artists, and any artist that failed; a local one only edits', () => {
        expect(resolveArtistCapabilities({ collection: { source: 'navidrome' }, snapshot: snapshot(), ...counts }).reload.enabled).toBe(true);
        const localReady = resolveArtistCapabilities({ collection: local, snapshot: snapshot(), ...counts });
        expect(localReady.reload.supported).toBe(false);
        expect(localReady['edit-entity']).toMatchObject({ supported: true, enabled: true });
        expect(resolveArtistCapabilities({ collection: { source: 'local' }, snapshot: snapshot(), ...counts })['edit-entity'].supported).toBe(false);
        const failed = resolveArtistCapabilities({ collection: local, snapshot: snapshot({ status: 'error', error: 'load-failed', detail: null }), ...counts });
        expect(failed.reload).toMatchObject({ supported: true, enabled: true });
    });

    it('resumes album paging only after a page failed (a paused one resumes by itself)', () => {
        const failed = snapshot({ albumSync: { state: 'interrupted', offset: 50, reason: 'failed' } });
        const paused = snapshot({ albumSync: { state: 'interrupted', offset: 50, reason: 'paused' } });
        expect(resolveArtistCapabilities({ collection: online, snapshot: failed, ...counts })['resume-sync'].enabled).toBe(true);
        expect(resolveArtistCapabilities({ collection: online, snapshot: paused, ...counts })['resume-sync'].supported).toBe(false);
    });
});

describe('artist command surface', () => {
    it('maps every palette action onto a declared artist action', () => {
        for (const source of Object.values(ARTIST_SURFACE_ACTION_SOURCES)) {
            expect(LIBRARY_ARTIST_ACTION_IDS).toContain(source);
        }
    });

    it('publishes enabled capabilities intersected with the declaration, in a fixed order', () => {
        const failed = snapshot({ albumSync: { state: 'interrupted', offset: 50, reason: 'failed' } });
        const capabilities = resolveArtistCapabilities({ collection: local, snapshot: failed, ...counts });
        expect(resolveArtistSurfaceActions(capabilities)).toEqual(['play-top-songs', 'enqueue-top-songs', 'retry-albums', 'edit-entity']);
        expect(resolveArtistSurfaceActions(capabilities, { actions: ['play-scope', 'edit-entity'], extraActions: [] }))
            .toEqual(['play-top-songs', 'edit-entity']);
        const onlineCapabilities = resolveArtistCapabilities({ collection: online, snapshot: snapshot(), ...counts });
        expect(resolveArtistSurfaceActions(onlineCapabilities, ALL_DECLARED)).toEqual(['play-top-songs', 'enqueue-top-songs', 'reload']);
    });

    it('offers a suite entry when declared and supported, even while it is not enabled yet', () => {
        const loading = resolveArtistCapabilities({
            collection: local,
            snapshot: snapshot({ status: 'loading', detail: null, topSongs: [], albums: [] }),
            playableTopSongCount: 0,
            queueableTopSongCount: 0,
        });
        const offered = resolveOfferedArtistActions({ actions: ['enqueue-scope', 'edit-entity', 'reload'], extraActions: [] }, loading);
        expect(offered).toEqual(['enqueue-scope', 'edit-entity']);
    });

    it('keeps the newest registration when an older artist page unmounts late', () => {
        const handle = (): LibraryArtistSurfaceHandle => ({ getState: () => { throw new Error('unused'); }, run: () => true });
        const first = handle();
        const second = handle();
        const releaseFirst = useLibraryArtistSurfaceStore.getState().registerArtistSurface(first);
        const releaseSecond = useLibraryArtistSurfaceStore.getState().registerArtistSurface(second);
        releaseFirst();
        expect(useLibraryArtistSurfaceStore.getState().artistSurface).toBe(second);
        releaseSecond();
        expect(useLibraryArtistSurfaceStore.getState().artistSurface).toBeNull();
    });
});
