import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisChrome.spec.ts
// 实测反馈 1 的组件用例（homeBehavior 探针 + setSuite('bravais')）：
// - Lattice 的墙面外观设置（灯光、叠色）作用到 bravais 根节点，三档透光下熄灯不涂黑窗；
// - 右下角共享工具按钮（components/wall/WallToolsButton）：点按打开面板、滑动打开命令面板、Esc 只收面板；面板分三组——
//   顶部一排纯图标快捷格（定位、队列洗牌、生成主题、队列、前往 Lattice、前往播放页：墙面工具宿主 wallToolsHost——探针里是
//   只记账的 probeWallToolsHost——与 onOpenLattice）、音量滑条（应用的音量 store）、墙面外观（透光、叠色、灯）；
// - 左上角隐藏式返回（WallBackButton concealed）：热区 / 键盘聚焦出现；首页根层有歌时回到播放页、没有歌时不画，
//   集合层上与缝里的 ‹ 同一个返回（先关面板再退层）；
// - 聚焦卡：立即播放是纯图标按钮，「已在队列」悬停 / 聚焦时显示「插入队列」。
// 探针左下角的 DEV 浮层可能盖住磁贴，点磁贴用 article 的 click（磁贴都在屏幕中部）。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const tools = (page: Page) => page.getByRole('button', { name: 'Wall tools', exact: true });
const panel = (page: Page) => page.getByRole('menu', { name: 'Wall tools', exact: true });
const quick = (page: Page, id: string) => panel(page).locator(`[data-wall-tools-quick="${id}"]`);
const volumeSlider = (page: Page) => panel(page).getByRole('slider', { name: 'Volume', exact: true });
const audio = (page: Page) => page.evaluate(() => window.__homeProbe!.volume());
const back = (page: Page) => page.locator('[data-library-stage="bravais"] .lattice-back');
const opacityOf = (page: Page, selector: string) => page.locator(selector).first().evaluate(node => Number(getComputedStyle(node).opacity));

/** 在 fixtures 的种子脚本之后再写几项存储（store 在模块 import 时读，必须在页面脚本之前落地）。 */
const seedStorage = (page: Page, entries: [string, string][]) => page.addInitScript(pairs => {
    for (const [key, value] of pairs) localStorage.setItem(key, value);
}, entries);

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

/** 一张此刻完整在视口中部、没被缝盖住的磁贴（slot key）。 */
const middleTile = (page: Page, attribute: 'data-library-card' | 'data-library-entry') => page.evaluate(name => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const fits = (rect: DOMRect) => rect.left > 200 && rect.top > 120
        && rect.right < window.innerWidth - 200 && rect.bottom < window.innerHeight - 200
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = [...document.querySelectorAll<HTMLElement>(`.bravais-tile[${name}]`)]
        .find(element => fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, attribute);

const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);

/** 点开一张首页卡片，等集合层接管墙面、翻牌放完。 */
const openCard = async (page: Page) => {
    const slot = await middleTile(page, 'data-library-card');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    await expect.poll(() => stack(page)).toHaveLength(1);
    await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0, { timeout: 10_000 });
    await settled(page);
};

/** 在集合层点开一首歌的聚焦卡，返回卡片与它的播放键。 */
const expandSong = async (page: Page) => {
    const slot = await middleTile(page, 'data-library-entry');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    const card = page.locator('[data-bravais-expanded]');
    await expect(card).toHaveCount(1);
    const entry = (await card.getAttribute('data-library-entry'))!;
    return { card, playbackKey: entry.replace(/-\d+$/, '') };
};

