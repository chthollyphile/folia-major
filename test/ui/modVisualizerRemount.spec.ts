import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/modVisualizerRemount.spec.ts
// A mod visualizer mounts once per song, not once per host re-render. For a song without lyrics the
// renderer model used to hand a fresh `[]` every render, so opening the side panel or toggling the
// player chrome rebuilt the Folium stage context and remounted the mod (visible as 52Hz restarting).
// The mod here only counts its mounts; it is registered through the real client API.

const SONG = { id: 1, name: 'Instrumental', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Album' }, durationMs: 180_000 };

test('does not remount a mod visualizer when the player UI changes on a lyric-less song', async ({ page }) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'en');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);
    // Every lyric request comes back empty: the song has no lyrics.
    await page.route('**/__mock_netease__/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));

    await page.goto('/');
    await waitForAppMounted(page);
    await expect.poll(async () => page.evaluate(async (song) => {
        try {
            const dbModulePath = '/src/services/db.ts';
            const { saveToCache } = await import(dbModulePath) as { saveToCache: (key: string, value: unknown) => Promise<unknown> };
            await saveToCache('last_song', song);
            await saveToCache('last_queue', [song]);
            return true;
        } catch {
            return false;
        }
    }, SONG)).toBe(true);
    await page.reload();
    await waitForAppMounted(page);
    await expect(page.getByTestId('player-visual-surface')).toBeAttached();

    await page.evaluate(async () => {
        const apiPath = '/src/mods/folium/api.ts';
        const storePath = '/src/stores/useVisualizerSettingsStore.ts';
        const { createFoliumClientApi } = await import(apiPath);
        const { useVisualizerSettingsStore } = await import(storePath);
        const probe = window as unknown as { __mounts: number };
        probe.__mounts = 0;
        const api = createFoliumClientApi(
            { id: 'remount-probe', name: 'probe', version: '1.0.0', author: null, description: null, permissions: [], status: 'active', error: null, enabled: true },
            { context: 'main', experimental: {}, onRelease: () => {}, stopped: () => false },
        );
        api.registries.visualizers.register({
            id: 'count',
            label: { en: 'Count' },
            mount: () => {
                probe.__mounts += 1;
                return () => {};
            },
        });
        useVisualizerSettingsStore.getState().handleSetVisualizerMode('mod:remount-probe:count');
    });

    const mounts = () => page.evaluate(() => (window as unknown as { __mounts: number }).__mounts);
    await expect.poll(mounts).toBeGreaterThan(0);
    // Let the first mount settle (StrictMode mounts twice in dev).
    await page.waitForTimeout(500);
    const settled = await mounts();

    await page.evaluate(async () => {
        const viewPath = '/src/stores/useAppViewStore.ts';
        const chromePath = '/src/stores/useAppChromeStore.ts';
        const { useAppViewStore } = await import(viewPath);
        const { useAppChromeStore } = await import(chromePath);
        const wait = () => new Promise(resolve => setTimeout(resolve, 150));
        useAppViewStore.getState().setIsPanelOpen(true);
        await wait();
        useAppViewStore.getState().setIsPanelOpen(false);
        await wait();
        useAppChromeStore.getState().setIsPlayerChromeHidden(true);
        await wait();
        useAppChromeStore.getState().setIsPlayerChromeHidden(false);
        await wait();
    });
    await page.waitForTimeout(300);

    expect(await mounts()).toBe(settled);
});
