import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/lattice.spec.ts
// Browser regressions for wall gestures and nested native playback controls.
const cameraX = (wall: Locator) => wall.locator('.lattice-world').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41);
// Past the end of the opening tile-landing wave, so no test measures a moving wall.
const settle = (page: Page) => page.waitForTimeout(1200);

async function dragCover(page: Page, wall: Locator) {
    const cover = wall.locator('.lattice-poster.is-expanded');
    const box = (await cover.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step++) {
        await page.mouse.move(x + step * 15, y);
        await page.waitForTimeout(16);
    }
}

/**
 * Drags the open cover and lets go, returning where the pointer was released.
 *
 * The hook drops a release more than 80ms after the last sample, and on a loaded machine a single
 * Playwright round trip can exceed that - the wall then simply never coasts. So this goes through
 * CDP and pipelines the final move with the release instead of awaiting them in turn.
 */
async function flingCover(page: Page, wall: Locator) {
    const box = (await wall.locator('.lattice-poster.is-expanded').boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    const session = await page.context().newCDPSession(page);
    const mouse = (type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', atX: number) => session.send('Input.dispatchMouseEvent', {
        type, x: atX, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1,
    });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await mouse('mousePressed', x);
    for (let step = 1; step <= 5; step++) {
        await mouse('mouseMoved', x + step * 15);
        await page.waitForTimeout(16);
    }
    const releaseX = x + 6 * 15;
    await Promise.all([mouse('mouseMoved', releaseX), mouse('mouseReleased', releaseX)]);
    await session.detach();
    return { x: releaseX, y };
}

/** Coasting only has to keep going; how far depends on the release speed, which load lowers. */
const COAST_MIN_PX = 3;

test('expanded cover drags and coasts; pressing again stops inertia', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    // Measure only after the release: a measuring round trip before it could make the sample stale.
    const release = await flingCover(page, wall);
    const released = await cameraX(wall);
    expect(released - before).toBeGreaterThan(70);
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(released + COAST_MIN_PX);
    await page.mouse.move(release.x, release.y);
    await page.mouse.down();
    const stopped = await cameraX(wall);
    await page.waitForTimeout(120);
    expect(await cameraX(wall)).toBeCloseTo(stopped, 1);
    await page.mouse.up();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(1);
});

// 触控板式的增量（单轴小于一格、或两轴同时）照旧当帧直接写进相机；鼠标滚轮的平滑见 wallWheelSmoothing.spec.ts。
test('trackpad-sized wheel deltas apply immediately without a tail and leave browser zoom intact', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    const result = await wall.locator('.lattice-field').evaluate(node => {
        const first = new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true });
        const second = new WheelEvent('wheel', { deltaX: 30, bubbles: true, cancelable: true });
        node.dispatchEvent(first);
        node.dispatchEvent(second);
        return {
            cancelled: first.defaultPrevented && second.defaultPrevented,
            x: new DOMMatrix(getComputedStyle(node.querySelector('.lattice-world')!).transform).m41,
        };
    });
    expect(result.cancelled).toBe(true);
    expect(result.x).toBeCloseTo(before - 60, 4);
    await page.waitForTimeout(300);
    expect(await cameraX(wall)).toBeCloseTo(before - 60, 0);
    expect(await wall.locator('.lattice-field').evaluate(node => {
        const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: 20, bubbles: true, cancelable: true });
        node.dispatchEvent(event);
        return event.defaultPrevented;
    })).toBe(false);
});

test('playback buttons and seek gestures do not pan; slider arrows keep native behavior', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    await wall.locator('.lattice-transport-button').click();
    await expect(wall.locator('[data-toggles]')).toHaveAttribute('data-toggles', '1');
    const input = wall.locator('input[type=range]');
    const box = (await input.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(Number(await input.inputValue())).toBeGreaterThan(90);
    await input.focus();
    const value = Number(await input.inputValue());
    await input.press('ArrowRight');
    expect(Number(await input.inputValue())).toBeGreaterThan(value);
    await settle(page);
    expect(await cameraX(wall)).toBeCloseTo(before, 1);
});

