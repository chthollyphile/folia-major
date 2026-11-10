import { create } from 'zustand';
import type { FoliumEntryKind } from './FoliumMountHost';

// src/mods/runtime/status.ts
// What went wrong in each mod's code in this window, and who is told.
//
// The record. Per mod and per place (what the host was calling, e.g.
// "visualizer aurora:text onFrame"): how many times it failed there, the first
// and the last time, and the last message. Places are what the host calls, so
// they are few and the record does not grow with the number of failures. It
// lives outside the store: a failure costs a counter, and the store (which
// the mod's row in Settings draws from) is written at most once a second per
// mod, so a listener that throws on every frame renders nothing per frame.
//
// The notice. A failure is either an ordinary result (a command that failed,
// a hook that timed out, the mod's own log.error) or a fault of the mod's code
// (mount, drawing, listeners, the helpers, activate, disposers). Only a fault
// is announced, once per mod per run of the app, and not at all for a mod the
// user asked not to be told about. Folia switches nothing off either way.
// A mod that runs past its start limit is told about the same way, in its own
// words and once: it is slow, not failed, so it leaves no row here.

// One write of the store per mod in this long.
const FLUSH_INTERVAL_MS = 1000;
// One line in the console per place in this long.
const LOG_INTERVAL_MS = 1000;
// A mod that makes up a new entry id on every failure ends up in one shared row past this.
const MAX_PLACES_PER_MOD = 50;
const OTHER_PLACES = 'other places';
const MAX_MESSAGE_LENGTH = 500;
const MUTED_STORAGE_KEY = 'folia_folium_fault_notice_muted_v1';

/** Which piece of a mod failed, for the words of the notice: a kind of entry, or the mod's start. */
export type FoliumFaultPiece = FoliumEntryKind | 'start';

/** One place where a mod's code failed. */
export interface FoliumIssue {
    /** What the host was calling, e.g. "visualizer aurora:text onFrame". */
    where: string;
    /** The message of the last failure there. */
    message: string;
    /** How many times it failed there. */
    count: number;
    /** The first time, epoch milliseconds. */
    firstAt: number;
    /** The last time, epoch milliseconds. */
    lastAt: number;
    /** The piece the place belongs to, when the failure is a fault of the mod's code. */
    piece?: FoliumFaultPiece;
}

interface FoliumStatusState {
    /** Per mod, its failures by place, as of the last write (at most one a second per mod). */
    issues: Record<string, FoliumIssue[]>;
    /** The mods the user asked not to be told about. */
    mutedNotices: readonly string[];
    clear: (modId: string) => void;
}

const readMuted = (): string[] => {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(MUTED_STORAGE_KEY) ?? '[]');
        return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [];
    } catch {
        return [];
    }
};

export const useFoliumStatusStore = create<FoliumStatusState>((set) => ({
    issues: {},
    mutedNotices: readMuted(),
    clear: (modId) => {
        forget(modId);
        set((state) => {
            if (!(modId in state.issues)) return state;
            const issues = { ...state.issues };
            delete issues[modId];
            return { issues };
        });
    },
}));

// A mod may throw anything, and reading it may throw again (a `message` getter, a proxy).
const describeError = (error: unknown): string => {
    let text: unknown;
    try {
        if (error instanceof Error) {
            text = error.message || error.name;
        } else if (typeof error === 'string') {
            text = error;
        } else {
            text = JSON.stringify(error);
        }
        if (typeof text !== 'string') text = String(error);
    } catch {
        try {
            text = String(error);
        } catch {
            text = 'an error that cannot be printed';
        }
    }
    return (text as string).slice(0, MAX_MESSAGE_LENGTH);
};

interface LiveIssue {
    where: string;
    count: number;
    firstAt: number;
    lastAt: number;
    /** Kept as it was thrown; turned into text only when the row or the console needs it. */
    lastError: unknown;
    /**
     * `lastError` as text, once it was needed; null until then and after another value was thrown.
     * Reading a thrown value can run the mod's code (toJSON, a getter), so it is read once.
     */
    message: string | null;
    piece: FoliumFaultPiece | undefined;
    loggedAt: number;
}

interface ModRecord {
    places: Map<string, LiveIssue>;
    writtenAt: number;
    timer: ReturnType<typeof setTimeout> | null;
}

const records = new Map<string, ModRecord>();

const messageOf = (live: LiveIssue): string => (live.message ??= describeError(live.lastError));

const toIssue = (live: LiveIssue): FoliumIssue => ({
    where: live.where,
    message: messageOf(live),
    count: live.count,
    firstAt: live.firstAt,
    lastAt: live.lastAt,
    ...(live.piece ? { piece: live.piece } : {}),
});

/** A mod's failures by place as they are now, not as of the last store write. */
export const getFoliumIssues = (modId: string): FoliumIssue[] => {
    const record = records.get(modId);
    return record ? Array.from(record.places.values(), toIssue) : [];
};

const write = (modId: string, record: ModRecord) => {
    record.writtenAt = Date.now();
    const issues = Array.from(record.places.values(), toIssue);
    useFoliumStatusStore.setState((state) => ({ issues: { ...state.issues, [modId]: issues } }));
};

const forget = (modId: string) => {
    const record = records.get(modId);
    if (record?.timer != null) clearTimeout(record.timer);
    records.delete(modId);
};

