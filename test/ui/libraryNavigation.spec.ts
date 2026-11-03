import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp } from './helpers/appFixtures';
import { waitForAppMounted } from '../helpers/appState';

// test/ui/libraryNavigation.spec.ts
// 真实应用里集合的入口与返回（P4.0 基线）：搜索结果、播放器面板的封面页、集合里嵌套打开，以及浏览器后退与刷新。
// 行为探针只挂宿主，覆盖不到这一层——真实的 useAppNavigation（history state、hash）、搜索 / 播放器来源的返回落点。
//
// 数据是导入的本地曲库（一首「Test Artist - Midnight Train」，专辑「Fixture Album」）：不出网，歌手 / 专辑都有本地实体。
// P4.5 起「完成」语义由宿主统一：返回按钮 = 完成（清会话），浏览器后退 = 离开但保留（文件末尾两套 suite 各一条）；
// 浏览器后退也跑 suite 的 beforeBack（网格的反向移形换影，单独一条打开转场来看）。
// B11 起 bravais 也在这里：它的换层由 stage 观察导航深度驱动，根节点的 data-bravais-shift(-seq) 记下每次换层的种类，
// 用它数「每次返回只翻一次」（应用内返回、浏览器后退、N1 折回、面包屑跳层），以及从搜索页 / 播放页打开集合时的
// 整墙入场（enter）与回到来源时的整墙出场（exit）。

const collectionLayer = (page: Page) => page.locator('[data-library-renderer]');
const grid = (page: Page) => page.locator('[data-library-renderer="grid"]');
const tui = (page: Page) => page.locator('[data-library-renderer="tui"]');
const gridBack = (page: Page) => grid(page).locator('button').filter({ has: page.locator('svg.lucide-chevron-left') }).first();
const bravais = (page: Page) => page.locator('[data-library-renderer="bravais"]');
const bravaisStage = (page: Page) => page.locator('[data-library-stage="bravais"]');
/** 缝里的 ‹（完成：onDone）。 */
const bravaisBack = (page: Page) => bravaisStage(page).locator('[data-bravais-seam-action="back"]').first();
const crumb = (page: Page, kind: string) => bravaisStage(page).locator(`[data-bravais-crumb="${kind}"]`);
/** 等墙上的翻牌放完。 */
const waitForWall = (page: Page) => expect(page.locator('[data-library-stage="bravais"][data-bravais-settling]')).toHaveCount(0);
/**
 * 从现在起记下 bravais stage 每一次换层的种类（push / back / replace / enter / exit / first）。stage 可能卸载再挂载
 * （去播放页再回来），所以盯整个文档，按「哪个根节点 + 序号」认新的一次。
 */
const watchShifts = (page: Page) => page.evaluate(() => {
    const record: string[] = [];
    const flag = window as unknown as { __bravaisShifts?: string[] };
    flag.__bravaisShifts = record;
    let lastRoot: Element | null = document.querySelector('[data-library-stage="bravais"]');
    let lastSeq = lastRoot?.getAttribute('data-bravais-shift-seq') ?? null;
    new MutationObserver(() => {
        const root = document.querySelector('[data-library-stage="bravais"]');
        const seq = root?.getAttribute('data-bravais-shift-seq') ?? null;
        if (!root || seq === null || (root === lastRoot && seq === lastSeq)) return;
        lastRoot = root;
        lastSeq = seq;
        record.push(root.getAttribute('data-bravais-shift') ?? '');
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-bravais-shift-seq'] });
});
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __bravaisShifts?: string[] }).__bravaisShifts ?? []);
const historyState = (page: Page) => page.evaluate(() => ({
    hash: window.location.hash,
    view: (window.history.state as { view?: string } | null)?.view ?? null,
    stack: ((window.history.state as { collection?: { stack: Array<{ name: string }> } | null } | null)?.collection?.stack ?? [])
        .map(entry => entry.name),
    origin: (window.history.state as { collection?: { origin?: string } | null } | null)?.collection?.origin ?? null,
}));
const searchResult = (page: Page) => page.getByRole('button', { name: 'Play track' });
/** 命令面板筛选框背后的同一个端口（当前可交互的集合层注册的那个）：读 / 写浏览会话里的筛选词。 */
const readQuery = (page: Page) => page.evaluate(async () => {
    const modulePath = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(/* @vite-ignore */ modulePath);
    return (useAppViewStore.getState().commandFilter?.getQuery() ?? null) as string | null;
});
const setQuery = (page: Page, query: string) => page.evaluate(async value => {
    const modulePath = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(/* @vite-ignore */ modulePath);
    useAppViewStore.getState().commandFilter?.setQuery(value);
}, query);

