import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/bravaisTileKinds.spec.ts
// bravais 磁贴的种类区分（设计稿 §7.7），挂 bravaisKinds 探针（真实 BravaisStage + 歌曲 / 专辑 / 歌单 / 歌手 / 特殊卡混排、
// 合成封面）：
// - 集合（专辑、歌单、文件夹、每日推荐）右下边缘露出两层错开的叠页边（内容层自己的 box-shadow，落在 8px 的磁贴间距里、
//   不占内容面积、不压到邻居），曲目数并进类型标签（「Album · 12」，未知时只写种类；特殊集合的强调色标签同样带数字），
//   标签与标题在普通海报的位置；副标题不再重复曲目数，可访问名里还有；歌曲与私人 FM 没有叠页边；
//   悬停与键盘焦点时页边收回卡片下面；设置「集合叠页边」关掉时不画；
// - 歌手是双色调人像：亮端取自头像（同源封面取得到），没有头像 / 头像加载不出来时回退到主题强调色；悬停、键盘焦点、
//   正在播放时恢复原色；名字放大、不显示副标题；
// - 与状态叠加：叠色在双色调之上，熄灯层在最上面；叠色与熄灯同样作用到叠页边（混进页边的颜色）与缝（信息条），
//   悬停 / 聚焦 / 正在播放的豁免照旧；全透明档页边与标题一起压到 0.28、歌手不做双色调；叠页边与双色调都在翻牌转的内容层上。
const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const settled = (page: Page) => expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });

type KindsProps = {
    theme?: 'midnight' | 'daylight' | 'vivid';
    look?: 'solid' | 'partial' | 'clear';
    lights?: 'on' | 'off';
    tint?: 'on' | 'off';
    edges?: 'on' | 'off';
    current?: string;
    mix?: 'mixed' | 'artists';
    extraArtistCover?: string;
};

/** 跨源、不带 CORS 头的头像：图片照常显示，但读不了像素。 */
const CORS_BLOCKED_COVER = 'http://kinds-cors.localhost:4196/portrait.png';
/** 2×2 的红色 PNG。 */
const RED_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAE0lEQVR4nGP4z8DwnwGM/zMwAAAf7gP9NRsAMwAAAABJRU5ErkJggg==', 'base64');

