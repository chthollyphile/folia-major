import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/loginPlatformColumn.spec.ts
// 登录窗口平台列的高亮块（#913）：8 行平分列高、最后一行取整后的底边比列表多 1px 时，指针移到最后一行，
// 高亮块不能把列表撑出滚动条。以前它用取整的 offset* 量，撑出的滚动条又让行变窄，测量来回切换，
// 布局阶段的 setState 停不下来，React 报更新层数超限，整个界面空白。只有真浏览器排版才有这些小数，
// 所以走 dev/probes/loginWindow.probe.tsx。

const WIDTH = 1000;

/** 列表的高，和最后一行按小数、按取整算的底边。 */
const measure = (list: Locator) => list.evaluate((element) => {
    const rows = element.querySelectorAll<HTMLElement>('[data-row]');
    const last = rows[rows.length - 1];
    const listTop = element.getBoundingClientRect().top + element.clientTop;
    const box = last.getBoundingClientRect();
    return {
        rows: rows.length,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        realBottom: box.bottom - listTop,
        roundedBottom: last.offsetTop + last.offsetHeight,
    };
});

/** 找一个窗口高，让列表正好装满 8 行，而最后一行取整后的底边多出来：报告里会炸的那几档。 */
async function findOverflowingHeight(page: Page, list: Locator): Promise<number> {
    for (let height = 440; height <= 600; height += 1) {
        await page.setViewportSize({ width: WIDTH, height });
        const seen = await measure(list);
        if (seen.scrollHeight === seen.clientHeight && Math.abs(seen.realBottom - seen.clientHeight) < 0.01 && seen.roundedBottom > seen.clientHeight) {
            return height;
        }
    }
    throw new Error('no window height in 440–600 makes the last row round past the list');
}

test('hovering the last of 8 platform rows keeps the window and adds no scrollbar', async ({ page, mount }) => {
    await page.setViewportSize({ width: WIDTH, height: 470 });
    await mount('loginWindow', { count: 8, lang: 'en', motion: 'off' });
    // 登录窗口画在 #root 外面（portal）。
    const list = page.getByRole('dialog').getByRole('listbox');
    await expect(list.locator('[data-row]')).toHaveCount(8);
    await findOverflowingHeight(page, list);

    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const last = list.locator('[data-row]').last();
    await last.hover();
    await expect(list).toHaveAttribute('aria-activedescendant', await last.getAttribute('id') ?? '');

    expect(errors).toEqual([]);
    await expect(list).toBeVisible();
    const after = await measure(list);
    expect(after.scrollHeight).toBe(after.clientHeight);
    // 高亮块和行一样大，落在行上。
    const [highlight, row] = await Promise.all([
        list.locator('> [aria-hidden]').first().evaluate(element => ({ height: parseFloat((element as HTMLElement).style.height) })),
        last.evaluate(element => parseFloat(getComputedStyle(element).height)),
    ]);
    expect(highlight.height).toBeCloseTo(row, 2);
});
