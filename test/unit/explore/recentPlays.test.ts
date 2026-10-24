import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { SongResult } from '@/types';
import { DAY_BEGINS_HOUR, MAX_RECENT_PLAYS, MAX_REPLAYED_SONGS, PLAYS_KEPT_MS, RECENT_PLAYS_KEPT_MS, noteSongListened, noteSongPlayed, recentPlaysOf, replayedSongsOf, resetRecentPlays, showRecordedSongsAs, watchRecentPlays } from '@/components/app/home/explore/recentPlays';
import { whenHeard } from '@/components/app/home/explore/useRecentPlaysRecorder';
import { readOwnExploreSections } from '@/components/app/home/explore/ownSections';

// test/unit/explore/recentPlays.test.ts — Folia's own record of the songs played here: what is
// kept, for whom and how long, which songs were played lately, which were listened to more than
// once and in what order, what counts as one listening, and when a report of sound is due. Also the
// explore page's own sections as they are read from it.

const song = (id: string, providerId = 'ytm', extra: Partial<SongResult> = {}): SongResult => ({
    id, name: `Song ${id}`, artists: [], album: { id: '', name: '' }, duration: 0,
    sourceRef: { kind: 'online', providerId, mediaId: id }, ...extra,
} as unknown as SongResult);
const idsOf = (songs: SongResult[]) => songs.map(entry => String(entry.id));
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
// The length the songs of these tests are listened to by, where a test gives no other.
const SONG_MS = 4 * MINUTE;
const START = Date.parse('2026-10-07T10:00:00Z');
// The listener's day that START falls in, in the zone these tests are given (UTC, see `beforeEach`).
const TODAY = Math.floor((START - DAY_BEGINS_HOUR * HOUR) / DAY);

