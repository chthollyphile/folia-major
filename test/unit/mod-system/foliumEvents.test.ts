// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    addFoliumEventHandler,
    dispatchFoliumHookAsync,
    dispatchFoliumHookSync,
    emitFoliumEvent,
    hasFoliumEventHandlers,
    removeFoliumEventHandlers,
} from '@/mods/folium/events';
import { clearFoliumIssues, useFoliumStatusStore } from '@/mods/runtime/status';
import type { FoliumBeforePlayEvent, FoliumLyricsTransformEvent } from '@/mods/folium/contract';
import type { ModRuntimeInfo } from '@/mods/types';
import { createFoliumPlaybackService, createFoliumUiService, registerFoliumHostActions } from '@/mods/folium/services';
import { buildLineRenderHints } from '@/utils/lyrics/renderHints';

// test/unit/mod-system/foliumEvents.test.ts
// The event bus (ordering, isolation, teardown, hook semantics) and the
// services' gates: playback control needs its permission, embeds need a
// declared origin, and nothing reaches host actions outside the main window.

afterEach(() => {
    ['mod-a', 'mod-b'].forEach(removeFoliumEventHandlers);
    ['mod-a', 'mod-b'].forEach(clearFoliumIssues);
    registerFoliumHostActions(null);
    vi.useRealTimers();
});

describe('folium event bus', () => {
    it('runs handlers by priority, then registration order', () => {
        const calls: string[] = [];
        addFoliumEventHandler('mod-a', 'app.viewChanged', () => { calls.push('a-normal'); });
        addFoliumEventHandler('mod-b', 'app.viewChanged', () => { calls.push('b-lowest'); }, 'lowest');
        addFoliumEventHandler('mod-b', 'app.viewChanged', () => { calls.push('b-highest'); }, 'highest');
        addFoliumEventHandler('mod-a', 'app.viewChanged', () => { calls.push('a-normal-2'); });
        emitFoliumEvent('app.viewChanged', { view: 'player' });
        expect(calls).toEqual(['b-highest', 'a-normal', 'a-normal-2', 'b-lowest']);
    });

    it('isolates a throwing handler and reports it against its mod', () => {
        const after = vi.fn();
        addFoliumEventHandler('mod-a', 'app.viewChanged', () => { throw new Error('boom'); });
        addFoliumEventHandler('mod-b', 'app.viewChanged', after);
        emitFoliumEvent('app.viewChanged', { view: 'home' });
        expect(after).toHaveBeenCalled();
        expect(useFoliumStatusStore.getState().issues['mod-a']?.[0].message).toBe('boom');
    });

    it('freezes notification payloads', () => {
        addFoliumEventHandler('mod-a', 'app.viewChanged', (event) => {
            expect(Object.isFrozen(event)).toBe(true);
        });
        emitFoliumEvent('app.viewChanged', { view: 'home' });
    });

    it('drops every handler of a mod on teardown, and a disposer drops one', () => {
        const dispose = addFoliumEventHandler('mod-a', 'app.viewChanged', () => {});
        addFoliumEventHandler('mod-a', 'theme.changed', () => {});
        dispose();
        expect(hasFoliumEventHandlers('app.viewChanged')).toBe(false);
        removeFoliumEventHandlers('mod-a');
        expect(hasFoliumEventHandlers('theme.changed')).toBe(false);
    });

    it('lets sync hooks mutate the shared event in order', () => {
        addFoliumEventHandler('mod-a', 'lyrics.transform', (event) => {
            event.lines = [...event.lines, { fullText: 'a', startTime: 0, endTime: 1, words: [], renderHints: buildLineRenderHints(0, 1) }];
        });
        addFoliumEventHandler('mod-b', 'lyrics.transform', (event) => {
            event.lines = event.lines.map((line) => ({ ...line, fullText: line.fullText.toUpperCase() }));
        }, 'low');
        const event: FoliumLyricsTransformEvent = { song: null, lines: [] };
        dispatchFoliumHookSync('lyrics.transform', event);
        expect(event.lines.map((line) => line.fullText)).toEqual(['A']);
    });

    it('awaits async hooks, stops once cancelled, and times out a stuck handler', async () => {
        vi.useFakeTimers();
        const later = vi.fn();
        addFoliumEventHandler('mod-a', 'playback.beforePlay', () => new Promise<void>(() => {}), 'highest');
        addFoliumEventHandler('mod-b', 'playback.beforePlay', (event) => { event.cancel(); });
        addFoliumEventHandler('mod-b', 'playback.beforePlay', later, 'low');
        let cancelled = false;
        const event = {
            song: { id: '1', title: 't', artist: '', album: null, source: null, ref: 'song-1' },
            get cancelled() { return cancelled; },
            cancel: () => { cancelled = true; },
            replaceWith: () => {},
        } as FoliumBeforePlayEvent;
        const done = dispatchFoliumHookAsync('playback.beforePlay', event, (current) => current.cancelled);
        await vi.advanceTimersByTimeAsync(1600);
        await done;
        expect(cancelled).toBe(true);
        expect(later).not.toHaveBeenCalled();
        expect(useFoliumStatusStore.getState().issues['mod-a']?.[0].message).toContain('timed out');
    });

    it('rejects unknown priorities and non-function handlers', () => {
        expect(() => addFoliumEventHandler('mod-a', 'app.viewChanged', () => {}, 'urgent' as never)).toThrow('unknown priority');
        expect(() => addFoliumEventHandler('mod-a', 'app.viewChanged', 'x' as never)).toThrow('handler must be a function');
    });
});

