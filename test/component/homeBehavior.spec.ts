import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import {
    HOME_FAVORITE_ALBUM_COUNTS,
    HOME_FM_COUNT,
    HOME_FM_PREFIX,
    HOME_PLAYLIST_FIXTURES,
    HOME_RECOMMENDED_COUNTS,
    homeFavoriteAlbumIds,
    homeRecommendedId,
    localSongTitle,
    NAVIDROME_HOME_ALBUMS,
    NAVIDROME_HOME_ARTISTS,
    NAVIDROME_NEWEST_ALBUM_IDS,
    NAVIDROME_RANDOM_SONGS,
    NAVIDROME_RECENT_ALBUM_IDS,
    NAVIDROME_STARRED_SONGS,
    ONLINE_FIXTURES,
    onlinePlaybackKey,
    onlineSongId,
    PROBE_PROVIDER_A,
    PROBE_PROVIDER_B,
} from '../../dev/probes/libraryBehavior/fixtureRules';
import {
    HOME_ALL_SONGS_ID,
    HOME_LOCAL_FOLDER_IDS,
    HOME_LOCAL_IGNORED_FOLDER,
    HOME_LOCAL_PLAYLIST,
    HOME_LOCAL_SONGS,
    homeFolderId,
    homeLocalSongId,
    homeLocalSongIds,
    homeLocalSongsIn,
} from '../../dev/probes/homeBehavior/homeFixtureRules';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import type { HomeBatchAction, HomeHiddenView, HomeTabKey } from '../../dev/probes/homeBehavior/probeApi';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/homeBehavior.spec.ts
// 首页与目录（GridMap）的行为回归闸门（Library Core P3 期间每一步都跑，和 libraryBehavior 一起）。
//
// 断言的是语义：宿主收到的集合描述（provider-aware key）、上游请求账、播放 / 入队回调、本地曲库服务调用账
// （经 serviceStubModule 的转接模块记下）、隐藏表。探针接口（window.__homeProbe）按语义命名，网格与 TUI 首页
// 各实现一套（网格专属概念——地图、批量面板——在 TUI 上的对应见 dev/probes/homeBehavior/homeProbeApi.ts 的文件头）；
// 标题前缀为 `[grid]` / `[tui]` / `[bravais]` 的那批用例对三个 suite 各跑一遍（B9 起 bravais 也实现首页；它的对应见
// dev/probes/homeBehavior/bravaisHomeProbe.ts：墙就是目录，筛选与批量是本地的目录树面板，在线页签没有目录过滤）。`[grid-only]` 的用例点的是网格专属的 DOM
// （地图按钮、卡片、批量面板按钮、确认框、Escape 阶梯），`[tui-only]` 的按 TUI 的键；`[switch]` 的在两套之间切换。
//
// 探针页开着 StrictMode：首页挂载时的请求会出现两次，分页断言看去重后的 offset 序列。
// test.fixme 记录的是现状缺陷，注释里写明由哪一步转正。

const SUITES = ['grid', 'tui', 'bravais'] as const;
type Suite = (typeof SUITES)[number];
const A = PROBE_PROVIDER_A;
const B = PROBE_PROVIDER_B;

const playlistIds = (providerId: string) => HOME_PLAYLIST_FIXTURES[providerId].map(id => ONLINE_FIXTURES[id].collectionId);
const localKeys = (indexes: readonly number[]) => homeLocalSongIds(indexes).map(id => `local:${id}`);
const localFilePath = (index: number) => {
    const rule = HOME_LOCAL_SONGS.find(song => song.index === index)!;
    return `${rule.folder}/${String(index).padStart(2, '0')} - ${localSongTitle(index)}.mp3`;
};

const mountHome = async (mount: (id: string) => Promise<unknown>, page: Page, suite: Suite = 'grid') => {
    // 本地曲库服务换成转接模块：需要目录句柄的函数走探针替身，其余放行到真实现（都记账）。
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({
        contentType: 'text/javascript',
        body: buildServiceStubModule(),
    }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => itemIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
    if (suite !== 'grid') await setSuite(page, suite);
};

/** 换 suite（与首页上 DEV 浮层同一条路径），等新 suite 的首页挂上、列表交给首页 surface 句柄。 */
const setSuite = async (page: Page, suite: Suite) => {
    await page.evaluate(id => window.__homeProbe!.setSuite(id), suite);
    await expect.poll(() => page.evaluate(() => window.__homeProbe!.homeSuite())).toBe(suite);
    await expect(page.locator('[data-library-home="tui"]')).toHaveCount(suite === 'tui' ? 1 : 0);
    // bravais 的首页与 stage 是 lazy chunk：加载完之前网格的首页还在，等墙上出现首页层。
    await expect(page.locator('[data-library-home="bravais"]')).toHaveCount(suite === 'bravais' ? 1 : 0);
    if (suite === 'bravais') await expect(page.locator('[data-library-stage="bravais"]')).toHaveAttribute('data-bravais-layer', /^home:/);
};

const setTab = (page: Page, tab: HomeTabKey) => page.evaluate(key => window.__homeProbe!.setTab(key), tab);
const setSection = (page: Page, id: string) => page.evaluate(section => window.__homeProbe!.setSection(section), id);
const activeSection = async (page: Page) => (
    (await page.evaluate(() => window.__homeProbe!.sections())).find(section => section.active)?.id
);
const items = (page: Page) => page.evaluate(() => window.__homeProbe!.items());
const itemIds = async (page: Page) => (await items(page)).map(item => item.id);
const itemById = async (page: Page, id: string) => (await items(page)).find(item => item.id === id);
const visibleIds = (page: Page) => page.evaluate(() => window.__homeProbe!.visibleItems());
const scope = (page: Page) => page.evaluate(() => window.__homeProbe!.scope());
const open = (page: Page, id: string) => page.evaluate(itemId => window.__homeProbe!.open(itemId), id);
const opened = (page: Page) => page.evaluate(() => window.__homeProbe!.opened());
const lastOpened = async (page: Page) => (await opened(page)).at(-1);
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const openMap = (page: Page) => page.evaluate(() => window.__homeProbe!.openMap());
const closeMap = (page: Page) => page.evaluate(() => window.__homeProbe!.closeMap());
const isMapOpen = (page: Page) => page.evaluate(() => window.__homeProbe!.isMapOpen());
const mapItems = (page: Page) => page.evaluate(() => window.__homeProbe!.mapItems());
const mapIds = async (page: Page) => (await mapItems(page)).map(item => item.id);
const setQuery = (page: Page, query: string) => page.evaluate(value => window.__homeProbe!.setQuery(value), query);
const getQuery = (page: Page) => page.evaluate(() => window.__homeProbe!.getQuery());
const openPanel = (page: Page) => page.evaluate(() => window.__homeProbe!.openPanel());
const batchScope = (page: Page) => page.evaluate(() => window.__homeProbe!.batchScope());
const batchSelect = (page: Page, ids: string[], selected = true) => (
    page.evaluate(([itemIdsToSelect, value]) => window.__homeProbe!.batchSelect(itemIdsToSelect, value), [ids, selected] as const)
);
const batchSelectAll = (page: Page, selected = true) => page.evaluate(value => window.__homeProbe!.batchSelectAll(value), selected);
const runBatch = (page: Page, action: HomeBatchAction, arg?: string) => (
    page.evaluate(([batchAction, value]) => window.__homeProbe!.runBatch(batchAction, value), [action, arg] as const)
);
const toggleHidden = (page: Page, id: string) => page.evaluate(itemId => window.__homeProbe!.toggleHidden(itemId), id);
const hiddenView = (page: Page) => page.evaluate(() => window.__homeProbe!.hiddenView());
const directoryCommands = (page: Page) => page.evaluate(() => window.__homeProbe!.directoryCommands());
const runDirectoryCommand = (page: Page, id: string, input?: string) => (
    page.evaluate(([commandId, value]) => window.__homeProbe!.runDirectoryCommand(commandId, value), [id, input] as const)
);
const BATCH_SELECTION_COMMANDS = [
    'directory-play-selection',
    'directory-enqueue-selection',
    'directory-create-playlist',
];
const setHiddenView = (page: Page, view: HomeHiddenView) => page.evaluate(value => window.__homeProbe!.setHiddenView(value), view);
const storedHidden = (page: Page) => page.evaluate(() => window.__homeProbe!.storedHidden());
const switchProvider = (page: Page, providerId: string) => page.evaluate(id => window.__homeProbe!.switchProvider(id), providerId);
const clearLog = (page: Page) => page.evaluate(() => window.__homeProbe!.clearLog());
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);
const serviceCalls = async (page: Page) => (await calls(page, 'service')).map(call => ({ name: call.key, args: call.detail }));
const requests = (page: Page, op: string, target?: string) => page.evaluate(([requestOp, requestTarget]) => (
    window.__homeProbe!.requests().filter(request => (
        request.op === requestOp && (requestTarget === undefined || request.target === requestTarget)
    ))
), [op, target] as const);
const distinctPages = async (page: Page, op: string, target: string) => (
    [...new Set((await requests(page, op, target)).map(request => `${request.offset}+${request.limit}`))]
);
const localSongIds = (page: Page) => page.evaluate(() => window.__homeProbe!.localSongIds());
const localPlaylists = (page: Page) => page.evaluate(() => window.__homeProbe!.localPlaylists());

