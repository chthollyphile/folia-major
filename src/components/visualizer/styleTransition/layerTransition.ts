import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { progressSince } from '../../../services/automix/handoffProgress';

// src/components/visualizer/styleTransition/layerTransition.ts
// What a lyric style switch and a background change share. A layer is one style or one background in
// its own box: while a change plays the one on screen leaves and the new one comes in, and at most two
// are mounted (each can hold a WebGL context). The animations are the browser's own, on the box's
// opacity, filter and transform, so they keep going while a new layer's first mount holds up the page.
// A change can wait before it starts: the new layer is mounted at once but not shown, the one on screen
// stays as it is, and both animations start together once the change is started (a style switch waits
// for the new style's first frame, VisualizerStyleTransition; a background change made with it, for it).

/** How a layer change looks (softFocus.ts). */
export interface LayerTransition {
    /** How the layer on screen leaves: the look it goes to. */
    leave: { to: Keyframe; duration: number; delay?: number; easing: string };
    /** How the new layer comes in: the look it comes from. */
    enter: { from: Keyframe; duration: number; delay?: number; easing: string };
    /** Where given, the change plays along this, 0..1, instead of the clock (alongProgress). */
    progress?: MotionValue<number>;
}

/**
 * `transition` played along `progress` (0..1) instead of the clock: a blend's song hand-off, which
 * takes as long as the blend (VisualizerRenderer). The same looks, from the first frame and evenly, as
 * `progress` brings its own curve. The length is what plays on the clock if the hand-off stops short
 * (settled early, called off): the rest of the change, at the transition's own speed.
 */
export const alongProgress = (transition: LayerTransition, progress: MotionValue<number>): LayerTransition => {
    const length = (transition.enter.delay ?? 0) + transition.enter.duration;
    return {
        leave: { ...transition.leave, delay: 0, duration: length, easing: 'linear' },
        enter: { ...transition.enter, delay: 0, duration: length, easing: 'linear' },
        progress,
    };
};

/**
 * Holds `animation` where `progress` puts it along its `length` (ms), counted from where `progress`
 * stood when it began, so a layer that starts late comes in rather than jumps. It ends once `progress`
 * reaches 1; the release returned plays the rest on the clock instead. Where `progress` is at 1
 * already there is nothing left to follow: it plays on the clock, and null is returned.
 */
const followProgress = (animation: Animation, progress: MotionValue<number>, length: number): (() => void) | null => {
    const start = Math.min(1, Math.max(0, progress.get()));
    if (start >= 1) {
        if (animation.playState === 'paused') animation.play();
        return null;
    }
    let following = true;
    const stop = () => {
        following = false;
        unsubscribe();
    };
    const seek = (value: number) => {
        if (!following) return;
        const along = progressSince(value, start);
        if (along >= 1) {
            stop();
            animation.finish();
            return;
        }
        animation.currentTime = along * length;
    };
    animation.pause();
    const unsubscribe = progress.on('change', seek);
    seek(progress.get());
    return () => {
        if (!following) return;
        stop();
        animation.play();
    };
};

/** The release of an enter that follows no progress any more, or never did. */
const followed = () => {};

/** One layer, keyed per change, so a value shown again is mounted again. */
export interface ShownLayer<T> {
    key: number;
    value: T;
    leaving: boolean;
    comesIn: boolean;
    /** Its change has not started: a new layer stays unseen, a leaving one stays as it is. */
    waits: boolean;
}

/** Every layer of a change that waits, started. */
const started = <T>(layers: readonly ShownLayer<T>[]): readonly ShownLayer<T>[] => layers.map(layer => ({ ...layer, waits: false }));

/**
 * The layers once `value` is the one to show. With a transition the layer on screen leaves and the new
 * one comes in; at most two are mounted, so one still leaving from an earlier change goes at once.
 * `waits` says whether a change made now waits to start, and a change that waits starts once `waits`
 * is false or startedLayers starts it. A new change made while one waits replaces it: the layer on
 * screen is still the one leaving, and a change back to it ends the change. A change back to the layer
 * still leaving while the new one comes in (a blend called off) ends it too: that layer stays, and the
 * new one leaves from where it got to, drawn over it; a change after that goes on from the layer on
 * screen, and the one leaving over it goes at once. Without a transition, the new layer only, and a
 * change still playing when transitions are turned off ends at once.
 */
export const nextShownLayers = <T>(
    layers: readonly ShownLayer<T>[],
    value: T,
    animate: boolean,
    waits: boolean,
): readonly ShownLayer<T>[] => {
    const top = layers[layers.length - 1];
    // The layers without one leaving over the layer on screen (a change called back).
    const below = top.leaving && layers.length > 1 ? layers.slice(0, -1) : layers;
    const current = below[below.length - 1];
    if (current.value === value) {
        if (!animate) return layers.length === 1 && !current.waits ? layers : [{ ...current, waits: false }];
        return current.waits && !waits ? started(layers) : layers;
    }
    const next: ShownLayer<T> = { key: top.key + 1, value, leaving: false, comesIn: animate, waits: animate && waits };
    if (!animate) return [next];
    const onScreen = below.length > 1 ? below[below.length - 2] : null;
    if (!current.waits) {
        if (onScreen?.value === value) return [{ ...onScreen, leaving: false, waits: false }, { ...current, leaving: true, waits: false }];
        return [{ ...current, leaving: true, waits: next.waits }, next];
    }
    if (!onScreen) return [next];
    if (onScreen.value === value) return [{ ...onScreen, leaving: false, waits: false }];
    return [{ ...onScreen, waits: next.waits }, next];
};

