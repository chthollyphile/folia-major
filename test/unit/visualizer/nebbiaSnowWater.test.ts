import { describe, expect, it } from 'vitest';
import { iceParams, iceSizeScale, NebbiaSnowWater } from '@/components/visualizer/nebbia/nebbiaSnowWater';
import { NebbiaSegments } from '@/components/visualizer/nebbia/nebbiaSegments';

// test/unit/visualizer/nebbiaSnowWater.test.ts
// 雪窗玻璃上的水（照 raindrop-fx 改写的那份物理）：碰到的合并、质量相加；钉住的不动；大水珠往下滑、身后分出小水珠，
// 走过的地方擦开雾；并得再多也不超过大小上限。

const W = 1000, H = 1000;
const run = (water: NebbiaSnowWater, seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) water.step(1 / 60); };

describe('nebbia snow water', () => {
    it('merges two touching drops into one that keeps both masses', () => {
        const water = new NebbiaSnowWater();
        water.resize(W, H);
        const a = water.spawn(500, 500, 40), b = water.spawn(503, 500, 30);
        a.pin = { x: 500, y: 500 }; b.pin = { x: 503, y: 500 };
        const before = a.mass + b.mass;
        water.step(1 / 60);
        expect(water.drops).toHaveLength(1);
        expect(water.drops[0].mass).toBeGreaterThan(before * 0.99);
    });

    it('keeps a pinned drop where it is', () => {
        const water = new NebbiaSnowWater();
        water.resize(W, H);
        const d = water.spawn(300, 200, 120);
        d.pin = { x: 300, y: 200 };
        run(water, 2);
        expect([d.x, d.y]).toEqual([300, 200]);
    });

    it('leaves a drop lighter than the sliding threshold hanging on the glass', () => {
        const water = new NebbiaSnowWater();
        water.resize(W, H);
        water.slip = 1;
        const d = water.spawn(300, 200, 30);
        // 不算结冰：结了冰的会自己往下挪（下一条测）
        iceParams.off = true;
        try { run(water, 3); } finally { iceParams.off = false; }
        expect(d.y).toBe(200);
    });

    it('freezes a drop that stays still long enough and lets it slide down', () => {
        const water = new NebbiaSnowWater();
        water.resize(W, H);
        water.slip = 1;
        const d = water.spawn(300, 200, 30);
        // 开始冻、冻透的时间按大小放长
        const scale = iceSizeScale(water.sizeX(d) / 4, H / 1000);
        run(water, (iceParams.freezeAfter + iceParams.freezeDur) * scale + 2);
        expect(d.ice).toBeGreaterThan(0.3);
        expect(d.y).toBeGreaterThan(200);
    });

    it('lets a heavy drop slide down, leaving smaller drops behind and a wiped trail in the fog', () => {
        const water = new NebbiaSnowWater();
        water.resize(W, H);
        water.slip = 1;
        const d = water.spawn(300, 100, 120);
        run(water, 1);
        expect(d.y).toBeGreaterThan(200);
        expect(water.drops.some(o => o.parent === d)).toBe(true);
        const ctx = new NebbiaSegments();
        water.drawFog(ctx, 1, 4);
        expect(ctx.count).toBeGreaterThan(0);
    });

    it('never lets merging grow a drop past the size cap, even through a light trail bead', () => {
        const water = new NebbiaSnowWater();
        water.resize(W, H);
        // 一颗拖尾留下的轻小珠（密度 0.2）先并进一颗比它还轻的，再并一串大水珠
        const bead = water.spawn(500, 500, 30, 0.2), d = water.spawn(500, 500, 5);
        for (const p of [bead, d]) p.pin = { x: 500, y: 500 };
        for (let i = 0; i < 12; i += 1) water.spawn(500, 500 + i, 70).pin = { x: 500, y: 500 + i };
        run(water, 0.2);
        // 不算刚并上时的摊开（sx，很快收回）
        const biggest = Math.max(...water.drops.map(p => Math.sqrt(p.mass) / p.density));
        expect(biggest).toBeLessThanOrEqual(water.maxSize * 1.01);
    });
});

