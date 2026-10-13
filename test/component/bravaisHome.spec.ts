import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import { HOME_FM_COUNT, HOME_FM_PREFIX, homeUserName, onlinePlaybackKey, onlineSongId, PROBE_PROVIDER_A, PROBE_PROVIDER_B } from '../../dev/probes/libraryBehavior/fixtureRules';
import { HOME_LOCAL_FOLDER_IDS, homeFolderId } from '../../dev/probes/homeBehavior/homeFixtureRules';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisHome.spec.ts
// B9 bravais 首页的组件用例（homeBehavior 探针 + setSuite('bravais')），覆盖参数化用例（homeBehavior.spec）摸不到的
// bravais 专属界面：换页签的整墙出场 / 入场与 F6、私人 FM 直接播放、本地四行是缝里的二级切换（不换层）、目录树面板
// （批量模式：墙退化为有限拼贴、点卡片只切换选中、批量按键、确认态、关面板丢掉选择）、管理隐藏视图与眼睛按钮、
// 缝里的全局搜索（提交走 onSearchCommitted）、本地「⋯」与 Navidrome 刷新。
// 墙是虚拟化的：只找此刻在 DOM 里的磁贴；探针左下角的 DEV 浮层可能盖住磁贴，点磁贴用派发点击（同一个 onClick）。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('[data-bravais-seam]');
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const batchScope = (page: Page) => page.evaluate(() => window.__homeProbe!.batchScope());
const card = (page: Page, itemKey: string) => page.locator(`.bravais-tile[data-library-card="${itemKey}"]`).first();
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

/** fb3：二级切换（本地四行、Navidrome 的 section）只有激活项有文字，按 role / 可访问名（全名）找；只在中段里找，
 * 免得撞上同名的一级页签（Albums）。 */
const section = (page: Page, name: string) => seam(page).locator('[data-bravais-home-body]').getByRole('tab', { name, exact: true });

/** fb3：工具格固定四格，目录、管理隐藏、Navidrome 刷新等都在「⋯」菜单里：打开菜单、点那一项。 */
const runMenuItem = async (page: Page, id: string) => {
    await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
    await seam(page).locator(`[data-bravais-seam-menu] [data-bravais-seam-action="${id}"]`).click();
};

const showLocal = async (page: Page) => {
    await seam(page).locator('[data-bravais-tab="local"]').click();
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
    await settled(page);
    await expect(page.locator('.bravais-tile[data-library-card^="card:folder:"]').first()).toBeAttached();
};

