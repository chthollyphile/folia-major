import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import type { ArtistFixtureId } from '../../dev/probes/libraryBehavior/fixtureRules';
import type { ProbeFault } from '../../dev/probes/libraryBehavior/fakeProviders';
import {
    ARTIST_ALBUM_PAGE_SIZE,
    artistAlbumIds,
    artistAlbumIdsMatching,
    artistAlbumName,
    isProbeUnavailable,
    LOCAL_ALBUM_NAMES,
    LOCAL_ARTIST_NAME,
    localSongId,
    NAVIDROME_ALBUM_TRACKS,
    NAVIDROME_ARTIST_ALBUMS,
    NAVIDROME_HOME_ARTISTS,
    ONLINE_ARTISTS,
    onlineArtistTarget,
    onlinePlaybackKey,
    onlineSongId,
    PROBE_ALBUM,
    PROBE_PROVIDER_A,
    range,
} from '../../dev/probes/libraryBehavior/fixtureRules';
import '../../dev/probes/libraryBehavior/probeApi';

// test/component/artistBehavior.spec.ts
// 歌手页与它的嵌套入口的行为基线（P4.0 建立；P4.1 把歌手数据挪进宿主按 collectionKey 持有的 core 歌手资源，
// 这批用例就是验收）。
//
// 用的是 libraryBehavior 探针页（同一个假宿主、假 provider、Navidrome 垫片、本地 fixture），驱动接口是
// window.__libraryProbe 上的歌手页部分：openArtist / artist() / openArtistAlbum / openArtistPanel / reloadArtist /
// artistSurface / runArtistSurface，以及故障、延迟、按住应答。artist() 读在场歌手页 surface（任何一套 suite）收到的
// 歌手资源的快照与浏览会话里的筛选词（见 dev/probes/libraryBehavior/artistProbeView.ts），断言只用它给出的语义字段。
//
// P4.3 起 TUI 也实现了歌手页：与渲染形态无关的场景在 `for (const suite of SUITES)` 里对 grid / tui 各跑一遍
// （点卡片 / 行上的链接、Enter 播放这类入口按 suite 换成各自的 DOM 或按键）；只属于网格的 DOM（卡片上的按钮、
// 专辑侧栏与信息面板）标 [grid-only]，只属于 TUI 的按键标 [tui-only]；[switch] 是两套之间切换
// （筛选与焦点保留、零新请求——歌手资源由宿主持有）。
// P4.5 起「返回按钮 = 完成（清会话与每套 suite 的布局记录）、Escape / 浏览器后退 = 离开但保留」由宿主统一，两套都跑。
// B8 起 bravais 也在参数化的列表里（[bravais]）：它的画面在常驻的 stage 里（surface 只是不可见的锚点），墙是虚拟化的
// 无限拼贴，所以热门歌曲经列表面板定位、聚焦卡上的按钮与链接操作；「加入热门歌曲」的条数提示显示在缝底（不走 toast）。
// P4.0 记下的三个缺陷（Navidrome 晚到写回、本地 catalog 未就绪闪空态、加载失败无错误态）P4.1 已转正。
//
// 资源复用（P4.1）：离开的在线 / Navidrome 歌手留在一个有界的 LRU 里，详情已到、没有失败就直接复用——
// 从专辑返回歌手页不重新请求详情与热门歌曲，被暂停的专辑分页从停下的 offset 续上；首屏没加载完就离开的
// 不复用（重开时从头加载）。
//
// 探针页开着 StrictMode：同一个请求理论上可能出现多次，分页断言看「去重后的 offset 序列」。

const SUITES = ['grid', 'tui', 'bravais'] as const;
type Suite = typeof SUITES[number];

const main = ONLINE_ARTISTS['artist-main'];
const guest = ONLINE_ARTISTS['artist-guest'];
const mainTarget = onlineArtistTarget(main);
/** 以根层打开的在线歌手页的浏览会话键（= 导航栈那一层的 collectionKey）。 */
const mainSessionKey = `online:${main.providerId}:artist:${main.artistId}`;
const guestTarget = onlineArtistTarget(guest);

const topKeys = (rule: typeof main, playableOnly = false) => rule.topSongIndexes
    .filter(index => !playableOnly || !isProbeUnavailable(index))
    .map(index => onlinePlaybackKey(rule.providerId, onlineSongId(rule.topSongPrefix, index)));
const naviKey = (songId: string) => `navidrome:${songId}`;
const naviTopKeys = (artistId: string) => NAVIDROME_ARTIST_ALBUMS[artistId]
    .slice(0, 5)
    .flatMap(albumId => NAVIDROME_ALBUM_TRACKS[albumId])
    .slice(0, 10)
    .map(naviKey);
const localKey = (index: number) => `local:${localSongId(index)}`;

const mountProbe = async (mount: (id: string) => Promise<unknown>, page: Page, suite: Suite = 'grid') => {
    await mount('libraryBehavior');
    await expect.poll(() => page.evaluate(() => window.__libraryProbe?.ready() ?? false)).toBe(true);
    if (suite !== 'grid') {
        await page.evaluate(id => window.__libraryProbe!.setSuite(id), suite);
    }
};

const openArtist = async (page: Page, id: ArtistFixtureId) => {
    expect(await page.evaluate(fixtureId => window.__libraryProbe!.openArtist(fixtureId), id)).toBe(true);
};
const artist = (page: Page) => page.evaluate(() => window.__libraryProbe!.artist());
const back = (page: Page) => page.evaluate(() => window.__libraryProbe!.back());
const stack = (page: Page) => page.evaluate(() => window.__libraryProbe!.stack());
const topDescriptor = async (page: Page) => (await page.evaluate(() => window.__libraryProbe!.stackDescriptors())).at(-1);
const setQuery = (page: Page, query: string) => page.evaluate(value => window.__libraryProbe!.setQuery(value), query);
const getQuery = (page: Page) => page.evaluate(() => window.__libraryProbe!.getQuery());
const setSuite = (page: Page, suite: Suite) => page.evaluate(id => window.__libraryProbe!.setSuite(id), suite);
const clearLog = (page: Page) => page.evaluate(() => window.__libraryProbe!.clearLog());
const addFault = (page: Page, fault: ProbeFault) => page.evaluate(value => window.__libraryProbe!.addFault(value), fault);
const clearFaults = (page: Page, target?: string) => page.evaluate(value => window.__libraryProbe!.clearFaults(value), target);
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__libraryProbe!.calls().filter(call => call.kind === callKind), kind)
);
const lastCall = async (page: Page, kind: ProbeCallKind) => (await calls(page, kind)).at(-1);
const requests = (page: Page, op: string, target?: string) => page.evaluate(([requestOp, requestTarget]) => (
    window.__libraryProbe!.requests().filter(request => (
        request.op === requestOp && (requestTarget === undefined || request.target === requestTarget)
    ))
), [op, target] as const);
const allRequests = (page: Page) => page.evaluate(() => window.__libraryProbe!.requests());
const distinctAlbumOffsets = async (page: Page, target: string) => (
    [...new Set((await requests(page, 'artistAlbums', target)).map(request => `${request.offset}+${request.limit}`))]
);
const scopeCount = async (page: Page) => (await page.evaluate(() => window.__libraryProbe!.surface()))?.filteredTrackCount ?? -1;
const artistSurface = (page: Page) => page.evaluate(() => window.__libraryProbe!.artistSurface());
const runArtistSurface = (page: Page, action: Parameters<NonNullable<typeof window.__libraryProbe>['runArtistSurface']>[0]) => (
    page.evaluate(value => window.__libraryProbe!.runArtistSurface(value), action)
);
const artistFocus = (page: Page) => page.evaluate(() => window.__libraryProbe!.artistFocus());

/** 等歌手页落定：状态是 ready、专辑数到达期望值。 */
const waitForArtist = async (page: Page, albumCount: number, timeout = 15_000) => {
    await expect.poll(async () => {
        const view = await artist(page);
        return view ? `${view.status}:${view.albumIds.length}` : 'none';
    }, { timeout }).toBe(`ready:${albumCount}`);
};

/** 键盘事件要落在 body 上：两套歌手页的键盘处理都忽略按钮、输入框里的按键。 */
const pressOnPage = async (page: Page, key: string) => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(key);
};

const artistLayer = (page: Page) => page.locator('[data-library-surface="artist"]');
/** 歌手页的画面：网格与 TUI 在 surface 自己里面，bravais 在 stage 里（surface 只渲染不可见的锚点）。 */
const artistScreen = (page: Page, suite: Suite) => (
    suite === 'bravais' ? page.locator('[data-library-stage="bravais"]') : artistLayer(page)
);
/** 切换期间旧层仍在退场：先等它卸载，再对唯一的在场层校验 suite。单元素断言遇到双层会立即抛 strict mode。 */
const waitForSuite = async (page: Page, suite: Suite) => {
    // lazy 的目标层还没揭示时旧层也只有一个；先等目标出现，避免把旧层误当成已经落定。
    await expect(page.locator(`[data-library-surface="artist"][data-library-renderer="${suite}"]`)).toHaveCount(1);
    await expect(artistLayer(page)).toHaveCount(1);
    await expect(artistLayer(page)).toHaveAttribute('data-library-renderer', suite);
};