/**
 * 关掉打开的集合，并等集合 surface 真正卸载（AnimatePresence 退场期间同一个 key 再进场会复用旧实例）。
 * 集合层一挂上就可以关（打开后马上关掉不会再留下卡住的透明层，见「closing a collection right after it opened」）。
 */
const closeCollection = async (page: Page) => {
    await expect(page.locator('[data-library-renderer]')).toHaveCount(1);
    await page.evaluate(() => window.__homeProbe!.closeCollection());
    await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
};

/** 打开某个页签 / section 并等列表到位。 */
const showList = async (page: Page, tab: HomeTabKey, section?: string) => {
    await setTab(page, tab);
    if (section) {
        await expect.poll(() => setSection(page, section)).toBe(true);
        await expect.poll(() => activeSection(page)).toBe(section);
    }
    await expect.poll(async () => (await items(page)).length).toBeGreaterThan(0);
};

/** 打开 GridMap 并等它在场；有批量配置时再打开批量面板。 */
const showMap = async (page: Page) => {
    await expect.poll(() => openMap(page)).toBe(true);
    await expect.poll(() => isMapOpen(page)).toBe(true);
    await expect.poll(() => getQuery(page)).toBe('');
};
const showBatch = async (page: Page) => {
    await showMap(page);
    expect(await openPanel(page)).toBe(true);
    await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([]);
};

/**
 * 关闭目录：网格是关掉 GridMap（地图退场、会话丢掉，getQuery 变成 null）；TUI 的目录视图一直开着，
 * 关闭就是丢掉会话再打开一个空的（getQuery 是 ''）。bravais 与 TUI 一样（墙一直是目录），另外收起目录树面板。
 */
const hideMap = async (page: Page) => {
    expect(await closeMap(page)).toBe(true);
    await expectDirectoryClosed(page);
};
const expectDirectoryClosed = async (page: Page) => {
    if (await page.evaluate(() => window.__homeProbe!.homeSuite()) !== 'grid') {
        await expect.poll(() => getQuery(page)).toBe('');
        expect(await isMapOpen(page)).toBe(true);
        return;
    }
    await expect.poll(() => isMapOpen(page)).toBe(false);
    await expect.poll(() => getQuery(page)).toBeNull();
};

/**
 * 只作用于焦点那一项的目录命令（隐藏焦点歌单、导入根上的重扫 / 移除、恢复忽略目录）：只有有焦点的目录（TUI）
 * 发布，取决于焦点落在哪一行。语义用例比的是其余的命令（两套 suite 一样）。
 */
const FOCUSED_DIRECTORY_COMMANDS = ['directory-toggle-hidden', 'directory-rescan-root', 'directory-remove-root', 'directory-clear-ignore'];
const scopeCommands = async (page: Page) => (await directoryCommands(page)).filter(id => !FOCUSED_DIRECTORY_COMMANDS.includes(id));

for (const suite of SUITES) {
test.describe(`[${suite}] online tabs`, () => {
    test('the playlist tab lists the account playlists with the cloud drive second', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        const list = await items(page);
        expect(list.map(item => [item.id, item.type])).toEqual([
            ['public', 'playlist'],
            ['cloud', 'cloud'],
            ['owned', 'playlist'],
            ['big', 'playlist'],
            ['same', 'playlist'],
        ]);
        expect(list.every(item => item.hideable && !item.hidden)).toBe(true);
        expect(await scope(page)).toBe(`online:${A}`);
        expect(await distinctPages(page, 'userPlaylists', `${A}:userPlaylists`)).toEqual(['0+50']);
        expect((await requests(page, 'cloudCollection', `${A}:cloud`)).length).toBeGreaterThan(0);
        // discover（发现页）排在电台与专辑之间：它是本 fork 加的第 4 个在线页签，
        // 显示开关来自布局设置（默认打开），可用性跟电台一致（四段数据都来自推荐接口）。
        expect(await page.evaluate(() => window.__homeProbe!.tabs().map(tab => [tab.key, tab.disabled]))).toEqual([
            ['playlist', false],
            ['radio', false],
            ['discover', false],
            ['albums', false],
            ['local', false],
            ['navidrome', false],
        ]);
    });

    test('favorite albums load every page in upstream order', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await setTab(page, 'albums');
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(A));
        expect(HOME_FAVORITE_ALBUM_COUNTS[A]).toBe(120);
        expect(await distinctPages(page, 'userAlbums', `${A}:userAlbums`)).toEqual(['0+50', '50+50', '100+50']);
        expect((await items(page)).every(item => item.type === 'album' && !item.hideable)).toBe(true);
    });

    test('the favorite-albums refresh event re-reads the list from the first page', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await setTab(page, 'albums');
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(A));
        await clearLog(page);

        await page.evaluate(() => window.dispatchEvent(new Event('folia-refresh-favorite-albums')));
        await expect.poll(() => distinctPages(page, 'userAlbums', `${A}:userAlbums`)).toEqual(['0+50', '50+50', '100+50']);
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(A));
    });

    test('the radio tab puts Personal FM and Daily Recommendations ahead of the recommended playlists', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await setTab(page, 'radio');
        const expected = [
            ['personal_fm', 'radio'],
            ['daily_recommendations', 'daily_recommendations'],
            ...Array.from({ length: HOME_RECOMMENDED_COUNTS[A] }, (_, index) => [homeRecommendedId(A, index), 'playlist']),
        ];
        await expect.poll(async () => (await items(page)).map(item => [item.id, item.type])).toEqual(expected);
        expect((await itemById(page, 'daily_recommendations'))?.trackCount).toBe(ONLINE_FIXTURES['online-daily'].rawIndexes.length);
        for (const op of ['personalFm', 'dailySongs', 'recommendedCollections']) {
            expect((await requests(page, op)).length, op).toBeGreaterThan(0);
        }
    });

    test('opening a playlist, an album and the daily recommendations hands the host provider-aware descriptors', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        expect(await open(page, 'owned')).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`online:${A}:playlist:owned`);
        expect(await lastOpened(page)).toMatchObject({ source: 'online', providerId: A, type: 'playlist', id: 'owned', name: 'Owned Playlist' });
        await expect.poll(() => stack(page)).toEqual(['Owned Playlist']);
        await closeCollection(page);

        await setTab(page, 'albums');
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(A));
        expect(await open(page, homeFavoriteAlbumIds(A)[3])).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`online:${A}:album:${homeFavoriteAlbumIds(A)[3]}`);
        await closeCollection(page);

        await setTab(page, 'radio');
        await expect.poll(() => itemIds(page)).toContain('daily_recommendations');
        expect(await open(page, 'daily_recommendations')).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key)
            .toBe(`online:${A}:daily_recommendations:daily_recommendations`);
        expect(await opened(page)).toHaveLength(3);
    });

    test('Personal FM plays straight away and opens no collection', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await setTab(page, 'radio');
        await expect.poll(() => itemIds(page)).toContain('personal_fm');
        await clearLog(page);

        expect(await open(page, 'personal_fm')).toBe(true);
        const fmKeys = Array.from({ length: HOME_FM_COUNT }, (_, index) => onlinePlaybackKey(A, onlineSongId(HOME_FM_PREFIX, index)));
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        expect((await calls(page, 'playSong'))[0]).toMatchObject({ ids: [fmKeys[0]], queueIds: fmKeys, isFm: true });
        expect(await requests(page, 'personalFm', `${A}:fm`)).toHaveLength(1);
        expect(await opened(page)).toEqual([]);
        expect(await stack(page)).toEqual([]);
    });

    // P3.0 记下的缺陷，P3.5 修复后转正：从首页打开集合后马上关掉（导航栈刚出现就清掉），首屏曲目的提交落在
    // 退场开始之后，网格右下角的列表按钮（带 exit 的 motion 元素）在集合层退场中途才挂上；framer 把它登记为
    // 「退场未完成」却不会给它播退场，集合层于是停在 opacity 0、仍是 fixed inset-0 z-[110]，挡住首页。
    // 现在按钮在父层已退场时不挂（GridListSearchButton）。owned / public / cloud 原先必现，big 首屏慢、不复现；
    // 本地歌手页（ArtistGridView，专辑到达后挂同一个按钮）也同样复现。
    test('closing a collection right after it opened does not leave an invisible layer over the home', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        for (const id of ['owned', 'public', 'cloud', 'big']) {
            expect(await open(page, id), id).toBe(true);
            await expect.poll(async () => (await stack(page)).length, id).toBe(1);
            await page.evaluate(() => window.__homeProbe!.closeCollection());
            await expect(page.locator('[data-library-renderer]'), id).toHaveCount(0);
            expect(await stack(page)).toEqual([]);
        }
        // 歌手页（ArtistGridView）同理：专辑到达后才挂列表按钮。
        await showList(page, 'local', 'artists');
        for (const { id } of (await items(page)).slice(0, 3)) {
            expect(await open(page, id), id).toBe(true);
            await expect.poll(async () => (await stack(page)).length, id).toBe(1);
            await page.evaluate(() => window.__homeProbe!.closeCollection());
            await expect(page.locator('[data-library-renderer]'), id).toHaveCount(0);
        }
        await setTab(page, 'playlist');
        await expect.poll(() => itemIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
        // 同一个任务里开了就关（集合层与导航栈同一帧出现又清掉）也一样。
        await page.evaluate(() => {
            window.__homeProbe!.open('owned');
            window.__homeProbe!.closeCollection();
        });
        await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
        expect(await stack(page)).toEqual([]);
        if (suite === 'grid') {
            // 关掉后马上再打开同一个集合（AnimatePresence 复用正在退场的那层网格）：列表按钮照常在。
            expect(await open(page, 'owned')).toBe(true);
            await expect.poll(async () => (await stack(page)).length).toBe(1);
            await page.evaluate(() => window.__homeProbe!.closeCollection());
            expect(await open(page, 'owned')).toBe(true);
            await expect(page.locator('[data-library-renderer]')).toHaveCount(1);
            await expect(page.getByTestId('grid-list-search-button')).toHaveCount(1);
            await closeCollection(page);
        }
    });

    test('the same playlist id under two providers opens two different collections', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        expect(await open(page, 'same')).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`online:${A}:playlist:same`);
        await closeCollection(page);

        expect(await switchProvider(page, B)).toBe(true);
        await expect.poll(() => itemIds(page)).toEqual(playlistIds(B));
        expect(await scope(page)).toBe(`online:${B}`);
        expect(await open(page, 'same')).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`online:${B}:playlist:same`);
        expect((await opened(page)).map(descriptor => descriptor.name)).toEqual(['Same Id (A)', 'Same Id (B)']);
    });
});

