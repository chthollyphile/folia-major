import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/videoLayer.spec.ts
// The built-in video layer behind the lyrics and Sora's blank mode, in the real app: the layer mounts
// on the player page from its stored settings, Sora blank drops the WebGL canvas, and the settings
// section writes the layer's localStorage keys. Not screenshots: the video itself never loads here.

const VIDEO_URL = 'https://video.test/loop.mp4';

const QUEUE_FIXTURE = [
    { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Album' }, durationMs: 180_000 },
];

const seedAndOpen = async (page: Page, storage: Record<string, string>) => {
    await page.addInitScript(([version, guideKey, entries]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'en');
        localStorage.setItem(guideKey, version);
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, storage] as const);
    await page.route('**/__mock_netease__/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.route('https://video.test/**', route => route.abort());
    await page.goto('/');
};

test('mounts the video layer on the player page and Sora blank skips the WebGL canvas', async ({ page }) => {
    await seedAndOpen(page, {
        open_player_on_launch: 'true',
        visualizer_mode: 'classic',
        static_mode: 'false',
        visualizer_background_mode: 'sora',
        sora_background_tuning: JSON.stringify({ blank: true }),
        video_layer_enabled: 'true',
        video_layer_url: VIDEO_URL,
        video_layer_opacity: '0.5',
        video_layer_fit: 'contain',
    });
    await expect.poll(async () => page.evaluate(async (songs) => {
        try {
            const dbModulePath = '/src/services/db.ts';
            const { saveToCache } = await import(dbModulePath) as { saveToCache: (key: string, value: unknown) => Promise<unknown> };
            await saveToCache('last_song', songs[0]);
            await saveToCache('last_queue', songs);
            return true;
        } catch {
            return false;
        }
    }, QUEUE_FIXTURE)).toBe(true);
    await page.reload();

    const surface = page.getByTestId('player-visual-surface');
    await expect(surface).toBeAttached();

    const video = surface.locator('video');
    await expect(video).toHaveAttribute('src', VIDEO_URL);
    await expect(video).toHaveJSProperty('muted', true);
    expect(await video.evaluate(element => ({
        opacity: element.style.opacity,
        objectFit: element.style.objectFit,
    }))).toEqual({ opacity: '0.5', objectFit: 'contain' });

    const canvases = surface.locator('canvas');
    const blankCount = await canvases.count();
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useVisualizerSettingsStore.ts';
        const { useVisualizerSettingsStore } = await import(storeModulePath);
        useVisualizerSettingsStore.getState().handleSetSoraBackgroundTuning({ blank: false });
    });
    await expect(canvases).toHaveCount(blankCount + 1);

    // Turning the layer off unmounts the element.
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useVideoLayerSettingsStore.ts';
        const { useVideoLayerSettingsStore } = await import(storeModulePath);
        useVideoLayerSettingsStore.getState().setVideoLayerEnabled(false);
    });
    await expect(video).toHaveCount(0);
});

test('edits the video layer from the appearance settings', async ({ page }) => {
    await seedAndOpen(page, { static_mode: 'true' });
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(storeModulePath);
        useSettingsModalStore.getState().openSettings('options', 'appearance', null, 'videoLayerSettings');
    });

    const section = page.locator('[data-settings-anchor="videoLayerSettings"]');
    const toggle = section.getByRole('button', { name: 'Show video behind lyrics' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const urlInput = section.getByPlaceholder('https://example.com/loop.mp4');
    await urlInput.fill(`  ${VIDEO_URL}  `);
    await urlInput.press('Enter');

    await section.getByRole('slider', { name: 'Opacity' }).fill('0.8');
    await section.getByRole('button', { name: 'Contain' }).click();

    await expect.poll(() => page.evaluate(() => ({
        enabled: localStorage.getItem('video_layer_enabled'),
        url: localStorage.getItem('video_layer_url'),
        opacity: localStorage.getItem('video_layer_opacity'),
        fit: localStorage.getItem('video_layer_fit'),
    }))).toEqual({ enabled: 'true', url: VIDEO_URL, opacity: '0.8', fit: 'contain' });
});
