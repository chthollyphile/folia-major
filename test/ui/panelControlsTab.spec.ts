import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/panelControlsTab.spec.ts
// 覆盖播放面板控制页的模式取景器：箭头步进、完整列表入口，以及步进经过商籁时不再被拦截。

const readVisualizerMode = (page: import('@playwright/test').Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useVisualizerSettingsStore.ts';
    const { useVisualizerSettingsStore } = await import(storeModulePath);
    return useVisualizerSettingsStore.getState().visualizerMode as string;
});

const openPlayerPage = async (page: import('@playwright/test').Page, bottomBarOffset = 32) => {
    await page.addInitScript(({ version, guideKey, offset }: {
        version: string;
        guideKey: string;
        offset: number;
    }) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem('open_player_on_launch', 'true');
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem('player_bottom_bar_offset', String(offset));
        localStorage.setItem(guideKey, version);
    }, {
        version: APP_VERSION,
        guideKey: GUIDE_VERSION_STORAGE_KEY,
        offset: bottomBarOffset,
    });
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');
    await waitForAppMounted(page);
    await page.waitForTimeout(2000);
};

const openControlsTab = async (page: import('@playwright/test').Page) => {
    await openPlayerPage(page);
    await page.getByTestId('panel-toggle').locator('button').last().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '控制', exact: true }).click();
    await page.waitForTimeout(600);
};

