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
import { useAudioSettingsStore } from '@/stores/useAudioSettingsStore';
import {
    applyLyricsTransform,
    hasBeforePlayHook,
    lyricsForNoLyrics,
    notifyPlaybackFailed,
    rerunLyricsTransform,
    runBeforePlayHook,
    untransformedLyrics,
} from '@/services/hostExtensionHooks';
import { supplyLyricsAfterEmptyLoad } from '@/components/app/playback/createLyricsSetter';
import type { FoliumLine } from '@/mods/folium/contract';
import { installFoliumHostEvents } from '@/mods/runtime/hostEvents';
import { buildFoliumQueueSnapshot } from '@/mods/runtime/hostQueue';
import { addFoliumEventHandler, removeFoliumEventHandlers } from '@/mods/folium/events';
import { resolveFoliumSongRef, toFoliumSong } from '@/mods/folium/dto';
import { buildLineRenderHints } from '@/utils/lyrics/renderHints';

// test/unit/mod-system/foliumHostEvents.test.ts
// The two host hooks as wired by installFoliumHostEvents: lyrics.transform at
// the end of the lyrics pipeline (untouched lines keep their host data, the
// transform never stacks on its own output, and it can supply lyrics to a
// song whose load ended with none), and
// playback.beforePlay in front of playSong (cancel, replace, pass-through).
// Folium 1.5 notifications from the same wiring: volumeChanged and
// loopModeChanged from the audio settings store, and queueChanged, one per
// task, from the playback store.
// Folium 1.5: the host's playback failure notice becomes playback.failed.

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
        expect(applyLyricsTransform(lyrics)).toBe(lyrics);
    });

    it('keeps untouched host lines and rebuilds edited ones from the DTO', () => {
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            event.lines = [
                event.lines[0],
                { ...event.lines[1], fullText: 'EDITED', translation: '改' },
                { fullText: 'added', startTime: 5, endTime: 6, words: [], renderHints: buildLineRenderHints(5, 6) },
            ];
        });
        const kept = line('keep', 0, { agentId: 'v1' });
        const result = applyLyricsTransform({ lines: [kept, line('edit', 2)], isWordByWord: true })!;
        expect(result.isWordByWord).toBe(true);
        expect(result.lines[0]).toBe(kept);
        expect(result.lines[1]).toMatchObject({ fullText: 'EDITED', translation: '改' });
        expect(result.lines[2]).toMatchObject({ fullText: 'added', words: [{ text: 'added', startTime: 5, endTime: 6 }] });
    });

    it('is not applied by the store setter, so functional updates never re-transform', () => {
        const handler = vi.fn((event: { lines: readonly unknown[] }) => { event.lines = [...event.lines] as never; });
        addFoliumEventHandler('mod-a', 'lyrics.transform', handler as never);
        usePlaybackStore.getState().setLyricsState(applyLyricsTransform({ lines: [line('x', 0)] }));
        usePlaybackStore.getState().setLyricsState((previous) => (previous ? { ...previous } : previous));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('re-transforms from the untransformed source instead of stacking on its own output', () => {
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            event.lines = [...event.lines, { fullText: 'tail', startTime: 9, endTime: 10, words: [], renderHints: buildLineRenderHints(9, 10) }];
        });
        const source: LyricData = { lines: [line('x', 0)] };
        const once = applyLyricsTransform(source)!;
        expect(once.lines).toHaveLength(2);
        expect(untransformedLyrics(once)).toBe(source);
        expect(applyLyricsTransform(once)!.lines).toHaveLength(2);
    });
});

