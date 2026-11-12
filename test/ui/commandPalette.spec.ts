import { expect, test } from '@playwright/test';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/commandPalette.spec.ts
// 覆盖命令面板的三类入口：默认匹配列表、surface 接管（音量 / 队列 / 模式选择器），
// 以及执行模式的单键立即执行。这些路径在重构后不再有按 id 硬编码的分支，需要真实浏览器验证。

// How long the songs say they are and how long the audio mockQueueAudio caches for them is: the same.
// Playback drops a cached copy shorter than half its song as a preview clip (src/services/wholeSongCheck.ts)
// and asks the platform instead, which the mocked NetEase answers with no URL, so the song never changes.
const MOCK_SONG_SECONDS = 60;

const QUEUE_FIXTURE = [
    { id: 1, name: 'Current', artists: [{ id: 10, name: 'Alpha' }], album: { id: 20, name: 'Shared Album' }, durationMs: MOCK_SONG_SECONDS * 1000 },
    { id: 2, name: 'Same Artist', artists: [{ id: 10, name: 'Alpha' }], album: { id: 21, name: 'Other Album' }, durationMs: MOCK_SONG_SECONDS * 1000 },
    { id: 3, name: 'Same Album', artists: [{ id: 11, name: 'Beta' }], album: { id: 20, name: 'Shared Album' }, durationMs: MOCK_SONG_SECONDS * 1000 },
    { id: 4, name: 'Other', artists: [{ id: 12, name: 'Gamma' }], album: { id: 22, name: 'Third Album' }, durationMs: MOCK_SONG_SECONDS * 1000 },
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
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'zh-CN');
        localStorage.setItem('open_player_on_launch', String(onLaunch));
        localStorage.setItem('visualizer_mode', 'classic');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem('auto_use_best_lyric', 'false');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY, openPlayerOnLaunch] as const);
    await page.route('**/__mock_netease__/**', async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
};

const openPlayerPage = async (page: import('@playwright/test').Page) => {
    await seedApp(page, true);

    await page.goto('/');
    await waitForAppMounted(page);
    // 种数据要等模块图和 IndexedDB 都就绪。定长 sleep 只是在赌，改成重试到真的写进去为止。
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
    await waitForAppMounted(page);
    // 重载后不再定长等待：下面每个入口要么轮询按键，要么轮询 store，自己会等。
};

const palette = (page: import('@playwright/test').Page) => page.getByTestId('command-palette-panel');
const paletteInput = (page: import('@playwright/test').Page) => palette(page).getByRole('combobox');

// 首页没有可播放的曲目，也不需要——这几条只关心面板本身在首页能不能开、开出什么。
const openHomePage = async (page: import('@playwright/test').Page) => {
    await seedApp(page, false);
    await page.goto('/');
    await waitForAppMounted(page);
    // 不定长等待：紧接着的 pressUntilPaletteOpens 会一直敲到面板真的响应为止。
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

/**
 * 输入查询并等匹配列表真的跟上。
 *
 * 匹配走 120ms 防抖，之后还要重排；「等 400ms」只是在赌这段够用，机器一忙就不够——本文件
 * 那几条偶发失败（surface 没打开、picker 一行都没有）全是这么来的：回车打在了旧列表上。
 * 改成等某一行真的出现，Playwright 的断言自己会重试。
 */
const typeUntilRow = async (page: import('@playwright/test').Page, query: string, rowTitle: string) => {
    await paletteInput(page).fill(query);
    const row = palette(page).getByText(rowTitle, { exact: true }).first();
    await expect(row).toBeVisible();
    return row;
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

    // 先拿落地列表当锚：队列在首页可用，所以打字前它一定在。
    await expect(palette(page).getByText('队列', { exact: true }).first()).toBeVisible();
    await paletteInput(page).fill('panel cover');
    // 它消失了，才说明排序确实按新查询跑过一遍——否则下面那条断言只是在对着旧列表空转。
    await expect(palette(page).getByText('队列', { exact: true })).toHaveCount(0);

    // 面板长在播放页上；首页没有可开的东西，所以这条命令连匹配都不该产生。
    await expect(palette(page).getByText('面板：封面', { exact: true })).toHaveCount(0);
});

