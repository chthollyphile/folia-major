// src/services/automix/modelAvailability.ts
// Which model weights are actually on disk, as a value the rest of the app can read synchronously.
//
// Every capability question in automix used to be answered with "am I running in Electron", which
// was the same answer as "are the weights here" only because the weights shipped inside the
// installer. They are 249MB of a 436MB download that most listeners never switch the feature on
// for, so they are becoming something a user chooses to fetch - and the moment that is true,
// "Electron" and "has weights" are different questions and the old one is wrong for the common case.
//
// So the whole question here is disk presence, answered in one place. The worker returns the same
// null for "no weights on disk" and "this runtime will not start", and this file deliberately does
// NOT try to tell those apart with a session-long "declined" latch - see `modelCanRun` for why that
// latch was removed and what replaced it. Presence heals when a download lands, so it is re-asked.
//
// A leaf on purpose - it imports nothing from the app. beatThis.ts and stems.ts both read it, and
// stems.ts already imports beatThis.ts, so anything shared between them has to sit below both.

export type AutomixModelName = 'beat_this' | 'htdemucs';

export type AutomixModelsPresent = Readonly<Record<AutomixModelName, boolean>>;

/**
 * What the browser build answers forever, and what every build answers until the first check lands.
 *
 * False rather than "unknown", because the two consumers of this turn it into a claim shown to the
 * listener: the engine badge and the 表现模式 switch. Starting at false understates this build for
 * one IPC round trip and then corrects upward; starting at true is a page promising stem separation
 * over an empty directory, which is the exact failure that let a gesture run zero times for a day.
 */
const ABSENT: AutomixModelsPresent = Object.freeze({ beat_this: false, htdemucs: false });

let present: AutomixModelsPresent = ABSENT;

const listeners = new Set<() => void>();

/** Subscribe/getSnapshot in the shape `useSyncExternalStore` wants. */
export const subscribeModelAvailability = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

/**
 * The current answer. Never null and never throws, so callers stay one boolean rather than a state.
 *
 * The returned object is only replaced when a value actually changed, which is what lets it be a
 * `useSyncExternalStore` snapshot without re-rendering on every refresh.
 */
export const modelsPresent = (): AutomixModelsPresent => present;

/**
 * Whether this model can run right now. Its weights being on disk is the whole of the question.
 *
 * There is deliberately no "this runtime refused, give up for the session" latch on top of this.
 * That latch was safe only while the weights shipped inside the installer: a run that came back
 * empty with the files present had no explanation left but a runtime that would not start. Once the
 * weights became an optional download the same empty answer started arriving for an ordinary reason
 * - the host restarts the worker on every folder switch and every finished download, and an
 * in-flight request cut off by one of those comes back with nothing. Telling the two apart after the
 * fact meant re-statting disk, which reads wherever the directory points NOW; switch folders or
 * re-download in that window and a transient empty answer latched the model off for good, curable
 * only by relaunching. The worker keeps its own per-process guard against re-initialising a runtime
 * that genuinely failed, which is that same protection without the false positive - so this stays a
 * single question about the files.
 */
export const modelCanRun = (name: AutomixModelName): boolean => present[name];

/**
 * Re-asks the main process. Safe to call at any time and from anywhere; failures leave the last
 * answer in place rather than downgrading a working build on one bad round trip.
 */
export const refreshModelAvailability = async (): Promise<AutomixModelsPresent> => {
    const ask = typeof window !== 'undefined' ? window.electron?.getAutomixModelsPresent : undefined;
    if (typeof ask !== 'function') return present;

    let answer: { beat_this: boolean; htdemucs: boolean } | null = null;
    try {
        answer = await ask();
    } catch (error) {
        console.warn('[Automix] could not check which models are installed', error);
        return present;
    }
    if (!answer) return present;

    const next: AutomixModelsPresent = {
        beat_this: answer.beat_this === true,
        htdemucs: answer.htdemucs === true,
    };
    if (next.beat_this === present.beat_this && next.htdemucs === present.htdemucs) return present;

    present = Object.freeze(next);
    for (const listener of listeners) listener();
    return present;
};

/**
 * Re-checks disk after a run came back with nothing, so the rest of the app stops believing in an
 * engine whose weights just vanished. The engine badge and the 表现模式 switch are drawn from this.
 *
 * It does NOT disable the model for the session - see `modelCanRun` for why that latch was removed.
 * An empty answer is not evidence the runtime is broken: the worker returns the same nothing when
 * the weights are missing and when an in-flight request was cut off by the worker restarting under
 * it, and both of those heal on their own. So the only thing to do here is make the on-disk answer
 * current again, and say so on the one branch that is actionable - the weights are gone.
 */
export const noteModelFailed = async (name: AutomixModelName): Promise<void> => {
    const stillThere = (await refreshModelAvailability())[name];
    if (!stillThere) console.warn(`[Automix] ${name} produced nothing and its weights are gone;`
        + ' will use it again if they come back');
};

// Asked once as the module loads, so the answer is usually in hand before anything renders. It is
// two `existsSync` calls behind one IPC hop; there is nothing to defer.
void refreshModelAvailability();
