import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/commandPaletteTouch.spec.ts
// 触屏上打开命令面板不拿输入框的焦点：拿了会先弹出输入法，入场动画一结束又被 blurInputOnTouch
// 收起（CommandPalette.tsx），输入法闪一下。在桌面上开发时看不出来，所以钉在这里；点输入框照样聚焦。

test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure' });

const twoFrames = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

test('a touch screen opens the palette with its input unfocused, and a tap on the input focuses it', async ({ page }) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);
    await page.goto('/');
    await waitForAppMounted(page);

    // Counts every focus the palette's input takes, so a focus that is dropped again a moment later still shows.
    await page.evaluate(() => {
        const counted = window as Window & { __paletteInputFocuses?: number };
        counted.__paletteInputFocuses = 0;
        document.addEventListener('focusin', (event) => {
            const target = event.target as Element;
            if (target.tagName === 'INPUT' && target.closest('[data-folia-keyboard-window]')) {
                counted.__paletteInputFocuses = (counted.__paletteInputFocuses ?? 0) + 1;
            }
        }, true);
    });
    // The module path goes in as an argument: it is the dev server's URL, which TypeScript does not resolve.
    await page.evaluate(async (storePath) => {
        const { openCommandPalette } = await import(storePath) as { openCommandPalette: () => void };
        openCommandPalette();
    }, '/src/stores/useAppViewStore.ts');
    const input = page.locator('[data-folia-keyboard-window] input').first();
    await expect(input).toBeVisible();
    // The palette took the focus a frame after it opened; two frames on, any such focus has happened.
    await page.evaluate(twoFrames);

    expect(await page.evaluate(() => (window as Window & { __paletteInputFocuses?: number }).__paletteInputFocuses)).toBe(0);
    await expect(input).not.toBeFocused();

    await input.tap();
    await expect(input).toBeFocused();
});
