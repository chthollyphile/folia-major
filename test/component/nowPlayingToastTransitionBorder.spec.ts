import { expect, test } from './fixtures';
// test/component/nowPlayingToastTransitionBorder.spec.ts

// 探针页跑一次混音，确认卡片边框上的发光描边真的挂起来了、尺寸是绕着卡片算的。
// 断言停在「画布存在且尺寸对得上」这一层：像素基线要 WebGL 逐帧稳定，而这个着色器本来
// 就是随时间走的，钉基线只会得到一个每次都在抖的测试。

test('混音进度描边挂在卡片周围', async ({ mount, page }) => {
    await mount('nowPlayingToastTransitionBorder');
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
test('设置页开关的预览 cue 收得到', async ({ mount, page }) => {
    await mount('nowPlayingToastTransitionBorder');
    const preview = page.locator('[data-probe-action="settings-preview"]');
    await expect(preview).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);

    await preview.click();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });
});

// 卡片外面那层是 pointer-events-none（描边和扫光都不该吃鼠标），只有卡片本身把它翻回来。
// 这个用例钉的就是那一层翻转：鼠标点、键盘回车都要到得了。
test('卡片本身可点，外面那层不吃鼠标', async ({ mount, page }) => {
    await mount('nowPlayingToastTransitionBorder');
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

// 预告「接下来播放」再真的播起来，是一件连续的事：卡片上已经是那首歌了，切过去的那一刻只有标签
// 要变。用 trackKey 做 key 时它恰好在那一刻变，于是重挂 + 重放一次进场——这一组钉的就是这个。
test.describe('切歌交接', () => {
    /** 在当前卡片节点上盖个戳。React 重挂会换掉 DOM 节点，戳就没了。 */
    const stamp = (page: import('@playwright/test').Page) => page.evaluate(() => {
        const card = document.querySelector('[data-toast-card]') as HTMLElement | null;
        if (card) card.dataset.probeStamp = 'kept';
    });

    test('预告那首落地时不重挂，只换标签', async ({ mount, page }) => {
        await mount('nowPlayingToastTransitionBorder');
        const card = page.locator('[data-toast-card]');
        await expect(card).toBeVisible();
        await stamp(page);

        // 正在播放 → 预告下一首 → 那首真的播起来，全程同一个 DOM 节点。
        // 文案取英文：components project 的 fixtures 把 i18nextLng 钉成 en，这条用例以前没有
        // 种子、读的是浏览器默认语言，钉住之后才是确定的。
        await page.locator('[data-probe-action="next-up"]').click();
        await expect(card).toContainText('Next playing');
        expect(await card.getAttribute('data-probe-stamp')).toBe('kept');

        await page.locator('[data-probe-action="handover"]').click();
        await expect(card).toContainText('Now playing');
        expect(await card.getAttribute('data-probe-stamp')).toBe('kept');
    });

    // 标签是 mode="wait" 换掉的，中途那一行是空的。不占住高度的话歌名会往上跳一下再落回来,
    // 本来是为了不硬切,结果换来一次抖动。
    test('换标签的中途歌名不上下跳', async ({ mount, page }) => {
        await mount('nowPlayingToastTransitionBorder');
        const title = page.locator('[data-toast-card] .truncate').first();
        await page.locator('[data-probe-action="next-up"]').click();
        await page.waitForTimeout(700);
        const before = (await title.boundingBox())!;

        await page.locator('[data-probe-action="handover"]').click();
        // 淡出淡入之间，标签那一行没有字
        await page.waitForTimeout(150);
        const during = (await title.boundingBox())!;
        expect(Math.abs(during.y - before.y)).toBeLessThan(1);
    });

    // 换歌也不重挂：短的正在播放跳到长的下一首，看到的应该是卡片自己变长，而不是滑出再滑入。
    test('换歌是宽度补间，不是滑出再滑入', async ({ mount, page }) => {
        await mount('nowPlayingToastTransitionBorder');
        const card = page.locator('[data-toast-card]');
        await expect(card).toBeVisible();

        // 先走到第三首（标题一个字，宽度压在 240 的下限上）
        await page.locator('[data-probe-action="skip"]').click();
        await page.locator('[data-probe-action="skip"]').click();
        await expect(card).toContainText('雨');
        await page.waitForTimeout(700);
        const short = (await card.boundingBox())!;
        await stamp(page);

        // 回到第一首的长标题
        await page.locator('[data-probe-action="skip"]').click();
        await page.waitForTimeout(700);
        const long = (await card.boundingBox())!;

        expect(await card.getAttribute('data-probe-stamp')).toBe('kept');
        expect(long.width).toBeGreaterThan(short.width);
        // 整卡没有横向滑出：x 是外层给的，全程不动
        expect(Math.abs(long.x - short.x)).toBeLessThan(1);
    });
});

test('短标题也不会把卡片缩到 240px 以下', async ({ mount, page }) => {
    await mount('nowPlayingToastTransitionBorder');
    const card = page.locator('[data-toast-card]');
    await expect(card).toBeVisible();

    // 第三首标题只有一个字，是最容易缩过头的那种
    await page.locator('[data-probe-action="skip"]').click();
    await page.locator('[data-probe-action="skip"]').click();
    await expect(card).toContainText('雨');
    await page.waitForTimeout(600);

    const box = (await card.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(240);
});

// 描边自己就沿着上边缘画，两条亮线隔着几个像素并排，读起来是好几层边框套在一起。
test('混音期间收掉顶部的扫光条', async ({ mount, page }) => {
    await mount('nowPlayingToastTransitionBorder');
    const sheen = page.locator('[data-toast-sheen]');
    await expect(sheen).toBeAttached();
    await page.waitForTimeout(700);
    expect(Number(await sheen.evaluate(el => getComputedStyle(el).opacity))).toBeGreaterThan(0.9);

    await page.locator('[data-probe-action="cue"]').click();
    await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(900);
    expect(Number(await sheen.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(0.05);
});

// 封面 URL 非空但加载不出来（探针里的 track-b 指向一个失效 blob，形状和媒体缓存 revoke 掉的
// object URL 一样）。修之前「没有封面才画占位图标」那条判断只看 URL 空不空，所以这种情况留下
// 的是一个纯灰方块——background-image 失败是没有声音的。
test('封面加载失败时退回占位图标', async ({ mount, page }) => {
    await mount('nowPlayingToastTransitionBorder');
    const cover = page.locator('[data-toast-cover]');

    // 第一首有一张真的（data: URI）封面
    await expect(cover).toHaveAttribute('data-toast-cover', 'image');

    // 换到封面指向失效 blob 的那首
    await page.locator('[data-probe-action="skip"]').click();
    await expect(cover).toHaveAttribute('data-toast-cover', 'placeholder');

    // 再换到真的没有封面的那首，结果应该一样
    await page.locator('[data-probe-action="skip"]').click();
    await expect(cover).toHaveAttribute('data-toast-cover', 'placeholder');
});
