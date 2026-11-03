import { expect, test } from './fixtures';

// test/component/playerLayout.spec.ts
// Pointer hit testing needs a browser: geometry alone cannot prove controls remain reachable.

test.beforeEach(async ({ mount }) => { await mount('playerLayout'); });

test('full chat preserves the hidden back-button reveal region and native card clicks', async ({ page }) => {
    const chat = page.locator('[data-layout-demo-chat]');
    await expect(chat).toBeVisible();
    await expect.poll(async () => (await chat.boundingBox())!.y).toBe(132);
    await page.mouse.move(42, 42);
    const back = page.getByRole('button', { name: 'Back to home' });
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await back.click();
    await expect(page.locator('[data-probe-layout]')).toHaveAttribute('data-back-hits', '1');
    await page.getByRole('button', { name: 'Activate native card' }).click();
    await expect(page.locator('[data-probe-layout]')).toHaveAttribute('data-card-hits', '1');
});

test('the private demo avoids a side panel and updates after viewport resizing', async ({ page }) => {
    const dialog = page.locator('[data-layout-demo-dialog]');
    await expect(dialog).toBeVisible();
    await page.locator('[data-probe-action="panel"]').click();
    await expect.poll(async () => {
        const a = (await dialog.boundingBox())!;
        const b = (await page.locator('[data-probe-panel]').boundingBox())!;
        return a.x + a.width <= b.x;
    }).toBe(true);
    await page.setViewportSize({ width: 800, height: 600 });
    await expect.poll(async () => {
        const box = (await dialog.boundingBox())!;
        return box.x >= 0 && box.y >= 0 && box.x + box.width <= 800 && box.y + box.height <= 600;
    }).toBe(true);
});

test('moving the bottom baseline raises the native card and the chat clearance together', async ({ page }) => {
    const chat = page.locator('[data-layout-demo-chat]');
    await expect(chat).toBeVisible();
    await expect.poll(async () => (await chat.boundingBox())!.height).toBeGreaterThan(100);
    const before = (await chat.boundingBox())!;
    await page.locator('[data-probe-action="lift"]').click();
    await expect.poll(async () => (await chat.boundingBox())!.height).toBeLessThan(before.height - 60);
    const after = (await chat.boundingBox())!;
    const card = (await page.getByRole('button', { name: 'Activate native card' }).boundingBox())!;
    expect(after.y + after.height).toBeLessThanOrEqual(card.y - 10);
});

