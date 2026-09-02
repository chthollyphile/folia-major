import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY } from '../helpers/appState';

// test/ui/panelControlsTab.spec.ts
// 覆盖播放面板控制页的模式取景器：箭头步进、完整列表入口，以及步进经过商籁时不再被拦截。

const readVisualizerMode = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useVisualizerSettingsStore.ts';
    const { useVisualizerSettingsStore } = await import(storeModulePath);
    return useVisualizerSettingsStore.getState().visualizerMode as string;
});

const openPlayerPage = async (page: import('@playwright/test').Page) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('i18nextLng', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await page.waitForTimeout(2000);
};

const openControlsTab = async (page: import('@playwright/test').Page) => {
    await openPlayerPage(page);
    await page.locator('div.fixed.bottom-8.right-0 button').last().click();
    await page.waitForTimeout(500);
    await page.getByTitle('控制', { exact: true }).click();
    await page.waitForTimeout(600);
};

const openQueueWithFixture = async (page: import('@playwright/test').Page) => {
    await openPlayerPage(page);
    const queue = [
        { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Shared Album' }, durationMs: 180_000 },
        { id: 2, name: 'Same Artist', artists: [{ id: 10, name: 'Alpha' }], album: { id: 21, name: 'Other Album' }, durationMs: 180_000 },
        { id: 3, name: 'Same Album', artists: [{ id: 11, name: 'Beta' }], album: { id: 20, name: 'Shared Album' }, durationMs: 180_000 },
        { id: 4, name: 'Other', artists: [{ id: 12, name: 'Gamma' }], album: { id: 22, name: 'Third Album' }, durationMs: 180_000 },
    ];
    await page.evaluate(async (songs) => {
        const dbModulePath = '/src/services/db.ts';
        const { saveToCache } = await import(dbModulePath);
        await saveToCache('last_song', songs[0]);
        await saveToCache('last_queue', songs);
    }, queue);
    await page.reload();
    await page.waitForTimeout(1800);
    // 全局键盘监听比首屏晚装上一拍，定长 sleep 只是赌它已经装好了。反复敲直到面板真的响应。
    await expect.poll(async () => {
        await page.keyboard.press('Control+P');
        return page.getByTestId('command-palette-panel').count();
    }).toBeGreaterThan(0);
};

test('steps lyric modes with the arrows and opens the full list from the name', async ({ page }) => {
    await openControlsTab(page);
    expect(await readVisualizerMode(page)).toBe('classic');

    // 右箭头逐个前进：注册表顺序里 classic 的下一个。
    const lyricRow = page.locator('div.space-y-1 > div').first();
    await lyricRow.getByRole('button', { name: '歌词样式 +' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('cadenza');

    // 左箭头回到原处。
    await lyricRow.getByRole('button', { name: '歌词样式 −' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('classic');

    // 点名称展开完整列表，并且底部有「更多设置」入口。
    await lyricRow.getByRole('button', { name: '歌词样式', exact: true }).click();
    const list = page.getByRole('listbox', { name: '歌词样式' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(13);
    await expect(list.getByRole('option', { name: '静止' })).toBeVisible();
    await expect(page.getByText('更多设置', { exact: true })).toBeVisible();

    await list.getByRole('option', { name: '云阶' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('partita');
});

test('steps straight through sonnet without an interstitial dialog', async ({ page }) => {
    await openControlsTab(page);
    // 停在商籁的相邻格。相邻是哪一个由注册表顺序决定，所以在页面里现算，
    // 不要写死模式名——重排 order 时这个用例应当继续有效。
    const stepDirection = await page.evaluate(async () => {
        const registryModulePath = '/src/components/visualizer/registry.tsx';
        const storeModulePath = '/src/stores/useVisualizerSettingsStore.ts';
        const { VISUALIZER_REGISTRY } = await import(registryModulePath);
        const { useVisualizerSettingsStore } = await import(storeModulePath);
        const modes = (VISUALIZER_REGISTRY as Array<{ mode: string }>).map(entry => entry.mode);
        const sonnetIndex = modes.indexOf('sonnet');
        // 商籁排在首位时没有前一格，改成从后一格往回步进。
        const forward = sonnetIndex > 0;
        useVisualizerSettingsStore.getState().handleSetVisualizerMode(modes[sonnetIndex + (forward ? -1 : 1)], { notify: false });
        return forward ? '+' : '−';
    });
    await page.waitForTimeout(300);

    const lyricRow = page.locator('div.space-y-1 > div').first();
    await lyricRow.getByRole('button', { name: `歌词样式 ${stepDirection}` }).click();
    await page.waitForTimeout(400);

    expect(await readVisualizerMode(page)).toBe('sonnet');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('closes the audio effect dialog with Escape', async ({ page }) => {
    await openControlsTab(page);

    await page.getByRole('button', { name: '打开音频均衡器' }).click();
    const equalizerTitle = page.getByText('音频效果器', { exact: true });
    await expect(equalizerTitle).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(equalizerTitle).toBeHidden();
});

test('cycles the open panel tabs with Tab and wraps around', async ({ page }) => {
    await openControlsTab(page);

    const coverTab = page.getByTitle('封面', { exact: true });
    const controlsTab = page.getByTitle('控制', { exact: true });
    const queueTab = page.getByTitle('播放列表', { exact: true });
    const accountTab = page.getByTitle('账户', { exact: true });

    await expect(controlsTab).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(queueTab).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(accountTab).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(coverTab).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Shift+Tab');
    await expect(accountTab).toHaveAttribute('aria-pressed', 'true');
});

test('opens the command palette directly in queue mode with Control+P', async ({ page }) => {
    await openControlsTab(page);

    await page.keyboard.press('Control+P');

    await expect(page.getByTestId('command-palette-panel')).toBeVisible();
    await expect(page.getByRole('combobox')).toHaveAttribute('placeholder', '输入歌名、歌手、专辑或队列序号');
    await expect(page.getByText('队列', { exact: true })).toBeVisible();
});

test('filters queue metadata with @ and confirms an atomic batch removal', async ({ page }) => {
    await openQueueWithFixture(page);
    const input = page.getByRole('combobox');

    await input.fill('@');
    const suggestions = page.getByTestId('command-palette-queue-suggestions');
    await expect(suggestions.getByText('歌手: Alpha')).toBeVisible();
    await expect(suggestions.getByText('专辑: Shared Album')).toBeVisible();
    await expect(page.getByText('Same Artist', { exact: true })).toBeVisible();
    await expect(page.getByText('Same Album', { exact: true })).toBeVisible();
    await expect(page.getByText('Other', { exact: true })).toBeHidden();

    await input.fill('@third');
    await suggestions.getByText('专辑: Third Album').click();
    await expect(input).toHaveValue('@album:"Third Album"');
    await expect(page.getByText('Other', { exact: true })).toBeVisible();

    await input.fill('--remove @artist:Alpha');
    const preview = page.getByTestId('command-palette-queue-batch-preview');
    await expect(preview).toContainText('将影响 1 首匹配歌曲');
    await expect(preview).toContainText('已排除当前播放歌曲');
    await preview.getByRole('button', { name: '确认执行' }).click();
    await expect(page.getByTestId('command-palette-panel')).toBeHidden();

    const persistedQueue = await page.evaluate(async () => {
        const dbModulePath = '/src/services/db.ts';
        const { getFromCache } = await import(dbModulePath);
        const songs = await getFromCache('last_queue') as Array<{ name: string }> | undefined;
        return songs?.map((song: { name: string }) => song.name) ?? [];
    });
    expect(persistedQueue).toEqual(['Current', 'Same Album', 'Other']);
});
