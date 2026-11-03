// src/mods/folium/omni/requestQuota.ts
// The allowance mods have for asking online sources through the host, shared by `folium.omni` and the
// experimental `platform.raw`: per mod, so many requests a minute and so many under way at once; per
// source built into Folia, so many across all mods together. It also bounds how long a caller waits for
// an answer and how long a request may keep its place. It imports neither Omni nor a store, so the
// client api's import closure may hold it.

/**
 * Requests one mod may make in a minute, and may have under way at once. Past the minute's allowance a
 * request is refused; past the ones at once it waits for one of them to finish, first come first served.
 */
const PER_MOD: AllowanceRules = { perMinute: 120, atOnce: 8 };
/**
 * Requests all mods together may make to one source built into Folia, in a minute and at once; the
 * host's own requests do not count. They go out with the session of the account signed in to that
 * source, so without this N mods reading in bulk would be N times one mod's allowance at one platform,
 * on the user's account. Past the minute a request is refused; past the ones at once it waits its turn.
 */
const PER_SOURCE: AllowanceRules = { perMinute: 240, atOnce: 8 };
const WINDOW_MS = 60_000;
/**
 * How long a `folium.omni` caller waits for an answer, counted from the call: most sources' requests
 * have no time limit of their own, and neither do a mod's source's.
 */
const ANSWER_WITHIN_MS = 30_000;
/**
 * How long a request that was sent may keep its places. One still under way then gives them back (and
 * may still be running at the source), so that a request that hangs cannot hold a place for good.
 */
const HOLD_AT_MOST_MS = 120_000;

interface AllowanceRules {
    readonly perMinute: number;
    readonly atOnce: number;
}

interface Allowance extends AllowanceRules {
    /** When each request of the last minute was accepted, oldest first. */
    readonly accepted: number[];
    /** Places taken now. */
    inFlight: number;
    /** Requests waiting for one of the places, oldest first: each is the function that lets it in. */
    readonly waiting: Array<() => void>;
}

/** Where a source comes from: built into Folia (`host`), or registered by a mod (`omni.providers`). */
export type FoliumSourceOrigin = 'host' | 'mod';

/** Why the allowance turned a request away or stopped waiting for it, as the rejection's `code` and message. */
export type FoliumRequestQuotaCode = 'rate-limited' | 'aborted' | 'network';

/** One request to a source, as `runFoliumRequest` counts it. */
export interface FoliumQuotaRequest {
    /** The mod whose allowance it counts against. */
    readonly modId: string;
    /** The source it asks. */
    readonly providerId: string;
    /**
     * `host`: takes one of the mod's places, and one of the source's with `perSource`. `mod`: counts
     * against the mod's minute only and never waits, since a mod's source that asks `folium.omni` in turn
     * would otherwise wait for a place its own outer request holds; the minute still bounds a loop.
     */
    readonly origin: FoliumSourceOrigin;
    /** Whether the allowance of the source across all mods applies (only with origin `host`). */
    readonly perSource: boolean;
    /**
     * Aborting it rejects the call with `aborted` at once. A request still waiting leaves its queue and
     * gives back the place it holds; one already sent keeps its places until `work` settles. A request
     * whose signal aborted is never sent, even when a place reaches it before its abort listener runs.
     */
    readonly signal: AbortSignal;
    /**
     * How long the caller waits, counted from the call, before the call rejects `network` (a request
     * already sent keeps its places then; one that gets its place only after that is never sent); null
     * to wait as long as `work` takes, for a request that has a time limit of its own.
     */
    readonly answerWithinMs: number | null;
    /** The request as the developer log names it after `[Folium:<mod id>]`, e.g. `platform.raw <id> <endpoint>`. */
    readonly what: string;
}

/**
 * Runs one call's requests to sources under this mod's allowance and the source's. Rejects with a coded
 * Error: `rate-limited`, `aborted` (the caller's signal or the mod stopping: the answer is dropped, `work`
 * may still be running), `network` (no answer within the hard limit). What `work` rejects with passes
 * through unchanged.
 */
export interface FoliumRequestGate {
    run<T>(providerId: string, work: () => Promise<T>): Promise<T>;
}

export interface FoliumRequestGateOptions {
    /** The mod whose allowance the requests count against. */
    readonly modId: string;
    /** The call, as the developer log names it: `omni.searchSongs`. Each line adds the source's id. */
    readonly what: string;
    /** The call's signal: the caller's and the end of the activation, merged by whoever builds the gate. */
    readonly signal: AbortSignal;
    /** Whether a source id is a source built into Folia or a mod's; the caller knows how mods' sources are named. */
    readonly originOf: (providerId: string) => FoliumSourceOrigin;
}

