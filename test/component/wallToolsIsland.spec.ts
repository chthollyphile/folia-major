import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { IslandProbeCall } from '../../dev/probes/wallToolsIsland/islandProbeApi';
import '../../dev/probes/wallToolsIsland/islandProbeApi';

// test/component/wallToolsIsland.spec.ts
// 墙面工具面板的队列浮岛（components/wall/WallToolsQueueIsland，探针 wallToolsIsland：就地的 WallToolsSurface + 改播放 store
// 的假宿主，200 首）：快捷排「队列」格开合与偏好记忆、打开时滚到当前歌曲、点歌播放（面板不收）、悬停动作、手柄拖拽（含越过
// 虚拟窗口的长距离自动滚动、Esc 撤拖拽）、键盘（Enter / ↑↓ / Alt+↑↓ / Delete）、清空两步确认、存为本地歌单的内联输入、
// 私人 FM 下隐藏（偏好保留）、外部舞台只读、Esc 分层、点浮岛不收面板，以及暗色 / 日光两张截图（写进 test-results，不是基线）。
// 另外：正在播放的那一行不给移除、Delete 在浮岛里一律被消费、双击清空不绕过确认、保存失败后焦点回到输入框、
// 强调色等于正文色时清空确认胶囊的前景仍与底不同色、2–8 首时列表不出滚动条、矮窗口里打开时按真实高度居中、
// 帮助展开 + 浮岛打开时整体留在视口里且不压到标题栏区。

/** 在页面里拿探针接口跑一段（函数源码连同接口一起送进页面；只用于不闭包外部变量的短箭头函数）。 */
const probe = <T>(page: Page, run: (api: NonNullable<Window['__wallToolsIslandProbe']>) => T) => (
    page.evaluate(`(${run.toString()})(window.__wallToolsIslandProbe)`) as Promise<T>
);
const calls = (page: Page, kind?: IslandProbeCall['kind']) => page.evaluate(
    callKind => window.__wallToolsIslandProbe!.calls().filter(call => !callKind || call.kind === callKind),
    kind,
);
const queueIds = (page: Page) => page.evaluate(() => window.__wallToolsIslandProbe!.queueIds());

const tools = (page: Page) => page.getByRole('button', { name: 'Wall tools', exact: true });
const panel = (page: Page) => page.getByRole('menu', { name: 'Wall tools', exact: true });
const queueQuick = (page: Page) => panel(page).locator('[data-wall-tools-quick="queue"]');
const island = (page: Page) => page.getByRole('region', { name: 'Play queue', exact: true });
const row = (page: Page, index: number) => island(page).locator(`[data-queue-index="${index}"]`);
const song = (page: Page, index: number) => row(page, index).locator('.lattice-tools-island-song');
const live = (page: Page) => island(page).locator('[data-queue-island-live]');

/** 在 window 上（冒泡最后一站，bravais 的按键监听就挂在这里）记下最近一次 Delete 有没有被消费。 */
const watchDelete = (page: Page) => page.evaluate(() => {
    const target = window as unknown as { __lastDeletePrevented?: boolean | null };
    target.__lastDeletePrevented = null;
    window.addEventListener('keydown', event => {
        if (event.key === 'Delete') target.__lastDeletePrevented = event.defaultPrevented;
    });
});
const lastDeletePrevented = (page: Page) => page.evaluate(
    () => (window as unknown as { __lastDeletePrevented?: boolean | null }).__lastDeletePrevented ?? null,
);

/** 在 fixtures 的种子脚本之后再写几项存储（store 在模块 import 时读）。 */
const seedStorage = (page: Page, entries: [string, string][]) => page.addInitScript(pairs => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
}, entries);

const mountProbe = async (mount: (id: string) => Promise<Locator>, page: Page, { islandOpen = true } = {}) => {
    if (islandOpen) await seedStorage(page, [['wall_tools_queue_island_open', 'true']]);
    await mount('wallToolsIsland');
    await expect.poll(() => page.evaluate(() => window.__wallToolsIslandProbe?.queueIds().length ?? 0)).toBe(200);
};

const openPanel = async (page: Page) => {
    await tools(page).click();
    await expect(panel(page)).toBeVisible();
};

