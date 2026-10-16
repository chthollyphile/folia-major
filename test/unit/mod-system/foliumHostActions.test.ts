// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
        },
    });
});
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { SongResult } from '@/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { resolveFoliumSongRef, toFoliumSong } from '@/mods/folium/dto';
import { useFoliumHostActions, type FoliumAppActions } from '@/mods/folium/hostActions';
import { createFoliumPlaybackService } from '@/mods/folium/services';
import type { ModRuntimeInfo } from '@/mods/types';

// test/unit/mod-system/foliumHostActions.test.ts
// The App side of folium.playback's Folium 1.3 additions: shuffle and like
// follow the same availability rules as the player bar's slots, and
// playback.likeChanged follows the liked value getState() reports.
// Folium 1.5: volume, mute and repeat mode go through the audio settings
// store's own setters; getQueue pages the store queue around the displayed
// song, and a page's refs stay valid when the ref pool is full; playQueueItem
// plays an entry with the store's own queue array, so a failed play's retry
// and skip follow the live queue.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mod: ModRuntimeInfo = {
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: ['playback.control'],
    status: 'loaded', error: null, enabled: true, trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: null,
};

const song = (id: number) => ({ id, name: `song ${id}` }) as unknown as SongResult;

const appActions = (overrides: Partial<FoliumAppActions> = {}): FoliumAppActions => ({
    sessionTransport: { stop: vi.fn(), seek: vi.fn() },
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(), seekToLyricTime: vi.fn(),
    next: vi.fn(), previous: vi.fn(), playSong: vi.fn(), playQueueSong: vi.fn(), enqueue: vi.fn(),
    navigateToPlayer: vi.fn(), navigateToHome: vi.fn(),
    shuffleQueue: vi.fn(), toggleLike: vi.fn(), openVolume: vi.fn(),
    isLiked: false, controlsDisabled: false,
    ...overrides,
});

const Harness: React.FC<{ actions: FoliumAppActions }> = ({ actions }) => {
    useFoliumHostActions(actions);
    return null;
};

let root: Root | null = null;
const render = (actions: FoliumAppActions) => {
    if (!root) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    act(() => root!.render(React.createElement(Harness, { actions })));
};

const initialPlayback = usePlaybackStore.getState();
const initialAudio = useAudioSettingsStore.getState();
beforeEach(() => {
    usePlaybackStore.setState(initialPlayback, true);
    useAudioSettingsStore.setState(initialAudio, true);
    useStatusMessageStore.setState({ message: null });
});
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    removeFoliumEventHandlers('mod-a');
    document.body.replaceChildren();
});

