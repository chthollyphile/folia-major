import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisSeamTab.spec.ts
// Tab 在墙与缝之间切换（设计稿 §7.6；用户实测：原先进缝后按 DOM 顺序一格格走、缝折叠时焦点跳到墙上的按钮、过滤位里的
// Tab 走到清除按钮）。真实按键，断言 document.activeElement 的落点：
// - 没有焦点（body）/ 墙上 → Tab 进缝（首页落在选中的页签，集合层落在第一个控件 ‹），缝里 → Tab 回墙（上次的焦点磁贴）；
//   Shift+Tab 同样是换到另一站；连按不会离开 stage；
// - 缝里的控件之间用方向键走（DOM 顺序，到头停住），Tab 回缝时还给上次停的那个；
// - 过滤位（输入框）里 Tab 也回墙，输入结束；
// - 缝折叠时 Tab 落在缝的边缘标签上（不再交给浏览器、跳到墙上的按钮）；在标签上按 Enter 恢复缝后，等缝张开把焦点交进缝里
//   （落点同 Tab 进缝），鼠标点标签不挪焦点。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

/** 此刻的焦点在哪：缝里（seam）、缝的边缘标签（seam-tab）、墙（wall：stage 里、缝外）、body，或 stage 之外（outside）。 */
const focusArea = (page: Page) => page.evaluate(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'body';
    if (active.closest('[data-bravais-seam]')) return 'seam';
    if (active.classList.contains('bravais-seam-tab')) return 'seam-tab';
    if (active.closest('[data-library-stage="bravais"]')) return 'wall';
    return 'outside';
});

/** 焦点元素的一个可辨认的名字（缝的动作名、页签 key、过滤位、墙的 field）。 */
const focusedName = (page: Page) => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) return null;
    if (active.dataset.bravaisTab) return `tab:${active.dataset.bravaisTab}`;
    if (active.dataset.bravaisSeamAction) return `action:${active.dataset.bravaisSeamAction}`;
    if (active.hasAttribute('data-bravais-filter-input')) return 'filter-input';
    if (active.classList.contains('bravais-field')) return 'field';
    return `${active.tagName.toLowerCase()}:${active.getAttribute('aria-label') ?? active.textContent?.trim().slice(0, 24) ?? ''}`;
});

const focusedTile = (page: Page) => page.locator('.bravais-tile[data-bravais-focused]').getAttribute('data-bravais-slot');

