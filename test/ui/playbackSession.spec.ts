import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/playbackSession.spec.ts
// Real App, audio decoding, Folium activation/disposal and the packaged sample's own controls.
const playbackSnapshot = (page: Page) => page.evaluate(async () => {
    const storePath = '/src/stores/usePlaybackStore.ts', sessionPath = '/src/services/externalPlaybackSession.ts';
    const { usePlaybackStore } = await import(storePath);
    const { hasExternalPlayback } = await import(sessionPath);
    const state = usePlaybackStore.getState();
    return { active: hasExternalPlayback(), song: state.currentSong?.name ?? null, source: state.audioSrc, state: state.playerState };
});

const intentCount = async (page: Page, type: string) =>
    (await page.getByLabel('执行日志').innerText()).split('\n').filter(line => line.includes(`意图 ${type}`)).length;

const trackModifier = (page: Page) => page.evaluate(async () => {
    const path = '/src/utils/platform.ts';
    const { isMacPlatform } = await import(path);
    return isMacPlatform ? 'Meta' : 'Control';
});

async function playSessionB(page: Page) {
    await page.getByRole('button', { name: '建立会话并播放 B', exact: true }).click();
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ active: true, song: '会话测试 B', state: 'PLAYING' });
}

async function clearSessionMedia(page: Page) {
    await page.getByRole('button', { name: '清空媒体，保持会话', exact: true }).click();
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ active: true, song: null, source: null, state: 'IDLE' });
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript(([version, key]) => {
        localStorage.clear();
        localStorage.setItem(key, version);
        localStorage.setItem('i18nextLng', 'zh-CN');
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem('auto_use_best_lyric', 'false');
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', route => route.fulfill({ contentType: 'application/json', body: '{}' }));
    await page.goto('/');
    await waitForAppMounted(page);
    await page.evaluate(async () => {
        const loaderPath = '/src/mods/folium/clientLoader.ts', storePath = '/src/stores/useAppViewStore.ts';
        const { reconcileFoliumClients } = await import(loaderPath);
        await reconcileFoliumClients([{
            id: 'session-api-demo', name: 'Session test', version: '1.0.1', status: 'loaded', enabled: true,
            permissions: ['playback.control'], experimental: ['playback.sessions', 'omni.providers'],
            clientUrl: '/dev/folium/sample-playback-session/client.mjs',
        }], 'main');
        const { useAppViewStore } = await import(storePath);
        useAppViewStore.getState().setView('player');
        useAppViewStore.getState().setPanelTab('folium:session-api-demo:session');
        useAppViewStore.getState().setIsPanelOpen(true);
    });
    await expect(page.getByRole('button', { name: '准备私人队列', exact: true })).toBeVisible();
});

for (const key of ['Enter', 'Space']) {
    test(`sample buttons keep one native ${key} activation instead of the host playback shortcut`, async ({ page }) => {
        await playSessionB(page);
        const next = page.getByRole('button', { name: '宿主下一首', exact: true });
        await next.evaluate(button => {
            button.dataset.clickCount = '0';
            button.addEventListener('click', () => { button.dataset.clickCount = String(Number(button.dataset.clickCount) + 1); });
        });
        await next.press(key);
        await expect(next).toHaveAttribute('data-click-count', '1');
        await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 A', state: 'PLAYING' });
        expect(await intentCount(page, 'next')).toBe(1);
    });
}

