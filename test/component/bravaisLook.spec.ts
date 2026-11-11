import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { buildServiceStubModule, LOCAL_MUSIC_SERVICE_ROUTE } from '../../dev/probes/homeBehavior/serviceStubModule';
import '../../dev/probes/homeBehavior/probeApi';

// test/component/bravaisLook.spec.ts
// bravais 的透光（B6b③，设计稿 §11），挂真实的 Home（homeBehavior 探针）切到 bravais：
// - 默认实色（2026-10-08 起）：没有窗、没有底板，stage 报遮挡；其余用例先把存储种成部分透明再挂载；
// - 部分透明：每块 k 个窗，窗不可点、方向键跳过，实色底板只在窗位挖洞；
// - 外观动作换窗数与循环三档：窗数跟着变，全透明时墙上只剩标题（聚焦卡照常有封面），实色档没有底板；
// - 聚焦卡让位期间局部底板顶上，落定后收起；
// - 拖动只改底板遮罩的位置，不重建遮罩、不重渲染磁贴。
// B12b：底板改为按块的 SVG（世界层里、磁贴之下，没有 CSS 遮罩）——让位期间只逐帧重画聚焦那一块、洞跟着窗磁贴的实时矩形；
// 拖动时底板随世界层平移，块底板与磁贴都不重画。
// 探针里没有 visualizer，窗里露出的是页面底色；visualizer 的挂载 / 卸载在 e2e 的 bravaisVisualizerMount 里。

const stage = (page: Page) => page.locator('[data-library-stage="bravais"]');
const plates = (page: Page) => page.locator('[data-bravais-plate-block]');
type CountWindow = Window & { __renderCounts?: Record<string, number>; __plateWrites?: string[]; __reflowError?: number[] };
const plateHoleCounts = (page: Page) => page.evaluate(() => [...new Set([...document.querySelectorAll<SVGSVGElement>('[data-bravais-plate-block]')]
    .map(svg => svg.dataset.bravaisPlateHoles))]);
const runChrome = (page: Page, id: string) => page.evaluate(actionId => window.__homeProbe!.runChrome(actionId), id);
const chromeAvailable = (page: Page) => page.evaluate(() => window.__homeProbe!.chrome()?.available ?? []);

/** 挂 bravais 首页；`look` 非 null 时先把透光档位种进存储（store 在 import 时读存储），null 表示不种、走默认档。 */
/**
 * 信息条始终透明 2026-10-09 起默认开；这里的用例看的是墙的透光档，默认把缝种成实色（`seamClear: false`），
 * `seamClear: null` 时不种、走默认。
 */
const mountBravais = async (mount: (id: string) => Promise<unknown>, page: Page, look: 'solid' | 'partial' | 'clear' | null = 'partial',
    { seamClear = false }: { seamClear?: boolean | null } = {}) => {
    if (look) await page.addInitScript(value => localStorage.setItem('library_wall_look', value), look);
    if (seamClear !== null) await page.addInitScript(value => localStorage.setItem('library_wall_seam_clear', value), String(seamClear));
    await page.route(LOCAL_MUSIC_SERVICE_ROUTE, route => route.fulfill({
        contentType: 'text/javascript',
        body: buildServiceStubModule(),
    }));
    await mount('homeBehavior');
    await expect.poll(() => page.evaluate(() => window.__homeProbe?.ready() ?? false), { timeout: 30_000 }).toBe(true);
    await page.evaluate(() => window.__homeProbe!.setSuite('bravais'));
    await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist', { timeout: 15_000 });
    await expect(page.locator('[data-library-card]').first()).toBeAttached();
};

