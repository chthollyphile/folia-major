// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// test/unit/player-panel/playerPanelLikedState.test.ts
// 播放器面板红心的响应性。App 把 isLocalSongLiked 经 useStableActionSurface 交给面板，
// 身份永久不变，所以任何以它为依赖的 memo 都会永远停在第一帧的答案。

vi.hoisted(() => {
    // jsdom 环境下 node 自带的 localStorage 占位没有 getItem，i18n 初始化会直接抛。
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
});

import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePlayerPanelModel } from '@/components/app/player-panel/usePlayerPanelModel';
import { useStableActionSurface } from '@/hooks/useStableCallbacks';
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import type { SongResult } from '@/types';

// 必须是常量：App 传进来的是稳定的 Set，每帧新建会让 memo 无条件重算，掩盖问题。
const emptyLocalLibraryCatalog = { entities: [], assignments: [] };

const localSong = {
    id: 'local-song-1',
    name: 'Song 1',
    isLocal: true,
    localRef: { songId: 'local-song-1' },
    artists: [],
} as unknown as SongResult;

describe('player panel liked state', () => {
    it('follows the local favorite set even though isLocalSongLiked keeps one identity', async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        usePlaybackStore.setState({ currentSong: localSong } as never);

        const likedStates: boolean[] = [];
        const likedCheckers = new Set<unknown>();
        let setFavoriteSongIds: (songIds: string[]) => void = () => {};

        const Probe: React.FC = () => {
            const [favoriteSongIds, setSongIds] = useState<string[]>([]);
            setFavoriteSongIds = setSongIds;
            // App 的真实形态：收藏数据每次变化都会换新闭包，但交出去的函数身份是永久的。
            const surface = useStableActionSurface({
                isLocalSongLiked: (song: SongResult | null) => Boolean(
                    song && favoriteSongIds.includes((song as { localRef?: { songId?: string } }).localRef?.songId || ''),
                ),
            });
            likedCheckers.add(surface.isLocalSongLiked);
            const model = usePlayerPanelModel({
                isLocalSongLiked: surface.isLocalSongLiked,
                shouldHidePlayerRightPanelButton: false,
                localSongs: [],
                localLibraryCatalog: emptyLocalLibraryCatalog,
                navigateToCollection: () => {},
                currentSong: localSong,
                playQueue: [],
            } as never);
            likedStates.push(model.panelProps.playback.isLiked);
            return null;
        };

        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(React.createElement(Probe)); });
        expect(likedStates.at(-1)).toBe(false);

        await act(async () => { setFavoriteSongIds(['local-song-1']); });

        expect(likedCheckers.size).toBe(1);
        expect(likedStates.at(-1)).toBe(true);
        await act(async () => { root.unmount(); });
    });

    it('follows a press on an online song at once, and goes back when its request fails', async () => {
        (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const providerId = 'panel-like-press-test';
        const onlineSong = {
            id: 'song-1',
            name: 'Song 1',
            artists: [],
            album: { id: '', name: '' },
            durationMs: 1,
            sourceRef: { kind: 'online', providerId, mediaId: 'song-1' },
        } as unknown as SongResult;
        // The provider answers when the test says so.
        let refuse: (error: unknown) => void = () => {};
        registerOnlineMusicProvider({
            id: providerId,
            displayName: providerId,
            capabilities: { mutations: true, likes: true },
            normalizeSong: () => onlineSong,
            mutations: { likeSong: () => new Promise<void>((_take, reject) => { refuse = reject; }) },
        } as never);
        // The account is there before the press, so the press changes nothing but what is wanted.
        useOnlineProviderAccountStore.getState().updateAccount(providerId, { likedSongIds: [] });
        usePlaybackStore.setState({ currentSong: onlineSong } as never);

        const likedStates: boolean[] = [];
        const Probe: React.FC = () => {
            const model = usePlayerPanelModel({
                isLocalSongLiked: () => false,
                shouldHidePlayerRightPanelButton: false,
                localSongs: [],
                localLibraryCatalog: emptyLocalLibraryCatalog,
                navigateToCollection: () => {},
                currentSong: onlineSong,
                playQueue: [],
            } as never);
            likedStates.push(model.panelProps.playback.isLiked);
            return null;
        };

        const root = createRoot(document.createElement('div'));
        await act(async () => { root.render(React.createElement(Probe)); });
        expect(likedStates.at(-1)).toBe(false);

        let settled: Promise<unknown> = Promise.resolve();
        await act(async () => { settled = omni.pressSongLike(onlineSong).settled; });
        // The provider has not answered yet.
        expect(likedStates.at(-1)).toBe(true);

        await act(async () => {
            refuse(new Error('offline'));
            await settled;
        });
        expect(likedStates.at(-1)).toBe(false);

        await act(async () => { root.unmount(); });
        unregisterOnlineMusicProvider(providerId);
    });
});
