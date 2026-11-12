import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { PerfRequest } from '../../dev/probes/bravais-perf/perfConfig';
import type { PerfResult } from '../../dev/probes/bravais-perf/perfStats';
import '../../dev/probes/bravais-perf/probeApi';

// test/component/bravaisPerf.spec.ts
// bravais 墙的性能**回归护栏**（B12a），挂的是真实 BravaisStage（bravaisPerf 探针：合成的集合 / 首页层，没有 visualizer）。
// 这些不是绝对性能标准——无头 Chromium、并行 worker 下的帧间隔说明不了真实机器的流畅度（那要换机实测，见
// dev/probes/bravais-perf/README.md）。这里钉的是**结构不变量**，它们一旦破了，任何机器上都会变慢：
// - 虚拟化：首屏挂的磁贴数与条目数无关（500 与 5000 首一样多，上限 400），首屏主线程块不随条目数涨；
// - 整面翻牌只动「视口 + 外扩」里的磁贴、不超过 400 张，屏外的只换不翻；
// - 小范围拖动只写底板遮罩的位置：遮罩不重建、磁贴不重渲染、stage 不提交；大范围拖动只渲染新进来的磁贴；
// - 聚焦放大每次只重建常数次遮罩，只动两个块；换页签的整墙出场 / 入场同样受 400 张的上限约束。
// B12b：底板改为按块 SVG（随世界层平移），「遮罩重建」换成「块底板重画」（已挂块的 <path d> 被改写）：小范围拖动
// 与换页签一次都不重画，大范围拖动只新挂块、不重画已挂的块，聚焦放大只重画放大 / 收起的那几块。drift 不再先空走一圈
// （缝开口补间会按含开口的可见范围补裁剪）。
// 计数类断言是精确的（与机器无关）；时间类只比 500 与 5000 的差、兜一个很宽的天花板，数值按本机实测留了余量
// （实测与依据见各断言旁的注释）。

const BASE: PerfRequest = { looks: ['partial'], windows: [3], visualizer: 'none', repeats: 1, warmupMs: 1500, settleMs: 300 };

