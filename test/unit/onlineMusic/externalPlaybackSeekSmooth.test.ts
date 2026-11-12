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
