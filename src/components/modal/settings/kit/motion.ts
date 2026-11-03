import type { CSSProperties } from 'react';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';

// src/components/modal/settings/kit/motion.ts
// The motion of the settings kit, written down once: a few durations and two easings. No part
// carries a number of its own. A part that moves with CSS reads them as the --st-dur-* and
// --st-ease-* variables the settings window sets (kitMotionTokens); a part that moves with
// framer-motion, or draws outside the window, takes kitTransition. With the app's reduce-motion
// setting for interface motion on, every duration is zero, so every one of them is instant.

/** Seconds. */
export const KIT_MOTION = {
    /** A colour change, a control answering a press, a tooltip. */
    fast: 0.12,
    /** Something that travels a short way: a switch's thumb, the mark of a choice, a page coming in. */
    move: 0.22,
    /** Rows, a note or a folded group opening and closing. */
    unfold: 0.3,
    /** Something that is uncovered, or travels from one place to another. */
    show: 0.48,
    /** How long the outline of a landed row takes to show and fade. */
    flash: 2.2,
    /** How long the pointer rests on a part before its tooltip shows. */
    tooltipDelay: 0.4,
    /** How long a part keeps saying that something was done: the tick after a copy. */
    confirm: 1.6,
} as const;

type CubicBezier = [number, number, number, number];

export const KIT_EASE: Record<'out' | 'standard' | 'inOut', CubicBezier> = {
    /** Leaves fast and settles softly: for everything that arrives or travels. */
    out: [0.22, 1, 0.36, 1],
    /** Even at both ends: for colour. */
    standard: [0.4, 0, 0.2, 1],
    /** Slow at both ends: for what leaves one place and lands in another. */
    inOut: [0.65, 0, 0.35, 1],
};

const seconds = (value: number, reduced: boolean) => (reduced ? '0s' : `${value}s`);
const bezier = (points: CubicBezier) => `cubic-bezier(${points.join(', ')})`;

/** The vocabulary as CSS variables, for the `style` of the settings window. */
export const kitMotionTokens = (reduced: boolean): CSSProperties => ({
    '--st-dur-fast': seconds(KIT_MOTION.fast, reduced),
    '--st-dur-move': seconds(KIT_MOTION.move, reduced),
    '--st-dur-unfold': seconds(KIT_MOTION.unfold, reduced),
    '--st-dur-show': seconds(KIT_MOTION.show, reduced),
    '--st-ease-out': bezier(KIT_EASE.out),
    '--st-ease-standard': bezier(KIT_EASE.standard),
    '--st-ease-in-out': bezier(KIT_EASE.inOut),
} as CSSProperties);

/** Whether the kit moves at all: the app's reduce-motion setting for interface motion. */
export const useKitReducedMotion = (): boolean => useReducedMotionFor('uiMicroMotion');

/** A framer-motion transition of the vocabulary. */
export const kitTransition = (duration: 'fast' | 'move' | 'unfold', reduced: boolean) => ({
    duration: reduced ? 0 : KIT_MOTION[duration],
    ease: KIT_EASE.out,
});
