import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';
import { homeGroupTab, selectOnlinePage } from './bravaisHomeNav';

// test/component/bravaisSeamMotion.spec.ts
// 缝里的过渡（设计稿 §7「缝内的过渡」）：homeBehavior 探针 + setSuite('bravais')。
// - 换层：整条缝的内容层翻牌（data-bravais-seam-flip 依次是 flip-out → flip-in，放完摘掉），换完内容是新的一层；
// - 首页换组（一级页签：在线 → 本地）：整条缝翻一次（2026-10-09 起与原型一致；之前只翻中段，看上去是硬切），一级页签列
//   还是原来那些节点（不重建），中段不再单独翻；
// - 在线组里换页（歌单 → 专辑，点缝里的二级切换）：信息条是同一条（resolveSeamContentIdentity 给在线组的页同一个身份），
//   整条不翻，只有里面的按钮自己过渡；
// - 「⋯」菜单：弹出时从缩小、透明开始，收起时放完动画才卸载，Esc 后焦点回到「⋯」；
// - 降低动态效果（reduce_motion_lattice）：换层与中段都走 fade-out → fade-in，不出现翻转；菜单只淡入、不缩放。
// 过渡很短，轮询抓不稳：在页面里用 MutationObserver 记下标记的每一次变化，再断言顺序。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const seam = (page: Page) => page.locator('[data-bravais-seam]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
/** 缝里所有过渡放完。 */
const seamStill = (page: Page) => expect(seam(page).locator('[data-bravais-seam-flip]')).toHaveCount(0);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
    await seamStill(page);
};

type FlipLog = Record<string, string[]>;

/** 开始记录：`selectors` 里每个元素的 data-bravais-seam-flip 依次变成过什么（null 记作 'still'）。 */
const recordFlips = (page: Page, selectors: Record<string, string>) => page.evaluate(entries => {
    const log: Record<string, string[]> = {};
    const seamElement = document.querySelector<HTMLElement>('[data-bravais-seam]')!;
    const snap = () => {
        for (const [name, selector] of Object.entries(entries)) {
            const element = seamElement.querySelector<HTMLElement>(selector);
            const phase = element?.getAttribute('data-bravais-seam-flip') ?? 'still';
            const list = (log[name] ??= []);
            if (list.at(-1) !== phase) list.push(phase);
        }
    };
    snap();
    new MutationObserver(snap).observe(seamElement, { attributes: true, subtree: true, attributeFilter: ['data-bravais-seam-flip'] });
    (window as Window & { __flipLog?: typeof log }).__flipLog = log;
}, selectors);

const flipLog = (page: Page) => page.evaluate(() => (window as Window & { __flipLog?: Record<string, string[]> }).__flipLog!) as Promise<FlipLog>;