describe('recent plays', () => {
    const storage = { getItem: vi.fn<(key: string) => string | null>(), setItem: vi.fn<(key: string, value: string) => void>() };

    // What was stored last, and the same handed back at the next start.
    const stored = () => JSON.parse(storage.setItem.mock.calls.at(-1)![1]) as Record<string, { song: SongResult; at: number; heardAt: number; days: [number, number][] }[]>;
    const startAgain = () => {
        storage.getItem.mockReturnValue(storage.setItem.mock.calls.at(-1)![1]);
        resetRecentPlays();
    };
    // Each song of what was stored last, with how many listenings it has.
    const counts = (scope = 'ytm:me') => stored()[scope].map(play => [play.song.id, play.days.reduce((sum, [, count]) => sum + count, 0)]);
    // A song as it is reported when it is listened to from its start: played, then listened to.
    const listen = (id: string, accountId = 'me') => {
        noteSongPlayed(song(id), accountId);
        noteSongListened(song(id), accountId, SONG_MS, false);
    };
    const later = (ms: number) => vi.advanceTimersByTime(ms);

    // The listener's days are those of the device's zone: UTC here, wherever the tests are run.
    let zone: MockInstance<() => number>;

    beforeEach(() => {
        vi.resetAllMocks();
        zone = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0);
        vi.useFakeTimers();
        vi.setSystemTime(START);
        storage.getItem.mockReturnValue(null);
        vi.stubGlobal('localStorage', storage);
        resetRecentPlays();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('keeps the songs newest first, each once, apart for each platform and account', () => {
        noteSongPlayed(song('a'), 'me');
        noteSongPlayed(song('b'), 'me');
        noteSongPlayed(song('c'), 'me');
        // A song played again moves to the front; it is not listed twice.
        noteSongPlayed(song('a'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a', 'c', 'b']);
        noteSongPlayed(song('a'), 'someone else');
        noteSongPlayed(song('a', 'netease'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a', 'c', 'b']);
        expect(idsOf(recentPlaysOf('ytm', 'someone else'))).toEqual(['a']);
        expect(idsOf(recentPlaysOf('netease', 'me'))).toEqual(['a']);
        expect(recentPlaysOf('kugou', 'me')).toEqual([]);
        // What was stored last holds all of it, each song with the time it was played.
        expect(stored()).toMatchObject({ 'ytm:me': [{ song: { id: 'a' }, at: START }, { song: { id: 'c' } }, { song: { id: 'b' } }], 'netease:me': [{ song: { id: 'a' } }] });
        expect(storage.setItem.mock.calls.at(-1)![0]).toBe('folia_recent_plays');
    });

    it('keeps the song as it was when it was played last', () => {
        noteSongPlayed(song('a'), 'me');
        noteSongPlayed(song('b'), 'me');
        noteSongPlayed(song('a', 'ytm', { name: 'With its details' }), 'me');
        expect(recentPlaysOf('ytm', 'me').map(entry => entry.name)).toEqual(['With its details', 'Song b']);
    });

    it('keeps what the catalogue says of a song, not what the player attached to it', () => {
        const playing = song('a', 'ytm', {
            onlineLyricsState: { lyricsSource: 'imported', importedLyrics: { lines: Array(400).fill({ text: 'a line' }) } },
            playbackSourceRevision: 'bytes-of-this-playback',
            durationMs: 200000,
        } as unknown as Partial<SongResult>);
        noteSongPlayed(playing, 'me');
        const [kept] = recentPlaysOf('ytm', 'me');
        expect(kept).toEqual({ id: 'a', name: 'Song a', artists: [], album: { id: '', name: '' }, duration: 0, durationMs: 200000, sourceRef: { kind: 'online', providerId: 'ytm', mediaId: 'a' } });
        expect(storage.setItem.mock.calls.at(-1)![1]).not.toContain('a line');
        // The song handed in is left as it was.
        expect(playing.onlineLyricsState).toBeDefined();
    });

    it('tells its watchers of a change, and of nothing else', () => {
        const watcher = vi.fn();
        const stop = watchRecentPlays(watcher);
        noteSongPlayed(song('a'), 'me');
        const first = recentPlaysOf('ytm', 'me');
        expect(watcher).toHaveBeenCalledTimes(1);
        // The newest song is played again: the same list, and nobody told; only the time stored for it is new.
        vi.advanceTimersByTime(MINUTE);
        noteSongPlayed(song('a'), 'me');
        expect(recentPlaysOf('ytm', 'me')).toBe(first);
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(stored()['ytm:me']).toEqual([{ song: song('a'), at: START + MINUTE, heardAt: 0, days: [] }]);
        // A listening of it that is counted does change the record: the songs to play again may be others.
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(watcher).toHaveBeenCalledTimes(2);
        const listened = recentPlaysOf('ytm', 'me');
        expect(listened).not.toBe(first);
        // One that is not counted (the same listening goes on) does not.
        vi.advanceTimersByTime(MINUTE);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(watcher).toHaveBeenCalledTimes(2);
        expect(recentPlaysOf('ytm', 'me')).toBe(listened);
        expect(stored()['ytm:me']).toEqual([{ song: song('a'), at: START + 2 * MINUTE, heardAt: START + MINUTE, days: [[TODAY, 1]] }]);
        watcher.mockClear();
        // The newest played again once a song after it is no longer kept: the record does change, and its watchers are told.
        noteSongPlayed(song('old'), 'someone else');
        vi.advanceTimersByTime(PLAYS_KEPT_MS - DAY);
        noteSongPlayed(song('new'), 'someone else');
        vi.advanceTimersByTime(DAY);
        noteSongPlayed(song('new'), 'someone else');
        expect(watcher).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(1);
        noteSongPlayed(song('new'), 'someone else');
        expect(watcher).toHaveBeenCalledTimes(3);
        expect(stored()['ytm:someone else'].map(play => play.song.id)).toEqual(['new']);
        expect(idsOf(recentPlaysOf('ytm', 'someone else'))).toEqual(['new']);
        // Or once it was not played lately any more: it is again, so the list of those changes.
        vi.advanceTimersByTime(RECENT_PLAYS_KEPT_MS + 1);
        expect(recentPlaysOf('ytm', 'someone else')).toEqual([]);
        noteSongPlayed(song('new'), 'someone else');
        expect(watcher).toHaveBeenCalledTimes(4);
        expect(idsOf(recentPlaysOf('ytm', 'someone else'))).toEqual(['new']);
        watcher.mockClear();
        storage.setItem.mockClear();
        resetRecentPlays();
        noteSongPlayed(song('a'), 'me');
        const again = recentPlaysOf('ytm', 'me');
        expect(again).not.toBe(first);
        watcher.mockClear();
        // A song that is of no online platform is not recorded.
        noteSongPlayed({ ...song('local'), sourceRef: { kind: 'local', mediaId: 'local' } } as unknown as SongResult, 'me');
        expect(watcher).toHaveBeenCalledTimes(0);
        // A change gives another list: what renders from it sees that it changed.
        noteSongPlayed(song('b'), 'me');
        expect(recentPlaysOf('ytm', 'me')).not.toBe(again);
        expect(watcher).toHaveBeenCalledTimes(1);
        stop();
        noteSongPlayed(song('c'), 'me');
        expect(watcher).toHaveBeenCalledTimes(1);
    });

    it('keeps no more than its limit, dropping the oldest', () => {
        for (let index = 0; index <= MAX_RECENT_PLAYS; index += 1) noteSongPlayed(song(`s${index}`), 'me');
        const kept = idsOf(recentPlaysOf('ytm', 'me'));
        expect(kept).toHaveLength(MAX_RECENT_PLAYS);
        expect(kept[0]).toBe(`s${MAX_RECENT_PLAYS}`);
        expect(kept.at(-1)).toBe('s1');
    });

    it('lists a play as recent for seven days, and keeps it for thirty', () => {
        noteSongPlayed(song('a'), 'me');
        vi.advanceTimersByTime(3 * DAY);
        noteSongPlayed(song('b'), 'me');
        vi.advanceTimersByTime(4 * DAY);
        // Seven days to the millisecond: still listed, and the list is the one it was.
        const whole = recentPlaysOf('ytm', 'me');
        expect(idsOf(whole)).toEqual(['b', 'a']);
        expect(recentPlaysOf('ytm', 'me')).toBe(whole);
        // A moment later the older one is gone from it, while the app stays open; the list is then that one until the next change.
        vi.advanceTimersByTime(1);
        const shorter = recentPlaysOf('ytm', 'me');
        expect(idsOf(shorter)).toEqual(['b']);
        expect(recentPlaysOf('ytm', 'me')).toBe(shorter);
        // The record still holds it thirty days to the millisecond after it was played, and not a moment later.
        vi.advanceTimersByTime(PLAYS_KEPT_MS - RECENT_PLAYS_KEPT_MS - 1);
        noteSongPlayed(song('c'), 'me');
        expect(stored()['ytm:me'].map(play => play.song.id)).toEqual(['c', 'b', 'a']);
        vi.advanceTimersByTime(1);
        noteSongPlayed(song('c'), 'me');
        expect(stored()['ytm:me'].map(play => play.song.id)).toEqual(['c', 'b']);
    });

    it('counts a listening once: reported again sooner than the song lasts, it is the same one', () => {
        // A song that was only played has no listening.
        noteSongPlayed(song('a'), 'me');
        expect(counts()).toEqual([['a', 0]]);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(counts()).toEqual([['a', 1]]);
        later(5 * MINUTE);
        listen('b');
        later(5 * MINUTE);
        listen('a');
        expect(counts()).toEqual([['a', 2], ['b', 1]]);
        // Reported again a minute on, and again just short of the song's length after the one that
        // was counted (the player took it to its other deck, a blend out of it was called off, the
        // window was built anew): the same listening.
        later(MINUTE);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        later(SONG_MS - MINUTE - 1);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(counts()).toEqual([['a', 2], ['b', 1]]);
        // The song's length is counted from the listening that was counted, not from those reports:
        // a millisecond on it can have played through, and this is another.
        later(1);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(counts()).toEqual([['a', 3], ['b', 1]]);
        // A listening the song went straight on into (on repeat, or taken back) is one more whatever the clock says.
        later(1000);
        noteSongListened(song('a'), 'me', SONG_MS, true);
        noteSongListened(song('a'), 'me', SONG_MS, true);
        expect(counts()).toEqual([['a', 5], ['b', 1]]);
        // A listening is counted with nothing of this platform and account recorded in between (a
        // local song, a song of another platform), days later, and after the app was started again.
        noteSongPlayed(song('x', 'netease'), 'me');
        later(3 * DAY);
        listen('a');
        startAgain();
        later(5 * MINUTE);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(counts()).toEqual([['a', 7], ['b', 1]]);
        // They are kept by the day they were on, the newest day first, with when the last one was counted.
        expect(stored()['ytm:me'][0]).toMatchObject({ at: START + 3 * DAY + 19 * MINUTE + 1000, heardAt: START + 3 * DAY + 19 * MINUTE + 1000, days: [[TODAY + 3, 2], [TODAY, 5]] });
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['a']);
        // A song that is not the newest goes to the front when a listening of it is reported, counted or not.
        noteSongPlayed(song('b'), 'me');
        later(MINUTE);
        noteSongListened(song('a'), 'me', SONG_MS, false);
        expect(counts()).toEqual([['a', 7], ['b', 1]]);
        // The length is the one handed in with the listening, whatever the catalogue says of the song.
        const long = song('long', 'ytm', { durationMs: 30 * 1000 });
        const short = song('short', 'ytm', { durationMs: 20 * MINUTE });
        noteSongListened(long, 'other', 20 * MINUTE, false);
        noteSongListened(short, 'other', 30 * 1000, false);
        later(MINUTE);
        noteSongListened(long, 'other', 20 * MINUTE, false);
        noteSongListened(short, 'other', 30 * 1000, false);
        expect(counts('ytm:other')).toEqual([['short', 2], ['long', 1]]);
        later(19 * MINUTE - 1);
        noteSongListened(long, 'other', 20 * MINUTE, false);
        expect(counts('ytm:other')).toEqual([['long', 1], ['short', 2]]);
        later(1);
        noteSongListened(long, 'other', 20 * MINUTE, false);
        expect(counts('ytm:other')).toEqual([['long', 2], ['short', 2]]);
        // A listening counted ahead of the clock (the clock was set back a day with the app open)
        // holds nothing back: the next one is counted.
        vi.setSystemTime(Date.now() - DAY);
        noteSongListened(long, 'other', 20 * MINUTE, false);
        expect(counts('ytm:other')).toEqual([['long', 3], ['short', 2]]);
    });

    it('lists the songs listened to more than once, the one with most listenings of a day first', () => {
        const hear = (...ids: string[]) => ids.forEach(id => { later(5 * MINUTE); listen(id); });
        expect(replayedSongsOf('ytm', 'me')).toEqual([]);
        hear('a', 'b', 'c');
        expect(replayedSongsOf('ytm', 'me')).toEqual([]);
        // "a" three times, "d", "e" and "b" twice ("e" last of those, "b" first), "c" once.
        hear('a', 'b', 'a', 'd', 'e', 'd', 'e');
        const replayed = replayedSongsOf('ytm', 'me');
        expect(idsOf(replayed)).toEqual(['a', 'e', 'd', 'b']);
        // The same list until a play changes the record.
        expect(replayedSongsOf('ytm', 'me')).toBe(replayed);
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['e', 'd', 'a', 'b', 'c']);
        expect(replayedSongsOf('ytm', 'me')).toBe(replayed);
        // A song played a second time and skipped is not listened to a second time.
        later(5 * MINUTE);
        noteSongPlayed(song('c'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['c', 'e', 'd', 'a', 'b']);
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['a', 'e', 'd', 'b']);
        // Listened to a second time, it is: of those with two listenings the one played last.
        noteSongListened(song('c'), 'me', SONG_MS, false);
        expect(replayedSongsOf('ytm', 'me')).not.toBe(replayed);
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['a', 'c', 'e', 'd', 'b']);
        // Apart for each account and platform, as the record is.
        expect(replayedSongsOf('ytm', 'someone else')).toEqual([]);
        expect(replayedSongsOf('netease', 'me')).toEqual([]);
        // A song is in it for as long as it is kept: also once it was not played lately, and not after thirty days.
        later(RECENT_PLAYS_KEPT_MS + 1);
        expect(recentPlaysOf('ytm', 'me')).toEqual([]);
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['a', 'c', 'e', 'd', 'b']);
        startAgain();
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['a', 'c', 'e', 'd', 'b']);
        later(PLAYS_KEPT_MS);
        expect(replayedSongsOf('ytm', 'me')).toEqual([]);
    });

    it('hands the explore page its own sections as they are when read, those that hold nothing left out', () => {
        const t = (key: string) => key;
        const hear = (...ids: string[]) => ids.forEach(id => { later(5 * MINUTE); listen(id); });
        const songsIn = (sections: ReturnType<typeof readOwnExploreSections>) => sections.map(section => [
            section.id, section.title, section.items.map(item => (item.kind === 'song' ? String(item.song.id) : '')),
        ]);
        expect(readOwnExploreSections('ytm', 'me', t)).toEqual([]);
        hear('a', 'b');
        // Played lately, none of them listened to twice yet: the one section.
        expect(songsIn(readOwnExploreSections('ytm', 'me', t))).toEqual([['folia-recent-plays', 'home.exploreRecent', ['b', 'a']]]);
        hear('a');
        const read = readOwnExploreSections('ytm', 'me', t);
        expect(songsIn(read)).toEqual([
            ['folia-recent-plays', 'home.exploreRecent', ['a', 'b']],
            ['folia-play-again', 'home.exploreAgain', ['a']],
        ]);
        // Read once, they stay as they were while songs are played; a read after that has the new play.
        hear('c');
        expect(songsIn(read)).toEqual([
            ['folia-recent-plays', 'home.exploreRecent', ['a', 'b']],
            ['folia-play-again', 'home.exploreAgain', ['a']],
        ]);
        expect(songsIn(readOwnExploreSections('ytm', 'me', t))[0][2]).toEqual(['c', 'a', 'b']);
        // Apart for each account, as the record is.
        expect(readOwnExploreSections('ytm', 'someone else', t)).toEqual([]);
    });

    it('puts a song come back to on several days before one looped for a night, and a liking of late before an older one', () => {
        const again = () => idsOf(replayedSongsOf('ytm', 'me'));
        // Thirty listenings of "night" in one evening, on repeat; one of "daily" on that day.
        listen('night');
        for (let pass = 1; pass < 30; pass += 1) noteSongListened(song('night'), 'me', SONG_MS, true);
        listen('daily');
        expect(counts()).toEqual([['daily', 1], ['night', 30]]);
        expect(again()).toEqual(['night']);
        // "daily" once on each day after it. Three days on the evening still weighs more
        // (3.68 against 3.47), four days on it does not (3.33 against 4.14).
        for (let day = 1; day <= 3; day += 1) { later(DAY); listen('daily'); }
        expect(again()).toEqual(['night', 'daily']);
        later(DAY);
        listen('daily');
        expect(again()).toEqual(['daily', 'night']);
        expect(counts()).toEqual([['daily', 5], ['night', 30]]);

        // Two listenings ten days ago weigh less than two of today, whichever song was played last.
        vi.setSystemTime(START);
        storage.getItem.mockReturnValue(null);
        resetRecentPlays();
        listen('old');
        later(5 * MINUTE);
        listen('old');
        later(10 * DAY);
        listen('new');
        later(5 * MINUTE);
        listen('new');
        noteSongPlayed(song('old'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['old', 'new']);
        expect(again()).toEqual(['new', 'old']);

        // A day ahead of today (the clock was set back a week since) weighs as today, not more:
        // two listenings on it (1.58, and 3.17 if it weighed by how far ahead it is) against three of today (2).
        vi.setSystemTime(START + 7 * DAY);
        storage.getItem.mockReturnValue(null);
        resetRecentPlays();
        listen('ahead');
        later(5 * MINUTE);
        listen('ahead');
        vi.setSystemTime(START);
        for (let time = 0; time < 3; time += 1) { later(5 * MINUTE); listen('today'); }
        expect(counts()).toEqual([['today', 3], ['ahead', 2]]);
        expect(again()).toEqual(['today', 'ahead']);
    });

    it('takes a listening to count for thirty days, and an evening that runs past midnight for one day', () => {
        listen('a');
        later(5 * MINUTE);
        listen('a');
        expect(stored()['ytm:me'][0].days).toEqual([[TODAY, 2]]);
        // Played for a moment each week, the song stays kept; its two listenings count through the twenty-ninth day after.
        for (let week = 1; week <= 4; week += 1) { later(7 * DAY); noteSongPlayed(song('a'), 'me'); }
        later(DAY);
        const counted = replayedSongsOf('ytm', 'me');
        expect(idsOf(counted)).toEqual(['a']);
        expect(replayedSongsOf('ytm', 'me')).toBe(counted);
        // The day after they do not, with the app left open and nothing played: the song is kept, and is not one to play again.
        later(DAY);
        expect(replayedSongsOf('ytm', 'me')).toEqual([]);
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a']);
        // Its next listening is stored without them.
        listen('a');
        expect(stored()['ytm:me'][0].days).toEqual([[TODAY + 30, 1]]);

        // The listener's day begins at four in the morning. START is ten o'clock: a millisecond
        // before four the next morning is the same day, four o'clock is the next.
        vi.setSystemTime(START);
        storage.getItem.mockReturnValue(null);
        resetRecentPlays();
        listen('b');
        later(18 * HOUR - 1);
        noteSongListened(song('b'), 'me', SONG_MS, true);
        expect(stored()['ytm:me'][0].days).toEqual([[TODAY, 2]]);
        later(1);
        noteSongListened(song('b'), 'me', SONG_MS, true);
        expect(stored()['ytm:me'][0].days).toEqual([[TODAY + 1, 1], [TODAY, 2]]);
        // By the device's own zone: eight hours east of UTC, four in the morning is 20:00 UTC.
        zone.mockReturnValue(-8 * 60);
        vi.setSystemTime(START + 10 * HOUR - 1);
        storage.getItem.mockReturnValue(null);
        resetRecentPlays();
        listen('c');
        expect(stored()['ytm:me'][0].days).toEqual([[TODAY, 1]]);
        later(1);
        noteSongListened(song('c'), 'me', SONG_MS, true);
        expect(stored()['ytm:me'][0].days).toEqual([[TODAY + 1, 1], [TODAY, 1]]);
    });

    it('lists no more of the songs listened to more than once than its limit, and reads of the listenings stored what has their shape', () => {
        for (let round = 0; round < 2; round += 1) {
            later(5 * MINUTE);
            for (let index = 0; index < MAX_REPLAYED_SONGS + 3; index += 1) listen(`s${index}`);
        }
        expect(replayedSongsOf('ytm', 'me')).toHaveLength(MAX_REPLAYED_SONGS);
        storage.getItem.mockReturnValue(JSON.stringify({ 'ytm:me': [
            // Of before listenings were kept by day: it has none, whatever it counted.
            { song: song('a'), at: START, times: 5 },
            { song: song('b'), at: START, heardAt: START, days: [[TODAY, 2]] },
            // Days that are none are left out, and a time that is none is no time.
            { song: song('c'), at: START, heardAt: 'then', days: [[TODAY, 1], [TODAY - 1, 0], [TODAY - 2, -3], ['x', 2], [TODAY - 3, 1.5], [TODAY - 4], 7, null, [TODAY - 10, 1]] },
            // A listening timed ahead of the clock was counted now.
            { song: song('d'), at: START, heardAt: START + 400 * DAY, days: 'many' },
        ] }));
        vi.setSystemTime(START + 5 * MINUTE);
        resetRecentPlays();
        // "b": two listenings today (1.58). "c": one today and one ten days ago (1.37).
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['b', 'c']);
        for (const id of ['d', 'c', 'b', 'a']) noteSongListened(song(id), 'me', SONG_MS, false);
        expect(stored()['ytm:me'].map(play => [play.song.id, play.heardAt - START, play.days])).toEqual([
            ['a', 5 * MINUTE, [[TODAY, 1]]],
            ['b', 5 * MINUTE, [[TODAY, 3]]],
            ['c', 5 * MINUTE, [[TODAY, 2], [TODAY - 10, 1]]],
            ['d', 5 * MINUTE, []],
        ]);
        later(SONG_MS);
        noteSongListened(song('d'), 'me', SONG_MS, false);
        expect(counts()[0]).toEqual(['d', 1]);
    });

    it('counts the seven days from the last time a song was played, and drops what is kept no longer from what it stores', () => {
        noteSongPlayed(song('a'), 'me');
        vi.advanceTimersByTime(DAY);
        noteSongPlayed(song('b'), 'me');
        vi.advanceTimersByTime(5 * DAY);
        noteSongPlayed(song('a'), 'me');
        // "b" was played after "a" the first time, and goes before it.
        vi.advanceTimersByTime(3 * DAY);
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a']);
        // The next play stores the record without what is too old (here it had not been asked for since).
        vi.setSystemTime(START);
        resetRecentPlays();
        noteSongPlayed(song('a'), 'me');
        vi.advanceTimersByTime(DAY);
        listen('b');
        vi.advanceTimersByTime(5 * MINUTE);
        listen('b');
        vi.advanceTimersByTime(PLAYS_KEPT_MS - DAY + 1);
        noteSongPlayed(song('c'), 'me');
        expect(stored()['ytm:me'].map(play => play.song.id)).toEqual(['c', 'b']);
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['b']);
        // The next start reads only what is still kept then: "b", listened to twice, is not a day later.
        vi.advanceTimersByTime(DAY);
        startAgain();
        expect(replayedSongsOf('ytm', 'me')).toEqual([]);
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['c']);
        vi.advanceTimersByTime(RECENT_PLAYS_KEPT_MS);
        expect(recentPlaysOf('ytm', 'me')).toEqual([]);
    });

    it('drops what is too old wherever it stands in the list', () => {
        // The clock was set back two days while the app was open, and a song was played after that:
        // the newer play carries the older time, and stands before the older play.
        vi.setSystemTime(START + 2 * DAY);
        noteSongPlayed(song('first'), 'me');
        vi.setSystemTime(START);
        noteSongPlayed(song('second'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['second', 'first']);
        vi.setSystemTime(START + RECENT_PLAYS_KEPT_MS + 1);
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['first']);
    });

    it('drops what is too old for an account that is never asked for again', () => {
        noteSongPlayed(song('theirs'), 'someone else');
        vi.advanceTimersByTime(PLAYS_KEPT_MS + 1);
        startAgain();
        // Only this account is shown and played under from here on.
        noteSongPlayed(song('mine'), 'me');
        expect(stored()['ytm:me'].map(play => play.song.id)).toEqual(['mine']);
        expect(stored()['ytm:someone else']).toEqual([]);
    });

    it('takes songs recorded before plays were timed as played when they are first read', () => {
        storage.getItem.mockReturnValue(JSON.stringify({ 'ytm:me': [song('a'), song('b')], 'ytm:other': [{ song: song('c'), at: START - DAY }] }));
        resetRecentPlays();
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a', 'b']);
        // Stored with that time at once, with what was already timed left as it was.
        expect(stored()).toMatchObject({ 'ytm:me': [{ song: { id: 'a' }, at: START }, { song: { id: 'b' }, at: START }], 'ytm:other': [{ song: { id: 'c' }, at: START - DAY }] });
        // So that the seven days are counted from the first read, not from every start.
        vi.advanceTimersByTime(6 * DAY);
        startAgain();
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a', 'b']);
        // (The one that was timed is seven days old to the millisecond by now, and goes first.)
        expect(idsOf(recentPlaysOf('ytm', 'other'))).toEqual(['c']);
        vi.advanceTimersByTime(1);
        expect(recentPlaysOf('ytm', 'other')).toEqual([]);
        vi.advanceTimersByTime(DAY);
        startAgain();
        expect(recentPlaysOf('ytm', 'me')).toEqual([]);
        // A record that is timed throughout is not stored again by being read.
        storage.setItem.mockClear();
        storage.getItem.mockReturnValue(JSON.stringify({ 'ytm:me': [{ song: song('a'), at: Date.now() }] }));
        resetRecentPlays();
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a']);
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('reads what was stored, leaving out what has another shape, and works where nothing can be stored', () => {
        const at = START - DAY;
        storage.getItem.mockReturnValue(JSON.stringify({
            'ytm:me': [
                { song: song('a'), at }, null, 'b', { id: 'no name' }, { song: song('no time') }, { song: { id: 'no name' }, at },
                { song: song('c'), at: 'then' }, { song: song('time as text'), at: String(at) }, { song: song('d'), at },
            ],
            'ytm:other': 'songs',
            bad: [7],
        }));
        resetRecentPlays();
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a', 'd']);
        expect(recentPlaysOf('ytm', 'other')).toEqual([]);
        // A time ahead of the clock (the clock was set back since) counts as now, and is stored so at once:
        // the play is not kept past its seven days from here, whether the app stays open or is started again.
        storage.getItem.mockReturnValue(JSON.stringify({ 'ytm:me': [{ song: song('ahead'), at: START + 400 * DAY }] }));
        resetRecentPlays();
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['ahead']);
        expect(stored()['ytm:me']).toMatchObject([{ song: { id: 'ahead' }, at: START }]);
        vi.advanceTimersByTime(RECENT_PLAYS_KEPT_MS + 1);
        expect(recentPlaysOf('ytm', 'me')).toEqual([]);
        startAgain();
        expect(recentPlaysOf('ytm', 'me')).toEqual([]);
        vi.setSystemTime(START);
        for (const stored of ['not json', '[1]', '7', 'null']) {
            storage.getItem.mockReturnValue(stored);
            resetRecentPlays();
            expect(recentPlaysOf('ytm', 'me')).toEqual([]);
        }
        // A list stored longer than the limit is cut to it.
        storage.getItem.mockReturnValue(JSON.stringify({ 'ytm:me': Array.from({ length: MAX_RECENT_PLAYS + 5 }, (_, index) => ({ song: song(`s${index}`), at })) }));
        resetRecentPlays();
        expect(recentPlaysOf('ytm', 'me')).toHaveLength(MAX_RECENT_PLAYS);
        // Storage that refuses: the record holds for the session.
        storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
        noteSongPlayed(song('z'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))[0]).toBe('z');
        vi.stubGlobal('localStorage', undefined);
        resetRecentPlays();
        noteSongPlayed(song('a'), 'me');
        expect(idsOf(recentPlaysOf('ytm', 'me'))).toEqual(['a']);
    });

    it('sets a recorded video right to the song the platform shows it as, with its listenings, asking about each play until it is answered', async () => {
        listen('video');
        later(5 * MINUTE);
        listen('other');
        later(5 * MINUTE);
        listen('song');
        const watcher = vi.fn();
        const stop = watchRecentPlays(watcher);
        const asked: string[][] = [];
        const shownAs = async (songs: SongResult[]) => {
            asked.push(idsOf(songs));
            return new Map([['video', song('song', 'ytm', { name: 'The song' })]]);
        };
        expect(await showRecordedSongsAs('ytm', 'me', shownAs)).toBe(1);
        expect(asked).toEqual([['song', 'other', 'video']]);
        // The song keeps its place, the later time and both listenings: it is one to play again now.
        expect(counts()).toEqual([['song', 2], ['other', 1]]);
        expect(stored()['ytm:me'][0].at).toBe(START + 10 * MINUTE);
        expect(idsOf(replayedSongsOf('ytm', 'me'))).toEqual(['song']);
        expect(watcher).toHaveBeenCalledTimes(1);
        // The video, still playing, goes on as the song: it is not recorded again, nor its listening counted twice.
        noteSongListened(song('video'), 'me', SONG_MS, false);
        expect(counts()).toEqual([['song', 2], ['other', 1]]);
        // Nothing answered: nothing is stored and nobody is told.
        const writes = storage.setItem.mock.calls.length;
        expect(await showRecordedSongsAs('ytm', 'me', async () => new Map())).toBe(0);
        expect(storage.setItem.mock.calls.length).toBe(writes);
        // A song not answered about is asked about again; one answered about, as itself too, never again, after a restart too.
        const answer = (answers: Map<string, SongResult | null>) => async (songs: SongResult[]) => {
            asked.push(idsOf(songs));
            return answers;
        };
        expect(await showRecordedSongsAs('ytm', 'me', answer(new Map([['other', null]])))).toBe(0);
        resetRecentPlays();
        expect(await showRecordedSongsAs('ytm', 'me', answer(new Map()))).toBe(0);
        expect(asked).toEqual([['song', 'other', 'video'], ['other']]);
        expect(counts()).toEqual([['song', 2], ['other', 1]]);
        expect(watcher).toHaveBeenCalledTimes(1);
        stop();
    });
});

