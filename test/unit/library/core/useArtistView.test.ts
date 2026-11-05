// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { LibraryArtistResource, LibraryArtistSnapshot } from '@/library/core/artist/artist.contract';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import type { LibraryPlaybackPort } from '@/library/core/shared/ports.contract';
import { LIBRARY_ARTIST_ACTION_IDS } from '@/library/core/suite/librarySuites';

// test/unit/library/core/useArtistView.test.ts
// 歌手页视图里的「全部歌曲」（#918）：宿主给了压栈的口子才出现（能力、命令面板的动作），执行时压进去的是
// core 的 artistSongsCollection 给的那一层在线集合，名字按 artistGrid.allSongsCollectionName 翻译。

vi.mock('react-i18next', async importOriginal => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string, options?: { artistName?: string }) => `${key}|${options?.artistName ?? ''}` }),
}));
vi.mock('@/library/core/collection/cover/useLocalCollectionCoverUrls', () => ({
    useLocalCollectionCoverUrls: () => new Map<string, string>(),
}));

const { useArtistView } = await import('@/library/core/artist/useArtistView');
type ArtistView = ReturnType<typeof useArtistView>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const song = (id: number): SongResult => ({ id, name: `Song ${id}`, artists: [], album: { id: 0, name: '' }, duration: 1000 } as unknown as SongResult);
const artist = { source: 'online', providerId: 'p', type: 'artist', id: 7, name: 'Listed' } as LibraryCollectionDescriptor;
const snapshot = (overrides: Partial<LibraryArtistSnapshot> = {}): LibraryArtistSnapshot => ({
    key: 'online:p:artist:7',
    status: 'ready',
    detail: { name: 'Main', coverUrl: 'cover.jpg', trackCount: 321 },
    topSongs: [song(1), song(2)],
    hasMoreSongs: true,
    albums: [],
    albumSync: { state: 'none' },
    error: null,
    hint: 'urgent',
    ...overrides,
});
const resource = { key: 'online:p:artist:7' } as unknown as LibraryArtistResource;
const playback = {} as LibraryPlaybackPort;

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
});

const renderView = (props: { snapshot: LibraryArtistSnapshot; onOpenCollection?: (collection: LibraryCollectionDescriptor) => void }) => {
    let view: ArtistView | null = null;
    const Probe = () => {
        view = useArtistView({
            collection: artist,
            resource,
            snapshot: props.snapshot,
            playback,
            declaredActions: { actions: LIBRARY_ARTIST_ACTION_IDS, extraActions: [] },
            onOpenCollection: props.onOpenCollection,
            setStatus: () => {},
        });
        return null;
    };
    root = createRoot(document.createElement('div'));
    act(() => root!.render(React.createElement(Probe)));
    return view as unknown as ArtistView;
};

describe('useArtistView: all songs', () => {
    it('offers it only when the host can push a collection', () => {
        const without = renderView({ snapshot: snapshot() });
        expect(without.capabilities['open-all-songs'].supported).toBe(false);
        expect(without.offers('open-all-songs')).toBe(false);
        expect(without.surfaceState().availableActions).not.toContain('open-all-songs');
        expect(without.runSurface('open-all-songs')).toBe(false);
    });

    it('pushes the artist\'s songs as an online collection from the palette and the page', () => {
        const onOpenCollection = vi.fn();
        const view = renderView({ snapshot: snapshot(), onOpenCollection });
        expect(view.offers('open-all-songs')).toBe(true);
        expect(view.surfaceState().availableActions).toContain('open-all-songs');
        expect(view.runSurface('open-all-songs')).toBe(true);
        expect(onOpenCollection).toHaveBeenCalledWith({
            source: 'online',
            providerId: 'p',
            id: 7,
            type: 'artist_songs',
            name: 'artistGrid.allSongsCollectionName|Main',
            isOwned: false,
            artists: [{ id: 7, name: 'Main' }],
            coverUrl: 'cover.jpg',
            trackCount: 321,
        });
        view.actions.openAllSongs();
        expect(onOpenCollection).toHaveBeenCalledTimes(2);
    });

    it('does nothing before the artist is ready, or when nothing lies past the top songs', () => {
        const onOpenCollection = vi.fn();
        const loading = renderView({ snapshot: snapshot({ status: 'loading', detail: null }), onOpenCollection });
        expect(loading.offers('open-all-songs')).toBe(true);
        expect(loading.runSurface('open-all-songs')).toBe(false);
        loading.actions.openAllSongs();
        act(() => root?.unmount());
        const topOnly = renderView({ snapshot: snapshot({ hasMoreSongs: false }), onOpenCollection });
        expect(topOnly.surfaceState().availableActions).not.toContain('open-all-songs');
        expect(topOnly.runSurface('open-all-songs')).toBe(false);
        expect(onOpenCollection).not.toHaveBeenCalled();
    });
});
