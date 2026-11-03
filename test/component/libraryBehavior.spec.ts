import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { GridSurfaceActionId } from '../../src/types/gridCommandSurface';
import { GRID_SURFACE_ACTION_SOURCES } from '../../src/library/core/collection/collectionSurface';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import type { ProbeFixtureId } from '../../dev/probes/libraryBehavior/fixtureRules';
import {
    expectedLoadedIndexes,
    expectedPlayableIndexes,
    hasSecondAlbum,
    LOCAL_ALBUM_NAMES,
    LOCAL_ARTIST_NAME,
    LOCAL_SORT_ORDERS,
    localSongId,
    ONLINE_FIXTURES,
    onlinePlaybackKey,
    onlineSearchText,
    onlineSongId,
    PROBE_ALBUM,
    PROBE_FIRST_PAGE,
    PROBE_LONG_DESCRIPTION,
    PROBE_PROVIDER_A,
    PROBE_PROVIDER_B,
    PROBE_SECOND_ALBUM,
    PROBE_SHORT_DESCRIPTION,
    PROBE_WORDS,
} from '../../dev/probes/libraryBehavior/fixtureRules';
import '../../dev/probes/libraryBehavior/probeApi';

// test/component/libraryBehavior.spec.ts
// 集合详情的行为回归闸门（Library Core 重构期间每一步都跑）。
//
// 断言的是语义，不是像素：上游请求账（假 provider / Navidrome 垫片）、宿主收到的播放与入队回调、
// 以及命令面板同一条通道读到的 surface 状态。这样换 renderer 时，同一批场景可以原样再跑一遍。
//
// 探针页开着 StrictMode，挂载 effect 会跑两遍，所以首页请求可能出现两次：分页断言看「去重后的
// offset 序列」，不数总次数。test.fixme 记录的是已知缺陷，修它的那一步把它转正。
//
// 与渲染形态无关的场景对网格和 TUI 各跑一遍（标题前缀 [grid] / [tui]）：两套 UI 共享同一份请求、
// 结果、筛选和动作，这批用例就是验收。只有网格才有的交互（卡片按钮、侧栏、编辑、嵌套专辑）只跑网格。
// B7 起 bravais 也在参数化的列表里（[bravais]）：它的墙是虚拟化、无限拼贴（同一条目有好几份副本），用例经列表面板
// 或键盘焦点把条目带进视口；聚焦卡上第一次 Enter 展开、第二次才播放；Esc 是逐级的阶梯。

const fixture = ONLINE_FIXTURES;
const keysOf = (providerId: string, prefix: string, indexes: number[]) => (
    indexes.map(index => onlinePlaybackKey(providerId, onlineSongId(prefix, index)))
);
const bigKeys = (query = '') => keysOf(
    PROBE_PROVIDER_A,
    'big',
    expectedPlayableIndexes(expectedLoadedIndexes(fixture['online-big'].rawIndexes), query),
);
const localKey = (index: number) => `local:${localSongId(index)}`;
const cardSelector = (itemKey: string, occurrence = 0) => `[data-folia-grid-item-id="${itemKey}-${occurrence}"]`;
/** 一个条目在任一 renderer 里的 DOM：网格卡片或 TUI 行（条目键是同一种格式）。 */
const entrySelector = (itemKey: string, occurrence = 0) => (
    `${cardSelector(itemKey, occurrence)}, [data-library-entry="${itemKey}-${occurrence}"]`
);

/**
 * 参数化用的 suite 列表（R3 之前叫 renderer）。Node 侧的用例 import 不了 registry（eager glob + React），
 * 所以写成常量，由下面「suites」里的用例与探针页里真实 registry 的列表核对。
 */
const RENDERERS = ['grid', 'tui', 'bravais'] as const;
type Renderer = typeof RENDERERS[number];

const mountProbe = async (mount: (id: string) => Promise<unknown>, page: Page, renderer: Renderer = 'grid') => {
    await mount('libraryBehavior');
    await expect.poll(() => page.evaluate(() => window.__libraryProbe?.ready() ?? false)).toBe(true);
    if (renderer !== 'grid') {
        await page.evaluate(id => window.__libraryProbe!.setSuite(id), renderer);
    }
};
const setRenderer = (page: Page, renderer: Renderer) => page.evaluate(id => window.__libraryProbe!.setSuite(id), renderer);
const waitForRenderer = (page: Page, renderer: Renderer) => (
    expect(page.locator(`[data-library-renderer="${renderer}"]`)).toHaveCount(1)
);

const open = (page: Page, id: ProbeFixtureId) => page.evaluate(fixtureId => window.__libraryProbe!.open(fixtureId), id);
const back = (page: Page) => page.evaluate(() => window.__libraryProbe!.back());
const stack = (page: Page) => page.evaluate(() => window.__libraryProbe!.stack());
const topDescriptor = async (page: Page) => (await page.evaluate(() => window.__libraryProbe!.stackDescriptors())).at(-1);
const surface = (page: Page) => page.evaluate(() => window.__libraryProbe!.surface());
const scopeCount = async (page: Page) => (await surface(page))?.filteredTrackCount ?? -1;
const runSurface = (page: Page, action: GridSurfaceActionId) => (
    page.evaluate(id => window.__libraryProbe!.runSurface(id), action)
);
const setQuery = (page: Page, query: string) => page.evaluate(value => window.__libraryProbe!.setQuery(value), query);
const getQuery = (page: Page) => page.evaluate(() => window.__libraryProbe!.getQuery());
const clearLog = (page: Page) => page.evaluate(() => window.__libraryProbe!.clearLog());
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__libraryProbe!.calls().filter(call => call.kind === callKind), kind)
);
const lastCall = async (page: Page, kind: ProbeCallKind) => (await calls(page, kind)).at(-1);
const requests = (page: Page, op: string, target?: string) => page.evaluate(([requestOp, requestTarget]) => (
    window.__libraryProbe!.requests().filter(request => (
        request.op === requestOp && (requestTarget === undefined || request.target === requestTarget)
    ))
), [op, target] as const);
const distinctOffsets = async (page: Page, target: string) => (
    [...new Set((await requests(page, 'playlistTracks', target)).map(request => `${request.offset}+${request.limit}`))]
);

/** 等某个集合加载完成：surface 里的可播放数量到达期望值。 */
const waitForScope = (page: Page, count: number, timeout = 15_000) => (
    expect.poll(() => scopeCount(page), { timeout }).toBe(count)
);

/** 读当前 play-filtered 会交给播放器的歌（通过真实 surface 动作）。 */
const playFilteredIds = async (page: Page) => {
    expect(await runSurface(page, 'play-filtered')).toBe(true);
    return (await lastCall(page, 'playAll'))?.ids ?? [];
};

/**
 * 返回并等上一层真正卸载。AnimatePresence 退场期间如果同一个 key 再次进场，会直接复用那个正在
 * 退场的实例（不重新挂载、不重新加载），所以「退出再进」的场景必须等它走完。
 */
const backAndSettle = async (page: Page) => {
    await back(page);
    await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
};

/**
 * 等筛选真正提交到网格上。surface 读到的可能是还没提交的那次（可打断的）渲染：这时按键会落在旧网格上，
 * 随后「筛选变化回到第一张」又把焦点拉回去。以一张不在筛选结果里的卡消失为准。
 */
const waitForFilteredGrid = async (page: Page, hiddenKey: string) => {
    await expect(page.locator(entrySelector(hiddenKey))).toHaveCount(0);
    await page.waitForTimeout(300);
};

/** 键盘事件要落在 body 上：网格的键盘处理会忽略按钮、输入框里的按键。 */
const pressOnGrid = async (page: Page, key: string) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(key);
};

/**
 * 播放键盘焦点所在的那一首。网格与 TUI 按一次 Enter；bravais 的歌曲磁贴第一次 Enter 展开成聚焦卡、第二次才播放
 * （已经展开着就只按一次）。
 */
const playFocused = async (page: Page, renderer: Renderer) => {
    if (renderer !== 'bravais') {
        await pressOnGrid(page, 'Enter');
        return;
    }
    const focused = page.locator('.bravais-tile[data-bravais-focused]');
    await expect(focused).toHaveCount(1);
    if (!(await focused.getAttribute('data-bravais-expanded'))) {
        await pressOnGrid(page, 'Enter');
        await expect(page.locator('.bravais-tile[data-bravais-focused][data-bravais-expanded]')).toHaveCount(1);
    }
    await pressOnGrid(page, 'Enter');
};

/** bravais：打开缝里当前这一层的列表面板（已经开着就不动；换层时上一层的面板可能还在翻走，不算）。 */
const openBravaisList = async (page: Page) => {
    const layerKey = await page.locator('[data-library-stage="bravais"]').getAttribute('data-bravais-layer');
    const panel = page.locator(`[data-bravais-list="${layerKey}"]`);
    if (await panel.count() === 0) await page.locator('[data-bravais-seam-action="list"]').click();
    await expect(panel).toBeVisible();
};

/** bravais：等墙上的翻牌放完（移除的两段、过滤、数据到达）——翻牌期间聚焦卡会被收起。 */
const waitForBravaisWall = (page: Page) => (
    expect(page.locator('[data-library-stage="bravais"][data-bravais-settling]')).toHaveCount(0)
);

/** bravais：经列表面板定位一个条目（相机飞到离缝最近的一份并展开聚焦卡），返回那张聚焦卡所在的磁贴。 */
const focusBravaisEntry = async (page: Page, itemKey: string, occurrence = 0) => {
    await openBravaisList(page);
    await waitForBravaisWall(page);
    const entryKey = `${itemKey}-${occurrence}`;
    await page.locator(`[data-bravais-list-row="${entryKey}"]`).click();
    const card = page.locator(`.bravais-tile[data-bravais-expanded][data-library-entry="${entryKey}"]`);
    await expect(card).toBeVisible();
    return card;
};

/** 条目在界面上：网格与 TUI 恰好一份；bravais 的无限拼贴上可能有好几份副本，至少一份。 */
const expectEntryShown = async (page: Page, renderer: Renderer, itemKey: string, occurrence = 0) => {
    if (renderer === 'bravais') await expect(page.locator(entrySelector(itemKey, occurrence)).first()).toBeAttached();
    else await expect(page.locator(entrySelector(itemKey, occurrence))).toHaveCount(1);
};

for (const renderer of RENDERERS) {
test.describe(`[${renderer}] online paging and cache`, () => {
    test('opens with a 150-track first page and fills the rest in the background', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);

        expect(await distinctOffsets(page, 'probe-a:playlist:big')).toEqual(['0+150', '150+1000']);
        expect(await playFilteredIds(page)).toEqual(bigKeys());
        expect(await stack(page)).toEqual(['Big Playlist']);
    });

    test('keeps first-page duplicates and de-duplicates later pages by playback key', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-dupes');
        const expected = keysOf(
            PROBE_PROVIDER_A,
            'dupes',
            expectedPlayableIndexes(expectedLoadedIndexes(fixture['online-dupes'].rawIndexes)),
        );
        await waitForScope(page, expected.length);
        expect(await playFilteredIds(page)).toEqual(expected);
    });

    test('re-entering a cached playlist makes no track requests', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await backAndSettle(page);
        await clearLog(page);

        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await page.waitForTimeout(500);
        expect(await requests(page, 'playlistTracks')).toEqual([]);
    });

    test('reload bypasses the cache and starts again from the first page', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await expect.poll(async () => (await surface(page))?.availableActions.includes('reload-online-collection')).toBe(true);
        await clearLog(page);

        expect(await runSurface(page, 'reload-online-collection')).toBe(true);
        await expect.poll(() => distinctOffsets(page, 'probe-a:playlist:big')).toEqual(['0+150', '150+1000']);
        await waitForScope(page, bigKeys().length);
    });

    test('a page that fails once is retried and the playlist completes', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-flaky');
        const expected = expectedPlayableIndexes(fixture['online-flaky'].rawIndexes);
        await waitForScope(page, expected.length);

        const atOffset = (await requests(page, 'playlistTracks', 'probe-a:playlist:flaky')).filter(request => request.offset === 150);
        expect(atOffset.map(request => request.outcome)).toEqual(['error', 'ok']);
    });

    test('an interrupted background sync shows a retry that resumes from the failed offset', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-broken');
        const firstPage = expectedPlayableIndexes(fixture['online-broken'].rawIndexes.slice(0, 150));
        await waitForScope(page, firstPage.length);

        // 1 次首发 + 3 次退避（0.5s / 1.5s / 4s）后才算中断。
        const retry = page.getByRole('button', { name: /Interrupted at 150 \/ 400.*Retry/ });
        await expect(retry).toBeVisible({ timeout: 15_000 });
        await clearLog(page);

        await retry.click();
        await waitForScope(page, expectedPlayableIndexes(fixture['online-broken'].rawIndexes).length);
        const resumed = await requests(page, 'playlistTracks', 'probe-a:playlist:broken');
        expect(resumed[0]?.offset).toBe(150);
        await expect(retry).toBeHidden();
    });

    test('a private playlist says so instead of showing an empty grid; an empty one shows no error', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-private');
        await expect(page.getByText('This playlist is not public, so the current music source cannot read its contents')).toBeVisible();
        expect(await scopeCount(page)).toBe(0);

        await back(page);
        await open(page, 'online-empty');
        await expect.poll(() => requests(page, 'playlistTracks', 'probe-a:playlist:empty')).not.toEqual([]);
        await expect(page.getByText('No content')).toBeVisible();
        await expect(page.getByText(/not public|Failed to load/)).toHaveCount(0);
    });

    test('a slow first page from a closed playlist never lands in the next one', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-slow');
        await page.waitForTimeout(100);
        await back(page);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await page.waitForTimeout(1_500);

        expect(await stack(page)).toEqual(['Big Playlist']);
        const ids = await playFilteredIds(page);
        expect(ids.some(id => id.includes(':slow-'))).toBe(false);
        expect(ids).toEqual(bigKeys());
    });

    // P1.3 之前：首页在网格卸载之后才返回时，补页循环自己换了一代，卸载时的取消拦不住它，
    // 关掉的歌单会在后台继续分页并写缓存。现在请求归属在资源上，释放即停。
    test('closing a playlist before its first page lands stops all further paging', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-slow');
        await page.waitForTimeout(300);
        await back(page);
        await page.waitForTimeout(4_000);
        const later = (await requests(page, 'playlistTracks', 'probe-a:playlist:slow')).filter(request => (request.offset ?? 0) > 0);
        expect(later).toEqual([]);
    });
});

