import { expect, test } from './fixtures';
// test/component/subtitleOverlayRows.spec.ts

// 共用底部字幕的行布局：行按布局从上到下排、第一行之后小一档；缺哪一种就少哪一行，不留空行占位。

test('三行布局按 当前句、罗马音、翻译 从上到下排，后两行字号小一档', async ({ mount, page }) => {
    await mount('subtitleOverlayRows');
    const rows = page.locator('[data-subtitle-track]');

    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toHaveAttribute('data-subtitle-track', 'current');
    await expect(rows.nth(0)).toHaveText('おはよう');
    await expect(rows.nth(1)).toHaveAttribute('data-subtitle-track', 'romanization');
    await expect(rows.nth(1)).toHaveText('ohayou');
    await expect(rows.nth(2)).toHaveAttribute('data-subtitle-track', 'translation');
    await expect(rows.nth(2)).toHaveText('早安');

    for (const index of [1, 2]) {
        const above = (await rows.nth(index - 1).boundingBox())!;
        const below = (await rows.nth(index).boundingBox())!;
        expect(above.y + above.height).toBeLessThanOrEqual(below.y + 1);
    }

    const fontPx = (index: number) => rows.nth(index).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(await fontPx(1)).toBeLessThan(await fontPx(0));
    expect(await fontPx(2)).toBe(await fontPx(1));
});

test('这一句缺哪种数据就只少那一行', async ({ mount, page }) => {
    await mount('subtitleOverlayRows');
    const rows = page.locator('[data-subtitle-track]');

    await page.locator('[data-probe-line="romanizationOnly"]').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveAttribute('data-subtitle-track', 'romanization');

    await page.locator('[data-probe-line="translationOnly"]').click();
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toHaveAttribute('data-subtitle-track', 'translation');

    await page.locator('[data-probe-line="neither"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-subtitle-track', 'current');
});

test('单行布局只显示自己那一行，这一句没有时改为预览接下来的歌词', async ({ mount, page }) => {
    await mount('subtitleOverlayRows');
    const rows = page.locator('[data-subtitle-track]');

    await page.locator('[data-probe-layout="translation"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('早安');

    await page.locator('[data-probe-layout="romanization"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('ohayou');

    await page.locator('[data-probe-layout="current"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('おはよう');

    await page.locator('[data-probe-layout="translation"]').click();
    await page.locator('[data-probe-line="neither"]').click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByText('こんにちは')).toBeVisible();
});

test('两行「下一句」依次是接下来的两句', async ({ mount, page }) => {
    await mount('subtitleOverlayRows');
    const rows = page.locator('[data-subtitle-track]');

    await page.locator('[data-probe-layout="current+next+next"]').click();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toHaveAttribute('data-subtitle-track', 'next');
    await expect(rows.nth(1)).toHaveText('こんにちは');
    await expect(rows.nth(2)).toHaveText('こんばんは');
});
