import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/explore/useRecentPlaysRecorder.test.ts
// The wiring between the player and Folia's own record of recently played songs: which song is
// written, for which account, when as played and when as listened to, and what starts the count
// again. The repo's vitest runs on node
// without a DOM, so this drives the hook with a minimal React runtime (as the listening-report
// test beside it does) that keeps to an effect's dependencies, and a hand-made audio element.

const runtime = vi.hoisted(() => ({
    slots: [] as Array<{ current: unknown }>,
    cursor: 0,
    effect: null as null | { deps: unknown[]; stop: void | (() => void) },
}));

vi.mock('react', () => ({
    useRef: (initial: unknown) => {
        const index = runtime.cursor++;
        runtime.slots[index] ??= { current: initial };
        return runtime.slots[index];
    },
    // The hook has one effect; it runs again only when one of its dependencies changed.
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
        const before = runtime.effect;
        if (before && before.deps.length === deps.length && before.deps.every((value, index) => Object.is(value, deps[index]))) return;
        before?.stop?.();
        runtime.effect = { deps, stop: effect() };
    },
}));

const recent = vi.hoisted(() => ({ noteSongPlayed: vi.fn(), noteSongListened: vi.fn() }));
// The record itself, for the tests that let the reports through to it.
const record = vi.hoisted(() => ({ real: null as null | typeof import('@/components/app/home/explore/recentPlays') }));
vi.mock('@/components/app/home/explore/recentPlays', async importOriginal => {
    record.real = await importOriginal<typeof import('@/components/app/home/explore/recentPlays')>();
    return { ...record.real, ...recent };
});
const accounts = vi.hoisted(() => ({ accounts: {} as Record<string, { user: { id: string | number } | null }> }));
vi.mock('@/stores/useOnlineProviderAccountStore', () => ({ useOnlineProviderAccountStore: { getState: () => accounts } }));
const navidrome = vi.hoisted(() => ({ config: null as null | { serverUrl: string; username: string; passwordHash: string } }));
vi.mock('@/services/navidromeService', () => ({ getNavidromeConfig: () => navidrome.config }));
// Only the playback route is read: on the HiFi route the song's position is the HiFi media shim's.
const playback = vi.hoisted(() => ({ state: { playbackRoute: 'web' as 'web' | 'hifi' } }));
vi.mock('@/stores/usePlaybackStore', () => ({
    usePlaybackStore: Object.assign(
        (selector: (state: typeof playback.state) => unknown) => selector(playback.state),
        { getState: () => playback.state },
    ),
}));

const { useRecentPlaysRecorder, RECENT_PLAY_SECONDS, LISTENING_SECONDS_AT_MOST, USUAL_SONG_SECONDS } = await import('@/components/app/home/explore/useRecentPlaysRecorder');
const { hifiMediaShim } = await import('@/services/hifi/hifiMediaShim');

const song = (id: string, providerId = 'ytm', extra: Partial<SongResult> = {}): SongResult => ({
    id, name: `Song ${id}`, sourceRef: { kind: 'online', providerId, mediaId: id }, ...extra,
} as unknown as SongResult);
// The part of an audio element the recorder goes by; `play` lets that many seconds of it sound,
// `restart` takes it back to its start as a song on repeat goes (which is no sound itself). Its
// length is not known unless a test gives it one.
const player = () => {
    const target = new EventTarget();
    const audio = Object.assign(target, { currentTime: 0, paused: false, duration: Number.NaN }) as unknown as HTMLAudioElement & { currentTime: number; duration: number };
    const play = (seconds: number) => {
        for (let heard = 0; heard < seconds; heard += 1) {
            audio.currentTime += 1;
            target.dispatchEvent(new Event('timeupdate'));
        }
    };
    const restart = () => {
        audio.currentTime = 0;
        target.dispatchEvent(new Event('timeupdate'));
    };
    return { audio, play, restart };
};
// As in the app: one ref for the whole session, naming whichever element plays.
const audioRef: { current: HTMLAudioElement | null } = { current: null };
const render = (audio: HTMLAudioElement | null, currentSong: SongResult | null, activeDeck = 'a') => {
    runtime.cursor = 0;
    audioRef.current = audio;
    useRecentPlaysRecorder({ audioRef, currentSong, activeDeck });
};

