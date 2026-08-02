import { describe, expect, it } from 'vitest';
import type { SonnetParagraph, SonnetShot, SonnetTransitionKind } from '@/components/visualizer/sonnet/types';
import {
    IDLE_SONNET_TRANSITION_FRAME,
    resolveSonnetEnterTransitionFrame,
    resolveSonnetExitTransitionFrame,
    resolveSonnetShotTransitionFrame,
    resolveSonnetTransitionEffectFrame,
} from '@/components/visualizer/sonnet/sonnetTransitions';

// test/unit/visualizer/sonnetTransitions.test.ts
// Locks Sonnet's optional, deterministic, monochrome scene-transition frames.
const paragraph = (kind: SonnetTransitionKind): SonnetParagraph => ({
    id: 'paragraph',
    kind: 'verse',
    boundary: 'time-gap',
    startTime: 1,
    endTime: 4,
    lines: [],
    shots: [],
    transitionOut: { kind, startTime: 3.8, endTime: 4 },
});
const shot = (id: string, startTime: number, endTime: number): SonnetShot => ({
    id,
    kind: 'editorial-column',
    startTime,
    endTime,
    lineIndices: [],
    cues: [],
    camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
});

describe('Sonnet scene transitions', () => {
    it('returns the idle frame when transitions are disabled', () => {
        expect(resolveSonnetExitTransitionFrame(paragraph('fast-blur'), 3.9, false, 42))
            .toBe(IDLE_SONNET_TRANSITION_FRAME);
        expect(resolveSonnetEnterTransitionFrame('camera-pull', 0.1, 0.2, false, 42))
            .toBe(IDLE_SONNET_TRANSITION_FRAME);
    });

    it('applies fast blur only inside the transition window', () => {
        expect(resolveSonnetExitTransitionFrame(paragraph('fast-blur'), 3.7, true, 42))
            .toBe(IDLE_SONNET_TRANSITION_FRAME);
        const frame = resolveSonnetExitTransitionFrame(paragraph('fast-blur'), 3.9, true, 42);
        expect(frame.blur).toBeGreaterThan(0);
        expect(frame.alpha).toBeLessThan(1);
    });

    it('keeps the glitch deterministic and free of color-channel state', () => {
        const first = resolveSonnetTransitionEffectFrame('mono-glitch', 'exit', 0.55, 1234);
        const second = resolveSonnetTransitionEffectFrame('mono-glitch', 'exit', 0.55, 1234);
        expect(first).toEqual(second);
        expect(Object.keys(first).sort()).toEqual([
            'alpha', 'blur', 'glitch', 'glitchSeed', 'rotation', 'scale', 'x', 'y',
        ]);
        expect(first.glitch).toBeGreaterThan(0);
        expect(first.x).toBe(0);
        expect(first.y).toBe(0);
    });

    it('resolves camera pull as a short zoom that settles at identity', () => {
        const start = resolveSonnetEnterTransitionFrame('camera-pull', 0, 0.2, true, 7);
        const end = resolveSonnetEnterTransitionFrame('camera-pull', 0.2, 0.2, true, 7);
        expect(start.scale).toBeLessThan(1);
        expect(end).toEqual(IDLE_SONNET_TRANSITION_FRAME);
    });

    it('transitions both sides of every internal layout boundary', () => {
        const shots = [shot('first', 1, 2.8), shot('second', 3, 5)];
        const outgoing = resolveSonnetShotTransitionFrame(shots, 0, 2.9, true, 99);
        const incoming = resolveSonnetShotTransitionFrame(shots, 1, 3.05, true, 99);
        expect(outgoing).not.toEqual(IDLE_SONNET_TRANSITION_FRAME);
        expect(incoming).not.toEqual(IDLE_SONNET_TRANSITION_FRAME);
        expect(resolveSonnetShotTransitionFrame(shots, 0, 2.9, false, 99))
            .toBe(IDLE_SONNET_TRANSITION_FRAME);
    });
});
