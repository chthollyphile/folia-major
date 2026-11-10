import { errorMessage } from './errorText';

// src/utils/likePresses.ts
//
// What happens between a press on a heart and the service holding the new state: pressed,
// wanted, sent, settled. No React and no store in here. What shows the heart is told through
// `onChange`; what talks to the service is handed in with the press.
//
// The rules, for one song:
// - A press says what is wanted from now on, and that is shown at once.
// - One request at a time. A press made while a request is under way sends nothing: it changes
//   what is wanted.
// - When a request is over and what is wanted differs from what it sent, one more goes out. So
//   the service ends with the state the listener left.
// - A request that fails ends the run. Nothing is wanted for the song any more, and what is
//   shown goes back to what the account holds (the service may hold the other state where the
//   request was given up and taken late).
// - A request with no answer after REQUEST_LIMIT_MS counts as failed.
// - `forget`: the presses so far were for an account that is no longer the one shown. None is
//   wanted or touched any more; a request under way ends, and records and sends nothing after.
//
// Used for the online providers' likes (omni.ts) and for Navidrome's stars
// (useLibraryPlaybackController.ts).

// How long a request is waited for.
const REQUEST_LIMIT_MS = 20_000;

/**
 * Asks the service for a state; rejects when the service does not take it. `signal` aborts once
 * the request is no longer waited for: an answer that comes after that must write nothing.
 */
export type LikeSend = (liked: boolean, signal: AbortSignal) => Promise<void>;

export type LikeOutcome =
    /** The service took the last request and holds `liked`, which is what was wanted. */
    | { ok: true; liked: boolean }
    /** A request failed. `confirmed` is the last state the service took in this run, if it took one. */
    | { ok: false; error: unknown; confirmed?: boolean };

export interface LikePress {
    /** What this press asked for. */
    wanted: boolean;
    /** The press came while a request for the song was under way; it sent nothing itself. */
    joined: boolean;
    /** How the run ended. One promise for every press of a run; it never rejects. */
    settled: Promise<LikeOutcome>;
}

export interface LikePressesOptions {
    /** Names the songs in the log, as `<name>:<key>`. Never a title. */
    name: string;
    /** Called when what is wanted changes, with every song that has an unsettled press. */
    onChange?: (wanted: Record<string, boolean>) => void;
    now?: () => number;
}

interface Run {
    wanted: boolean;
    confirmed?: boolean;
    send: LikeSend;
    settled: Promise<LikeOutcome>;
}

const wordOf = (liked: boolean): string => (liked ? 'liked' : 'not liked');

// One request, waited for REQUEST_LIMIT_MS at most: past that it is given up and counts as failed.
const answerInTime = (send: LikeSend, liked: boolean): Promise<void> => {
    const waiting = new AbortController();
    return new Promise<void>((resolve, reject) => {
        const limit = setTimeout(() => {
            waiting.abort();
            reject(new Error(`no answer in ${REQUEST_LIMIT_MS / 1000} s`));
        }, REQUEST_LIMIT_MS);
        // `async`: a send that throws at once rejects too, so the limit is always cleared.
        (async () => send(liked, waiting.signal))().then(resolve, reject).finally(() => clearTimeout(limit));
    });
};

export const createLikePresses = ({ name, onChange, now = () => Date.now() }: LikePressesOptions) => {
    const runs = new Map<string, Run>();
    // When the service last took a request for each song: one entry for a song whose request was
    // taken in this session. A request that failed or was given up leaves none.
    const takenAt = new Map<string, number>();

    const wanted = (): Record<string, boolean> => (
        Object.fromEntries([...runs].map(([key, run]) => [key, run.wanted]))
    );
    const changed = (): void => onChange?.(wanted());

    // Sends what is wanted until the service holds it, one request after the other.
    const settle = async (key: string, run: Run): Promise<LikeOutcome> => {
        let outcome: LikeOutcome;
        try {
            let sent: boolean;
            do {
                sent = run.wanted;
                await answerInTime(run.send, sent);
                run.confirmed = sent;
                if (runs.get(key) === run) takenAt.set(key, now());
                console.log(`[Like] ${name}:${key} request taken: ${wordOf(sent)}`);
            } while (runs.get(key) === run && run.wanted !== sent);
            outcome = { ok: true, liked: sent };
        } catch (error) {
            console.warn(`[Like] ${name}:${key} request failed: ${errorMessage(error)}`);
            outcome = run.confirmed === undefined ? { ok: false, error } : { ok: false, error, confirmed: run.confirmed };
        }
        // A run that was forgotten is no longer the song's: a press after it may have begun another.
        if (runs.get(key) === run) runs.delete(key);
        changed();
        return outcome;
    };

    return {
        /**
         * A press on the heart of `key`: `liked` is wanted from now on. A run keeps the `send` of
         * the press that began it.
         */
        press(key: string, liked: boolean, send: LikeSend): LikePress {
            const running = runs.get(key);
            if (running) {
                running.wanted = liked;
                console.log(`[Like] ${name}:${key} pressed: ${wordOf(liked)} wanted, after the request under way`);
                changed();
                return { wanted: liked, joined: true, settled: running.settled };
            }
            const run = { wanted: liked, send } as Run;
            runs.set(key, run);
            console.log(`[Like] ${name}:${key} pressed: ${wordOf(liked)} wanted`);
            changed();
            run.settled = settle(key, run);
            return { wanted: liked, joined: false, settled: run.settled };
        },
        /** What is wanted for every song with an unsettled press. */
        wanted,
        /** Whether the song has an unsettled press, or the service took a request for it at `time` or later. */
        touchedSince(key: string, time: number): boolean {
            const at = takenAt.get(key);
            return runs.has(key) || (at !== undefined && at >= time);
        },
        /** Forgets every press made so far (see the rules at the top). */
        forget(): void {
            takenAt.clear();
            if (runs.size === 0) return;
            runs.clear();
            changed();
        },
    };
};

export type LikePresses = ReturnType<typeof createLikePresses>;
