// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
        clear: () => values.clear(),
    } });
});
vi.mock('@/services/db', () => ({
    getFromCache: async () => null, saveToCache: async () => {}, removeFromCache: async () => {},
    getLocalSong: async () => null, getLocalSongs: async () => [], saveLocalSong: async () => {},
    saveLocalSongs: async () => {}, getSessionData: async () => ({}), clearSession: async () => {},
    getCacheEntriesByPrefix: async () => [], getFromCacheWithMigration: async () => null,
}));
vi.mock('@/services/localMusicService', async original => ({
    ...(await original<typeof import('@/services/localMusicService')>()),
    getAudioFromLocalSong: vi.fn(),
    ensureLocalSongCoverAsset: async (song: unknown) => song,
}));
vi.mock('@/utils/lyrics/localSongLyrics', () => ({ resolveLocalSongLyrics: vi.fn() }));
vi.mock('@/services/localLibraryEntityRepository', () => ({
    getLocalLibraryCatalogSnapshot: async () => ({ entities: [], assignments: [] }),
}));
vi.mock('@/services/coverCache', () => ({ getCachedCoverUrl: () => null, loadCachedOrFetchCover: vi.fn() }));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLibraryPlaybackController } from '@/hooks/useLibraryPlaybackController';
import { getAudioFromLocalSong } from '@/services/localMusicService';
import { loadCachedOrFetchCover } from '@/services/coverCache';
import { resolveLocalSongLyrics } from '@/utils/lyrics/localSongLyrics';
import { beginPlaybackRequest, invalidatePlaybackRequest } from '@/services/playbackRequest';
import { acquireExternalPlayback, releaseAllExternalPlayback, releaseExternalPlayback } from '@/services/externalPlaybackSession';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import type { LocalSong, LyricData } from '@/types';

// test/unit/playback/localPlaybackCommittedMetadata.test.ts
// Requests may be superseded without replacing the audible source: background metadata follows
// the committed source until an actual source replacement or an external-session boundary.
const initialState = usePlaybackStore.getState();
const localSong = {
    id: 'local-a', fileName: 'a.mp3', filePath: 'Music/a.mp3', title: 'Local A', titleOrigin: 'import',
    importedMetadata: { title: 'Local A', titleSource: 'filename', artistNames: ['Someone'] },
    duration: 100, fileSize: 1234, fileLastModified: 1000, mimeType: 'audio/mpeg', addedAt: 1,
    folderName: 'Music', markedPureMusic: true, useOnlineCover: true,
    onlineMetadata: { coverUrl: 'https://example.invalid/a-cover' },
} as LocalSong;
const source = 'https://example.invalid/local-source';
const ref = <T,>(value: T) => ({ current: value });
const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const metadataValue = { lyrics: { lines: [] } as unknown as LyricData, source: null };
let root: Root;
let controller: ReturnType<typeof useLibraryPlaybackController>;
let input: Parameters<typeof useLibraryPlaybackController>[0];

beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    usePlaybackStore.setState(initialState, true);
    vi.mocked(getAudioFromLocalSong).mockResolvedValue(source);
    vi.mocked(resolveLocalSongLyrics).mockResolvedValue({ lyrics: null, source: null });
    vi.mocked(loadCachedOrFetchCover).mockResolvedValue('https://example.invalid/new-cover');
    input = {
        likedSongIds: new Set(), setLyrics: vi.fn(), setIsLyricsLoading: vi.fn(), setLikedSongIds: vi.fn(),
        navigateToPlaybackView: vi.fn(), persistLastPlaybackCache: vi.fn(async () => {}),
        restoreCachedThemeForSong: vi.fn(async () => {}), interruptStagePlaybackForMainTransition: () => null,
        blobUrlRef: ref(null), shouldAutoPlayRef: ref(false), currentSongRef: ref(null),
        currentOnlineAudioUrlFetchedAtRef: ref(null),
    };
    root = createRoot(document.createElement('div'));
    await act(async () => { root.render(React.createElement(() => {
        controller = useLibraryPlaybackController(input);
        return null;
    })); });
});