test.describe(`[${suite}] provider switch`, () => {
    test('a slow favorite-albums response from the previous provider never lands in the new list', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await page.evaluate(target => window.__homeProbe!.setLatency(target, { first: 1500 }), `${A}:userAlbums`);
        await setTab(page, 'albums');
        await page.waitForTimeout(200);

        expect(await switchProvider(page, B)).toBe(true);
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(B));
        // A 的首页应答在切换之后才回来（omni 按 provider / generation 丢弃它）；之后列表仍是 B 的。
        await expect.poll(() => requests(page, 'userAlbums', `${A}:userAlbums`), { timeout: 5_000 }).toHaveLength(1);
        await page.waitForTimeout(500);
        expect(await itemIds(page)).toEqual(homeFavoriteAlbumIds(B));
    });

    // P3.0 记下的缺陷，P3.3 修复后转正：原先收藏专辑 / 电台的加载 effect 先于「切 provider 清空」的 effect 执行，
    // 判断 `favoriteAlbums.length === 0` 时读到的还是上一个 provider 的列表，于是不加载，新 provider 的收藏专辑
    // 一直不出现。现在两份数据是首页资源（core/services/onlineHomeFeeds），绑定在同一个 effect 里先换归属再 ensure。
    test('switching provider after the albums tab has loaded shows the new provider\'s albums', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await setTab(page, 'albums');
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(A));

        expect(await switchProvider(page, B)).toBe(true);
        await expect.poll(() => itemIds(page)).toEqual(homeFavoriteAlbumIds(B));
    });

    // 同一个缺陷的电台版本（P3.3 修复后转正）。
    test('switching provider after the radio tab has loaded shows the new provider\'s feed', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await setTab(page, 'radio');
        await expect.poll(() => itemIds(page)).toContain(homeRecommendedId(A, 0));

        expect(await switchProvider(page, B)).toBe(true);
        await expect.poll(() => itemIds(page)).toContain(homeRecommendedId(B, 0));
        expect(await itemIds(page)).not.toContain(homeRecommendedId(A, 0));
    });
});

test.describe(`[${suite}] local tab`, () => {
    test('the four sections list folders (with the virtual All Songs), albums, artists and playlists', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        expect(await page.evaluate(() => window.__homeProbe!.sections())).toEqual([
            { id: 'folders', active: true },
            { id: 'albums', active: false },
            { id: 'artists', active: false },
            { id: 'playlists', active: false },
        ]);
        expect(await scope(page)).toBe('local');

        const folders = await items(page);
        expect(folders.map(item => item.id)).toEqual(HOME_LOCAL_FOLDER_IDS);
        expect(folders.every(item => item.type === 'folder' && !item.hideable)).toBe(true);
        // 「全部歌曲」作为虚拟条目交给目录（P3.1 起滑条条目保留 isVirtual，删除守卫按它判断）。
        expect(folders.filter(item => item.isVirtual).map(item => item.id)).toEqual([HOME_ALL_SONGS_ID]);
        expect(folders[0].trackIds).toEqual(homeLocalSongIds(HOME_LOCAL_SONGS.map(song => song.index)));
        for (const folder of ['Extra', 'Music/Alpha', 'Music/Alpha/Live', 'Music/Beta']) {
            expect(folders.find(item => item.id === homeFolderId(folder))?.trackIds, folder).toEqual(homeLocalSongIds(homeLocalSongsIn(folder)));
        }

        const grouped = (rows: { name: string; trackIds?: string[] }[]) => Object.fromEntries(
            rows.map(row => [row.name, [...(row.trackIds ?? [])].sort()]),
        );
        const byField = (field: 'album' | 'artist') => {
            const result: Record<string, string[]> = {};
            HOME_LOCAL_SONGS.forEach(song => {
                (result[song[field]] ??= []).push(homeLocalSongId(song.index));
            });
            Object.values(result).forEach(ids => ids.sort());
            return result;
        };

        await showList(page, 'local', 'albums');
        expect((await items(page)).every(item => item.type === 'album' && !item.hideable)).toBe(true);
        expect(grouped(await items(page))).toEqual(byField('album'));

        await showList(page, 'local', 'artists');
        expect((await items(page)).every(item => item.type === 'artist' && !item.hideable)).toBe(true);
        expect(grouped(await items(page))).toEqual(byField('artist'));

        await showList(page, 'local', 'playlists');
        const playlists = await items(page);
        // 「我喜欢」是本地曲库自带的收藏歌单（读歌单时自动建出），排在自建歌单前面。
        expect(playlists.map(item => [item.name, item.type, item.hideable])).toEqual([
            ['Liked Songs', 'playlist', true],
            [HOME_LOCAL_PLAYLIST.name, 'playlist', true],
        ]);
        expect(playlists.map(item => Boolean(item.isVirtual))).toEqual([true, false]);
        expect(playlists[0].trackIds).toEqual([]);
        expect(playlists[1].trackIds).toEqual(homeLocalSongIds(HOME_LOCAL_PLAYLIST.songs));
    });

    test('opening local entries hands the host local descriptors (All Songs is virtual)', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        expect(await open(page, HOME_ALL_SONGS_ID)).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:folder:${HOME_ALL_SONGS_ID}`);
        expect(await lastOpened(page)).toMatchObject({
            source: 'local',
            type: 'folder',
            isVirtual: true,
            songIds: homeLocalSongIds(HOME_LOCAL_SONGS.map(song => song.index)),
        });
        await closeCollection(page);

        expect(await open(page, homeFolderId('Music/Beta'))).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:folder:${homeFolderId('Music/Beta')}`);
        expect((await lastOpened(page))?.songIds).toEqual(homeLocalSongIds(homeLocalSongsIn('Music/Beta')));
        await closeCollection(page);

        await showList(page, 'local', 'albums');
        const album = (await items(page)).find(item => item.name === 'Alpha Album')!;
        expect(await open(page, album.id)).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:album:${album.id}`);
        expect((await lastOpened(page))?.entityId).toBe(album.id);
        await closeCollection(page);

        await showList(page, 'local', 'playlists');
        const playlist = (await items(page)).find(item => item.name === HOME_LOCAL_PLAYLIST.name)!;
        expect(await open(page, playlist.id)).toBe(true);
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:playlist:${playlist.id}`);
        expect((await lastOpened(page))?.songIds).toEqual(homeLocalSongIds(HOME_LOCAL_PLAYLIST.songs));
    });
});