/** 记下歌手页上是否出现过空态文案（「No content」）：MutationObserver 能看到只存在一帧的状态。 */
const watchEmptyState = (page: Page) => page.evaluate(() => {
    const flag = window as unknown as { __artistEmptySeen?: boolean };
    flag.__artistEmptySeen = false;
    new MutationObserver(() => {
        const screens = [
            document.querySelector('[data-library-surface="artist"]'),
            document.querySelector('[data-library-stage="bravais"]'),
        ];
        if (screens.some(screen => screen?.textContent?.includes('No content'))) {
            flag.__artistEmptySeen = true;
        }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
});
const emptyStateSeen = (page: Page) => page.evaluate(() => Boolean((window as unknown as { __artistEmptySeen?: boolean }).__artistEmptySeen));
const songCard = (page: Page, songId: string) => artistLayer(page).locator(`[data-folia-grid-item-id="${songId}"]`);
/** TUI 的热门歌曲行（条目键 song:<playback key>，与网格写进会话的同一个键）。 */
const tuiSongRow = (page: Page, playbackKey: string) => artistLayer(page).locator(`[data-library-entry="song:${playbackKey}"]`);

/** 一首在线热门歌曲上的歌手 / 专辑链接：网格是卡片上的名字，TUI 是那一行上的按钮。 */
const songLink = (page: Page, suite: Suite, songId: string, name: string): Locator => (
    suite === 'grid'
        ? songCard(page, songId).getByText(name, { exact: true })
        : tuiSongRow(page, onlinePlaybackKey(PROBE_PROVIDER_A, songId)).getByRole('button', { name, exact: true })
);

/** bravais：等墙上的翻牌放完（换层、数据到达、过滤）——翻牌期间聚焦卡会被收起。 */
const waitForBravaisWall = (page: Page) => (
    expect(page.locator('[data-library-stage="bravais"][data-bravais-settling]')).toHaveCount(0)
);

/** bravais：经列表面板定位一项（热门歌曲展开聚焦卡；专辑只聚焦），返回它所在的磁贴。 */
const focusBravaisArtistEntry = async (page: Page, entryKey: string) => {
    const layerKey = await page.locator('[data-library-stage="bravais"]').getAttribute('data-bravais-layer');
    const panel = page.locator(`[data-bravais-list="${layerKey}"]`);
    // 开发版的 suite 浮层盖在缝底部的按钮上：派发点击。
    if (await panel.count() === 0) await page.locator('[data-bravais-seam-action="list"]').dispatchEvent('click');
    await expect(panel).toBeVisible();
    await waitForBravaisWall(page);
    await panel.locator(`[data-bravais-list-row="${entryKey}"]`).click();
    const attribute = entryKey.startsWith('song:') ? 'data-library-entry' : 'data-library-card';
    const tile = page.locator(`.bravais-tile[data-bravais-focused][${attribute}="${entryKey}"]`);
    await expect(tile).toBeVisible();
    return tile;
};

/**
 * 一首在线热门歌曲上的歌手 / 专辑链接，先让它出现：网格与 TUI 本来就在 DOM 里；bravais 经列表面板展开那首的聚焦卡，
 * 链接是卡上的文字按钮。
 */
const revealSongLink = async (page: Page, suite: Suite, songId: string, name: string): Promise<Locator> => {
    if (suite !== 'bravais') return songLink(page, suite, songId, name);
    const entryKey = `song:${onlinePlaybackKey(PROBE_PROVIDER_A, songId)}`;
    await focusBravaisArtistEntry(page, entryKey);
    return page.locator(`[data-bravais-focus-card="${entryKey}"]`).getByRole('button', { name, exact: true });
};

/** 「加入热门歌曲」的条数提示：网格与 TUI 走应用的 toast；bravais 显示在缝底（设计稿 §10.4），不走 toast。 */
const expectTopSongsReport = async (page: Page, suite: Suite, text: string) => {
    if (suite === 'bravais') {
        await expect(page.locator('[data-library-stage="bravais"] [data-bravais-seam-notice]')).toHaveText(text);
        expect(await calls(page, 'toast')).toEqual([]);
        return;
    }
    await expect.poll(async () => (await calls(page, 'toast')).map(call => call.text)).toEqual([text]);
};

/** 显式的返回按钮（= 完成）：网格是页头最左边那个，TUI 是状态栏的 [← Back]，bravais 是缝面包屑行的 ‹。 */
const pressArtistBackButton = async (page: Page, suite: Suite) => {
    if (suite === 'grid') await artistLayer(page).locator('button').first().click();
    else if (suite === 'tui') await artistLayer(page).locator('[data-tui-back]').click();
    else await page.locator('[data-library-stage="bravais"] [data-bravais-seam-action="back"]').click();
};

/**
 * 「播放焦点那首热门歌曲」：网格先把相机从简介卡移到歌曲上，TUI 的焦点一开始就在第一首；bravais 经列表面板展开
 * 第一首的聚焦卡，Enter 立即播放。
 */
const playFocusedTopSong = async (page: Page, suite: Suite) => {
    if (suite === 'bravais') {
        await focusBravaisArtistEntry(page, `song:${topKeys(main)[0]}`);
        await expect(page.locator('.bravais-tile[data-bravais-focused][data-bravais-expanded]')).toHaveCount(1);
        await pressOnPage(page, 'Enter');
        return;
    }
    if (suite === 'grid') {
        await page.waitForTimeout(400);
        await pressOnPage(page, 'ArrowUp');
        await page.waitForTimeout(400);
    }
    await pressOnPage(page, 'Enter');
};

for (const suite of SUITES) {
    test.describe(`[${suite}] online artist`, () => {
        test('loads the detail, the top songs and every album page', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            await waitForSuite(page, suite);

            const view = (await artist(page))!;
            expect(view.detail).toEqual({ name: main.name, cover: main.coverUrl, hasBio: true });
            expect(view.topSongIds).toEqual(topKeys(main));
            expect(view.playableTopSongIds).toEqual(topKeys(main, true));
            expect(view.albumIds).toEqual(artistAlbumIds(main));
            expect(await distinctAlbumOffsets(page, mainTarget)).toEqual(
                range(Math.ceil(main.albumCount / ARTIST_ALBUM_PAGE_SIZE)).map(index => `${index * ARTIST_ALBUM_PAGE_SIZE}+${ARTIST_ALBUM_PAGE_SIZE}`),
            );
            expect((await requests(page, 'artistSongs', mainTarget)).every(request => request.offset === 0 && request.limit === 10)).toBe(true);
            expect(await stack(page)).toEqual([main.name]);
        });

        test('an album page that fails shows a retry that resumes from the failed offset', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await addFault(page, { op: 'artistAlbums', target: mainTarget, offset: ARTIST_ALBUM_PAGE_SIZE, remaining: 99 });
            await openArtist(page, 'artist-main');
            await expect.poll(async () => {
                const view = await artist(page);
                return view ? `${view.status}:${view.albumIds.length}` : 'none';
            }).toBe(`interrupted:${ARTIST_ALBUM_PAGE_SIZE}`);

            await clearFaults(page, mainTarget);
            await clearLog(page);
            await artistScreen(page, suite).getByRole('button', { name: 'Retry' }).click();
            await waitForArtist(page, main.albumCount);
            expect(await distinctAlbumOffsets(page, mainTarget)).toEqual([`${ARTIST_ALBUM_PAGE_SIZE}+50`, `${ARTIST_ALBUM_PAGE_SIZE * 2}+50`]);
            expect((await artist(page))!.albumIds).toEqual(artistAlbumIds(main));
            // 重试只续专辑：详情与热门歌曲不重新请求。
            expect(await requests(page, 'artistDetail')).toEqual([]);
            expect(await requests(page, 'artistSongs')).toEqual([]);
        });

        test('a slow artist that was left never lands in the next one', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await page.evaluate(target => window.__libraryProbe!.setLatency(target, { first: 1500, rest: 1500 }), mainTarget);
            await openArtist(page, 'artist-main');
            await page.waitForTimeout(100);
            await openArtist(page, 'artist-guest');
            await waitForArtist(page, guest.albumCount);

            // 等 A 的应答真的回来（请求在延迟之后才记账），再看 B 有没有被它改写。
            await expect.poll(() => requests(page, 'artistDetail', mainTarget), { timeout: 10_000 }).not.toEqual([]);
            await page.waitForTimeout(500);
            const view = (await artist(page))!;
            expect(view.detail?.name).toBe(guest.name);
            expect(view.topSongIds).toEqual(topKeys(guest));
            expect(view.albumIds).toEqual(artistAlbumIds(guest));
            expect(await stack(page)).toEqual([guest.name]);
            // 离开的歌手不再翻专辑页：它的资源在离开时被暂停，晚到的应答被丢掉，没有续页。
            expect((await requests(page, 'artistAlbums', mainTarget)).filter(request => (request.offset ?? 0) > 0)).toEqual([]);

            // 重开 A：被暂停时首屏还没到，宿主不复用那个资源，从头加载，内容完整且是 A 的。
            await clearLog(page);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount, 30_000);
            const reopened = (await artist(page))!;
            expect(reopened.detail?.name).toBe(main.name);
            expect(reopened.topSongIds).toEqual(topKeys(main));
            expect(reopened.albumIds).toEqual(artistAlbumIds(main));
            expect(await requests(page, 'artistDetail', mainTarget)).not.toEqual([]);
            expect(await distinctAlbumOffsets(page, mainTarget)).toEqual(
                range(Math.ceil(main.albumCount / ARTIST_ALBUM_PAGE_SIZE)).map(index => `${index * ARTIST_ALBUM_PAGE_SIZE}+${ARTIST_ALBUM_PAGE_SIZE}`),
            );
        });

        test('album pages of an artist left for a nested one never land in it', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await page.evaluate(target => window.__libraryProbe!.holdPagesOf(target), mainTarget);
            await openArtist(page, 'artist-main');
            await expect.poll(async () => {
                const view = await artist(page);
                return view ? `${view.status}:${view.albumIds.length}` : 'none';
            }).toBe(`syncing:${ARTIST_ALBUM_PAGE_SIZE}`);

            // 热门歌曲 21 带着客座歌手：点它上面的歌手名压入它的歌手页。
            await (await revealSongLink(page, suite, onlineSongId(main.topSongPrefix, 21), guest.name)).dispatchEvent('click');
            await expect.poll(() => stack(page)).toEqual([main.name, guest.name]);
            expect(await topDescriptor(page)).toEqual({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'artist', id: guest.artistId, name: guest.name });
            await waitForArtist(page, guest.albumCount);

            await page.evaluate(target => window.__libraryProbe!.releasePagesOf(target), mainTarget);
            await page.waitForTimeout(800);
            const view = (await artist(page))!;
            expect(view.detail?.name).toBe(guest.name);
            expect(view.albumIds).toEqual(artistAlbumIds(guest));

            // 返回落回 A：宿主复用 A 的资源（详情已到），不重新请求详情与热门歌曲；离开时被暂停的专辑分页
            // 从停下的那一页（第二页）续上，放行之后晚到的那一页没有被记进去（不重复、不缺）。
            await clearLog(page);
            await back(page);
            await expect.poll(() => stack(page)).toEqual([main.name]);
            await waitForArtist(page, main.albumCount);
            const resumed = (await artist(page))!;
            expect(resumed.detail?.name).toBe(main.name);
            expect(resumed.topSongIds).toEqual(topKeys(main));
            expect(resumed.albumIds).toEqual(artistAlbumIds(main));
            expect(await requests(page, 'artistDetail', mainTarget)).toEqual([]);
            expect(await requests(page, 'artistSongs', mainTarget)).toEqual([]);
            expect(await distinctAlbumOffsets(page, mainTarget)).toEqual(
                range(Math.ceil(main.albumCount / ARTIST_ALBUM_PAGE_SIZE)).slice(1).map(index => `${index * ARTIST_ALBUM_PAGE_SIZE}+${ARTIST_ALBUM_PAGE_SIZE}`),
            );
        });
    });

    test.describe(`[${suite}] Navidrome and local artists`, () => {
        test('a Navidrome artist loads its albums and the first albums\' songs as top songs', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'navi-artist');
            await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);
            const first = (await artist(page))!;
            expect(first.detail).toMatchObject({ name: NAVIDROME_HOME_ARTISTS[0].name });
            expect(first.albumIds).toEqual(NAVIDROME_ARTIST_ALBUMS['navi-ar-1']);
            expect(first.topSongIds).toEqual(naviTopKeys('navi-ar-1'));
            expect(first.albums.every(album => album.link.source === 'navidrome' && album.link.type === 'album')).toBe(true);

            await back(page);
            await expect(artistLayer(page)).toHaveCount(0);
            await openArtist(page, 'navi-artist-2');
            await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-2'].length);
            const second = (await artist(page))!;
            expect(second.detail).toMatchObject({ name: NAVIDROME_HOME_ARTISTS[1].name });
            expect(second.albumIds).toEqual(NAVIDROME_ARTIST_ALBUMS['navi-ar-2']);
            expect(second.topSongIds).toEqual(naviTopKeys('navi-ar-2'));
        });

        test('a local artist loads its own songs and albums from the catalog', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'local-artist');
            await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
            const view = (await artist(page))!;
            expect(view.detail).toMatchObject({ name: LOCAL_ARTIST_NAME, hasBio: true });
            expect(view.albums.map(album => album.name)).toEqual([...LOCAL_ALBUM_NAMES]);
            expect(view.albums.every(album => album.link.source === 'local' && album.link.type === 'album')).toBe(true);
            expect(view.topSongIds).toEqual(range(8, 1).map(localKey));
        });

        // 加载期间不出现空态（本地歌手的同一条在 former defects 里）。
        for (const [id, albums] of [['artist-main', main.albumCount], ['navi-artist', NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length]] as const) {
            test(`${id} never shows the empty state while it loads`, async ({ mount, page }) => {
                await mountProbe(mount, page, suite);
                await watchEmptyState(page);
                await openArtist(page, id);
                await waitForArtist(page, albums);
                expect(await emptyStateSeen(page)).toBe(false);
            });
        }
    });

    test.describe(`[${suite}] filter, play and enqueue`, () => {
        test('the filter narrows the albums by name and leaves the top songs alone', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);

            expect(await setQuery(page, 'cedar')).toBe(true);
            await expect.poll(async () => (await artist(page))?.albumIds).toEqual(artistAlbumIdsMatching(main, 'cedar'));
            const view = (await artist(page))!;
            expect(view.query).toBe('cedar');
            expect(view.topSongIds).toEqual(topKeys(main));
            // 筛选只看专辑名：一个只出现在歌名里的词筛不出专辑，热门歌曲也不受影响。
            expect(await setQuery(page, 'track')).toBe(true);
            await expect.poll(async () => (await artist(page))?.albumIds).toEqual([]);
            expect((await artist(page))!.topSongIds).toEqual(topKeys(main));
            expect(await setQuery(page, artistAlbumName(7))).toBe(true);
            await expect.poll(async () => (await artist(page))?.albumIds).toEqual([`${main.albumPrefix}-7`]);
        });

        test('Enter on a top song plays it with the playable top songs as the queue', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);

            await playFocusedTopSong(page, suite);
            await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
            const played = (await lastCall(page, 'playSong'))!;
            expect(topKeys(main)).toContain(played.ids[0]);
            expect(played.queueIds).toEqual(topKeys(main, true));
        });

        // 正确行为（main 369c34e6：歌手页直接拿应用的 addAllToQueue）：歌手页要求静默，队列不弹自己的提示；
        // 歌手页的提示报的是队列真正收下的条数（队列里已有的不算）。b0bea643 起播放端口的 enqueueAll 丢了
        // { suppressToast: true } 和返回的数量，P4.0 的修复提交把它们接了回来。TUI 状态栏上有同名的按钮。
        test('queueing the top songs asks the queue to stay quiet and reports how many it took', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            const playable = topKeys(main, true);
            await page.evaluate(keys => window.__libraryProbe!.seedQueue(keys), playable.slice(0, 2));
            await clearLog(page);

            await artistScreen(page, suite).getByRole('button', { name: 'Queue top songs' }).click();
            await expect.poll(() => calls(page, 'addAllToQueue')).toHaveLength(1);
            expect(await lastCall(page, 'addAllToQueue')).toMatchObject({ ids: playable, suppressToast: true, accepted: playable.length - 2 });
            await expectTopSongsReport(page, suite, `Added ${playable.length - 2} top songs to the play queue`);
        });
    });

    test.describe(`[${suite}] nested opens`, () => {
        test('an album opens the provider album, and going back returns to the artist', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            const album = (await artist(page))!.albums[3];
            expect(album.link).toEqual({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'album' });

            expect(await page.evaluate(id => window.__libraryProbe!.openArtistAlbum(id), album.id)).toBe(true);
            await expect.poll(() => stack(page)).toEqual([main.name, artistAlbumName(3)]);
            expect(await topDescriptor(page)).toEqual({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'album', id: album.id, name: album.name });
            await expect(artistLayer(page)).toHaveCount(0);
            await expect.poll(() => requests(page, 'albumTracks', `${PROBE_PROVIDER_A}:album:${album.id}`)).not.toEqual([]);

            // 返回歌手页：复用宿主持有的资源，不重新请求。
            await clearLog(page);
            await back(page);
            await expect.poll(() => stack(page)).toEqual([main.name]);
            await waitForArtist(page, main.albumCount);
            expect((await artist(page))!.detail?.name).toBe(main.name);
            expect(await requests(page, 'artistDetail', mainTarget)).toEqual([]);
            expect(await requests(page, 'artistAlbums', mainTarget)).toEqual([]);
        });

        test('a song\'s album link opens that album with its tracks', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);

            await (await revealSongLink(page, suite, onlineSongId(main.topSongPrefix, 22), PROBE_ALBUM.name)).dispatchEvent('click');
            await expect.poll(() => stack(page)).toEqual([main.name, PROBE_ALBUM.name]);
            expect(await topDescriptor(page)).toMatchObject({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'album', id: PROBE_ALBUM.id });
            await expect.poll(() => scopeCount(page)).toBe(PROBE_ALBUM.rawIndexes.length);

            await back(page);
            await waitForArtist(page, main.albumCount);
        });

        test('a Navidrome album opens the Navidrome album', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'navi-artist');
            await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);

            expect(await page.evaluate(() => window.__libraryProbe!.openArtistAlbum('navi-al-3'))).toBe(true);
            await expect.poll(async () => (await topDescriptor(page))?.id).toBe('navi-al-3');
            expect(await topDescriptor(page)).toMatchObject({ source: 'navidrome', type: 'album', id: 'navi-al-3' });
            await expect.poll(() => scopeCount(page)).toBe(NAVIDROME_ALBUM_TRACKS['navi-al-3'].length);

            await back(page);
            await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);
        });

        test('a local album opens the album entity with its songs', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'local-artist');
            await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
            const beta = (await artist(page))!.albums.find(album => album.name === 'Beta Album')!;

            expect(await page.evaluate(id => window.__libraryProbe!.openArtistAlbum(id), beta.id)).toBe(true);
            await expect.poll(() => stack(page)).toEqual([LOCAL_ARTIST_NAME, 'Beta Album']);
            expect(await topDescriptor(page)).toMatchObject({ source: 'local', type: 'album', id: beta.id, entityId: beta.id });
            await expect.poll(() => scopeCount(page)).toBe(4);

            await back(page);
            await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
        });
    });

    // P4.2：歌手页的筛选词与「看到哪一项」在浏览会话里（键是宿主那一层的 collectionKey），动作经 artist surface 发布到
    // 命令面板（core 能力 ∩ suite 声明）。
    test.describe(`[${suite}] artist session and command surface`, () => {
        test('the filter lives in the browse session: an album opened and closed comes back filtered', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            expect(await setQuery(page, 'cedar')).toBe(true);
            const filtered = artistAlbumIdsMatching(main, 'cedar');
            await expect.poll(async () => (await artist(page))?.albumIds).toEqual(filtered);

            expect(await page.evaluate(id => window.__libraryProbe!.openArtistAlbum(id), filtered[0])).toBe(true);
            await expect.poll(() => stack(page)).toHaveLength(2);
            await back(page);
            await expect.poll(() => stack(page)).toEqual([main.name]);
            await expect.poll(async () => (await artist(page))?.albumIds).toEqual(filtered);
            expect((await artist(page))!.query).toBe('cedar');
            await expect.poll(() => getQuery(page)).toBe('cedar');
        });

        test('browser back keeps the session', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            expect(await setQuery(page, 'cedar')).toBe(true);
            await expect.poll(async () => (await artist(page))?.query).toBe('cedar');

            await back(page);
            await expect(artistLayer(page)).toHaveCount(0);
            await openArtist(page, 'artist-main');
            await expect.poll(async () => (await artist(page))?.query).toBe('cedar');
            await expect.poll(async () => (await artist(page))?.albumIds).toEqual(artistAlbumIdsMatching(main, 'cedar'));
        });

        // P4.5：返回按钮 = 完成，由宿主执行（清会话、每套 suite 忘掉布局记录），两套 suite 同一个含义。
        test('the back button clears the session', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            expect(await setQuery(page, 'cedar')).toBe(true);
            await expect.poll(async () => (await artist(page))?.query).toBe('cedar');
            if (suite === 'tui') await pressOnPage(page, 'ArrowDown');

            // 返回按钮（网格：页头最左边那个；TUI：状态栏的 [← Back]）表示看完了：筛选与焦点随会话一起清掉。
            await pressArtistBackButton(page, suite);
            await expect(artistLayer(page)).toHaveCount(0);
            expect(await page.evaluate(key => window.__libraryProbe!.browseSession(key), mainSessionKey)).toBeNull();
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            expect((await artist(page))!.query).toBe('');
            expect((await artist(page))!.albumIds).toEqual(artistAlbumIds(main));
        });

        // Escape 阶梯的最后一步是「离开但保留」：会话里的焦点还在，回来时回到那一项（筛选在阶梯里先被撤掉）。
        test('Escape keeps the session', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            await playFocusedTopSong(page, suite);
            await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
            const focusedSong = (await lastCall(page, 'playSong'))!.ids[0];
            expect(await artistFocus(page)).toBe(`song:${focusedSong}`);

            // bravais 的 Esc 是逐级的阶梯（聚焦卡 → 键盘焦点 → 列表面板 → 返回），每按一次只处理一级。
            for (let press = 0; press < (suite === 'bravais' ? 6 : 1) && (await stack(page)).length > 0; press += 1) {
                await pressOnPage(page, 'Escape');
                if (suite === 'bravais') await page.waitForTimeout(150);
            }
            await expect.poll(() => stack(page)).toEqual([]);
            await expect(artistLayer(page)).toHaveCount(0);
            expect((await page.evaluate(key => window.__libraryProbe!.browseSession(key), mainSessionKey))?.focusedEntryKey)
                .toBe(`song:${focusedSong}`);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            expect(await artistFocus(page)).toBe(`song:${focusedSong}`);
        });

        test('the command surface publishes the top-song actions; queueing reports the accepted count', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'artist-main');
            await waitForArtist(page, main.albumCount);
            const playable = topKeys(main, true);
            // 随机播放热门歌曲只有 grid / bravais 声明（TUI 已冻结）。
            const shuffles = suite !== 'tui';
            await expect.poll(async () => (await artistSurface(page))?.availableActions)
                .toEqual(shuffles ? ['play-top-songs', 'shuffle-top-songs', 'enqueue-top-songs', 'reload'] : ['play-top-songs', 'enqueue-top-songs', 'reload']);
            expect(await artistSurface(page)).toMatchObject({ playableTopSongCount: playable.length, albumCount: main.albumCount, isFilterActive: false });

            await clearLog(page);
            expect(await runArtistSurface(page, 'play-top-songs')).toBe(true);
            await expect.poll(() => calls(page, 'playAll')).toHaveLength(1);
            expect((await lastCall(page, 'playAll'))?.ids).toEqual(playable);
            expect((await lastCall(page, 'playAll'))?.shuffle).toBeUndefined();
            if (shuffles) {
                await clearLog(page);
                expect(await runArtistSurface(page, 'shuffle-top-songs')).toBe(true);
                await expect.poll(() => calls(page, 'playAll')).toHaveLength(1);
                expect(await lastCall(page, 'playAll')).toMatchObject({ ids: playable, shuffle: true });
            }

            await page.evaluate(keys => window.__libraryProbe!.seedQueue(keys), playable.slice(0, 3));
            await clearLog(page);
            expect(await runArtistSurface(page, 'enqueue-top-songs')).toBe(true);
            await expect.poll(() => calls(page, 'addAllToQueue')).toHaveLength(1);
            expect(await lastCall(page, 'addAllToQueue')).toMatchObject({ ids: playable, suppressToast: true, accepted: playable.length - 3 });
            await expectTopSongsReport(page, suite, `Added ${playable.length - 3} top songs to the play queue`);
            // 不在 availableActions 里的动作被拒绝（在线歌手没有实体可编辑）。
            expect(await runArtistSurface(page, 'edit-entity')).toBe(false);

            await back(page);
            await expect.poll(() => artistSurface(page)).toBeNull();
        });

        test('a local artist publishes entity editing (not reload), and running it opens the host dialog', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'local-artist');
            await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
            await expect.poll(async () => (await artistSurface(page))?.availableActions).toEqual(suite === 'tui'
                ? ['play-top-songs', 'enqueue-top-songs', 'edit-entity']
                : ['play-top-songs', 'shuffle-top-songs', 'enqueue-top-songs', 'edit-entity']);
            expect(await runArtistSurface(page, 'edit-entity')).toBe(true);
            await expect(page.getByRole('dialog')).toBeVisible();
        });

        test('a failed album page publishes the album retry, and running it resumes from the failed offset', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await addFault(page, { op: 'artistAlbums', target: mainTarget, offset: ARTIST_ALBUM_PAGE_SIZE, remaining: 99 });
            await openArtist(page, 'artist-main');
            await expect.poll(async () => (await artistSurface(page))?.availableActions ?? []).toContain('retry-albums');
            await clearFaults(page, mainTarget);
            await clearLog(page);
            expect(await runArtistSurface(page, 'retry-albums')).toBe(true);
            await waitForArtist(page, main.albumCount);
            expect(await distinctAlbumOffsets(page, mainTarget)).toEqual([`${ARTIST_ALBUM_PAGE_SIZE}+50`, `${ARTIST_ALBUM_PAGE_SIZE * 2}+50`]);
            expect((await artistSurface(page))?.availableActions).not.toContain('retry-albums');
        });
    });

    // P4.0 记下的已知缺陷（P4 现状速记），P4.1 的 core 歌手资源修掉之后转正。
    test.describe(`[${suite}] former artist page defects`, () => {
        // 原先 ArtistGridView 的 Navidrome 分支在 getArtist 回来之后直接 setArtistInfo，没有比对 generation：
        // 同一个歌手页重新加载时，先发出、晚回来的那次会把旧的详情写回来。P4.0 靠本地曲库刷新让歌手页自己的 catalog
        // 重载来触发重新加载；P4.1 起歌手页不再自带 catalog（Navidrome 歌手也不随本地曲库重载），改用资源的 reload
        // （错误态「重试」的同一个入口）。资源每次加载领一张票，被取代的加载不写快照。
        test('a late Navidrome artist response from a superseded load does not overwrite the current detail', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await openArtist(page, 'navi-artist');
            await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);
            const renamed = 'Navi Artist Renamed';

            await page.evaluate(() => window.__libraryProbe!.holdNavidrome('getArtist'));
            await clearLog(page);
            // 第一次重载：请求按改名前的上游生成，被按住。
            expect(await page.evaluate(() => window.__libraryProbe!.reloadArtist())).toBe(true);
            await expect.poll(() => page.evaluate(() => window.__libraryProbe!.heldNavidrome('getArtist'))).toBeGreaterThan(0);
            const staleCount = await page.evaluate(() => window.__libraryProbe!.heldNavidrome('getArtist'));
            // 上游改名，第二次重载：它的应答先放行。
            await page.evaluate(name => window.__libraryProbe!.renameNavidromeArtist('navi-ar-1', name), renamed);
            expect(await page.evaluate(() => window.__libraryProbe!.reloadArtist())).toBe(true);
            await expect.poll(() => page.evaluate(() => window.__libraryProbe!.heldNavidrome('getArtist'))).toBeGreaterThan(staleCount);
            await page.evaluate(() => window.__libraryProbe!.releaseNavidrome('getArtist', 'newest'));
            await expect.poll(async () => (await artist(page))?.detail?.name).toBe(renamed);
            await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);

            // 先发出的那次晚到。
            await page.evaluate(() => window.__libraryProbe!.releaseNavidrome('getArtist', 'all'));
            await page.waitForTimeout(500);
            expect((await artist(page))?.detail?.name).toBe(renamed);
        });

        // 原先本地歌手页用自己的 catalog 实例，catalog 就绪之前那次加载直接返回，页面先显示空态（「No content」），
        // 就绪后才出内容。P4.1 起本地歌手由宿主的 catalog 派生，未就绪时资源保持 loading（单测覆盖未就绪的分支）。
        test('a local artist never shows the empty state while its catalog is still loading', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await watchEmptyState(page);
            await openArtist(page, 'local-artist');
            await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
            expect(await emptyStateSeen(page)).toBe(false);
        });

        // 原先详情请求失败时只打 console，页面落到空态（「No content」，即 home.loadingLibrary），没有错误态，也没有重试。
        // P4.1 起资源记为 error：页面显示集合页同一句失败文案与一个「重试」，从头重新加载（TUI 同一句、同一个入口）。
        test('a failed artist load shows an error state with a retry instead of the empty text', async ({ mount, page }) => {
            await mountProbe(mount, page, suite);
            await addFault(page, { op: 'artistDetail', target: mainTarget, remaining: 99 });
            await openArtist(page, 'artist-main');
            await expect.poll(async () => (await artist(page))?.status, { timeout: 10_000 }).toBe('error');
            await expect(artistScreen(page, suite).getByText('No content')).toHaveCount(0);
            await expect(artistScreen(page, suite).getByText(`Failed to load: ${main.name}`)).toBeVisible();
            await expect(artistScreen(page, suite).getByRole('button', { name: 'Retry' })).toBeVisible();

            // 故障清掉之后重试：完整加载。
            await clearFaults(page, mainTarget);
            await artistScreen(page, suite).getByRole('button', { name: 'Retry' }).click();
            await waitForArtist(page, main.albumCount);
            expect((await artist(page))!.detail?.name).toBe(main.name);
        });
    });

    // 守住探针本身：artist() 读到的是在场的那一层（退场中的歌手页不算）。
    test(`[${suite}] the artist view follows the top of the stack`, async ({ mount, page }) => {
        await mountProbe(mount, page, suite);
        expect(await artist(page)).toBeNull();
        await openArtist(page, 'artist-guest');
        await waitForArtist(page, guest.albumCount);
        expect((await artist(page))!.name).toBe(guest.name);
        await back(page);
        await expect.poll(() => artist(page)).toBeNull();
        expect(await requests(page, 'artistDetail', guestTarget)).not.toEqual([]);
    });
}

