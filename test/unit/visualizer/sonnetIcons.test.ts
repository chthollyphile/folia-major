import { describe, expect, it } from 'vitest';
import {
    buildSonnetIconDataUrl,
    buildSonnetIconParticleIndices,
    buildSonnetIconTextureKey,
    resolveSonnetIconEntryDelay,
    resolveSonnetIconEntryDuration,
    resolveSonnetIconEntryPhase,
    resolveSonnetIconNames,
} from '@/components/visualizer/sonnet/sonnetIcons';

// test/unit/visualizer/sonnetIcons.test.ts
// Locks Sonnet theme-icon validation and complete deterministic particle coverage.
describe('Sonnet theme icons', () => {
    it('keeps valid unique Lucide names and ignores invalid values', () => {
        expect(resolveSonnetIconNames(['Moon', 'moon', 'heart', 'not-a-lucide-icon'])).toEqual(['Moon', 'Heart']);
    });

    it('falls back to the Lucide flower when the theme provides no usable icon', () => {
        expect(resolveSonnetIconNames(undefined)).toEqual(['Flower']);
        expect(resolveSonnetIconNames([])).toEqual(['Flower']);
        expect(resolveSonnetIconNames(['not-a-lucide-icon'])).toEqual(['Flower']);
    });

    it('builds theme-colored SVG data and complete cache keys', () => {
        const url = buildSonnetIconDataUrl('Sparkles', '#ff00aa', 1.5, 192);
        expect(url).toContain('data:image/svg+xml');
        expect(decodeURIComponent(url ?? '')).toContain('#ff00aa');
        expect(buildSonnetIconTextureKey('Sparkles', '#fff', 1.5, 192, 2)).toBe('Sparkles|#fff|1.5|192|2');
    });

    it('uses every available theme icon in a bounded scene', () => {
        const plan = buildSonnetIconParticleIndices(12, 12, 7);
        const usedIcons = plan.filter((index): index is number => index !== null);

        expect(new Set(usedIcons)).toEqual(new Set(Array.from({ length: 12 }, (_, index) => index)));
    });

    it('keeps icon placement deterministic and distributed when only a few icons exist', () => {
        const firstPlan = buildSonnetIconParticleIndices(2, 12, -3);
        const secondPlan = buildSonnetIconParticleIndices(2, 12, -3);

        expect(firstPlan).toEqual(secondPlan);
        expect(firstPlan.filter((index): index is number => index !== null)).toHaveLength(3);
        expect(firstPlan.filter((index): index is number => index !== null)).toContain(0);
        expect(firstPlan.filter((index): index is number => index !== null)).toContain(1);
    });

    it('spreads icon entry across the scene and finishes the last reveal before its end', () => {
        const sceneDuration = 6;
        const preferredDuration = 0.7;
        const entryDuration = resolveSonnetIconEntryDuration(sceneDuration, preferredDuration);
        const phases = Array.from({ length: 5 }, (_, index) => resolveSonnetIconEntryPhase(index, 5));
        const delays = phases.map(phase => resolveSonnetIconEntryDelay(phase, sceneDuration, entryDuration));

        expect(phases[0]).toBeCloseTo(0.04);
        expect(phases[4]).toBeCloseTo(0.86);
        expect(delays).toEqual([...delays].sort((left, right) => left - right));
        expect(delays[4] + entryDuration).toBeLessThan(sceneDuration);
    });

    it('shortens icon entry animation for short scenes', () => {
        expect(resolveSonnetIconEntryDuration(0.3, 0.8)).toBeLessThanOrEqual(0.3);
    });
});
