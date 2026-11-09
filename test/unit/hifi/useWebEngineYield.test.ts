// @vitest-environment jsdom
import React, { act } from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hifi/useWebEngineYield.test.ts
// 路线切到 HiFi 的那一下 Web 引擎让位（finding #28）：在 setState 里同步停掉过渡、暂停并卸空两个 deck、挂起 AudioContext；
// 切回 Web 恢复 AudioContext；App 的 deck 带上能被找到的属性，事件处理在 HiFi 路线上什么都不做。

const { installWebEngineYield, findPlaybackDecks, useWebEngineYield, PLAYBACK_DECK_ATTRIBUTE } = await import('@/components/hifi/useWebEngineYield');
const { usePlaybackStore, setAudioSrc, setPlaybackRoute } = await import('@/stores/usePlaybackStore');

type FakeContext = { state: AudioContextState; suspend: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> };

const fakeContext = (state: AudioContextState = 'running'): FakeContext => {
    const context: FakeContext = {
        state,
        suspend: vi.fn(async () => { context.state = 'suspended'; }),
        resume: vi.fn(async () => { context.state = 'running'; }),
    };
    return context;
};

/** 一个“正在放”的 deck：jsdom 的媒体元素不会真的放，pause / load 换成记录调用的假实现。 */
const playingDeck = (deck: string, log: string[]) => {
    const element = document.createElement('audio');
    element.setAttribute(PLAYBACK_DECK_ATTRIBUTE, deck);
    element.setAttribute('src', `blob:deck-${deck}`);
    let paused = false;
    Object.defineProperty(element, 'paused', { configurable: true, get: () => paused });
    element.pause = vi.fn(() => { paused = true; log.push(`pause ${deck}`); });
    element.load = vi.fn(() => { log.push(`load ${deck} src=${element.getAttribute('src')}`); });
    document.body.appendChild(element);
    return element;
};

let unsubscribe: (() => void) | null = null;
let root: Root | null = null;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: 'blob:deck-A' });
});

afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = '';
    usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null });
    vi.restoreAllMocks();
});

describe('installWebEngineYield', () => {
    it('stops the blend, pauses and unloads both decks and suspends the AudioContext inside the route write', () => {
        const log: string[] = [];
        const deckA = playingDeck('A', log);
        const deckB = playingDeck('B', log);
        const context = fakeContext();
        const abortTransition = vi.fn(() => { log.push('abort transition'); });
        unsubscribe = installWebEngineYield({
            decks: () => findPlaybackDecks(null),
            audioContext: () => context as unknown as AudioContext,
            abortTransition,
        });

        // What beginHifiTrack writes; nothing is awaited in between.
        setAudioSrc(null);
        setPlaybackRoute('hifi');

        expect(log).toEqual([
            'abort transition',
            'pause A',
            'load A src=null',
            'pause B',
            'load B src=null',
        ]);
        expect(deckA.paused).toBe(true);
        expect(deckB.paused).toBe(true);
        expect(deckA.hasAttribute('src')).toBe(false);
        expect(deckB.hasAttribute('src')).toBe(false);
        expect(context.suspend).toHaveBeenCalledOnce();
    });

    it('yields once per flip, not on every store write while on HiFi', () => {
        const log: string[] = [];
        playingDeck('A', log);
        const context = fakeContext();
        const abortTransition = vi.fn();
        unsubscribe = installWebEngineYield({
            decks: () => findPlaybackDecks(null),
            audioContext: () => context as unknown as AudioContext,
            abortTransition,
        });

        setPlaybackRoute('hifi');
        usePlaybackStore.setState({ duration: 42 });
        setPlaybackRoute('hifi');

        expect(abortTransition).toHaveBeenCalledOnce();
        expect(context.suspend).toHaveBeenCalledOnce();
    });

    it('resumes the AudioContext when the route goes back to web, so the next web song is heard', async () => {
        const context = fakeContext();
        unsubscribe = installWebEngineYield({
            decks: () => [],
            audioContext: () => context as unknown as AudioContext,
            abortTransition: vi.fn(),
        });
        setPlaybackRoute('hifi');
        await Promise.resolve();
        expect(context.state).toBe('suspended');

        setPlaybackRoute('web');

        expect(context.resume).toHaveBeenCalledOnce();
    });

    it('sees the flip back to web that the route guard writes inside another subscriber', () => {
        const context = fakeContext('suspended');
        // The order App mounts them in: this hook's subscription comes first, the route guard's after it.
        unsubscribe = installWebEngineYield({
            decks: () => [],
            audioContext: () => context as unknown as AudioContext,
            abortTransition: vi.fn(),
        });
        usePlaybackStore.setState({ playbackRoute: 'hifi', audioSrc: null });
        context.state = 'suspended';
        const guard = usePlaybackStore.subscribe((state) => {
            if (state.playbackRoute === 'hifi' && state.audioSrc !== null) setPlaybackRoute('web');
        });

        setAudioSrc('https://cdn.example/web.mp3');
        guard();

        expect(usePlaybackStore.getState().playbackRoute).toBe('web');
        expect(context.resume).toHaveBeenCalledOnce();
    });

    it('leaves a context that is not running alone on the way to HiFi', () => {
        const closed = fakeContext('closed');
        unsubscribe = installWebEngineYield({ decks: () => [], audioContext: () => closed as unknown as AudioContext, abortTransition: vi.fn() });
        setPlaybackRoute('hifi');
        expect(closed.suspend).not.toHaveBeenCalled();
    });

    it('still unloads the decks when the blend cannot be stopped', () => {
        const log: string[] = [];
        playingDeck('A', log);
        unsubscribe = installWebEngineYield({
            decks: () => findPlaybackDecks(null),
            audioContext: () => null,
            abortTransition: () => { throw new Error('no session'); },
        });
        setPlaybackRoute('hifi');
        expect(log).toEqual(['pause A', 'load A src=null']);
    });
});