afterEach(async () => {
    await act(async () => { root.unmount(); });
    releaseAllExternalPlayback();
    invalidatePlaybackRequest();
    vi.restoreAllMocks();
});

async function commitWithPendingMetadata() {
    const metadata = deferred<Awaited<ReturnType<typeof resolveLocalSongLyrics>>>();
    const cover = deferred<string | null>();
    vi.mocked(resolveLocalSongLyrics)
        .mockResolvedValueOnce({ lyrics: null, source: null })
        .mockReturnValueOnce(metadata.promise);
    vi.mocked(loadCachedOrFetchCover).mockReturnValueOnce(cover.promise);
    await act(async () => { await controller.onPlayLocalSong(localSong); });
    expect(usePlaybackStore.getState().audioSrc).toBe(source);
    expect(input.setIsLyricsLoading).toHaveBeenLastCalledWith(true);
    return { metadata, cover };
}

it.each(['cancelled', 'unreadable-file'] as const)('finishes current metadata after a later %s pick', async outcome => {
    const { metadata, cover } = await commitWithPendingMetadata();
    if (outcome === 'cancelled') {
        beginPlaybackRequest().finish('cancelled');
    } else {
        vi.mocked(getAudioFromLocalSong).mockResolvedValueOnce(null);
        await act(async () => { await controller.onPlayLocalSong({ ...localSong, id: 'local-b' }); });
    }
    await act(async () => {
        metadata.resolve(metadataValue);
        cover.resolve('https://example.invalid/a-cover-ready');
    });
    expect(usePlaybackStore.getState().audioSrc).toBe(source);
    expect(input.setLyrics).toHaveBeenLastCalledWith(metadataValue.lyrics);
    expect(input.setIsLyricsLoading).toHaveBeenLastCalledWith(false);
    expect(usePlaybackStore.getState().cachedCoverUrl).toBe('https://example.invalid/a-cover-ready');
});

it('clears current loading when its metadata fails after a later pick is cancelled', async () => {
    const { metadata, cover } = await commitWithPendingMetadata();
    beginPlaybackRequest().finish('cancelled');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => { metadata.reject(new Error('metadata failed')); cover.resolve(null); });
    expect(input.setIsLyricsLoading).toHaveBeenLastCalledWith(false);
});

it.each(['acquire', 'acquire-release'] as const)('drops pending metadata across %s even if the song and URL are unchanged', async boundary => {
    const { metadata, cover } = await commitWithPendingMetadata();
    const token = acquireExternalPlayback({ modId: 'test', cleanup: vi.fn(), dispatch: vi.fn(), report: vi.fn() });
    if (boundary === 'acquire-release') releaseExternalPlayback(token);
    const previousCalls = vi.mocked(input.setLyrics).mock.calls.length;
    await act(async () => { metadata.resolve(metadataValue); cover.resolve('https://example.invalid/stale-cover'); });
    expect(input.setLyrics).toHaveBeenCalledTimes(previousCalls);
    expect(usePlaybackStore.getState().cachedCoverUrl).not.toBe('https://example.invalid/stale-cover');
});

it('drops metadata from an older load after the same local song and URL have been committed again', async () => {
    const { metadata, cover } = await commitWithPendingMetadata();
    await act(async () => { await controller.onPlayLocalSong(localSong); });
    const previousCalls = vi.mocked(input.setLyrics).mock.calls.length;
    await act(async () => { metadata.resolve(metadataValue); cover.resolve('https://example.invalid/stale-cover'); });
    expect(usePlaybackStore.getState().audioSrc).toBe(source);
    expect(input.setLyrics).toHaveBeenCalledTimes(previousCalls);
    expect(usePlaybackStore.getState().cachedCoverUrl).toBe('https://example.invalid/new-cover');
});
