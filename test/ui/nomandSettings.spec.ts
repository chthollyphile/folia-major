import { expect, test } from '@playwright/test';
import { APP_VERSION } from '../helpers/appState';

// test/ui/nomandSettings.spec.ts
// Verifies Nomand swaps its effect-specific tuning controls while keeping the shared settings shell.

test('switches Nomand Paper effects and exposes matching tuning controls', async ({ page }) => {
    await page.addInitScript((version) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem('folia_last_seen_guide_version', version);
    }, APP_VERSION);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options', 'visualizer', 'visualizer');
    });

    await page.getByRole('button', { name: 'Background Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Nomand', exact: true }).click();
    await expect(page.getByText('Effect', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fluted Glass', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Fluted Glass', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Rib Size' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Distortion' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Blur' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Grid Size' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Paper Texture', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Contrast' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Roughness' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Fiber' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Rib Size' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Halftone Dots', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Dot Size' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Dot Radius' })).toBeVisible();
    await expect(page.getByText('Keep Original Image Colors', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Lens Distortion', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Color Spread' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Lens Bulge' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Color Dispersion' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Dot Size' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Dithering', exact: true }).click();
    await expect(page.getByRole('button', { name: '2x2', exact: true })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Grid Size' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Color Steps' })).toBeVisible();
});