/**
 * 导入本地曲库，停在网格首页的本地页签上。collectionMorph：打开歌单展开转场（基线把所有动效面都降级了，
 * 这里在它的初始化脚本之后再撤掉这一面）。
 */
const openLocalHome = async (page: Page, options: { collectionMorph?: boolean } = {}) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    if (options.collectionMorph) {
        await page.addInitScript(() => localStorage.removeItem('reduce_motion_collectionMorph'));
    }
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
};

/**
 * 在本地页签的搜索框里搜。导入之后曲库的实体目录要晚一拍才就绪，那之前的结果不带实体（歌手链接是灰的、没有专辑）；
 * 搜索页按当前目录重算展示，目录到了同一行就会补上链接，所以提交一次、等链接可点即可。
 * 以前这里反复回车直到链接可点，但轮询里的 isEnabled() 对不存在的专辑按钮会一直等下去（不会抛错落到 catch），
 * 第一次回车搜在目录之前就把整个轮询卡满 15s。
 */
const searchLocal = async (page: Page, query: string) => {
    const input = page.getByPlaceholder('Search local songs...');
    await input.fill(query);
    await input.press('Enter');
    await expect(searchResult(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Fixture Album' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Test Artist' })).toBeEnabled();
    expect(await historyState(page)).toMatchObject({ hash: `#search/${query}`, view: 'home', stack: [] });
};

/**
 * 换成 bravais 后等它的 stage 挂上（stage 是 lazy 的）。搜索页下面的首页外壳还挂着，stage 会在那里先显示一次首页层
 * （记成 first）；不等的话，这次挂载可能落在 watchShifts 之后、点击之前（记下 first + enter），也可能落在点击之后
 * （直接以 enter 挂上），用例就随 chunk 的加载快慢时过时不过。
 */
const waitForBravaisStage = (page: Page) => expect(bravaisStage(page)).toHaveAttribute('data-bravais-shift-seq', /.+/);

