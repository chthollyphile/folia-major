import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { OmniPlaybackReport } from '@/types/onlineMusic';

// test/unit/playback/usePlaybackReporter.test.ts
// The wiring layer: it alone decides when a listening session opens and when it settles, so the
// branches that only comments could describe until now - an automix deck handover, loop-one, and
// signing out mid-track - are pinned here. The repo's vitest runs on node with no jsdom and no
// testing-library, so this reuses the minimal React runtime from useProviderLogin.test.ts
// and a hand-rolled audio element rather than pulling in a rendering stack.

const runtime = vi.hoisted(() => ({
    slots: [] as { current: any }[],
    cursor: 0,
    effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', () => ({
    useRef: (initial: unknown) => {
        const index = runtime.cursor++;
        runtime.slots[index] ??= { current: initial };
        return runtime.slots[index];
    },
    // The hook's single effect has a dependency array, but every `render` below is a deliberate
    // re-render with changed inputs, so running it each time matches what React would do.
    useEffect: (effect: () => void | (() => void)) => { runtime.effects.push(effect); },
}));

const gate = vi.hoisted(() => ({
    isPlaybackReportReady: vi.fn((_song?: unknown) => true),
    // Typed rather than bare, so the assertions below can read the song and report it was handed.
    sendPlaybackReport: vi.fn(async (_song: unknown, _report: unknown) => true),
}));
vi.mock('@/services/onlineMusic/playbackReportGate', () => gate);

// The song's provider decides which songs it takes a report of (`canReport`, pinned for NetEase in
// neteaseProvider.test.ts); here the only reporting provider is 'netease' and it takes them all.
const omniMock = vi.hoisted(() => ({
    canReportPlayback: vi.fn((song: SongResult) => (
        song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'netease'
    )),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

vi.mock('@/services/onlineMusic/songMetadata', () => ({
    getProviderSongMetadata: (song: SongResult) => ({ durationMs: song.durationMs ?? 0, artists: [] }),
}));

const audioSettings = vi.hoisted(() => ({ neteaseScrobbleEnabled: true, audioQuality: 'high' }));
const useAudioSettingsStore = vi.hoisted(() => {
    const hook = (selector: (state: { neteaseScrobbleEnabled: boolean; audioQuality: string }) => unknown) => selector(audioSettings);
    hook.getState = () => audioSettings;
    return hook;
});
vi.mock('@/stores/useAudioSettingsStore', () => ({ useAudioSettingsStore }));

// Only the playback route is read: on the HiFi route the listeners go on the HiFi media shim instead of the deck.
const playback = vi.hoisted(() => ({ state: { playbackRoute: 'web' as 'web' | 'hifi' } }));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: Object.assign(
        (selector: (state: typeof playback.state) => unknown) => selector(playback.state),
        { getState: () => playback.state },
    ),
}));

const { usePlaybackReporter } = await import('@/components/app/playback/bridges/usePlaybackReporter');
const { hifiMediaShim } = await import('@/services/hifi/hifiMediaShim');

/**
 * A clock that moves with playback.
 *
 * The tracker cross-checks accumulated media time against the wall clock, so a test that plays 45
 * seconds of audio in zero real time is - correctly - rejected as impossible. Every tick advances
 * this by its own quarter second, which is what real playback would do.
 */
const clock = { now: 1_700_000_000_000 };

/** The parts of an HTMLAudioElement the hook touches, plus a way to drive its listeners. */
const createDeck = () => {
    const listeners = new Map<string, Set<() => void>>();
    return {
        currentTime: 0,
        paused: false,
        ended: false,
        addEventListener: (type: string, listener: () => void) => {
            listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
        },
        removeEventListener: (type: string, listener: () => void) => {
            listeners.get(type)?.delete(listener);
        },
        emit(type: string) {
            listeners.get(type)?.forEach(listener => listener());
        },
        /** Continuous playback in quarter-second ticks, the way a real deck reports it. */
        playFor(seconds: number) {
            for (let step = 0; step <= Math.round(seconds / 0.25); step += 1) {
                if (step > 0) {
                    this.currentTime = Number((this.currentTime + 0.25).toFixed(4));
                    clock.now += 250;
                }
                this.emit('timeupdate');
            }
        },
    };
};

type Deck = ReturnType<typeof createDeck>;

const song = (mediaId: string, overrides: Partial<SongResult> = {}): SongResult => ({
    id: mediaId,
    name: 'song-' + mediaId,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 240_000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId },
    ...overrides,
} as SongResult);

/** The song and payload of the nth report, named so the assertions read as intent. */
const reportedSong = (call: number) => gate.sendPlaybackReport.mock.calls[call]?.[0] as SongResult;
const reportedPayload = (call: number) => gate.sendPlaybackReport.mock.calls[call]?.[1] as OmniPlaybackReport;

let cleanups: Array<() => void> = [];
const audioRef: { current: Deck | null } = { current: null };

const render = (currentSong: SongResult | null, activeDeck = 'A') => {
    cleanups.forEach(cleanup => cleanup());
    runtime.cursor = 0;
    runtime.effects.length = 0;
    usePlaybackReporter({ audioRef: audioRef as never, currentSong, activeDeck });
    cleanups = runtime.effects
        .map(effect => effect())
        .filter((cleanup): cleanup is () => void => typeof cleanup === 'function');
};

