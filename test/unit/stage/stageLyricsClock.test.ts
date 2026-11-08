import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LyricData, StageLyricsSession } from '@/types';
import { getStageLyricsSessionTimeline, latestStageLyricsClock, stageLyricsClockTimeSec, withLatestStageLyricsClock } from '@/utils/appStageHelpers';
import { resolveStageConnectionFilePath } from '../../../electron/stageConnectionFile.cjs';

// An external player's clock on a Stage lyrics session, and where the Stage API's connection file goes.

const lyricsFrom = (lines: Array<[number, number]>) => ({
    lines: lines.map(([startTime, endTime]) => ({ startTime, endTime, fullText: 'x', words: [] })),
}) as unknown as LyricData;

describe('stageLyricsClockTimeSec', () => {
    it('runs on from when the position was received, unless paused', () => {
        expect(stageLyricsClockTimeSec({ positionMs: 10_000, paused: false, sampledAtMs: 1_000 }, 3_500)).toBe(12.5);
        expect(stageLyricsClockTimeSec({ positionMs: 10_000, paused: true, sampledAtMs: 1_000 }, 3_500)).toBe(10);
        // A clock read before it was received (clock skew) does not run backwards.
        expect(stageLyricsClockTimeSec({ positionMs: 10_000, paused: false, sampledAtMs: 5_000 }, 3_500)).toBe(10);
    });
});

describe('latestStageLyricsClock', () => {
    const session: StageLyricsSession = { title: 't', updatedAt: 100, clock: { positionMs: 0, paused: false, sampledAtMs: 200 } };

    it('takes a clock sent since for the same session when it is newer', () => {
        const sent = { positionMs: 5_000, paused: true, sampledAtMs: 300 };
        expect(latestStageLyricsClock(session, { sessionUpdatedAt: 100, clock: sent })).toBe(sent);
        expect(latestStageLyricsClock(session, { sessionUpdatedAt: 100, clock: { ...sent, sampledAtMs: 150 } })).toBe(session.clock);
    });

    it('ignores a clock sent for another session', () => {
        expect(latestStageLyricsClock(session, { sessionUpdatedAt: 99, clock: { positionMs: 1, paused: false, sampledAtMs: 999 } })).toBe(session.clock);
        expect(latestStageLyricsClock({ title: 't', updatedAt: 1 }, null)).toBeNull();
    });
});

describe('withLatestStageLyricsClock', () => {
    const session: StageLyricsSession = { title: 't', updatedAt: 100, clock: { positionMs: 0, paused: false, sampledAtMs: 200 } };

    it('takes the newest clock and a length sent with it for the same session', () => {
        const clock = { positionMs: 30_000, paused: true, sampledAtMs: 500 };
        expect(withLatestStageLyricsClock(session, { sessionUpdatedAt: 100, clock, durationMs: 240_000 }))
            .toEqual({ ...session, clock, durationMs: 240_000 });
    });

    it("keeps the session as it is for another session's clock or none", () => {
        expect(withLatestStageLyricsClock(session, { sessionUpdatedAt: 99, clock: { positionMs: 1, paused: true, sampledAtMs: 900 }, durationMs: 1 })).toBe(session);
        expect(withLatestStageLyricsClock(session, null)).toBe(session);
    });
});

describe('getStageLyricsSessionTimeline', () => {
    const lyrics = lyricsFrom([[12, 15], [15, 180]]);

    it('plays lyrics on their own clock from the first line to the last', () => {
        expect(getStageLyricsSessionTimeline({ updatedAt: 1 }, lyrics)).toEqual({ startTimeSec: 12, endTimeSec: 180, durationSec: 180 });
        // A longer length given runs on past the lyrics.
        expect(getStageLyricsSessionTimeline({ updatedAt: 1, durationMs: 200_000 }, lyrics)).toEqual({ startTimeSec: 12, endTimeSec: 200, durationSec: 200 });
    });

    it('runs an external player\'s clock over the whole track', () => {
        const clock = { positionMs: 0, paused: false, sampledAtMs: 0 };
        expect(getStageLyricsSessionTimeline({ updatedAt: 1, clock, durationMs: 240_000 }, lyrics)).toEqual({ startTimeSec: 0, endTimeSec: 240, durationSec: 240 });
        // No length given: the clock is unbounded (end 0) and the length unknown, whatever the lyrics.
        expect(getStageLyricsSessionTimeline({ updatedAt: 1, clock }, lyrics)).toEqual({ startTimeSec: 0, endTimeSec: 0, durationSec: 0 });
        expect(getStageLyricsSessionTimeline({ updatedAt: 1, clock }, null)).toEqual({ startTimeSec: 0, endTimeSec: 0, durationSec: 0 });
    });
});

describe('resolveStageConnectionFilePath', () => {
    it('uses the Linux runtime directory, and userData elsewhere', () => {
        expect(resolveStageConnectionFilePath({ platform: 'linux', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, userDataDir: '/home/u/.config/Folia' }))
            .toBe(path.join('/run/user/1000', 'folia', 'stage.json'));
        expect(resolveStageConnectionFilePath({ platform: 'linux', env: {}, userDataDir: '/home/u/.config/Folia' }))
            .toBe(path.join('/home/u/.config/Folia', 'stage', 'connection.json'));
        expect(resolveStageConnectionFilePath({ platform: 'linux', env: { XDG_RUNTIME_DIR: 'relative' }, userDataDir: '/data' }))
            .toBe(path.join('/data', 'stage', 'connection.json'));
        expect(resolveStageConnectionFilePath({ platform: 'win32', env: { XDG_RUNTIME_DIR: '/run/user/1000' }, userDataDir: 'C:/Users/u/AppData/Roaming/Folia' }))
            .toBe(path.join('C:/Users/u/AppData/Roaming/Folia', 'stage', 'connection.json'));
    });
});
