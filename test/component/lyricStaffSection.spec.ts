import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/lyricStaffSection.spec.ts
// 覆盖歌词过滤面板里「开头制作人员信息」区块的接线：策略按钮和滑块是不是真的驱动了
// 同一份判定，预览标记是不是跟着走。判定算法本身有单测，这里只证明受控输入接对了地方，
// 走 dev 组件探针，见 dev/probes/lyricStaffSection.probe.tsx。

const sample = (page: Page, id: 'long-intro' | 'short-intro') => page.locator(`[data-probe-sample="${id}"]`);

const clickPolicy = async (page: Page, label: string) => {
    await sample(page, 'long-intro').getByRole('button', { name: label }).click();
};

test.describe('lyric staff section', () => {
    test('reports a different verdict for a long and a short intro', async ({ mount, page }) => {
        await mount('lyricStaffSection');

        await expect(sample(page, 'long-intro')).toContainText('Shown, spread across the intro');
        await expect(sample(page, 'short-intro')).toContainText('Hidden');
    });

    test('hides the verdict readout when credits are always shown', async ({ mount, page }) => {
        await mount('lyricStaffSection');

        await clickPolicy(page, 'Always show');

        await expect(sample(page, 'long-intro')).not.toContainText('Result for this song');
        // keep 策略下不再删任何行，两段歌词的署名都留在预览里。
        await expect(sample(page, 'short-intro').locator('.line-through')).toHaveCount(0);
    });

    test('drops the credit block everywhere when credits are always hidden', async ({ mount, page }) => {
        await mount('lyricStaffSection');

        await clickPolicy(page, 'Always hide');

        await expect(sample(page, 'long-intro')).toContainText('Hidden');
        await expect(sample(page, 'long-intro').locator('.line-through')).toHaveCount(4);
        // 4 条署名 + 中间和块尾的 4 条分隔行一起走。
        await expect(sample(page, 'short-intro').locator('.line-through')).toHaveCount(8);
    });

    test('raises the intro budget when the minimum dwell time grows', async ({ mount, page }) => {
        await mount('lyricStaffSection');

        const slider = sample(page, 'long-intro').locator('input[type="range"]');
        await slider.fill('4');

        // 4 秒/行 × 5 条署名放不进短前奏，长前奏依然摊得开。
        await expect(sample(page, 'long-intro')).toContainText('Shown, spread across the intro');
        await expect(sample(page, 'short-intro')).toContainText('Hidden');
    });
});

test.describe('lyric filter modal', () => {
    test('re-enables saving once the invalid staff pattern is off screen', async ({ mount, page }) => {
        await mount('lyricFilterModal');

        const save = page.getByRole('button', { name: 'Save' });
        await expect(save).toBeEnabled();

        await page.getByPlaceholder('Leave empty to use the built-in dictionary').fill('[');
        await expect(save).toBeDisabled();

        // 切到「始终显示」后自定义规则输入框收起，保存不该再被一个看不见的错误卡住。
        await page.getByRole('button', { name: 'Always show' }).click();
        await expect(save).toBeEnabled();
    });
});

test.describe('lyric staff segmented pickers', () => {
    const readGroupBackgrounds = (page: Page, group: 'policy' | 'absorb') =>
        sample(page, 'long-intro')
            .locator(`[data-staff-${group}-group] button[aria-pressed]`)
            .evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundColor));

    for (const group of ['policy', 'absorb'] as const) {
        test(`marks the selected ${group} option distinctly in both themes`, async ({ mount, page }) => {
            await mount('lyricStaffSection');

            for (const theme of ['dark', 'daylight']) {
                if (theme === 'daylight') {
                    await page.locator('[data-probe-toggle-daylight]').click();
                    await expect(page.locator('[data-probe-daylight="true"]')).toBeVisible();
                }

                const backgrounds = await readGroupBackgrounds(page, group);
                expect(backgrounds, `${group} / ${theme}`).toHaveLength(3);
                expect(new Set(backgrounds).size, `${group} / ${theme}`).toBe(2);
            }
        });
    }
});

test.describe('playback lyrics settings', () => {
    test('lists the lyric filtering entry next to the global timing offset', async ({ mount, page }) => {
        await mount('playbackLyricsSettings');

        const lyricsCard = page.locator('section', { hasText: 'Global Timing Offset' }).last();
        const entries = lyricsCard.locator('button', { hasText: /Global Timing Offset|Lyric Filtering/ });

        await expect(entries).toHaveCount(2);
        await expect(entries.nth(1)).toContainText('Lyric Filtering');
    });
});