test.describe('[bravais-only] home', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('switching tabs lifts the whole wall off and lands the next one; F6 cycles the tabs', async ({ page }) => {
        // 整墙出场 / 入场：内容层先抬起（出场的 WAAPI 动画往上抬 90 个世界单位），翻牌期间 stage 挂着 settling。
        // 点之前先装一个逐帧计数（记下同时在跑的「抬起」动画最多有几个）。
        await page.evaluate(() => {
            const probe = window as unknown as { __b9Lifted: number };
            probe.__b9Lifted = 0;
            const started = performance.now();
            const count = () => {
                const lifted = document.getAnimations().filter(animation => {
                    const keyframes = (animation.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
                    return keyframes.some(frame => String(frame.transform ?? '').includes('-90px'));
                }).length;
                probe.__b9Lifted = Math.max(probe.__b9Lifted, lifted);
                if (performance.now() - started < 2500) requestAnimationFrame(count);
            };
            requestAnimationFrame(count);
        });
        await seam(page).locator('[data-bravais-tab="albums"]').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-settling', 'true');
        await expect.poll(() => page.evaluate(() => (window as unknown as { __b9Lifted: number }).__b9Lifted)).toBeGreaterThan(5);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:albums');
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card^="card:album:"]').first()).toBeAttached();
        await expect(page.locator('.bravais-tile[data-library-card^="card:playlist:"]')).toHaveCount(0);

        await page.keyboard.press('F6');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await page.keyboard.press('Shift+F6');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:albums');
        expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe('albums');
    });

    test('Personal FM plays straight away and stays on the radio wall', async ({ page }) => {
        await seam(page).locator('[data-bravais-tab="radio"]').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:radio');
        await settled(page);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await card(page, 'card:radio:personal_fm').locator('article').dispatchEvent('click');
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const fmKeys = Array.from({ length: HOME_FM_COUNT }, (_, index) => onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(HOME_FM_PREFIX, index)));
        expect((await calls(page, 'playSong'))[0]).toMatchObject({ ids: [fmKeys[0]], isFm: true });
        expect(await stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:radio');
    });

    test('the four local rows switch inside the seam without changing the layer', async ({ page }) => {
        await showLocal(page);
        await expect(section(page, 'Folders')).toHaveAttribute('aria-selected', 'true');
        // fb3：只有激活项显示竖排文字，其余只有图标（全名在 aria-label / title）。
        await expect(section(page, 'Folders').locator('.is-label')).toHaveText('Folders');
        await expect(section(page, 'Albums').locator('.is-label')).toHaveCount(0);
        await expect(section(page, 'Albums')).toHaveAttribute('title', 'Albums');
        await section(page, 'Albums').click();
        await expect(section(page, 'Albums')).toHaveAttribute('aria-selected', 'true');
        await expect(section(page, 'Albums').locator('.is-label')).toHaveText('Albums');
        await expect(section(page, 'Folders').locator('.is-label')).toHaveCount(0);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card^="card:album:"]').first()).toBeAttached();
        await expect(page.locator('.bravais-tile[data-library-card^="card:folder:"]')).toHaveCount(0);
    });

    test('the directory panel is batch mode: cards only toggle, batch keys work, and closing drops the selection', async ({ page }) => {
        await showLocal(page);
        await runMenuItem(page, 'directory');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'panel');
        await expect(seam(page).locator('[data-bravais-directory="home:local"]')).toBeVisible();
        await settled(page);
        // 面板一打开就是批量模式：墙上每张卡都只有一份（有限拼贴），全都还没选中、灰着。
        const folderKeys = HOME_LOCAL_FOLDER_IDS.map(id => `card:folder:${id}`);
        await expect.poll(() => page.locator('.bravais-tile[data-library-card]').evaluateAll(
            elements => elements.map(element => element.getAttribute('data-library-card')).sort(),
        )).toEqual([...folderKeys].sort());
        await expect(page.locator('.bravais-tile[data-library-card][data-bravais-dimmed]')).toHaveCount(folderKeys.length);

        // 点卡片只切换选中，绝不进入文件夹。
        const beta = `card:folder:${homeFolderId('Music/Beta')}`;
        await card(page, beta).locator('article').dispatchEvent('click');
        await expect(card(page, beta)).not.toHaveAttribute('data-bravais-dimmed', /.*/);
        await expect(card(page, beta).locator('[data-bravais-selected]')).toHaveCount(1);
        expect(await stack(page)).toEqual([]);
        await expect.poll(async () => (await batchScope(page))?.itemIds).toEqual([homeFolderId('Music/Beta')]);
        // 树上对应的节点跟着勾上（上层是部分）。
        await expect(seam(page).locator(`[data-bravais-dir-row="item:${homeFolderId('Music/Beta')}"] [role="checkbox"]`)).toHaveAttribute('aria-checked', 'true');
        await expect(seam(page).locator('[data-bravais-dir-row]').filter({ has: page.locator('strong', { hasText: /^Music$/ }) })
            .locator('[role="checkbox"]')).toHaveAttribute('aria-checked', 'mixed');

        // Ctrl+A 全选，Ctrl+Enter 播放所选，Delete 先翻成确认态，Esc 撤销确认态。
        await page.keyboard.press('Control+a');
        await expect.poll(async () => (await batchScope(page))?.itemIds.length).toBe(folderKeys.length);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await page.keyboard.press('Control+Enter');
        await expect.poll(() => calls(page, 'playAll')).toHaveLength(1);
        await page.keyboard.press('Delete');
        await expect(seam(page).locator('[data-bravais-form-id="remove"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-form-id="remove"]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__homeProbe!.localSongIds())).toHaveLength(8);

        // Esc 阶梯：先清掉点卡片时落下的键盘焦点，再关面板 = 退出批量模式：选择清空，墙翻回无限拼贴（不再灰）。
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.getQuery())).toBe('');
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-card][data-bravais-dimmed]')).toHaveCount(0);
        await card(page, beta).locator('article').dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual(['Music/Beta']);
    });

    test('creating a playlist from the panel turns its foot into a form and keeps it open until it works', async ({ page }) => {
        await showLocal(page);
        await runMenuItem(page, 'directory');
        await settled(page);
        await page.evaluate(id => window.__homeProbe!.batchSelect([id]), homeFolderId('Extra'));
        await seam(page).locator('[data-bravais-dir-action="create-playlist"]').click();
        const form = seam(page).locator('[data-bravais-form-id="create-playlist"]');
        await expect(form).toBeVisible();
        await form.locator('input').fill('Wall Mix');
        await form.locator('input').press('Enter');
        await expect(form).toHaveCount(0);
        await expect.poll(async () => (await page.evaluate(() => window.__homeProbe!.localPlaylists())).map(playlist => playlist.name)).toContain('Wall Mix');
    });

    test('manage hidden flips the hidden cards up greyed; hidden-only narrows it; Escape leaves the view', async ({ page }) => {
        // 平时没有眼睛按钮（悬停也不出现），只有「管理隐藏」里才有。
        await card(page, 'card:playlist:owned').hover();
        await expect(card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]')).toBeHidden();

        await runMenuItem(page, 'manage-hidden');
        // 管理模式里点眼睛隐藏一张：变灰留在原地。
        await settled(page);
        await expect(card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]')).toBeVisible();
        await card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]').click();
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.storedHidden())).toEqual({ [`online:${PROBE_PROVIDER_A}`]: ['owned'] });
        await expect(seam(page).locator('[data-bravais-manage]')).toHaveAttribute('data-bravais-manage', 'manage');
        await expect(stage(page)).toHaveClass(/is-managing-hidden/);
        await settled(page);
        await expect(card(page, 'card:playlist:owned')).toHaveAttribute('data-bravais-dimmed', 'true');
        // 原地取消隐藏：变色不重排。
        const slot = await card(page, 'card:playlist:owned').getAttribute('data-bravais-slot');
        await card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]').dispatchEvent('click');
        await expect(page.locator(`[data-bravais-slot="${slot}"]`)).not.toHaveAttribute('data-bravais-dimmed', /.*/);
        await expect(page.locator(`[data-bravais-slot="${slot}"]`)).toHaveAttribute('data-library-card', 'card:playlist:owned');
        await card(page, 'card:playlist:owned').locator('[data-bravais-action="toggle-hidden"]').dispatchEvent('click');

        await seam(page).locator('[data-bravais-seam-action="hidden-only"]').click();
        await expect(seam(page).locator('[data-bravais-manage]')).toHaveAttribute('data-bravais-manage', 'manage-hidden-only');
        await settled(page);
        await expect.poll(() => page.locator('.bravais-tile[data-library-card]').evaluateAll(
            elements => [...new Set(elements.map(element => element.getAttribute('data-library-card')))],
        )).toEqual(['card:playlist:owned']);

        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-manage]')).toHaveCount(0);
        expect(await page.evaluate(() => window.__homeProbe!.hiddenView())).toBe('browse');
    });

    test('the seam search box submits through onSearchCommitted, the one way off the wall', async ({ page }) => {
        await page.keyboard.press('/');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'search');
        const input = seam(page).locator('input[name="bravais-search"]');
        await expect(input).toBeFocused();
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await input.fill('blue train');
        await input.press('Enter');
        await expect.poll(async () => (await calls(page, 'searchCommitted')).map(call => [call.text, call.key])).toEqual([['blue train', 'playlist']]);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');

        await seam(page).locator('[data-bravais-seam-action="search"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'search');
        await seam(page).locator('[data-bravais-seam-action="close-search"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
    });

    // 设计稿 §7.6：每面墙都有当前页过滤——首页各页签也一样。墙上直接打字进缝里的输入位（窄缝里，平时不占地方），
    // 过滤词是这一页的目录会话 query；它只收窄当前墙，不发 provider 请求。搜索在线平台是另一个入口（⌕ / `/`）。
    const filterField = (page: Page) => seam(page).locator('[data-bravais-input-kind="filter"]');
    const filterInput = (page: Page) => seam(page).locator('[data-bravais-filter-input]');
    const wallCards = (page: Page) => page.locator('.bravais-tile[data-library-card]').evaluateAll(
        elements => elements.map(element => element.getAttribute('data-library-card')),
    );
    const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    test('typing on a home tab filters its wall into a finite collage through the narrow seam input, without any request', async ({ page }) => {
        await expect(filterField(page)).toHaveCount(0);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await blur(page);
        await page.keyboard.press('o');
        await expect(filterInput(page)).toBeFocused();
        await page.keyboard.type('wned');
        await expect(filterInput(page)).toHaveValue('owned');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.getQuery())).toBe('owned');
        // 缝还是首页窄缝（不是搜索），墙退化为有限拼贴：只剩匹配的那张、不重复。
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await settled(page);
        await expect.poll(() => wallCards(page)).toEqual(['card:playlist:owned']);
        await expect(filterField(page).locator('[data-bravais-filter-count]')).toHaveText('1 / 5');
        // 过滤不发请求、不走搜索提交。
        expect(await page.evaluate(() => window.__homeProbe!.requests())).toEqual([]);
        expect(await calls(page, 'searchCommitted')).toEqual([]);

        // Esc：先清空（翻回无限拼贴），再结束输入（输入位收起，窄缝不留它）。
        await page.keyboard.press('Escape');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.getQuery())).toBe('');
        await settled(page);
        await expect.poll(async () => {
            const cards = await wallCards(page);
            return new Set(cards).size < cards.length;
        }).toBe(true);
        await page.keyboard.press('Escape');
        await expect(filterField(page)).toHaveCount(0);
    });

    test('search and filter are told apart: the online search is its own box, the page filter its own line', async ({ page }) => {
        // 搜索在线平台：`/`（或工具格的 ⌕）把缝换成搜索态——放大镜、带框的输入框、「搜索在线平台」、面包屑「书库 › 搜索」。
        await blur(page);
        await page.keyboard.press('/');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'search');
        const search = seam(page).locator('[data-bravais-input-kind="search"]');
        await expect(search.locator('input[name="bravais-search"]')).toHaveAttribute('placeholder', 'Search online platforms');
        await expect(search.locator('[data-bravais-seam-action="submit-search"]')).toBeVisible();
        await expect(filterField(page)).toHaveCount(0);
        await seam(page).locator('[data-bravais-seam-action="close-search"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect(seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="search"]')).toHaveAttribute('aria-label', 'Search online platforms');

        // 过滤当前页：「⋯」里的「过滤当前页」（或直接打字）在窄缝里叫出下划线输入位，缝不换形态。
        await runMenuItem(page, 'filter');
        await expect(filterInput(page)).toBeFocused();
        await expect(filterInput(page)).toHaveAttribute('placeholder', 'Filter this page');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect(seam(page).locator('[data-bravais-input-kind="search"]')).toHaveCount(0);
        // 输入位里 `/` 只是一个字符（焦点在输入框里，不开搜索）。
        await page.keyboard.type('a/b');
        await expect(filterInput(page)).toHaveValue('a/b');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.getQuery())).toBe('a/b');
    });

    test('the directory panel shows the same page filter; closing the panel keeps the words', async ({ page }) => {
        await showLocal(page);
        await blur(page);
        await page.keyboard.press('b');
        await page.keyboard.type('eta');
        await expect(filterInput(page)).toHaveValue('beta');
        await settled(page);
        await expect.poll(() => wallCards(page)).toEqual([`card:folder:${homeFolderId('Music/Beta')}`]);
        await page.keyboard.press('ArrowDown');
        await runMenuItem(page, 'directory');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'panel');
        const panelInput = seam(page).locator('[data-bravais-directory] [data-bravais-filter-input]');
        await expect(panelInput).toHaveValue('beta');
        // 面板里 `/` 是过滤字符（批量模式不开搜索）。
        await blur(page);
        await page.keyboard.press('/');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'panel');
        await expect(panelInput).toHaveValue('beta/');
        await page.keyboard.press('Backspace');
        await expect(panelInput).toHaveValue('beta');
        // 结束输入，Esc 阶梯关面板（退出批量模式）：选择丢掉，过滤词留着。
        // （先清掉 ↓ 落下的键盘焦点，再关面板。）
        await blur(page);
        if (await page.locator('.bravais-tile[data-bravais-focused]').count() > 0) {
            await page.keyboard.press('Escape');
            await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveCount(0);
        }
        await page.keyboard.press('Escape');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.getQuery())).toBe('beta');
        await expect(filterInput(page)).toHaveValue('beta');
    });

    test('the local seam menu imports a folder; the Navidrome seam refreshes the overview', async ({ page }) => {
        await showLocal(page);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await seam(page).locator('[data-bravais-seam-action="more"]').click();
        await seam(page).locator('[data-bravais-seam-action="home-import-folder"]').click();
        await expect.poll(async () => (await calls(page, 'service')).map(call => call.key)).toEqual(['importFolder']);

        await seam(page).locator('[data-bravais-tab="navidrome"]').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:navidrome');
        await expect(section(page, 'Albums')).toHaveAttribute('aria-selected', 'true');
        await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
        await expect(seam(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="refresh-navidrome"]')).toBeEnabled();
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await seam(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="refresh-navidrome"]').click();
        await expect.poll(async () => (await page.evaluate(() => window.__homeProbe!.requests())).filter(request => request.op === 'getAlbumList2').length)
            .toBeGreaterThan(0);
    });
});

