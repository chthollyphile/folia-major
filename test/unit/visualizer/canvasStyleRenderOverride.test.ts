import { describe, expect, it } from 'vitest';
import cadenzaTuning from '@/components/visualizer/cadenza/tuning';
import dioramaTuning from '@/components/visualizer/diorama/tuning';
import fumeTuning from '@/components/visualizer/fume/tuning';
import monetTuning from '@/components/visualizer/monet/tuning';
import { DEFAULT_CADENZA_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_MONET_TUNING } from '@/types';

// test/unit/visualizer/canvasStyleRenderOverride.test.ts
// 镜台、浮名、心象、莫奈 tuning 里的分辨率 / 抗锯齿覆盖（#929）：旧存档没有 render 就全跟随全局，
// 存着的 render 原样读回，不认识的值回退到「跟随全局」，改动只换 render 不碰别的项。

const GLOBAL = { scale: 'global', antialias: 'global' };

/** 四个样式的 storage 放在一张表里比，只看共同的形状。 */
type HeldTuning = Record<string, unknown> & { render: unknown };
type TuningStorage = { read: (stored: unknown) => HeldTuning; merge: (held: HeldTuning, patch: Record<string, unknown>) => HeldTuning };

const styles = [
    { name: 'diorama', tuning: dioramaTuning, defaults: DEFAULT_DIORAMA_TUNING },
    { name: 'fume', tuning: fumeTuning, defaults: DEFAULT_FUME_TUNING },
    { name: 'cadenza', tuning: cadenzaTuning, defaults: DEFAULT_CADENZA_TUNING },
    { name: 'monet', tuning: monetTuning, defaults: DEFAULT_MONET_TUNING },
] as const;

describe.each(styles)('$name render override', ({ tuning, defaults }) => {
    const storage = tuning.storage as unknown as TuningStorage;
    const read = (stored: Record<string, unknown>) => storage.read(stored);

    it('follows the global level for an old save without render', () => {
        expect(read({}).render).toEqual(GLOBAL);
        expect(defaults.render).toEqual(GLOBAL);
    });

    it('reads a stored render back as it is', () => {
        expect(read({ render: { scale: 1.5, antialias: 'off' } }).render).toEqual({ scale: 1.5, antialias: 'off' });
        expect(read({ render: { scale: 0.5, antialias: 'global' } }).render).toEqual({ scale: 0.5, antialias: 'global' });
    });

    it('falls back to the global level for values it does not know', () => {
        expect(read({ render: { scale: 3, antialias: 'auto' } }).render).toEqual(GLOBAL);
        expect(read({ render: { scale: '2', antialias: true } }).render).toEqual(GLOBAL);
        expect(read({ render: 'high' }).render).toEqual(GLOBAL);
    });

    it('merges a change of render alone, keeping the rest of the tuning', () => {
        const held = read({});
        const merged = storage.merge(held, { render: { scale: 2, antialias: 'on' } });
        expect(merged.render).toEqual({ scale: 2, antialias: 'on' });
        expect({ ...merged, render: GLOBAL }).toEqual({ ...held, render: GLOBAL });
        // 不提 render 的改动不动它
        const { render: _render, ...rest } = held;
        expect(storage.merge(merged, rest).render).toEqual({ scale: 2, antialias: 'on' });
    });
});

describe('cadenza reset', () => {
    it('puts back only what its panel shows, keeping the fields only an import gives', () => {
        const storage = cadenzaTuning.storage!;
        const held = { ...DEFAULT_CADENZA_TUNING, fontScale: 1.4, widthRatio: 0.6, render: { scale: 2, antialias: 'global' } } as const;
        expect(storage.reset?.(held, DEFAULT_CADENZA_TUNING)).toEqual({ ...held, render: GLOBAL });
    });
});
