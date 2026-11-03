// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

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
// Counts the keys worked out from outside the guards module: the version is the only reader here.
vi.mock('@/utils/appPlaybackGuards', async importOriginal => {
    const real = await importOriginal<typeof import('@/utils/appPlaybackGuards')>();
    return { ...real, getPlaybackSongKey: vi.fn(real.getPlaybackSongKey) };
});

import type { SongResult } from '@/types';
import { replacePlayQueue, usePlaybackStore } from '@/stores/usePlaybackStore';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { installFoliumHostEvents } from '@/mods/runtime/hostEvents';
import { buildFoliumQueueSnapshot } from '@/mods/runtime/hostQueue';
import {
    dropFoliumQueueWriter,
    readFoliumQueueVersion,
    recordFoliumQueueReplace,
    resetFoliumQueueVersionForTest,
    takeFoliumQueueChange,
} from '@/mods/runtime/queue/queueVersion';

// test/unit/mod-system/foliumQueueVersion.test.ts
// Folium 1.7: the play queue's version (runtime/queue/queueVersion.ts). It follows the songs and the
// queue's kind, not the array: an equal copy keeps it, moving the displayed song keeps it, any change of
// the songs, their order or FM / Stage gives a new one. Nothing is worked out until something reads it.
// And whose replaceQueue an event reports: only the event that replacement's own write scheduled.

installFoliumHostEvents();

const song = (id: string): SongResult => ({
    id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'bodian', mediaId: id },
});
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(song);
const flushMicrotasks = () => new Promise<void>(resolve => setTimeout(resolve, 0));

const initialPlayback = usePlaybackStore.getState();
afterEach(() => {
    removeFoliumEventHandlers('mod-a');
    usePlaybackStore.setState(initialPlayback, true);
    resetFoliumQueueVersionForTest();
    vi.mocked(getPlaybackSongKey).mockClear();
});

describe('the queue version', () => {
    it('stays for the same array and for an equal copy of it', () => {
        const queue = [a, b, c];
        const version = readFoliumQueueVersion(queue, 'queue');
        expect(readFoliumQueueVersion(queue, 'queue')).toBe(version);
        expect(readFoliumQueueVersion(queue.map(entry => ({ ...entry })), 'queue')).toBe(version);
        // The copy is the array remembered now; the original still has the same songs.
        expect(readFoliumQueueVersion(queue, 'queue')).toBe(version);
    });

    it.each([
        ['another order', [b, a, c]],
        ['a song added', [a, b, c, d]],
        ['a song removed', [a, b]],
        ['a song swapped for another', [a, d, c]],
    ])('changes for %s', (_change, next) => {
        const version = readFoliumQueueVersion([a, b, c], 'queue');
        expect(readFoliumQueueVersion(next, 'queue')).not.toBe(version);
    });

    it('changes going into and out of Personal FM and the Stage, with the same songs', () => {
        const queue = [a, b, c];
        const plain = readFoliumQueueVersion(queue, 'queue');
        const fm = readFoliumQueueVersion(queue, 'fm');
        const stage = readFoliumQueueVersion(queue, 'stage');
        const back = readFoliumQueueVersion(queue, 'queue');
        expect(new Set([plain, fm, stage]).size).toBe(3);
        expect(back).not.toBe(stage);
    });

    it('stays when only the displayed song moves', () => {
        const queue = [a, b, c];
        usePlaybackStore.setState({ playQueue: queue, currentSong: a });
        const version = buildFoliumQueueSnapshot(usePlaybackStore.getState(), undefined, 10).version;
        usePlaybackStore.setState({ currentSong: c });
        const moved = buildFoliumQueueSnapshot(usePlaybackStore.getState(), undefined, 10);
        expect(moved.currentIndex).toBe(2);
        expect(moved.version).toBe(version);
    });

    it('carries a session prefix, and is never handed out again after a reset', () => {
        const before = readFoliumQueueVersion([a], 'queue');
        expect(before).toMatch(/^[a-z0-9]+\.\d+$/);
        resetFoliumQueueVersionForTest();
        const after = readFoliumQueueVersion([a], 'queue');
        expect(after).not.toBe(before);
        expect(after.split('.')[0]).toBe(before.split('.')[0]);
    });

    it('works out nothing while nobody reads it', async () => {
        const queue = [a, b, c];
        vi.mocked(getPlaybackSongKey).mockClear();
        usePlaybackStore.getState().setPlayQueue(queue);
        usePlaybackStore.getState().setPlayQueue([c, b, a]);
        usePlaybackStore.getState().setIsFmMode(true);
        await flushMicrotasks();
        expect(getPlaybackSongKey).not.toHaveBeenCalled();

        readFoliumQueueVersion(usePlaybackStore.getState().playQueue, 'fm');
        expect(getPlaybackSongKey).toHaveBeenCalledTimes(3);
    });
});

describe('whose change an event reports', () => {
    it('names the replacing mod once, in the same task; a move of the displayed song after is nobody\'s', () => {
        const next = [a, b];
        const version = recordFoliumQueueReplace(next, 'queue', 'mod-a');
        expect(takeFoliumQueueChange(next, 'queue')).toEqual({ version, writer: 'mod-a' });
        expect(takeFoliumQueueChange(next, 'queue')).toEqual({ version, writer: null });
    });

    it('names nobody when the songs changed again in the same task', () => {
        recordFoliumQueueReplace([a, b], 'queue', 'mod-a');
        expect(takeFoliumQueueChange([a, b, c], 'queue').writer).toBeNull();
    });

    it('names nobody once the mark is dropped', () => {
        const next = [a, b];
        recordFoliumQueueReplace(next, 'queue', 'mod-a');
        dropFoliumQueueWriter();
        expect(takeFoliumQueueChange(next, 'queue').writer).toBeNull();
    });

    it('a replacement nobody listened to is not reported as the mod\'s own to a handler added later', async () => {
        usePlaybackStore.setState({ playQueue: [a, b, c], currentSong: a });
        await flushMicrotasks();

        // As replaceQueue writes: the version, the store, then the mark dropped a microtask later.
        const next = [c, b, a];
        recordFoliumQueueReplace(next, 'queue', 'mod-a');
        replacePlayQueue(next, false);
        queueMicrotask(dropFoliumQueueWriter);
        await flushMicrotasks();

        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        usePlaybackStore.setState({ currentSong: b });
        await flushMicrotasks();
        expect(handler.mock.calls).toEqual([[expect.objectContaining({ currentIndex: 1, byThisMod: false })]]);
    });
});
