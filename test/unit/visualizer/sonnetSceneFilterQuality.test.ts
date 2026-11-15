import { describe, expect, it } from 'vitest';
import {
    resolveSonnetSceneFilterAntialias,
    SONNET_TRANSITION_BLUR_RESOLUTION_SHARE,
} from '@/components/visualizer/sonnet/sonnetSceneBuilder';

// test/unit/visualizer/sonnetSceneFilterQuality.test.ts
// The filters on a Sonnet scene container must not fall back to Pixi's defaults (resolution 1,
// antialias off): one container's enabled filters run as a single pass at the lowest resolution
// among them, unsmoothed as soon as one refuses, so a transition used to redraw the whole scene
// at one pixel per CSS pixel whatever the 分辨率 and 抗锯齿 settings said. Nothing on screen
// shows the regression until someone runs a 2x canvas, hence this lock on the rules.
describe('Sonnet scene filter antialiasing', () => {
    it('switches every pass off when 抗锯齿 is 关, the post-process chain included', () => {
        expect(resolveSonnetSceneFilterAntialias('off', false)).toBe('off');
        expect(resolveSonnetSceneFilterAntialias('off', true)).toBe('off');
    });

    it('matches the post-process chain, which multisamples its own pass', () => {
        // The canvas is not multisampled by default while post-processing is on, so 'inherit'
        // would take the smoothing away from the chain for as long as a transition filter is on.
        expect(resolveSonnetSceneFilterAntialias('auto', true)).toBe('on');
        expect(resolveSonnetSceneFilterAntialias('on', true)).toBe('on');
    });

    it('follows the canvas when 抗锯齿 is 开 and there is no chain', () => {
        expect(resolveSonnetSceneFilterAntialias('on', false)).toBe('inherit');
    });

    it('leaves the transition passes unsampled on 自动 without a chain', () => {
        // A 4-sample target at the canvas resolution stays in the texture pool for good; the
        // default tier does not pay that for a pass that tears or blurs the picture anyway.
        expect(resolveSonnetSceneFilterAntialias('auto', false)).toBe('off');
    });
});

describe('Sonnet transition blur resolution', () => {
    it('is a share of the canvas resolution, not a fixed number', () => {
        // A fixed 0.5 on a 3x canvas stretched the scene sixfold while the blur was on.
        expect(SONNET_TRANSITION_BLUR_RESOLUTION_SHARE).toBeGreaterThan(0);
        expect(SONNET_TRANSITION_BLUR_RESOLUTION_SHARE).toBeLessThanOrEqual(1);
        expect(3 * SONNET_TRANSITION_BLUR_RESOLUTION_SHARE).toBeGreaterThanOrEqual(1.5);
    });
});
