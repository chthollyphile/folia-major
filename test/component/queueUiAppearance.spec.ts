import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/queueUiAppearance.spec.ts
// Compare contributed controls to actual neighboring native controls in all interaction states.
const appearance = async (button: Locator) => {
    await expect(button.locator('svg')).toBeAttached();
    return button.evaluate(element => {
        const style = getComputedStyle(element);
        const icon = getComputedStyle(element.querySelector('svg')!);
        return Object.fromEntries([
            ...['width', 'height', 'padding', 'borderRadius', 'borderWidth', 'borderColor',
                'backgroundColor', 'color', 'opacity', 'outlineStyle', 'outlineWidth', 'outlineOffset']
                .map(key => [key, style[key as keyof CSSStyleDeclaration]]),
            ['iconWidth', icon.width], ['iconHeight', icon.height],
        ]);
    });
};

async function matchingControls(page: Page, native: Locator, added: Locator) {
    for (const state of ['idle', 'hover', 'focus'] as const) {
        const read = async (button: Locator) => {
            await page.mouse.move(0, 0);
            await button.evaluate(element => (element as HTMLElement).blur());
            const row = native.locator('xpath=ancestor::*[@role="listitem" or @data-queue-index][1]');
            if (await row.count()) await row.hover();
            if (state === 'hover') await button.hover();
            if (state === 'focus') {
                await page.keyboard.press('Tab');
                await button.focus();
                expect(await button.evaluate(element => element.matches(':focus-visible'))).toBe(true);
            }
            // Native opacity/background transitions must finish before comparing colors.
            await button.evaluate(async element => {
                await Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {})));
            });
            const result = await appearance(button);
            await button.evaluate(element => (element as HTMLElement).blur());
            return result;
        };
        expect(await read(added), `${state} must match the native neighbor`).toEqual(await read(native));
    }
}

for (const daylight of [false, true]) {
    test(`panel and palette controls match their native neighbors (${daylight ? 'daylight' : 'dark'})`, async ({ mount, page }) => {
        await mount('queueUiNative');
        if (daylight) await page.locator('[data-probe-daylight]').click();
        const toolbar = page.getByTestId('command-palette-queue-syntax-hint').locator('..');
        const nativeHeight = (await toolbar.boundingBox())!.height;
        await page.locator('[data-probe-enable]').click();
        const panel = page.locator('[data-probe-panel]');
        const command = page.locator('[data-probe-command]');
        const sync = command.getByRole('button', { name: 'Fixture sync', exact: true });
        const hint = command.getByTestId('command-palette-queue-syntax-hint');
        const checkbox = command.getByRole('checkbox');
        expect((await toolbar.boundingBox())!.height).toBe(nativeHeight);
        const center = async (locator: Locator) => {
            const box = (await locator.boundingBox())!;
            return box.y + box.height / 2;
        };
        expect(Math.abs(await center(sync) - await center(hint))).toBeLessThan(1);
        expect(Math.abs(await center(sync) - await center(checkbox))).toBeLessThan(1);
        await matchingControls(page, panel.locator('button:has(svg.lucide-shuffle)'),
            panel.getByRole('button', { name: 'Fixture sync', exact: true }));
        for (const surface of [panel, command]) {
            const row = surface.locator('[role="listitem"]').first();
            const native = row.getByRole('button', { name: 'Play next', exact: true });
            const added = row.getByRole('button', { name: 'Fixture react 0', exact: true });
            await row.hover();
            await matchingControls(page, native, added);
            await added.click();
            await expect(added).not.toBeFocused();
        }
    });

    test(`wall header, row and playback controls inherit native styling (${daylight ? 'daylight' : 'dark'})`, async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('wall_tools_queue_island_open', 'true'));
        await mount('queueUiWall');
        if (daylight) await page.locator('[data-probe-daylight]').click();
        await page.locator('[data-probe-enable]').click();
        const chrome = page.locator('[data-probe-lattice]');
        await matchingControls(page, chrome.locator('[data-action="next"]'),
            chrome.getByRole('button', { name: 'Vote 2', exact: true }));
        await page.getByRole('button', { name: 'Wall tools', exact: true }).click();
        const island = page.getByRole('region', { name: 'Play queue', exact: true });
        await matchingControls(page, island.locator('[data-queue-island-action="clear"]'),
            island.getByRole('button', { name: 'Fixture sync', exact: true }));
        const row = island.locator('[data-queue-index="0"]');
        await row.hover();
        await matchingControls(page, row.locator('[data-queue-row-action]').first(),
            row.getByRole('button', { name: 'Vote 0', exact: true, includeHidden: true }));
    });

    test(`full Lattice poster preserves the shared count badge shape (${daylight ? 'daylight' : 'dark'})`, async ({ mount, page }) => {
        await page.addInitScript(() => localStorage.setItem('wall_tools_queue_island_open', 'true'));
        await mount('queueUiWall');
        if (daylight) await page.locator('[data-probe-daylight]').click();
        await page.locator('[data-probe-enable]').click();
        await page.locator('[data-probe-poster]').click();
        const poster = page.locator('.lattice-poster.is-expanded');
        await poster.hover();
        const vote = poster.getByRole('button', { name: 'Vote 2', exact: true });
        await vote.hover();
        const badgeStyle = (badge: Locator) => badge.evaluate(element => {
            const style = getComputedStyle(element);
            return { radius: style.borderRadius, background: style.backgroundColor, border: style.borderColor };
        });
        const count = vote.locator('[data-sample-count]');
        await expect(count).toBeVisible();
        const actual = await badgeStyle(count);
        expect(parseFloat(actual.radius)).toBeGreaterThan(0);
        // Only the contributed badge keeps its rounded shape; the native poster stays square.
        await expect(poster).toHaveCSS('border-radius', '0px');
        await page.getByRole('button', { name: 'Wall tools', exact: true }).click();
        const row = page.getByRole('region', { name: 'Play queue', exact: true }).locator('[data-queue-index="2"]');
        await row.hover();
        await row.getByRole('button', { name: 'Vote 2', exact: true }).hover();
        expect(actual).toEqual(await badgeStyle(row.locator('[data-sample-count]')));
    });
}

test('small-screen Lattice additions keep the same touch target and icon as native actions', async ({ mount, page }) => {
    await page.setViewportSize({ width: 640, height: 900 });
    await mount('queueUiWall');
    await page.locator('[data-probe-enable]').focus();
    await page.keyboard.press('Space');
    const chrome = page.locator('[data-probe-lattice]');
    const native = await appearance(chrome.locator('[data-action="next"]'));
    expect(native.width).toBe('86px');
    expect(await appearance(chrome.getByRole('button', { name: 'Vote 2', exact: true }))).toEqual(native);
});