test.describe(`[${suite}] navidrome tab`, () => {
    test('sections come from the overview requests, with virtual Random and Favorites playlists', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'navidrome');
        expect(await activeSection(page)).toBe('albums');
        expect(await scope(page)).toBe('navidrome');
        expect(await itemIds(page)).toEqual(NAVIDROME_HOME_ALBUMS.map(album => album.id));

        await showList(page, 'navidrome', 'recently-added');
        expect(await itemIds(page)).toEqual(NAVIDROME_NEWEST_ALBUM_IDS);
        await showList(page, 'navidrome', 'recently-played');
        expect(await itemIds(page)).toEqual(NAVIDROME_RECENT_ALBUM_IDS);
        await showList(page, 'navidrome', 'artists');
        expect(await itemIds(page)).toEqual(NAVIDROME_HOME_ARTISTS.map(artist => artist.id));

        await showList(page, 'navidrome', 'playlists');
        const playlists = await items(page);
        expect(playlists.map(item => [item.id, item.type, item.hideable])).toEqual([
            ['__navi_random__', 'playlist', true],
            ['__navi_favorites__', 'playlist', true],
            ['navi-pl-1', 'playlist', true],
            ['navi-pl-2', 'playlist', true],
        ]);
        // 「随机」「收藏」是虚拟歌单（P3.3 起带 isVirtual），服务器上的歌单不是。
        expect(playlists.map(item => Boolean(item.isVirtual))).toEqual([true, true, false, false]);
        expect(playlists[0].trackCount).toBe(NAVIDROME_RANDOM_SONGS.length);
        expect(playlists[1].trackCount).toBe(NAVIDROME_STARRED_SONGS.length);

        expect([...new Set((await requests(page, 'getAlbumList2')).map(request => `${request.target}:${request.offset}+${request.limit}`))])
            .toEqual(['alphabeticalByName:0+500', 'newest:0+500', 'recent:0+500']);
        for (const op of ['getPlaylists', 'getArtists', 'getRandomSongs', 'getStarred2']) {
            expect((await requests(page, op)).length, op).toBeGreaterThan(0);
        }
    });

    test('opening Navidrome entries resolves album, random, favorites, playlist and artist descriptors', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'navidrome');
        const openAndClose = async (id: string, key: string) => {
            expect(await open(page, id)).toBe(true);
            await expect.poll(async () => (await lastOpened(page))?.key).toBe(key);
            await closeCollection(page);
        };
        await openAndClose('navi-al-1', 'navidrome:album:navi-al-1');
        await showList(page, 'navidrome', 'playlists');
        await openAndClose('__navi_random__', 'navidrome:random:__navi_random__');
        await openAndClose('__navi_favorites__', 'navidrome:favorites:__navi_favorites__');
        await openAndClose('navi-pl-1', 'navidrome:playlist:navi-pl-1');
        expect(await lastOpened(page)).toMatchObject({ editable: true });
        await showList(page, 'navidrome', 'artists');
        await openAndClose('navi-ar-1', 'navidrome:artist:navi-ar-1');
    });

    test('the last section is remembered under folia_navidrome_last_section across remounts', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'navidrome', 'playlists');
        expect(await page.evaluate(() => localStorage.getItem('folia_navidrome_last_section'))).toBe('playlists');

        await page.evaluate(() => window.__homeProbe!.remount());
        await expect.poll(() => activeSection(page)).toBe('playlists');
        await expect.poll(() => itemIds(page)).toContain('__navi_random__');
    });
});

test.describe(`[${suite}] directory filter`, () => {
    test('the query filters the map by name or path; every term has to match; empty shows all', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showMap(page);
        expect(await mapIds(page)).toEqual(HOME_LOCAL_FOLDER_IDS);
        // 虚拟的「全部歌曲」不是文件夹：地图上没有路径（不按路径匹配、不进目录树的路径规则）。
        const allSongs = (await mapItems(page)).find(item => item.id === HOME_ALL_SONGS_ID);
        expect(allSongs?.isVirtual).toBe(true);
        expect(allSongs?.path).toBeUndefined();
        // 可见文字不变：描述行仍是名称「All Songs」，不是「Folder」（local-library 截图基线锁着它）。
        expect(allSongs?.description).toBe('All Songs');

        expect(await setQuery(page, 'alpha')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual([homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);
        expect(await setQuery(page, 'music live')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual([homeFolderId('Music/Alpha/Live')]);
        expect(await setQuery(page, 'nothing-matches')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual([]);
        expect(await setQuery(page, '')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual(HOME_LOCAL_FOLDER_IDS);
        // 筛选只作用于地图：滑条上的列表不变。
        expect(await visibleIds(page)).toEqual(HOME_LOCAL_FOLDER_IDS);
    });

    test('closing the map drops the query; reopening starts unfiltered', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        if (suite === 'bravais') {
            // 每面墙都注册了当前页过滤（设计稿 §7.6）：在线页签上也能过滤，过滤词是目录会话的 query；关闭目录丢掉它。
            expect(await setQuery(page, 'owned')).toBe(true);
            await expect.poll(() => mapIds(page)).toEqual(['owned']);
            await hideMap(page);
            expect(await mapIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
            // 本地的目录树面板里是同一个过滤（同一个目录 query）。
            await showList(page, 'local');
            await showMap(page);
            expect(await setQuery(page, 'beta')).toBe(true);
            await expect.poll(() => mapIds(page)).toEqual([homeFolderId('Music/Beta')]);
            await hideMap(page);
            await showMap(page);
            expect(await mapIds(page)).toEqual(HOME_LOCAL_FOLDER_IDS);
            return;
        }
        await showMap(page);
        expect(await setQuery(page, 'owned')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual(['owned']);

        await hideMap(page);
        await showMap(page);
        expect(await mapIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
    });
});

test.describe(`[${suite}] directory batch`, () => {
    test('the batch scope starts empty and follows card order, not click order', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        expect(await batchScope(page)).toMatchObject({
            selectionType: 'folders',
            itemIds: [],
            trackIds: [],
            totalItemCount: HOME_LOCAL_FOLDER_IDS.length,
            actions: ['play', 'enqueue', 'create-playlist', 'remove', 'rescan-root', 'remove-root', 'clear-ignore'],
        });

        await batchSelect(page, [homeFolderId('Music/Beta')]);
        await batchSelect(page, [homeFolderId('Extra')]);
        const expectedTracks = homeLocalSongIds([...homeLocalSongsIn('Extra'), ...homeLocalSongsIn('Music/Beta')]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Extra'), homeFolderId('Music/Beta')]);
        expect((await batchScope(page))?.trackIds).toEqual(expectedTracks);

        await clearLog(page);
        expect(await runBatch(page, 'play')).toBe(true);
        expect(await runBatch(page, 'enqueue')).toBe(true);
        expect((await calls(page, 'playAll')).map(call => call.ids)).toEqual([expectedTracks.map(id => `local:${id}`)]);
        expect((await calls(page, 'addAllToQueue')).map(call => call.ids)).toEqual([expectedTracks.map(id => `local:${id}`)]);

        await batchSelect(page, [homeFolderId('Extra')], false);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Beta')]);
    });

    test('overlapping selections are de-duplicated and keep the first occurrence', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [homeFolderId('Music/Alpha'), HOME_ALL_SONGS_ID]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([HOME_ALL_SONGS_ID, homeFolderId('Music/Alpha')]);
        expect((await batchScope(page))?.trackIds).toEqual(homeLocalSongIds(HOME_LOCAL_SONGS.map(song => song.index)));

        await clearLog(page);
        await runBatch(page, 'play');
        expect((await calls(page, 'playAll'))[0].ids).toEqual(localKeys(HOME_LOCAL_SONGS.map(song => song.index)));
    });

    test('select-all takes only the filtered cards, and the selection outlives the query', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await setQuery(page, 'alpha');
        await expect.poll(() => mapIds(page)).toEqual([homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);

        await batchSelectAll(page);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);
        expect(await batchScope(page)).toMatchObject({
            trackIds: homeLocalSongIds([...homeLocalSongsIn('Music/Alpha'), ...homeLocalSongsIn('Music/Alpha/Live')]),
            totalItemCount: 2,
        });

        await setQuery(page, '');
        await expect.poll(async () => (await batchScope(page))?.totalItemCount).toBe(HOME_LOCAL_FOLDER_IDS.length);
        expect((await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);

        await batchSelectAll(page, false);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([]);
    });

    test('create playlist writes a local playlist with the scope\'s songs in order', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [homeFolderId('Music/Beta'), homeFolderId('Extra')]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toHaveLength(2);
        await clearLog(page);

        expect(await runBatch(page, 'create-playlist', 'Batch Mix')).toBe(true);
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(1);
        await expect.poll(async () => (await localPlaylists(page)).find(playlist => playlist.name === 'Batch Mix')?.songIds)
            .toEqual(homeLocalSongIds([...homeLocalSongsIn('Extra'), ...homeLocalSongsIn('Music/Beta')]));

        await hideMap(page);
        await showList(page, 'local', 'playlists');
        await expect.poll(async () => (await items(page)).map(item => item.name)).toContain('Batch Mix');
    });

    test('albums and artists offer play, enqueue and create playlist only; playlists have no batch', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        for (const section of ['albums', 'artists'] as const) {
            await showList(page, 'local', section);
            await showBatch(page);
            expect(await batchScope(page)).toMatchObject({ selectionType: section, actions: ['play', 'enqueue', 'create-playlist'] });
            expect(await page.evaluate(() => window.__homeProbe!.directoryNodes())).toEqual([]);
            await hideMap(page);
        }
        await showList(page, 'local', 'playlists');
        expect(await page.evaluate(() => window.__homeProbe!.batchAvailable())).toBe(false);
        await showList(page, 'local', 'albums');
        await showBatch(page);
        const [first, second] = await mapIds(page);
        await batchSelect(page, [second, first]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([first, second]);
    });

    test('removing a folder whose subfolders are not selected deletes only its own songs', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [homeFolderId('Music/Alpha')]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Alpha')]);
        await clearLog(page);

        expect(await runBatch(page, 'remove')).toBe(true);
        expect(await serviceCalls(page)).toEqual([
            { name: 'deleteSongsByIds', args: [homeLocalSongIds(homeLocalSongsIn('Music/Alpha'))] },
        ]);
        await expect.poll(() => localSongIds(page)).toEqual(homeLocalSongIds([4, 5, 6, 7, 8]));
    });

    test('removing a folder together with all its subfolders removes the top folder', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toHaveLength(2);
        await clearLog(page);

        expect(await runBatch(page, 'remove')).toBe(true);
        expect(await serviceCalls(page)).toEqual([
            { name: 'deleteFolderSongs', args: ['Music/Alpha'] },
            { name: 'deleteSongsByIds', args: [homeLocalSongIds([1, 2, 3, 4, 5])] },
        ]);
        await expect.poll(() => localSongIds(page)).toEqual(homeLocalSongIds([6, 7, 8]));
        // 删掉的子目录在扫描快照里记为忽略，目录树里能「恢复并重扫」。
        await expect.poll(async () => (await page.evaluate(() => window.__homeProbe!.directoryNodes()))
            .find(node => node.path === 'Music/Alpha')?.ignored).toBe(true);
    });

    test('All Songs is never removed as a folder; its songs are removed by id', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [HOME_ALL_SONGS_ID]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([HOME_ALL_SONGS_ID]);
        await clearLog(page);

        expect(await runBatch(page, 'remove')).toBe(true);
        expect(await serviceCalls(page)).toEqual([
            { name: 'deleteSongsByIds', args: [homeLocalSongIds(HOME_LOCAL_SONGS.map(song => song.index))] },
        ]);
        await expect.poll(() => localSongIds(page)).toEqual([]);
    });

    test('a fully selected top-level folder is removed through its root path', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [homeFolderId('Extra')]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Extra')]);
        await clearLog(page);

        expect(await runBatch(page, 'remove')).toBe(true);
        expect(await serviceCalls(page)).toEqual([
            { name: 'deleteFolderSongs', args: ['Extra'] },
            { name: 'deleteSongsByIds', args: [homeLocalSongIds(homeLocalSongsIn('Extra'))] },
        ]);
        await expect.poll(() => localSongIds(page)).toEqual(homeLocalSongIds([1, 2, 3, 4, 5, 6, 7]));
        await expect.poll(async () => (await page.evaluate(() => window.__homeProbe!.directoryNodes())).map(node => node.path))
            .not.toContain('Extra');
    });

    test('rescan root, remove root and clear ignore reach their services and refresh the library', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        expect((await page.evaluate(() => window.__homeProbe!.directoryNodes())).filter(node => node.depth === 0).map(node => node.path))
            .toEqual(['Extra', 'Music']);
        expect((await page.evaluate(() => window.__homeProbe!.directoryNodes())).find(node => node.path === HOME_LOCAL_IGNORED_FOLDER)?.ignored)
            .toBe(true);
        await clearLog(page);

        expect(await runBatch(page, 'rescan-root', 'Music')).toBe(true);
        expect(await serviceCalls(page)).toEqual([{ name: 'resyncFolder', args: ['Music'] }]);
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(1);
        await clearLog(page);

        expect(await runBatch(page, 'clear-ignore', HOME_LOCAL_IGNORED_FOLDER)).toBe(true);
        expect(await serviceCalls(page)).toEqual([{ name: 'clearFolderIgnore', args: [HOME_LOCAL_IGNORED_FOLDER] }]);
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(1);
        await clearLog(page);

        expect(await runBatch(page, 'remove-root', 'Music')).toBe(true);
        expect((await serviceCalls(page))[0]).toEqual({ name: 'removeImportedRoot', args: ['Music'] });
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(1);
        await expect.poll(() => localSongIds(page)).toEqual(homeLocalSongIds(homeLocalSongsIn('Extra')));
    });
});

