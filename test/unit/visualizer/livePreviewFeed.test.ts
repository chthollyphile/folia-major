import { motionValue } from 'framer-motion';
import { describe, expect, it } from 'vitest';
import {
    createLivePreviewFeed,
    createTimePulse,
    PULSE_MS,
    trackRestTime,
    type LivePreviewContent,
    type LivePreviewScheduler,
    type LivePreviewSource,
} from '@/components/visualizer/preview/livePreviewFeed';
import { HELD_TIME_STEP } from '@/components/visualizer/preview/usePreviewClock';
import { readLivePreviewContent } from '@/components/visualizer/preview/useLivePreviewFeed';

// test/unit/visualizer/livePreviewFeed.test.ts
// The live source of the lyric previews: follows the player while it runs, holds the picture of the
// moment it is paused (nothing subscribed), and stirs a held picture for a short while.

// One array, as the player's store holds the lines of a song: a new one means the lyrics changed.
const LINES = [{ startTime: 0, endTime: 4, fullText: 'la', words: [] }] as unknown as LivePreviewContent['lines'];

const content = (overrides: Partial<LivePreviewContent> = {}): LivePreviewContent => ({
    lines: LINES,
    duration: 200,
    songTitle: 'Song',
    coverUrl: null,
    currentLineIndex: 0,
    seed: 'live-preview-1',
    ...overrides,
});

/** A player the test drives by hand: what it shows, who listens, and its signals. */
const makePlayer = (initial: LivePreviewContent | null) => {
    const state = { content: initial };
    const listeners = new Set<() => void>();
    const playbackTime = motionValue(1);
    const signals = {
        currentTime: motionValue(1),
        audioPower: motionValue(0.5),
        audioBands: {
            bass: motionValue(0.1),
            lowMid: motionValue(0.2),
            mid: motionValue(0.3),
            vocal: motionValue(0.4),
            treble: motionValue(0.5),
            spectrum: motionValue(new Uint8Array(4)),
        },
    };
    const source: LivePreviewSource = {
        read: () => (state.content ? { ...state.content } : null),
        subscribe: (listener) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        signals,
        playbackTime,
    };
    return {
        source,
        signals,
        playbackTime,
        listeners,
        /** One write of the player's store, which tells its listeners. */
        write: (next: LivePreviewContent | null) => {
            state.content = next;
            listeners.forEach(listener => listener());
        },
    };
};

/** A frame loop the test steps by hand. */
const makeScheduler = () => {
    let now = 0;
    let nextHandle = 1;
    const frames = new Map<number, () => void>();
    const scheduler: LivePreviewScheduler = {
        now: () => now,
        requestFrame: (callback) => {
            const handle = nextHandle++;
            frames.set(handle, callback);
            return handle;
        },
        cancelFrame: (handle) => { frames.delete(handle); },
    };
    return {
        scheduler,
        pending: () => frames.size,
        /** One frame, `ms` later. */
        frame: (ms = 16) => {
            now += ms;
            const due = [...frames.values()];
            frames.clear();
            due.forEach(callback => callback());
        },
        /** Frames until the time is `ms` further on. */
        advance: function advance(ms: number) {
            const end = now + ms;
            while (now < end) this.frame(Math.min(16, end - now));
        },
    };
};

describe('live preview feed: following', () => {
    it('keeps media progress separate from the lyric clock of a preview clip', () => {
        const player = makePlayer(content({ duration: 30 }));
        player.playbackTime.set(5);
        // A clip starts 60 seconds into the song, with a 500 ms manual lyric offset.
        player.signals.currentTime.set(64.5);
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        const detach = feed.attach(true);

        expect(feed.playbackTime.get()).toBe(5);
        expect(feed.currentTime.get()).toBe(64.5);

        player.playbackTime.set(6);
        player.signals.currentTime.set(65.5);
        expect(feed.playbackTime.get()).toBe(6);
        expect(feed.currentTime.get()).toBe(65.5);

        detach();
        player.playbackTime.set(7);
        expect(feed.playbackTime.get()).toBe(6);
    });

    it('takes what the player shows and its signals on attach', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        expect(feed.getContent()).toBeNull();

        feed.attach(true);

        expect(feed.getContent()).toEqual(content());
        expect(feed.currentTime.get()).toBe(1);
        expect(feed.audioPower.get()).toBe(0.5);
        expect(feed.audioBands.vocal.get()).toBe(0.4);
    });

    it('keeps up with the player and tells its listeners only when the picture changed', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        let told = 0;
        feed.subscribe(() => { told += 1; });
        feed.attach(true);
        told = 0;

        player.write(content());
        expect(told).toBe(0);

        player.write(content({ currentLineIndex: 1 }));
        player.signals.currentTime.set(3);
        player.signals.audioBands.bass.set(0.9);
        expect(told).toBe(1);
        expect(feed.getContent()?.currentLineIndex).toBe(1);
        expect(feed.currentTime.get()).toBe(3);
        expect(feed.audioBands.bass.get()).toBe(0.9);
    });

    it('has no content while the player has no lyric lines, and takes it when they arrive', () => {
        const player = makePlayer(null);
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(true);
        expect(feed.getContent()).toBeNull();

        player.write(content());
        expect(feed.getContent()).toEqual(content());
    });

    it('stops listening on detach', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        const detach = feed.attach(true);
        detach();

        player.write(content({ currentLineIndex: 5 }));
        player.signals.currentTime.set(9);

        expect(player.listeners.size).toBe(0);
        expect(feed.getContent()?.currentLineIndex).toBe(0);
        expect(feed.currentTime.get()).toBe(1);
    });

    it('lets a new attachment end the one before', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(true);
        feed.attach(true);
        expect(player.listeners.size).toBe(1);
    });

    it('forgets the picture on clear and tells its listeners', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(true);
        let told = 0;
        feed.subscribe(() => { told += 1; });

        feed.clear();

        expect(feed.getContent()).toBeNull();
        expect(told).toBe(1);
    });
});

