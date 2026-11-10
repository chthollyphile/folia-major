import type { CSSProperties } from 'react';
import { KIT_EASE } from '../modal/settings/kit/motion';
import { overlayBackdropMotion, overlayPanelCalmMotion, overlayPanelMotion } from '../shared/overlayEntranceMotion';
import './ponder.css';

// src/components/ponder/ponderMotion.ts
// The motion of Ponder's own interface, written down once: four durations and three easings.
// CSS reads them as the --pd-* variables a Ponder layer sets on its root (ponderMotionTokens),
// framer-motion takes ponderTransition, and the lesson timeline (usePonderTimeline) reads the
// numbers. A lesson step's own durationMs is the lesson's and is not one of these.
//
// With the app's reduce-motion setting for interface motion on: fades take the quick time and are
// linear, nothing travels and nothing shifts or scales. What shows time (the timeline's fill, the
// hold fill, the countdown) does not read these.

/** Milliseconds. */
export const PONDER_MOTION = {
    /** Hover, a press, something leaving. */
    quick: 120,
    /** A text or an icon changing, a small thing appearing. */
    base: 200,
    /** A layer, a window or a part arriving. */
    enter: 280,
    /** Something travelling from one place to another: the focus frame, a selection, a segment. */
    move: 420,
} as const;

export type PonderDuration = keyof typeof PONDER_MOTION;

type CubicBezier = [number, number, number, number];

/** The third easing is linear: for what shows time, and for everything when motion is reduced. */
export const PONDER_EASE: Record<'arrive' | 'travel', CubicBezier> = {
    /** Arrive and settle: the curve of the app's overlays and of the settings kit. */
    arrive: KIT_EASE.out,
    /** Travel: even at both ends. */
    travel: [0.65, 0, 0.35, 1],
};

/** How far a text or a small part rises as it comes in, px. */
export const PONDER_RISE_PX = 6;

/** A duration as it runs now: reduced motion shortens fades to the quick time and makes travel instant. */
export const ponderMs = (duration: PonderDuration, calm: boolean): number => {
    if (!calm) {
        return PONDER_MOTION[duration];
    }
    return duration === 'move' ? 0 : PONDER_MOTION.quick;
};

const bezier = (points: CubicBezier) => `cubic-bezier(${points.join(', ')})`;

/** The vocabulary as CSS variables, for the `style` of a Ponder layer's root. */
export const ponderMotionTokens = (calm: boolean): CSSProperties => ({
    '--pd-dur-quick': `${ponderMs('quick', calm)}ms`,
    '--pd-dur-base': `${ponderMs('base', calm)}ms`,
    '--pd-dur-enter': `${ponderMs('enter', calm)}ms`,
    '--pd-dur-move': `${ponderMs('move', calm)}ms`,
    '--pd-ease-arrive': calm ? 'linear' : bezier(PONDER_EASE.arrive),
    '--pd-ease-travel': calm ? 'linear' : bezier(PONDER_EASE.travel),
    '--pd-rise': calm ? '0px' : `${PONDER_RISE_PX}px`,
} as CSSProperties);

/** A framer-motion transition of the vocabulary. */
export const ponderTransition = (duration: PonderDuration, calm: boolean, ease: 'arrive' | 'travel' = 'arrive') => ({
    duration: ponderMs(duration, calm) / 1000,
    ease: calm ? ('linear' as const) : PONDER_EASE[ease],
});

/**
 * A text or a list giving way to the next one, for a keyed child of AnimatePresence mode="wait":
 * the old one leaves upward in the quick time, then the new one rises in.
 */
export const ponderSwapMotion = (calm: boolean) => ({
    initial: { opacity: 0, y: calm ? 0 : PONDER_RISE_PX },
    animate: { opacity: 1, y: 0, transition: ponderTransition('enter', calm) },
    exit: { opacity: 0, y: calm ? 0 : -4, transition: ponderTransition('quick', calm) },
});

/**
 * How a Ponder layer (the stage, the index) comes over the app and leaves: the shapes of
 * overlayEntranceMotion, arriving in the enter time and leaving in the base time.
 */
export const ponderLayerMotion = (calm: boolean) => {
    const enter = ponderTransition('enter', calm);
    const leave = ponderTransition('base', calm);
    const panel = calm ? overlayPanelCalmMotion : overlayPanelMotion;
    return {
        backdrop: {
            initial: overlayBackdropMotion.initial,
            animate: { ...overlayBackdropMotion.animate, transition: enter },
            exit: { ...overlayBackdropMotion.exit, transition: leave },
        },
        panel: {
            initial: panel.initial,
            animate: { ...panel.animate, transition: enter },
            exit: { ...panel.exit, transition: leave },
        },
    };
};