// B8：bravais 歌手页自己的墙（设计稿 §10.4）。都经语义标记驱动：磁贴的 data-bravais-slot / data-library-entry（热门歌曲）
// / data-library-card（专辑）、列表面板的 data-bravais-list-row、缝的 data-bravais-seam-action，stage 的 data-bravais-layer
// 与翻牌期间的 data-bravais-settling。
test.describe('[bravais-only] artist page wall', () => {
    const stageRoot = (page: Page) => page.locator('[data-library-stage="bravais"]');
    const layerKey = (page: Page) => stageRoot(page).getAttribute('data-bravais-layer');
    const artistAnchor = (page: Page) => page.locator('[data-library-surface="artist"][data-library-renderer="bravais"]');
    /** 墙上此刻有内容的磁贴：slot → 条目键（热门歌曲是 data-library-entry，专辑是 data-library-card）。 */
    const wallContent = (page: Page) => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.bravais-tile')]
            .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryEntry ?? tile.dataset.libraryCard ?? ''])
            .filter(([, entry]) => entry),
    ));
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
    /** 等墙落定：翻牌放完，再多等一拍（落定后不该再有数据更新的翻牌）。 */
    const settle = async (page: Page) => {
        await waitForBravaisWall(page);
        await page.waitForTimeout(500);
        await waitForBravaisWall(page);
    };
    const openMain = async (mount: (id: string) => Promise<unknown>, page: Page) => {
        await mountProbe(mount, page, 'bravais');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        await waitForSuite(page, 'bravais');
        await settle(page);
    };
    const songEntry = (index: number) => `song:${onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(main.topSongPrefix, index))}`;
    const albumTrackEntry = (index: number) => `${onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(PROBE_ALBUM.prefix, index))}-0`;

    test('top songs come first and albums after them; the filter narrows only the albums into a finite tiling', async ({ mount, page }) => {
        await openMain(mount, page);
        await expect(artistAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
        // 列表面板按墙上的顺序：热门歌曲在前，专辑在后。
        await page.locator('[data-bravais-seam-action="list"]').dispatchEvent('click');
        const rows = page.locator('[data-bravais-list-row]');
        await expect(rows.first()).toHaveAttribute('data-bravais-list-row', `song:${topKeys(main)[0]}`);
        // 虚拟列表的行是面板翻进来、量完高度之后才补齐的（从海报翻成面板时相机同时在让位）：等它补齐再读。
        const firstRows = () => rows.evaluateAll(elements => elements.slice(0, 12).map(element => element.getAttribute('data-bravais-list-row')));
        await expect.poll(async () => (await firstRows()).slice(0, 10)).toEqual(topKeys(main).map(key => `song:${key}`));
        expect((await firstRows()).slice(10).every(key => key?.startsWith('album:'))).toBe(true);
        // 无限拼贴：Home 落在起点磁贴，它是第 1 首热门歌曲。
        await pressOnPage(page, 'Home');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-entry', `song:${topKeys(main)[0]}`);

        expect(await setQuery(page, 'cedar')).toBe(true);
        await expect(artistAnchor(page)).toHaveAttribute('data-bravais-mode', 'finite');
        const filtered = artistAlbumIdsMatching(main, 'cedar');
        await expect.poll(async () => (await artist(page))?.albumIds).toEqual(filtered);
        // 缝里的过滤位显示过滤词（Home / End 让相机移动之前看：缝可能随墙移出屏幕而收起）。
        await expect(stageRoot(page).locator('[data-bravais-seam-filter="active"]')).toBeVisible();
        // 列表面板只列匹配的专辑（虚拟列表，只看前几行）：热门歌曲仍在前面。
        await expect.poll(() => rows.evaluateAll(elements => elements.slice(0, 11).map(element => element.getAttribute('data-bravais-list-row'))))
            .toEqual([...topKeys(main).map(key => `song:${key}`), `album:${filtered[0]}`]);
        await settle(page);
        // 有限拼贴：rank 0 是第 1 首热门歌曲（离缝最近），最后一项是最后一张匹配的专辑；热门歌曲全在。
        await pressOnPage(page, 'Home');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-entry', `song:${topKeys(main)[0]}`);
        await pressOnPage(page, 'End');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-card', `album:${filtered.at(-1)}`);
        expect((await artist(page))!.topSongIds).toEqual(topKeys(main));
    });

    test('typing on the artist wall filters the albums through the seam input; the words are the browse session query', async ({ mount, page }) => {
        await openMain(mount, page);
        await clearLog(page);
        const before = await page.evaluate(() => window.__libraryProbe!.requests().length);
        // 墙上直接打字：进缝里的过滤输入位（占位照实说「过滤专辑」：歌手页只筛专辑名）。
        await pressOnPage(page, 'c');
        const input = stageRoot(page).locator('[data-bravais-filter-input]');
        await expect(input).toBeFocused();
        await expect(input).toHaveAttribute('placeholder', 'Filter albums');
        await page.keyboard.type('edar');
        await expect(input).toHaveValue('cedar');
        expect(await getQuery(page)).toBe('cedar');
        await expect(artistAnchor(page)).toHaveAttribute('data-bravais-mode', 'finite');
        await expect.poll(async () => (await artist(page))?.albumIds).toEqual(artistAlbumIdsMatching(main, 'cedar'));
        expect((await artist(page))!.topSongIds).toEqual(topKeys(main));
        // 过滤不发请求：只收窄墙上已有的专辑。
        expect(await page.evaluate(() => window.__libraryProbe!.requests().length)).toBe(before);
        // Esc：先清空（翻回无限拼贴），再结束输入。
        await page.keyboard.press('Escape');
        await expect(artistAnchor(page)).toHaveAttribute('data-bravais-mode', 'infinite');
        await page.keyboard.press('Escape');
        await expect(input).not.toBeFocused();
    });

    test('a new album page only fills slots that were empty: tiles already showing something keep it', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await page.evaluate(target => window.__libraryProbe!.holdPagesOf(target), mainTarget);
        await openArtist(page, 'artist-main');
        await expect.poll(async () => {
            const view = await artist(page);
            return view ? `${view.status}:${view.albumIds.length}` : 'none';
        }).toBe(`syncing:${ARTIST_ALBUM_PAGE_SIZE}`);
        await settle(page);
        // 分页中：元数据行显示已到 / 总数。
        await expect(stageRoot(page).locator('[data-bravais-sync="syncing"]')).toContainText(`${ARTIST_ALBUM_PAGE_SIZE} / ${main.albumCount}`);
        const before = await wallContent(page);
        expect(Object.keys(before).length).toBeGreaterThan(0);

        await page.evaluate(target => window.__libraryProbe!.releasePagesOf(target), mainTarget);
        await waitForArtist(page, main.albumCount);
        await settle(page);
        const after = await wallContent(page);
        for (const [slot, entry] of Object.entries(before)) {
            if (slot in after) expect(after[slot], slot).toBe(entry);
        }
        // 确实有空着的 slot 被新页填上了。
        expect(Object.keys(after).filter(slot => !(slot in before)).length).toBeGreaterThan(0);
        await expect(stageRoot(page).locator('[data-bravais-sync]')).toHaveCount(0);
    });

    test('clicking an album tile opens it with that tile as the start tile; back flips once and restores the wall', async ({ mount, page }) => {
        // Navidrome 歌手：它的专辑有曲目，起点磁贴能看出是专辑的第 1 首。
        await mountProbe(mount, page, 'bravais');
        await openArtist(page, 'navi-artist');
        await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);
        await settle(page);
        const naviLayer = (await layerKey(page))!;
        const before = await wallContent(page);
        const albumId = 'navi-al-3';
        const tile = await focusBravaisArtistEntry(page, `album:${albumId}`);
        const slot = (await tile.getAttribute('data-bravais-slot'))!;
        await settle(page);

        await watchStage(page);
        await page.locator(`.bravais-tile[data-bravais-slot="${slot}"] article`).dispatchEvent('click');
        await expect.poll(async () => (await topDescriptor(page))?.id).toBe(albumId);
        await expect.poll(() => layerKey(page)).not.toBe(naviLayer);
        await expect.poll(() => scopeCount(page)).toBe(NAVIDROME_ALBUM_TRACKS[albumId].length);
        await settle(page);
        expect((await stageWatch(page)).flips).toBe(1);
        // 起点磁贴：被点的那张原地成为专辑的第 1 首（Home 回到起点磁贴，落在同一个 slot 上）。
        await expect.poll(async () => (await wallContent(page))[slot]).toMatch(/-0$/);
        await pressOnPage(page, 'Home');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-bravais-slot', slot);

        await watchStage(page);
        await back(page);
        await expect.poll(() => layerKey(page)).toBe(naviLayer);
        await waitForArtist(page, NAVIDROME_ARTIST_ALBUMS['navi-ar-1'].length);
        await settle(page);
        const watch = await stageWatch(page);
        expect(watch.layers).toEqual([naviLayer]);
        expect(watch.flips).toBe(1);
        // 墙回到离开时的样子（相机、起点都从布局记忆恢复）。
        const after = await wallContent(page);
        for (const [key, entry] of Object.entries(before)) {
            if (key in after) expect(after[key], key).toBe(entry);
        }
    });

    test('artist ↔ album: push flips once from the clicked tile; back and the folded round trip both flip once in reverse', async ({ mount, page }) => {
        await openMain(mount, page);
        const artistWall = await wallContent(page);
        const songLink22 = () => revealSongLink(page, 'bravais', onlineSongId(main.topSongPrefix, 22), PROBE_ALBUM.name);
        /** 歌手（bravais）→ 专辑（热门歌曲聚焦卡上的专辑链接，bravais）。 */
        const openAlbum = async () => {
            await (await songLink22()).dispatchEvent('click');
            await expect.poll(() => stack(page)).toEqual([main.name, PROBE_ALBUM.name]);
            await expect.poll(() => layerKey(page)).not.toBe(mainSessionKey);
            await expect.poll(() => scopeCount(page)).toBe(PROBE_ALBUM.rawIndexes.length);
            await settle(page);
            return (await layerKey(page))!;
        };
        const expectArtistBack = async () => {
            await expect.poll(() => stack(page)).toEqual([main.name]);
            await expect.poll(() => layerKey(page)).toBe(mainSessionKey);
            await waitForArtist(page, main.albumCount);
            await settle(page);
            const after = await wallContent(page);
            for (const [key, entry] of Object.entries(artistWall)) {
                if (key in after) expect(after[key], key).toBe(entry);
            }
            return stageWatch(page);
        };

        await watchStage(page);
        const album = await openAlbum();
        expect(await stageWatch(page)).toEqual({ flips: 1, layers: [album] });

        // 参照：专辑上普通返回一次。
        await watchStage(page);
        await back(page);
        const backWatch = await expectArtistBack();
        expect(backWatch).toEqual({ flips: 1, layers: [mainSessionKey] });

        // 专辑上点曲目的歌手（正好是上一层）：N1 折成一次返回，与上面的返回一样——反向翻一次，不按 push 翻。
        await openAlbum();
        await page.locator('[data-bravais-seam-action="list"]').dispatchEvent('click');
        await page.locator(`[data-bravais-list-row="${albumTrackEntry(1)}"]`).click();
        const card = page.locator(`[data-bravais-focus-card="${albumTrackEntry(1)}"]`);
        await expect(card).toBeVisible();
        await settle(page);
        await watchStage(page);
        await card.getByRole('button', { name: main.name, exact: true }).dispatchEvent('click');
        const foldWatch = await expectArtistBack();
        expect(foldWatch).toEqual(backWatch);
        expect(await stack(page)).toEqual([main.name]);
    });

    test('album ↔ artist: the artist page folds back into the album below it with one reverse flip', async ({ mount, page }) => {
        // 歌单（根）→ 专辑（曲目聚焦卡上的专辑链接）→ 歌手（专辑曲目上的歌手链接）→ 热门歌曲上点这张专辑（正好是上一层）。
        await mountProbe(mount, page, 'bravais');
        await page.evaluate(() => window.__libraryProbe!.open('online-public'));
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        await settle(page);
        const publicEntry = `${onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId('public', 1))}-0`;
        await page.locator('[data-bravais-seam-action="list"]').dispatchEvent('click');
        await page.locator(`[data-bravais-list-row="${publicEntry}"]`).click();
        await page.locator(`[data-bravais-focus-card="${publicEntry}"]`).getByRole('button', { name: PROBE_ALBUM.name, exact: true }).dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
        await expect.poll(() => scopeCount(page)).toBe(PROBE_ALBUM.rawIndexes.length);
        await settle(page);
        const album = (await layerKey(page))!;
        const albumWall = await wallContent(page);

        // 专辑 → 歌手：push 翻一次，换到 bravais 的歌手页（不再回退 grid）。
        await page.locator('[data-bravais-seam-action="list"]').dispatchEvent('click');
        await page.locator(`[data-bravais-list-row="${albumTrackEntry(1)}"]`).click();
        await expect(page.locator(`[data-bravais-focus-card="${albumTrackEntry(1)}"]`)).toBeVisible();
        await settle(page);
        await watchStage(page);
        await page.locator(`[data-bravais-focus-card="${albumTrackEntry(1)}"]`)
            .getByRole('button', { name: main.name, exact: true }).dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name, main.name]);
        await expect(artistAnchor(page)).toHaveCount(1);
        await waitForArtist(page, main.albumCount);
        await settle(page);
        expect(await stageWatch(page)).toEqual({ flips: 1, layers: [mainSessionKey] });

        // 歌手页上点这张专辑：折成一次返回——换回专辑那一层、反向翻一次，墙回到离开专辑时的布局。
        const link = await revealSongLink(page, 'bravais', onlineSongId(main.topSongPrefix, 22), PROBE_ALBUM.name);
        await settle(page);
        await watchStage(page);
        await link.dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist', PROBE_ALBUM.name]);
        await expect.poll(() => layerKey(page)).toBe(album);
        await expect.poll(() => scopeCount(page)).toBe(PROBE_ALBUM.rawIndexes.length);
        await settle(page);
        expect(await stageWatch(page)).toEqual({ flips: 1, layers: [album] });
        const after = await wallContent(page);
        for (const [key, entry] of Object.entries(albumWall)) {
            if (key in after) expect(after[key], key).toBe(entry);
        }
    });

    test('the seam carries the artist info, and a local artist edits its entity from "More"', async ({ mount, page }) => {
        await mountProbe(mount, page, 'bravais');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        // 完整等级的歌手页是海报（BravaisSeamPoster）：名字是缝的标题，定妆照垫底，简介与统计是「关于艺术家」。
        await expect(stageRoot(page).locator('[data-bravais-seam="poster"] [data-bravais-poster]')).toHaveCount(1);
        await expect(stageRoot(page).locator('[data-bravais-seam-title]')).toHaveText(main.name);
        await expect(stageRoot(page).locator('[data-bravais-artist-bio]')).toHaveText(main.description);
        await expect(stageRoot(page).locator('[data-bravais-poster-portrait] img')).toHaveCount(1);
        // 统计只有一行（详情的歌曲数 · 专辑数），是「关于艺术家」的附注；元数据行不再重复它，也没有「N 首热门」。
        const stats = `${main.topSongIndexes.length} songs · ${main.albumCount} albums`;
        await expect(stageRoot(page).locator('[data-bravais-artist-stats]')).toHaveText(stats);
        await expect(stageRoot(page).locator('[data-bravais-poster] .bravais-poster-meta')).toHaveCount(0);
        await expect(stageRoot(page).locator('[data-bravais-poster]')).not.toContainText('top songs ·');
        // 在线歌手没有实体可编辑：「⋯ 更多」里只有重新拉取。
        await stageRoot(page).locator('[data-bravais-seam-action="more"]').dispatchEvent('click');
        await expect(stageRoot(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="reload"]')).toBeVisible();
        await expect(stageRoot(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="edit-entity"]')).toHaveCount(0);
        await back(page);
        await expect(artistLayer(page)).toHaveCount(0);

        await openArtist(page, 'local-artist');
        await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
        await expect(stageRoot(page).locator('[data-bravais-seam-title]')).toHaveText(LOCAL_ARTIST_NAME);
        // 「⋯ 更多」的展开状态留在缝里：已经开着就不再点（点一下会收起）。
        const more = stageRoot(page).locator('[data-bravais-seam-action="more"]');
        if (await more.getAttribute('aria-expanded') !== 'true') await more.dispatchEvent('click');
        await expect(stageRoot(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="edit-entity"]')).toBeVisible();
        await expect(stageRoot(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="reload"]')).toHaveCount(0);
        await stageRoot(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="edit-entity"]').dispatchEvent('click');
        await expect(page.getByRole('dialog')).toBeVisible();
    });
});

test.describe('[grid-only] song cards and panels', () => {
    test('a song card\'s play button plays with the playable top songs; its queue button enqueues through the port', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        const songId = onlineSongId(main.topSongPrefix, 22);

        await songCard(page, songId).getByTitle('Play', { exact: true }).dispatchEvent('click');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        expect(await lastCall(page, 'playSong')).toMatchObject({
            ids: [onlinePlaybackKey(PROBE_PROVIDER_A, songId)],
            queueIds: topKeys(main, true),
        });

        await songCard(page, songId).getByTitle('Add to Queue', { exact: true }).dispatchEvent('click');
        await expect.poll(() => calls(page, 'addSongToQueue')).toHaveLength(1);
        expect((await lastCall(page, 'addSongToQueue'))?.ids).toEqual([onlinePlaybackKey(PROBE_PROVIDER_A, songId)]);
    });

    test('editing a local artist opens the host entity dialog', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'local-artist');
        await waitForArtist(page, LOCAL_ALBUM_NAMES.length);

        expect(await page.evaluate(() => window.__libraryProbe!.openArtistPanel('cut-in'))).toBe(true);
        await expect.poll(async () => (await artist(page))?.panels.cutIn).toBe(true);
        await artistLayer(page).getByRole('button', { name: 'Artist Info' }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect.poll(async () => (await artist(page))?.panels.cutIn).toBe(false);
    });

    test('an online artist offers no entity editing', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        expect(await page.evaluate(() => window.__libraryProbe!.openArtistPanel('cut-in'))).toBe(true);
        await expect.poll(async () => (await artist(page))?.panels.cutIn).toBe(true);
        await expect(artistLayer(page).getByRole('button', { name: 'Artist Info' })).toHaveCount(0);
    });

    test('Escape clears the filter, then closes the album list, then the info panel, then leaves', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        expect(await setQuery(page, 'cedar')).toBe(true);
        await expect.poll(async () => (await artist(page))?.albumIds.length).toBe(artistAlbumIdsMatching(main, 'cedar').length);
        expect(await page.evaluate(() => window.__libraryProbe!.openArtistPanel('side'))).toBe(true);
        await expect.poll(async () => (await artist(page))?.panels.sidePanel).toBe(true);

        await pressOnPage(page, 'Escape');
        await expect.poll(() => getQuery(page)).toBe('');
        expect((await artist(page))!.panels.sidePanel).toBe(true);

        await pressOnPage(page, 'Escape');
        await expect.poll(async () => (await artist(page))?.panels.sidePanel).toBe(false);

        expect(await page.evaluate(() => window.__libraryProbe!.openArtistPanel('cut-in'))).toBe(true);
        await expect.poll(async () => (await artist(page))?.panels.cutIn).toBe(true);
        await pressOnPage(page, 'Escape');
        await expect.poll(async () => (await artist(page))?.panels.cutIn).toBe(false);
        expect(await stack(page)).toEqual([main.name]);

        await pressOnPage(page, 'Escape');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(artistLayer(page)).toHaveCount(0);
    });

});