describe('live preview feed: holding', () => {
    it('freezes media progress without pulsing it, then catches up on resume', () => {
        const player = makePlayer(content({ duration: 30 }));
        player.playbackTime.set(5);
        player.signals.currentTime.set(64.5);
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        const detach = feed.attach(false);
        const progressChanges: number[] = [];
        const stop = feed.playbackTime.on('change', latest => progressChanges.push(latest));

        player.playbackTime.set(12);
        player.signals.currentTime.set(71.5);
        loop.advance(PULSE_MS + 100);
        feed.nudge();
        loop.advance(PULSE_MS + 100);

        expect(feed.playbackTime.get()).toBe(5);
        expect(feed.currentTime.get()).toBe(64.5);
        expect(progressChanges).toEqual([]);

        detach();
        const resume = feed.attach(true);
        expect(feed.playbackTime.get()).toBe(12);
        expect(feed.currentTime.get()).toBe(71.5);
        stop();
        resume();
    });

    it('holds the picture of the moment it is attached, and subscribes to nothing', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(false);

        player.write(content({ lines: [], currentLineIndex: 7, seed: 'live-preview-2' }));
        player.signals.currentTime.set(40);
        player.signals.audioPower.set(0.99);

        expect(player.listeners.size).toBe(0);
        expect(feed.getContent()).toEqual(content());
        expect(feed.audioPower.get()).toBe(0.5);
        expect(Math.abs(feed.currentTime.get() - 1)).toBeLessThanOrEqual(HELD_TIME_STEP);
    });

    it('is not changed by the several writes a song change is made of', () => {
        const player = makePlayer(null);
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(false);

        // Lyrics first, then the length, then the line, as the stage controller writes them.
        player.write(content({ duration: 0, currentLineIndex: -1 }));
        player.write(content({ duration: 200, currentLineIndex: -1 }));
        player.write(content({ duration: 200, currentLineIndex: 0 }));

        expect(feed.getContent()).toBeNull();
    });

    it('stays without content until it follows again, then takes what is there', () => {
        const player = makePlayer(null);
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(false);
        player.write(content());
        expect(feed.getContent()).toBeNull();

        feed.attach(true);

        expect(feed.getContent()).toEqual(content());
    });

    it('goes back to what the player shows now when it follows again', () => {
        const player = makePlayer(content());
        const feed = createLivePreviewFeed(player.source, makeScheduler().scheduler);
        feed.attach(false);
        player.write(content({ currentLineIndex: 3, seed: 'live-preview-9' }));
        player.signals.currentTime.set(77);

        feed.attach(true);

        expect(feed.getContent()?.seed).toBe('live-preview-9');
        expect(feed.currentTime.get()).toBe(77);
    });
});

describe('live preview feed: stirring a held picture', () => {
    it('steps the time by a hair each frame and ends on the held time itself', () => {
        const player = makePlayer(content());
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        feed.attach(false);
        const seen = new Set<number>();
        feed.currentTime.on('change', latest => seen.add(latest));

        loop.advance(PULSE_MS + 100);

        expect([...seen].every(time => time === 1 || time === 1 + HELD_TIME_STEP)).toBe(true);
        expect(seen.size).toBe(2);
        expect(feed.currentTime.get()).toBe(1);
        expect(loop.pending()).toBe(0);
    });

    it('ignores a nudge while it is stirring, and stirs again after it has ended', () => {
        const player = makePlayer(content());
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        feed.attach(false);
        loop.frame();
        const before = loop.pending();

        feed.nudge();
        expect(loop.pending()).toBe(before);

        loop.advance(PULSE_MS + 100);
        expect(loop.pending()).toBe(0);

        feed.nudge();
        expect(loop.pending()).toBe(1);
    });

    it('does not take the picture again on a nudge', () => {
        const player = makePlayer(content());
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        feed.attach(false);
        loop.advance(PULSE_MS + 100);

        player.write(content({ currentLineIndex: 4 }));
        feed.nudge();
        loop.advance(PULSE_MS + 100);

        expect(feed.getContent()?.currentLineIndex).toBe(0);
        expect(feed.currentTime.get()).toBe(1);
    });

    it('stirs a followed picture only while the player\'s clock stands still', () => {
        const player = makePlayer(content());
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        feed.attach(true);
        loop.advance(400);

        // The player's clock moved a moment ago: it tells the styles where it is.
        player.signals.currentTime.set(2);
        feed.nudge();
        expect(loop.pending()).toBe(0);

        // It has stood still for a while: the time is stirred around the player's, and ends on it.
        loop.advance(400);
        feed.nudge();
        expect(loop.pending()).toBe(1);
        expect(feed.pulsing()).toBe(true);
        loop.advance(PULSE_MS + 100);
        expect(feed.pulsing()).toBe(false);
        expect(feed.currentTime.get()).toBe(2);
    });

    it('stirs a followed picture at once when the player has not moved at all', () => {
        const player = makePlayer(content());
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        feed.attach(true);

        feed.nudge();

        expect(loop.pending()).toBe(1);
    });

    it('has nothing to stir before it is attached, and stops stirring on detach', () => {
        const player = makePlayer(content());
        const loop = makeScheduler();
        const feed = createLivePreviewFeed(player.source, loop.scheduler);
        feed.nudge();
        expect(loop.pending()).toBe(0);

        const hold = feed.attach(false);
        expect(loop.pending()).toBe(1);
        hold();
        expect(loop.pending()).toBe(0);
        feed.nudge();
        expect(loop.pending()).toBe(0);
    });
});

