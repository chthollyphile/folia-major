import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';
import { homeGroupTab, onlinePageTab } from './bravaisHomeNav';

// test/component/bravaisWall.spec.ts
// bravais 骨架（B6）的组件用例：挂真实的 Home（homeBehavior 探针：GridViewOverlayHost → registry 解析出的首页与集合
// surface，以及生效 suite 的 stage），经 window.__homeProbe.setSuite('bravais') 切到 bravais。
// 墙是虚拟化的：条目不保证都在 DOM 里，用例只找「此刻在视口里、没被缝挡住」的磁贴，或经键盘焦点走过去。
// 覆盖：首页歌单墙、从卡片打开集合（被点的磁贴原地成为第 1 项）、缝里的返回、聚焦卡与立即播放 / 加入队列、
// 方向键 / Enter / Esc 阶梯、外观动作（缝的三级开口）。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('[data-bravais-seam]');
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({
        contentType: 'text/javascript',
        body: buildServiceStubModule(),
    }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect.poll(() => page.evaluate(() => window.__homeProbe!.homeSuite())).toBe('bravais');
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
};

/**
 * 一张此刻完整在视口里、没被缝盖住的磁贴（slot key）。`kind` 是 card（首页卡片）或 entry（集合曲目），
 * `exclude` 排除某个 slot（例如起点磁贴）。
 */
const visibleTile = (page: Page, kind: 'card' | 'entry', exclude?: string) => page.evaluate(([attribute, skip]) => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const tiles = [...document.querySelectorAll<HTMLElement>(`.bravais-tile[${attribute}]`)];
    const fits = (rect: DOMRect) => rect.left > 8 && rect.top > 8
        && rect.right < window.innerWidth - 8 && rect.bottom < window.innerHeight - 140
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = tiles.find(element => element.dataset.bravaisSlot !== skip && fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, [kind === 'card' ? 'data-library-card' : 'data-library-entry', exclude ?? ''] as const);

const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);

/** 此刻打开「思索当前页面」会进哪一篇（与长按 Ctrl+G、触屏灯泡同一条解析）。 */
const pageTarget = (page: Page) => page.evaluate(async () => {
    const modulePath = '/src/services/ponder/pagePonderTarget.ts';
    const { readCurrentPagePonderTarget } = await import(/* @vite-ignore */ modulePath);
    return readCurrentPagePonderTarget();
});

/** 点开一张首页卡片，等集合层接管墙面。 */
const openCard = async (page: Page) => {
    const slot = await visibleTile(page, 'card');
    expect(slot).not.toBeNull();
    const name = await tile(page, slot!).locator('strong').getAttribute('aria-label');
    await tile(page, slot!).locator('article').click();
    await expect.poll(() => stack(page)).toEqual([name]);
    await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', 'home:playlist');
    await expect(tile(page, slot!)).toHaveAttribute('data-library-entry', /.+/);
    // 翻牌放完：墙上已经没有首页卡片。
    await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0);
    return { slot: slot!, name: name! };
};

