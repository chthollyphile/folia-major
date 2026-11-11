// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { ProviderExternalPlaybackStatus, ExternalPlaybackTraits, ExternalTrackRepeatAnswer } from '@/types/onlineMusic';

// test/unit/onlineMusic/externalPlayback.test.ts
// What a start costs the interface: it hands the play path back as soon as the session and the route
// are ready and loads the song in the player afterwards, the queue write waits for that start to
// land, and every start is timed in one line that names its number. The block before the last one
// pins the position while a move the player takes seconds to take is in flight - for as long as the
// way of playing declared with `seekLimitMs`, and a second where it declared nothing - that a move the
// player refuses puts the bar back at once, to the spot the first move still in flight was sent from
// rather than to the target the one it replaced was sent to, and that a move of a song that is gone
// lands nowhere. The last block pins the limits the Spotify transport puts on the app's own status,
// level and queue calls, which is what makes a wedged page fail instead of holding the queue.

const omniMock = vi.hoisted(() => {
    /** What a way of playing that declared nothing about its moves answers (`omni.externalPlaybackTraits`). */
    const NONE_DECLARED = {
        capturesSystemAudio: false, startsWithoutWaiting: false, backsOffStatusPolls: false, holdsMediaKeysWhilePlaying: false,
        seekLimitMs: null as number | null,
        loopsTrackNatively: false,
        followsPlayerChanges: false,
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
        setExternalPlaybackRepeatOne: vi.fn<(song: unknown, enabled: boolean) => Promise<void>>(async () => {}),
        setExternalTrackRepeat: vi.fn(async (): Promise<ExternalTrackRepeatAnswer | null | undefined> => undefined),
        getExternalPlaybackStatus: vi.fn(async (): Promise<ProviderExternalPlaybackStatus> => ({
            mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false,
        })),
        isExternalPlaybackStatusForSong: vi.fn(() => true),
        adoptExternalPlayback: vi.fn(() => {}),
        // The player these blocks pin is the one that declared all of them: Spotify's own app.
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
const { createHifiClock, MAX_EXTRAPOLATION_SEC } = await import('@/services/hifi/hifiClock');
const { usePlaybackStore } = await import('@/stores/usePlaybackStore');
const { PlayerState } = await import('@/types');
const { useAudioSettingsStore } = await import('@/stores/useAudioSettingsStore');

const song: SongResult = {
    id: '123',
    name: 'Example',
    artists: [{ id: '', name: 'Artist' }],
    album: { id: '', name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId: '123', providerData: { resourceType: 'songs' } },
};

const songOf = (mediaId: string, name: string): SongResult => ({
    ...song, id: mediaId, name, sourceRef: { kind: 'online', providerId: 'appleMusic', mediaId, providerData: { resourceType: 'songs' } },
});
const b = songOf('b', 'B');
const c = songOf('c', 'C');

const status = (overrides: Partial<ProviderExternalPlaybackStatus> = {}): ProviderExternalPlaybackStatus => ({
    mediaId: '123', isPlaying: true, positionMs: 5000, durationMs: 200000, ended: false, ...overrides,
});

const deferred = () => {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
};

/** A status answer held back until the test gives it. */
const deferredStatus = () => {
    let resolve!: (value: ProviderExternalPlaybackStatus) => void;
    const promise = new Promise<ProviderExternalPlaybackStatus>(done => { resolve = done; });
    return { promise, resolve };
};

describe('a player taken over, before the listener picks a song of their own', () => {
    // A take-over follows what the player is already sounding: the listener left Spotify playing,
    // and Folia is reopened onto it. Nothing of what it holds behind that song was written by this
    // run, and its level was set by the listener, so neither is Folia's to change yet.
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song, b, c], isFmMode: false,
        });
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        omniMock.prepareExternalPlaybackQueue.mockClear();
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        // The loop mode is part of what a start follows (`loopsCurrentTrack`), and a case that left
        // repeat one on would hand it to the next one: an end there would replay instead of being said.
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'off' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
    });

    it('takes the player over without changing its level', async () => {
        // The listener's own level was set in Spotify's window: a take-over does not replace it.
        const taken = await engine.adoptExternalPlayback(song);
        expect(taken).toMatchObject({ attempt: expect.any(Number) });
        expect(engine.isExternalTakeoverPending()).toBe(true);
        expect(omniMock.setExternalPlaybackVolume).not.toHaveBeenCalled();
    });

    it('writes nothing of the songs that follow while the player is only taken over', async () => {
        await engine.adoptExternalPlayback(song);
        // The queue edits a poll makes on its own: every one of them would write into the app's
        // queue, which this run has not been told to hold.
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(3000);

        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();
    });

    it('leaves the level alone when the app follows its own stored volume, until they pick a song', async () => {
        // The level the slider shows is the one an earlier run left; following it here would put
        // Folia's number over the one the listener set in Spotify's window.
        await engine.adoptExternalPlayback(song);
        engine.setExternalPlaybackVolume(0.25, 'sync');
        useAudioSettingsStore.setState({ volume: 0.3 });
        await vi.advanceTimersByTimeAsync(1000);
        expect(omniMock.setExternalPlaybackVolume).not.toHaveBeenCalled();
    });

    it('passes on a level the listener moves in Folia while the player is only taken over', async () => {
        // Dragging Folia's slider or pressing a volume key here is the listener's own change, made in
        // this window: it reaches the player even though the app does not write the level by itself.
        await engine.adoptExternalPlayback(song);
        engine.previewExternalPlaybackVolume(0.25);
        await vi.advanceTimersByTimeAsync(1000);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledWith(song, 0.25);
        // The take-over still stands: the app's own level is not written on its own afterwards.
        expect(engine.isExternalTakeoverPending()).toBe(true);
    });

    it('passes on muting and unmuting in Folia while the player is only taken over', async () => {
        // The mute button, its command-palette entry and the volume keys are the listener's own
        // presses in this window, like the slider: the player is told while it is only taken over.
        await engine.adoptExternalPlayback(song);
        useAudioSettingsStore.getState().handleSetMuted(true);
        await vi.advanceTimersByTimeAsync(1000);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledWith(song, 0);

        useAudioSettingsStore.getState().handleSetMuted(false);
        await vi.advanceTimersByTimeAsync(1000);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 1);
        // The take-over still stands: it is a press, not the app following its own level.
        expect(engine.isExternalTakeoverPending()).toBe(true);
    });

    it('keeps a level the listener set while a write was in flight, after the take-over', async () => {
        // A drag's second level is still the listener's when the first write returns: it is sent, not
        // dropped as if the app had asked for it.
        await engine.adoptExternalPlayback(song);
        let finish!: () => void;
        omniMock.setExternalPlaybackVolume.mockImplementationOnce(() => new Promise<void>(done => { finish = done; }));
        engine.previewExternalPlaybackVolume(0.4);
        engine.previewExternalPlaybackVolume(0.2);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalledTimes(1);
        finish();
        await vi.advanceTimersByTimeAsync(0);
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenLastCalledWith(song, 0.2);
    });

    it('writes them and sets the level again once the listener picks a song of their own', async () => {
        await engine.adoptExternalPlayback(song);
        expect(engine.isExternalTakeoverPending()).toBe(true);

        const start = engine.startExternalPlayback(b, 0);
        expect(engine.isExternalTakeoverPending()).toBe(false);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1500);

        // Folia plays that song now: the level is its own, and the songs that follow are written.
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalled();
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalled();
    });

    it('is no take-over for a start that is not one, so a plain play writes from the first poll', async () => {
        const start = engine.startExternalPlayback(song, 0);
        expect(engine.isExternalTakeoverPending()).toBe(false);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1500);

        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalled();
        expect(omniMock.setExternalPlaybackVolume).toHaveBeenCalled();
    });

    it('ends the take-over where the app is let go, so the next song starts from nothing', async () => {
        await engine.adoptExternalPlayback(song);
        engine.stopExternalPlayback('the listener left this way of playing');
        expect(engine.isExternalTakeoverPending()).toBe(false);
    });
});