test.describe(`[${suite}] directory commands`, () => {
    // 目录命令只在目录可交互时出现（网格：GridMap 打开时注册 directory surface；TUI 的目录列表一直注册），
    // 能不能做与批量面板的按钮同源。
    test('directory commands exist only while the directory is open and follow what the section supports', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        const closedCommands = suite === 'grid' ? [] : ['directory-manage-hidden'];
        await expect.poll(() => scopeCommands(page)).toEqual(closedCommands);
        await showMap(page);
        // 在线歌单没有批量，可隐藏：只有「管理隐藏」。
        await expect.poll(() => scopeCommands(page)).toEqual(['directory-manage-hidden']);
        await hideMap(page);
        await expect.poll(() => scopeCommands(page)).toEqual(closedCommands);

        await showList(page, 'local');
        await showMap(page);
        await expect.poll(() => scopeCommands(page)).toEqual(['directory-select-all']);
        expect(await openPanel(page)).toBe(true);
        await batchSelect(page, [homeFolderId('Extra')]);
        await expect.poll(() => scopeCommands(page)).toEqual([
            ...BATCH_SELECTION_COMMANDS,
            'directory-remove-selection',
            'directory-select-all',
            'directory-clear-selection',
        ]);
        await hideMap(page);
        await expect.poll(() => scopeCommands(page)).toEqual(suite === 'grid' ? [] : ['directory-select-all']);

        // 专辑：没有删除。
        await showList(page, 'local', 'albums');
        await showBatch(page);
        const [firstAlbum] = await mapIds(page);
        await batchSelect(page, [firstAlbum]);
        await expect.poll(() => scopeCommands(page)).toEqual([
            ...BATCH_SELECTION_COMMANDS,
            'directory-select-all',
            'directory-clear-selection',
        ]);
        await hideMap(page);

        // 本地歌单：没有批量，可隐藏。
        await showList(page, 'local', 'playlists');
        await showMap(page);
        await expect.poll(() => scopeCommands(page)).toEqual(['directory-manage-hidden']);
    });

    test('select-all from the palette opens the batch panel on the filtered cards; clear empties the selection', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showMap(page);
        await setQuery(page, 'alpha');
        await expect.poll(() => mapIds(page)).toEqual([homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);

        expect(await runDirectoryCommand(page, 'directory-select-all')).toBe(true);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Alpha'), homeFolderId('Music/Alpha/Live')]);
        expect(await getQuery(page)).toBe('alpha');

        expect(await runDirectoryCommand(page, 'directory-clear-selection')).toBe(true);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([]);
        await expect.poll(() => scopeCommands(page)).toEqual(['directory-select-all']);
    });

    test('create playlist from the palette takes the typed name and refuses an empty one', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await showBatch(page);
        await batchSelect(page, [homeFolderId('Music/Beta'), homeFolderId('Extra')]);
        await expect.poll(() => directoryCommands(page)).toContain('directory-create-playlist');
        await clearLog(page);

        expect(await runDirectoryCommand(page, 'directory-create-playlist', '   ')).toBe(false);
        expect(await runDirectoryCommand(page, 'directory-create-playlist', 'Palette Mix')).toBe(true);
        await expect.poll(async () => (await localPlaylists(page)).find(playlist => playlist.name === 'Palette Mix')?.songIds)
            .toEqual(homeLocalSongIds([...homeLocalSongsIn('Extra'), ...homeLocalSongsIn('Music/Beta')]));
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(1);
    });

    test('manage hidden from the palette enters the hidden view and leaves it again', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showMap(page);
        await expect.poll(() => scopeCommands(page)).toEqual(['directory-manage-hidden']);

        expect(await runDirectoryCommand(page, 'directory-manage-hidden')).toBe(true);
        await expect.poll(() => hiddenView(page)).toBe('manage');
        expect(await toggleHidden(page, 'owned')).toBe(true);
        await expect.poll(async () => (await mapItems(page)).find(item => item.id === 'owned')?.hidden).toBe(true);

        expect(await runDirectoryCommand(page, 'directory-manage-hidden')).toBe(true);
        await expect.poll(() => hiddenView(page)).toBe('browse');
        await expect.poll(() => mapIds(page)).toEqual(['public', 'cloud', 'big', 'same']);
    });
});

