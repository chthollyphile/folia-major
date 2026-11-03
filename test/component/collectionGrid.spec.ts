import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/collectionGrid.spec.ts
// 歌单页（GridView）。一，歌曲分批到达时不挪动视图：在线歌单一页一页读，YouTube Music 一页
// 只有 15 或 100 首，每到一页就把视图拉回某张卡片的话，听的人滚到哪儿都会被拽回去。
// 二，页面自己的定位按钮（网格右下角一个，列表面板里一个）：只在这一页已有的卡片里找，按下就回答。
// 有就把卡片移到中央，整张读完了却没有就说没有，还没读完就说没读完；不等，也不去别的歌单。
// 三，“回到开始播放的歌单”（播放器封面上的按钮做的事）：换到队列开始的那一张去找。那一页的歌是它
// 自己一页一页读的，读到之前不说“没有”。

// Where the grid has been moved to: the offset of the layer that holds the cards.
const place = (page: Page) => page.evaluate(() => {
    const layer = document.querySelector('[data-grid-canvas]');
    if (!layer) return null;
    const matrix = new DOMMatrix(getComputedStyle(layer).transform);
    return [Math.round(matrix.m41), Math.round(matrix.m42)];
});
// The grid has come to rest (its springs, and the focus that follows them).
const rest = async (page: Page) => {
    let before = await place(page);
    await expect.poll(async () => {
        await page.waitForTimeout(350);
        const now = await place(page);
        const still = JSON.stringify(now) === JSON.stringify(before);
        before = now;
        return still;
    }).toBe(true);
    return before!;
};
// The title of the card nearest the middle of the grid.
const centred = (page: Page) => page.evaluate(() => {
    const frame = document.querySelector('[data-grid-canvas]')?.parentElement?.getBoundingClientRect();
    if (!frame) return '';
    let nearest = '';
    let least = Infinity;
    for (const card of document.querySelectorAll('[data-folia-grid-item-id]')) {
        const box = card.getBoundingClientRect();
        const distance = Math.hypot(box.left + box.width / 2 - frame.left - frame.width / 2, box.top + box.height / 2 - frame.top - frame.height / 2);
        if (distance < least) {
            least = distance;
            nearest = /Track \d{3,}/.exec(card.textContent ?? '')?.[0] ?? '';
        }
    }
    return nearest;
});

test('a collection stays where the listener scrolled to when further tracks arrive', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    const add = component.locator('[data-probe-add-page]');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    expect(await rest(page)).toEqual([0, 0]);
    expect(await centred(page)).toBe('Track 000');

    // Scrolled away from the first card, and at rest there.
    await page.mouse.move(640, 420);
    await page.mouse.wheel(0, 300);
    const away = await rest(page);
    expect(away[1]).toBeLessThan(-200);

    // A page of further tracks moves nothing: the same card is in the middle, at the same place.
    const awayCard = await centred(page);
    await add.click();
    await expect(component.locator('[data-probe-tracks="55"]')).toHaveCount(1);
    expect(await rest(page)).toEqual(away);
    expect(await centred(page)).toBe(awayCard);

    // Nor does one that arrives while the listener is still scrolling: the grid goes on to where the wheel sent it.
    await page.mouse.move(640, 420);
    await page.mouse.wheel(0, -160);
    await add.click();
    await expect(component.locator('[data-probe-tracks="70"]')).toHaveCount(1);
    const further = await rest(page);
    expect(further[1]).toBeGreaterThan(away[1] + 100);
    expect(further[1]).toBeLessThan(0);

    // A window that crosses a size breakpoint spaces the cards anew: the card that was in the middle still is.
    const middle = await centred(page);
    expect(middle).not.toBe('Track 000');
    await page.setViewportSize({ width: 2100, height: 1000 });
    const spaced = await rest(page);
    expect(spaced).not.toEqual(further);
    expect(await centred(page)).toBe(middle);
});

