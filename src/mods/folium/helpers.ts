import { cancelFrame, frame } from 'framer-motion';
import type { FoliumDisposer, FoliumMountHelpers, FoliumSize } from './contract';
import {
    callFoliumMod,
    createFoliumGatedChannel,
    createFoliumMountView,
    type FOLIUM_CLOCK_HELPERS,
    type FoliumHostClock,
} from '../runtime/guard';
import type { FoliumFaultPiece } from '../runtime/status';

// src/mods/folium/helpers.ts
// The helpers: onChange, onLyricTime / onPlaybackTime, onFrame, onResize,
// every and onDispose on a mount's context, every and onDispose on the
// `folium` object. Each takes a function of the mod, calls it through the gate
// (guard.ts), and belongs to an owner: one mount, or one activation of a
// client. When the owner ends, the host stops everything still running,
// whether or not the mod kept the disposer it was given, and a helper called
// after that is refused.

type ClockHelpers = typeof FOLIUM_CLOCK_HELPERS;

/**
 * A mount context as the host builds it. createFoliumMountScope turns it into what the mod receives:
 * `subscribe` becomes `onChange`, a clock's `on` becomes its helper (`onLyricTime`, `onPlaybackTime`), and
 * the other helpers are added per mount.
 */
export type FoliumHostContext<Ctx> = {
    [Key in Exclude<keyof Ctx, keyof FoliumMountHelpers | ClockHelpers[keyof ClockHelpers]>]:
        Key extends keyof ClockHelpers ? FoliumHostClock : Ctx[Key];
} & {
    /** Announces a change of a value the context reads through a getter. */
    subscribe(listener: () => void): FoliumDisposer;
};

// A timer faster than a frame only burns time: per-frame work belongs to onFrame.
const MIN_INTERVAL_MS = 16;
// The longest a browser timer can wait. A longer one wraps around and fires as fast as it can.
const MAX_INTERVAL_MS = 2_147_483_647;

/*
 * The frame loop behind onFrame is the app's own: framer-motion's, which
 * already carries the lyric clock and every animation of the app. All frame
 * listeners of all mods share one process on it, in its render step (after
 * the clock and the animated values of that frame are set). The process is
 * scheduled only while there is a listener, so a session in which no mod uses
 * onFrame schedules nothing and costs nothing.
 *
 * A frame calls the listeners it began with, each at most once: one that was
 * stopped earlier in the frame is skipped, and one that joins during the frame
 * starts with the next. So a listener that stops itself and subscribes again
 * inside its own call, the way a requestAnimationFrame loop is written, runs
 * once per frame. The list is rebuilt only when a listener joined or left, so a
 * frame allocates nothing.
 */
type FrameListener = (timestamp: number) => void;
const frameListeners = new Set<FrameListener>();
let frameList: FrameListener[] | null = null;
const runFrame = (data: { timestamp: number }) => {
    const list = frameList ??= Array.from(frameListeners);
    for (let index = 0; index < list.length; index += 1) {
        const listener = list[index];
        if (frameListeners.has(listener)) listener(data.timestamp);
    }
};

const joinFrameLoop = (listener: FrameListener): FoliumDisposer => {
    const first = frameListeners.size === 0;
    if (!frameListeners.has(listener)) {
        frameListeners.add(listener);
        frameList = null;
    }
    if (first) frame.render(runFrame, true);
    return () => {
        if (!frameListeners.delete(listener)) return;
        frameList = null;
        if (frameListeners.size === 0) cancelFrame(runFrame);
    };
};

/** The helpers that need nothing but an owner, and the way to end that owner. */
export interface FoliumScope {
    every(ms: number, listener: () => void): FoliumDisposer;
    onFrame(listener: (timestamp: number) => void): FoliumDisposer;
    onResize(target: Element, listener: (size: FoliumSize) => void): FoliumDisposer;
    onDispose(disposer: FoliumDisposer): void;
    /**
     * Ends the owner: runs the disposers given to onDispose, newest first, then stops every timer,
     * frame listener and size listener still running. A disposer given later runs at once.
     */
    end(): void;
}

