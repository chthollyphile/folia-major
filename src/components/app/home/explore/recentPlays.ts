import type { SongResult } from '../../../../types';
import type { OnlineProviderId } from '../../../../types/onlineMusic';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../../../utils/appPlaybackGuards';

// src/components/app/home/explore/recentPlays.ts
// Folia's own record of the songs played here from an online platform: each song once, with
// when it was last played and how many listenings of it each day had, newest first. It is what
// the explore page's own sections are made of (ownSections.ts): the songs played lately, and the
// songs listened to more than once. What an account played on a platform's own apps is no part
// of it, and what is played here need not reach the platform (the YouTube Music sign-in reports
// no play).
// Played and listened to are two things, reported apart (useRecentPlaysRecorder.ts): a song is
// played once a few seconds of it have sounded, and listened to once half of it has. Only a
// listening speaks for playing a song again: a song skipped twice was not liked twice.
// Kept on this device (localStorage), apart for each platform and each account of it. A song is
// kept for thirty days after it was last played, and a listening counts for thirty of the
// listener's days; "played lately" is the last seven days.

const STORAGE_KEY = 'folia_recent_plays';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** How long a song is kept after it was last played, in milliseconds. */
export const PLAYS_KEPT_MS = 30 * DAY_MS;
/** How long a song counts as played lately, in milliseconds. */
export const RECENT_PLAYS_KEPT_MS = 7 * DAY_MS;
/** How many songs are kept for one account of one platform, however many were played in that time. */
export const MAX_RECENT_PLAYS = 300;
/** How many of the songs listened to more than once are listed. */
export const MAX_REPLAYED_SONGS = 30;
/** In how many days a listening comes to weigh half as much, where the songs to play again are put in order. */
const LISTENING_HALF_LIFE_DAYS = 7;
/** The hour at which a listener's day begins: an evening that runs past midnight is one day. */
export const DAY_BEGINS_HOUR = 4;
const LISTENING_KEPT_DAYS = PLAYS_KEPT_MS / DAY_MS;

/** A day of the listener's (see `dayOf`), and how many listenings of a song it had. */
type DayCount = [day: number, listenings: number];
/**
 * A song, when it was last played, when a listening of it was last counted (0: never), its
 * listenings by day, and whether the platform was asked which song it shows it as (see `showRecordedSongsAs`).
 */
interface Play { song: SongResult; at: number; heardAt: number; days: DayCount[]; checked?: boolean }
type Kept = Record<string, Play[]>;

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);
const scopeOf = (providerId: string, accountId: string) => `${providerId}:${accountId}`;
const isSong = (value: unknown): value is SongResult => typeof value === 'object' && value !== null && 'id' in value && 'name' in value;
const isPlay = (value: unknown): value is Play => typeof value === 'object' && value !== null
    && isSong((value as Play).song) && Number.isFinite((value as Play).at);
const isDayCount = (value: unknown): value is DayCount => Array.isArray(value) && value.length === 2
    && Number.isSafeInteger(value[0]) && Number.isSafeInteger(value[1]) && value[1] > 0;