// 拆成两条、并且改用设置而不是 emulateMedia：动效不再跟随系统偏好（issue #370），
// emulateMedia 已经影响不了 fling。这里用 addInitScript 在页面脚本运行前写好 localStorage，
// store 初始化时读到的就是降级值；运行时切换开关是即时生效的，只是这个测试框架里没有入口去点它，
// 所以「降级」和「完整动效」各挂一次。
test('reduced queue collage motion disables fling', async ({ mount, page }) => {
    await page.addInitScript(() => localStorage.setItem('reduce_motion_lattice', 'true'));
    const wall = await mount('lattice');
    await settle(page);
    await dragCover(page, wall);
    await page.mouse.up();
    const released = await cameraX(wall);
    await page.waitForTimeout(150);
    expect(await cameraX(wall)).toBeCloseTo(released, 1);
});

test('cancellation never starts a fling', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await dragCover(page, wall);
    await wall.locator('.lattice-field').dispatchEvent('pointercancel', { pointerId: 1 });
    const cancelled = await cameraX(wall);
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await cameraX(wall)).toBeCloseTo(cancelled, 1);
});

test('the system preference alone no longer reduces motion', async ({ mount, page }) => {
    // #370 的回归点：系统关掉动画效果时，应用默认仍然播放完整动效。
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const wall = await mount('lattice');
    await settle(page);
    await flingCover(page, wall);
    const released = await cameraX(wall);
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(released + COAST_MIN_PX);
});

test('touch swipe coasts and a secondary pointer cannot replace the gesture', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const field = wall.locator('.lattice-field');
    const before = await cameraX(wall);
    // CDP touch input creates a native active pointer and exercises real pointer capture.
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 500, y: 250, id: 0 }] });
    for (let step = 1; step <= 5; step++) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 500 + step * 20, y: 250, id: 0 }] });
        await page.waitForTimeout(16);
    }
    await field.dispatchEvent('pointerdown', { pointerId: 99, isPrimary: false, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    // The first finger keeps moving after the secondary pointer, which also keeps the release
    // sample fresh: the hook ignores samples older than 80ms, and on a loaded machine a single CDP
    // round trip can exceed that. So the last move and the release are pipelined, not awaited in
    // turn, and the camera is measured only after the release.
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 620, y: 250, id: 0 }] });
    await page.waitForTimeout(16);
    await Promise.all([
        session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 640, y: 250, id: 0 }] }),
        session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    ]);
    const released = await cameraX(wall);
    expect(released - before).toBeGreaterThan(75);
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(released + COAST_MIN_PX);
    await session.detach();
});

test('Shift and line-mode wheels pan horizontally with normalized distance', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { shiftKey: true, deltaY: 3, deltaMode: 1 });
    // 按行的是鼠标滚轮：平滑地走过去，落定后正好 3 行。
    await expect.poll(() => cameraX(wall)).toBeCloseTo(before - 48, 1);
});

test('Tab adopts the actual poster for arrow navigation without stealing nested focus', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await page.keyboard.press('Tab');
    const tabbed = await page.evaluate(() => document.activeElement?.getAttribute('data-instance-id'));
    expect(tabbed).toBeTruthy();
    await expect(wall.locator(`.lattice-poster[data-instance-id="${tabbed}"]`)).toHaveClass(/is-focused/);
    await page.keyboard.press('ArrowRight');
    await expect(wall.locator('.lattice-poster.is-focused')).toBeFocused();
    expect(await wall.locator('.lattice-poster.is-focused').getAttribute('data-instance-id')).not.toBe(tabbed);
    await page.keyboard.press('Enter');
    const button = wall.locator('.lattice-transport-button');
    await button.focus();
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 500 });
    await page.waitForTimeout(100);
    await expect(button).toBeFocused();
});

test('Escape returns only after card focus has been cleared', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const state = wall.locator('[data-backs]');
    await wall.locator('.lattice-field').press('Escape');
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
    await expect(wall.locator('.lattice-poster.is-focused')).toHaveCount(0);
    await expect(state).toHaveAttribute('data-backs', '0');
    await wall.locator('.lattice-field').press('Escape');
    await expect(state).toHaveAttribute('data-backs', '1');
});