// 合并 B8 后：从首页打开集合（B7）/ 歌手页（B8）再返回。首页层第一次画时没有起点（布局记忆里的起点是 null），
// B8 的 stage 修复让返回时照记忆恢复——墙回到离开时的排法，压栈与返回各只翻一次（不走首页之间的整墙出场 / 入场）。
// 歌单那条是这个修复的守卫（换回「一律取离缝最近的 slot」会失败）；本地页签是换页签（replace）落下的层，起点不是 null，
// 那条只核对歌手页（bravais）与首页之间的往返。
test.describe('[bravais-only] home ↔ collection / artist', () => {
    /** 墙上此刻有内容的磁贴：slot → 卡片键。 */
    const wallContent = (page: Page) => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.bravais-tile')]
            .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryCard ?? tile.dataset.libraryEntry ?? ''])
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
    /** 等墙落定，再多等一拍（落定后不该再有数据更新的翻牌）。 */
    const settle = async (page: Page) => {
        await settled(page);
        await page.waitForTimeout(500);
        await settled(page);
    };
    /** 打开一张卡、再用缝里的返回按钮退回：压栈翻一次、返回翻一次，墙的每个 slot 与离开前一致。 */
    const openAndBack = async (page: Page, cardKey: string, homeLayer: string, surface: 'collection' | 'artist') => {
        await settle(page);
        // 先把相机挪开（键盘焦点往下走几行），返回时「离缝最近的 slot」就不是第一次画时的原点。
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('ArrowRight');
        for (let step = 0; step < 8; step += 1) await page.keyboard.press('ArrowDown');
        await settle(page);
        const before = await wallContent(page);
        expect(Object.keys(before).length).toBeGreaterThan(0);

        await watchStage(page);
        await card(page, cardKey).locator('article').dispatchEvent('click');
        await expect.poll(async () => (await stack(page)).length).toBe(1);
        await expect(page.locator(`[data-library-surface="${surface}"][data-library-renderer="bravais"]`)).toHaveCount(1);
        await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', homeLayer);
        await settle(page);
        expect((await stageWatch(page)).flips).toBe(1);

        await watchStage(page);
        await seam(page).locator('[data-bravais-seam-action="back"]').first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', homeLayer);
        await settle(page);
        const watch = await stageWatch(page);
        expect(watch.layers).toEqual([homeLayer]);
        expect(watch.flips).toBe(1);
        const after = await wallContent(page);
        const shared = Object.keys(before).filter(slot => slot in after);
        expect(shared.length).toBeGreaterThan(0);
        for (const slot of shared) expect(after[slot], slot).toBe(before[slot]);
    };

    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('a playlist opened from the home wall and closed again: one flip each way, the wall comes back as it was', async ({ page }) => {
        await openAndBack(page, 'card:playlist:owned', 'home:playlist', 'collection');
    });

    test('a local artist opened from the home wall and closed again: one flip each way, the wall comes back as it was', async ({ page }) => {
        await showLocal(page);
        await section(page, 'Artists').click();
        await settled(page);
        const artistCard = page.locator('.bravais-tile[data-library-card^="card:artist:"]').first();
        await expect(artistCard).toBeAttached();
        const cardKey = (await artistCard.getAttribute('data-library-card'))!;
        await openAndBack(page, cardKey, 'home:local', 'artist');
        await expect(section(page, 'Artists')).toHaveAttribute('aria-selected', 'true');
    });
});

// B11：从搜索页 / 播放页打开的集合下面没有首页墙——整墙入场（磁贴从抬起落回，没有起点磁贴）；‹ 回到来源是整墙出场
// （首页层在遮盖之下落回，相机回到离开时的位置）。探针里没有搜索页，用导航 store 以 search 来源打开同一个歌单。
test.describe('[bravais-only] whole-wall entrance and exit from a source', () => {
    const wallContent = (page: Page) => page.evaluate(() => Object.fromEntries(
        [...document.querySelectorAll<HTMLElement>('.bravais-tile')]
            .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryCard ?? tile.dataset.libraryEntry ?? ''])
            .filter(([, entry]) => entry),
    ));
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
    /** 此刻磁贴内容层上的动画：抬起（整墙波次）、转（翻牌）、fill。 */
    const tileAnimations = (page: Page) => page.evaluate(() => document.getAnimations()
        .filter(animation => {
            // 只看磁贴自己放的 WAAPI 动画（CSS 的过渡 / 动画也在 getAnimations 里，例如悬停与日光切换的过渡）。
            if (animation instanceof CSSTransition || animation instanceof CSSAnimation) return false;
            const target = (animation.effect as KeyframeEffect | null)?.target;
            return target instanceof Element && target.classList.contains('bravais-tile-face');
        })
        .map(animation => {
            const effect = animation.effect as KeyframeEffect;
            const transforms = effect.getKeyframes().map(frame => String(frame.transform ?? '')).join(' ');
            return { lifts: transforms.includes('-90px'), rotates: transforms.includes('rotateY'), fill: effect.getTiming().fill };
        }));

    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('a playlist opened from the search enters the whole wall, and Back exits it with the home wall landing as it was', async ({ page }) => {
        // 先从首页打开一次拿到描述（宿主收到的同一份），退回首页。
        await card(page, 'card:playlist:owned').locator('article').dispatchEvent('click');
        await expect.poll(async () => (await stack(page)).length).toBe(1);
        const descriptor = await page.evaluate(async () => {
            const modulePath = '/src/stores/useCollectionNavigationStore.ts';
            const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
            return useCollectionNavigationStore.getState().snapshot!.stack[0] as unknown;
        });
        await settled(page);
        await seam(page).locator('[data-bravais-seam-action="back"]').first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await settled(page);
        await page.waitForTimeout(400);
        const before = await wallContent(page);
        expect(Object.keys(before).length).toBeGreaterThan(0);

        await watchShifts(page);
        await page.evaluate(async collection => {
            const modulePath = '/src/stores/useCollectionNavigationStore.ts';
            const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
            useCollectionNavigationStore.getState().openRoot(collection, 'search');
        }, descriptor);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'enter');
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        expect((await tileAnimations(page)).every(animation => animation.lifts && !animation.rotates && animation.fill === 'backwards')).toBe(true);
        await expect(stage(page).locator('[data-bravais-crumb="root"]')).toHaveText('Search');
        await settled(page);
        await page.waitForTimeout(400);

        await seam(page).locator('[data-bravais-seam-action="back"]').first().dispatchEvent('click');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'exit');
        await expect.poll(async () => (await tileAnimations(page)).length).toBeGreaterThan(0);
        expect((await tileAnimations(page)).some(animation => animation.lifts)).toBe(true);
        expect((await tileAnimations(page)).some(animation => animation.rotates)).toBe(false);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await settled(page);
        await page.waitForTimeout(400);
        expect(await shifts(page)).toEqual(['enter', 'exit']);
        const after = await wallContent(page);
        const shared = Object.keys(before).filter(slot => slot in after);
        expect(shared.length).toBeGreaterThan(0);
        for (const slot of shared) expect(after[slot], slot).toBe(before[slot]);
    });
});

