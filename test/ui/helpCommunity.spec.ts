import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/helpCommunity.spec.ts
// 帮助页的「加入社区」：一颗胶囊，点开在 Discord 与 QQ 自助交流群之间选。Discord 打开邀请链接；
// QQ 复制群号并在这一项上显示「已复制」（剪贴板 API 被拒时退回 execCommand）；Escape 只关菜单不关设置。

const QQ_GROUP_NUMBER = '372521584';
const DISCORD_INVITE_URL = 'https://discord.com/invite/dMDBTHxeKd';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const openHelp = async (page: Page, { denyClipboardApi = false } = {}) => {
    await page.addInitScript(([version, guideKey, deny]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
        // 记下 window.open 打开的地址，不真的开新页。
        const opened: string[] = [];
        (window as unknown as { __opened: string[] }).__opened = opened;
        window.open = ((url?: string | URL) => {
            opened.push(String(url));
            return null;
        }) as typeof window.open;
        if (deny) {
            navigator.clipboard.writeText = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
        }
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, denyClipboardApi] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('help');
    });
};

const capsule = (page: Page) => page.getByRole('button', { name: 'Join the community', exact: true });
const menu = (page: Page) => page.getByRole('menu', { name: 'Join the community' });
const qqItem = (page: Page) => menu(page).getByRole('menuitem', { name: /QQ self-help group/ });
const discordItem = (page: Page) => menu(page).getByRole('menuitem', { name: /Discord server/ });
const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const openedUrls = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);

test('one community capsule replaces the separate Discord and QQ buttons', async ({ page }) => {
    await openHelp(page);

    await expect(capsule(page)).toBeVisible();
    await expect(capsule(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('button', { name: /Join our Discord/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /QQ self-help group/ })).toHaveCount(0);

    await capsule(page).click();
    await expect(capsule(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(discordItem(page)).toBeVisible();
    await expect(qqItem(page)).toContainText(QQ_GROUP_NUMBER);
});

test('the QQ option copies the group number and says so', async ({ page }) => {
    await openHelp(page);
    await page.evaluate(() => navigator.clipboard.writeText(''));

    await capsule(page).click();
    await qqItem(page).click();

    // 菜单留着，这一项换成「已复制」。
    await expect(qqItem(page)).toContainText('Group number copied');
    expect(await readClipboard(page)).toBe(QQ_GROUP_NUMBER);
    // 约 1.8s 后变回群号。
    await expect(qqItem(page)).toContainText(QQ_GROUP_NUMBER, { timeout: 4000 });
});

test('the Discord option opens the invite and closes the menu', async ({ page }) => {
    await openHelp(page);

    await capsule(page).click();
    await discordItem(page).click();

    await expect(menu(page)).toHaveCount(0);
    expect(await openedUrls(page)).toEqual([DISCORD_INVITE_URL]);
});

test('Escape closes only the menu, and a click elsewhere closes it too', async ({ page }) => {
    await openHelp(page);

    await capsule(page).click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    // 设置还开着：胶囊仍在。
    await expect(capsule(page)).toBeVisible();

    await capsule(page).click();
    await expect(menu(page)).toBeVisible();
    await page.getByRole('button', { name: 'Need help?' }).hover();
    await page.mouse.down();
    await page.mouse.up();
    await expect(menu(page)).toHaveCount(0);
});

test('copying falls back to execCommand when the clipboard API is refused', async ({ page }) => {
    await openHelp(page, { denyClipboardApi: true });

    await capsule(page).click();
    await qqItem(page).click();

    await expect(qqItem(page)).toContainText('Group number copied');
    expect(await readClipboard(page)).toBe(QQ_GROUP_NUMBER);
});
