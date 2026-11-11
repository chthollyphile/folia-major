import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { ProbeCallKind } from '../../dev/probes/libraryBehavior/probeLog';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisPlayingCard.spec.ts
// 实测反馈 fb3 的组件用例（homeBehavior 探针；播放、暂停 / 继续、进入播放视图都只记账，正在播放的那首由
// __homeProbe.setNowPlaying 模拟应用的播放器）：
// - bravais：正在播放的聚焦卡上播放键变成暂停 / 继续（交给宿主的播放开关，不再立即播放），多一个按设置去 Lattice /
//   播放页的「进入」按钮（留在原处时去播放页）；从墙上播放之后 stage 重新挂载（离开首页再回来），那首歌的聚焦卡是展开的，
//   用户自己收起之后不再保持。
// - 网格：「留在原处」时正在播放的那首的卡片播放键变成暂停 / 继续，点了切换播放状态而不是重新播放；另外两个值下不变。
// 探针左下角的 DEV 浮层可能盖住磁贴，点磁贴用 article 的 click（磁贴都在屏幕中部）。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
const calls = (page: Page, kind: ProbeCallKind) => (
    page.evaluate(callKind => window.__homeProbe!.calls().filter(call => call.kind === callKind), kind)
);
const clearLog = (page: Page) => page.evaluate(() => window.__homeProbe!.clearLog());
const stack = (page: Page) => page.evaluate(() => window.__homeProbe!.stack());
const setNowPlaying = (page: Page, key: string | null, playing = true) => (
    page.evaluate(([value, isPlaying]) => window.__homeProbe!.setNowPlaying(value as string | null, isPlaying as boolean), [key, playing] as const)
);
const setEntryView = (page: Page, view: 'player' | 'lattice' | 'stay') => page.evaluate(value => window.__homeProbe!.setEntryView(value), view);

const mountHome = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({ contentType: 'text/javascript', body: buildServiceStubModule() }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
};

const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page) => {
    await mountHome(mount, page);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
    await settled(page);
};

/**
 * 一张此刻在视口中部、没被缝盖住的磁贴（slot key）。集合页整层倾斜着：磁贴与缝的外接框都是转过的（缝还带上下的出血），
 * 所以按磁贴的中心点找——中心在视口中部、最上层就是它自己。
 */
const middleTile = (page: Page, attribute: 'data-library-card' | 'data-library-entry') => page.evaluate(name => {
    const tile = [...document.querySelectorAll<HTMLElement>(`.bravais-tile[${name}]`)].find((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 320 || y < 240 || x > window.innerWidth - 320 || y > window.innerHeight - 320) return false;
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && element.contains(hit));
    });
    return tile?.dataset.bravaisSlot ?? null;
}, attribute);

const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);

const openCard = async (page: Page) => {
    const slot = await middleTile(page, 'data-library-card');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    await expect.poll(() => stack(page)).toHaveLength(1);
    await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0, { timeout: 10_000 });
    await settled(page);
};

/** 点开一首歌的聚焦卡，返回卡片、条目 key 与播放键。 */
const expandSong = async (page: Page) => {
    const slot = await middleTile(page, 'data-library-entry');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    const card = page.locator('[data-bravais-expanded]');
    await expect(card).toHaveCount(1);
    const entry = (await card.getAttribute('data-library-entry'))!;
    return { card, entry, playbackKey: entry.replace(/-\d+$/, '') };
};

/** 聚焦卡整张在视口里（相机做过最小平移）。 */
const isInViewport = (page: Page) => page.locator('[data-bravais-expanded]').evaluate(node => {
    const rect = node.getBoundingClientRect();
    return rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1;
});

