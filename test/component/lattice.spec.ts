import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/lattice.spec.ts
// Browser regressions for wall gestures and nested native playback controls.
const cameraX = (wall: Locator) => wall.locator('.lattice-world').evaluate(node => new DOMMatrix(getComputedStyle(node).transform).m41);
const settle = (page: Page) => page.waitForTimeout(650);

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

test('expanded cover drags and coasts; pressing again stops inertia', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    await dragCover(page, wall);
    const dragged = await cameraX(wall);
    expect(dragged - before).toBeGreaterThan(70);
    await page.mouse.up();
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(dragged + 10);
    await page.mouse.down();
    const stopped = await cameraX(wall);
    await page.waitForTimeout(120);
    expect(await cameraX(wall)).toBeCloseTo(stopped, 1);
    await page.mouse.up();
    await expect(wall.locator('.lattice-poster.is-expanded')).toHaveCount(1);
});

test('wheel applies exact deltas immediately without a tail and leaves browser zoom intact', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    const result = await wall.locator('.lattice-field').evaluate(node => {
        const first = new WheelEvent('wheel', { deltaX: 60, bubbles: true, cancelable: true });
        const second = new WheelEvent('wheel', { deltaX: 60, bubbles: true, cancelable: true });
        node.dispatchEvent(first);
        node.dispatchEvent(second);
        return {
            cancelled: first.defaultPrevented && second.defaultPrevented,
            x: new DOMMatrix(getComputedStyle(node.querySelector('.lattice-world')!).transform).m41,
        };
    });
    expect(result.cancelled).toBe(true);
    expect(result.x).toBeCloseTo(before - 120, 4);
    await page.waitForTimeout(300);
    expect(await cameraX(wall)).toBeCloseTo(before - 120, 0);
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

test('reduced motion disables fling and cancellation never starts one', async ({ mount, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const wall = await mount('lattice');
    await settle(page);
    await dragCover(page, wall);
    await page.mouse.up();
    const released = await cameraX(wall);
    await page.waitForTimeout(150);
    expect(await cameraX(wall)).toBeCloseTo(released, 1);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await dragCover(page, wall);
    await wall.locator('.lattice-field').dispatchEvent('pointercancel', { pointerId: 1 });
    const cancelled = await cameraX(wall);
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await cameraX(wall)).toBeCloseTo(cancelled, 1);
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
    const dragged = await cameraX(wall);
    expect(dragged - before).toBeGreaterThan(75);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    expect(await cameraX(wall)).toBeGreaterThan(dragged + 10);
    await session.detach();
});

test('Shift and line-mode wheels pan horizontally with normalized distance', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    const before = await cameraX(wall);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { shiftKey: true, deltaY: 3, deltaMode: 1 });
    await page.waitForTimeout(300);
    expect(await cameraX(wall)).toBeCloseTo(before - 48, 0);
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

for (const key of ['Enter', ' ']) {
    test(`focused poster stays centered after expanding with ${key === ' ' ? 'Space' : key}`, async ({ mount, page }) => {
        const wall = await mount('lattice');
        await settle(page);
        await wall.locator('.lattice-field').press('Escape');
        await page.keyboard.press('ArrowRight');
        await expect(wall.locator('.lattice-poster.is-focused')).toBeFocused();
        await settle(page);
        await page.keyboard.press(key);
        await expectExpandedCentered(wall);
    });
}

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

test('wall panel focuses the current song and Escape only dismisses the panel', async ({ mount, page }) => {
    const wall = await mount('lattice');
    await settle(page);
    await wall.locator('.lattice-field').dispatchEvent('wheel', { deltaX: 600, deltaY: 400 });
    const toggle = wall.getByRole('button', { name: 'Wall controls', exact: true });
    await toggle.click();
    await expect(wall.getByRole('dialog', { name: 'Wall controls' })).toBeVisible();
    await wall.screenshot({ path: 'test-results/lattice-panel.png' });
    await page.keyboard.press('Escape');
    await expect(wall.getByRole('dialog')).toHaveCount(0);
    await expect(toggle).toBeFocused();
    await expect(wall.locator('.is-expanded')).toHaveCount(1);
    await toggle.click();
    await wall.getByRole('button', { name: 'Focus current song', exact: true }).click();
    await expectExpandedCentered(wall);
    await expect(wall.getByRole('dialog')).toHaveCount(0);
    await expect(wall.locator('.is-expanded')).toHaveAttribute('aria-label', 'Poster 0 · Artist');
    await wall.getByRole('button', { name: 'Clear queue', exact: true }).click();
    await toggle.click();
    await expect(wall.getByRole('button', { name: 'Focus current song', exact: true })).toBeDisabled();
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
    await expect(chrome.getByRole('button')).toHaveCount(3);
    await page.waitForTimeout(250);
    const after = (await input.boundingBox())!;
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    await wall.screenshot({ path: 'test-results/lattice-chrome-revealed.png' });
    await page.mouse.move(0, 0);
    await expect(chrome).not.toHaveClass(/is-revealed/);
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
    await wall.getByRole('button', { name: 'Wall controls', exact: true }).click();
    await wall.getByRole('button', { name: 'Focus current song', exact: true }).click();
    await expectExpandedCentered(wall);
    await expect(wall.locator('.lattice-secondary-action')).toBeVisible();
    const shortcutBox = (await wall.locator('.lattice-secondary-action').boundingBox())!;
    expect(shortcutBox.width).toBeGreaterThanOrEqual(44);
    expect(shortcutBox.height).toBeGreaterThanOrEqual(44);
    await wall.screenshot({ path: 'test-results/lattice-chrome-mobile.png' });
});
