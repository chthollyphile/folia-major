import { describe, expect, it } from 'vitest';
import { DEFAULT_SONNET_TUNING, type Theme } from '@/types';
import { resolveSonnetPostProcessProfile } from '@/components/visualizer/sonnet/sonnetPostProcess';

// test/unit/visualizer/sonnetPostProcess.test.ts
// Locks bounded glow/noise strength and static-mode filter suppression.
const theme = {
    animationIntensity: 'normal',
} as Theme;

describe('Sonnet post-process profile', () => {
    it('keeps glow and film noise within restrained limits', () => {
        const profile = resolveSonnetPostProcessProfile(theme, DEFAULT_SONNET_TUNING, false);

        expect(profile.glowStrength).toBeGreaterThan(3);
        expect(profile.glowAlpha).toBeLessThanOrEqual(0.62);
        expect(profile.noise).toBeGreaterThan(0);
        expect(profile.noise).toBeLessThanOrEqual(0.055);
    });

    it('disables filter passes in static mode', () => {
        expect(resolveSonnetPostProcessProfile(theme, DEFAULT_SONNET_TUNING, true))
            .toEqual({ glowStrength: 0, glowAlpha: 0, noise: 0 });
    });

    it('scales with theme animation intensity without exceeding caps', () => {
        const calm = resolveSonnetPostProcessProfile(
            { ...theme, animationIntensity: 'calm' },
            DEFAULT_SONNET_TUNING,
            false,
        );
        const chaotic = resolveSonnetPostProcessProfile(
            { ...theme, animationIntensity: 'chaotic' },
            DEFAULT_SONNET_TUNING,
            false,
        );

        expect(chaotic.glowStrength).toBeGreaterThan(calm.glowStrength);
        expect(chaotic.noise).toBeLessThanOrEqual(0.055);
    });
});
