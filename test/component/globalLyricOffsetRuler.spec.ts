import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/globalLyricOffsetRuler.spec.ts
// 全局时间偏移的刻度尺：中线固定、刻度带跟手。这些都是只有真实浏览器才成立的性质
// （pointer capture 拖动、mask 之后中线仍要可见、刻度带的 transform 不能吃掉命中区），
// 所以走 dev 组件探针，见 dev/probes/globalLyricOffsetRuler.probe.tsx。

const RULER = '[role="slider"]';
const TAPE = '[role="slider"] .absolute.inset-0 > div';

const readOffset = async (page: Page): Promise<number> => Number(
    await page.locator('[data-probe-offset]').getAttribute('data-probe-offset'),
);

/** 从刻度尺中心水平拖动 dx 像素 */
async function dragBy(page: Page, dx: number): Promise<void> {
    const box = (await page.locator(RULER).boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 8 });
    await page.mouse.up();
}

test.beforeEach(async ({ mount }) => {
    await mount('globalLyricOffsetRuler');
});

test('刻度带跟手：向右拖动让更小的值落到中线上', async ({ page }) => {
    await dragBy(page, 120);
    const afterRight = await readOffset(page);
    expect(afterRight).toBeLessThan(0);

    await dragBy(page, -240);
    expect(await readOffset(page)).toBeGreaterThan(afterRight);
});

test('中线不被刻度带盖住，也不被边缘遮罩吃掉', async ({ page }) => {
    const box = (await page.locator(RULER).boundingBox())!;

    // 曾经的风险：刻度带是后插入的定位元素，会盖在中线之上；边缘 mask 也可能连中线一起裁掉
    const centerOpacity = await page
        .locator(RULER)
        .locator('div.pointer-events-none.absolute.left-1\\/2.top-0.h-10 > div.flex-1')
        .evaluate(el => Number(getComputedStyle(el).opacity));
    expect(centerOpacity).toBe(1);

    // 中线所在的位置必须仍然由刻度尺自身接收指针事件，拖动才可能从中心起手
    const owner = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('[role="slider"]') !== null,
        [box.x + box.width / 2, box.y + box.height / 2],
    );
    expect(owner).toBe(true);
});

test('键盘可细调：方向键 1ms，Shift 加速，Home 归零', async ({ page }) => {
    await page.locator(RULER).focus();

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect(await readOffset(page)).toBe(2);

    await page.keyboard.press('Shift+ArrowLeft');
    expect(await readOffset(page)).toBe(-8);

    await page.keyboard.press('Home');
    expect(await readOffset(page)).toBe(0);
});

test('滚轮调整刻度尺时不连带滚动外层面板', async ({ page }) => {
    const box = (await page.locator(RULER).boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);

    await expect.poll(() => readOffset(page)).not.toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
