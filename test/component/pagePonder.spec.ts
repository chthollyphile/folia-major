import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// test/component/pagePonder.spec.ts：真实 TUI 三个 surface 的无教程声明和切回网格的入口回归。

const target = (page: Page) => page.evaluate(() => window.__pagePonderProbe!.target());
const session = (page: Page) => page.evaluate(() => window.__pagePonderProbe!.session());

/** 等长按阈值过去后检查入口状态，不依赖教程层下载或动画速度。 */
const holdPageShortcut = async (page: Page) => {
    const start = await page.evaluate(() => performance.now());
    await page.keyboard.down('ControlOrMeta');
    await page.keyboard.down('g');
    await expect.poll(() => page.evaluate(() => performance.now())).toBeGreaterThan(start + 450);
    await page.keyboard.up('g');
    await page.keyboard.up('ControlOrMeta');
};

for (const surface of ['home', 'collection', 'artist'] as const) {
    test(`${surface}: TUI has no page tutorial or hold feedback; the rendered grid regains its tutorial`, async ({ mount, page }) => {
        await mount('pagePonder', { home: surface === 'home' });
        if (surface === 'home') {
            await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
            await page.evaluate(() => window.__homeProbe!.setSuite('tui'));
        } else {
            await expect.poll(() => page.evaluate(() => window.__libraryProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
            await page.evaluate(surface => {
                window.__libraryProbe!.setSuite('tui');
                if (surface === 'artist') window.__libraryProbe!.openArtist('artist-main');
                else window.__libraryProbe!.open('online-public');
            }, surface);
        }
        const tui = page.locator('[data-ponder-page-scope="none"]');
        await expect(tui).toHaveCount(1);
        await expect(tui).toBeVisible();
        await expect.poll(() => target(page)).toBeNull();
        expect(await page.evaluate(() => window.__pagePonderProbe!.open())).toBeNull();
        expect(await session(page)).toBeNull();

        const stageRequests: string[] = [];
        page.on('request', request => {
            if (request.url().includes('/PonderStage.tsx')) stageRequests.push(request.url());
        });
        await page.keyboard.down('ControlOrMeta');
        await page.keyboard.down('g');
        await expect(page.getByTestId('page-ponder-hold')).toHaveAttribute('data-holding', 'false');
        await page.keyboard.up('g');
        await page.keyboard.up('ControlOrMeta');
        await holdPageShortcut(page);
        expect(await session(page)).toBeNull();
        expect(stageRequests).toEqual([]);

        // 即使选择的 suite 不是 grid，registry 实际回退到 grid 时仍有网格教程。
        await page.evaluate(() => window.__pagePonderProbe!.fallback());
        await expect(tui).toHaveCount(0);
        const expected = surface === 'home' ? 'grid-page' : 'grid-view-page';
        await expect.poll(() => target(page)).toBe(expected);
        expect(await page.evaluate(() => window.__pagePonderProbe!.open())).toBe(expected);
        await page.evaluate(() => window.__pagePonderProbe!.close());

        await page.evaluate(home => {
            if (home) window.__homeProbe!.setSuite('grid');
            else window.__libraryProbe!.setSuite('grid');
        }, surface === 'home');
        await expect(tui).toHaveCount(0);
        await expect.poll(() => target(page)).toBe(expected);
        await holdPageShortcut(page);
        await expect.poll(() => session(page)).toBe(expected);
        await page.evaluate(() => window.__pagePonderProbe!.close());
        expect(await page.evaluate(() => window.__pagePonderProbe!.open())).toBe(expected);
    });
}
