// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import type { BurstEvent, BurstKind, BurstSpec, HanabiPalette, HanabiTextures, LaunchEvent, PixiModule } from '@/components/visualizer/hanabi/types';
import {
    burstDemand, drawBursts, drawLaunch, launchEnd, planBurst, starPosition, type BurstPlan, type SparkEmit,
} from '@/components/visualizer/hanabi/mg/burstPlan';
import { createFireworks } from '@/components/visualizer/hanabi/mg/fireworks';
import { AMBIENT_PARALLAX, DISTANT_DURATION, distantBurstAt, distantRange, parallaxY } from '@/components/visualizer/hanabi/mg/ambient';

// test/unit/visualizer/hanabi/hanabiFireworks.test.ts
// 花火 MG 部件库的纯函数：烟花 / 升空尾迹的闭式解是确定的、与 seek 顺序无关、在 duration 之后全部熄灭、
// 精灵数不超过池上限（超出时每朵等比例抽稀）；环境层的纵向循环连续（换位只发生在画面外）。（取自 lumisynth）

const KINDS: BurstKind[] = [
    'kiku', 'botan', 'yanagi', 'kamuro', 'senrin', 'ring', 'heart', 'star', 'palm', 'crossette', 'strobe', 'hachi', 'willow-ring', 'mine',
];

const palette: HanabiPalette = {
    ink: 0x111111,
    paper: 0xffffff,
    blocks: [0xff3366, 0x3366ff],
    sparks: [0xff5577, 0xffcc44, 0x55ccff, 0xaaff66],
    accent: 0xffdd00,
    glow: 0xffeecc,
};

const env = { unit: 1080, amount: 1 };

const spec = (kind: BurstKind, extra: Partial<BurstSpec> = {}): BurstSpec => ({
    kind, count: 120, radius: 0.3, duration: 2.8, colors: [0, 1, 2], trail: 0.6, twinkle: 0.5, ...extra,
});

const event = (kind: BurstKind, at = 10, extra: Partial<BurstEvent> = {}): BurstEvent => ({
    x: 960, y: 400, at, spec: spec(kind), seed: `test:${kind}`, scale: 1, squash: 0.5, rotation: 0.3, ...extra,
});

type Op = [string, number, number, number, number, number, number, number];
const record = (budget: number, plans: readonly BurstPlan[], time: number) => {
    const ops: Op[] = [];
    const emit: SparkEmit = (texture, x, y, w, h, r, a, tint) => {
        ops.push([texture, x, y, w, h, r, a, tint]);
        return true;
    };
    drawBursts(plans, time, budget, emit);
    return ops;
};

