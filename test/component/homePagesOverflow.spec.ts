import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import { PROBE_PROVIDER_A } from '../../dev/probes/libraryBehavior/fixtureRules';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/homePagesOverflow.spec.ts
// Real Bravais sizing: one live mod mount follows native shortcuts into the existing overflow menu.
type OverflowWindow = Window & { overflow: {
    mounts: number; disposes: number; nodes: HTMLElement[]; initialLayout: { connected: boolean; width: number }[];
    add(id: string, height: number): void; remove(id: string): void; resize(id: string, height: number): void;
} };
const seam = (page: Page) => page.locator('[data-bravais-home-seam]');
const more = (page: Page) => seam(page).locator('[data-bravais-seam-action="more"]');
const menu = (page: Page) => seam(page).locator('[data-bravais-seam-menu]');
const column = (page: Page) => seam(page).locator('[data-bravais-home-jumps]');
const nav = (page: Page, id = 'Notes') => page.getByRole('button', { name: id, exact: true });
async function ready(page: Page, mount: (id: string) => Promise<unknown>) {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false)).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(seam(page)).toBeVisible();
    await expect(page.locator('[data-library-stage="bravais"]')).not.toHaveAttribute('data-bravais-settling', /.*/);
    await page.evaluate(async () => {
        const path = '/src/mods/folium/homePages.ts'; const { homePagesRegistry } = await import(path);
        const handles = new Map<string, { unregister(): void }>();
        const buttons = new Map<string, HTMLButtonElement>();
        const state: OverflowWindow['overflow'] = {
            mounts: 0, disposes: 0, nodes: [], initialLayout: [],
            add(id, height) {
                handles.set(id, homePagesRegistry.register('overflow-test', {
                    id: id.toLowerCase(), label: { en: id },
                    mountNavigation(container: HTMLElement, ctx: { open(): boolean }) {
                        state.mounts++;
                        state.initialLayout.push({ connected: container.isConnected, width: container.clientWidth });
                        const button = document.createElement('button'); button.textContent = id;
                        button.style.cssText = `height:${height}px;color:white;background:#493b64;width:100%;border-radius:8px`;
                        button.onclick = () => ctx.open(); buttons.set(id, button); state.nodes.push(button);
                        container.append(button);
                        return () => { state.disposes++; buttons.delete(id); };
                    },
                    mountPage(container: HTMLElement, ctx: { close(): boolean }) {
                        const button = document.createElement('button'); button.textContent = 'Close mod page'; button.onclick = () => ctx.close();
                        container.append(button);
                    },
                }));
            },
            remove(id) { handles.get(id)?.unregister(); handles.delete(id); },
            resize(id, height) { buttons.get(id)!.style.height = `${height}px`; },
        };
        (window as unknown as OverflowWindow).overflow = state;
    });
}
const add = (page: Page, id = 'Notes', height = 32) => page.evaluate(({ id, height }) => (window as unknown as OverflowWindow).overflow.add(id, height), { id, height });
const mountCounts = (page: Page) => page.evaluate(() => { const s = (window as unknown as OverflowWindow).overflow; return [s.mounts, s.disposes]; });

