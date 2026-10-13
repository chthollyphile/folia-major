import { expect, test } from './fixtures';

// test/component/homeCardText.spec.ts
// 2026-10-09 用户实测反馈：点进某些 tab 后只剩封面图，歌名/歌手/来源行不见。
// 这类退化不抛异常（字段全走可选链），界面只会安静地变成一堵图墙，所以用探针钉住。
//
// 断言的是「看得见的文字」，不是 DOM 里有没有节点——卡片的副标题行在
// ``item.description`` 为空时整段不渲染，那正是要防的。

test('album and category playlist cards keep their title and subtitle', async ({ mount }) => {
    const probe = await mount('homeCardText');

    const album = probe.locator('[data-probe-card="album"]');
    // 歌名必须可见：它一没，卡片就只剩一张图。
    await expect(album.getByText('叶惠美')).toBeVisible();
    await expect(album.getByText('周杰伦')).toBeVisible();

    const playlist = probe.locator('[data-probe-card="category-playlist"]');
    await expect(playlist.getByText('睡前轻音乐：把灯调暗，让耳朵慢下来')).toBeVisible();
    // 分类筛出来的卡：description 仍是歌单自己的描述（回归点：曾把它让给来源分类名）。
    await expect(playlist.getByText('适合在睡前置顶播放的安静歌单')).toBeVisible();
});

test('Grid3DSlider text resolvers keep name, subtitle and source rows filled', async ({ mount }) => {
    const probe = await mount('homeCardText');

    const albumRow = probe.locator('[data-probe-row="album-1"]');
    await expect(albumRow.locator('[data-probe-name]')).toHaveText('叶惠美');
    await expect(albumRow.locator('[data-probe-secondary]')).toHaveText('周杰伦');
    await expect(albumRow.locator('[data-probe-summary]')).toHaveText('2003 · 11 首');

    const playlistRow = probe.locator('[data-probe-row="pl-1"]');
    await expect(playlistRow.locator('[data-probe-name]')).toHaveText('睡前轻音乐：把灯调暗，让耳朵慢下来');
    // playlist 的副标题优先取 summary（来源分类），description 由卡片自身渲染
    await expect(playlistRow.locator('[data-probe-secondary]')).toHaveText('睡前');
    // 来源行与副标题相同就不重复渲染一行
    await expect(playlistRow.locator('[data-probe-summary]')).toHaveText('');
});
