import { runStemPass, type StemReader } from './stemPass';
import { stemSegmentStarts } from './stemRange';
import { decodeAtRate } from './trackAudio';
import { decodeTrackAtRate } from './trackBytes';

// src/services/analysis/trackStemRun.ts
// A track's stem run: its bytes decoded once and one stem pass (stemPass.ts) over them, for every
// task that reads its stems - the drum hits (drumHits.ts) and 雾笺's voice (vocalStemRun.ts) today.
// What it reads and keeps is the task's own; the run only owns the track, the pass and when they stop.
//
// A task (StemTask) is opened once the track is decoded and gives its readers, then its answer: from
// `finish` once all its readers are through, from `stop` when the run stops first (the track was left,
// or a segment could not be separated) - where it keeps what it needs to carry on later. A task asked
// for while its track runs is opened on the decode the run already has and joins the pass at its next
// segment - not a second decode, nor a second pass; one let go (`releaseTrackStems`) is stopped there
// and the rest carry on. The same kind asked for twice is the one task.
//
// Only the wanted track runs (`setWantedStemTrack`): any other stops at its next segment, so skipping
// through tracks does not queue their separations up.

const STEM_RATE = 44100;

export interface StemTrack { key: string; left: Float32Array; right: Float32Array }

/** A task opened on a decoded track: its readers on the pass, and how it answers. */
export interface OpenedStemTask<T> {
    readers: StemReader[];
    /** All its readers are through: its answer. */
    finish: () => Promise<T>;
    /** The run stopped (or it was let go) first: it keeps what carries it on; its answer. */
    stop: () => Promise<T>;
}

export interface StemTask<T> {
    /** What it reads, for joining (one task per kind per track) and the log. */
    kind: string;
    open: (track: StemTrack) => OpenedStemTask<T>;
}

interface TaskEntry {
    task: StemTask<unknown>;
    opened: OpenedStemTask<unknown> | null;
    state: 'waiting' | 'reading' | 'answering';
    answer: Promise<unknown>;
    settle: (value: unknown) => void;
}

interface TrackRun {
    key: string;
    entries: TaskEntry[];
    /** Answers still being worked out (a finish or a stop). */
    pending: Promise<void>[];
}

const runs = new Map<string, TrackRun>();
let wanted: string | null = null;

/** Names the track whose stems may be separated now, or null for none; any other run stops at its next segment. */
export const setWantedStemTrack = (key: string | null): void => {
    wanted = key;
};

/** Whether `key` is the track whose stems may be separated now. */
export const stemTrackWanted = (key: string): boolean => wanted === key;

/** Answers a task from `how` (its finish or its stop); a task that throws answers null. */
const answer = (run: TrackRun, entry: TaskEntry, how: () => Promise<unknown>) => {
    entry.state = 'answering';
    run.pending.push(how()
        .catch((error) => {
            console.warn(`[StemRun] ${run.key}: ${entry.task.kind} failed`, error);
            return null;
        })
        .then(entry.settle));
};

/** Opens the tasks asked for since the last turn on the decoded `track`. */
const openWaiting = (run: TrackRun, track: StemTrack) => {
    for (const entry of run.entries) {
        if (entry.state !== 'waiting') continue;
        try {
            entry.opened = entry.task.open(track);
            entry.state = 'reading';
        } catch (error) {
            console.warn(`[StemRun] ${run.key}: ${entry.task.kind} could not start`, error);
            entry.state = 'answering';
            entry.settle(null);
        }
    }
};

/** The readers of the tasks still reading; a task whose readers are all through answers from its finish. */
const readersNow = (run: TrackRun, track: StemTrack, count: number): StemReader[] => {
    openWaiting(run, track);
    for (const entry of run.entries) {
        if (entry.state === 'reading' && entry.opened!.readers.every(reader => reader.next >= count)) answer(run, entry, entry.opened!.finish);
    }
    return run.entries.flatMap(entry => (entry.state === 'reading' ? entry.opened!.readers : []));
};

/** Decodes the track and runs its pass until every task has answered (see the header). */
const drive = async (run: TrackRun, readBytes: () => Promise<ArrayBuffer | null>) => {
    const bytes = await readBytes().catch(() => null);
    const buffer = bytes ? await decodeTrackAtRate(run.key, STEM_RATE, bytes, decodeAtRate, 'stems', 'own') : null;
    if (!buffer) {
        runs.delete(run.key);
        for (const entry of run.entries) if (entry.state === 'waiting') entry.settle(null);
        return;
    }
    const left = buffer.getChannelData(0);
    const track: StemTrack = { key: run.key, left, right: buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left };
    const count = stemSegmentStarts(left.length).length;
    const done = await runStemPass({
        left: track.left,
        right: track.right,
        key: run.key,
        readers: () => readersNow(run, track, count),
        keepGoing: () => wanted === run.key,
    });
    // Anything asked for after this answers from a run of its own.
    runs.delete(run.key);
    if (done) readersNow(run, track, count);
    for (const entry of run.entries) {
        if (entry.state === 'reading') answer(run, entry, entry.opened!.stop);
        else if (entry.state === 'waiting') entry.settle(null);
    }
    await Promise.all(run.pending);
};

/**
 * Reads `key`'s stems for `task`: opened on the track's run, joining one in flight (see the header).
 * Null when the bytes cannot be read or decoded, or the task failed; otherwise the task's answer.
 */
export const runTrackStems = <T>(key: string, readBytes: () => Promise<ArrayBuffer | null>, task: StemTask<T>): Promise<T | null> => {
    const existing = runs.get(key);
    const same = existing?.entries.find(entry => entry.task.kind === task.kind && entry.state !== 'answering');
    if (same) return same.answer as Promise<T | null>;
    let settle: (value: unknown) => void = () => undefined;
    const entry: TaskEntry = { task: task as StemTask<unknown>, opened: null, state: 'waiting', answer: new Promise((resolve) => { settle = resolve; }), settle: value => settle(value) };
    if (existing) {
        existing.entries.push(entry);
        return entry.answer as Promise<T | null>;
    }
    const run: TrackRun = { key, entries: [entry], pending: [] };
    runs.set(key, run);
    void drive(run, readBytes).catch((error) => {
        console.warn(`[StemRun] ${key}: failed`, error);
        runs.delete(key);
        for (const each of run.entries) each.settle(null);
    });
    return entry.answer as Promise<T | null>;
};

/** Lets `kind`'s task on `key` go: stopped at the pass' next segment (it keeps where it was), the rest carry on. */
export const releaseTrackStems = (key: string, kind: string): void => {
    const run = runs.get(key);
    const entry = run?.entries.find(each => each.task.kind === kind && each.state !== 'answering');
    if (!run || !entry) return;
    if (entry.state === 'waiting') {
        entry.state = 'answering';
        entry.settle(null);
        return;
    }
    answer(run, entry, entry.opened!.stop);
};