test('sample buttons keep Tab, Escape and modified host navigation available', async ({ page }) => {
    await playSessionB(page);
    const next = page.getByRole('button', { name: '宿主下一首', exact: true });
    await next.focus();
    await page.keyboard.press('Tab');
    // The host owns Tab for cycling panel tabs; the sample must let that shortcut through.
    await expect(page.getByRole('button', { name: '封面', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(next).toBeHidden();
    await page.keyboard.press('Shift+Tab');
    await expect(next).toBeVisible();
    await next.focus();
    await page.keyboard.press(`${await trackModifier(page)}+ArrowRight`);
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 A', state: 'PLAYING' });
    expect(await intentCount(page, 'next')).toBe(1);
    await next.press('Escape');
    await expect(next).toBeHidden();
});

test('an empty owned session keeps keyboard and floating track navigation', async ({ page }) => {
    await playSessionB(page);
    await clearSessionMedia(page);
    const bar = page.locator('[data-ponder="player-bar"]');
    await expect(bar).toBeVisible();
    await bar.hover();
    await expect(bar.locator('button.h-12.w-12')).toBeDisabled();
    await expect(bar.locator('input[type="range"]')).toBeDisabled();

    // Plain arrows remain seek intents, even when the owner's current media is empty.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    expect(await intentCount(page, 'seek')).toBe(2);
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ active: true, song: null, source: null });

    const modifier = await trackModifier(page);
    await page.keyboard.press(`${modifier}+ArrowRight`);
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 A', state: 'PLAYING' });
    expect(await intentCount(page, 'next')).toBe(1);
    await clearSessionMedia(page);
    await page.keyboard.press(`${modifier}+ArrowLeft`);
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 B', state: 'PLAYING' });
    expect(await intentCount(page, 'previous')).toBe(1);

    await clearSessionMedia(page);
    await bar.hover();
    await bar.getByRole('button', { name: '下一首', exact: true }).click();
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 A', state: 'PLAYING' });
    expect(await intentCount(page, 'next')).toBe(2);
    await clearSessionMedia(page);
    await bar.hover();
    await bar.getByRole('button', { name: '上一首', exact: true }).click();
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 B', state: 'PLAYING' });
    expect(await intentCount(page, 'previous')).toBe(2);
});

test('an empty session still consumes forbidden keyboard and API intents until capabilities return', async ({ page }) => {
    await playSessionB(page);
    await page.getByRole('button', { name: '切换切歌 / 跳转权限', exact: true }).click();
    await clearSessionMedia(page);
    await page.getByRole('button', { name: '清空日志', exact: true }).click();
    const bar = page.locator('[data-ponder="player-bar"]');
    await bar.hover();
    await expect(bar.getByRole('button', { name: '下一首', exact: true })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: '上一首', exact: true })).toHaveCount(0);
    await expect(bar.locator('button.h-12.w-12')).toBeDisabled();
    await expect(bar.locator('input[type="range"]')).toBeDisabled();
    const modifier = await trackModifier(page);
    for (const key of [`${modifier}+ArrowRight`, `${modifier}+ArrowLeft`, 'ArrowRight', 'ArrowLeft']) {
        await page.keyboard.press(key);
    }
    await page.getByRole('button', { name: '宿主下一首', exact: true }).click();
    await page.getByRole('button', { name: '宿主跳转到 10 秒', exact: true }).click();
    await expect(page.getByLabel('执行日志')).not.toContainText('意图');
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ active: true, song: null, source: null });

    await page.getByRole('button', { name: '切换切歌 / 跳转权限', exact: true }).click();
    await bar.hover();
    await bar.getByRole('button', { name: '下一首', exact: true }).click();
    await expect.poll(() => playbackSnapshot(page)).toMatchObject({ song: '会话测试 A', state: 'PLAYING' });
    expect(await intentCount(page, 'next')).toBe(1);
});

test('an ordinary empty player has no floating navigation before acquisition or after release', async ({ page }) => {
    const bar = page.locator('[data-ponder="player-bar"]');
    const modifier = await trackModifier(page);
    const expectEmpty = async () => {
        await expect(bar).toHaveCount(0);
        for (const key of [`${modifier}+ArrowRight`, `${modifier}+ArrowLeft`, 'ArrowRight', 'ArrowLeft']) {
            await page.keyboard.press(key);
        }
        await expect.poll(() => playbackSnapshot(page)).toMatchObject({ active: false, song: null, source: null, state: 'IDLE' });
        await expect(page.getByLabel('执行日志')).not.toContainText('意图');
    };
    await expectEmpty();
    await playSessionB(page);
    await page.getByRole('button', { name: '释放会话', exact: true }).click();
    await expectEmpty();
});

