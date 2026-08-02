import { describe, expect, it } from 'vitest';
import { resolveSonnetTextFixedGeoPlan } from '@/components/visualizer/sonnet/sonnetTextFixedGeo';

// test/unit/visualizer/sonnetTextFixedGeo.test.ts
// Locks the two-level fixed-geometry selection without requiring a Pixi renderer.
describe('Sonnet text fixed geometry', () => {
    it('preserves the normal 50/50 hollow and solid category split', () => {
        const plans = Array.from({ length: 400 }, (_, seed) => resolveSonnetTextFixedGeoPlan(seed, false));
        expect(plans.filter(plan => plan.category === 'hollow')).toHaveLength(200);
        expect(plans.filter(plan => plan.category === 'solid')).toHaveLength(200);
    });

    it('preserves the chorus 90/10 hollow and solid category split', () => {
        const plans = Array.from({ length: 300 }, (_, seed) => resolveSonnetTextFixedGeoPlan(seed, true));
        expect(plans.filter(plan => plan.category === 'hollow')).toHaveLength(270);
        expect(plans.filter(plan => plan.category === 'solid')).toHaveLength(30);
    });

    it('shares solid-category probability across all three solid designs', () => {
        const variants = new Set(
            Array.from({ length: 400 }, (_, seed) => resolveSonnetTextFixedGeoPlan(seed, false))
                .filter(plan => plan.category === 'solid')
                .map(plan => plan.variant),
        );
        expect(variants).toEqual(new Set(['orb-hatch', 'music-steps', 'bent-lines']));
    });
});
