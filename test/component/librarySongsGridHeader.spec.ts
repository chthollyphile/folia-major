import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

// Regression for the real GridView's title intercepting library retry clicks at narrow widths.

const titleSelector = '.group\\/grid-title';

async function expectBelowTitle(status: Locator, title: Locator, width: number) {
    const statusBox = await status.boundingBox();
    const titleBox = await title.boundingBox();
    expect(statusBox).not.toBeNull();
    expect(titleBox).not.toBeNull();
    if (!statusBox || !titleBox) throw new Error('Header geometry is missing');
    expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
    expect(statusBox.x).toBeGreaterThanOrEqual(0);
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(width);
}

for (const width of [725, 320]) {
    test(`library retry receives pointer clicks without covering the title at ${width}px`, async ({ page, mount }) => {
        await page.setViewportSize({ width, height: 1000 });
        const root = await mount('librarySongsGridHeader');
        const status = root.locator('[data-library-songs-status="refreshFailed"]');
        const retry = status.getByRole('button', { name: 'Retry', exact: true });
        await expect(retry).toBeVisible();
        expect(await retry.evaluate(element => {
            const box = element.getBoundingClientRect();
            return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
        })).toBe(true);
        await retry.click();
        await expect(root.locator('[data-probe-retries]')).toHaveAttribute('data-probe-retries', '1');
        await expectBelowTitle(status, root.locator(titleSelector), width);
        const back = root.locator('button').filter({ has: page.locator('svg.lucide-chevron-left') });
        await back.click();
        await expect(root.locator('[data-probe-backs]')).toHaveAttribute('data-probe-backs', '1');
    });

    test(`library progress remains readable below the title in every state at ${width}px`, async ({ page, mount }) => {
        await page.setViewportSize({ width, height: 1000 });
        const root = await mount('librarySongsGridHeader');
        for (const [stage, key, count] of [
            ['refreshFailed', 'refreshFailed', '200'],
            ['loading', 'loading', '200'],
            ['complete', 'loaded', '666'],
        ]) {
            await root.locator(`[data-probe-stage="${stage}"]`).click();
            const status = root.locator(`[data-library-songs-status="${key}"]`);
            await expect(status.getByRole('status')).toContainText(count);
            await expectBelowTitle(status, root.locator(titleSelector), width);
        }
    });
}

test('unsupported library rows visibly disable playback but retain collect and save actions', async ({ page, mount }) => {
    await page.setViewportSize({ width: 725, height: 1000 });
    const root = await mount('librarySongsGridHeader');
    await root.locator('[data-probe-stage="unsupported"]').click();
    const play = root.locator('[data-grid-card-play]');
    await expect(play).toHaveCount(1);
    await expect(play).toBeDisabled();
    await expect(play).toHaveAttribute('title', 'Playback not supported');
    const collect = root.locator('[data-grid-card-quick="collect"]');
    await expect(collect).toBeEnabled();
    await expect(root.locator('[data-grid-card-quick="save-to-playlist"]')).toBeEnabled();
    await expect(root.getByRole('button', { name: 'Add to Queue', exact: true })).toHaveCount(0);
    await collect.focus();
    await collect.click();
    await expect(root.locator('[data-probe-collected]')).toHaveAttribute('data-probe-collected', '1');
});

test('filtered unsupported library rows remain collectable while bulk playback is disabled', async ({ page, mount }) => {
    await page.setViewportSize({ width: 725, height: 1000 });
    const root = await mount('librarySongsGridHeader');
    await root.locator('[data-probe-stage="unsupported"]').click();
    await root.getByRole('textbox', { name: 'Probe filter' }).fill('Uploaded');
    await root.locator(titleSelector).click();
    const collect = root.locator('[data-grid-action="collect-scope"]');
    await expect(collect).toContainText('1');
    await expect(collect).toBeEnabled();
    await expect(root.getByRole('button', { name: 'Play 0 songs', exact: true })).toBeDisabled();
    await collect.click();
    await expect(root.locator('[data-probe-collected]')).toHaveAttribute('data-probe-collected', '1');
});

test('ordinary collections keep the centered floating title and have no library status row', async ({ page, mount }) => {
    await page.setViewportSize({ width: 725, height: 1000 });
    const root = await mount('librarySongsGridHeader');
    await root.locator('[data-probe-stage="playlist"]').click();
    await expect(root.locator('[data-library-songs-status]')).toHaveCount(0);
    const title = root.locator(titleSelector);
    await expect(title).toContainText('Ordinary playlist');
    expect(await title.evaluate(element => getComputedStyle(element).position)).toBe('absolute');
});