test('primary modifier B exits Lattice immediately', async ({ mount, page }) => {
    const wall = await mount('lattice');
    const state = wall.locator('[data-backs]');

    await page.keyboard.press('Control+b');

    await expect(state).toHaveAttribute('data-backs', '1');
});

test('Enter expands first, then plays the focused card or toggles the current song', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const state = wall.locator('[data-toggles]');
    const current = wall.locator('.lattice-poster.is-current').first();
    await current.focus();
    await current.press('Enter');
    await expect(state).toHaveAttribute('data-toggles', '1');

    const other = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await other.focus();
    await other.press('Enter');
    await expect(state).toHaveAttribute('data-toggles', '1');
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await expect(wall.locator('.lattice-poster.is-current').first()).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await other.press('Enter');
    await expect(state).toHaveAttribute('data-toggles', '1');
    await expect(wall.locator('.lattice-poster.is-current').first()).toHaveAttribute('aria-label', 'Poster 3 · Artist');
});

test('queue edits preserve the expanded song and clearing does not resurrect the selection', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.getByRole('button', { name: 'Reverse queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    const other = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await other.focus();
    await other.press('Enter');
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await wall.getByRole('button', { name: 'Reverse queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await wall.getByRole('button', { name: 'Remove poster 3', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
    await wall.getByRole('button', { name: 'Restore queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
    await wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first().press('Enter');
    await wall.getByRole('button', { name: 'Clear queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster')).toHaveCount(0);
    await wall.getByRole('button', { name: 'Restore queue', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(0);
});

test('a queue reorder moves DOM focus with the selected song', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const selected = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await selected.focus();
    // Update the queue without moving focus to the probe toolbar, as an external queue update would.
    await wall.getByRole('button', { name: 'Reverse queue', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    const focused = wall.locator('.lattice-poster.is-focused');
    await expect(focused).toHaveAttribute('aria-label', 'Poster 3 · Artist');
    await expect(focused).toBeFocused();
});

// Compare actual rendered bounds so reflowed positions, scale and camera motion are all covered.
async function expectExpandedCentered(wall: Locator) {
    await expect.poll(async () => {
        const field = (await wall.locator('.lattice-field').boundingBox())!;
        const poster = (await wall.locator('.lattice-poster.is-expanded').boundingBox())!;
        return Math.hypot(
            poster.x + poster.width / 2 - field.x - field.width / 2,
            poster.y + poster.height / 2 - field.y - field.height / 2,
        );
    }).toBeLessThan(2);
}

test('the wall opens centred on the playing song, whatever the viewport measures', async ({ mount, page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    const wall = await mount('lattice');
    await settle(page);
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await expectExpandedCentered(wall);
});

test('focused poster stays centered after expanding with Space', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await page.keyboard.press('ArrowRight');
    await expect(wall.locator('.lattice-poster.is-focused')).toBeFocused();
    await settle(page);
    await page.keyboard.press(' ');
    await expectExpandedCentered(wall);
});

test('pointer hover and keyboard focus grow every poster edge by one rendered grid gap', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await settle(page);
    const copies = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]');
    const visibleInstanceId = await copies.evaluateAll(nodes => nodes.find(node => {
        const rect = node.getBoundingClientRect();
        return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    })?.getAttribute('data-instance-id'));
    expect(visibleInstanceId).toBeTruthy();
    const poster = wall.locator(`.lattice-poster[data-instance-id="${visibleInstanceId}"]`);
    const base = (await poster.boundingBox())!;
    const worldScale = await wall.locator('.lattice-world').evaluate(node => (
        Math.abs(new DOMMatrix(getComputedStyle(node).transform).a)
    ));
    const renderedGrowth = 2 * 8 * worldScale;
    const expectGapGrowth = async () => {
        await expect.poll(async () => (await poster.boundingBox())!.width - base.width).toBeCloseTo(renderedGrowth, 1);
        await expect.poll(async () => (await poster.boundingBox())!.height - base.height).toBeCloseTo(renderedGrowth, 1);
    };

    await poster.hover();
    await expectGapGrowth();
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await poster.boundingBox())!.width).toBeCloseTo(base.width, 1);

    await poster.focus();
    await expectGapGrowth();
});

test('mouse expansion centers the reflowed card and remains interruptible by trackpad input', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').press('Escape');
    await page.keyboard.press('ArrowRight');
    await settle(page);
    await wall.locator('.lattice-poster.is-focused').click();
    await expectExpandedCentered(wall);
    await settle(page);
    const before = await cameraX(wall);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 40 });
    expect(await cameraX(wall)).toBeCloseTo(before - 40, 1);
    await settle(page);
    expect(await cameraX(wall)).toBeCloseTo(before - 40, 1);
});

test('playback follow uses the expanded card position after reflow', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const poster = wall.locator('.lattice-poster[aria-label="Poster 3 · Artist"]').first();
    await poster.focus();
    await poster.press('Enter');
    await expectExpandedCentered(wall);
    await wall.locator('.lattice-transport-button').click();
    await expect(wall.locator('input[type=range]')).toBeEnabled();
    await settle(page);
    await expectExpandedCentered(wall);
});