test.describe(`[${suite}] hidden items`, () => {
    test('a hidden playlist leaves the slider, the map and map search; unhiding restores it', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showMap(page);
        expect(await toggleHidden(page, 'owned')).toBe(true);

        await expect.poll(() => visibleIds(page)).toEqual(['public', 'cloud', 'big', 'same']);
        expect(await itemById(page, 'owned')).toMatchObject({ hidden: true, hideable: true });
        await expect.poll(() => mapIds(page)).toEqual(['public', 'cloud', 'big', 'same']);
        expect(await storedHidden(page)).toEqual({ [`online:${A}`]: ['owned'] });
        // bravais 的在线页签没有目录过滤（首页不注册过滤）。
        if (suite !== 'bravais') {
            await setQuery(page, 'owned');
            await expect.poll(() => mapIds(page)).toEqual([]);
            await setQuery(page, '');
        }

        expect(await toggleHidden(page, 'owned')).toBe(true);
        await expect.poll(() => visibleIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
        await expect.poll(() => mapIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
        expect(await storedHidden(page)).toEqual({ [`online:${A}`]: [] });
    });

    test('a hidden card cannot be opened from the slider', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showMap(page);
        await toggleHidden(page, 'owned');
        await expect.poll(() => visibleIds(page)).not.toContain('owned');
        await hideMap(page);
        expect(await open(page, 'owned')).toBe(false);
        expect(await opened(page)).toEqual([]);
    });

    test('the manage view shows everything with hidden flags, or only the hidden ones', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showMap(page);
        await toggleHidden(page, 'owned');
        await toggleHidden(page, 'big');
        await expect.poll(() => mapIds(page)).toEqual(['public', 'cloud', 'same']);

        expect(await setHiddenView(page, 'manage')).toBe(true);
        await expect.poll(async () => (await mapItems(page)).map(item => [item.id, item.hidden])).toEqual([
            ['public', false],
            ['cloud', false],
            ['owned', true],
            ['big', true],
            ['same', false],
        ]);
        expect(await setHiddenView(page, 'manage-hidden-only')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual(['owned', 'big']);
        expect(await setHiddenView(page, 'browse')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual(['public', 'cloud', 'same']);
    });

    test('hidden ids are scoped per provider, local library and Navidrome', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showMap(page);
        await toggleHidden(page, 'same');
        await expect.poll(() => visibleIds(page)).not.toContain('same');
        await hideMap(page);

        expect(await switchProvider(page, B)).toBe(true);
        await expect.poll(() => itemIds(page)).toEqual(playlistIds(B));
        expect(await visibleIds(page)).toEqual(['same']);
        expect(await itemById(page, 'same')).toMatchObject({ hidden: false });

        await showList(page, 'local', 'playlists');
        const localPlaylists = await items(page);
        const localPlaylistId = localPlaylists.find(item => item.name === HOME_LOCAL_PLAYLIST.name)!.id;
        await showMap(page);
        expect(await toggleHidden(page, localPlaylistId)).toBe(true);
        await expect.poll(() => visibleIds(page)).toEqual(localPlaylists.filter(item => item.id !== localPlaylistId).map(item => item.id));
        await hideMap(page);

        await showList(page, 'navidrome', 'playlists');
        await showMap(page);
        expect(await toggleHidden(page, '__navi_random__')).toBe(true);
        await expect.poll(() => visibleIds(page)).toEqual(['__navi_favorites__', 'navi-pl-1', 'navi-pl-2']);
        await hideMap(page);

        expect(await storedHidden(page)).toEqual({
            [`online:${A}`]: ['same'],
            local: [localPlaylistId],
            navidrome: ['__navi_random__'],
        });

        await setTab(page, 'playlist');
        expect(await switchProvider(page, A)).toBe(true);
        await expect.poll(() => visibleIds(page)).toEqual(['public', 'cloud', 'owned', 'big']);
    });

    test('hiding survives a remount; folders, albums and artists cannot be hidden', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showMap(page);
        await toggleHidden(page, 'owned');
        await expect.poll(() => visibleIds(page)).not.toContain('owned');
        await hideMap(page);

        await page.evaluate(() => window.__homeProbe!.remount());
        await expect.poll(() => itemIds(page)).toEqual(['public', 'cloud', 'owned', 'big', 'same']);
        await expect.poll(() => visibleIds(page)).toEqual(['public', 'cloud', 'big', 'same']);

        for (const section of ['folders', 'albums', 'artists']) {
            await showList(page, 'local', section);
            await showMap(page);
            const [first] = await mapIds(page);
            expect(await toggleHidden(page, first), section).toBe(false);
            await hideMap(page);
        }
        expect(await storedHidden(page)).toEqual({ [`online:${A}`]: ['owned'] });
    });

    test('batch-capable sections have nothing hideable and hideable lists have no batch', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        expect(await page.evaluate(() => window.__homeProbe!.batchAvailable())).toBe(false);
        for (const section of ['folders', 'albums', 'artists']) {
            await showList(page, 'local', section);
            expect(await page.evaluate(() => window.__homeProbe!.batchAvailable()), section).toBe(true);
            expect((await items(page)).some(item => item.hideable), section).toBe(false);
        }
        await showList(page, 'navidrome', 'playlists');
        expect(await page.evaluate(() => window.__homeProbe!.batchAvailable())).toBe(false);
    });
});

test.describe(`[${suite}] imports`, () => {
    test('folder import calls the import service and refreshes the library', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await clearLog(page);

        expect(await page.evaluate(() => window.__homeProbe!.runAction('import-folder'))).toBe(true);
        await expect.poll(() => serviceCalls(page)).toEqual([{ name: 'importFolder', args: [] }]);
        await expect.poll(() => calls(page, 'refreshLocalSongs')).toHaveLength(1);
        await expect.poll(() => itemIds(page)).toContain(homeFolderId('Imported'));
    });

    test('refresh re-syncs all roots and refreshes the library', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local');
        await clearLog(page);

        expect(await page.evaluate(() => window.__homeProbe!.runAction('refresh-folders'))).toBe(true);
        await expect.poll(() => serviceCalls(page)).toEqual([{ name: 'resyncAllFolders', args: [] }]);
        await expect.poll(() => calls(page, 'refreshLocalSongs')).toHaveLength(1);
    });

    test('a playlist file import creates a playlist from matching paths and reports the result', async ({ mount, page }) => {
        await mountHome(mount, page, suite);
        await showList(page, 'local', 'playlists');
        await clearLog(page);
        const importFile = (name: string, lines: string[]) => page.evaluate(
            ([fileName, text]) => window.__homeProbe!.importPlaylistFile(fileName, text),
            [name, ['#EXTM3U', ...lines].join('\n')] as const,
        );

        expect(await importFile('road.m3u8', ['#PLAYLIST:Road Trip', localFilePath(6), localFilePath(1)])).toBe(true);
        expect((await calls(page, 'statusMessage')).map(call => call.status)).toEqual(['success']);
        expect((await calls(page, 'statusMessage'))[0].text).toContain('Road Trip');
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(1);
        await expect.poll(async () => (await localPlaylists(page)).find(playlist => playlist.name === 'Road Trip')?.songIds)
            .toEqual(homeLocalSongIds([6, 1]));
        await expect.poll(async () => (await items(page)).map(item => item.name)).toContain('Road Trip');
        await clearLog(page);

        expect(await importFile('partial.m3u8', ['#PLAYLIST:Partial', localFilePath(2), 'Missing/nowhere.mp3'])).toBe(true);
        expect((await calls(page, 'statusMessage')).map(call => call.status)).toEqual(['info']);
        await clearLog(page);

        expect(await importFile('none.m3u8', ['Missing/nowhere.mp3'])).toBe(true);
        expect((await calls(page, 'statusMessage')).map(call => call.status)).toEqual(['error']);
        expect(await calls(page, 'refreshLocalSongs')).toHaveLength(0);
    });
});
}