const mountKinds = async (mount: (story: string, props?: Record<string, unknown>) => Promise<unknown>, page: Page, props: KindsProps = {}) => {
    await mount('bravaisKinds', props);
    await expect.poll(() => page.evaluate(() => window.__bravaisKindsProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await settled(page);
    await page.mouse.move(2, 600);
};

/** 一张此刻完整在视口里、没被缝挡住的磁贴（按选择器挑），返回它的 slot。 */
const visibleSlot = (page: Page, selector: string) => page.evaluate((query) => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const fits = (rect: DOMRect) => rect.left > 8 && rect.top > 8
        && rect.right < window.innerWidth - 8 && rect.bottom < window.innerHeight - 8
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = [...document.querySelectorAll<HTMLElement>(query)].find(element => fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, selector);

const tileAt = (page: Page, slot: string) => page.locator(`.bravais-tile[data-bravais-slot="${slot}"]`);
const card = (page: Page, key: string) => page.locator(`.bravais-tile[data-library-card="${key}"]`).first();
const style = (locator: Locator, property: string, pseudo?: string) => locator.evaluate(
    (node, [name, element]) => getComputedStyle(node, element || null).getPropertyValue(name),
    [property, pseudo ?? ''] as const,
);
/** 在内容层里的 left（标签与文字块都是内容层的绝对定位子元素）。 */
const leftWithinFace = (locator: Locator) => locator.evaluate(node => Math.round(Number.parseFloat(getComputedStyle(node).left)));
const duoOpacity = (locator: Locator) => locator.locator('.bravais-tile-duo').evaluate(node => Number(getComputedStyle(node).opacity));

type Shadow = { color: string; x: number; y: number; blur: number; spread: number };
/** 计算后的 box-shadow 拆成一条条（括号里的逗号不拆）。 */
const shadowsOf = (locator: Locator) => locator.evaluate((node): Shadow[] => {
    const text = getComputedStyle(node).boxShadow;
    if (text === 'none') return [];
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const character of text) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;
        if (character === ',' && depth === 0) {
            parts.push(current.trim());
            current = '';
        } else current += character;
    }
    if (current.trim()) parts.push(current.trim());
    return parts.map((part) => {
        // 过渡途中的颜色序列化成 oklab(…)，落定后是 color(srgb …) / rgba(…)：任何颜色函数都认。
        const color = /^[a-z-]+\([^)]*\)/.exec(part)?.[0] ?? '';
        const [x, y, blur, spread] = part.slice(color.length).trim().split(/\s+/).map(value => Number.parseFloat(value));
        return { color, x, y, blur, spread };
    });
});
/** 叠页边：向右下错开、不模糊的那几条（近的一层 3px、远的一层 6px，各带一道外扩 1px 的发丝线）。 */
const stackEdgesOf = async (face: Locator) => (await shadowsOf(face)).filter(shadow => shadow.blur === 0 && (shadow.x !== 0 || shadow.y !== 0));
/** 叠页边那四条（不论偏移是不是 0）：聚焦环三条之后、抬升投影之前。 */
const stackSlotsOf = async (face: Locator) => (await shadowsOf(face)).slice(3, 7);
/** color(srgb r g b / a) 或 rgb(a)() → [r, g, b, a]（0–1）。 */
const channels = (color: string): number[] => {
    const numbers = (color.match(/[\d.]+/g) ?? []).map(Number);
    if (color.startsWith('color(')) return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
    return [numbers[0] / 255, numbers[1] / 255, numbers[2] / 255, numbers[3] ?? 1];
};
const luminance = (color: string) => {
    const [r, g, b] = channels(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** 叠页边近的那一层（第 4 条阴影）的颜色。 */
const nearPageColor = async (face: Locator) => (await stackSlotsOf(face))[0]?.color ?? '';
/** 等颜色过渡放完（途中是 oklab，落定后是 srgb）再读。 */
const settledNearPageColor = async (face: Locator) => {
    await expect.poll(() => nearPageColor(face)).toMatch(/^(color\(srgb|rgba?\()/);
    return nearPageColor(face);
};
const setStore = (page: Page, path: string, name: string, patch: Record<string, unknown>) => page.evaluate(async ([modulePath, storeName, next]) => {
    const module = await import(/* @vite-ignore */ modulePath) as Record<string, { setState: (value: Record<string, unknown>) => void }>;
    module[storeName].setState(next);
}, [path, name, patch] as const);
const setLattice = (page: Page, patch: Record<string, unknown>) => setStore(page, '/src/stores/useLatticeSettingsStore.ts', 'useLatticeSettingsStore', patch);
const setWallLook = (page: Page, patch: Record<string, unknown>) => setStore(page, '/src/stores/useLibraryWallLookStore.ts', 'useLibraryWallLookStore', patch);
const seam = (page: Page) => page.locator('.bravais-seam');
const pseudo = (locator: Locator, element: '::before' | '::after') => locator.evaluate((node, which) => {
    const style = getComputedStyle(node, which);
    return { opacity: Number(style.opacity), background: style.backgroundColor, image: style.backgroundImage };
}, element);

test.describe('[bravais-only] tile kinds', () => {
    test('collections show stacked page edges outside the poster and the track count in the type label', async ({ mount, page }) => {
        await mountKinds(mount, page);
        await expect(stage(page)).toHaveClass(/\bhas-stack-edges\b/);
        await expect(page.locator('.bravais-tile-spine')).toHaveCount(0);
        const album = card(page, 'card:album:a0');
        await expect(album).toHaveAttribute('data-bravais-form', 'stack');
        const face = album.locator('.bravais-tile-face');
        await expect(face).toHaveClass(/\bis-stack\b/);
        // 两层页边：近的一层错开 3px、远的一层 6px，各带一道外扩 1px 的发丝线；最远到 7px，小于 8px 的磁贴间距。
        const edges = await stackEdgesOf(face);
        expect(edges.map(edge => [edge.x, edge.y, edge.spread])).toEqual([[3, 3, 0], [3, 3, 1], [6, 6, 0], [6, 6, 1]]);
        expect(Math.max(...edges.map(edge => edge.x + edge.spread))).toBe(7);
        // 不越界到邻居：右边紧挨着的那张磁贴离这张 8px（世界坐标），页边只占 7px。
        const gapToRight = await album.evaluate((frame) => {
            const at = (element: Element) => {
                const inline = (element as HTMLElement).style;
                const match = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(inline.transform)!;
                return { x: Number(match[1]), y: Number(match[2]), width: Number.parseFloat(inline.width), height: Number.parseFloat(inline.height) };
            };
            const self = at(frame);
            const others = [...frame.parentElement!.querySelectorAll(':scope > .bravais-tile')].filter(other => other !== frame).map(at);
            const right = others.filter(other => other.x >= self.x + self.width && other.y < self.y + self.height && other.y + other.height > self.y);
            return Math.min(...right.map(other => other.x - (self.x + self.width)));
        });
        expect(gapToRight).toBe(8);
        // 不占内容面积：内容层与外框同大，标签、标题在普通海报的位置。
        const sizes = await album.evaluate(frame => [frame.getBoundingClientRect().width, frame.querySelector('.bravais-tile-face')!.getBoundingClientRect().width]);
        expect(sizes[1]).toBeCloseTo(sizes[0], 1);
        expect(await leftWithinFace(album.locator('.lattice-poster-badge'))).toBe(14);
        expect(await leftWithinFace(album.locator('.lattice-poster-copy'))).toBe(17);
        // 翻牌只转内容层：页边是内容层自己画的，外框没有阴影。
        expect(await album.evaluate(frame => getComputedStyle(frame).boxShadow)).toBe('none');

        // 曲目数并进类型标签；副标题不再重复曲目数，可访问名里还有。
        await expect(album.locator('.lattice-poster-badge')).toHaveText('Album · 12');
        await expect(album.locator('.lattice-poster-copy small')).toHaveText('YOASOBI · 2021');
        await expect(album.locator('article')).toHaveAttribute('aria-label', 'THE BOOK · YOASOBI · 2021 · 12 tracks');
        await expect(card(page, 'card:playlist:p0').locator('.lattice-poster-badge')).toHaveText('Playlist · 48');
        await expect(card(page, 'card:folder:folder-Music').locator('.lattice-poster-badge')).toHaveText('Folder · 42');
        await expect(card(page, 'card:daily_recommendations:daily_recommendations').locator('.lattice-poster-badge')).toHaveText('Radio · 30');
        // 曲目数未知：照样是集合（有页边），标签只写种类。
        const unknown = card(page, 'card:playlist:p-unknown');
        if (await unknown.count()) {
            await expect(unknown).toHaveAttribute('data-bravais-form', 'stack');
            await expect(unknown.locator('.lattice-poster-badge')).toHaveText('Playlist');
        }

        // 歌曲、私人 FM（直接播放的电台流）：满版海报，没有页边，标签只写种类。
        const track = page.locator('.bravais-tile[data-library-entry="kinds-track-0"]').first();
        await expect(track).not.toHaveAttribute('data-bravais-form', /.*/);
        expect(await stackEdgesOf(track.locator('.bravais-tile-face'))).toEqual([]);
        expect(await leftWithinFace(track.locator('.lattice-poster-badge'))).toBe(14);
        const fm = card(page, 'card:radio:personal_fm');
        await expect(fm).not.toHaveAttribute('data-bravais-form', /.*/);
        expect(await stackEdgesOf(fm.locator('.bravais-tile-face'))).toEqual([]);
        await expect(fm.locator('.lattice-poster-badge')).toHaveText('Radio');

        // 特殊集合的强调色标签同样带数字、在普通位置。
        const liked = card(page, 'card:playlist:liked');
        await expect(liked.locator('.lattice-poster-badge')).toHaveClass(/\bis-special\b/);
        await expect(liked.locator('.lattice-poster-badge')).toHaveText('Playlist · 321');
        expect(await leftWithinFace(liked.locator('.lattice-poster-badge'))).toBe(14);
        expect((await stackEdgesOf(liked.locator('.bravais-tile-face'))).length).toBe(4);
    });

    test('hover and keyboard focus fold the page edges under the lifted card', async ({ mount, page }) => {
        await mountKinds(mount, page, { current: 'none' });
        const slot = await visibleSlot(page, '.bravais-tile[data-bravais-form="stack"]');
        expect(slot).not.toBeNull();
        const tile = tileAt(page, slot!);
        const face = tile.locator('.bravais-tile-face');
        expect((await stackEdgesOf(face)).length).toBe(4);
        await face.hover();
        // 抬起时页边收回卡片下面（偏移归零），不伸进邻居；条目数不变，阴影能补间。
        await expect.poll(async () => (await stackSlotsOf(face)).every(edge => edge.x === 0 && edge.y === 0)).toBe(true);
        expect(await stackSlotsOf(face)).toHaveLength(4);
        await page.mouse.move(2, 600);
        await expect.poll(async () => (await stackEdgesOf(face)).length).toBe(4);

        // 键盘焦点：同样收起，聚焦环外不露页边。方向键走到第一张集合为止。
        await page.locator('.bravais-field').focus();
        await page.keyboard.press('ArrowRight');
        const focused = page.locator('.bravais-tile[data-bravais-focused]');
        await expect(focused).toHaveCount(1);
        for (let step = 0; step < 24 && (await focused.getAttribute('data-bravais-form')) !== 'stack'; step += 1) {
            await page.keyboard.press(step % 6 === 5 ? 'ArrowDown' : 'ArrowRight');
        }
        await expect(focused).toHaveAttribute('data-bravais-form', 'stack');
        await expect.poll(async () => (await stackEdgesOf(focused.locator('.bravais-tile-face'))).length).toBe(0);
    });

    test('the stack edges setting removes the page edges and keeps the count in the label', async ({ mount, page }) => {
        await mountKinds(mount, page, { edges: 'off' });
        await expect(stage(page)).not.toHaveClass(/\bhas-stack-edges\b/);
        const album = card(page, 'card:album:a0');
        // 关掉时集合就是普通海报：没有页边，标签照样带曲目数。
        await expect(album).toHaveAttribute('data-bravais-form', 'stack');
        expect(await stackEdgesOf(album.locator('.bravais-tile-face'))).toEqual([]);
        await expect(album.locator('.lattice-poster-badge')).toHaveText('Album · 12');
        // 设置是活的：打开后不用重挂就画出来。
        await setWallLook(page, { collectionStackEdges: true });
        await expect(stage(page)).toHaveClass(/\bhas-stack-edges\b/);
        await expect.poll(async () => (await stackEdgesOf(album.locator('.bravais-tile-face'))).length).toBe(4);
    });

    test('artists are duotone portraits that take their light from the photo and fall back to the accent', async ({ mount, page }) => {
        // Playwright 给拦截的跨源应答自动补 CORS 头；明确写一个别的来源，匿名请求就读不了像素（普通 <img> 照常显示）。
        await page.route('http://kinds-cors.localhost:4196/**', route => route.fulfill({
            contentType: 'image/png',
            headers: { 'access-control-allow-origin': 'http://elsewhere.invalid' },
            body: RED_PNG,
        }));
        await mountKinds(mount, page, { theme: 'vivid', mix: 'artists', current: 'none', extraArtistCover: CORS_BLOCKED_COVER });
        const artist = card(page, 'card:artist:r0');
        await expect(artist).toHaveAttribute('data-bravais-form', 'portrait');
        const duo = artist.locator('.bravais-tile-face > .bravais-tile-duo');
        await expect(duo).toHaveCount(1);
        // 取色是异步的：先画回退色，取到后写上 --bravais-duo-light（同源封面取得到）。
        await expect(duo).toHaveAttribute('data-bravais-tone', 'photo');
        expect(await duo.evaluate(node => (node as HTMLElement).style.getPropertyValue('--bravais-duo-light'))).toMatch(/^hsl\(\d+ 62% 66%\)$/);
        expect(await style(duo.locator('i'), 'mix-blend-mode')).toBe('multiply');
        expect(await style(duo, 'mix-blend-mode', '::after')).toBe('lighten');
        expect(await duoOpacity(artist)).toBe(1);
        // 名字放大约 1.3 倍、不显示副标题。
        expect(await style(artist.locator('.lattice-poster-copy small'), 'display')).toBe('none');
        const fontSize = Number.parseFloat(await style(artist.locator('.lattice-poster-copy strong'), 'font-size'));
        // 普通海报的标题字号 clamp(22px, 2vw, 36px)。
        const plain = await page.evaluate(() => Math.min(36, Math.max(22, window.innerWidth * 0.02)));
        expect(fontSize / plain).toBeCloseTo(1.3, 2);

        // 没有头像（人像层画在程序生成的渐变上）：亮端回退到主题强调色（彩色主题的 #fd5c47）。
        const accent = 'rgb(253, 92, 71)';
        const fallback = card(page, 'card:artist:no-cover').locator('.bravais-tile-duo');
        await expect(fallback).toHaveAttribute('data-bravais-tone', 'fallback');
        await expect.poll(() => style(fallback, 'background-color')).toBe(accent);
        await expect.poll(() => style(duo, 'background-color')).not.toBe(accent);
        // 图片能显示、但跨源没有 CORS 头（读不了像素）：照样是双色调，亮端回退到强调色。
        const blocked = card(page, 'card:artist:extra-cover').locator('.bravais-tile-duo');
        await expect(blocked).toHaveAttribute('data-bravais-tone', 'fallback');
        await expect.poll(() => style(blocked, 'background-color')).toBe(accent);
        // 头像地址本身加载不出来：不画人像层（与任何坏封面一样露出空卡底色），名字照样放大。
        const broken = card(page, 'card:artist:broken-cover');
        await expect(broken).toHaveAttribute('data-bravais-form', 'portrait');
        await expect(broken.locator('.bravais-tile-duo')).toHaveCount(0);
    });

    test('hover, keyboard focus and the playing card bring the portrait back to its own colours', async ({ mount, page }) => {
        await mountKinds(mount, page, { mix: 'artists', current: 'card:artist:r1', tint: 'on' });
        // 正在播放：双色调层淡出、不染色。
        const playing = page.locator('.bravais-tile[data-bravais-current]').first();
        await expect(playing).toHaveAttribute('data-library-card', 'card:artist:r1');
        await expect.poll(() => duoOpacity(playing)).toBe(0);
        await expect.poll(() => playing.locator('.lattice-poster-tint').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(0);

        // 悬停：恢复原色，移开后回到双色调。
        const slot = await visibleSlot(page, '.bravais-tile[data-bravais-form="portrait"]:not([data-bravais-current])');
        expect(slot).not.toBeNull();
        const hovered = tileAt(page, slot!);
        // 叠色画在双色调之上（双色调是内容层的第一层、没有 z-index；叠色 z 3）。
        await expect.poll(() => hovered.locator('.lattice-poster-tint').evaluate(node => Number(getComputedStyle(node).opacity))).toBeGreaterThan(0);
        expect(await hovered.locator('.bravais-tile-face').evaluate((face) => {
            const children = [...face.children];
            return children.indexOf(face.querySelector(':scope > .bravais-tile-duo')!) < children.indexOf(face.querySelector(':scope > .lattice-poster-tint')!);
        })).toBe(true);
        expect(await style(hovered.locator('.bravais-tile-duo'), 'z-index')).toBe('auto');
        await expect.poll(() => duoOpacity(hovered)).toBe(1);
        await hovered.locator('article').hover();
        await expect.poll(() => duoOpacity(hovered)).toBe(0);
        await page.mouse.move(2, 600);
        await expect.poll(() => duoOpacity(hovered)).toBe(1);

        // 键盘焦点（整面墙都是歌手，焦点落在哪张都是人像）。
        await page.locator('.bravais-field').focus();
        await page.keyboard.press('ArrowRight');
        const focused = page.locator('.bravais-tile[data-bravais-focused]');
        await expect(focused).toHaveCount(1);
        await expect(focused).toHaveAttribute('data-bravais-form', 'portrait');
        await expect.poll(() => duoOpacity(focused)).toBe(0);
    });

    test('lights out and the poster tint reach the page edges and keep their fixed order over the portrait', async ({ mount, page }) => {
        await mountKinds(mount, page, { tint: 'on', current: 'none' });
        const album = card(page, 'card:album:a0');
        const face = album.locator('.bravais-tile-face');
        const layers = await face.evaluate((node) => {
            const z = (selector: string) => getComputedStyle(node.querySelector(selector)!).zIndex;
            return { tint: z(':scope > .lattice-poster-tint'), lightsOut: z(':scope > .lattice-poster-lights-out'), badge: z(':scope > .lattice-poster-badge') };
        });
        expect(layers).toEqual({ tint: '3', lightsOut: '5', badge: 'auto' });
        // 叠色：海报里的叠色层盖不到画在外侧的页边，所以叠色混进了页边的颜色——关掉叠色，页边的颜色就变回去。
        const tinted = await settledNearPageColor(face);
        await setLattice(page, { latticePosterTintEnabled: false });
        await expect.poll(() => nearPageColor(face)).not.toBe(tinted);
        const plain = await settledNearPageColor(face);
        expect(plain).not.toBe(tinted);
        // 熄灯：页边与整张卡一起压暗（82% 黑）。
        await setLattice(page, { latticeLightsOn: false });
        await expect(stage(page)).toHaveClass(/\bis-lights-out\b/);
        await expect.poll(async () => luminance(await settledNearPageColor(face))).toBeLessThan(luminance(plain) * 0.3);
        await expect.poll(() => album.locator('.lattice-poster-lights-out').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.82, 2);
        const artist = card(page, 'card:artist:r0');
        await expect.poll(() => artist.locator('.lattice-poster-lights-out').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.82, 2);
        // 双色调在翻牌转的内容层里；叠页边是内容层自己的阴影。
        await expect(page.locator('.bravais-tile > .bravais-tile-face > .bravais-tile-duo').first()).toBeAttached();
        await expect(page.locator('.bravais-tile > :not(.bravais-tile-face) .bravais-tile-duo')).toHaveCount(0);
    });

    test('the playing collection keeps its page edges lit and untinted', async ({ mount, page }) => {
        await mountKinds(mount, page, { tint: 'on', lights: 'off', current: 'card:album:a0' });
        const playing = page.locator('.bravais-tile[data-bravais-current]').first();
        await expect(playing).toHaveAttribute('data-library-card', 'card:album:a0');
        const other = card(page, 'card:album:a1');
        const playingColor = await settledNearPageColor(playing.locator('.bravais-tile-face'));
        await expect.poll(async () => luminance(await settledNearPageColor(other.locator('.bravais-tile-face')))).toBeLessThan(luminance(playingColor) * 0.3);
        // 与熄灯关、叠色关时同一个颜色（正在播放的不熄、不染）。
        await setLattice(page, { latticeLightsOn: true, latticePosterTintEnabled: false });
        await expect.poll(() => nearPageColor(playing.locator('.bravais-tile-face'))).toBe(playingColor);
    });

    test('the clear look degrades: no duotone, page edges fade with the titles when the lights are out', async ({ mount, page }) => {
        await mountKinds(mount, page, { look: 'clear', lights: 'off', current: 'none' });
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        const artist = card(page, 'card:artist:r0');
        await expect(artist).toHaveAttribute('data-bravais-see-through', 'true');
        await expect(artist).toHaveAttribute('data-bravais-form', 'portrait');
        await expect(artist.locator('.bravais-tile-duo')).toHaveCount(0);
        // 名字照样放大、不显示副标题。
        expect(await style(artist.locator('.lattice-poster-copy small'), 'display')).toBe('none');

        const album = card(page, 'card:album:a0');
        await expect(album.locator('.lattice-poster-badge')).toHaveText('Album · 12');
        // 熄灯：页边与标题、徽标同一条规则压到 0.28（不往窗上涂黑）。
        await expect.poll(async () => channels(await settledNearPageColor(album.locator('.bravais-tile-face')))[3]).toBeCloseTo(0.28, 2);
        await expect.poll(() => album.locator('.lattice-poster-copy').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.28, 2);
    });

    test('the poster tint and lights out reach the info strip; hovering or focusing it lifts both', async ({ mount, page }) => {
        await mountKinds(mount, page, { tint: 'on', current: 'none' });
        // 叠色：纸被染满 e（午夜主题 0.5），内容层上那一层封顶 0.35：::after 0.35，::before 补齐 1 − 0.5 / 0.65。
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBeCloseTo(0.35, 2);
        expect((await pseudo(seam(page), '::before')).opacity).toBeCloseTo(1 - 0.5 / 0.65, 2);
        expect((await pseudo(seam(page), '::after')).image).toContain('linear-gradient');
        // 悬停在缝上：整条亮起、不染。
        await seam(page).hover();
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBe(0);
        expect((await pseudo(seam(page), '::before')).opacity).toBe(0);
        await page.mouse.move(2, 600);
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBeCloseTo(0.35, 2);

        // 熄灯：叠色归零，整条压 60% 黑。
        await setLattice(page, { latticeLightsOn: false });
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBeCloseTo(0.6, 2);
        expect((await pseudo(seam(page), '::after')).background).toBe('rgb(0, 0, 0)');
        expect((await pseudo(seam(page), '::before')).opacity).toBe(0);
        // 缝里有键盘焦点（:focus-visible）：豁免。
        await seam(page).locator('button').first().focus();
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBe(0);
    });

    // 日光主题下熄灯也是压暗（2026-11-18 起不再往白里褪）。
    test('in daylight the info strip dims toward black too; in the clear look only its content fades', async ({ mount, page }) => {
        await mountKinds(mount, page, { theme: 'daylight', lights: 'off', current: 'none' });
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBeCloseTo(0.6, 2);
        expect((await pseudo(seam(page), '::after')).background).toBe('rgb(0, 0, 0)');

        await setWallLook(page, { look: 'clear' });
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        // 全透明档的缝是半透明的纸：不往上涂，只把内容压到 0.4。
        await expect.poll(async () => (await pseudo(seam(page), '::after')).opacity).toBe(0);
        await expect.poll(() => seam(page).locator('.bravais-seam-body').evaluate(node => Number(getComputedStyle(node).opacity))).toBeCloseTo(0.4, 2);
    });
});
