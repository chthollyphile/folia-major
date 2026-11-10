import { expect, test, type Page } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/commandPaletteCapsuleCenter.spec.ts
// 播放条在场时命令窗口以胶囊为外壳（data-palette-frame="capsule"）。外壳里的面板必须垂直居中，
// 不是贴着播放条：贴底在矮窗口上（2560×1600 开 150% 缩放 = CSS 视口约 1707×1010）整块面板压在
// 屏幕下半部，上留白 419px、下留白 32px，看起来像位置算错了。这里把「上下留白相等」钉住，
// 并在同一条用例里换三次窗口高度重测，免得以后有人改回按胶囊位置算的 padding —— 那样只有
// 一种窗口高度是对的，而验收时正好是那种。

const SONGS = [
    { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Album' }, durationMs: 180_000 },
    { id: 2, name: 'Next', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Album' }, durationMs: 180_000 },
];

// 150% 缩放下 2560×1600 屏幕的 CSS 视口。DPR 只影响位图，不影响这里的任何断言，
// 所以不设 deviceScaleFactor：要钉的是布局，不是像素密度。
test.use({ viewport: { width: 1707, height: 1010 } });

const paletteFrame = (page: Page) => page.locator('[data-palette-frame="capsule"]');
const palette = (page: Page) => page.getByTestId('command-palette-panel');

const seedApp = async (page: Page, songs: typeof SONGS) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY] as const);

    await page.route('**/__mock_netease__/**', async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await waitForAppMounted(page);
    // 重试到真的写进 IndexedDB 为止；定长 sleep 只是在赌模块图和 DB 都已就绪。
    await expect.poll(async () => page.evaluate(async (queue) => {
        try {
            const dbModulePath = '/src/services/db.ts';
            const { saveToCache } = await import(dbModulePath);
            await saveToCache('last_song', queue[0]);
            await saveToCache('last_queue', queue);
            return true;
        } catch {
            return false;
        }
    }, songs)).toBe(true);
    await page.reload();
    await waitForAppMounted(page);
};

// 全局键盘监听比首屏晚装上一拍，定长 sleep 只是在赌它已经装好了。反复敲直到面板真的响应。
const pressUntilPaletteOpens = async (page: Page) => {
    await expect.poll(async () => {
        await page.keyboard.press('Control+k');
        return palette(page).count();
    }).toBeGreaterThan(0);
    await expect(paletteFrame(page)).toBeVisible();
};

type Gaps = { top: number; bottom: number };

/**
 * 外壳里那一摞（置顶命令行 + 面板）到视口上下边的距离。外壳本身带 CENTER_INSET 的上下 padding，
 * 减掉它才是「居中之后还剩多少空」，量级的差会被 padding 掩盖，所以先扣掉再比。
 */
const readGaps = async (page: Page): Promise<Gaps> => page.evaluate(() => {
    const frame = document.querySelector('[data-palette-frame="capsule"]') as HTMLElement | null;
    const stack = frame?.firstElementChild as HTMLElement | null;
    if (!frame || !stack) {
        return { top: Number.NaN, bottom: Number.NaN };
    }
    const rect = stack.getBoundingClientRect();
    const style = window.getComputedStyle(frame);
    return {
        top: Math.round(rect.top - parseFloat(style.paddingTop || '0')),
        bottom: Math.round(window.innerHeight - rect.bottom - parseFloat(style.paddingBottom || '0')),
    };
});

/** 上下留白相等；留 1px 给亚像素排版。 */
const expectVerticallyCentered = async (page: Page, label: string) => {
    await expect.poll(async () => {
        const gaps = await readGaps(page);
        return Math.abs(gaps.top - gaps.bottom);
    }, { message: label + '：面板没有垂直居中' }).toBeLessThanOrEqual(1);

    const gaps = await readGaps(page);
    expect(gaps.top, label + '：上留白 ' + gaps.top + ' / 下留白 ' + gaps.bottom).toBeGreaterThan(0);
};

test('播放条在场时命令窗口垂直居中，换窗口高度也居中', async ({ page }) => {
    await seedApp(page, SONGS);
    await pressUntilPaletteOpens(page);

    // 基线就是那次报障的窗口：150% 缩放下的 2560×1600。
    await expectVerticallyCentered(page, '1707×1010');

    for (const viewport of [{ width: 1707, height: 1530 }, { width: 1280, height: 680 }, { width: 1280, height: 420 }]) {
        await page.setViewportSize(viewport);
        await expectVerticallyCentered(page, viewport.width + '×' + viewport.height);
    }

    // 矮到放不下时压的是列表高度，不是位置：面板仍在中间，且没有顶出视口。
    const box = await palette(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(420);
});