describe('time pulse', () => {
    it('steps the time by a hair each frame for PULSE_MS and ends on the base time', () => {
        const loop = makeScheduler();
        const time = motionValue(5);
        const pulse = createTimePulse(time, loop.scheduler);
        const seen = new Set<number>();
        time.on('change', latest => seen.add(latest));

        pulse.start(() => 5);
        expect(pulse.running()).toBe(true);
        loop.advance(PULSE_MS + 100);

        expect(pulse.running()).toBe(false);
        expect([...seen].every(value => value === 5 || value === 5 + HELD_TIME_STEP)).toBe(true);
        expect(time.get()).toBe(5);
        expect(loop.pending()).toBe(0);
    });

    it('reads the base time each frame, so a time that moves is followed', () => {
        const loop = makeScheduler();
        const time = motionValue(0);
        const pulse = createTimePulse(time, loop.scheduler);
        let base = 10;

        pulse.start(() => base);
        base = 20;
        loop.advance(PULSE_MS + 100);

        expect(time.get()).toBe(20);
    });

    it('rests on a time set from outside while it is being stirred', () => {
        const loop = makeScheduler();
        const time = motionValue(8);
        const rest = trackRestTime(time);
        const pulse = createTimePulse(time, loop.scheduler);

        pulse.start(rest.get);
        loop.advance(500);
        // The sample starts over with another style, halfway through the pulse.
        time.set(4);
        loop.advance(PULSE_MS + 100);

        expect(time.get()).toBe(4);
        expect(rest.get()).toBe(4);
        rest.stop();
    });

    it('does not take its own steps for a time set from outside', () => {
        const loop = makeScheduler();
        const time = motionValue(8);
        const rest = trackRestTime(time);
        const pulse = createTimePulse(time, loop.scheduler);

        pulse.start(rest.get);
        loop.advance(PULSE_MS + 100);

        expect(rest.get()).toBe(8);
        expect(time.get()).toBe(8);
        rest.stop();
    });

    it('can be stopped, and started again', () => {
        const loop = makeScheduler();
        const pulse = createTimePulse(motionValue(0), loop.scheduler);
        pulse.start(() => 0);
        pulse.stop();
        expect(pulse.running()).toBe(false);
        expect(loop.pending()).toBe(0);

        pulse.start(() => 0);
        expect(pulse.running()).toBe(true);
    });
});

describe('reading the player', () => {
    const state = (overrides: Record<string, unknown> = {}) => ({
        transitionDisplay: null,
        currentSong: { id: 42, name: 'Song' },
        cachedCoverUrl: 'https://example.test/cover.jpg',
        lyrics: { lines: [{ startTime: 0, endTime: 1, fullText: 'la', words: [] }] },
        duration: 215,
        currentLineIndex: 0,
        ...overrides,
    }) as unknown as Parameters<typeof readLivePreviewContent>[0];

    it('reads the song, lyrics, cover, length and line the player shows', () => {
        expect(readLivePreviewContent(state())).toMatchObject({
            songTitle: 'Song',
            coverUrl: 'https://example.test/cover.jpg',
            duration: 215,
            currentLineIndex: 0,
            seed: 'live-preview-42',
        });
    });

    it('has nothing to read without lyric lines', () => {
        expect(readLivePreviewContent(state({ lyrics: null }))).toBeNull();
        expect(readLivePreviewContent(state({ lyrics: { lines: [] } }))).toBeNull();
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('reads a length of %s as unknown (0)', (duration) => {
        expect(readLivePreviewContent(state({ duration }))?.duration).toBe(0);
    });

    it('has one seed per song', () => {
        expect(readLivePreviewContent(state({ currentSong: { id: 7, name: 'B' } }))?.seed).toBe('live-preview-7');
    });
});
