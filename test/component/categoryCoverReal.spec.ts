import { expect, test } from './fixtures';

// test/component/categoryCoverReal.spec.ts
// 分类歌单封面回归防线。
//
// 2026-10-11 用户实测反馈：分类筛出来的歌单只有骨架没有封面。真因是 qqNormalize 的
// 封面候选里没有 `imgurl` —— 而 /getSongLists 真实响应里封面恰恰只给这个键。
// 这类退化不抛异常（字段全走可选链），界面只是安静地少一张图，所以必须钉住。
//
// 探针里固化的是真实抓取的上游条目，走真实正规化 + 真实 PolaroidCard。
// 封面图片本身用本地桩（同仓库 latticeArtwork / collectionMorph 的做法）：
// 组件测试不依赖外网，既快又不受网络波动影响。

const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

// 三条 fixture 各自的封面 hash —— 用来断言上游 URL 原样传到了 <img>，没被中间改写坏。
const EXPECTED_COVER_HASHES = [
    's4SoBc0IrDEDpHKlDkDflKbCgbic5ldSQrdsEafqvxULdib5CvKhaibww',
    '1Jcpjia5qaEibPyTuy709wFiapqHbxdewwwc5yBJI7NiaNMN9XDhUJPibJA',
    'qhuJFHlwiayRp1rhWoJk9HaAkric2uNwiaX5vwuDF1mb4LgEId9z2eExg',
];

const serveCovers = (page: import('@playwright/test').Page) => page.route(
    '**/music_cover/**',
    route => route.fulfill({ contentType: 'image/png', body: PIXEL_PNG }),
);

test('real category song lists keep a cover that actually renders', async ({ mount, page }) => {
    await serveCovers(page);
    const probe = await mount('categoryCoverReal');

    const cards = probe.locator('[data-probe-card="category"]');
    await expect(cards).toHaveCount(3);

    // 三张卡的封面都必须取到（这一步守住 imgurl 映射）。
    const metas = await cards.locator('[data-probe-meta]').allTextContents();
    for (const meta of metas) {
        expect(JSON.parse(meta).hasCover).toBe(true);
    }

    // 播放量也要映射（listennum），否则歌单详情页的「N 次播放」对 QQ 永远是空的。
    expect(metas.map((meta: string) => JSON.parse(meta).playCount))
        .toEqual([8553372, 1814465, 55497489]);

    // 关键一步：卡片里真的有 <img> 且解码出非零尺寸 —— 只查 coverUrl 非空是不够的，
    // URL 对了不等于图片元素存在或能加载。
    await expect.poll(async () => probe.locator('img').count(), { timeout: 10000 }).toBe(3);
    await expect.poll(async () => probe.locator('img').evaluateAll(
        (nodes: HTMLImageElement[]) => nodes.map((img) => img.naturalWidth),
    ), { timeout: 10000 }).toEqual([1, 1, 1]);

    // 上游给的 URL 必须原样传给 <img>：hash 一条都不能串，串了就是映射把封面配错了卡片。
    const sources = await probe.locator('img').evaluateAll(
        (nodes: HTMLImageElement[]) => nodes.map((img) => img.currentSrc || img.src),
    );
    EXPECTED_COVER_HASHES.forEach((hash, index) => {
        expect(sources[index]).toContain('music_cover');
        expect(sources[index]).toContain(hash);
    });
});