/** 搜索页还在、结果还在：返回落回的就是离开时的那一页。 */
const expectSearchResults = async (page: Page, query: string) => {
    await expect(collectionLayer(page)).toHaveCount(0);
    await expect(page.getByPlaceholder('Search songs...')).toHaveValue(query);
    await expect(searchResult(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Test Artist' })).toBeEnabled();
    expect(await historyState(page)).toMatchObject({ hash: `#search/${query}`, view: 'home', stack: [] });
};

test.describe('search results', () => {
    test('[grid] an album opens as a collection, and Back returns to the search with its results', async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');

        await page.getByRole('button', { name: 'Fixture Album' }).click();
        await expect(grid(page)).toHaveCount(1);
        await expect(grid(page)).toHaveAttribute('data-library-surface', 'collection');
        await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();
        expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Fixture Album'], origin: 'search' });
        expect((await historyState(page)).hash).toMatch(/^#collection\/local\/album\//);

        await gridBack(page).click();
        await expectSearchResults(page, 'Midnight');
    });

    test('[grid] an artist opens the artist page, and Back returns to the search with its results', async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');

        await page.getByRole('button', { name: 'Test Artist' }).click();
        await expect(grid(page)).toHaveAttribute('data-library-surface', 'artist');
        await expect(grid(page).getByRole('heading', { name: 'Test Artist' })).toBeVisible();
        expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Test Artist'], origin: 'search' });

        await gridBack(page).click();
        await expectSearchResults(page, 'Midnight');
    });

    test('[tui] with the TUI selected an album opens in the TUI, and Back returns to the search', async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');
        await selectSuite(page, 'tui');

        await page.getByRole('button', { name: 'Fixture Album' }).click();
        await expect(tui(page)).toHaveCount(1);
        await expect(tui(page).locator('[data-tui-title]')).toHaveText('Fixture Album');
        await expect(tui(page).locator('[data-tui-row="0"]')).toContainText('Midnight Train');

        await tui(page).locator('[data-tui-back]').click();
        await expectSearchResults(page, 'Midnight');
    });

    // P4.3 起 TUI 自己渲染歌手页（以前回退到网格歌手页）。
    test('[tui] with the TUI selected an artist opens the TUI artist page, and Back returns to the search', async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');
        await selectSuite(page, 'tui');

        await page.getByRole('button', { name: 'Test Artist' }).click();
        await expect(tui(page)).toHaveAttribute('data-library-surface', 'artist');
        await expect(grid(page)).toHaveCount(0);
        await expect(tui(page).locator('[data-tui-title]')).toHaveText('Test Artist');
        await expect(tui(page).locator('[data-tui-artist-songs]')).toContainText('Midnight Train');
        await expect(tui(page).locator('[data-tui-artist-albums]')).toContainText('Fixture Album');
        expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Test Artist'], origin: 'search' });

        // 真点返回：页头在桌面版自绘标题栏的拖拽区之下（根节点 pt-8），点得到。
        await tui(page).locator('[data-tui-back]').click();
        await expectSearchResults(page, 'Midnight');
    });

    // B11：搜索页下面没有首页墙——打开是整墙入场（不是从首页翻过去），‹ 回到搜索页是整墙出场；面包屑的根是「搜索」。
    test('[bravais] an album from the search enters the whole wall, and Back exits it to the search', async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');
        await selectSuite(page, 'bravais');
        await waitForBravaisStage(page);
        await watchShifts(page);

        await page.getByRole('button', { name: 'Fixture Album' }).click();
        await expect(bravais(page)).toHaveAttribute('data-library-surface', 'collection');
        await expect(bravaisStage(page).locator('[data-bravais-seam-title]').first()).toHaveText('Fixture Album');
        await expect(bravaisStage(page).locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
        expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Fixture Album'], origin: 'search' });
        await expect.poll(() => shifts(page)).toEqual(['enter']);
        await expect(crumb(page, 'root')).toHaveText('Search');

        await waitForWall(page);
        await bravaisBack(page).click();
        await expectSearchResults(page, 'Midnight');
        await expect.poll(() => shifts(page)).toEqual(['enter', 'exit']);
    });

    test('[bravais] an artist from the search opens the bravais artist page, and Back returns to the search', async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');
        await selectSuite(page, 'bravais');
        await waitForBravaisStage(page);
        await watchShifts(page);

        await page.getByRole('button', { name: 'Test Artist' }).click();
        await expect(bravais(page)).toHaveAttribute('data-library-surface', 'artist');
        await expect(grid(page)).toHaveCount(0);
        await expect(bravaisStage(page).locator('[data-bravais-seam-title]').first()).toHaveText('Test Artist');
        expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Test Artist'], origin: 'search' });
        await expect.poll(() => shifts(page)).toEqual(['enter']);

        await waitForWall(page);
        await bravaisBack(page).click();
        await expectSearchResults(page, 'Midnight');
        await expect.poll(() => shifts(page)).toEqual(['enter', 'exit']);
    });
});

// 搜索结果是提交那一刻的快照。导入后紧接着搜，实体目录还没加载完，快照里的行没有专辑、歌手不带实体；
// 搜索页渲染时要按当前目录重算，否则这些行会一直缺链接到重新搜索为止。这里把 store 里的结果换回那种快照，
// 确定性地复现「目录比搜索晚到」，不靠机器负载去撞时序。
test('local search results pick up the entity catalog that arrives after the search', async ({ page }) => {
    await openLocalHome(page);
    await searchLocal(page, 'Midnight');

    await page.evaluate(async () => {
        const modulePath = '/src/stores/useSearchNavigationStore.ts';
        const { useSearchNavigationStore } = await import(/* @vite-ignore */ modulePath);
        const results = useSearchNavigationStore.getState().searchResults as Array<{
            artists: Array<{ id: number; name: string }>;
            album?: Record<string, unknown>;
        }>;
        useSearchNavigationStore.setState({
            searchResults: results.map(track => ({
                ...track,
                artists: track.artists.map(artist => ({ id: 0, name: artist.name })),
                album: { ...track.album, id: 0, name: '', entityId: undefined },
            })),
        });
    });

    await expect(searchResult(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Fixture Album' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Test Artist' })).toBeEnabled();
});

