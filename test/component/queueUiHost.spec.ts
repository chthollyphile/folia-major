import { expect, test } from './fixtures';

// test/component/queueUiHost.spec.ts
// Exercise the actual global-keyboard host rather than only a queue view.
test('palette Enter and Space activate the contributed button without executing the native active command', async ({ mount, page }) => {
    await mount('queueUiHost');
    const panel = page.getByTestId('command-palette-panel');
    await panel.getByRole('button', { name: 'Fixture sync', exact: true }).focus();
    await page.keyboard.press('Enter');
    await panel.getByRole('button', { name: 'Fixture vote', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    await expect(page.locator('[data-host-calls]')).toHaveAttribute('data-host-calls', '["sync","vote","vote"]');
});
