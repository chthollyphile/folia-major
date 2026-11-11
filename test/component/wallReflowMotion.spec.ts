import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';
import { spring } from 'framer-motion';
import { WALL_REFLOW_SPRING } from '../../src/components/wall/wallReflowMotion';

// test/component/wallReflowMotion.spec.ts
// 块内让位的运动（设计稿 §7「聚焦卡」、§11.3）：bravais 点开歌曲磁贴展开成 6×6 聚焦卡时，被换位的磁贴与 Lattice 上
// 点海报放大时走同一条弹簧——不过冲、不回弹（2026-10-08 之前 bravais 是带回弹的 cubic-bezier，每张换位的磁贴都会
// 「弹一下」）。两边各逐帧采样一次块里磁贴的位置与尺寸（世界单位，不含相机平移），断言：
// - 每条变化的量单调趋近目标，从不越过；
// - 走到离目标 0.5 个单位以内的时刻 ≈ 这条弹簧把这段位移走到差 0.5 以内的时刻（springReachMs），两边同一个时长。
// bravais 还量收起（同一条过渡回原位）与换到另一块（旧块收回、新块展开同时过渡）。

type Sample = { t: number; rects: Record<string, [number, number, number, number]> };
type SamplerWindow = Window & { __reflowSamples?: Sample[]; __reflowSampling?: boolean };

/**
 * 在页面里按 rAF 逐帧记下选中元素的 [x, y, 宽, 高]（世界单位）。bravais 的外框由 useBravaisReflowDriver 逐帧写，读计算样式；Lattice 的
 * 海报由 framer 每帧写内联样式（transform 里还带悬停抬起的 scaleX / scaleY，只取平移）。
 */