describe('folium host actions', () => {
    it('shuffles only a queue the player bar could shuffle', () => {
        const actions = appActions();
        render(actions);
        const playback = createFoliumPlaybackService(mod, 'main');

        usePlaybackStore.setState({ playQueue: [song(1)], isFmMode: false });
        expect(playback.shuffleQueue()).toBe(false);

        usePlaybackStore.setState({ playQueue: [song(1), song(2)], isFmMode: true });
        expect(playback.shuffleQueue()).toBe(false);

        usePlaybackStore.setState({ playQueue: [song(1), song(2)], isFmMode: false, activePlaybackContext: 'stage' });
        expect(playback.shuffleQueue()).toBe(false);
        expect(actions.shuffleQueue).not.toHaveBeenCalled();

        usePlaybackStore.setState({ activePlaybackContext: 'main' });
        expect(playback.shuffleQueue()).toBe(true);
        expect(actions.shuffleQueue).toHaveBeenCalledTimes(1);
    });

    it('does not like when there is no song', () => {
        const actions = appActions({ isLiked: true });
        render(actions);
        const playback = createFoliumPlaybackService(mod, 'main');
        expect(playback.getState()).toMatchObject({ song: null, liked: false, canLike: false });
        expect(playback.toggleLike()).toBe(false);
        expect(actions.toggleLike).not.toHaveBeenCalled();
    });

    it('emits playback.likeChanged when the liked value changes, not on first render', () => {
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.likeChanged', handler);
        render(appActions({ isLiked: false }));
        expect(handler).not.toHaveBeenCalled();
        render(appActions({ isLiked: true }));
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0]).toEqual({ liked: true });
        render(appActions({ isLiked: true }));
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('folium volume, mute and repeat mode', () => {
    it('reads and writes the audio settings store; volume leaves the mute switch alone', () => {
        render(appActions());
        const playback = createFoliumPlaybackService(mod, 'main');
        useAudioSettingsStore.setState({ volume: 0.6, isMuted: true, loopMode: 'off' });
        expect(playback.getVolume()).toEqual({ volume: 0.6, muted: true });

        playback.setVolume(0.3);
        expect(useAudioSettingsStore.getState()).toMatchObject({ volume: 0.3, isMuted: true });
        expect(localStorage.getItem('player_volume')).toBe('0.3');

        playback.setMuted(false);
        expect(useAudioSettingsStore.getState()).toMatchObject({ volume: 0.3, isMuted: false });
        expect(localStorage.getItem('player_is_muted')).toBe('false');
        expect(playback.getVolume()).toEqual({ volume: 0.3, muted: false });

        // A stored value outside 0–1 (the store never clamped on read) is reported clamped.
        useAudioSettingsStore.setState({ volume: 1.4 });
        expect(playback.getVolume().volume).toBe(1);
    });

    it('sets the repeat mode with the repeat button toast, and does nothing for the mode in effect', () => {
        render(appActions());
        const playback = createFoliumPlaybackService(mod, 'main');
        expect(playback.getLoopMode()).toBe('off');

        playback.setLoopMode('all');
        expect(playback.getLoopMode()).toBe('all');
        expect(localStorage.getItem('player_loop_mode')).toBe('all');
        const fromMod = useStatusMessageStore.getState().message;

        // The host's repeat button, from the same starting point, toasts the same message.
        useAudioSettingsStore.setState({ loopMode: 'off' });
        useStatusMessageStore.setState({ message: null });
        useAudioSettingsStore.getState().handleToggleLoopMode();
        const fromButton = useStatusMessageStore.getState().message;
        expect(fromMod).toMatchObject({ type: 'success', nonce: expect.any(Number) });
        expect({ type: fromMod?.type, text: fromMod?.text }).toEqual({ type: fromButton?.type, text: fromButton?.text });

        useStatusMessageStore.setState({ message: null });
        localStorage.removeItem('player_loop_mode');
        playback.setLoopMode('all');
        expect(useStatusMessageStore.getState().message).toBeNull();
        expect(localStorage.getItem('player_loop_mode')).toBeNull();
    });

    it('sets the repeat mode during Stage playback too, like the remote window does', () => {
        render(appActions({ controlsDisabled: true }));
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        createFoliumPlaybackService(mod, 'main').setLoopMode('one');
        expect(useAudioSettingsStore.getState().loopMode).toBe('one');
    });
});

describe('folium play queue', () => {
    const songs = (count: number, from = 0) => Array.from({ length: count }, (_, index) => song(from + index));

    it('centres the default page on the displayed song, clamped to the ends of the queue', () => {
        render(appActions());
        const playback = createFoliumPlaybackService(mod, 'main');
        const queue = songs(1000);

        usePlaybackStore.setState({ playQueue: queue, currentSong: { ...queue[600] } as SongResult });
        let page = playback.getQueue();
        expect(page).toMatchObject({ length: 1000, currentIndex: 600, kind: 'queue' });
        expect(page.items).toHaveLength(500);
        expect(page.items[0].index).toBe(350);
        expect(page.items[499].index).toBe(849);

        usePlaybackStore.setState({ currentSong: queue[950] });
        page = playback.getQueue({ limit: 100 });
        expect(page.items.map((item) => item.index)).toEqual(Array.from({ length: 100 }, (_, index) => 900 + index));

        usePlaybackStore.setState({ currentSong: queue[10] });
        expect(playback.getQueue({ limit: 100 }).items[0].index).toBe(0);

        // Not in the queue: from the top.
        usePlaybackStore.setState({ currentSong: song(5000) });
        page = playback.getQueue({ limit: 20 });
        expect(page.currentIndex).toBe(-1);
        expect(page.items[0].index).toBe(0);
        expect(page.items).toHaveLength(20);
    });

    it('pages from a given offset, clamped to the queue', () => {
        render(appActions());
        const playback = createFoliumPlaybackService(mod, 'main');
        usePlaybackStore.setState({ playQueue: songs(30), currentSong: null });
        expect(playback.getQueue({ offset: 25, limit: 10 }).items.map((item) => item.index)).toEqual([25, 26, 27, 28, 29]);
        expect(playback.getQueue({ offset: -4, limit: 2 }).items.map((item) => item.index)).toEqual([0, 1]);
        const past = playback.getQueue({ offset: 99 });
        expect(past.items).toEqual([]);
        expect(past.length).toBe(30);
    });

    it('returns frozen entries whose refs resolve to the queue songs', () => {
        render(appActions());
        const queue = songs(3);
        usePlaybackStore.setState({ playQueue: queue });
        const page = createFoliumPlaybackService(mod, 'main').getQueue();
        expect(Object.isFrozen(page)).toBe(true);
        expect(Object.isFrozen(page.items)).toBe(true);
        expect(Object.isFrozen(page.items[0])).toBe(true);
        expect(page.items[1].song.title).toBe('song 1');
        expect(resolveFoliumSongRef(page.items[1].song.ref)).toBe(queue[1]);
    });

    it('keeps every ref of the page it returns when the ref pool is full', async () => {
        const actions = appActions();
        render(actions);
        const playback = createFoliumPlaybackService(mod, 'main');
        const mintFillers = (count: number, from: number) => {
            for (let filler = 0; filler < count; filler += 1) toFoliumSong(song(from + filler));
        };
        // The first entry's ref is the oldest in a full pool (2,000) and the second has none yet: minting
        // the second must not evict the ref the same page has just handed out for the first.
        const [first, second] = [song(1), song(2)];
        const firstRef = toFoliumSong(first)!.ref;
        mintFillers(1999, 10_000);
        usePlaybackStore.setState({ playQueue: [first, second] });
        const { items } = playback.getQueue({ offset: 0, limit: 2 });
        expect(items[0].song.ref).toBe(firstRef);
        expect(items.map((item) => resolveFoliumSongRef(item.song.ref))).toEqual([first, second]);
        await expect(playback.playQueueItem(0, items[0].song.ref!)).resolves.toBe(true);
        expect((actions.playQueueSong as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(first);

        // Still bounded: reading the page counts as use, so the ref outlives 1,998 newer ones, not 2,000.
        mintFillers(1998, 20_000);
        expect(resolveFoliumSongRef(firstRef)).toBe(first);
        mintFillers(1, 30_000);
        expect(resolveFoliumSongRef(firstRef)).toBeNull();
    });

    it('counts a song listed twice at its first position, matched by playback key', () => {
        render(appActions());
        const [a, b] = songs(2);
        usePlaybackStore.setState({ playQueue: [b, { ...a } as SongResult, a], currentSong: { ...a } as SongResult });
        expect(createFoliumPlaybackService(mod, 'main').getQueue().currentIndex).toBe(1);
    });

    it('follows the displayed song during an automix blend', () => {
        render(appActions());
        const queue = songs(3);
        usePlaybackStore.setState({
            playQueue: queue,
            currentSong: queue[2],
            transitionDisplay: { song: queue[1], lyrics: null, coverUrl: null, duration: 200 },
        });
        expect(createFoliumPlaybackService(mod, 'main').getQueue().currentIndex).toBe(1);
    });

    it('reports Personal FM and Stage playback in kind', () => {
        render(appActions());
        const playback = createFoliumPlaybackService(mod, 'main');
        usePlaybackStore.setState({ playQueue: songs(2), isFmMode: true });
        expect(playback.getQueue().kind).toBe('fm');
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        expect(playback.getQueue().kind).toBe('stage');
        usePlaybackStore.setState({ activePlaybackContext: 'main', isFmMode: false, currentSong: { ...song(9), isStage: true } as SongResult });
        expect(playback.getQueue().kind).toBe('stage');
    });

    it('plays an entry with the store queue array itself', async () => {
        const actions = appActions();
        render(actions);
        const queue = songs(3);
        usePlaybackStore.setState({ playQueue: queue });
        await expect(createFoliumPlaybackService(mod, 'main').playQueueItem(1)).resolves.toBe(true);
        expect(actions.playQueueSong).toHaveBeenCalledTimes(1);
        const [played, passedQueue, isFm] = (actions.playQueueSong as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(played).toBe(queue[1]);
        expect(passedQueue).toBe(usePlaybackStore.getState().playQueue);
        expect(isFm).toBe(false);
    });

    it('keeps Personal FM on when playing from the FM queue', async () => {
        const actions = appActions();
        render(actions);
        usePlaybackStore.setState({ playQueue: songs(3), isFmMode: true });
        await expect(createFoliumPlaybackService(mod, 'main').playQueueItem(2)).resolves.toBe(true);
        expect((actions.playQueueSong as ReturnType<typeof vi.fn>).mock.calls[0][2]).toBe(true);
    });

    it('refuses an index out of range and Stage playback', async () => {
        const actions = appActions();
        render(actions);
        const playback = createFoliumPlaybackService(mod, 'main');
        usePlaybackStore.setState({ playQueue: songs(3) });
        await expect(playback.playQueueItem(3)).resolves.toBe(false);
        await expect(playback.playQueueItem(-1)).resolves.toBe(false);
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        await expect(playback.playQueueItem(0)).resolves.toBe(false);
        usePlaybackStore.setState({ activePlaybackContext: 'main', currentSong: { ...song(9), isStage: true } as SongResult });
        await expect(playback.playQueueItem(0)).resolves.toBe(false);
        expect(actions.playQueueSong).not.toHaveBeenCalled();
    });

    it('checks expectedRef by identity, then by playback key', async () => {
        const actions = appActions();
        render(actions);
        const playback = createFoliumPlaybackService(mod, 'main');
        usePlaybackStore.setState({ playQueue: songs(3) });
        const [first, second] = playback.getQueue().items;

        await expect(playback.playQueueItem(1, first.song.ref!)).resolves.toBe(false);
        await expect(playback.playQueueItem(1, 'song-unknown')).resolves.toBe(false);
        await expect(playback.playQueueItem(1, null as never)).resolves.toBe(false);
        expect(actions.playQueueSong).not.toHaveBeenCalled();

        await expect(playback.playQueueItem(1, second.song.ref!)).resolves.toBe(true);

        // The host swaps an entry for an equal copy when it starts playing; the old ref still names it.
        const replaced = usePlaybackStore.getState().playQueue.map((entry, index) => (index === 1 ? { ...entry } as SongResult : entry));
        usePlaybackStore.setState({ playQueue: replaced });
        await expect(playback.playQueueItem(1, second.song.ref!)).resolves.toBe(true);
        expect((actions.playQueueSong as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe(replaced[1]);

        // After a reorder the position holds another song: refused.
        usePlaybackStore.setState({ playQueue: [replaced[1], replaced[0], replaced[2]] });
        await expect(playback.playQueueItem(1, second.song.ref!)).resolves.toBe(false);
        expect(actions.playQueueSong).toHaveBeenCalledTimes(2);
    });
});
