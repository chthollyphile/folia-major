import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/interactionSettingsSection.spec.ts
// 确认这一分区在侧栏里、在「控制」这一组下、点得进去，三项设置都真的渲染出来，
// 以及按键录制的四条规则：记下按键、拒绝并说明原因、不让这一次按键漏进 app、可以清除。

// 按键框：「自定义快捷键」那一行里的按钮，名字是这一行的标题加上它显示的键；
// 它的文字就是 Alt、加号和录到的键（或「未设置」「按下一个键…」）。
const keyField = (page: import('@playwright/test').Page) => (
    page.locator('[data-settings-row="customShortcut"]').getByRole('button', { name: /^Custom shortcut/ })
);

const storedShortcut = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useInteractionSettingsStore.ts';
    const { useInteractionSettingsStore } = await import(storeModulePath);
    return useInteractionSettingsStore.getState().customShortcutLetter;
});

const openInteractionSettings = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options');
    });

    await expect(page.getByText('App', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Shortcuts', exact: true })).toBeVisible();
};

test('lists Shortcuts under App and opens it', async ({ page }) => {
    await openInteractionSettings(page);

    await expect(page.getByRole('heading', { name: 'Shortcuts', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filter search' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Open the command palette with S on a grid' })).toBeVisible();
    await expect(keyField(page)).toBeVisible();
    await expect(page.locator('[data-settings-row="customShortcut"]').getByRole('combobox', { name: /Runs/ })).toBeVisible();
});

test('records the shortcut key by capturing the next press', async ({ page }) => {
    await openInteractionSettings(page);
    // Alt 是画出来的、不可编辑的那一半；只有右边这个位子是录的。
    await expect(keyField(page)).toHaveText('Alt+Not set');

    await keyField(page).click();
    await expect(keyField(page)).toHaveText('Alt+Press a key…');
    await page.keyboard.press('j');

    await expect(keyField(page)).toHaveText('Alt+J');
    expect(await storedShortcut(page)).toBe('j');
});

test('refuses a key it cannot bind, and says why', async ({ page }) => {
    await openInteractionSettings(page);
    await keyField(page).click();
    await page.keyboard.press('1');

    await expect(page.getByText('Letters A–Z only')).toBeVisible();
    // 还在等：拒绝一个键不该把录制模式也一起关掉。
    await expect(keyField(page)).toHaveText('Alt+Press a key…');

    await page.keyboard.press('k');
    await expect(keyField(page)).toHaveText('Alt+K');
});

test('does not let the captured key reach the app', async ({ page }) => {
    await openInteractionSettings(page);
    await keyField(page).click();

    // S 是播放页打开命令面板的键。录制期间它必须只被记下来，而不是同时把面板拉开。
    await page.keyboard.press('s');

    await expect(keyField(page)).toHaveText('Alt+S');
    await expect(page.getByTestId('command-palette-panel')).toHaveCount(0);
});

test('clears the binding', async ({ page }) => {
    await openInteractionSettings(page);
    await keyField(page).click();
    await page.keyboard.press('j');
    await expect(keyField(page)).toHaveText('Alt+J');

    await page.getByRole('button', { name: 'Clear' }).click();

    await expect(keyField(page)).toHaveText('Alt+Not set');
    expect(await storedShortcut(page)).toBeNull();
});

test('lands on the section a command names, not the top of its page', async ({ page }) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);

    const openPlayerPage = (anchorId: string | null) => page.evaluate(async (anchor) => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options', 'player', null, anchor);
    }, anchorId);

    const contentsEntry = (label: string) => page.locator('header').getByRole('button', { name: label, exact: true });
    const lastGroup = page.locator('[data-settings-anchor="labPlayerUi"] [data-settings-fold]');

    // 播放页足够长，末尾那一组不滚是够不着的——先确认这一点，否则下面那条断言只是在
    // 陈述页面本来就短。
    await openPlayerPage(null);
    await expect(page.getByRole('heading', { name: 'View', exact: true }).first()).toBeVisible();
    await expect(contentsEntry('Player Page UI')).not.toHaveAttribute('aria-current', 'true');
    await expect(lastGroup).not.toBeInViewport();

    // 这正是一条锚点级设置命令的调用形状：页 + 页内分组。落点是一个折叠的分组，落过去要把它打开。
    await openPlayerPage('labPlayerUi');
    await expect(contentsEntry('Player Page UI')).toHaveAttribute('aria-current', 'true');
    await expect(lastGroup).toBeInViewport();
    await expect(lastGroup.locator('button[aria-expanded]').first()).toHaveAttribute('aria-expanded', 'true');

    // 有些锚点现在落在分组里的某一行上，而不是一个分组上。
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options', 'home', null, 'grid3dCardStyle');
    });
    await expect(page.getByRole('heading', { name: 'Home & playlists', exact: true })).toBeVisible();
    await expect(page.locator('[data-settings-row="grid3dCardStyle"]')).toBeInViewport();
});
