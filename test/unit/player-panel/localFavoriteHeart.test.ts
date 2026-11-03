// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// test/unit/player-panel/localFavoriteHeart.test.ts
// 本地收藏的端到端回归：点一次红心之后，面板上的红心必须当场变亮。
// 两条曾经各自让它失效的路径都在这里：memo 依赖用了身份恒定的 isLocalSongLiked，
// 以及重复导入的副本被写成 canonical id 后读不回来。

const env = vi.hoisted(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        value: {
            getItem: (key: string) => (entries.has(key) ? entries.get(key)! : null),
            setItem: (key: string, value: string) => { entries.set(key, String(value)); },
            removeItem: (key: string) => { entries.delete(key); },
            clear: () => { entries.clear(); },
            key: (index: number) => Array.from(entries.keys())[index] ?? null,
            get length() { return entries.size; },
        },
        configurable: true,
        writable: true,
    });
    return { cache: new Map<string, unknown>(), songs: [] as unknown[] };
});

vi.mock('@/services/db', () => ({
    getFromCache: async (key: string) => env.cache.get(key) ?? null,
    saveToCache: async (key: string, data: unknown) => { env.cache.set(key, data); },
    removeFromCache: async (key: string) => { env.cache.delete(key); },
    getLocalSongs: async () => env.songs,
    saveLocalSongs: async () => {},
    getSessionData: async () => ({}),
    clearSession: async () => {},
    getCacheEntriesByPrefix: async () => [],
    getFromCacheWithMigration: async () => null,
}));

import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useLibraryPlaybackController } from '@/components/app/playback/start/useLibraryPlaybackController';
import { usePlayerPanelModel } from '@/components/app/player-panel/usePlayerPanelModel';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import type { LocalSong, SongResult } from '@/types';

const localSongRecord = (id: string, filePath: string, addedAt: number): LocalSong => ({
    id,
    fileName: filePath.split('/').pop() || 'song.mp3',
    filePath,
    title: 'Song 1',
    titleOrigin: 'import',
    importedMetadata: { title: 'Song 1', titleSource: 'filename', artistNames: [] },
    duration: 100,
    fileSize: 1234,
    fileLastModified: 1000,
    mimeType: 'audio/mpeg',
    addedAt,
    folderName: filePath.split('/').slice(0, -1).join('/'),
} as LocalSong);

const canonicalSong = localSongRecord('song-canonical', 'Music/a.mp3', 100);
const duplicateSong = localSongRecord('song-duplicate', 'Music (2)/a.mp3', 200);
const playingDuplicate = {
    id: 'song-duplicate',
    name: 'Song 1',
    isLocal: true,
    localRef: { songId: 'song-duplicate' },
    artists: [],
} as unknown as SongResult;

const emptyLocalLibraryCatalog = { entities: [], assignments: [] };

describe('local favorite heart', () => {
    it('lights the panel heart after favoriting a repeated import', async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        env.cache = new Map();
        env.songs = [canonicalSong, duplicateSong];
        usePlaybackStore.setState({ currentSong: playingDuplicate } as never);

        const likedStates: boolean[] = [];
        let handleLike: () => Promise<void> = async () => {};
        let loadLocalSongs: () => Promise<void> = async () => {};

        const Probe: React.FC = () => {
            const anyRef = useRef<unknown>(null);
            const controller = useLibraryPlaybackController({
                setLyrics: () => {},
                setIsLyricsLoading: () => {},
                navigateToPlaybackView: () => {},
                persistLastPlaybackCache: async () => {},
                restoreCachedThemeForSong: async () => {},
                interruptStagePlaybackForMainTransition: () => null,
                blobUrlRef: anyRef,
                shouldAutoPlayRef: anyRef,
                currentOnlineAudioUrlFetchedAtRef: anyRef,
            } as never) as {
                handleLike: () => Promise<void>;
                loadLocalSongs: () => Promise<void>;
                isLocalSongLiked: (song: SongResult | null) => boolean;
            };
            handleLike = controller.handleLike;
            loadLocalSongs = controller.loadLocalSongs;
            const model = usePlayerPanelModel({
                isLocalSongLiked: controller.isLocalSongLiked,
                shouldHidePlayerRightPanelButton: false,
                localSongs: [],
                localLibraryCatalog: emptyLocalLibraryCatalog,
                navigateToCollection: () => {},
                currentSong: playingDuplicate,
                playQueue: [],
            } as never);
            likedStates.push(model.panelProps.playback.isLiked);
            return null;
        };

        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(React.createElement(Probe)); });
        await act(async () => { await loadLocalSongs(); });
        expect(likedStates.at(-1)).toBe(false);

        await act(async () => { await handleLike(); });
        expect(likedStates.at(-1)).toBe(true);

        await act(async () => { await handleLike(); });
        expect(likedStates.at(-1)).toBe(false);

        await act(async () => { root.unmount(); });
    });
});
