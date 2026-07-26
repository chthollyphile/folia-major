import { describe, expect, it } from 'vitest';
import {
    resolvePendoloChorusPresentation,
    resolvePendoloMotionProfile,
} from '@/components/visualizer/pendolo/pendoloMotionProfile';

// test/unit/visualizer/pendoloMotionProfile.test.ts

describe('Pendolo motion profile', () => {
    it('orders calm, normal, and chaotic mechanical motion from restrained to energetic', () => {
        const calm = resolvePendoloMotionProfile('calm');
        const normal = resolvePendoloMotionProfile('normal');
        const chaotic = resolvePendoloMotionProfile('chaotic');

        expect(calm.balanceSpeedMultiplier).toBeLessThan(normal.balanceSpeedMultiplier);
        expect(normal.balanceSpeedMultiplier).toBeLessThan(chaotic.balanceSpeedMultiplier);
        expect(calm.balanceAmplitudeMultiplier).toBeLessThan(normal.balanceAmplitudeMultiplier);
        expect(normal.balanceAmplitudeMultiplier).toBeLessThan(chaotic.balanceAmplitudeMultiplier);
        expect(calm.escapementSpringMultiplier).toBeLessThan(normal.escapementSpringMultiplier);
        expect(normal.escapementSpringMultiplier).toBeLessThan(chaotic.escapementSpringMultiplier);
        expect(calm.chorusHaloOpacity).toBeLessThan(normal.chorusHaloOpacity);
        expect(normal.chorusHaloOpacity).toBeLessThanOrEqual(chaotic.chorusHaloOpacity);
    });

    it('falls back to the normal profile for missing or invalid intensity', () => {
        expect(resolvePendoloMotionProfile(undefined)).toEqual(resolvePendoloMotionProfile('normal'));
        expect(resolvePendoloMotionProfile('turbo')).toEqual(resolvePendoloMotionProfile('normal'));
    });

    it('only enables chorus treatment for the playback-active chorus line', () => {
        const profile = resolvePendoloMotionProfile('normal');

        expect(resolvePendoloChorusPresentation(true, true, profile).isActive).toBe(true);
        expect(resolvePendoloChorusPresentation(true, false, profile)).toMatchObject({
            isActive: false,
            haloOpacity: 0,
            glowMultiplier: 0,
        });
        expect(resolvePendoloChorusPresentation(false, true, profile).isActive).toBe(false);
    });
});