test.describe(`[${renderer}] filter, play and enqueue`, () => {
    test('the filter scope drives play-filtered and enqueue-filtered, and skips unavailable songs', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);

        for (const query of ['cedar', 'amber', 'guest', 'second', 'kite', '译名', 'track 1', 'probe artist']) {
            expect(await setQuery(page, query)).toBe(true);
            await waitForScope(page, bigKeys(query).length);
            expect((await surface(page))?.isFilterActive).toBe(true);
            expect(await playFilteredIds(page)).toEqual(bigKeys(query));
        }

        await setQuery(page, 'cedar');
        await waitForScope(page, bigKeys('cedar').length);
        expect(await runSurface(page, 'enqueue-filtered')).toBe(true);
        expect((await lastCall(page, 'addAllToQueue'))?.ids).toEqual(bigKeys('cedar'));

        await setQuery(page, '');
        await waitForScope(page, bigKeys().length);
        expect((await surface(page))?.isFilterActive).toBe(false);
    });

    test('Enter plays the focused card with the filtered songs as the queue', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await setQuery(page, 'cedar');
        await waitForScope(page, bigKeys('cedar').length);
        await waitForFilteredGrid(page, onlinePlaybackKey(PROBE_PROVIDER_A, 'big-0'));

        // bravais 过滤时是有限拼贴：Home 落在 rank 0（第一个匹配项）。
        if (renderer === 'bravais') await pressOnGrid(page, 'Home');
        await playFocused(page, renderer);
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const played = await lastCall(page, 'playSong');
        expect(played?.ids).toEqual([bigKeys('cedar')[0]]);
        expect(played?.queueIds).toEqual(bigKeys('cedar'));
    });

    test('a side-panel row plays with the unfiltered playable list as the queue', async ({ mount, page }) => {
        test.skip(renderer !== 'grid', 'only the grid has a track side panel');
        await mountProbe(mount, page, renderer);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await setQuery(page, 'cedar');
        await waitForScope(page, bigKeys('cedar').length);

        expect(await runSurface(page, 'toggle-track-list')).toBe(true);
        const panel = page.locator('[data-testid="side-panel-list"]');
        await panel.getByText('Track 7 Cedar', { exact: true }).click();
        const played = await lastCall(page, 'playSong');
        expect(played?.ids).toEqual([onlinePlaybackKey(PROBE_PROVIDER_A, 'big-7')]);
        // 现状：侧栏忽略筛选，队列是整张歌单的可播放曲目。
        expect(played?.queueIds).toEqual(bigKeys());
    });

    test('queueing the focused song routes online, local and Navidrome songs to their own enqueue path', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        // 网格点卡片上的入队按钮；TUI 对焦点行按 Shift+Enter；bravais 经列表面板聚焦它、点聚焦卡上的「加入队列」。
        // 都落到同一个播放端口。
        const enqueueFocused = async (entryKey: string) => {
            if (renderer === 'grid') {
                await page.locator(cardSelector(entryKey)).getByTitle('Add to Queue').click();
            } else if (renderer === 'bravais') {
                const card = await focusBravaisEntry(page, entryKey);
                await card.locator('[data-bravais-action="enqueue"]').click();
            } else {
                await expect(page.locator(entrySelector(entryKey))).toHaveAttribute('aria-selected', 'true');
                await pressOnGrid(page, 'Shift+Enter');
            }
        };

        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        const onlineKey = onlinePlaybackKey(PROBE_PROVIDER_A, 'big-0');
        await enqueueFocused(onlineKey);
        await expect.poll(async () => (await lastCall(page, 'addSongToQueue'))?.ids).toEqual([onlineKey]);

        await backAndSettle(page);
        await open(page, 'local-all');
        await waitForScope(page, 8);
        await enqueueFocused(localKey(1));
        await expect.poll(async () => (await lastCall(page, 'addLocalSongToQueue'))?.ids).toEqual([localSongId(1)]);

        await backAndSettle(page);
        await open(page, 'navi-album');
        await waitForScope(page, 6);
        await enqueueFocused('navidrome:navi-song-1');
        await expect.poll(async () => (await lastCall(page, 'addNavidromeSongsToQueue'))?.ids).toEqual(['navi-song-1']);
    });

    test('local All Songs sorting changes the play order and persists the choice', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'local-all');
        await waitForScope(page, 8);
        const order = (indexes: readonly number[]) => indexes.map(localKey);

        expect(await playFilteredIds(page)).toEqual(order(LOCAL_SORT_ORDERS.fileNameAsc));
        await runSurface(page, 'sort-modified-date');
        await expect.poll(() => playFilteredIds(page)).toEqual(order(LOCAL_SORT_ORDERS.modifiedAsc));
        await runSurface(page, 'sort-toggle-direction');
        await expect.poll(() => playFilteredIds(page)).toEqual(order(LOCAL_SORT_ORDERS.modifiedDesc));
        await runSurface(page, 'sort-album-track');
        await expect.poll(() => playFilteredIds(page)).toEqual(order(LOCAL_SORT_ORDERS.albumTrackDesc));
        await runSurface(page, 'sort-toggle-direction');
        await expect.poll(() => playFilteredIds(page)).toEqual(order(LOCAL_SORT_ORDERS.albumTrackAsc));

        expect(await page.evaluate(() => [
            localStorage.getItem('local_track_sort_field'),
            localStorage.getItem('local_track_sort_direction'),
        ])).toEqual(['albumTrack', 'asc']);
    });

    test('local folder, album entity and Navidrome playlist load their own track sets', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'local-folder');
        await waitForScope(page, 5);
        expect([...await playFilteredIds(page)].sort()).toEqual([1, 2, 3, 4, 5].map(localKey).sort());

        await back(page);
        await open(page, 'local-album');
        await waitForScope(page, 4);
        expect([...await playFilteredIds(page)].sort()).toEqual([1, 2, 3, 4].map(localKey).sort());

        await back(page);
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);
        expect(await requests(page, 'getPlaylist')).not.toEqual([]);
    });

    // P0.1 之前：集合身份不含 provider，两个 provider 下同 id 的歌单共用一个视图实例，
    // 后打开的那个显示的是前一个的曲目。
    test('two providers with the same playlist id never share tracks', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'collide-a');
        await waitForScope(page, 5);
        expect(await playFilteredIds(page)).toEqual(keysOf(PROBE_PROVIDER_A, 'ca', fixture['collide-a'].rawIndexes));

        await open(page, 'collide-b');
        await expect.poll(() => stack(page)).toEqual(['Same Id (B)']);
        await expect.poll(() => requests(page, 'playlistTracks', 'probe-b:playlist:same')).not.toEqual([]);
        await waitForScope(page, 5);
        expect(await playFilteredIds(page)).toEqual(keysOf(PROBE_PROVIDER_B, 'cb', fixture['collide-b'].rawIndexes));
    });
});
}

/**
 * 删一个条目：网格进编辑模式点卡片上的删除按钮，TUI 点一下那一行（移动焦点）再按 Delete，bravais 经列表面板聚焦它、
 * 点聚焦卡右上角「⋯」里的「移出歌单」（每日推荐是「不喜欢」）。
 * 都落到同一个变更控制器，所以下面的请求账、结果条数与 play-filtered 断言对三边相同。
 */
const removeEntry = async (page: Page, renderer: Renderer, itemKey: string, occurrence = 0) => {
    if (renderer === 'bravais') {
        const card = await focusBravaisEntry(page, itemKey, occurrence);
        await card.locator('[data-bravais-action="more"]').click();
        await card.locator('[data-bravais-action="remove-entry"]').click();
        return;
    }
    if (renderer === 'grid') {
        if (!(await surface(page))?.isEditMode) {
            await expect.poll(async () => (await surface(page))?.availableActions.includes('toggle-edit-mode')).toBe(true);
            expect(await runSurface(page, 'toggle-edit-mode')).toBe(true);
            await expect.poll(async () => (await surface(page))?.isEditMode).toBe(true);
        }
        await page.locator(cardSelector(itemKey, occurrence)).locator('button.bg-red-500').click();
        return;
    }
    const row = page.locator(`[data-library-entry="${itemKey}-${occurrence}"]`);
    // 点行首（焦点标记那一列）：P4.4 起行中间的歌手 / 专辑名是链接，点中会打开嵌套页。
    await row.click({ position: { x: 6, y: 10 } });
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await pressOnGrid(page, 'Delete');
};

/** 同一个条目再提交一次（网格再点一次删除按钮，TUI 再按一次 Delete，bravais 再走一遍「⋯ → 移出」），不等结果。 */
const removeAgain = async (page: Page, renderer: Renderer, itemKey: string, occurrence = 0) => {
    if (renderer === 'bravais') {
        await removeEntry(page, renderer, itemKey, occurrence);
    } else if (renderer === 'grid') {
        await page.locator(cardSelector(itemKey, occurrence)).locator('button.bg-red-500').click();
    } else {
        await pressOnGrid(page, 'Delete');
    }
};

/** 订阅星标：网格在信息面板的封面上，TUI 在状态栏上，bravais 在缝里标题下面；title 是同一句。 */
const showSubscribeButton = async (page: Page, renderer: Renderer) => {
    if (renderer === 'grid' && !(await surface(page))?.isInfoPanelOpen) {
        expect(await runSurface(page, 'toggle-info-panel')).toBe(true);
    }
};
/** 当前 suite 里的那个星标（换 suite 时旧的那一层可能还在退场）。bravais 的画面在 stage 里，不在 surface 的锚点里。 */
const subscribeButton = (page: Page, renderer: Renderer, title: 'Subscribe Playlist' | 'Unsubscribe Playlist') => (
    page.locator(renderer === 'bravais' ? '[data-library-stage="bravais"]' : `[data-library-renderer="${renderer}"]`).getByTitle(title)
);

