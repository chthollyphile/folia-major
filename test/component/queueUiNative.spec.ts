import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/queueUiNative.spec.ts
// Contributions only append: native markup, syntax, icons and actions survive enable/update/unload.

const panel = (page: Page) => page.locator('[data-probe-panel]');
const command = (page: Page) => page.locator('[data-probe-command]');
const rows = (surface: Locator) => surface.locator('[role="listitem"]');
const logs = (page: Page) => page.locator('[data-probe-call-log]').getAttribute('data-probe-call-log');
const markup = (surface: Locator) => surface.evaluate(element => element.innerHTML);

test.describe('append-only queue UI', () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    for (const daylight of [false, true]) {
        test(`native markup is restored after empty updates and unload (${daylight ? 'daylight' : 'dark'})`, async ({ mount, page }) => {
            await mount('queueUiNative');
            if (daylight) await page.locator('[data-probe-daylight]').click();
            await expect(panel(page).getByText('Queue Track 0', { exact: true })).toBeVisible();
            await expect(panel(page).locator('svg.lucide-shuffle')).toHaveCount(1);
            await expect(panel(page).locator('svg.lucide-shuffle')).toHaveAttribute('width', '14');
            await expect(command(page).getByTestId('command-palette-queue-syntax-hint')).toHaveText('Use @ for artist/album filters · use -- for batch actions');
            await expect(command(page).getByRole('checkbox')).toHaveCSS('accent-color', 'rgb(182, 125, 227)');
            await expect(rows(panel(page)).first()).toHaveCSS('height', '50px');
            await expect(rows(command(page)).first()).toHaveCSS('height', '60px');
            await expect(panel(page).locator(':scope > div').first()).toHaveCSS('opacity', '1');
            const nativePanel = await markup(panel(page));
            const nativeCommand = await markup(command(page));

            await page.locator('[data-probe-enable]').click();
            await expect(panel(page).getByRole('button', { name: 'Fixture sync', exact: true })).toBeVisible();
            await page.locator('[data-probe-outputs]').click();
            await expect(panel(page).getByRole('button', { name: 'Fixture sync', exact: true })).toHaveCount(0);
            await expect.poll(() => markup(panel(page))).toBe(nativePanel);
            await expect.poll(() => markup(command(page))).toBe(nativeCommand);

            await page.locator('[data-probe-outputs]').click();
            await expect(panel(page).getByRole('button', { name: 'Fixture sync', exact: true })).toBeVisible();
            await page.locator('[data-probe-enable]').click();
            await expect.poll(() => markup(panel(page))).toBe(nativePanel);
            await expect.poll(() => markup(command(page))).toBe(nativeCommand);
        });
    }

    test('native actions remain before appended actions and extension clicks do not play', async ({ mount, page }) => {
        await mount('queueUiNative');
        await page.locator('[data-probe-enable]').click();
        const firstPanel = rows(panel(page)).first();
        const firstCommand = rows(command(page)).first();
        await firstPanel.hover();
        await expect(firstPanel.getByRole('button')).toHaveCount(4);
        expect(await firstPanel.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual([
            'Play next', 'Move to end', 'Remove from queue', 'Fixture react 0',
        ]);
        await firstPanel.getByRole('button', { name: 'Fixture react 0', exact: true }).click();
        await expect.poll(() => logs(page)).toBe('["extension:panel:0"]');
        await firstPanel.getByRole('button', { name: 'Play next', exact: true }).click();
        await expect.poll(() => logs(page)).toBe('["extension:panel:0","native:panel:next:0"]');

        await firstCommand.hover();
        await firstCommand.getByRole('button', { name: 'Fixture react 0', exact: true }).focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => logs(page)).toBe('["extension:panel:0","native:panel:next:0","extension:command:0"]');
        await firstCommand.getByRole('button', { name: 'Remove from queue', exact: true }).click();
        await expect.poll(() => logs(page)).toContain('native:command:remove:0');
        expect(await logs(page)).not.toContain('native:command:play');
    });

    test('overlines fit virtual rows, while filtered rows use their original queue index', async ({ mount, page }) => {
        await mount('queueUiNative');
        await page.locator('[data-probe-enable]').click();
        await expect(rows(panel(page)).nth(0)).toHaveCSS('height', '64px');
        await expect(rows(panel(page)).nth(1)).toHaveCSS('height', '64px');
        await expect(rows(command(page)).first()).toHaveCSS('height', '76px');
        for (const surface of [panel(page), command(page)]) {
            const row = rows(surface).first();
            const overline = row.getByText(/^Recommended by fixture user 0/);
            await expect(overline).toBeVisible();
            const outer = (await row.boundingBox())!;
            const inner = (await overline.boundingBox())!;
            const contained = inner.y >= outer.y && inner.y + inner.height <= outer.y + outer.height
                && inner.x + inner.width <= outer.x + outer.width;
            expect(contained).toBe(true);
        }
        await page.locator('[data-probe-filter]').click();
        const firstFiltered = rows(command(page)).first();
        await firstFiltered.hover();
        await firstFiltered.getByRole('button', { name: 'Fixture react 1', exact: true }).click();
        await expect.poll(() => logs(page)).toBe('["extension:command:1"]');
    });

    test('empty native queue stays unchanged and a contribution can still append a header action', async ({ mount, page }) => {
        await mount('queueUiNative');
        await page.locator('[data-probe-empty]').click();
        await expect(panel(page).getByRole('button')).toHaveCount(0);
        await expect(panel(page).locator(':scope > div').first()).toHaveCSS('opacity', '1');
        const nativeEmpty = await markup(panel(page));
        await page.locator('[data-probe-enable]').click();
        await panel(page).getByRole('button', { name: 'Fixture sync', exact: true }).click();
        await expect.poll(() => logs(page)).toBe('["extension:sync"]');
        await expect(panel(page).getByRole('button')).toHaveCount(1);
        await page.locator('[data-probe-enable]').click();
        await expect.poll(() => markup(panel(page))).toBe(nativeEmpty);
    });

    test('10k entries only call the provider for mounted rows on each notification', async ({ mount, page }) => {
        await mount('queueUiNative');
        await page.locator('[data-probe-large]').click();
        await page.locator('[data-probe-action-only]').click();
        await page.locator('[data-probe-enable]').click();
        await expect(rows(command(page)).first()).toHaveAttribute('aria-setsize', '10000');
        await expect(rows(panel(page)).first()).toHaveCSS('height', '50px');
        await expect(rows(command(page)).first()).toHaveCSS('height', '60px');
        await expect(command(page).getByRole('button', { name: 'Fixture react 0', exact: true })).toBeAttached();
        const readCount = () => page.locator('[data-probe-read-count]').getAttribute('data-probe-read-count').then(Number);
        for (let update = 0; update < 3; update += 1) {
            await page.locator('[data-probe-notify]').click();
            await expect.poll(readCount).toBeGreaterThan(0);
            // React StrictMode may read twice, but the count remains bounded by visible rows + overscan.
            expect(await readCount()).toBeLessThan(80);
        }
        await page.locator('[data-probe-action-only]').click();
        await expect(rows(panel(page)).first()).toHaveCSS('height', '64px');
        await expect(rows(command(page)).first()).toHaveCSS('height', '76px');
        await page.locator('[data-probe-notify]').click();
        await expect.poll(readCount).toBeGreaterThan(0);
        expect(await readCount()).toBeLessThan(80);
    });

    test('the shipped example responds to panel clicks with the host display queue projection', async ({ mount, page }) => {
        await mount('queueUiNative');
        await page.locator('[data-probe-sample]').click();
        const first = rows(panel(page)).first();
        const vote = first.getByRole('button', { name: 'Sample vote', exact: true });
        await first.hover();
        await vote.click();
        await expect(vote).toHaveAttribute('aria-description', '1');
        await vote.click();
        await expect(vote).toHaveAttribute('aria-description', '2');
        await expect.poll(() => logs(page)).toContain('queue.ui vote: surface=panel, index=0, song=Queue Track 0, count=2');
        const commandRow = rows(command(page)).first();
        await commandRow.hover();
        const commandVote = commandRow.getByRole('button', { name: 'Sample vote', exact: true });
        await expect(commandVote).toHaveAttribute('aria-description', '2');
        await commandVote.click();
        await expect(vote).toHaveAttribute('aria-description', '3');
        const duplicate = rows(panel(page)).nth(1);
        await duplicate.hover();
        const duplicateVote = duplicate.getByRole('button', { name: 'Sample vote', exact: true });
        await expect(duplicateVote).toHaveAttribute('aria-description', '0');
        await duplicateVote.click();
        await expect(duplicateVote).toHaveAttribute('aria-description', '1');
        await expect(vote).toHaveAttribute('aria-description', '3');
        expect(await logs(page)).not.toContain('native:');
    });
    test('interactive mod overlines isolate input, styles and cleanup from native song buttons', async ({ mount, page }) => {
        await mount('queueUiNative');
        const nativeButton = rows(command(page)).first().locator('button').first();
        const color = await nativeButton.evaluate(el => getComputedStyle(el).backgroundColor);
        await page.locator('[data-probe-custom]').click();
        await page.locator('[data-probe-enable]').click();
        for (const area of [panel(page), command(page)]) {
            const input = area.getByRole('textbox', { name: 'Mod note 0', exact: true });
            await input.fill('hello');
            await input.press('Enter');
            await input.press('Space');
            await expect(input).toBeFocused();
            await expect(input).toHaveValue('hello ');
        }
        expect(await logs(page)).not.toContain('native:');
        expect(await nativeButton.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(color);
        expect(Number(await page.locator('[data-mounted-fields]').getAttribute('data-mounted-fields'))).toBeGreaterThan(0);
        await page.locator('[data-probe-enable]').click();
        await expect(page.locator('[data-mounted-fields]')).toHaveAttribute('data-mounted-fields', '0');
        await expect(page.getByRole('textbox', { name: 'Mod note 0', exact: true })).toHaveCount(0);
    });

});