test.describe('[bravais] skeleton wall', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('draws the playlists tab as a wall behind the narrow home seam', async ({ page }) => {
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam-level', 'full');
        // 两级页签：一级在在线组，二级（缝里的二级切换）在歌单页。
        await expect(homeGroupTab(page, 'online')).toHaveAttribute('aria-selected', 'true');
        await expect(onlinePageTab(page, 'playlist')).toHaveAttribute('aria-selected', 'true');
        // 页面教程是墙（bravais-wall）：长按 Ctrl+G、触屏灯泡、命令面板「思索当前页面」都解析到它。
        await expect(page.locator('[data-library-surface="home"][data-ponder-page-scope="bravais-wall"]')).toHaveCount(1);
        expect(await pageTarget(page)).toBe('bravais-wall');
        // 无限拼贴：五张歌单卡在墙上循环铺开，屏内都看得到。
        const names = await page.locator('.bravais-tile[data-library-card] strong').evaluateAll(
            elements => [...new Set(elements.map(element => element.getAttribute('aria-label')))].sort(),
        );
        expect(names).toEqual(expect.arrayContaining(['Big Playlist', 'Owned Playlist', 'Public Playlist']));
    });

    test('opens a playlist in place and the done button flips the wall back', async ({ page }) => {
        const { slot, name } = await openCard(page);
        // 被点的磁贴原地成为新层的第 1 项；缝保持张开，内容翻成完整信息条。
        await expect(tile(page, slot).locator('.lattice-poster-badge')).toHaveText(/^0*1$/);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full');
        await expect(seam(page).locator('.bravais-seam-vtitle')).toHaveText(name);
        await expect(page.locator('[data-library-surface="collection"][data-ponder-page-scope="bravais-wall"]')).toHaveCount(1);
        expect(await pageTarget(page)).toBe('bravais-wall');

        await seam(page).locator('[data-bravais-seam-action="back"]').click();
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await expect(tile(page, slot)).toHaveAttribute('data-library-card', /.+/);
        // 返回时焦点回到当初被点的那张。
        await expect(tile(page, slot)).toHaveAttribute('data-bravais-focused', 'true');
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
    });

    test('a song tile opens the focus card; play now and add to queue go to the player', async ({ page }) => {
        const { slot: start } = await openCard(page);
        const song = await visibleTile(page, 'entry', start);
        expect(song).not.toBeNull();
        const entry = await tile(page, song!).getAttribute('data-library-entry');
        await page.evaluate(() => window.__homeProbe!.clearLog());

        await tile(page, song!).locator('article').click();
        const card = page.locator('[data-bravais-expanded]');
        await expect(card).toHaveAttribute('data-library-entry', entry!);
        await expect(card.locator('[data-bravais-focus-card]')).toHaveAttribute('data-bravais-focus-card', entry!);
        // 点开不播放（聚焦不是播放）。
        expect(await calls(page, 'playSong')).toEqual([]);

        // 探针左下角的 DEV suite 浮层会盖住卡片底部的按钮：直接派发点击（同一个 onClick）。
        await card.locator('[data-bravais-action="enqueue"]').dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'addSongToQueue')).map(call => call.ids[0])).toEqual([entry!.replace(/-\d+$/, '')]);
        await card.locator('[data-bravais-action="play"]').dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'playSong')).map(call => call.ids[0])).toEqual([entry!.replace(/-\d+$/, '')]);
    });

    test('arrow keys walk the wall, Enter expands then plays, Escape climbs back one level at a time', async ({ page }) => {
        await openCard(page);
        // 打开时点过的那张带着键盘焦点；先清掉，从「没有焦点」开始。
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(0);
        await page.evaluate(() => window.__homeProbe!.clearLog());

        await page.keyboard.press('ArrowRight');
        const first = await page.locator('[data-bravais-focused]').getAttribute('data-bravais-slot');
        expect(first).not.toBeNull();
        await page.keyboard.press('ArrowRight');
        await expect(page.locator('[data-bravais-focused]')).not.toHaveAttribute('data-bravais-slot', first!);
        const focused = page.locator('[data-bravais-focused]');
        const entry = await focused.getAttribute('data-library-entry');

        await page.keyboard.press('Enter');
        await expect(page.locator('[data-bravais-expanded]')).toHaveAttribute('data-library-entry', entry!);
        expect(await calls(page, 'playSong')).toEqual([]);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await calls(page, 'playSong')).map(call => call.ids[0])).toEqual([entry!.replace(/-\d+$/, '')]);

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bravais-expanded]')).toHaveCount(0);
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(0);
        expect(await stack(page)).toHaveLength(1);
        await page.keyboard.press('Escape');
        await expect.poll(() => stack(page)).toEqual([]);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
    });

    test('chrome actions fold, spine and restore the seam', async ({ page }) => {
        // 只看缝的开口动作（透光等其它外观动作在各自的用例里，B6b③ 起默认的部分透明档还会多出三条）。
        const chrome = () => page.evaluate(() => {
            const current = window.__homeProbe!.chrome();
            return current && { ...current, available: current.available.filter(id => id.startsWith('seam-')) };
        });
        await expect.poll(chrome).toEqual({ suiteId: 'bravais', available: ['seam-spine', 'seam-hide'] });

        expect(await page.evaluate(() => window.__homeProbe!.runChrome('seam-spine'))).toBe(true);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        await expect.poll(chrome).toEqual({ suiteId: 'bravais', available: ['seam-full', 'seam-hide'] });

        expect(await page.evaluate(() => window.__homeProbe!.runChrome('seam-hide'))).toBe(true);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'none');
        const tab = page.locator('.bravais-seam-tab');
        await expect(tab).toBeVisible();
        await tab.click();
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home-spine');
        await expect(tab).toBeHidden();

        expect(await page.evaluate(() => window.__homeProbe!.runChrome('seam-full'))).toBe(true);
        await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'home');
        // 首页没有正在播放的那首：定位不可用，执行也不做事。
        expect(await page.evaluate(() => window.__homeProbe!.runChrome('locate-playing'))).toBe(false);
    });
});