const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'mod-a', name: 'A', version: '1.0.0', author: null, description: null, permissions: [],
    status: 'loaded', error: null, enabled: true, trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null, ...overrides,
});

const fakeActions = () => ({
    getPlaybackState: () => ({ song: null, state: 'paused' as const, position: 3, duration: 10, liked: false, canLike: false }),
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(), seekToLyricTime: vi.fn(), next: vi.fn(), previous: vi.fn(),
    playSongRef: vi.fn(async () => true), enqueueSongRef: vi.fn(() => true),
    shuffleQueue: vi.fn(() => true), toggleLike: vi.fn(() => false),
    getVolume: vi.fn(() => ({ volume: 0.4, muted: true })), setVolume: vi.fn(), setMuted: vi.fn(),
    getLoopMode: vi.fn(() => 'all' as const), setLoopMode: vi.fn(),
    getQueue: vi.fn(() => ({ items: [], length: 0, currentIndex: -1, kind: 'queue' as const, version: 'v' })),
    playQueueItem: vi.fn(async () => true),
    replaceQueue: vi.fn(() => ({ status: 'replaced' as const, version: 'v2', length: 0, currentIndex: -1 })),
    toast: vi.fn(), openPlayerPanel: vi.fn(), navigate: vi.fn(), openVolume: vi.fn(),
    getLyricLines: () => [], refreshLyrics: vi.fn(),
});