test.describe('[grid-only] directory interactions', () => {
    // P3.1 保留 isVirtual 后这张卡的第二行一度变成「Folder」、地图卡丢了「本目录 N 首」；这条把可见文字钉住。
    test('the virtual All Songs card reads "All Songs" under its title on the slider and in the map', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        const infoTitle = page.locator('h3.text-2xl', { hasText: /^All Songs$/ });
        await expect(infoTitle).toHaveCount(1);
        await expect(infoTitle.locator('xpath=following-sibling::p[1]')).toHaveText(`${HOME_LOCAL_SONGS.length} Tracks • All Songs`);

        await showMap(page);
        const allSongsCard = page.locator('[data-ponder-page-scope="local-grid-map-page"] .theme-polaroid-card')
            .filter({ hasText: `${HOME_LOCAL_SONGS.length} tracks in this folder` })
            .filter({ hasText: 'All Songs' });
        await expect(allSongsCard).toHaveCount(1);
        expect((await allSongsCard.innerText()).split(/\r?\n/).map(line => line.trim()).filter(Boolean))
            .toEqual(['All Songs', 'All Songs', `${HOME_LOCAL_SONGS.length} tracks in this folder`]);
    });

    test('the map button opens GridMap; Escape clears the query before it closes the map', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        await page.getByRole('button', { name: 'All', exact: true }).click();
        await expect.poll(() => isMapOpen(page)).toBe(true);
        await expect.poll(() => getQuery(page)).toBe('');

        await setQuery(page, 'alpha');
        await expect.poll(() => mapIds(page)).toHaveLength(2);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('Escape');
        await expect.poll(() => getQuery(page)).toBe('');
        expect(await isMapOpen(page)).toBe(true);
        await page.keyboard.press('Escape');
        await expect.poll(() => isMapOpen(page)).toBe(false);
    });

    test('in batch mode the tree checkbox and a card click select, and the panel button plays the scope', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        await showMap(page);
        await page.locator('button[class*="group/grid-title"]').click();
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([]);

        await page.locator('button[role="checkbox"][title="Music/Beta"]').click();
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Beta')]);
        // 卡片在批量面板下面露出的部分不一定能点到中心：直接派发 click（卡片的 onClick 就是批选切换）。
        await page.locator('[data-ponder-page-scope="local-grid-map-page"] .theme-polaroid-card', { hasText: 'Extra' }).dispatchEvent('click');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Extra'), homeFolderId('Music/Beta')]);

        await clearLog(page);
        await page.getByRole('button', { name: 'Play 3 songs' }).click();
        await expect.poll(async () => (await calls(page, 'playAll')).map(call => call.ids))
            .toEqual([localKeys([...homeLocalSongsIn('Extra'), ...homeLocalSongsIn('Music/Beta')])]);
    });

    test('removing from the panel and removing a root both ask for confirmation first', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        await showBatch(page);
        await page.locator('button[role="checkbox"][title="Music/Beta"]').click();
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Beta')]);
        await clearLog(page);

        await page.getByRole('button', { name: 'Remove from library' }).click();
        await page.waitForTimeout(300);
        expect(await serviceCalls(page)).toEqual([]);
        await page.getByRole('button', { name: 'Remove from library' }).last().click();
        await expect.poll(() => serviceCalls(page)).toEqual([
            { name: 'deleteFolderSongs', args: ['Music/Beta'] },
            { name: 'deleteSongsByIds', args: [homeLocalSongIds(homeLocalSongsIn('Music/Beta'))] },
        ]);
        await clearLog(page);

        await page.locator('button[title="Remove imported root"]').first().click();
        await page.waitForTimeout(300);
        expect(await serviceCalls(page)).toEqual([]);
        await page.getByRole('button', { name: 'Remove imported root' }).last().click();
        await expect.poll(async () => (await serviceCalls(page))[0]).toEqual({ name: 'removeImportedRoot', args: ['Extra'] });
    });

    test('play from the palette reaches the playback port with the same songs as the panel button', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        await showMap(page);
        await page.locator('button[class*="group/grid-title"]').click();
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([]);
        await page.locator('button[role="checkbox"][title="Music/Beta"]').click();
        await page.locator('[data-ponder-page-scope="local-grid-map-page"] .theme-polaroid-card', { hasText: 'Extra' }).dispatchEvent('click');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Extra'), homeFolderId('Music/Beta')]);
        await clearLog(page);

        expect(await runDirectoryCommand(page, 'directory-play-selection')).toBe(true);
        await expect.poll(async () => (await calls(page, 'playAll')).length).toBe(1);
        await page.getByRole('button', { name: 'Play 3 songs' }).click();
        await expect.poll(async () => (await calls(page, 'playAll')).length).toBe(2);
        const [fromPalette, fromPanel] = (await calls(page, 'playAll')).map(call => call.ids);
        expect(fromPalette).toEqual(fromPanel);
        expect(fromPalette).toEqual(localKeys([...homeLocalSongsIn('Extra'), ...homeLocalSongsIn('Music/Beta')]));
    });

    test('remove from the palette asks for the same confirmation as the panel button', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        await showBatch(page);
        await page.locator('button[role="checkbox"][title="Music/Beta"]').click();
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Beta')]);
        await clearLog(page);

        expect(await runDirectoryCommand(page, 'directory-remove-selection')).toBe(true);
        await page.waitForTimeout(300);
        expect(await serviceCalls(page)).toEqual([]);
        await page.getByRole('button', { name: 'Remove from library' }).last().click();
        await expect.poll(() => serviceCalls(page)).toEqual([
            { name: 'deleteFolderSongs', args: ['Music/Beta'] },
            { name: 'deleteSongsByIds', args: [homeLocalSongIds(homeLocalSongsIn('Music/Beta'))] },
        ]);
    });

    test('the eye button on a card hides it while the hide editor is on', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showMap(page);
        expect(await setHiddenView(page, 'manage')).toBe(true);
        await page.locator('.theme-polaroid-card', { hasText: 'Owned Playlist' }).getByTitle('Hide playlist').click();
        await expect.poll(() => storedHidden(page)).toEqual({ [`online:${A}`]: ['owned'] });
        await expect.poll(async () => (await mapItems(page)).find(item => item.id === 'owned')?.hidden).toBe(true);
        expect(await visibleIds(page)).not.toContain('owned');
    });
});

// ---- 在两套 suite 之间切换（P3.4） ----
// 首页数据与目录会话的寿命跟语义走：换 suite 不重新请求；目录会话（筛选词、选择、管理隐藏视图）跟着
// 「目录打开 / 关闭」，换 suite 不丢，关闭目录在两套里都丢掉会话。
const tuiHome = (page: Page) => page.locator('[data-library-home="tui"]');
const tuiRows = (page: Page) => tuiHome(page).locator('[data-tui-home-row]');
const tuiRowOf = (page: Page, itemId: string) => tuiHome(page).locator(`[data-library-entry="${itemId}"]`);
const focusedTuiRow = (page: Page) => tuiHome(page).locator('[data-tui-home-row][aria-selected="true"]');
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
const playAllIds = async (page: Page) => (await calls(page, 'playAll')).map(call => call.ids);
const ALPHA = homeFolderId('Music/Alpha');
const LIVE = homeFolderId('Music/Alpha/Live');
const BETA = homeFolderId('Music/Beta');
const EXTRA = homeFolderId('Extra');

