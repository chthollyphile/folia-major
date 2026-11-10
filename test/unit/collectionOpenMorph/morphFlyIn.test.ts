import { describe, expect, it, vi } from 'vitest';
import { flyInAnimation, playFlyIn } from '@/library/suites/grid/transitions/morphFlyIn';
import { collectionMorphFlyIn } from '@/library/suites/grid/transitions/morphGeometry';

// test/unit/collectionOpenMorph/morphFlyIn.test.ts
// A card's entrance as a Web Animation: where it starts, how it is timed, and that it is played once.

describe('flyInAnimation', () => {
    const flyIn = collectionMorphFlyIn({ x: 300, y: -400 }, { x: 0, y: 0 }, 200, 240, 0.5);

    it('starts the card where its push puts it, see-through and a little small, and ends it in its slot', () => {
        const { keyframes } = flyInAnimation(flyIn);
        expect(keyframes).toEqual([
            { opacity: 0, translate: '144.0px -192.0px', scale: '0.94' },
            { opacity: 1, translate: '0px 0px', scale: '1' },
        ]);
    });

    it('moves the card by properties of its own, and leaves `transform` alone', () => {
        for (const keyframe of flyInAnimation(flyIn).keyframes) {
            expect(Object.keys(keyframe).sort()).toEqual(['opacity', 'scale', 'translate']);
        }
    });

    it('takes half a second on the entrance curve, after the delay of the card, in milliseconds', () => {
        const { timing } = flyInAnimation(flyIn);
        expect(timing.duration).toBe(500);
        expect(timing.easing).toBe('cubic-bezier(0.32, 0.72, 0, 1)');
        expect(timing.delay).toBeCloseTo(flyIn.delay * 1000, 9);
        expect(timing.delay).toBeGreaterThan(40);
        expect(timing.delay).toBeLessThanOrEqual(320);
    });

    it('holds the card at its start through the delay, and lets go of it at the end', () => {
        expect(flyInAnimation(flyIn).timing.fill).toBe('backwards');
    });
});

describe('playFlyIn', () => {
    const flyIn = collectionMorphFlyIn({ x: 300, y: -400 }, { x: 0, y: 0 }, 200, 240, 0.5);
    const makeCard = () => ({ animate: vi.fn() });

    it('plays the entrance on the card', () => {
        const card = makeCard();
        playFlyIn(card as unknown as HTMLElement, flyIn);
        const { keyframes, timing } = flyInAnimation(flyIn);
        expect(card.animate).toHaveBeenCalledTimes(1);
        expect(card.animate).toHaveBeenCalledWith(keyframes, timing);
    });

    it('plays it once: the same card given again is left as it is', () => {
        const card = makeCard();
        playFlyIn(card as unknown as HTMLElement, flyIn);
        playFlyIn(card as unknown as HTMLElement, { ...flyIn, x: 0, y: 0 });
        expect(card.animate).toHaveBeenCalledTimes(1);
    });

    it('plays each card its own', () => {
        const first = makeCard();
        const second = makeCard();
        playFlyIn(first as unknown as HTMLElement, flyIn);
        playFlyIn(second as unknown as HTMLElement, flyIn);
        expect(first.animate).toHaveBeenCalledTimes(1);
        expect(second.animate).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the ref is taken back', () => {
        expect(() => playFlyIn(null, flyIn)).not.toThrow();
    });
});