// Per mod id and per source id, for as long as the page lives: two activations of one mod (a reload,
// say) share one allowance, as do `folium.omni` and `platform.raw`.
const modAllowances = new Map<string, Allowance>();
const sourceAllowances = new Map<string, Allowance>();

// The rejections that are the allowance's own, as against those `work` rejected with.
const quotaErrors = new WeakSet<object>();

/** A rejection with one of the allowance's codes, as the code and as the message. */
const quotaError = (code: FoliumRequestQuotaCode): Error & { readonly code: FoliumRequestQuotaCode } => {
    const error = Object.assign(new Error(code), { code });
    quotaErrors.add(error);
    return error;
};

/** Whether `error` is a rejection of the allowance's own, not one that `work` rejected with. */
export const isFoliumRequestQuotaError = (error: unknown): error is Error & { readonly code: FoliumRequestQuotaCode } => (
    typeof error === 'object' && error !== null && quotaErrors.has(error)
);

const allowanceOf = (allowances: Map<string, Allowance>, id: string, rules: AllowanceRules): Allowance => {
    let allowance = allowances.get(id);
    if (!allowance) {
        allowance = { ...rules, accepted: [], inFlight: 0, waiting: [] };
        allowances.set(id, allowance);
    }
    return allowance;
};

/* Whether the minute has room for one more request, forgetting the ones accepted over a minute ago. */
const hasRoom = (allowance: Allowance, now: number): boolean => {
    while (allowance.accepted.length > 0 && now - allowance.accepted[0] >= WINDOW_MS) allowance.accepted.shift();
    return allowance.accepted.length < allowance.perMinute;
};

/* Gives a place back and lets the oldest waiting request in. */
const givePlace = (allowance: Allowance) => {
    allowance.inFlight -= 1;
    allowance.waiting.shift()?.();
};

/**
 * Runs `work`, one request to a source, under the allowances: refused (`rate-limited`) past a minute's
 * allowance, sent once it has its places, the mod's first and then the source's. A free place is taken
 * without waiting, so a request is sent in the same turn as it was made whenever it can be.
 */