describe('a report of a song is due once enough of it has sounded', () => {
    // The part of an audio element the recorder goes by.
    const player = () => {
        const target = new EventTarget();
        const audio = Object.assign(target, { currentTime: 0, paused: false }) as unknown as HTMLAudioElement;
        const at = (seconds: number) => {
            (audio as { currentTime: number }).currentTime = seconds;
            target.dispatchEvent(new Event('timeupdate'));
        };
        return { audio, at };
    };

    it('reports each time as much has sounded as is asked for next, one report at a step', () => {
        const { audio, at } = player();
        const heard = vi.fn();
        // The first two reports are due after 5 s, the third after 8 s, and none after that.
        const dueAt = vi.fn((reports: number) => [5, 5, 8][reports] ?? Infinity);
        whenHeard(audio, dueAt, heard);
        for (const seconds of [1, 2, 3, 4, 4.9]) at(seconds);
        expect(heard).not.toHaveBeenCalled();
        at(5);
        expect(heard.mock.calls).toEqual([[0]]);
        at(6);
        expect(heard.mock.calls).toEqual([[0], [1]]);
        at(7);
        expect(heard).toHaveBeenCalledTimes(2);
        at(8);
        expect(heard.mock.calls).toEqual([[0], [1], [2]]);
        for (const seconds of [9, 10, 11, 12, 13, 14]) at(seconds);
        expect(heard).toHaveBeenCalledTimes(3);
        // What is due is asked for anew at each step: it may be another by then.
        expect(dueAt.mock.calls.slice(0, 6)).toEqual([[0], [0], [0], [0], [0], [0]]);
        expect(dueAt).toHaveBeenLastCalledWith(3);
    });

    it('counts neither a seek, nor a step backwards, nor time while paused', () => {
        const { audio, at } = player();
        const heard = vi.fn();
        whenHeard(audio, () => 5, heard);
        at(1);
        // Dragged far ahead, and back: neither is sound.
        at(120);
        at(60);
        at(61);
        (audio as { paused: boolean }).paused = true;
        at(62);
        at(63);
        (audio as { paused: boolean }).paused = false;
        // 1 + 1 heard so far; the step taken while paused is not made up for.
        at(64);
        at(65);
        expect(heard).not.toHaveBeenCalled();
        at(66);
        expect(heard).toHaveBeenCalledTimes(1);
    });

    it('starts from where the song stands, and stops when told to', () => {
        const { audio, at } = player();
        (audio as { currentTime: number }).currentTime = 90.5;
        const heard = vi.fn();
        const stopFirst = whenHeard(audio, () => 5, heard);
        // The first step counts from where the song stood: 1.5 s, then 1 + 1 + 1 + 0.5.
        for (const seconds of [92, 93, 94, 95]) at(seconds);
        expect(heard).not.toHaveBeenCalled();
        at(95.5);
        expect(heard).toHaveBeenCalledTimes(1);
        stopFirst();

        const stopped = vi.fn();
        const stop = whenHeard(audio, () => 5, stopped);
        for (const seconds of [96, 97, 98, 99]) at(seconds);
        stop();
        for (const seconds of [100, 101, 102]) at(seconds);
        expect(stopped).not.toHaveBeenCalled();
    });
});
