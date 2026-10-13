import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { HOME_FM_COUNT, HOME_FM_PREFIX, onlinePlaybackKey, onlineSongId, PROBE_PROVIDER_A, PROBE_PROVIDER_B } from '../../dev/probes/libraryBehavior/fixtureRules';
import { HOME_ALL_SONGS_ID, HOME_LOCAL_SONGS, homeLocalSongId } from '../../dev/probes/homeBehavior/homeFixtureRules';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisSpecialCards.spec.ts
// bravais 首页的特殊集合（我喜欢的音乐、云盘、私人 FM、每日推荐、全部歌曲、本地「我喜欢」、Navidrome 随机 / 收藏）：
// - 墙上那张卡左上角的类型标签换一身（is-special + data-bravais-special：强调色底、带小图标），普通卡片不变；
// - 缝里中段底部的直达入口（fb11：竖排文字，显示种类的短名，并排成列；贴在账户入口 / 工具格上方）：只在那张集合此刻真有时出现（在线看当前页签的卡；provider 没有、未登录都不出现），
//   点它与点墙上那张卡同一条打开路径——墙上（屏内）找得到那张卡就以它为起点磁贴，找不到（别的 section）就以缝为中心，
//   不拿键盘焦点所在的那张不相干的磁贴当起点；私人 FM 直接播放；键盘可达（Tab 进缝、方向键、Enter）；
// - 放不下时入口先于二级切换让位，挪进「⋯」菜单。
// fixture：probe-a 的 public 在首页歌单列表上标成 isLiked（HOME_LIKED_PLAYLIST），只有 probe-a 有云盘；本地的「我喜欢」
// 是曲库自带的；Navidrome 的随机 / 收藏是概览里的虚拟歌单。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('[data-bravais-seam]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const card = (page: Page, itemKey: string) => page.locator(`.bravais-tile[data-library-card="${itemKey}"]`).first();
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const lastOpened = async (page: Page) => (await page.evaluate(() => window.__homeProbe!.opened())).at(-1);
const calls = (page: Page, kind: string) => page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind);
const shortcutsGroup = (page: Page) => seam(page).locator('[data-bravais-home-jumps] [data-bravais-shortcuts]');
const shortcut = (page: Page, special: string) => seam(page).locator(`[data-bravais-home-jumps] [data-bravais-shortcut="${special}"]`);
const shortcutKinds = (page: Page) => seam(page).locator('[data-bravais-home-jumps] [data-bravais-shortcut]').evaluateAll(
    elements => elements.map(element => [(element as HTMLElement).dataset.bravaisShortcut, element.getAttribute('aria-label'), element.getAttribute('title')]),
);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

const showTab = async (page: Page, tab: string) => {
    await seam(page).locator(`[data-bravais-tab="${tab}"]`).click();
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', `home:${tab}`);
    await settled(page);
};

/** 焦点所在的缝里控件（动作名 / 页签 key）。 */
const focusedAction = (page: Page) => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.dataset.bravaisSeamAction ?? (active?.dataset.bravaisTab ? `tab:${active.dataset.bravaisTab}` : active?.tagName ?? null);
});

const section = (page: Page, name: string) => seam(page).locator('[data-bravais-home-body]').getByRole('tab', { name, exact: true });

/** 墙上每个 slot 此刻显示的条目（虚拟化：只有 DOM 里的）。 */
const wallContent = (page: Page) => page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll<HTMLElement>('.bravais-tile')]
        .map(tile => [tile.dataset.bravaisSlot ?? '', tile.dataset.libraryCard ?? tile.dataset.libraryEntry ?? ''])
        .filter(([, entry]) => entry),
));