// 合并 B10：账户的登录态 / 确认态不属于任何一层——换层（压栈、返回、来源整墙入场 / 出场，降低动效时的淡入淡出）途中与
// 之后缝都还是账户变体，面包屑不出现；切 suite 的 reset 不碰账户表单；答复后缝回到当前层自己的开口（面包屑回来）。
test.describe('[bravais-only] the account seam over layer shifts', () => {
    const confirmForm = (page: Page) => seam(page).locator('[data-bravais-account-confirm]');
    const askSwitch = async (page: Page) => {
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await stage(page).locator(`[data-bravais-account-list] [data-bravais-account-provider="${PROBE_PROVIDER_B}"] [role="menuitemradio"]`).click();
        await expect(confirmForm(page)).toHaveAttribute('data-bravais-account-confirm', PROBE_PROVIDER_B);
    };
    const expectAccountSeam = async (page: Page) => {
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'confirm');
        await expect(confirmForm(page)).toBeVisible();
        await expect(seam(page).locator('[data-bravais-crumbs]')).toHaveCount(0);
    };
    const closeAll = (page: Page) => page.evaluate(async () => {
        const modulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { notifyCollectionPop, useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
        notifyCollectionPop(null);
        useCollectionNavigationStore.getState().clear();
    });
    const openFromSearch = (page: Page, descriptor: unknown) => page.evaluate(async collection => {
        const modulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
        useCollectionNavigationStore.getState().openRoot(collection, 'search');
    }, descriptor);
    const firstDescriptor = (page: Page) => page.evaluate(async () => {
        const modulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { useCollectionNavigationStore } = await import(/* @vite-ignore */ modulePath);
        return useCollectionNavigationStore.getState().snapshot!.stack[0] as unknown;
    });

    const walkShifts = async (page: Page) => {
        await askSwitch(page);
        await expectAccountSeam(page);

        // 压栈（首页卡片）→ 返回：缝一直是确认态。
        await card(page, 'card:playlist:owned').locator('article').dispatchEvent('click');
        await expect.poll(async () => (await stack(page)).length).toBe(1);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'push');
        await expectAccountSeam(page);
        await settled(page);
        await expectAccountSeam(page);
        const descriptor = await firstDescriptor(page);
        await closeAll(page);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'back');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await expectAccountSeam(page);
        await settled(page);

        // 来源是搜索：整墙入场 → 出场，缝同样不动。
        await openFromSearch(page, descriptor);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'enter');
        await expectAccountSeam(page);
        await settled(page);
        await expectAccountSeam(page);
        await closeAll(page);
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'exit');
        await expectAccountSeam(page);
        await settled(page);

        // 切 suite 时宿主调的 reset 只丢起点磁贴，不碰账户表单。
        await page.evaluate(async () => {
            const modulePath = '/src/library/suites/bravais/bravaisTransitions.ts';
            const { resetBravaisTransitions } = await import(/* @vite-ignore */ modulePath);
            resetBravaisTransitions();
        });
        await expectAccountSeam(page);

        // 再从搜索打开、在集合层上答复：缝回到集合层的完整信息条，面包屑回来（根是 Search）。
        await openFromSearch(page, descriptor);
        await expectAccountSeam(page);
        await settled(page);
        await confirmForm(page).locator('[data-bravais-form-action="cancel"]').click();
        await expect(confirmForm(page)).toHaveCount(0);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full');
        await expect(seam(page).locator('[data-bravais-crumb="root"]')).toHaveText('Search');
        expect(await page.evaluate(() => window.__homeProbe!.activeProvider())).toBe(PROBE_PROVIDER_A);
    };

    test('a pending switch keeps the seam through push, back and a whole-wall entrance / exit; crumbs return after the answer', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await walkShifts(page);
    });

    test('the half-turn towards the account form leaves the old content inert', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await settled(page);
        // 记下缝每次变化时「此刻渲染的内容」与内容层是否 inert（翻转的半圈很短，轮询抓不稳）。
        await page.evaluate(() => {
            const seamElement = document.querySelector<HTMLElement>('[data-bravais-seam]')!;
            const log: { variant: string | null; inert: boolean; hidden: string | null }[] = [];
            const snap = () => {
                const body = seamElement.querySelector<HTMLElement>('.bravais-seam-body')!;
                const entry = { variant: seamElement.dataset.bravaisSeam ?? null, inert: body.inert, hidden: body.getAttribute('aria-hidden') };
                const last = log.at(-1);
                if (!last || last.variant !== entry.variant || last.inert !== entry.inert || last.hidden !== entry.hidden) log.push(entry);
            };
            snap();
            new MutationObserver(snap).observe(seamElement, { attributes: true, subtree: true, attributeFilter: ['inert', 'aria-hidden', 'data-bravais-seam'] });
            (window as Window & { __seamLog?: typeof log }).__seamLog = log;
        });
        await askSwitch(page);
        await expectAccountSeam(page);
        const log = await page.evaluate(() => (window as Window & { __seamLog?: unknown[] }).__seamLog);
        // 翻出去的半圈：渲染的还是首页窄缝，内容层已经 inert / aria-hidden；翻到确认态后解除。
        expect(log).toContainEqual({ variant: 'home', inert: true, hidden: 'true' });
        expect(log?.at(-1)).toEqual({ variant: 'confirm', inert: false, hidden: null });
        expect(log?.at(0)).toEqual({ variant: 'home', inert: false, hidden: null });

        // 答复后翻回首页窄缝：外层不 inert（翻出去的确认表单自己 inert），翻完窄缝可点。
        await confirmForm(page).locator('[data-bravais-form-action="cancel"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect(seam(page).locator('.bravais-seam-body')).not.toHaveAttribute('inert', /.*/);
        await expect(seam(page).locator('.bravais-seam-body')).not.toHaveAttribute('aria-hidden', /.*/);
        await expect(seam(page).locator('[data-bravais-account-toggle="strip"]')).toBeEnabled();
    });

    test('with reduced motion the fades leave the account seam in place too', async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
        await mountBravais(mount, page);
        await walkShifts(page);
    });
});