test('the player panel Cover tab opens the album, and Back returns to the player', async ({ page }) => {
    await openLocalHome(page);
    await searchLocal(page, 'Midnight');
    await searchResult(page).click();
    await expect.poll(async () => (await historyState(page)).view).toBe('player');
    await expect(page.getByTestId('panel-toggle')).toBeVisible();

    await page.getByTestId('panel-toggle').locator('button').last().click();
    // 封面页是面板的默认页：歌名下面是歌手与专辑，点专辑名打开它。
    await page.getByText('Fixture Album', { exact: true }).last().click();
    await expect(grid(page)).toHaveAttribute('data-library-surface', 'collection');
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();
    expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Fixture Album'], origin: 'player' });

    await gridBack(page).click();
    await expect(collectionLayer(page)).toHaveCount(0);
    await expect.poll(async () => (await historyState(page)).view).toBe('player');
    expect(await historyState(page)).toMatchObject({ hash: '#player', stack: [] });
    await expect(page.getByTestId('panel-toggle')).toBeVisible();
});

// B11：从播放页打开的集合下面也没有首页墙（首页外壳那时已卸载，stage 随打开重新挂载）：整墙入场；‹ 回到播放页是整墙出场。
test('[bravais] the player panel Cover tab enters the album as a whole wall, and Back exits it to the player', async ({ page }) => {
    await openLocalHome(page);
    await searchLocal(page, 'Midnight');
    await selectSuite(page, 'bravais');
    await searchResult(page).click();
    await expect.poll(async () => (await historyState(page)).view).toBe('player');
    await expect(page.getByTestId('panel-toggle')).toBeVisible();
    await watchShifts(page);

    await page.getByTestId('panel-toggle').locator('button').last().click();
    await page.getByText('Fixture Album', { exact: true }).last().click();
    await expect(bravais(page)).toHaveAttribute('data-library-surface', 'collection');
    await expect(bravaisStage(page).locator('[data-bravais-seam-title]').first()).toHaveText('Fixture Album');
    expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['Fixture Album'], origin: 'player' });
    await expect.poll(() => shifts(page)).toEqual(['enter']);
    await expect(crumb(page, 'root')).toHaveText('Now Playing');

    await waitForWall(page);
    await bravaisBack(page).click();
    await expect.poll(async () => (await historyState(page)).view).toBe('player');
    expect(await historyState(page)).toMatchObject({ hash: '#player', stack: [] });
    await expect.poll(() => shifts(page)).toEqual(['enter', 'exit']);
    await expect(page.getByTestId('panel-toggle')).toBeVisible();
});

test('a nested album pops one level on browser back, and the next back leaves the collection', async ({ page }) => {
    await openLocalHome(page);
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(grid(page)).toHaveCount(1);
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();
    expect(await historyState(page)).toMatchObject({ view: 'home', stack: ['All Songs'], origin: 'home' });

    // 曲目卡片上的专辑名：在集合里嵌套压入这张专辑。
    await grid(page).getByText('Fixture Album', { exact: true }).first().dispatchEvent('click');
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Fixture Album']);
    await expect(grid(page)).toHaveCount(1);

    await page.goBack();
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs']);
    await expect(grid(page)).toHaveCount(1);
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();

    await page.goBack();
    await expect(collectionLayer(page)).toHaveCount(0);
    expect(await historyState(page)).toMatchObject({ view: 'home', stack: [] });
    await expect(page.getByText('All Songs').first()).toBeVisible();
});