for (const renderer of RENDERERS) {
test.describe(`[${renderer}] edits`, () => {
    test('removing a song from an owned online playlist updates upstream, the view and the cache', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-owned');
        await waitForScope(page, 12);
        await clearLog(page);
        await removeEntry(page, renderer, onlinePlaybackKey(PROBE_PROVIDER_A, 'owned-0'));

        await expect.poll(() => requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);
        expect((await requests(page, 'updatePlaylistTracks:del'))[0]?.ids).toEqual(['owned-0']);
        await waitForScope(page, 11);
        await expect.poll(() => calls(page, 'refreshUser')).not.toEqual([]);
        // 现状：账户刷新带回新的 trackCount，集合据此从第一页重拉，并把缓存写回有效的快照。
        await expect.poll(() => distinctOffsets(page, 'probe-a:playlist:owned')).toEqual(['0+150']);

        await backAndSettle(page);
        await clearLog(page);
        await open(page, 'online-owned');
        await waitForScope(page, 11);
        await page.waitForTimeout(500);
        expect(await requests(page, 'playlistTracks')).toEqual([]);
        expect(await playFilteredIds(page)).not.toContain(onlinePlaybackKey(PROBE_PROVIDER_A, 'owned-0'));
    });

    test('removing a song from a local playlist persists it and refreshes the library', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'local-playlist');
        await waitForScope(page, 6);
        await removeEntry(page, renderer, localKey(1));

        await waitForScope(page, 5);
        await expect.poll(() => calls(page, 'refreshLocalSongs')).not.toEqual([]);
        expect(await playFilteredIds(page)).not.toContain(localKey(1));
    });

    test('removing a song from a Navidrome playlist sends its index', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);
        await removeEntry(page, renderer, 'navidrome:navi-song-11');

        await expect.poll(() => requests(page, 'updatePlaylist')).toHaveLength(1);
        expect((await requests(page, 'updatePlaylist'))[0]?.ids).toEqual(['0']);
        await waitForScope(page, 4);
    });

    // P2.2 之前网格按显示下标删，并用 `${playbackKey}-${显示下标}` 藏卡片：删过一首之后显示下标与资源里的
    // 原始下标错开，第二次删的卡藏不掉，第三次就把上游的另一首删了。
    test('removing Navidrome entries one after another sends the current raw index each time', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);

        const removeAndSettle = async (songId: string, remaining: number) => {
            await removeEntry(page, renderer, `navidrome:${songId}`);
            await waitForScope(page, remaining);
            await expect(page.locator(entrySelector(`navidrome:${songId}`))).toHaveCount(0);
        };
        await removeAndSettle('navi-song-11', 4);
        await removeAndSettle('navi-song-13', 3);
        await removeAndSettle('navi-song-14', 2);
        expect((await requests(page, 'updatePlaylist')).map(request => request.ids)).toEqual([['0'], ['1'], ['1']]);

        // 重新打开从服务器取：上游剩下的正是界面上剩下的。
        await backAndSettle(page);
        await open(page, 'navi-playlist');
        await waitForScope(page, 2);
        expect(await playFilteredIds(page)).toEqual(['navidrome:navi-song-12', 'navidrome:navi-song-15']);
    });

    // 重复条目：在线歌单上游按歌删，同一首的两个条目都没了；Navidrome 按原始下标删，只删选中的那一个。
    test('removing one of two online duplicates removes every copy, upstream and on screen', async ({ mount, page }) => {
        const rule = fixture['online-owned-twice'];
        const songKey = onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(rule.prefix, 1));
        await mountProbe(mount, page, renderer);
        await open(page, 'online-owned-twice');
        await waitForScope(page, 12);
        await expectEntryShown(page, renderer, songKey, 1);
        await clearLog(page);

        await removeEntry(page, renderer, songKey, 1);
        await expect.poll(() => requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);
        expect((await requests(page, 'updatePlaylistTracks:del'))[0]?.ids).toEqual([onlineSongId(rule.prefix, 1)]);
        await waitForScope(page, 10);
        await expect(page.locator(`${entrySelector(songKey, 0)}, ${entrySelector(songKey, 1)}`)).toHaveCount(0);
        expect(await playFilteredIds(page)).toEqual(keysOf(PROBE_PROVIDER_A, rule.prefix, rule.rawIndexes.filter(index => index !== 1)));
    });

    test('removing the second of two Navidrome duplicates sends only its raw index and keeps the first', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'navi-playlist-dupes');
        await waitForScope(page, 4);
        await removeEntry(page, renderer, 'navidrome:navi-song-21', 1);

        await expect.poll(() => requests(page, 'updatePlaylist', 'navi-pl-2')).toHaveLength(1);
        expect((await requests(page, 'updatePlaylist', 'navi-pl-2'))[0]?.ids).toEqual(['2']);
        await waitForScope(page, 3);
        await expectEntryShown(page, renderer, 'navidrome:navi-song-21', 0);
        await expect(page.locator(entrySelector('navidrome:navi-song-21', 1))).toHaveCount(0);
        expect(await playFilteredIds(page)).toEqual(['navidrome:navi-song-21', 'navidrome:navi-song-22', 'navidrome:navi-song-23']);
    });

    test('a background page arriving right after the removal does not bring the removed song back', async ({ mount, page }) => {
        const rule = fixture['online-owned-dupes'];
        const target = 'probe-a:playlist:owned-dupes';
        const removedKey = onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(rule.prefix, 0));
        const expectedAfter = expectedPlayableIndexes(expectedLoadedIndexes(rule.rawIndexes).filter(index => index !== 0));

        await mountProbe(mount, page, renderer);
        // 后台分页在删除之前就按当时的上游生成（里面还有第一首的重复条目），删除之后才送达；
        // 账户刷新也按住，免得在线集合因版本变化从第一页重拉，掩盖晚到的那一页。
        await page.evaluate(() => window.__libraryProbe!.holdPages('online-owned-dupes'));
        await page.evaluate(() => window.__libraryProbe!.holdRefresh('refreshUser'));
        await open(page, 'online-owned-dupes');
        await waitForScope(page, expectedPlayableIndexes(rule.rawIndexes.slice(0, PROBE_FIRST_PAGE)).length);
        await expect.poll(async () => (await requests(page, 'playlistTracks', target)).some(request => request.offset === PROBE_FIRST_PAGE)).toBe(true);

        await removeEntry(page, renderer, removedKey);
        await expect.poll(() => requests(page, 'updatePlaylistTracks:del', target)).toHaveLength(1);
        // 网格：退出动画还在播（展示被按住）时送达；TUI：删除刚提交之后送达。
        await page.evaluate(() => window.__libraryProbe!.releasePages('online-owned-dupes'));

        await waitForScope(page, expectedAfter.length);
        await expect(page.locator(entrySelector(removedKey))).toHaveCount(0);
        expect(await playFilteredIds(page)).toEqual(keysOf(PROBE_PROVIDER_A, rule.prefix, expectedAfter));

        await page.evaluate(() => window.__libraryProbe!.releaseRefresh('refreshUser'));
        await expect.poll(() => calls(page, 'refreshUser')).not.toEqual([]);
        await page.waitForTimeout(500);
        await waitForScope(page, expectedAfter.length);
        expect(await playFilteredIds(page)).toEqual(keysOf(PROBE_PROVIDER_A, rule.prefix, expectedAfter));
    });

    // 晚到：删除请求还没回来，后台分页先到了。那一页照常追加（这首此刻还在），删除回来时同一首的全部条目一起删掉。
    test('a slow removal with a background page landing meanwhile still ends without the removed song', async ({ mount, page }) => {
        const rule = fixture['online-owned-dupes'];
        const target = 'probe-a:playlist:owned-dupes';
        const removedKey = onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(rule.prefix, 0));
        const expectedAfter = expectedPlayableIndexes(expectedLoadedIndexes(rule.rawIndexes).filter(index => index !== 0));

        await mountProbe(mount, page, renderer);
        await page.evaluate(() => window.__libraryProbe!.holdPages('online-owned-dupes'));
        await page.evaluate(() => window.__libraryProbe!.holdRefresh('refreshUser'));
        await page.evaluate(() => window.__libraryProbe!.holdMutations());
        await open(page, 'online-owned-dupes');
        await waitForScope(page, expectedPlayableIndexes(rule.rawIndexes.slice(0, PROBE_FIRST_PAGE)).length);
        await expect.poll(async () => (await requests(page, 'playlistTracks', target)).some(request => request.offset === PROBE_FIRST_PAGE)).toBe(true);

        await removeEntry(page, renderer, removedKey);
        await expect.poll(() => requests(page, 'updatePlaylistTracks:del', target)).toHaveLength(1);
        await page.evaluate(() => window.__libraryProbe!.releasePages('online-owned-dupes'));
        // 删除还在路上。TUI 与 bravais 立即追加那一页（这首此刻还在上游；bravais 只在展示层按住翻牌的旧帧，
        // core 不等动画）；网格发起删除时按住了展示，这一页暂存，等删除结束和删除一起提交（最新的赢）。
        if (renderer !== 'grid') {
            await waitForScope(page, expectedPlayableIndexes(expectedLoadedIndexes(rule.rawIndexes)).length);
        } else {
            await page.waitForTimeout(500);
            expect(await scopeCount(page)).toBe(expectedPlayableIndexes(rule.rawIndexes.slice(0, PROBE_FIRST_PAGE)).length);
        }

        await page.evaluate(() => window.__libraryProbe!.releaseMutations());
        await waitForScope(page, expectedAfter.length);
        await expect(page.locator(entrySelector(removedKey))).toHaveCount(0);
        expect(await playFilteredIds(page)).toEqual(keysOf(PROBE_PROVIDER_A, rule.prefix, expectedAfter));
        await page.evaluate(() => window.__libraryProbe!.releaseRefresh('refreshUser'));
    });

    test('closing the collection before a slow removal returns raises no error, and reopening shows it removed', async ({ mount, page }) => {
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await mountProbe(mount, page, renderer);
        await page.evaluate(() => window.__libraryProbe!.holdMutations());
        await open(page, 'online-owned');
        await waitForScope(page, 12);
        await removeEntry(page, renderer, onlinePlaybackKey(PROBE_PROVIDER_A, 'owned-0'));
        await expect.poll(() => requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);

        await backAndSettle(page);
        await page.evaluate(() => window.__libraryProbe!.releaseMutations());
        await expect.poll(() => calls(page, 'refreshUser')).not.toEqual([]);
        await page.waitForTimeout(500);

        await open(page, 'online-owned');
        await waitForScope(page, 11);
        expect(await playFilteredIds(page)).not.toContain(onlinePlaybackKey(PROBE_PROVIDER_A, 'owned-0'));
        expect(await requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);
        expect(errors).toEqual([]);
    });

    test('submitting the same removal twice while it is in flight sends one request', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await page.evaluate(() => window.__libraryProbe!.holdMutations());
        await open(page, 'online-owned');
        await waitForScope(page, 12);
        const key = onlinePlaybackKey(PROBE_PROVIDER_A, 'owned-0');
        await removeEntry(page, renderer, key);
        await expect.poll(() => requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);

        await removeAgain(page, renderer, key);
        await page.waitForTimeout(300);
        expect(await requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);

        await page.evaluate(() => window.__libraryProbe!.releaseMutations());
        await waitForScope(page, 11);
        await page.waitForTimeout(300);
        expect(await requests(page, 'updatePlaylistTracks:del')).toHaveLength(1);
    });

    // 改名经变更控制器；宿主的集合描述（导航栈里那份）不再被就地改写，标题来自控制器记下的新名字。
    // 网格在信息面板的编辑模式里改，TUI 用状态栏的 [rename] 打开行内提示。
    test('renaming a Navidrome playlist goes upstream once and shows the new title', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);
        let input;
        if (renderer === 'grid') {
            expect(await runSurface(page, 'toggle-info-panel')).toBe(true);
            await expect.poll(async () => (await surface(page))?.availableActions.includes('toggle-edit-mode')).toBe(true);
            expect(await runSurface(page, 'toggle-edit-mode')).toBe(true);
            input = page.locator('.theme-glass-panel input');
        } else if (renderer === 'bravais') {
            // bravais：缝的「⋯ 更多 → 改名」，缝原地翻成表单态。
            await page.locator('[data-bravais-seam-action="more"]').click();
            await page.locator('[data-bravais-seam-menu] [data-bravais-seam-action="rename"]').click();
            input = page.locator('[data-bravais-form="rename"] input');
        } else {
            await page.locator('[data-tui-action="rename"]').click();
            input = page.locator('[data-tui-prompt="rename"] input');
        }
        await clearLog(page);

        await expect(input).toHaveValue('Navi Playlist');
        await input.fill('Renamed Navi');
        await input.press('Enter');
        await expect.poll(() => requests(page, 'updatePlaylist')).toHaveLength(1);
        if (renderer === 'grid') {
            await expect.poll(async () => (await surface(page))?.isEditMode).toBe(false);
            await expect(page.locator('h2', { hasText: 'Renamed Navi' })).toBeVisible();
        } else if (renderer === 'bravais') {
            await expect(page.locator('[data-bravais-form]')).toHaveCount(0);
            await expect(page.locator('[data-bravais-seam-title]')).toHaveText('Renamed Navi');
        } else {
            await expect(page.locator('[data-tui-prompt]')).toHaveCount(0);
            await expect(page.locator('[data-tui-title]')).toHaveText('Renamed Navi');
        }
        expect(await stack(page)).toEqual(['Navi Playlist']);
    });

    test('deleting a Navidrome playlist goes upstream once and leaves the collection', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);
        await clearLog(page);
        if (renderer === 'grid') {
            expect(await runSurface(page, 'toggle-info-panel')).toBe(true);
            // 探针视口里 DEV 的 suite 切换浮层压在信息面板底部的按钮上，直接派发点击。
            await page.getByRole('button', { name: 'Delete Playlist' }).dispatchEvent('click');
        } else if (renderer === 'bravais') {
            // bravais：「⋯ 更多 → 删除」，缝翻成确认态，确认按钮拿到焦点（Enter 确认）。
            await page.locator('[data-bravais-seam-action="more"]').click();
            await page.locator('[data-bravais-seam-menu] [data-bravais-seam-action="delete-collection"]').click();
            await expect(page.locator('[data-bravais-form="confirm-delete"] [data-bravais-form-action="confirm"]')).toBeFocused();
            await page.keyboard.press('Enter');
        } else {
            await page.locator('[data-tui-action="delete-collection"]').click();
            // TUI 先确认（行内提示，Enter 确认）。
            await expect(page.locator('[data-tui-prompt="confirm-delete"]')).toBeFocused();
            await page.keyboard.press('Enter');
        }

        await expect.poll(() => stack(page)).toEqual([]);
        expect(await requests(page, 'deletePlaylist', 'navi-pl-1')).toHaveLength(1);
    });

    test('disliking a daily recommendation replaces it in place', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-daily');
        await waitForScope(page, 10);
        expect(await requests(page, 'dailySongs')).not.toEqual([]);
        await removeEntry(page, renderer, onlinePlaybackKey(PROBE_PROVIDER_A, 'daily-0'));

        await expect.poll(() => requests(page, 'dislikeSong')).toHaveLength(1);
        await expect.poll(async () => (await playFilteredIds(page))[0]).toBe(onlinePlaybackKey(PROBE_PROVIDER_A, 'daily-r-0'));
        expect(await scopeCount(page)).toBe(10);
    });

    test('subscribing to a public playlist goes upstream and refreshes the account', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await showSubscribeButton(page, renderer);

        await page.getByTitle('Subscribe Playlist').click();
        await expect.poll(() => requests(page, 'subscribePlaylist')).toHaveLength(1);
        await expect(page.getByTitle('Unsubscribe Playlist')).toBeVisible();
        await expect.poll(() => calls(page, 'refreshUser')).not.toEqual([]);
    });

    // 命令面板的 toggle-subscribe 与星标是同一个控制器动作：一次切换只发一次上游请求，状态随之翻转。
    test('toggle-subscribe from the command surface goes upstream once and flips the state', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await expect.poll(async () => (await surface(page))?.availableActions ?? []).toContain('toggle-subscribe');

        expect(await runSurface(page, 'toggle-subscribe')).toBe(true);
        await expect.poll(() => requests(page, 'subscribePlaylist')).toHaveLength(1);
        await showSubscribeButton(page, renderer);
        await expect(page.getByTitle('Unsubscribe Playlist')).toBeVisible();
        await expect.poll(() => calls(page, 'refreshUser')).not.toEqual([]);

        // 再切一次回到未订阅：同样只发一次，前一次的请求不重发。
        await expect.poll(async () => (await surface(page))?.availableActions ?? []).toContain('toggle-subscribe');
        expect(await runSurface(page, 'toggle-subscribe')).toBe(true);
        await expect.poll(() => requests(page, 'unsubscribePlaylist')).toHaveLength(1);
        await expect(page.getByTitle('Subscribe Playlist')).toBeVisible();
        expect(await requests(page, 'subscribePlaylist')).toHaveLength(1);
    });

    // 订阅状态在控制器里（宿主持有，换 suite 不重建）：在一边切换，另一边立刻是同一个状态，不再查询。
    test('the subscription state carries across a suite switch without asking upstream again', async ({ mount, page }) => {
        const other: Renderer = renderer === 'grid' ? 'tui' : 'grid';
        await mountProbe(mount, page, renderer);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await expect.poll(async () => (await surface(page))?.availableActions ?? []).toContain('toggle-subscribe');
        expect(await runSurface(page, 'toggle-subscribe')).toBe(true);
        await expect.poll(() => requests(page, 'subscribePlaylist')).toHaveLength(1);
        const statusQueries = (await requests(page, 'subscriptionStatus')).length;

        await setRenderer(page, other);
        await waitForRenderer(page, other);
        await showSubscribeButton(page, other);
        await expect(subscribeButton(page, other, 'Unsubscribe Playlist')).toBeVisible();
        expect(await requests(page, 'subscriptionStatus')).toHaveLength(statusQueries);

        // 在另一边切回去：同一个控制器，只发一次取消订阅。
        await subscribeButton(page, other, 'Unsubscribe Playlist').click();
        await expect.poll(() => requests(page, 'unsubscribePlaylist')).toHaveLength(1);
        await setRenderer(page, renderer);
        await waitForRenderer(page, renderer);
        await showSubscribeButton(page, renderer);
        await expect(subscribeButton(page, renderer, 'Subscribe Playlist')).toBeVisible();
        expect(await requests(page, 'subscribePlaylist')).toHaveLength(1);
    });
});
}

test.describe('cross-suite edits', () => {
    // P1 的已知缺口：网格删本地歌单曲目之后，资源要等曲库刷新才变，TUI 在那之前还看得到它。
    test('a local playlist removal made in the grid shows in the TUI at once', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await page.evaluate(() => window.__libraryProbe!.holdRefresh('refreshLocalSongs'));
        await open(page, 'local-playlist');
        await waitForScope(page, 6);
        await removeEntry(page, 'grid', localKey(1));
        // 删除确认、提交给资源之后才去刷新曲库；刷新被按住，资源是唯一的来源。
        await expect.poll(() => calls(page, 'refreshLocalSongs')).not.toEqual([]);

        await setRenderer(page, 'tui');
        await waitForRenderer(page, 'tui');
        await waitForScope(page, 5, 2_000);
        await expect(page.locator(entrySelector(localKey(1)))).toHaveCount(0);
        expect(await playFilteredIds(page)).not.toContain(localKey(1));

        await page.evaluate(() => window.__libraryProbe!.releaseRefresh('refreshLocalSongs'));
        await page.waitForTimeout(300);
        expect(await scopeCount(page)).toBe(5);
        expect(await playFilteredIds(page)).not.toContain(localKey(1));
    });
});