/** The layers once the change to the layer `key` starts: the same ones unless it is the newest and waits. */
export const startedLayers = <T>(layers: readonly ShownLayer<T>[], key: number): readonly ShownLayer<T>[] => {
    const current = layers[layers.length - 1];
    return current.key === key && current.waits ? started(layers) : layers;
};

/** How long after its leave should have ended a leaving layer is removed when no finish event came. */
export const LEAVE_FALLBACK_MARGIN_MS = 1000;

/**
 * The layers to draw for `value`, oldest first (the new one is drawn over the leaving one), what a
 * layer calls once it has left, and what starts the change to a layer that waits. The first value is
 * there from the start, without a transition. `waits` as for nextShownLayers.
 */
export const useShownLayers = <T>(
    value: T,
    animate: boolean,
    waits: boolean,
): readonly [readonly ShownLayer<T>[], (key: number) => void, (key: number) => void] => {
    const [layers, setLayers] = useState<readonly ShownLayer<T>[]>(() => [{ key: 0, value, leaving: false, comesIn: false, waits: false }]);
    const shown = nextShownLayers(layers, value, animate, waits);
    if (shown !== layers) setLayers(shown);
    const onLeft = useCallback((key: number) => {
        setLayers(list => list.filter(layer => layer.key !== key));
    }, []);
    const onStart = useCallback((key: number) => {
        setLayers(list => startedLayers(list, key));
    }, []);
    return [shown, onLeft, onStart];
};

/**
 * Plays a layer's transition on its box: the enter when it mounts coming in (fixed then, so a setting
 * changed later does not play it again), and the leave once it is leaving, after which it calls
 * `onLeft`; both once the change has started. A layer without a box, or without a transition, has left
 * at once. `hold`, where given, is called while the layer waits or plays its transition, and what it
 * returns once that is over. A transition with `progress` plays along it; the enter plays the rest on
 * the clock once the layer's transition no longer follows that progress (the hand-off is over).
 */
export const useLayerAnimation = (
    ref: RefObject<HTMLElement | null>,
    layer: ShownLayer<unknown>,
    transition: LayerTransition | null,
    onLeft: (key: number) => void,
    hold?: () => () => void,
) => {
    const comingRef = useRef<Animation | null>(null);
    /** Ends the enter's following of its progress; a no-op once it has ended. */
    const releaseComingRef = useRef<(() => void) | null>(null);
    const [enter] = useState(() => (layer.comesIn && transition ? { ...transition.enter, progress: transition.progress } : null));
    const { key, leaving, waits } = layer;

    useLayoutEffect(() => {
        const element = ref.current;
        if (!enter || !element || typeof element.animate !== 'function') return undefined;
        const { from, delay, duration, easing } = enter;
        const animation = element.animate([{ ...from, offset: 0 }], { delay, duration, easing, fill: 'backwards' });
        comingRef.current = animation;
        const release = hold?.();
        if (release) animation.finished.then(release, release);
        return () => {
            releaseComingRef.current?.();
            animation.cancel();
            release?.();
        };
    }, [ref, enter, hold]);

    // Held at the look it comes from, unseen, until its change starts. One that is called away while
    // still coming in goes on coming in until its leave starts.
    const enterWaits = waits && !leaving;
    // Along the hand-off it came in on while that hand-off runs. Once it is over (settled, called off),
    // on the clock: the rest of the way, or all of it for one that was still waiting then - nothing
    // moves that progress any more, and following it would hold the layer at its first look. Only that
    // once: the next blend sets the same progress back to 0, and following it would rewind the layer.
    const followsProgress = Boolean(enter?.progress) && transition?.progress === enter?.progress;
    useLayoutEffect(() => {
        const coming = comingRef.current;
        if (!coming) return;
        if (enterWaits) coming.pause();
        else if (followsProgress && enter?.progress) {
            releaseComingRef.current ??= followProgress(coming, enter.progress, (enter.delay ?? 0) + enter.duration) ?? followed;
        } else {
            releaseComingRef.current?.();
            releaseComingRef.current = followed;
            if (coming.playState === 'paused') coming.play();
        }
    }, [enter, enterWaits, followsProgress]);

    useLayoutEffect(() => {
        if (!leaving) return undefined;
        const element = ref.current;
        if (!transition || !element || typeof element.animate !== 'function') {
            onLeft(key);
            return undefined;
        }
        if (waits) return undefined;
        const coming = comingRef.current;
        if (coming?.playState === 'running' || coming?.playState === 'paused') {
            // Called away while still coming in (on the clock or along a hand-off): it leaves from
            // where it got to.
            try {
                coming.commitStyles();
            } catch {
                // Not rendered: it leaves from its full look.
            }
            releaseComingRef.current?.();
            coming.cancel();
        }
        const { to, ...timing } = transition.leave;
        const animation = element.animate([{ ...to, offset: 1 }], { ...timing, fill: 'forwards' });
        animation.onfinish = () => onLeft(key);
        const length = (timing.delay ?? 0) + timing.duration;
        // Along a hand-off it ends when the hand-off does; once that is over the transition is another
        // one, and this runs again on the clock.
        const stopFollowing = transition.progress ? followProgress(animation, transition.progress, length) : null;
        // The finish event waits while the window is hidden, and never comes for an animation cancelled
        // from outside; either way the layer (maybe a WebGL context) would stay mounted. The timer
        // counts from here, while the animation starts with the next frame, which the new layer's
        // first mount can hold up: the margin keeps the timer from cutting a fade that started late.
        const fallback = stopFollowing ? undefined : window.setTimeout(() => onLeft(key), length + LEAVE_FALLBACK_MARGIN_MS);
        const release = hold?.();
        return () => {
            window.clearTimeout(fallback);
            stopFollowing?.();
            animation.cancel();
            release?.();
        };
    }, [ref, leaving, waits, transition, onLeft, key, hold]);
};