test('still offers the player-surface commands on the player', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');
    await paletteInput(page).fill('panel cover');

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
    await (await typeUntilRow(page, 'volume', '音量条')).click();

    // Surface 接管后输入框变成数字输入，面板主体是滑块而不是匹配列表。
    await expect(paletteInput(page)).toHaveAttribute('type', 'number');
    await expect(palette(page).locator('input[type="range"]')).toBeVisible();
});

test('queue command parses the batch syntax and stages a preview', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 'Control+P');

    await paletteInput(page).fill('--rm @artist:Alpha');
    await expect(palette(page).getByText('移除匹配歌曲')).toBeVisible();

    // Escape 先摘掉批量动作，再摘掉筛选，最后才关闭面板。
    await page.keyboard.press('Escape');
    await expect(paletteInput(page)).toHaveValue('@artist:Alpha');
    await expect(palette(page)).toBeVisible();
});

/** Seed playable audio and lyrics so queue tests exercise playback without a configured provider. */
const mockQueueAudio = async (page: import('@playwright/test').Page) => {
    const samples = 8_000 * MOCK_SONG_SECONDS;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8_000, 24);
    wav.writeUInt32LE(16_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(samples * 2, 40);

    await page.evaluate(async ({ header, length }) => {
        const audioModule = '/src/services/audioCache.ts';
        const dbModule = '/src/services/db.ts';
        const keyModule = '/src/services/onlineMusic/resourceKeys.ts';
        const [{ saveAudioBlob }, { saveToCache }, { getSongResourceCacheKey }] = await Promise.all([
            import(audioModule), import(dbModule), import(keyModule),
        ]);
        const bytes = new Uint8Array(length);
        bytes.set(header);
        const blob = new Blob([bytes], { type: 'audio/wav' });
        await Promise.all(Array.from({ length: 20 }, async (_, index) => {
            const song = { id: index + 1 };
            await saveAudioBlob(getSongResourceCacheKey('audio', song), blob);
            await saveToCache(getSongResourceCacheKey('lyric', song), { lines: [] });
        }));
    }, { header: Array.from(wav.subarray(0, 44)), length: wav.length });
};

test('queue song selection closes the palette by default', async ({ page }) => {
    await openPlayerPage(page);
    await mockQueueAudio(page);
    await pressUntilPaletteOpens(page, 'Control+P');

    await expect(palette(page).getByRole('checkbox', { name: '切歌后保持打开' })).not.toBeChecked();
    await palette(page).getByRole('button').filter({ hasText: 'Same Artist' }).click();
    await expect.poll(async () => (await readStore(page, 'currentSong') as { id: number })?.id).toBe(2);
    await expect(palette(page)).toBeHidden();
});

test('queue keep-open preserves filtering for mouse and keyboard song changes', async ({ page }) => {
    await openPlayerPage(page);
    await mockQueueAudio(page);
    await pressUntilPaletteOpens(page, 'Control+P');
    const keepOpen = () => palette(page).getByRole('checkbox', { name: '切歌后保持打开' });

    await keepOpen().check();
    await expect(paletteInput(page)).toBeFocused();
    await palette(page).screenshot({ path: test.info().outputPath('queue-keep-open.png'), animations: 'disabled' });
    await paletteInput(page).fill('Same');
    await expect(palette(page).locator('button[data-active]')).toHaveCount(2);
    await palette(page).getByRole('button').filter({ hasText: 'Same Artist' }).click();
    await expect.poll(async () => (await readStore(page, 'currentSong') as { id: number })?.id).toBe(2);
    await expect(palette(page)).toBeVisible();
    await expect(paletteInput(page)).toHaveValue('Same');
    await expect(paletteInput(page)).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await readStore(page, 'currentSong') as { id: number })?.id).toBe(3);
    await expect(paletteInput(page)).toHaveValue('Same');
    await expect(palette(page).locator('button[data-active="true"]')).toContainText('Same Album');

    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();
    await pressUntilPaletteOpens(page, 'Control+P');
    await expect(keepOpen()).toBeChecked();
    expect(await page.evaluate(() => localStorage.getItem('queue_palette_keep_open'))).toBe('true');

    await keepOpen().uncheck();
    await paletteInput(page).fill('Other');
    await expect(palette(page).locator('button[data-active]').first()).toContainText('#4');
    await expect(palette(page).locator('[class~="group/queue-row"][class~="bg-white/10"]')).toContainText('#4');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await readStore(page, 'currentSong') as { id: number })?.id).toBe(4);
    await expect(palette(page)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('queue_palette_keep_open'))).toBe('false');
});