// 刷新后不恢复打开的集合：P4 决定维持现状（非目标），这里把它钉住，改变它要有意为之。
test('reloading with a collection open lands on the home without it', async ({ page }) => {
    await openLocalHome(page);
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(grid(page)).toHaveCount(1);
    expect((await historyState(page)).hash).toMatch(/^#collection\/local\//);

    await page.reload();
    await waitForAppMounted(page);
    // installBaseState 的初始化脚本在刷新时会再跑一次（localStorage 回到「歌单」页签），导入的曲库在 IndexedDB 里还在。
    await expect(page.getByRole('button', { name: 'Folder' }).last()).toBeVisible();
    await page.waitForTimeout(800);
    await expect(collectionLayer(page)).toHaveCount(0);
    expect(await historyState(page)).toMatchObject({ view: 'home', stack: [] });
    expect((await historyState(page)).hash).not.toMatch(/^#collection/);
});

// P4.5：「完成」与「离开」由宿主统一，两套 suite 同一个手势同一个含义——显式的返回按钮 = 看完了（清掉这一层的
// 浏览会话与网格的布局记录），浏览器后退 = 离开但保留（Escape 同样保留，探针里覆盖）。筛选词在浏览会话里，所以用它来看。
for (const suite of ['grid', 'tui', 'bravais'] as const) {
    test(`[${suite}] browser back keeps the filter, the Back button forgets it`, async ({ page }) => {
        await openLocalHome(page);
        await searchLocal(page, 'Midnight');
        await selectSuite(page, suite);
        const layer = suite === 'grid' ? grid(page) : suite === 'tui' ? tui(page) : bravais(page);
        const openAlbum = async () => {
            await page.getByRole('button', { name: 'Fixture Album' }).click();
            await expect(layer).toHaveAttribute('data-library-surface', 'collection');
            await expect.poll(() => readQuery(page)).not.toBeNull();
        };

        await openAlbum();
        await setQuery(page, 'midnight');
        await expect.poll(() => readQuery(page)).toBe('midnight');

        await page.goBack();
        await expectSearchResults(page, 'Midnight');
        await openAlbum();
        await expect.poll(() => readQuery(page)).toBe('midnight');

        if (suite === 'grid') await gridBack(page).click();
        else if (suite === 'tui') await tui(page).locator('[data-tui-back]').click();
        else await bravaisBack(page).click();
        await expectSearchResults(page, 'Midnight');
        await openAlbum();
        await expect.poll(() => readQuery(page)).toBe('');
    });
}

// P4.5：浏览器后退（popstate）与应用内返回一样先跑渲染这一层的 suite 的 beforeBack——网格的反向移形换影（嵌套返回时
// hero 收回、卡片散开）。以前 popstate 绕过宿主，网格直接切走、没有转场。这一条要打开歌单展开转场（基线默认把动效全关了）。
test('[grid] browser back from a nested album plays the reverse transition', async ({ page }) => {
    await openLocalHome(page, { collectionMorph: true });
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(grid(page)).toHaveCount(1);
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();
    await grid(page).getByText('Fixture Album', { exact: true }).first().dispatchEvent('click');
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Fixture Album']);
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();
    await page.waitForTimeout(1500);

    // 退场层只存在几百毫秒：用 MutationObserver 记下它出现过。
    await page.evaluate(() => {
        const flag = window as unknown as { __exitSeen?: boolean };
        flag.__exitSeen = false;
        new MutationObserver(() => {
            if (document.querySelector('[data-folia-collection-morph="exit-backdrop"]')) flag.__exitSeen = true;
        }).observe(document.body, { childList: true, subtree: true });
    });
    await page.goBack();
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs']);
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __exitSeen?: boolean }).__exitSeen))).toBe(true);
    await expect(page.locator('[data-folia-collection-morph="exit-backdrop"]')).toHaveCount(0, { timeout: 5_000 });
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();
});

