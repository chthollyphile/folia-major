import { expect, test } from '@playwright/test';
import {
    DIORAMA_PARTICLE_DENSITY_MAX,
    DIORAMA_PARTICLE_DENSITY_MIN,
} from '../../src/types';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/dioramaSettings.spec.ts
// Verifies Diorama's point-cloud controls - including the mutually-exclusive clouds/corridor mode
// switch - in the real settings panel without relying on screenshots.
test('switches between clouds and corridor mode and keeps particle controls interactive', async ({ page }) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem('visualizer_mode', 'diorama');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options', 'visualizer', 'visualizer');
    });

    // 不能用 getByText：fieldset 的 sr-only <legend> 也叫这个名字，会撞上 strict mode。
    // 这里要断言的本来就是那个可见的控件本身。
    const particleLabel = page.getByRole('button', { name: 'Background Particles' });
    const expander = page.getByRole('button', { name: /Particle Geometry/ });
    const parentSwitch = page.getByRole('switch', { name: 'Particle Geometry' });
    await expect(particleLabel).toBeVisible();
    await expect(expander).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('switch', { name: 'Particle Cubes' })).toHaveCount(0);

    // The point-cloud geometry group sits AFTER the effect expanders and BEFORE background particles.
    for (const label of ['Sung Glow', 'Soul Drift', 'Progress Gradient']) {
        const effectExpander = page.getByRole('button', { name: new RegExp(label) });
        await expect(effectExpander).toHaveAttribute('aria-expanded', 'false');
        await effectExpander.click();
        await expect(effectExpander).toHaveAttribute('aria-expanded', 'true');
        await effectExpander.click();
        await expect(effectExpander).toHaveAttribute('aria-expanded', 'false');
    }

    const geometryElement = await expander.elementHandle();
    expect(geometryElement).not.toBeNull();
    const backgroundFollowsGeometry = await particleLabel.evaluate((element, geometry) => (
        Boolean(geometry && (geometry.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))
    ), geometryElement);
    expect(backgroundFollowsGeometry).toBe(true);

    // Parent switch hides/shows the whole layer without discarding preferences.
    await parentSwitch.click();
    await expect(parentSwitch).toHaveAttribute('aria-checked', 'false');
    await parentSwitch.click();
    await expect(parentSwitch).toHaveAttribute('aria-checked', 'true');

    await expander.click();
    await expect(expander).toHaveAttribute('aria-expanded', 'true');

    // Clouds mode (default): family switches and the shared appearance sliders are all present.
    const cloudsMode = page.getByRole('button', { name: 'Point Clouds' });
    const corridorMode = page.getByRole('button', { name: 'Corridor' });
    await expect(cloudsMode).toHaveAttribute('aria-pressed', 'true');
    await expect(corridorMode).toHaveAttribute('aria-pressed', 'false');

    const strandSwitch = page.getByRole('switch', { name: 'Particle Cubes' });
    await expect(strandSwitch).toBeVisible();
    await strandSwitch.click();
    await expect(strandSwitch).toHaveAttribute('aria-checked', 'false');

    const densitySlider = page.getByRole('slider', { name: 'Point Cloud Density' });
    await expect(densitySlider).toHaveAttribute('min', String(DIORAMA_PARTICLE_DENSITY_MIN));
    await expect(densitySlider).toHaveAttribute('max', String(DIORAMA_PARTICLE_DENSITY_MAX));
    await densitySlider.fill('960');
    await expect(densitySlider).toHaveValue('960');

    const cloudVolumeSlider = page.getByRole('slider', { name: 'Cloud Volume' });
    await cloudVolumeSlider.fill('1.5');
    await expect(cloudVolumeSlider).toHaveValue('1.5');

    const auraSwitch = page.getByRole('switch', { name: 'Cloud Aura' });
    await expect(auraSwitch).toHaveAttribute('aria-checked', 'true');
    const auraStrengthSlider = page.getByRole('slider', { name: 'Aura Strength' });
    await auraStrengthSlider.fill('0.9');
    await expect(auraStrengthSlider).toHaveValue('0.9');

    // Corridor mode replaces the clouds: family switches vanish, shared appearance stays.
    await corridorMode.click();
    await expect(corridorMode).toHaveAttribute('aria-pressed', 'true');
    await expect(cloudsMode).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('switch', { name: 'Particle Cubes' })).toHaveCount(0);
    await expect(page.getByRole('slider', { name: 'Point Cloud Density' })).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Cloud Aura' })).toBeVisible();

    // 关键字着色 is a plain on/off with no strength tier, so it has no expander of its own - the colours
    // are the theme's keyword list, not a slider. Defaults on, and persists through the store.
    const keywordSwitch = page.getByRole('switch', { name: 'Keyword Coloring' });
    await expect(keywordSwitch).toBeVisible();
    await expect(keywordSwitch).toHaveAttribute('aria-checked', 'true');
    await keywordSwitch.click();
    await expect(keywordSwitch).toHaveAttribute('aria-checked', 'false');
    const storedAfterOff = await page.evaluate(() => JSON.parse(localStorage.getItem('diorama_tuning') ?? '{}'));
    expect(storedAfterOff.keywordColoringEnabled).toBe(false);
    await keywordSwitch.click();
    await expect(keywordSwitch).toHaveAttribute('aria-checked', 'true');
});
