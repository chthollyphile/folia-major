import { test, expect } from '@playwright/test';
// test/ui/nowPlayingToastTransitionBorder.spec.ts

// 探针页跑一次混音，确认卡片边框上的发光描边真的挂起来了、尺寸是绕着卡片算的。
// 断言停在「画布存在且尺寸对得上」这一层：像素基线要 WebGL 逐帧稳定，而这个着色器本来
// 就是随时间走的，钉基线只会得到一个每次都在抖的测试。

const PROBE_URL = '/dev-probe.html?probe=nowPlayingToastTransitionBorder';

test('混音进度描边挂在卡片周围', async ({ page }) => {
    await page.goto(PROBE_URL);
    const cue = page.locator('[data-probe-action="cue"]');
    await expect(cue).toBeVisible();

    // 混音之前没有描边：着色器 chunk 也还没有被拉下来
    await expect(page.locator('canvas')).toHaveCount(0);

    const card = page.locator('[data-toast-card]');

    await cue.click();
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    // 两个都有进场动画（卡片滑入、描边淡入），落定之后再量
    await page.waitForTimeout(1200);

    // 画布 = 卡片 + 两侧各 22px 的辉光留白，位置也相应外扩
    const cardBox = (await card.boundingBox())!;
    const canvasBox = (await canvas.boundingBox())!;
    expect(canvasBox.width).toBeCloseTo(cardBox.width + 44, 0);
    expect(canvasBox.height).toBeCloseTo(cardBox.height + 44, 0);
    expect(canvasBox.x).toBeCloseTo(cardBox.x - 22, 0);
    expect(canvasBox.y).toBeCloseTo(cardBox.y - 22, 0);

    // 描边在场就把卡片撑住：模式是限时 3 秒，早该淡出了
    await page.waitForTimeout(3500);
    await expect(card).toBeVisible();
    await expect(canvas).toBeVisible();

    // 提前结束（切歌）时描边收掉，卡片留给它自己的计时
    await page.locator('[data-probe-action="end"]').click();
    await expect(canvas).toHaveCount(0, { timeout: 5_000 });
});

// 设置页那个开关在同一个 click 处理函数里把设置拨上去、下一行就广播预览 cue，而 React 要等
// 事件结束才提交。订阅或者开关判断只要挂在 prop 上，这条预览就永远收不到——这个用例钉的就是它。
test('设置页开关的预览 cue 收得到', async ({ page }) => {
    await page.goto(PROBE_URL);
    const preview = page.locator('[data-probe-action="settings-preview"]');
    await expect(preview).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);

    await preview.click();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });
});

// 卡片外面那层是 pointer-events-none（描边和扫光都不该吃鼠标），只有卡片本身把它翻回来。
// 这个用例钉的就是那一层翻转：鼠标点、键盘回车都要到得了。
test('卡片本身可点，外面那层不吃鼠标', async ({ page }) => {
    await page.goto(PROBE_URL);
    const card = page.locator('[data-toast-card]');
    await expect(card).toBeVisible();
    await expect(page.locator('[data-probe-activations="0"]')).toBeAttached();

    await card.click();
    await expect(page.locator('[data-probe-activations="1"]')).toBeAttached();

    // 是真的 button，所以键盘白送
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-probe-activations="2"]')).toBeAttached();
});