/** 渲染完整（12 个 slot 都在 DOM 里）的块，各有几个窗。 */
const windowsPerRenderedBlock = (page: Page) => page.evaluate(() => {
    const blocks = new Map<string, { slots: number; windows: number }>();
    document.querySelectorAll<HTMLElement>('.bravais-tile[data-bravais-slot]').forEach((tile) => {
        const [column, row] = tile.dataset.bravaisSlot!.split(',');
        const block = blocks.get(`${column},${row}`) ?? { slots: 0, windows: 0 };
        block.slots += 1;
        if (tile.dataset.bravaisKind === 'window') block.windows += 1;
        blocks.set(`${column},${row}`, block);
    });
    return [...new Set([...blocks.values()].filter(block => block.slots === 12).map(block => block.windows))];
});

/** 一张完整在视口里、没被缝挡住的磁贴（按选择器挑）。 */
const visibleSlot = (page: Page, selector: string) => page.evaluate((query) => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const fits = (rect: DOMRect) => rect.left > 8 && rect.top > 8
        && rect.right < window.innerWidth - 8 && rect.bottom < window.innerHeight - 140
        && (!seamRect || seamRect.width < 1 || rect.right < seamRect.left - 4 || rect.left > seamRect.right + 4);
    const tile = [...document.querySelectorAll<HTMLElement>(query)].find(element => fits(element.getBoundingClientRect()));
    return tile?.dataset.bravaisSlot ?? null;
}, selector);

const tile = (page: Page, slotKey: string) => page.locator(`[data-bravais-slot="${slotKey}"]`);

/** 墙面颗粒噪点叠层（.lattice-root::after）的 display。 */
const noiseOverlay = (page: Page) => stage(page).evaluate(element => getComputedStyle(element, '::after').display);

/** 打开一张首页卡片，等集合层的曲目铺满墙。 */
const openCollection = async (page: Page) => {
    const slot = await visibleSlot(page, '.bravais-tile[data-library-card]');
    expect(slot).not.toBeNull();
    await tile(page, slot!).locator('article').click();
    await expect(stage(page)).not.toHaveAttribute('data-bravais-layer', 'home:playlist');
    await expect(page.locator('.bravais-tile[data-library-card]')).toHaveCount(0);
    await expect(page.locator('.bravais-tile[data-library-entry]').first()).toBeAttached();
};

/**
 * 每次块底板的路径被写（MutationObserver 的微任务，与写入同一帧）：记下是哪一块，并把路径里的洞对照块里窗磁贴
 * 此刻的实际位置（世界层里的坐标；磁贴越出块外框的部分先裁掉，洞本来就裁到外框里）。
 */
