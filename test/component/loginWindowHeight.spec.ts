import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/loginWindowHeight.spec.ts
// The sign-in window keeps one height while it is open. The account of a platform and the pages of
// its playback setup are the same size, and what does not fit scrolls inside the window instead of
// making it taller. Only a real browser lays this out, so it goes through
// dev/probes/loginWindow.probe.tsx.

const VIEWPORT = { width: 1440, height: 1100 };

const size = async (page: Page) => {
    const box = await page.getByRole('dialog').boundingBox();
    if (!box) throw new Error('the sign-in window is not drawn');
    return { height: Math.round(box.height), width: Math.round(box.width) };
};

/** The size the window has once its arrival is over: it comes in a little smaller. */
const settled = async (page: Page) => {
    await expect.poll(() => page.getByRole('dialog').evaluate((panel) => {
        const transform = getComputedStyle(panel).transform;
        return transform === 'none' || transform === 'matrix(1, 0, 0, 1, 0, 0)';
    }), { timeout: 8000 }).toBe(true);
    return size(page);
};

/** The parts of the window that scroll, with how much of their own content they hide. */
const scrollers = (page: Page) => page.getByRole('dialog').evaluate((panel) => (
    Array.from(panel.querySelectorAll<HTMLElement>('*'))
        .filter(node => getComputedStyle(node).overflowY === 'auto' && node.scrollHeight > node.clientHeight + 1)
        .map(node => ({ clientHeight: node.clientHeight, scrollHeight: node.scrollHeight }))
));

test('the playback setup page leaves the sign-in window the size the account page has', async ({ page, mount }) => {
    await page.setViewportSize(VIEWPORT);
    await mount('loginWindow', { state: 'account-spotify', lang: 'zh', motion: 'off' });
    const account = await settled(page);
    expect(await scrollers(page)).toEqual([]);

    for (const state of ['setup-client', 'setup-steps', 'setup-nokey']) {
        await mount('loginWindow', { state, lang: 'zh', motion: 'off' });
        // Same window, same size: a page of it does not make it taller.
        expect(await settled(page)).toEqual(account);
        const scrolling = await scrollers(page);
        expect(scrolling.length).toBeGreaterThan(0);
        expect(scrolling[0].scrollHeight).toBeGreaterThan(scrolling[0].clientHeight);
    }
});

test('the way out of the playback setup page is reachable by scrolling', async ({ page, mount }) => {
    await page.setViewportSize(VIEWPORT);
    await mount('loginWindow', { state: 'setup-client', lang: 'zh', motion: 'off' });
    const before = await settled(page);
    const panel = page.getByRole('dialog');
    const back = panel.getByRole('button', { name: '改用 Soloist 播放' });

    // Below the fold at first, inside the window once the window's own body is scrolled.
    expect((await back.boundingBox())!.y).toBeGreaterThan(before.height);
    await back.scrollIntoViewIfNeeded();
    await expect(back).toBeInViewport();
    expect(await settled(page)).toEqual(before);
});
