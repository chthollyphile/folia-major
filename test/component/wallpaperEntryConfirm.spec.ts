import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/wallpaperEntryConfirm.spec.ts
// 进入壁纸模式前的首次确认弹窗：取消不进入、确认后才进入并记下已确认、之后进入不再弹窗；
// 退出不弹窗，且文案写明退出方式。探针见 dev/probes/wallpaperEntryConfirm.probe.tsx。

const ROOT = '[data-probe-wallpaper-confirm]';
const DIALOG_TITLE = 'Enter wallpaper mode?';

const readAttr = (page: Page, name: string) => page.locator(ROOT).getAttribute(name);

test('cancelling the confirmation does not enter wallpaper mode', async ({ page, mount }) => {
    await mount('wallpaperEntryConfirm');
    await expect(page.locator(ROOT)).toHaveAttribute('data-probe-wallpaper-confirm', 'ready');

    await page.locator('[data-probe="enter"]').click();
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeVisible();
    // 点击弹出确认时不得已经进入
    expect(await readAttr(page, 'data-probe-saved')).toBe('');

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeHidden();
    expect(await readAttr(page, 'data-probe-saved')).toBe('');
    expect(await readAttr(page, 'data-probe-wallpaper-mode')).toBe('false');
    expect(await readAttr(page, 'data-probe-confirmed')).toBe('false');
});

test('confirming enters wallpaper mode and the copy states how to leave', async ({ page, mount }) => {
    await mount('wallpaperEntryConfirm');
    await expect(page.locator(ROOT)).toHaveAttribute('data-probe-wallpaper-confirm', 'ready');

    await page.locator('[data-probe="enter"]').click();
    await expect(page.getByText('system tray')).toBeVisible();
    await expect(page.getByText('Wallpaper Mode', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Enter wallpaper mode' }).click();
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeHidden();
    expect(await readAttr(page, 'data-probe-saved')).toBe('wallpaper_entry_confirmed=true,wallpaper_mode=true');
    expect(await readAttr(page, 'data-probe-wallpaper-mode')).toBe('true');
    expect(await readAttr(page, 'data-probe-confirmed')).toBe('true');
});

test('later entries go straight in without asking again', async ({ page, mount }) => {
    await mount('wallpaperEntryConfirm');
    await expect(page.locator(ROOT)).toHaveAttribute('data-probe-wallpaper-confirm', 'ready');

    await page.locator('[data-probe="enter"]').click();
    await page.getByRole('button', { name: 'Enter wallpaper mode' }).click();
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeHidden();
    expect(await readAttr(page, 'data-probe-confirmed')).toBe('true');

    await page.locator('[data-probe="leave"]').click();
    await page.locator('[data-probe="enter"]').click();

    // 第二次进入不弹窗，直接写入 wallpaper_mode
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeHidden();
    expect(await readAttr(page, 'data-probe-wallpaper-mode')).toBe('true');
});

test('leaving wallpaper mode needs no confirmation', async ({ page, mount }) => {
    await mount('wallpaperEntryConfirm');
    await expect(page.locator(ROOT)).toHaveAttribute('data-probe-wallpaper-confirm', 'ready');

    await page.locator('[data-probe="enter"]').click();
    await page.getByRole('button', { name: 'Enter wallpaper mode' }).click();
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeHidden();

    await page.locator('[data-probe="leave"]').click();
    await expect(page.getByRole('heading', { name: DIALOG_TITLE })).toBeHidden();
    expect(await readAttr(page, 'data-probe-saved')).toBe('wallpaper_entry_confirmed=true,wallpaper_mode=true,wallpaper_mode=false');
    expect(await readAttr(page, 'data-probe-wallpaper-mode')).toBe('false');
});