// TUI 的歌手页（P4.3）：只用不可打印键——Tab 切热门歌曲 / 专辑两栏，Enter 播放 / 打开，Shift+Enter 入队焦点歌曲，
// Ctrl+Enter 播放全部热门歌曲，Ctrl+Shift+Enter 加入热门歌曲；Esc：收起简介 → 撤掉筛选 → 离开。
test.describe('[tui-only] artist page keys and header', () => {
    test('Shift+Enter queues the focused song, Ctrl+Enter plays every playable top song, Ctrl+Shift+Enter queues them quietly', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        const playable = topKeys(main, true);
        await expect(tuiSongRow(page, topKeys(main)[0])).toHaveAttribute('aria-selected', 'true');

        await pressOnPage(page, 'ArrowDown');
        await expect(tuiSongRow(page, topKeys(main)[1])).toHaveAttribute('aria-selected', 'true');
        await pressOnPage(page, 'Shift+Enter');
        await expect.poll(() => calls(page, 'addSongToQueue')).toHaveLength(1);
        expect((await lastCall(page, 'addSongToQueue'))?.ids).toEqual([topKeys(main)[1]]);

        await pressOnPage(page, 'Control+Enter');
        await expect.poll(() => calls(page, 'playAll')).toHaveLength(1);
        expect((await lastCall(page, 'playAll'))?.ids).toEqual(playable);

        await page.evaluate(keys => window.__libraryProbe!.seedQueue(keys), playable.slice(0, 4));
        await clearLog(page);
        await pressOnPage(page, 'Control+Shift+Enter');
        await expect.poll(() => calls(page, 'addAllToQueue')).toHaveLength(1);
        expect(await lastCall(page, 'addAllToQueue')).toMatchObject({ ids: playable, suppressToast: true, accepted: playable.length - 4 });
        await expect.poll(async () => (await calls(page, 'toast')).map(call => call.text)).toEqual([
            `Added ${playable.length - 4} top songs to the play queue`,
        ]);
    });

    test('Tab moves to the albums, Enter opens the focused album, and going back restores the focus', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);

        await pressOnPage(page, 'Tab');
        await expect(artistLayer(page).locator('[data-tui-pane="albums"]')).toHaveAttribute('aria-current', 'true');
        await pressOnPage(page, 'ArrowDown');
        await pressOnPage(page, 'ArrowDown');
        const albumId = `${main.albumPrefix}-2`;
        await expect(artistLayer(page).locator(`[data-library-entry="album:${albumId}"]`)).toHaveAttribute('aria-selected', 'true');
        await pressOnPage(page, 'Enter');
        await expect.poll(() => stack(page)).toEqual([main.name, artistAlbumName(2)]);
        expect(await topDescriptor(page)).toEqual({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'album', id: albumId, name: artistAlbumName(2) });

        // 压栈前写回了会话：返回时 TUI 按条目键回到这张专辑，焦点仍在专辑栏。
        await back(page);
        await waitForArtist(page, main.albumCount);
        expect(await artistFocus(page)).toBe(`album:${albumId}`);
        await expect(artistLayer(page).locator(`[data-library-entry="album:${albumId}"]`)).toHaveAttribute('aria-selected', 'true');
        await expect(artistLayer(page).locator('[data-tui-pane="albums"]')).toHaveAttribute('aria-current', 'true');
    });

    // P4.4：与集合视图同一组键。歌曲栏里 Alt+Enter 打开焦点歌曲的专辑；Alt+Shift+Enter 打开它的第一个歌手——
    // 这里每首都是本歌手的歌，打开的就是当前这一层，宿主不再压栈。
    test("Alt+Enter opens the focused song's album; Alt+Shift+Enter on this artist's own song stays put", async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        await pressOnPage(page, 'ArrowDown');
        await pressOnPage(page, 'ArrowDown');
        await expect(tuiSongRow(page, topKeys(main)[2])).toHaveAttribute('aria-selected', 'true');
        await expect(artistLayer(page).locator('footer')).toContainText('Alt+Enter album');

        await pressOnPage(page, 'Alt+Shift+Enter');
        await page.waitForTimeout(300);
        expect(await stack(page)).toEqual([main.name]);

        await pressOnPage(page, 'Alt+Enter');
        await expect.poll(() => stack(page)).toEqual([main.name, PROBE_ALBUM.name]);
        expect(await topDescriptor(page)).toMatchObject({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'album', id: PROBE_ALBUM.id });
        await back(page);
        await waitForArtist(page, main.albumCount);
        await expect(tuiSongRow(page, topKeys(main)[2])).toHaveAttribute('aria-selected', 'true');
    });

    test('Escape collapses the biography, then clears the filter, then leaves', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        await artistLayer(page).locator('[data-tui-bio-toggle]').click();
        await expect(artistLayer(page).locator('[data-tui-bio]')).toHaveAttribute('data-tui-bio', 'expanded');
        expect(await setQuery(page, 'cedar')).toBe(true);
        await expect.poll(async () => (await artist(page))?.albumIds).toEqual(artistAlbumIdsMatching(main, 'cedar'));

        await pressOnPage(page, 'Escape');
        await expect(artistLayer(page).locator('[data-tui-bio]')).toHaveAttribute('data-tui-bio', 'collapsed');
        expect(await getQuery(page)).toBe('cedar');
        await pressOnPage(page, 'Escape');
        await expect.poll(() => getQuery(page)).toBe('');
        expect(await stack(page)).toEqual([main.name]);
        await pressOnPage(page, 'Escape');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(artistLayer(page)).toHaveCount(0);
    });

    test('the header offers editing only for a local artist, above the TUI', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        await expect(artistLayer(page).locator('[data-tui-action="edit-entity"]')).toHaveCount(0);
        await expect(artistLayer(page).locator('[data-tui-action="reload"]')).toBeEnabled();
        await back(page);
        await expect(artistLayer(page)).toHaveCount(0);

        await openArtist(page, 'local-artist');
        await waitForArtist(page, LOCAL_ALBUM_NAMES.length);
        await expect(artistLayer(page).locator('[data-tui-action="reload"]')).toHaveCount(0);
        await artistLayer(page).locator('[data-tui-action="edit-entity"]').click();
        await expect(page.getByRole('dialog')).toBeVisible();
    });
});

