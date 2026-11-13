// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ExternalPlaybackTraits, ExternalTrackRepeatAnswer, ProviderExternalPlaybackStatus } from '@/types/onlineMusic';

// test/unit/onlineMusic/externalPlaybackSeekSmooth.test.ts
// What the bar and the lyrics do while a drag is being taken by a playing song: the position never
// goes back over the spot the bar was dropped on, and it never stands still under it. Every reading
// is taken one frame apart, which is how a listener meets it, and the longest stretch in which the
// position did not move is the hitch they see.

const omniMock = vi.hoisted(() => {
    /** What a way of playing that declared nothing about its moves answers (omni.externalPlaybackTraits). */
    const NONE_DECLARED = {
        capturesSystemAudio: false, startsWithoutWaiting: false, backsOffStatusPolls: false, holdsMediaKeysWhilePlaying: false,
        seekLimitMs: null as number | null, loopsTrackNatively: false, followsPlayerChanges: false,
    };
    return {
        NONE_DECLARED,
        canPlayExternally: vi.fn(() => true),
        canPlaySong: vi.fn(() => true),
        prepareExternalPlaybackQueue: vi.fn(async () => {}),
        playSongExternally: vi.fn(async () => {}),
        pauseExternalPlayback: vi.fn(async () => {}),
        resumeExternalPlayback: vi.fn(async () => {}),
        seekExternalPlayback: vi.fn(async () => {}),
        setExternalPlaybackVolume: vi.fn(async () => {}),
        setExternalTrackRepeat: vi.fn(async (): Promise<ExternalTrackRepeatAnswer | null | undefined> => undefined),
        getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
            mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false,
        })),
        isExternalPlaybackStatusForSong: vi.fn(() => true),
        adoptExternalPlayback: vi.fn(() => {}),
        externalPlaybackTraits: vi.fn((): ExternalPlaybackTraits => ({
            capturesSystemAudio: true,
            startsWithoutWaiting: true,
            backsOffStatusPolls: true,
            holdsMediaKeysWhilePlaying: true,
            seekLimitMs: 8000,
            loopsTrackNatively: true,
            followsPlayerChanges: true,
        })),
    };
});

vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

const engine = await import('@/services/onlineMusic/externalPlayback');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');

const song: SongResult = {
    id: '123',
    name: 'Example',
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: '123', providerData: { resourceType: 'songs' } },
};

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false, ...overrides,
});

/** One frame at 60 Hz: the spacing of every reading taken here. */
const SAMPLE_MS = 16;

/** An answer held back until the test gives it. */
const deferred = () => {
    let resolve!: (value: ProviderExternalPlaybackStatus) => void;
    const promise = new Promise<ProviderExternalPlaybackStatus>((done) => { resolve = done; });
    return { promise, resolve };
};
/** How long a play may stand still between two frames before a listener calls it a hitch. */
const STILL_LIMIT_MS = 100;

/** The longest stretch, in ms, in which the position did not move between two frames. */
const longestStillMs = (shown: number[]): number => {
    let still = 0;
    let longest = 0;
    for (let index = 1; index < shown.length; index++) {
        still = shown[index] > shown[index - 1] ? 0 : still + SAMPLE_MS;
        longest = Math.max(longest, still);
    }
    return longest;
};

/** How far, in seconds, the position fell back between two frames. */
const largestFallSec = (shown: number[]): number => {
    let largest = 0;
    for (let index = 1; index < shown.length; index++) largest = Math.max(largest, shown[index - 1] - shown[index]);
    return largest;
};

