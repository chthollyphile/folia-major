import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/playerBottomBar.spec.ts
// 底部基线的定位模式。这里覆盖的都是只有真实浏览器才暴露的东西：拖动写 MotionValue 后
// bottom 是否真的生效、定位模式下 pointer-events 有没有真的挡住 seek、
// 以及可自定义槽位点下去到底调了谁。见 dev/probes/playerBottomBar.probe.tsx。

const ROOT = '[data-probe-positioning]';
const CAPSULE = '.rounded-full.cursor-pointer, .rounded-full.cursor-grab';

const offsetOf = (page: Page) => page.locator(ROOT).getAttribute('data-probe-offset');

async function enterPositioning(page: Page): Promise<void> {
    await page.locator('[data-probe-action="start"]').click();
    await expect(page.locator(ROOT)).toHaveAttribute('data-probe-positioning', 'on');
}

/** 播放入口写进探针页用的同一份 store；路径放变量里，免得类型检查去解析浏览器里的模块地址。 */
async function setPlaybackEntryView(page: Page, view: 'player' | 'lattice'): Promise<void> {
    await page.evaluate(async (next) => {
        const modulePath = '/src/stores/usePlaybackEntryViewStore.ts';
        const { usePlaybackEntryViewStore } = await import(modulePath);
        usePlaybackEntryViewStore.getState().setPlaybackEntryView(next);
    }, view);
}

/** 命令面板被请求打开过几次（探针里没有面板，请求本身就是它会打开的证据）。 */
async function paletteRequestSeq(page: Page): Promise<number> {
    return page.evaluate(async () => {
        const modulePath = '/src/stores/useAppViewStore.ts';
        const { useAppViewStore } = await import(modulePath);
        return useAppViewStore.getState().commandPaletteRequest.seq as number;
    });
}

/** 等胶囊的 layout spring 停下来，否则量到的是动画中间帧 */
async function settleCapsule(page: Page): Promise<void> {
    const capsule = page.locator(CAPSULE).first();
    let previous = -1;
    for (let attempt = 0; attempt < 40; attempt += 1) {
        const box = (await capsule.boundingBox())!;
        if (Math.abs(box.y - previous) < 0.5) {
            return;
        }
        previous = box.y;
        await page.waitForTimeout(50);
    }
}

