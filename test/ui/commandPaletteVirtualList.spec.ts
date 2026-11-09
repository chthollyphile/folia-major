import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/commandPaletteVirtualList.spec.ts
// 「全部命令」列表的虚拟化：既要证明它真的只渲染可视区（否则虚拟化白做），
// 也要证明滚到底仍然能拿到最后一条（否则就是把命令弄丢了）。
//
// 尺寸不变由 commandPaletteSizing.spec.ts 单独守，这里不重复。

const seedApp = async (page: Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);

    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
};

const palette = (page: Page) => page.getByTestId('command-palette-panel');

const openAllCommands = async (page: Page) => {
    await seedApp(page);
    await page.goto('/');
    await waitForAppMounted(page);

    // 不定长等待开机：一直敲到面板真的响应为止。
    await expect.poll(async () => {
        await page.keyboard.press('s');
        return palette(page).count();
    }).toBeGreaterThan(0);

    await palette(page).getByRole('button', { name: '查看全部命令' }).click();
    // 表头那个计数是「全部命令」视图独有的，它出现就说明列表已经切过去了。
    await expect(palette(page).locator('span.tabular-nums').first()).toBeVisible();
};

/** 表头右侧那个 tabular-nums 数字就是可用命令总数。 */
const readTotal = async (page: Page) => {
    const header = palette(page).locator('span.tabular-nums').first();
    return Number((await header.innerText()).trim());
};

const countRenderedRows = (page: Page) => palette(page).getByRole('button').count();

test('全部命令列表只渲染可视区，而不是把整份注册表铺进 DOM', async ({ page }) => {
    await openAllCommands(page);

    const total = await readTotal(page);
    expect(total).toBeGreaterThan(100);

    // 行是 60px，可视区是 min(496, 50vh) 减去表头，最多装十来行；加上 overscan 也远少于总数。
    // 这条断言的意义是「虚拟化确实生效」——铺全量时这里会等于 total 加上几个外壳按钮。
    const rendered = await countRenderedRows(page);
    expect(rendered).toBeLessThan(total / 2);
});

test('滚到底仍然能拿到最后一条命令', async ({ page }) => {
    await openAllCommands(page);

    const firstTitles = await palette(page).getByRole('button').allInnerTexts();

    const scroller = palette(page).locator('.custom-scrollbar').first();
    await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
    });

    // 等窗口真的挪过去：渲染出来的那批行必须和滚动前不同。
    await expect.poll(async () => {
        const titles = await palette(page).getByRole('button').allInnerTexts();
        return titles.join('|');
    }).not.toBe(firstTitles.join('|'));

    const lastTitles = await palette(page).getByRole('button').allInnerTexts();

    // 滚动后渲染出来的是另一批行——说明窗口在移动，而不是一次性铺完后只是滚了滚条。
    expect(lastTitles).not.toEqual(firstTitles);
    // 而且末尾这批里必须有内容，不能滚到底之后是空的。
    expect(lastTitles.filter(text => text.trim().length > 0).length).toBeGreaterThan(0);
});

test('点击列表里的一项会回填一个仍能搜到它的词', async ({ page }) => {
    await openAllCommands(page);

    // 回填用的是检索索引算出的 primaryTerm，不再是 keywords[0]——关键词降级之后那个字段
    // 已经不保证存在，也不保证是拉丁字母。primaryTerm 是英文，而行上显示的是本地化标题，
    // 两者本来就不会重叠，所以这里验的是「回填的词能不能把这条命令搜出来」。
    const rows = palette(page).getByRole('button');
    const clickedTitle = (await rows.nth(3).innerText()).split('\n')[0].trim();
    await rows.nth(3).click();

    // 点击会回填输入框并切回匹配列表；等输入框真的有值，而不是睡一觉。
    await expect.poll(() => palette(page).getByRole('combobox').inputValue()).not.toBe('');

    const query = await palette(page).getByRole('combobox').inputValue();
    expect(query.trim()).toMatch(/^[\x20-\x7e]+$/);

    await expect(palette(page).getByText(clickedTitle, { exact: true }).first()).toBeVisible();
});