describe('lyrics.transform on a song whose lyric load ended with none', () => {
    const supplied = (text: string): FoliumLine => ({
        fullText: text, startTime: 1, endTime: 2, words: [], renderHints: buildLineRenderHints(1, 2),
    });

    it('leaves the song without lyrics with no mod, and with a mod that only rewrites the lines it gets', () => {
        expect(lyricsForNoLyrics()).toBeNull();
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            event.lines = event.lines.map((each) => ({ ...each, fullText: each.fullText.toUpperCase() }));
        });
        expect(lyricsForNoLyrics()).toBeNull();
        supplyLyricsAfterEmptyLoad();
        expect(usePlaybackStore.getState().lyrics).toBeNull();
    });

    it('shows what a mod supplies, for the displayed song, and leaves lyrics a load did find alone', () => {
        usePlaybackStore.getState().setCurrentSong({ id: 7, name: 'Seven', artists: [], album: { name: '' }, durationMs: 0 } as unknown as SongResult);
        const seen: Array<{ title: string | undefined; lines: number }> = [];
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            seen.push({ title: event.song?.title, lines: event.lines.length });
            if (event.lines.length === 0) event.lines = [supplied('from the mod')];
        });
        supplyLyricsAfterEmptyLoad();
        expect(seen).toEqual([{ title: 'Seven', lines: 0 }]);
        expect(usePlaybackStore.getState().lyrics?.lines.map((each) => each.fullText)).toEqual(['from the mod']);

        const found: LyricData = { lines: [line('found', 0)] };
        usePlaybackStore.getState().setLyricsState(found);
        supplyLyricsAfterEmptyLoad();
        expect(usePlaybackStore.getState().lyrics).toBe(found);
        expect(seen).toHaveLength(1);
        usePlaybackStore.getState().setCurrentSong(null);
    });

    it('runs again on the empty lines, not on its own output, and an empty answer then takes the lyrics away', () => {
        let answer = ['first'];
        const seen: number[] = [];
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            seen.push(event.lines.length);
            event.lines = answer.map(supplied);
        });
        const once = rerunLyricsTransform(null);
        expect(once?.lines.map((each) => each.fullText)).toEqual(['first']);
        answer = ['second'];
        expect(rerunLyricsTransform(once)?.lines.map((each) => each.fullText)).toEqual(['second']);
        answer = [];
        expect(rerunLyricsTransform(once)).toBeNull();
        expect(seen).toEqual([0, 0, 0]);
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

describe('Folium 1.5 playback notifications', () => {
    const song = (id: number) => ({ id, name: `s${id}`, artists: [], album: { name: '' } }) as unknown as SongResult;
    const initialPlayback = usePlaybackStore.getState();
    const initialAudio = useAudioSettingsStore.getState();
    const flushMicrotasks = () => Promise.resolve();

    // Handlers go first, so resetting the stores schedules nothing into the next test.
    afterEach(async () => {
        removeFoliumEventHandlers('mod-a');
        usePlaybackStore.setState(initialPlayback, true);
        useAudioSettingsStore.setState(initialAudio, true);
        await flushMicrotasks();
    });

    it('reports volume and mute changes, whoever made them, once per change', () => {
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.volumeChanged', handler);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
        handler.mockClear();

        useAudioSettingsStore.getState().handleSetVolume(0.5);
        useAudioSettingsStore.getState().handleToggleMute();
        useAudioSettingsStore.getState().handleSetMuted(true);
        useAudioSettingsStore.getState().handleSetLoopMode('one');
        expect(handler.mock.calls).toEqual([
            [{ volume: 0.5, muted: false }],
            [{ volume: 0.5, muted: true }],
        ]);
    });

    it('reports repeat mode changes', () => {
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.loopModeChanged', handler);
        useAudioSettingsStore.setState({ loopMode: 'off' });
        handler.mockClear();

        useAudioSettingsStore.getState().handleToggleLoopMode();
        useAudioSettingsStore.getState().handleSetLoopMode('all');
        useAudioSettingsStore.getState().handleSetLoopMode('off');
        useAudioSettingsStore.getState().handleSetVolume(0.2);
        expect(handler.mock.calls).toEqual([[{ mode: 'all' }], [{ mode: 'off' }]]);
    });

    it('turns the queue changes of one task into one event, read once they settled', async () => {
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        const queue = [song(1), song(2), song(3)];
        usePlaybackStore.setState({ playQueue: queue });
        usePlaybackStore.setState({ currentSong: queue[1] });
        usePlaybackStore.setState({ isFmMode: true });
        expect(handler).not.toHaveBeenCalled();
        await flushMicrotasks();
        expect(handler.mock.calls).toEqual([[{ length: 3, currentIndex: 1, version: expect.any(String), byThisMod: false }]]);
    });

    it('reports a shuffle even though the length and the current index stay the same', async () => {
        const queue = [song(1), song(2), song(3)];
        usePlaybackStore.setState({ playQueue: queue, currentSong: queue[0] });
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        usePlaybackStore.setState({ playQueue: [queue[0], queue[2], queue[1]] });
        await flushMicrotasks();
        expect(handler.mock.calls).toEqual([[{ length: 3, currentIndex: 0, version: expect.any(String), byThisMod: false }]]);
    });

    it('reports the displayed song moving, FM and Stage switches, but not changes that leave the outline alone', async () => {
        const queue = [song(1), song(2), song(3)];
        usePlaybackStore.setState({ playQueue: queue, currentSong: queue[0] });
        await flushMicrotasks();
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);

        // The same song as a fresh object (the host does this when a song starts), and an unrelated field.
        usePlaybackStore.setState({ currentSong: { ...queue[0] } as SongResult });
        usePlaybackStore.setState({ currentLineIndex: 4 });
        await flushMicrotasks();
        expect(handler).not.toHaveBeenCalled();

        // The queue's version before the displayed song moves, as getQueue would give it.
        const before = buildFoliumQueueSnapshot(usePlaybackStore.getState(), undefined, 1).version;
        usePlaybackStore.setState({ currentSong: queue[2] });
        await flushMicrotasks();
        usePlaybackStore.setState({ isFmMode: true });
        await flushMicrotasks();
        usePlaybackStore.setState({ activePlaybackContext: 'stage' });
        await flushMicrotasks();
        const outline = { length: 3, currentIndex: 2, version: expect.any(String), byThisMod: false };
        expect(handler.mock.calls).toEqual([[outline], [outline], [outline]]);
        // The song moving keeps the version; entering FM and the Stage each change it.
        const [moved, fm, stage] = handler.mock.calls.map(([event]) => event.version);
        expect(moved).toBe(before);
        expect(fm).not.toBe(before);
        expect(stage).not.toBe(before);
        expect(stage).not.toBe(fm);
    });

    it('schedules nothing while nobody listens', async () => {
        usePlaybackStore.setState({ playQueue: [song(1)] });
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.queueChanged', handler);
        await flushMicrotasks();
        expect(handler).not.toHaveBeenCalled();
    });
});