/** 从胶囊中心往上拖 delta 像素 */
async function dragCapsuleUp(page: Page, delta: number): Promise<void> {
    const box = (await page.locator(CAPSULE).first().boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    // 分几步移动，framer-motion 的 drag 需要真实的中间 pointermove 才会启动
    for (let step = 1; step <= 5; step += 1) {
        await page.mouse.move(x, y - (delta * step) / 5);
    }
    await page.mouse.up();
}

test.beforeEach(async ({ mount }) => {
    await mount('playerBottomBar');
});

test.describe('player bottom bar positioning', () => {
    test('starts at the original bottom-8 baseline', async ({ page }) => {
        expect(await offsetOf(page)).toBe('32');
    });

    test('dragging up raises the shared offset by exactly the drag distance', async ({ page }) => {
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        expect(Number(await offsetOf(page))).toBe(32 + 120);
    });

    test('the capsule moves once, not twice, for a given drag', async ({ page }) => {
        // 回归：胶囊自身的 transform 和外层 lift 如果都在表达同一段位移，屏幕上会走两倍距离。
        await enterPositioning(page);
        await settleCapsule(page);
        const before = (await page.locator(CAPSULE).first().boundingBox())!;
        await dragCapsuleUp(page, 120);
        await settleCapsule(page);
        const after = (await page.locator(CAPSULE).first().boundingBox())!;
        expect(before.y - after.y).toBeGreaterThan(110);
        expect(before.y - after.y).toBeLessThan(130);
    });

    test('lifting never introduces a transform on the capsule ancestry', async ({ page }) => {
        // 回归：一开始位移是用 style.y 做的，非零 transform 会新建 stacking context 并提升
        // 合成层，backdrop-blur 的采样根和字幕辉光的混合方式随之改变 —— 表现为「拖完之后
        // 透明度变了」。位置改由 bottom 表达后，拖动不应该让祖先链上多出任何 transform。
        const transformedAncestors = async () => page.evaluate((selector) => {
            let node = document.querySelector(selector)?.parentElement ?? null;
            let count = 0;
            while (node && node !== document.documentElement) {
                if (getComputedStyle(node).transform !== 'none') {
                    count += 1;
                }
                node = node.parentElement;
            }
            return count;
        }, CAPSULE);
        const before = await transformedAncestors();
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        await settleCapsule(page);
        expect(await transformedAncestors()).toBe(before);
    });

    test('the capsule stays horizontally centred after lifting', async ({ page }) => {
        // 回归：定位层和动画层一度被合并成一个节点，framer-motion 的 animate 会写 transform，
        // 整个盖掉同一节点上 Tailwind 的 -translate-x-1/2，胶囊就丢了居中向右偏出去。
        const centreOffset = async () => {
            const box = (await page.locator(CAPSULE).first().boundingBox())!;
            const viewport = page.viewportSize()!;
            return Math.abs((box.x + box.width / 2) - viewport.width / 2);
        };

        expect(await centreOffset()).toBeLessThan(2);
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        await settleCapsule(page);
        expect(await centreOffset()).toBeLessThan(2);
    });

    test('the song card and panel button ride the same baseline', async ({ page }) => {
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        // 这些组件共用同一个 MotionValue，偏移量即为共享结果。
        expect(Number(await offsetOf(page))).toBe(152);
    });

    test('other-page bottom actions use the same lift', async ({ page }) => {
        const action = page.getByTestId('grid-list-search-button');
        const providerSwitcher = page.getByTestId('online-provider-switcher');
        await expect(action).toBeVisible();
        await expect(providerSwitcher).toBeVisible();
        await page.waitForTimeout(300);
        const before = (await action.boundingBox())!;
        const providerBefore = (await providerSwitcher.boundingBox())!;
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        const after = (await action.boundingBox())!;
        const providerAfter = (await providerSwitcher.boundingBox())!;

        expect(before.y - after.y).toBeCloseTo(120, 0);
        expect(providerBefore.y - providerAfter.y).toBeCloseTo(120, 0);
    });

    test('the offset never drops below the baseline when dragged down', async ({ page }) => {
        await enterPositioning(page);
        const box = (await page.locator(CAPSULE).first().boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 5; step += 1) {
            await page.mouse.move(x, y + 40 * step);
        }
        await page.mouse.up();
        expect(Number(await offsetOf(page))).toBe(32);
    });

    test('seeking is dead while positioning', async ({ page }) => {
        await enterPositioning(page);
        // 定位模式下整块内容 pointer-events:none，点在进度条上不应该产生 seek
        await page.locator(CAPSULE).first().click({ position: { x: 200, y: 60 }, force: true });
        expect(await page.locator(ROOT).getAttribute('data-probe-seeks')).toBe('0');
    });

    test('committing writes the dragged offset back', async ({ page }) => {
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        const dragged = Number(await offsetOf(page));
        await page.getByRole('button', { name: /save|保存/i }).click();
        await expect(page.locator(ROOT)).toHaveAttribute('data-probe-positioning', 'off');
        expect(Number(await page.locator(ROOT).getAttribute('data-probe-committed'))).toBe(dragged);
    });

    test('escape cancels and rolls the offset back', async ({ page }) => {
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        await page.keyboard.press('Escape');
        await expect(page.locator(ROOT)).toHaveAttribute('data-probe-positioning', 'off');
        expect(await offsetOf(page)).toBe('32');
    });
});

test.describe('capsule navigation', () => {
    test('clicking the seek control does not activate capsule navigation', async ({ page }) => {
        await page.locator(CAPSULE).first().hover();
        await page.locator('input[type="range"]').click({ position: { x: 120, y: 3 } });

        expect(Number(await page.locator(ROOT).getAttribute('data-probe-seeks'))).toBeGreaterThan(0);
        await expect(page.locator(ROOT)).toHaveAttribute('data-probe-player-navigations', '0');
    });

    test('clicking the capsule hot area activates its configured destination', async ({ page }) => {
        // 播放入口设成歌曲墙时，播放页上点胶囊仍然去墙；只有本来是空操作的那一下才改成开命令面板。
        await setPlaybackEntryView(page, 'lattice');
        const capsule = page.locator(CAPSULE).first();
        await expect(capsule).toBeVisible();

        // Hit the capsule padding rather than the transparent range input.
        await capsule.click({ position: { x: 20, y: 2 } });

        await expect(page.locator(ROOT)).toHaveAttribute('data-probe-player-navigations', '1');
        expect(await paletteRequestSeq(page)).toBe(0);
    });

    test('on the player page the capsule hot area opens the command palette instead', async ({ page }) => {
        await setPlaybackEntryView(page, 'player');
        const capsule = page.locator(CAPSULE).first();
        await expect(capsule).toBeVisible();

        await capsule.click({ position: { x: 20, y: 2 } });

        await expect.poll(() => paletteRequestSeq(page)).toBe(1);
        await expect(page.locator(ROOT)).toHaveAttribute('data-probe-player-navigations', '0');
    });

    test('a touch tap on the collapsed capsule only unfolds it', async ({ page }) => {
        await setPlaybackEntryView(page, 'player');
        // 触屏上点收起的胶囊是展开它的手势：按下时胶囊还收着，这一下不能直接弹出命令面板。
        await page.locator(CAPSULE).first().evaluate(element => {
            element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch', pointerId: 7 }));
            element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch', pointerId: 7 }));
            (element as HTMLElement).click();
        });

        expect(await paletteRequestSeq(page)).toBe(0);
    });
});

test.describe('bottom subtitle', () => {
    const SUBTITLE = '[data-probe-subtitle-host] .absolute.left-0.right-0';

    const subtitleBottom = (page: Page) => page.locator(SUBTITLE)
        .evaluate(el => Number.parseFloat(getComputedStyle(el).bottom));

    test('sits one capsule clearance above the baseline by default', async ({ page }) => {
        expect(await subtitleBottom(page)).toBeCloseTo(112, 0);
    });

    test('follows the baseline while dragging, without lagging behind', async ({ page }) => {
        // 抬高量必须跟手：字幕若走 spring 会落后于另外三个组件，看起来不同步
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        expect(await subtitleBottom(page)).toBeCloseTo(112 + 120, 0);
    });

    test('eases to the baseline when the control bar leaves, rather than jumping', async ({ page }) => {
        // 回归：bottom 从 animate 挪到 style 时丢过 spring，让位变成瞬间跳变
        await page.locator('[data-probe-action="toggle-chrome"]').click();

        const samples = await page.evaluate(async (selector) => {
            const el = document.querySelector(selector)!;
            const seen: number[] = [];
            const start = performance.now();
            while (performance.now() - start < 800) {
                seen.push(Number.parseFloat(getComputedStyle(el).bottom));
                await new Promise(requestAnimationFrame);
            }
            return seen;
        }, SUBTITLE);

        // 跳变的话中间值恰好是 0 个（同一帧内从 112 直接到 32），所以只要采到中间态就说明有过渡。
        // 阈值取 2 而不是更大，是为了在并行跑、掉帧的机器上也不误报。
        const intermediate = samples.filter(v => v > 33 && v < 111);
        expect(intermediate.length).toBeGreaterThanOrEqual(2);
        expect(samples[samples.length - 1]).toBeCloseTo(32, 0);
    });
});

test.describe('preview isolation', () => {
    const PREVIEW = '[data-probe-subtitle-preview] .absolute.left-0.right-0';

    test('a subtitle outside the player tree ignores the lifted baseline', async ({ page }) => {
        // 同一个字幕组件也长在 VisPlayground、Theme Park 预览和 OBS 浏览器源里。
        // 它们没有底栏，读播放页的偏移量只会让预览莫名其妙地抬高。
        const previewBottom = () => page.locator(PREVIEW)
            .evaluate(el => Number.parseFloat(getComputedStyle(el).bottom));

        expect(await previewBottom()).toBeCloseTo(112, 0);
        await enterPositioning(page);
        await dragCapsuleUp(page, 120);
        expect(await previewBottom()).toBeCloseTo(112, 0);
    });
});

test.describe('player control slots', () => {
    test('default slots still run loop and the lyrics timeline', async ({ page }) => {
        await page.locator(CAPSULE).first().hover();
        // 循环按钮的名字跟随当前模式，不再是固定的"循环模式"。
        await page.getByRole('button', { name: /^(loop (all|one|off)|列表循环|单曲循环|关闭循环)$/i }).click();
        expect(await page.locator(ROOT).getAttribute('data-probe-slot-hits')).toBe('loop');
    });

    test('a reassigned slot runs the new action', async ({ page }) => {
        await page.locator('[data-probe-action="slot-like"]').click();
        await page.locator(CAPSULE).first().hover();
        await page.getByRole('button', { name: /^(like|喜爱)$/i }).click();
        expect(await page.locator(ROOT).getAttribute('data-probe-slot-hits')).toBe('like');
    });

    test('an interface slot goes grey when its command is unavailable', async ({ page }) => {
        // 首页、Personal FM 等场景下这些命令跑不起来；按钮必须置灰，
        // 而不是可点但静默无响应。
        await page.locator('[data-probe-action="slot-queue"]').click();
        await page.locator('[data-probe-action="block-commands"]').click();
        await page.locator(CAPSULE).first().hover();

        const queueButton = page.getByRole('button', { name: /play queue|播放队列/i });
        await expect(queueButton).toBeDisabled();
        await queueButton.click({ force: true });
        expect(await page.locator(ROOT).getAttribute('data-probe-slot-hits')).toBe('');
    });

    test('an interface slot goes through the command palette, not a panel tab', async ({ page }) => {
        await page.locator('[data-probe-action="slot-queue"]').click();
        await page.locator(CAPSULE).first().hover();
        await page.getByRole('button', { name: /play queue|播放队列/i }).click();
        expect(await page.locator(ROOT).getAttribute('data-probe-slot-hits')).toBe('cmd:queue');
    });
});