/**
 * One owner's helpers. `where` names the owner in failure reports, e.g. "visualizer aurora:text";
 * `piece` is the kind of piece it is, for the notice a failure raises.
 */
export const createFoliumScope = (modId: string, where: string, piece?: FoliumFaultPiece): FoliumScope => {
    const timers = createFoliumGatedChannel(modId, `${where} every`, false, piece);
    const frames = createFoliumGatedChannel(modId, `${where} onFrame`, true, piece);
    const sizes = createFoliumGatedChannel(modId, `${where} onResize`, false, piece);
    const disposers: FoliumDisposer[] = [];
    let ended = false;
    const dispose = (disposer: FoliumDisposer) => {
        callFoliumMod(modId, `${where} dispose`, disposer, undefined, piece);
    };
    return {
        every: (ms, listener) => {
            if (typeof ms !== 'number' || !Number.isFinite(ms)) {
                throw new TypeError(`${where} every: ms must be a number`);
            }
            return timers.subscribe(listener, (gated) => {
                const timer = setInterval(gated, Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms)));
                return () => clearInterval(timer);
            });
        },
        onFrame: (listener) => frames.subscribe(listener, joinFrameLoop),
        onResize: (target, listener) => sizes.subscribe(listener, (gated) => {
            const observer = new ResizeObserver((entries) => {
                const { width, height } = entries[entries.length - 1].contentRect;
                gated(Object.freeze({ width, height }));
            });
            observer.observe(target);
            return () => observer.disconnect();
        }),
        onDispose: (disposer) => {
            if (typeof disposer !== 'function') {
                throw new TypeError(`${where} onDispose: disposer must be a function`);
            }
            if (ended) {
                dispose(disposer);
            } else {
                disposers.push(disposer);
            }
        },
        end: () => {
            if (ended) return;
            ended = true;
            // Before the helpers stop, so a disposer that still needs its listeners has them.
            while (disposers.length > 0) dispose(disposers.pop()!);
            timers.release();
            frames.release();
            sizes.release();
        },
    };
};

/** What one mount holds: the context its `mount` receives, and the way to end the mount. */
export interface FoliumMountScope<Ctx> {
    ctx: Ctx;
    /** Takes what `mount` returned: a disposer, a promise of one, or nothing. */
    adopt(result: unknown): void;
    /**
     * Runs the mod's disposers, then removes everything the mount still has subscribed or running.
     * Calling it again does nothing.
     */
    end(): void;
}

/*
 * The context one mount receives: the host's context as a view that belongs
 * to this mount (guard.ts: onChange, the clock's helper, the settings), plus
 * the helpers that need only an owner. Build it once per mount; it is not a
 * React dependency, so it never remounts anything.
 */
export const createFoliumMountScope = <Ctx>(
    ctx: FoliumHostContext<Ctx>,
    modId: string,
    where: string,
    container: HTMLElement,
    piece?: FoliumFaultPiece,
): FoliumMountScope<Ctx> => {
    const owned = createFoliumMountView<Ctx>(ctx, modId, where, piece);
    const scope = createFoliumScope(modId, where, piece);
    const helpers: Omit<FoliumMountHelpers, 'onChange'> = {
        onFrame: scope.onFrame,
        onResize: (listener) => scope.onResize(container, listener),
        every: scope.every,
        onDispose: scope.onDispose,
    };
    const end = () => {
        scope.end();
        owned.release();
    };
    const adopt = (result: unknown) => {
        if (typeof result === 'function') {
            // Given last, so it runs first: before what the mount handed to onDispose.
            scope.onDispose(result as FoliumDisposer);
        } else if (result instanceof Promise) {
            // An async mount. A disposer that arrives after the mount ended runs at once (onDispose
            // does that). A rejection is reported by the gate, and the mount is over: what it had
            // started stops now, as for a mount that threw (FoliumMountHost.tsx).
            result.then(adopt, end);
        }
    };
    return {
        ctx: Object.freeze({ ...owned.view, ...helpers }) as unknown as Ctx,
        adopt,
        end,
    };
};