const isKept = (play: Play, now: number) => now - play.at <= PLAYS_KEPT_MS;
const isRecent = (play: Play, now: number) => now - play.at <= RECENT_PLAYS_KEPT_MS;
// The number of the listener's day that a time falls in, by this device's clock and zone.
const dayOf = (at: number) => Math.floor((at - new Date(at).getTimezoneOffset() * 60 * 1000 - DAY_BEGINS_HOUR * HOUR_MS) / DAY_MS);
// The listenings that count on a day: those of the thirty days up to it.
const countedOn = (days: DayCount[], day: number) => days.filter(([on]) => day - on < LISTENING_KEPT_DAYS);
const listeningsIn = (days: DayCount[]) => days.reduce((sum, [, count]) => sum + count, 0);
// The listenings by day with one more on `day`, without those that count no longer.
const withListening = (days: DayCount[], day: number): DayCount[] => {
    const counted = countedOn(days, day);
    const before = counted.find(([on]) => on === day)?.[1] ?? 0;
    return [[day, before + 1], ...counted.filter(([on]) => on !== day)];
};
// What listenings weigh on `day`, where the songs to play again are put in order. Two things are
// held down. A liking of some time ago: a day's listenings weigh half as much with every seven
// days since. And one evening on repeat: a day with n listenings weighs log2(1 + n), which is 1,
// 1.6, 2, 2.3 ... and 5 for thirty of them. So a song come back to day after day stands before
// one that was looped for a night after a few days: after four of them, for a night of thirty.
// (A day ahead of `day`, after the clock or the zone was set back, weighs as that day itself.)
const weightOf = (days: DayCount[], day: number) => days.reduce((sum, [on, count]) => (
    sum + Math.log2(1 + count) * 0.5 ** (Math.max(0, day - on) / LISTENING_HALF_LIFE_DAYS)
), 0);
// One listening of a song is counted once. A song is followed anew more than once in a listening
// (the player takes it to its other deck, a blend out of it is called off, the window is built
// anew in mid-song), each time from nothing heard, and what is reported then does not tell those
// from a song begun again. So: a listening reported sooner after the last one counted than the
// song lasts cannot be of a song played through in between, and is taken to be that same one.
// The length is the one the listening was measured by, handed over with it. (A listening the
// song went straight on into is told apart by who reports it: `noteSongListened`. One counted
// ahead of the clock, which was set back since, holds nothing back.)
const goesOn = (play: Play, now: number, lengthMs: number) => now >= play.heardAt && now - play.heardAt < lengthMs;
const store = (plays: Kept): void => {
    try { storage()?.setItem(STORAGE_KEY, JSON.stringify(plays)); } catch { /* kept for the session */ }
};
// A play as it is kept, from one that was stored: its times no later than `now`, and of its
// listenings what has the shape written here. A record of before listenings were kept by day has
// none: what it counted were plays of a few seconds.
const keptAs = (stored: Play, now: number): Play => ({
    song: stored.song,
    at: Math.min(stored.at, now),
    heardAt: Number.isFinite(stored.heardAt) ? Math.min(stored.heardAt, now) : 0,
    days: Array.isArray(stored.days) ? stored.days.filter(isDayCount) : [],
    ...(stored.checked === true ? { checked: true } : {}),
});

// What is stored, as far as it has the shape written here and is not too old; anything else is
// left out. A record written before plays were timed holds the songs themselves: those count as
// played now. So does a play timed ahead of this device's clock (the clock was set back since).
// Either is stored with its new time at once: read again at the next start, it would otherwise be
// given its whole time again at each start.
const read = (): Kept => {
    const now = Date.now();
    const plays: Kept = {};
    let isRetimed = false;
    try {
        const stored: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null');
        if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return plays;
        for (const [scope, entries] of Object.entries(stored)) {
            if (!Array.isArray(entries)) continue;
            isRetimed ||= entries.some(entry => isSong(entry) || (isPlay(entry) && entry.at > now));
            plays[scope] = entries
                .flatMap((entry): Play[] => (isSong(entry) ? [{ song: entry, at: now, heardAt: 0, days: [] }] : isPlay(entry) ? [keptAs(entry, now)] : []))
                .filter(play => isKept(play, now))
                .slice(0, MAX_RECENT_PLAYS);
        }
    } catch { /* nothing usable is stored */ }
    if (isRetimed) store(plays);
    return plays;
};
// A profile that cannot store keeps the record for the session.
let kept: Kept | null = null;
const recall = (): Kept => (kept ??= read());
const watchers = new Set<() => void>();
const NONE: SongResult[] = [];
// What is read from a list of plays: the same lists for as long as the plays are the same ones.
// (The songs played lately are fewer as time goes by: `recentCount` tells that they are. The
// listenings that count are fewer from one day to the next: `replayedOn` is the day they were read on.)
const listed = new WeakMap<Play[], { recentCount: number; recent: SongResult[]; replayedOn?: number; replayed?: SongResult[] }>();
// The plays of a scope that are still kept.
const keptOf = (scope: string, now: number): Play[] | null => {
    const plays = recall()[scope];
    if (!plays) return null;
    // (Any of them, not the last one alone: a clock that was set back leaves the list out of the order of its times.)
    if (plays.some(play => !isKept(play, now))) recall()[scope] = plays.filter(play => isKept(play, now));
    return recall()[scope];
};

