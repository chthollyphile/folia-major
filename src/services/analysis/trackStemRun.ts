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
// Who wants a track separated is said per claimant (`claimStemTrack`): 智能动感模式 for its drum hits
// and 雾笺's voice, and each other feature that reads stems on its own. A claimant wants one track at a
// time, or none. A run goes on while any claimant wants its track and stops at its next segment once
// none does, so skipping through tracks does not queue their separations up. A task belongs to one
// claimant (`StemTask.claimant`): when its claimant moves off the track while another still wants it,
// the task is let go there (as `releaseTrackStems` does) and the run carries on for the rest.
// Until 2026-11 there was one wanted track for everyone, set by the drum hits alone, so nothing else
// could keep a run going, and clearing it stopped every task on it.

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

/** Who asks for a track's stems (see the header): 智能动感模式, and 分轨调音台 playing them. */
export type StemClaimant = 'beatFx' | 'stemMixer';

export interface StemTask<T> {
    /** What it reads, for joining (one task per kind per track) and the log. */
    kind: string;
    /** Whose it is: let go when this claimant no longer wants the track (see the header). */
    claimant: StemClaimant;
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
    /** The track's segment count, once decoded. */
    count: number | null;
}

const runs = new Map<string, TrackRun>();

/** Whether a run on `key` is going now: a task asked for now joins it and reads through its bytes, not its own. */
export const stemRunGoing = (key: string): boolean => runs.has(key);
/** The track each claimant wants separated now. */
const claims = new Map<StemClaimant, string>();

/** Whether `key` is wanted now: by `claimant`, or with none named by anyone. */
export const stemTrackWanted = (key: string, claimant?: StemClaimant): boolean => (
    claimant ? claims.get(claimant) === key : [...claims.values()].includes(key)
);

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

/** Whether every reader of a reading task is through: it answers from its finish at the pass' next turn. */
const through = (run: TrackRun, entry: TaskEntry) => (
    entry.state === 'reading' && run.count !== null && (entry.opened?.readers.every(reader => reader.next >= (run.count ?? Infinity)) ?? false)
);

/**
 * Stops one task now: a waiting one answers null, a reading one from its stop; the pass feeds it no
 * more (`stillFed`). One already through is left to answer from its finish: its work is whole.
 */
const letGo = (run: TrackRun, entry: TaskEntry) => {
    if (entry.state === 'waiting') {
        entry.state = 'answering';
        entry.settle(null);
        return;
    }
    if (entry.state === 'reading' && entry.opened && !through(run, entry)) answer(run, entry, entry.opened.stop);
};

/**
 * Names the track `claimant` wants separated now, or null for none. The track it wanted before stops
 * at its next segment if no one else wants it; if someone does, the run carries on and only this
 * claimant's tasks on it are let go.
 */
export const claimStemTrack = (claimant: StemClaimant, key: string | null): void => {
    const before = claims.get(claimant);
    if (key === null) claims.delete(claimant);
    else claims.set(claimant, key);
    if (before === undefined || before === key || !stemTrackWanted(before)) return;
    const run = runs.get(before);
    for (const entry of run?.entries ?? []) {
        if (run && entry.task.claimant === claimant) letGo(run, entry);
    }
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

/**
 * The readers of the tasks still reading; a task whose readers are all through answers from its finish.
 * While the run goes on, a task whose claimant no longer wants the track is let go here - however the
 * claims moved (its claimant left first and another came to the track later, say).
 */
const readersNow = (run: TrackRun, track: StemTrack, count: number): StemReader[] => {
    openWaiting(run, track);
    for (const entry of run.entries) {
        if (entry.state === 'reading' && entry.opened!.readers.every(reader => reader.next >= count)) answer(run, entry, entry.opened!.finish);
    }
    // Only while someone wants the run: with no one, the pass stops and every task answers from its stop as it always did.
    if (stemTrackWanted(run.key)) {
        for (const entry of run.entries) {
            if (!stemTrackWanted(run.key, entry.task.claimant)) letGo(run, entry);
        }
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
    run.count = count;
    const done = await runStemPass({
        left: track.left,
        right: track.right,
        key: run.key,
        readers: () => readersNow(run, track, count),
        keepGoing: () => stemTrackWanted(run.key),
        stillFed: reader => run.entries.some(entry => entry.state === 'reading' && (entry.opened?.readers.includes(reader) ?? false)),
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
    const run: TrackRun = { key, entries: [entry], pending: [], count: null };
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
    letGo(run, entry);
};