/** 行在列表视口里的位置（相对列表顶，px）；不在 DOM 里时 null。 */
const rowOffset = (page: Page, index: number) => page.evaluate(i => {
    const list = document.querySelector('.lattice-tools-island-scroll');
    const node = document.querySelector(`[data-queue-index="${i}"]`);
    if (!list || !node) return null;
    return node.getBoundingClientRect().top - list.getBoundingClientRect().top;
}, index);

test.describe('wall tools queue island', () => {
    test('the queue cell opens and closes the island, and the choice is remembered', async ({ mount, page }) => {
        await mountProbe(mount, page, { islandOpen: false });
        await openPanel(page);
        await expect(queueQuick(page)).toHaveAttribute('aria-expanded', 'false');
        await expect(queueQuick(page)).toHaveAttribute('aria-description', 'Show the play queue');
        await expect(island(page)).toHaveCount(0);

        await queueQuick(page).click();
        await expect(island(page)).toBeVisible();
        await expect(panel(page)).toBeVisible();
        await expect(queueQuick(page)).toHaveAttribute('aria-expanded', 'true');
        await expect(queueQuick(page)).toHaveAttribute('aria-controls', 'probe-wall-tools-queue-island');
        await expect(island(page)).toHaveAttribute('id', 'probe-wall-tools-queue-island');
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 200 songs');
        expect(await page.evaluate(() => localStorage.getItem('wall_tools_queue_island_open'))).toBe('true');

        // 浮岛视觉上在面板上方，且两者都在按钮之上。
        const islandBox = (await island(page).boundingBox())!;
        const panelBox = (await panel(page).boundingBox())!;
        expect(islandBox.y + islandBox.height).toBeLessThanOrEqual(panelBox.y + 1);
        // 上下边框 2 + 头部 36 + 8 行 × 40（等出场的缩放放完再量）。
        await expect.poll(async () => Math.round((await island(page).boundingBox())!.height)).toBe(2 + 36 + 8 * 40);

        // 收起面板：浮岛一起走；再打开：浮岛照旧展开。
        await tools(page).click();
        await expect(panel(page)).toHaveCount(0);
        await expect(island(page)).toHaveCount(0);
        await openPanel(page);
        await expect(island(page)).toBeVisible();

        await queueQuick(page).click();
        await expect(island(page)).toHaveCount(0);
        await expect(queueQuick(page)).toHaveAttribute('aria-expanded', 'false');
        expect(await probe(page, api => api.islandPreference())).toBe(false);
    });

    test('opening centres the playing song, and a song change scrolls it into view', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ currentIndex: 120 }));
        await openPanel(page);
        await expect(song(page, 120)).toHaveAttribute('aria-current', 'true');
        const listHeight = await island(page).locator('.lattice-tools-island-scroll').evaluate(node => node.clientHeight);
        await expect.poll(async () => Math.abs(((await rowOffset(page, 120)) ?? -999) + 20 - listHeight / 2)).toBeLessThan(24);

        // 切到窗口外的一首：smart 平滑滚动把它带进视口。
        await probe(page, api => api.setCurrent(10));
        await expect.poll(async () => {
            const offset = await rowOffset(page, 10);
            return offset !== null && offset >= -1 && offset <= listHeight - 39;
        }).toBe(true);
        await expect(song(page, 10)).toHaveAttribute('aria-current', 'true');
    });

    test('clicking a song plays it without closing anything; the unavailable song is tagged', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        await expect(row(page, 3).locator('.lattice-tools-island-tag')).toBeVisible();
        await song(page, 5).click();
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-5' }]);
        await expect(song(page, 5)).toHaveAttribute('aria-current', 'true');
        await expect(row(page, 5)).toHaveClass(/\bis-current\b/);
        await expect(panel(page)).toBeVisible();
        await expect(island(page)).toBeVisible();
    });

    test('2 to 8 songs fit without a scrollbar or a clipped last row', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        for (const count of [2, 5, 8]) {
            await page.evaluate(n => window.__wallToolsIslandProbe!.seed({ count: n }), count);
            await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText(`Play queue · ${count} songs`);
            const list = island(page).locator('.lattice-tools-island-scroll');
            await expect.poll(() => list.evaluate(node => node.scrollHeight - node.clientHeight)).toBe(0);
            const [lastRow, listBox] = [(await row(page, count - 1).boundingBox())!, (await list.boundingBox())!];
            expect(lastRow.y + lastRow.height).toBeLessThanOrEqual(listBox.y + listBox.height + 0.5);
        }
    });

    test('the playing row offers neither remove nor play next', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await watchDelete(page);
        await openPanel(page);
        await row(page, 0).hover();
        await expect(row(page, 0).locator('[data-queue-row-action]')).toHaveCount(1);
        await expect(row(page, 0).getByRole('button', { name: 'Move to end', exact: true })).toBeVisible();
        await song(page, 0).focus();
        await page.keyboard.press('Delete');
        expect(await calls(page, 'removeQueueSong')).toEqual([]);
        expect(await lastDeletePrevented(page)).toBe(true);
        expect(await queueIds(page)).toHaveLength(200);
    });

    test('Delete on a hover action button is consumed by the island, not passed to the wall', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await watchDelete(page);
        await openPanel(page);
        await row(page, 4).hover();
        await row(page, 4).getByRole('button', { name: 'Move to end', exact: true }).focus();
        await page.keyboard.press('Delete');
        expect(await lastDeletePrevented(page)).toBe(true);
        expect(await calls(page, 'removeQueueSong')).toEqual([]);
    });

    test('hovering a row shows play next, move to end and remove', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const actions = row(page, 4).locator('.lattice-tools-island-row-actions');
        await expect(actions).toBeHidden();
        await row(page, 4).hover();
        await expect(actions).toBeVisible();
        await row(page, 4).getByRole('button', { name: 'Play next', exact: true }).click();
        expect(await calls(page, 'playQueueSongNext')).toEqual([{ kind: 'playQueueSongNext', index: 4 }]);
        expect((await queueIds(page)).slice(0, 3)).toEqual(['island-0', 'island-4', 'island-1']);

        await row(page, 2).hover();
        await row(page, 2).getByRole('button', { name: 'Move to end', exact: true }).click();
        expect((await queueIds(page)).at(-1)).toBe('island-1');

        await row(page, 2).hover();
        await row(page, 2).getByRole('button', { name: 'Remove from queue', exact: true }).click();
        expect(await queueIds(page)).toHaveLength(199);
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 199 songs');
    });

    test('dragging a handle reorders: a short move lands on the row under the pointer', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const handle = row(page, 1).locator('.lattice-tools-island-handle');
        const box = (await handle.boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // 4px 以内不算拖。
        await page.mouse.move(x, y + 3);
        await expect(island(page).locator('.lattice-tools-island-ghost')).toHaveCount(0);
        for (let step = 1; step <= 6; step++) {
            await page.mouse.move(x, y + step * 20);
            await page.waitForTimeout(20);
        }
        await expect(island(page).locator('.lattice-tools-island-ghost')).toBeVisible();
        await expect(row(page, 1)).toHaveClass(/\bis-drag-source\b/);
        // 拖到第 4 行的位置：2..4 上移一行。
        await expect.poll(() => row(page, 3).evaluate(node => getComputedStyle(node).transform)).toContain('matrix');
        await page.mouse.up();
        expect(await calls(page, 'moveQueueSong')).toEqual([{ kind: 'moveQueueSong', from: 1, to: 4 }]);
        expect((await queueIds(page)).slice(0, 6)).toEqual(['island-0', 'island-2', 'island-3', 'island-4', 'island-1', 'island-5']);
        await expect(island(page).locator('.lattice-tools-island-ghost')).toHaveCount(0);
        await expect(live(page)).toHaveText('Moved to position 5');
        await expect(panel(page)).toBeVisible();
    });

    test('a long drag auto-scrolls past the virtual window and still drops the right song', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const list = island(page).locator('.lattice-tools-island-scroll');
        const listBox = (await list.boundingBox())!;
        const handle = row(page, 2).locator('.lattice-tools-island-handle');
        const box = (await handle.boundingBox())!;
        const x = box.x + box.width / 2;
        await page.mouse.move(x, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(x, box.y + 30, { steps: 4 });
        // 指针压到列表下边缘：自动滚动（指针不动也继续滚）。
        await page.mouse.move(x, listBox.y + listBox.height - 4, { steps: 6 });
        await expect.poll(() => list.evaluate(node => node.scrollTop), { timeout: 10_000 }).toBeGreaterThan(40 * 40);
        // 第 2 行早已滚出虚拟窗口被卸掉，指针捕获在列表外框上，拖拽照常进行。
        await expect(row(page, 2)).toHaveCount(0);
        // 回到列表中部停下，松手。
        await page.mouse.move(x, listBox.y + listBox.height / 2, { steps: 4 });
        await page.waitForTimeout(100);
        await page.mouse.up();
        const moves = await calls(page, 'moveQueueSong');
        expect(moves).toHaveLength(1);
        const { from, to } = moves[0];
        expect(from).toBe(2);
        expect(to!).toBeGreaterThan(40);
        const ids = await queueIds(page);
        expect(ids[to!]).toBe('island-2');
        expect(ids).toHaveLength(200);
        await expect(song(page, to!).locator('.lattice-tools-island-name')).toHaveText('Island Track 2');
    });

    test('Escape during a drag only cancels the drag', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const box = (await row(page, 1).locator('.lattice-tools-island-handle').boundingBox())!;
        await page.mouse.move(box.x + 5, box.y + 10);
        await page.mouse.down();
        await page.mouse.move(box.x + 5, box.y + 90, { steps: 6 });
        await expect(island(page).locator('.lattice-tools-island-ghost')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(island(page).locator('.lattice-tools-island-ghost')).toHaveCount(0);
        await page.mouse.up();
        expect(await calls(page, 'moveQueueSong')).toEqual([]);
        await expect(panel(page)).toBeVisible();
        await expect(island(page)).toBeVisible();
    });

    test('the keyboard plays, moves focus, reorders with Alt+arrows and removes with Delete', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        await song(page, 4).focus();
        await page.keyboard.press('ArrowDown');
        await expect(song(page, 5)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(song(page, 4)).toBeFocused();

        await page.keyboard.press('Alt+ArrowDown');
        expect(await calls(page, 'moveQueueSong')).toEqual([{ kind: 'moveQueueSong', from: 4, to: 5 }]);
        expect((await queueIds(page))[5]).toBe('island-4');
        await expect(song(page, 5)).toBeFocused();
        await expect(live(page)).toHaveText('Moved to position 6');
        await page.keyboard.press('Alt+ArrowUp');
        expect((await queueIds(page))[4]).toBe('island-4');
        await expect(song(page, 4)).toBeFocused();
        await expect(live(page)).toHaveText('Moved to position 5');

        await page.keyboard.press('Enter');
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-4' }]);

        // island-4 现在正在播放：Delete 不删它。
        await page.keyboard.press('Delete');
        expect(await calls(page, 'removeQueueSong')).toEqual([]);
        await page.keyboard.press('ArrowDown');
        await expect(song(page, 5)).toBeFocused();
        await page.keyboard.press('Delete');
        expect(await calls(page, 'removeQueueSong')).toEqual([{ kind: 'removeQueueSong', index: 5 }]);
        expect((await queueIds(page))[5]).toBe('island-6');
        await expect(song(page, 5)).toBeFocused();
        await expect(panel(page)).toBeVisible();
    });

    test('searching filters the rows; actions and keys still reach the right songs', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const searchButton = island(page).locator('[data-queue-island-action="search"]');
        const input = island(page).locator('[data-queue-island-search]');
        const rows = island(page).locator('.lattice-tools-island-row');
        await searchButton.click();
        await expect(input).toBeFocused();
        await expect(input).toHaveAttribute('placeholder', 'Search the queue (200)');
        // 搜索时不给存歌单与清空。
        await expect(island(page).locator('[data-queue-island-action="clear"]')).toHaveCount(0);

        // 「199」既是第 200 首的歌名，也是第 199 首的位置号（与命令面板、遥控窗口的队列搜索同一份检索文字）。
        await input.fill('track 199');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toHaveAttribute('data-queue-index', '198');
        await expect(rows.nth(1)).toHaveAttribute('data-queue-index', '199');
        // 筛选中不能拖拽排序：没有手柄，Alt+↑↓ 不挪。
        await expect(island(page).locator('.lattice-tools-island-handle')).toHaveCount(0);
        await expect(island(page)).toHaveAttribute('data-queue-filtering');
        // 高度仍按整个队列算。
        await expect.poll(async () => Math.round((await island(page).boundingBox())!.height)).toBe(2 + 36 + 8 * 40);

        // ↓ 进第一行、↑ 回到搜索框；Enter 播放第一首匹配。
        await page.keyboard.press('ArrowDown');
        await expect(song(page, 198)).toBeFocused();
        await page.keyboard.press('Alt+ArrowDown');
        expect(await calls(page, 'moveQueueSong')).toEqual([]);
        await page.keyboard.press('ArrowDown');
        await expect(song(page, 199)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(song(page, 198)).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(input).toBeFocused();
        await page.keyboard.press('Enter');
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-198' }]);

        // 悬停动作按队列下标走；Delete 删的也是队列里的那一首，焦点落在剩下的匹配上。
        await row(page, 199).hover();
        await row(page, 199).locator('[data-queue-row-action="move-to-end"]').click();
        expect(await calls(page, 'moveQueueSongToEnd')).toEqual([{ kind: 'moveQueueSongToEnd', index: 199 }]);
        await probe(page, api => api.clearCalls());
        await probe(page, api => api.setCurrent(0));
        await song(page, 198).focus();
        await page.keyboard.press('Delete');
        expect(await calls(page, 'removeQueueSong')).toEqual([{ kind: 'removeQueueSong', index: 198 }]);
        await expect(rows).toHaveCount(1);
        await expect(song(page, 198)).toBeFocused();
        // 删掉最后剩下的那一行：焦点回到搜索框，不掉到 body 上。
        await page.keyboard.press('Delete');
        await expect(island(page).getByText('No songs match')).toBeVisible();
        await expect(input).toBeFocused();

        // 没有匹配：给一句说明。
        await input.fill('zzz');
        await expect(island(page).getByText('No songs match')).toBeVisible();

        // Esc 只收起搜索（搜索词一起清掉），焦点回到放大镜，面板还在。
        await input.focus();
        await page.keyboard.press('Escape');
        await expect(input).toHaveCount(0);
        await expect(searchButton).toBeFocused();
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 198 songs');
        await expect(island(page).locator('.lattice-tools-island-handle').first()).toBeAttached();
        await expect(panel(page)).toBeVisible();
    });

    test('clearing takes a second click within three seconds', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        const clear = island(page).locator('[data-queue-island-action="clear"]');
        await expect(clear).toHaveAccessibleName('Clear the queue');
        await clear.click();
        await expect(clear).toHaveAccessibleName('Click again to clear the queue');
        await expect(live(page)).toHaveText('Click again to clear the queue');
        expect(await calls(page, 'clearQueue')).toEqual([]);
        // 3 秒不点就复原。
        await expect(clear).toHaveAccessibleName('Clear the queue', { timeout: 5_000 });

        // 双击：第二击不算确认（进入确认态 400ms 内的点击与 detail > 1 的点击都不算）。
        await clear.dblclick();
        await expect(clear).toHaveAccessibleName('Click again to clear the queue');
        expect(await calls(page, 'clearQueue')).toEqual([]);
        // 连点两下（间隔不到 400ms）也不行。
        await clear.click();
        expect(await calls(page, 'clearQueue')).toEqual([]);
        await page.keyboard.press('Escape');
        await expect(clear).toHaveAccessibleName('Clear the queue');

        await clear.click();
        await page.waitForTimeout(450);
        await clear.click();
        expect(await calls(page, 'clearQueue')).toHaveLength(1);
        await expect(island(page).getByText('Queue is empty')).toBeVisible();
        await expect(island(page).locator('.lattice-tools-island-heading')).toHaveText('Play queue · 0 songs');
        await expect(island(page)).toBeVisible();
    });

    test('saving the queue as a local playlist uses an inline name field', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        // 在线队列不能存。
        await expect(island(page).locator('[data-queue-island-action="save"]')).toHaveCount(0);
        await probe(page, api => api.seed({ count: 12, local: true }));
        const save = island(page).locator('[data-queue-island-action="save"]');
        await expect(save).toHaveAccessibleName('Save as local playlist');

        await save.click();
        const input = island(page).getByRole('textbox', { name: 'Enter playlist name' });
        await expect(input).toBeFocused();
        // 打字（含会被墙当快捷键的字符）全部落进输入框。
        await page.keyboard.type('Night: mix s');
        await expect(input).toHaveValue('Night: mix s');
        await page.keyboard.press('Enter');
        expect(await calls(page, 'saveQueueAsPlaylist')).toEqual([{ kind: 'saveQueueAsPlaylist', name: 'Night: mix s' }]);
        await expect(input).toHaveCount(0);
        await expect(save).toBeFocused();

        // 失败：输入框留着，焦点回到它（保存中禁用会丢焦点），可以接着改名再试。
        await probe(page, api => api.failNextSave());
        await save.click();
        await page.keyboard.type('Again');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await calls(page, 'saveQueueAsPlaylist')).length).toBe(2);
        await expect(island(page).getByRole('textbox', { name: 'Enter playlist name' })).toHaveValue('Again');
        await expect(island(page).getByRole('textbox', { name: 'Enter playlist name' })).toBeFocused();
        await page.keyboard.type('!');
        await expect(island(page).getByRole('textbox', { name: 'Enter playlist name' })).toHaveValue('Again!');
    });

    test('Personal FM hides the island and disables the cell, keeping the preference', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await openPanel(page);
        await expect(island(page)).toBeVisible();
        await probe(page, api => api.setFmMode(true));
        await expect(island(page)).toHaveCount(0);
        await expect(queueQuick(page)).toBeDisabled();
        await expect(queueQuick(page)).toHaveAttribute('aria-description', 'Personal FM has no queue to edit');
        expect(await probe(page, api => api.islandPreference())).toBe(true);
        await probe(page, api => api.setFmMode(false));
        await expect(island(page)).toBeVisible();
    });

    test('an external Stage leaves the island read-only: songs play, nothing edits', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await watchDelete(page);
        await probe(page, api => api.setStage(true));
        await openPanel(page);
        await expect(island(page)).toHaveAttribute('data-queue-readonly', 'true');
        await expect(island(page).locator('.lattice-tools-island-handle')).toHaveCount(0);
        await expect(island(page).locator('[data-queue-island-action="clear"]')).toHaveCount(0);
        await row(page, 2).hover();
        await expect(row(page, 2).locator('[data-queue-row-action]')).toHaveCount(0);
        await song(page, 2).click();
        expect(await calls(page, 'playQueueSong')).toEqual([{ kind: 'playQueueSong', id: 'island-2' }]);
        await song(page, 2).focus();
        await page.keyboard.press('Alt+ArrowDown');
        await page.keyboard.press('Delete');
        expect(await calls(page, 'moveQueueSong')).toEqual([]);
        expect(await calls(page, 'removeQueueSong')).toEqual([]);
        // 只读时 Delete 也被浮岛消费，不漏到墙的批量移除。
        expect(await lastDeletePrevented(page)).toBe(true);
        // 洗牌格写的是舞台的原因，不是「至少两首」。
        await expect(panel(page).locator('[data-wall-tools-quick="shuffle-queue"]')).toHaveAttribute(
            'aria-description',
            "An external Stage is playing: the queue can't be shuffled",
        );
    });

    test('the clear confirmation stays legible when the accent is the text colour', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.setAccentMatchesText(true));
        await openPanel(page);
        const clear = island(page).locator('[data-queue-island-action="clear"]');
        await clear.click();
        await expect(clear).toHaveAccessibleName('Click again to clear the queue');
        const colors = () => clear.evaluate(node => {
            const style = getComputedStyle(node);
            return { color: style.color, background: style.backgroundColor };
        });
        await expect.poll(async () => { const { color, background } = await colors(); return color !== background; }).toBe(true);
        // 灯光开关的激活字与旋钮也一样。
        const active = panel(page).locator('.lattice-tools-lights-toggle span.is-active');
        await expect.poll(() => active.evaluate(node => {
            const style = getComputedStyle(node);
            return style.color !== style.backgroundColor;
        })).toBe(true);
    });

    test('in a short window the island centres the playing song on its real height', async ({ mount, page }) => {
        await page.setViewportSize({ width: 1280, height: 620 });
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ currentIndex: 120 }));
        await openPanel(page);
        const list = island(page).locator('.lattice-tools-island-scroll');
        // 浮岛被压缩：列表比按 8 行算的理想高度矮。
        const listHeight = await list.evaluate(node => node.clientHeight);
        expect(listHeight).toBeLessThan(8 * 40);
        await expect.poll(async () => Math.abs(((await rowOffset(page, 120)) ?? -999) + 20 - listHeight / 2)).toBeLessThan(24);
    });

    test('help plus the island stay inside the viewport and below the title bar strip', async ({ mount, page }) => {
        for (const height of [1100, 760, 620]) {
            await page.setViewportSize({ width: 1280, height });
            await mountProbe(mount, page);
            await probe(page, api => api.setHelpLines(14));
            await openPanel(page);
            await panel(page).getByRole('menuitem', { name: 'Operation guide' }).click();
            await expect(panel(page).locator('.lattice-tools-help')).toBeVisible();
            await page.waitForTimeout(400);
            const islandBox = (await island(page).boundingBox())!;
            const panelBox = (await panel(page).boundingBox())!;
            // 顶上让出 Electron 标题栏（32px）+ 间距。
            expect(islandBox.y).toBeGreaterThanOrEqual(48 - 0.5);
            expect(islandBox.height).toBeGreaterThanOrEqual(112 - 0.5);
            expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(height);
            expect(islandBox.y + islandBox.height).toBeLessThanOrEqual(panelBox.y);
        }
    });

    test('Escape peels one layer at a time; clicks inside the island keep the panel', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ count: 30, local: true }));
        await openPanel(page);

        // 点浮岛（空白头部、行）不收面板。
        await island(page).locator('.lattice-tools-island-heading').click();
        await expect(panel(page)).toBeVisible();

        // 内联输入：Esc 只撤输入。
        await island(page).locator('[data-queue-island-action="save"]').click();
        await expect(island(page).getByRole('textbox')).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(island(page).getByRole('textbox')).toHaveCount(0);
        await expect(panel(page)).toBeVisible();

        // 清空待确认：Esc 只撤确认。
        const clear = island(page).locator('[data-queue-island-action="clear"]');
        await clear.click();
        await expect(clear).toHaveAccessibleName('Click again to clear the queue');
        await page.keyboard.press('Escape');
        await expect(clear).toHaveAccessibleName('Clear the queue');
        await expect(panel(page)).toBeVisible();

        // 没有可撤的了：Esc 收起面板与浮岛，偏好不变。
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        await expect(island(page)).toHaveCount(0);
        expect(await probe(page, api => api.islandPreference())).toBe(true);

        // 点外面也一起收起。
        await openPanel(page);
        await expect(island(page)).toBeVisible();
        await page.locator('[data-probe-outside]').click();
        await expect(panel(page)).toHaveCount(0);
        await expect(island(page)).toHaveCount(0);
    });

    test('dark and daylight screenshots', async ({ mount, page }) => {
        await mountProbe(mount, page);
        await probe(page, api => api.seed({ currentIndex: 6 }));
        await openPanel(page);
        await row(page, 5).hover();
        await page.waitForTimeout(300);
        const root = page.locator('.lattice-tools');
        const box = (await island(page).boundingBox())!;
        const clip = { x: box.x - 24, y: box.y - 24, width: box.width + 48, height: page.viewportSize()!.height - box.y + 24 };
        await page.screenshot({ path: 'test-results/wall-tools-island-dark.png', clip });
        await probe(page, api => api.setDaylight(true));
        await expect(root).toHaveClass(/\bis-daylight\b/);
        await page.waitForTimeout(300);
        await page.screenshot({ path: 'test-results/wall-tools-island-daylight.png', clip });

        // 浮岛与下面的面板同宽、左右对齐（宽屏与窄屏都是）。
        const edges = async () => {
            const [a, b] = [(await island(page).boundingBox())!, (await panel(page).boundingBox())!];
            return [Math.round(a.x), Math.round(a.width), Math.round(b.x), Math.round(b.width)];
        };
        await expect.poll(async () => { const [ix, iw, px, pw] = await edges(); return ix === px && iw === pw; }).toBe(true);
        await page.setViewportSize({ width: 390, height: 760 });
        await expect.poll(async () => { const [ix, iw, px, pw] = await edges(); return ix === px && iw === pw && iw === 296; }).toBe(true);
        await page.screenshot({ path: 'test-results/wall-tools-island-mobile.png' });
    });
});
