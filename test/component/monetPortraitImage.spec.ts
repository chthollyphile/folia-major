import { expect, test } from './fixtures';

// test/component/monetPortraitImage.spec.ts
// 切歌瞬间的封面闪烁：画面上必须始终有一张解码好的封面，新的那张只能盖上去，不能先清空再等。

const portraitImages = '[data-monet-portrait-image]';

test('异步封面 URL 到达时交叉淡入新封面并最终只留下它', async ({ mount, page }) => {
    const component = await mount('monetPortraitImage');

    const portrait = component.locator(portraitImages);
    const initialNode = await portrait.first().elementHandle();
    await expect.poll(() => portrait.first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await component.getByRole('button', { name: 'Resolve cached cover' }).click();

    // 交叉淡入期间两张都在，旧的那张仍然完整可见——这一段是「不闪」的定义。
    await expect.poll(() => portrait.count()).toBe(2);
    await expect(portrait.first()).toHaveAttribute('src', /7c3aed/);

    await expect.poll(() => initialNode?.evaluate(image => image.isConnected)).toBe(false);
    await expect(portrait).toHaveCount(1);
    await expect.poll(() => portrait.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

test('封面 URL 指向失效 blob 时保留已有封面而不是清空画面', async ({ mount, page }) => {
    const component = await mount('monetPortraitImage');

    const portrait = component.locator(portraitImages);
    const initialNode = await portrait.first().elementHandle();
    await expect.poll(() => portrait.first().evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await component.getByRole('button', { name: 'Point at a dead blob' }).click();

    // 解码失败的那张永远上不了台；原来那张既没被换掉也没被淡出。
    await page.waitForTimeout(1500);
    await expect(portrait).toHaveCount(1);
    expect(await initialNode?.evaluate(image => image.isConnected)).toBe(true);
    await expect.poll(() => portrait.evaluate(image => Number(getComputedStyle(image).opacity))).toBe(1);
});