// fb2：首页窄缝（120px）重排。页签竖排、一列一个；纵向放不下全名时（按测量，不按断点）缩成一个字，全名留在
// title / aria-label；导航区与工具格互不重叠，整体在播放条安全区之上。
// fb2 第二轮：「书库」是页头最上面一行小字。缩减顺序（都按测量）：先隐藏标题（视觉隐藏，读屏仍有）→ 再缩页签
// → 再不够导航区内部滚动。大高度：标题 + 全名；中等：无标题 + 全名；小：无标题 + 一个字。
// 第三轮：折叠按钮单独一行，在标题之下、页签列之上，三级下都看得见、点得到。
// fb3：工具格固定四格（搜索、设置、队列、「⋯」；探针没有队列入口，只有三格），其余（本页签的管理隐藏、目录…，
// app 级的回到播放页…）在「⋯」里，本页签的在前、分隔线、app 级的在后。中段（二级切换、账户入口、状态）在页头与
// 工具格之间竖直居中；二级切换只有激活项有竖排文字，short 时与页签一起缩成一个字。书脊上一列图标，「⋯」先展开缝再开菜单。
// fb4：账户入口不在中段了——贴在工具格正上方（书脊上是工具列上面的一个图标）；平台列表从入口往上弹出、盖在导航区上，
// 不推挤页签、不改变页签的缩减级别。中段（二级切换、状态）在页头与账户入口（没有入口时是工具格）之间竖直居中。
test.describe('[bravais-only] the narrow home seam layout', () => {
    type Box = { left: number; top: number; right: number; bottom: number };
    const root = (page: Page) => page.locator('[data-bravais-home-seam]');
    const overlaps = (a: Box, b: Box) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

    /** 窄缝里各段的矩形、页签的文字与全名、工具格的按钮。 */
    const seamLayout = (page: Page) => page.evaluate(() => {
        const box = (element: Element | null) => {
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
        };
        const root = document.querySelector('[data-bravais-home-seam]')!;
        const body = root.closest('.bravais-seam-body')!;
        const bodyRect = body.getBoundingClientRect();
        return {
            seam: box(document.querySelector('[data-bravais-seam]')),
            safeBottom: bodyRect.bottom - parseFloat(getComputedStyle(body).paddingBottom),
            nav: box(root.querySelector('.bravais-seam-home-nav')),
            overflowing: root.querySelector('.bravais-seam-home-nav')!.classList.contains('is-overflowing'),
            head: box(root.querySelector('.bravais-seam-home-nav .bravais-seam-home-head')),
            middle: box(root.querySelector('[data-bravais-home-body]')),
            // fb11：中段底部的直达入口（入口挪进菜单或没有入口时没有）：从看得见的第一样（分隔线或入口）量到入口底边。
            jumps: (() => {
                const wrap = root.querySelector('[data-bravais-home-jumps] .bravais-seam-shortcuts-wrap');
                if (!wrap) return null;
                const first = box(wrap.firstElementChild)!;
                return { ...box(wrap)!, top: first.top };
            })(),
            dock: box(root.querySelector('.bravais-seam-dock')),
            account: box(root.querySelector(':scope > [data-bravais-account-slot]')),
            accountInMiddle: root.querySelector('[data-bravais-home-body] [data-bravais-account-slot]') !== null,
            fit: root.getAttribute('data-bravais-home-fit'),
            title: (() => {
                const title = root.querySelector<HTMLElement>('[data-bravais-home-title]')!;
                const rect = title.getBoundingClientRect();
                return { state: title.dataset.bravaisHomeTitle, text: title.textContent, width: rect.width, height: rect.height, bottom: rect.bottom };
            })(),
            tablistName: root.querySelector('.bravais-seam-tabs[role="tablist"]')?.getAttribute('aria-label') ?? null,
            fold: box(root.querySelector('[data-bravais-seam-action="hide"]')),
            tabsBox: box(root.querySelector('.bravais-seam-tabs[role="tablist"]')),
            tabs: [...root.querySelectorAll<HTMLElement>('[data-bravais-tab]')].map(tab => ({
                key: tab.dataset.bravaisTab!,
                text: tab.textContent,
                name: tab.getAttribute('aria-label') ?? tab.textContent,
                title: tab.title,
                short: tab.dataset.bravaisTabShort === 'true',
                writingMode: getComputedStyle(tab).writingMode,
            })),
            sections: [...root.querySelectorAll<HTMLElement>('[data-bravais-section]')].map(section => {
                const label = section.querySelector<HTMLElement>('.is-label');
                return {
                    name: section.getAttribute('aria-label'),
                    active: section.getAttribute('aria-selected') === 'true',
                    label: label?.textContent ?? null,
                    writingMode: label ? getComputedStyle(label).writingMode : null,
                    icon: section.querySelector('svg') !== null,
                    ...box(section)!,
                };
            }),
            tools: [...root.querySelectorAll<HTMLElement>('.bravais-seam-tools [data-bravais-seam-action]')].map(tool => ({
                id: tool.dataset.bravaisSeamAction!,
                ...box(tool)!,
            })),
        };
    });

    /** 菜单里的东西（按钮的 id，分隔线记作 rule）。 */
    const menuItems = (page: Page) => seam(page).locator('[data-bravais-seam-menu] > *').evaluateAll(elements => elements.map(
        element => (element as HTMLElement).dataset.bravaisSeamAction ?? (element.getAttribute('role') === 'separator' ? 'rule' : '?'),
    ));

    const expectTidy = async (page: Page, width = 120) => {
        // 缝开到目标宽度（开合补间放完）再量。
        await expect.poll(async () => Math.round((await seam(page).boundingBox())?.width ?? 0)).toBe(width);
        const toolSize = width === 120 ? 40 : 36;
        // 缝里的过渡（整条翻、中段翻）放完再量（设计稿 §7「缝内的过渡」：过渡中的元素挂 data-bravais-seam-flip）。
        await expect(seam(page).locator('[data-bravais-seam-flip]')).toHaveCount(0);
        // 内容翻转（换成书脊 / 窄缝那一套）放完：工具按钮回到原尺寸。
        await expect.poll(async () => (await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action]').first().boundingBox())?.width ?? 0)
            .toBeGreaterThanOrEqual(toolSize - 0.5);
        const layout = await seamLayout(page);
        // fb4：账户入口不在中段，在工具格正上方（与工具格之间只留一小段，书脊上 6px、窄缝 8px）。
        expect(layout.accountInMiddle).toBe(false);
        const account = layout.account;
        if (account) {
            const gap = layout.dock!.top - account.bottom;
            expect(gap).toBeGreaterThanOrEqual(4);
            expect(gap).toBeLessThanOrEqual(10);
            expect(overlaps(layout.nav!, account)).toBe(false);
        }
        const lower = account ?? layout.dock!;
        const parts = [layout.head!, layout.middle!, ...(account ? [account] : []), layout.dock!];
        if (!layout.overflowing) {
            for (let i = 0; i < parts.length; i += 1) {
                for (let j = i + 1; j < parts.length; j += 1) expect(overlaps(parts[i], parts[j])).toBe(false);
            }
            // 中段在页头与下面那一段（账户入口，没有时是工具格）之间竖直居中（上下留白相等），不贴着页签。
            // fb11：直达入口贴在中段底部（离下面那一段一个段间距），中段内层在页头与入口之间居中。
            const jumps = layout.jumps;
            if (jumps) {
                expect(jumps.bottom).toBeLessThanOrEqual(lower.top - 10);
                expect(jumps.top).toBeGreaterThanOrEqual(layout.middle!.bottom - 0.5);
            }
            const above = layout.middle!.top - layout.head!.bottom;
            const below = (jumps?.top ?? lower.top) - layout.middle!.bottom;
            expect(above).toBeGreaterThanOrEqual(10);
            expect(Math.abs(above - below)).toBeLessThanOrEqual(2);
        }
        expect(overlaps(layout.nav!, layout.dock!)).toBe(false);
        for (const tool of layout.tools) {
            expect(tool.right - tool.left).toBeGreaterThanOrEqual(toolSize - 0.5);
            // fb11：舞台入口（舞台开着时）单独一行，宽同两格。
            expect(tool.bottom - tool.top).toBeGreaterThanOrEqual(toolSize - 0.5);
            expect(tool.left).toBeGreaterThanOrEqual(layout.seam!.left);
            expect(tool.right).toBeLessThanOrEqual(layout.seam!.right);
        }
        for (let i = 0; i < layout.tools.length; i += 1) {
            for (let j = i + 1; j < layout.tools.length; j += 1) expect(overlaps(layout.tools[i], layout.tools[j])).toBe(false);
        }
        expect(layout.dock!.bottom).toBeLessThanOrEqual(layout.safeBottom + 0.5);
        // 折叠按钮单独一行：在标题之下（标题显示时）、页签列之上，不与页签并排；任何一级都看得见。
        const fold = layout.fold!;
        expect(fold.bottom - fold.top).toBeGreaterThan(20);
        expect(fold.bottom).toBeLessThanOrEqual(layout.tabsBox!.top + 0.5);
        if (layout.title.state === 'shown') expect(fold.top).toBeGreaterThanOrEqual(layout.title.bottom - 0.5);
        await expect(seam(page).locator('[data-bravais-home-seam] [data-bravais-seam-action="hide"]')).toBeVisible();
        return layout;
    };

    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    /** 改窗口大小，等两帧（ResizeObserver 量完、React 提交）。 */
    const resize = async (page: Page, height: number, width = 1440) => {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };

    test('the title goes first, then the tabs shrink to one letter, and the tools never crowd', async ({ page }) => {
        // 起点比别的用例高：本 fork 的首页在电台与专辑之间多了一个页签（发现），页头的测量副本因此
        // 高一格，1440×1100 已经排不下标题行（测量式判定，见 useBravaisSeamTabsFit）。抬到 1200 让
        // 标题级仍然可达，下面的阶梯（titled → untitled → short）与顺序都不变。
        const TOP = 1200;
        await resize(page, TOP);
        // 1440×1200：标题 + 全名。
        let layout = await expectTidy(page);
        expect(layout.fit).toBe('titled');
        expect(layout.title).toMatchObject({ state: 'shown', text: 'Library' });
        expect(layout.title.height).toBeGreaterThan(10);
        // 标题是横排的一行小字，不再与页签列并排占一大块。
        expect(layout.title.height).toBeLessThan(30);
        expect(layout.tabs.map(tab => tab.key)).toEqual(['playlist', 'radio', 'discover', 'albums', 'local', 'navidrome']);
        expect(layout.tabs.every(tab => !tab.short && tab.writingMode === 'vertical-rl' && tab.text === tab.title)).toBe(true);
        // 工具格固定的几格（探针没有队列入口）；本页签的与 app 级的入口都在「⋯」里，本页签的在前、分隔线、app 级的在后。
        expect(layout.tools.map(tool => tool.id)).toEqual(['search', 'settings', 'more']);
        // 「回到播放页」只在有当前歌曲时出现（与左上角返回同一个判断，selectBravaisHasCurrentSong）：探针起始没有歌。
        await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toBeVisible();
        expect(await menuItems(page)).toEqual(['filter', 'manage-hidden']);
        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toHaveCount(0);
        await page.evaluate(() => window.__homeProbe!.setNowPlaying('online:probe:loaded', false));
        await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toBeVisible();
        expect(await menuItems(page)).toEqual(['filter', 'manage-hidden', 'rule', 'player']);
        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toHaveCount(0);

        // 一路往下压窗口高度：级别只按 titled → untitled → short 的顺序走，三级都出现过。
        const order = ['titled', 'untitled', 'short'];
        const firstAt = new Map<string, number>();
        let previous = 0;
        for (let height = TOP; height >= 480; height -= 10) {
            await resize(page, height);
            const fit = await root(page).getAttribute('data-bravais-home-fit');
            const rank = order.indexOf(fit ?? '');
            expect(rank).toBeGreaterThanOrEqual(previous);
            previous = rank;
            if (!firstAt.has(fit!)) firstAt.set(fit!, height);
        }
        expect([...firstAt.keys()]).toEqual(order);

        // 中等高度：无标题 + 全名。标题视觉隐藏，可访问名还在（标题文字与页签列的 aria-label）。
        await resize(page, firstAt.get('untitled')!);
        layout = await expectTidy(page);
        expect(layout.fit).toBe('untitled');
        expect(layout.title).toMatchObject({ state: 'hidden', text: 'Library' });
        expect(layout.title.width).toBeLessThanOrEqual(1);
        expect(layout.tablistName).toBe('Library');
        expect(layout.tabs.every(tab => !tab.short && tab.text === tab.title)).toBe(true);

        // 小高度：无标题 + 一个字，全名留在 aria-label / title。
        await resize(page, firstAt.get('short')!);
        layout = await expectTidy(page);
        expect(layout.fit).toBe('short');
        expect(layout.title.state).toBe('hidden');
        // 本 fork 在电台与专辑之间多了「发现」页签，并把电台页签改名为 Plaza（它现在是歌单广场：
        // 编辑选出的热门歌单 + 分类筛选）。短形规则见 bravaisSeamTabLabels：取首字素，
        // 撞车的那几个改取两个——Playlists 与 Plaza 同首字母 P，于是都变成 Pl。
        expect(layout.tabs.map(tab => [tab.text, tab.name, tab.title])).toEqual([
            ['Pl', 'Playlists', 'Playlists'],
            ['Pl', 'Plaza', 'Plaza'],
            ['D', 'Discover', 'Discover'],
            ['A', 'Albums', 'Albums'],
            ['F', 'Folder', 'Folder'],
            ['N', 'Navi', 'Navi'],
        ]);
        // 本地页签：二级切换在中段，激活项的文字与页签同级退让（short 时也是一个字）。
        await resize(page, 560);
        await seam(page).getByRole('tab', { name: 'Folder' }).click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await settled(page);
        layout = await expectTidy(page);
        const active = layout.sections.find(entry => entry.active)!;
        expect(active.name).toBe('Folders');
        expect(active.label).toBe(layout.fit === 'short' ? 'F' : 'Folders');

        // 再拉高：回到标题 + 全名。
        await resize(page, TOP);
        await expect(root(page)).toHaveAttribute('data-bravais-home-fit', 'titled');
        await expect(seam(page).locator('[data-bravais-tab][data-bravais-tab-short]')).toHaveCount(0);
        await expectTidy(page);

        // 三级下折叠按钮都能点：小高度（标题隐藏、页签一个字）点它，缝折起来。
        await resize(page, firstAt.get('short')!);
        await expect(root(page)).toHaveAttribute('data-bravais-home-fit', 'short');
        await seam(page).locator('[data-bravais-home-seam] [data-bravais-seam-action="hide"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-level', 'hidden');
    });

    test('the local rows sit centred between the tabs and the tools: one vertical label on the active row, icons on the rest', async ({ page }) => {
        await showLocal(page);
        const layout = await expectTidy(page);
        expect(layout.fit).toBe('titled');
        expect(layout.sections.map(entry => [entry.name, entry.active, entry.label])).toEqual([
            ['Folders', true, 'Folders'],
            ['Albums', false, null],
            ['Artists', false, null],
            ['Playlists', false, null],
        ]);
        expect(layout.sections.every(entry => entry.icon)).toBe(true);
        expect(layout.sections.find(entry => entry.active)!.writingMode).toBe('vertical-rl');
        // 纵向一项一行：同一列、自上而下。
        for (let i = 1; i < layout.sections.length; i += 1) {
            expect(layout.sections[i].top).toBeGreaterThanOrEqual(layout.sections[i - 1].bottom - 0.5);
            expect(Math.abs((layout.sections[i].left + layout.sections[i].right) - (layout.sections[0].left + layout.sections[0].right))).toBeLessThanOrEqual(2);
        }
        // 本地页签的「⋯」：目录与导入等在分隔线前，app 级的在后（有当前歌曲才有「回到播放页」）。
        await page.evaluate(() => window.__homeProbe!.setNowPlaying('online:probe:loaded', false));
        await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
        const items = await menuItems(page);
        expect(items.indexOf('directory')).toBeGreaterThanOrEqual(0);
        expect(items.indexOf('home-import-folder')).toBeGreaterThan(items.indexOf('directory'));
        expect(items.slice(items.indexOf('rule'))).toEqual(['rule', 'player']);
        await expect(seam(page).locator('[data-bravais-seam-menu] [data-bravais-seam-action="directory"]')).toHaveAttribute('role', 'menuitemcheckbox');
    });

    test('on the spine the tools are one column, and the more button opens the narrow seam with its menu', async ({ page }) => {
        await resize(page, 900, 820);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        const layout = await expectTidy(page, 64);
        expect(layout.tools.map(tool => tool.id)).toEqual(['search', 'settings', 'more']);
        expect(new Set(layout.tools.map(tool => Math.round(tool.left))).size).toBe(1);

        await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect.poll(async () => Math.round((await seam(page).boundingBox())?.width ?? 0)).toBe(120);
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toBeVisible();
        expect(await menuItems(page)).toEqual(['filter', 'manage-hidden']);
        await page.keyboard.press('Escape');
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toHaveCount(0);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
    });

    // fb4：账户入口贴在工具格正上方；点开后平台列表从入口往上弹出（scale + 位移，从底边长出来），盖在导航区上，
    // 页签的缩减级别与页头的位置都不变；再点入口、Esc、点别处都收起。登出是当前那一行右侧的小图标。
    // 2026-10-09：列表从缝的侧面弹出到墙上（挂在 stage 根节点上，不在缝里）。
    const accountList = (page: Page) => stage(page).locator('[data-bravais-account-list]');
    const headSnapshot = (page: Page) => root(page).evaluate(element => ({
        fit: element.getAttribute('data-bravais-home-fit'),
        tabs: [...element.querySelectorAll<HTMLElement>('[data-bravais-tab]')].map(tab => {
            const rect = tab.getBoundingClientRect();
            return [tab.textContent, Math.round(rect.top), Math.round(rect.height)];
        }),
    }));
    type ListFrame = { scale: number; opacity: number };
    /** 点开之前装一个逐帧记录：列表每一帧的 transform 缩放与不透明度。 */
    const watchListFrames = (page: Page) => page.evaluate(() => {
        const frames: { scale: number; opacity: number }[] = [];
        (window as Window & { __accountFrames?: typeof frames }).__accountFrames = frames;
        const started = performance.now();
        const tick = () => {
            const list = document.querySelector<HTMLElement>('[data-bravais-account-list]');
            if (list) {
                const style = getComputedStyle(list);
                const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
                frames.push({ scale: Math.hypot(matrix.a, matrix.b), opacity: Number(style.opacity) });
            }
            if (performance.now() - started < 1500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });
    const listFrames = (page: Page) => page.evaluate(() => (window as Window & { __accountFrames?: ListFrame[] }).__accountFrames ?? []);

    /** 列表在缝的侧面（墙上，与缝不重叠）、底边与入口底边对齐、往上长、不出 stage 顶端（等弹出动画放完再量）。 */
    const expectListAbove = async (page: Page) => {
        await expect.poll(async () => {
            const frames = await listFrames(page);
            const last = frames.at(-1);
            return last ? Math.abs(last.scale - 1) < 0.001 && last.opacity > 0.999 : false;
        }).toBe(true);
        const toggle = (await seam(page).locator('[data-bravais-account-slot] [data-bravais-account-toggle]').boundingBox())!;
        const seamBox = (await seam(page).boundingBox())!;
        const stageBox = (await stage(page).boundingBox())!;
        const list = (await accountList(page).boundingBox())!;
        const side = await accountList(page).getAttribute('data-bravais-account-list-side');
        if (side === 'right') expect(list.x).toBeGreaterThanOrEqual(seamBox.x + seamBox.width - 0.5);
        else expect(list.x + list.width).toBeLessThanOrEqual(seamBox.x + 0.5);
        expect(Math.abs((list.y + list.height) - (toggle.y + toggle.height))).toBeLessThanOrEqual(1);
        expect(list.y).toBeGreaterThanOrEqual(stageBox.y - 0.5);
    };

    test('typing on the home spine opens the narrow seam for the page filter and folds back once the input ends', async ({ page }) => {
        await resize(page, 900, 820);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.keyboard.press('o');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-level', 'spine');
        const input = seam(page).locator('[data-bravais-filter-input]');
        await expect(input).toBeFocused();
        await page.keyboard.type('wned');
        await expect(input).toHaveValue('owned');
        // ↓ 交给墙：输入结束，缩回书脊；书脊上是强调色的过滤图标。
        await page.keyboard.press('ArrowDown');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        await expect(seam(page).locator('[data-bravais-seam-action="filter"]')).toBeVisible();
        await seam(page).locator('[data-bravais-seam-action="filter"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect(input).toBeFocused();
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        await expect(seam(page).locator('[data-bravais-seam-action="filter"]')).toHaveCount(0);
    });

    test('the account entry sits right above the tools and its list pops out sideways onto the wall without changing the tab fit', async ({ page }) => {
        const layout = await expectTidy(page);
        expect(layout.account).not.toBeNull();
        const before = await headSnapshot(page);
        expect(before.fit).toBe('titled');

        await watchListFrames(page);
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await expect(seam(page).locator('[data-bravais-account-slot] [data-bravais-account]')).toHaveAttribute('data-bravais-account', 'panel');
        await expect(accountList(page)).toBeVisible();
        await expectListAbove(page);
        // 弹出：开头几帧缩小、半透明，最后落到原尺寸。
        const frames = await listFrames(page);
        expect(frames.some(frame => frame.scale < 0.97)).toBe(true);
        expect(frames.some(frame => frame.opacity < 0.9)).toBe(true);
        // 列表开着：页签的级别、位置、尺寸都没变。
        expect(await headSnapshot(page)).toEqual(before);
        await expectTidy(page);

        // 登出是当前那一行右侧的图标按钮（可访问名是登出文案），行本身仍是选平台的 menuitemradio。
        const current = accountList(page).locator(`[data-bravais-account-provider="${PROBE_PROVIDER_A}"]`);
        const logout = current.getByRole('button', { name: 'Logout', exact: true });
        await expect(logout).toHaveCount(1);
        await expect(logout).toHaveText('');
        await expect(logout).toHaveAttribute('title', 'Logout');
        const rowBox = (await current.getByRole('menuitemradio').boundingBox())!;
        const logoutBox = (await logout.boundingBox())!;
        expect(logoutBox.x).toBeGreaterThanOrEqual(rowBox.x + rowBox.width - 0.5);
        expect(Math.abs((logoutBox.y + logoutBox.height / 2) - (rowBox.y + rowBox.height / 2))).toBeLessThanOrEqual(4);
        await expect(accountList(page).locator('[data-bravais-account-logout]')).toHaveCount(1);

        // 再点入口收起；Esc 收起；点别处收起。
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await expect(accountList(page)).toHaveCount(0);
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await expect(accountList(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(accountList(page)).toHaveCount(0);
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await expect(accountList(page)).toBeVisible();
        const title = (await root(page).locator('[data-bravais-home-title]').boundingBox())!;
        await page.mouse.click(title.x + title.width / 2, title.y + title.height / 2);
        await expect(accountList(page)).toHaveCount(0);
        expect(await headSnapshot(page)).toEqual(before);
    });

    test('at a short height the open list scrolls inside itself and the one-letter tabs stay as they were', async ({ page }) => {
        await resize(page, 520);
        await expect(root(page)).toHaveAttribute('data-bravais-home-fit', 'short');
        await expectTidy(page);
        const before = await headSnapshot(page);
        await watchListFrames(page);
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await expect(accountList(page)).toBeVisible();
        await expectListAbove(page);
        expect(await headSnapshot(page)).toEqual(before);
        // 每一行都还够得着（列表在里面滚）。
        const rows = accountList(page).locator('[data-bravais-account-provider]');
        await rows.last().scrollIntoViewIfNeeded();
        await expect(rows.last()).toBeInViewport();
    });

    test('with reduced motion the list only fades in', async ({ page }) => {
        await page.evaluate(async () => {
            const modulePath = '/src/stores/useMotionSettingsStore.ts';
            const { useMotionSettingsStore } = await import(/* @vite-ignore */ modulePath);
            useMotionSettingsStore.getState().handleToggleReducedMotionSurface('uiMicroMotion', true);
        });
        await watchListFrames(page);
        await seam(page).locator('[data-bravais-account-toggle="strip"]').click();
        await expect(accountList(page)).toBeVisible();
        await expectListAbove(page);
        const frames = await listFrames(page);
        expect(frames.length).toBeGreaterThan(0);
        expect(frames.every(frame => Math.abs(frame.scale - 1) < 0.001)).toBe(true);
    });

    test('on the spine the account icon sits above the tools and opens the narrow seam with the list popped out sideways', async ({ page }) => {
        await resize(page, 900, 820);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        const layout = await expectTidy(page, 64);
        expect(layout.account).not.toBeNull();
        await expect(seam(page).locator('[data-bravais-account-slot] [data-bravais-account-toggle="compact"]')).toBeVisible();

        await watchListFrames(page);
        await seam(page).locator('[data-bravais-account-toggle="compact"]').click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect.poll(async () => Math.round((await seam(page).boundingBox())?.width ?? 0)).toBe(120);
        await expect(accountList(page)).toBeVisible();
        await expectListAbove(page);
        await page.keyboard.press('Escape');
        await expect(accountList(page)).toHaveCount(0);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
    });
    // fb8（用户实测）：「⋯」菜单盖住后面的账户入口（不透明底，层级在账户位之上）；菜单与平台列表互斥。
    test('the more menu is opaque and covers the account entry; it and the account list never stay open together', async ({ page }) => {
        await expectTidy(page);
        const toggle = seam(page).locator('[data-bravais-account-toggle="strip"]');
        const more = seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]');
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        await more.click();
        await expect(menu).toBeVisible();
        await expect.poll(() => menu.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        // 底色不透明（alpha = 1），菜单比工具格两侧各宽一些、仍在缝里。
        const background = await menu.evaluate(node => getComputedStyle(node).backgroundColor);
        const alpha = /rgba?\(([^)]+)\)/.exec(background)?.[1].split(/[ ,/]+/).filter(Boolean)[3];
        expect(alpha === undefined || Number(alpha) === 1).toBe(true);
        const menuBox = (await menu.boundingBox())!;
        const dockBox = (await root(page).locator('.bravais-seam-dock').boundingBox())!;
        const seamBox = (await seam(page).boundingBox())!;
        expect(menuBox.width).toBeGreaterThan(dockBox.width);
        expect(menuBox.x).toBeGreaterThanOrEqual(seamBox.x - 0.5);
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(seamBox.x + seamBox.width + 0.5);
        // 菜单与账户入口重叠的地方，最上面的是菜单（入口不透出来）。
        const toggleBox = (await toggle.boundingBox())!;
        const probe = { x: toggleBox.x + toggleBox.width / 2, y: Math.max(toggleBox.y, menuBox.y) + 4 };
        expect(probe.y).toBeLessThan(menuBox.y + menuBox.height);
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-bravais-seam-menu]') !== null, probe)).toBe(true);
        // 每一项一行（菜单项不折行）。
        const heights = await menu.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
        expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(1);

        // 菜单开着时用键盘打开平台列表：菜单收起。
        await toggle.focus();
        await page.keyboard.press('Enter');
        await expect(accountList(page)).toBeVisible();
        await expect(menu).toHaveCount(0);
        await expect(more).toHaveAttribute('aria-expanded', 'false');
        // 反过来：列表开着时用键盘打开菜单，列表收起。
        await more.focus();
        await page.keyboard.press('Enter');
        await expect(menu).toBeVisible();
        await expect(accountList(page)).toHaveCount(0);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        // 鼠标同样：点入口（先点别处收起菜单）开列表，再点「⋯」开菜单，列表收起。
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await toggle.click();
        await expect(accountList(page)).toBeVisible();
        await more.click();
        await expect(menu).toBeVisible();
        await expect(accountList(page)).toHaveCount(0);
    });

    // fb8：入口是 grid 切换器的样子——头像 / 平台徽章 + 名字，不写账户状态（状态在可访问名与 title 里）。
    test('the signed-in entry shows the avatar and the nickname, falling back to the platform badge', async ({ page }) => {
        await expectTidy(page);
        const toggle = seam(page).locator('[data-bravais-account-toggle="strip"]');
        const nickname = homeUserName(PROBE_PROVIDER_A);
        await expect(toggle.locator('[data-bravais-account-avatar="badge"]')).toBeVisible();
        await expect(toggle).toHaveText(new RegExp(`${nickname}$`));
        await expect(toggle.locator('.is-name')).toHaveText(nickname);
        await expect(toggle).toHaveAccessibleName(`Switch online music provider · ${PROBE_PROVIDER_A} · ${nickname}`);
        await expect(toggle).toHaveAttribute('title', `Switch online music provider · ${PROBE_PROVIDER_A} · ${nickname}`);

        await page.evaluate(async ({ providerId }) => {
            const modulePath = '/src/stores/useOnlineProviderAccountStore.ts';
            const { useOnlineProviderAccountStore } = await import(/* @vite-ignore */ modulePath);
            const store = useOnlineProviderAccountStore.getState();
            const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#f59e0b"/></svg>')}`;
            store.updateAccount(providerId, { user: { ...store.accounts[providerId].user, avatarUrl: avatar } });
        }, { providerId: PROBE_PROVIDER_A });
        const image = toggle.locator('img[data-bravais-account-avatar="image"]');
        await expect(image).toBeVisible();
        await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await expect(toggle.locator('[data-bravais-account-avatar="badge"]')).toHaveCount(0);
        await expect(toggle.locator('.is-name')).toHaveText(nickname);

        // 列表的行：头像 / 徽章 + 平台名，当前已登录那一行下面是昵称；状态与「切换至 X」在可访问名里。
        await toggle.click();
        await expect(accountList(page)).toBeVisible();
        const current = accountList(page).locator(`[data-bravais-account-provider="${PROBE_PROVIDER_A}"] [role="menuitemradio"]`);
        await expect(current.locator('img[data-bravais-account-avatar="image"]')).toBeVisible();
        await expect(current.locator('.is-name')).toHaveText(PROBE_PROVIDER_A);
        await expect(current.locator('.is-note')).toHaveText(nickname);
        const other = accountList(page).locator(`[data-bravais-account-provider="${PROBE_PROVIDER_B}"] [role="menuitemradio"]`);
        await expect(other.locator('[data-bravais-account-avatar="badge"]')).toBeVisible();
        await expect(other).toHaveAccessibleName(new RegExp(`^${PROBE_PROVIDER_B} · ${homeUserName(PROBE_PROVIDER_B)} · Switch to `));
        await expect(accountList(page).getByText('Not signed in', { exact: true })).toHaveCount(0);
    });

    test('the collection more menu is opaque too', async ({ page }) => {
        await card(page, 'card:playlist:owned').locator('article').dispatchEvent('click');
        await settled(page);
        const more = seam(page).locator('.bravais-seam-actions [data-bravais-seam-action="more"]');
        await more.click();
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        await expect(menu).toBeVisible();
        const background = await menu.evaluate(node => getComputedStyle(node).backgroundColor);
        const alpha = /rgba?\(([^)]+)\)/.exec(background)?.[1].split(/[ ,/]+/).filter(Boolean)[3];
        expect(alpha === undefined || Number(alpha) === 1).toBe(true);
        expect(await menu.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
    });
    // fb8：「⋯」里的「回到播放页」与左上角返回同一个判断——没有当前歌曲时不显示（点了会进空的播放页），有了才出现、点了回播放页。
    test('the more menu offers back to the player only while a song is loaded', async ({ page }) => {
        const more = seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]');
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        const player = menu.locator('[data-bravais-seam-action="player"]');
        await more.click();
        await expect(menu).toBeVisible();
        await expect(player).toHaveCount(0);
        await expect(menu.locator('[role="separator"]')).toHaveCount(0);
        // 菜单开着时歌加载进来：那一项（与分隔线）出现。
        await page.evaluate(() => window.__homeProbe!.setNowPlaying('online:probe:loaded', false));
        await expect(player).toBeVisible();
        await expect(player).toHaveText('Back to the player');
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await player.click();
        await expect.poll(() => calls(page, 'backToPlayer')).toHaveLength(1);
        // 歌没了：又不显示。
        await page.evaluate(() => window.__homeProbe!.setNowPlaying(null));
        await more.click();
        await expect(menu).toBeVisible();
        await expect(player).toHaveCount(0);
    });

    // fb11：舞台模式开着时（宿主给了 onOpenStagePlayer 且 stageEnabled）舞台入口单独占工具格最上面一行（窄缝里图标 +
    // 短名，宽同两格；书脊上一列最上面的一个图标），不再在「⋯」里；舞台关着时工具格与菜单都与原来一样。
    test('with the stage on its entry gets a row of its own in the tools; with it off the tools and the menu are as before', async ({ page }) => {
        const tools = () => seam(page).locator('.bravais-seam-tools [data-bravais-seam-action]').evaluateAll(elements => elements.map(
            element => (element as HTMLElement).dataset.bravaisSeamAction,
        ));
        const more = seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]');
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        const stageTool = seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="stage"]');
        // 舞台关着：工具格搜索、设置（探针没有队列）、「⋯」；菜单里也没有舞台。
        expect(await tools()).toEqual(['search', 'settings', 'more']);
        await more.click();
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-bravais-seam-action="stage"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);

        await page.evaluate(() => window.__homeProbe!.setStage({ enabled: true }));
        await expect.poll(tools).toEqual(['stage', 'search', 'settings', 'more']);
        await expect(stageTool).toHaveAccessibleName('Stage player');
        await expect(stageTool).toHaveText('Stage');
        await expect(stageTool).toHaveAttribute('data-stage-active', 'false');
        // 一整行：宽同两格，在其余工具上面。
        const wide = (await stageTool.boundingBox())!;
        const search = (await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="search"]').boundingBox())!;
        const settings = (await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="settings"]').boundingBox())!;
        expect(wide.y + wide.height).toBeLessThanOrEqual(search.y + 0.5);
        expect(Math.abs(wide.x - search.x)).toBeLessThan(1);
        expect(Math.abs((wide.x + wide.width) - (settings.x + settings.width))).toBeLessThan(1);
        // 菜单里没有它。
        await more.click();
        await expect(menu).toBeVisible();
        await expect(menu.locator('[data-bravais-seam-action="stage"]')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await stageTool.click();
        await expect.poll(() => calls(page, 'openStagePlayer')).toHaveLength(1);
        // 正在用舞台播放：与 grid 一样只标 data-stage-active，不是按下态。
        await page.evaluate(() => window.__homeProbe!.setStage({ enabled: true, active: true }));
        await expect(stageTool).toHaveAttribute('data-stage-active', 'true');
        await expect(stageTool).not.toHaveAttribute('aria-pressed', /.*/);

        // 书脊：一列，舞台入口在最上面，只有图标。
        await page.setViewportSize({ width: 820, height: 900 });
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        await expect.poll(async () => Math.round((await seam(page).boundingBox())?.width ?? 0)).toBe(64);
        await expect.poll(tools).toEqual(['stage', 'search', 'settings', 'more']);
        await expect(stageTool).toHaveText('');
        await expect.poll(async () => Math.round((await stageTool.boundingBox())?.width ?? 0)).toBe(36);

        // 舞台关掉：回到原来的样子。
        await page.evaluate(() => window.__homeProbe!.setStage({ enabled: false }));
        await expect.poll(tools).toEqual(['search', 'settings', 'more']);
    });
});