// N1（折叠紧邻往返）：在歌手页和专辑页之间来回点，栈和浏览器历史都不再变长——要进入的歌手正好是上一层时当作一次
// 应用内返回（history.back()），栈深保持 2–3。返回（应用内或浏览器后退）落到上一个不同的集合，网格的反向转场每次
// 返回只跑一次（折回也算一次返回）。要打开歌单展开转场才有反向转场可数。
test('[grid] bouncing between an artist and an album keeps the depth at 2–3, and each back reverses once', async ({ page }) => {
    await openLocalHome(page, { collectionMorph: true });
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(grid(page)).toHaveCount(1);
    await expect(grid(page).getByText('Midnight Train').first()).toBeVisible();

    // 转场期间退场的那一层还在 DOM 里：只看当前那一层（网格给它或它的卡片容器打 data-folia-active-grid）。
    const active = (surface: 'artist' | 'collection') => page.locator(
        `[data-library-renderer="grid"][data-library-surface="${surface}"]:is([data-folia-active-grid], :has([data-folia-active-grid]))`,
    );
    const openArtist = async () => {
        // 曲目卡片上的歌手名（专辑页头的歌手名不是链接）。
        await active('collection').locator('[data-folia-grid-item-id]').getByText('Test Artist', { exact: true }).first().dispatchEvent('click');
        await expect(active('artist')).toHaveCount(1);
        await expect(active('artist').getByRole('heading', { name: 'Test Artist' })).toBeVisible();
    };
    const openAlbum = async () => {
        await active('artist').getByText('Fixture Album', { exact: true }).first().dispatchEvent('click');
        await expect(active('collection')).toHaveCount(1);
        await expect(active('collection').getByText('Midnight Train').first()).toBeVisible();
    };
    const historyLength = () => page.evaluate(() => window.history.length);
    // 反向转场的次数：网格的 beforeBack 每次都经转场 store 的 armExit / armNestedExit 武装，包一层计数。
    const reverseRuns = () => page.evaluate(() => (window as unknown as { __reverseRuns?: number }).__reverseRuns ?? 0);
    await page.evaluate(async () => {
        const modulePath = '/src/library/suites/grid/transitions/collectionMorphStore.ts';
        const { useCollectionMorphStore } = await import(/* @vite-ignore */ modulePath);
        const flag = window as unknown as { __reverseRuns?: number };
        flag.__reverseRuns = 0;
        const { armExit, armNestedExit } = useCollectionMorphStore.getState();
        useCollectionMorphStore.setState({
            armExit: (...args: unknown[]) => { flag.__reverseRuns! += 1; return armExit(...args); },
            armNestedExit: (...args: unknown[]) => { flag.__reverseRuns! += 1; return armNestedExit(...args); },
        });
    });

    await openArtist();
    await openAlbum();
    expect(await historyState(page)).toMatchObject({ stack: ['All Songs', 'Test Artist', 'Fixture Album'] });
    const deepestLength = await historyLength();

    for (let round = 1; round <= 4; round += 1) {
        await page.waitForTimeout(600);
        await openArtist();
        await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist']);
        await expect.poll(reverseRuns).toBe(round);
        await page.waitForTimeout(600);
        await openAlbum();
        await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist', 'Fixture Album']);
        expect(await historyLength()).toBe(deepestLength);
    }
    expect(await reverseRuns()).toBe(4);

    // 浏览器后退：落到上一个不同的集合（歌手页），反向转场一次。
    await page.waitForTimeout(600);
    await page.goBack();
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist']);
    await expect(active('artist')).toHaveCount(1);
    await expect.poll(reverseRuns).toBe(5);

    // 前进回到专辑，再用应用内返回：落在同一层，反向转场同样只一次。
    await page.goForward();
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist', 'Fixture Album']);
    await expect(active('collection')).toHaveCount(1);
    await page.waitForTimeout(600);
    await active('collection').locator('button').filter({ has: page.locator('svg.lucide-chevron-left') }).first().click();
    await expect.poll(async () => (await historyState(page)).stack).toEqual(['All Songs', 'Test Artist']);
    await expect(active('artist')).toHaveCount(1);
    await page.waitForTimeout(600);
    expect(await reverseRuns()).toBe(6);
});