test('Bravais shortcuts: native items first, single live mod moves into more and back with focus', async ({ page, mount }) => {
    await ready(page, mount); await add(page);
    await expect(nav(page)).toBeVisible();
    const initialMounts = await mountCounts(page);
    const native = column(page).locator('[data-bravais-shortcut]');
    await expect(native).toHaveCount(2);
    await expect(column(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    expect((await nav(page).boundingBox())!.y).toBeGreaterThanOrEqual((await native.last().boundingBox())!.y + (await native.last().boundingBox())!.height);
    const width = (await nav(page).boundingBox())!.width;
    await page.screenshot({ path: test.info().outputPath('bravais-shortcuts-high.png') });
    await native.last().focus(); await page.keyboard.press('ArrowDown'); await expect(nav(page)).toBeFocused();
    await page.setViewportSize({ width: 1440, height: 430 });
    await expect(seam(page)).toHaveAttribute('data-bravais-home-shortcuts', 'menu');
    await expect(more(page)).toBeFocused();
    await expect(nav(page)).toHaveCount(0); // parked inert content is absent from the accessibility tree
    await more(page).press('Space');
    await expect(menu(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    await expect.poll(async () => (await nav(page).boundingBox())!.width).toBeCloseTo(width, 1);
    await menu(page).locator('[data-bravais-shortcut]').last().focus();
    await page.keyboard.press('ArrowDown'); await expect(nav(page)).toBeFocused();
    await nav(page).press('Escape');
    await expect(menu(page)).toHaveCount(0); await expect(more(page)).toBeFocused();
    await more(page).press('Enter'); await nav(page).press('Space');
    await expect(page.locator('[data-folium-home-page]')).toBeVisible();
    await page.getByRole('button', { name: 'Close mod page' }).click();
    await expect(more(page)).toBeFocused();
    await more(page).press('Enter'); await nav(page).focus();
    await page.screenshot({ path: test.info().outputPath('bravais-shortcuts-overflow.png') });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect(column(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    await expect(nav(page)).toBeFocused();
    expect(await mountCounts(page)).toEqual(initialMounts);
    expect(await page.evaluate(() => (window as unknown as OverflowWindow).overflow.nodes.at(-1)!.isConnected)).toBe(true);
});

test('Bravais shortcuts: logged-out mod still appears and overflow accepts pointer clicks', async ({ page, mount }) => {
    await ready(page, mount);
    await page.evaluate(id => window.__homeProbe!.signOut(id), PROBE_PROVIDER_A);
    await expect(column(page).locator('[data-bravais-shortcut]')).toHaveCount(0);
    await add(page, 'Notes', 80);
    await expect(column(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    const initialMounts = await mountCounts(page);
    await page.setViewportSize({ width: 1440, height: 320 });
    await more(page).click(); await expect(menu(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    await nav(page).click(); await expect(page.locator('[data-folium-home-page]')).toBeVisible();
    await page.getByRole('button', { name: 'Close mod page' }).click(); await expect(more(page)).toBeFocused();
    expect(await mountCounts(page)).toEqual(initialMounts);
});

test('Bravais shortcuts: dynamic registrations and parked size changes restore native fit without remounts', async ({ page, mount }) => {
    await ready(page, mount);
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = await seam(page).getAttribute('data-bravais-home-fit');
    const nativeBefore = await column(page).locator('[data-bravais-shortcut]').allTextContents();
    await add(page); await add(page, 'Chat');
    await expect(column(page).getByRole('button', { name: 'Chat' })).toBeVisible();
    const initialMounts = await mountCounts(page);
    const initialLayout = await page.evaluate(() => (window as unknown as OverflowWindow).overflow.initialLayout);
    expect(initialLayout.every(layout => layout.connected && layout.width > 0)).toBe(true);
    await page.evaluate(() => (window as unknown as OverflowWindow).overflow.resize('Chat', 1000));
    await expect(seam(page)).toHaveAttribute('data-bravais-home-shortcuts', 'menu');
    await more(page).click(); await expect(menu(page).getByRole('button', { name: 'Chat' })).toBeVisible();
    await more(page).click(); await expect(menu(page)).toHaveCount(0);
    await page.evaluate(() => (window as unknown as OverflowWindow).overflow.resize('Chat', 24));
    await expect(column(page).getByRole('button', { name: 'Chat' })).toBeVisible();
    await add(page, 'Large', 1000); await expect(seam(page)).toHaveAttribute('data-bravais-home-shortcuts', 'menu');
    await page.evaluate(() => (window as unknown as OverflowWindow).overflow.remove('Large'));
    await expect(column(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    const after = await mountCounts(page);
    expect(after[0] - after[1]).toBe(2);
    expect(after[0] - initialMounts[0]).toBe(after[1] - initialMounts[1]);
    await page.evaluate(() => { const s = (window as unknown as OverflowWindow).overflow; s.remove('Notes'); s.remove('Chat'); });
    await expect(page.locator('[data-folium-slot="home.navigation"]')).toHaveCount(0);
    await expect(seam(page).locator('.bravais-home-mod-shortcuts')).toHaveCount(0);
    await expect(seam(page)).toHaveAttribute('data-bravais-home-fit', before!);
    expect(await column(page).locator('[data-bravais-shortcut]').allTextContents()).toEqual(nativeBefore);
    const final = await mountCounts(page); expect(final[0]).toBe(final[1]);
});


test('actual sample 2.0.4: horizontal shortcut styling in the column and overflow menu', async ({ page, mount }) => {
    await ready(page, mount);
    await page.evaluate(async () => {
        const apiPath = '/src/mods/folium/api.ts'; const experimentalPath = '/src/mods/folium/experimental.ts';
        const samplePath = '/dev/folium/sample-home-pages/client.mjs';
        const [{ createFoliumClientApi }, { createFoliumExperimental }, { default: activate }] = await Promise.all([import(apiPath), import(experimentalPath), import(samplePath)]);
        const mod = { id: 'sample-home-pages', permissions: [], experimental: ['home.pages'] };
        activate(createFoliumClientApi(mod, { context: 'main', internals: null, experimental: createFoliumExperimental(mod) }));
    });
    await expect(column(page).locator('[data-bravais-shortcut]')).toHaveCount(2);
    await expect(column(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    expect(await nav(page).evaluate(element => getComputedStyle(element).writingMode)).toBe('horizontal-tb');
    await page.screenshot({ path: test.info().outputPath('sample-bravais-high.png') });
    await page.setViewportSize({ width: 1440, height: 600 });
    await expect(seam(page)).toHaveAttribute('data-bravais-home-shortcuts', 'menu');
    await more(page).click(); await expect(menu(page).getByRole('button', { name: 'Notes' })).toBeVisible();
    await page.waitForTimeout(250); // finish the native menu reveal before capturing its geometry
    await page.screenshot({ path: test.info().outputPath('sample-bravais-overflow.png') });
    await nav(page).click(); await expect(page.getByRole('textbox', { name: 'Note draft' })).toBeVisible();
});


test('Bravais extended overflow menu stays on screen and scrolls to native and mod actions', async ({ page, mount }) => {
    await ready(page, mount);
    await page.setViewportSize({ width: 1440, height: 430 });
    for (let index = 0; index < 9; index++) await add(page, `Page ${index}`.replace(' ', '-'));
    await more(page).click(); await expect(menu(page)).toBeVisible();
    await page.waitForTimeout(250);
    const box = (await menu(page).boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y + box.height).toBeLessThan(430);
    const first = menu(page).locator('[data-bravais-shortcut]').first();
    await first.scrollIntoViewIfNeeded(); await expect(first).toBeInViewport();
    await nav(page, 'Page-8').scrollIntoViewIfNeeded(); await expect(nav(page, 'Page-8')).toBeInViewport();
    await nav(page, 'Page-8').click(); await expect(page.locator('[data-folium-home-page]')).toBeVisible();
    await page.getByRole('button', { name: 'Close mod page' }).click();
    await more(page).click();
    const lastNative = menu(page).locator('[data-bravais-seam-action]').last();
    await lastNative.scrollIntoViewIfNeeded(); await expect(lastNative).toBeInViewport();
    const closingTops = await page.evaluate(async () => {
        document.querySelector<HTMLButtonElement>('[data-bravais-seam-action="more"]')!.click();
        const tops: number[] = [];
        for (let frame = 0; frame < 30; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const menu = document.querySelector('[data-bravais-seam-menu]');
            if (!menu) break;
            tops.push(menu.getBoundingClientRect().top);
        }
        return tops;
    });
    expect(closingTops.every(top => top >= 0)).toBe(true);
    await expect(menu(page)).toHaveCount(0);
});
