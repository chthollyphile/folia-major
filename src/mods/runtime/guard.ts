import type { FoliumSettingAccess } from '../folium/contract';
import { reportFoliumFault, type FoliumFaultPiece } from './status';

// src/mods/runtime/guard.ts
// The gate every host-to-mod call in this window goes through, and the
// ownership of what a mod subscribes through an object the host built for it.
//
// Gate. A call into mod code is timed with two clock reads around its
// synchronous part (the part that holds the UI thread), counted per mod, and a
// throw or a rejected promise is caught and reported as a fault of the mod's
// code (status.ts) under the mod id and the place: it goes on the mod's row
// and the user is told once. Where the host already turns a failure into a
// result of its own (a command's card, a music source's rejection, the hook
// time limit) the gate only times and counts, and the failure goes on to that
// handling. `piece` names the kind of piece the call belongs to, for the
// words of that notice.
//
// Ownership. The context a mount receives and the settings values a client
// receives are views. A listener given to a view is wrapped once, so the
// host's notify loops and the app's time signal only ever hold gated wrappers,
// and every subscription made through a view is recorded and removed when its
// owner (that mount, that activation) ends, even when the mod never
// unsubscribed.

/** What the host has seen of one mod's code in this window. The mod's row in Settings reads it. */
export interface FoliumCallStats {
    /** Calls into the mod's code. */
    calls: number;
    /** Synchronous time spent in them, milliseconds. */
    totalMs: number;
    /** The longest single call, milliseconds. */
    longestMs: number;
    /** Calls that threw, or whose promise rejected. */
    failures: number;
    /**
     * The part of `totalMs` spent in what the host calls again and again while the mod's pieces
     * are up (its listeners and the helpers' callbacks), milliseconds.
     */
    listenerMs: number;
    /** In how many different seconds such a call ran. `listenerMs` over this is its cost per second while it runs. */
    listenerSeconds: number;
}

interface Counters extends FoliumCallStats {
    /** The second (of the page's clock) the last listener call fell in. */
    listenerSecond: number;
}

const statsByMod = new Map<string, Counters>();

const statsOf = (modId: string): Counters => {
    let stats = statsByMod.get(modId);
    if (!stats) {
        stats = { calls: 0, totalMs: 0, longestMs: 0, failures: 0, listenerMs: 0, listenerSeconds: 0, listenerSecond: -1 };
        statsByMod.set(modId, stats);
    }
    return stats;
};

const count = (stats: FoliumCallStats, elapsed: number) => {
    stats.calls += 1;
    stats.totalMs += elapsed;
    if (elapsed > stats.longestMs) stats.longestMs = elapsed;
};

/** A copy of one mod's counters; null while the host never called into it. */
export const getFoliumCallStats = (modId: string): FoliumCallStats | null => {
    const stats = statsByMod.get(modId);
    if (!stats) return null;
    const { calls, totalMs, longestMs, failures, listenerMs, listenerSeconds } = stats;
    return { calls, totalMs, longestMs, failures, listenerMs, listenerSeconds };
};

// Reading `then` is itself a read of a mod's object, so it may not throw into the host either.
const isThenable = (value: unknown): value is PromiseLike<unknown> => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return false;
    try {
        return typeof (value as PromiseLike<unknown>).then === 'function';
    } catch {
        return false;
    }
};

/*
 * One call into mod code. `rethrow` leaves the failure to the caller (it is
 * counted, then thrown again, and a rejecting promise is handed back as it is);
 * otherwise the failure is reported and the call yields undefined. `slowMs`
 * logs a synchronous part that ran longer than that.
 */
const run = <T>(
    modId: string,
    where: string,
    call: () => T,
    rethrow: boolean,
    slowMs?: number,
    piece?: FoliumFaultPiece,
): T | undefined => {
    const stats = statsOf(modId);
    let result: T | undefined;
    let failure: unknown;
    let failed = false;
    const started = performance.now();
    try {
        result = call();
    } catch (error) {
        failure = error;
        failed = true;
    }
    const elapsed = performance.now() - started;
    count(stats, elapsed);
    if (slowMs !== undefined && elapsed > slowMs) {
        console.warn(`[Folium:${modId}] ${where} took ${elapsed.toFixed(1)}ms`);
    }
    if (failed) {
        stats.failures += 1;
        if (rethrow) throw failure;
        reportFoliumFault(modId, where, failure, piece);
        return undefined;
    }
    if (isThenable(result)) {
        // Adopted once: a thenable that can be consumed only once is asked for its then() a
        // single time, and the caller awaits the adopted promise (a native promise is itself).
        const followed = Promise.resolve(result);
        followed.then(undefined, (error) => {
            stats.failures += 1;
            if (!rethrow) reportFoliumFault(modId, where, error, piece);
        });
        return followed as unknown as T;
    }
    return result;
};