const openOnlineLyricsTab = async (page: import('@playwright/test').Page) => {
    await openPlayerPage(page);
    await page.evaluate(async () => {
        const i18nModulePath = '/src/i18n/config.ts';
        const storeModulePath = '/src/stores/usePlaybackStore.ts';
        const { default: i18n } = await import(i18nModulePath);
        const { usePlaybackStore } = await import(storeModulePath);
        await i18n.changeLanguage('en');
        const song = {
            id: 397,
            name: 'Timeline Offset Fixture',
            artists: [{ id: 10, name: 'Alpha' }],
            album: { id: 20, name: 'Shared Album' },
            durationMs: 180_000,
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '397' },
        };
        usePlaybackStore.getState().setCurrentSong(song);
        usePlaybackStore.getState().setPlayQueue([song]);
    });

    const panelToggleButton = page.getByTestId('panel-toggle').getByRole('button');
    await expect(panelToggleButton).toBeVisible();
    await panelToggleButton.click();
    await page.getByRole('button', { name: 'Lyrics', exact: true }).click();
    await expect(page.getByRole('spinbutton', { name: 'Timeline Offset' })).toBeVisible();
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
    await waitForAppMounted(page);
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
    const lyricRow = page.locator('[data-ponder="lyric-style"] > div').first();
    await lyricRow.getByRole('button', { name: '歌词样式 +' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('cadenza');

    // 左箭头回到原处。
    await lyricRow.getByRole('button', { name: '歌词样式 −' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('classic');

    // 点中间那一块展开全部样式的小图，并且底部有「更多设置」入口。
    await lyricRow.getByRole('button', { name: '歌词样式', exact: true }).click();
    const list = page.getByRole('radiogroup', { name: '歌词样式' });
    await expect(list).toBeVisible();
    // 注册表中的样式之外，还有一个随机选择入口。
    const modeCount = await page.evaluate(async () => {
        const registryModulePath = '/src/components/visualizer/registry.tsx';
        const { VISUALIZER_REGISTRY } = await import(registryModulePath);
        return (VISUALIZER_REGISTRY as unknown[]).length;
    });
    await expect(list.getByRole('radio')).toHaveCount(modeCount + 1);
    await expect(list.getByRole('radio', { name: '随机', exact: true })).toBeVisible();
    await expect(list.getByRole('radio', { name: '静止' })).toBeVisible();
    await expect(page.getByText('更多设置', { exact: true })).toBeVisible();

    await list.getByRole('radio', { name: '云阶' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('partita');
});

test('shows the word segmentation button only for the modes built from word splits', async ({ page }) => {
    await openControlsTab(page);
    expect(await readVisualizerMode(page)).toBe('classic');

    const lyricRow = page.locator('[data-ponder="lyric-style"] > div').first();
    const segmentationButton = lyricRow.getByRole('button', { name: '歌词分词调整' });

    // classic 在注册表里标了 usesWordSegmentation。
    await expect(segmentationButton).toBeVisible();

    // 步到 cadenza —— 它是逐 grapheme 的，分词结果对它没有影响，按钮必须消失。
    await lyricRow.getByRole('button', { name: '歌词样式 +' }).click();
    await page.waitForTimeout(200);
    expect(await readVisualizerMode(page)).toBe('cadenza');
    await expect(segmentationButton).toBeHidden();

    // 回到 classic 再出现，确认它跟着模式走而不是一次性渲染。
    await lyricRow.getByRole('button', { name: '歌词样式 −' }).click();
    await page.waitForTimeout(200);
    await expect(segmentationButton).toBeVisible();

    // 点它打开命令面板里那条命令的 surface，而不是另开一个弹窗。
    await segmentationButton.click();
    await expect(page.getByTestId('command-palette-panel')).toBeVisible();
    await expect(page.getByTestId('command-palette-panel').getByText('当前没有可分词的歌词')).toBeVisible();
});

test('lifts the open right panel with the configured bottom bar baseline', async ({ page }) => {
    const bottomBarOffset = 152;
    await openPlayerPage(page, bottomBarOffset);
    await page.getByTestId('panel-toggle').locator('button').last().click();

    const panel = page.getByTestId('unified-panel-surface');
    await expect(panel).toBeVisible();
    // 面板从手柄的圆心长出来，长完之前下边缘还在动。
    await page.waitForTimeout(500);
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();

    // 面板整个在手柄上方：下边缘比基线高出手柄的 48px 加 12px 间距，基线和底栏共用同一个实时偏移。
    expect(viewport!.height - box!.y - box!.height).toBeCloseTo(bottomBarOffset + 60, 0);
    // 抬高时同步收缩滚动面板，不能把顶部推出视口。
    expect(box!.y).toBeGreaterThanOrEqual(48);
});

test('keeps the lyric offset reset clear of the open-panel close button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOnlineLyricsTab(page);

    const offsetInput = page.getByRole('spinbutton', { name: 'Timeline Offset' });
    const resetButton = page.getByRole('button', { name: 'Reset timeline offset' });
    const panelToggleButton = page.getByTestId('panel-toggle').getByRole('button');

    await offsetInput.fill('250');
    await expect(resetButton).toBeEnabled();
    const [resetBox, toggleBox] = await Promise.all([
        resetButton.boundingBox(),
        panelToggleButton.boundingBox(),
    ]);
    expect(resetBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(resetBox!.x + resetBox!.width).toBeLessThanOrEqual(toggleBox!.x);

    await resetButton.click();
    await expect(offsetInput).toHaveValue('0');
    await expect(resetButton).toBeHidden();
});

test('keeps the configured bottom baseline after navigating to another page', async ({ page }) => {
    const bottomBarOffset = 152;
    await openPlayerPage(page, bottomBarOffset);
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useAppViewStore.ts';
        const { useAppViewStore } = await import(storeModulePath);
        useAppViewStore.setState({ view: 'home' });
    });

    await expect.poll(() => page.evaluate(async () => {
        const signalModulePath = '/src/stores/motionSignals.ts';
        const { playerBottomBarLiveOffset } = await import(signalModulePath);
        return playerBottomBarLiveOffset.get();
    })).toBe(bottomBarOffset);

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

    const lyricRow = page.locator('[data-ponder="lyric-style"] > div').first();
    await lyricRow.getByRole('button', { name: `歌词样式 ${stepDirection}` }).click();
    await page.waitForTimeout(400);

    expect(await readVisualizerMode(page)).toBe('sonnet');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('closes the audio effect dialog with Escape', async ({ page }) => {
    await openControlsTab(page);

    await page.getByRole('button', { name: '音频效果器', exact: true }).click();
    // 面板上那一块也叫这个名字，所以按窗口的标题找。
    const equalizerTitle = page.getByRole('heading', { name: '音频效果器', exact: true });
    await expect(equalizerTitle).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(equalizerTitle).toBeHidden();
});

test('cycles the open panel tabs with Tab and wraps around', async ({ page }) => {
    await openControlsTab(page);

    const coverTab = page.getByRole('button', { name: '封面', exact: true });
    const controlsTab = page.getByRole('button', { name: '控制', exact: true });
    const queueTab = page.getByRole('button', { name: '播放列表', exact: true });
    const accountTab = page.getByRole('button', { name: '账户', exact: true });

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
