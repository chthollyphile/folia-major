import { useCallback, useEffect, useRef, type DependencyList, type RefObject } from 'react';
import { useFirstFrameDrawn } from '../styleTransition/firstFrame';

// src/components/visualizer/pixi/pixiRuntimeHost.ts
// Mount-once lifecycle for the imperative Pixi directors (tempera, sonnet). Those runtimes used
// to list every song-scoped input in their create effect's dependency array, so a track change
// destroyed the WebGL context, the texture pool and the whole scene cache and rebuilt them from
// scratch - with the canvas gone from the DOM for the whole async build. Here the runtime is
// created once and a song change is handed to it in place, the same way tuning changes already
// were, while the outgoing song keeps rendering until the runtime is ready to swap.

export interface VisualizerPixiHostOptions<TRuntime, TSong> {
    hostRef: RefObject<HTMLDivElement | null>;
    /** Prefix for console output, e.g. `Tempera`. */
    label: string;
    /**
     * Inputs that genuinely require a new runtime (canvas-wide settings, texture pools).
     * Song-scoped inputs must NOT appear here - that is what `song` is for.
     */
    rebuildKey: DependencyList;
    /** Everything that changes per track, as one object whose identity changes with it. */
    song: TSong;
    create: (host: HTMLDivElement, song: TSong, signal: AbortSignal) => Promise<TRuntime>;
    /** Applies a new song to a live runtime. Resolves when the handover has finished. */
    swap: (runtime: TRuntime, song: TSong, signal: AbortSignal) => Promise<void> | void;
    destroy: (runtime: TRuntime) => void;
    /** Reported when `create` fails, so the mode can show its text fallback. */
    onFailedChange?: (failed: boolean) => void;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Returns a ref to the live runtime, for the mode's own live-update effects
 * (`setTuning`, `setPaused`, `setSongMetadata`, ...). It is null before the first
 * `create` resolves and after teardown.
 */
export const useVisualizerPixiHost = <TRuntime, TSong>({
    hostRef,
    label,
    rebuildKey,
    song,
    create,
    swap,
    destroy,
    onFailedChange,
}: VisualizerPixiHostOptions<TRuntime, TSong>) => {
    const runtimeRef = useRef<TRuntime | null>(null);
    const songRef = useRef(song);
    songRef.current = song;
    /** The song the live runtime is actually rendering; null while there is no runtime. */
    const appliedSongRef = useRef<TSong | null>(null);
    const signalRef = useRef<AbortSignal | null>(null);
    const drainingRef = useRef(false);

    // Callbacks behind refs: they are almost always inline arrow functions at the call site, and
    // listing them as dependencies would rebuild the WebGL context on every parent render.
    const createRef = useRef(create);
    createRef.current = create;
    const swapRef = useRef(swap);
    swapRef.current = swap;
    const destroyRef = useRef(destroy);
    destroyRef.current = destroy;
    const onFailedRef = useRef(onFailedChange);
    onFailedRef.current = onFailedChange;
    // The runtimes draw their first frame before `create` resolves, and that frame, its shaders
    // compiled, is the slow part of their start: a style switch waits for it (styleTransition/firstFrame.ts),
    // and for the ticker's first frame after it, which still takes 60 to 90 ms (商籁, 凝彩, 绘光,
    // measured on four slow cores) and otherwise falls at the very start of the switch's transition.
    const firstFrameDrawn = useFirstFrameDrawn();
    const firstFrameDrawnRef = useRef(firstFrameDrawn);
    firstFrameDrawnRef.current = firstFrameDrawn;

    /**
     * Drains towards the newest song rather than queueing one handover per skip. Skipping faster
     * than a handover can finish is ordinary; running all of them back to back would leave the
     * screen wiping for seconds after the user stopped, so the in-flight one finishes and the
     * next hop goes straight to whatever is current by then.
     */
    const drainSong = useCallback(async () => {
        if (drainingRef.current) return;
        drainingRef.current = true;
        try {
            for (;;) {
                const runtime = runtimeRef.current;
                const signal = signalRef.current;
                const next = songRef.current;
                if (!runtime || !signal || signal.aborted || next === appliedSongRef.current) break;
                await swapRef.current(runtime, next, signal);
                // The runtime was torn down or rebuilt while this handover ran; whatever replaced
                // it was built against the current song already.
                if (runtimeRef.current !== runtime || signal.aborted) break;
                appliedSongRef.current = next;
            }
        } catch (error) {
            if (!isAbort(error)) {
                // A failed handover leaves the previous song on screen, which reads far better
                // than punching a hole in the frame.
                console.error(`[${label}] song handover failed`, error);
            }
        } finally {
            drainingRef.current = false;
        }
    }, [label]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return undefined;
        let disposed = false;
        let createdRuntime: TRuntime | null = null;
        let firstTick = 0;
        const abortController = new AbortController();
        signalRef.current = abortController.signal;
        onFailedRef.current?.(false);
        // Read now, but reconciled against the newest value below: the song can move on while
        // Pixi is importing or initializing.
        const initialSong = songRef.current;
        void createRef.current(host, initialSong, abortController.signal)
            .then(runtime => {
                if (disposed) {
                    destroyRef.current(runtime);
                    return;
                }
                createdRuntime = runtime;
                runtimeRef.current = runtime;
                appliedSongRef.current = initialSong;
                // Asked for after the ticker's, so it runs in the same frame, after the ticker has drawn.
                firstTick = requestAnimationFrame(() => firstFrameDrawnRef.current());
                void drainSong();
            })
            .catch(error => {
                if (isAbort(error)) return;
                console.error(`[${label}] Pixi runtime initialization failed`, error);
                if (disposed) return;
                onFailedRef.current?.(true);
                // What shows instead is the mode's text fallback, drawn at once.
                firstFrameDrawnRef.current();
            });
        return () => {
            disposed = true;
            cancelAnimationFrame(firstTick);
            abortController.abort();
            if (signalRef.current === abortController.signal) signalRef.current = null;
            appliedSongRef.current = null;
            const runtime = createdRuntime ?? runtimeRef.current;
            if (runtime) destroyRef.current(runtime);
            runtimeRef.current = null;
            host.replaceChildren();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drainSong, hostRef, label, ...rebuildKey]);

    useEffect(() => {
        void drainSong();
    }, [drainSong, song]);

    return runtimeRef;
};