describe('a start that runs on after the interface', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song, b, c], isFmMode: false,
        });
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        omniMock.setExternalTrackRepeat.mockReset().mockResolvedValue(undefined);
        omniMock.prepareExternalPlaybackQueue.mockClear();
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.seekExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        omniMock.setExternalTrackRepeat.mockReset().mockResolvedValue(undefined);
        // The loop mode is part of what a start follows (`loopsCurrentTrack`), and a case that left
        // repeat one on would hand it to the next one: an end there would replay instead of being said.
        useAudioSettingsStore.setState({ volume: 1, isMuted: false, loopMode: 'off' });
    });

    afterEach(() => {
        engine.stopExternalPlayback('test end');
        usePlaybackStore.setState({ playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, playQueue: [] });
        vi.useRealTimers();
    });

    it('gives the play path back before the player has the song, and starts it once', async () => {
        const playing = deferred();
        omniMock.playSongExternally.mockImplementation(() => playing.promise);
        const start = engine.startExternalPlayback(song, 0);

        // The session and the route are ready here and the player is still loading the song: this is
        // the moment the interface shows the name, the lyrics and the cover instead of waiting.
        expect(usePlaybackStore.getState().playbackRoute).toBe('external');
        expect(engine.getExternalSong()?.id).toBe(song.id);
        let settled = false;
        void start.started.then(() => { settled = true; });
        await vi.advanceTimersByTimeAsync(2500);
        expect(settled).toBe(false);
        expect(omniMock.playSongExternally).toHaveBeenCalledTimes(1);

        // The player has it at last: the start ends where it was, and nothing is started again.
        playing.resolve();
        await start.started;
        expect(omniMock.playSongExternally).toHaveBeenCalledTimes(1);
    });

    it('gives the route back and says the start failed', async () => {
        const failures: unknown[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'failure') failures.push(event.error);
        });
        omniMock.playSongExternally.mockRejectedValue(new Error('refused'));

        const start = engine.startExternalPlayback(song, 0);
        await expect(start.started).rejects.toThrow('refused');

        // The player has nothing of this song and Folia is no longer on its route: the next play
        // decides its own route, as it did when the play path waited for the start.
        expect(usePlaybackStore.getState().playbackRoute).toBe('web');
        expect(engine.getExternalSong()).toBeNull();
        expect(failures).toHaveLength(0);
        unsubscribe();
    });

    it('still waits for the song where the caller asked it to', async () => {
        const playing = deferred();
        omniMock.playSongExternally.mockImplementation(() => playing.promise);
        const waiting = engine.beginExternalPlayback(song, 0);
        let returned = false;
        void waiting.then(() => { returned = true; });
        await vi.advanceTimersByTimeAsync(500);
        expect(returned).toBe(false);
        playing.resolve();
        await waiting;
        expect(returned).toBe(true);
    });

    it('leaves the queue alone while the player is still taking the song, and writes it on the poll after', async () => {
        const playing = deferred();
        omniMock.playSongExternally.mockImplementation(() => playing.promise);
        const start = engine.startExternalPlayback(song, 0);
        // The song is on screen and the queue is edited while the page is still loading the track:
        // neither writes anything into that page.
        engine.announceExternalPlayback();
        usePlaybackStore.setState({ playQueue: [song, b, c] });
        await vi.advanceTimersByTimeAsync(1000);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();

        // The player has it: the poll that follows asks again and writes the tail the queue holds.
        playing.resolve();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(500);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledWith(song, [b, c], undefined);
    });

    it('writes the take-back picked while a start is still landing, once that start lands', async () => {
        const playing = deferred();
        omniMock.playSongExternally.mockImplementation(() => playing.promise);
        // The player reports real progress: two answers apart the position moves, which is what lets
        // the tail be written at all.
        let positionMs = 0;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => {
            positionMs += 1000;
            return status({ positionMs });
        });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        // Repeat one is picked while the player is still taking the song. Nothing is written now, and
        // not because a write was held back: no answer of this song has come yet, so there is no tail
        // to write and none to take back either.
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await vi.advanceTimersByTimeAsync(1500);
        expect(omniMock.prepareExternalPlaybackQueue).not.toHaveBeenCalled();

        // The start lands, the player answers as playing, and the take-back the new mode asks for is
        // written on the first answers that follow rather than being left out for this song.
        playing.resolve();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(2000);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledWith(song, [], { retract: true });
    });

    it('writes the take-back again when repeat one is picked although nothing follows either way', async () => {
        useAudioSettingsStore.setState({ loopMode: 'off' });
        // The player reports real progress, which is what lets the tail be written at all.
        let positionMs = 0;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => {
            positionMs += 1000;
            return status({ positionMs });
        });
        // Nothing follows this song, so the tail is empty in both modes: only the take-back tells
        // repeat one apart from the end of a queue.
        usePlaybackStore.setState({ playQueue: [song] });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(2000);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(1);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [], undefined);

        // Repeat one: the songs an earlier write left behind this one are taken back, even though
        // the tail it writes is the same empty one. A key of the tail alone would read this as the
        // write just made and send nothing.
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenCalledTimes(2);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [], { retract: true });
    });

    it('says an end was heard only once the player had said this song was playing', async () => {
        const ends: { heard?: boolean }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') ends.push(event);
        });
        // The player never says it plays this song, and then reports it over: a start that never
        // landed answers with an end of its own, and a replay of it would restart nothing.
        let answers = 0;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            answers++ === 0 ? status({ isPlaying: false, positionMs: 0 }) : status({ isPlaying: false, positionMs: 0, ended: true })
        ));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(600);

        expect(ends).toHaveLength(1);
        expect(ends[0].heard).toBe(false);
        unsubscribe();
    });

    it('says an end was heard where the player said this song was playing', async () => {
        const ends: { heard?: boolean }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') ends.push(event);
        });
        let positionMs = 5000;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            positionMs > 0 ? status({ positionMs }) : status({ isPlaying: false, positionMs: 0, ended: true })
        ));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        positionMs = 0;
        await vi.advanceTimersByTimeAsync(600);

        expect(ends).toHaveLength(1);
        expect(ends[0].heard).toBe(true);
        unsubscribe();
    });

    it('says an end was not heard where a buffering read preceded the end of a song that had played', async () => {
        // Repeat one replays the song that ended only where the player said this song was sounding
        // (useExternalPlaybackBridge reads that as `heard`). A player that answers "still buffering"
        // in the last seconds of a song it had been playing clears that flag, so the end that
        // follows is reported as one that was never heard and the queue steps on. Pinned here as it
        // stands: the song did sound, and the reading is what the bridge goes by.
        const ends: { heard?: boolean }[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => {
            if (event.type === 'ended') ends.push(event);
        });
        const answers = [
            status({ positionMs: 5000 }),
            status({ isPlaying: false, starting: true, positionMs: 199000 }),
            status({ isPlaying: false, positionMs: 200000, ended: true }),
        ];
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => answers.shift() ?? status({ isPlaying: false, positionMs: 200000, ended: true }));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(2000);

        expect(ends).toHaveLength(1);
        expect(ends[0].heard).toBe(false);
        unsubscribe();
    });

    it('hands repeat one to the player\'s own repeat of the track, and takes it back when it goes off', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'off' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;

        // Repeat one is the player's own repeat of the track: it sounds the song again by itself,
        // so no start is asked for at its end.
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, true);

        // Another mode, and the listener's own repeat goes back where it was.
        useAudioSettingsStore.setState({ loopMode: 'all' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
    });

    it('sends the repeat a mode change asked for while an earlier write of it was still on its way', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'off' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1);

        // Repeat one hands the repeat to the player, and that write is still on its way.
        const asking = deferred();
        omniMock.setExternalTrackRepeat.mockImplementationOnce(async () => {
            await asking.promise;
            return { read: true, changed: true, now: 2 };
        });
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, true);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(1);

        // Another mode picked while that write is pending waits for it rather than asking twice.
        useAudioSettingsStore.setState({ loopMode: 'all' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(1);

        // The answer lands, and the mode picked meanwhile is asked for as well: without that second
        // ask the change would be lost with no later trigger, and the player would repeat the song.
        omniMock.setExternalTrackRepeat.mockImplementation(async () => ({ read: true, changed: false, now: 0 }));
        asking.resolve();
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(2);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
    });

    it('sends the off when the mode changes, even with no record of a repeat of the track', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'all' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(500);

        // The song was started in a mode of Folia's, and that start itself turned the player's
        // repeat off: announcing the song asks nothing of it, since there is nothing to turn off.
        expect(omniMock.setExternalTrackRepeat).not.toHaveBeenCalled();

        // The listener turns the player's own repeat to the track in Spotify's window, which nothing
        // here knows of. A record of what a start wrote would read the off as done already, and no
        // later trigger would come: the mode changing is the one moment this is caught.
        useAudioSettingsStore.setState({ loopMode: 'off' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);

        // Personal FM asks the same question for the same reason, both on the way in and out.
        omniMock.setExternalTrackRepeat.mockClear();
        usePlaybackStore.setState({ isFmMode: true });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
        usePlaybackStore.setState({ isFmMode: false });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
    });

    it('takes the player\'s answer for a repeat one it was started in, never the start itself', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'one' });
        // The start asked the player for its repeat of the track and the player would not repeat it:
        // what it holds afterwards is no repeat, which is the value the answer names.
        omniMock.setExternalTrackRepeat.mockImplementation(async () => ({ read: true, changed: false, now: 0 }));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1000);

        // The start carried the ask, and that ask is not an answer: the app confirms what the player
        // holds before its own replay of repeat one is given up for the player's.
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledWith(song, true);
        // A record taken from the start would have said the player repeats the track, and every
        // later trigger for the value it already holds would have passed it by.
        useAudioSettingsStore.setState({ loopMode: 'all' });
        await vi.advanceTimersByTimeAsync(1);
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(3);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, true);
    });

    it('asks the player again for the repeat an earlier write never got an answer for', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'one' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1000);
        // The confirm that follows the start of a song in repeat one, counted on its own below.
        omniMock.setExternalTrackRepeat.mockClear();

        // The off never got an answer: what the player holds is unknown, so the app cannot take the
        // value it asked for as the one it has.
        omniMock.setExternalTrackRepeat.mockImplementation(async () => null);
        useAudioSettingsStore.setState({ loopMode: 'all' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);

        // Another change of the way it plays asks again, rather than reading the unknown as done.
        useAudioSettingsStore.setState({ loopMode: 'off' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(2);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
    });

    it('asks again for an off the player answered while still repeating the track', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'off' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;

        // Repeat one is handed over, and then taken back: the player answers the off with the value
        // it still holds, which is the track's repeat - the one value the next trigger must ask on.
        omniMock.setExternalTrackRepeat.mockImplementation(async () => ({ read: true, changed: false, now: 2 }));
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await vi.advanceTimersByTimeAsync(1);
        useAudioSettingsStore.setState({ loopMode: 'all' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);

        useAudioSettingsStore.setState({ loopMode: 'off' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(3);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
    });

    it('asks for the repeat of the track in the start itself when the song starts in repeat one', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        omniMock.playSongExternally.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'one' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1000);

        // The start carries it: the setting is never turned off here and on again a moment later.
        // What that start left is confirmed once afterwards, for the same value it already asked
        // for: a start is no answer, so the record is what that confirm reads back from the player.
        expect(omniMock.playSongExternally).toHaveBeenCalledWith(song, 0, { userAction: true, singleLoop: true });
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, true);

        // Leaving repeat one for the next song's start hands the value back once.
        useAudioSettingsStore.setState({ loopMode: 'off' });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);
    });

    it('takes the player\'s repeat of the track back when the listener goes to personal FM, and asks for it again on the way out', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        omniMock.playSongExternally.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'one' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1000);

        // Repeat one is the player's own repeat of the track, asked for in the start itself and
        // confirmed once after it.
        expect(omniMock.playSongExternally).toHaveBeenCalledWith(song, 0, { userAction: true, singleLoop: true });
        expect(omniMock.setExternalTrackRepeat).toHaveBeenCalledTimes(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, true);

        // Personal FM never repeats one song: the player's own repeat has to go, or it sounds this
        // song again where it ends and the station never moves on.
        usePlaybackStore.setState({ isFmMode: true });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, false);

        // Out of FM with the mode still repeat one: the player's own repeat is asked for again.
        usePlaybackStore.setState({ isFmMode: false });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.setExternalTrackRepeat).toHaveBeenLastCalledWith(song, true);
    });

    it('starts a song in personal FM without the player\'s repeat of the track, whatever the mode is', async () => {
        omniMock.playSongExternally.mockClear();
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'one' });
        usePlaybackStore.setState({ isFmMode: true });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1000);

        expect(omniMock.playSongExternally).toHaveBeenCalledWith(song, 0, { userAction: true });
        expect(omniMock.setExternalTrackRepeat).not.toHaveBeenCalled();
    });

    it('takes back what an earlier write left behind the song when the listener goes to personal FM', async () => {
        // The player reports real progress, which is what lets the queue be written at all.
        let positionMs = 0;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => {
            positionMs += 1000;
            return status({ positionMs });
        });
        useAudioSettingsStore.setState({ loopMode: 'off' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(2000);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [b, c], undefined);

        // Personal FM goes on to nothing by itself here: the station moves on when the song ends, so
        // what an earlier write left in the player's own queue is taken back - the player would
        // otherwise sound that song instead of the one the station plays next.
        usePlaybackStore.setState({ isFmMode: true });
        await vi.advanceTimersByTimeAsync(1);
        expect(omniMock.prepareExternalPlaybackQueue).toHaveBeenLastCalledWith(song, [], { retract: true });
    });

    it('asks the player nothing of repeat when a song of Folia\'s starts on a player without one', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        omniMock.playSongExternally.mockClear();
        omniMock.externalPlaybackTraits.mockReturnValue({
            capturesSystemAudio: true, startsWithoutWaiting: true, backsOffStatusPolls: true, holdsMediaKeysWhilePlaying: true,
            seekLimitMs: null, loopsTrackNatively: false, followsPlayerChanges: false,
        });
        useAudioSettingsStore.setState({ loopMode: 'one' });
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        await vi.advanceTimersByTimeAsync(1000);

        // Apple Music and the other players have no repeat of their own here: repeat one stays the
        // app's own replay, and nothing is asked of them.
        expect(omniMock.setExternalTrackRepeat).not.toHaveBeenCalled();
    });

    it('says nothing of repeat for a player that was only taken over', async () => {
        omniMock.setExternalTrackRepeat.mockClear();
        useAudioSettingsStore.setState({ loopMode: 'one' });
        await engine.adoptExternalPlayback(song);
        engine.announceExternalPlayback();
        await vi.advanceTimersByTimeAsync(1000);

        // The app follows the listener's own song here, and this run was not told to hold it: what
        // repeat it has is theirs until a song of Folia's is started.
        expect(omniMock.setExternalTrackRepeat).not.toHaveBeenCalled();
        expect(engine.isExternalTakeoverPending()).toBe(true);
    });

    it('takes the song round again where the player repeats it, and never ends or steps past it', async () => {
        const events: string[] = [];
        const unsubscribe = engine.subscribeExternalPlayback(event => events.push(event.type));
        // What the media observers are told: the song coming round again is a move back to its
        // start, said the way a seek is, so the position and the lyrics start over with it.
        const seeked: number[] = [];
        const onSeeked = () => seeked.push(engine.getExternalPosition());
        engine.externalMediaShim.addEventListener('seeked', onSeeked);
        useAudioSettingsStore.setState({ loopMode: 'one' });
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({ positionMs: 30000 }));
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        seeked.length = 0;

        // The player's own repeat sounded the song again from its start: the same song, at its
        // beginning, with no end and no step on.
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({ positionMs: 200, replayed: true }));
        await vi.advanceTimersByTimeAsync(600);
        expect(events).not.toContain('ended');
        expect(engine.getExternalPosition()).toBeLessThan(2);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        // The shim was told, and told it at the start: the observers that read it a moment later see
        // the song from its beginning rather than the position the turn came from.
        expect(seeked).toHaveLength(1);
        expect(seeked[0]).toBeLessThan(2);
        engine.externalMediaShim.removeEventListener('seeked', onSeeked);
        unsubscribe();
    });

    it('times a start in one line that names the start and every part of it', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const start = engine.startExternalPlayback(song, 0);
        start.timings.lyricsMs = 4;
        start.timings.visibleMs = 6;
        start.timings.coverMs = 9;
        await start.seeded;

        const lines = info.mock.calls.map(call => String(call[0]));
        const summary = lines.filter(line => line.startsWith('[Playback] external start '));
        expect(summary).toHaveLength(1);
        expect(summary[0]).toMatch(/^\[Playback\] external start \d+ms #\d+ visible 6ms /);
        expect(summary[0]).toContain('play 0ms');
        expect(summary[0]).toContain('lyrics 4ms');
        expect(summary[0]).toContain('cover 9ms');
        info.mockRestore();
    });
});