describe('recent plays recorder', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        runtime.effect?.stop?.();
        Object.assign(runtime, { slots: [], cursor: 0, effect: null });
        accounts.accounts = { ytm: { user: { id: 'me' } }, netease: { user: { id: 42 } } };
        playback.state.playbackRoute = 'web';
        hifiMediaShim.reset();
    });

    it('records a song of an online platform once it has sounded long enough, for the account of that platform', () => {
        const { audio, play } = player();
        const first = song('a');
        render(audio, first);
        play(RECENT_PLAY_SECONDS - 1);
        expect(recent.noteSongPlayed).not.toHaveBeenCalled();
        play(1);
        expect(recent.noteSongPlayed.mock.calls).toEqual([[first, 'me']]);
        // Once for a song, however long it goes on; that it was played is no listening.
        play(60);
        expect(recent.noteSongPlayed).toHaveBeenCalledTimes(1);
        expect(recent.noteSongListened).not.toHaveBeenCalled();

        // Another platform's song goes under that platform's account; nobody signed in is ''.
        const other = song('b', 'netease');
        render(audio, other);
        play(RECENT_PLAY_SECONDS);
        expect(recent.noteSongPlayed).toHaveBeenLastCalledWith(other, '42');
        accounts.accounts = {};
        const guest = song('c');
        render(audio, guest);
        play(RECENT_PLAY_SECONDS);
        expect(recent.noteSongPlayed).toHaveBeenLastCalledWith(guest, '');
    });

    it('goes on counting when the app holds another object for the same song, and records that one', () => {
        const { audio, play } = player();
        render(audio, song('a'));
        play(3);
        // The song's details were filled in while it plays.
        const filled = song('a', 'ytm', { name: 'With its details' });
        render(audio, filled);
        play(2);
        expect(recent.noteSongPlayed.mock.calls).toEqual([[filled, 'me']]);
    });

    it('starts over with another song, and does not record the one that was skipped', () => {
        const { audio, play } = player();
        render(audio, song('a'));
        play(RECENT_PLAY_SECONDS - 1);
        const next = song('b');
        render(audio, next);
        play(RECENT_PLAY_SECONDS - 1);
        expect(recent.noteSongPlayed).not.toHaveBeenCalled();
        play(1);
        expect(recent.noteSongPlayed.mock.calls).toEqual([[next, 'me']]);
    });

    it('follows playback to the other deck', () => {
        const first = player();
        const second = player();
        const playing = song('a');
        render(first.audio, playing, 'a');
        first.play(2);
        // Automix handed over: the same queue entry now plays from the other element.
        render(second.audio, playing, 'b');
        first.play(10);
        expect(recent.noteSongPlayed).not.toHaveBeenCalled();
        second.play(RECENT_PLAY_SECONDS);
        expect(recent.noteSongPlayed.mock.calls).toEqual([[playing, 'me']]);
    });

    it('records a listening once half of the song has sounded, and one more with each further length of it', () => {
        const { audio, play, restart } = player();
        const playing = song('a', 'ytm', { durationMs: 200 * 1000 });
        render(audio, playing);
        play(99);
        expect(recent.noteSongPlayed).toHaveBeenCalledTimes(1);
        expect(recent.noteSongListened).not.toHaveBeenCalled();
        play(1);
        expect(recent.noteSongListened.mock.calls).toEqual([[playing, 'me', 200 * 1000, false]]);
        play(100);
        // On repeat: the song goes on from its start, and is listened to again once its whole
        // length has sounded since the last listening. That one is told as one more.
        restart();
        play(99);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(1);
        play(1);
        expect(recent.noteSongListened.mock.calls).toEqual([[playing, 'me', 200 * 1000, false], [playing, 'me', 200 * 1000, true]]);
        // Taken back by hand in the middle: the same.
        restart();
        play(199);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(2);
        play(1);
        expect(recent.noteSongListened.mock.calls).toEqual([[playing, 'me', 200 * 1000, false], [playing, 'me', 200 * 1000, true], [playing, 'me', 200 * 1000, true]]);
        // It was played once in all that.
        expect(recent.noteSongPlayed).toHaveBeenCalledTimes(1);

        // The account at the moment of each report, and the song as it is then.
        accounts.accounts = { ytm: { user: { id: 'another' } } };
        const filled = song('a', 'ytm', { durationMs: 200 * 1000, name: 'With its details' });
        render(audio, filled);
        restart();
        play(200);
        expect(recent.noteSongListened).toHaveBeenLastCalledWith(filled, 'another', 200 * 1000, true);
    });

    it('takes four minutes of a long song for a listening', () => {
        const { audio, play } = player();
        const long = song('a', 'ytm', { durationMs: 20 * 60 * 1000 });
        render(audio, long);
        play(LISTENING_SECONDS_AT_MOST - 1);
        expect(recent.noteSongListened).not.toHaveBeenCalled();
        play(1);
        expect(recent.noteSongListened.mock.calls).toEqual([[long, 'me', 20 * 60 * 1000, false]]);
        // One more after its whole length again, not after four more minutes.
        play(20 * 60 - 1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(1);
        play(1);
        expect(recent.noteSongListened).toHaveBeenLastCalledWith(long, 'me', 20 * 60 * 1000, true);
    });

    it('goes by the length of what is sounding, by that of the catalogue where the element has none, and by the usual one else', () => {
        // The element says 100 s, the catalogue 200 s: half of what is sounding.
        const sounding = player();
        sounding.audio.duration = 100;
        render(sounding.audio, song('a', 'ytm', { durationMs: 200 * 1000 }));
        sounding.play(49);
        expect(recent.noteSongListened).not.toHaveBeenCalled();
        sounding.play(1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(1);
        // The record is handed the length the listening was measured by.
        expect(recent.noteSongListened.mock.calls[0][2]).toBe(100 * 1000);
        // A stream of no known length: the 200 s of the catalogue.
        const stream = player();
        stream.audio.duration = Infinity;
        render(stream.audio, song('b', 'ytm', { durationMs: 200 * 1000 }));
        stream.play(99);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(1);
        stream.play(1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(2);
        // Neither knows: the usual length.
        const unknown = player();
        render(unknown.audio, song('c'));
        unknown.play(USUAL_SONG_SECONDS / 2 - 1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(2);
        unknown.play(1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(3);
        expect(recent.noteSongListened.mock.calls[2][2]).toBe(USUAL_SONG_SECONDS * 1000);
        // The length is asked for at each step: the element comes to know its own while the song plays.
        const late = player();
        render(late.audio, song('d'));
        late.play(10);
        late.audio.duration = 60;
        late.play(19);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(3);
        late.play(1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(4);
    });

    it('takes a length that is too short for twice what makes a song played', () => {
        const { audio, play } = player();
        const broken = song('a', 'ytm', { durationMs: 1 });
        render(audio, broken);
        // Played after 5 s; the listening is due then too, and is reported at the next step.
        play(RECENT_PLAY_SECONDS);
        expect(recent.noteSongPlayed).toHaveBeenCalledTimes(1);
        expect(recent.noteSongListened).not.toHaveBeenCalled();
        play(1);
        expect(recent.noteSongListened.mock.calls).toEqual([[broken, 'me', 2 * RECENT_PLAY_SECONDS * 1000, false]]);
        // One more with each 10 s after that, not at every step.
        play(2 * RECENT_PLAY_SECONDS - 2);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(1);
        play(1);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(2);
    });

    it('counts from nothing when the song is followed anew, and tells the listening after that as no further one', () => {
        const first = player();
        const second = player();
        const playing = song('a', 'ytm', { durationMs: 200 * 1000 });
        render(first.audio, playing, 'a');
        first.play(150);
        expect(recent.noteSongListened.mock.calls).toEqual([[playing, 'me', 200 * 1000, false]]);
        // The player took the song to its other deck: the 150 s are not carried over.
        render(second.audio, playing, 'b');
        second.play(99);
        expect(recent.noteSongListened).toHaveBeenCalledTimes(1);
        second.play(1);
        expect(recent.noteSongListened.mock.calls).toEqual([[playing, 'me', 200 * 1000, false], [playing, 'me', 200 * 1000, false]]);
        expect(recent.noteSongPlayed).toHaveBeenCalledTimes(2);
    });

    it('follows the same song onto the HiFi media shim when only the route changes', () => {
        const deck = player();
        let position = 0;
        hifiMediaShim.setClockReader(() => position);
        const playing = song('a');
        render(deck.audio, playing);
        deck.play(RECENT_PLAY_SECONDS - 1);
        // The same song goes on through mpv (a restore that adopted it): nothing else changed.
        playback.state.playbackRoute = 'hifi';
        hifiMediaShim.beginTrack('online:ytm:a#1');
        hifiMediaShim.markPlaying();
        render(deck.audio, playing);
        deck.play(30);
        expect(recent.noteSongPlayed).not.toHaveBeenCalled();
        for (let heard = 0; heard < RECENT_PLAY_SECONDS; heard += 1) {
            position += 1;
            hifiMediaShim.dispatchEvent(new Event('timeupdate'));
        }
        hifiMediaShim.reset();
        expect(recent.noteSongPlayed.mock.calls).toEqual([[playing, 'me']]);
    });

    it('records a local file under no account and a Navidrome song under the user at its server, and nothing of the stage nor with nothing playing', () => {
        navidrome.config = { serverUrl: 'https://music.example/', username: 'me', passwordHash: '' };
        const { audio, play } = player();
        render(audio, { id: 'file', name: 'A file', durationMs: 20 * 1000, sourceRef: { kind: 'local', mediaId: 'file' } } as unknown as SongResult);
        play(60);
        expect(recent.noteSongPlayed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'file' }), '');
        render(audio, { id: 'n1', name: 'A Navidrome song', durationMs: 20 * 1000, sourceRef: { kind: 'navidrome', mediaId: 'n1' } } as unknown as SongResult);
        play(60);
        expect(recent.noteSongPlayed).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'n1' }), 'me@https://music.example');
        navidrome.config = null;
        recent.noteSongPlayed.mockClear();
        recent.noteSongListened.mockClear();
        render(audio, { id: 'show', name: 'Another app', durationMs: 20 * 1000, sourceRef: { kind: 'stage', mediaId: 'show' } } as unknown as SongResult);
        play(60);
        render(audio, null);
        play(30);
        render(null, song('a'));
        expect(recent.noteSongPlayed).not.toHaveBeenCalled();
        expect(recent.noteSongListened).not.toHaveBeenCalled();
    });

    describe('with its reports let through to the record', () => {
        const storage = { getItem: () => null, setItem: vi.fn<(key: string, value: string) => void>() };
        // How many listenings what was stored last holds for a song, and the lists read from the record.
        const listeningsOf = (id: string) => {
            const stored = JSON.parse(storage.setItem.mock.calls.at(-1)![1]) as Record<string, { song: SongResult; days: [number, number][] }[]>;
            return stored['ytm:me'].find(play => play.song.id === id)?.days.reduce((sum, [, count]) => sum + count, 0);
        };
        const idsOf = (songs: SongResult[]) => songs.map(entry => String(entry.id));
        const recentIds = () => idsOf(record.real!.recentPlaysOf('ytm', 'me'));
        const againIds = () => idsOf(record.real!.replayedSongsOf('ytm', 'me'));
        // Lets that many seconds of a player sound, the clock going with it.
        const sound = (source: ReturnType<typeof player>, seconds: number) => {
            for (let heard = 0; heard < seconds; heard += 1) {
                vi.advanceTimersByTime(1000);
                source.play(1);
            }
        };

        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(Date.parse('2026-10-07T10:00:00Z'));
            vi.stubGlobal('localStorage', storage);
            record.real!.resetRecentPlays();
            recent.noteSongPlayed.mockImplementation(record.real!.noteSongPlayed);
            recent.noteSongListened.mockImplementation(record.real!.noteSongListened);
        });
        afterEach(() => {
            vi.useRealTimers();
            vi.unstubAllGlobals();
        });

        it('counts a song once for each time it is heard through: on repeat too, and not for a skip', () => {
            const deck = player();
            const looped = song('looped', 'ytm', { durationMs: 200 * 1000 });
            render(deck.audio, looped);
            sound(deck, 200);
            expect(listeningsOf('looped')).toBe(1);
            expect(againIds()).toEqual([]);
            // Twice more round, on repeat.
            for (let round = 0; round < 2; round += 1) {
                deck.restart();
                sound(deck, 200);
            }
            expect(listeningsOf('looped')).toBe(3);
            expect(againIds()).toEqual(['looped']);

            // A song skipped after ten seconds, twice: played, and never listened to.
            const skipped = song('skipped', 'ytm', { durationMs: 200 * 1000 });
            for (const next of [skipped, looped, skipped]) {
                render(deck.audio, next);
                deck.restart();
                sound(deck, 10);
            }
            expect(recentIds()).toEqual(['skipped', 'looped']);
            expect(listeningsOf('skipped')).toBe(0);
            expect(listeningsOf('looped')).toBe(3);
            expect(againIds()).toEqual(['looped']);
        });

        it('counts one listening for a song that is followed anew while it plays', () => {
            // Taken to the other deck at 150 s of its 200 s: less than half is left, and nothing more is reported.
            const first = player();
            const second = player();
            const moved = song('moved', 'ytm', { durationMs: 200 * 1000 });
            render(first.audio, moved, 'a');
            sound(first, 150);
            second.audio.currentTime = 150;
            render(second.audio, moved, 'b');
            sound(second, 50);
            expect(listeningsOf('moved')).toBe(1);
            // A twenty-minute track taken over at five minutes: four more minutes of it are reported
            // as a listening, sooner after the one counted than the track lasts, and are that same one.
            const long = song('long', 'ytm', { durationMs: 20 * 60 * 1000 });
            render(first.audio, long, 'a');
            first.restart();
            sound(first, 300);
            expect(listeningsOf('long')).toBe(1);
            second.audio.currentTime = 300;
            render(second.audio, long, 'b');
            sound(second, 300);
            expect(recent.noteSongListened).toHaveBeenLastCalledWith(long, 'me', 20 * 60 * 1000, false);
            expect(listeningsOf('long')).toBe(1);
        });

        it('holds a second listening to the length the song was measured by, where the catalogue gives none', () => {
            // 150 s by the element, nothing in the catalogue. Heard through, a one-minute song
            // heard through, and heard through again: the second listening comes 210 s after the
            // first, which is more than the song lasts (and less than the usual four minutes).
            const deck = player();
            const short = song('short');
            const between = song('between', 'ytm', { durationMs: 60 * 1000 });
            for (const [next, seconds] of [[short, 150], [between, 60], [short, 150]] as const) {
                deck.audio.duration = seconds;
                render(deck.audio, next);
                deck.restart();
                sound(deck, seconds);
            }
            expect(listeningsOf('short')).toBe(2);
            expect(againIds()).toEqual(['short']);
        });
    });
});
