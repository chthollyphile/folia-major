import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNeteaseApi, openApp } from './helpers/appFixtures';
import { APP_VERSION, GUIDE_VERSION_STORAGE_KEY, waitForAppMounted } from '../helpers/appState';

// test/ui/playbackEntryStay.spec.ts
// 实测反馈 fb3 在真实应用里的接缝（组件探针只记账，到不了这一层：真实的 playSong → navigateToPlaybackView、history、
// 离开首页后 stage 卸载再挂载）：
// - bravais：从墙上播放 → 播放页 → 返回，那首歌的聚焦卡是展开的；正在播放的卡上「进入」按设置去 Lattice / 播放页
//   （留在原处时去播放页）；「留在原处」下立即播放不跳转、卡片保持展开、播放键变成暂停 / 继续。
// - 网格：「留在原处」下点卡片播放不跳转，那张卡的播放键变成暂停 / 继续。
// - 设置页「播放后进入的视图」的第三个选项与命令面板的对应命令。
// 数据是导入的本地曲库（一首「Test Artist - Midnight Train」）。假音频放不出声，播放状态停在非播放（卡片画「继续」）；
// 用例需要「在播」时直接写播放 store。

type EntryView = 'player' | 'lattice' | 'stay';

const rendererSwitch = (page: Page) => page.getByTestId('dev-library-renderer-switch');
const bravaisCollection = (page: Page) => page.locator('[data-library-surface="collection"][data-library-renderer="bravais"]');
const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const expanded = (page: Page) => page.locator('[data-bravais-expanded]');
const appView = (page: Page) => page.evaluate(async () => {
    const modulePath = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(/* @vite-ignore */ modulePath);
    return useAppViewStore.getState().view as string;
});
const currentSongName = (page: Page) => page.evaluate(async () => {
    const modulePath = '/src/stores/usePlaybackStore.ts';
    const { usePlaybackStore } = await import(/* @vite-ignore */ modulePath);
    return (usePlaybackStore.getState().currentSong?.name ?? null) as string | null;
});
const setPlaying = (page: Page) => page.evaluate(async () => {
    const storePath = '/src/stores/usePlaybackStore.ts';
    const typesPath = '/src/types.ts';
    const { usePlaybackStore } = await import(/* @vite-ignore */ storePath);
    const { PlayerState } = await import(/* @vite-ignore */ typesPath);
    usePlaybackStore.getState().setPlayerState(PlayerState.PLAYING);
});

/** 导入本地曲库、停在网格首页；「播放后进入的视图」按给定值预置（并当作已回答过首启提问）。 */
const openLocalLibrary = async (page: Page, entryView: EntryView) => {
    await installBaseState(page, { neteaseMode: 'guest', localImportFixture });
    await page.addInitScript(view => {
        localStorage.setItem('playback_entry_view', view);
        localStorage.setItem('playback_entry_view_chosen', 'true');
    }, entryView);
    await mockNeteaseApi(page, 'guest');
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
};

/** 打开「全部歌曲」，再用开发浮层把打开着的集合换到 bravais。 */
const openAllSongsInBravais = async (page: Page, entryView: EntryView) => {
    await openLocalLibrary(page, entryView);
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await rendererSwitch(page).locator('[data-renderer="bravais"]').click();
    await expect(bravaisCollection(page)).toHaveCount(1);
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
    await settled(page);
};

/** 点开一张屏幕中部的歌曲磁贴（没被缝盖住），返回它的条目 key。 */
const expandMiddleSong = async (page: Page) => {
    const slot = await page.evaluate(() => {
        const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
        const fits = (rect: DOMRect) => rect.left > 200 && rect.top > 120
            && rect.right < window.innerWidth - 200 && rect.bottom < window.innerHeight - 200
            && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
        return [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-entry]')]
            .find(element => fits(element.getBoundingClientRect()))?.dataset.bravaisSlot ?? null;
    });
    expect(slot).not.toBeNull();
    await page.locator(`[data-bravais-slot="${slot}"] article`).click();
    await expect(expanded(page)).toHaveCount(1);
    return (await expanded(page).getAttribute('data-library-entry'))!;
};

test('[bravais] a song played from the wall is expanded again after the player and back', async ({ page }) => {
    await openAllSongsInBravais(page, 'player');
    const entry = await expandMiddleSong(page);
    await expanded(page).locator('[data-bravais-action="play"]').click();
    await expect.poll(() => appView(page)).toBe('player');
    await expect.poll(() => currentSongName(page)).toBe('Midnight Train');
    // 离开首页约 350ms 后 stage 卸载。
    await expect(stage(page)).toHaveCount(0, { timeout: 10_000 });

    await page.goBack();
    await expect.poll(() => appView(page)).toBe('home');
    await expect(bravaisCollection(page)).toHaveCount(1);
    await settled(page);
    await expect(expanded(page)).toHaveCount(1, { timeout: 10_000 });
    await expect(expanded(page)).toHaveAttribute('data-library-entry', entry);
    await expect(expanded(page)).toHaveAttribute('data-bravais-current', 'true');
    // 正在播放的卡：播放键是暂停 / 继续，旁边有「进入」。
    await expect(expanded(page).locator('[data-bravais-action="play"]')).toHaveAttribute('data-bravais-playback', /^(playing|paused)$/);
    await expect(expanded(page).locator('[data-bravais-action="enter"]')).toHaveAccessibleName('Open the player');
});