describe('playback.failed', () => {
    const song = (id: number) => ({ id, name: `f${id}`, artists: [{ id: 1, name: 'A' }], album: { name: 'Al' }, durationMs: 0 }) as unknown as SongResult;
    const refNumber = (ref: string | null | undefined) => parseInt(String(ref).replace('song-', ''), 36);

    it('does no DTO work while nobody listens, so the shared ref pool is not used up', () => {
        const before = refNumber(toFoliumSong(song(10))!.ref);
        notifyPlaybackFailed({ song: song(11), reason: 'unreachable', phase: 'play', willAutoSkip: false });
        const after = refNumber(toFoliumSong(song(12))!.ref);
        expect(after).toBe(before + 1);
    });

    it('emits the song DTO, the coarse reason, the phase and willAutoSkip, frozen', () => {
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.failed', handler);
        const failed = song(20);
        notifyPlaybackFailed({ song: failed, reason: 'subscription-required', phase: 'mid-playback', willAutoSkip: true });

        expect(handler).toHaveBeenCalledOnce();
        const event = handler.mock.calls[0][0];
        expect(event).toEqual({
            song: toFoliumSong(failed),
            reason: 'restricted',
            phase: 'mid-playback',
            willAutoSkip: true,
        });
        expect(event.song).toMatchObject({ id: '20', title: 'f20', artist: 'A', album: 'Al' });
        expect(Object.isFrozen(event)).toBe(true);
        // The ref plays the very song that failed (playSong / enqueue / replaceWith accept it).
        expect(resolveFoliumSongRef(event.song.ref)).toBe(failed);
    });

    it('reports a path without a reason as unknown and keeps a missing song as null', () => {
        const handler = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.failed', handler);
        notifyPlaybackFailed({ song: null, reason: null, phase: 'restore', willAutoSkip: false });
        expect(handler).toHaveBeenCalledWith({ song: null, reason: 'unknown', phase: 'restore', willAutoSkip: false });
    });

    it('keeps a throwing handler away from the playback path', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const after = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.failed', () => { throw new Error('boom'); });
        addFoliumEventHandler('mod-a', 'playback.failed', after);
        expect(() => notifyPlaybackFailed({ song: song(30), reason: 'taken-down', phase: 'play', willAutoSkip: false })).not.toThrow();
        expect(after).toHaveBeenCalledWith(expect.objectContaining({ reason: 'taken-down' }));
        warn.mockRestore();
    });
});