test('queue smoothly centers the playing song after Enter', async ({ page }) => {
    await openPlayerPage(page);
    await mockQueueAudio(page);
    await page.evaluate(async () => {
        const modulePath = '/src/stores/usePlaybackStore.ts';
        const { usePlaybackStore } = await import(modulePath);
        const queue = Array.from({ length: 20 }, (_, index) => ({
            id: index + 1,
            name: `Queue Track ${index + 1}`,
            artists: [{ id: 1, name: 'Artist' }],
            album: { id: 1, name: 'Album' },
            durationMs: 60_000,
        }));
        usePlaybackStore.setState({ currentSong: queue[0], playQueue: queue });
    });
    await pressUntilPaletteOpens(page, 'Control+P');
    await palette(page).getByRole('checkbox', { name: '切歌后保持打开' }).check();
    for (let index = 0; index < 5; index += 1) {
        await page.keyboard.press('ArrowDown');
    }
    await expect(palette(page).locator('[class~="group/queue-row"][class~="bg-white/10"]')).toContainText('#6');

    const scroller = palette(page).locator('.custom-scrollbar').first();
    expect(await scroller.evaluate(node => node.scrollTop)).toBe(0);
    // Native scroll events must include intermediate positions, not just the final centered offset.
    await scroller.evaluate(node => {
        const element = node as HTMLElement;
        const positions: number[] = [];
        element.addEventListener('scroll', () => {
            positions.push(element.scrollTop);
            element.dataset.scrollPositions = JSON.stringify(positions);
        });
        element.addEventListener('scrollend', () => {
            element.dataset.scrollComplete = 'true';
        }, { once: true });
    });
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await readStore(page, 'currentSong') as { id: number })?.id).toBe(6);
    await expect(scroller).toHaveAttribute('data-scroll-complete', 'true');
    const { finalTop, positions } = await scroller.evaluate(node => ({
        finalTop: node.scrollTop,
        positions: JSON.parse((node as HTMLElement).dataset.scrollPositions || '[]') as number[],
    }));
    expect(finalTop).toBeGreaterThan(0);
    expect(positions.some(top => top > 0 && top < finalTop)).toBe(true);
    const viewport = (await scroller.boundingBox())!;
    const playingRow = (await palette(page).locator('button[data-active="true"]').boundingBox())!;
    expect(Math.abs(playingRow.y + playingRow.height / 2 - viewport.y - viewport.height / 2)).toBeLessThan(60);
    await expect(palette(page)).toBeVisible();
});

/**
 * 执行模式的入口是单键 ':'，进去之后每个字符都会被当成命令键，所以不能像 s 那样反复敲到开为止。
 * 先用 s 探一次全局监听是否已装好（开了就关掉，无副作用），再精确敲一次 ':'。
 */
const openExecuteMode = async (page: import('@playwright/test').Page) => {
    await pressUntilPaletteOpens(page, 's');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toBeHidden();

    await page.keyboard.press(':');
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByText('执行模式')).toBeVisible();
};

/** 打开可视化选择器：等命令行出现再回车，再等 surface 的行画出来。 */
const openVisualizerPicker = async (page: import('@playwright/test').Page) => {
    await typeUntilRow(page, '选择可视化', '选择可视化');
    await page.keyboard.press('Enter');
    await expect(palette(page).locator('[data-picker-mode]').first()).toBeVisible();
};

test('visualizer picker switches the mode from the list', async ({ page }) => {
    await openPlayerPage(page);
    await expect.poll(() => readStore(page, 'visualizerMode')).toBe('classic');

    await pressUntilPaletteOpens(page, 's');
    await openVisualizerPicker(page);

    await paletteInput(page).fill('云阶');
    const target = palette(page).getByRole('button').filter({ hasText: '云阶' }).first();
    await expect(target).toBeVisible();
    await target.click();

    // 切换是异步落到 store 的，轮询而不是睡一觉再读。
    await expect.poll(() => readStore(page, 'visualizerMode')).toBe('partita');
    await expect(palette(page)).toBeHidden();
});

