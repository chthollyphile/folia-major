import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/homePages.spec.ts
// Real Grid and Bravais homes: mod-owned components, native preservation, input and teardown.
type HomeWindow = Window & { __homePageTest: { mounts: number; disposes: number; shortcuts: number; unregister(): void; native: Element[] } };
async function registerPage(page: Page) {
    await page.evaluate(async () => {
        const modulePath = '/src/mods/folium/homePages.ts';
        const { homePagesRegistry } = await import(modulePath);
        const state = { mounts: 0, disposes: 0, shortcuts: 0, unregister() {}, native: [] as Element[] };
        (window as unknown as HomeWindow).__homePageTest = state;
        window.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'k') state.shortcuts++; });
        state.unregister = homePagesRegistry.register('home-test', {
            id: 'notes', label: { en: 'Home Notes' },
            mountNavigation(container: HTMLElement, ctx: { surface: string; open(): boolean }) {
                state.mounts++;
                const style = document.createElement('style');
                style.textContent = 'button { border: 0; background: red; color: white; padding: 6px; }';
                const button = document.createElement('button'); button.textContent = 'Home Notes';
                if (ctx.surface === 'bravais') button.style.writingMode = 'vertical-rl';
                button.onclick = () => ctx.open();
                container.append(style, button);
                return () => { state.disposes++; };
            },
            mountPage(container: HTMLElement, ctx: { close(): boolean }) {
                state.mounts++;
                const input = document.createElement('textarea'); input.setAttribute('aria-label', 'Note draft');
                const action = document.createElement('button'); action.textContent = 'Draft action';
                const result = document.createElement('output'); action.onclick = () => { result.textContent = 'action called'; };
                const close = document.createElement('button'); close.textContent = 'Mod close'; close.onclick = () => ctx.close();
                const inert = document.createElement('div'); inert.inert = true;
                const inertButton = document.createElement('button'); inertButton.textContent = 'Inert action'; inert.append(inertButton);
                const hiddenButton = document.createElement('button'); hiddenButton.textContent = 'Hidden action'; hiddenButton.style.visibility = 'hidden';
                container.append(input, action, close, result, inert, hiddenButton);
                return () => { state.disposes++; };
            },
        }).unregister;
    });
}
async function ready(page: Page, mount: (id: string) => Promise<unknown>, suite: 'grid' | 'bravais') {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await page.evaluate(value => window.__homeProbe!.setSuite(value), suite);
    await expect(page.locator(suite === 'grid' ? '[data-ponder-page-scope="grid-page"]' : '[data-bravais-home-seam]').first()).toBeVisible();
}
for (const suite of ['grid', 'bravais'] as const) {
    test(`${suite}: appends isolated mod navigation, preserves native buttons and restores after unregister`, async ({ page, mount }) => {
        await ready(page, mount, suite);
        const native = suite === 'grid' ? '[data-ponder-page-scope="grid-page"] button' : '[data-bravais-tab]';
        const readNative = () => page.evaluate(selector => [...document.querySelectorAll(selector)].map(element => ({
            html: (() => { const clone = element.cloneNode(true) as Element;
                clone.querySelectorAll('span.absolute').forEach(span => span.removeAttribute('style'));
                return clone.outerHTML; })(), background: getComputedStyle(element).backgroundColor,
        })), native);
        await page.waitForTimeout(250);
        const before = await readNative();
        await registerPage(page);
        const button = page.locator('[data-folium-slot="home.navigation"]').getByRole('button', { name: 'Home Notes' });
        await expect(button).toBeVisible();
        expect(await readNative()).toEqual(before);
        await page.screenshot({ path: test.info().outputPath(`${suite}-home-navigation.png`) });
        expect(await button.evaluate(element => element.getRootNode() instanceof ShadowRoot)).toBe(true);
        await page.evaluate(selector => { (window as unknown as HomeWindow).__homePageTest.native = [...document.querySelectorAll(selector)]; }, native);
        await button.focus(); await page.keyboard.press('Control+k');
        expect(await page.evaluate(() => (window as unknown as HomeWindow).__homePageTest.shortcuts)).toBe(1);
        await page.keyboard.press('Enter');
        const owned = page.locator('[data-folium-home-page="home-test:notes"]');
        await expect(owned).toBeVisible();
        await page.screenshot({ path: test.info().outputPath(`${suite}-home-page.png`) });
        const box = (await owned.boundingBox())!; expect(box.width).toBeGreaterThan(1000); expect(box.height).toBeGreaterThan(800);
        const source = await page.evaluate(() => window.__homeProbe!.tab());
        const input = owned.getByRole('textbox', { name: 'Note draft' });
        await input.focus(); await page.keyboard.press('Control+k');
        expect(await page.evaluate(() => (window as unknown as HomeWindow).__homePageTest.shortcuts)).toBe(2);
        await input.fill('Hello'); await input.press('End'); await page.keyboard.type(' world');
        await input.press('Enter'); await page.keyboard.type('Second line');
        await expect(input).toHaveValue('Hello world\nSecond line');
        await owned.getByRole('button', { name: 'Return to Home' }).focus();
        await page.keyboard.press('Shift+Tab');
        await expect(owned.getByRole('button', { name: 'Mod close' })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(owned.getByRole('button', { name: 'Return to Home' })).toBeFocused();
        await input.focus(); await input.press('Tab'); await expect(owned.getByRole('button', { name: 'Draft action' })).toBeFocused();
        await page.keyboard.press('Space'); await expect(owned.getByText('action called')).toBeVisible();
        await page.keyboard.press('Shift+Tab'); await expect(input).toBeFocused();
        expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe(source);
        await owned.getByRole('button', { name: 'Mod close' }).click();
        await expect(owned).toHaveCount(0);
        await expect(button).toBeFocused();
        expect(await page.evaluate(() => (window as unknown as HomeWindow).__homePageTest.native.every(element => element.isConnected))).toBe(true);
        await button.click(); await expect(owned).toBeVisible();
        await page.evaluate(() => (window as unknown as HomeWindow).__homePageTest.unregister());
        await expect(owned).toHaveCount(0); await expect(page.locator('[data-folium-slot="home.navigation"]')).toHaveCount(0);
        expect(await page.evaluate(() => { const s = (window as unknown as HomeWindow).__homePageTest; return s.mounts === s.disposes; })).toBe(true);
        expect(await page.evaluate(() => window.__homeProbe!.tab())).toBe(source);
        expect(await readNative()).toEqual(before);
    });
    test(`${suite}: native keyboard cycling stays within the original source tabs`, async ({ page, mount }) => {
        await ready(page, mount, suite); await registerPage(page);
        const initial = await page.evaluate(() => window.__homeProbe!.tab());
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.keyboard.press(suite === 'grid' ? 'Tab' : 'F6');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.tab())).not.toBe(initial);
        await expect(page.locator('[data-folium-home-page]')).toHaveCount(0);
        await page.keyboard.press(suite === 'grid' ? 'Shift+Tab' : 'Shift+F6');
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.tab())).toBe(initial);
        await expect(page.locator('[data-folium-home-page]')).toHaveCount(0);
    });
    test(`${suite}: native command selection dismisses the mod page, including the same native source`, async ({ page, mount }) => {
        await ready(page, mount, suite); await registerPage(page);
        await page.getByRole('button', { name: 'Home Notes', exact: true }).click();
        const owned = page.locator('[data-folium-home-page]'); await expect(owned).toBeVisible();
        await page.evaluate(async () => {
            const path = '/src/components/command-palette/commandFactories.ts';
            const { createHomeTabCommand } = await import(path);
            createHomeTabCommand(window.__homeProbe!.tab(), '', '', []).execute('', { navigation: {
                setHomeViewTab: () => {}, navigateToHome: () => {},
            } });
        });
        await expect(owned).toHaveCount(0);
        await page.getByRole('button', { name: 'Home Notes', exact: true }).click();
        await owned.getByRole('button', { name: 'Return to Home' }).click();
        await expect(owned).toHaveCount(0);
    });
}
test('actual offline sample registers and cleans up both slots and its command', async ({ page, mount }) => {
    await ready(page, mount, 'grid');
    await page.evaluate(async () => {
        const path = '/src/mods/folium/experimental.ts'; const apiPath = '/src/mods/folium/api.ts';
        const samplePath = '/dev/folium/sample-home-pages/client.mjs';
        const [{ createFoliumExperimental }, { createFoliumClientApi }, { default: activate }] = await Promise.all([import(path), import(apiPath), import(samplePath)]);
        const mod = { id: 'sample-home-pages', permissions: [], experimental: ['home.pages'] };
        const exported = createFoliumClientApi(mod, { context: 'export', internals: null });
        if (activate(exported) !== undefined) throw new Error('export window must stay inert');
        const client = createFoliumClientApi(mod, { context: 'main', internals: null, experimental: createFoliumExperimental(mod) });
        (window as unknown as HomeWindow).__homePageTest = { mounts: 0, disposes: 0, shortcuts: 0, native: [], unregister: activate(client) };
    });
    await page.screenshot({ path: test.info().outputPath('sample-home-navigation.png') });
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    const pageHost = page.locator('[data-folium-home-page]');
    await pageHost.getByRole('textbox', { name: 'Note draft' }).fill('offline text');
    await pageHost.getByRole('button', { name: 'Record action' }).click();
    await expect(pageHost.getByText('Actions: 1')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('sample-home-page.png') });
    await pageHost.getByRole('button', { name: 'Return to library' }).click();
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await expect(pageHost.getByRole('textbox')).toHaveValue('offline text');
    await page.evaluate(() => (window as unknown as HomeWindow).__homePageTest.unregister());
    await expect(pageHost).toHaveCount(0); await expect(page.locator('[data-folium-slot]')).toHaveCount(0);
});
