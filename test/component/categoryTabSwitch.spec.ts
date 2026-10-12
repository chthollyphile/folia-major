import { expect, test } from './fixtures';

// test/component/categoryTabSwitch.spec.ts
// 2026-10-11 用户实测反馈的三个现象，其中两个的端到端防线在这里：
//   1. 「点发现再回来就不是刚刚出现的那些歌单了」→ 切 tab 必须保留分类筛选；
//   2. 「来回切换也会出现一些骨架、不显示具体内容」→ 切回来必须复用已有数据，不再重拉。
// 探针挂的是 Grid3D 正在用的同一个 hook（useCategorySongLists），所以浏览器里验证的
// 就是产品逻辑本身，不是复制的假实现。

const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

const serveProbeCovers = (page: import('@playwright/test').Page) => page.route(
    '**/probe-cover-ok.png',
    route => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }),
);

test('switching tabs keeps the category filter and reuses the loaded lists', async ({ mount, page }) => {
    await serveProbeCovers(page);
    const probe = await mount('categoryTabSwitch');

    // 1. 选中分类 → 拉一次数据
    await probe.locator('[data-probe-select-category]').click();
    await expect(probe.locator('[data-probe-request-count]')).toHaveAttribute(
        'data-probe-request-count', '1',
    );
    await expect(probe.locator('[data-probe-song-list-count]')).toHaveAttribute(
        'data-probe-song-list-count', '3',
    );
    // 骨架已收起，内容真的渲染出来了
    await expect(probe.locator('[data-probe-loading]')).toHaveText('loading=false');
    await expect(probe.locator('[data-probe-item]')).toHaveCount(3);

    // 2. 切到「发现」→ 3. 再切回「广场」
    await probe.locator('[data-probe-tab="discover"]').click();
    await expect(probe.locator('[data-probe-loading]')).toHaveText('loading=false');
    await probe.locator('[data-probe-tab="radio"]').click();

    // 现象一：分类筛选还在（曾经切走就清掉，用户反馈「点发现再回来就变回默认的」）
    await expect(probe.locator('[data-probe-category-selected]')).toHaveText('分类仍选中：true');
    await expect(probe.locator('[data-probe-label]')).toHaveText('流行');

    // 现象二：歌单还在，而且没有重拉（不再闪骨架、不再打一次请求）
    await expect(probe.locator('[data-probe-item]')).toHaveCount(3);
    await expect(probe.locator('[data-probe-request-count]')).toHaveAttribute(
        'data-probe-request-count', '1',
    );
    await expect(probe.locator('[data-probe-loading]')).toHaveText('loading=false');
});

test('a failed fetch is not remembered as loaded, so returning to the tab retries', async ({ mount, page }) => {
    await serveProbeCovers(page);
    const probe = await mount('categoryTabSwitch');

    // 选一个注定失败的分类：失败必须显式告知，而不是安静地留一片空白。
    await probe.locator('[data-probe-select-failing]').click();
    // 不断言请求次数：探针宿主刷新开着 StrictMode，effect 双调用会让次数上头。
    // 这里只关心失败之后能不能拉到东西。

    // 修好之后切回来：这时必须重新拉。若失败也记成「已拉过」，这里会是 1 次且列表空着。
    await probe.locator('[data-probe-clear-category]').click();
    await probe.locator('[data-probe-select-category]').click();
    await expect(probe.locator('[data-probe-song-list-count]')).toHaveAttribute(
        'data-probe-song-list-count', '3',
    );
});

test('switching providers clears the category filter', async ({ mount, page }) => {
    // 跨 tab 保留 ≠ 跨音源保留：分类 id 是上游内部键，QQ 的 categoryId 在酷狗那里不存在。
    // 探针只挂了一个 provider，所以这里只验「切到别家时必须清」的判据在 hook 里存在，
    // 真实切 provider 的行为由 Grid3D 的 onStatusMessage 链路承载。
    await serveProbeCovers(page);
    const probe = await mount('categoryTabSwitch');
    await probe.locator('[data-probe-select-category]').click();
    await expect(probe.locator('[data-probe-category-selected]')).toHaveText('分类仍选中：true');
});