describe('hanabi 烟花的闭式解', () => {
    it('同一事件同一时刻结果相同（确定性）', () => {
        for (const kind of KINDS) {
            const a = planBurst(event(kind), palette, env);
            const b = planBurst(event(kind), palette, env);
            expect(a).toEqual(b);
            for (const t of [10, 10.05, 10.6, 11.4, 12.5]) expect(record(5000, [a], t)).toEqual(record(5000, [b], t));
        }
    });

    it('不同种子得到不同的烟花', () => {
        const a = planBurst(event('kiku'), palette, env);
        const b = planBurst(event('kiku', 10, { seed: 'other' }), palette, env);
        expect(a.stars.map(s => s.vx)).not.toEqual(b.stars.map(s => s.vx));
    });

    it('seek 顺序无关：乱序求值与顺序求值逐帧一致', () => {
        const plans = KINDS.map((kind, i) => planBurst(event(kind, 10 + i * 0.3), palette, env));
        const times = Array.from({ length: 60 }, (_, i) => 9.9 + i * 0.12);
        const forward = times.map(t => record(1500, plans, t));
        const shuffled = [...times.keys()].sort((a, b) => ((a * 7919) % 61) - ((b * 7919) % 61));
        for (const index of shuffled) expect(record(1500, plans, times[index]!)).toEqual(forward[index]);
    });

    it('位置是 (初速度 × 阻尼 + 重力) 的闭式解：τ=0 在起点，之后连续', () => {
        const plan = planBurst(event('yanagi'), palette, env);
        const star = plan.stars[0]!;
        const p = { x: 0, y: 0 };
        starPosition(star, 0, p);
        expect(p.x).toBeCloseTo(star.x0, 6);
        expect(p.y).toBeCloseTo(star.y0, 6);
        const a = { ...starPosition(star, 1, p) };
        const b = { ...starPosition(star, 1 + 1e-4, p) };
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1);
        // 柳：重力让星最终往下走。
        const late = starPosition(star, star.life, { x: 0, y: 0 });
        const early = starPosition(star, star.life * 0.5, { x: 0, y: 0 });
        expect(late.y).toBeGreaterThan(early.y);
    });

    it.each(KINDS)('%s：开花后有粒子，duration 之后全部熄灭', kind => {
        const e = event(kind);
        const plan = planBurst(e, palette, env);
        expect(plan.stars.length).toBeGreaterThan(0);
        expect(plan.end).toBeLessThanOrEqual(e.at + e.spec.duration + 1e-9);
        expect(record(5000, [plan], e.at + e.spec.duration * 0.3).length).toBeGreaterThan(0);
        expect(record(5000, [plan], e.at + e.spec.duration + 1e-3)).toEqual([]);
        expect(record(5000, [plan], e.at - 1e-3)).toEqual([]);
    });

    it('sparkAmount = 0 时没有星', () => {
        const plan = planBurst(event('kiku'), palette, { unit: 1080, amount: 0 });
        expect(plan.stars).toEqual([]);
    });

    it('粒子总数不超过池上限，超出时每一朵都等比例抽稀', () => {
        const plans = KINDS.map(kind => planBurst(event(kind, 10, { spec: spec(kind, { count: 300 }) }), palette, env));
        const t = 10.5;
        const demand = burstDemand(plans, t);
        expect(demand.stars + demand.flashes).toBeGreaterThan(600);
        for (const budget of [0, 50, 300, 600]) {
            const ops = record(budget, plans, t);
            expect(ops.length).toBeLessThanOrEqual(budget);
        }
        // 抽稀是按比例的：每一朵还在燃烧的花都至少画出了一部分。
        const budget = 600;
        for (const plan of plans) {
            const alone = record(100000, [plan], t).filter(op => op[0] !== 'flash').length;
            if (alone === 0) continue;
            const within: Op[] = [];
            let used = 0;
            drawBursts(plans, t, budget, (texture, x, y, w, h, r, a, tint) => {
                used += 1;
                if (plan.stars.some(star => star.trailColor === tint || star.color === tint || star.endColor === tint)) within.push([texture, x, y, w, h, r, a, tint]);
                return true;
            });
            expect(used).toBeLessThanOrEqual(budget);
            expect(within.length).toBeGreaterThan(0);
        }
    });

    it('升空尾迹：确定、到达后弹头消失、火星燃尽后什么都不剩', () => {
        const launch: LaunchEvent = { fromX: 900, fromY: 1150, toX: 960, toY: 400, at: 5, duration: 1.2, color: 0xffaa55, seed: 'launch:1' };
        const collect = (t: number) => {
            const ops: unknown[][] = [];
            drawLaunch(launch, t, 1080, (...args) => {
                ops.push(args);
                return true;
            });
            return ops;
        };
        expect(collect(5.6)).toEqual(collect(5.6));
        expect(collect(5.6).length).toBeGreaterThan(5);
        expect(collect(4.99)).toEqual([]);
        // 到达之后只剩掉落的火星（glow），没有拖尾段与弹头白芯。
        const after = collect(6.3);
        expect(after.every(op => op[0] === 'glow')).toBe(true);
        expect(collect(launchEnd(launch) + 1e-3)).toEqual([]);
    });
});

// ─── 用最小的假 Pixi 跑一遍图层：池不超上限、乱序 seek 的画面一致 ─────────

class FakeContainer {
    children: Array<FakeSprite | FakeContainer> = [];
    visible = true;
    blendMode = 'normal';
    isRenderGroup: boolean;
    constructor(options: { isRenderGroup?: boolean } = {}) {
        this.isRenderGroup = options.isRenderGroup === true;
    }
    addChild(...items: Array<FakeSprite | FakeContainer>) {
        this.children.push(...items);
    }
    destroy() {
        this.children.length = 0;
    }
}
class FakeSprite {
    texture: unknown;
    anchor = { set: () => undefined };
    position = { x: 0, y: 0, set: (x: number, y: number) => { this.position.x = x; this.position.y = y; } };
    blendMode = 'normal';
    visible = true;
    rotation = 0;
    width = 0;
    height = 0;
    alpha = 1;
    tint = 0xffffff;
    constructor(texture: unknown) {
        this.texture = texture;
    }
}
const fakePixi = { Container: FakeContainer, Sprite: FakeSprite } as unknown as PixiModule;
const fakeTextures = Object.fromEntries(['dot', 'glow', 'star4', 'streak', 'ring', 'square', 'triangle', 'petal'].map(name => [name, { name }])) as unknown as HanabiTextures;

/** 烟花层下面是普通 / 叠加两个池（各一层），精灵按层的混合模式画。 */
const spritesOf = (view: FakeContainer) => view.children.flatMap(layer => (layer as FakeContainer).children.map(sprite => ({ sprite: sprite as FakeSprite, blend: (layer as FakeContainer).blendMode })));
const snapshot = (view: FakeContainer) => spritesOf(view)
    .filter(({ sprite }) => sprite.visible)
    .map(({ sprite: s, blend }) => [(s.texture as { name: string }).name, blend, s.position.x, s.position.y, s.width, s.height, s.alpha, s.tint]);