test('the locate button brings the card of the playing song to the middle, and says when the page does not hold it', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    const locate = page.locator('[data-grid-locate]');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    // Nothing plays: there is nothing to locate.
    await expect(locate).toHaveCount(0);

    // A song of this page plays: the button is lit, and a press centres its card.
    await component.locator('[data-probe-play="30"]').click();
    await expect(locate).toHaveAttribute('data-grid-locate', 'here');
    await expect(locate).toHaveAttribute('title', 'Locate the playing song on this page');
    expect(await centred(page)).toBe('Track 000');
    await locate.click();
    await expect.poll(() => centred(page)).toBe('Track 030');
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    await rest(page);
    expect(await centred(page)).toBe('Track 030');

    // A song that is in no page: the button is not lit, and a press says so and moves nothing.
    await component.locator('[data-probe-play="900"]').click();
    await expect(locate).toHaveAttribute('data-grid-locate', 'elsewhere');
    await locate.click();
    await expect(component.locator('[data-probe-status="The playing song is not in this list"]')).toHaveCount(1);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    expect(await centred(page)).toBe('Track 030');

    // A song that a later page brings, asked for while pages still arrive: the page does not
    // wait. It says at once that its list is not whole, and moves nothing.
    await component.locator('[data-probe-arriving]').click();
    await component.locator('[data-probe-play="60"]').click();
    await expect(locate).toHaveAttribute('data-grid-locate', 'elsewhere');
    await locate.click();
    await expect(component.locator(`[data-probe-status="${NOT_WHOLE}"]`)).toHaveCount(1);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    await expect(locate).toHaveAttribute('data-grid-locate-seeking', 'no');
    expect(await said(component)).toBe(`${NOT_HERE} | ${NOT_WHOLE}`);
    expect(await centred(page)).toBe('Track 030');
    // Nor does it answer later, when the pages come: the card is centred when the listener asks again.
    await component.locator('[data-probe-add-page]').click();
    await component.locator('[data-probe-add-page]').click();
    await expect(locate).toHaveAttribute('data-grid-locate', 'here');
    await page.waitForTimeout(400);
    expect(await centred(page)).toBe('Track 030');
    await locate.click();
    await expect.poll(() => centred(page)).toBe('Track 060');
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    expect(await said(component)).toBe(`${NOT_HERE} | ${NOT_WHOLE}`);

    // A question put to the page of another collection is not this page's to answer.
    await component.locator('[data-probe-ask-another]').click();
    await page.waitForTimeout(400);
    await expect(component.locator('[data-probe-request="asked"]')).toHaveCount(1);
    expect(await centred(page)).toBe('Track 060');
});

test('the list of the page has the same button: it finds the playing song on this page, in the list and in the grid', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    await component.locator('[data-probe-play="30"]').click();
    await page.getByRole('button', { name: 'View tracks' }).click();
    const list = page.getByTestId('side-panel-list');
    const locate = list.locator('[data-list-locate]');
    await expect(locate).toHaveAttribute('data-list-locate', 'here');
    await expect(locate).toHaveAttribute('title', 'Locate the playing song on this page');
    // The list opens on the card the grid stands on, far from the song.
    await expect(list.getByText('Track 000', { exact: true })).toBeVisible();
    await expect(list.getByText('Track 030', { exact: true })).toHaveCount(0);
    await locate.click();
    await expect(list.getByText('Track 030', { exact: true })).toBeVisible();
    await expect.poll(() => centred(page)).toBe('Track 030');
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);

    // The listener scrolls the list away; the grid still stands on the song's card. Asked again, the list comes back to its row.
    await list.locator('.custom-scrollbar').evaluate(element => { element.scrollTop = 0; });
    await expect(list.getByText('Track 030', { exact: true })).toHaveCount(0);
    await locate.click();
    await expect(list.getByText('Track 030', { exact: true })).toBeVisible();

    // A song this page does not hold: it says so, as the button over the grid does, and goes nowhere.
    await component.locator('[data-probe-play="900"]').click();
    await expect(locate).toHaveAttribute('data-list-locate', 'elsewhere');
    await locate.click();
    await expect(component.locator(`[data-probe-status="${NOT_HERE}"]`)).toHaveCount(1);
    await expect(component.locator('[data-probe-open="given"]')).toHaveCount(1);

    // Under a filter the grid has ten cards (Track 030 to 039) and the list still has every track.
    // The song is the sixth of those cards and the thirty-sixth row of the list: the list goes to
    // its own row of it, not to its sixth.
    await component.locator('[data-probe-filter]').click();
    await expect(page.locator('[data-folia-grid-item-id]')).toHaveCount(10);
    await component.locator('[data-probe-play="35"]').click();
    await list.locator('.custom-scrollbar').evaluate(element => { element.scrollTop = 0; });
    await expect(list.getByText('Track 035', { exact: true })).toHaveCount(0);
    await locate.click();
    await expect.poll(() => centred(page)).toBe('Track 035');
    await expect(list.getByText('Track 035', { exact: true })).toBeVisible();
    await expect(list.getByText('Track 005', { exact: true })).toHaveCount(0);
});

