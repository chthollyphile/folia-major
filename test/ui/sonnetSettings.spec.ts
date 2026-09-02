import { expect, test } from '@playwright/test';
import { APP_VERSION } from '../helpers/appState';

// test/ui/sonnetSettings.spec.ts
// Verifies entering Sonnet from the real settings UI and the visibility tuning controls it exposes.

// 新功能弹窗只在 lastSeenGuideVersion 不等于当前版本时弹出，会挡住所有点击。
// 直接读 package.json 对齐版本号，避免每次发版都要回来改这里。
test('enters Sonnet from settings and exposes its layer controls', async ({ page }) => {
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

    const sonnetMode = page.getByRole('button', { name: 'Sonnet', exact: true });
    await expect(sonnetMode).toBeVisible();
    await sonnetMode.click();

    await expect(page.getByText('Text only', { exact: true })).toBeVisible();
    await expect(page.getByText('Guide lines', { exact: true })).toBeVisible();
    await expect(page.getByText('Main scene', { exact: true })).toBeVisible();
    await expect(page.getByText('Text markers', { exact: true })).toBeVisible();
    await expect(page.getByText('Giant decorative outline text', { exact: true })).toBeVisible();
    await expect(page.getByText('Background decorations', { exact: true })).toBeVisible();

    const visualizerMode = await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useVisualizerSettingsStore.ts';
        const { useVisualizerSettingsStore } = await import(storeModulePath);
        return useVisualizerSettingsStore.getState().visualizerMode;
    });
    expect(visualizerMode).toBe('sonnet');
});