test.describe('[tui] edits', () => {
    const focusedEntry = (page: Page) => page.locator('[data-library-entry][aria-selected="true"]');

    test('Delete moves the focus to the next row, or to the previous one when the last row went', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'local-playlist');
        await waitForScope(page, 6);

        await removeEntry(page, 'tui', localKey(2));
        await waitForScope(page, 5);
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${localKey(3)}-0`);

        await pressOnGrid(page, 'End');
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${localKey(6)}-0`);
        await pressOnGrid(page, 'Delete');
        await waitForScope(page, 4);
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${localKey(5)}-0`);
    });

    test('the footer offers Delete only where the collection can remove entries', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'local-playlist');
        await waitForScope(page, 6);
        await expect(page.locator('footer')).toContainText('Del remove');

        await backAndSettle(page);
        await open(page, 'local-all');
        await waitForScope(page, 8);
        await expect(page.locator('footer')).not.toContainText('Del');
        // 不支持删除的集合按 Delete 什么都不做。
        await clearLog(page);
        await pressOnGrid(page, 'Delete');
        await page.waitForTimeout(300);
        expect(await scopeCount(page)).toBe(8);
        expect(await calls(page, 'refreshLocalSongs')).toEqual([]);
    });

    test('a daily recommendation date switches the list from the status bar', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'online-daily');
        await waitForScope(page, 10);
        const dates = page.locator('[data-tui-daily-date]');
        await expect(dates.getByRole('button', { name: '[2026-09-30]' })).toBeVisible();

        await dates.getByRole('button', { name: '[2026-09-30]' }).click();
        await expect.poll(() => requests(page, 'historySongs')).toHaveLength(1);
        await waitForScope(page, 3);
        await expect(dates.getByRole('button', { name: '[2026-09-30]' })).toHaveAttribute('aria-pressed', 'true');
    });

    // 宿主挂载的对话框（手动匹配、实体编辑）必须盖在 TUI（fixed z-[110]）之上，并接管键盘。
    test('host dialogs opened from the TUI sit above it', async ({ mount, page }) => {
        const isOnTop = (selector: string) => page.evaluate((dialogSelector) => {
            const dialog = document.querySelector(dialogSelector);
            if (!dialog) return false;
            const rect = dialog.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(hit && dialog.contains(hit));
        }, selector);

        await mountProbe(mount, page, 'tui');
        await open(page, 'local-all');
        await waitForScope(page, 8);
        await page.locator(`[data-library-entry="${localKey(1)}-0"] [data-tui-match]`).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await isOnTop('[role="dialog"]')).toBe(true);
        // 对话框开着时 TUI 不接键盘（hasBlockingWindow）：方向键不移动焦点。
        const focusedBefore = await page.locator('[data-library-entry][aria-selected="true"]').getAttribute('data-library-entry');
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('[data-library-entry][aria-selected="true"]')).toHaveAttribute('data-library-entry', focusedBefore!);
        await page.getByRole('dialog').locator('button:has(svg.lucide-x)').first().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        await backAndSettle(page);
        await open(page, 'local-album');
        await waitForScope(page, 4);
        await expect.poll(async () => (await surface(page))?.availableActions ?? []).toContain('edit-entity');
        expect(await runSurface(page, 'edit-entity')).toBe(true);
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await isOnTop('[role="dialog"]')).toBe(true);
    });
});

test.describe('navigation', () => {
    test('[grid] a nested album opens once, and going back restores the filter and the focused card', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await setQuery(page, 'cedar');
        await waitForScope(page, bigKeys('cedar').length);
        await waitForFilteredGrid(page, onlinePlaybackKey(PROBE_PROVIDER_A, 'big-0'));

        // 先把焦点挪离第一张，恢复才有区分度。
        await pressOnGrid(page, 'ArrowRight');
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedKey = (await lastCall(page, 'playSong'))!.ids[0];
        expect(focusedKey).not.toBe(bigKeys('cedar')[0]);

        await page.locator(cardSelector(focusedKey)).getByText(PROBE_ALBUM.name, { exact: true }).click();
        await expect.poll(() => stack(page)).toEqual(['Big Playlist', PROBE_ALBUM.name]);
        await waitForScope(page, PROBE_ALBUM.rawIndexes.length);

        // 专辑里的曲目卡片指回同一张专辑：再点不压栈。
        const albumCard = cardSelector(onlinePlaybackKey(PROBE_PROVIDER_A, `${PROBE_ALBUM.prefix}-0`));
        await page.locator(albumCard).getByText(PROBE_ALBUM.name, { exact: true }).click();
        await page.waitForTimeout(300);
        expect(await stack(page)).toEqual(['Big Playlist', PROBE_ALBUM.name]);

        await back(page);
        await expect.poll(() => stack(page)).toEqual(['Big Playlist']);
        await waitForScope(page, bigKeys('cedar').length);
        expect(await getQuery(page)).toBe('cedar');
        await page.waitForTimeout(400);
        await clearLog(page);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        expect((await lastCall(page, 'playSong'))?.ids).toEqual([focusedKey]);
    });

    // N1（折叠紧邻往返）：要进入的正好是上一层时当作一次返回（X → Y → X 变回 X）；更早的层照常压栈，
    // 栈里可以有重复，返回沿完整路径退回。走的是真实的链接点击（宿主的 onOpenAlbum / onOpenArtist → 压栈判断）。
    test('[grid] the layer right below the top folds into a back; a deeper layer still pushes', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        /** 当前那一层（转场期间退场的层还在 DOM 里）里某张卡片上的歌手 / 专辑名（多位歌手时名字后面带逗号）。 */
        const link = (surface: 'collection' | 'artist', cardId: string, name: string) => page
            .locator(`[data-library-surface="${surface}"]`).last()
            .locator(`[data-folia-grid-item-id="${cardId}"]`)
            .getByText(new RegExp(`^${name},?$`)).first();
        const songKey = (prefix: string, index: number) => `${onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(prefix, index))}-0`;
        const settle = () => page.waitForTimeout(600);

        // A 歌单 → B 专辑（第 1 首的专辑）→ C 客座歌手（专辑第 7 首带客座）→ D 主歌手（客座热门第 1 首）。
        await link('collection', songKey('public', 1), PROBE_ALBUM.name).dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
        await waitForScope(page, PROBE_ALBUM.rawIndexes.length);
        await settle();
        await link('collection', songKey(PROBE_ALBUM.prefix, 7), 'Guest Singer').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Guest Singer']);
        await expect(link('artist', onlineSongId('gtop', 1), 'Probe Artist')).toBeVisible();
        await settle();
        await link('artist', onlineSongId('gtop', 1), 'Probe Artist').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Guest Singer', 'Probe Artist']);
        await expect(link('artist', onlineSongId('artop', 21), 'Guest Singer')).toBeVisible();
        await settle();

        // D 上点 C（上一层）：折成一次返回，不压栈。
        await link('artist', onlineSongId('artop', 21), 'Guest Singer').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Guest Singer']);
        await expect(link('artist', onlineSongId('gtop', 1), 'Probe Artist')).toBeVisible();
        await settle();
        await link('artist', onlineSongId('gtop', 1), 'Probe Artist').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Guest Singer', 'Probe Artist']);
        await expect(link('artist', onlineSongId('artop', 21), PROBE_ALBUM.name)).toBeVisible();
        await settle();

        // D 上点 B（更早的一层）：照常压栈，B 在栈里出现两次；返回回到 D。
        await link('artist', onlineSongId('artop', 21), PROBE_ALBUM.name).dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Guest Singer', 'Probe Artist', PROBE_ALBUM.name]);
        await waitForScope(page, PROBE_ALBUM.rawIndexes.length);
        await settle();
        await back(page);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Guest Singer', 'Probe Artist']);
        await expect(page.locator('[data-library-surface="artist"]')).toHaveCount(1);
    });
});

// P4.4：集合里曲目上的专辑 / 歌手链接（网格：卡片上的名字；TUI：行上的按钮）。core 的规则同一份（core/shared/trackLinks），
// 打开时压入的描述由宿主解析；压栈之前两套都把焦点写回会话，返回之后焦点回到那一项。
for (const renderer of RENDERERS) {
test.describe(`[${renderer}] nested opens from collection entries`, () => {
    /**
     * 一个条目上的歌手 / 专辑链接：网格是卡片上的名字（多位歌手时名字后面带逗号），TUI 是那一行上的按钮，
     * bravais 是聚焦卡上的文字链接。
     */
    const entryLink = (page: Page, entryKey: string, name: string) => (
        renderer === 'grid'
            ? page.locator(cardSelector(entryKey)).getByText(new RegExp(`^${name},?$`)).first()
            : renderer === 'bravais'
                ? page.locator(`[data-bravais-focus-card="${entryKey}-0"]`).getByRole('button', { name, exact: true })
                : page.locator(`[data-library-entry="${entryKey}-0"]`).getByRole('button', { name, exact: true })
    );
    /** 把焦点挪离第一项再播放它：返回这一项的条目键（同时把焦点写进了会话）。 */
    const focusAwayFromFirst = async (page: Page) => {
        await pressOnGrid(page, renderer === 'tui' ? 'ArrowDown' : 'ArrowRight');
        await page.waitForTimeout(400);
        await clearLog(page);
        await playFocused(page, renderer);
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        return (await lastCall(page, 'playSong'))!.ids[0];
    };
    /** 返回上一层并确认焦点回到了那一项：Enter 播放的就是它。 */
    const backToFocus = async (page: Page, rootName: string, scope: number, focusedKey: string) => {
        await back(page);
        await expect.poll(() => stack(page)).toEqual([rootName]);
        await waitForRenderer(page, renderer);
        await waitForScope(page, scope);
        await page.waitForTimeout(400);
        await clearLog(page);
        await playFocused(page, renderer);
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        expect((await lastCall(page, 'playSong'))?.ids).toEqual([focusedKey]);
    };

    test('an online track opens its provider album and artist, and going back restores the focus', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'online-public');
        const scope = expectedPlayableIndexes(fixture['online-public'].rawIndexes).length;
        await waitForScope(page, scope);
        const focusedKey = await focusAwayFromFirst(page);
        const index = Number(focusedKey.split('-').at(-1));
        const album = hasSecondAlbum(index) ? PROBE_SECOND_ALBUM : PROBE_ALBUM;

        await entryLink(page, focusedKey, album.name).dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', album.name]);
        expect(await topDescriptor(page)).toEqual({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'album', id: album.id, name: album.name });
        await backToFocus(page, 'Public Playlist', scope, focusedKey);

        await entryLink(page, focusedKey, 'Probe Artist').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', 'Probe Artist']);
        expect(await topDescriptor(page)).toEqual({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'artist', id: 'ar-1', name: 'Probe Artist' });
        // B8 起 bravais 自己渲染歌手页（之前回退给网格）。
        await expect(page.locator(`[data-library-surface="artist"][data-library-renderer="${renderer}"]`)).toHaveCount(1);
        await backToFocus(page, 'Public Playlist', scope, focusedKey);
    });

    test('a local track opens its album and artist entities', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'local-all');
        await waitForScope(page, 8);
        const focusedKey = await focusAwayFromFirst(page);
        const index = Number(focusedKey.split('-').at(-1));
        const albumName = index <= 4 ? LOCAL_ALBUM_NAMES[0] : LOCAL_ALBUM_NAMES[1];

        await entryLink(page, focusedKey, albumName).dispatchEvent('click');
        await expect.poll(async () => (await topDescriptor(page))?.type).toBe('album');
        expect(await topDescriptor(page)).toMatchObject({ source: 'local', type: 'album', name: albumName, entityId: expect.any(String) });
        await expect.poll(() => scopeCount(page)).toBe(4);
        await backToFocus(page, 'All Songs', 8, focusedKey);

        await entryLink(page, focusedKey, LOCAL_ARTIST_NAME).dispatchEvent('click');
        await expect.poll(async () => (await topDescriptor(page))?.type).toBe('artist');
        expect(await topDescriptor(page)).toMatchObject({ source: 'local', type: 'artist', name: LOCAL_ARTIST_NAME, entityId: expect.any(String) });
        await backToFocus(page, 'All Songs', 8, focusedKey);
    });

    test('a Navidrome track opens the Navidrome album and artist', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);
        const focusedKey = await focusAwayFromFirst(page);

        await entryLink(page, focusedKey, 'Navi Mixed').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Navi Playlist', 'Navi Mixed']);
        expect(await topDescriptor(page)).toEqual({ source: 'navidrome', type: 'album', id: 'navi-al-2', name: 'Navi Mixed' });
        await backToFocus(page, 'Navi Playlist', 5, focusedKey);

        await entryLink(page, focusedKey, 'Navi Artist').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Navi Playlist', 'Navi Artist']);
        expect(await topDescriptor(page)).toEqual({ source: 'navidrome', type: 'artist', id: 'navi-ar-1', name: 'Navi Artist' });
        await backToFocus(page, 'Navi Playlist', 5, focusedKey);
    });
});
}

// TUI 的键盘入口（P4.4）：Alt+Enter 打开焦点行的专辑、Alt+Shift+Enter 打开它的歌手（与歌手页歌曲栏同一组键）。
// 只挪焦点、不播放：返回后焦点仍回到那一行，靠的是压栈前与卸载时把焦点写回会话。
test.describe('[tui-only] nested opens from the keyboard', () => {
    const focusedEntry = (page: Page) => page.locator('[data-library-entry][aria-selected="true"]');

    test('Alt+Enter opens the focused row\'s album, Alt+Shift+Enter its artist, and the focus survives both round trips', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'online-public');
        const scope = expectedPlayableIndexes(fixture['online-public'].rawIndexes).length;
        await waitForScope(page, scope);
        const focusedKey = onlinePlaybackKey(PROBE_PROVIDER_A, 'public-2');
        await pressOnGrid(page, 'ArrowDown');
        await pressOnGrid(page, 'ArrowDown');
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${focusedKey}-0`);
        await expect(page.locator('[data-library-renderer="tui"] footer')).toContainText('Alt+Enter album');

        await pressOnGrid(page, 'Alt+Enter');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
        expect(await topDescriptor(page)).toMatchObject({ source: 'online', type: 'album', id: PROBE_ALBUM.id });
        await back(page);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${focusedKey}-0`);

        await pressOnGrid(page, 'Alt+Shift+Enter');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', 'Probe Artist']);
        expect(await topDescriptor(page)).toMatchObject({ source: 'online', type: 'artist', id: 'ar-1' });
        await back(page);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${focusedKey}-0`);
        expect(await calls(page, 'playSong')).toEqual([]);
    });

    test('leaving without moving the focus leaves the session focus alone', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-public');
        const scope = expectedPlayableIndexes(fixture['online-public'].rawIndexes).length;
        await waitForScope(page, scope);
        // 网格里播放第二张：会话记下它。
        await pressOnGrid(page, 'ArrowRight');
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedKey = (await lastCall(page, 'playSong'))!.ids[0];
        const index = Number(focusedKey.split('-').at(-1));
        // 换到 TUI，筛掉那一首：TUI 的焦点落在第一行。不动焦点就离开——卸载时不写回，会话里还是网格记下的那首。
        await setRenderer(page, 'tui');
        await waitForRenderer(page, 'tui');
        await setQuery(page, PROBE_WORDS[(index + 1) % PROBE_WORDS.length].toLowerCase());
        await expect(page.locator(entrySelector(focusedKey))).toHaveCount(0);
        await expect(focusedEntry(page)).toHaveCount(1);
        await backAndSettle(page);

        await open(page, 'online-public');
        await waitForRenderer(page, 'tui');
        await setQuery(page, '');
        await waitForScope(page, scope);
        await expect(focusedEntry(page)).toHaveAttribute('data-library-entry', `${focusedKey}-0`);
    });
});

// P4.5：「完成」与「离开」由宿主统一，两套 suite 同一个手势同一个含义——返回按钮 = 完成（清掉这一层的浏览会话，
// 每套 suite 忘掉这一层的布局记录）；Escape 与浏览器后退 = 离开但保留。
const PUBLIC_SESSION_KEY = `online:${PROBE_PROVIDER_A}:playlist:public`;
const browseSession = (page: Page, sessionKey = PUBLIC_SESSION_KEY) => (
    page.evaluate(key => window.__libraryProbe!.browseSession(key), sessionKey)
);
const gridLayoutRecord = (page: Page, sessionKey = PUBLIC_SESSION_KEY) => (
    page.evaluate(key => sessionStorage.getItem(`folia_gridview_state:v2:${key}`), sessionKey)
);
/** 显式的返回按钮：网格是左上角的圆形按钮，TUI 是状态栏的 [← Back]，bravais 是缝面包屑行的 ‹。 */
const pressBackButton = async (page: Page, renderer: Renderer) => {
    if (renderer === 'bravais') {
        await page.locator('[data-library-stage="bravais"] [data-bravais-seam-action="back"]').click();
    } else if (renderer === 'grid') {
        await page.locator('[data-library-renderer="grid"] button').filter({ has: page.locator('svg.lucide-chevron-left') }).first().click();
    } else {
        await page.locator('[data-library-renderer="tui"] [data-tui-back]').click();
    }
};

for (const renderer of RENDERERS) {
test.describe(`[${renderer}] done and leave`, () => {
    /** 打开公开歌单、筛选、把焦点挪离第一项并播放它（焦点写进会话）；返回焦点那一项的条目键。 */
    const openFilteredAndFocus = async (page: Page, query: string | null) => {
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        if (query) {
            await setQuery(page, query);
            await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes, query).length);
            await page.waitForTimeout(400);
        }
        await pressOnGrid(page, renderer === 'tui' ? 'ArrowDown' : 'ArrowRight');
        await page.waitForTimeout(400);
        await clearLog(page);
        await playFocused(page, renderer);
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedKey = (await lastCall(page, 'playSong'))!.ids[0];
        await expect.poll(async () => (await browseSession(page))?.focusedEntryKey).toBe(`${focusedKey}-0`);
        return focusedKey;
    };

    test('browser back keeps the filter and the focus', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        const focusedKey = await openFilteredAndFocus(page, 'amber');
        await backAndSettle(page);
        expect(await browseSession(page)).toEqual({ query: 'amber', focusedEntryKey: `${focusedKey}-0` });

        await open(page, 'online-public');
        await expect.poll(() => getQuery(page)).toBe('amber');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes, 'amber').length);
    });

    test('Escape keeps the focus (the ladder only clears the filter first)', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        const focusedKey = await openFilteredAndFocus(page, null);
        // bravais 的 Esc 是逐级的阶梯（聚焦卡 → 键盘焦点 → 返回），每按一次只处理一级。
        for (let press = 0; press < (renderer === 'bravais' ? 4 : 1); press += 1) {
            if ((await stack(page)).length === 0) break;
            await pressOnGrid(page, 'Escape');
        }
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
        expect((await browseSession(page))?.focusedEntryKey).toBe(`${focusedKey}-0`);
    });

    test('the back button forgets the filter and the focus', async ({ mount, page }) => {
        await mountProbe(mount, page, renderer);
        await openFilteredAndFocus(page, 'amber');
        await pressBackButton(page, renderer);
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
        // TUI 卸载时会想把动过的焦点写回：会话的「代」挡住了它，清掉的会话不会被写出来。
        expect(await browseSession(page)).toBeNull();
        expect(await gridLayoutRecord(page)).toBeNull();

        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        expect(await getQuery(page)).toBe('');
    });
});
}