test('the locate button of the wall goes to the playing song', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 600, deltaY: 400 });
    // The button a collection's page has, above the wall's tools button: lit, for the song has a tile here.
    const locate = wall.locator('[data-grid-locate]');
    await expect(locate).toHaveAttribute('data-grid-locate', 'here');
    await wall.screenshot({ path: 'test-results/lattice-focus-button.png' });
    await locate.click();
    await expectExpandedCentered(wall);
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await expect(locate).toHaveAttribute('data-grid-locate-seeking', 'no');
    // The tools button under it keeps its menu, without the two entries the locate button replaced.
    await wall.getByRole('button', { name: 'Lattice tools', exact: true }).click();
    await expect(wall.getByRole('menu', { name: 'Lattice tools', exact: true })).toBeVisible();
    await expect(wall.getByRole('menuitem', { name: 'Focus current song', exact: true })).toHaveCount(0);
    await expect(wall.getByRole('menuitemcheckbox', { name: 'Auto-focus on track change', exact: true })).toHaveCount(0);
    // While no song plays there is nothing to locate, and no button.
    await wall.getByRole('button', { name: 'Clear queue', exact: true }).click();
    await expect(locate).toHaveCount(0);
});

test('the wall tool panel shares the six-cell layout and its home cell always goes home', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const root = wall.locator('[data-homes]');
    await wall.getByRole('button', { name: 'Lattice tools', exact: true }).click();
    const menu = wall.getByRole('menu', { name: 'Lattice tools', exact: true });
    // 探针没有墙面工具宿主：洗牌、主题、播放器三格跳过，队列格在但禁用；去处是「主页」。定位不是一格：它是按钮上方的定位按钮
    // （集合页的那一个），「切歌时自动聚焦」也不在面板里（开关在命令面板），所以没有「墙面」那一组。
    expect(await menu.locator('[data-wall-tools-quick]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.wallToolsQuick)))
        .toEqual(['queue', 'go-home']);
    await expect(menu.locator('[data-wall-tools-quick="queue"]')).toBeDisabled();
    await expect(menu.getByRole('slider', { name: 'Volume', exact: true })).toBeVisible();
    await expect(menu.getByRole('separator', { name: 'Wall', exact: true })).toHaveCount(0);
    await expect(menu.getByRole('menuitem', { name: 'Open queue command', exact: true })).toHaveCount(0);
    const home = menu.getByRole('menuitem', { name: 'Go to Home', exact: true });
    await expect(home).toHaveAttribute('data-wall-tools-quick', 'go-home');
    await home.click();
    await expect(root).toHaveAttribute('data-homes', '1');
    await expect(root).toHaveAttribute('data-backs', '0');
    await expect(menu).toHaveCount(0);
});

test('auto-focus toggle leaves browsing position alone until the next enabled track change', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const field = wall.locator('.lattice-field');
    // The setting is on at first. Its switch is a command of the palette; the probe has a button for it.
    const autoFocusToggle = wall.getByRole('button', { name: 'Toggle auto-focus', exact: true });

    await autoFocusToggle.click();
    await field.dispatchEvent('wheel', { deltaX: 600, deltaY: 400 });
    const browsingX = await cameraX(wall);

    await wall.getByRole('button', { name: 'Next track', exact: true }).click();
    await settle(page);
    expect(await cameraX(wall)).toBeCloseTo(browsingX, 1);
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');

    await autoFocusToggle.click();
    await wall.getByRole('button', { name: 'Next track', exact: true }).click();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveAttribute('aria-label', 'Poster 2 · Artist');
    await expectExpandedCentered(wall);
});