// What is kept of a song: what the catalogue says of it. What the player attached while it
// played is left out: the listener's own lyrics for it (which may be a whole lyric sheet, are
// kept elsewhere and are attached again when the song is played) and the mark of the bytes
// that were playing.
const catalogued = ({ onlineLyricsState: _lyrics, playbackSourceRevision: _revision, ...song }: SongResult): SongResult => song;

/** Forgets what was read from storage, so that the next call reads it again, and what was set right this run. */
export const resetRecentPlays = (): void => {
    kept = null;
    setRightTo.clear();
};

/** Calls `watcher` whenever a play changes the list of an account. */
export const watchRecentPlays = (watcher: () => void): (() => void) => {
    watchers.add(watcher);
    return () => { watchers.delete(watcher); };
};

/**
 * The songs played from this platform under this account in the last seven days, newest first.
 * The same list until a play changes it or its oldest song has become too old.
 */
export const recentPlaysOf = (providerId: OnlineProviderId, accountId: string): SongResult[] => {
    const now = Date.now();
    const plays = keptOf(scopeOf(providerId, accountId), now);
    if (!plays) return NONE;
    const recent = plays.filter(play => isRecent(play, now));
    const known = listed.get(plays);
    if (known?.recentCount === recent.length) return known.recent;
    listed.set(plays, { ...known, recentCount: recent.length, recent: recent.map(play => play.song) });
    return listed.get(plays)!.recent;
};

/**
 * The songs listened to more than once in the last thirty days from this platform under this
 * account, of those that are kept: the one whose listenings weigh most first (see `weightOf`),
 * and of two that weigh the same the one played later. The same list until a play changes it, a
 * song of it is no longer kept, or the day is another.
 */
export const replayedSongsOf = (providerId: OnlineProviderId, accountId: string): SongResult[] => {
    const now = Date.now();
    const plays = keptOf(scopeOf(providerId, accountId), now);
    if (!plays) return NONE;
    const known = listed.get(plays) ?? { recentCount: -1, recent: NONE };
    const today = dayOf(now);
    if (!known.replayed || known.replayedOn !== today) {
        known.replayedOn = today;
        known.replayed = plays.map(play => ({ play, days: countedOn(play.days, today) }))
            .filter(({ days }) => listeningsIn(days) > 1)
            .map(({ play, days }) => ({ play, weight: weightOf(days, today) }))
            .sort((one, other) => other.weight - one.weight || other.play.at - one.play.at)
            .slice(0, MAX_REPLAYED_SONGS).map(({ play }) => play.song);
        listed.set(plays, known);
    }
    return known.replayed;
};

// The songs set right this run (see `showRecordedSongsAs`), by the key of what was recorded: one
// still playing goes on being recorded as the song it was set right to, with that song's play.
const setRightTo = new Map<string, SongResult>();

// Records that `song` is playing under this account of its platform, and a listening of it
// where one is handed in: one that may be the last one going on (see `goesOn`), or, having gone
// straight on, one more whatever the clock says. A song of no online platform is not recorded.
const note = (song: SongResult, accountId: string, listening?: { lengthMs: number; wentStraightOn: boolean }): void => {
    const source = getPlaybackSourceRef(song);
    if (source.kind !== 'online') return;
    const scope = scopeOf(source.providerId, accountId);
    const shown = setRightTo.get(getPlaybackSongKey(song)) ?? song;
    const songKey = getPlaybackSongKey(shown);
    const now = Date.now();
    const before = recall()[scope] ?? [];
    const kept = before.filter(other => isKept(other, now));
    const again = kept.find(other => getPlaybackSongKey(other.song) === songKey);
    const isCounted = listening !== undefined
        && (listening.wentStraightOn || !(again !== undefined && goesOn(again, now, listening.lengthMs)));
    if (!isCounted && again !== undefined && again === before[0] && isRecent(again, now) && kept.length === before.length) {
        // The newest already and played lately, no listening to count, and nothing has become too old: the lists are the ones they were and nobody is told; only its time is new.
        again.at = now;
        store(recall());
        return;
    }
    const played: Play = {
        song: catalogued(shown),
        at: now,
        heardAt: isCounted ? now : again?.heardAt ?? 0,
        days: isCounted ? withListening(again?.days ?? [], dayOf(now)) : again?.days ?? [],
        ...(again?.checked ? { checked: true } : {}),
    };
    recall()[scope] = [played, ...kept.filter(other => other !== again)].slice(0, MAX_RECENT_PLAYS);
    store(recall());
    for (const watcher of watchers) watcher();
};

