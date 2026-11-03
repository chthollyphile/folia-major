// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NebbiaBreathMask, type NebbiaBreath } from '@/components/visualizer/nebbia/nebbiaBreath';
import { NEBBIA_FIXED } from '@/components/visualizer/nebbia/nebbiaConstants';
import type { LaidLine } from '@/components/visualizer/nebbia/nebbiaScene';

// test/unit/visualizer/nebbiaBreath.test.ts
// 白气遮罩只在这一帧要画的气和上一帧不一样时才重画、才加 version（nebbiaGl.ts 按 version 决定传不传纹理）：
// 挂着的那段不重画，慢慢散时只在浓淡变了一级时重画，改尺寸后照画，白气没了清一次就停；
// 同一句的让位白气（糊开旧字）和出场白气共用一个 breath 对象，只差 B 通道时也要重画。

const { breathSpread, breathFade } = NEBBIA_FIXED;

/** 只数清屏和画圆的次数，别的绘图调用都是空的。 */
const fakeContext = () => {
    const calls = { fillRect: 0, arc: 0 };
    const ctx = {
        setTransform() {},
        beginPath() {},
        fill() {},
        fillRect() { calls.fillRect += 1; },
        arc() { calls.arc += 1; },
        createRadialGradient: () => ({ addColorStop() {} }),
        globalCompositeOperation: 'source-over',
        fillStyle: '#000' as unknown,
    };
    return { ctx, calls };
};

/** 一句带着现成白气的句子：drawLine 不必再从排版里算外框。 */
const lineWithBreath = (): LaidLine => {
    const breath: NebbiaBreath = { lobes: [{ x: 100, y: 50, rx: 40, ry: 20 }, { x: 120, y: 60, rx: 15, ry: 15 }], cx: 100, cy: 50, ry: 20 };
    return { breath } as unknown as LaidLine;
};

/** 画一帧：这一帧在 T 秒，这句的气从 t0 起哈、用 spread 秒鼓开、挂到 until；melt 是让位那口（糊开旧字）。 */
const frame = (mask: NebbiaBreathMask, line: LaidLine | null, T: number, t0 = 0, until = 10, spread = breathSpread, melt = true) => {
    mask.begin();
    if (line) mask.drawLine(line, 0, T, t0, until, spread, melt);
    mask.end();
};

describe('nebbia breath mask redraws only when the puffs change', () => {
    let calls: ReturnType<typeof fakeContext>['calls'];

    beforeEach(() => {
        const fake = fakeContext();
        calls = fake.calls;
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fake.ctx as never);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('draws once while the breath hangs, then keeps the canvas as it is', () => {
        const mask = new NebbiaBreathMask();
        mask.resize(800, 400);
        const line = lineWithBreath();
        const start = mask.version;
        frame(mask, line, breathSpread + 1);
        expect(mask.active).toBe(true);
        expect(mask.version).toBe(start + 1);
        const arcs = calls.arc;
        for (let k = 1; k <= 30; k += 1) frame(mask, line, breathSpread + 1 + k / 60);
        expect(mask.version).toBe(start + 1);
        expect(calls.arc).toBe(arcs);
    });

    it('redraws at most once per step of density while it fades out', () => {
        const mask = new NebbiaBreathMask();
        mask.resize(800, 400);
        const line = lineWithBreath();
        const until = 10;
        frame(mask, line, until);
        const start = mask.version;
        const frames = Math.round(breathFade * 60);
        for (let k = 1; k <= frames; k += 1) frame(mask, line, until + k / 60, 0, until);
        const redraws = mask.version - start;
        expect(redraws).toBeGreaterThan(0);
        // 浓淡取整到 0..255，单调变淡：最多 255 级，远少于帧数
        expect(redraws).toBeLessThanOrEqual(256);
        expect(redraws).toBeLessThan(frames / 1.5);
    });

    it('draws again after a resize, even when the puffs are the same', () => {
        const mask = new NebbiaBreathMask();
        mask.resize(800, 400);
        const line = lineWithBreath();
        frame(mask, line, breathSpread + 1);
        const arcs = calls.arc;
        mask.resize(1000, 500);
        const resized = mask.version;
        frame(mask, line, breathSpread + 1.1);
        expect(mask.version).toBe(resized + 1);
        expect(calls.arc).toBeGreaterThan(arcs);
    });

    it('redraws when only the blur of the covered words differs (same breath object)', () => {
        const mask = new NebbiaBreathMask();
        mask.resize(800, 400);
        const line = lineWithBreath();
        // 鼓开到一半：让位那口在 B 通道上糊开旧字，出场那口不糊
        const T = breathSpread * 0.3;
        frame(mask, line, T, 0, 10, breathSpread, true);
        const drawn = mask.version;
        frame(mask, line, T, 0, 10, breathSpread, false);
        expect(mask.version).toBe(drawn + 1);
    });

    it('clears once when the breath is gone, then leaves the canvas alone', () => {
        const mask = new NebbiaBreathMask();
        mask.resize(800, 400);
        const line = lineWithBreath();
        frame(mask, line, breathSpread + 1);
        const drawn = mask.version;
        const clears = calls.fillRect;
        frame(mask, null, breathSpread + 1.1);
        expect(mask.active).toBe(false);
        expect(mask.version).toBe(drawn + 1);
        expect(calls.fillRect).toBe(clears + 1);
        for (let k = 2; k <= 10; k += 1) frame(mask, null, breathSpread + 1 + k / 10);
        expect(mask.version).toBe(drawn + 1);
        expect(calls.fillRect).toBe(clears + 1);
    });
});