test.describe('[bravais-only] Tab switches between the wall and the info strip', () => {
    test('home: Tab and Shift+Tab toggle between the wall and the strip, arrows move inside the strip', async ({ mount, page }) => {
        await mountBravais(mount, page);
        expect(await focusArea(page)).toBe('body');

        // 没有焦点：Tab 进缝，落在选中的页签上。
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('seam');
        expect(await focusedName(page)).toBe('tab:online');

        // 缝里：Tab 回墙，键盘焦点落在一张磁贴上（没有上次的焦点：离缝最近的一张）。
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');
        expect(await focusedName(page)).toBe('field');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveCount(1);

        // 墙上移一格，记下这张；Shift+Tab 也是进缝（只有两站），回到上次停的页签。
        await page.keyboard.press('ArrowRight');
        const wallSlot = await focusedTile(page);
        expect(wallSlot).not.toBeNull();
        await page.keyboard.press('Shift+Tab');
        expect(await focusedName(page)).toBe('tab:online');

        // 缝里方向键：↓ 下一个控件、↑ 回来；焦点一直在缝里，墙上的键盘焦点不动。
        await page.keyboard.press('ArrowDown');
        const next = await focusedName(page);
        expect(await focusArea(page)).toBe('seam');
        expect(next).not.toBe('tab:online');
        await page.keyboard.press('ArrowUp');
        expect(await focusedName(page)).toBe('tab:online');
        await page.keyboard.press('ArrowDown');
        expect(await focusedName(page)).toBe(next);
        expect(await focusedTile(page)).toBe(wallSlot);

        // Shift+Tab 回墙：回到上次的焦点磁贴；再 Tab 回缝：还给上次停的那个控件。
        await page.keyboard.press('Shift+Tab');
        expect(await focusArea(page)).toBe('wall');
        expect(await focusedTile(page)).toBe(wallSlot);
        await page.keyboard.press('Tab');
        expect(await focusedName(page)).toBe(next);

        // 连按 Tab 只在两站之间来回，不会走到 stage 之外（标题栏、工具按钮）。
        const areas: string[] = [];
        for (let press = 0; press < 6; press++) {
            await page.keyboard.press('Tab');
            areas.push(await focusArea(page));
        }
        expect(areas).toEqual(['wall', 'seam', 'wall', 'seam', 'wall', 'seam']);
    });

    test('home: with the strip folded Tab lands on its edge label, and Enter there hands the focus into the reopened strip', async ({ mount, page }) => {
        await mountBravais(mount, page);
        // 先在缝里停一下：Tab 进缝（选中的页签）→ ↓ 走到下一个控件 → Tab 回墙。缝记下这一个。
        await page.keyboard.press('Tab');
        await page.keyboard.press('ArrowDown');
        const remembered = await focusedName(page);
        expect(remembered).not.toBe('tab:online');
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');

        await page.locator('[data-bravais-seam-action="hide"]').first().click();
        await expect(stage(page).locator('[data-bravais-seam]')).toHaveAttribute('data-bravais-seam-level', 'hidden');
        await expect(page.locator('.bravais-seam-tab')).toBeVisible();
        await page.locator('.bravais-field').focus();
        await page.keyboard.press('ArrowRight');
        const wallSlot = await focusedTile(page);

        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('seam-tab');
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');
        expect(await focusedTile(page)).toBe(wallSlot);

        // 边缘标签上按 Enter：缝恢复（标签藏起来），等缝张开后焦点直接交进缝里，落点同 Tab 进缝（上次停过的那个）。
        await page.keyboard.press('Shift+Tab');
        expect(await focusArea(page)).toBe('seam-tab');
        await page.keyboard.press('Enter');
        await expect(stage(page).locator('[data-bravais-seam]')).not.toHaveAttribute('data-bravais-seam-level', 'hidden');
        await expect.poll(() => focusedName(page)).toBe(remembered);
        // 落在缝里时内容已经完全张开（不透明、没有在翻）。
        expect(await page.locator('.bravais-seam-content').evaluate(node => Number((node as HTMLElement).style.opacity))).toBe(1);
        await expect(page.locator('[data-bravais-seam] [data-bravais-seam-flip]')).toHaveCount(0);
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');

        // 鼠标点边缘标签恢复：不替用户挪焦点。
        await page.locator('[data-bravais-seam-action="hide"]').first().click();
        await expect(stage(page).locator('[data-bravais-seam]')).toHaveAttribute('data-bravais-seam-level', 'hidden');
        await page.locator('.bravais-seam-tab').click();
        await expect(page.locator('[data-bravais-tab="online"]')).toBeVisible();
        await page.waitForTimeout(400);
        expect(await focusArea(page)).not.toBe('seam');
    });

    test('collection: the strip entry is its first control, the filter field hands Tab back to the wall', async ({ mount, page }) => {
        await mountBravais(mount, page);
        // 打开一张首页卡片（键盘：方向键 + Enter）。
        await page.locator('.bravais-field').focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect.poll(() => stack(page)).toHaveLength(1);
        await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0, { timeout: 10_000 });
        await settled(page);
        await expect(stage(page).locator('[data-bravais-seam]')).toHaveAttribute('data-bravais-seam', 'full');

        // 焦点在墙上：Tab 进缝，落在第一个控件（‹ 返回）。
        expect(await focusArea(page)).toBe('wall');
        const wallSlot = await focusedTile(page);
        expect(wallSlot).not.toBeNull();
        await page.keyboard.press('Tab');
        expect(await focusedName(page)).toBe('action:back');
        // 方向键在缝里走，跳过过滤位（它的方向键归光标，↓ 交给墙），走到「播放全部」。
        const visited: (string | null)[] = [];
        for (let press = 0; press < 6; press++) {
            await page.keyboard.press('ArrowDown');
            visited.push(await focusedName(page));
        }
        expect(visited).not.toContain('filter-input');
        expect(visited).toContain('action:play-scope');
        expect(await stack(page)).toHaveLength(1);
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');
        expect(await focusedTile(page)).toBe(wallSlot);

        // 墙上打字：焦点进过滤位。过滤位里按 Tab：回墙，输入结束（输入位不再有焦点）。
        await page.keyboard.type('t');
        await expect.poll(() => focusedName(page)).toBe('filter-input');
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');
        expect(await focusedName(page)).toBe('field');
        await expect(page.locator('.bravais-tile[data-bravais-focused]')).toHaveCount(1);
        expect(await page.locator('[data-bravais-filter-input]').inputValue()).toBe('t');

        // 再 Tab：回到上次停的过滤位；Shift+Tab 从过滤位同样回墙。
        await page.keyboard.press('Tab');
        expect(await focusedName(page)).toBe('filter-input');
        await page.keyboard.press('Shift+Tab');
        expect(await focusArea(page)).toBe('wall');
    });

    // fb10：「收起」改成点标题区域。它是缝里方向键序列里的一个按钮（‹、面包屑之后）；Enter / Space 切换，
    // 缝整条翻完焦点交给新内容里的标题，再按一次切回去。
    test('collection: the title area is in the arrow sequence, Enter / Space toggle full and spine and the focus follows', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await page.locator('.bravais-field').focus();
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Enter');
        await expect.poll(() => stack(page)).toHaveLength(1);
        await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0, { timeout: 10_000 });
        await settled(page);
        const seam = stage(page).locator('[data-bravais-seam]');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
        // 完整信息条的竖排大标题（标题区域按钮里的 span）字重 800。
        expect(await seam.locator('[data-bravais-seam-title]').evaluate(node => getComputedStyle(node).fontWeight)).toBe('800');

        await page.keyboard.press('Tab');
        expect(await focusedName(page)).toBe('action:back');
        for (let press = 0; press < 6 && await focusedName(page) !== 'action:spine'; press++) await page.keyboard.press('ArrowDown');
        expect(await focusedName(page)).toBe('action:spine');

        await page.keyboard.press('Enter');
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'spine');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'spine');
        await expect.poll(() => focusedName(page)).toBe('action:expand');
        expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-bravais-seam-title') ?? false)).toBe(true);
        // 书脊标题是 <button>：缝里 `button { font: inherit }` 不能盖掉竖排标题的字重（与完整信息条的大标题同为 800）。
        expect(await seam.locator('[data-bravais-seam-title]').evaluate(node => getComputedStyle(node).fontWeight)).toBe('800');

        await page.keyboard.press('Space');
        await expect(seam).toHaveAttribute('data-bravais-seam-level', 'full');
        await expect(seam).toHaveAttribute('data-bravais-seam', 'full');
        await expect.poll(() => focusedName(page)).toBe('action:spine');
        expect(await stack(page)).toHaveLength(1);
        expect(await seam.locator('[data-bravais-seam-title]').evaluate(node => getComputedStyle(node).fontWeight)).toBe('800');

        // 两站规则不变：Tab 回墙。
        await page.keyboard.press('Tab');
        expect(await focusArea(page)).toBe('wall');
    });
});
