import { describe, expect, it } from 'vitest';
import { NebbiaCondensation } from '@/components/visualizer/nebbia/nebbiaCondensation';

// test/unit/visualizer/nebbiaCondensation.test.ts
// 凝露玻璃上的冷凝水珠：都是细小水珠（没有大水珠），刚铺时陆续凝出来，暂停时不动，挂久了会缩没、在别处再凝出来。

const W = 1600, H = 900;
// 每颗固定一格，还没凝出来、缩没了的那格宽为 0：只看得见的
const radii = (inst: number[]) => inst.filter((w, i) => i % 6 === 2 && w > 0).map(w => w / 8);
const xsOf = (inst: number[]) => inst.filter((_, i) => i % 6 === 0).filter((_, j) => inst[j * 6 + 2] > 0);
const run = (c: NebbiaCondensation, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 30) c.instances(1 / 30);
    return Array.from(c.instances(0));
};

describe('NebbiaCondensation', () => {
    it('seeps in gradually and keeps every droplet tiny', () => {
        const c = new NebbiaCondensation();
        c.build(W, H);
        const early = radii(run(c, 1)).length;
        const full = run(c, 20);
        expect(radii(full).length).toBeGreaterThan(early * 3);
        expect(radii(full).length).toBeGreaterThan(W * H / 81 * 0.8);
        expect(Math.max(...radii(full))).toBeLessThanOrEqual(4.3);
        expect(full.every(Number.isFinite)).toBe(true);
    });

    it('scales count with dew and radius with size', () => {
        const c = new NebbiaCondensation();
        c.build(W, H);
        run(c, 20);
        const full = c.instances(0).length;
        expect(c.instances(0, 0.5).length).toBeLessThan(full * 0.6);
        expect(c.instances(0, 0).length).toBe(0);
        const big = radii(Array.from(c.instances(0, 1, 2)));
        expect(Math.max(...big)).toBeGreaterThan(6);
    });

    it('only rewrites every 50 ms, and not at all while frozen', () => {
        const c = new NebbiaCondensation();
        c.build(W, H);
        // 刚铺时陆续凝出来，正在长的那些要改
        run(c, 3);
        c.instances(0.06);
        expect(c.changed).toBe(true);
        c.instances(0.01);
        expect(c.changed).toBe(false);
        for (let i = 0; i < 10; i += 1) c.instances(0);
        expect(c.changed).toBe(false);
        // 都长足了、还没开始缩的那一阵，到点更新也没有要改的
        run(c, 17);
        c.instances(0.06);
        expect(c.changed).toBe(false);
        // 大小、多少一变就重写
        c.instances(0, 1, 1.2);
        expect(c.changed).toBe(true);
        c.instances(0, 0.8, 1.2);
        expect(c.changed).toBe(true);
    });

    it('freezes while dt is 0', () => {
        const c = new NebbiaCondensation();
        c.build(W, H);
        const a = run(c, 3);
        for (let i = 0; i < 60; i += 1) c.instances(0);
        expect(Array.from(c.instances(0))).toEqual(a);
    });

    it('droplets evaporate and re-form elsewhere over time', () => {
        const c = new NebbiaCondensation();
        c.build(W, H);
        const xs = new Set(xsOf(run(c, 20)));
        const later = xsOf(run(c, 90));
        const moved = later.filter(x => !xs.has(x)).length;
        expect(moved).toBeGreaterThan(later.length * 0.5);
    });
});
