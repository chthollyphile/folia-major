import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisSeamRow.spec.ts
// 信息条方向（设置「信息条方向」，默认自动）的组件用例（homeBehavior 探针 + setSuite('bravais')）：竖着的视口自动开横条、
// 转屏时换方向；横条的首页窄缝按宽度退让（data-bravais-home-fit），测量副本不和真控件撞定位器；集合页的横条、
// 「⋯ 更多」菜单完整落在视口里且离按钮近的一侧弹出；打开列表面板换成竖的开口、关上换回横条。
// 只断言结构与几何（方向、退让级别、矩形），不比截图。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('[data-bravais-seam]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());

const setDirection = (page: Page, direction: 'auto' | 'vertical' | 'horizontal') => page.evaluate(async value => {
    const modulePath = '/src/stores/useLibraryWallLookStore.ts';
    const { useLibraryWallLookStore } = await import(/* @vite-ignore */ modulePath);
    useLibraryWallLookStore.getState().setSeamDirection(value);
}, direction);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await settled(page);
};

/** 点开一张没被缝盖住的首页卡片（派发点击：探针左下角的 DEV 浮层可能盖住磁贴）。 */
const openCard = async (page: Page) => {
    const slot = await page.evaluate(() => {
        const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
        const tiles = [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-card]')];
        return tiles.find(element => {
            const rect = element.getBoundingClientRect();
            const clear = !seamRect || rect.bottom < seamRect.top - 4 || rect.top > seamRect.bottom + 4;
            return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight && clear;
        })?.dataset.bravaisSlot ?? null;
    });
    expect(slot).not.toBeNull();
    await page.locator(`[data-bravais-slot="${slot}"] article`).dispatchEvent('click');
    await expect.poll(() => stack(page)).toHaveLength(1);
    await settled(page);
};

/** 横条此刻完整张开（开口落定、不裁内容）。 */
const rowSettled = (page: Page) => expect(seam(page)).toHaveAttribute('data-bravais-seam-settled', '', { timeout: 5_000 });

test.describe('[bravais-only] info strip direction', () => {
    test('auto opens a row on a portrait phone, gives way by width and turns with the screen', async ({ mount, page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await mountBravais(mount, page);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'y');
        await rowSettled(page);

        // 窄屏下默认是书脊（< 900px）：页签缩成一个字，账户只留头像，工具与账户都在屏内。
        const home = seam(page).locator('[data-bravais-home-seam]');
        await expect(home).toHaveAttribute('data-bravais-home-fit', 'short');
        const tabs = seam(page).locator('[data-bravais-tab]');
        await expect(tabs.first()).toHaveAttribute('data-bravais-tab-short', 'true');
        const viewportWidth = 390;
        for (const action of ['search', 'settings']) {
            const box = await seam(page).locator(`[data-bravais-seam-action="${action}"]`).boundingBox();
            expect(box).not.toBeNull();
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewportWidth);
        }
        // 测量副本不带真控件的 data 属性：账户入口只有一个。
        await expect(page.locator('[data-bravais-account-toggle]')).toHaveCount(1);

        // 转成横屏：缝合上，换成竖的开口。
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'x', { timeout: 5_000 });
        // 接近方形的窗口不算竖着。
        await page.setViewportSize({ width: 900, height: 950 });
        await page.waitForTimeout(600);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'x');
        await page.setViewportSize({ width: 390, height: 844 });
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'y', { timeout: 5_000 });
    });

    test('horizontal on a wide screen: full home row, collection row with its menu on screen, panel opens vertically', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'x');
        await setDirection(page, 'horizontal');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'y', { timeout: 5_000 });
        await rowSettled(page);
        await expect(seam(page).locator('[data-bravais-home-seam]')).toHaveAttribute('data-bravais-home-fit', 'titled');
        await expect(seam(page).locator('[data-bravais-home-title]')).toHaveAttribute('data-bravais-home-title', 'shown');
        await expect(page.locator('[data-bravais-account-toggle]')).toHaveCount(1);

        await openCard(page);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'y');
        await rowSettled(page);

        // 「⋯ 更多」：菜单完整落在视口里，从离按钮近的一侧弹出（横条在上半往下、下半往上）。
        const more = seam(page).locator('[data-bravais-seam-action="more"]');
        await more.click();
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        await expect(menu).toBeVisible();
        await page.waitForTimeout(300);
        const [menuBox, moreBox, half] = await Promise.all([
            menu.boundingBox(),
            more.boundingBox(),
            seam(page).getAttribute('data-bravais-seam-half'),
        ]);
        const viewport = page.viewportSize()!;
        expect(menuBox!.y).toBeGreaterThanOrEqual(0);
        expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height);
        expect(menuBox!.width).toBeGreaterThanOrEqual(200);
        if (half === 'top') expect(menuBox!.y).toBeGreaterThanOrEqual(moreBox!.y + moreBox!.height);
        else expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(moreBox!.y);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);

        // 列表面板是竖的开口：横条合上、竖着张开；关上面板换回横条。
        await seam(page).locator('[data-bravais-seam-action="list"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'panel', { timeout: 5_000 });
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'x');
        await seam(page).locator('[data-bravais-seam-action="close-list"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full', { timeout: 5_000 });
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'y');

        // 改回竖向：横条换成竖的完整信息条。
        await setDirection(page, 'vertical');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-axis', 'x', { timeout: 5_000 });
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full');
    });
});