test.describe('[switch] grid and TUI share the home', () => {
    test('filter and selection made in GridMap carry over to the TUI and back; batch play is the same; nothing is refetched', async ({ mount, page }) => {
        await mountHome(mount, page);
        await showList(page, 'local');
        await showMap(page);
        expect(await setQuery(page, 'music')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual([ALPHA, LIVE, BETA]);
        expect(await openPanel(page)).toBe(true);
        await batchSelect(page, [BETA, ALPHA]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([ALPHA, BETA]);
        await clearLog(page);
        expect(await runBatch(page, 'play')).toBe(true);
        const gridPlay = await playAllIds(page);
        expect(gridPlay).toEqual([localKeys([...homeLocalSongsIn('Music/Alpha'), ...homeLocalSongsIn('Music/Beta')])]);
        await clearLog(page);

        await setSuite(page, 'tui');
        await expect.poll(() => getQuery(page)).toBe('music');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([ALPHA, BETA]);
        expect(await mapIds(page)).toEqual([ALPHA, LIVE, BETA]);
        await expect(tuiHome(page).locator('[data-tui-filter]')).toContainText('music');
        expect(await runBatch(page, 'play')).toBe(true);
        // TUI 的键：Ctrl+Enter 播放选中的范围，与网格的面板按钮同一份歌。
        await blur(page);
        await page.keyboard.press('Control+Enter');
        await expect.poll(() => playAllIds(page)).toEqual([...gridPlay, ...gridPlay]);
        expect(await page.evaluate(() => window.__homeProbe!.requests())).toEqual([]);
        expect(await serviceCalls(page)).toEqual([]);

        await setSuite(page, 'grid');
        // 网格挂载时目录还开着、会话有筛选与选择：GridMap 与批量面板直接开着把它们显示出来。
        await expect.poll(() => isMapOpen(page)).toBe(true);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([ALPHA, BETA]);
        expect(await getQuery(page)).toBe('music');
        expect(await mapIds(page)).toEqual([ALPHA, LIVE, BETA]);
        expect(await page.evaluate(() => window.__homeProbe!.requests())).toEqual([]);
    });

    test('switching suites on the home requests nothing again: favorite albums, radio feed, Navidrome overview', async ({ mount, page }) => {
        await mountHome(mount, page);
        for (const tab of ['albums', 'radio', 'navidrome'] as const) {
            await showList(page, tab);
            await expect.poll(() => page.evaluate(() => window.__homeProbe!.isLoading())).toBe(false);
            const before = await itemIds(page);
            await page.waitForTimeout(200);
            await clearLog(page);

            await setSuite(page, 'tui');
            await expect.poll(() => itemIds(page)).toEqual(before);
            await setSuite(page, 'grid');
            await expect.poll(() => itemIds(page)).toEqual(before);
            await page.waitForTimeout(200);
            expect(await page.evaluate(() => window.__homeProbe!.requests()), tab).toEqual([]);
        }
    });

    test('closing the directory drops the query and the selection in both suites', async ({ mount, page }) => {
        await mountHome(mount, page, 'tui');
        await showList(page, 'local');
        expect(await setQuery(page, 'alpha')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual([ALPHA, LIVE]);
        await batchSelect(page, [ALPHA]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([ALPHA]);
        await hideMap(page);
        expect((await batchScope(page))?.itemIds).toEqual([]);

        // 关掉之后还是空会话：切到网格时地图不会自己打开。
        await setSuite(page, 'grid');
        await page.waitForTimeout(200);
        expect(await isMapOpen(page)).toBe(false);

        await showMap(page);
        expect(await setQuery(page, 'beta')).toBe(true);
        await expect.poll(() => mapIds(page)).toEqual([BETA]);
        await hideMap(page);
        await setSuite(page, 'tui');
        await expect.poll(() => getQuery(page)).toBe('');
        expect(await mapIds(page)).toEqual(HOME_LOCAL_FOLDER_IDS);
    });
});

test.describe('[tui-only] directory keys', () => {
    test('Insert selects and moves down, Ctrl+A selects the filtered rows, Ctrl+Enter plays the selection or the focused row', async ({ mount, page }) => {
        await mountHome(mount, page, 'tui');
        await showList(page, 'local');
        await expect(tuiRowOf(page, EXTRA)).toHaveCount(1);
        await tuiRowOf(page, EXTRA).click();
        await expect(tuiRowOf(page, EXTRA)).toHaveAttribute('aria-selected', 'true');
        await blur(page);

        await page.keyboard.press('Insert');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([EXTRA]);
        // 下一行是没有直属歌曲的 Music：Insert 选中它下面显示着的全部文件夹。
        await expect(focusedTuiRow(page)).toHaveAttribute('data-tui-home-key', /^node:/);
        await page.keyboard.press('Insert');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([EXTRA, ALPHA, LIVE, BETA]);

        await clearLog(page);
        await page.keyboard.press('Control+Enter');
        await expect.poll(() => playAllIds(page)).toEqual([localKeys([
            ...homeLocalSongsIn('Extra'), ...homeLocalSongsIn('Music/Alpha'), ...homeLocalSongsIn('Music/Alpha/Live'), ...homeLocalSongsIn('Music/Beta'),
        ])]);

        await page.keyboard.press('Control+a');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual(HOME_LOCAL_FOLDER_IDS);

        // Esc（没有筛选词时）关闭目录：选择丢掉。之后 Ctrl+Enter 播放焦点那一行，Ctrl+Shift+Enter 入队。
        await page.keyboard.press('Escape');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([]);
        await tuiRowOf(page, BETA).click();
        await blur(page);
        await clearLog(page);
        await page.keyboard.press('Control+Enter');
        await expect.poll(() => playAllIds(page)).toEqual([localKeys(homeLocalSongsIn('Music/Beta'))]);
        // 批量动作同一时间只做一个：等播放做完（批量控制器不再忙）再入队。
        await expect(tuiHome(page).locator('[data-tui-busy]')).toHaveCount(0);
        await page.keyboard.press('Control+Shift+Enter');
        await expect.poll(async () => (await calls(page, 'addAllToQueue')).map(call => call.ids)).toEqual([localKeys(homeLocalSongsIn('Music/Beta'))]);
    });

    test('the folder tree folds with arrows; Enter opens the TUI collection and Back returns with the focus kept', async ({ mount, page }) => {
        await mountHome(mount, page, 'tui');
        await showList(page, 'local');
        await tuiRowOf(page, ALPHA).click();
        await blur(page);
        await page.keyboard.press('ArrowLeft');
        await expect(tuiRowOf(page, LIVE)).toHaveCount(0);
        await page.keyboard.press('ArrowRight');
        await expect(tuiRowOf(page, LIVE)).toHaveCount(1);

        await page.keyboard.press('Enter');
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:folder:${ALPHA}`);
        await expect(page.locator('[data-library-renderer="tui"]')).toHaveCount(1);
        await page.waitForTimeout(250);
        await page.locator('[data-library-renderer="tui"]').getByRole('button', { name: /Back/ }).click();
        await expect(page.locator('[data-library-renderer]')).toHaveCount(0);
        await expect(focusedTuiRow(page)).toHaveAttribute('data-library-entry', ALPHA);
        await blur(page);
        await page.keyboard.press('ArrowDown');
        await expect(focusedTuiRow(page)).toHaveAttribute('data-library-entry', LIVE);
    });

    test('commands on the focused row: hide a playlist, rescan or remove a root, restore an ignored folder; removals ask first', async ({ mount, page }) => {
        await mountHome(mount, page, 'tui');
        await tuiRowOf(page, 'owned').click();
        await expect.poll(() => directoryCommands(page)).toEqual(['directory-manage-hidden', 'directory-toggle-hidden']);
        expect(await runDirectoryCommand(page, 'directory-toggle-hidden')).toBe(true);
        await expect.poll(() => storedHidden(page)).toEqual({ [`online:${A}`]: ['owned'] });
        await expect(tuiRowOf(page, 'owned')).toHaveCount(0);

        await showList(page, 'local');
        const musicRow = tuiHome(page).locator('[data-tui-home-key^="node:"]', { hasText: 'Music' }).first();
        await musicRow.click();
        await expect.poll(() => directoryCommands(page)).toEqual(['directory-select-all', 'directory-rescan-root', 'directory-remove-root']);
        await clearLog(page);
        expect(await runDirectoryCommand(page, 'directory-rescan-root')).toBe(true);
        await expect.poll(() => serviceCalls(page)).toEqual([{ name: 'resyncFolder', args: ['Music'] }]);

        await tuiRows(page).filter({ hasText: 'Hidden' }).click();
        await expect.poll(() => directoryCommands(page)).toContain('directory-clear-ignore');
        await clearLog(page);
        expect(await runDirectoryCommand(page, 'directory-clear-ignore')).toBe(true);
        await expect.poll(() => serviceCalls(page)).toEqual([{ name: 'clearFolderIgnore', args: [HOME_LOCAL_IGNORED_FOLDER] }]);

        // 新建歌单的行内输入；从曲库删除选中的先确认。
        await tuiRowOf(page, BETA).click();
        await blur(page);
        await page.keyboard.press('Insert');
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([BETA]);
        await tuiHome(page).locator('[data-tui-create-playlist]').click();
        await page.locator('[data-tui-prompt="create-playlist"] input').fill('Inline Mix');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await localPlaylists(page)).find(playlist => playlist.name === 'Inline Mix')?.songIds)
            .toEqual(homeLocalSongIds(homeLocalSongsIn('Music/Beta')));
        await expect(page.locator('[data-tui-prompt]')).toHaveCount(0);

        await clearLog(page);
        expect(await runDirectoryCommand(page, 'directory-remove-selection')).toBe(true);
        await expect(page.locator('[data-tui-prompt="remove-selection"]')).toBeFocused();
        await page.waitForTimeout(200);
        expect(await serviceCalls(page)).toEqual([]);
        await page.keyboard.press('Enter');
        await expect.poll(() => serviceCalls(page)).toEqual([
            { name: 'deleteFolderSongs', args: ['Music/Beta'] },
            { name: 'deleteSongsByIds', args: [homeLocalSongIds(homeLocalSongsIn('Music/Beta'))] },
        ]);

        await tuiRowOf(page, EXTRA).click();
        await expect.poll(() => directoryCommands(page)).toContain('directory-remove-root');
        await clearLog(page);
        expect(await runDirectoryCommand(page, 'directory-remove-root')).toBe(true);
        await expect(page.locator('[data-tui-prompt="remove-root:Extra"]')).toBeFocused();
        expect(await serviceCalls(page)).toEqual([]);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await serviceCalls(page))[0]).toEqual({ name: 'removeImportedRoot', args: ['Extra'] });
    });
});
