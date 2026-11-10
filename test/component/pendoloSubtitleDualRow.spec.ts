import { expect, test } from './fixtures';
// test/component/pendoloSubtitleDualRow.spec.ts

// 时计转盘的副字幕双行：罗马音在上、翻译在下，第二行字号更小、更淡；缺哪一种就少哪一行。
// 只断言焦点行（第 0 行）的副字幕；转盘上其它行的翻译（译文 N）不参与。

const focalRows = (page: import('@playwright/test').Page) => page.locator('[data-pendolo-subtitle-track]').filter({ hasNotText: '译文' });

test('双行模式下焦点行的罗马音在上、翻译在下，第二行更小更淡', async ({ mount, page }) => {
    await mount('pendoloSubtitleDualRow');
    const rows = focalRows(page);

    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAttribute('data-pendolo-subtitle-track', 'romanization');
    await expect(rows.nth(0)).toHaveText('ohayou gozaimasu');
    await expect(rows.nth(1)).toHaveAttribute('data-pendolo-subtitle-track', 'translation');
    await expect(rows.nth(1)).toHaveText('早上好');

    const top = (await rows.nth(0).boundingBox())!;
    const bottom = (await rows.nth(1).boundingBox())!;
    expect(bottom.y).toBeGreaterThan(top.y);

    const style = (index: number) => rows.nth(index).evaluate(el => {
        const computed = getComputedStyle(el);
        return { fontPx: parseFloat(computed.fontSize), lineHeightPx: parseFloat(computed.lineHeight), opacity: parseFloat(computed.opacity) };
    });
    const first = await style(0);
    const second = await style(1);
    expect(second.fontPx).toBeLessThan(first.fontPx);
    expect(first.opacity).toBe(1);
    expect(second.opacity).toBeLessThan(1);
    // 转盘预留高度按 字号 × 1.5 测量（pendoloSubtitleTracks），DOM 行高必须一致，否则折行多时会压到下一句。
    for (const row of [first, second]) {
        expect(row.lineHeightPx).toBeCloseTo(row.fontPx * 1.5, 1);
    }
});

test('缺一种数据时只剩那一行，占位文本和重复内容不产生多余行', async ({ mount, page }) => {
    await mount('pendoloSubtitleDualRow');
    const rows = focalRows(page);

    await page.locator('[data-probe-line="romanizationOnly"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-pendolo-subtitle-track', 'romanization');

    await page.locator('[data-probe-line="translationOnly"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute('data-pendolo-subtitle-track', 'translation');

    await page.locator('[data-probe-line="placeholder"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('早上好');

    await page.locator('[data-probe-line="same"]').click();
    await expect(rows).toHaveCount(1);

    await page.locator('[data-probe-line="neither"]').click();
    await expect(rows).toHaveCount(0);
});

test('单来源模式保持单行', async ({ mount, page }) => {
    await mount('pendoloSubtitleDualRow');
    const rows = focalRows(page);

    await page.locator('[data-probe-mode="translation"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('早上好');
    // 这一行刚才是双行里更淡的第二行，变回不透明有 200ms 的过渡：等它走完再读。
    await expect.poll(() => rows.first().evaluate(el => parseFloat(getComputedStyle(el).opacity))).toBe(1);

    await page.locator('[data-probe-mode="romanization"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText('ohayou gozaimasu');

    await page.locator('[data-probe-mode="none"]').click();
    await expect(rows).toHaveCount(0);
});
