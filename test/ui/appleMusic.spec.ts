import { expect, test } from '@playwright/test';
import { installBaseState, mockNeteaseApi, openApp } from './helpers/appFixtures';

// test/ui/appleMusic.spec.ts

async function prepare(page: import('@playwright/test').Page) {
    await installBaseState(page, { neteaseMode: 'guest' });
    await mockNeteaseApi(page, 'guest');
    await page.addInitScript(() => {
        const matchMedia = window.matchMedia;
        Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => {
            const result = matchMedia(query);
            const minWidth = query.match(/min-width:\s*(\d+)px/);
            return { ...result, matches: minWidth ? innerWidth >= Number(minWidth[1]) : result.matches };
        } });
        const commands: Array<{ path: string; body?: Record<string, unknown> }> = [];
        let playing = true;
        let position = 12;
        Object.assign(window.electron!, {
            getSettings: async () => ({}),
            getCacheDirectory: async () => ({ path: "/tmp/folia-test", isDefault: true }),
            appleMusicAvailable: true,
            appleMusicRequest: async (action: string, input: Record<string, unknown> = {}) => {
                commands.push({ path: action, body: input });
                if (action === 'api') {
                    const path = String(input.path);
                    if (path.includes('storefront')) return { ok: true, data: { data: [{ id: 'us' }] } };
                    if (path.includes('/search?')) return { ok: true, data: { results: { songs: { data: [{ id: '42', type: 'songs', attributes: { name: 'Remote song', artistName: 'Artist', albumName: 'Album', durationInMillis: 120000 } }] } } } };
                    return { ok: true, data: { data: [] } };
                }
                if (action === 'snapshot') return { ok: true, data: { mediaId: '42', position, duration: 120, playing } };
                if (action === 'command') {
                    if (input.command === 'pause') playing = false;
                    if (input.command === 'play') playing = true;
                    if (input.command === 'seek') position = Number(input.value);
                }
                return { ok: true, data: true };
            },
        });
        Object.assign(window, { appleTestCommands: commands });
    });
    await openApp(page);
    await expect(page.getByRole('button', { name: 'A Switch to Apple Music', exact: true })).toBeVisible();
}

// Enter through the same account menu as the other online music providers.
async function openAppleMusicLogin(page: import('@playwright/test').Page) {
    await page.evaluate(async () => {
        const path = '/src/stores/useOnlineProviderAccountStore.ts';
        (await import(path)).useOnlineProviderAccountStore.getState().clearAccount('applemusic');
    });
    await page.getByRole('button', { name: 'Switch online music provider', exact: true }).click();
    await expect(page.getByRole('menuitemradio', { name: /NetEase/ })).toBeVisible();
    await page.getByRole('menuitemradio', { name: /Apple Music/ }).click();
    await expect(page.getByRole('dialog', { name: 'Apple Music', exact: true })).toHaveCount(0);
}

test('uses the remote clock, pause/resume and seek while the audio elements remain empty', async ({ page }) => {
    await prepare(page);
    await page.evaluate(async () => {
        const playPath = '/src/components/app/playback/playRemoteSong.ts';
        const settingsPath = '/src/stores/useLyricSettingsStore.ts';
        const { playRemoteSong } = await import(playPath);
        const { useLyricSettingsStore } = await import(settingsPath);
        useLyricSettingsStore.setState({ autoUseBestLyric: false });
        await playRemoteSong({ song: { id: '42', name: 'Remote song', artists: [{ id: '1', name: 'Artist' }], album: { id: '2', name: 'Album' }, durationMs: 120000,
            sourceRef: { kind: 'online', providerId: 'applemusic', mediaId: '42' } }, queue: [], audio: document.querySelector('audio'),
            isCurrent: () => true, setLyrics: () => {}, setLoading: () => {} });
    });
    const state = () => page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const motionPath = '/src/stores/motionSignals.ts';
        const { usePlaybackStore } = await import(path);
        const { currentTime } = await import(motionPath);
        return { playerState: usePlaybackStore.getState().playerState, time: currentTime.get() };
    });
    await expect.poll(async () => (await state()).time).toBeGreaterThanOrEqual(12);
    expect(await page.locator('audio').evaluateAll(elements => elements.every(audio => !audio.getAttribute('src')))).toBe(true);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state()).playerState).toBe('PAUSED');
    await page.keyboard.press('Space');
    await expect.poll(async () => (await state()).playerState).toBe('PLAYING');
    await page.getByRole('button', { name: 'Back to Player', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => (window as any).appleTestCommands.some((r: any) => r.path === 'command' && r.body?.command === 'seek'))).toBe(true);
    await page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const { setCurrentSong } = await import(path);
        setCurrentSong(null);
    });
    await expect.poll(() => page.evaluate(async () => {
        const path = '/src/services/remotePlayback.ts';
        return (await import(path)).isRemotePlaybackActive();
    })).toBe(false);
});


