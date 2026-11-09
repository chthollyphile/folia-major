import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_NEBBIA_TUNING } from '@/components/visualizer/nebbia/types';

// test/unit/visualizer/nebbiaSnow.test.ts
// 雪窗和歌词的水联动：扫过的地方（笔尖、往下淌的水珠头）雪当帧化开、水珠被吸走；写好的笔画只吸走挨着的水珠，雪照常粘着；
// 落在水上（水珠、还挂着水珠的笔画）的雪一沾水就很快化没、水并进去；够不着的雪和水珠不受影响。
// 测试环境没有 2D 画布：雪花贴图换成空的。

vi.mock('@/components/visualizer/nebbia/nebbiaSnowFlakes', () => ({
    FLAKE_SPRITE: 64, FLAKE_R: 26.88, FLAKE_STAGES: 16, FLAKE_FILL: 0.84,
    buildFlakeKind: (type: string, row: number) => ({ type, row, stages: [], lumps: [{ x: 0, y: 0, w: 1 }] }),
    buildFlakeAtlas: () => ({}),
}));

type Flake = { x: number; y: number; r: number; age: number; hold: number; quick: boolean; ox: number; app: number };
type SnowInternals = {
    flakes: Flake[]; newFlake: (t: typeof DEFAULT_NEBBIA_TUNING, wind: number) => Flake;
    water: { drops: { x: number; y: number; dead: boolean; mass: number }[]; spawn: (x: number, y: number, size: number) => { dead: boolean; mass: number } };
};

const tuning = { ...DEFAULT_NEBBIA_TUNING, glass: 'snow' as const, snow: 0 };

describe('nebbia snow glass', () => {
    const landed = async (x: number, y: number) => {
        const { NebbiaSnow } = await import('@/components/visualizer/nebbia/nebbiaSnow');
        const snow = new NebbiaSnow();
        snow.resize(1000, 1000);
        const inner = snow as unknown as SnowInternals;
        const f = inner.newFlake(tuning, 1);
        Object.assign(f, { x, y, age: 1, app: 0.3, hold: 100 });
        inner.flakes.push(f);
        return { snow, inner, f };
    };

    const live = (inner: SnowInternals) => inner.water.drops.filter(d => !d.dead);

    it('melts a stuck flake the finger sweeps over and takes the water under it into the stroke', async () => {
        const { snow, inner } = await landed(500, 500);
        inner.water.spawn(520, 503, 16);
        snow.step(1 / 60, tuning, [400, 500, 600, 500, 12], [], 1);
        expect(inner.flakes).toHaveLength(0);
        expect(live(inner)).toHaveLength(0);
    });

    it('leaves snow and water the finger does not reach', async () => {
        const { snow, inner } = await landed(500, 560);
        inner.water.spawn(300, 300, 16);
        snow.step(1 / 60, tuning, [400, 500, 600, 500, 12], [], 1);
        expect(inner.flakes).toHaveLength(1);
        expect(live(inner)).toHaveLength(1);
    });

    // 一片正要落下的雪：再走一帧就打到玻璃上
    const falling = async (x: number, y: number) => {
        const r = await landed(x, y);
        r.f.age = 0.29;
        return r;
    };

    it('melts a flake landing on a drop at once and adds its water to that drop', async () => {
        const { snow, inner, f } = await falling(500, 500);
        const d = inner.water.spawn(501, 501, 20);
        f.age = 0.27;
        snow.step(1 / 60, tuning, [], [], 1);
        expect(f.quick).toBe(false);
        snow.step(1 / 60, tuning, [], [], 1);
        expect(f.quick).toBe(true);
        // 一片雪化出的水：看得见的半径是雪花半径的对数（画面高 1000）
        expect(d.mass).toBeGreaterThan(20 * 20 + (4 * 4.5 * Math.log(1 + f.r / 2.5)) ** 2 * 0.95);
        for (let i = 0; i < 20; i += 1) snow.step(1 / 60, tuning, [], [], 1);
        expect(inner.flakes).toHaveLength(0);
        expect(live(inner)).toHaveLength(1);
    });

    it('melts a flake landing on a written stroke that still has beads', async () => {
        const { snow, inner, f } = await falling(500, 504);
        snow.step(1 / 60, tuning, [], [400, 500, 600, 500, 12], 1);
        expect(f.quick).toBe(true);
        for (let i = 0; i < 20; i += 1) snow.step(1 / 60, tuning, [], [400, 500, 600, 500, 12], 1);
        expect(inner.flakes).toHaveLength(0);
        expect(live(inner)).toHaveLength(0);
    });

    it('lets a written stroke soak up water beside it while a flake already stuck there stays', async () => {
        const { snow, inner } = await landed(500, 500);
        inner.water.spawn(560, 512, 16);
        snow.step(1 / 60, tuning, [], [400, 500, 600, 500, 12], 1);
        expect(inner.flakes).toHaveLength(1);
        expect(live(inner)).toHaveLength(0);
    });

    it('blows flakes in from further ahead and faster when the bus goes faster', async () => {
        const { inner } = await landed(500, 500);
        const mean = (wind: number) => {
            let ox = 0, app = 0;
            for (let i = 0; i < 2000; i += 1) { const f = inner.newFlake(tuning, wind); ox += f.ox; app += f.app; }
            return { ox: ox / 2000, app: app / 2000 };
        };
        const calm = mean(0), fast = mean(3);
        expect(fast.ox).toBeGreaterThan(calm.ox + 200);
        expect(fast.app).toBeLessThan(calm.app * 0.6);
    });
});
