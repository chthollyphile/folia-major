import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/interactionSettingsSection.spec.ts
// 确认这一分区在侧栏里、在「控制」这一组下、点得进去，三项设置都真的渲染出来，
// 以及按键录制的四条规则：记下按键、拒绝并说明原因、不让这一次按键漏进 app、可以清除。

const shortcutSlot = (page: import('@playwright/test').Page) => page.getByTestId('custom-shortcut-slot');

const storedShortcut = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useInteractionSettingsStore.ts';
    const { useInteractionSettingsStore } = await import(storeModulePath);
    return useInteractionSettingsStore.getState().customShortcutLetter;
});

const openInteractionSettings = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options');
    });

    await expect(page.getByText('Controls', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Interaction', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Interaction', exact: true })).toBeVisible();
};

test('lists Interaction under Controls and opens it', async ({ page }) => {
    await openInteractionSettings(page);

    await expect(page.getByRole('heading', { name: 'Interaction', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filter search' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Open the command palette with S on a grid' })).toBeVisible();
    await expect(page.getByLabel('Key')).toBeVisible();
    await expect(page.getByLabel('Runs')).toBeVisible();
});

test('records the shortcut key by capturing the next press', async ({ page }) => {
    await openInteractionSettings(page);
    const keyField = page.getByLabel('Key');
    // Alt 是画出来的、不可编辑的那一半；只有右边这个位子是录的。
    await expect(keyField).toContainText('Alt');
    await expect(shortcutSlot(page)).toHaveText('Not set');

    await keyField.click();
    await expect(shortcutSlot(page)).toHaveText('Press a key…');
    await page.keyboard.press('j');

    await expect(shortcutSlot(page)).toHaveText('J');
    expect(await storedShortcut(page)).toBe('j');
});

test('refuses a key it cannot bind, and says why', async ({ page }) => {
    await openInteractionSettings(page);
    const keyField = page.getByLabel('Key');

    await keyField.click();
    await page.keyboard.press('1');

    await expect(page.getByText('Letters A–Z only')).toBeVisible();
    // 还在等：拒绝一个键不该把录制模式也一起关掉。
    await expect(shortcutSlot(page)).toHaveText('Press a key…');

    await page.keyboard.press('k');
    await expect(shortcutSlot(page)).toHaveText('K');
});

test('does not let the captured key reach the app', async ({ page }) => {
    await openInteractionSettings(page);
    await page.getByLabel('Key').click();

    // S 是播放页打开命令面板的键。录制期间它必须只被记下来，而不是同时把面板拉开。
    await page.keyboard.press('s');

    await expect(shortcutSlot(page)).toHaveText('S');
    await expect(page.getByTestId('command-palette-panel')).toHaveCount(0);
});

test('clears the binding', async ({ page }) => {
    await openInteractionSettings(page);
    const keyField = page.getByLabel('Key');
    await keyField.click();
    await page.keyboard.press('j');
    await expect(shortcutSlot(page)).toHaveText('J');

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(shortcutSlot(page)).toHaveText('Not set');
    expect(await storedShortcut(page)).toBeNull();
});