const watchPlateWrites = (page: Page, blockKey: string) => page.evaluate((key) => {
    const countWindow = window as CountWindow;
    countWindow.__plateWrites = [];
    countWindow.__reflowError = [];
    // 洞与窗磁贴都按世界层里的坐标量（块底板与磁贴在同一个世界层里，各自的 translate + 尺寸），再乘世界层的缩放换成屏幕
    // 像素：集合页整层倾斜着，getBoundingClientRect 给的是转过之后的外接框，拿它对不上。
    const translateOf = (element: Element) => {
        const transform = getComputedStyle(element).transform;
        const matrix = new DOMMatrixReadOnly(transform === 'none' ? undefined : transform);
        return { x: matrix.m41, y: matrix.m42, scale: Math.hypot(matrix.a, matrix.b) };
    };
    type Rect = { left: number; top: number; right: number; bottom: number };
    const MISALIGNED = 99;
    const measure = (svg: SVGSVGElement) => {
        const origin = translateOf(svg);
        const box = { left: origin.x, top: origin.y, right: origin.x + svg.viewBox.baseVal.width, bottom: origin.y + svg.viewBox.baseVal.height };
        // 底板与它盖着的磁贴在同一个世界层（同一半面墙）里：只跟这一层里的窗磁贴比。
        const world = svg.closest('.lattice-world')!;
        const scale = translateOf(world).scale;
        const holes = [...svg.querySelector('path')!.getAttribute('d')!.matchAll(/M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)/g)]
            .slice(1)
            .map(match => ({
                left: box.left + Number(match[1]),
                top: box.top + Number(match[2]),
                right: box.left + Number(match[1]) + Number(match[3]),
                bottom: box.top + Number(match[2]) + Number(match[4]),
            }));
        const windows: Rect[] = [];
        world.querySelectorAll<HTMLElement>(`.bravais-tile[data-bravais-slot^="${key},"][data-bravais-kind="window"]`).forEach((tile) => {
            const at = translateOf(tile);
            const style = getComputedStyle(tile);
            const rect = { left: at.x, top: at.y, right: at.x + parseFloat(style.width), bottom: at.y + parseFloat(style.height) };
            windows.push({
                left: Math.max(box.left, rect.left),
                top: Math.max(box.top, rect.top),
                right: Math.min(box.right, rect.right),
                bottom: Math.min(box.bottom, rect.bottom),
            });
        });
        // 让位途中两张窗磁贴会叠在一起，洞是它们的并集（路径把并集切成几条矩形），所以不逐张对矩形：窗磁贴往里收 1.5 屏幕像素
        // 的四个角与中心都落在某个洞里，洞往里收同样多的四个角与中心也都落在某张窗磁贴里——两边的并集在 1.5 像素内重合。
        // 对得上记 0，对不上记 MISALIGNED（下面断言 < 1.5）。
        const tolerance = 1.5 / scale;
        const probes = (rect: Rect) => (rect.right - rect.left <= tolerance * 2 || rect.bottom - rect.top <= tolerance * 2 ? [] : [
            [rect.left + tolerance, rect.top + tolerance], [rect.right - tolerance, rect.top + tolerance],
            [rect.left + tolerance, rect.bottom - tolerance], [rect.right - tolerance, rect.bottom - tolerance],
            [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
        ]);
        const covered = (rects: Rect[], [x, y]: number[]) => rects.some(rect => x! >= rect.left && x! <= rect.right && y! >= rect.top && y! <= rect.bottom);
        const aligned = windows.flatMap(probes).every(point => covered(holes, point)) && holes.flatMap(probes).every(point => covered(windows, point));
        const worst = aligned ? 0 : MISALIGNED;
        countWindow.__reflowError!.push(worst);
    };
    new MutationObserver((records) => {
        const written = new Set<SVGSVGElement>();
        for (const record of records) {
            const svg = (record.target as Element).closest<SVGSVGElement>('[data-bravais-plate-block]');
            if (!svg) continue;
            countWindow.__plateWrites!.push(svg.dataset.bravaisPlateBlock!);
            written.add(svg);
        }
        written.forEach(svg => { if (svg.dataset.bravaisPlateBlock === key) measure(svg); });
    }).observe(document.querySelector('[data-library-stage="bravais"]')!, { attributes: true, subtree: true, attributeFilter: ['d'] });
}, blockKey);

test.describe('[bravais] default look', () => {
    test('with nothing stored the info strip is see-through over the solid wall, so the backdrop stays open', async ({ mount, page }) => {
        await mountBravais(mount, page, null, { seamClear: null });
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
        await expect(stage(page)).toHaveClass(/\bhas-clear-seam\b/);
        await expect(stage(page)).toHaveClass(/\bis-backdrop-open\b/);
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([0]);
    });

    test('with nothing stored the wall is solid: no windows, no plates, the root paints the wall', async ({ mount, page }) => {
        await mountBravais(mount, page, null);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
        await expect(stage(page)).not.toHaveClass(/is-see-through/);
        await expect(plates(page)).toHaveCount(0);
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([0]);
        await expect(page.locator('.bravais-tile[data-bravais-see-through], .bravais-tile[data-bravais-kind="window"]')).toHaveCount(0);
        expect(await stage(page).evaluate(element => getComputedStyle(element).backgroundImage)).toContain('radial-gradient');
        // 窗数动作只在部分透明时可用；循环档位从实色进到部分透明。
        await expect.poll(() => chromeAvailable(page)).toContain('wall-look');
        expect(await chromeAvailable(page)).not.toContain('more-windows');
        expect(await runChrome(page, 'wall-look')).toBe(true);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'partial');
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([3]);
    });
});