test.describe('[bravais-only] wall chrome and shared appearance settings', () => {
    test('lights and poster tint from the Lattice settings land on the bravais root', async ({ mount, page }) => {
        await seedStorage(page, [
            ['library_wall_look', 'solid'],
            ['lattice_poster_tint_use_custom_color', 'true'],
            ['lattice_poster_tint_color', '#33aa66'],
            ['lattice_poster_tint_intensity', '0.3'],
        ]);
        await mountBravais(mount, page);
        const root = stage(page);
        await expect(root).toHaveClass(/\bhas-poster-tint\b/);
        await expect(root).toHaveClass(/\buses-custom-poster-tint\b/);
        await expect(root).not.toHaveClass(/\bis-lights-out\b/);
        expect(await root.evaluate(node => (node as HTMLElement).style.getPropertyValue('--lattice-poster-tint-color'))).toBe('#33aa66');
        expect(await root.evaluate(node => (node as HTMLElement).style.getPropertyValue('--lattice-poster-tint-intensity'))).toBe('0.3');
        // 叠色画在普通磁贴上（自定义颜色、强度 0.3）；熄灯层此刻不显示。
        await page.mouse.move(2, 600);
        const plainTile = '.bravais-tile:not(:hover) > .lattice-poster.bravais-tile-face:not(.is-current):not(.is-focused):not(.is-wall):not(.is-window)';
        expect(await page.locator(`${plainTile} .lattice-poster-tint`).first().evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(51, 170, 102)');
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-tint`)).toBeCloseTo(0.3, 2);
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-lights-out`)).toBe(0);

        // 面板里关灯、关叠色：写的是 Lattice 的同一个 store（同一份存储），根节点的 class 跟着变。
        await tools(page).click();
        await panel(page).getByRole('menuitemcheckbox', { name: 'Poster lighting', exact: true }).click();
        await expect(root).toHaveClass(/\bis-lights-out\b/);
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-lights-out`)).toBeCloseTo(0.82, 2);
        // 熄灯时叠色归零（与 Lattice 相同），不叠两层。
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-tint`)).toBe(0);
        await panel(page).getByRole('menuitemcheckbox', { name: 'Poster focus tint', exact: true }).click();
        await expect(root).not.toHaveClass(/\bhas-poster-tint\b/);
        expect(await page.evaluate(() => [localStorage.getItem('lattice_lights_on'), localStorage.getItem('lattice_poster_tint_enabled')]))
            .toEqual(['false', 'false']);
    });

    test('lights out never paints the windows: partial windows have no layer, clear tiles only dim their text', async ({ mount, page }) => {
        await seedStorage(page, [['lattice_lights_on', 'false'], ['library_wall_look', 'partial']]);
        await mountBravais(mount, page);
        await expect(stage(page)).toHaveClass(/\bis-lights-out\b/);
        await page.mouse.move(2, 600);
        // 部分透明：窗没有内容，也就没有熄灯层；内容磁贴照常熄灯。
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"]').first()).toBeAttached();
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"] .lattice-poster-lights-out')).toHaveCount(0);
        const plainTile = '.bravais-tile:not(:hover) > .lattice-poster.bravais-tile-face:not(.is-current):not(.is-focused):not(.is-wall):not(.is-window)';
        await expect.poll(() => opacityOf(page, `${plainTile} .lattice-poster-lights-out`)).toBeCloseTo(0.82, 2);

        // 全透明：内容磁贴本身是窗，熄灯层不显示，只压暗标题。
        await page.evaluate(() => window.__homeProbe!.runChrome('wall-look'));
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        await settled(page);
        const seeThrough = '.bravais-tile:not(:hover) > .lattice-poster.is-see-through:not(.is-current):not(.is-focused)';
        await expect(page.locator(seeThrough).first()).toBeAttached();
        await expect.poll(() => opacityOf(page, `${seeThrough} .lattice-poster-lights-out`)).toBe(0);
        await expect.poll(() => opacityOf(page, `${seeThrough} > .lattice-poster-copy`)).toBeCloseTo(0.28, 2);
    });

    test('the tools button opens its panel, the slide opens the command palette, Escape only closes the panel', async ({ mount, page }) => {
        await seedStorage(page, [['library_wall_look', 'partial']]);
        await mountBravais(mount, page);
        await tools(page).click();
        const menu = panel(page);
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Locate the playing song', exact: true })).toBeVisible();
        await expect(menu.getByRole('menuitemcheckbox', { name: 'Poster lighting', exact: true })).toBeChecked();
        await expect(menu.getByRole('menuitemcheckbox', { name: 'Poster focus tint', exact: true })).toBeChecked();

        // 透光：点一下换下一档，面板不收起，墙跟着换档。
        const look = menu.getByRole('menuitem', { name: /^Wall transparency/ });
        await expect(look).toContainText('Partly see-through');
        await look.click();
        await expect(menu).toBeVisible();
        await expect(look).toContainText('See-through');
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');

        // 帮助：每行一件事——左边一个说明、右边一个按键，内容是 bravais 实际的键位（bravaisHelp，单测核对键位规则）。
        await menu.getByRole('menuitem', { name: 'Operation guide', exact: true }).click();
        const help = menu.getByRole('note');
        await expect(help).toBeVisible();
        const rows = await help.locator('li').evaluateAll(items => items.map(item => ({
            children: [...item.children].map(child => child.tagName.toLowerCase()),
            label: item.querySelector(':scope > span')?.textContent ?? '',
            key: item.querySelector(':scope > kbd')?.textContent ?? '',
        })));
        expect(rows.map(row => row.children)).toEqual(Array.from({ length: 13 }, () => ['span', 'kbd']));
        expect(rows.map(row => [row.label, row.key])).toEqual([
            ['Type to filter this page', 'A–Z'],
            ['Search online platforms (home)', '/'],
            ['Move the focus (wall or info strip)', '↑ ↓ ← →'],
            ['Open a song card or a collection', 'Enter'],
            ['Play the song in the open card', 'Enter'],
            ['Add the focused song to the queue', 'Shift + Enter'],
            ['Step back one level', 'ESC'],
            ['Move between the wall and the info strip', 'Tab'],
            ['Switch the home tabs', 'F6'],
            ['Locate the playing song', ': + C'],
            ['Shuffle the play queue', ': + R'],
            ['Go to Lattice (queue collage)', 'Ctrl + B'],
            ['Open the command palette', 'Ctrl + K'],
        ]);

        // 在集合层上按 Esc：只收起面板，不退层。
        await page.keyboard.press('Escape');
        await expect(menu).toHaveCount(0);
        await openCard(page);
        await tools(page).click();
        await expect(panel(page)).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(panel(page)).toHaveCount(0);
        expect(await stack(page)).toHaveLength(1);

        // 向左滑：打开命令面板（根列表），不打开工具面板。
        const before = await page.evaluate(() => window.__homeProbe!.paletteRequest().seq);
        const box = (await tools(page).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 6; step++) await page.mouse.move(x - step * 9, y);
        await page.mouse.up();
        await expect.poll(() => page.evaluate(() => window.__homeProbe!.paletteRequest())).toEqual({ seq: before + 1, kind: 'root' });
        await expect(panel(page)).toHaveCount(0);
    });

    test('the tools panel groups one-shot actions on top, the volume below them and the wall appearance last', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await page.evaluate(() => window.__homeProbe!.setLattice(true));
        await tools(page).click();
        const menu = panel(page);
        await expect(menu).toBeVisible();

        // 顺序：快捷格一排（六格）→ 音量 → 「墙面外观」小标题 → 透光 → 叠色 → 灯与帮助。
        const order = await menu.evaluate(node => [...node.children].map(child => {
            if (child.classList.contains('lattice-tools-quick')) {
                return `quick:${[...child.querySelectorAll<HTMLElement>('[data-wall-tools-quick]')].map(button => button.dataset.wallToolsQuick).join(',')}`;
            }
            if (child.classList.contains('lattice-tools-slider')) return 'slider';
            if (child.classList.contains('lattice-tools-heading')) return 'heading';
            if (child.classList.contains('lattice-tools-help-section')) return 'lights+help';
            return child.textContent?.trim().split(/\s/)[0] ?? '';
        }));
        expect(order).toEqual([
            'quick:shuffle-queue,generate-theme,queue,open-lattice,open-player,open-settings',
            'slider',
            'heading',
            'Wall',
            'Poster',
            'lights+help',
        ]);
        await expect(menu.getByRole('separator', { name: 'Wall appearance', exact: true })).toBeAttached();
        // 快捷格是纯图标：可访问名是全名，格子里没有字，tooltip 带按键提示。
        await expect(quick(page, 'shuffle-queue')).toHaveAccessibleName('Shuffle the queue');
        await expect(quick(page, 'shuffle-queue')).toHaveText('');
        await expect(quick(page, 'shuffle-queue')).toHaveAttribute('title', /: \+ R/);
        await expect(quick(page, 'generate-theme')).toHaveAccessibleName('Generate a theme for this song');
        await expect(quick(page, 'open-lattice')).toHaveAccessibleName('Go to Lattice');
        await expect(quick(page, 'open-lattice')).toHaveAttribute('title', /Ctrl \+ B/);
        await expect(quick(page, 'queue')).toHaveAccessibleName('Play queue');
        await expect(quick(page, 'open-player')).toHaveAccessibleName('Open the player');
        await expect(quick(page, 'open-settings')).toHaveAccessibleName('Open settings');

        // 面板整个在屏内（不顶出顶部、不出右边）；窄屏同样放得下。
        const inside = async () => {
            const box = (await menu.boundingBox())!;
            const viewport = page.viewportSize()!;
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        };
        await inside();
        await page.setViewportSize({ width: 390, height: 760 });
        await expect(menu).toBeVisible();
        await inside();
    });

    test('without a playable song the theme and the shuffle are disabled with a reason; with one they reach the host and keep the panel open', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await tools(page).click();
        const menu = panel(page);
        // 探针的宿主缺省没给 onOpenLattice：没有那一格。
        await expect(quick(page, 'open-lattice')).toHaveCount(0);

        // 缺省（没有歌）：主题、洗牌与前往播放页都不可用，tooltip / aria-description 写原因；队列格在（开合队列浮岛，浮岛本身见 wallToolsIsland.spec）。
        await expect(quick(page, 'generate-theme')).toBeDisabled();
        await expect(quick(page, 'generate-theme')).toHaveAttribute('aria-description', 'Needs a playing song with lyrics (or pure music)');
        await expect(quick(page, 'generate-theme')).toHaveAttribute('title', /Needs a playing song/);
        await expect(quick(page, 'shuffle-queue')).toBeDisabled();
        await expect(quick(page, 'shuffle-queue')).toHaveAttribute('aria-description', /two or more songs/);
        await expect(quick(page, 'open-player')).toBeDisabled();
        await expect(quick(page, 'open-player')).toHaveAttribute('aria-description', 'Nothing is playing yet');
        await expect(quick(page, 'queue')).toBeEnabled();

        // 宿主说可以了：两格可用，点了交给宿主（命令面板的同一条命令），面板不收起。
        await page.evaluate(() => window.__homeProbe!.setWallToolsHost({ themeGeneration: 'ready', canShuffleQueue: true }));
        await expect(quick(page, 'generate-theme')).toBeEnabled();
        await expect(quick(page, 'generate-theme')).not.toHaveAttribute('aria-description', /.+/);
        await quick(page, 'shuffle-queue').click();
        await expect.poll(async () => (await calls(page, 'shuffleQueue')).length).toBe(1);
        await expect(menu).toBeVisible();
        await quick(page, 'generate-theme').click();
        await expect.poll(async () => (await calls(page, 'generateTheme')).length).toBe(1);
        await expect(menu).toBeVisible();

        // 生成中：禁用、aria-busy，状态进 tooltip 与 aria-description；生成完恢复。
        await page.evaluate(() => window.__homeProbe!.setWallToolsHost({ themeGeneration: 'busy' }));
        const theme = quick(page, 'generate-theme');
        await expect(theme).toBeDisabled();
        await expect(theme).toHaveAttribute('aria-busy', 'true');
        await expect(theme).toHaveClass(/\bis-busy\b/);
        await expect(theme).toHaveAttribute('title', /Generating a theme…/);
        await expect(theme).toHaveAttribute('aria-description', 'Generating a theme…');
        await page.evaluate(() => window.__homeProbe!.setWallToolsHost({ themeGeneration: 'ready' }));
        await expect(theme).toBeEnabled();
        await expect(theme).not.toHaveAttribute('aria-busy', /.*/);
        await expect(theme).toHaveAttribute('title', 'Generate a theme for this song');
        expect(await calls(page, 'generateTheme')).toHaveLength(1);
    });

    test('go to Lattice hands over to the host entry and closes the panel', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await page.evaluate(() => window.__homeProbe!.setLattice(true));
        await tools(page).click();
        await quick(page, 'open-lattice').click();
        await expect.poll(async () => (await calls(page, 'openLattice')).length).toBe(1);
        await expect(panel(page)).toHaveCount(0);
    });

    test('in Personal FM, Lattice and the queue cell are disabled with a reason', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await page.evaluate(() => window.__homeProbe!.setLattice(true));
        await page.evaluate(async () => {
            const path = '/src/stores/usePlaybackStore.ts';
            const { usePlaybackStore } = await import(/* @vite-ignore */ path);
            usePlaybackStore.setState({ isFmMode: true });
        });
        await tools(page).click();
        await expect(quick(page, 'open-lattice')).toBeDisabled();
        await expect(quick(page, 'open-lattice')).toHaveAttribute('aria-description', 'Lattice does not support Personal FM mode');
        await expect(quick(page, 'queue')).toBeDisabled();
        await expect(quick(page, 'queue')).toHaveAttribute('aria-description', 'Personal FM has no queue to edit');
    });

    test('open the player goes through the host and closes the panel', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await page.evaluate(() => window.__homeProbe!.setNowPlaying('online:probe:loaded'));
        await tools(page).click();
        await quick(page, 'open-player').click();
        await expect.poll(async () => (await calls(page, 'openPlayer')).length).toBe(1);
        await expect(panel(page)).toHaveCount(0);
    });

    test('the last quick cell opens settings through the host and closes the panel', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await tools(page).click();
        await quick(page, 'open-settings').click();
        await expect.poll(async () => (await calls(page, 'openSettings')).length).toBe(1);
        await expect(panel(page)).toHaveCount(0);
    });

    test('the volume slider reads and writes the app volume: keys step it, a drag previews then commits, the icon mutes', async ({ mount, page }) => {
        await seedStorage(page, [['player_volume', '0.4'], ['player_is_muted', 'false']]);
        await mountBravais(mount, page);
        await tools(page).click();
        const slider = volumeSlider(page);
        await expect(slider).toHaveValue('0.4');
        await expect(slider).toHaveAttribute('aria-valuetext', '40%');
        await expect(panel(page).locator('.lattice-tools-slider-value')).toHaveText('40%');

        // 键盘：方向键一步 5%，PageUp 10%，Home / End 到头；每一下都直接写进同一个音量 store（与播放条、播放页面板同一份）。
        await slider.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => audio(page)).toEqual({ volume: 0.45, isMuted: false });
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('ArrowLeft');
        await expect.poll(async () => (await audio(page)).volume).toBe(0.35);
        await page.keyboard.press('PageUp');
        await expect.poll(async () => (await audio(page)).volume).toBe(0.45);
        await page.keyboard.press('End');
        await expect.poll(async () => (await audio(page)).volume).toBe(1);
        await expect(slider).toHaveAttribute('aria-valuetext', '100%');
        await page.keyboard.press('Home');
        await expect.poll(async () => (await audio(page)).volume).toBe(0);
        expect(await page.evaluate(() => localStorage.getItem('player_volume'))).toBe('0');
        // 墙没有把这些方向键当成移动焦点（焦点还在滑条上，墙上没有键盘聚焦环）。
        await expect(slider).toBeFocused();
        await expect(page.locator('.lattice-poster.is-focused')).toHaveCount(0);

        // 拖动：途中只经宿主预览（不写 store），松手才写。
        await page.evaluate(() => window.__homeProbe!.clearLog());
        const box = (await slider.boundingBox())!;
        const y = box.y + box.height / 2;
        await page.mouse.move(box.x + box.width * 0.2, y);
        await page.mouse.down();
        for (let step = 1; step <= 6; step++) await page.mouse.move(box.x + box.width * (0.2 + step * 0.09), y);
        expect((await audio(page)).volume).toBe(0);
        expect((await calls(page, 'previewVolume')).length).toBeGreaterThan(0);
        await page.mouse.up();
        await expect.poll(async () => (await audio(page)).volume).toBeGreaterThan(0.6);
        const dragged = (await audio(page)).volume;
        expect(dragged).toBeLessThan(0.85);
        await expect(slider).toHaveAttribute('aria-valuetext', `${Math.round(dragged * 100)}%`);

        // 左侧图标：静音切换（同一个 isMuted）；静音时滑条显示 0、读作「Muted」，再拖 / 按键就先解除静音。
        await panel(page).getByRole('button', { name: 'Mute', exact: true }).click();
        await expect.poll(() => audio(page)).toEqual({ volume: dragged, isMuted: true });
        await expect(panel(page).getByRole('button', { name: 'Unmute', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(slider).toHaveValue('0');
        await expect(slider).toHaveAttribute('aria-valuetext', 'Muted');
        await slider.focus();
        await page.keyboard.press('ArrowUp');
        await expect.poll(() => audio(page)).toEqual({ volume: 0.05, isMuted: false });
        await expect(panel(page).getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute('aria-pressed', 'false');
    });

    test('the hidden back button shows in the top-left corner or on keyboard focus; at the home root it returns to the player only with a song', async ({ mount, page }) => {
        await mountBravais(mount, page);
        const button = back(page);
        // 首页根层、没有正在播放 / 已加载的歌：不画（播放页是空的，不能把人送过去）。
        await expect(button).toHaveCount(0);

        // 有歌：回到播放页。
        await page.evaluate(() => window.__homeProbe!.setNowPlaying('online:probe:loaded', false));
        await expect(button).toHaveAccessibleName('Back to the player');
        await expect(button).toHaveAttribute('title', 'Back to the player');
        await page.mouse.move(700, 500);
        await expect.poll(() => button.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(0);
        await expect(button).not.toHaveClass(/\bis-revealed\b/);

        // 鼠标进左上角热区：出现，点了回到播放页。
        await page.mouse.move(60, 60);
        await expect(button).toHaveClass(/\bis-revealed\b/);
        await expect.poll(() => button.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        await button.click();
        await expect.poll(async () => (await calls(page, 'backToPlayer')).length).toBe(1);

        // 离开热区就藏起来；键盘聚焦时出现（可聚焦）。
        await page.mouse.move(700, 500);
        await expect(button).not.toHaveClass(/\bis-revealed\b/);
        await page.keyboard.press('Shift');
        await button.focus();
        await expect(button).toBeFocused();
        await expect.poll(() => button.evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await calls(page, 'backToPlayer')).length).toBe(2);

        // 歌没了：首页根层上又不画了。
        await page.evaluate(() => window.__homeProbe!.setNowPlaying(null));
        await expect(button).toHaveCount(0);
    });

    test('off the home root the hidden back button is the info strip back: panel first, then the layer', async ({ mount, page }) => {
        await mountBravais(mount, page);
        // 集合层上有没有歌都在，语义与缝里的 ‹ 相同（返回），不是回到播放页。
        await openCard(page);
        const button = back(page);
        await expect(button).toHaveAccessibleName('Back');
        await expect(button).toHaveAttribute('title', 'Back');

        // 列表面板开着：先关面板（与 ‹、Esc 一致），不退层。
        await page.locator('[data-bravais-seam-action="list"]').click();
        await expect(stage(page).locator('[data-bravais-seam="panel"]')).toBeAttached();
        await settled(page);
        await page.mouse.move(700, 500);
        await page.mouse.move(60, 60);
        await expect(button).toHaveClass(/\bis-revealed\b/);
        await expect(button).toHaveAccessibleName('Back');
        await button.click();
        await expect(stage(page).locator('[data-bravais-seam="full"]')).toBeAttached();
        expect(await stack(page)).toHaveLength(1);

        // 再点：退回首页（缝里 ‹ 的同一个 onDone），墙翻回首页层。
        await settled(page);
        await button.click();
        await expect.poll(() => stack(page)).toHaveLength(0);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 10_000 });
        expect(await calls(page, 'backToPlayer')).toHaveLength(0);
        // 回到首页根层、没有歌：按钮不画。
        await expect(button).toHaveCount(0);
    });

    test('the focus card plays from an icon-only button and offers insert-into-queue on a queued song', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openCard(page);
        const { card, playbackKey } = await expandSong(page);

        const play = card.locator('[data-bravais-action="play"]');
        await expect(play).toHaveAccessibleName('Play now');
        await expect(play).toHaveAttribute('title', 'Play now');
        expect((await play.innerText()).trim()).toBe('');

        const enqueue = card.locator('[data-bravais-action="enqueue"]');
        await expect(enqueue).toHaveAccessibleName('Add to queue');

        // 已在队列：静止时「已在队列」，悬停 / 键盘聚焦时「插入队列」，点了仍交给入队（应用按入队规则挪位置）。
        await page.evaluate(key => window.__homeProbe!.setPlayQueue([key]), playbackKey);
        await expect(enqueue).toHaveAttribute('data-bravais-queued', 'true');
        await page.mouse.move(2, 600);
        await expect(enqueue).toHaveAccessibleName('In queue');
        await expect(enqueue.locator('.bravais-enqueue-hover')).toBeHidden();

        await enqueue.hover();
        await expect(enqueue.locator('.bravais-enqueue-hover')).toBeVisible();
        await expect(enqueue.locator('.bravais-enqueue-rest')).toBeHidden();
        await expect(enqueue).toHaveAccessibleName('Insert into queue');

        await page.mouse.move(2, 600);
        await expect(enqueue.locator('.bravais-enqueue-rest')).toBeVisible();
        await page.keyboard.press('Shift');
        await enqueue.focus();
        await expect(enqueue.locator('.bravais-enqueue-hover')).toBeVisible();

        await page.evaluate(() => window.__homeProbe!.clearLog());
        await enqueue.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'addSongToQueue')).map(call => call.ids[0])).toEqual([playbackKey]);
    });
});
