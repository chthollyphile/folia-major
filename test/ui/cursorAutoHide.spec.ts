import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/cursorAutoHide.spec.ts
// 拦住「干净安装默认不隐藏指针」：控件默认 always-visible 时，播放页空闲后仍应挂上
// cursor-auto-hidden；命令面板打开时必须立刻拿掉。不要在种子里写
// player_chrome_visibility_mode，否则这条回归会自己把自己绕过去。

const QUEUE_FIXTURE = [
    { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Shared Album' }, durationMs: 180_000 },
];

const shell = (page: import('@playwright/test').Page) => (
    page.locator('div.fixed.inset-0.w-full.h-full.flex.flex-col').first()
);

const openPlayerPage = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await expect.poll(async () => page.evaluate(async (songs) => {
        try {
            const dbModulePath = '/src/services/db.ts';
            const { saveToCache } = await import(dbModulePath);
            await saveToCache('last_song', songs[0]);
            await saveToCache('last_queue', songs);
            return true;
        } catch {
            return false;
        }
    }, QUEUE_FIXTURE)).toBe(true);
    await page.reload();
};

const waitForPlayerView = async (page: import('@playwright/test').Page) => {
    await expect.poll(() => page.evaluate(async () => {
        const storeModulePath = '/src/stores/useAppViewStore.ts';
        const { useAppViewStore } = await import(storeModulePath);
        return useAppViewStore.getState().view;
    })).toBe('player');
};

test('hides the cursor on a clean player page even when chrome stays always-visible', async ({ page }) => {
    await openPlayerPage(page);
    await waitForPlayerView(page);

    // 控件 hook 会把缺省值写进 localStorage。断言它确实是 always-visible，
    // 才说明下面那条 class 不是靠「用户开了自动隐藏控件」才出现的。
    await expect.poll(() => page.evaluate(() => localStorage.getItem('player_chrome_visibility_mode')))
        .toBe('always-visible');

    await expect(shell(page)).toHaveClass(/cursor-auto-hidden/, { timeout: 5_000 });
});

test('keeps the cursor visible while the command palette is open', async ({ page }) => {
    await openPlayerPage(page);
    await waitForPlayerView(page);
    await expect(shell(page)).toHaveClass(/cursor-auto-hidden/, { timeout: 5_000 });

    await expect.poll(async () => {
        await page.keyboard.press('ControlOrMeta+k');
        return page.getByTestId('command-palette-panel').count();
    }).toBeGreaterThan(0);

    await expect(shell(page)).not.toHaveClass(/cursor-auto-hidden/);
});
