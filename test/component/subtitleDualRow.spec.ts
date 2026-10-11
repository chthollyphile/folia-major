import { expect, test } from './fixtures';
// test/component/subtitleDualRow.spec.ts

// 共用副字幕的双行样式：罗马音在上、翻译在下；缺哪一种就少哪一行，不留空行占位。

test('双行模式下罗马音在上、翻译在下，且字号小一档', async ({ mount, page }) => {
    await mount('subtitleDualRow');
    const rows = page.locator('[data-subtitle-track]');

    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-subtitle-track', 'romanization');
    await expect(rows.nth(0)).toHaveText('ohayou');
    await expect(rows.nth(1)).toHaveAttribute('data-subtitle-track', 'translation');
    await expect(rows.nth(1)).toHaveText('早安');

    const top = (await rows.nth(0).boundingBox())!;
    const bottom = (await rows.nth(1).boundingBox())!;
    expect(top.y + top.height).toBeLessThanOrEqual(bottom.y + 1);

    const fontPx = (index: number) => rows.nth(index).evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    expect(await fontPx(1)).toBeLessThan(await fontPx(0));
});

test('双行模式下只有一种数据时只剩那一行', async ({ mount, page }) => {
    await mount('subtitleDualRow');
    const rows = page.locator('[data-subtitle-track]');

    await page.locator('[data-probe-line="romanizationOnly"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-subtitle-track', 'romanization');

    await page.locator('[data-probe-line="translationOnly"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-subtitle-track', 'translation');

    await page.locator('[data-probe-line="neither"]').click();
    await expect(rows).toHaveCount(0);
});

test('单来源模式保持原样，只显示自己那一行', async ({ mount, page }) => {
    await mount('subtitleDualRow');
    const rows = page.locator('[data-subtitle-track]');

    await page.locator('[data-probe-mode="translation"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('早安');

    await page.locator('[data-probe-mode="romanization"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('ohayou');

    await page.locator('[data-probe-mode="none"]').click();
    await expect(rows).toHaveCount(0);
});

for (const mode of ['translation', 'romanization', 'both']) {
    test(`${mode} 字幕在长间奏中保留 1.5 秒后消失，短句间隔仍然连续`, async ({ mount, page }) => {
        await mount('subtitleDualRow');
        await page.locator(`[data-probe-mode="${mode}"]`).click();
        const rows = page.locator('[data-subtitle-track]');
        const rowCount = mode === 'both' ? 2 : 1;

        await page.locator('[data-probe-time="2.5"]').click();
        await expect(rows).toHaveCount(rowCount);
        await expect(rows.first()).toHaveText(mode === 'translation' ? '早安' : 'ohayou');
        await page.locator('[data-probe-time="3.2"]').click();
        await expect(rows.first()).toHaveText(mode === 'translation' ? '午安' : 'konnichiwa');

        await page.locator('[data-probe-time="4.1"]').click();
        await expect(rows).toHaveCount(rowCount);
        const renders = await page.locator('[data-probe-renders]').getAttribute('data-probe-renders');
        await page.locator('[data-probe-time="5.4"]').click();
        await expect(rows).toHaveCount(rowCount);
        await page.locator('[data-probe-time="5.5"]').click();
        await expect(rows).toHaveCount(0);
        await expect(page.locator('[data-probe-renders]')).toHaveAttribute('data-probe-renders', renders!);
    });
}

test('暂停不消耗保留时间，间奏之间跳转和回退重新选择字幕', async ({ mount, page }) => {
    await mount('subtitleDualRow');
    const rows = page.locator('[data-subtitle-track]');

    await page.locator('[data-probe-time="4.1"]').click();
    await expect(rows.first()).toHaveText('konnichiwa');
    await page.waitForTimeout(1800);
    await expect(rows).toHaveCount(2);

    // Both positions have index -1: the clock alone must select the new completed line.
    await page.locator('[data-probe-time="22.1"]').click();
    await expect(rows.first()).toHaveText('konbanwa');
    await page.locator('[data-probe-time="23.5"]').click();
    await expect(rows).toHaveCount(0);
    await page.locator('[data-probe-time="2.1"]').click();
    await expect(rows.first()).toHaveText('ohayou');
    await page.locator('[data-probe-time="0"]').click();
    await expect(rows).toHaveCount(0);
});
