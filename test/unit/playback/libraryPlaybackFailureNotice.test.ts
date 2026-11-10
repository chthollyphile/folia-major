// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/libraryPlaybackFailureNotice.test.ts
// 本地与 Navidrome 点歌失败各自弹一条错误消息；这里锁定它们同样报告一次
// （hostExtensionHooks.notifyPlaybackFailed → Folium playback.failed），phase 'play'，没有原因码，不自动跳过。

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
    return {
        navidromeConfig: null as unknown,
        streamUrlError: null as Error | null,
        // Navidrome 匹配缓存的查询；用例用它在第一次网络等待之后才让加载失败。
        matchLookup: null as (() => Promise<unknown>) | null,
    };
});

vi.mock('@/services/db', () => ({
    getFromCache: async () => null,
    saveToCache: async () => {},
    removeFromCache: async () => {},
    getLocalSong: async () => null,
    getLocalSongs: async () => [],
    saveLocalSong: async () => {},
    saveLocalSongs: async () => {},
    getSessionData: async () => ({}),
    clearSession: async () => {},
    getCacheEntriesByPrefix: async () => [],
    getFromCacheWithMigration: () => env.matchLookup?.() ?? Promise.resolve(null),
}));
vi.mock('@/services/localMusicService', async importOriginal => ({
    ...(await importOriginal<typeof import('@/services/localMusicService')>()),
    getAudioFromLocalSong: vi.fn(async () => null),
}));
vi.mock('@/services/navidromeService', async importOriginal => {
    const actual = await importOriginal<typeof import('@/services/navidromeService')>();
    return {
        ...actual,
        getNavidromeConfig: () => env.navidromeConfig,
        navidromeApi: {
            ...actual.navidromeApi,
            getStreamUrl: () => {
                if (env.streamUrlError) throw env.streamUrlError;
                return 'https://navidrome.example/stream';
            },
            getSong: async () => null,
        },
    };
});

import React, { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useLibraryPlaybackController } from '@/components/app/playback/start/useLibraryPlaybackController';
import { startPlay } from '@/components/app/playback/currentSong';
import { installPlaybackFailedListener } from '@/services/hostExtensionHooks';
import { getAudioFromLocalSong } from '@/services/localMusicService';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import type { LocalSong } from '@/types';
import type { NavidromeSong } from '@/types/navidrome';

const localSong = {
    id: 'local-1',
    fileName: 'a.mp3',
    filePath: 'Music/a.mp3',
    title: 'Local Song',
    titleOrigin: 'import',
    importedMetadata: { title: 'Local Song', titleSource: 'filename', artistNames: ['Someone'] },
    duration: 100,
    fileSize: 1234,
    fileLastModified: 1000,
    mimeType: 'audio/mpeg',
    addedAt: 1,
    folderName: 'Music',
} as unknown as LocalSong;

const navidromeSong = {
    id: 'nd-1',
    name: 'Navi Song',
    artists: [{ id: 0, name: 'Band' }],
    album: { id: 0, name: 'Record' },
    durationMs: 1000,
    isNavidrome: true,
    navidromeData: { id: 'nd-1', streamUrl: 'https://navidrome.example/stream' },
} as unknown as NavidromeSong;

type Controller = {
    onPlayLocalSong: (song: LocalSong, queue?: LocalSong[]) => Promise<void>;
    onPlayNavidromeSong: (song: NavidromeSong, queue?: NavidromeSong[]) => Promise<void>;
};

const deferred = <T,>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const naviConfig = { serverUrl: 'https://navidrome.example', username: 'u', password: 'p' };

const listener = vi.fn();
let controller: Controller;
let root: Root;

const Probe: React.FC = () => {
    const anyRef = useRef<unknown>(null);
    const lyricsLoadingWrites = useRef(0);
    controller = useLibraryPlaybackController({
        likedSongIds: new Set<string>(),
        setLyrics: () => {},
        setIsLyricsLoading: () => {},
        setLikedSongIds: () => {},
        navigateToPlaybackView: () => {},
        persistLastPlaybackCache: async () => {},
        restoreCachedThemeForSong: async () => {},
        interruptStagePlaybackForMainTransition: () => null,
        blobUrlRef: anyRef,
        shouldAutoPlayRef: anyRef,
        currentSongRef: anyRef,
        currentOnlineAudioUrlFetchedAtRef: anyRef,
        lyricsLoadingWritesRef: lyricsLoadingWrites,
    } as never) as unknown as Controller;
    return null;
};

beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    env.navidromeConfig = null;
    env.streamUrlError = null;
    env.matchLookup = null;
    listener.mockReset();
    installPlaybackFailedListener(listener);
    useStatusMessageStore.setState({ message: null });
    root = createRoot(document.createElement('div'));
    await act(async () => { root.render(React.createElement(Probe)); });
});

afterEach(async () => {
    installPlaybackFailedListener(null);
    await act(async () => { root.unmount(); });
    vi.restoreAllMocks();
});

describe('library playback failure reports', () => {
    it('reports a local song whose file cannot be read', async () => {
        await act(async () => { await controller.onPlayLocalSong(localSong); });
        expect(useStatusMessageStore.getState().message).toMatchObject({ type: 'error', text: expect.any(String) });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({
            song: expect.objectContaining({ name: 'Local Song', localRef: expect.objectContaining({ songId: 'local-1' }) }),
            reason: null,
            phase: 'play',
            willAutoSkip: false,
        });
    });

    it('reports a Navidrome song when Navidrome is not configured', async () => {
        await act(async () => { await controller.onPlayNavidromeSong(navidromeSong); });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({ song: navidromeSong, reason: null, phase: 'play', willAutoSkip: false });
    });

    it('reports a Navidrome song whose load threw, with the carrier itself', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        env.navidromeConfig = naviConfig;
        env.streamUrlError = new Error('stream url failed');
        await act(async () => { await controller.onPlayNavidromeSong(navidromeSong); });
        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({ song: navidromeSong, reason: null, phase: 'play', willAutoSkip: false });
    });
});

// 等待期间用户换了歌（一次新的播放开始了，currentSong.ts 的 startPlay）：旧请求的失败已不是用户眼前的事，
// 既不提示也不报告（否则按契约在 willAutoSkip 为 false 时调 next() 的模组会跳过用户的新歌）。
describe('library playback failures of a replaced pick', () => {
    it('neither shows nor reports a local file read a newer play has replaced', async () => {
        const read = deferred<string | null>();
        vi.mocked(getAudioFromLocalSong).mockReturnValueOnce(read.promise);
        let playing!: Promise<void>;
        act(() => { playing = controller.onPlayLocalSong(localSong, []); });

        startPlay();
        await act(async () => { read.resolve(null); await playing; });
        expect(useStatusMessageStore.getState().message).toBeNull();
        expect(listener).not.toHaveBeenCalled();
    });

    it('reports only the latest of two overlapping library plays', async () => {
        const firstRead = deferred<string | null>();
        vi.mocked(getAudioFromLocalSong).mockReturnValueOnce(firstRead.promise);
        let first!: Promise<void>;
        act(() => { first = controller.onPlayLocalSong(localSong); });
        await act(async () => { await controller.onPlayLocalSong(localSong); });
        expect(listener).toHaveBeenCalledOnce();

        await act(async () => { firstRead.resolve(null); await first; });
        expect(listener).toHaveBeenCalledOnce();
    });

    it.each([
        ['still the latest pick', true, 1],
        ['replaced by a newer pick', false, 0],
    ] as const)('handles a Navidrome load that fails after a network wait while %s', async (_case, stillCurrent, reports) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        env.navidromeConfig = naviConfig;
        const lookup = deferred<unknown>();
        env.matchLookup = () => lookup.promise;
        let playing!: Promise<void>;
        act(() => { playing = controller.onPlayNavidromeSong(navidromeSong, []); });

        if (!stillCurrent) startPlay();
        await act(async () => { lookup.reject(new Error('cache read failed')); await playing; });
        expect(listener).toHaveBeenCalledTimes(reports);
        expect(useStatusMessageStore.getState().message).toEqual(
            reports ? expect.objectContaining({ type: 'error' }) : null,
        );
    });
});