const startSampling = (page: Page, kind: 'bravais' | 'lattice') => page.evaluate((which) => {
    const samplerWindow = window as SamplerWindow;
    const samples: Sample[] = [];
    samplerWindow.__reflowSamples = samples;
    samplerWindow.__reflowSampling = true;
    const readBravais = () => {
        const rects: Sample['rects'] = {};
        document.querySelectorAll<HTMLElement>('.bravais-tile[data-bravais-slot]').forEach((element) => {
            const style = getComputedStyle(element);
            const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
            rects[element.dataset.bravaisSlot!] = [matrix.m41, matrix.m42, parseFloat(style.width), parseFloat(style.height)];
        });
        return rects;
    };
    const readLattice = () => {
        const rects: Sample['rects'] = {};
        document.querySelectorAll<HTMLElement>('.lattice-poster[data-instance-id]').forEach((element) => {
            const transform = element.style.transform;
            const x = Number(/translateX\((-?[\d.]+)px\)/.exec(transform)?.[1] ?? 0);
            const y = Number(/translateY\((-?[\d.]+)px\)/.exec(transform)?.[1] ?? 0);
            rects[element.dataset.instanceId!] = [x, y, parseFloat(element.style.width), parseFloat(element.style.height)];
        });
        return rects;
    };
    const read = which === 'bravais' ? readBravais : readLattice;
    /** 两帧之间有没有哪个量变了（同一批磁贴里比）。 */
    const changed = (previous: Sample['rects'], next: Sample['rects']) => Object.keys(next).some((key) => {
        const before = previous[key];
        return before !== undefined && next[key]!.some((value, index) => Math.abs(value - before[index]!) > 0.001);
    });
    // 采到动起来、再连续 20 帧（约 330ms）不动为止（加载重时点击与起步都可能晚），最多 5s。
    const started = performance.now();
    let moved = false;
    let still = 0;
    samples.push({ t: started, rects: read() });
    const tick = (now: number) => {
        const sample = { t: now, rects: read() };
        const moving = changed(samples.at(-1)!.rects, sample.rects);
        samples.push(sample);
        moved ||= moving;
        still = moving ? 0 : still + 1;
        if ((moved && still >= 20) || now - started > 5_000) samplerWindow.__reflowSampling = false;
        else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}, kind);

const collectSamples = async (page: Page) => {
    await expect.poll(() => page.evaluate(() => (window as SamplerWindow).__reflowSampling), { timeout: 15_000 }).toBe(false);
    return page.evaluate(() => (window as SamplerWindow).__reflowSamples ?? []);
};

/**
 * 一条轨迹。真正的起步落在 (startedAt, startedBy] 里（起步前最后一帧到第一帧动了），走到目标 0.5 以内落在
 * (reachedAfter, reachedAt] 里——加载重时帧间隔会拉长，所以时长按区间比，不按单帧。
 */
type Track = {
    key: string; channel: number; from: number; to: number; overshoot: number; reverse: number;
    startedAt: number; startedBy: number; reachedAfter: number; reachedAt: number | null;
};

/** 把采样拆成每张磁贴每个量的一条轨迹，只留真的动了（≥ 40 单位）的那些。 */
const tracksOf = (samples: Sample[]): Track[] => {
    const first = samples[0]!;
    const last = samples.at(-1)!;
    const tracks: Track[] = [];
    for (const key of Object.keys(first.rects)) {
        const series = samples.map(sample => sample.rects[key]).filter((rect): rect is Sample['rects'][string] => Boolean(rect));
        if (series.length !== samples.length) continue;
        for (let channel = 0; channel < 4; channel += 1) {
            const from = first.rects[key]![channel]!;
            const to = last.rects[key]![channel]!;
            if (Math.abs(to - from) < 40) continue;
            const direction = Math.sign(to - from);
            let overshoot = 0;
            let reverse = 0;
            let startedAt = Number.NaN;
            let startedBy = Number.NaN;
            let reachedAfter = Number.NaN;
            let reachedAt: number | null = null;
            for (let index = 1; index < samples.length; index += 1) {
                const value = series[index]![channel]!;
                const previous = series[index - 1]![channel]!;
                // 越过目标多少、往回走了多少（都按运动方向算）。
                overshoot = Math.max(overshoot, (value - to) * direction);
                reverse = Math.max(reverse, (previous - value) * direction);
                // 起步时刻取上一帧（真正的起点落在两帧之间）。
                if (Number.isNaN(startedAt) && Math.abs(value - from) > 0.01) {
                    startedAt = samples[index - 1]!.t;
                    startedBy = samples[index]!.t;
                }
                if (reachedAt === null && Math.abs(value - to) <= 0.5) {
                    reachedAfter = samples[index - 1]!.t;
                    reachedAt = samples[index]!.t;
                }
            }
            tracks.push({ key, channel, from, to, overshoot, reverse, startedAt, startedBy, reachedAfter, reachedAt });
        }
    }
    return tracks;
};

/**
 * 不过冲、单调，且走到目标附近的时刻与弹簧对得上。`lateSlack`：允许比弹簧晚多少毫秒——Lattice 的 framer 动画在主线程上
 * 逐帧推进，加载重（并行 worker）时会比墙钟落后几帧，对照时放宽这一侧；bravais 倾斜着的墙同样放宽（TILTED_LATE_SLACK_MS）。
 */
const expectLatticeSpring = (tracks: Track[], label: string, lateSlack = 0) => {
    expect(tracks.length, `${label}: something moved`).toBeGreaterThan(2);
    for (const track of tracks) {
        const name = `${label} ${track.key}[${track.channel}] ${track.from}→${track.to}`;
        expect(track.overshoot, `${name} overshoot`).toBeLessThanOrEqual(0.05);
        expect(track.reverse, `${name} reverse`).toBeLessThanOrEqual(0.05);
        expect(track.reachedAt, `${name} reached`).not.toBeNull();
        const expected = springReachMs(Math.abs(track.to - track.from));
        // 按帧量到的时长区间：最短 = 起步最晚、到达最早；最长 = 起步最早、到达最晚。再放 30ms（过渡的起步时间晚一帧定）。
        const shortest = track.reachedAfter - track.startedBy;
        const longest = track.reachedAt! - track.startedAt;
        const span = `${Math.round(shortest)}–${Math.round(longest)}ms vs ${expected}ms`;
        // 不比弹簧快：
        expect(expected, `${name}: ${span}`).toBeLessThanOrEqual(longest + 30);
        // 不比弹簧慢（Lattice 对照放宽 lateSlack）：
        expect(expected + lateSlack, `${name}: ${span}`).toBeGreaterThanOrEqual(shortest - 30);
    }
};

/** 让位弹簧把位移 distance 走到离目标 0.5 个单位以内的毫秒数（framer 的同一条弹簧，按毫秒取）。 */
const springReachMs = (distance: number) => {
    const generator = spring({ stiffness: WALL_REFLOW_SPRING.stiffness, damping: WALL_REFLOW_SPRING.damping, keyframes: [0, distance] });
    let time = 0;
    while (Math.abs(distance - generator.next(time).value) > 0.5) time += 1;
    return time;
};

/**
 * 歌单页的墙是倾斜着量的（出厂就是这样）。让位由 rAF 逐帧写、按墙钟取值，本身不会慢；但无头浏览器是软件渲染，倾斜的层
 * 逐帧合成慢、帧间隔被拉长，采样（也是按帧）读到的总晚一两帧。与 Lattice 对照同样放宽「不比弹簧慢」这一侧；不过冲、单调、
 * 不比弹簧快照旧不放。
 */
const TILTED_LATE_SLACK_MS = 150;

test.describe('[bravais] focus reflow motion', () => {
    const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
    const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);
    const blockOf = (slotKey: string) => slotKey.split(',').slice(0, 2).join(',');
    const inBlock = (block: string) => (track: Track) => blockOf(track.key) === block;
    /** 中心点在视口里（避开缝与底部一带）、最上层就是它自己的歌曲磁贴，可排除一块。 */
    const topmostTrack = (page: Page, excludeBlock: string | null = null) => page.evaluate((skip) => {
        const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
        const found = [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-entry]')].find((element) => {
            if (skip && element.dataset.bravaisSlot!.startsWith(`${skip},`)) return false;
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            if (x < 40 || y < 40 || x > window.innerWidth - 40 || y > window.innerHeight - 160) return false;
            if (seamRect && seamRect.width > 0 && x > seamRect.left - 60 && x < seamRect.right + 60) return false;
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit && element.contains(hit));
        });
        return found?.dataset.bravaisSlot ?? null;
    }, excludeBlock);

    test.beforeEach(async ({ mount, page }) => {
        await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
        await mount('homeBehavior');
        await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
        await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
        const card = page.locator('.bravais-tile[data-library-card]').first();
        await expect(card).toBeAttached();
        await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
        // 进一个集合（歌曲铺满墙）。
        const slot = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-card]')].find((element) => {
            const rect = element.getBoundingClientRect();
            return rect.left > 8 && rect.top > 8 && rect.right < window.innerWidth - 400 && rect.bottom < window.innerHeight - 140;
        })?.dataset.bravaisSlot ?? null);
        expect(slot).not.toBeNull();
        await tile(page, slot!).locator('article').click();
        await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
        await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
        // 歌单页整层倾斜着（缝张开时 −4°）：等它转到位再量。
        await page.waitForTimeout(1300);
    });

    test('expanding, folding back and switching blocks all ride the Lattice spring, without overshoot', async ({ page }) => {
        const track = await topmostTrack(page);
        expect(track).not.toBeNull();
        const block = blockOf(track!);
        /** 让位放完（每段采样前都等上一段放完）：没有磁贴还挂着 data-bravais-reflowing。 */
        const reflowSettled = () => expect(page.locator('.bravais-tile[data-bravais-reflowing]')).toHaveCount(0, { timeout: 5_000 });

        // 展开：块里换位的磁贴（含展开的那张）。
        await startSampling(page, 'bravais');
        await tile(page, track!).locator('article').click();
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        const expandTracks = tracksOf(await collectSamples(page)).filter(inBlock(block));
        expectLatticeSpring(expandTracks, 'expand', TILTED_LATE_SLACK_MS);
        // 展开的那张自己的宽高也走同一条弹簧。
        expect(expandTracks.some(item => item.key === track && item.channel >= 2)).toBe(true);

        await reflowSettled();
        // 换到另一块：旧块收回、新块展开，两块同时、同一条弹簧。
        const other = await topmostTrack(page, block);
        expect(other).not.toBeNull();
        await startSampling(page, 'bravais');
        await tile(page, other!).locator('article').click();
        await expect(tile(page, other!)).toHaveAttribute('data-bravais-expanded', 'true');
        const switchTracks = tracksOf(await collectSamples(page));
        const returning = switchTracks.filter(inBlock(block));
        const opening = switchTracks.filter(inBlock(blockOf(other!)));
        expectLatticeSpring(returning, 'switch: old block', TILTED_LATE_SLACK_MS);
        expectLatticeSpring(opening, 'switch: new block', TILTED_LATE_SLACK_MS);
        // 同时起步：两块的起步时刻相差不到两帧。
        expect(Math.abs(Math.min(...returning.map(item => item.startedAt)) - Math.min(...opening.map(item => item.startedAt)))).toBeLessThan(40);

        await reflowSettled();
        // 收起（Esc）：这一块沿同一条弹簧回到原位。
        await startSampling(page, 'bravais');
        await page.keyboard.press('Escape');
        await expect(page.locator('.bravais-tile[data-bravais-expanded]')).toHaveCount(0);
        expectLatticeSpring(tracksOf(await collectSamples(page)).filter(inBlock(blockOf(other!))), 'collapse', TILTED_LATE_SLACK_MS);
    });
});

test.describe('[lattice] poster expansion motion (the reference)', () => {
    test('expanding a poster rides the reflow spring, without overshoot', async ({ mount, page }) => {
        const wall = await mount('lattice');
        // 过了开场的落位波次。
        await page.waitForTimeout(1200);
        await wall.locator('.lattice-field').press('Escape');
        await page.keyboard.press('ArrowRight');
        await expect(wall.locator('.lattice-poster.is-focused')).toBeFocused();
        await page.waitForTimeout(1200);
        await startSampling(page, 'lattice');
        await page.keyboard.press(' ');
        await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(1);
        expectLatticeSpring(tracksOf(await collectSamples(page)), 'lattice expand', 150);
    });
});