describe('a move the player takes seconds to take', () => {
    // Dragging the bar asks the player to move, and the app's call for it may take seconds: Spotify's
    // own app answers a call within CALL_LIMIT_MS in electron/spotify/officialClient.cjs, which is
    // what `seekLimitMs` declares. Every status ask is held while the move is in flight, so the clock
    // has only its own extrapolation to run on for the whole of that time - a second of it, as
    // `hifiClock` allows mpv, leaves the bar and the lyrics standing at the target until the player
    // answers again. The second is what a way of playing that declared no limit keeps.
    const SAMPLE_MS = 50;
    /** What Spotify's own app declares (src/services/onlineMusic/spotify/spotifyClientPlayback.ts). */
    const DECLARED: ExternalPlaybackTraits = {
        capturesSystemAudio: true, startsWithoutWaiting: true, backsOffStatusPolls: true, holdsMediaKeysWhilePlaying: true,
        seekLimitMs: 8000, loopsTrackNatively: true, followsPlayerChanges: true,
    };

    /**
     * Reads the position every SAMPLE_MS of fake time for `spanMs` and answers the longest stretch in
     * which it did not move. A clock that stops counting while the player is still taking a move, or
     * while it catches up with one it took, is a bar and a lyric line standing still under a song that
     * is playing.
     */
    const longestStall = async (spanMs: number): Promise<number> => {
        let previous = engine.getExternalPosition();
        let stillMs = 0;
        let longest = 0;
        for (let waited = 0; waited < spanMs; waited += SAMPLE_MS) {
            await vi.advanceTimersByTimeAsync(SAMPLE_MS);
            const position = engine.getExternalPosition();
            stillMs = position > previous ? 0 : stillMs + SAMPLE_MS;
            longest = Math.max(longest, stillMs);
            previous = position;
        }
        return longest;
    };

    /**
     * What the bar and the lyrics read every SAMPLE_MS for `spanMs`, the first reading taken where the
     * test stands: a timeline the listener dropped the bar on must run forward from there and never
     * come back to the spot the song stood on before the drop.
     */
    const readings = async (spanMs: number): Promise<number[]> => {
        const seen: number[] = [engine.getExternalPosition()];
        for (let waited = 0; waited < spanMs; waited += SAMPLE_MS) {
            await vi.advanceTimersByTimeAsync(SAMPLE_MS);
            seen.push(engine.getExternalPosition());
        }
        return seen;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        engine.installExternalPlayback();
        engine.stopExternalPlayback('test reset');
        usePlaybackStore.setState({
            playbackRoute: 'web', audioSrc: null, playerState: PlayerState.IDLE, duration: 0, currentSong: null,
            playQueue: [song, b, c], isFmMode: false,
        });
        omniMock.playSongExternally.mockReset().mockResolvedValue(undefined);
        omniMock.pauseExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.seekExternalPlayback.mockReset().mockResolvedValue(undefined);
        omniMock.setExternalPlaybackVolume.mockReset().mockResolvedValue(undefined);
        omniMock.prepareExternalPlaybackQueue.mockReset().mockResolvedValue(undefined);
        omniMock.getExternalPlaybackStatus.mockReset().mockResolvedValue(status());
        omniMock.isExternalPlaybackStatusForSong.mockReset().mockReturnValue(true);
        omniMock.externalPlaybackTraits.mockReset().mockReturnValue(DECLARED);
        useAudioSettingsStore.setState({ volume: 1, isMuted: false });
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

    it('keeps the position moving while the player is still taking the move', async () => {
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        // The song is playing from 10 s: the clock runs on between the player's answers.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10000, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);

        const taking = deferred();
        omniMock.seekExternalPlayback.mockImplementation(() => taking.promise);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        expect(engine.getExternalPosition()).toBeCloseTo(60, 1);

        // The player has not answered yet - every status ask is held while the move is in flight - so
        // the bar goes on from where the listener dropped it instead of waiting one second and stopping.
        expect(await longestStall(3000)).toBeLessThanOrEqual(150);
        expect(engine.getExternalPosition()).toBeGreaterThan(62.5);

        taking.resolve();
        await vi.advanceTimersByTimeAsync(0);
    });

    it('does not stand still while the player catches up with a move it has taken', async () => {
        const start = engine.startExternalPlayback(song, 0);
        engine.announceExternalPlayback();
        await start.seeded;
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10000, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);

        expect(engine.seekExternalPlayback(60)).toBe(true);
        // The move landed. The app asks the player again at once, and the player answers from where it
        // loads the song - eight tenths of a second short of the spot the bar was dropped on - and
        // runs on from there as it sounds the song.
        const landedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: 59200 + Math.round(performance.now() - landedAt), isPlaying: true })
        ));
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);

        // One answer's step back is the player's own and is followed; standing there until it catches
        // up is the bar and the lyrics frozen under a song that is playing.
        expect(engine.getExternalPosition()).toBeLessThan(60);
        expect(await longestStall(3000)).toBeLessThanOrEqual(150);
        expect(engine.getExternalPosition()).toBeGreaterThan(59.8);
    });

    it('keeps the HiFi clock\'s own limit at one second', () => {
        // The limit a moved bar may run under belongs to that move: mpv's clock keeps the second it
        // always had, and a clock that is never told otherwise is not given a longer one.
        expect(MAX_EXTRAPOLATION_SEC).toBe(1);
    });

    it('reads a HiFi sync that asks for no longer limit one second on', () => {
        const clock = createHifiClock();
        clock.sync({ positionSec: 30, paused: false, durationSec: 200, nowMs: 0 });
        expect(clock.read(3000)).toBe(31);
    });

    it('takes the bar back where the player stood when the move is refused', async () => {
        await startFrom(18000);
        const refusing = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => refusing.promise);
        // Where the bar stood when the listener dropped it: the last spot the player answered from,
        // plus what the clock had run on since.
        const stoodAt = engine.getExternalPosition();
        expect(engine.seekExternalPlayback(120)).toBe(true);
        // The app asked for the move and the player has not answered it: the bar runs on from where the
        // listener dropped it.
        await vi.advanceTimersByTimeAsync(3000);
        expect(engine.getExternalPosition()).toBeGreaterThan(122);

        // The player refused. It never left the spot it stood on, and the bar says so at once instead of
        // running on to the drop point until the next answer - which does not come while the failed move
        // is still in flight - pulls it back.
        const held = deferredStatus();
        omniMock.getExternalPlaybackStatus.mockImplementation(() => held.promise);
        refusing.reject(new Error('seek refused'));
        await vi.advanceTimersByTimeAsync(0);
        expect(engine.getExternalPosition()).toBeCloseTo(stoodAt, 1);
        expect(engine.getExternalPosition()).toBeLessThan(19);

        // And it runs on a second at a time again: a refused move does not keep the longer limit it was
        // allowed while the player was taking it. The answer that follows corrects where it really is.
        await vi.advanceTimersByTimeAsync(3000);
        expect(engine.getExternalPosition()).toBeGreaterThan(stoodAt + 0.5);
        expect(engine.getExternalPosition()).toBeLessThan(stoodAt + 1.5);

        // The player answers at last, from the spot it never left.
        held.resolve(status({ positionMs: 18000, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(0);
        expect(engine.getExternalPosition()).toBeLessThan(stoodAt + 1.5);
    });

    it('takes the bar back to where the listener first moved the song from when a drag made on top of another is refused', async () => {
        await startFrom(18000);
        // The listener drags once and the player is still taking that move the whole time.
        const taking = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => taking.promise);
        const stoodAt = engine.getExternalPosition();
        engine.seekExternalPlayback(60);
        await vi.advanceTimersByTimeAsync(2000);
        expect(engine.getExternalPosition()).toBeGreaterThan(60);

        // A second drag while the first is still in flight replaces it in the bar.
        const refused = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => refused.promise);
        engine.seekExternalPlayback(30);
        await vi.advanceTimersByTimeAsync(1000);
        expect(engine.getExternalPosition()).toBeGreaterThan(30.9);

        // The answer that follows a move is held here, so what the bar says is the spot a refused
        // move puts it on and nothing else.
        const held = deferredStatus();
        omniMock.getExternalPlaybackStatus.mockImplementation(() => held.promise);
        refused.reject(new Error('seek refused'));
        await vi.advanceTimersByTimeAsync(0);

        // The player took neither move: it still stands where it stood before the listener dragged at
        // all, which is where the bar goes back to, not the spot the first drag left it running from.
        expect(engine.getExternalPosition()).toBeCloseTo(stoodAt, 1);
        expect(engine.getExternalPosition()).toBeLessThan(19);

        taking.resolve();
        await vi.advanceTimersByTimeAsync(0);
        held.resolve(status({ positionMs: 18000, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(0);
    });

    it('keeps the second it always had where the way of playing declared no limit for a move', async () => {
        // Stands for the ways of playing that declare no limit for a move: neither Apple Music nor
        // Soloist declares one. Such a player is extrapolated as it always was, so a move in flight
        // leaves the bar where one second takes it rather than the eight the official app declares.
        omniMock.externalPlaybackTraits.mockReturnValue(omniMock.NONE_DECLARED);
        await startFrom(10000);
        const taking = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => taking.promise);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        expect(engine.getExternalPosition()).toBeCloseTo(60, 1);

        await vi.advanceTimersByTimeAsync(3000);
        expect(engine.getExternalPosition()).toBeGreaterThan(60.5);
        expect(engine.getExternalPosition()).toBeLessThan(61.5);

        taking.resolve();
        await vi.advanceTimersByTimeAsync(0);
    });

    it('lets the move dropped on last decide where the one before it lands late', async () => {
        await startFrom(10000);
        const stale = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => stale.promise);
        engine.seekExternalPlayback(60);
        // A second move is asked for while the first is still in flight: that one is the player's to take.
        omniMock.seekExternalPlayback.mockResolvedValueOnce(undefined);
        engine.seekExternalPlayback(30);
        let positionMs = 30200;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => {
            const answer = status({ positionMs, isPlaying: true });
            positionMs += 500;
            return answer;
        });
        await vi.advanceTimersByTimeAsync(600);
        expect(engine.getExternalPosition()).toBeLessThan(32);

        // The first move finishes now. It is not the move the player is on, so it neither puts the bar at
        // its own target nor marks the next answer as the one right after a move: an answer naming a
        // position half a second behind the bar is the player's own late word and is held, not followed back.
        stale.resolve();
        await vi.advanceTimersByTimeAsync(0);
        const shown = engine.getExternalPosition();
        expect(shown).toBeLessThan(32);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: Math.round((shown - 0.5) * 1000), isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(shown - 0.05);
    });

    it('leaves the song started meanwhile alone when a move of the one before it lands late', async () => {
        await startFrom(10000);
        const stale = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => stale.promise);
        engine.seekExternalPlayback(60);
        await vi.advanceTimersByTimeAsync(500);

        // The listener picks another song: it starts in the same player, and the move of the song before
        // it belongs to a session that is gone.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ mediaId: 'b', positionMs: 5000, isPlaying: true }));
        const next = engine.startExternalPlayback(b, 0);
        engine.announceExternalPlayback();
        await next.seeded;
        await vi.advanceTimersByTimeAsync(500);
        const shown = engine.getExternalPosition();
        expect(shown).toBeLessThan(6);

        stale.resolve();
        await vi.advanceTimersByTimeAsync(1000);
        expect(engine.getExternalSong()?.id).toBe('b');
        expect(engine.getExternalPosition()).toBeGreaterThan(shown - 0.5);
        expect(engine.getExternalPosition()).toBeLessThan(shown + 3);
    });

    it('keeps the bar moving when the listener drops it on a paused song, which the drop resumes', async () => {
        await startFrom(10000);
        // The player is stopped, and the bar stands where it stopped.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10200, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(await longestStall(1000)).toBe(1000);

        // No ask answers while the move is in flight (see `poll`), so the press that resumes the song
        // after the drop is the last write the clock gets: it runs on from there under the same limit as
        // the move, rather than the second a playing clock is otherwise given, which would leave the bar
        // and the lyrics standing until the player takes the move.
        const held = deferredStatus();
        omniMock.getExternalPlaybackStatus.mockImplementation(() => held.promise);
        const taking = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => taking.promise);
        expect(engine.seekExternalPlayback(60, { resume: true })).toBe(true);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);

        expect(await longestStall(3000)).toBeLessThanOrEqual(150);
        expect(engine.getExternalPosition()).toBeGreaterThan(62.5);

        // The ask that was held is the player's own answer to where it now stands after the move.
        held.resolve(status({ positionMs: 60000, isPlaying: true }));
        taking.resolve();
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeGreaterThan(59.8);
    });

    it('stays on the spot the bar was dropped on when the answer right after the move still names the old one', async () => {
        // Spotify's app answers a move in about 20 ms, long before it has loaded the track at the new
        // spot: the read taken at once still names where the song stood before the drop. Following
        // that one took the bar and the lyrics back to the old line for a whole poll - the flicker a
        // listener saw on every drop, worse than before the move was followed at all.
        await startFrom(10000);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        // Every read for the first three quarters of a second still names the old spot, then the
        // player's own answer arrives.
        const stillOld = performance.now() + 750;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: performance.now() < stillOld ? 10500 : 60300, isPlaying: true })
        ));

        const seen = await readings(2000);
        // Never back to the old line: the timeline runs forward from the drop and never returns.
        for (let index = 1; index < seen.length; index++) expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] - 1e-6);
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(59.9);
    });

    it('does not jump forward to the spot the song stood on before a move back', async () => {
        // A drag back is the same in the other direction: the read taken before the player took the
        // move names the spot the song stood on, which is ahead of the drop. Following it would put
        // the lyrics a whole line on and pull them back a poll later.
        await startFrom(60000);
        expect(engine.seekExternalPlayback(30)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        const stillOld = performance.now() + 750;
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: performance.now() < stillOld ? 60500 : 30300, isPlaying: true })
        ));

        const seen = await readings(2000);
        for (let index = 1; index < seen.length; index++) expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] - 1e-6);
        // It runs on from the drop - the two seconds read here - and never reaches the 60 s it stood on.
        expect(Math.max(...seen)).toBeLessThan(33);
    });

    it('holds a drag dropped again on top of a move the player has not taken yet', async () => {
        // Two drops in a row: the first is answered before the player moved, and the second is asked
        // for on top of it. What the player answers meanwhile names the spot both were sent from.
        await startFrom(10000);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({ positionMs: 10500, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(300);

        const second = performance.now();
        expect(engine.seekExternalPlayback(120)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: performance.now() < second + 750 ? 10500 : 120300, isPlaying: true })
        ));

        const seen = await readings(2000);
        for (let index = 1; index < seen.length; index++) expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1] - 1e-6);
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(119.9);
    });

    it('takes the player\'s own word when it never answers the spot the bar was dropped on', async () => {
        // A player that jumps somewhere else altogether has said where the song is: after the few reads
        // that spot is held for, the answer stands rather than holding the bar off for good.
        await startFrom(10000);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => status({ positionMs: 30000, isPlaying: true }));

        // Held at the drop for the window, then the player's own answer: the clock stands on 30 s.
        await vi.advanceTimersByTimeAsync(600);
        expect(engine.getExternalPosition()).toBeGreaterThan(60);
        await vi.advanceTimersByTimeAsync(3000);
        expect(engine.getExternalPosition()).toBeGreaterThan(30.9);
        expect(engine.getExternalPosition()).toBeLessThan(32);
    });

    it('stays on the spot the bar was dropped on when the paused player still names the old one', async () => {
        // A song paused where the listener left it, then dropped somewhere else and paused again right
        // after the drop: every answer the player gives is a stopped one, and the first of them still
        // names where the song stood before the drop. Taking that position for the pause put the bar and
        // the lyrics back on the old line for a whole poll, which is the same flicker the playing reads
        // are already kept from.
        await startFrom(10000);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10200, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);

        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10500, isPlaying: false }));
        const seen: number[] = [];
        for (let waited = 0; waited < 1000; waited += SAMPLE_MS) {
            await vi.advanceTimersByTimeAsync(SAMPLE_MS);
            seen.push(engine.getExternalPosition());
        }

        // The pause is the player's, and the spot is the one the bar was dropped on: never the old line.
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(59);
        expect(Math.min(...seen)).toBeGreaterThanOrEqual(59);
        // A paused song stands where it is put: what keeps a playing clock from standing still must not
        // set a stopped one running, here or anywhere in the window the drop is held for.
        console.log('[PAUSED-SEEN]', JSON.stringify(seen.map(v => Number(v.toFixed(2)))));
        expect(Math.max(...seen)).toBeLessThanOrEqual(60.5);

        // The answer that loads the spot stands as it comes: a stopped answer is followed as it always was.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 60200, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeCloseTo(60.2, 1);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);
    });

    it('keeps the spot the bar was dropped on where a paused session hears a playing answer with the old one', async () => {
        // The session is paused where the listener stopped it, and a drop is made without asking the
        // player to start again. The first answer says it is playing - the player took the move and went
        // on by itself - but still names the spot the song stood on before the drop: reading that answer
        // as the start of the song's play put the bar and the lyrics back on the old line.
        await startFrom(10000);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10200, isPlaying: false }));
        await vi.advanceTimersByTimeAsync(500);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PAUSED);

        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 10500, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);

        // The play is taken, and so is the spot the bar was dropped on: never the old line.
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        expect(engine.getExternalPosition()).toBeGreaterThanOrEqual(59);

        // The answer that loads the spot is followed as any playing answer is.
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 60200, isPlaying: true }));
        await vi.advanceTimersByTimeAsync(500);
        expect(engine.getExternalPosition()).toBeGreaterThan(59.9);
        expect(engine.getExternalPosition()).toBeLessThan(61);
    });

    it('takes the player\'s own turn of the song even right after a move', async () => {
        // Repeat one the player carries out itself is said the way a seek is, and it lands a moment after
        // a drop: the answer names the song's start, which is nowhere near the spot the bar was dropped
        // on. Judged against that spot it looked like a read the player had not loaded the move for, so
        // the song's own turn was given up and the bar and the lyrics stayed on the old line.
        await startFrom(190000);
        expect(engine.seekExternalPlayback(199)).toBe(true);
        await vi.advanceTimersByTimeAsync(20);
        const seeked: number[] = [];
        const onSeeked = () => seeked.push(engine.getExternalPosition());
        engine.externalMediaShim.addEventListener('seeked', onSeeked);
        omniMock.getExternalPlaybackStatus.mockResolvedValue(status({ positionMs: 200, replayed: true }));

        await vi.advanceTimersByTimeAsync(500);
        // The song starts over: the spot it is at is its own beginning, and the observers were told there.
        expect(engine.getExternalPosition()).toBeLessThan(2);
        expect(seeked).toHaveLength(1);
        expect(seeked[0]).toBeLessThan(2);
        expect(usePlaybackStore.getState().playerState).toBe(PlayerState.PLAYING);
        engine.externalMediaShim.removeEventListener('seeked', onSeeked);
    });

    it('keeps running on from the drop while the answers still name the old spot', async () => {
        // Stands for the ways of playing that declare no limit for a move, Apple Music among them: the
        // call for the move itself takes most of a second, and the answers that follow it still name the
        // spot the song stood on until the player has loaded the new one. Giving such a read up used to
        // write nothing at all, so the clock ran the one second a move in flight is given out and then
        // stood there until the reads it is allowed ran out - the bar and the lyrics stopped under a song
        // that is playing, which a listener saw as a hitch after the drop.
        omniMock.externalPlaybackTraits.mockReturnValue(omniMock.NONE_DECLARED);
        await startFrom(10000);
        const taking = deferred();
        omniMock.seekExternalPlayback.mockImplementationOnce(() => taking.promise);
        expect(engine.seekExternalPlayback(60)).toBe(true);
        await vi.advanceTimersByTimeAsync(800);
        taking.resolve();
        await vi.advanceTimersByTimeAsync(20);
        const landedAt = performance.now();
        omniMock.getExternalPlaybackStatus.mockImplementation(async () => (
            status({ positionMs: performance.now() < landedAt + 750 ? 10500 : 60300 + Math.round(performance.now() - landedAt) })
        ));

        const seen = await readings(2500);
        // A poll interval - the 500 ms the player is asked at - is all that may pass without the bar
        // moving: the move has a spot and the player has not left it, so the clock goes on from there
        // for as long as that spot is held for it.
        let stillMs = 0;
        let longest = 0;
        for (let index = 1; index < seen.length; index++) {
            stillMs = seen[index] > seen[index - 1] ? 0 : stillMs + SAMPLE_MS;
            longest = Math.max(longest, stillMs);
        }
        expect(longest).toBeLessThanOrEqual(500);
        // And it never goes back to the line the song stood on before the drop.
        expect(Math.min(...seen)).toBeGreaterThan(59.9);
        expect(seen[seen.length - 1]).toBeGreaterThan(61.5);
    });
});