test('[bravais] stay here starts the song without leaving the wall, and enter opens the player', async ({ page }) => {
    await openAllSongsInBravais(page, 'stay');
    await expandMiddleSong(page);
    const play = expanded(page).locator('[data-bravais-action="play"]');
    await expect(play).toHaveAccessibleName('Play now');
    await play.click();
    await expect.poll(() => currentSongName(page)).toBe('Midnight Train');
    await page.waitForTimeout(500);
    expect(await appView(page)).toBe('home');
    await expect(bravaisCollection(page)).toHaveCount(1);
    await expect(expanded(page)).toHaveCount(1);
    await expect(play).toHaveAttribute('data-bravais-playback', /^(playing|paused)$/);

    await setPlaying(page);
    await expect(play).toHaveAttribute('data-bravais-playback', 'playing');
    await expect(play).toHaveAccessibleName('Pause');

    const enter = expanded(page).locator('[data-bravais-action="enter"]');
    await expect(enter).toHaveAccessibleName('Open the player');
    await enter.click();
    await expect.poll(() => appView(page)).toBe('player');
});

test('[bravais] enter follows the setting to Lattice', async ({ page }) => {
    await openAllSongsInBravais(page, 'stay');
    await expandMiddleSong(page);
    await expanded(page).locator('[data-bravais-action="play"]').click();
    await expect.poll(() => currentSongName(page)).toBe('Midnight Train');
    await page.evaluate(async () => {
        const modulePath = '/src/stores/usePlaybackEntryViewStore.ts';
        const { usePlaybackEntryViewStore } = await import(/* @vite-ignore */ modulePath);
        usePlaybackEntryViewStore.getState().setPlaybackEntryView('lattice');
    });
    const enter = expanded(page).locator('[data-bravais-action="enter"]');
    await expect(enter).toHaveAccessibleName('Open Lattice');
    await enter.click();
    await expect.poll(() => appView(page)).toBe('lattice');
});

test('[grid] stay here plays a card in place and turns its play button into pause / resume', async ({ page }) => {
    await openLocalLibrary(page, 'stay');
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    const grid = page.locator('[data-library-renderer="grid"]');
    const hash = await page.evaluate(() => window.location.hash);

    await grid.locator('[data-grid-card-play="play"]').first().dispatchEvent('click');
    await expect.poll(() => currentSongName(page)).toBe('Midnight Train');
    await page.waitForTimeout(500);
    expect(await appView(page)).toBe('home');
    expect(await page.evaluate(() => window.location.hash)).toBe(hash);
    await expect(grid).toHaveCount(1);
    await expect(grid.locator('[data-grid-card-play="play"]')).toHaveCount(0);

    await setPlaying(page);
    const pause = grid.locator('[data-grid-card-play="playing"]').first();
    await expect(pause).toHaveAttribute('title', 'Pause');
    await expect(pause.locator('svg.lucide-pause')).toHaveCount(1);
});

test('[grid] the player setting still leaves the grid for the player', async ({ page }) => {
    await openLocalLibrary(page, 'player');
    await page.getByRole('heading', { name: 'All Songs' }).first().click();
    await expect(page.getByText('Midnight Train').first()).toBeVisible();
    await page.locator('[data-library-renderer="grid"] [data-grid-card-play="play"]').first().dispatchEvent('click');
    await expect.poll(() => appView(page)).toBe('player');
});

test('the settings section offers stay here, and the command palette switches to it', async ({ page }) => {
    await page.addInitScript(([version, guideKey]) => {
        localStorage.clear();
        localStorage.setItem('library_suite_prompt_seen', 'true');
        localStorage.setItem('folia_app_language', 'en');
        localStorage.setItem('static_mode', 'true');
        localStorage.setItem('playback_entry_view_chosen', 'true');
        localStorage.setItem(guideKey, version);
    }, [APP_VERSION, GUIDE_VERSION_STORAGE_KEY]);
    await page.route('**/__mock_netease__/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    await page.goto('/');
    await waitForAppMounted(page);
    await page.evaluate(async () => {
        const modulePath = '/src/stores/useSettingsModalStore.ts';
        const { useSettingsModalStore } = await import(/* @vite-ignore */ modulePath);
        useSettingsModalStore.getState().openSettings('options', 'general', null, 'playbackEntryView');
    });
    const choiceRow = page.locator('[data-settings-row="playbackEntryViewChoice"]');
    await expect(choiceRow.getByRole('button')).toHaveCount(3);
    const player = choiceRow.getByRole('button', { name: 'Visualizer' });
    await expect(player).toHaveAttribute('aria-pressed', 'true');
    const stay = choiceRow.getByRole('button', { name: 'Stay here' });
    await stay.click();
    await expect(stay).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('playback_entry_view'))).toBe('stay');
    await player.click();
    expect(await page.evaluate(() => localStorage.getItem('playback_entry_view'))).toBe('player');
    await page.keyboard.press('Escape');

    // 命令面板：「播放后：留在原处」可用（当前不是它），执行后写进设置；之后它不再出现在结果里。
    const palette = page.getByTestId('command-palette-panel');
    await expect.poll(async () => {
        await page.keyboard.press('ControlOrMeta+k');
        return palette.count();
    }).toBeGreaterThan(0);
    await palette.getByRole('combobox').fill('stay here');
    const row = palette.getByText('Play opens: Stay here', { exact: true }).first();
    await expect(row).toBeVisible();
    await row.click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('playback_entry_view'))).toBe('stay');
});
