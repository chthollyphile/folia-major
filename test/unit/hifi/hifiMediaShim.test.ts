import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybackRoute } from '@/types/hifi';
import { HIFI_TIMEUPDATE_INTERVAL_MS, HifiMediaShim, getObservedMedia, hifiMediaShim } from '@/services/hifi/hifiMediaShim';

// test/unit/hifi/hifiMediaShim.test.ts
// The stand-in <audio> the read-only observers watch while mpv plays: read-only properties, the
// native event order, the 250 ms timeupdate cadence, the start announced again for a song the player
// took over while mpv already played it, and the route switch in getObservedMedia.

const playback = vi.hoisted(() => ({ state: { playbackRoute: 'web' as PlaybackRoute } }));
vi.mock('@/stores/usePlaybackStore', () => ({ usePlaybackStore: { getState: () => playback.state } }));

const TRACKED_EVENTS = ['play', 'playing', 'pause', 'timeupdate', 'seeked', 'ended', 'loadedmetadata', 'durationchange'];

const record = (shim: HifiMediaShim) => {
    const events: string[] = [];
    for (const type of TRACKED_EVENTS) shim.addEventListener(type, () => events.push(type));
    return events;
};

describe('HifiMediaShim', () => {
    let clockSec = 0;
    let shim: HifiMediaShim;

    beforeEach(() => {
        vi.useFakeTimers();
        clockSec = 0;
        shim = new HifiMediaShim(() => clockSec);
    });

    afterEach(() => {
        shim.reset();
        vi.useRealTimers();
    });

    it('looks like an empty media element before a track begins', () => {
        expect(shim.currentTime).toBe(0);
        expect(shim.duration).toBeNaN();
        expect(shim.readyState).toBe(0);
        expect(shim.paused).toBe(true);
        expect(shim.ended).toBe(false);
        expect(shim.playbackRate).toBe(1);
        expect(shim.currentSrc).toBe('');
        expect(shim.src).toBe('');
    });

    it('names the source after the track and has no metadata until the duration is set', () => {
        shim.beginTrack('local:song-1#a1');
        expect(shim.currentSrc).toBe('hifi:local:song-1#a1');
        expect(shim.src).toBe('hifi:local:song-1#a1');
        expect(shim.readyState).toBe(0);
        expect(shim.duration).toBeNaN();

        shim.setDuration(180.5);
        expect(shim.readyState).toBe(1);
        expect(shim.duration).toBe(180.5);
    });

    it('fires durationchange and loadedmetadata once per track', () => {
        const events = record(shim);
        shim.beginTrack('t1');
        shim.setDuration(Number.NaN);
        shim.setDuration(0);
        expect(events).toEqual([]);
        shim.setDuration(200);
        shim.setDuration(200);
        expect(events).toEqual(['durationchange', 'loadedmetadata']);
        // A refined length is a duration change, not new metadata.
        shim.setDuration(201);
        expect(events).toEqual(['durationchange', 'loadedmetadata', 'durationchange']);

        shim.beginTrack('t2');
        expect(shim.readyState).toBe(0);
        shim.setDuration(90);
        expect(events.slice(3)).toEqual(['durationchange', 'loadedmetadata']);
    });

    it('reads the time from the injected clock', () => {
        shim.beginTrack('t1');
        shim.setDuration(100);
        clockSec = 12.5;
        expect(shim.currentTime).toBe(12.5);
        clockSec = Number.NaN;
        expect(shim.currentTime).toBe(0);
        clockSec = 150;
        expect(shim.currentTime).toBe(100);

        const replacement = vi.fn(() => 33);
        shim.setClockReader(replacement);
        expect(shim.currentTime).toBe(33);
    });

    it('fires play and playing, then timeupdate every 250 ms only while playing', () => {
        const events = record(shim);
        shim.beginTrack('t1');
        shim.setDuration(100);
        events.length = 0;

        vi.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        shim.markPlaying();
        expect(shim.paused).toBe(false);
        expect(events).toEqual(['play', 'playing']);
        vi.advanceTimersByTime(HIFI_TIMEUPDATE_INTERVAL_MS - 1);
        expect(events.filter(type => type === 'timeupdate')).toHaveLength(0);
        vi.advanceTimersByTime(1);
        vi.advanceTimersByTime(HIFI_TIMEUPDATE_INTERVAL_MS * 3);
        expect(events.filter(type => type === 'timeupdate')).toHaveLength(4);

        // Playing again (after a seek, say) neither re-fires play nor doubles the cadence.
        shim.markPlaying();
        expect(events.at(-1)).toBe('playing');
        expect(events.filter(type => type === 'play')).toHaveLength(1);
        vi.advanceTimersByTime(HIFI_TIMEUPDATE_INTERVAL_MS);
        expect(events.filter(type => type === 'timeupdate')).toHaveLength(5);

        events.length = 0;
        shim.markPaused();
        expect(shim.paused).toBe(true);
        expect(events).toEqual(['timeupdate', 'pause']);
        vi.advanceTimersByTime(2000);
        expect(events).toEqual(['timeupdate', 'pause']);
        shim.markPaused();
        expect(events).toEqual(['timeupdate', 'pause']);
    });

    it('stops the cadence on reset and on a new track', () => {
        const events = record(shim);
        shim.beginTrack('t1');
        shim.markPlaying();
        shim.beginTrack('t2');
        expect(shim.paused).toBe(true);
        events.length = 0;
        vi.advanceTimersByTime(1000);
        expect(events).toEqual([]);

        shim.markPlaying();
        shim.reset();
        events.length = 0;
        vi.advanceTimersByTime(1000);
        expect(events).toEqual([]);
        expect(shim.currentSrc).toBe('');
        expect(shim.paused).toBe(true);
    });

    it('ends in the native order and holds the time at the duration', () => {
        shim.beginTrack('t1');
        shim.setDuration(100);
        shim.markPlaying();
        clockSec = 99.9;

        const seen: Array<{ type: string; paused: boolean; ended: boolean; time: number }> = [];
        for (const type of ['timeupdate', 'pause', 'ended']) {
            shim.addEventListener(type, () => seen.push({ type, paused: shim.paused, ended: shim.ended, time: shim.currentTime }));
        }
        shim.markEnded();
        expect(seen).toEqual([
            { type: 'timeupdate', paused: false, ended: false, time: 100 },
            { type: 'pause', paused: true, ended: true, time: 100 },
            { type: 'ended', paused: true, ended: true, time: 100 },
        ]);

        // mpv's time-pos goes away at the end; the shim keeps the last position.
        clockSec = 0;
        expect(shim.currentTime).toBe(100);
        seen.length = 0;
        vi.advanceTimersByTime(1000);
        shim.markEnded();
        expect(seen).toEqual([]);
    });

    it('leaves the ended state on a seek and on playing again', () => {
        shim.beginTrack('t1');
        shim.setDuration(100);
        shim.markPlaying();
        shim.markEnded();
        clockSec = 30;
        const events = record(shim);
        shim.markSeeked();
        expect(events).toEqual(['timeupdate', 'seeked']);
        expect(shim.ended).toBe(false);
        expect(shim.paused).toBe(true);
        expect(shim.currentTime).toBe(30);
        shim.markPlaying();
        expect(events.slice(2)).toEqual(['play', 'playing']);
    });

    it('fires playing after a seek that lands while playing, as <audio> does, so Media Session reports the new position', () => {
        shim.beginTrack('t1');
        shim.setDuration(100);
        shim.markPlaying();
        const events = record(shim);
        clockSec = 60;

        shim.markSeeked();

        expect(events).toEqual(['timeupdate', 'seeked', 'playing']);
        expect(shim.paused).toBe(false);
        // Only one play: the element never paused.
        expect(events).not.toContain('play');
    });

    it('announces a start again only while playing, without touching the cadence', () => {
        const events = record(shim);
        shim.announceStart();
        shim.beginTrack('t1');
        shim.setDuration(100);
        events.length = 0;
        // Paused: there is no start to announce.
        shim.announceStart();
        expect(events).toEqual([]);

        shim.markPlaying();
        events.length = 0;
        shim.announceStart();
        expect(events).toEqual(['play', 'playing']);
        vi.advanceTimersByTime(HIFI_TIMEUPDATE_INTERVAL_MS);
        // One cadence, not a second one started by the announcement.
        expect(events.filter(type => type === 'timeupdate')).toHaveLength(1);
    });

    it('throws when something assigns currentTime', () => {
        shim.beginTrack('t1');
        expect(() => {
            (shim as unknown as { currentTime: number }).currentTime = 5;
        }).toThrow(TypeError);
    });
});

describe('getObservedMedia', () => {
    afterEach(() => {
        playback.state.playbackRoute = 'web';
    });

    it('returns the shim only on the HiFi route', () => {
        const audio = { currentTime: 1 } as unknown as HTMLAudioElement;
        expect(getObservedMedia(audio)).toBe(audio);
        expect(getObservedMedia(null)).toBeNull();

        playback.state.playbackRoute = 'hifi';
        expect(getObservedMedia(audio)).toBe(hifiMediaShim);
        expect(getObservedMedia(null)).toBe(hifiMediaShim);
    });

    it('hands out one shim for the whole session', async () => {
        const again = await import('@/services/hifi/hifiMediaShim');
        expect(again.hifiMediaShim).toBe(hifiMediaShim);
        expect(hifiMediaShim).toBeInstanceOf(HifiMediaShim);
    });
});