test.describe('[bravais] see-through wall', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('the partial look inserts three windows per block that cannot be focused', async ({ page }) => {
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'partial');
        await expect(stage(page)).toHaveClass(/is-see-through/);
        expect(await stage(page).evaluate(element => getComputedStyle(element).backgroundImage)).toBe('none');
        // 墙面的颗粒噪点（全屏 ::after）不画：否则它压在窗上，等于给下面的 visualizer 蒙一层噪点。
        expect(await noiseOverlay(page)).toBe('none');
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([3]);
        // 底板：每个已挂载的块一张 SVG（evenodd 路径 = 外框减去 3 个窗洞），在世界层里、磁贴之前；整个 stage 没有 CSS 遮罩。
        await expect(plates(page).first()).toBeAttached();
        const plateShape = await page.evaluate(() => {
            const all = [...document.querySelectorAll<SVGSVGElement>('[data-bravais-plate-block]')];
            return {
                holes: [...new Set(all.map(svg => svg.dataset.bravaisPlateHoles))],
                subpaths: [...new Set(all.map(svg => svg.querySelector('path')!.getAttribute('d')!.match(/M/g)!.length))],
                fillRule: getComputedStyle(all[0].querySelector('path')!).fillRule,
                beforeTiles: all.every(svg => svg.parentElement!.classList.contains('lattice-world')
                    && !svg.previousElementSibling?.classList.contains('bravais-tile')),
                masked: [...document.querySelectorAll('[data-library-stage="bravais"], [data-library-stage="bravais"] *')]
                    .filter(element => getComputedStyle(element).maskImage !== 'none').length,
            };
        });
        expect(plateShape).toEqual({ holes: ['3'], subpaths: [4], fillRule: 'evenodd', beforeTiles: true, masked: 0 });
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"][data-library-card]')).toHaveCount(0);

        // 点窗：不聚焦、不展开、不打开下一层。
        const windowSlot = await visibleSlot(page, '.bravais-tile[data-bravais-kind="window"]');
        expect(windowSlot).not.toBeNull();
        await tile(page, windowSlot!).locator('article').click();
        await expect(page.locator('[data-bravais-focused]')).toHaveCount(0);
        await expect(stage(page)).toHaveAttribute('data-bravais-layer', 'home:playlist');

        // 方向键在墙上走，永远不落在窗上。
        await page.locator('.bravais-field').focus();
        for (const key of ['ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowRight']) {
            await page.keyboard.press(key);
            await expect(page.locator('[data-bravais-focused]')).toHaveCount(1);
            await expect(page.locator('[data-bravais-focused]')).not.toHaveAttribute('data-bravais-kind', 'window');
        }
    });

    test('chrome actions step the windows and cycle solid, partial and clear', async ({ page }) => {
        await expect.poll(() => chromeAvailable(page)).toEqual(expect.arrayContaining(['wall-look', 'more-windows', 'fewer-windows']));
        expect(await runChrome(page, 'more-windows')).toBe(true);
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([4]);
        expect(await runChrome(page, 'fewer-windows')).toBe(true);
        expect(await runChrome(page, 'fewer-windows')).toBe(true);
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([2]);

        // 全透明：墙上没有结构窗，内容磁贴只留标题（2026-10-09 起没有封面底条），底板在它们上面挖洞。
        expect(await runChrome(page, 'wall-look')).toBe(true);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'clear');
        await expect.poll(() => windowsPerRenderedBlock(page)).toEqual([0]);
        await expect.poll(() => plateHoleCounts(page)).toEqual(['12']);
        await expect.poll(() => chromeAvailable(page)).not.toContain('more-windows');
        const seeThrough = page.locator('.bravais-tile[data-bravais-see-through] > article').first();
        await expect(seeThrough).toBeAttached();
        expect(await seeThrough.evaluate(element => element.style.backgroundImage)).toBe('');
        await expect(seeThrough.locator('.bravais-tile-strip')).toHaveCount(0);
        await expect(seeThrough.locator('.lattice-poster-copy strong')).toHaveCount(1);
        expect(await noiseOverlay(page)).toBe('none');

        // 聚焦卡照常显示封面。
        await openCollection(page);
        const track = await visibleSlot(page, '.bravais-tile[data-library-entry]');
        await tile(page, track!).locator('article').click();
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        await expect(tile(page, track!)).not.toHaveAttribute('data-bravais-see-through', /.*/);
        expect(await tile(page, track!).locator('article').first().evaluate(element => element.style.backgroundImage)).not.toBe('');

        // 实色：没有底板、没有窗，根节点画墙面。
        expect(await runChrome(page, 'wall-look')).toBe(true);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
        await expect(plates(page)).toHaveCount(0);
        await expect(page.locator('.bravais-tile[data-bravais-see-through], .bravais-tile[data-bravais-kind="window"]')).toHaveCount(0);
        expect(await stage(page).evaluate(element => getComputedStyle(element).backgroundImage)).toContain('radial-gradient');
        // 实色档照旧有颗粒噪点（与 Lattice 一致）。
        expect(await noiseOverlay(page)).toBe('block');
    });

    test('a focus reflow redraws only its own block plate, with the holes riding on the moving windows', async ({ page }) => {
        await openCollection(page);
        await expect(plates(page).first()).toBeAttached();
        const track = await visibleSlot(page, '.bravais-tile[data-library-entry]');
        const blockKey = track!.split(',').slice(0, 2).join(',');
        // 每次块底板的路径被写：记下是哪一块，并对照洞与窗磁贴此刻的实际位置（watchPlateWrites）。
        await watchPlateWrites(page, blockKey);
        await tile(page, track!).locator('article').click();
        // 让位期间：只有聚焦的块挂着 data-bravais-plate-live；落定后摘掉。
        await expect(page.locator('[data-bravais-plate-live]')).toHaveAttribute('data-bravais-plate-block', blockKey);
        await expect(page.locator('[data-bravais-plate-live]')).toHaveCount(0, { timeout: 3_000 });
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        const result = await page.evaluate(() => ({
            writes: (window as CountWindow).__plateWrites ?? [],
            error: (window as CountWindow).__reflowError ?? [],
        }));
        // 逐帧重画的只有这一块（远多于落定时的一次），别的块一次都没重画。
        expect(new Set(result.writes)).toEqual(new Set([blockKey]));
        expect(result.writes.length).toBeGreaterThan(5);
        // 洞贴着窗磁贴走：每次写入时的误差都在 1.5 屏幕像素以内（磁贴外框与洞在同一帧里写，useBravaisReflowDriver）。
        expect(result.error.length).toBeGreaterThan(5);
        expect(Math.max(...result.error)).toBeLessThan(1.5);
    });

    test('dragging moves the block plates with the world, without redrawing them or re-rendering tiles', async ({ page }) => {
        await expect(plates(page).first()).toBeAttached();
        const field = await page.locator('.bravais-field').boundingBox();
        const x = field!.x + field!.width * 0.25;
        const y = field!.y + field!.height * 0.4;
        /** 拖一段再停稳（末尾原地停几帧，松手时没有惯性）。 */
        const drag = async (fromX: number, fromY: number, dx: number, dy: number) => {
            await page.mouse.move(fromX, fromY);
            await page.mouse.down();
            for (let step = 1; step <= 12; step += 1) await page.mouse.move(fromX + (dx * step) / 12, fromY + (dy * step) / 12);
            for (let rest = 0; rest < 3; rest += 1) {
                await page.waitForTimeout(40);
                await page.mouse.move(fromX + dx, fromY + dy);
            }
            await page.mouse.up();
        };
        // 缝开口的补间按含开口的可见范围补裁剪（B12b 修了 B12a 发现 3），挂载落定后的小幅拖动就在已裁剪的范围里，
        // 不必再先拖一段让裁剪跟上。鼠标先停到起点（进入磁贴的悬停不算拖动的开销）。
        await page.mouse.move(x, y);
        await page.waitForTimeout(500);
        await page.evaluate(() => {
            const countWindow = window as CountWindow;
            countWindow.__renderCounts = {};
            countWindow.__plateWrites = [];
            new MutationObserver((records) => {
                for (const record of records) {
                    if (record.type === 'attributes') countWindow.__plateWrites!.push('d');
                    record.addedNodes.forEach((node) => {
                        if (node instanceof Element && node.matches('[data-bravais-plate-block]')) countWindow.__plateWrites!.push('added');
                        if (node instanceof Element && node.matches('.bravais-tile')) countWindow.__plateWrites!.push('tile added');
                    });
                }
            }).observe(document.querySelector('[data-library-stage="bravais"]')!, { attributes: true, childList: true, subtree: true, attributeFilter: ['d'] });
        });
        const worldBefore = await page.locator('[data-bravais-half="right"]').evaluate(element => element.style.transform);
        const plateKey = await plates(page).first().getAttribute('data-bravais-plate-block');
        const plate = page.locator(`[data-bravais-plate-block="${plateKey}"]`);
        const firstTile = page.locator(`.bravais-tile[data-bravais-slot^="${plateKey},"]`).first();
        const boxBefore = await plate.boundingBox();
        const tileBefore = await firstTile.boundingBox();
        await drag(x, y, 72, 48);
        const worldAfter = await page.locator('[data-bravais-half="right"]').evaluate(element => element.style.transform);
        const boxAfter = await plate.boundingBox();
        const tileAfter = await firstTile.boundingBox();
        // 底板与磁贴一起随世界层平移（同一个 transform），自己什么都不写。
        expect(worldAfter).not.toBe(worldBefore);
        expect(Math.abs(boxAfter!.x - boxBefore!.x) + Math.abs(boxAfter!.y - boxBefore!.y)).toBeGreaterThan(10);
        expect(boxAfter!.x - boxBefore!.x).toBeCloseTo(tileAfter!.x - tileBefore!.x, 1);
        expect(boxAfter!.y - boxBefore!.y).toBeCloseTo(tileAfter!.y - tileBefore!.y, 1);
        const counts = await page.evaluate(() => ({ renders: (window as CountWindow).__renderCounts ?? {}, writes: (window as CountWindow).__plateWrites ?? [] }));
        // 已裁剪的范围里拖动：块底板不重画、不新挂块、不新挂磁贴（没有重新裁剪），也不重渲染。
        expect(counts.writes).toEqual([]);
        expect(counts.renders.BravaisBlockPlate ?? 0).toBe(0);
        expect(counts.renders.BravaisTile ?? 0).toBe(0);
    });
});

