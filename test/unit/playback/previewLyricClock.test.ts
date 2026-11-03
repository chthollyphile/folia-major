import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData } from '@/types';
import { PlayerState } from '@/types';
import { currentTime, handoffLyricCurrentTime, lyricCurrentTime } from '@/stores/motionSignals';
import { setCurrentLineIndex } from '@/stores/usePlaybackStore';
import { usePlaybackVisualizerBridge } from '@/components/app/playback/bridges/usePlaybackVisualizerBridge';
import { buildObsBrowserSourceClock, resolveObsBrowserSourceClockTime } from '@/utils/obsBrowserSource';

// Exercises the real frame and handover paths without a renderer, using the same preview lookup
// contract as the OBS publisher. Media progress and saved manual offsets remain clip-relative.
const env = vi.hoisted(() => ({
    effects: [] as Array<() => unknown>,
    cleanup: [] as Array<() => void>,
    frame: null as FrameRequestCallback | null,
    subscriber: null as ((state: any, previous: any) => void) | null,
    state: {} as any,
    starts: new Map<string, number>(),
    version: 0,
    lookup: vi.fn((url: string): number => 0),
}));
vi.mock('react', async importOriginal => ({
    ...(await importOriginal<typeof import('react')>()),
    useCallback: (fn: unknown) => fn,
    useRef: (value: unknown) => ({ current: value }),
    useEffect: (fn: () => unknown) => { env.effects.push(fn); },
}));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: Object.assign(
        (selector: (state: any) => unknown) => selector(env.state),
        { subscribe: (fn: typeof env.subscriber) => { env.subscriber = fn; return () => {}; } },
    ),
    selectDisplayLyrics: (state: any) => state.transitionDisplay?.lyrics ?? state.lyrics,
    setCurrentLineIndex: vi.fn(),
    setHandoffLineIndex: vi.fn(),
    setPlayerState: vi.fn(),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: {
    previewClipStartMsOfAudioSource: env.lookup,
    audioSourceMetadataVersion: () => env.version,
} }));
vi.mock('@/hooks/useBeatFxTrack', () => ({ useBeatFxTrack: () => false }));
vi.mock('@/services/beatFx/beatFxLive', () => ({ tickBeatFx: vi.fn() }));
vi.mock('@/services/automix/transitionCue', () => ({ getTransitionHandoffProgress: () => 0.5 }));

const lyrics: LyricData = { lines: [{ fullText: 'clip', startTime: 30, endTime: 90, words: [] }] };
const audio = (url: string, time = 2) => ({ currentSrc: url, currentTime: time, paused: false, ended: false }) as HTMLAudioElement;
const mount = (incoming: HTMLAudioElement, displayed: HTMLAudioElement | null = null) => {
    usePlaybackVisualizerBridge({
        audioRef: { current: incoming }, analyserRef: { current: null }, animationFrameRef: { current: 0 },
        effectiveLoopMode: 'off', isNowPlayingStageActive: false, isPlayerCapStageActive: false,
        stageActiveEntryKind: null, stageLyricsSession: null,
        stageLyricsClockRef: { current: { startTimeSec: 0, endTimeSec: 0, baseTimeSec: 0, startedAtMs: null } },
        getSyntheticStageLyricsTime: () => 0, syncStageLyricsClock: vi.fn(),
        getNowPlayingDisplayTime: () => 0, getPlayerCapDisplayTime: () => 0, syncNowPlayingClock: vi.fn(),
        lyricTimelineOffsetMs: 500, incomingLyricTimelineOffsetMs: 1000,
        isTransitionAudible: () => displayed !== null, getDisplayElement: () => displayed,
    });
    for (const effect of env.effects.splice(0)) {
        const cleanup = effect();
        if (typeof cleanup === 'function') env.cleanup.push(cleanup as () => void);
    }
};
const frame = () => { expect(env.frame).not.toBeNull(); env.frame!(0); };
// The paused-deck sync listens on the document in the capture phase; a stand-in that keeps the listeners.
const mediaEvents = () => {
    const listeners = new Map<string, Set<(event: Event) => void>>();
    vi.stubGlobal('document', {
        addEventListener: (type: string, fn: (event: Event) => void, capture: boolean) => {
            expect(capture).toBe(true);
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(fn);
        },
        removeEventListener: (type: string, fn: (event: Event) => void) => { listeners.get(type)?.delete(fn); },
    });
    return (type: 'loadedmetadata' | 'seeked', target: HTMLAudioElement) => {
        listeners.get(type)?.forEach(fn => fn({ type, target } as unknown as Event));
    };
};
const pausedAudio = (url: string, time = 0) => Object.assign(audio(url, time), { paused: true }) as HTMLAudioElement;
const obs = (url: string, manualOffsetMs = 500) => buildObsBrowserSourceClock({
    currentTime: currentTime.get(), duration: 30, playerState: PlayerState.PLAYING,
    sentAtMs: 1000, playbackRate: 1, lyricOffsetMs: manualOffsetMs,
}, env.starts.get(url) ?? 0);

