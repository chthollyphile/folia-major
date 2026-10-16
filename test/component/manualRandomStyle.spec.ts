import { test, expect } from './fixtures';

// test/component/manualRandomStyle.spec.ts
// Compare whole appearances so song changes cannot silently replace any part of a manual result.
for (const scope of ['lyrics', 'all'] as const) {
    test(`manual ${scope} randomization remains fixed through song changes and pauses`, async ({ mount, page }) => {
        const component = await mount('manualRandomStyle');
        const read = (key: string) => component.locator(`[data-manual-random="${key}"]`);
        if (scope === 'all') await component.getByRole('switch', { name: 'Randomize all' }).click();
        await component.getByRole('button', { name: 'Enable legacy song randomization', exact: true }).click();
        await expect(read('legacy')).toHaveText('true');
        const protectedBefore = await read('protected').textContent();
        const assetsBefore = await read('assets').textContent();
        const modeBefore = await read('mode').textContent();
        await component.getByRole('button', { name: 'Random style', exact: true }).click();
        await expect(read('mode')).not.toHaveText(modeBefore!);
        await expect(read('legacy')).toHaveText('false');
        await expect(read('savedLegacy')).toHaveText('false');
        const randomized = await read('appearance').textContent();
        if (scope === 'lyrics') await expect(read('protected')).toHaveText(protectedBefore!);
        await expect(read('assets')).toHaveText(assetsBefore!);
        await component.getByRole('button', { name: 'Next song', exact: true }).click();
        await expect(read('song')).toHaveText('b');
        await component.getByRole('button', { name: 'Pause playback', exact: true }).click();
        await expect(read('playerState')).toHaveText('PAUSED');
        await expect(read('appearance')).toHaveText(randomized!);
        // Verify the real legacy effect has completed after the song update.
        await page.waitForTimeout(150);
        await expect(read('appearance')).toHaveText(randomized!);
    });
}

test('scope alone preserves the appearance, and another click generates a new result', async ({ mount }) => {
    const component = await mount('manualRandomStyle');
    const appearance = component.locator('[data-manual-random="appearance"]');
    const before = await appearance.textContent();
    const scope = component.getByRole('switch', { name: 'Randomize all' });
    await scope.click();
    await expect(scope).toHaveAttribute('aria-checked', 'true');
    await expect(appearance).toHaveText(before!);
    const randomize = component.getByRole('button', { name: 'Random style', exact: true });
    await randomize.click();
    const first = await appearance.textContent();
    await randomize.click();
    await expect(appearance).not.toHaveText(first!);
});

test('editing one parameter preserves the other random values', async ({ mount }) => {
    const component = await mount('manualRandomStyle');
    await component.getByRole('button', { name: 'Random style', exact: true }).click();
    const appearance = component.locator('[data-manual-random="appearance"]');
    const expected = JSON.parse((await appearance.textContent())!);
    expected.visual.classicTuning.wordSpacing = 0.91;
    await component.getByRole('spinbutton', { name: 'Classic word spacing' }).fill('0.91');
    await expect(appearance).toHaveText(JSON.stringify(expected));
    await component.getByRole('button', { name: 'Next song', exact: true }).click();
    await expect(appearance).toHaveText(JSON.stringify(expected));
});

test('restart hydrates the manual result and scope from persisted storage', async ({ mount, page }) => {
    const component = await mount('manualRandomStyle');
    await component.getByRole('switch', { name: 'Randomize all' }).click();
    await component.getByRole('button', { name: 'Random style', exact: true }).click();
    const result = await component.locator('[data-manual-random="appearance"]').textContent();
    const stored = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    // Restore after the standard fixture's storage seed and before module-import hydration.
    await page.addInitScript(values => {
        localStorage.clear();
        for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    }, stored);
    await page.reload();
    const restarted = await mount('manualRandomStyle');
    await expect(restarted.locator('[data-manual-random="appearance"]')).toHaveText(result!);
    await expect(restarted.getByRole('switch', { name: 'Randomize all' })).toHaveAttribute('aria-checked', 'true');
});

test('the real lyric playground shares the same randomization scope and action', async ({ mount }) => {
    const component = await mount('manualRandomStyle');
    await component.getByRole('button', { name: 'Open preview', exact: true }).click();
    const scope = component.getByRole('switch', { name: 'Randomize all' }).last();
    await scope.click();
    await expect(component.getByRole('switch', { name: 'Randomize all' }).first()).toHaveAttribute('aria-checked', 'true');
    const before = await component.locator('[data-manual-random="mode"]').textContent();
    await component.getByRole('button', { name: 'Random style', exact: true }).last().click();
    await expect(component.locator('[data-manual-random="mode"]')).not.toHaveText(before!);
    await expect(component.locator('[data-manual-random="legacy"]')).toHaveText('false');
});