const mountProbe = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await mount('bravaisPerf');
    await expect.poll(() => page.evaluate(() => window.__bravaisPerfProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
};

const run = async (page: Page, request: PerfRequest): Promise<PerfResult> => {
    const results = await page.evaluate(async (body) => {
        const before = window.__bravaisPerfProbe!.results().length;
        const all = await window.__bravaisPerfProbe!.run(body);
        return all.slice(before);
    }, { ...BASE, ...request });
    expect(results).toHaveLength(1);
    return results[0]!;
};

/** 先空跑一轮丢掉读数：第一次挂 stage 要付模块求值、CSS、封面解码的冷启动。 */
const warmUp = (page: Page) => run(page, { items: [500], scenarios: ['idle'], seconds: 0.5 });

const mountBlock = (result: PerfResult) => Math.max(result.mount.longTaskMaxMs, result.mount.loafMaxMs);

test.describe('[bravais] wall performance guard rails', () => {
    test.beforeEach(async ({ mount, page }) => {
        test.setTimeout(150_000);
        await mountProbe(mount, page);
        await warmUp(page);
    });

    test('the first screen and a whole-wall flip cost the same for 500 and 5000 tracks', async ({ page }) => {
        const small = await run(page, { items: [500], scenarios: ['flip'], seconds: 3.2 });
        const large = await run(page, { items: [5000], scenarios: ['flip'], seconds: 3.2 });
        console.log('PERF bravais flip', JSON.stringify({ small: { mount: small.mount, animation: small.animation, counts: small.counts, motion: small.motion }, large: { mount: large.mount, animation: large.animation, counts: large.counts, motion: large.motion } }));

        // 首屏：挂的磁贴是「视口附近的 slot」，与条目数无关。
        expect(large.mount.tiles).toBeGreaterThan(0);
        expect(large.mount.tiles).toBeLessThanOrEqual(400);
        expect(large.mount.tiles).toBeLessThan(small.mount.tiles * 1.2 + 10);
        // 首屏主线程块：只比两档的差（机器忙时两边一起慢），再兜一个宽天花板。
        // 本机实测（1440×1100）：单 worker 两档 90–130ms；5 个 worker 并行 0–240ms，同一次里出现过 500 首 0ms、5000 首 157ms
        // （机器忙时某一边恰好没碰上长任务），所以差的余量给到 250ms。回归成整表重算（每次挂载对 5000 项做重活）时
        // 5000 首会远超 400ms 的天花板。
        expect(mountBlock(large) - mountBlock(small)).toBeLessThan(250);
        expect(mountBlock(large)).toBeLessThan(400);

        for (const result of [small, large]) {
            // 进 / 出过滤各翻一次。
            expect(result.animation.triggers).toBeGreaterThanOrEqual(2);
            expect(result.animation.peakAnimated).toBeGreaterThan(0);
            // 翻牌上限（FLIP_MAX_TILES）与「屏外只换不翻」。
            expect(result.animation.peakAnimated).toBeLessThanOrEqual(400);
            expect(result.animation.maxOffscreen).toBe(0);
            // 每张磁贴每次翻牌最多渲染两次（换层那次 + 转到 90° 换内容那次），StrictMode 下各算两次：
            // 渲染次数超过「触发次数 × 在场磁贴 × 4」说明翻牌期间在逐帧重渲染。
            expect(result.counts.tileRenders).toBeLessThanOrEqual(result.animation.triggers * result.tiles.peak * 4);
        }
        // 5000 首的翻牌不比 500 首多掉帧（有限墙按全量 5000 规划，但只翻屏内）。
        expect(large.motion.over33 - small.motion.over33).toBeLessThan(6);
        expect(large.motion.loafMaxMs).toBeLessThan(250);
    });

    test('panning inside the culled range writes nothing but the world transforms', async ({ page }) => {
        const drift = await run(page, { items: [5000], scenarios: ['drift'], seconds: 2.5 });
        console.log('PERF bravais drift', JSON.stringify({ counts: drift.counts, motion: drift.motion }));
        expect(drift.motion.frames).toBeGreaterThan(30);
        // 帧状态直接写 DOM：块底板随世界层平移（不重画、不新挂）、磁贴不重渲染、没有新磁贴、stage 不提交。
        expect(drift.counts.plateRedraws).toBe(0);
        expect(drift.counts.platesAdded).toBe(0);
        expect(drift.counts.tileRenders).toBe(0);
        expect(drift.counts.tilesAdded).toBe(0);
        expect(drift.counts.stageCommits).toBe(0);
    });

    test('a long pan renders only the tiles it brings in', async ({ page }) => {
        const pan = await run(page, { items: [5000], scenarios: ['pan'], seconds: 3 });
        console.log('PERF bravais pan', JSON.stringify({ counts: pan.counts, tiles: pan.tiles, motion: pan.motion }));
        // 跨了块边界：重新裁剪、带进新磁贴与新块的底板——已挂的块底板一次都不重画。
        expect(pan.counts.tilesAdded).toBeGreaterThan(0);
        expect(pan.counts.platesAdded).toBeGreaterThan(0);
        expect(pan.counts.plateRedraws).toBe(0);
        // 新挂的磁贴各渲染一次（StrictMode 下两次），已在场的不重渲染。
        expect(pan.counts.tileRenders).toBeLessThanOrEqual(pan.counts.tilesAdded * 2);
        expect(pan.tiles.peak).toBeLessThanOrEqual(400);
    });

    test('focus expansion and home tab waves stay within their budgets', async ({ page }) => {
        const expand = await run(page, { items: [5000], scenarios: ['expand'], seconds: 3.2 });
        const tab = await run(page, { items: [5000], scenarios: ['tab'], seconds: 2.8 });
        console.log('PERF bravais expand/tab', JSON.stringify({ expand: { counts: expand.counts, animation: expand.animation }, tab: { counts: tab.counts, animation: tab.animation, tiles: tab.tiles } }));

        expect(expand.animation.triggers).toBeGreaterThanOrEqual(3);
        // 放大只让位一个块（12 张）、收起另一个块：在动的磁贴不超过两块。
        expect(expand.animation.peakAnimated).toBeGreaterThan(0);
        expect(expand.animation.peakAnimated).toBeLessThanOrEqual(24);
        // 只重画放大的块与收起归位的那一块（让位期间都逐帧）：重画过的块都在「展开过聚焦卡」的块里，块数不超过触发数 + 1。
        expect(expand.counts.plateRedraws).toBeGreaterThan(0);
        expect(expand.counts.strayPlateRedraws).toBe(0);
        expect(expand.counts.plateRedrawBlocks).toBeLessThanOrEqual(expand.animation.triggers + 1);

        expect(tab.animation.triggers).toBeGreaterThanOrEqual(2);
        expect(tab.animation.peakAnimated).toBeGreaterThan(0);
        expect(tab.animation.peakAnimated).toBeLessThanOrEqual(400);
        expect(tab.animation.maxOffscreen).toBe(0);
        // 窗位是结构位、固定在世界坐标上：换页签不重画块底板。
        expect(tab.counts.plateRedraws).toBe(0);
    });
});
