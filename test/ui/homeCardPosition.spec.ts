import { expect, test, type Page } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/homeCardPosition.spec.ts
// Exercises the actual home tabs, asynchronous library reloads and the player unmount boundary.

test.use({ serviceWorkers: 'block', screenshot: 'only-on-failure' });

const albums = [1, 2, 3].map(id => ({ id, name: `Album ${id}`, artists: [], size: 5 }));
const focusedTitle = (page: Page) => page.locator('[data-grid3d-slider] + div h3');

const bootHome = async (page: Page) => {
    await installBaseState(page, { neteaseMode: 'logged-in', preserveNativeMediaQueries: true });
    await page.addInitScript(() => {
        // The shared home fixture provides a minimal Electron bridge; opening settings needs these too.
        Object.assign(window.electron!, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: '', isDefault: true }),
        });
    });
    await mockNeteaseApi(page, 'logged-in');
    await page.route('**/__mock_netease__/user/cloud?*', route => route.fulfill({ json: { count: 0, songs: [] } }));
    await page.route('**/__mock_netease__/album/sublist?*', route => route.fulfill({
        json: { data: albums, hasMore: false },
    }));
    await openApp(page);
    await expect(focusedTitle(page)).toHaveText('Daily Mix');
};

const focusCard = async (page: Page, index: number, name: string) => {
    await page.locator(`[data-grid3d-index="${index}"]`).click();
    await expect(focusedTitle(page)).toHaveText(name);
};

const expectCenteredCard = async (page: Page, index: number, name: string) => {
    await expect(focusedTitle(page)).toHaveText(name);
    // Checking the label alone would miss a restored index with the scroll position still at zero.
    await expect.poll(() => page.locator(`[data-grid3d-index="${index}"]`).evaluate(node => {
        // Right after a reorder the card can be outside the slider for a frame. Report "not
        // centered yet" so the poll retries instead of throwing on the missing slider.
        const slider = node.closest('[data-grid3d-slider]');
        if (!slider) return Number.POSITIVE_INFINITY;
        const card = node.getBoundingClientRect();
        const viewport = slider.getBoundingClientRect();
        return Math.abs(card.x + card.width / 2 - viewport.x - viewport.width / 2);
    })).toBeLessThan(5);
};

// Drive the same view state the navigation controller owns; audio/network playback is unrelated here.
const setView = async (page: Page, view: 'home' | 'player') => {
    await page.evaluate(async next => {
        const path = '/src/stores/useAppViewStore.ts';
        const { useAppViewStore } = await import(path);
        useAppViewStore.getState().setView(next);
    }, view);
};

test('remembers separate cards across tabs and a player round trip with delayed albums', async ({ page }) => {
    await bootHome(page);
    await focusCard(page, 1, 'Late Night Drive');
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    await expect(focusedTitle(page)).toHaveText('Album 1');
    await focusCard(page, 2, 'Album 3');

    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    await expectCenteredCard(page, 1, 'Late Night Drive');
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    await expectCenteredCard(page, 2, 'Album 3');

    await setView(page, 'player');
    await expect(page.locator('[data-grid3d-slider]')).toHaveCount(0);
    let releaseAlbums!: () => void;
    const albumGate = new Promise<void>(resolve => { releaseAlbums = resolve; });
    await page.route('**/__mock_netease__/album/sublist?*', async route => {
        await albumGate;
        await route.fulfill({ json: { data: albums, hasMore: false } });
    });
    await setView(page, 'home');
    await expect(focusedTitle(page)).toHaveCount(0);
    releaseAlbums();
    await expectCenteredCard(page, 2, 'Album 3');
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    await expectCenteredCard(page, 1, 'Late Night Drive');
});

test('restores the card identity after reorder and bounds the fallback after deletion', async ({ page }) => {
    await bootHome(page);
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    await expect(focusedTitle(page)).toHaveText('Album 1');
    await focusCard(page, 2, 'Album 3');
    await page.route('**/__mock_netease__/album/sublist?*', route => route.fulfill({
        json: { data: [albums[2], albums[0], albums[1]], hasMore: false },
    }));
    await page.evaluate(() => window.dispatchEvent(new Event('folia-refresh-favorite-albums')));
    await expectCenteredCard(page, 0, 'Album 3');
    await page.route('**/__mock_netease__/album/sublist?*', route => route.fulfill({
        json: { data: [albums[0]], hasMore: false },
    }));
    await page.evaluate(() => window.dispatchEvent(new Event('folia-refresh-favorite-albums')));
    await expectCenteredCard(page, 0, 'Album 1');
});

test('the interface setting persists and disabling restores the original reset behavior', async ({ page }, testInfo) => {
    await bootHome(page);
    await focusCard(page, 1, 'Late Night Drive');
    await page.evaluate(async () => {
        const path = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(path);
        useSettingsModalStore.getState().openSettings('options', 'general');
    });
    const toggle = page.getByRole('switch', { name: 'Remember home card position', exact: true });
    await expect(toggle).toBeChecked();
    await toggle.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('home-card-position-setting.png') });
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('remember_home_card_position'))).toBe('false');
    await page.evaluate(async () => {
        const path = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(path);
        useSettingsModalStore.getState().closeSettings();
    });
    await page.getByRole('button', { name: 'Albums', exact: true }).click();
    await expect(focusedTitle(page)).toHaveText('Album 1');
    await page.getByRole('button', { name: 'Playlists', exact: true }).click();
    await expectCenteredCard(page, 0, 'Daily Mix');
    await focusCard(page, 1, 'Late Night Drive');
    await setView(page, 'player');
    await expect(page.locator('[data-grid3d-slider]')).toHaveCount(0);
    await setView(page, 'home');
    await expectCenteredCard(page, 0, 'Daily Mix');
});