// B11：bravais 的每一种返回都只翻一次——应用内返回（‹）、浏览器后退、N1 折回（聚焦卡上点上一层的歌手）、面包屑跳层
// （列表面板开着，跳过折叠的中间层回到第 1 层；导航层越过面板记录）都是一次深度变浅，stage 各记一次 back；压栈各记一次
// push。bravais 不声明 beforeBack，翻牌由 stage 观察深度驱动，所以这里数的是 stage 的换层，不是钩子。
test('[bravais] every way back flips the wall once: Back, browser back, the N1 fold and a breadcrumb jump past the list panel', async ({ page }) => {
    await openLocalHome(page);
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(grid(page)).toHaveCount(1);
    await selectSuite(page, 'bravais');
    await expect(bravais(page)).toHaveAttribute('data-library-surface', 'collection');
    await expect(bravaisStage(page).locator('.bravais-tile[data-library-entry]').first()).toBeAttached();

    const stackNow = async () => (await historyState(page)).stack;
    // 聚焦卡上的歌手（全部歌曲、专辑页都有这一首）。
    const openArtist = async () => {
        await waitForWall(page);
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await page.locator('[data-bravais-focus-card]').getByRole('button', { name: 'Test Artist', exact: true }).click();
        await expect(bravais(page)).toHaveAttribute('data-library-surface', 'artist');
    };
    // 歌手墙上的专辑磁贴。
    const openAlbum = async () => {
        await waitForWall(page);
        await page.locator('.bravais-tile[data-bravais-kind="album"]').filter({ hasText: 'Fixture Album' }).first()
            .locator('article').dispatchEvent('click');
        await expect.poll(stackNow).toEqual(['All Songs', 'Test Artist', 'Fixture Album']);
        await expect(bravais(page)).toHaveAttribute('data-library-surface', 'collection');
    };
    const settle = async () => {
        await waitForWall(page);
        await page.waitForTimeout(400);
    };

    await openArtist();
    await openAlbum();
    await settle();
    await watchShifts(page);

    // 应用内返回（缝里的 ‹）。
    await bravaisBack(page).click();
    await expect.poll(stackNow).toEqual(['All Songs', 'Test Artist']);
    await settle();
    expect(await shifts(page)).toEqual(['back']);

    // 浏览器后退。
    await openAlbum();
    await settle();
    await page.goBack();
    await expect.poll(stackNow).toEqual(['All Songs', 'Test Artist']);
    await settle();
    expect(await shifts(page)).toEqual(['back', 'push', 'back']);

    // N1 折回：专辑页的聚焦卡上点歌手（正好是上一层）。
    await openAlbum();
    await settle();
    await openArtist();
    await expect.poll(stackNow).toEqual(['All Songs', 'Test Artist']);
    await settle();
    expect(await shifts(page)).toEqual(['back', 'push', 'back', 'push', 'back']);

    // 面包屑：列表面板开着，展开折叠的中间层，点第 1 层（全部歌曲）。面板记录被越过，落地后面板关着。
    await openAlbum();
    await settle();
    await bravaisStage(page).locator('[data-bravais-seam-action="list"]').click();
    await expect(page.locator('[data-bravais-list]')).toBeVisible();
    await expect(crumb(page, 'current')).toHaveText('Fixture Album');
    await expect(crumb(page, 'panel')).toHaveCount(1);
    await expect(crumb(page, 'layer')).toHaveText('Test Artist');
    await crumb(page, 'more').click();
    await expect(crumb(page, 'layer')).toHaveText(['All Songs', 'Test Artist']);
    await bravaisStage(page).locator('[data-bravais-crumb="layer"][data-bravais-crumb-depth="1"]').click();
    await expect.poll(stackNow).toEqual(['All Songs']);
    await expect(page.locator('[data-bravais-list]')).toHaveCount(0);
    await settle();
    expect(await shifts(page)).toEqual(['back', 'push', 'back', 'push', 'back', 'push', 'back']);

    // 根（书库）：整个关掉，回到首页墙。
    await expect(crumb(page, 'root')).toHaveText('Library');
    await crumb(page, 'root').click();
    await expect.poll(stackNow).toEqual([]);
    await expect(collectionLayer(page)).toHaveCount(0);
    await settle();
    expect(await shifts(page)).toEqual(['back', 'push', 'back', 'push', 'back', 'push', 'back', 'back']);
});

/**
 * 切换 suite。搜索页盖住了开发版浮层（浮层在首页之上、搜索页之下），所以直接调浮层按钮背后的同一个函数
 * （switchLibrarySuite：先冲刷会话、清网格转场，再写 suite store）。
 */
async function selectSuite(page: Page, suite: 'grid' | 'tui' | 'bravais') {
    await page.evaluate(async id => {
        const modulePath = '/src/library/app/switchLibrarySuite.ts';
        const { switchLibrarySuite } = await import(/* @vite-ignore */ modulePath);
        switchLibrarySuite('home', id);
    }, suite);
    await expect.poll(() => page.evaluate(async () => {
        const modulePath = '/src/library/core/suite/useLibrarySuiteStore.ts';
        const { useLibrarySuiteStore } = await import(/* @vite-ignore */ modulePath);
        return useLibrarySuiteStore.getState().suite as string;
    })).toBe(suite);
}