/**
 * Calls into a mod and keeps a failure away from the host: a throw or a
 * rejected promise is reported against the mod as `where`. Yields undefined
 * when the call threw.
 */
export const callFoliumMod = <T>(
    modId: string,
    where: string,
    call: () => T,
    slowMs?: number,
    piece?: FoliumFaultPiece,
): T | undefined => (
    run(modId, where, call, false, slowMs, piece)
);

/**
 * Calls into a mod where the host already shows the failure itself: the call
 * is timed and counted under the mod, and a throw or a rejection reaches the
 * caller unchanged.
 */
export const timeFoliumMod = <T>(modId: string, where: string, call: () => T): T => (
    run(modId, where, call, true) as T
);

/*
 * Wraps a function a mod hands over to be called again and again (a listener,
 * a predicate). This is the per-frame path: a clock listener runs every frame,
 * so one call costs a try, two clock reads and a few additions, allocates
 * nothing and writes no store. A failure is caught and counted against its place; a listener that
 * throws on every frame costs a counter per frame, and the record (status.ts)
 * writes its store at most once a second.
 */
export const gateFoliumCallback = <Arg, Result>(
    modId: string,
    where: string,
    callback: (arg: Arg) => Result,
    piece?: FoliumFaultPiece,
): ((arg: Arg) => Result | undefined) => {
    const stats = statsOf(modId);
    const fail = (error: unknown) => {
        stats.failures += 1;
        reportFoliumFault(modId, where, error, piece);
    };
    return (arg) => {
        let result: Result | undefined;
        let failure: unknown;
        let failed = false;
        const started = performance.now();
        try {
            result = callback(arg);
        } catch (error) {
            failure = error;
            failed = true;
        }
        const elapsed = performance.now() - started;
        count(stats, elapsed);
        // The cost while running: time, and in how many different seconds it ran. No frame is
        // counted here, because the gate does not know where one ends.
        stats.listenerMs += elapsed;
        const second = Math.floor(started / 1000);
        if (second !== stats.listenerSecond) {
            stats.listenerSecond = second;
            stats.listenerSeconds += 1;
        }
        if (failed) {
            fail(failure);
        } else if (result !== undefined && isThenable(result)) {
            // Adopted once, as in `run`.
            const followed = Promise.resolve(result);
            followed.then(undefined, fail);
            return followed as unknown as Result;
        }
        return result;
    };
};

type AnyListener = (value: any) => unknown;
type Unsubscribe = () => unknown;

const IGNORED: Unsubscribe = () => {};

export interface FoliumGatedChannel {
    /** Subscribes the gated wrapper of `listener` through `attach` and records it. */
    subscribe<Listener extends AnyListener>(listener: Listener, attach: (gated: Listener) => Unsubscribe): Unsubscribe;
    /** Removes everything still subscribed, and refuses what comes later. */
    release(): void;
}

/*
 * One listener-taking member, as one owner sees it. The same listener always
 * maps to the same wrapper, so a host side that keeps listeners by identity (a
 * Set, the time signal) dedups and unsubscribes exactly as it does without the
 * gate. `unique` says the host side is of that kind: one record per listener
 * is then enough, and a mod that subscribes the same function over and over
 * adds nothing. Otherwise (the settings store, a timer) every subscription is
 * its own. Once released, the owner (a mount, an activation) is over and
 * nothing would ever remove a new subscription, so one is refused and named
 * in the console.
 */
