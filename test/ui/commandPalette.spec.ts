import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/commandPalette.spec.ts
// 覆盖命令面板的三类入口：默认匹配列表、surface 接管（音量 / 队列 / 模式选择器），
// 以及执行模式的单键立即执行。这些路径在重构后不再有按 id 硬编码的分支，需要真实浏览器验证。

const QUEUE_FIXTURE = [
    { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Shared Album' }, durationMs: 180_000 },
    { id: 2, name: 'Same Artist', artists: [{ id: 10, name: 'Alpha' }], album: { id: 21, name: 'Other Album' }, durationMs: 180_000 },
    { id: 3, name: 'Same Album', artists: [{ id: 11, name: 'Beta' }], album: { id: 20, name: 'Shared Album' }, durationMs: 180_000 },
    { id: 4, name: 'Other', artists: [{ id: 12, name: 'Gamma' }], album: { id: 22, name: 'Third Album' }, durationMs: 180_000 },
];

// Settings live in several domain stores now, so look the key up across them rather than
// naming one store here — otherwise every further store split silently breaks these reads.
const readStore = (page: import('@playwright/test').Page, key: string) => page.evaluate(async (stateKey) => {
    const modulePaths = [
        '/src/stores/useVisualizerSettingsStore.ts',
        '/src/stores/useThemeSettingsStore.ts',
        '/src/stores/usePlayerChromeSettingsStore.ts',
        '/src/stores/useAudioSettingsStore.ts',
        '/src/stores/useAutomixSettingsStore.ts',
        '/src/stores/usePlaybackStore.ts',
    ];
    for (const modulePath of modulePaths) {
        const module = await import(modulePath) as Record<string, { getState: () => Record<string, unknown> }>;
        const store = Object.values(module).find(value => typeof value?.getState === 'function');
        const state = store?.getState();
        if (state && stateKey in state) {
            return state[stateKey];
        }
    }
    return undefined;
}, key);

const seedApp = async (page: import('@playwright/test').Page, openPlayerOnLaunch: boolean) => {
    await page.addInitScript(([version, guideKey, onLaunch]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'zh-CN');
        localStorage.setItem('open_player_on_launch', String(onLaunch));
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, openPlayerOnLaunch] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
};

const openPlayerPage = async (page: import('@playwright/test').Page) => {
    await seedApp(page, true);

    await page.goto('/');
    await page.waitForTimeout(2000);
    await page.evaluate(async (songs) => {
        const dbModulePath = '/src/services/db.ts';
        const { saveToCache } = await import(dbModulePath);
        await saveToCache('last_song', songs[0]);
        await saveToCache('last_queue', songs);
    }, QUEUE_FIXTURE);
    await page.reload();
    await page.waitForTimeout(1800);
};

const palette = (page: import('@playwright/test').Page) => page.getByTestId('command-palette-panel');
const paletteInput = (page: import('@playwright/test').Page) => palette(page).getByRole('combobox');

// 首页没有可播放的曲目，也不需要——这几条只关心面板本身在首页能不能开、开出什么。
const openHomePage = async (page: import('@playwright/test').Page) => {
    await seedApp(page, false);
    await page.goto('/');
    await page.waitForTimeout(2000);
};

/**
 * 全局键盘监听比首屏晚装上一拍，定长 sleep 只是赌它已经装好了——本文件长期偶发的
 * 「面板没打开」就是这么来的，并发负载下等待窗口不够。改成反复敲入口键直到面板真的响应。
 * 顺带让「不该打开」那条断言变得有意义：先证明监听器在，再证明它没反应。
 */
const pressUntilPaletteOpens = async (page: import('@playwright/test').Page, key = 'ControlOrMeta+k') => {
    await expect.poll(async () => {
        await page.keyboard.press(key);
        return palette(page).count();
    }).toBeGreaterThan(0);
};

test('opens on home with the primary modifier and K', async ({ page }) => {
    await openHomePage(page);

    await pressUntilPaletteOpens(page);
    await expect(palette(page)).toBeVisible();
});

test('still opens with bare s on the home shelf', async ({ page }) => {
    await openHomePage(page);

    // 首页这一层没有任何东西读单字符，所以裸键 s 和播放页一样管用。让位只发生在网格里，
    // 那里注册了筛选。
    await pressUntilPaletteOpens(page, 's');
    await expect(palette(page)).toBeVisible();
});

test('withdraws the player-surface commands on home', async ({ page }) => {
    await openHomePage(page);
    await pressUntilPaletteOpens(page);
    await paletteInput(page).fill('panel cover');
    await page.waitForTimeout(400);

    // 面板长在播放页上；首页没有可开的东西，所以这条命令连匹配都不该产生。
    await expect(palette(page).getByText('面板：封面', { exact: true })).toHaveCount(0);
});

test('still offers the player-surface commands on the player', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');
    await paletteInput(page).fill('panel cover');
    await page.waitForTimeout(400);

    await expect(palette(page).getByText('面板：封面', { exact: true }).first()).toBeVisible();
});