test('publishes native status toasts and returns null immediately outside the player', async ({ page }) => {
    await page.locator('[data-probe-action="toast"]').click();
    await expect.poll(async () => {
        const text = await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot');
        return text?.includes('notification');
    }).toBe(true);
    await page.locator('[data-probe-action="replace-toast"]').click();
    await page.waitForTimeout(400);
    await expect.poll(async () => (await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot'))?.includes('notification')).toBe(true);
    await page.locator('[data-probe-action="page"]').click();
    await expect(page.locator('[data-layout-demo-chat]')).toBeHidden();
    await expect(page.locator('[data-layout-demo-snapshot]')).toHaveAttribute('data-layout-demo-snapshot', 'null');
});

test('static visuals keep live app-overlay geometry and hidden control reveal regions', async ({ page }) => {
    await page.locator('[data-probe-action="static"]').click();
    const chat = page.locator('[data-layout-demo-chat]');
    await expect(chat).toBeVisible();
    await expect.poll(async () => {
        const text = await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot');
        const obstacles = JSON.parse(text ?? 'null')?.obstacles ?? [];
        return ['navigation', 'panel'].every(role => obstacles.some((item: { role: string; kind: string }) => item.role === role && item.kind === 'reveal-area'));
    }).toBe(true);
    await expect.poll(async () => (await chat.boundingBox())!.y).toBe(132);
    await page.mouse.move(42, 42);
    const back = page.getByRole('button', { name: 'Back to home' });
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await back.click();
    await expect(page.locator('[data-probe-layout]')).toHaveAttribute('data-back-hits', '1');
});

test('a lower side panel leaves the non-overlapping upper-right dialog in place', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const dialog = page.locator('[data-layout-demo-dialog]');
    await expect.poll(async () => (await dialog.boundingBox())?.x).toBe(876);
    const before = (await dialog.boundingBox())!;
    await page.locator('[data-probe-action="lower-panel"]').click();
    await expect(page.locator('[data-probe-panel]')).toBeVisible();
    await expect.poll(async () => {
        const snapshot = JSON.parse(await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot') ?? 'null');
        return snapshot?.obstacles.some((item: { role: string; kind: string; rect: { height: number } }) => (
            item.role === 'panel' && item.kind === 'control' && item.rect.height > 100
        ));
    }).toBe(true);
    const after = (await dialog.boundingBox())!;
    const panel = (await page.locator('[data-probe-panel]').boundingBox())!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.y + after.height + 12).toBeLessThanOrEqual(panel.y);
    await page.screenshot({ path: testInfo.outputPath('lower-panel-geometry.png') });
});

test('app.overlay content cannot reveal the native back button behind it', async ({ page }) => {
    const chat = page.locator('[data-layout-demo-chat]');
    await expect(chat).toBeVisible();
    await expect.poll(async () => (await chat.boundingBox())?.y).toBe(132);
    const back = page.getByRole('button', { name: 'Back to home' });
    await page.mouse.move(400, 300);
    await expect(back).toHaveCSS('pointer-events', 'none');
    // Deliberately violate the published reservation to verify that a sibling app.overlay
    // does not pass mouse movement through the shell. Real demo placement stays at y=132.
    await chat.evaluate(element => { (element as HTMLElement).style.top = '76px'; });
    await page.mouse.move(42, 90);
    expect(await page.evaluate(() => Boolean(document.elementFromPoint(42, 90)?.shadowRoot?.elementFromPoint(42, 90)?.closest('[data-layout-demo-chat]')))).toBe(true);
    await expect(back).toHaveCSS('pointer-events', 'none');
    await page.mouse.move(42, 42);
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await back.click();
    await expect(page.locator('[data-probe-layout]')).toHaveAttribute('data-back-hits', '1');
    await page.locator('[data-probe-action="page"]').click();
    await page.mouse.move(400, 300);
    await page.mouse.move(42, 42);
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await expect(page.locator('[data-layout-demo-snapshot]')).toHaveAttribute('data-layout-demo-snapshot', 'null');
});

test('shell capture receives a descendant mouse move even if it stops bubbling', async ({ page }) => {
    const back = page.getByRole('button', { name: 'Back to home' });
    await page.mouse.move(400, 300);
    await expect(back).toHaveCSS('pointer-events', 'none');
    await page.locator('[data-probe-shell-child]').hover();
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await page.mouse.move(-10, -10);
    await expect(back).toHaveCSS('pointer-events', 'none');
});

for (const overlay of ['settings', 'command']) {
    test(`${overlay} outside the shell does not reveal the back button without any mod`, async ({ page }) => {
        await page.locator('[data-probe-action="mod"]').click();
        await expect(page.locator('[data-folium-slot="app.overlay"]')).toHaveCount(0);
        const back = page.getByRole('button', { name: 'Back to home' });
        await page.mouse.move(400, 300);
        await expect(back).toHaveCSS('pointer-events', 'none');
        await page.locator(`[data-probe-action="${overlay}"]`).click();
        await expect(page.locator('[data-folia-keyboard-window]')).toBeVisible();
        await page.mouse.move(42, 90);
        expect(await page.evaluate(() => Boolean(document.elementFromPoint(42, 90)?.closest('[data-folia-keyboard-window]')))).toBe(true);
        await expect(back).toHaveCSS('pointer-events', 'none');
        await page.mouse.move(42, 42);
        await expect(back).toHaveCSS('pointer-events', 'none');
        await page.locator(`[data-probe-action="${overlay}"]`).click();
        await expect(page.locator('[data-folia-keyboard-window]')).toHaveCount(0);
        await page.mouse.move(400, 300);
        await page.mouse.move(42, 42);
        await expect(back).toHaveCSS('pointer-events', 'auto');
    });
}

test('publishes the complete 120px return hotspot independently of the button rem size', async ({ page }) => {
    const readNavigation = async () => {
        const text = await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot');
        return JSON.parse(text ?? 'null')?.obstacles.find((item: { role: string }) => item.role === 'navigation');
    };
    await expect.poll(readNavigation).toEqual({
        role: 'navigation', kind: 'reveal-area', rect: { left: 0, top: 0, width: 120, height: 120 },
    });
    await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
    await expect.poll(async () => (await page.locator('[data-layout-demo-chat]').boundingBox())?.y).toBe(132);
    await expect.poll(readNavigation).toEqual({
        role: 'navigation', kind: 'reveal-area', rect: { left: 0, top: 0, width: 120, height: 120 },
    });
    const back = page.getByRole('button', { name: 'Back to home' });
    await page.mouse.move(42, 90);
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await back.click();
    await expect(page.locator('[data-probe-layout]')).toHaveAttribute('data-back-hits', '1');
});

test('reserves a full-width 56px titlebar only with custom window chrome', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    const readSnapshot = async () => JSON.parse(await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot') ?? 'null');
    await expect.poll(async () => (await readSnapshot())?.obstacles.find((item: { role: string }) => item.role === 'window'))
        .toEqual({ role: 'window', kind: 'reveal-area', rect: { left: 0, top: 0, width: 1200, height: 56 } });
    expect((await readSnapshot()).insets).toEqual({ top: 56, right: 0, bottom: 0, left: 0 });
    await page.locator('[data-probe-action="titlebar"]').click();
    await expect.poll(async () => (await readSnapshot())?.obstacles.some((item: { role: string }) => item.role === 'window')).toBe(false);
    expect((await readSnapshot()).insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
});


test('disabling the appended layer restores native geometry and can re-enable cleanly', async ({ page }) => {
    await expect(page.locator('[data-layout-demo-chat]')).toBeVisible();
    await page.mouse.move(42, 42);
    const back = page.getByRole('button', { name: 'Back to home' });
    const card = page.getByRole('button', { name: 'Activate native card' });
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await expect(back).toHaveCSS('transform', 'none');
    const before = [await back.boundingBox(), await card.boundingBox()];
    await page.locator('[data-probe-action="mod"]').click();
    await expect(page.locator('[data-folium-slot="app.overlay"]')).toHaveCount(0);
    await page.mouse.move(42, 42);
    await expect(back).toHaveCSS('pointer-events', 'auto');
    await expect.poll(async () => [await back.boundingBox(), await card.boundingBox()]).toEqual(before);
    await back.click();
    await expect(page.locator('[data-probe-layout]')).toHaveAttribute('data-back-hits', '1');
    await page.locator('[data-probe-action="mod"]').click();
    await expect(page.locator('[data-layout-demo-chat]')).toBeVisible();
    await expect(page.locator('[data-layout-demo-chat]')).toHaveCount(1);
    await page.locator('[data-probe-action="chrome"]').click();
    await expect.poll(async () => (await page.locator('[data-layout-demo-snapshot]').getAttribute('data-layout-demo-snapshot'))?.includes('playback')).toBe(false);
});