describe('the limits the Spotify transport puts on the app own calls', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete (window as unknown as { electron?: unknown }).electron;
    });

    const bridge = (answer: (operation: string) => Promise<unknown>) => {
        const spotifyRequest = vi.fn(answer);
        (window as unknown as { electron?: unknown }).electron = { spotifyRequest };
        return spotifyRequest;
    };

    it('fails a status read the app never answers, and says so once', async () => {
        vi.useFakeTimers();
        const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
        bridge(() => new Promise(() => {}));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        let outcome: { message: string; code?: string } | null = null;
        void requestSpotify('client_status').then(
            () => { outcome = { message: 'answered' }; },
            (error: { message: string; code?: string }) => { outcome = error; },
        );
        await vi.advanceTimersByTimeAsync(1499);
        // The app still has the rest of its limit.
        expect(outcome).toBeNull();
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('did not answer'));

        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).not.toBeNull();
        expect(outcome!.message).toContain('client_status within 1500ms');
        // A call that ran out of time is a failure of that call, not the page having gone away.
        expect(outcome!.code).toBe('network');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('client_status did not answer within 1500ms'));
    });

    it('fails a repeat write the app never answers, so repeat one is not held by a wedged page', async () => {
        vi.useFakeTimers();
        const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
        bridge(() => new Promise(() => {}));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        let outcome: string | null = null;
        void requestSpotify('client_repeat', { on: true }).then(
            () => { outcome = 'answered'; },
            (error: Error) => { outcome = error.message; },
        );
        await vi.advanceTimersByTimeAsync(1499);
        expect(outcome).toBeNull();
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('did not answer'));

        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toContain('client_repeat within 1500ms');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('client_repeat did not answer within 1500ms'));
    });

    it('gives a queue write the longer limit the app needs for it', async () => {
        vi.useFakeTimers();
        const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
        bridge(() => new Promise(() => {}));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        let outcome: string | null = null;
        void requestSpotify('client_queue', { ids: [] }).then(
            () => { outcome = 'answered'; },
            (error: Error) => { outcome = error.message; },
        );
        await vi.advanceTimersByTimeAsync(3999);
        expect(outcome).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        expect(outcome).toContain('within 4000ms');
    });

    it('leaves the call the app loads a song on to the limit the main process already keeps', async () => {
        vi.useFakeTimers();
        const { requestSpotify } = await import('@/services/onlineMusic/spotify/spotifyTransport');
        const spotifyRequest = bridge(() => new Promise(() => {}));
        vi.spyOn(console, 'warn').mockImplementation(() => {});

        let outcome: string | null = null;
        void requestSpotify('client_play', { id: '123' }).then(
            () => { outcome = 'answered'; },
            () => { outcome = 'failed'; },
        );
        // A start the app is loading the song for is given longer than any read here: nothing of
        // this file's limits may fail it.
        await vi.advanceTimersByTimeAsync(20000);
        expect(outcome).toBeNull();
        expect(spotifyRequest).toHaveBeenCalledWith('client_play', { id: '123' });
    });
});
