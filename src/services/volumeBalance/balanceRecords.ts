import type { SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { getTrackProfile, onProgramMeasured, readStoredTrackProfile } from '../automix/profileService';
import { programIsWholeTrack, TRACK_PROFILE_VERSION } from '../automix/trackProfile';
import { getFromCache, saveToCache } from '../db';
import { getPlaybackAnalysisKey } from '../playbackRecovery/representationRegistry';
import { whyNotTheSongPlayed } from '../wholeSongCheck';
import { isAudible, TYPICAL_SIZE, VOLUME_BALANCE_TARGET_DB, whyNotWholePlay, type MeasuredLoudness, type MeteredPlay } from './balanceRules';

// src/services/volumeBalance/balanceRecords.ts
// What the volume balance knows of each song, in records of its own (cache keys volume_balance_*, their own
// 智能平衡数据 category on the storage page): the file's measured loudness, the loudness learned from a whole play, and the gains
// of the last whole readings for the typical guess. Read straight from the cache when a song starts or
// prefetch names it, never behind the analysis queue. Nothing here writes into an automix profile.

export const VOLUME_BALANCE_KEY_PREFIX = 'volume_balance_';
const TYPICAL_KEY = `${VOLUME_BALANCE_KEY_PREFIX}typical`;
const recordKey = (analysisKey: string) => `${VOLUME_BALANCE_KEY_PREFIX}${analysisKey}`;
/** As many as automix keeps profiles in memory; each is a few dozen bytes. */
const MAX_RECORDS = 200;

export interface BalanceRecord {
    /** The file decoded and measured whole. */
    file?: MeasuredLoudness;
    /** Learned from a whole play. */
    played?: MeasuredLoudness;
}

/** By analysis key; null when the cache was read and holds nothing. */
const records = new Map<string, BalanceRecord | null>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
/** When each song last started, by playback key, for the timing line. */
const songStarts = new Map<string, number>();
let typical: Array<{ key: string; gainDb: number }> = [];
let typicalLoad: Promise<void> | null = null;
/** Moved on by each clear: a read begun before it writes nothing after it. */
let generation = 0;

const capped = <T>(map: Map<string, T>, key: string, value: T) => {
    map.delete(key);
    map.set(key, value);
    while (map.size > MAX_RECORDS) {
        const oldest = map.keys().next().value;
        if (oldest === undefined) break;
        map.delete(oldest);
    }
};

/** Told each time a song's record is read back or gains a reading. */
export const onBalanceRecord = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const getBalanceRecord = (song: SongResult): BalanceRecord | null => records.get(getPlaybackAnalysisKey(song)) ?? null;

const loadTypical = () => {
    const at = generation;
    typicalLoad ??= getFromCache<Array<{ key: string; gainDb: number }>>(TYPICAL_KEY).then((stored) => {
        if (at !== generation || !Array.isArray(stored)) return;
        const noted = new Set(typical.map(entry => entry.key));
        typical = [...stored.filter(entry => !noted.has(entry.key)), ...typical].slice(-TYPICAL_SIZE);
    });
    return typicalLoad;
};

/** The gains of the last whole-track readings, oldest first. */
export const typicalGains = (): number[] => typical.map(entry => entry.gainDb);

/** Counts a whole-track reading's gain (target minus loudness) into the typical guess, once per song. */
export const noteWholeReading = (analysisKey: string, gainDb: number): void => {
    if (typical.some(entry => entry.key === analysisKey && Math.abs(entry.gainDb - gainDb) < 0.01)) return;
    typical = [...typical.filter(entry => entry.key !== analysisKey), { key: analysisKey, gainDb }].slice(-TYPICAL_SIZE);
    const at = generation;
    void loadTypical().then(() => (at === generation ? saveToCache(TYPICAL_KEY, typical) : undefined));
};

const remember = (analysisKey: string, record: BalanceRecord | null) => {
    capped(records, analysisKey, record);
    if (record) listeners.forEach(listener => listener());
};

const readRecord = async (analysisKey: string): Promise<BalanceRecord | null> => {
    if (records.has(analysisKey)) return records.get(analysisKey) ?? null;
    const stored = await getFromCache<BalanceRecord>(recordKey(analysisKey));
    return stored && (stored.file || stored.played) ? stored : null;
};

const publish = async (analysisKey: string, kind: keyof BalanceRecord, measured: MeasuredLoudness) => {
    if (!isAudible(measured)) {
        console.log(`[VolumeBalance] no ${kind} reading kept for ${analysisKey}: silence`);
        return;
    }
    const at = generation;
    const record = { ...(await readRecord(analysisKey)), ...records.get(analysisKey), [kind]: measured };
    if (at !== generation) return;
    remember(analysisKey, record);
    noteWholeReading(analysisKey, VOLUME_BALANCE_TARGET_DB - measured.loudness);
    await saveToCache(recordKey(analysisKey), record);
};

/**
 * Reads a song's record from the cache, once. A song measured before the balance kept records has its
 * whole-track automix profile's reading taken over as the file's, in memory only: it can be read from the
 * profile again, so it is not saved, and it counts into the typical guess when the song plays, not when
 * prefetch names it. A load that a clear overtook keeps nothing.
 */
export const loadBalanceRecord = (song: SongResult): Promise<void> => {
    void loadTypical();
    const analysisKey = getPlaybackAnalysisKey(song);
    if (records.has(analysisKey)) return Promise.resolve();
    const running = loading.get(analysisKey);
    if (running) return running;
    const at = generation;
    const load: Promise<void> = (async () => {
        const stored = await readRecord(analysisKey);
        if (at !== generation || records.has(analysisKey)) return;
        if (stored) return remember(analysisKey, stored);
        const profile = await readStoredTrackProfile(analysisKey);
        // A reading published while the profile was read is newer than the profile's.
        if (at !== generation || records.has(analysisKey)) return;
        const file = programIsWholeTrack(profile) && profile.version === TRACK_PROFILE_VERSION
            && typeof profile.programLoudness === 'number' && !whyNotTheSongPlayed(song, null, profile.duration)
            ? { loudness: profile.programLoudness, peak: profile.peak ?? null }
            : null;
        remember(analysisKey, file && isAudible(file) ? { file } : null);
    })().catch((error) => {
        console.warn('[VolumeBalance] reading a stored record failed', error);
    }).finally(() => {
        if (loading.get(analysisKey) === load) loading.delete(analysisKey);
    });
    loading.set(analysisKey, load);
    return load;
};

/**
 * Forgets the records and the typical list held in memory, and drops the reads still under way, so nothing
 * is written back. Called before their storage is cleared, so a write already sent lands before the clear.
 */
export const clearBalanceRuntime = (): void => {
    generation += 1;
    records.clear();
    loading.clear();
    typical = [];
    typicalLoad = null;
};

/** Notes that a song started now, for the timing line. */
export const noteSongStarted = (song: SongResult): void => {
    capped(songStarts, getPlaybackSongKey(song), performance.now());
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

onProgramMeasured((measured) => {
    void publish(measured.key, 'file', { loudness: measured.loudness, peak: measured.peak });
    const started = songStarts.get(getPlaybackSongKey(measured.song));
    const zero = started ?? measured.queuedAt;
    void measured.profiled.then((profiledAt) => console.log(
        `[VolumeBalance] loudness of "${measured.song.name}" arrived ${seconds(measured.measuredAt - zero)}`
        + ` after ${started === undefined ? 'it was queued' : 'the song started'}:`
        + ` waiting in the queue ${seconds(measured.startedAt - measured.queuedAt)},`
        + ` reading bytes ${seconds(measured.bytesAt - measured.startedAt)},`
        + ` decoding ${seconds(measured.decodedAt - measured.bytesAt)},`
        + ` measuring ${seconds(measured.measuredAt - measured.decodedAt)};`
        + ` full profile ${profiledAt === null ? 'failed' : `at ${seconds(profiledAt - zero)}`}`,
    ));
});

const peakDb = (peak: number) => (peak > 0 ? `${(20 * Math.log10(peak)).toFixed(1)} dBFS` : 'silent');

/** Keeps what a deck heard as the song's learned reading, if it heard the song whole. */
export const learnPlayedSong = (song: SongResult, play: MeteredPlay | null, element: HTMLAudioElement): void => {
    if (!play) return;
    const duration = element.duration;
    const whyNot = whyNotWholePlay(play, {
        duration,
        leadInSec: getTrackProfile(song)?.leadIn,
        clip: whyNotTheSongPlayed(song, element.currentSrc || null, duration),
    });
    if (whyNot) {
        console.log(
            `[VolumeBalance] not learned "${song.name}": ${whyNot}, heard ${play.heardSec.toFixed(1)}s`
            + ` from ${play.fromSec.toFixed(1)}s to ${play.toSec.toFixed(1)}s of ${Number.isFinite(duration) ? duration.toFixed(1) : '?'}s`,
        );
        return;
    }
    const analysisKey = getPlaybackAnalysisKey(song);
    const file = records.get(analysisKey)?.file;
    console.log(
        `[VolumeBalance] learned "${song.name}": ${play.loudness.toFixed(1)} LUFS, peak ${peakDb(play.peak)}`
        + `${file ? `, ${(play.loudness - file.loudness).toFixed(1)} dB from the file analysis` : ''}`,
    );
    void publish(analysisKey, 'played', { loudness: play.loudness, peak: play.peak });
};