test('a press on a long list answers at once', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    const locate = page.locator('[data-grid-locate]');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    await component.locator('[data-probe-many]').click();
    await expect(component.locator('[data-probe-tracks="3000"]')).toHaveCount(1);
    // Its last song but one plays: its card is 2998 cards from the one the grid stands on.
    await component.locator('[data-probe-play="2998"]').click();
    await expect(locate).toHaveAttribute('data-grid-locate', 'here');
    await rest(page);
    const pressed = Date.now();
    await locate.click();
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    const answered = Date.now() - pressed;
    await expect.poll(() => centred(page)).toBe('Track 2998');
    const centredAfter = Date.now() - pressed;
    console.log(`[collectionGrid] 3000 tracks: answered ${answered} ms after the press, card in the middle after ${centredAfter} ms`);
    // The answer is what must not wait (measured 151 ms in this development build, the press
    // included); the card then travels to the middle on a spring (measured 526 ms).
    expect(answered).toBeLessThan(1000);
    expect(centredAfter).toBeLessThan(4000);
});

// The queue was started from another collection, whose page reads its tracks itself, a page at a time.
const NOT_HERE = 'The playing song is not in this list';
const NOT_WHOLE = 'This list is not fully loaded yet, so the song cannot be located';
// What the player's "playing from" does: back to the collection the queue was started from.
const goToSource = (component: Locator) => component.locator('[data-probe-go-to-source]').click();
// Every status line shown since the probe opened, joined.
const said = (component: Locator) => component.locator('[data-probe-said]').getAttribute('data-probe-said');
// How many of that collection's 70 tracks its page has been given.
const read = async (component: Locator) => Number(await component.locator('[data-probe-read]').getAttribute('data-probe-read'));
// Lets the page reads that are held go, round after round, until `done`; `each` looks after every round.
const releaseUntil = async (page: Page, component: Locator, done: () => Promise<boolean>, each: () => Promise<void> = async () => {}) => {
    for (let round = 0; round < 80; round += 1) {
        if (await done()) return;
        const button = component.locator('[data-probe-release]');
        if (await button.isEnabled()) await button.click();
        await page.waitForTimeout(200);
        await each();
    }
    throw new Error('the reads never brought it');
};

test('a page opened to show the playing song waits for its tracks before it says the song is not there', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    const locate = page.locator('[data-grid-locate]');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();

    // The song is of the other collection: "playing from" goes there, and that page has read nothing yet.
    await component.locator('[data-probe-play-from-loaded="65"]').click();
    await expect(locate).toHaveAttribute('data-grid-locate', 'elsewhere');
    await goToSource(component);
    await expect(component.locator('[data-probe-open="loaded"]')).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(component.locator('[data-probe-request="asked"]')).toHaveCount(1);
    expect(await said(component)).toBe('');

    // Its first tracks arrive without the song: still not a word, and the button shows the wait.
    const wordless = async () => expect(await said(component)).toBe('');
    await releaseUntil(page, component, async () => await read(component) >= 15, wordless);
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    await page.waitForTimeout(300);
    expect(await read(component)).toBeLessThan(70);
    await expect(component.locator('[data-probe-request="asked"]')).toHaveCount(1);
    await expect(locate).toHaveAttribute('data-grid-locate-seeking', 'yes');
    // The last page brings it: its card is centred, and nothing was ever said.
    await releaseUntil(page, component, async () => await centred(page) === 'Track 065', wordless);
    expect(await read(component)).toBe(70);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    await expect(locate).toHaveAttribute('data-grid-locate', 'here');
    await expect(locate).toHaveAttribute('data-grid-locate-seeking', 'no');
    expect(await said(component)).toBe('');
});

test('a page opened to show the playing song says it is not there once every track has arrived', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();

    await component.locator('[data-probe-play-from-loaded="900"]').click();
    await goToSource(component);
    await expect(component.locator('[data-probe-open="loaded"]')).toHaveCount(1);
    // The first word comes with the last track, and is that one line.
    await releaseUntil(page, component, async () => await said(component) !== '');
    expect(await read(component)).toBe(70);
    expect(await said(component)).toBe(NOT_HERE);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
});

test('the button of a page does not lead to the collection the queue is of', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();

    // The queue is of the other collection, and this page does not hold the song: it says so and stays.
    await component.locator('[data-probe-play-from-loaded="65"]').click();
    await page.locator('[data-grid-locate]').click();
    await expect(component.locator(`[data-probe-status="${NOT_HERE}"]`)).toHaveCount(1);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    await page.waitForTimeout(400);
    await expect(component.locator('[data-probe-open="given"]')).toHaveCount(1);
    expect(await said(component)).toBe(NOT_HERE);
});