/** 装一个记录器：换层翻牌里错开延迟最小（= 起点）的那张磁贴的 slot。 */
const watchFlipOrigin = (page: Page) => page.evaluate(() => {
    const probe = window as unknown as { __flipOrigin: { slot: string | null; delay: number } };
    probe.__flipOrigin = { slot: null, delay: Number.POSITIVE_INFINITY };
    const started = performance.now();
    const look = () => {
        for (const animation of document.getAnimations()) {
            if (animation instanceof CSSTransition || animation instanceof CSSAnimation) continue;
            const effect = animation.effect as KeyframeEffect | null;
            const target = effect?.target;
            if (!(target instanceof Element) || !target.classList.contains('bravais-tile-face')) continue;
            const rotates = effect!.getKeyframes().some(frame => /rotateY\(-?90deg\)/.test(String(frame.transform ?? '')));
            if (!rotates) continue;
            const delay = Number(effect!.getTiming().delay ?? 0);
            if (delay < probe.__flipOrigin.delay) {
                probe.__flipOrigin = { slot: target.closest<HTMLElement>('.bravais-tile')?.dataset.bravaisSlot ?? null, delay };
            }
        }
        if (performance.now() - started < 5000) requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
});
const flipOrigin = (page: Page) => page.evaluate(() => (window as unknown as { __flipOrigin: { slot: string | null; delay: number } }).__flipOrigin);

test.describe('[bravais-only] special collections', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('special cards wear an accent type label with an icon; ordinary cards keep the plain one', async ({ page }) => {
        const badge = (itemKey: string) => card(page, itemKey).locator('.lattice-poster-badge');
        const expectSpecial = async (itemKey: string, special: string, text: string) => {
            await expect(card(page, itemKey)).toHaveAttribute('data-bravais-special', special);
            await expect(badge(itemKey)).toHaveClass(/\bis-special\b/);
            await expect(badge(itemKey)).toHaveAttribute('data-bravais-special', special);
            await expect(badge(itemKey).locator('svg')).toHaveCount(1);
            // 文字仍是种类；集合的曲目数已知时带在后面（「Playlist · 12」，设计稿 §7.7）。
            await expect(badge(itemKey)).toHaveText(new RegExp(`^${text}( · \\d+)?$`));
        };
        const expectPlain = async (itemKey: string) => {
            await expect(card(page, itemKey)).not.toHaveAttribute('data-bravais-special', /.*/);
            await expect(badge(itemKey)).not.toHaveClass(/\bis-special\b/);
            await expect(badge(itemKey).locator('svg')).toHaveCount(0);
        };

        await expectSpecial('card:playlist:public', 'liked', 'Playlist');
        await expectSpecial('card:cloud:cloud', 'cloud', 'Playlist');
        await expectPlain('card:playlist:owned');
        // 强调色底：与普通标签的底色不同；层级与普通标签相同（2026-10-09 起叠色与熄灯一律盖住集合的标记）。
        const look = (itemKey: string) => badge(itemKey).evaluate(node => ({ background: getComputedStyle(node).backgroundColor, z: getComputedStyle(node).zIndex }));
        const special = await look('card:playlist:public');
        const plain = await look('card:playlist:owned');
        expect(special.background).not.toBe(plain.background);
        expect(special.z).toBe('auto');

        // 种类区分（设计稿 §7.7）：歌单类的特殊卡照样是集合（叠页边），标签在普通位置。
        await expect(card(page, 'card:playlist:public')).toHaveAttribute('data-bravais-form', 'stack');
        expect(await badge('card:playlist:public').evaluate(node => getComputedStyle(node).left)).toBe('14px');

        await showTab(page, 'radio');
        await expectSpecial('card:radio:personal_fm', 'personal-fm', 'Radio');
        await expectSpecial('card:daily_recommendations:daily_recommendations', 'daily', 'Radio');
        await expectPlain(`card:playlist:rec-${PROBE_PROVIDER_A}-0`);
        // 私人 FM 是直接播放的电台流，不是集合；每日推荐是一张曲目表，是集合。
        await expect(card(page, 'card:radio:personal_fm')).not.toHaveAttribute('data-bravais-form', /.*/);
        await expect(card(page, 'card:daily_recommendations:daily_recommendations')).toHaveAttribute('data-bravais-form', 'stack');

        await showTab(page, 'local');
        await expectSpecial(`card:folder:${HOME_ALL_SONGS_ID}`, 'all-songs', 'Folder');
        await expectPlain('card:folder:folder-Extra');
        // 文件夹是集合：曲目数写进类型标签（副标题不再重复）。
        const allSongs = card(page, `card:folder:${HOME_ALL_SONGS_ID}`);
        await expect(allSongs).toHaveAttribute('data-bravais-form', 'stack');
        await expect(allSongs.locator('.lattice-poster-badge')).toHaveText(`Folder · ${HOME_LOCAL_SONGS.length}`);
        await expect(allSongs.locator('.lattice-poster-copy small')).not.toContainText('tracks');
    });

    test('online tabs offer jump-ins only for the special collections that exist', async ({ page }) => {
        // 歌单页签：我喜欢的音乐、云盘；横排文字是种类的短名（fb11；2026-10-09 改横排），卡片全名在 aria-label / title；与二级切换不同，它们是一组普通按钮。
        await expect(shortcutsGroup(page)).toHaveAttribute('role', 'group');
        await expect(shortcutsGroup(page)).toHaveAccessibleName('Jump to');
        expect(await shortcutKinds(page)).toEqual([
            ['liked', 'Public Playlist', 'Public Playlist'],
            ['cloud', 'Probe Cloud', 'Probe Cloud'],
        ]);
        await expect(shortcut(page, 'liked')).toHaveText('Liked Songs');
        await expect(shortcut(page, 'cloud')).toHaveText('Cloud Drive');
        await expect(shortcut(page, 'liked').locator('svg')).toHaveCount(0);
        // 无描边、11px。
        const look = await shortcut(page, 'liked').evaluate(node => {
            const label = node.querySelector('.is-label')!;
            const style = getComputedStyle(label);
            return { writing: style.writingMode, border: getComputedStyle(node).borderTopWidth, size: style.fontSize };
        });
        // 横排（用户定，2026-10-09）。
        expect(look).toEqual({ writing: 'horizontal-tb', border: '0px', size: '11px' });
        const likedBox = (await shortcut(page, 'liked').boundingBox())!;
        const cloudBox = (await shortcut(page, 'cloud').boundingBox())!;
        // 一行一个、上下排列（同一列居中）。
        expect(cloudBox.y).toBeGreaterThanOrEqual(likedBox.y + likedBox.height - 0.5);
        expect(Math.abs((likedBox.x + likedBox.width / 2) - (cloudBox.x + cloudBox.width / 2))).toBeLessThan(1);
        // 靠下：入口一块的底边贴着账户入口（一个段间距，18px），不在中段中间。
        const jumpsBottom = await seam(page).locator('[data-bravais-home-jumps]').evaluate(node => node.getBoundingClientRect().bottom);
        const accountTop = await seam(page).locator('[data-bravais-account-slot]').evaluate(node => node.getBoundingClientRect().top);
        expect(accountTop - jumpsBottom).toBeGreaterThanOrEqual(17);
        expect(accountTop - jumpsBottom).toBeLessThan(26);
        await expect(seam(page).locator('[data-bravais-home-seam]')).toHaveAttribute('data-bravais-home-shortcuts', 'column');

        // 电台页签：私人 FM、每日推荐。
        await showTab(page, 'radio');
        expect((await shortcutKinds(page)).map(([kind]) => kind)).toEqual(['personal-fm', 'daily']);
        await expect(shortcut(page, 'personal-fm')).toHaveAttribute('aria-label', 'Personal FM');

        // 收藏专辑页签：没有特殊集合，就没有入口。
        await showTab(page, 'albums');
        await expect(shortcutsGroup(page)).toHaveCount(0);
        await expect(seam(page).locator('[data-bravais-home-seam]')).not.toHaveAttribute('data-bravais-home-shortcuts', /.*/);

        // probe-b 没有「我喜欢的音乐」、没有云盘：歌单页签没有入口。
        await showTab(page, 'playlist');
        expect(await page.evaluate(id => window.__homeProbe!.switchProvider(id), PROBE_PROVIDER_B)).toBe(true);
        await expect(page.locator('.bravais-tile[data-library-card="card:playlist:same"]').first()).toBeAttached();
        await settled(page);
        await expect(shortcutsGroup(page)).toHaveCount(0);

        // 回到 probe-a 又有；退出登录（未登录：墙空着）就没有。
        expect(await page.evaluate(id => window.__homeProbe!.switchProvider(id), PROBE_PROVIDER_A)).toBe(true);
        await expect(shortcut(page, 'liked')).toBeVisible();
        await page.evaluate(id => window.__homeProbe!.signOut(id), PROBE_PROVIDER_A);
        await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0);
        await expect(shortcutsGroup(page)).toHaveCount(0);
    });

    test('a jump-in opens its collection like its card: from the card on the wall, and Personal FM plays straight away', async ({ page }) => {
        const before = await wallContent(page);
        const likedSlots = Object.entries(before).filter(([, entry]) => entry === 'card:playlist:public').map(([slot]) => slot);
        expect(likedSlots.length).toBeGreaterThan(0);
        await watchFlipOrigin(page);
        await shortcut(page, 'liked').click();
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
        expect(await lastOpened(page)).toMatchObject({ source: 'online', providerId: PROBE_PROVIDER_A, type: 'playlist', id: 'public' });
        await expect(page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]')).toHaveCount(1);
        await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', 'home:playlist');
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'push');
        await settled(page);
        // 起点磁贴是墙上那张「我喜欢的音乐」（翻牌从它开始），它原地成了新层的第 1 项。
        const origin = await flipOrigin(page);
        expect(origin.slot).not.toBeNull();
        expect(likedSlots).toContain(origin.slot);
        await expect(page.locator(`.bravais-tile[data-bravais-slot="${origin.slot}"] .lattice-poster-badge`)).toHaveText('01');

        // 返回首页；电台页签的私人 FM：直接播放，不进新层。
        await seam(page).locator('[data-bravais-seam-action="back"]').first().click();
        await expect.poll(() => stack(page)).toEqual([]);
        await settled(page);
        await showTab(page, 'radio');
        await page.evaluate(() => window.__homeProbe!.clearLog());
        await shortcut(page, 'personal-fm').click();
        await expect.poll(() => calls(page, 'playSong')).toHaveLength(1);
        const fmKeys = Array.from({ length: HOME_FM_COUNT }, (_, index) => onlinePlaybackKey(PROBE_PROVIDER_A, onlineSongId(HOME_FM_PREFIX, index)));
        expect((await calls(page, 'playSong'))[0]).toMatchObject({ ids: [fmKeys[0]], isFm: true });
        expect(await stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:radio');
    });

    test('local and Navidrome jump-ins reach their collections from any section, centred on the seam when the card is not on the wall', async ({ page }) => {
        await showTab(page, 'local');
        expect((await shortcutKinds(page)).map(([kind, name]) => [kind, name])).toEqual([
            ['all-songs', 'All Songs'],
            ['local-favorites', 'Liked Songs'],
        ]);
        // 二级切换与入口之间一道分隔线；入口排在二级切换下面（fb11：贴在中段底部，二级切换仍在上面居中）。
        await expect(shortcut(page, 'all-songs')).toHaveText('All Songs');
        await expect(shortcut(page, 'local-favorites')).toHaveText('Favorites');
        // 与激活的二级切换区分：字号小一级、字重轻、颜色不是强调色。
        const activeLabel = await seam(page).locator('[data-bravais-home-body] .bravais-seam-section.is-active .is-label').evaluate(node => {
            const style = getComputedStyle(node);
            return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight), color: getComputedStyle(node.parentElement!).color };
        });
        const jumpLabel = await shortcut(page, 'all-songs').evaluate(node => {
            const style = getComputedStyle(node.querySelector('.is-label')!);
            return { size: parseFloat(style.fontSize), weight: Number(style.fontWeight), color: getComputedStyle(node).color };
        });
        expect(jumpLabel.size).toBeLessThan(activeLabel.size);
        expect(jumpLabel.weight).toBeLessThan(activeLabel.weight);
        expect(jumpLabel.color).not.toBe(activeLabel.color);
        await expect(seam(page).locator('[data-bravais-home-jumps] .bravais-seam-shortcuts-rule')).toHaveCount(1);
        const sectionsBox = (await seam(page).locator('[data-bravais-home-body] [role="tablist"]').boundingBox())!;
        const shortcutsBox = (await shortcutsGroup(page).boundingBox())!;
        expect(shortcutsBox.y).toBeGreaterThanOrEqual(sectionsBox.y + sectionsBox.height);

        // 切到「专辑」：全部歌曲不在墙上，入口照样在。
        await section(page, 'Albums').click();
        await settled(page);
        await expect(page.locator(`.bravais-tile[data-library-card="card:folder:${HOME_ALL_SONGS_ID}"]`)).toHaveCount(0);
        // 键盘焦点放在墙上一张专辑卡上（往右挪几格，离开离缝最近的那张）。
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowRight');
        const focused = await page.locator('.bravais-tile[data-bravais-focused]').getAttribute('data-bravais-slot');
        expect(focused).not.toBeNull();
        // 用键盘进缝、走到入口上按 Enter（墙上的键盘焦点还在那张专辑卡上）。
        await page.keyboard.press('Tab');
        for (let press = 0; press < 16 && (await focusedAction(page)) !== 'shortcut-all-songs'; press += 1) await page.keyboard.press('ArrowDown');
        expect(await focusedAction(page)).toBe('shortcut-all-songs');
        expect(await page.locator('.bravais-tile[data-bravais-focused]').getAttribute('data-bravais-slot')).toBe(focused);
        await watchFlipOrigin(page);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:folder:${HOME_ALL_SONGS_ID}`);
        expect(await lastOpened(page)).toMatchObject({
            source: 'local',
            type: 'folder',
            isVirtual: true,
            songIds: HOME_LOCAL_SONGS.map(song => homeLocalSongId(song.index)),
        });
        await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', 'home:local');
        await expect(stage(page)).toHaveAttribute('data-bravais-shift', 'push');
        await settled(page);
        // 没有起点磁贴：不拿键盘焦点所在的那张专辑卡当起点。
        const origin = await flipOrigin(page);
        expect(origin.slot).not.toBeNull();
        expect(origin.slot).not.toBe(focused);
        await seam(page).locator('[data-bravais-seam-action="back"]').first().click();
        await expect.poll(() => stack(page)).toEqual([]);
        await settled(page);
        await expect(section(page, 'Albums')).toHaveAttribute('aria-selected', 'true');

        // Navidrome：随机、收藏在歌单 section 里；从「专辑」section 点「随机」，集合类型仍是 random。
        await showTab(page, 'navidrome');
        await expect.poll(async () => (await shortcutKinds(page)).map(([kind]) => kind)).toEqual(['navidrome-random', 'navidrome-favorites']);
        await shortcut(page, 'navidrome-random').click();
        await expect.poll(async () => (await lastOpened(page))?.key).toBe('navidrome:random:__navi_random__');
    });

    test('the jump-ins are reachable from the keyboard: Tab into the strip, arrows down past the tabs, Enter opens', async ({ page }) => {
        const focusedName = () => page.evaluate(() => {
            const active = document.activeElement as HTMLElement | null;
            return active?.dataset.bravaisSeamAction ?? (active?.dataset.bravaisTab ? `tab:${active.dataset.bravaisTab}` : active?.tagName ?? null);
        });
        await page.keyboard.press('Tab');
        expect(await focusedName()).toBe('tab:playlist');
        const seen: (string | null)[] = [];
        for (let press = 0; press < 12 && (await focusedName()) !== 'shortcut-liked'; press += 1) {
            await page.keyboard.press('ArrowDown');
            seen.push(await focusedName());
        }
        expect(await focusedName()).toBe('shortcut-liked');
        // 方向键序列：页签之后紧接着是入口（DOM 顺序），下一个是云盘。
        expect(seen.slice(0, 5)).toEqual(['tab:radio', 'tab:discover', 'tab:albums', 'tab:local', 'tab:navidrome']);
        await page.keyboard.press('ArrowDown');
        expect(await focusedName()).toBe('shortcut-cloud');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        await expect.poll(() => stack(page)).toEqual(['Public Playlist']);
    });

    test('when the strip runs short the jump-ins give way first, into the more menu, before the tabs shrink', async ({ page }) => {
        await showTab(page, 'local');
        const root = seam(page).locator('[data-bravais-home-seam]');
        const state = async () => `${await root.getAttribute('data-bravais-home-fit')}/${await root.getAttribute('data-bravais-home-shortcuts')}`;
        const order = ['titled/column', 'untitled/column', 'untitled/menu', 'short/menu'];
        const seenAt = new Map<string, number>();
        let previous = 0;
        for (let height = 1100; height >= 480; height -= 10) {
            await page.setViewportSize({ width: 1440, height });
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            const current = await state();
            const rank = order.indexOf(current);
            expect(rank, `${height}: ${current}`).toBeGreaterThanOrEqual(previous);
            previous = rank;
            if (!seenAt.has(current)) seenAt.set(current, height);
        }
        expect([...seenAt.keys()]).toEqual(order);

        // 挪进菜单的入口：排在最前，图标 + 全名，后面一道分隔线；点它照样打开。
        await page.setViewportSize({ width: 1440, height: seenAt.get('untitled/menu')! });
        await expect(root).toHaveAttribute('data-bravais-home-shortcuts', 'menu');
        await expect(shortcutsGroup(page)).toHaveCount(0);
        await seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]').click();
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        await expect(menu).toBeVisible();
        const items = await menu.locator(':scope > *').evaluateAll(elements => elements.map(
            element => (element as HTMLElement).dataset.bravaisSeamAction ?? (element.getAttribute('role') === 'separator' ? 'rule' : '?'),
        ));
        expect(items.slice(0, 3)).toEqual(['shortcut-all-songs', 'shortcut-local-favorites', 'rule']);
        await expect(menu.locator('[data-bravais-seam-action="shortcut-all-songs"]')).toHaveText('All Songs');
        await menu.locator('[data-bravais-seam-action="shortcut-all-songs"]').click();
        await expect.poll(async () => (await lastOpened(page))?.key).toBe(`local:folder:${HOME_ALL_SONGS_ID}`);

        // 拉回高处：入口回到中段。
        await seam(page).locator('[data-bravais-seam-action="back"]').first().click();
        await expect.poll(() => stack(page)).toEqual([]);
        await page.setViewportSize({ width: 1440, height: 1100 });
        await expect(root).toHaveAttribute('data-bravais-home-shortcuts', 'column');
    });
});