// One play of two that are of one song: where and as which song the first stands, the later of
// their times, the listenings of both, and checked where either was.
const together = (first: Play, other: Play): Play => {
    const days = new Map<number, number>();
    for (const [day, count] of [...first.days, ...other.days]) days.set(day, (days.get(day) ?? 0) + count);
    return {
        song: first.song,
        at: Math.max(first.at, other.at),
        heardAt: Math.max(first.heardAt, other.heardAt),
        days: [...days].sort(([one], [two]) => two - one),
        ...(first.checked || other.checked ? { checked: true } : {}),
    };
};

// How many times this run a record was set right (see `showRecordedSongsAs`).
let setRightTimes = 0;
/** How many times this run a record of the songs played was set right: what was read of it before then is no longer so. */
export const recordSetRightTimes = (): number => setRightTimes;

/**
 * Asks the platform which song it shows each song played under this account as, of those it was
 * not asked about yet (`shownAs`, by id: another song, or null for the song itself; one it could
 * not answer about is left out, and asked about the next time), and puts that song in its place:
 * a music video recorded as played, before the platform showed videos as their songs, or from a
 * list that names the video with its song's album and length. Its plays and listenings go to that
 * song, and to that song's own play where it has one. Resolves to how many plays were set right.
 */
export const showRecordedSongsAs = async (
    providerId: OnlineProviderId,
    accountId: string,
    shownAs: (songs: SongResult[]) => Promise<Map<string, SongResult | null>>,
): Promise<number> => {
    const scope = scopeOf(providerId, accountId);
    const unasked = keptOf(scope, Date.now())?.filter(play => !play.checked) ?? [];
    if (unasked.length === 0) return 0;
    const answers = await shownAs(unasked.map(play => play.song));
    if (answers.size === 0) return 0;
    // (Read again: songs may have been played meanwhile.)
    const plays: Play[] = [];
    let changed = 0;
    for (const play of recall()[scope] ?? []) {
        const id = String(play.song.id);
        const version = answers.get(id);
        if (version) {
            changed += 1;
            setRightTo.set(getPlaybackSongKey(play.song), version);
        }
        const shown: Play = answers.has(id) ? { ...play, ...(version ? { song: catalogued(version) } : {}), checked: true } : play;
        const key = getPlaybackSongKey(shown.song);
        const at = plays.findIndex(other => getPlaybackSongKey(other.song) === key);
        // (The plays are newest first: the one already in place is the later.)
        if (at < 0) plays.push(shown);
        else plays[at] = together(plays[at], shown);
    }
    recall()[scope] = plays;
    store(recall());
    if (changed === 0) return 0;
    setRightTimes += 1;
    for (const watcher of watchers) watcher();
    return changed;
};

/**
 * Records that `song` was played under this account of its platform: it is the newest of the
 * songs played. No listening of it is counted by that.
 */
export const noteSongPlayed = (song: SongResult, accountId: string): void => note(song, accountId);

/**
 * Records a listening of `song` under this account of its platform. `lengthMs` is how long the
 * song lasts, as the listening was measured by. `wentStraightOn`: the song was followed without
 * a break since its last listening and has sounded for its whole length again (it is on repeat,
 * or was taken back), so this is one more, whatever the clock says. Otherwise it is counted
 * unless the last listening counted may still be going on (see `goesOn`).
 */
export const noteSongListened = (song: SongResult, accountId: string, lengthMs: number, wentStraightOn: boolean): void => (
    note(song, accountId, { lengthMs, wentStraightOn })
);