// fb2：窗不是墙面。聚焦卡展开时点窗（结构窗、透明档有限墙的空 slot）没有任何反应——聚焦卡仍展开、键盘焦点不动、
// 不换层不翻牌、相机不动；拖动结束在窗上也一样。实色空画框（实色档 / 无限墙的空画框）才算空白墙面，点它收起
// 聚焦卡，让位那一块沿同一条弹簧回到原位（逐帧驱动，动着的磁贴挂 data-bravais-reflowing）。

/** 中心点在视口里（避开缝与底部播放条一带）、中心点上最上层就是它自己的磁贴（按选择器挑，可排除某个块）。 */
const topmostSlot = (page: Page, selector: string, excludeBlock: string | null = null) => page.evaluate(([query, skip]) => {
    const seamRect = document.querySelector('[data-bravais-seam]')?.getBoundingClientRect();
    const tile = [...document.querySelectorAll<HTMLElement>(query)].find((element) => {
        if (skip && element.dataset.bravaisSlot!.startsWith(`${skip},`)) return false;
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (x < 40 || y < 40 || x > window.innerWidth - 40 || y > window.innerHeight - 160) return false;
        if (seamRect && seamRect.width > 0 && x > seamRect.left - 60 && x < seamRect.right + 60) return false;
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit && element.contains(hit));
    });
    return tile?.dataset.bravaisSlot ?? null;
}, [selector, excludeBlock] as const);

