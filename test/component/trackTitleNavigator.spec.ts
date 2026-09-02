import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/trackTitleNavigator.spec.ts
// 覆盖浮动播放条标题区的切歌箭头。这里的每一条都对应一个实际发生过、且只有在真实浏览器里
// 才暴露的回归（层叠命中测试、StrictMode 下 effect 双调用、异步切歌期间的旧标题闪现），
// 所以走 dev 组件探针而不是整应用，见 dev/probes/trackTitleNavigator.probe.tsx。

const CURRENT_LAYER = '.group\\/title .relative.h-6 > div:not([aria-hidden])';
const PREVIEW_LAYER = '.group\\/title .relative.h-6 > div[aria-hidden]';

/** 悬浮胶囊使其展开，返回标题区的 locator */
async function expandBar(page: Page): Promise<Locator> {
    const capsule = page.locator('.rounded-full.cursor-pointer').first();
    await capsule.hover();
    const titleArea = page.locator('.group\\/title');
    await expect(titleArea).toBeVisible();
    return titleArea;
}

/** 把指针移到标题区右侧感应区（箭头附近但不在箭头上） */
async function hoverNextZone(page: Page, titleArea: Locator): Promise<void> {
    const box = (await titleArea.boundingBox())!;
    await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2);
}

/** 采样当前标题层在一段时间内出现过的横向位移，用来判断有没有播方向性入场动画 */
async function sampleTranslateX(page: Page, durationMs = 450): Promise<number[]> {
    return page.evaluate(async ({ selector, duration }) => {
        const seen = new Set<number>();
        const start = performance.now();
        while (performance.now() - start < duration) {
            const el = document.querySelector(selector);
            if (el) {
                const { transform } = getComputedStyle(el);
                seen.add(transform === 'none' ? 0 : Math.round(new DOMMatrix(transform).m41));
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return [...seen];
    }, { selector: CURRENT_LAYER, duration: durationMs });
}

test.beforeEach(async ({ mount }) => {
    await mount('trackTitleNavigator');
});

test('箭头可命中：文字层不得吞掉指针事件', async ({ page }) => {
    const titleArea = await expandBar(page);
    await hoverNextZone(page, titleArea);

    const nextArrow = page.getByRole('button', { name: 'Next track' });
    await expect(nextArrow).toBeVisible();

    // 曾经的回归：标题文字层是 position:relative 且 DOM 序在感应区之后，
    // 后来居上盖住箭头，点击被静默吞掉。
    const box = (await nextArrow.boundingBox())!;
    const topmost = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(topmost).toBe('Next track');

    await nextArrow.click();
    await expect(page.locator('[data-probe-track]')).toHaveAttribute('data-probe-track', 'Charlie Song');
});

test('悬浮感应区预览相邻曲名，移开还原', async ({ page }) => {
    const titleArea = await expandBar(page);
    await hoverNextZone(page, titleArea);

    const preview = page.locator(PREVIEW_LAYER);
    await expect(preview).toHaveText('Charlie Song');
    await expect
        .poll(() => preview.evaluate(el => Number(getComputedStyle(el).opacity)))
        .toBeGreaterThan(0.3);

    const box = (await titleArea.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect
        .poll(() => preview.evaluate(el => Number(getComputedStyle(el).opacity)))
        .toBeLessThan(0.05);
});

test('仅展开播放条不播入场动画（StrictMode 下 effect 会跑两次）', async ({ page }) => {
    // 曾经的回归：用「我挂载过没」的布尔 ref 做守卫，而 ref 在 StrictMode 的双调用之间不会重置，
    // 于是每次 ExpandedView 挂载都被误判成换歌，标题一显示就滑一次。
    await expandBar(page);
    expect(await sampleTranslateX(page)).toEqual([0]);

    await page.mouse.move(10, 10);
    await expect(page.locator('.group\\/title')).toBeHidden();
    await expandBar(page);
    expect(await sampleTranslateX(page)).toEqual([0]);
});

test('点箭头切歌时不闪回旧曲名', async ({ page }) => {
    const titleArea = await expandBar(page);
    await hoverNextZone(page, titleArea);
    await expect(page.locator(PREVIEW_LAYER)).toHaveText('Charlie Song');
    // 必须等交叉淡入走完再点，否则采样到的是 hover 淡出途中的旧标题，与点击行为无关
    await expect
        .poll(() => page.locator(CURRENT_LAYER).evaluate(el => Number(getComputedStyle(el).opacity)))
        .toBeLessThan(0.05);

    // playSong 是异步的，title prop 会晚几帧才更新。曾经的回归：点击后当前标题层立刻亮起，
    // 亮出来的却还是旧曲名，直到真实 props 到达才滑成新的。
    const visibleTexts = await page.evaluate(async (selectors) => {
        const seen: string[] = [];
        const start = performance.now();
        (document.querySelector('button[aria-label="Next track"]') as HTMLButtonElement).click();
        while (performance.now() - start < 900) {
            for (const selector of selectors) {
                const el = document.querySelector(selector);
                if (!el) continue;
                const text = (el as HTMLElement).innerText.trim();
                if (text && Number(getComputedStyle(el).opacity) >= 0.15 && seen[seen.length - 1] !== text) {
                    seen.push(text);
                }
            }
            await new Promise(resolve => requestAnimationFrame(resolve));
        }
        return [...new Set(seen)];
    }, [CURRENT_LAYER, PREVIEW_LAYER]);

    expect(visibleTexts).toEqual(['Charlie Song']);
});

test('切歌确认窗口：先亮新曲名，指针未动则窗口结束后恢复预览', async ({ page }) => {
    const titleArea = await expandBar(page);
    await hoverNextZone(page, titleArea);

    const preview = page.locator(PREVIEW_LAYER);
    await page.getByRole('button', { name: 'Next track' }).click();

    // 窗口内：预览必须压住，否则用户会以为预览的那首就是正在播放的
    await expect(page.locator('[data-probe-track]')).toHaveAttribute('data-probe-track', 'Charlie Song');
    expect(await preview.evaluate(el => Number(getComputedStyle(el).opacity))).toBeLessThan(0.05);

    // 窗口结束后指针仍在感应区，预览恢复并指向新的下一首
    await expect(preview).toHaveText('Delta Song', { timeout: 3000 });
    await expect
        .poll(() => preview.evaluate(el => Number(getComputedStyle(el).opacity)), { timeout: 3000 })
        .toBeGreaterThan(0.3);
});

test('实验室开关开启时箭头常驻，不再依赖悬浮', async ({ mount, page }) => {
    // 这条 addInitScript 必须排在 fixtures 那条种子脚本之后：种子会 localStorage.clear()。
    // 重挂用 mount() 而不是 page.reload()：gallery 的 URL 不带 ?probe=，reload 之后回到的是索引页。
    await page.addInitScript(() => {
        localStorage.setItem('always_show_track_switch_buttons', 'true');
    });
    await mount('trackTitleNavigator');

    // 悬浮播放按钮把胶囊展开，但指针始终不进标题区：
    // 常驻模式下箭头不能再靠 group-hover/title 才浮出
    const titleArea = await expandBar(page);
    await page.locator('button.h-12.w-12').first().hover();
    await expect(titleArea).toBeVisible();

    const nextArrow = page.getByRole('button', { name: 'Next track' });
    await expect
        .poll(() => nextArrow.evaluate(el => Number(getComputedStyle(el).opacity)))
        .toBeGreaterThan(0.3);
});