describe('findPlaybackDecks', () => {
    it('finds the marked decks and the active one, once each, and nothing else on the page', () => {
        const log: string[] = [];
        const deckA = playingDeck('A', log);
        const deckB = playingDeck('B', log);
        const other = document.createElement('audio');
        document.body.appendChild(other);
        const unmarked = document.createElement('audio');

        expect(findPlaybackDecks(deckA)).toEqual([deckA, deckB]);
        expect(findPlaybackDecks(unmarked)).toEqual([deckA, deckB, unmarked]);
    });
});

describe('useWebEngineYield', () => {
    it('subscribes on mount, reads the newest automix, and unsubscribes on unmount', () => {
        const log: string[] = [];
        playingDeck('A', log);
        const context = fakeContext();
        const first = { abortTransition: vi.fn() };
        const second = { abortTransition: vi.fn() };
        const audioRef = { current: null as HTMLAudioElement | null };
        const audioContextRef = { current: context as unknown as AudioContext };
        function Probe({ automix }: { automix: { abortTransition: () => void } }) {
            useWebEngineYield({ audioRef, audioContextRef, automix });
            return null;
        }
        root = createRoot(document.createElement('div'));
        act(() => root!.render(React.createElement(Probe, { automix: first })));
        act(() => root!.render(React.createElement(Probe, { automix: second })));

        act(() => setPlaybackRoute('hifi'));
        expect(first.abortTransition).not.toHaveBeenCalled();
        expect(second.abortTransition).toHaveBeenCalledOnce();
        expect(log).toEqual(['pause A', 'load A src=null']);

        act(() => root!.unmount());
        root = null;
        act(() => setPlaybackRoute('web'));
        act(() => setPlaybackRoute('hifi'));
        expect(second.abortTransition).toHaveBeenCalledOnce();
    });
});

describe('the decks in App', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../../../src/App.tsx'), 'utf8');
    const deckStart = app.indexOf('const renderAudioDeck = ');
    const deck = app.slice(deckStart, app.indexOf('\n    );\n', deckStart));

    it('mounts the yield with the decks it unloads, and marks each deck so it can be found', () => {
        expect(app).toMatch(/useWebEngineYield\(\{ audioRef, audioContextRef, automix \}\);/);
        expect(deck).toContain(`${PLAYBACK_DECK_ATTRIBUTE}={deck}`);
        // No deck is handed a source while mpv plays the song.
        expect(deck).toContain("src={playbackRoute === 'hifi' ? undefined : automix.deckSrc(deck)}");
    });

    it.each(['onPlay', 'onPlaying', 'onPause', 'onTimeUpdate', 'onSeeked', 'onEnded', 'onLoadedMetadata', 'onError'])(
        'does nothing in %s while the route is HiFi',
        (handler) => {
            const start = deck.indexOf(`${handler}={(e) => {`);
            expect(start).toBeGreaterThan(-1);
            // The guard comes before anything the handler writes (onPause first spends a flushed fade's mark).
            const head = deck.slice(start, start + 800).split('\n').slice(1, 7).join('\n');
            expect(head).toMatch(/if \(isHifiRoute\(\)\) return;/);
        },
    );
});
