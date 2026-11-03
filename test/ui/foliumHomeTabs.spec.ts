import { expect, test } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/foliumHomeTabs.spec.ts
// Exercise the real App palette listener across host navigation and owned ShadowRoot input.
// 另外：打开页面时焦点交给页面的页签；命令面板里运行模组命令打开的页面，等面板关掉之后再拿焦点。

for (const suite of ['grid', 'bravais'] as const) {
    test(`${suite}: the global command palette remains reachable from an owned home page`, async ({ page }) => {
        await installBaseState(page, { neteaseMode: 'guest' });
        await mockNeteaseApi(page, 'guest');
        await openApp(page);
        await page.evaluate(async value => {
            const suitePath = '/src/library/core/suite/useLibrarySuiteStore.ts';
            const registryPath = '/src/mods/folium/registries/homeTabs.ts';
            const { useLibrarySuiteStore } = await import(suitePath);
            const { homeTabsRegistry } = await import(registryPath);
            useLibrarySuiteStore.getState().setSuite(value);
            homeTabsRegistry.register('home-test', {
                id: 'messages', label: { en: 'Home Messages' },
                mount(container: HTMLElement) {
                    const input = document.createElement('textarea'); input.setAttribute('aria-label', 'Message draft');
                    container.append(input);
                },
            });
        }, suite);
        const entry = suite === 'grid' ? page.getByRole('button', { name: 'Home Messages', exact: true })
            : page.locator('[data-bravais-tab="home-test:messages"]');
        await entry.click();
        const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
        // 真实 App 里没有常驻的接管键盘的窗口挡着：打开时焦点照常交给页面的页签。
        await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
        const palette = page.getByTestId('command-palette-panel');
        await homePage.getByRole('button', { name: 'Back to library' }).press('ControlOrMeta+k');
        await expect(palette).toBeVisible();
        await palette.getByRole('combobox').press('Escape');
        await expect(palette).toHaveCount(0);
        const draft = homePage.getByRole('textbox', { name: 'Message draft' });
        await draft.fill('Hello');
        await draft.press('End');
        await draft.press('Enter');
        await page.keyboard.type('Second line');
        await draft.press('Control+Enter');
        await expect(draft).toHaveValue('Hello\nSecond line');
        await expect(palette).toHaveCount(0);
        await draft.press('ControlOrMeta+k');
        await expect(palette).toBeVisible();
        await expect(homePage).toBeVisible();
    });
}

// 命令面板里运行一个打开首页页面的模组命令：页面打开的那一刻焦点还在面板的输入框里（面板是接管键盘的窗口），
// 页面不抢；面板关掉、淡出之后焦点空出来，再交给页面的页签。
for (const suite of ['grid', 'bravais'] as const) {
    test(`${suite}: a page opened by a mod command from the palette gets focus once the palette is gone`, async ({ page }) => {
        await installBaseState(page, { neteaseMode: 'guest' });
        await mockNeteaseApi(page, 'guest');
        await openApp(page);
        await page.evaluate(async value => {
            const suitePath = '/src/library/core/suite/useLibrarySuiteStore.ts';
            const desktopPath = '/src/stores/useDesktopSettingsStore.ts';
            const homeTabsPath = '/src/mods/folium/registries/homeTabs.ts';
            const commandsPath = '/src/mods/folium/registries/commands.ts';
            const { useLibrarySuiteStore } = await import(suitePath);
            const { useDesktopSettingsStore } = await import(desktopPath);
            const { homeTabsRegistry, selectFoliumHomeTab } = await import(homeTabsPath);
            const { commandsRegistry } = await import(commandsPath);
            useLibrarySuiteStore.getState().setSuite(value);
            // 模组命令只在模组系统开着时进命令面板。
            useDesktopSettingsStore.setState({ modSystemEnabled: true });
            homeTabsRegistry.register('home-test', {
                id: 'messages', label: { en: 'Home Messages' },
                mount(container: HTMLElement) {
                    const input = document.createElement('textarea'); input.setAttribute('aria-label', 'Message draft');
                    container.append(input);
                },
            });
            commandsRegistry.register('home-test', {
                id: 'open-messages', label: { en: 'Open the messages page' },
                run: () => { selectFoliumHomeTab('home-test:messages'); },
            });
        }, suite);
        const palette = page.getByTestId('command-palette-panel');
        await expect.poll(async () => {
            await page.keyboard.press('ControlOrMeta+k');
            return palette.count();
        }).toBeGreaterThan(0);
        await palette.getByRole('combobox').fill('Open the messages page');
        const row = palette.getByText('Open the messages page', { exact: true }).first();
        await expect(row).toBeVisible();
        await row.click();
        const homePage = page.locator('[data-folium-home-page="home-test:messages"]');
        await expect(homePage).toBeVisible();
        await expect(palette).toHaveCount(0);
        await expect(homePage.getByRole('button', { name: 'Home Messages', exact: true })).toBeFocused();
    });
}