test('searches the selected Apple Music provider and starts its result from the UI', async ({ page }) => {
    await prepare(page);
    await page.evaluate(async () => {
        const accountPath = '/src/stores/useOnlineProviderAccountStore.ts';
        const settingsPath = '/src/stores/useLyricSettingsStore.ts';
        (await import(accountPath)).useOnlineProviderAccountStore.getState().setActiveProviderId('applemusic');
        (await import(settingsPath)).useLyricSettingsStore.setState({ autoUseBestLyric: false });
    });
    const search = page.getByPlaceholder('SEARCH DATABASE...');
    await search.fill('Remote song');
    await search.press('Enter');
    await page.getByText('Remote song', { exact: true }).first().click();
    await expect.poll(() => page.evaluate(() => (window as any).appleTestCommands.some((r: any) => r.path === 'start' && r.body?.id === '42'))).toBe(true);
    await expect.poll(() => page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const s = (await import(path)).usePlaybackStore.getState();
        return { id: s.currentSong?.sourceRef?.mediaId, audioSrc: s.audioSrc, playerState: s.playerState };
    })).toEqual({ id: '42', audioSrc: null, playerState: 'PLAYING' });
});

test('opens Apple authorization directly from the account menu without a Folia confirmation dialog', async ({ page }) => {
    await prepare(page);
    await page.evaluate(() => {
        let attempts = 0;
        window.electron!.appleMusicRequest = async (action, input) => {
            if (action === 'connect') {
                if (input?.developerToken) throw new Error('User must not supply the application token');
                return ++attempts === 1 ? { ok: false, error: 'developer-token-rejected' } : { ok: true, data: true };
            }
            if (action === 'api') return { ok: true, data: { data: String(input?.path).includes('storefront') ? [{ id: 'us' }] : [] } };
            return { ok: true, data: true };
        };
    });
    await openAppleMusicLogin(page);
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);

    await expect(page.getByText('Apple rejected this Folia release’s application credentials. Please contact the maintainer; signing in again will not fix this.', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/apple-music-standalone.png' });
    await openAppleMusicLogin(page);
    // Like the other providers, activation confirms replacing the current online queue.
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect.poll(() => page.evaluate(async () => {
        const path = '/src/stores/useOnlineProviderAccountStore.ts';
        return (await import(path)).useOnlineProviderAccountStore.getState().activeProviderId;
    })).toBe('applemusic');
    await expect(page.getByRole('dialog', { name: 'Apple Music', exact: true })).toBeHidden();
});

test('integration settings do not duplicate the Apple Music account form', async ({ page }) => {
    await prepare(page);
    await page.evaluate(async () => {
        const path = '/src/stores/useSettingsModalStore.ts';
        (await import(path)).useSettingsModalStore.getState().openSettings('options', 'integration');
    });
    await expect(page.getByText('Discord Rich Presence', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Apple Music', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Playback mode')).toHaveCount(0);
});