test('routes native transport to the session, preserves local pause and restores the private queue', async ({ page }, testInfo) => {
    const state = () => page.evaluate(async () => {
        const path = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(path);
        const s = usePlaybackStore.getState();
        return { song: s.currentSong?.name ?? null, queue: s.playQueue.map((song: { name: string }) => song.name), state: s.playerState, source: s.audioSrc };
    });
    await page.getByRole('button', { name: '准备私人队列', exact: true }).click();
    await expect.poll(async () => (await state()).queue).toEqual(['会话测试 A', '会话测试 B']);
    await page.getByRole('button', { name: '建立会话并播放 B', exact: true }).click();
    await expect.poll(async () => (await state()).song).toBe('会话测试 B');
    await expect.poll(async () => (await state()).state).toBe('PLAYING');
    await expect.poll(() => page.evaluate(() => document.querySelector('audio')?.currentTime ?? 0)).toBeGreaterThan(0.5);
    await page.screenshot({ path: testInfo.outputPath('session-api-demo.png'), animations: 'disabled' });
    await page.getByRole('button', { name: '宿主暂停 / 恢复', exact: true }).click();
    await expect.poll(async () => (await state()).state).toBe('PAUSED');
    await expect(page.getByLabel('执行日志')).not.toContainText('意图 pause');
    await page.getByRole('button', { name: '宿主下一首', exact: true }).click();
    await expect.poll(async () => (await state()).song).toBe('会话测试 A');
    await expect(page.getByLabel('执行日志')).toContainText('意图 next');
    await page.getByRole('button', { name: '切换切歌 / 跳转权限', exact: true }).click();
    await page.getByRole('button', { name: '清空日志', exact: true }).click();
    await page.getByRole('button', { name: '宿主下一首', exact: true }).click();
    await page.getByRole('button', { name: '宿主跳转到 10 秒', exact: true }).click();
    await expect(page.getByLabel('执行日志')).not.toContainText('意图');
    await page.getByRole('button', { name: '释放会话', exact: true }).click();
    await expect.poll(state).toMatchObject({ song: null, queue: ['会话测试 A', '会话测试 B'], source: null });
});

test('disabling the real sample cancels ownership and a delayed source cannot return after release', async ({ page }) => {
    await page.getByRole('button', { name: '加载慢音源后立即退出', exact: true }).click();
    await expect(page.getByLabel('执行日志')).toContainText('已释放');
    await expect(page.getByLabel('执行日志')).toContainText('加载 B: cancelled');
    await expect(page.getByLabel('执行日志')).not.toContainText('source-committed');
    await page.waitForTimeout(4300);
    const snapshot = () => page.evaluate(async () => {
        const storePath = '/src/stores/usePlaybackStore.ts', sessionPath = '/src/services/externalPlaybackSession.ts';
        const { usePlaybackStore } = await import(storePath);
        const { hasExternalPlayback } = await import(sessionPath);
        return { active: hasExternalPlayback(), source: usePlaybackStore.getState().audioSrc };
    });
    await expect.poll(snapshot).toEqual({ active: false, source: null });
    await page.getByRole('button', { name: '建立会话并播放 B', exact: true }).click();
    await expect.poll(async () => (await snapshot()).source).not.toBeNull();
    await page.evaluate(async () => {
        const path = '/src/mods/folium/clientLoader.ts';
        const { reconcileFoliumClients } = await import(path);
        await reconcileFoliumClients([], 'main');
    });
    await expect.poll(snapshot).toEqual({ active: false, source: null });
    await expect(page.getByRole('button', { name: '建立会话并播放 B', exact: true })).toHaveCount(0);
});