test.describe('[bravais-only] the playing song on the wall', () => {
    test('the playing focus card pauses and resumes in place and enters the view the setting names', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openCard(page);
        const { card, playbackKey } = await expandSong(page);
        const play = card.locator('[data-bravais-action="play"]');
        const enter = card.locator('[data-bravais-action="enter"]');

        // 不是正在播放的那首：立即播放，没有「进入」。
        await expect(play).toHaveAccessibleName('Play now');
        await expect(play).not.toHaveAttribute('data-bravais-playback', /.*/);
        await expect(enter).toHaveCount(0);

        // 正在播放：暂停（纯图标、可访问名与 title 同步），点了交给播放开关，不再立即播放。
        await setNowPlaying(page, playbackKey, true);
        await expect(card).toHaveAttribute('data-bravais-current', 'true');
        await expect(play).toHaveAttribute('data-bravais-playback', 'playing');
        await expect(play).toHaveAccessibleName('Pause');
        await expect(play).toHaveAttribute('title', 'Pause');
        expect((await play.innerText()).trim()).toBe('');
        await clearLog(page);
        await play.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'togglePlayback')).length).toBe(1);
        expect(await calls(page, 'playSong')).toHaveLength(0);

        // 暂停中：继续。
        await setNowPlaying(page, playbackKey, false);
        await expect(play).toHaveAttribute('data-bravais-playback', 'paused');
        await expect(play).toHaveAccessibleName('Resume');
        await play.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'togglePlayback')).length).toBe(2);
        expect(await calls(page, 'playSong')).toHaveLength(0);

        // 「进入」：同一族的纯图标按钮，名字跟着设置走；留在原处时去播放页。
        await expect(enter).toHaveCount(1);
        await expect(enter).toHaveClass(/\bis-icon\b/);
        await expect(enter).toHaveAccessibleName('Open the player');
        await expect(enter).toHaveAttribute('data-bravais-enter', 'player');
        await setEntryView(page, 'lattice');
        await expect(enter).toHaveAccessibleName('Open Lattice');
        await expect(enter).toHaveAttribute('title', 'Open Lattice');
        await expect(enter).toHaveAttribute('data-bravais-enter', 'lattice');
        await enter.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'enterPlaybackView')).length).toBe(1);
        await setEntryView(page, 'stay');
        await expect(enter).toHaveAccessibleName('Open the player');
        await expect(enter).toHaveAttribute('data-bravais-enter', 'player');
        // 点按钮不会收起聚焦卡、不会打开别的层。
        await expect(card).toHaveCount(1);
        expect(await stack(page)).toHaveLength(1);

        // 换成别的歌在播：这张回到立即播放，「进入」消失。
        await setNowPlaying(page, 'online:elsewhere:1', true);
        await expect(play).toHaveAccessibleName('Play now');
        await expect(enter).toHaveCount(0);
    });

    test('playing from the wall keeps that card expanded when the wall comes back, until it is collapsed by hand', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openCard(page);
        const { card, entry, playbackKey } = await expandSong(page);
        await clearLog(page);
        await card.locator('[data-bravais-action="play"]').dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'playSong')).map(call => call.ids[0])).toEqual([playbackKey]);
        // 应用开始播放这首（探针只记账，这里替它摆上正在播放）；在原处（留在原处 / 探针不跳转）卡片保持展开。
        await setNowPlaying(page, playbackKey, true);
        await expect(card).toHaveAttribute('data-library-entry', entry);
        await expect(card.locator('[data-bravais-action="play"]')).toHaveAccessibleName('Pause');

        // 离开首页再回来：stage 重新挂载，那首的聚焦卡又是展开的，键盘焦点在它上面，相机让它整张可见。
        await page.evaluate(() => window.__homeProbe!.remount());
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', /.+/);
        await settled(page);
        const restored = page.locator('[data-bravais-expanded]');
        await expect(restored).toHaveCount(1, { timeout: 10_000 });
        await expect(restored).toHaveAttribute('data-library-entry', entry);
        await expect(restored).toHaveAttribute('data-bravais-focused', 'true');
        await expect(restored).toHaveAttribute('data-bravais-current', 'true');
        await expect.poll(() => isInViewport(page)).toBe(true);
        expect(await stack(page)).toHaveLength(1);

        // 正在播放的换成同一层里的另一首（自动切歌）：回来时展开的是新的那首。
        const other = await page.evaluate(current => {
            const keys = [...document.querySelectorAll<HTMLElement>('.bravais-tile[data-library-entry]')]
                .map(element => element.dataset.libraryEntry!)
                .filter(key => key !== current);
            return keys[0] ?? null;
        }, entry);
        expect(other).not.toBeNull();
        await setNowPlaying(page, other!.replace(/-\d+$/, ''), true);
        await page.evaluate(() => window.__homeProbe!.remount());
        await settled(page);
        await expect(page.locator('[data-bravais-expanded]')).toHaveAttribute('data-library-entry', other!, { timeout: 10_000 });

        // 用户自己收起（Esc）之后不再保持。
        await page.locator('[data-bravais-expanded] article').evaluate(node => (node as HTMLElement).blur());
        await page.keyboard.press('Escape');
        await expect(page.locator('[data-bravais-expanded]')).toHaveCount(0);
        await page.evaluate(() => window.__homeProbe!.remount());
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
        await page.waitForTimeout(400);
        await expect(page.locator('[data-bravais-expanded]')).toHaveCount(0);
    });

    test('coming back from Lattice, the playing card opens as the seam starts opening, not after the handoff', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openCard(page);
        const { card, entry, playbackKey } = await expandSong(page);
        await card.locator('[data-bravais-action="play"]').dispatchEvent('click');
        await setNowPlaying(page, playbackKey, true);
        await expect(card).toHaveAttribute('data-library-entry', entry);

        // 回资料库墙的翻牌交接（探针里没有 Lattice：直接开一次会话，stage 重新挂载后报准备好，之后按时间表
        // 翻进 → 缝张开 → 结束）。逐帧记下聚焦卡第一次出现时根节点的交接阶段（2026-10-10：在缝开始张开时就展开）。
        await page.evaluate(async () => {
            const storePath = '/src/stores/useWallHandoffStore.ts';
            const timingPath = '/src/components/wall/wallHandoff.ts';
            const { useWallHandoffStore } = await import(/* @vite-ignore */ storePath);
            const { WALL_HANDOFF_TIMING } = await import(/* @vite-ignore */ timingPath);
            const w = window as unknown as { __expandedAt?: string | null; __phases: string[] };
            w.__phases = [];
            const tick = () => {
                const root = document.querySelector('[data-library-stage="bravais"]');
                const phase = root?.getAttribute('data-wall-handoff-phase') ?? null;
                if (phase && w.__phases.at(-1) !== phase) w.__phases.push(phase);
                if (root?.querySelector('[data-bravais-expanded]')) {
                    w.__expandedAt = phase;
                    return;
                }
                requestAnimationFrame(tick);
            };
            useWallHandoffStore.getState().begin({ direction: 'from-lattice', mode: 'flip', seeThrough: null, timing: { ...WALL_HANDOFF_TIMING } });
            window.__homeProbe!.remount();
            requestAnimationFrame(tick);
        });
        await expect.poll(() => page.evaluate(() => (window as unknown as { __expandedAt?: string | null }).__expandedAt), { timeout: 10_000 })
            .toBe('opening');
        expect(await page.evaluate(() => (window as unknown as { __phases: string[] }).__phases)).toEqual(expect.arrayContaining(['flipping', 'opening']));
        await expect(stage(page)).not.toHaveAttribute('data-wall-handoff', /.*/, { timeout: 10_000 });
        await expect(page.locator('[data-bravais-expanded]')).toHaveAttribute('data-library-entry', entry);
        await expect.poll(() => isInViewport(page)).toBe(true);
    });

    test('nothing is forced open on a layer where the remembered song is not playing', async ({ mount, page }) => {
        await mountBravais(mount, page);
        await openCard(page);
        const { card, playbackKey } = await expandSong(page);
        await card.locator('[data-bravais-action="play"]').dispatchEvent('click');
        await setNowPlaying(page, playbackKey, true);

        // 这一层里没有正在播放的歌（换成了别处的歌）：回来时不展开。
        await setNowPlaying(page, 'online:elsewhere:1', true);
        await page.evaluate(() => window.__homeProbe!.remount());
        await settled(page);
        await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
        await page.waitForTimeout(400);
        await expect(page.locator('[data-bravais-expanded]')).toHaveCount(0);
    });
});