describe('hanabi 烟花层', () => {
    const bursts = KINDS.map((kind, i) => event(kind, 3 + i * 0.4));
    const launches: LaunchEvent[] = [{ fromX: 900, fromY: 1150, toX: 960, toY: 400, at: 1.8, duration: 1.2, color: 0xffaa55, seed: 'l' }];

    it('精灵池不超过 maxParticles，乱序 seek 与顺序播放逐帧一致', () => {
        const maxParticles = 700;
        const layer = createFireworks(fakePixi, fakeTextures, { width: 1920, height: 1080, palette, amount: 1.5, maxParticles });
        const view = layer.view as unknown as FakeContainer;
        const times = Array.from({ length: 40 }, (_, i) => 1.5 + i * 0.25);
        // 烟花层自己是渲染组：每帧的显隐只重排这一池，不牵动整个舞台。
        expect(view.isRenderGroup).toBe(true);
        const forward = times.map(t => {
            layer.update(t, bursts, launches);
            expect(spritesOf(view).length).toBeLessThanOrEqual(maxParticles);
            return snapshot(view);
        });
        // 闪光（叠加）与其余的分在两个池里，精灵不用来回换混合模式。
        const blends = new Set(forward.flat().map(row => `${row[0]}:${row[1]}`));
        expect([...blends].some(key => key.endsWith(':add'))).toBe(true);
        expect(spritesOf(view).every(({ sprite }) => sprite.blendMode === 'normal')).toBe(true);
        const order = [...times.keys()].reverse();
        for (const index of order) {
            layer.update(times[index]!, bursts, launches);
            expect(snapshot(view)).toEqual(forward[index]);
        }
        layer.update(100, bursts, launches);
        expect(snapshot(view)).toEqual([]);
        layer.destroy();
    });
});

// ─── 环境层 ─────────────────────────────────────────────────────────────

describe('hanabi 环境层的纵向循环', () => {
    const height = 1080;
    const margin = 300;

    it('随 rise 平滑移动，换位只发生在画面外', () => {
        for (const parallax of [AMBIENT_PARALLAX.starsFar, AMBIENT_PARALLAX.distant, AMBIENT_PARALLAX.embers, AMBIENT_PARALLAX.bokeh]) {
            for (const y0 of [0, 137, 555, 1400]) {
                let prev = parallaxY(y0, 0, parallax, 0, height, margin);
                for (let rise = 3; rise < 20000; rise += 3) {
                    const y = parallaxY(y0, rise, parallax, -rise * 0.01, height, margin);
                    expect(y).toBeGreaterThanOrEqual(-margin);
                    expect(y).toBeLessThan(height + margin);
                    const step = 3 * parallax - 0.03;
                    if (Math.abs(y - prev - step) > 1e-6) {
                        // 换位：前后两个位置都在画面之外。
                        expect(prev > height || prev < 0).toBe(true);
                        expect(y > height || y < 0).toBe(true);
                    }
                    prev = y;
                }
            }
        }
    });

    it('上升很多屏也不会空：画面里的点数大致恒定', () => {
        const rng = (i: number) => ((i * 2654435761) % 4294967296) / 4294967296;
        const points = Array.from({ length: 200 }, (_, i) => rng(i + 1) * (height + margin * 2));
        const counts: number[] = [];
        for (let rise = 0; rise < 50000; rise += 997) {
            counts.push(points.filter(y0 => {
                const y = parallaxY(y0, rise, 0.3, 0, height, margin);
                return y >= 0 && y <= height;
            }).length);
        }
        const expected = 200 * height / (height + margin * 2);
        for (const count of counts) expect(Math.abs(count - expected)).toBeLessThan(expected * 0.35);
    });

    it('远方小烟花按种子排在整个单元里，序号范围覆盖所有可能在燃烧的', () => {
        const rate = 0.8;
        const a = distantBurstAt('unit', 5, rate, 0, 1920, 1680);
        expect(distantBurstAt('unit', 5, rate, 0, 1920, 1680)).toEqual(a);
        for (let t = 0; t < 60; t += 0.37) {
            const [first, last] = distantRange(t, rate, 0, 60);
            for (let k = 0; k < Math.floor(60 * rate); k += 1) {
                const burst = distantBurstAt('unit', k, rate, 0, 1920, 1680);
                const burning = t >= burst.at && t <= burst.at + DISTANT_DURATION;
                if (burning) {
                    expect(k).toBeGreaterThanOrEqual(first);
                    expect(k).toBeLessThanOrEqual(last);
                }
            }
        }
    });
});
