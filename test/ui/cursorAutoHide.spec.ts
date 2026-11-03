import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/cursorAutoHide.spec.ts
// 播放页空闲时的指针隐藏。它没有自己的计时器，跟着控制栏的自动隐藏状态走，所以这里验的是
// 三件事：跟随是否成立、作用域有没有溢出到命令面板、以及附加开关能不能只关指针不关控制栏。
// 单测环境是 node、也没有 React 测试库，这些只能在真实浏览器里看。

const QUEUE_FIXTURE = [
    { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Shared Album' }, durationMs: 180_000 },
    { id: 2, name: 'Next', artists: [{ id: 11, name: 'Beta' }], album: { id: 21, name: 'Other Album' }, durationMs: 180_000 },
];

const surface = (page: Page) => page.getByTestId('player-visual-surface');

const readCursor = (page: Page, locator: ReturnType<typeof surface>) => locator.evaluate(
    element => getComputedStyle(element).cursor,
);

/** 播放页 + 控制栏自动隐藏模式；`cursorEnabled` 为 false 时预置附加开关为关。 */
const openPlayerPage = async (page: Page, cursorEnabled: boolean) => {
    await page.addInitScript(([version, guideKey, cursor]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
        localStorage.setItem('auto_hide_player_chrome', 'true');
        localStorage.setItem('player_chrome_visibility_mode', 'auto-hide');
        localStorage.setItem('auto_hide_cursor_with_player_chrome', String(cursor));
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, cursorEnabled] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await waitForAppMounted(page);
    // 种数据要等模块图和 IndexedDB 都就绪，轮询到真的写进去为止再重载。
    await expect.poll(async () => page.evaluate(async (songs) => {
        try {
            // 动态 import 的路径走变量：tsc 不会把浏览器里的 vite 路径当模块去解析。
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
    await waitForAppMounted(page);
    await expect(surface(page)).toBeAttached();
};

/** 控制栏的空闲延时是 3 秒，指针跟着它走，所以这里等的是同一个时钟。 */
const expectCursorHidden = async (page: Page) => {
    await expect.poll(async () => readCursor(page, surface(page)), { timeout: 10_000 }).toBe('none');
};

test('hides the cursor with the player chrome and brings it back on mouse move', async ({ page }) => {
    await openPlayerPage(page, true);

    await expectCursorHidden(page);

    // 后代里那些带 Tailwind `cursor-*` 工具类的元素也必须被压过去，否则隐藏只是看起来生效。
    const visibleCursors = await surface(page).evaluate(element => Array.from(
        element.querySelectorAll('*'),
    ).filter(node => getComputedStyle(node).cursor !== 'none').length);
    expect(visibleCursors).toBe(0);

    // 压制靠的是那条规则不在任何 @layer 里，而不是特异性——作用域内真实存在 disabled:
    // cursor-not-allowed 这类特异性更高的工具类（visualizer 下 18 处），只是这个夹具页面上
    // 没有处于 disabled 态的。临时塞一个进去，把「别把规则挪进 @layer」这条约束钉住。
    const injectedCursor = await surface(page).evaluate(element => {
        const probe = document.createElement('button');
        probe.className = 'cursor-pointer disabled:cursor-not-allowed';
        probe.disabled = true;
        element.appendChild(probe);
        const cursor = getComputedStyle(probe).cursor;
        probe.remove();
        return cursor;
    });
    expect(injectedCursor).toBe('none');

    await page.mouse.move(720, 560);
    await expect.poll(async () => readCursor(page, surface(page))).not.toBe('none');
});

test('reveals both the player chrome and cursor on pointer interaction', async ({ page }) => {
    await openPlayerPage(page, true);
    await expectCursorHidden(page);

    // Dispatch directly so this assertion cannot pass because Playwright moved the mouse first.
    await surface(page).dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'mouse', buttons: 1 });
    await expect.poll(async () => page.evaluate(async () => {
        const chromeStorePath = '/src/stores/useAppChromeStore.ts';
        const { useAppChromeStore } = await import(chromeStorePath) as {
            useAppChromeStore: { getState: () => { isPlayerChromeHidden: boolean } };
        };
        return useAppChromeStore.getState().isPlayerChromeHidden;
    })).toBe(false);
    expect(await readCursor(page, surface(page))).not.toBe('none');

    await surface(page).dispatchEvent('pointerup', { pointerId: 1, pointerType: 'mouse', buttons: 0 });
});

test('keeps the cursor on the command palette while the player surface hides it', async ({ page }) => {
    await openPlayerPage(page, true);
    await expectCursorHidden(page);

    // 键盘不参与唤回（控制栏也不因按键重新出现），所以面板打开时播放页仍是隐藏态——
    // 正好用来验证作用域：面板是那个容器的兄弟节点，不该继承 cursor: none。
    await expect.poll(async () => {
        await page.keyboard.press('ControlOrMeta+k');
        return page.getByTestId('command-palette-panel').count();
    }).toBeGreaterThan(0);

    const input = page.getByTestId('command-palette-panel').getByRole('combobox');
    await expect(input).toBeVisible();
    expect(await readCursor(page, surface(page))).toBe('none');
    expect(await readCursor(page, input)).not.toBe('none');
});

test('auto-hides the chrome without the cursor when the add-on is off', async ({ page }) => {
    await openPlayerPage(page, false);

    // 控制栏照常收起，指针不受影响：这就是这个附加开关存在的理由。
    await expect.poll(async () => page.evaluate(async () => {
        const chromeStorePath = '/src/stores/useAppChromeStore.ts';
        const { useAppChromeStore } = await import(chromeStorePath) as {
            useAppChromeStore: { getState: () => Record<string, unknown> };
        };
        return useAppChromeStore.getState().isPlayerChromeHidden;
    }), { timeout: 10_000 }).toBe(true);

    expect(await readCursor(page, surface(page))).not.toBe('none');
});
