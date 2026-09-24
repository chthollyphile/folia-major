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
import { useFoliumStatusStore } from '@/mods/folium/status';
import type { FoliumBeforePlayEvent, FoliumLyricsTransformEvent } from '@/mods/folium/contract';
import type { ModRuntimeInfo } from '@/mods/types';
import { createFoliumPlaybackService, createFoliumUiService, registerFoliumHostActions } from '@/mods/folium/services';

// test/unit/mod-system/foliumEvents.test.ts
// The event bus (ordering, isolation, teardown, hook semantics) and the
// services' gates: playback control needs its permission, embeds need a
// declared origin, and nothing reaches host actions outside the main window.

afterEach(() => {
    ['mod-a', 'mod-b'].forEach(removeFoliumEventHandlers);
    useFoliumStatusStore.setState({ issues: {} });
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
            event.lines = [...event.lines, { text: 'a', startTime: 0, endTime: 1, words: [] }];
        });
        addFoliumEventHandler('mod-b', 'lyrics.transform', (event) => {
            event.lines = event.lines.map((line) => ({ ...line, text: line.text.toUpperCase() }));
        }, 'low');
        const event: FoliumLyricsTransformEvent = { song: null, lines: [] };
        dispatchFoliumHookSync('lyrics.transform', event);
        expect(event.lines.map((line) => line.text)).toEqual(['A']);
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
    status: 'loaded', error: null, enabled: true, trustStale: false, experimental: [], embedOrigins: [],
    folia: null, hasMain: false, clientUrl: null, ...overrides,
});

const fakeActions = () => ({
    getPlaybackState: () => ({ song: null, state: 'paused' as const, position: 3, duration: 10 }),
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), seek: vi.fn(), next: vi.fn(), previous: vi.fn(),
    playSongRef: vi.fn(async () => true), enqueueSongRef: vi.fn(() => true),
    toast: vi.fn(), openPlayerPanel: vi.fn(), navigate: vi.fn(),
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