const blockOf = (slotKey: string) => slotKey.split(',').slice(0, 2).join(',');
const expanded = (page: Page) => page.locator('.bravais-tile[data-bravais-expanded]');
/** 让位放完：没有磁贴还挂着 data-bravais-reflowing（useBravaisReflowDriver 逐帧驱动时挂上，放完摘掉）。 */
const reflowSettled = (page: Page) => expect(page.locator('.bravais-tile[data-bravais-reflowing]')).toHaveCount(0, { timeout: 3_000 });

/** 此刻点不动的那些东西：聚焦卡、键盘焦点、DOM 焦点、换层序号、两半世界层的位置、在跑的翻牌（WAAPI）。 */
const wallSnapshot = (page: Page) => page.evaluate(() => ({
    expanded: document.querySelector<HTMLElement>('.bravais-tile[data-bravais-expanded]')?.dataset.bravaisSlot ?? null,
    focused: document.querySelector<HTMLElement>('.bravais-tile[data-bravais-focused]')?.dataset.bravaisSlot ?? null,
    active: document.activeElement?.closest<HTMLElement>('[data-bravais-slot]')?.dataset.bravaisSlot ?? document.activeElement?.className ?? null,
    shiftSeq: document.querySelector('[data-library-stage="bravais"]')?.getAttribute('data-bravais-shift-seq') ?? null,
    worlds: [...document.querySelectorAll<HTMLElement>('[data-bravais-half]')].map(element => element.style.transform),
    flips: document.getAnimations().filter(animation => typeof CSSTransition === 'undefined' || !(animation instanceof CSSTransition)).length,
}));

