import { expect, test } from '@playwright/test';

// test/ui/sonnetSettings.spec.ts
// Verifies Sonnet's first-entry warning and the visibility tuning controls in the real settings UI.
test('warns before entering Sonnet and exposes its layer controls', async ({ page }) => {
    await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem('folia_last_seen_guide_version', '0.5.27');
    });
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsUiStore.ts';
        const { useSettingsUiStore } = await import(storeModulePath);
        useSettingsUiStore.getState().openSettings('options', 'visualizer', 'visualizer');
    });

    const sonnetMode = page.getByRole('button', { name: 'Sonnet', exact: true });
    await expect(sonnetMode).toBeVisible();
    await sonnetMode.click();

    await expect(page.getByText('Sonnet performance warning', { exact: true })).toBeVisible();
    const warningCheckbox = page.getByRole('checkbox', { name: 'Do not show this warning again' });
    await warningCheckbox.check();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText('Sonnet performance warning', { exact: true })).toHaveCount(0);

    await expect(page.getByText('Text only', { exact: true })).toBeVisible();
    await expect(page.getByText('Guide lines', { exact: true })).toBeVisible();
    await expect(page.getByText('Main scene', { exact: true })).toBeVisible();
    await expect(page.getByText('Text markers', { exact: true })).toBeVisible();
    await expect(page.getByText('Giant decorative outline text', { exact: true })).toBeVisible();
    await expect(page.getByText('Background decorations', { exact: true })).toBeVisible();

    const storeState = await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsUiStore.ts';
        const { useSettingsUiStore } = await import(storeModulePath);
        return {
            visualizerMode: useSettingsUiStore.getState().visualizerMode,
            warningDismissed: localStorage.getItem('sonnet_performance_warning_dismissed'),
        };
    });
    expect(storeState).toEqual({ visualizerMode: 'sonnet', warningDismissed: 'true' });
});
