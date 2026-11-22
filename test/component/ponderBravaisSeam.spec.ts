import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/ponderBravaisSeam.spec.ts
// bravais 信息条那一篇（bravais-seam）：合成界面里的锚点和画出来的元素对齐、各章的结果层真的演出来了，
// 以及指针停在真实 bravais 的缝上时命中的是这一篇。

type Mount = (component: string) => Promise<unknown>;

const stageOf = (page: Page) => page.locator('[data-testid="ponder-stage"]');

const openScene = async (page: Page, mount: Mount | null, scene: string) => {
    if (mount) await mount('ponderBravaisSeam');
    await page.locator(`[data-probe-open="bravais-seam-${scene}"]`).click();
    const stage = stageOf(page);
    await expect(stage).toBeVisible();
    return stage;
};

/** 进场的整层缩放和骨架落位都停下来再量（同 ponderPageSurfaces.spec）。 */
const settled = async (stage: Locator) => {
    await expect(stage).toHaveCSS('opacity', '1', { timeout: 3000 });
    await expect(stage.locator('[data-ponder-stage-content]')).toHaveCSS('transform', 'none', { timeout: 3000 });
    await stage.page().waitForFunction(() => !document.getAnimations().some(animation => (
        animation.playState === 'running'
        && String((animation as unknown as { animationName?: string }).animationName ?? '').startsWith('ponder-skeleton')
    )), undefined, { timeout: 3000 });
};

const expectAligned = async (stage: Locator, anchor: string, element: string) => {
    const anchorBox = await stage.locator(`[data-ponder-anchor="${anchor}"]`).boundingBox();
    const elementBox = await stage.locator(element).first().boundingBox();
    expect(anchorBox, `anchor ${anchor}`).not.toBeNull();
    expect(elementBox, `element ${element}`).not.toBeNull();
    for (const side of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(anchorBox![side] - elementBox![side]), `${anchor}.${side}`).toBeLessThan(1.5);
    }
};

/**
 * 按 → 一个关键帧一个关键帧地往后跳，直到这一层完全显出来。一章有二三十秒，干等太慢；
 * 跳关键帧走的是用户能按的同一条路。
 */
const seekUntilShown = async (page: Page, layer: Locator) => {
    for (let press = 0; press < 14; press += 1) {
        if (await layer.evaluate(node => getComputedStyle(node).opacity === '1')) return;
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(120);
    }
    await expect(layer).toHaveCSS('opacity', '1');
};

test('锚点和合成界面里画出来的信息条严丝合缝', async ({ mount, page }) => {
    let stage = await openScene(page, mount as unknown as Mount, 'levels');
    await settled(stage);
    await expectAligned(stage, 'strip', '[data-ponder-bravais-strip]');
    await expectAligned(stage, 'title', '[data-ponder-bravais-title]');
    await expectAligned(stage, 'crumbs', '[data-ponder-bravais-crumbs]');
    await page.keyboard.press('Escape');
    await expect(stage).toHaveCount(0);

    stage = await openScene(page, null, 'home-navigation');
    await settled(stage);
    await expectAligned(stage, 'homeSeam', '[data-ponder-bravais-home-seam]');
    await expectAligned(stage, 'tabs', '[data-ponder-bravais-tabs]');
    await expectAligned(stage, 'account', '[data-ponder-bravais-account]');
    await expectAligned(stage, 'tools', '[data-ponder-bravais-tools]');
});

test('三档：点标题收成书脊，「⋯ 更多」里折叠之后只剩侧边标签', async ({ mount, page }) => {
    const stage = await openScene(page, mount as unknown as Mount, 'levels');
    const spine = stage.locator('[data-ponder-surface-state="spine"]');
    await seekUntilShown(page, spine);
    await expect(spine.locator('[data-ponder-bravais-spine]')).toBeVisible();
    // 书脊整屏替换了完整信息条那一屏，屏幕上不会同时有两条缝。
    await expect(stage.locator('[data-ponder-surface-state="base"]')).toHaveCSS('opacity', '0');

    const hidden = stage.locator('[data-ponder-surface-state="hidden"]');
    await seekUntilShown(page, hidden);
    await expect(hidden.locator('[data-ponder-bravais-edge-tab]')).toBeVisible();
    await expect(hidden.locator('[data-ponder-bravais-wall="closed"]')).toBeAttached();
});

test('首页：换到本地页签之后多出二级切换，直达入口换成本地的', async ({ mount, page }) => {
    const stage = await openScene(page, mount as unknown as Mount, 'home-navigation');
    const local = stage.locator('[data-ponder-surface-state="home-local"]');
    await seekUntilShown(page, local);
    await expect(local.locator('[data-ponder-bravais-sections]')).toBeVisible();
    // 一级页签是组：Folia、当前在线音源、本地、Navidrome——本地是第 3 个（下标 2）。
    await expect(local.locator('[data-ponder-bravais-tab="2"][data-active]')).toBeVisible();
    await expect(local.locator('[data-ponder-bravais-tab][data-active]')).toHaveCount(1);
    await expect(stage.locator('[data-ponder-surface-state="base"] [data-ponder-bravais-sections]')).toHaveCount(0);
});

test('过滤与搜索是两个样子：打字出过滤位，放大镜换成搜索框', async ({ mount, page }) => {
    const stage = await openScene(page, mount as unknown as Mount, 'filter');
    const filtering = stage.locator('[data-ponder-surface-state="filtering"]');
    await seekUntilShown(page, filtering);
    await expect(filtering.locator('[data-ponder-bravais-filter]')).toBeVisible();
    // 过滤中墙退化为有限拼贴：大部分磁贴翻成墙面留白。
    expect(await filtering.locator('[data-ponder-bravais-tile="wall"]').count())
        .toBeGreaterThan(await filtering.locator('[data-ponder-bravais-tile="content"]').count());

    const search = stage.locator('[data-ponder-surface-state="search-open"]');
    await seekUntilShown(page, search);
    await expect(search.locator('[data-ponder-bravais-search-box]')).toBeVisible();
    await expect(search.locator('[data-ponder-bravais-filter]')).toHaveCount(0);
});

test('指针停在真实 bravais 的缝上，命中的是信息条这一篇', async ({ mount, page }) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await (mount as unknown as Mount)('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    const seam = page.locator('[data-bravais-seam]');
    await expect(seam.locator('[data-bravais-tab="local"]')).toBeVisible({ timeout: 15_000 });

    const resolved = await page.evaluate(async () => {
        const registryPath = '/src/components/ponder/ponderRegistry.ts';
        const { resolveHoveredPonderTarget } = await import(registryPath);
        const tab = document.querySelector('[data-bravais-seam] [data-bravais-tab="local"]');
        const tool = document.querySelector('[data-bravais-seam] [data-bravais-seam-action="more"]');
        return [tab, tool].map(element => resolveHoveredPonderTarget(element)?.id ?? null);
    });
    expect(resolved).toEqual(['bravais-seam', 'bravais-seam']);
});