// 换 suite：歌手资源由宿主持有，两套订阅同一个；筛选词与焦点在浏览会话里，所以换过去都还在，而且不发任何新请求。
test.describe('[switch] artist page between suites', () => {
    test('the grid exits when switching just as a filtered album action enters', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        // 通过真实切换预热 lazy surface：再次切到 TUI 时无需等待首次 Suspense 揭示，两个层会短暂重叠。
        await setSuite(page, 'tui');
        await waitForSuite(page, 'tui');
        await setSuite(page, 'grid');
        await waitForSuite(page, 'grid');
        expect(await setQuery(page, 'track')).toBe(true);
        await expect(artistLayer(page).getByTestId('grid-list-search-button')).toHaveCount(0);

        // 在按钮刚挂到 DOM 的提交中切换：不要等它的入场动画落定，覆盖筛选/分页晚一帧提交的真实时序。
        const overlaps = await page.evaluate(() => new Promise<boolean>(resolve => {
            let switched = false;
            const observer = new MutationObserver(() => {
                if (!switched && document.querySelector('[data-library-renderer="grid"] [data-testid="grid-list-search-button"]')) {
                    switched = true;
                    window.__libraryProbe!.setSuite('tui');
                }
                if (document.querySelector('[data-library-surface="artist"][data-library-renderer="tui"]')) {
                    observer.disconnect();
                    resolve(Boolean(document.querySelector('[data-library-surface="artist"][data-library-renderer="grid"]')));
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            window.__libraryProbe!.setQuery('cedar');
        }));
        expect(overlaps).toBe(true);
        await waitForSuite(page, 'tui');
        await expect(page.locator('[data-library-surface="artist"][data-library-renderer="tui"]')).toHaveCount(1);
        await expect(page.locator('[data-library-surface="artist"][data-library-renderer="grid"]')).toHaveCount(0);
        expect((await artist(page))!.query).toBe('cedar');
    });

    // P4.5：在 TUI 里点了返回（完成），网格那份歌手页布局记录也一起忘掉——下次在网格里打开从头开始。
    test('the TUI back button also drops the grid artist layout record', async ({ mount, page }) => {
        const record = () => page.evaluate(key => sessionStorage.getItem(`folia_artist_grid_state:v2:${key}`), mainSessionKey);
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        await playFocusedTopSong(page, 'grid');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        await expect.poll(record).not.toBeNull();

        await setSuite(page, 'tui');
        await waitForSuite(page, 'tui');
        await artistLayer(page).locator('[data-tui-back]').click();
        await expect(artistLayer(page)).toHaveCount(0);
        expect(await record()).toBeNull();
        expect(await page.evaluate(key => window.__libraryProbe!.browseSession(key), mainSessionKey)).toBeNull();
    });

    test('a filter and a focused song in the grid survive the switch to the TUI, with no new requests', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        expect(await setQuery(page, 'cedar')).toBe(true);
        const filtered = artistAlbumIdsMatching(main, 'cedar');
        await expect.poll(async () => (await artist(page))?.albumIds).toEqual(filtered);
        await playFocusedTopSong(page, 'grid');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedSong = (await lastCall(page, 'playSong'))!.ids[0];
        expect(await artistFocus(page)).toBe(`song:${focusedSong}`);

        // 开发版浮层在歌手页上也出现（P4.3），切换走它的按钮（与探针的 setSuite 同一条路径：先冲刷会话）。
        await clearLog(page);
        const devSwitch = page.getByTestId('dev-library-renderer-switch');
        await expect(devSwitch).toHaveAttribute('data-placement', 'artist');
        await devSwitch.locator('[data-suite="tui"]').click();
        await waitForSuite(page, 'tui');
        await waitForArtist(page, filtered.length);
        expect((await artist(page))!.query).toBe('cedar');
        await expect(tuiSongRow(page, focusedSong)).toHaveAttribute('aria-selected', 'true');
        await expect(artistLayer(page).locator('[data-tui-filter]')).toContainText('cedar');
        expect(await allRequests(page)).toEqual([]);
    });

    test('a focused album and a filter in the TUI survive the switch to the grid, with no new requests', async ({ mount, page }) => {
        await mountProbe(mount, page, 'tui');
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        expect(await setQuery(page, 'cedar')).toBe(true);
        const filtered = artistAlbumIdsMatching(main, 'cedar');
        await expect.poll(async () => (await artist(page))?.albumIds).toEqual(filtered);
        await pressOnPage(page, 'Tab');
        await pressOnPage(page, 'ArrowDown');
        await expect(artistLayer(page).locator(`[data-library-entry="album:${filtered[1]}"]`)).toHaveAttribute('aria-selected', 'true');

        await clearLog(page);
        await setSuite(page, 'grid');
        await waitForSuite(page, 'grid');
        await waitForArtist(page, filtered.length);
        expect((await artist(page))!.query).toBe('cedar');
        expect(await getQuery(page)).toBe('cedar');
        // 切换时 TUI 把焦点写回会话，网格挂载时按条目键恢复到那张专辑卡。
        expect(await artistFocus(page)).toBe(`album:${filtered[1]}`);
        await expect.poll(() => page.evaluate(() => window.__libraryProbe!.artistGridFocus())).toBe(`album:${filtered[1]}`);
        expect(await allRequests(page)).toEqual([]);
    });

    // B8：换到 bravais 时同样不重新请求；过滤生效的歌手墙是有限拼贴，键盘焦点落在会话记着的那首歌上。
    test('a filter and a focused song in the grid survive the switch to bravais, with no new requests', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openArtist(page, 'artist-main');
        await waitForArtist(page, main.albumCount);
        expect(await setQuery(page, 'cedar')).toBe(true);
        const filtered = artistAlbumIdsMatching(main, 'cedar');
        await expect.poll(async () => (await artist(page))?.albumIds).toEqual(filtered);
        await playFocusedTopSong(page, 'grid');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const focusedSong = (await lastCall(page, 'playSong'))!.ids[0];

        await clearLog(page);
        await setSuite(page, 'bravais');
        await waitForSuite(page, 'bravais');
        await waitForArtist(page, filtered.length);
        expect((await artist(page))!.query).toBe('cedar');
        expect(await getQuery(page)).toBe('cedar');
        await expect(artistLayer(page)).toHaveAttribute('data-bravais-mode', 'finite');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveAttribute('data-library-entry', `song:${focusedSong}`);
        expect(await artistFocus(page)).toBe(`song:${focusedSong}`);
        expect(await allRequests(page)).toEqual([]);
    });
});