test.describe('[bravais] clicking a window', () => {
    test.beforeEach(async ({ mount, page }) => {
        await mountBravais(mount, page);
    });

    test('a window click (or a drag that ends on a window) leaves the focus card, the focus and the camera alone', async ({ page }) => {
        await openCollection(page);
        await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
        const track = await topmostSlot(page, '.bravais-tile[data-library-entry]');
        expect(track).not.toBeNull();
        await tile(page, track!).locator('article').click();
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        await reflowSettled(page);
        await page.waitForTimeout(400);
        const before = await wallSnapshot(page);
        expect(before).toMatchObject({ expanded: track, focused: track, flips: 0 });

        const windowSlot = await topmostSlot(page, '.bravais-tile[data-bravais-kind="window"]', blockOf(track!));
        expect(windowSlot).not.toBeNull();
        await tile(page, windowSlot!).locator('article').click();
        await page.waitForTimeout(300);
        expect(await wallSnapshot(page)).toEqual(before);
        // 也没有收起：外框上没有起过渡。
        await reflowSettled(page);

        // 在窗上按下、拖一段、松手：只是拖动（相机跟手），松手后的残余点击不收起聚焦卡、不动焦点。
        const box = (await tile(page, windowSlot!).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 8; step += 1) await page.mouse.move(x + step * 6, y + step * 4);
        await page.waitForTimeout(60);
        await page.mouse.move(x + 48, y + 32);
        await page.mouse.up();
        await page.waitForTimeout(300);
        const dragged = await wallSnapshot(page);
        expect(dragged.worlds).not.toEqual(before.worlds);
        expect({ ...dragged, worlds: before.worlds }).toEqual(before);

        // 残余点击已经吞掉：接下来点别的歌照常展开（拖动标记没有残留在窗上）。
        const other = await topmostSlot(page, '.bravais-tile[data-library-entry]:not([data-bravais-expanded])', blockOf(track!));
        expect(other).not.toBeNull();
        await tile(page, other!).locator('article').click();
        await expect(tile(page, other!)).toHaveAttribute('data-bravais-expanded', 'true');
    });

    test('folding the card back redraws only that block plate, with the holes riding on the returning windows', async ({ page }) => {
        await openCollection(page);
        await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
        const track = await topmostSlot(page, '.bravais-tile[data-library-entry]');
        expect(track).not.toBeNull();
        await tile(page, track!).locator('article').click();
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        await reflowSettled(page);
        await expect(page.locator('[data-bravais-plate-live]')).toHaveCount(0, { timeout: 3_000 });
        const blockKey = blockOf(track!);
        await watchPlateWrites(page, blockKey);
        // Esc 的第一级收起聚焦卡：这一块沿同一条弹簧归位，期间块底板与磁贴同一帧逐帧重画，放完摘掉 live。
        await page.keyboard.press('Escape');
        await expect(expanded(page)).toHaveCount(0);
        await expect(page.locator('[data-bravais-plate-live]')).toHaveAttribute('data-bravais-plate-block', blockKey);
        await expect(page.locator('[data-bravais-plate-live]')).toHaveCount(0, { timeout: 3_000 });
        await reflowSettled(page);
        const result = await page.evaluate(() => ({
            writes: (window as CountWindow).__plateWrites ?? [],
            error: (window as CountWindow).__reflowError ?? [],
        }));
        expect(new Set(result.writes)).toEqual(new Set([blockKey]));
        expect(result.writes.length).toBeGreaterThan(5);
        expect(Math.max(...result.error)).toBeLessThan(1.5);
    });

    test('a solid empty frame folds the focus card back with the reflow transition', async ({ page }) => {
        // 实色档：partial → clear → solid。
        expect(await runChrome(page, 'wall-look')).toBe(true);
        expect(await runChrome(page, 'wall-look')).toBe(true);
        await expect(stage(page)).toHaveAttribute('data-bravais-look', 'solid');
        await openCollection(page);
        await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
        // 过滤成有限拼贴：结果之外的 slot 是实色空画框。
        const title = await page.locator('.bravais-tile[data-library-entry] .lattice-poster-copy strong').first().textContent();
        await expect.poll(() => page.evaluate(query => window.__homeProbe!.setQuery(query), title!.trim())).toBe(true);
        await expect(page.locator('.bravais-tile[data-bravais-kind="wall"]').first()).toBeAttached();
        await expect(stage(page)).not.toHaveAttribute('data-bravais-settling', /.*/, { timeout: 10_000 });
        await expect(page.locator('.bravais-tile[data-bravais-kind="window"]')).toHaveCount(0);

        const track = await topmostSlot(page, '.bravais-tile[data-library-entry]');
        expect(track).not.toBeNull();
        await tile(page, track!).locator('article').click();
        await expect(tile(page, track!)).toHaveAttribute('data-bravais-expanded', 'true');
        await reflowSettled(page);
        const frame = await topmostSlot(page, '.bravais-tile[data-bravais-kind="wall"]', blockOf(track!));
        expect(frame).not.toBeNull();
        await tile(page, frame!).locator('article').click();
        await expect(expanded(page)).toHaveCount(0);
        // 收起的那一刻：原来展开的那张正在缩回原位（挂着 data-bravais-reflowing，宽度还在 6×6 与原位之间）。
        const returning = await tile(page, track!).evaluate(element => ({
            reflowing: element.hasAttribute('data-bravais-reflowing'),
            width: element.getBoundingClientRect().width,
        }));
        expect(returning.reflowing).toBe(true);
        // 放完后摘掉，宽度落到原位（比收起那一刻窄）。
        await reflowSettled(page);
        const settledWidth = await tile(page, track!).evaluate(element => element.getBoundingClientRect().width);
        expect(settledWidth).toBeLessThan(returning.width);
    });
});
