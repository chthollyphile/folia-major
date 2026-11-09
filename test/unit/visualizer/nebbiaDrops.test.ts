import { describe, expect, it } from 'vitest';
import { NebbiaGlassMotion } from '@/components/visualizer/nebbia/nebbiaDrops';
import { appendNebbiaCredits } from '@/components/visualizer/nebbia/nebbiaCredits';
import type { NebbiaSourceLine } from '@/components/visualizer/nebbia/nebbiaChars';

// test/unit/visualizer/nebbiaDrops.test.ts
// 雾笺玻璃上的水珠：底鼓颠得密时大水珠不会几分钟里掉光，掉落的水珠不再接着原位置的甩痕；
// 片尾的中文曲名能切成几个词（排版才能分两行）。

const W = 1920, H = 1080;
type Drop = { y: number; w: number; fall: unknown; smear: { end: number | null } | null };
// fieldDrops 是私有的，测试直接看
const dropsOf = (motion: NebbiaGlassMotion) => (motion as unknown as { fieldDrops: Drop[] }).fieldDrops;
const bigOnScreen = (motion: NebbiaGlassMotion) => dropsOf(motion).filter(d => d.w >= 26 && d.y < H).length;

/** 按 30 帧每秒推进到 `until` 秒，每 `every` 秒颠一下；每次颠后检查 `onTrigger`。 */
const run = (motion: NebbiaGlassMotion, until: number, every: number, onTrigger?: () => void) => {
    const out: number[] = [];
    let next = 0;
    for (let t = 0; t < until; t += 1 / 30) {
        motion.beginFrame(t, false, false);
        if (t >= next) { motion.trigger(t, 0.65); next += every; onTrigger?.(); }
        motion.fieldInstances(out, 1);
    }
};

describe('nebbia drops on the glass', () => {
    it('keeps the big drops on screen through minutes of kick-driven bumps', () => {
        const motion = new NebbiaGlassMotion();
        motion.buildField(W, H);
        const before = bigOnScreen(motion);
        let falling = 0;
        run(motion, 210, 0.5, () => { falling = Math.max(falling, dropsOf(motion).filter(d => d.fall).length); });
        expect(bigOnScreen(motion)).toBeGreaterThan(before * 0.6);
        // 震落的概率按颠簸间隔打折：同时往下淌的水珠不会堆成几十颗
        expect(falling).toBeLessThan(50);
    });

    it('ends and lets go of a drop\'s swing mark when it starts to fall', () => {
        const motion = new NebbiaGlassMotion();
        motion.buildField(W, H);
        run(motion, 60, 4, () => {
            for (const d of dropsOf(motion)) if (d.fall) expect(d.smear).toBeNull();
        });
    });
});

describe('nebbia end card', () => {
    const lyric: NebbiaSourceLine = { chars: [{ ch: '啊', t: 1, d: 1 }], words: [[0]], t: 1, end: 2, next: Infinity };

    it('splits a Chinese title into words and writes the artist after it', () => {
        const out = appendNebbiaCredits([lyric], '我们的爱情故事永远不会结束了', '某人');
        const [, title, artist] = out;
        expect(title.credits).toBe('title');
        expect(title.words.length).toBeGreaterThan(1);
        expect(artist.credits).toBe('artist');
        expect(artist.t).toBeGreaterThan(title.t);
        expect(out[0].next).toBe(title.t);
    });

    it('adds nothing without a title', () => {
        expect(appendNebbiaCredits([lyric], '  ', '某人')).toHaveLength(1);
    });
});