describe('usePlaybackReporter', () => {
    let deck: Deck;

    beforeEach(() => {
        runtime.slots.length = 0;
        runtime.cursor = 0;
        runtime.effects.length = 0;
        cleanups = [];
        gate.isPlaybackReportReady.mockReset().mockReturnValue(true);
        gate.sendPlaybackReport.mockReset().mockResolvedValue(true);
        audioSettings.neteaseScrobbleEnabled = true;
        clock.now = 1_700_000_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
        deck = createDeck();
        audioRef.current = deck;
        playback.state.playbackRoute = 'web';
        hifiMediaShim.reset();
    });

    it('reports the finished track when the queue moves on', () => {
        render(song('1'));
        deck.playFor(45);
        render(song('2'));

        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(1);
        expect(reportedSong(0)).toMatchObject({ id: '1' });
        expect(reportedPayload(0)).toMatchObject({ playedSeconds: 45, quality: 'high' });
    });

    it('reports the outgoing track on an automix handover, where its `ended` never arrives', () => {
        render(song('1'));
        deck.playFor(50);

        // The blend arms: the queue advances and `audioRef` is repointed at the other deck, whose
        // `ended` for the outgoing track will never reach this hook.
        audioRef.current = createDeck();
        render(song('2'), 'B');

        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(1);
        expect(reportedSong(0)).toMatchObject({ id: '1' });
    });

    it('reports each pass of a loop-one repeat separately', () => {
        render(song('1'));
        deck.playFor(40);

        deck.currentTime = 0.25;
        deck.emit('timeupdate');
        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(1);

        deck.playFor(40);
        render(song('2'));
        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(2);
        expect(reportedSong(1)).toMatchObject({ id: '1' });
    });

    it('reports on `ended` when nothing else advances the queue', () => {
        render(song('1'));
        deck.playFor(45);
        deck.ended = true;
        deck.emit('ended');

        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(1);
    });

    it('says nothing about a track that was skipped early', () => {
        render(song('1'));
        deck.playFor(10);
        render(song('2'));

        expect(gate.sendPlaybackReport).not.toHaveBeenCalled();
    });

    it('drops the listen in progress when the setting is switched off', () => {
        render(song('1'));
        deck.playFor(45);

        audioSettings.neteaseScrobbleEnabled = false;
        render(song('1'));
        render(song('2'));

        expect(gate.sendPlaybackReport).not.toHaveBeenCalled();
    });

    it('withholds a report from a listener who signed out during the track', () => {
        render(song('1'));
        deck.playFor(45);

        gate.isPlaybackReportReady.mockReturnValue(false);
        render(song('2'));

        expect(gate.sendPlaybackReport).not.toHaveBeenCalled();
    });

    it.each([
        ['a provider that takes no reports', { kind: 'online', providerId: 'kugou', mediaId: '1' }],
        ['a local file', { kind: 'local', mediaId: 'local-1' }],
    ])('never opens a session for a song of %s', (_label, sourceRef) => {
        render(song('1', { sourceRef } as Partial<SongResult>));
        deck.playFor(90);
        render(song('2'));

        expect(gate.sendPlaybackReport).not.toHaveBeenCalled();
    });

    it('never opens a session for a song its provider cannot vouch for', () => {
        omniMock.canReportPlayback.mockImplementationOnce(() => false);
        render(song('1'));
        deck.playFor(90);
        omniMock.canReportPlayback.mockImplementationOnce(() => false);
        render(song('2'));

        expect(gate.sendPlaybackReport).not.toHaveBeenCalled();
    });

    it('asks whether the account of the song\'s own provider is signed in', () => {
        const first = song('1');
        render(first);
        deck.playFor(45);
        render(song('2'));

        expect(gate.isPlaybackReportReady).toHaveBeenCalledWith(first);
        expect(gate.isPlaybackReportReady).not.toHaveBeenCalledWith();
    });

    it('follows the song onto the HiFi media shim when the route changes, and back', () => {
        let position = 0;
        hifiMediaShim.setClockReader(() => position);
        const tick = (seconds: number) => {
            for (let step = 0; step < Math.round(seconds / 0.25); step += 1) {
                position += 0.25;
                clock.now += 250;
                hifiMediaShim.dispatchEvent(new Event('timeupdate'));
            }
        };

        render(song('1'));
        deck.playFor(10);
        // The next song plays through mpv: same hook, same ref, only the route moved.
        playback.state.playbackRoute = 'hifi';
        hifiMediaShim.beginTrack('online:netease:2#a');
        hifiMediaShim.setDuration(240);
        hifiMediaShim.markPlaying();
        render(song('2'));
        // The silent deck reports nothing any more; the shim's clock is what counts.
        deck.playFor(60);
        tick(45);
        playback.state.playbackRoute = 'web';
        hifiMediaShim.reset();
        render(song('3'));

        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(1);
        expect(reportedSong(0)).toMatchObject({ id: '2' });
        expect(reportedPayload(0)).toMatchObject({ playedSeconds: 45 });
        // Back on the web route the deck is listened to again.
        deck.playFor(45);
        render(song('4'));
        expect(gate.sendPlaybackReport).toHaveBeenCalledTimes(2);
        expect(reportedSong(1)).toMatchObject({ id: '3' });
    });

    it('counts nothing while the deck is paused', () => {
        render(song('1'));
        deck.playFor(20);
        deck.paused = true;
        deck.playFor(60);
        deck.paused = false;
        render(song('2'));

        expect(gate.sendPlaybackReport).not.toHaveBeenCalled();
    });
});
