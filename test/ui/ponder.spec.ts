import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/ponder.spec.ts
// 思索在真实应用里的验证。这里只做 probe 做不到的那部分：
//
// 选择器是整套机制最脆的一环 —— 它对重构完全透明，删掉一个属性不会有任何东西报错，
// 只是从此没人能把教程调出来。ponderSelectorContract 从源码文本上守住属性还在，
// 但「选择器在真实 DOM 里确实命中」只有把应用跑起来才知道，这就是本文件存在的理由。

const openPlayerPage = async (page: Page, slots?: { primary: string; secondary: string }) => {
    await page.addInitScript(({ version, guideKey, slotPair }: {
        version: string;
        guideKey: string;
        slotPair?: { primary: string; secondary: string };
    }) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
        if (slotPair) {
            localStorage.setItem('player_control_slot_primary', slotPair.primary);
            localStorage.setItem('player_control_slot_secondary', slotPair.secondary);
        }
    }, { version: APP_VERSION, guideKey: GUIDE_VERSION_STORAGE_KEY, slotPair: slots });

    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await waitForAppMounted(page);
    await page.waitForTimeout(2000);
};

/**
 * 底部控制条只在有当前歌曲时才挂载，两个槽位还要控制条展开才渲染。
 * 这里不去真的放一首歌 —— 要验证的是选择器命中不命中，不是播放链路。
 */
const showPlayerControls = async (page: Page) => {
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(storeModulePath);
        usePlaybackStore.getState().setCurrentSong({
            id: 'ponder-e2e', name: '思索验证曲', artist: '测试', album: '测试', duration: 210,
        });
    });
    const bar = page.locator('[data-ponder="player-bar"]');
    await expect(bar).toHaveCount(1, { timeout: 5000 });
    // 悬停让胶囊展开，槽位才会出现。用户要悬停某个槽位，本来也必须先经过这一步。
    const box = (await bar.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.locator('[data-ponder-slots]')).toHaveCount(1, { timeout: 5000 });
};

/** 注册表里每个目标的 hoverSelector，从应用自己的模块里取，不在测试里抄一份。 */
const hoverSelectors = (page: Page) => page.evaluate(async () => {
    const registryPath = '/src/components/ponder/ponderRegistry.ts';
    const { PONDER_TARGET_LIST } = await import(registryPath);
    return (PONDER_TARGET_LIST as { id: string; hoverSelector: string | null }[])
        .map(target => ({ id: target.id, selector: target.hoverSelector }));
});

test.describe('思索 · 真实 DOM 里的选择器', () => {
    test('播放页上的目标都能命中真实元素', async ({ page }) => {
        // 两个槽位分别设成 shuffle 和 volume，这两个目标才会在页面上存在。
        await openPlayerPage(page, { primary: 'shuffle', secondary: 'volume' });
        await showPlayerControls(page);

        const targets = await hoverSelectors(page);
        const onPlayerPage = ['panel-slide', 'player-bar'];

        for (const id of onPlayerPage) {
            const target = targets.find(entry => entry.id === id);
            expect(target, `注册表里没有 ${id}`).toBeTruthy();
            await expect(
                page.locator(target!.selector!).first(),
                `${id} 的选择器 ${target!.selector} 在播放页上没有命中任何元素`,
            ).toHaveCount(1, { timeout: 5000 });
        }
    });

    test('整条控制条都能命中，不必对准某个小按钮', async ({ page }) => {
        await openPlayerPage(page, { primary: 'shuffle', secondary: 'volume' });
        await showPlayerControls(page);

        // 这才是这个目标按组件划分的意义：随便指向条上哪里都算数。
        const bar = page.locator('[data-ponder="player-bar"]');
        await expect(bar).toHaveCount(1);
        await expect(page.locator('[data-ponder-slot]')).toHaveCount(2);

        const slot = page.locator('[data-ponder-slot]').first();
        const belongsToBar = await slot.evaluate(node => Boolean(node.closest('[data-ponder="player-bar"]')));
        expect(belongsToBar, '槽位按钮应当落在控制条这个目标内部').toBe(true);
    });

    test('面板展开后，封面和四格标签各自的选择器都命中真实元素', async ({ page }) => {
        await openPlayerPage(page);

        await page.getByTestId('panel-toggle').click();
        await expect(page.locator('[data-testid="unified-panel-surface"]')).toHaveCount(1, { timeout: 5000 });

        const targets = await hoverSelectors(page);
        // 封面四颗按钮和四个标签页各是一个目标，整块面板的选择器命中不了它们。
        const insidePanel = [
            'panel-cover-actions',
            'panel-cover-tab',
            'panel-controls-tab',
            'panel-queue-tab',
            'panel-account-tab',
        ];
        // 来源那一格只在当前这首有来源信息时才渲染，播放页这条 mock 歌曲没有，
        // 所以它的选择器不在上面这组里 —— 那一格的存在性本身就是它那章要讲的事。

        for (const id of insidePanel) {
            const target = targets.find(entry => entry.id === id);
            expect(target, `注册表里没有 ${id}`).toBeTruthy();
            await expect(
                page.locator(target!.selector!),
                `${id} 的选择器 ${target!.selector} 在展开的面板里没有命中任何元素`,
            ).toHaveCount(1, { timeout: 5000 });
        }
    });

    // 随机那一章不再按槽位筛（合成胶囊里直接把按钮换成随机），但 data-ponder-slot 的值
    // 仍然是槽位配置的唯一真源，改名了这里就该红。
    test('槽位按钮的 data-ponder-slot 跟着配置走', async ({ page }) => {
        await openPlayerPage(page, { primary: 'loop', secondary: 'like' });
        await showPlayerControls(page);

        await expect(page.locator('[data-ponder-slot="shuffle"]')).toHaveCount(0);
        await expect(page.locator('[data-ponder-slot]')).toHaveCount(2);
    });
});

test.describe('思索 · 进入链路', () => {
    test('悬停侧栏开关满 600ms 出提示，长按 G 进教程，Esc 退出', async ({ page }) => {
        await openPlayerPage(page);

        const toggle = page.getByTestId('panel-toggle');
        // 用配置的默认超时：播放页在并行全量里首帧可能超过 5s，这一步验的是思索，不是启动速度。
        await expect(toggle).toBeVisible();
        const box = (await toggle.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

        await expect(page.locator('[data-testid="ponder-hint-capsule"]')).toBeVisible({ timeout: 3000 });

        await page.keyboard.down('g');
        await expect(page.locator('[data-testid="ponder-stage"]')).toBeVisible({ timeout: 3000 });
        await page.keyboard.up('g');

        await page.keyboard.press('Escape');
        await expect(page.locator('[data-testid="ponder-stage"]')).toHaveCount(0);
    });

    test('教程层接管键盘：开着时按 S 不会打开命令面板', async ({ page }) => {
        await openPlayerPage(page);

        const box = (await page.getByTestId('panel-toggle').boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await expect(page.locator('[data-testid="ponder-hint-capsule"]')).toBeVisible({ timeout: 3000 });
        await page.keyboard.down('g');
        await expect(page.locator('[data-testid="ponder-stage"]')).toBeVisible({ timeout: 3000 });
        await page.keyboard.up('g');

        await page.keyboard.press('s');
        await page.waitForTimeout(500);
        await expect(page.locator('[data-testid="command-palette-panel"]')).toHaveCount(0);
    });
});
