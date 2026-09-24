import type { FoliumDisposer, FoliumEventMap, FoliumEventPriority } from './contract';
import { reportFoliumIssue } from './status';

// src/mods/folium/events.ts
// The Folium event bus. Handlers run in priority order (highest first; equal
// priority keeps registration order), each inside its own error boundary: one
// mod throwing never stops the others or the host. Handlers are owned by the
// mod that added them and removed with it.
//
// Two dispatch styles:
//   - emitFoliumEvent: notifications. Synchronous, fire-and-forget; a handler
//     returning a promise is not awaited.
//   - dispatchFoliumHookSync / dispatchFoliumHookAsync: hooks. The same event
//     object passes through every handler, which may mutate it; async hooks
//     await each handler in turn, with a per-handler time limit so a stuck mod
//     cannot hold playback hostage.

const PRIORITY_RANK: Record<FoliumEventPriority, number> = {
    highest: 0,
    high: 1,
    normal: 2,
    low: 3,
    lowest: 4,
};

// A synchronous handler slower than this delays the host; it is logged against its mod.
const SYNC_BUDGET_MS = 16;
// An async hook handler is abandoned (not awaited further) after this long.
const ASYNC_TIMEOUT_MS = 1500;

type AnyHandler = (event: any) => void | Promise<void>;

interface Registration {
    modId: string;
    handler: AnyHandler;
    rank: number;
    sequence: number;
}

const handlersByType = new Map<string, Registration[]>();
let sequence = 0;

export const addFoliumEventHandler = <K extends keyof FoliumEventMap>(
    modId: string,
    type: K,
    handler: (event: FoliumEventMap[K]) => void | Promise<void>,
    priority: FoliumEventPriority = 'normal',
): FoliumDisposer => {
    if (typeof handler !== 'function') {
        throw new Error(`events.on(${type}): handler must be a function`);
    }
    const rank = PRIORITY_RANK[priority];
    if (rank === undefined) {
        throw new Error(`events.on(${type}): unknown priority "${String(priority)}"`);
    }
    const registration: Registration = { modId, handler, rank, sequence: sequence += 1 };
    const list = [...(handlersByType.get(type) ?? []), registration]
        .sort((left, right) => left.rank - right.rank || left.sequence - right.sequence);
    handlersByType.set(type, list);
    return () => {
        const current = handlersByType.get(type);
        if (!current) return;
        handlersByType.set(type, current.filter((entry) => entry !== registration));
    };
};

/** Removes every handler a mod added (teardown). */
export const removeFoliumEventHandlers = (modId: string) => {
    handlersByType.forEach((list, type) => {
        handlersByType.set(type, list.filter((entry) => entry.modId !== modId));
    });
};

export const hasFoliumEventHandlers = (type: keyof FoliumEventMap) => (handlersByType.get(type)?.length ?? 0) > 0;

const runSync = (registration: Registration, type: string, event: unknown) => {
    const started = performance.now();
    try {
        const result = registration.handler(event);
        if (result && typeof (result as Promise<void>).catch === 'function') {
            (result as Promise<void>).catch((error) => reportFoliumIssue(registration.modId, `event ${type}`, error));
        }
    } catch (error) {
        reportFoliumIssue(registration.modId, `event ${type}`, error);
    }
    const elapsed = performance.now() - started;
    if (elapsed > SYNC_BUDGET_MS) {
        console.warn(`[Folium:${registration.modId}] ${type} handler took ${elapsed.toFixed(1)}ms`);
    }
};

/** Notification: every handler sees the same frozen payload; nothing is awaited. */
export const emitFoliumEvent = <K extends keyof FoliumEventMap>(type: K, payload: FoliumEventMap[K]) => {
    const list = handlersByType.get(type);
    if (!list || list.length === 0) return;
    const event = Object.freeze({ ...payload });
    list.forEach((registration) => runSync(registration, type, event));
};

/** Synchronous hook: handlers mutate `event` in order; async handlers are not awaited. */
export const dispatchFoliumHookSync = <K extends keyof FoliumEventMap>(type: K, event: FoliumEventMap[K]): FoliumEventMap[K] => {
    const list = handlersByType.get(type);
    if (!list) return event;
    list.forEach((registration) => runSync(registration, type, event));
    return event;
};

/*
 * Asynchronous hook: handlers run one after another on the same event. A
 * handler that takes longer than ASYNC_TIMEOUT_MS is reported and skipped; its
 * later mutations still land on the event but are no longer waited for.
 * `stop` lets the caller end the chain early (e.g. once cancelled).
 */
export const dispatchFoliumHookAsync = async <K extends keyof FoliumEventMap>(
    type: K,
    event: FoliumEventMap[K],
    stop: (event: FoliumEventMap[K]) => boolean = () => false,
): Promise<FoliumEventMap[K]> => {
    const list = handlersByType.get(type);
    if (!list) return event;
    for (const registration of list) {
        if (stop(event)) break;
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
            await Promise.race([
                Promise.resolve().then(() => registration.handler(event)),
                new Promise<void>((_, reject) => {
                    timer = setTimeout(() => reject(new Error(`timed out after ${ASYNC_TIMEOUT_MS}ms`)), ASYNC_TIMEOUT_MS);
                }),
            ]);
        } catch (error) {
            reportFoliumIssue(registration.modId, `hook ${type}`, error);
        } finally {
            if (timer !== null) clearTimeout(timer);
        }
    }
    return event;
};