test.describe('done clears every suite\'s layout records', () => {
    test('[grid] the grid back button drops the grid layout record of that collection', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await pressOnGrid(page, 'ArrowRight');
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => gridLayoutRecord(page)).not.toBeNull();

        await pressBackButton(page, 'grid');
        await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
        expect(await gridLayoutRecord(page)).toBeNull();
    });

    test('[tui] the TUI back button drops the grid record too, so the grid starts fresh next time', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await pressOnGrid(page, 'ArrowRight');
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedKey = (await lastCall(page, 'playSong'))!.ids[0];
        await expect.poll(() => gridLayoutRecord(page)).not.toBeNull();

        await setRenderer(page, 'tui');
        await waitForRenderer(page, 'tui');
        await pressBackButton(page, 'tui');
        await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
        expect(await gridLayoutRecord(page)).toBeNull();
        expect(await browseSession(page)).toBeNull();

        // 回到网格再打开：没有记录可恢复，焦点不再是上次那张。
        await setRenderer(page, 'grid');
        await open(page, 'online-public');
        await waitForRenderer(page, 'grid');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await page.waitForTimeout(600);
        await clearLog(page);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        expect((await lastCall(page, 'playSong'))?.ids).not.toEqual([focusedKey]);
    });
});

// 浏览器后退（探针的 back() 就是 popstate 那条路：先通知「将要弹栈」，再改 store）与应用内返回一样跑网格的 beforeBack：
// 嵌套返回时 hero 收回、卡片散开（退场层 data-folia-collection-morph="exit-backdrop"）。P4.5 之前 popstate 绕过宿主，
// 这一层直接切走、没有转场。
test.describe('suite backdrop', () => {
    test('the host follows grid motion settings and uses a neutral TUI backdrop', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        // 读真实 motion 元素的 props，避免用测试专属 data 属性复述契约而漏掉宿主接线。
        const readBackdrop = () => page.evaluate(async () => {
            const modulePath = '/dev/probes/homeBehavior/reactFiberProbe.ts';
            const { currentRootFiber, findFibers } = await import(/* @vite-ignore */ modulePath);
            const props = findFibers(currentRootFiber(), (fiber: { memoizedProps?: Record<string, unknown> }) => (
                fiber.memoizedProps?.['data-library-backdrop'] === '' && Boolean(fiber.memoizedProps?.transition)
            ))[0]?.memoizedProps;
            return props ? { enter: props.transition, exit: props.exit } : null;
        });
        await expect.poll(readBackdrop).toEqual({
            enter: { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
            exit: { opacity: 0, transition: { duration: 0.28, ease: [0.4, 0, 0.2, 1] } },
        });
        const setReduced = (enabled: boolean) => page.evaluate(async value => {
            const modulePath = '/src/stores/useMotionSettingsStore.ts';
            const { useMotionSettingsStore } = await import(/* @vite-ignore */ modulePath);
            useMotionSettingsStore.getState().handleToggleReducedMotionSurface('collectionMorph', value);
        }, enabled);
        const neutral = { enter: { duration: 0.18, ease: [0.16, 1, 0.3, 1] }, exit: { opacity: 0 } };
        await setReduced(true);
        await expect.poll(readBackdrop).toEqual(neutral);
        await setReduced(false);
        await expect.poll(async () => (await readBackdrop())?.enter).toEqual({ duration: 0.62, ease: [0.22, 1, 0.36, 1] });
        await setRenderer(page, 'tui');
        await waitForRenderer(page, 'tui');
        await expect.poll(readBackdrop).toEqual(neutral);
        await setReduced(true);
        await expect.poll(readBackdrop).toEqual(neutral);
        await setRenderer(page, 'grid');
        await waitForRenderer(page, 'grid');
        await expect.poll(readBackdrop).toEqual(neutral);
    });
});

test.describe('browser back and the suite transitions', () => {
    const watchExitLayer = (page: Page) => page.evaluate(() => {
        const flag = window as unknown as { __exitSeen?: number };
        flag.__exitSeen = 0;
        let present = false;
        new MutationObserver(() => {
            const now = Boolean(document.querySelector('[data-folia-collection-morph="exit-backdrop"]'));
            if (now && !present) flag.__exitSeen = (flag.__exitSeen ?? 0) + 1;
            present = now;
        }).observe(document.body, { childList: true, subtree: true });
    });
    const exitLayersSeen = (page: Page) => page.evaluate(() => (window as unknown as { __exitSeen?: number }).__exitSeen ?? 0);
    const openNestedAlbum = async (page: Page) => {
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        const songKey = onlinePlaybackKey(PROBE_PROVIDER_A, 'public-1');
        await page.locator(cardSelector(songKey)).getByText(PROBE_ALBUM.name, { exact: true }).first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
        await waitForScope(page, PROBE_ALBUM.rawIndexes.length);
        // 等嵌套层的级联入场落定，退场才有 hero 可量。
        await page.waitForTimeout(1500);
    };

    test('[grid] browser back from a nested album plays the reverse transition', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openNestedAlbum(page);
        await watchExitLayer(page);
        await back(page);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        await expect.poll(() => exitLayersSeen(page)).toBe(1);
        await expect(page.locator('[data-folia-collection-morph="exit-backdrop"]')).toHaveCount(0, { timeout: 5_000 });
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
    });

    // 应用内返回先跑 beforeBack 再弹栈；随后的弹栈通知认出这次弹栈、不再跑第二遍。
    test('[grid] Escape from a nested album still plays it', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openNestedAlbum(page);
        await watchExitLayer(page);
        await pressOnGrid(page, 'Escape');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        await expect.poll(() => exitLayersSeen(page)).toBe(1);
        await expect(page.locator('[data-folia-collection-morph="exit-backdrop"]')).toHaveCount(0, { timeout: 5_000 });
        await page.waitForTimeout(300);
        expect(await exitLayersSeen(page)).toBe(1);
    });
});

test.describe('renderer switch', () => {
    test('switching keeps the filter, the scope, the focused song and the play queue, and never refetches', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await setQuery(page, 'cedar');
        await waitForScope(page, bigKeys('cedar').length);
        await waitForFilteredGrid(page, onlinePlaybackKey(PROBE_PROVIDER_A, 'big-0'));
        await pressOnGrid(page, 'ArrowRight');
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedKey = (await lastCall(page, 'playSong'))!.ids[0];
        expect(focusedKey).not.toBe(bigKeys('cedar')[0]);
        await clearLog(page);

        await setRenderer(page, 'tui');
        await waitForRenderer(page, 'tui');
        expect(await getQuery(page)).toBe('cedar');
        await waitForScope(page, bigKeys('cedar').length);
        expect(await playFilteredIds(page)).toEqual(bigKeys('cedar'));
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        expect(await lastCall(page, 'playSong')).toMatchObject({ ids: [focusedKey], queueIds: bigKeys('cedar') });

        await setRenderer(page, 'grid');
        await waitForRenderer(page, 'grid');
        await expect(page.locator('[data-library-renderer="tui"]')).toHaveCount(0);
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(2);
        expect((await lastCall(page, 'playSong'))?.ids).toEqual([focusedKey]);
        expect(await requests(page, 'playlistTracks')).toEqual([]);
    });

    test('a local sort chosen in one renderer orders the other', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'local-all');
        await waitForScope(page, 8);
        await runSurface(page, 'sort-modified-date');
        await expect.poll(() => playFilteredIds(page)).toEqual(LOCAL_SORT_ORDERS.modifiedAsc.map(localKey));

        await setRenderer(page, 'tui');
        await waitForRenderer(page, 'tui');
        await expect.poll(() => playFilteredIds(page)).toEqual(LOCAL_SORT_ORDERS.modifiedAsc.map(localKey));
        await expect(page.locator('[data-tui-row="0"]')).toHaveAttribute('data-library-entry', `${localKey(8)}-0`);
    });

    test('[tui] Escape clears the filter first, then leaves without a reverse transition', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'online-big');
        await waitForScope(page, bigKeys().length);
        await setQuery(page, 'cedar');
        await waitForScope(page, bigKeys('cedar').length);

        await pressOnGrid(page, 'Escape');
        await expect.poll(() => getQuery(page)).toBe('');
        expect(await stack(page)).toEqual(['Big Playlist']);
        await pressOnGrid(page, 'Escape');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(page.locator('[data-folia-collection-morph]')).toHaveCount(0);
    });

    test('[tui] keeps the DOM bounded on a big playlist and End reaches the last row', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'online-slow');
        const total = fixture['online-slow'].rawIndexes.length;
        await waitForScope(page, expectedPlayableIndexes(fixture['online-slow'].rawIndexes).length, 20_000);
        expect(await page.locator('[data-tui-row]').count()).toBeLessThan(80);

        await pressOnGrid(page, 'End');
        await expect(page.locator(`[data-tui-row="${total - 1}"]`)).toHaveAttribute('aria-selected', 'true');
        expect(await page.locator('[data-tui-row]').count()).toBeLessThan(80);
    });
});

test.describe('suites', () => {
    test("the parameterised suite list is the registry's, and the old renderer names still work", async ({ mount, page }) => {
        await mountProbe(mount, page);
        const suites = await page.evaluate(() => window.__libraryProbe!.suites());
        expect([...suites].sort()).toEqual([...RENDERERS].sort());
        await open(page, 'local-all');
        await waitForRenderer(page, 'grid');
        await page.evaluate(() => window.__libraryProbe!.setRenderer('tui'));
        await waitForRenderer(page, 'tui');
        expect(await page.evaluate(() => window.__libraryProbe!.renderer())).toBe('tui');
        expect(await page.evaluate(() => window.__libraryProbe!.suite())).toBe('tui');
    });

    // P4.3 起 TUI 自己渲染歌手页（回退规则本身由 test/unit/library/registry.test.ts 用一套没有歌手页的假 suite 守着）。
    test('[tui] the TUI renders the artist page itself, and going back returns to the TUI collection', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'local-all');
        await waitForRenderer(page, 'tui');
        await waitForScope(page, 8);
        expect(await page.evaluate(() => window.__libraryProbe!.resolveSurface('artist'))).toMatchObject({ suiteId: 'tui', isFallback: false });

        expect(await page.evaluate(() => window.__libraryProbe!.pushArtist())).toBe(true);
        await expect(page.locator('[data-library-surface="artist"][data-library-renderer="tui"]')).toHaveCount(1);
        await expect(page.locator('[data-library-surface="artist"][data-library-renderer="grid"]')).toHaveCount(0);
        await expect(page.locator('[data-library-surface="collection"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__libraryProbe!.suite())).toBe('tui');

        await back(page);
        await waitForRenderer(page, 'tui');
        await expect(page.locator('[data-library-surface="artist"]')).toHaveCount(0);
        await waitForScope(page, 8);
        expect(await playFilteredIds(page)).toHaveLength(8);
    });

    // 上一条用例自 R3 起偶发失败（约 1/3）：返回之后歌手页停在 0 透明度、计数仍为 1。根因与 P3.5 修掉的
    // 「打开集合后马上关掉」相同——本地歌手页的专辑在退场开始之后才到，列表按钮在退场中途挂上，宿主的
    // AnimatePresence 等不到它完成。这里把时机固定下来：压入歌手页后不等它的数据，立刻返回。
    for (const renderer of RENDERERS) {
        test(`[${renderer}] going back from an artist page right after it opened leaves no artist layer behind`, async ({ mount, page }) => {
            await mountProbe(mount, page, renderer);
            await open(page, 'local-all');
            await waitForRenderer(page, renderer);
            await waitForScope(page, 8);
            for (let round = 0; round < 3; round += 1) {
                expect(await page.evaluate(() => window.__libraryProbe!.pushArtist())).toBe(true);
                await back(page);
                await expect(page.locator('[data-library-surface="artist"]'), `round ${round}`).toHaveCount(0);
                await waitForRenderer(page, renderer);
            }
            await waitForScope(page, 8);
            expect(await playFilteredIds(page)).toHaveLength(8);
        });
    }

    for (const renderer of RENDERERS) {
        test(`[${renderer}] the command surface offers only actions the suite declares`, async ({ mount, page }) => {
            await mountProbe(mount, page, renderer);
            await open(page, 'local-folder');
            await waitForRenderer(page, renderer);
            await expect.poll(async () => (await surface(page))?.availableActions.length ?? 0).toBeGreaterThan(0);

            const { declaredActions } = await page.evaluate(() => window.__libraryProbe!.resolveSurface('collection'));
            const available = (await surface(page))!.availableActions;
            const undeclared = available.filter(action => {
                const source = GRID_SURFACE_ACTION_SOURCES[action];
                return 'action' in source
                    ? !declaredActions.actions.includes(source.action)
                    : !declaredActions.extraActions.includes(source.extra);
            });
            expect(undeclared).toEqual([]);
            expect(available).toEqual(expect.arrayContaining(['play-filtered', 'enqueue-filtered', 'sort-file-name']));
            // 本地文件夹的重扫、整理是 core 动作，两套 UI 都声明了；两个面板是网格的局部动作，TUI 没有。
            expect(available).toEqual(expect.arrayContaining(['resync-folder', 'organize-song-info']));
            const gridOnly: GridSurfaceActionId[] = ['toggle-info-panel', 'toggle-track-list'];
            if (renderer === 'grid') expect(available).toEqual(expect.arrayContaining(gridOnly));
            else expect(available.filter(action => gridOnly.includes(action))).toEqual([]);
        });
    }

    // 同一个控制器（宿主持有，换 suite 不重建）：TUI 自 P2.4 声明 subscribe，命令面板在两边都发布 toggle-subscribe；
    // 只是打开集合、换 suite 不会发出任何订阅请求。
    test('[tui] toggle-subscribe is published on the TUI surface too, and switching suites sends nothing', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await open(page, 'online-public');
        await waitForRenderer(page, 'tui');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);

        const { declaredActions } = await page.evaluate(() => window.__libraryProbe!.resolveSurface('collection'));
        expect(declaredActions.actions).toContain('subscribe');
        await expect.poll(async () => (await surface(page))?.availableActions ?? []).toContain('toggle-subscribe');
        await expect(page.locator('[data-tui-subscribe]')).toHaveAttribute('data-tui-subscribe', 'off');

        await setRenderer(page, 'grid');
        await waitForRenderer(page, 'grid');
        await expect.poll(async () => (await surface(page))?.availableActions ?? []).toContain('toggle-subscribe');
        expect(await requests(page, 'subscribePlaylist')).toEqual([]);
    });
});