describe('a bar dropped on a song that is playing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song], isFmMode: false,
        });
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.seekExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.prepareExternalPlaybackQueue.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        omniMock.externalPlaybackTraits.mockReset().mockReturnValue({
            capturesSystemAudio: true, startsWithoutWaiting: true, backsOffStatusPolls: true, holdsMediaKeysWhilePlaying: true,
            seekLimitMs: 8000, loopsTrackNatively: true, followsPlayerChanges: true,
        });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** Puts the song on the route from `positionMs`, the player answering that it sounds from there. */
    const startFrom = async (positionMs: number) => {
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs, isPlaying: true }));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(500);
    };

    /**
     * Where the player itself stands `elapsedMs` after the bar was dropped: it goes on naming the line
     * the song stood on until it has loaded the spot, and runs on from that spot after.
     */
    const playerAtSec = (fromSec: number, targetSec: number, delayMs: number, elapsedMs: number): number => (
        elapsedMs < delayMs ? fromSec + elapsedMs / 1000 : targetSec + (elapsedMs - delayMs) / 1000
    );

    /**
     * Drags the bar from `fromSec` to `targetSec` and answers with the position every frame for
     * `spanMs` after the drop, by which a player that takes `delayMs` to load the spot has long since
     * done it. Returns what the bar and the lyrics read, one frame apart.
     */
    const drag = async (fromSec: number, targetSec: number, delayMs: number, spanMs: number): Promise<number[]> => {
        await startFrom(Math.round(fromSec * 1000));
        const askedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({
            positionMs: Math.round(playerAtSec(fromSec, targetSec, delayMs, performance.now() - askedAt) * 1000),
            isPlaying: true,
        }));
        expect(engine.seekExternalPlayback(targetSec)).toBe(true);
        const shown: number[] = [engine.getExternalPosition()];
        for (let waited = 0; waited < spanMs; waited += SAMPLE_MS) {
            await vi.advanceTimersByTimeAsync(SAMPLE_MS);
            shown.push(engine.getExternalPosition());
        }
        return shown;
    };

    const shortDrags = [
        { drag: 'forward', fromSec: 10, targetSec: 11, delayMs: 400 },
        { drag: 'back', fromSec: 20, targetSec: 18.5, delayMs: 400 },
    ];

    it.each(shortDrags)('never goes back over a short drag $drag', async ({ fromSec, targetSec, delayMs }) => {
        const shown = await drag(fromSec, targetSec, delayMs, 3000);
        const fall = largestFallSec(shown);
        console.log('[short drag] from=' + fromSec + ' to=' + targetSec + ' fall=' + fall.toFixed(3) + ' last=' + shown[shown.length - 1].toFixed(3));
        // The drop itself is the one jump the listener asked for: once the bar is there, every frame
        // is at least where the frame before it stood.
        expect(fall).toBe(0);
    });

    /** The waits a player may take to load the spot the bar was dropped on. */
    const landingDelaysMs = [100, 300, 500, 700, 1000, 1500, 2000];
    const landingCells = landingDelaysMs.flatMap(delayMs => ([
        { drag: 'forward', fromSec: 10, targetSec: 11, delayMs },
        { drag: 'back', fromSec: 20, targetSec: 18.5, delayMs },
    ]));

    it.each(landingCells)(
        'keeps moving and ends on the player over a $delayMs ms landing, drag $drag',
        async ({ fromSec, targetSec, delayMs }) => {
            const spanMs = 3 * delayMs + 2500;
            const shown = await drag(fromSec, targetSec, delayMs, spanMs);
            const still = longestStillMs(shown);
            const fall = largestFallSec(shown);
            // The clock closes the lead it ran up while the player was loading the spot at half speed,
            // so the two meet 2 x the lead after the landing instead of the bar standing still for it.
            const meetMs = 2 * delayMs;
            const index = (ms: number) => Math.min(shown.length - 1, Math.round(ms / SAMPLE_MS));
            const gapAt2s = Math.abs(shown[index(delayMs + 2000)] - playerAtSec(fromSec, targetSec, delayMs, delayMs + 2000));
            const gapAfterMeet = Math.abs(shown[index(delayMs + meetMs + 400)] - playerAtSec(fromSec, targetSec, delayMs, delayMs + meetMs + 400));
            console.log('[landing] drag=' + (targetSec > fromSec ? 'forward' : 'back') + ' delay=' + delayMs + 'ms still=' + still
                + 'ms fall=' + fall.toFixed(3) + ' gap@2s=' + gapAt2s.toFixed(3) + ' gap@meet=' + gapAfterMeet.toFixed(3));
            expect(fall, 'never goes back over the drop').toBe(0);
            expect(still, 'never stands still under a song that is playing').toBeLessThanOrEqual(STILL_LIMIT_MS);
            // Two seconds after the landing the shortest leads are long gone; a lead of a second or
            // more is closed at half speed, so those are held to their own 2 x lead.
            if (meetMs <= 2000) expect(Math.abs(gapAt2s), 'on the player two seconds in').toBeLessThanOrEqual(0.15);
            expect(gapAfterMeet, 'on the player once the lead is closed').toBeLessThanOrEqual(0.15);
            expect(Math.abs(shown[shown.length - 1] - playerAtSec(fromSec, targetSec, delayMs, spanMs))).toBeLessThanOrEqual(0.15);
        },
        60000,
    );

    /** How far back a listener drags the bar over the line the song stood on, in seconds. */
    const backDrags = [0.3, 0.6, 0.8, 1, 1.5];
    /** The waits a player takes to load a spot this near the line the song stood on. */
    const backLandingsMs = [100, 500, 1000];

    it.each(backDrags.flatMap(back => backLandingsMs.map(delayMs => ({ back, delayMs }))))(
        'keeps moving and ends on the player over a $back s drag back landing in $delayMs ms',
        async ({ back, delayMs }) => {
            const fromSec = 20;
            const targetSec = fromSec - back;
            const spanMs = delayMs + 4000;
            const shown = await drag(fromSec, targetSec, delayMs, spanMs);
            const still = longestStillMs(shown);
            const fall = largestFallSec(shown);
            const gapEnd = Math.abs(shown[shown.length - 1] - playerAtSec(fromSec, targetSec, delayMs, spanMs));
            console.log('[back drag] back=' + back + ' delay=' + delayMs + ' still=' + still + ' fall=' + fall.toFixed(3)
                + ' gapEnd=' + gapEnd.toFixed(3));
            // A drag back of this length leaves the bar ahead of the spot the player lands on by as much
            // as the wait was: the lead is run out at the slower speed rather than the bar standing
            // still on it until the player arrives.
            expect(fall, 'never goes back over the drop').toBe(0);
            expect(still, 'never stands still under a song that is playing').toBeLessThanOrEqual(STILL_LIMIT_MS);
            expect(gapEnd, 'on the player once the lead is played out').toBeLessThanOrEqual(0.15);
        },
        60000,
    );

    /**
     * Drags the bar to a spot the player takes far longer to load than the lead it runs up can be
     * played out over, and answers with the position every frame.
     */
    const longLanding = async (callMs: number, delayMs: number, tailMs = 8000): Promise<number[]> => {
        await startFrom(10000);
        let release!: () => void;
        const taking = new Promise<void>((done) => { release = done; });
        omniMock.seekExternalPlayback.mockImplementationOnce(() => taking);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(callMs);
        release();
        await vi.advanceTimersByTimeAsync(0);
        const askedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({
            positionMs: Math.round(playerAtSec(10, 60, delayMs, performance.now() - askedAt) * 1000),
            isPlaying: true,
        }));
        const shown: number[] = [engine.getExternalPosition()];
        for (let waited = 0; waited < delayMs + tailMs; waited += SAMPLE_MS) {
            await vi.advanceTimersByTimeAsync(SAMPLE_MS);
            shown.push(engine.getExternalPosition());
        }
        return shown;
    };

    it.each([
        { call: 'lands straight away', callMs: 0, delayMs: 4000, tailMs: 8000 },
        { call: 'takes two seconds to return', callMs: 2000, delayMs: 2500, tailMs: 8000 },
        { call: 'lands after five and a half seconds', callMs: 0, delayMs: 5500, tailMs: 8000 },
        // The lead run up over a longer wait is played out at the slower speed, which takes longer.
        { call: 'lands after eight seconds', callMs: 0, delayMs: 8000, tailMs: 14000 },
        { call: 'lands after nine and a half seconds', callMs: 0, delayMs: 9500, tailMs: 14000 },
    ])('holds the spot it stands on where the player $call from further behind than a lead runs out', async ({ callMs, delayMs, tailMs }) => {
        // The bar ran on from the drop for longer than a lead is played out over, so the player is not
        // catching up with the bar but saying the song is somewhere else: nothing is played out from the
        // spot the bar stands on, and the spot is held until the player's own answers come up to it, the
        // way a lagging tick always was. Held for good is what this branch must not do: the bar stands
        // on that spot and then follows the player again.
        const shown = await longLanding(callMs, delayMs, tailMs);
        const still = longestStillMs(shown);
        const fall = largestFallSec(shown);
        const gapEnd = Math.abs(shown[shown.length - 1] - playerAtSec(10, 60, delayMs, delayMs + tailMs));
        console.log('[long landing] call=' + callMs + ' delay=' + delayMs + ' still=' + still + ' fall=' + fall.toFixed(3)
            + ' gapEnd=' + gapEnd.toFixed(3));
        // The spot the bar stands on is never gone back over, and the wait is the distance the player
        // has to cover to reach it rather than a freeze of its own.
        expect(fall, 'never goes back over the drop').toBe(0);
        expect(still, 'held for the lead the player is behind by, not longer').toBeLessThanOrEqual(delayMs);
        expect(gapEnd, 'on the player once it has loaded the spot').toBeLessThanOrEqual(0.15);
    }, 60000);

    it('drops what an answer sent before the drop says about the player', async () => {
        // The ask went out before the bar was dropped and its answer lands after the drop: it is a
        // reading of the timeline the listener has already left, and every word of it - where the song
        // stood, and whether the player was sounding it - is about that timeline. Followed, a player
        // that was stopped before the drop stops a song the listener has since moved.
        await startFrom(10000);
        // The ask the ordinary half second sends is answered only after the drop that follows it.
        const answered = deferred();
        omniMock.getExternalPlaybackStatus.mockImplementationOnce(() => answered.promise);
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({ positionMs: 60300, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(20);

        // The player was stopped when that ask went out, and it says so now, long after the drop.
        answered.resolve(status({ positionMs: 10000, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(20);
        console.log('[late answer] state=' + usePlaybackStore.getState().playerState + ' at=' + engine.getExternalPosition().toFixed(3));
        expect(usePlaybackStore.getState().playerState, 'the song the listener moved is still playing').toBe(PlayerState.PLAYING);
        expect(engine.getExternalPosition()).toBeGreaterThan(60);
    });

    it('counts the answer that names the spot the drop landed on as the song going on', async () => {
        // The answer that names the spot is the first one that says where the song stands after the
        // move: read as one more answer from before it, the progress is told from the poll after, and
        // the background reads wait half a second longer for a song that is already playing on.
        await startFrom(10000);
        const askedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({
            positionMs: 60000 + Math.round(performance.now() - askedAt), isPlaying: true,
        }));
        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(700);
        expect(engine.isExternalPlaybackReadyForPrefetch(song)).toBe(true);
    });

    /**
     * How far ahead of the line the song stood on the bar is dropped, and how long the player takes to
     * load the spot: past a lead that is played out, the bar stands where it is for the player instead
     * of running on, and it never goes back over the drop for the wait either way.
     */
    const farLandings = [
        { aheadSec: 30, delayMs: 4000 },
        { aheadSec: 60, delayMs: 4000 },
        { aheadSec: 30, delayMs: 5500 },
        { aheadSec: 60, delayMs: 5500 },
        { aheadSec: 60, delayMs: 9500 },
    ];

    it.each(farLandings)(
        'never goes back over a $aheadSec s drag the player takes $delayMs ms to load',
        async ({ aheadSec, delayMs }) => {
            const fromSec = 10;
            const targetSec = fromSec + aheadSec;
            // Sampled well past the landing: the bar stands still until the player has played its way
            // up to it, and then goes on with the player.
            const spanMs = 3 * delayMs + 2000;
            const shown = await drag(fromSec, targetSec, delayMs, spanMs);
            const still = longestStillMs(shown);
            const fall = largestFallSec(shown);
            const gapEnd = Math.abs(shown[shown.length - 1] - playerAtSec(fromSec, targetSec, delayMs, spanMs));
            console.log('[far landing] ahead=' + aheadSec + 's delay=' + delayMs + 'ms still=' + still + 'ms fall=' + fall.toFixed(3)
                + ' gapEnd=' + gapEnd.toFixed(3));
            expect(fall, 'never goes back over the drop, however far behind the player lands').toBe(0);
            expect(gapEnd, 'on the player once it has played its way up to the bar').toBeLessThanOrEqual(0.15);
        },
        120000,
    );

    /** How far apart the moves of one run of drags are asked for, and what the player takes to load each. */
    const stackedGapsMs = [100, 300, 600];
    const stackedLandingsMs = [300, 700, 1500];

    /**
     * Drags the bar to each spot of targets, one drag every gapMs, and answers the way a player that
     * takes the wait of its own landing to load a spot does: it goes on from the last spot it landed
     * on until the next one has loaded, so a read taken between two moves names the spot the one
     * before it landed on. Every drag here is forward, so no drop is a fall of its own.
     */
    const stackedDrags = async (
        fromSec: number, targets: number[], gapMs: number, landMs: number[], spanMs: number,
    ): Promise<number[]> => {
        await startFrom(Math.round(fromSec * 1000));
        const beganMs = performance.now();
        /** When each move was asked for, in ms after the first frame: the player lands its own wait later. */
        const askedMs: number[] = [];
        const playerAt = (elapsedMs: number): number => {
            let stoodSec = fromSec;
            let standsFromMs = 0;
            for (let index = 0; index < askedMs.length; index++) {
                const landedMs = askedMs[index] + landMs[index];
                if (elapsedMs >= landedMs) {
                    stoodSec = targets[index];
                    standsFromMs = landedMs;
                }
            }
            return stoodSec + (elapsedMs - standsFromMs) / 1000;
        };
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({
            positionMs: Math.round(playerAt(performance.now() - beganMs) * 1000),
            isPlaying: true,
        }));
        const shown: number[] = [engine.getExternalPosition()];
        let next = 0;
        for (let waited = 0; waited < spanMs; waited += SAMPLE_MS) {
            if (next < targets.length && waited >= next * gapMs) {
                askedMs.push(waited);
                expect(engine.seekExternalPlayback(targets[next])).toBe(true);
                shown.push(engine.getExternalPosition());
                next += 1;
            }
            await vi.advanceTimersByTimeAsync(SAMPLE_MS);
            shown.push(engine.getExternalPosition());
        }
        return shown;
    };

    it.each(stackedGapsMs.flatMap(gapMs => stackedLandingsMs.map(landMs => ({ gapMs, landMs }))))(
        'never goes back over two drags $gapMs ms apart landing in $landMs ms',
        async ({ gapMs, landMs }) => {
            const spanMs = 2 * gapMs + 3 * landMs + 2000;
            const shown = await stackedDrags(10, [30, 60], gapMs, [landMs, landMs], spanMs);
            const fall = largestFallSec(shown);
            console.log('[two drags] gap=' + gapMs + 'ms land=' + landMs + 'ms fall=' + fall.toFixed(3)
                + ' last=' + shown[shown.length - 1].toFixed(3));
            expect(fall, 'the move asked for last owns the timeline').toBe(0);
        },
        60000,
    );

    it.each(stackedGapsMs.flatMap(gapMs => stackedLandingsMs.map(landMs => ({ gapMs, landMs }))))(
        'never goes back over three drags $gapMs ms apart landing in $landMs ms',
        async ({ gapMs, landMs }) => {
            const spanMs = 2 * gapMs + 3 * landMs + 2500;
            const shown = await stackedDrags(10, [30, 60, 90], gapMs, [landMs, landMs, landMs], spanMs);
            const fall = largestFallSec(shown);
            console.log('[three drags] gap=' + gapMs + 'ms land=' + landMs + 'ms fall=' + fall.toFixed(3)
                + ' last=' + shown[shown.length - 1].toFixed(3));
            expect(fall, 'the move asked for last owns the timeline').toBe(0);
        },
        60000,
    );

    it('holds the lead a move of the listener left the bar until the player is on the bar', async () => {
        // The answers that named the line the song stood on leave the bar ahead of where the player lands,
        // and that lead is what the bar stands on while the player plays its way up to it. Read against a
        // wait of its own, the bar was put back onto the player the moment the lead was found: what shows
        // here is that the bar stands still rather than stepping back, across the whole of that catch-up.
        const fromSec = 10;
        const targetSec = 55;
        const delayMs = 3000;
        const shown = await drag(fromSec, targetSec, delayMs, delayMs + 6000);
        const fall = largestFallSec(shown);
        const still = longestStillMs(shown);
        console.log('[held lead] fall=' + fall.toFixed(3) + ' still=' + still + 'ms');
        // Never back over the drop, and the wait is the player catching up rather than a freeze of its own.
        expect(fall, 'the lead the bar ran up is held, not given up').toBe(0);
        expect(still, 'held for the lead the player is behind by, not longer').toBeLessThanOrEqual(delayMs + 250);
    }, 60000);

    it('keeps the bar moving while the answers still name the line the song stood on', async () => {
        // A read of the line the song stood on before a move is not where the song is now, and nothing
        // is written from it. What the bar does meanwhile is what a listener sees of the wait: it runs
        // on from the drop rather than standing still on it for the whole load.
        const shown = await drag(10, 20, 2000, 1500);
        const still = longestStillMs(shown);
        const fall = largestFallSec(shown);
        console.log('[old line reads] still=' + still + 'ms fall=' + fall.toFixed(3));
        expect(fall, 'never goes back over the drop').toBe(0);
        expect(still, 'never stands still under a song that is playing').toBeLessThanOrEqual(STILL_LIMIT_MS);
    }, 60000);

    it('asks the player again far sooner than the usual rate while it waits for the drop', async () => {
        // The answer that says the player has loaded the spot is what the bar is held for: asking at
        // the half second the player is followed at leaves that answer a whole poll late, and the bar
        // a whole poll of lead it then has to close.
        await startFrom(10000);
        const askedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: 10000 + Math.round(performance.now() - askedAt), isPlaying: true })
        ));
        expect(engine.seekExternalPlayback(60)).toBe(true);
        omniMock.getExternalPlaybackStatus.mockClear();
        await vi.advanceTimersByTimeAsync(450);
        const asked = omniMock.getExternalPlaybackStatus.mock.calls.length;
        console.log('[seek asks] in 450 ms=' + asked);
        // Every tenth of a second while the drop is still being loaded, not the half second the song
        // is followed at otherwise.
        expect(asked).toBeGreaterThanOrEqual(4);
        // And the ordinary rate is back once the search is over: the same window of a song that is not
        // being dragged is a tenth of that many asks.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 60000, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);
        omniMock.getExternalPlaybackStatus.mockClear();
        await vi.advanceTimersByTimeAsync(5000);
        const steady = omniMock.getExternalPlaybackStatus.mock.calls.length;
        console.log('[seek asks] steady in 5000 ms=' + steady);
        expect(steady).toBeLessThanOrEqual(12);
    });
});