test('visualizer picker walks the mode list and marks the live mode', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');
    await openVisualizerPicker(page);

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
    await expect.poll(() => readStore(page, 'visualizerMode')).toBe(modes[targetIndex]);
});

test('typing -- documents a command\'s flags, for any command that declares them', async ({ page }) => {
    await openPlayerPage(page);
    await pressUntilPaletteOpens(page, 's');

    // The sleep timer, deliberately: it has always had flags and never had a way to discover them —
    // it only rejected an unknown one with an error. Nothing about it is segmentation-specific.
    // Click rather than Enter: Enter runs whatever sits at activeIndex, which is not necessarily
    // the row just asserted to exist.
    await paletteInput(page).fill('睡眠定时');
    const sleepRow = palette(page).getByRole('button').filter({ hasText: '睡眠定时' }).first();
    await expect(sleepRow).toBeVisible();
    await sleepRow.click();
    await paletteInput(page).fill('--');

    const hints = palette(page).getByTestId('command-palette-syntax-hints');
    await expect(hints).toBeVisible();
    await expect(hints.locator('[data-syntax-flag]')).toHaveCount(2);
    await expect(hints.getByText('--on', { exact: true })).toBeVisible();
    await expect(hints.getByText('开启睡眠定时器')).toBeVisible();
    // Aliases are listed too, so `--enable` is discoverable without guessing.
    await expect(hints.getByText('--enable', { exact: true })).toBeVisible();

    // Narrowing the draft narrows the list.
    await paletteInput(page).fill('--of');
    await expect(hints.locator('[data-syntax-flag]')).toHaveCount(1);

    // Enter completes the highlighted flag rather than running a half-typed command.
    await page.keyboard.press('Enter');
    await expect(paletteInput(page)).toHaveValue('--off');
    await expect(hints).toBeHidden();
});

test('execute mode runs a command from a single key', async ({ page }) => {
    await openPlayerPage(page);
    await openExecuteMode(page);

    // d 是明暗切换；敲下去应立即执行并关闭面板，不需要回车。
    const before = await readStore(page, 'isDaylight');
    await paletteInput(page).pressSequentially('d');

    await expect.poll(() => readStore(page, 'isDaylight')).not.toBe(before);
    await expect(palette(page)).toBeHidden();
});

test('execute mode reports an unknown key instead of guessing', async ({ page }) => {
    await openPlayerPage(page);
    await openExecuteMode(page);
    await paletteInput(page).pressSequentially('z');

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
    await typeUntilRow(page, '私人 FM 模式', '私人 FM 模式');
    await page.keyboard.press('Enter');
    // Surface 是 React.lazy，dev 下要现拉 chunk。等它的第一行真的画出来，别赌一个时长。
    await expect(palette(page).locator('[data-fm-option]').first()).toBeVisible();
};

test('fm mode picker selects scene mode straight from a scene pill', async ({ page }) => {
    await openPlayerPage(page);
    expect(await readPersonalFmSelection(page)).toEqual({ mode: 'DEFAULT', scene: null });

    await openFmModeSurface(page);
    // 模式行 5 个 + 场景 42 个，全部是同一种 pill。
    await expect(palette(page).locator('[data-fm-option]')).toHaveCount(47);
    await expect(palette(page).locator('[data-fm-option="fm-mode-pick-DEFAULT"][data-fm-selected="true"]')).toBeVisible();

    await palette(page).locator('[data-fm-option="fm-scene-pick-SLEEP_HELP"]').click();

    await expect.poll(() => readPersonalFmSelection(page)).toEqual({ mode: 'SCENE_RCMD', scene: 'SLEEP_HELP' });
});

test('fm mode picker filters to one section and walks it with arrows', async ({ page }) => {
    await openPlayerPage(page);
    await openFmModeSurface(page);

    // 筛选后剩下的必须比全量少，也必须不为空——两头都钉住，才说明筛选真的生效过。
    await paletteInput(page).fill('语');
    const filtered = palette(page).locator('[data-fm-option]');
    await expect.poll(() => filtered.count()).toBeGreaterThan(0);
    await expect.poll(() => filtered.count()).toBeLessThan(47);

    await paletteInput(page).fill('');
    await expect(palette(page).locator('[data-fm-option]')).toHaveCount(47);

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