export const createFoliumGatedChannel = (
    modId: string,
    where: string,
    unique: boolean,
    piece?: FoliumFaultPiece,
): FoliumGatedChannel => {
    const wrappers = new WeakMap<AnyListener, AnyListener>();
    const live = new Map<unknown, Unsubscribe>();
    let released = false;
    return {
        subscribe: (listener, attach) => {
            if (typeof listener !== 'function') {
                throw new TypeError(`${where}: listener must be a function`);
            }
            if (released) {
                console.warn(`[Folium:${modId}] ${where}: called after it ended, ignored`);
                return IGNORED;
            }
            let gated = wrappers.get(listener);
            if (!gated) {
                gated = gateFoliumCallback(modId, where, listener, piece);
                wrappers.set(listener, gated);
            }
            const off = attach(gated as typeof listener);
            const key: unknown = unique ? gated : off;
            live.set(key, off);
            return () => {
                live.delete(key);
                return off();
            };
        },
        release: () => {
            released = true;
            const offs = Array.from(live.values());
            live.clear();
            offs.forEach((off) => off());
        },
    };
};

/** An object handed to a mod in place of the host's own, and the way to end what was subscribed through it. */
export interface FoliumOwnedView<T> {
    view: T;
    /** Removes every subscription still made through the view. */
    release(): void;
}

/** Settings values as one owner sees them: `onChange` goes through the gate and is recorded. */
export const gateFoliumSettingAccess = (
    access: FoliumSettingAccess,
    modId: string,
    where: string,
    piece?: FoliumFaultPiece,
): FoliumOwnedView<FoliumSettingAccess> => {
    const channel = createFoliumGatedChannel(modId, `${where} settings.onChange`, false, piece);
    return {
        view: Object.freeze({
            ...access,
            onChange: (listener: () => void) => channel.subscribe(listener, access.onChange),
        }),
        release: channel.release,
    };
};

/**
 * A clock as the host builds it: `get` is what the mod reads, `on` the change source the mount view turns
 * into the context's on-time helper.
 */
export interface FoliumHostClock {
    get(): number;
    on(listener: (seconds: number) => void): Unsubscribe;
}

/** Each clock a context can carry, and the helper that calls a listener on its every change (contract.ts). */
export const FOLIUM_CLOCK_HELPERS = Object.freeze({ lyricTime: 'onLyricTime', playbackTime: 'onPlaybackTime' } as const);

/** The members a host context can have that the view turns into listener-taking ones: any of them may be absent. */
interface HostSources {
    subscribe?: (listener: () => void) => Unsubscribe;
    lyricTime?: FoliumHostClock;
    playbackTime?: FoliumHostClock;
    settings?: FoliumSettingAccess;
}

/*
 * The context one mount receives, without the helpers that need no source
 * (helpers.ts adds those): the host context's members, except that
 * `subscribe` becomes `onChange`, a clock keeps only `get` and its `on`
 * becomes the clock's helper (`onLyricTime`, `onPlaybackTime`), and
 * `settings.onChange` goes through the gate, each under this mod and this
 * entry (`where`). `release` is for the unmount, after the mod's own disposer
 * ran. Build it once per mount; it is not a React dependency, so it never
 * remounts anything.
 */
export const createFoliumMountView = <Ctx>(
    ctx: object,
    modId: string,
    where: string,
    piece?: FoliumFaultPiece,
): FoliumOwnedView<Ctx> => {
    // A context is any of the host's shapes; the members the view changes are found by shape.
    const { subscribe, ...source } = ctx as HostSources & Record<string, unknown>;
    const members: Record<string, unknown> = {};
    const releases: Array<() => void> = [];

    if (typeof subscribe === 'function') {
        const channel = createFoliumGatedChannel(modId, `${where} onChange`, true, piece);
        members.onChange = (listener: () => void) => channel.subscribe(listener, subscribe);
        releases.push(channel.release);
    }
    (Object.keys(FOLIUM_CLOCK_HELPERS) as Array<keyof typeof FOLIUM_CLOCK_HELPERS>).forEach((name) => {
        const clock = source[name];
        if (!clock || typeof clock.on !== 'function') return;
        const helper = FOLIUM_CLOCK_HELPERS[name];
        const channel = createFoliumGatedChannel(modId, `${where} ${helper}`, true, piece);
        members[name] = Object.freeze({ get: () => clock.get() });
        members[helper] = (listener: (seconds: number) => void) => channel.subscribe(listener, (gated) => clock.on(gated));
        releases.push(channel.release);
    });
    const { settings } = source;
    if (settings && typeof settings.onChange === 'function') {
        const owned = gateFoliumSettingAccess(settings, modId, where, piece);
        members.settings = owned.view;
        releases.push(owned.release);
    }
    return {
        view: Object.freeze({ ...source, ...members }) as unknown as Ctx,
        release: () => releases.forEach((release) => release()),
    };
};