beforeEach(() => {
    env.starts.clear(); env.version = 0;
    env.lookup.mockReset().mockImplementation(url => env.starts.get(url) ?? 0);
    env.effects = []; env.cleanup = []; env.subscriber = null;
    env.state = { activePlaybackContext: 'main', playerState: PlayerState.PLAYING, duration: 30, lyrics, transitionDisplay: null };
    currentTime.set(0); lyricCurrentTime.set(0); handoffLyricCurrentTime.set(0);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { env.frame = fn; return 1; });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    // The loop's background-throttling hold schedules on window timers (and always clears one on cleanup).
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout });
});
afterEach(() => { env.cleanup.forEach(fn => fn()); vi.unstubAllGlobals(); });

describe('preview lyric clock consumers', () => {
    it('aligns main and OBS at 31.5 s without changing the 2 s media position or 500 ms manual offset', () => {
        env.starts.set('https://audio.test/preview', 30000);
        mount(audio('https://audio.test/preview'));
        frame(); frame();
        expect(currentTime.get()).toBe(2);
        expect(lyricCurrentTime.get()).toBe(31.5);
        expect(env.lookup).toHaveBeenCalledTimes(1);
        const clock = obs('https://audio.test/preview');
        expect(clock.currentTime).toBe(2);
        expect(clock.duration).toBe(30);
        expect(resolveObsBrowserSourceClockTime(clock, 1000)).toBe(lyricCurrentTime.get());
        expect(resolveObsBrowserSourceClockTime(clock, 2000)).toBe(32.5);
        expect(resolveObsBrowserSourceClockTime(clock, 100000)).toBe(59.5);
        expect(resolveObsBrowserSourceClockTime({ ...clock, playerState: PlayerState.PAUSED }, 100000)).toBe(31.5);
    });

    it.each(['file:///music/song.flac', 'blob:http://localhost/cached-song', 'https://navidrome.test/stream', ''])('leaves a non-preview source unchanged: %s', url => {
        mount(audio(url)); frame();
        expect(currentTime.get()).toBe(2);
        expect(lyricCurrentTime.get()).toBe(1.5);
        expect(resolveObsBrowserSourceClockTime(obs(url), 1000)).toBe(1.5);
    });

    it.each(['replaced by full song', 'evicted'])('invalidates a cached clip start when its registry entry is %s', () => {
        const url = 'https://audio.test/reused-url';
        env.starts.set(url, 30000);
        mount(audio(url)); frame();
        expect(lyricCurrentTime.get()).toBe(31.5);
        env.starts.delete(url); env.version++;
        frame();
        expect(currentTime.get()).toBe(2);
        expect(lyricCurrentTime.get()).toBe(1.5);
        expect(resolveObsBrowserSourceClockTime(obs(url), 1000)).toBe(1.5);
        expect(env.lookup).toHaveBeenCalledTimes(2);
        // A later re-registration also reaches the existing deck without a URL change.
        env.starts.set(url, 60000); env.version++;
        frame();
        expect(lyricCurrentTime.get()).toBe(61.5);
        expect(resolveObsBrowserSourceClockTime(obs(url), 1000)).toBe(61.5);
    });

    it('drops the previous preview offset when a deck switches to a cached or local file', () => {
        const deck = audio('https://audio.test/old-preview');
        env.starts.set(deck.currentSrc, 30000);
        mount(deck); frame();
        expect(lyricCurrentTime.get()).toBe(31.5);
        Object.assign(deck, { currentSrc: 'blob:http://localhost/full-song', currentTime: 8 });
        frame();
        expect(lyricCurrentTime.get()).toBe(7.5);
        expect(resolveObsBrowserSourceClockTime(obs(deck.currentSrc), 1000)).toBe(7.5);
    });

    it('looks up the restored deck by its current URL, not a previous track or saved manual offset', () => {
        env.starts.set('https://audio.test/restored-preview', 60000);
        mount(audio('https://audio.test/restored-preview', 7)); frame();
        expect(lyricCurrentTime.get()).toBe(66.5);
        expect(resolveObsBrowserSourceClockTime(obs('https://audio.test/restored-preview'), 1000)).toBe(66.5);
    });

    it('keeps outgoing and incoming clip clocks separate, then continues the incoming clock at handover', () => {
        const outgoing = audio('https://audio.test/outgoing', 20);
        const incoming = audio('https://audio.test/incoming', 3);
        env.starts.set(outgoing.currentSrc, 30000); env.starts.set(incoming.currentSrc, 60000);
        env.state.transitionDisplay = { lyrics };
        mount(incoming, outgoing); frame();
        expect(currentTime.get()).toBe(20);
        expect(lyricCurrentTime.get()).toBe(49.5);
        expect(handoffLyricCurrentTime.get()).toBe(62);
        expect(resolveObsBrowserSourceClockTime(obs(outgoing.currentSrc), 1000)).toBe(49.5);
        const previous = env.state;
        env.state = { ...env.state, transitionDisplay: null, transitionEnd: 'handedOver' };
        env.subscriber!(env.state, previous);
        expect(currentTime.get()).toBe(3);
        expect(lyricCurrentTime.get()).toBe(62);
        expect(resolveObsBrowserSourceClockTime(obs(incoming.currentSrc, 1000), 1000)).toBe(62);
    });

    it('puts a paused restored preview clip at its clip start, then at its saved position, with no jump on play', () => {
        const dispatch = mediaEvents();
        const url = 'https://audio.test/restored-paused-preview';
        env.starts.set(url, 64300);
        const deck = pausedAudio(url);
        mount(deck);
        // The song change reset the read-head to the top of the whole song (500 ms manual offset).
        lyricCurrentTime.set(-0.5);
        frame();
        expect(lyricCurrentTime.get()).toBe(-0.5);
        dispatch('loadedmetadata', deck);
        expect(lyricCurrentTime.get()).toBeCloseTo(63.8, 6);
        expect(setCurrentLineIndex).toHaveBeenLastCalledWith(0);
        // App applies the saved position after the metadata, which the deck answers with `seeked`.
        deck.currentTime = 7;
        dispatch('seeked', deck);
        expect(lyricCurrentTime.get()).toBeCloseTo(70.8, 6);
        frame();
        expect(lyricCurrentTime.get()).toBeCloseTo(70.8, 6);
        Object.assign(deck, { paused: false });
        frame();
        expect(lyricCurrentTime.get()).toBeCloseTo(70.8, 6);
    });

    it('leaves a full song paused at its start where the song-change reset put it', () => {
        const dispatch = mediaEvents();
        const deck = pausedAudio('blob:http://localhost/full-song');
        mount(deck);
        lyricCurrentTime.set(-0.5);
        dispatch('loadedmetadata', deck);
        expect(lyricCurrentTime.get()).toBe(-0.5);
    });

    it('ignores the other deck, a held blend, a playing deck and a stage clock', () => {
        const dispatch = mediaEvents();
        const url = 'https://audio.test/paused-preview';
        env.starts.set(url, 30000);
        const deck = pausedAudio(url, 4);
        const other = pausedAudio('https://audio.test/other', 9);
        mount(deck, other);
        lyricCurrentTime.set(-0.5);
        // A blend holds the picture on the other deck: this one is the incoming track.
        dispatch('loadedmetadata', deck);
        dispatch('seeked', other);
        expect(lyricCurrentTime.get()).toBe(-0.5);
        env.cleanup.forEach(fn => fn()); env.cleanup = [];

        mount(deck);
        dispatch('seeked', other);
        expect(lyricCurrentTime.get()).toBe(-0.5);
        Object.assign(deck, { paused: false });
        dispatch('seeked', deck);
        expect(lyricCurrentTime.get()).toBe(-0.5);
        Object.assign(deck, { paused: true });
        env.cleanup.forEach(fn => fn()); env.cleanup = [];

        env.state = { ...env.state, activePlaybackContext: 'stage' };
        mount(deck);
        dispatch('seeked', deck);
        expect(lyricCurrentTime.get()).toBe(-0.5);
    });
});