test('opens with s and shows the declared landing commands', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');

    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByText('队列', { exact: true }).first()).toBeVisible();
    await expect(palette(page).getByText('音量条', { exact: true }).first()).toBeVisible();
});

test('volume command takes over the panel with a slider surface', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');
    await paletteInput(page).fill('volume');
    await page.waitForTimeout(400);
    await palette(page).getByText('音量条', { exact: true }).first().click();
    await page.waitForTimeout(400);

    // Surface 接管后输入框变成数字输入，面板主体是滑块而不是匹配列表。
    await expect(paletteInput(page)).toHaveAttribute('type', 'number');
    await expect(palette(page).locator('input[type="range"]')).toBeVisible();
});

test('queue command parses the batch syntax and stages a preview', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 'Control+P');

    await paletteInput(page).fill('--rm @artist:Alpha');
    await page.waitForTimeout(400);
    await expect(palette(page).getByText('移除匹配歌曲')).toBeVisible();

    // Escape 先摘掉批量动作，再摘掉筛选，最后才关闭面板。
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(paletteInput(page)).toHaveValue('@artist:Alpha');
    await expect(palette(page)).toBeVisible();
});

test('visualizer picker switches the mode from the list', async ({ page }) => {
    await openPlayerPage(page);
    expect(await readStore(page, 'visualizerMode')).toBe('classic');

    await pressUntilPaletteOpens(page, 's');
    await paletteInput(page).fill('选择可视化');
    // 匹配走 120ms 防抖，回车必须等列表刷新后再按，否则命中的是落地列表首项。
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    await paletteInput(page).fill('云阶');
    await page.waitForTimeout(400);
    await palette(page).getByRole('button').filter({ hasText: '云阶' }).first().click();
    await page.waitForTimeout(600);

    expect(await readStore(page, 'visualizerMode')).toBe('partita');
    await expect(palette(page)).toBeHidden();
});

test('visualizer picker walks the mode list and marks the live mode', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');
    await paletteInput(page).fill('选择可视化');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);

    const rows = palette(page).locator('[data-picker-mode]');
    const modes = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-picker-mode')));
    expect(modes.length).toBeGreaterThan(2);

    // 当前生效的模式带勾选标记，且只有一个。
    await expect(palette(page).locator('[data-picker-selected="true"]')).toHaveCount(1);
    expect(await palette(page).locator('[data-picker-selected="true"]').getAttribute('data-picker-mode')).toBe('classic');

    const activeMode = () => palette(page).locator('[data-picker-active="true"]').getAttribute('data-picker-mode');
    expect(await activeMode()).toBe(modes[0]);

    // 单列列表，上下一次一行；首行再往上停在边界。
    await page.keyboard.press('ArrowDown');
    expect(await activeMode()).toBe(modes[1]);

    await page.keyboard.press('ArrowUp');
    expect(await activeMode()).toBe(modes[0]);

    await page.keyboard.press('ArrowUp');
    expect(await activeMode()).toBe(modes[0]);

    // 走到第一个不是初始模式的行再回车，避免断言被「本来就是 classic」蒙混过去。
    const targetIndex = modes.findIndex(mode => mode !== 'classic');
    expect(targetIndex).toBeGreaterThanOrEqual(0);
    for (let step = 0; step < targetIndex; step += 1) {
        await page.keyboard.press('ArrowDown');
    }
    expect(await activeMode()).toBe(modes[targetIndex]);

    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
    expect(await readStore(page, 'visualizerMode')).toBe(modes[targetIndex]);
});

