import { describe, expect, it } from 'vitest';
import { normalizeNebbiaTuning } from '@/components/visualizer/nebbia/tuning';
import { DEFAULT_NEBBIA_TUNING } from '@/components/visualizer/nebbia/types';

// test/unit/visualizer/nebbiaTuning.test.ts
// 雾笺 tuning 的分辨率一项（#929）：旧存档的 resolution 滑块值换成共用的分辨率倍数，新存档的 render 原样读回。

const GLOBAL = { scale: 'global', antialias: 'global' };

describe('nebbia render override', () => {
    it('follows the global level when nothing about resolution is stored', () => {
        expect(normalizeNebbiaTuning({}).render).toEqual(GLOBAL);
        expect(normalizeNebbiaTuning(null).render).toEqual(GLOBAL);
        expect(normalizeNebbiaTuning({ mist: 0.5 })).toEqual({ ...DEFAULT_NEBBIA_TUNING, mist: 0.5 });
    });

    it('follows the global level for an old save whose resolution is 1', () => {
        expect(normalizeNebbiaTuning({ resolution: 1 }).render).toEqual(GLOBAL);
    });

    it('turns an old resolution other than 1 into the nearest scale', () => {
        const scaleOf = (resolution: unknown) => normalizeNebbiaTuning({ resolution }).render.scale;
        expect(scaleOf(0.5)).toBe(0.5);
        expect(scaleOf(0.75)).toBe(0.75);
        expect(scaleOf(1.5)).toBe(1.5);
        expect(scaleOf(2)).toBe(2);
        // 两边一样近取大的那个
        expect(scaleOf(1.25)).toBe(1.5);
        expect(scaleOf(1.75)).toBe(2);
        expect(scaleOf(0.6)).toBe(0.5);
        // 越界的先夹进旧滑块的范围（0.5–2），不是数就当 1
        expect(scaleOf(0)).toBe(0.5);
        expect(scaleOf(9)).toBe(2);
        expect(scaleOf('2')).toBe('global');
        expect(normalizeNebbiaTuning({ resolution: 1.5 }).render.antialias).toBe('global');
    });

    it('reads a stored render as it is and ignores an old resolution beside it', () => {
        expect(normalizeNebbiaTuning({ render: { scale: 0.75, antialias: 'global' } }).render).toEqual({ scale: 0.75, antialias: 'global' });
        expect(normalizeNebbiaTuning({ render: GLOBAL, resolution: 2 }).render).toEqual(GLOBAL);
    });

    it('falls back to global for values it does not know', () => {
        expect(normalizeNebbiaTuning({ render: { scale: 1.25, antialias: 'auto' } }).render).toEqual(GLOBAL);
        expect(normalizeNebbiaTuning({ render: 'sharp' }).render).toEqual(GLOBAL);
    });

    it('does not keep the old resolution field in what it reads', () => {
        expect(normalizeNebbiaTuning({ resolution: 1.5 })).not.toHaveProperty('resolution');
    });
});
