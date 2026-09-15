import { expect, test } from './fixtures';

// test/component/cursorAutoHide.spec.ts
// 按住指针时不应隐藏。这是真实 pointerdown/up 时序，走组件探针，
// 见 dev/probes/cursorAutoHide.probe.tsx。

const root = (page: import('@playwright/test').Page) => page.locator('[data-probe-cursor-hidden]');

test('hides after idle, stays visible while the pointer is held, then hides again on release', async ({ mount, page }) => {
    await mount('cursorAutoHide');
    const delay = Number(await root(page).getAttribute('data-probe-cursor-delay'));

    await expect(root(page)).toHaveAttribute('data-probe-cursor-hidden', 'yes', { timeout: delay + 2_000 });

    const box = (await root(page).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(root(page)).toHaveAttribute('data-probe-cursor-hidden', 'no');

    await page.waitForTimeout(delay + 150);
    await expect(root(page)).toHaveAttribute('data-probe-cursor-hidden', 'no');

    await page.mouse.up();
    await expect(root(page)).toHaveAttribute('data-probe-cursor-hidden', 'yes', { timeout: delay + 2_000 });
});