export const runFoliumRequest = <T>(request: FoliumQuotaRequest, work: () => Promise<T>): Promise<T> => {
    const { modId, providerId, signal, what } = request;
    if (signal.aborted) return Promise.reject(quotaError('aborted'));

    // A request counts against the minute when it is accepted, waiting for a place included. Refused by
    // either minute, it counts against neither.
    const now = Date.now();
    const own = allowanceOf(modAllowances, modId, PER_MOD);
    const source = request.origin === 'host' && request.perSource ? allowanceOf(sourceAllowances, providerId, PER_SOURCE) : null;
    if (!hasRoom(own, now)) {
        console.warn(`[Folium:${modId}] ${what}: refused, over ${PER_MOD.perMinute} requests a minute`);
        return Promise.reject(quotaError('rate-limited'));
    }
    if (source && !hasRoom(source, now)) {
        console.warn(`[Folium:${modId}] ${what}: refused, all mods together are over ${PER_SOURCE.perMinute} requests a minute to ${providerId}`);
        return Promise.reject(quotaError('rate-limited'));
    }
    own.accepted.push(now);
    source?.accepted.push(now);
    // Always the mod's place before the source's, so no two requests each hold what the other waits for:
    // whoever holds a source's place is under way and waits for nothing. A mod's source takes none.
    const places = request.origin === 'host' ? (source ? [own, source] : [own]) : [];
    // When the caller stops waiting for an answer, if it has a time limit.
    const deadline = request.answerWithinMs === null ? null : now + request.answerWithinMs;

    return new Promise<T>((resolve, reject) => {
        const held: Allowance[] = [];
        // The place it waits for, while it waits.
        let queued: { allowance: Allowance; letIn: () => void } | null = null;
        let sent = false;
        let answered = false;
        let answerTimer: ReturnType<typeof setTimeout> | undefined;

        /* Gives back the places it holds; a second time gives back nothing. */
        const giveBack = () => {
            held.splice(0).forEach(givePlace);
        };

        /* Settles the call once: the first of the answer, the abort and the time limit. */
        const answer = (settle: () => void) => {
            if (answered) return;
            answered = true;
            clearTimeout(answerTimer);
            signal.removeEventListener('abort', onAbort);
            settle();
        };

        /*
         * The caller stops waiting: its signal aborted, or the time ran out. A request not sent yet leaves
         * its queue and gives back the place it holds. One that was sent keeps its places until `work`
         * settles: the request at the source may still be running, and counts as under way.
         */
        const stop = (code: FoliumRequestQuotaCode) => {
            if (answered) return;
            if (!sent) {
                if (queued) {
                    const index = queued.allowance.waiting.indexOf(queued.letIn);
                    if (index >= 0) queued.allowance.waiting.splice(index, 1);
                    queued = null;
                }
                // Passed on a turn later, not at once: this caller may be one of several that stop waiting
                // together (calls sharing one signal, or a stopping mod's calls aborted one after another),
                // and the place must not reach the next of them before that one has stopped too. Until
                // then it still counts as taken, so nobody jumps the queue.
                const given = held.splice(0);
                if (given.length > 0) queueMicrotask(() => given.forEach(givePlace));
            }
            answer(() => reject(quotaError(code)));
        };
        /*
         * Why the caller no longer waits although its abort listener or its timer has not run yet: a
         * place may reach it from another request stopping in the same moment (the same signal, a time
         * limit running out together with its own). Null while it still waits.
         */
        const gaveUp = (): FoliumRequestQuotaCode | null => {
            if (signal.aborted) return 'aborted';
            return deadline !== null && Date.now() >= deadline ? 'network' : null;
        };
        const onAbort = () => stop('aborted');
        signal.addEventListener('abort', onAbort, { once: true });
        if (request.answerWithinMs !== null) answerTimer = setTimeout(() => stop('network'), request.answerWithinMs);

        const send = () => {
            sent = true;
            let running: Promise<T>;
            try {
                running = Promise.resolve(work());
            } catch (error) {
                running = Promise.reject(error);
            }
            const holdTimer = held.length === 0 ? undefined : setTimeout(() => {
                if (held.length === 0) return;
                console.warn(`[Folium:${modId}] ${what}: still under way ${HOLD_AT_MOST_MS / 1000} s after it was sent; its places are given back, though it may still be running`);
                giveBack();
            }, HOLD_AT_MOST_MS);
            const done = () => {
                clearTimeout(holdTimer);
                giveBack();
            };
            running.then(
                (value) => {
                    done();
                    answer(() => resolve(value));
                },
                (error: unknown) => {
                    done();
                    answer(() => reject(error));
                },
            );
        };

        /* Takes the places from `from` on, each at once when one is free and else in turn; then sends. */
        const enter = (from: number) => {
            for (let index = from; index < places.length; index += 1) {
                const allowance = places[index];
                // While anyone waits all places are taken (a freed one goes straight to the oldest waiting),
                // so a free place here never jumps the queue.
                if (allowance.inFlight < allowance.atOnce) {
                    allowance.inFlight += 1;
                    held.push(allowance);
                    continue;
                }
                const letIn = () => {
                    queued = null;
                    allowance.inFlight += 1;
                    held.push(allowance);
                    // A caller that gave up is never sent: it stops here and the place goes on to the
                    // next in line, as if it had left the queue in time.
                    const code = gaveUp();
                    if (code !== null) {
                        stop(code);
                        return;
                    }
                    enter(index + 1);
                };
                queued = { allowance, letIn };
                allowance.waiting.push(letIn);
                return;
            }
            send();
        };
        enter(0);
    });
};

/**
 * The gate one call of a `folium.omni` method runs its requests through, under this mod's allowance and
 * the source's, with the host's time limits. Build one per call, with that call's signal.
 */
export const createFoliumRequestGate = (options: FoliumRequestGateOptions): FoliumRequestGate => {
    const { modId, what, signal, originOf } = options;
    return Object.freeze({
        run: <T>(providerId: string, work: () => Promise<T>): Promise<T> => runFoliumRequest({
            modId,
            providerId,
            origin: originOf(providerId),
            perSource: true,
            signal,
            answerWithinMs: ANSWER_WITHIN_MS,
            what: `${what} ${providerId}`,
        }, work),
    });
};

/**
 * For tests only: forgets every mod's and every source's allowance, as a fresh page would. The
 * allowances live as long as the page (per id, not per service), so a test file whose cases make
 * requests calls this in `afterEach`; requests still under way then keep counting against the old ones.
 */
export const resetFoliumRequestQuotasForTest = () => {
    modAllowances.clear();
    sourceAllowances.clear();
};