test('publishes when the current playing card leaves and re-enters the viewport', async ({ mount, page }) => {
    const wall = await mount('lattice');
    const visibility = wall.locator('[data-current-song-poster-visible]');
    await settle(page);
    await expect(visibility).toHaveAttribute('data-current-song-poster-visible', 'true');
    await expect(wall.locator('.z-60')).toHaveCount(0);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 1200, deltaY: 900 });
    await expect(visibility).toHaveAttribute('data-current-song-poster-visible', 'false');
    await expect(wall.locator('.z-60')).toBeVisible();
    await wall.locator('[data-grid-locate]').click();
    await expect(visibility).toHaveAttribute('data-current-song-poster-visible', 'true');
    await expect(wall.locator('.z-60')).toHaveCount(0);
});

test('chrome has three quiet controls at rest and reveals details on hover without moving seek targets', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await page.mouse.move(0, 0);
    const chrome = wall.locator('.lattice-chrome');
    await expect(chrome).not.toHaveClass(/is-revealed/);
    await expect(chrome.getByRole('button')).toHaveCount(2);
    await expect(chrome.getByRole('slider')).toHaveCount(1);
    const input = chrome.getByRole('slider');
    const before = (await input.boundingBox())!;
    await wall.screenshot({ path: 'test-results/lattice-chrome-rest.png' });
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    await expect(chrome).toHaveClass(/is-revealed/);
    await expect(chrome.getByRole('button')).toHaveCount(6);
    expect(await chrome.locator('.lattice-chrome-actions button').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action'))))
        .toEqual(['prev', 'loop', 'lyrics-timeline', 'next']);
    await expect(chrome.locator('[data-action=prev]')).toBeVisible();
    await expect(chrome.locator('[data-action=next]')).toBeVisible();
    await expect(chrome.locator('[data-action=loop]')).toBeVisible();
    await expect(chrome.locator('strong')).toHaveCount(0);
    await page.waitForTimeout(250);
    const after = (await input.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    const chromeBox = (await chrome.boundingBox())!;
    const copyBox = (await wall.locator('.is-expanded .lattice-poster-copy').boundingBox())!;
    expect(chromeBox.x).toBeCloseTo(copyBox.x, 0);
    await wall.screenshot({ path: 'test-results/lattice-chrome-revealed.png' });
    await page.mouse.move(0, 0);
    await expect(chrome).not.toHaveClass(/is-revealed/);
    await wall.locator('.lattice-field').press('Escape');
    await expect(wall.locator('.is-expanded')).toHaveCount(0);
});

test('touch taps reveal and dismiss chrome, while a touch drag leaves it collapsed', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const session = await page.context().newCDPSession(page);
    const box = (await wall.locator('.is-expanded').boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 3, id: 0 };
    for (const revealed of [true, false]) {
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await expect(wall.locator('.lattice-chrome')).toHaveClass(revealed ? /is-revealed/ : /^lattice-chrome\s*$/);
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point, x: point.x + 80 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(wall.locator('.lattice-chrome')).not.toHaveClass(/is-revealed/);
    await session.detach();
});

test('the player shortcut remains reachable on a narrow touch screen', async ({ mount, page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('[data-grid-locate]').click();
    await expectExpandedCentered(wall);
    await expect(wall.locator('.lattice-secondary-action')).toBeVisible();
    const shortcutBox = (await wall.locator('.lattice-secondary-action').boundingBox())!;
    expect(shortcutBox.width).toBeGreaterThanOrEqual(44);
    expect(shortcutBox.height).toBeGreaterThanOrEqual(44);
    await wall.screenshot({ path: 'test-results/lattice-chrome-mobile.png' });
});

test('expanded chrome operates next, previous and all three loop modes', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const chrome = wall.locator('.lattice-chrome');
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    await chrome.getByRole('button', { name: 'Next track', exact: true }).click();
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 1 · Artist');
    await expectExpandedCentered(wall);
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    await chrome.getByRole('button', { name: 'Previous track', exact: true }).click();
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await expectExpandedCentered(wall);
    // 循环按钮的名字跟随当前模式（Loop all / Loop one / Loop off），所以按 data-action 找它。
    const loop = chrome.locator('[data-action=loop]');
    for (const [mode, name] of [['one', 'Loop one'], ['off', 'Loop off'], ['all', 'Loop all']]) {
        await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
        await loop.click();
        await expect(wall.locator('[data-loop]')).toHaveAttribute('data-loop', mode);
        await expect(loop).toHaveAttribute('aria-pressed', String(mode !== 'off'));
        await expect(loop).toHaveAccessibleName(name);
    }
});

test('expanded chrome uses the configured main-bar slot to open volume', async ({ mount, page }) => {
    await page.addInitScript(() => {
        localStorage.setItem('player_control_slot_primary', 'prev');
        localStorage.setItem('player_control_slot_secondary', 'volume');
    });
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.is-expanded').hover({ position: { x: 100, y: 80 } });
    expect(await wall.locator('.lattice-chrome-actions button').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-action'))))
        .toEqual(['prev', 'prev', 'volume', 'next']);
    await wall.locator('.lattice-chrome [data-action=volume]').click();
    await expect(wall.locator('[data-command]')).toHaveAttribute('data-command', 'playback-volume');
    await expect(wall.locator('.lattice-chrome [data-action=lyrics-timeline]')).toHaveCount(0);
});

test('pause, resume and duration updates re-render no poster', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const transport = wall.locator('.lattice-poster.is-expanded .lattice-transport-button');
    const playing = await transport.getAttribute('aria-label');
    await expect(wall.locator('.lattice-poster')).not.toHaveCount(0);

    const counts = () => page.evaluate(() => (window as unknown as { __renderCounts: Record<string, number> }).__renderCounts);
    const resetCounts = () => page.evaluate(() => { (window as unknown as { __renderCounts: Record<string, number> }).__renderCounts = {}; });
    // Armed after the wall has settled so the opening wave's own renders are not counted. On a
    // loaded machine the wave can still be re-rendering posters after `settle`, so wait for a quiet
    // 300ms window rather than trusting the fixed wait. Renders that never stop still fail here.
    await expect.poll(async () => {
        await resetCounts();
        await page.waitForTimeout(300);
        return (await counts()).LatticePoster ?? 0;
    }, { intervals: [0], timeout: 10_000 }).toBe(0);
    await resetCounts();
    await wall.getByRole('button', { name: 'Toggle player state' }).click();
    await wall.getByRole('button', { name: 'Bump duration' }).click();

    // The expanded card's chrome still follows the transport...
    await expect(transport).not.toHaveAttribute('aria-label', playing!);
    // ...and the update reached it through the wall, not around it.
    expect((await counts()).Lattice ?? 0).toBeGreaterThan(0);
    expect((await counts()).LatticePoster ?? 0).toBe(0);
});

// bravais 的集合叠页边（--lattice-poster-elevation 接进共享海报的阴影列表）与缝的叠色 / 熄灯只在 bravais 的样式里：
// Lattice 的海报仍是四条阴影（三条透明的聚焦环位 + 抬升投影），没有向右下错开的页边。
test('Lattice posters keep their own shadow list without bravais stack edges', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const shadows = await wall.locator('.lattice-poster:not(.is-expanded):not(.is-focused)').first().evaluate((node) => {
        const text = getComputedStyle(node).boxShadow;
        return text.split(/,(?![^(]*\))/).map(part => part.trim());
    });
    expect(shadows).toHaveLength(4);
    expect(shadows.some(part => /\b3px 3px\b|\b6px 6px\b/.test(part))).toBe(false);
});
