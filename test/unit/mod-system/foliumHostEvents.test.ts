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
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

import type { Line, LyricData, SongResult } from '@/types';
import { usePlaybackStore } from '@/stores/usePlaybackStore';
import { runBeforePlayHook, hasBeforePlayHook } from '@/services/hostExtensionHooks';
import { installFoliumHostEvents } from '@/mods/folium/hostEvents';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { toFoliumSong } from '@/mods/folium/dto';

// test/unit/mod-system/foliumHostEvents.test.ts
// The two host hooks as wired by installFoliumHostEvents: lyrics.transform at
// the store's lyrics setter (untouched lines keep their host data), and
// playback.beforePlay in front of playSong (cancel, replace, pass-through).

installFoliumHostEvents();

afterEach(() => {
    removeFoliumEventHandlers('mod-a');
    usePlaybackStore.getState().setLyricsState(null);
});

const line = (text: string, start: number, extra: Partial<Line> = {}): Line => ({
    words: [{ text, startTime: start, endTime: start + 1 }],
    startTime: start,
    endTime: start + 1,
    fullText: text,
    ...extra,
});

describe('lyrics.transform hook', () => {
    it('passes lyrics through untouched when nobody listens', () => {
        const lyrics: LyricData = { lines: [line('a', 0)] };
        usePlaybackStore.getState().setLyricsState(lyrics);
        expect(usePlaybackStore.getState().lyrics).toBe(lyrics);
    });

    it('keeps untouched host lines and rebuilds edited ones from the DTO', () => {
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            event.lines = [
                event.lines[0],
                { ...event.lines[1], text: 'EDITED', translation: '改' },
                { text: 'added', startTime: 5, endTime: 6, words: [] },
            ];
        });
        const kept = line('keep', 0, { agentId: 'v1' });
        usePlaybackStore.getState().setLyricsState({ lines: [kept, line('edit', 2)], isWordByWord: true });
        const result = usePlaybackStore.getState().lyrics!;
        expect(result.isWordByWord).toBe(true);
        expect(result.lines[0]).toBe(kept);
        expect(result.lines[1]).toMatchObject({ fullText: 'EDITED', translation: '改' });
        expect(result.lines[2]).toMatchObject({ fullText: 'added', words: [{ text: 'added', startTime: 5, endTime: 6 }] });
    });

    it('does not transform an already transformed object again', () => {
        const handler = vi.fn((event: { lines: readonly unknown[] }) => { event.lines = [...event.lines] as never; });
        addFoliumEventHandler('mod-a', 'lyrics.transform', handler as never);
        usePlaybackStore.getState().setLyricsState({ lines: [line('x', 0)] });
        const once = usePlaybackStore.getState().lyrics;
        usePlaybackStore.getState().setLyricsState(once);
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('playback.beforePlay hook', () => {
    const song = (id: number) => ({ id, name: `s${id}`, artists: [], album: { name: '' }, durationMs: 0 }) as unknown as SongResult;

    it('is inactive without handlers', () => {
        expect(hasBeforePlayHook()).toBe(false);
    });

    it('cancels or replaces the song', async () => {
        const replacement = song(2);
        const replacementDto = toFoliumSong(replacement)!;
        addFoliumEventHandler('mod-a', 'playback.beforePlay', (event) => {
            if (event.song.title === 's1') event.replaceWith(replacementDto);
            if (event.song.title === 's3') event.cancel();
        });
        expect(hasBeforePlayHook()).toBe(true);
        expect(await runBeforePlayHook(song(1))).toBe(replacement);
        expect(await runBeforePlayHook(song(3))).toBeNull();
        const untouched = song(4);
        expect(await runBeforePlayHook(untouched)).toBe(untouched);
    });
});