// B7：bravais 集合页自己的交互（双模式、列表面板、表单态、日期步进、过滤框 ↓ 交给墙）。都经语义标记驱动：
// 磁贴的 data-bravais-slot / data-library-entry、面板的 data-bravais-list(-row)、缝的 data-bravais-seam-action / form。
test.describe('[bravais-only] collection page', () => {
    const PUBLIC = fixture['online-public'];
    const publicScope = () => expectedPlayableIndexes(PUBLIC.rawIndexes).length;
    const collectionAnchor = (page: Page) => page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]');
    /** 此刻墙上每个有内容的 slot 显示的条目键（翻牌放完之后读）。 */
    const wallEntries = (page: Page) => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-entry]')]
            .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryEntry ?? '']),
    ));
    const settleFlips = (page: Page) => page.waitForTimeout(1200);
    const openPublic = async (mount: (id: string) => Promise<unknown>, page: Page) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-public');
        await waitForScope(page, publicScope());
        await settleFlips(page);
    };

    test('filtering degrades to a finite collage without repeats; clearing flips back with the start offset kept', async ({ mount, page }) => {
        await openPublic(mount, page);
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
        const before = await wallEntries(page);
        // 无限拼贴：同一条目有好几份。
        expect(new Set(Object.values(before)).size).toBeLessThan(Object.values(before).length);

        await setQuery(page, 'amber');
        await waitForScope(page, expectedPlayableIndexes(PUBLIC.rawIndexes, 'amber').length);
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'finite');
        await settleFlips(page);
        const filtered = Object.values(await wallEntries(page));
        expect(new Set(filtered).size).toBe(filtered.length);
        // 墙上放的是全部匹配项（不可播放的也在，灰显），播放范围才跳过它们。
        const matchIndexes = PUBLIC.rawIndexes.filter(index => onlineSearchText(index).includes('amber'));
        const matches = keysOf(PROBE_PROVIDER_A, PUBLIC.prefix, matchIndexes).map(key => `${key}-0`);
        expect(filtered.every(entry => matches.includes(entry))).toBe(true);
        await expect(page.locator('[data-bravais-seam-filter="active"]')).toBeVisible();

        await setQuery(page, '');
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
        await settleFlips(page);
        const after = await wallEntries(page);
        const shared = Object.keys(before).filter(slot => slot in after);
        expect(shared.length).toBeGreaterThan(0);
        expect(shared.filter(slot => before[slot] !== after[slot])).toEqual([]);
    });

    test('the filter box hands the keyboard to rank 0 on arrow down and keeps the filter', async ({ mount, page }) => {
        await openPublic(mount, page);
        await setQuery(page, 'cedar');
        const matches = keysOf(PROBE_PROVIDER_A, PUBLIC.prefix, expectedPlayableIndexes(PUBLIC.rawIndexes, 'cedar'));
        await waitForScope(page, matches.length);
        await settleFlips(page);
        // 命令面板的过滤框（Ctrl/Cmd+F、列表里的 filter-view，bravais 上是浮层）里按 ↓ 走的就是这个注册
        // （CommandFilterAnchor.focusResults）；缝里输入位的 ↓ 见下一条。
        const handled = await page.evaluate(async () => {
            const storePath = '/src/stores/useAppViewStore.ts';
            const { useAppViewStore } = await import(/* @vite-ignore */ storePath);
            return useAppViewStore.getState().commandFilter?.focusResults?.() ?? false;
        });
        expect(handled).toBe(true);
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-entry', `${matches[0]}-0`);
        expect(await getQuery(page)).toBe('cedar');
        await clearLog(page);
        await playFocused(page, 'bravais');
        await expect.poll(async () => (await lastCall(page, 'playSong'))?.ids).toEqual([matches[0]]);
    });

    // 设计稿 §7.6：每面墙的当前页过滤是缝自己的输入位——墙上直接打字（命令面板经 ownInput 交过来；组件探针里是
    // paletteTypingStandIn），不是命令面板的内联框。
    const filterInput = (page: Page) => page.locator('[data-library-stage="bravais"] [data-bravais-filter-input]');

    test('typing on the wall goes into the seam own filter input; arrow down hands the keyboard to rank 0 and keeps the filter', async ({ mount, page }) => {
        await openPublic(mount, page);
        await pressOnGrid(page, 'c');
        await expect(filterInput(page)).toBeFocused();
        await page.keyboard.type('edar');
        await expect(filterInput(page)).toHaveValue('cedar');
        expect(await getQuery(page)).toBe('cedar');
        // 不是命令面板的框：缝里只有自己的输入位（下划线、「过滤当前页」）。
        await expect(page.getByTestId('command-palette-filter')).toHaveCount(0);
        await expect(filterInput(page)).toHaveAttribute('placeholder', 'Filter this page');
        const matches = keysOf(PROBE_PROVIDER_A, PUBLIC.prefix, expectedPlayableIndexes(PUBLIC.rawIndexes, 'cedar'));
        await waitForScope(page, matches.length);
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'finite');
        // 匹配数在输入位右边（墙上放的是全部匹配项，不可播放的也在）。
        const matchCount = PUBLIC.rawIndexes.filter(index => onlineSearchText(index).includes('cedar')).length;
        await expect(page.locator('[data-bravais-filter-count]')).toHaveText(new RegExp(`^${matchCount} / \\d+$`));
        await settleFlips(page);
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-entry', `${matches[0]}-0`);
        await expect(filterInput(page)).not.toBeFocused();
        expect(await getQuery(page)).toBe('cedar');
        await clearLog(page);
        await playFocused(page, 'bravais');
        await expect.poll(async () => (await lastCall(page, 'playSong'))?.ids).toEqual([matches[0]]);
    });

    test('Escape in the seam input clears the words first, then ends the input without leaving the collection', async ({ mount, page }) => {
        await openPublic(mount, page);
        await pressOnGrid(page, 'a');
        await page.keyboard.type('mber');
        await expect(filterInput(page)).toHaveValue('amber');
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'finite');
        await page.keyboard.press('Escape');
        await expect(filterInput(page)).toHaveValue('');
        await expect(filterInput(page)).toBeFocused();
        expect(await getQuery(page)).toBe('');
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
        await page.keyboard.press('Escape');
        await expect(filterInput(page)).not.toBeFocused();
        expect(await stack(page)).toEqual(['Public Playlist']);
    });

    test('typing on the spine opens the seam to the full strip for the input, and it folds back once the input ends', async ({ mount, page }) => {
        await openPublic(mount, page);
        const seam = page.locator('[data-library-stage="bravais"] [data-bravais-seam]');
        // fb10：点标题区域收成书脊（原来是面包屑行右侧的「收起」）。
        await page.locator('[data-library-stage="bravais"] .bravais-seam-full .bravais-seam-title-area').click();
        await expect(seam).toHaveAttribute('data-bravais-seam', 'spine');
        await pressOnGrid(page, 'a');
        // 书脊上没有输入框：这一下先追加进过滤词，缝临时展开成完整信息条，输入位挂上后拿焦点（光标在末尾）。
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'spine');
        await expect(filterInput(page)).toBeFocused();
        await page.keyboard.type('mber');
        await expect(filterInput(page)).toHaveValue('amber');
        // ↓ 交给墙：输入结束，缝缩回书脊；过滤词还在，书脊上是强调色的过滤图标。
        await settleFlips(page);
        await page.keyboard.press('ArrowDown');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'spine');
        expect(await getQuery(page)).toBe('amber');
        await expect(seam.locator('[data-bravais-seam-action="filter"]')).toBeVisible();
        // 点它重新展开、焦点回到输入位；清空并结束输入后缩回原等级。
        await seam.locator('[data-bravais-seam-action="filter"]').click();
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
        await expect(filterInput(page)).toBeFocused();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'spine');
        expect(await getQuery(page)).toBe('');
    });

    test('the list panel is a navigation step: the crumb gains "List", Escape and browser back close it before leaving', async ({ mount, page }) => {
        await openPublic(mount, page);
        await openBravaisList(page);
        await expect(page.locator('[data-bravais-list] .bravais-seam-crumb-trail')).toContainText('List');
        expect(await page.evaluate(() => (window.history.state as { bravaisPanel?: string } | null)?.bravaisPanel ?? null)).toBe(PUBLIC_SESSION_KEY);

        await pressOnGrid(page, 'Escape');
        await expect(page.locator('[data-bravais-list]')).toHaveCount(0);
        expect(await stack(page)).toEqual(['Public Playlist']);

        await openBravaisList(page);
        await page.goBack();
        await expect(page.locator('[data-bravais-list]')).toHaveCount(0);
        expect(await stack(page)).toEqual(['Public Playlist']);

        await pressOnGrid(page, 'Escape');
        await expect.poll(() => stack(page)).toEqual([]);
    });

    test('hovering a list row marks its copies on the wall; a click flies to the nearest copy and opens it', async ({ mount, page }) => {
        await openPublic(mount, page);
        await openBravaisList(page);
        const entryKey = `${onlinePlaybackKey(PROBE_PROVIDER_A, `${PUBLIC.prefix}-3`)}-0`;
        await page.locator(`[data-bravais-list-row="${entryKey}"]`).hover();
        const linked = page.locator('.bravais-tile[data-bravais-linked]');
        await expect(linked.first()).toBeAttached();
        const linkedEntries = await linked.evaluateAll(tiles => tiles.map(tile => (tile as HTMLElement).dataset.libraryEntry));
        expect(new Set(linkedEntries)).toEqual(new Set([entryKey]));

        await page.locator(`[data-bravais-list-row="${entryKey}"]`).click();
        const card = page.locator(`.bravais-tile[data-bravais-expanded][data-library-entry="${entryKey}"]`);
        await expect(card).toBeInViewport();
        await page.mouse.move(5, 5);
        await expect(page.locator('.bravais-tile[data-bravais-linked]')).toHaveCount(0);
    });

    test('rename backs out with Escape and sends nothing; the seam flips back to the strip', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'navi-playlist');
        await waitForScope(page, 5);
        await clearLog(page);
        await page.locator('[data-bravais-seam-action="more"]').click();
        await page.locator('[data-bravais-seam-menu] [data-bravais-seam-action="rename"]').click();
        const input = page.locator('[data-bravais-form="rename"] input');
        await expect(input).toBeFocused();
        await input.press('Escape');
        await expect(page.locator('[data-bravais-form]')).toHaveCount(0);
        await expect(page.locator('[data-bravais-seam-title]')).toHaveText('Navi Playlist');
        expect(await requests(page, 'updatePlaylist')).toEqual([]);
        expect(await stack(page)).toEqual(['Navi Playlist']);
    });

    test('the daily recommendation date steps back through history from the seam', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-daily');
        await waitForScope(page, 10);
        const date = page.locator('[data-bravais-daily-date]');
        await expect(date).not.toHaveText('2026-09-30');
        await clearLog(page);
        await page.locator('[data-bravais-seam-action="daily-previous"]').click();
        await expect.poll(() => requests(page, 'historySongs')).not.toEqual([]);
        await expect(date).toHaveText('2026-09-30');
        expect(await stack(page)).toEqual(['Daily Picks']);
    });

    // 集合的描述（歌单简介）在完整信息条的标题下方，与歌手页的简介同一种截断 + 展开；没有描述不占位，书脊上没有。
    const description = (page: Page) => page.locator('[data-library-stage="bravais"] [data-bravais-collection-description]');
    const boxOf = async (page: Page, selector: string) => {
        const box = await page.locator(`[data-library-stage="bravais"] ${selector}`).first().boundingBox();
        expect(box, selector).not.toBeNull();
        return box!;
    };
    /** 缝里的按钮（播放全部、加入队列、列表、更多）都在视口里，也都在缝的纸条里。 */
    const expectSeamButtonsInView = async (page: Page) => {
        const viewport = page.viewportSize()!;
        const seam = await boxOf(page, '.bravais-seam-full');
        for (const action of ['play-scope', 'enqueue-scope', 'list', 'more']) {
            const box = await boxOf(page, `.bravais-seam-full [data-bravais-seam-action="${action}"]`);
            expect(box.y, action).toBeGreaterThanOrEqual(0);
            expect(box.y + box.height, action).toBeLessThanOrEqual(Math.min(viewport.height, seam.y + seam.height) + 0.5);
        }
    };

    test('the seam shows the collection description under the title as plain text; the spine leaves it out', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-dupes');
        await expect(description(page)).toHaveText(PROBE_SHORT_DESCRIPTION);
        await expect(description(page)).toHaveAttribute('data-bravais-collection-description', 'collapsed');
        const title = await boxOf(page, '.bravais-seam-full [data-bravais-seam-title]');
        const text = await boxOf(page, '[data-bravais-collection-description]');
        expect(text.y).toBeGreaterThan(title.y + title.height);
        // 竖排标题上下的引号成对角：上面那个靠右，下面那个靠左。
        const seam = await boxOf(page, '.bravais-seam-full');
        const quotes = await page.locator('[data-library-stage="bravais"] .bravais-seam-full .bravais-seam-quote').evaluateAll(elements => elements.map(element => {
            const range = document.createRange();
            range.selectNodeContents(element);
            const box = range.getBoundingClientRect();
            return { left: box.left, right: box.right };
        }));
        expect(quotes).toHaveLength(2);
        expect(quotes[0].left).toBeGreaterThan(seam.x + seam.width / 2);
        expect(quotes[1].right).toBeLessThan(seam.x + seam.width / 2);
        // 一行字：收起时就是全文，不截断。
        expect(await description(page).evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true);
        await expectSeamButtonsInView(page);

        await page.locator('[data-library-stage="bravais"] .bravais-seam-full .bravais-seam-title-area').click();
        await expect(page.locator('[data-library-stage="bravais"] .bravais-seam-spine')).toBeVisible();
        await expect(description(page)).toHaveCount(0);
    });

    test('the grid shows the same description under its title (unchanged)', async ({ mount, page }) => {
        await mountProbe(mount, page, 'grid');
        await open(page, 'online-dupes');
        await expect(page.locator('h2', { hasText: fixture['online-dupes'].name }).locator('xpath=following-sibling::p'))
            .toHaveText(PROBE_SHORT_DESCRIPTION);
    });

    test('a collection without a description leaves no room for it', async ({ mount, page }) => {
        await openPublic(mount, page);
        await expect(page.locator('[data-library-stage="bravais"] .bravais-seam-full [data-bravais-seam-title]')).toHaveText(PUBLIC.name);
        await expect(description(page)).toHaveCount(0);
        await expect(page.locator('[data-library-stage="bravais"] .bravais-seam-blurb')).toHaveCount(0);
    });

    test('a long description is clamped, opens in place with its line breaks, scrolls inside, and closes again', async ({ mount, page }) => {
        // 矮一点的视口：展开的描述与竖排标题一起让位，按钮仍在缝里、在视口里。
        await page.setViewportSize({ width: 1440, height: 640 });
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-owned-twice');
        const text = description(page);
        await expect(text).toHaveAttribute('data-bravais-collection-description', 'collapsed');
        // 首尾空白去掉，段落之间的换行原样保留（纯文本，pre-wrap）。
        expect(await text.evaluate(element => element.textContent)).toBe(PROBE_LONG_DESCRIPTION.trim());
        await expect(text).toHaveCSS('white-space', 'pre-wrap');
        const collapsed = await text.evaluate(element => ({
            client: element.clientHeight,
            scroll: element.scrollHeight,
            lineHeight: parseFloat(getComputedStyle(element).lineHeight),
        }));
        expect(collapsed.scroll).toBeGreaterThan(collapsed.client);
        // 收起时 6 行（fb10：星标挪进按钮行，让出来的两行给了描述）；矮视口里与竖排标题一起让位，可能更少。
        expect(collapsed.client).toBeLessThanOrEqual(Math.ceil(collapsed.lineHeight * 6) + 1);
        await expectSeamButtonsInView(page);

        await text.click();
        await expect(text).toHaveAttribute('data-bravais-collection-description', 'expanded');
        await expect(text).toHaveAttribute('aria-expanded', 'true');
        const expanded = await text.evaluate(element => ({
            client: element.clientHeight,
            scroll: element.scrollHeight,
            overflow: getComputedStyle(element).overflowY,
        }));
        expect(expanded.client).toBeGreaterThan(collapsed.client);
        // 比封顶还长：在这一块里滚动，不把按钮挤出去。
        expect(expanded.overflow).toBe('auto');
        expect(expanded.scroll).toBeGreaterThan(expanded.client);
        await expectSeamButtonsInView(page);

        await text.click();
        await expect(text).toHaveAttribute('data-bravais-collection-description', 'collapsed');
        expect(await text.evaluate(element => element.clientHeight)).toBe(collapsed.client);
    });

    // fb10（用户实测「面包屑被截得很短」）：面包屑行只剩 ‹ 与面包屑，「收起」改成点标题区域、「折叠」挪进「⋯ 更多」。
    const seamOf = (page: Page) => page.locator('[data-library-stage="bravais"] [data-bravais-seam]');
    const titleArea = (page: Page) => seamOf(page).locator('.bravais-seam-full .bravais-seam-title-area');
    const spineTitle = (page: Page) => seamOf(page).locator('.bravais-seam-spine [data-bravais-seam-title]');
    const noFlips = (page: Page) => expect(seamOf(page).locator('[data-bravais-seam-flip]')).toHaveCount(0);

    test('the crumb row keeps only back and the crumbs, which take the whole row', async ({ mount, page }) => {
        await openPublic(mount, page);
        const row = seamOf(page).locator('.bravais-seam-full .bravais-seam-crumbs');
        await expect(row.locator('[data-bravais-seam-action="spine"], [data-bravais-seam-action="hide"], .bravais-seam-level')).toHaveCount(0);
        const rowBox = await boxOf(page, '.bravais-seam-full .bravais-seam-crumbs');
        const back = await boxOf(page, '.bravais-seam-full .bravais-seam-crumbs [data-bravais-seam-action="back"]');
        const trail = await boxOf(page, '.bravais-seam-full [data-bravais-crumbs]');
        // ‹ 之后的整行都是面包屑（间距 6px）；原来右侧两个文字按钮占掉近一半。
        expect(trail.width).toBeGreaterThanOrEqual(rowBox.width - back.width - 6 - 1);
        expect(trail.width).toBeGreaterThan(200);
        // 根（书库）不截断，当前层的名字完整放得下。
        const root = row.locator('[data-bravais-crumb="root"]');
        expect(await root.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
        const current = row.locator('[data-bravais-crumb="current"]');
        await expect(current).toHaveText(PUBLIC.name);
        expect(await current.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    });

    test('clicking the title area collapses the strip to the spine; clicking the spine title opens it again', async ({ mount, page }) => {
        await openPublic(mount, page);
        const seam = seamOf(page);
        const area = titleArea(page);
        // 可感知：原生按钮、读屏名与悬停提示是「收起信息条」，标题文字作为描述读得到；指针是手形，悬停有浅底。
        await expect(area).toHaveJSProperty('tagName', 'BUTTON');
        await expect(area).toHaveAccessibleName('Collapse the info strip');
        await expect(area).toHaveAttribute('title', 'Collapse the info strip');
        await expect(area).toHaveAccessibleDescription(PUBLIC.name);
        await expect(area).toHaveCSS('cursor', 'pointer');
        // 引号与竖排标题都在这个按钮里。
        await expect(area.locator('.bravais-seam-quote')).toHaveCount(2);
        await expect(area.locator('[data-bravais-seam-title]')).toHaveText(PUBLIC.name);
        const restBackground = await area.evaluate(node => getComputedStyle(node).backgroundColor);
        await area.hover();
        await expect.poll(() => area.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(restBackground);

        // 点引号（标题区域的一角）也算。
        await area.locator('.bravais-seam-quote').first().click();
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'spine');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'spine');
        await noFlips(page);
        await expect(spineTitle(page)).toHaveAccessibleName('Expand the info strip');
        await expect(spineTitle(page)).toHaveAccessibleDescription(PUBLIC.name);

        await spineTitle(page).click();
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'full');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
        await noFlips(page);
        expect(await stack(page)).toEqual(['Public Playlist']);
    });

    test('dragging across the title does not toggle the strip', async ({ mount, page }) => {
        await openPublic(mount, page);
        const seam = seamOf(page);
        const box = await boxOf(page, '.bravais-seam-full [data-bravais-seam-title]');
        const x = box.x + box.width / 2;
        await page.mouse.move(x, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(x + 2, box.y + 30, { steps: 3 });
        await page.mouse.move(x + 6, box.y + 60, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(400);
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'full');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
        // 原地点一下照常收起。
        await page.mouse.click(x, box.y + 30);
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'spine');
    });

    test('folding moved into the more menu, last, and the edge tab brings the strip back', async ({ mount, page }) => {
        await openPublic(mount, page);
        const seam = seamOf(page);
        await seam.locator('.bravais-seam-full [data-bravais-seam-action="more"]').click();
        const menu = seam.locator('[data-bravais-seam-menu]');
        await expect(menu).toBeVisible();
        const fold = menu.locator('[data-bravais-seam-action="hide"]');
        await expect(fold).toHaveAccessibleName('Fold the info strip');
        await expect(fold).toHaveAttribute('role', 'menuitem');
        // 它是菜单的最后一项，与集合动作之间一道分隔线。
        expect(await menu.locator('[role="menuitem"]').last().getAttribute('data-bravais-seam-action')).toBe('hide');
        await expect(menu.locator('[role="separator"]')).toHaveCount(1);
        await fold.click();
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'hidden');
        const tab = page.locator('.bravais-seam-tab[data-bravais-seam-tab="hidden"]');
        await expect(tab).toBeVisible();
        await tab.click();
        // 恢复到折叠前的等级（完整信息条）。
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'full');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
    });

    test('the more menu floats above the buttons: nothing in the strip moves, and a click elsewhere or Escape closes it', async ({ mount, page }) => {
        await openPublic(mount, page);
        const seam = seamOf(page);
        const more = seam.locator('.bravais-seam-full [data-bravais-seam-action="more"]');
        const play = seam.locator('.bravais-seam-full [data-bravais-seam-action="play-scope"]').first();
        const before = { more: await more.boundingBox(), play: await play.boundingBox() };
        await more.click();
        const menu = seam.locator('[data-bravais-seam-menu]');
        await expect(menu).toBeVisible();
        expect(await menu.evaluate(node => getComputedStyle(node).position)).toBe('absolute');
        // 打开菜单不推挤：按钮行与上面的播放按钮都没动；菜单在「⋯ 更多」上方。
        expect(await more.boundingBox()).toEqual(before.more);
        expect(await play.boundingBox()).toEqual(before.play);
        await expect.poll(async () => (await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(before.more!.y);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'full');
        await more.click();
        await expect(menu).toBeVisible();
        // 点别处（按下在菜单与按钮之外）收起。
        await page.locator('body').dispatchEvent('pointerdown');
        await expect(menu).toHaveCount(0);
    });

    test('the star sits at the end of the play / enqueue row instead of a row of its own', async ({ mount, page }) => {
        await openPublic(mount, page);
        const row = seamOf(page).locator('.bravais-seam-full .bravais-seam-actions.is-scope');
        const star = row.locator('[data-bravais-seam-action="subscribe"]');
        await expect(star).toBeVisible();
        await expect(star).toHaveAccessibleName('Subscribe Playlist');
        await expect(star).toHaveAttribute('aria-pressed', 'false');
        // 同一行：与「播放全部」竖直方向重叠；靠右（这一行的最后一个，右边缘贴着行尾）。
        const play = await boxOf(page, '.bravais-seam-full [data-bravais-seam-action="play-scope"]');
        const starBox = await boxOf(page, '.bravais-seam-full [data-bravais-seam-action="subscribe"]');
        const rowBox = await boxOf(page, '.bravais-seam-full .bravais-seam-actions.is-scope');
        expect(starBox.y).toBeLessThan(play.y + play.height);
        expect(starBox.y + starBox.height).toBeGreaterThan(play.y);
        expect(starBox.x).toBeGreaterThan(play.x + play.width);
        expect(Math.abs(starBox.x + starBox.width - (rowBox.x + rowBox.width))).toBeLessThanOrEqual(1);
        expect(rowBox.height).toBeLessThanOrEqual(Math.max(play.height, starBox.height) + 1);
        // 行为不变：按下去发上游请求，按下状态翻转。
        await clearLog(page);
        await star.click();
        await expect.poll(() => requests(page, 'subscribePlaylist')).toHaveLength(1);
        await expect(star).toHaveAttribute('aria-pressed', 'true');
        await expect(star).toHaveAccessibleName('Unsubscribe Playlist');
    });
});