test('execute mode runs a command from a single key', async ({ page }) => {
    await openPlayerPage(page);
    await page.keyboard.press(':');

    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByText('执行模式')).toBeVisible();

    // d 是明暗切换；敲下去应立即执行并关闭面板，不需要回车。
    const before = await readStore(page, 'isDaylight');
    await paletteInput(page).pressSequentially('d');
    await page.waitForTimeout(600);

    expect(await readStore(page, 'isDaylight')).not.toBe(before);
    await expect(palette(page)).toBeHidden();
});

test('execute mode reports an unknown key instead of guessing', async ({ page }) => {
    await openPlayerPage(page);
    await page.keyboard.press(':');
    await paletteInput(page).pressSequentially('z');
    await page.waitForTimeout(400);

    await expect(palette(page).getByText(/没有命令使用/)).toBeVisible();
    await expect(palette(page)).toBeVisible();
});

const readPersonalFmSelection = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/usePersonalFmModeStore.ts';
    const { usePersonalFmModeStore } = await import(storeModulePath);
    return usePersonalFmModeStore.getState().selection;
});

const openFmModeSurface = async (page: import('@playwright/test').Page) => {
    await pressUntilPaletteOpens(page, 's');
    await paletteInput(page).fill('私人 FM 模式');
    // 匹配走 120ms 防抖，回车必须等列表刷新后再按。
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(600);
};

test('fm mode picker selects scene mode straight from a scene pill', async ({ page }) => {
    await openPlayerPage(page);
    expect(await readPersonalFmSelection(page)).toEqual({ mode: 'DEFAULT', scene: null });

    await openFmModeSurface(page);
    // 模式行 5 个 + 场景 42 个，全部是同一种 pill。
    await expect(palette(page).locator('[data-fm-option]')).toHaveCount(47);
    await expect(palette(page).locator('[data-fm-option="fm-mode-pick-DEFAULT"][data-fm-selected="true"]')).toBeVisible();

    await palette(page).locator('[data-fm-option="fm-scene-pick-SLEEP_HELP"]').click();
    await page.waitForTimeout(600);

    expect(await readPersonalFmSelection(page)).toEqual({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
});

test('fm mode picker filters to one section and walks it with arrows', async ({ page }) => {
    await openPlayerPage(page);
    await openFmModeSurface(page);

    await paletteInput(page).fill('语');
    await page.waitForTimeout(300);
    const filtered = palette(page).locator('[data-fm-option]');
    await expect(filtered).toHaveCount(await filtered.count());
    expect(await filtered.count()).toBeGreaterThan(0);

    await paletteInput(page).fill('');
    await page.waitForTimeout(300);

    const activeOption = () => palette(page).locator('[data-fm-active="true"]').getAttribute('data-fm-option');
    expect(await activeOption()).toBe('fm-mode-pick-DEFAULT');

    // 左右一次一格。
    await page.keyboard.press('ArrowRight');
    expect(await activeOption()).toBe('fm-mode-pick-FAMILIAR');
    await page.keyboard.press('ArrowLeft');
    expect(await activeOption()).toBe('fm-mode-pick-DEFAULT');

    // 上下走的是实际渲染出来的行。分类内部会折行（场景 2 行、曲风 3 行），按分类跳会漏掉
    // 折下来的那几行，只能靠左右键够到——这里逐行断言，防止再退回按分类跳。
    const rowHeads = await palette(page).locator('[data-fm-option]').evaluateAll(nodes => {
        const rows = new Map<number, string>();
        nodes.forEach(node => {
            const top = Math.round(node.getBoundingClientRect().top);
            if (!rows.has(top)) rows.set(top, (node as HTMLElement).dataset.fmOption ?? '');
        });
        return [...rows.entries()].sort((left, right) => left[0] - right[0]).map(([, id]) => id);
    });
    expect(rowHeads.length).toBeGreaterThan(5);

    for (const head of rowHeads.slice(1)) {
        await page.keyboard.press('ArrowDown');
        expect(await activeOption()).toBe(head);
    }
    for (const head of [...rowHeads].reverse().slice(1)) {
        await page.keyboard.press('ArrowUp');
        expect(await activeOption()).toBe(head);
    }
});