describe('folium services', () => {
    it('reads playback state freely but needs playback.control to drive it', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        const readOnly = createFoliumPlaybackService(mod(), 'main');
        expect(readOnly.getState().position).toBe(3);
        expect(() => readOnly.pause()).toThrow('permission-denied:playback.control');
        const control = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'main');
        control.seek(-5);
        expect(actions.seek).toHaveBeenCalledWith(0);
        expect(() => control.enqueue({ ref: null } as never)).toThrow('song-ref-required');
    });

    it('hands lyric-time seeks to the host unconverted, behind playback.control', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        expect(() => createFoliumPlaybackService(mod(), 'main').seekToLyricTime(12)).toThrow('permission-denied:playback.control');
        const control = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'main');
        control.seekToLyricTime(12.5);
        // The host does the lyric-to-playback conversion, so the value passes through as is.
        expect(actions.seekToLyricTime).toHaveBeenCalledWith(12.5);
        expect(actions.seek).not.toHaveBeenCalled();
        expect(() => control.seekToLyricTime(Number.NaN)).toThrow('requires a finite number');
    });

    it('shuffles and likes behind playback.control and reports what the host did', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        const readOnly = createFoliumPlaybackService(mod(), 'main');
        expect(() => readOnly.shuffleQueue()).toThrow('permission-denied:playback.control');
        expect(() => readOnly.toggleLike()).toThrow('permission-denied:playback.control');
        const control = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'main');
        expect(control.shuffleQueue()).toBe(true);
        expect(control.toggleLike()).toBe(false);
        expect(actions.shuffleQueue).toHaveBeenCalledTimes(1);
        expect(actions.toggleLike).toHaveBeenCalledTimes(1);
    });

    it('reads volume, repeat mode and the queue freely, in the main window only', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        const readOnly = createFoliumPlaybackService(mod(), 'main');
        expect(readOnly.getVolume()).toEqual({ volume: 0.4, muted: true });
        expect(readOnly.getLoopMode()).toBe('all');
        expect(readOnly.getQueue().kind).toBe('queue');
        const exported = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'export');
        expect(() => exported.getVolume()).toThrow('playback-unavailable-in-export-context');
        expect(() => exported.getLoopMode()).toThrow('playback-unavailable-in-export-context');
        expect(() => exported.getQueue()).toThrow('playback-unavailable-in-export-context');
    });

    it('sets volume, mute and repeat mode behind playback.control, checking the values first', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        const readOnly = createFoliumPlaybackService(mod(), 'main');
        expect(() => readOnly.setVolume(0.5)).toThrow('permission-denied:playback.control');
        expect(() => readOnly.setMuted(true)).toThrow('permission-denied:playback.control');
        expect(() => readOnly.setLoopMode('one')).toThrow('permission-denied:playback.control');

        const control = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'main');
        control.setVolume(0.25);
        control.setVolume(1.5);
        control.setVolume(-2);
        expect(actions.setVolume.mock.calls).toEqual([[0.25], [1], [0]]);
        expect(() => control.setVolume(Number.NaN)).toThrow('playback.setVolume requires a finite number');
        expect(() => control.setVolume(Infinity)).toThrow('playback.setVolume requires a finite number');
        expect(() => control.setVolume('0.5' as never)).toThrow('playback.setVolume requires a finite number');

        control.setMuted(false);
        expect(actions.setMuted).toHaveBeenCalledWith(false);
        expect(() => control.setMuted(1 as never)).toThrow('playback.setMuted requires a boolean');

        control.setLoopMode('one');
        expect(actions.setLoopMode).toHaveBeenCalledWith('one');
        expect(() => control.setLoopMode('shuffle' as never)).toThrow('playback.setLoopMode: unknown mode "shuffle"');
        expect(actions.setVolume).toHaveBeenCalledTimes(3);
        expect(actions.setMuted).toHaveBeenCalledTimes(1);
        expect(actions.setLoopMode).toHaveBeenCalledTimes(1);

        const exported = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'export');
        expect(() => exported.setVolume(0.5)).toThrow('playback-unavailable-in-export-context');
    });

    it('pages the queue: limit defaults to 500 and is clamped, a given value must be finite', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        const playback = createFoliumPlaybackService(mod(), 'main');
        playback.getQueue();
        playback.getQueue({ offset: 20.7, limit: 50.9 });
        playback.getQueue({ limit: 0 });
        playback.getQueue({ offset: -3, limit: 10_000 });
        playback.getQueue(null as never);
        expect(actions.getQueue.mock.calls).toEqual([
            [undefined, 500],
            [20, 50],
            [undefined, 1],
            [-3, 500],
            [undefined, 500],
        ]);
        // A value that is given but not a finite number throws instead of reading some other page.
        expect(() => playback.getQueue({ offset: Number.NaN })).toThrow('playback.getQueue: offset must be a finite number');
        expect(() => playback.getQueue({ limit: Infinity })).toThrow('playback.getQueue: limit must be a finite number');
        expect(() => playback.getQueue({ offset: '2' as never })).toThrow('playback.getQueue: offset must be a finite number');
        expect(actions.getQueue).toHaveBeenCalledTimes(5);
    });

    it('plays a queue entry behind playback.control and needs an integer index', async () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        await expect(createFoliumPlaybackService(mod(), 'main').playQueueItem(0)).rejects.toThrow('permission-denied:playback.control');
        const control = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'main');
        await expect(control.playQueueItem(2, 'song-7')).resolves.toBe(true);
        await expect(control.playQueueItem(3)).resolves.toBe(true);
        expect(actions.playQueueItem.mock.calls).toEqual([[2, 'song-7'], [3, undefined]]);
        await expect(control.playQueueItem(1.5)).rejects.toThrow('playback.playQueueItem requires an integer index');
        await expect(control.playQueueItem(Number.NaN)).rejects.toThrow('playback.playQueueItem requires an integer index');
        expect(actions.playQueueItem).toHaveBeenCalledTimes(2);
        const exported = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'export');
        await expect(exported.playQueueItem(0)).rejects.toThrow('playback-unavailable-in-export-context');
    });

    it('opens the volume panel without a permission', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        createFoliumUiService(mod(), 'main').openVolume();
        expect(actions.openVolume).toHaveBeenCalledTimes(1);
        expect(() => createFoliumUiService(mod(), 'export').openVolume()).toThrow('ui-unavailable-in-export-context');
    });

    it('is unavailable outside the main window', () => {
        registerFoliumHostActions(fakeActions());
        const service = createFoliumPlaybackService(mod({ permissions: ['playback.control'] }), 'export');
        expect(() => service.play()).toThrow('playback-unavailable-in-export-context');
    });

    it('prefixes panel tab ids with the mod id', () => {
        const actions = fakeActions();
        registerFoliumHostActions(actions);
        createFoliumUiService(mod(), 'main').openPlayerPanel('notes');
        expect(actions.openPlayerPanel).toHaveBeenCalledWith('folium:mod-a:notes');
    });

    it('embeds only declared https origins, sandboxed, and removes the frame on dispose', () => {
        const container = document.createElement('div');
        const denied = createFoliumUiService(mod({ embedOrigins: ['https://www.youtube-nocookie.com'] }), 'main');
        expect(() => denied.embed(container, 'https://www.youtube-nocookie.com/embed/x')).toThrow('permission-denied:net.embed');
        const ui = createFoliumUiService(mod({
            permissions: ['net.embed'],
            embedOrigins: ['https://www.youtube-nocookie.com'],
        }), 'main');
        expect(() => ui.embed(container, 'https://evil.example/embed')).toThrow('embed-origin-not-declared');
        expect(() => ui.embed(container, 'http://www.youtube-nocookie.com/embed/x')).toThrow('embed-origin-not-declared');
        const dispose = ui.embed(container, 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
        const frame = container.querySelector('iframe')!;
        expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
        expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
        dispose();
        expect(container.querySelector('iframe')).toBeNull();
    });
});
