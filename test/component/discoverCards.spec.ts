import { expect, test } from './fixtures';

// test/component/discoverCards.spec.ts
// 「发现」页的两条回归防线：
//
// 1. FM 段必须排在第一位，且空段被丢弃 —— 排序或装配坏了不会报错，只会让首屏安静地少一屏内容。
//    探针把每段渲染成一个带 `data-probe-item-id` 的 <li>，所以段数 == 非空段数。
// 2. 封面加载失败必须停在**静止**占位图。少了 onError 时占位图会永远以 3 秒一圈转下去，
//    读起来像还在加载，而它已经不会成功了。

const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

// 探针的「封面可用」走同源路径，由这里 route 桩立即返回。曾经它用真实外网网易云图，
// 加载慢或被网络拦下时卡片走占位图，断言就偶发失败——那种失败与被测装配契约无关，
// 纯粹是环境抖动，会掩盖真回归（同仓库 latticeArtwork / collectionMorph 的做法）。
const serveProbeCover = (page: import('@playwright/test').Page) => page.route(
    '**/probe-cover-ok.png',
    route => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }),
);

test('discover keeps the FM segment first and drops the empty ones', async ({ mount, page }) => {
    await serveProbeCover(page);
    const probe = await mount('discoverCards');

    const segments = probe.locator('[data-probe-item-id]');
    // fixture 只填了 FM 段与新歌速递段，similar / radar 为空会被 buildDiscoverSections 丢弃，
    // 所以就是 2 个。这里曾经写 3：那是把「段」和「卡」混为一谈，而下面那条卡片契约
    // id `personal_fm` 又是另一回事，两个数不该互相推。
    await expect(segments).toHaveCount(2);

    // FM 段排第一。
    await expect(segments.first()).toHaveAttribute('data-probe-item-id', 'personal-fm');
    await expect(segments.first()).toHaveAttribute('data-probe-item-fm', 'true');
    await expect(segments.nth(1)).toHaveAttribute('data-probe-item-fm', 'false');
});

test('a failed cover stops on a static placeholder instead of spinning forever', async ({ mount, page }) => {
    await serveProbeCover(page);
    const probe = await mount('discoverCards');

    const brokenCover = probe.locator('img[src*="probe-definitely-missing-cover"]');
    await expect(brokenCover).toBeVisible();
    // 等失败回调跑完：图片保持隐藏，占位图保持可见。
    await expect(brokenCover).toHaveCSS('opacity', '0');

    const placeholder = brokenCover.locator('xpath=following-sibling::div[1]');
    await expect(placeholder).toBeVisible();
    // 关键断言：不再有 animate-spin。没有这条兜底时它会永远转下去。
    await expect(placeholder.locator('svg')).not.toHaveClass(/animate-spin/);
});