test.describe('[bravais-only] collection page, more', () => {
    const collectionAnchor = (page: Page) => page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]');

    test('an input method composition holds the wall until it ends', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        // 组词发生在缝里的输入位上（它报告组词状态，墙用的过滤词停在组词开始前的那一个）。
        const host = page.locator('[data-library-stage="bravais"] [data-bravais-filter-input]');
        await host.dispatchEvent('compositionstart');
        await setQuery(page, 'amber');
        await page.waitForTimeout(500);
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
        await host.dispatchEvent('compositionend');
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'finite');
    });

    test('sorting from the list panel reorders the wall and stays on the infinite collage', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'local-all');
        await waitForScope(page, 8);
        await openBravaisList(page);
        await page.locator('[data-bravais-list-sort-field]').selectOption('fileLastModified');
        await expect.poll(() => playFilteredIds(page)).toEqual(LOCAL_SORT_ORDERS.modifiedAsc.map(localKey));
        await expect(page.locator('[data-bravais-list-row]').first()).toHaveAttribute('data-bravais-list-row', `${localKey(8)}-0`);
        await page.locator('[data-bravais-list-sort-direction]').click();
        await expect.poll(() => playFilteredIds(page)).toEqual(LOCAL_SORT_ORDERS.modifiedDesc.map(localKey));
        await expect(collectionAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
    });

    test('add to playlist flips the seam into a picker of Navidrome playlists; a new one is created from the same form', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'navi-album');
        await waitForScope(page, 6);
        const openPicker = async () => {
            await page.locator('[data-bravais-seam-action="more"]').click();
            await page.locator('[data-bravais-seam-menu] [data-bravais-seam-action="add-to-playlist"]').click();
            await expect(page.locator('[data-bravais-form="pick-playlist"]')).toBeVisible();
        };
        await clearLog(page);
        await openPicker();
        await page.locator('[data-bravais-form-playlist="navi-pl-1"]').click();
        await expect.poll(() => requests(page, 'updatePlaylist', 'navi-pl-1')).toHaveLength(1);
        await expect(page.locator('[data-bravais-form]')).toHaveCount(0);

        await openPicker();
        await page.locator('[data-bravais-form-action="create"]').click();
        const input = page.locator('[data-bravais-form="pick-playlist"] input');
        await expect(input).toBeFocused();
        await input.fill('Fresh Picks');
        await input.press('Enter');
        await expect.poll(() => requests(page, 'createPlaylist')).toHaveLength(1);
        await expect(page.locator('[data-bravais-form]')).toHaveCount(0);
        expect(await stack(page)).toEqual(['Navi Album']);
    });

    test('switching from the grid keeps the focused song: the wall puts the keyboard focus on it', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await pressOnGrid(page, 'ArrowRight');
        await page.waitForTimeout(400);
        await pressOnGrid(page, 'Enter');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedKey = (await lastCall(page, 'playSong'))!.ids[0];

        await setRenderer(page, 'bravais');
        await waitForRenderer(page, 'bravais');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-entry', `${focusedKey}-0`);
        await clearLog(page);
        await playFocused(page, 'bravais');
        await expect.poll(async () => (await lastCall(page, 'playSong'))?.ids).toEqual([focusedKey]);
        expect(await requests(page, 'playlistTracks')).toEqual([]);
    });
});

test.describe('[bravais-only] host dialogs', () => {
    test('match-song from the focus card and edit-entity from the seam open host dialogs above the wall', async ({ mount, page }) => {
        const isOnTop = (selector: string) => page.evaluate((dialogSelector) => {
            const dialog = document.querySelector(dialogSelector);
            if (!dialog) return false;
            const rect = dialog.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return Boolean(hit && dialog.contains(hit));
        }, selector);

        await mountProbe(mount, page, 'bravais');
        await open(page, 'local-all');
        await waitForScope(page, 8);
        const card = await focusBravaisEntry(page, localKey(1));
        await card.locator('[data-bravais-action="more"]').click();
        await card.locator('[data-bravais-action="match-song"]').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await isOnTop('[role="dialog"]')).toBe(true);
        // 对话框开着时墙不接键盘（hasBlockingWindow）：Esc 不收起聚焦卡。
        await page.keyboard.press('Escape');
        await expect(page.locator(`.bravais-tile[data-bravais-expanded][data-library-entry="${localKey(1)}-0"]`)).toHaveCount(1);
        await page.getByRole('dialog').locator('button:has(svg.lucide-x)').first().click();
        await expect(page.getByRole('dialog')).toHaveCount(0);

        await backAndSettle(page);
        await open(page, 'local-album');
        await waitForScope(page, 4);
        await page.locator('[data-bravais-seam-action="more"]').click();
        await page.locator('[data-bravais-seam-menu] [data-bravais-seam-action="edit-entity"]').click();
        await expect(page.getByRole('dialog')).toBeVisible();
        expect(await isOnTop('[role="dialog"]')).toBe(true);
    });
});

