import { describe, expect, it } from 'vitest';
import { MACHI_BASE_COC, resolveMachiLens } from '@/components/visualizer/machi/engine/lens';
import { resolveMachiBokehLevel } from '@/components/visualizer/machi/engine/fx/lensPass';
import {
    apertureReadout,
    MACHI_APERTURE_TRACK_MAX,
    machiApertureFromTrack,
    machiApertureToTrack,
} from '@/components/visualizer/machi/cameraControls';
import { MACHI_APERTURE_STOPS } from '@/components/visualizer/machi/types';

// test/unit/visualizer/machi/lens.test.ts
// 町景的景深：f/8、强度 1 是原来的微缩感；光圈每大一档清晰的那一层变薄、离焦圆变大，过渡收得比清晰的那一层慢，
// 拉近时清晰的那一层变浅；
// 强度 0 时没有离焦但移轴还在；散景按离焦圆的大小降到够低的分辨率，那一层里的圆不超过 8 个像素、取样够密又不贵；
// 光圈滑块往右光圈越大，存的是 f 值，不在档上的值落到最近的一档。

const lens = (patch: Partial<{ aperture: number; dof: number; dofRange: number; tiltShift: number }>, zoom = 1) => (
    resolveMachiLens({ aperture: 8, dof: 1, dofRange: 1, tiltShift: 0.3, ...patch }, zoom)
);

describe('resolveMachiLens', () => {
    it('keeps the original miniature look at f/8', () => {
        expect(lens({})).toMatchObject({ focusBand: 3.4, focusFalloff: 7.5, coc: MACHI_BASE_COC });
    });

    it('thins the focus and widens the blur as the aperture opens', () => {
        const f8 = lens({});
        const f28 = lens({ aperture: 2.8 });
        const f14 = lens({ aperture: 1.4 });
        expect(f28.focusBand).toBeLessThan(f8.focusBand);
        expect(f14.focusBand).toBeLessThan(f28.focusBand);
        expect(f14.coc).toBeCloseTo(MACHI_BASE_COC * 8 / 1.4);
        expect(lens({ aperture: 16 }).coc).toBeCloseTo(MACHI_BASE_COC / 2);
        // 过渡比清晰的那一层收得慢：大光圈下仍是一路渐渐虚上去。
        expect(f14.focusFalloff).toBeCloseTo(7.5 / Math.sqrt(8 / 1.4));
        expect(f14.focusFalloff / f8.focusFalloff).toBeGreaterThan(f14.focusBand / f8.focusBand);
        // 移轴不随光圈变。
        expect(f14.tilt).toBeCloseTo(f8.tilt);
    });

    it('gets shallower when zoomed in and wider with the range', () => {
        expect(lens({}, 2).focusBand).toBeCloseTo(1.7);
        expect(lens({ dofRange: 2 }).focusFalloff).toBeCloseTo(15);
    });

    it('drops the depth blur at strength 0 but keeps the tilt-shift', () => {
        const flat = lens({ dof: 0, tiltShift: 0.5 });
        expect(flat.coc).toBe(0);
        expect(flat.tilt).toBeCloseTo(MACHI_BASE_COC * 0.5);
    });
});

describe('resolveMachiBokehLevel', () => {
    it('works at half resolution for small blurs', () => {
        // 默认的 f/8 在 1080p 上（离焦圆约 13 像素）。
        expect(resolveMachiBokehLevel(13)).toMatchObject({ level: 0, scale: 2, levelCoc: 6.5 });
        expect(resolveMachiBokehLevel(13).taps).toBeLessThanOrEqual(34);
        // 1440p 上降到四分之一分辨率。
        expect(resolveMachiBokehLevel(17.3).level).toBe(1);
    });

    it('steps down a level at a time until the largest circle fits', () => {
        [20, 60, 150, 400].forEach(cocPx => {
            const { level, levelCoc, scale, taps } = resolveMachiBokehLevel(cocPx);
            expect(levelCoc * scale).toBeCloseTo(cocPx);
            expect(level === 4 || levelCoc <= 8).toBe(true);
            expect(taps).toBeGreaterThanOrEqual(12);
            expect(taps).toBeLessThanOrEqual(48);
        });
        expect(resolveMachiBokehLevel(60).level).toBe(2);
        expect(resolveMachiBokehLevel(60).levelCoc).toBeCloseTo(7.5);
        // 最虚的设置（强度 2、f/1.4）在 4K 屏上：离焦圆约是画面高度的 13.7%。
        expect(resolveMachiBokehLevel(MACHI_BASE_COC * 2 * (8 / 1.4) * 2160).levelCoc).toBeLessThanOrEqual(10);
        expect(resolveMachiBokehLevel(4000).level).toBe(4);
    });
});

describe('aperture slider', () => {
    it('opens the aperture to the right and stores f-numbers on the stops', () => {
        expect(machiApertureFromTrack(0)).toBe(16);
        expect(machiApertureFromTrack(MACHI_APERTURE_TRACK_MAX)).toBe(1.4);
        MACHI_APERTURE_STOPS.forEach(stop => expect(machiApertureFromTrack(machiApertureToTrack(stop))).toBe(stop));
        expect(machiApertureFromTrack(machiApertureToTrack(3.2))).toBe(2.8);
        expect(machiApertureFromTrack(99)).toBe(1.4);
        expect(apertureReadout(2.8)).toBe('f/2.8');
    });
});