test('a page that is given its tracks says its list is not whole once it is told their reading failed', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    const locate = page.locator('[data-grid-locate]');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();

    // The page reads nothing itself (a Navidrome page is such a one). Its tracks were all read: the song is not here.
    await component.locator('[data-probe-play="900"]').click();
    await locate.click();
    await expect(component.locator(`[data-probe-status="${NOT_HERE}"]`)).toHaveCount(1);
    // Their reading failed: what the page holds is not the whole list, and it cannot tell.
    await component.locator('[data-probe-given-failed]').click();
    await locate.click();
    await expect(component.locator(`[data-probe-status="${NOT_WHOLE}"]`)).toHaveCount(1);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
    expect(await said(component)).toBe(`${NOT_HERE} | ${NOT_WHOLE}`);
    // A song among the tracks it does hold is found all the same.
    await component.locator('[data-probe-play="30"]').click();
    await locate.click();
    await expect.poll(() => centred(page)).toBe('Track 030');
    expect(await said(component)).toBe(`${NOT_HERE} | ${NOT_WHOLE}`);
});

test('a page whose reading failed says that its list is not whole, not that the song is missing', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();

    await component.locator('[data-probe-play-from-loaded="65"]').click();
    await goToSource(component);
    await expect(component.locator('[data-probe-open="loaded"]')).toHaveCount(1);
    await releaseUntil(page, component, async () => await read(component) >= 15);
    // From here every read is refused; the reading gives up after its retries (some six seconds).
    await component.locator('[data-probe-refuse-reads]').click();
    await releaseUntil(page, component, async () => await said(component) !== '');
    expect(await said(component)).toBe(NOT_WHOLE);
    expect(await read(component)).toBeLessThan(70);
    await expect(component.locator('[data-probe-request="none"]')).toHaveCount(1);
});

test('a list that was read to its end is still whole after reading it anew has failed', async ({ mount, page }) => {
    const component = await mount('collectionGrid');
    const locate = page.locator('[data-grid-locate]');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();

    // The other collection's page is opened and read to its end; the song is not in it.
    await component.locator('[data-probe-play-from-loaded="900"]').click();
    await goToSource(component);
    await releaseUntil(page, component, async () => await said(component) !== '');
    expect(await said(component)).toBe(NOT_HERE);
    expect(await read(component)).toBe(70);

    // The listener has the list read anew, and that read fails. While it is under way the list is not whole...
    await component.locator('[data-probe-refuse-reads]').click();
    // (The probe's own buttons lie over the page's title: it is pressed without the pointer.)
    await page.locator('h2', { hasText: 'Loaded Playlist' }).last().evaluate(title => (title as HTMLElement).click());
    await page.getByRole('button', { name: 'Reload' }).click();
    await expect(component.locator('[data-probe-held]')).not.toHaveAttribute('data-probe-held', '0');
    await page.keyboard.press('Escape');
    await locate.click();
    await expect(component.locator(`[data-probe-status="${NOT_WHOLE}"]`)).toHaveCount(1);
    // ...and once it has failed, the cards on screen are the 70 of the read before: the song is not here.
    await releaseUntil(page, component, async () => (await component.locator('[data-probe-held]').getAttribute('data-probe-held')) === '0');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    await expect.poll(async () => {
        await locate.click();
        await page.waitForTimeout(150);
        return component.locator('[data-probe-status]').getAttribute('data-probe-status');
    }).toBe(NOT_HERE);

    // Not so when the list is read anew because its collection changed (it has more tracks now):
    // the cards on screen are then known to be out of date, and after the read has failed the
    // page still cannot tell.
    await component.locator('[data-probe-change-loaded]').click();
    await expect(component.locator('[data-probe-held]')).not.toHaveAttribute('data-probe-held', '0');
    await releaseUntil(page, component, async () => (await component.locator('[data-probe-held]').getAttribute('data-probe-held')) === '0');
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
    await expect.poll(async () => {
        await locate.click();
        await page.waitForTimeout(150);
        return component.locator('[data-probe-status]').getAttribute('data-probe-status');
    }).toBe(NOT_WHOLE);
    await page.waitForTimeout(1500);
    await locate.click();
    await expect(component.locator(`[data-probe-status="${NOT_WHOLE}"]`)).toHaveCount(1);
});