// N1（折叠紧邻往返）在 bravais 上：stage 按导航深度判断换层种类，所以「要进入的正好是上一层」经宿主走返回之后，
// 墙看到的是深度变浅——按返回翻一次（相机 / 起点从布局记忆恢复、离开的那一层不写记忆），不是再 push 一次，也不翻两次；
// 打开时记下的起点（pendingOrigin）在这次换层里被取走丢掉，不留给以后。曲目链接只通向专辑 / 歌手，两个集合页之间的
// 往返用探针的 push 构造（与宿主收到 onPushCollection 之后同一条路）。B8 起歌手页也由 bravais 渲染：专辑 ↔ 歌手的
// 折回同样是换层一次、反向翻一次（更多歌手页的用例在 artistBehavior 的 [bravais-only]）。
test.describe('[bravais-only] N1 fold', () => {
    const stageRoot = (page: Page) => page.locator('[data-library-stage="bravais"]');
    const layerKey = (page: Page) => stageRoot(page).getAttribute('data-bravais-layer');
    const layoutMemory = (page: Page, key: string) => page.evaluate(
        sessionKey => window.sessionStorage.getItem(`folia_bravais_layout:v1:${sessionKey}`),
        key,
    );
    /** 从现在起数 stage 的翻牌次数（data-bravais-settling 出现一次算一次）与换过的层。 */
    const watchStage = (page: Page) => page.evaluate(() => {
        const root = document.querySelector('[data-library-stage="bravais"]')!;
        const record = { flips: 0, layers: [] as string[] };
        (window as unknown as { __bravaisStageWatch?: typeof record }).__bravaisStageWatch = record;
        let settling = root.hasAttribute('data-bravais-settling');
        let layer = root.getAttribute('data-bravais-layer');
        new MutationObserver(() => {
            const nextSettling = root.hasAttribute('data-bravais-settling');
            if (nextSettling && !settling) record.flips += 1;
            settling = nextSettling;
            const nextLayer = root.getAttribute('data-bravais-layer');
            if (nextLayer !== layer && nextLayer) record.layers.push(nextLayer);
            layer = nextLayer;
        }).observe(root, { attributes: true, attributeFilter: ['data-bravais-settling', 'data-bravais-layer'] });
    });
    const stageWatch = (page: Page) => page.evaluate(() => (
        (window as unknown as { __bravaisStageWatch?: { flips: number; layers: string[] } }).__bravaisStageWatch!
    ));
    const pendingOrigin = (page: Page) => page.evaluate(async () => {
        const modulePath = '/src/library/suites/bravais/bravaisStageStore.ts';
        const { useBravaisStageStore } = await import(/* @vite-ignore */ modulePath);
        return useBravaisStageStore.getState().pendingOrigin as unknown;
    });
    const push = (page: Page, id: ProbeFixtureId) => page.evaluate(fixtureId => window.__libraryProbe!.push(fixtureId), id);

    test('entering the collection right below folds into one back: one reverse flip, no push, no origin left over', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await waitForBravaisWall(page);
        const playlist = (await layerKey(page))!;

        expect(await push(page, 'online-owned')).toBe(true);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', fixture['online-owned'].name]);
        await waitForScope(page, expectedPlayableIndexes(fixture['online-owned'].rawIndexes).length);
        await expect.poll(() => layerKey(page)).not.toBe(playlist);
        await waitForBravaisWall(page);
        const owned = (await layerKey(page))!;
        // push 离开歌单时记下了它的布局；歌单之上的这一层还没离开过。
        expect(await layoutMemory(page, playlist)).not.toBeNull();
        expect(await layoutMemory(page, owned)).toBeNull();
        // 在这一层上「打开」时 stage 会先记起点（这里模拟那一步）：折叠成返回时它要被取走丢掉。
        await page.evaluate(async key => {
            const modulePath = '/src/library/suites/bravais/bravaisStageStore.ts';
            const { setBravaisPendingOrigin } = await import(/* @vite-ignore */ modulePath);
            setBravaisPendingOrigin({ fromLayerKey: key, slotKey: '0,0,0' });
        }, owned);

        await watchStage(page);
        expect(await push(page, 'online-public')).toBe(true);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        await expect.poll(() => layerKey(page)).toBe(playlist);
        await waitForBravaisWall(page);
        await page.waitForTimeout(400);

        const watch = await stageWatch(page);
        expect(watch.layers).toEqual([playlist]);
        expect(watch.flips).toBe(1);
        // 返回不给离开的那一层写布局记忆（push 才写）。
        expect(await layoutMemory(page, owned)).toBeNull();
        expect(await pendingOrigin(page)).toBeNull();

        // 之后照常压栈：再进去是一次 push（这次离开歌单又写一遍记忆），翻一次。
        await watchStage(page);
        expect(await push(page, 'online-owned')).toBe(true);
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', fixture['online-owned'].name]);
        await expect.poll(() => layerKey(page)).toBe(owned);
        await waitForBravaisWall(page);
        await page.waitForTimeout(400);
        expect((await stageWatch(page)).flips).toBe(1);
    });

    test('folding back from the bravais artist page into the album below it is the same as a back', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await open(page, 'online-public');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        const focusCardLink = (itemKey: string, name: string) => page
            .locator(`[data-bravais-focus-card="${itemKey}-0"]`)
            .getByRole('button', { name, exact: true });
        const albumKey = onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(PROBE_ALBUM.prefix, 1));
        const artistKey = 'online:probe-a:artist:ar-1';
        const artistAnchor = page.locator('[data-library-surface="artist"][data-library-renderer="bravais"]');
        /** 专辑（bravais）→ 歌手（聚焦卡上的歌手链接，也是 bravais）：换到歌手那一层。 */
        const openArtist = async () => {
            await focusBravaisEntry(page, albumKey);
            await focusCardLink(albumKey, 'Probe Artist').click();
            await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, 'Probe Artist']);
            await expect(artistAnchor).toHaveCount(1);
            await expect.poll(() => layerKey(page)).toBe(artistKey);
            await waitForBravaisWall(page);
            await page.waitForTimeout(400);
        };
        const expectAlbumBack = async (album: string) => {
            await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
            await expect(page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]')).toHaveCount(1);
            await waitForScope(page, PROBE_ALBUM.rawIndexes.length);
            await waitForBravaisWall(page);
            await page.waitForTimeout(400);
            expect(await layerKey(page)).toBe(album);
            return stageWatch(page);
        };

        // 歌单 → 专辑（聚焦卡上的专辑链接）。
        const publicKey = onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId('public', 1));
        await focusBravaisEntry(page, publicKey);
        await focusCardLink(publicKey, PROBE_ALBUM.name).click();
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
        await waitForScope(page, PROBE_ALBUM.rawIndexes.length);
        await waitForBravaisWall(page);
        const album = (await layerKey(page))!;

        // 参照：歌手页上普通返回一次——换回专辑那一层，反向翻一次。
        await openArtist();
        await watchStage(page);
        await back(page);
        const backWatch = await expectAlbumBack(album);
        expect(backWatch).toEqual({ flips: 1, layers: [album] });

        // 歌手页上点热门歌曲的这张专辑（正好是上一层）：折成一次返回，与上面的返回一样——不按 push 翻、不翻两次。
        await openArtist();
        const songEntry = `song:${onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId('artop', 22))}`;
        await openBravaisList(page);
        await page.locator(`[data-bravais-list-row="${songEntry}"]`).click();
        const songCard = page.locator(`[data-bravais-focus-card="${songEntry}"]`);
        await expect(songCard).toBeVisible();
        await waitForBravaisWall(page);
        await watchStage(page);
        await songCard.getByRole('button', { name: PROBE_ALBUM.name, exact: true }).dispatchEvent('click');
        const foldWatch = await expectAlbumBack(album);
        expect(foldWatch).toEqual(backWatch);
    });
});

// B11 导航与转场收尾：面包屑按位置跳层（栈里有重复的集合、面板开着）、从搜索页打开的整墙入场、降低动态效果的淡入淡出。
// stage 根节点的 data-bravais-shift(-seq) 记下每次换层的种类；探针没有首页层，回到深度 0 的出场在 bravaisHome 里验。
test.describe('[bravais-only] B11 navigation and transitions', () => {
    const stageRoot = (page: Page) => page.locator('[data-library-stage="bravais"]');
    const layerKey = (page: Page) => stageRoot(page).getAttribute('data-bravais-layer');
    const crumbs = (page: Page) => stageRoot(page).locator('[data-bravais-crumb]');
    const crumbKinds = (page: Page) => crumbs(page).evaluateAll(nodes => nodes.map(node => (
        `${node.getAttribute('data-bravais-crumb')}${node.getAttribute('data-bravais-crumb-depth') ?? ''}:${node.textContent ?? ''}`
    )));
    const push = (page: Page, id: ProbeFixtureId) => page.evaluate(fixtureId => window.__libraryProbe!.push(fixtureId), id);
    /** 从现在起记下每一次换层的种类（按序号认新的一次）。 */
    const watchShifts = (page: Page) => page.evaluate(() => {
        const root = document.querySelector('[data-library-stage="bravais"]')!;
        const record: string[] = [];
        (window as unknown as { __shifts?: string[] }).__shifts = record;
        let seq = root.getAttribute('data-bravais-shift-seq');
        new MutationObserver(() => {
            const next = root.getAttribute('data-bravais-shift-seq');
            if (next === seq || next === null) return;
            seq = next;
            record.push(root.getAttribute('data-bravais-shift') ?? '');
        }).observe(root, { attributes: true, attributeFilter: ['data-bravais-shift-seq'] });
    });
    const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts?: string[] }).__shifts ?? []);
    /** 此刻在磁贴内容层上跑着的动画：关键帧里有没有绕 Y 轴转、抬起、只改透明度。 */
    const tileAnimations = (page: Page) => page.evaluate(() => document.getAnimations()
        .filter(animation => {
            // 只看磁贴自己放的 WAAPI 动画（CSS 的过渡 / 动画也在 getAnimations 里，例如悬停与日光切换的过渡）。
            if (animation instanceof CSSTransition || animation instanceof CSSAnimation) return false;
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return target instanceof Element && target.classList.contains('bravais-tile-face');
        })
        .map(animation => {
            const effect = animation.effect as KeyframeEffect;
            const frames = effect.getKeyframes();
            const transforms = frames.map(frame => String(frame.transform ?? '')).join(' ');
            return {
                rotates: transforms.includes('rotateY'),
                lifts: transforms.includes('-90px'),
                fadesOnly: !frames.some(frame => frame.transform !== undefined) && frames.some(frame => frame.opacity !== undefined),
                duration: Number(effect.getTiming().duration),
                fill: effect.getTiming().fill,
            };
        }));
    const openFixture = async (page: Page, id: keyof typeof fixture) => {
        await open(page, id);
        await waitForScope(page, expectedPlayableIndexes(fixture[id].rawIndexes).length);
        await waitForBravaisWall(page);
    };
    const pushAndWait = async (page: Page, id: ProbeFixtureId, expected: string[]) => {
        const before = await layerKey(page);
        expect(await push(page, id)).toBe(true);
        await expect.poll(() => stack(page)).toEqual(expected);
        await expect.poll(() => layerKey(page)).not.toBe(before);
        await waitForBravaisWall(page);
    };
    const PUBLIC = fixture['online-public'].name;
    const OWNED = fixture['online-owned'].name;
    const DAILY = fixture['online-daily'].name;

    test('a stack that repeats a collection: crumbs fold, expand and jump by position; the repeated layer flips back once', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await openFixture(page, 'online-public');
        const publicKey = (await layerKey(page))!;
        await expect.poll(() => crumbKinds(page)).toEqual(['root0:Library', `current:${PUBLIC}`]);

        await pushAndWait(page, 'online-owned', [PUBLIC, OWNED]);
        await expect.poll(() => crumbKinds(page)).toEqual(['root0:Library', `layer1:${PUBLIC}`, `current:${OWNED}`]);
        await pushAndWait(page, 'online-daily', [PUBLIC, OWNED, DAILY]);
        // 不是紧邻的往返：照常压栈，栈里第二次出现 Public。
        expect(await push(page, 'online-public')).toBe(true);
        await expect.poll(() => stack(page)).toEqual([PUBLIC, OWNED, DAILY, PUBLIC]);
        await expect.poll(() => layerKey(page)).toBe(publicKey);
        await waitForBravaisWall(page);

        // 中间层多于 1 层：只留紧挨当前层的那一层，其余折成「…」；点「…」展开，每一层都给它自己的位置。
        await expect.poll(() => crumbKinds(page)).toEqual(['root0:Library', 'more:…', `layer3:${DAILY}`, `current:${PUBLIC}`]);
        await expect(stageRoot(page).locator('[data-bravais-crumb="more"]')).toHaveAttribute('title', `${PUBLIC} › ${OWNED}`);
        await stageRoot(page).locator('[data-bravais-crumb="more"]').click();
        await expect.poll(() => crumbKinds(page)).toEqual([
            'root0:Library', `layer1:${PUBLIC}`, `layer2:${OWNED}`, `layer3:${DAILY}`, `current:${PUBLIC}`,
        ]);

        // 点第 1 层的 Public：同一个集合、深度从 4 变 1——是一次返回，翻一次，层还是 Public。
        await page.waitForTimeout(300);
        await watchShifts(page);
        await stageRoot(page).locator('[data-bravais-crumb="layer"][data-bravais-crumb-depth="1"]').click();
        await expect.poll(() => stack(page)).toEqual([PUBLIC]);
        await waitForBravaisWall(page);
        await page.waitForTimeout(400);
        expect(await shifts(page)).toEqual(['back']);
        await expect(stageRoot(page)).toHaveAttribute('data-bravais-layer', publicKey);
        await expect.poll(() => crumbKinds(page)).toEqual(['root0:Library', `current:${PUBLIC}`]);
    });

    test('with the list panel open the current crumb closes it, and a crumb jump leaves the panel behind', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await openFixture(page, 'online-public');
        await pushAndWait(page, 'online-owned', [PUBLIC, OWNED]);
        await pushAndWait(page, 'online-daily', [PUBLIC, OWNED, DAILY]);

        await openBravaisList(page);
        await expect.poll(() => crumbKinds(page)).toEqual([
            'root0:Library', 'more:…', `layer2:${OWNED}`, `current:${DAILY}`, 'panel:List',
        ]);
        // 当前层（面板开着）= 关面板，不换层。
        await watchShifts(page);
        await stageRoot(page).locator('[data-bravais-crumb="current"]').click();
        await expect(page.locator('[data-bravais-list]')).toHaveCount(0);
        expect(await stack(page)).toEqual([PUBLIC, OWNED, DAILY]);

        // 再开面板，点上一层：调用方不先关面板，落地后面板不在了，翻一次。
        await openBravaisList(page);
        await page.waitForTimeout(300);
        await stageRoot(page).locator('[data-bravais-crumb="layer"][data-bravais-crumb-depth="2"]').click();
        await expect.poll(() => stack(page)).toEqual([PUBLIC, OWNED]);
        await expect(page.locator('[data-bravais-list]')).toHaveCount(0);
        await waitForBravaisWall(page);
        await page.waitForTimeout(400);
        expect(await shifts(page)).toEqual(['back']);
    });

    test('opening from the search enters the whole wall: no start tile, every tile lands from lifted', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await page.evaluate(() => window.__libraryProbe!.open('online-public', 'search'));
        await expect(stageRoot(page)).toHaveAttribute('data-bravais-shift', 'enter');
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        const animations = await tileAnimations(page);
        expect(animations.every(animation => animation.lifts && !animation.rotates && animation.fill === 'backwards')).toBe(true);
        await expect(stageRoot(page).locator('[data-bravais-crumb="root"]')).toHaveText('Search');
        await waitForScope(page, expectedPlayableIndexes(fixture['online-public'].rawIndexes).length);
        await waitForBravaisWall(page);
        // 落定后墙上是这一层的内容（入场途中到达的数据照样落回），起点没有留下。
        await expect(stageRoot(page).locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
        expect(await page.evaluate(async () => {
            const modulePath = '/src/library/suites/bravais/bravaisStageStore.ts';
            const { useBravaisStageStore } = await import(/* @vite-ignore */ modulePath);
            return useBravaisStageStore.getState().pendingOrigin as unknown;
        })).toBeNull();
    });

    test('reduced motion fades the flips in 0.18s instead of turning them, both ways', async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
        await mountProbe(mount, page, 'bravais');
        await openFixture(page, 'online-public');
        await page.waitForTimeout(300);

        const settleStarted = Date.now();
        expect(await push(page, 'online-owned')).toBe(true);
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        const pushed = await tileAnimations(page);
        expect(pushed.every(animation => animation.fadesOnly && animation.duration === 90)).toBe(true);
        await expect.poll(() => stack(page)).toEqual([PUBLIC, OWNED]);
        await waitForBravaisWall(page);
        // 落定按 0.18s 算（加上换层前后的余量），不是翻牌的错开上限。
        expect(Date.now() - settleStarted).toBeLessThan(2000);

        await page.waitForTimeout(300);
        await back(page);
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        expect((await tileAnimations(page)).every(animation => animation.fadesOnly)).toBe(true);
        await expect.poll(() => stack(page)).toEqual([PUBLIC]);
        await waitForBravaisWall(page);
    });
});