/** 记下菜单出现后头几帧的透明度与 transform（弹出动画的起点）。 */
const watchMenu = (page: Page) => page.evaluate(() => {
    const frames: { opacity: number; transform: string }[] = [];
    const tick = () => {
        const menu = document.querySelector<HTMLElement>('[data-bravais-seam-menu]');
        if (menu) {
            const style = getComputedStyle(menu);
            frames.push({ opacity: Number(style.opacity), transform: style.transform });
        }
        if (frames.length < 40) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    (window as Window & { __menuFrames?: typeof frames }).__menuFrames = frames;
});

const menuFrames = (page: Page) => page.evaluate(() => (
    (window as Window & { __menuFrames?: { opacity: number; transform: string }[] }).__menuFrames ?? []
));

const openOwnedPlaylist = async (page: Page) => {
    await page.locator('.bravais-tile[data-library-card="card:playlist:owned"]').first().locator('article').dispatchEvent('click');
    await expect(seam(page)).toHaveAttribute('data-bravais-seam', 'full');
    await expect(seam(page).locator('[data-bravais-seam-title]')).toHaveText('Owned Playlist');
};

test.describe('[bravais-only] seam motion', () => {
    test('switching home groups flips the whole seam once, keeping the tab nodes; pages of the online group do not flip it; opening a collection does', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await recordFlips(page, {
            content: '.bravais-seam-content',
            middle: '[data-bravais-home-body]',
            tab: '[data-bravais-tab="online"]',
            page: '[data-bravais-section="albums"]',
        });
        await page.evaluate(() => {
            (document.querySelector('[data-bravais-tab="online"]') as HTMLElement & { __kept?: boolean }).__kept = true;
        });
        // 在线组里换页：还是同一条信息条，哪里都不翻。
        await selectOnlinePage(page, 'albums');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:albums');
        await settled(page);
        await seamStill(page);
        let log = await flipLog(page);
        expect(log.content).toEqual(['still']);
        expect(log.middle).toEqual(['still']);
        expect(log.tab).toEqual(['still']);
        expect(log.page).toEqual(['still']);
        await expect(seam(page).locator('[data-bravais-tab="online"]')).toHaveAttribute('aria-selected', 'true');
        await expect(seam(page).locator('[data-bravais-section="albums"]')).toHaveAttribute('aria-selected', 'true');

        // 换组：整条缝翻一次，里面不再各自翻；页签列是同一批节点（不重建）。
        await homeGroupTab(page, 'local').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await seamStill(page);
        log = await flipLog(page);
        expect(log.content).toEqual(['still', 'flip-out', 'flip-in', 'still']);
        expect(log.middle).toEqual(['still']);
        expect(log.tab).toEqual(['still']);
        expect(await page.evaluate(() => (document.querySelector('[data-bravais-tab="online"]') as HTMLElement & { __kept?: boolean }).__kept)).toBe(true);
        await expect(seam(page).locator('[data-bravais-tab="local"]')).toHaveAttribute('aria-selected', 'true');
        await settled(page);

        // 换回歌单页签再打开一张歌单：整条缝翻一次，翻完是集合层的完整信息条，内容回正。
        await selectOnlinePage(page, 'playlist');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');
        await settled(page);
        await seamStill(page);
        await recordFlips(page, { content: '.bravais-seam-content' });
        await openOwnedPlaylist(page);
        await seamStill(page);
        log = await flipLog(page);
        expect(log.content).toEqual(['still', 'flip-out', 'flip-in', 'still']);
        expect(await seam(page).locator('.bravais-seam-content').evaluate(node => getComputedStyle(node).transform)).toBe('none');
    });

    test('the more menu pops out of the tools, waits for its exit, and hands focus back', async ({ mount, page }) => {
        await mountBravais(mount, page);
        const more = seam(page).locator('.bravais-seam-tools [data-bravais-seam-action="more"]');
        await watchMenu(page);
        await more.click();
        const menu = seam(page).locator('[data-bravais-seam-menu]');
        await expect(menu).toBeVisible();
        // 放完：不透明、没有残留的缩放。
        await expect.poll(() => menu.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        const frames = await menuFrames(page);
        expect(frames[0].opacity).toBeLessThan(1);
        expect(frames[0].transform).not.toBe('none');
        // 收起：先放收起动画（还在 DOM 里、不接指针），放完才卸载；焦点交回「⋯」。
        await menu.locator('[data-bravais-seam-action]').first().focus();
        await page.keyboard.press('Escape');
        await expect(more).toBeFocused();
        await expect(menu).toHaveCount(0);
        await expect(more).toHaveAttribute('aria-expanded', 'false');
    });

    test('with reduced motion the seam fades instead of flipping, and the menu only fades', async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
        await mountBravais(mount, page);
        await recordFlips(page, { content: '.bravais-seam-content', middle: '[data-bravais-home-body]' });
        // 在线组里换页不动整条信息条；换组才淡出淡入。
        await selectOnlinePage(page, 'albums');
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:albums');
        await settled(page);
        await seamStill(page);
        expect((await flipLog(page)).content).toEqual(['still']);
        await homeGroupTab(page, 'local').click();
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:local');
        await seamStill(page);
        let log = await flipLog(page);
        expect(log.content).toEqual(['still', 'fade-out', 'fade-in', 'still']);
        expect(log.middle).toEqual(['still']);
        await settled(page);
        await selectOnlinePage(page, 'playlist');
        await settled(page);
        await seamStill(page);

        await recordFlips(page, { content: '.bravais-seam-content' });
        await openOwnedPlaylist(page);
        await seamStill(page);
        log = await flipLog(page);
        expect(log.content).toEqual(['still', 'fade-out', 'fade-in', 'still']);
        // 没有任何绕轴翻转的动画留下。
        expect(await page.evaluate(() => document.getAnimations().some(animation => (
            ((animation.effect as KeyframeEffect | null)?.getKeyframes() ?? []).some(frame => /rotate[XY]/.test(String(frame.transform ?? '')))
            && (animation.effect as KeyframeEffect).target instanceof Element
            && ((animation.effect as KeyframeEffect).target as Element).closest('[data-bravais-seam]') !== null
        )))).toBe(false);

        // 集合层的「⋯ 更多」：只淡入，不缩放、不位移。
        await watchMenu(page);
        await seam(page).locator('.bravais-seam-actions [data-bravais-seam-action="more"]').click();
        await expect(seam(page).locator('[data-bravais-seam-menu]')).toBeVisible();
        await expect.poll(async () => (await menuFrames(page)).length).toBeGreaterThan(3);
        const frames = await menuFrames(page);
        expect(frames[0].opacity).toBeLessThan(1);
        expect(frames.every(frame => frame.transform === 'none')).toBe(true);
    });
});