test.describe('[grid] stay here', () => {
    test('the playing card pauses and resumes under stay here, and plays as before otherwise', async ({ mount, page }) => {
        await mountHome(mount, page);
        expect(await page.evaluate(() => window.__homeProbe!.open('owned'))).toBe(true);
        const buttons = page.locator('[data-library-renderer="grid"] [data-grid-card-play]');
        await expect(buttons.first()).toBeAttached({ timeout: 15_000 });

        await clearLog(page);
        await buttons.first().dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'playSong')).length).toBe(1);
        const playbackKey = (await calls(page, 'playSong'))[0].ids[0];

        // 播放后进入播放页（默认）：卡片照旧是播放键，再点仍是立即播放。
        await setNowPlaying(page, playbackKey, true);
        await expect(page.locator('[data-grid-card-play="playing"]')).toHaveCount(0);

        // 留在原处：正在播放的那张变成暂停，点了切换播放状态。
        await setEntryView(page, 'stay');
        const playing = page.locator('[data-grid-card-play="playing"]').first();
        await expect(playing).toBeAttached();
        await expect(playing).toHaveAttribute('title', 'Pause');
        await expect(playing.locator('svg.lucide-pause')).toHaveCount(1);
        await clearLog(page);
        await playing.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'togglePlayback')).length).toBe(1);
        expect(await calls(page, 'playSong')).toHaveLength(0);

        await setNowPlaying(page, playbackKey, false);
        const paused = page.locator('[data-grid-card-play="paused"]').first();
        await expect(paused).toHaveAttribute('title', 'Play');
        await paused.dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'togglePlayback')).length).toBe(2);
        expect(await calls(page, 'playSong')).toHaveLength(0);

        // 别的卡仍是立即播放。
        await page.locator('[data-grid-card-play="play"]').first().dispatchEvent('click');
        await expect.poll(async () => (await calls(page, 'playSong')).length).toBe(1);

        // 换回播放页：不再有暂停键。
        await setEntryView(page, 'player');
        await expect(page.locator('[data-grid-card-play="playing"], [data-grid-card-play="paused"]')).toHaveCount(0);
    });
});
