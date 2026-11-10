import { useSyncExternalStore } from 'react';

// src/components/visualizer/preview/pictureTurns.ts
// Two rules for all small pictures on the page, whichever window they are in: images are made one
// after the other, and one picture runs at a time. Drawing a style for the first time is the heavy
// moment (14 at once froze the page for a quarter to half a second), and Chromium keeps 16 WebGL
// contexts alive in a page: one more, and the oldest is lost, which is the playing page's.
//
// The count in the worst case: the playing page holds 3 (a style over a background of two
// shaders), the large sample 3, the picture being made at most 2, the picture that runs at most
// 2, the lattice's lyrics and the now-playing toast 1 each, Pixi keeps 1 of its own for as long
// as the page lives and makes 1 more for a moment when it starts: 14. The number of styles does
// not enter it, so a mod's styles add nothing: a picture's context is gone before the next
// picture's is made. Measured on a production build with all 14 styles and the backgrounds made
// one after the other: a lyric style's context was lost 0.5 to 1.6 s after it was made and 0.2 s
// or more before the next one came. The Paper shaders of nomand and latent and the canvas of sora
// kept theirs after they were taken away (4 were still there 18 s later), so a stage that is
// taken down gives its canvases' contexts back itself (frozenPicture.followCanvases): measured
// again, each of those was lost before the next picture's was made.
//
// And a third: no picture starts while the page switches its lyric style (holdTurns, whenFree). The
// new style's own start is the same heavy moment, and the switch's transition plays over it:
// measured in the player panel, the pictures the picker started after a switch to 商籁 made four
// WebGL contexts and a second of shader linking, in the middle of it. The rule holds where a picture
// starts, not where it gets its turn: one whose turn came before the switch, still waiting for a
// moment the page is idle, started making in the middle of a switch to 镜台.

const waiting: Array<() => void> = [];
let current: (() => void) | null = null;

const startNext = () => {
    current = waiting.shift() ?? null;
    current?.();
};

/**
 * Asks for the turn to make an image. `start` is called when the turn comes: at once when nobody
 * has it. The function returned gives the turn back, or takes the ask back while it still waits.
 */
export const takeTurn = (start: () => void): (() => void) => {
    const turn = () => start();
    waiting.push(turn);
    if (!current) {
        startNext();
    }
    return () => {
        if (current === turn) {
            startNext();
            return;
        }
        const at = waiting.indexOf(turn);
        if (at >= 0) {
            waiting.splice(at, 1);
        }
    };
};

/** How many holds there are: while there is one, no picture starts. */
let held = 0;
const waitingForFree = new Set<() => void>();

/**
 * Holds every picture back from starting, an image or a run, until the function returned is called.
 * A picture already being made, or running, goes on.
 */
export const holdTurns = (): (() => void) => {
    held += 1;
    let letGo = false;
    return () => {
        if (letGo) {
            return;
        }
        letGo = true;
        held -= 1;
        if (held > 0) {
            return;
        }
        const runs = [...waitingForFree];
        waitingForFree.clear();
        runs.forEach(run => run());
    };
};

/**
 * Runs `run`, the start of a picture, once nothing holds the pictures back: at once when nothing
 * does. The function returned takes it back while it still waits.
 */
export const whenFree = (run: () => void): (() => void) => {
    if (held === 0) {
        run();
        return () => {};
    }
    const start = () => run();
    waitingForFree.add(start);
    return () => {
        waitingForFree.delete(start);
    };
};

let running: string | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

const setRunning = (id: string | null) => {
    running = id;
    listeners.forEach(listener => listener());
};

/** Which picture runs, if any. */
export const runningPicture = (): string | null => running;

/** Makes `id` the one picture that runs; whichever ran stops. The function returned stops it. */
export const claimRun = (id: string): (() => void) => {
    setRunning(id);
    return () => {
        if (running === id) {
            setRunning(null);
        }
    };
};

/** Whether the picture `id` is the one that runs. */
export const useIsRunning = (id: string): boolean => useSyncExternalStore(subscribe, () => running === id);