const log = (modId: string, live: LiveIssue) => {
    const line = `[Folium:${modId}] ${live.where}: ${messageOf(live)}${live.count > 1 ? ` (${live.count} times)` : ''}`;
    try {
        console.warn(line, live.lastError);
    } catch {
        // Printing the thrown value itself can throw; the line alone still says what happened.
        console.warn(line);
    }
};

/*
 * Counts one failure. This runs on every failure, which for a listener that
 * throws on every frame is every frame: one clock read, two lookups, a few
 * assignments, nothing allocated once the place is known. The console gets a
 * line and the store a write at most once a second each.
 */
const record = (modId: string, where: string, error: unknown, piece: FoliumFaultPiece | undefined) => {
    const now = Date.now();
    let mod = records.get(modId);
    if (!mod) {
        mod = { places: new Map(), writtenAt: -Infinity, timer: null };
        records.set(modId, mod);
    }
    let live = mod.places.get(where);
    if (!live) {
        const place = mod.places.size < MAX_PLACES_PER_MOD ? where : OTHER_PLACES;
        live = mod.places.get(place);
        if (!live) {
            live = { where: place, count: 0, firstAt: now, lastAt: now, lastError: error, message: null, piece, loggedAt: -Infinity };
            mod.places.set(place, live);
        }
    }
    live.count += 1;
    live.lastAt = now;
    if (error !== live.lastError) {
        live.lastError = error;
        live.message = null;
    }
    if (now - live.loggedAt >= LOG_INTERVAL_MS) {
        live.loggedAt = now;
        log(modId, live);
    }
    if (mod.timer !== null) return;
    const wait = mod.writtenAt + FLUSH_INTERVAL_MS - now;
    if (wait <= 0) {
        write(modId, mod);
        return;
    }
    const pending = mod;
    mod.timer = setTimeout(() => {
        pending.timer = null;
        // Cleared in the meantime (the mod was activated again): nothing of it is left to write.
        if (records.get(modId) === pending) write(modId, pending);
    }, wait);
};

/**
 * Records a failure that is an ordinary result: a command that failed, a hook that timed out, a
 * registration the host turned down, the mod's own `log.error`. It shows on the mod's row; no
 * notice.
 */
export const reportFoliumIssue = (modId: string, where: string, error: unknown) => {
    record(modId, where, error, undefined);
};

export const clearFoliumIssues = (modId: string) => useFoliumStatusStore.getState().clear(modId);

// ---- the notice

/**
 * What a notice is about: the piece of a mod that failed, or 'slow-start' for a mod that has not
 * finished starting within its limit. That one is slowness, not a failure.
 */
export type FoliumNoticeKind = FoliumFaultPiece | 'slow-start';

type FoliumFaultNotifier = (modId: string, kind: FoliumNoticeKind | undefined) => void;

let notifier: FoliumFaultNotifier | null = null;
// Mods already announced in this run of the app. A mod that is reloaded and fails again was already
// named, so a reload takes none out; only switching its notice back on does (setFoliumFaultNoticeMuted).
const announced = new Set<string>();
// Mods already said to be slow to start in this run. Apart from `announced`: a mod that was slow
// to start and then fails is still named for the failure.
const announcedSlowStart = new Set<string>();
const muted = new Set(useFoliumStatusStore.getState().mutedNotices);

/** Who shows the notice (faultNotice.ts, main window only). Without one, faults are only recorded. */
export const setFoliumFaultNotifier = (next: FoliumFaultNotifier | null) => {
    notifier = next;
};

export const isFoliumFaultNoticeMuted = (modId: string) => muted.has(modId);

/** "Do not tell me again" for one mod, and back. Stored; the record goes on either way. */
export const setFoliumFaultNoticeMuted = (modId: string, mute: boolean) => {
    if (mute === muted.has(modId)) return;
    if (mute) {
        muted.add(modId);
    } else {
        muted.delete(modId);
        // Asked to be told again: the next fault is announced, also when one already was in this run.
        announced.delete(modId);
        announcedSlowStart.delete(modId);
    }
    const mutedNotices = Array.from(muted);
    useFoliumStatusStore.setState({ mutedNotices });
    try {
        localStorage.setItem(MUTED_STORAGE_KEY, JSON.stringify(mutedNotices));
    } catch {
        // Quota or private mode: the choice holds for this run.
    }
};

/**
 * Records a fault of a mod's code (a mount, a listener, a helper, activate, a disposer that
 * threw or rejected) and has the user told, once per mod per run, unless they asked not to be.
 * `piece` says which kind of piece failed, for the words of the notice.
 */
export const reportFoliumFault = (modId: string, where: string, error: unknown, piece?: FoliumFaultPiece) => {
    record(modId, where, error, piece);
    if (announced.has(modId) || notifier === null || muted.has(modId)) return;
    announced.add(modId);
    notifier(modId, piece);
};

/**
 * Has the user told, once per mod per run, that a mod has not finished starting within its start
 * limit, unless they asked not to be told about that mod. The mod is slow, it has not failed:
 * nothing is recorded, and it goes on starting.
 */
export const announceFoliumSlowStart = (modId: string) => {
    if (announcedSlowStart.has(modId) || notifier === null || muted.has(modId)) return;
    announcedSlowStart.add(modId);
    notifier(modId, 'slow-start');
};
