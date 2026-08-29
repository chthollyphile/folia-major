import { expect, test } from '@playwright/test';

// test/ui/devProbe.spec.ts

test('探针内容超过视口时页面可以滚动', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await page.goto('/dev-probe.html');
    await page.getByRole('heading', { name: 'Component Probes' }).waitFor();

    expect(await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight)).toBe(true);

    await page.mouse.move(320, 180);
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
});
