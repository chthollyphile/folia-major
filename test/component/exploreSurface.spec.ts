import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// test/component/exploreSurface.spec.ts
// 首页“探索”分页。整应用测试登录不了带推荐页的平台，所以走组件探针：假平台第一页给六栏
// （比窗口高），第一栏的“更多”再给三首；滚到底时下一页是空的，再下一页第一次读失败。
// 每逢第二次读第一页，假平台把头两栏对调着给。

// Notes, from now on, how visible each section is at the moment it is put on the page: '0' for
// one that then arrives, '1' for one that is there at once.
const watchSections = (root: { evaluate: (run: (element: HTMLElement) => void) => Promise<void> }) => root.evaluate(element => {
    const seen: string[] = [];
    (window as unknown as { exploreSectionsSeen: string[] }).exploreSectionsSeen = seen;
    new MutationObserver(records => {
        for (const node of records.flatMap(record => [...record.addedNodes])) {
            if (!(node instanceof HTMLElement)) continue;
            const sections = node.matches('[data-explore-shelf]') ? [node] : [...node.querySelectorAll('[data-explore-shelf]')];
            seen.push(...sections.map(section => getComputedStyle(section).opacity));
        }
    }).observe(element, { childList: true, subtree: true });
});
const sectionsSeen = (page: { evaluate: <T>(run: () => T) => Promise<T> }) => page.evaluate(() => (window as unknown as { exploreSectionsSeen: string[] }).exploreSectionsSeen.splice(0));
// The same for entries and the places held for them.
const watchEntries = (root: { evaluate: (run: (element: HTMLElement) => void) => Promise<void> }) => root.evaluate(element => {
    const seen: string[] = [];
    (window as unknown as { exploreEntriesSeen: string[] }).exploreEntriesSeen = seen;
    new MutationObserver(records => {
        for (const node of records.flatMap(record => [...record.addedNodes])) {
            if (!(node instanceof HTMLElement)) continue;
            const chosen = '[data-explore-card], [data-explore-ghost]';
            const entries = node.matches(chosen) ? [node] : [...node.querySelectorAll(chosen)];
            seen.push(...entries.map(entry => getComputedStyle(entry).opacity));
        }
    }).observe(element, { childList: true, subtree: true });
});
const entriesSeen = (page: { evaluate: <T>(run: () => T) => Promise<T> }) => page.evaluate(() => (window as unknown as { exploreEntriesSeen: string[] }).exploreEntriesSeen.splice(0));

test('explore tab lists the provider sections, plays a song with its section as the queue and opens a card', async ({ mount }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');

    await expect(component.getByRole('heading', { name: 'Picked for you' })).toBeVisible();
    // The first section opens the page: one entry large, the other five listed beside it.
    await expect(shelves.first().locator('[data-explore-card]')).toHaveCount(6);
    await expect(shelves.first().locator('[data-explore-scroll]')).toHaveCount(0);
    // Twelve cards do not fit this window, so their row has both arrows, and only the one that
    // leads somewhere can be pressed; six cards fit, so their row has none.
    const arrows = shelves.nth(1).locator('[data-explore-scroll]');
    await expect(arrows).toHaveCount(2);
    await expect(arrows.first()).toBeDisabled();
    await expect(arrows.last()).toBeEnabled();
    await expect(shelves.nth(2).locator('[data-explore-card]')).toHaveCount(6);
    await expect(shelves.nth(2).locator('[data-explore-scroll]')).toHaveCount(0);
    // The picture is of the page once it has arrived.
    await expect(shelves.last()).toHaveCSS('opacity', '1');
    await expect(shelves.nth(2).locator('[data-explore-card]').last()).toHaveCSS('opacity', '1');
    await component.screenshot({ path: 'test-results/explore-surface-dark.png' });

    await shelves.first().locator('[data-explore-card="song"]').nth(1).click();
    await expect(component.locator('[data-probe-played="song-2 of 6"]')).toBeVisible();
    await expect(component.locator('[data-probe-queue="song-1 song-2 song-3 song-4 song-5 song-6"]')).toBeVisible();
    // The large entry is the section's first, and plays with the same queue.
    await shelves.first().locator('[data-explore-card]').first().click();
    await expect(component.locator('[data-probe-played="song-1 of 6"]')).toBeVisible();

    // A section that mixes cards and songs queues its songs only.
    await shelves.nth(1).locator('[data-explore-card="song"]').first().click();
    await expect(component.locator('[data-probe-played="song-20 of 8"]')).toBeVisible();
    await expect(component.locator('[data-probe-queue="song-20 song-21 song-22 song-23 song-24 song-25 song-26 song-27"]')).toBeVisible();
    await shelves.nth(1).locator('[data-explore-card="artist"]').click();
    await expect(component.locator('[data-probe-opened="artist:artist-4"]')).toBeVisible();
    // A mix is named as one, not as a playlist.
    const lists = shelves.nth(1).locator('[data-explore-card="playlist"]');
    await expect(lists.nth(0).locator('span.truncate')).toHaveText('Playlist');
    await expect(lists.nth(1).locator('span.truncate')).toHaveText('Mix');

    // An arrow moves the row; with cards hidden at both ends, both arrows can be pressed.
    await arrows.last().click();
    await expect(arrows.first()).toBeEnabled();
    await expect.poll(() => shelves.nth(1).locator('[data-explore-row]').evaluate(element => element.scrollLeft)).toBeGreaterThan(200);

    // A collection the listener took out of their library leaves the page.
    await component.locator('[data-probe-take-out]').click();
    await expect(lists).toHaveCount(1);
    await expect(shelves.nth(1).locator('[data-explore-card]')).toHaveCount(11);
});

test('explore tab shows a section in the form its entries call for, and a wide picture in its own proportions', async ({ page }) => {
    // The probe's sample of the real page: stills for songs and mixes, round artists, two sections of one song.
    await page.goto('?probe=exploreSurface&sample=page');
    const shelves = page.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(8);
    // The second section holds one song: one card, no row, no arrows, and it plays as a queue of one.
    await expect(shelves.nth(1).locator('[data-explore-card]')).toHaveCount(1);
    await expect(shelves.nth(1).locator('[data-explore-row], [data-explore-scroll]')).toHaveCount(0);
    await shelves.nth(1).locator('[data-explore-card]').click();
    await expect(page.locator('[data-probe-played="song-7 of 1"]')).toBeVisible();
    // A video still is shown 16:9 wherever it stands: the opening entry, the list beside it,
    // a band, a row. An artist's picture is square.
    const sizeOf = (index: number, picture = '[data-explore-card] span.relative > img') => shelves.nth(index).locator(picture).first().evaluate(image => [image.clientWidth, image.clientHeight]);
    expect(await sizeOf(0)).toEqual([384, 216]);
    expect(await sizeOf(0, '[data-explore-row] img')).toEqual([96, 54]);
    expect(await sizeOf(1)).toEqual([192, 108]);
    expect(await sizeOf(2)).toEqual([288, 162]);
    expect(await sizeOf(3)).toEqual([162, 162]);
    // A title too long for its line is cut short.
    const title = shelves.first().locator('[data-explore-card]').nth(3).locator('span.truncate').first();
    await expect(title).toHaveText(/Official Music Video Full Version$/);
    expect(await title.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);

    // A section of one entry that has further ones is a row: it grows in place, and has arrows
    // once its cards no longer fit.
    const growing = shelves.nth(7);
    await expect(growing.locator('[data-explore-row] [data-explore-card]')).toHaveCount(1);
    await expect(growing.locator('[data-explore-scroll]')).toHaveCount(0);
    await growing.locator('[data-explore-more]').click();
    await expect(growing.locator('[data-explore-card]')).toHaveCount(7);
    await expect(growing.locator('[data-explore-scroll]')).toHaveCount(2);

    // The opening section lists five entries beside its large one. The ones its "more" brings stand
    // in further columns of five to the right, every picture in a slot of one width: the section
    // is no higher for them, and has arrows now that not all of its columns fit. Two columns are
    // in view in a window this wide, and they fill the list's width.
    const lead = shelves.first();
    const lines = lead.locator('[data-explore-row] [data-explore-card]');
    const heightOf = async (shelf: typeof lead) => Math.round((await shelf.boundingBox())!.height);
    // (The page is at its top again: the test went down it for the section before this.)
    const list = page.locator('[data-explore-surface]');
    await list.evaluate(element => { element.scrollTop = 0; });
    const leadHeight = await heightOf(lead);
    await expect(lead.locator('[data-explore-scroll]')).toHaveCount(0);
    await lead.locator('[data-explore-more]').click();
    await expect(lead.locator('[data-explore-card]')).toHaveCount(12);
    await expect(lines).toHaveCount(11);
    expect(await heightOf(lead)).toBe(leadHeight);
    expect(await lines.nth(7).locator('img').evaluate(image => [image.clientWidth, image.clientHeight])).toEqual([96, 54]);
    // They arrive one after another, counted from the first of them, and come to rest. The
    // entries it had before keep the places they arrived in: they did not arrive again.
    expect(await lines.evaluateAll(all => all.map(card => card.getAttribute('data-explore-order')))).toEqual(['1', '2', '3', '4', '5', '0', '1', '2', '3', '4', '5']);
    await expect(lines.last()).toHaveCSS('opacity', '1');
    // Five to a column, from the top: the sixth line heads the second column, the eleventh the third.
    const placed = () => lines.evaluateAll(cards => cards.map(card => { const box = card.getBoundingClientRect(); return [Math.round(box.left), Math.round(box.top)]; }));
    // (Measured once the last of them has come to rest: a line is fully visible a moment before it stands still.)
    await expect.poll(async () => { const boxes = await placed(); return [boxes[1][1] - boxes[0][1], boxes[10][1] - boxes[0][1]]; }).toEqual([70, 0]);
    const boxes = await placed();
    expect(new Set(boxes.slice(0, 5).map(([left]) => left)).size).toBe(1);
    expect(boxes[5][1]).toBe(boxes[0][1]);
    expect(boxes[10][1]).toBe(boxes[0][1]);
    expect(boxes[5][0] - boxes[0][0]).toBe(404);
    expect(boxes[10][0] - boxes[5][0]).toBe(404);
    const leadRow = lead.locator('[data-explore-row]');
    const widths = await lines.evaluateAll(cards => cards.map(card => Math.round(card.getBoundingClientRect().width)));
    expect(new Set(widths)).toEqual(new Set([380]));
    expect(await leadRow.evaluate(row => row.clientWidth)).toBe(380 + 24 + 380 + 8);
    // The places held for them were in sight beside the first column, so the list was moved nowhere;
    // an arrow moves it by a column, here to its end, where whole columns are in view as well.
    expect(await leadRow.evaluate(row => row.scrollLeft)).toBe(0);
    await expect(lead.locator('[data-explore-scroll="left"]')).toBeDisabled();
    await lead.locator('[data-explore-scroll="right"]').click();
    await expect.poll(() => leadRow.evaluate(row => row.scrollLeft)).toBe(404);
    expect(await leadRow.evaluate(row => row.scrollWidth - row.clientWidth)).toBe(404);
    await expect(lead.locator('[data-explore-scroll="left"]')).toBeEnabled();
    await expect(lead.locator('[data-explore-scroll="right"]')).toBeDisabled();
    await lead.locator('[data-explore-scroll="left"]').click();
    await expect.poll(() => leadRow.evaluate(row => row.scrollLeft)).toBe(0);
    // The list fades nothing out at an end: no entry is cut there.
    expect(await leadRow.evaluate(row => getComputedStyle(row).maskImage)).toBe('none');
    // The page itself was moved nowhere.
    expect(await list.evaluate(element => element.scrollTop)).toBe(0);

    // A row brings the first place its "more" asked for to its start: to the few pixels by which
    // the four places it holds leave a window this wide unfilled, the entries having come while
    // the row was still on its way (where they come later, it then stands at the start exactly:
    // the test of the held places below).
    const mixes = shelves.nth(2);
    await expect(mixes.locator('[data-explore-card] span.truncate').first()).toHaveText('Mix');
    await mixes.locator('[data-explore-more]').click();
    await expect(mixes.locator('[data-explore-card]')).toHaveCount(12);
    const startOfSeventh = () => mixes.locator('[data-explore-row]').evaluate(row => {
        const card = row.querySelectorAll('[data-explore-card]')[6].getBoundingClientRect();
        return Math.round(card.left - row.getBoundingClientRect().left);
    });
    await expect.poll(startOfSeventh).toBeLessThanOrEqual(12);
    expect(await startOfSeventh()).toBeGreaterThanOrEqual(8);

    // A window too narrow to put the list beside the opening entry keeps that entry's size.
    await page.setViewportSize({ width: 800, height: 900 });
    expect(await sizeOf(0)).toEqual([384, 216]);

    // Where the list of columns was left is nothing to the row this section becomes once another
    // one opens the page (the app's own, with the first song played here): the row starts at its start.
    await page.setViewportSize({ width: 1280, height: 720 });
    await lead.locator('[data-explore-scroll="right"]').click();
    await expect.poll(() => leadRow.evaluate(row => row.scrollLeft)).toBe(404);
    await page.waitForTimeout(200);
    await page.locator('[data-probe-hear]').click();
    await expect(shelves).toHaveCount(9);
    const becameRow = shelves.nth(1);
    await expect(becameRow.locator('[data-explore-row] [data-explore-place]')).toHaveCount(12);
    expect(await becameRow.locator('[data-explore-row]').evaluate(row => row.scrollLeft)).toBe(0);
});

test('explore tab reads further items of a section, and further sections once the end of the list is reached', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');
    const first = shelves.first();

    await first.locator('[data-explore-more]').click();
    await expect(first.locator('[data-explore-card]')).toHaveCount(9);
    // The three that came stand in a second column beside the first five, their pictures square.
    // Two columns share the room there is: nothing is out of sight, so there are no arrows.
    const lines = first.locator('[data-explore-row] [data-explore-card]');
    await expect(lines).toHaveCount(8);
    expect(await lines.last().locator('img').evaluate(image => [image.clientWidth, image.clientHeight])).toEqual([54, 54]);
    await expect(lines.last()).toHaveCSS('opacity', '1');
    const [fifth, sixth] = [await lines.nth(4).boundingBox(), await lines.nth(5).boundingBox()];
    expect(Math.round(sixth!.x - fifth!.x)).toBe(404);
    expect(Math.round(fifth!.y - sixth!.y)).toBe(280);
    await expect(first.locator('[data-explore-scroll]')).toHaveCount(0);
    // The section has no further items, so its "more" is gone.
    await expect(first.locator('[data-explore-more]')).toHaveCount(0);

    // The end of the list is below the window, so nothing further has been asked for.
    await expect(shelves).toHaveCount(6);
    await component.locator('[data-explore-surface]').evaluate(element => element.scrollTo(0, element.scrollHeight));
    // The next page holds nothing and the one after it fails: the end offers to try again.
    const retry = component.locator('[data-explore-retry]');
    await expect(retry).toBeVisible();
    await expect(shelves).toHaveCount(6);
    await retry.click();
    await expect(component.getByRole('heading', { name: 'A shelf from the next page' })).toBeVisible();
    await expect(shelves).toHaveCount(7);
    await expect(retry).toHaveCount(0);

    await component.locator('[data-probe-toggle="daylight"]').click();
    // The cards fade between the two colour sets; the picture is of the settled one.
    await page.waitForTimeout(400);
    await component.screenshot({ path: 'test-results/explore-surface-daylight.png' });
});

test('explore tab comes back where it was left after the home screen was taken down', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const list = component.locator('[data-explore-surface]');
    const shelves = component.locator('[data-explore-shelf]');
    const row = shelves.nth(1).locator('[data-explore-row]');
    const place = async () => [await list.evaluate(element => element.scrollTop), await row.evaluate(element => element.scrollLeft)];

    await expect(shelves).toHaveCount(6);
    // The sections of a page stand in the order they arrive in.
    expect(await shelves.evaluateAll(sections => sections.map(section => section.getAttribute('data-explore-order')))).toEqual(['0', '1', '2', '3', '4', '5']);
    await expect(shelves.last()).toHaveCSS('opacity', '1');
    await list.evaluate(element => { element.scrollTop = 240; });
    // A row comes to rest on the edge of a card: two cards in.
    await row.evaluate(element => { element.scrollLeft = 364; });
    // The place is recorded as the scroll events arrive.
    await page.waitForTimeout(200);

    const toggle = component.locator('[data-probe-toggle="surface"]');
    await watchSections(component);
    await watchEntries(component);
    await toggle.click();
    await expect(list).toHaveCount(0);
    await toggle.click();
    await expect(shelves).toHaveCount(6);
    await expect.poll(place).toEqual([240, 364]);
    // It is the page that was left, and is there at once: its sections, and what they hold.
    expect(await sectionsSeen(page)).toEqual(['1', '1', '1', '1', '1', '1']);
    const entries = await entriesSeen(page);
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.filter(opacity => opacity !== '1')).toEqual([]);
    // What joins it afterwards still arrives: the three further songs of the opening section.
    await shelves.first().locator('[data-explore-more]').click();
    await expect(shelves.first().locator('[data-explore-card]')).toHaveCount(9);
    expect((await entriesSeen(page)).filter(opacity => opacity !== '0')).toEqual([]);
    await expect(shelves.first().locator('[data-explore-card]').last()).toHaveCSS('opacity', '1');

    // A page read in the place of this one is shown where the listener stands: the list is not
    // sent back to its top. Its rows are other rows, and start from their starts.
    // (A refresh reads the page once no section has entries that were not shown: the opening
    // section shows all of its own now, and from here on the probe's sections have no further ones.)
    await component.locator('[data-probe-no-further]').click();
    // (The press on "more" above brought that button, and with it the list's top, into the window.)
    await list.evaluate(element => { element.scrollTop = 240; });
    await expect.poll(place).toEqual([240, 364]);
    await page.waitForTimeout(200);
    await component.locator('[data-explore-refresh]').click();
    await expect.poll(place).toEqual([240, 0]);
    // Also where the platform names the sections of a page as it named those of the page before:
    // the row that leaves is of another read, and where it stood is nothing to the one that comes.
    const readAgain = async () => {
        await row.evaluate(element => element.setAttribute('data-test-row-before', ''));
        await component.locator('[data-explore-refresh]').click();
        await expect(component.locator('[data-test-row-before]')).toHaveCount(0);
        await expect(row.locator('[data-explore-card]').first()).toHaveCSS('opacity', '1');
    };
    await component.locator('[data-probe-keep-ids]').click();
    await readAgain();
    await row.evaluate(element => { element.scrollLeft = 364; });
    await page.waitForTimeout(200);
    expect(await place()).toEqual([240, 364]);
    await readAgain();
    expect(await place()).toEqual([240, 0]);
    await expect(shelves).toHaveCount(6);
    // Its sections are the ones that stood there: none was put on the page anew.
    expect(await sectionsSeen(page)).toEqual([]);

    // A page dropped under the tab (a read overtaken by a provider switch) is read again, and
    // arrives as a page seen for the first time does: every section from nothing.
    await component.locator('[data-probe-forget]').click();
    await expect(shelves).toHaveCount(6);
    await expect(component.locator('[data-explore-refresh]')).toBeEnabled();
    expect(await sectionsSeen(page)).toEqual(['0', '0', '0', '0', '0', '0']);
    await expect(shelves.last()).toHaveCSS('opacity', '1');
});

test('explore tab keeps its page on screen while the next one is read, and its sections in the order they had', async ({ mount }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');
    const refresh = component.locator('[data-explore-refresh]');
    const headings = () => component.locator('[data-explore-shelf] h2').allTextContents();
    const firstSong = shelves.first().locator('[data-explore-card]').first();
    // What a refresh dims: what holds a section's entries, whatever the section's form.
    const holderOf = (index: number) => shelves.nth(index).locator('[data-explore-body]').locator('..');
    const leadBody = holderOf(0);
    // Each section's heading and each one's entries are marked, to tell afterwards which are still the same.
    const mark = () => component.evaluate(root => {
        for (const element of root.querySelectorAll('[data-explore-shelf] h2, [data-explore-body]')) element.setAttribute('data-test-kept', '');
    });
    const kept = (what: string) => component.locator(`${what}[data-test-kept]`).count();
    await expect(shelves).toHaveCount(6);
    // (No section has further entries of its own to go on to: every refresh here reads the page.)
    await component.locator('[data-probe-no-further]').click();
    const order = await headings();
    const label = (await refresh.getAttribute('aria-label'))!;
    expect(label).toBe('Refresh');
    const failedMark = refresh.locator('[data-explore-refresh-failed]');

    // While the next page is on its way the one shown stays, dimmed, and takes no clicks.
    await component.locator('[data-probe-hold]').click();
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(shelves).toHaveCount(6);
    for (const body of [leadBody, holderOf(1)]) {
        await expect(body).toHaveAttribute('data-explore-waiting', 'true');
        await expect(body).toHaveCSS('opacity', '0.6');
        await expect(body).toHaveCSS('pointer-events', 'none');
    }
    await expect(shelves.first().locator('h2')).toHaveCSS('opacity', '1');
    await expect(shelves.first().locator('[data-explore-more]')).toBeDisabled();
    // The end of the list, brought into view, asks for nothing meanwhile; it does once the page is back.
    const list = component.locator('[data-explore-surface]');
    await list.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await expect(component.locator('[data-explore-retry]')).toHaveCount(0);
    await component.locator('[data-probe-refuse]').click();
    await component.locator('[data-probe-release]').click();
    await expect(component.locator('[data-explore-retry]')).toBeVisible();
    await list.evaluate(element => element.scrollTo(0, 0));
    // A read that failed left everything as it was.
    await expect(leadBody).not.toHaveAttribute('data-explore-waiting');
    await mark();
    await component.locator('[data-probe-hold]').click();
    await refresh.click();
    await expect(refresh).toBeDisabled();

    // The probe hands this page with its first two sections swapped; they stand as before. Every
    // heading is the one that stood there, and under each the entries are new ones.
    await component.locator('[data-probe-release]').click();
    await expect(refresh).toBeEnabled();
    await expect(leadBody).toHaveCSS('opacity', '1');
    expect(await headings()).toEqual(order);
    await expect.poll(() => kept('[data-explore-body]')).toBe(0);
    expect(await kept('[data-explore-shelf] h2')).toBe(6);
    await expect(shelves.locator('[data-explore-body]')).toHaveCount(6);
    await expect(shelves.nth(1).locator('[data-explore-card]').first()).toHaveCSS('opacity', '1');
    await firstSong.click();
    // (The probe's platform hands other entries with every read: this is the first song of its second.)
    await expect(component.locator('[data-probe-played="song-1~2 of 6"]')).toBeVisible();

    // A read that fails leaves the page, and the button, marked, offers to try again.
    await expect(failedMark).toHaveCount(0);
    await component.locator('[data-probe-refuse]').click();
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-label', 'Retry');
    await expect(refresh).toHaveAttribute('title', 'The recommendations could not be read');
    await expect(failedMark).toHaveCount(1);
    await expect(refresh).toBeEnabled();
    await expect(shelves).toHaveCount(6);
    await expect(leadBody).toHaveCSS('opacity', '1');
    await refresh.click();
    await expect(refresh).toHaveAttribute('aria-label', label);
    await expect(failedMark).toHaveCount(0);
    expect(await headings()).toEqual(order);
});

test('explore tab holds the places of further entries open while they are read', async ({ page }) => {
    // The probe answers every read after a second and a half here.
    await page.goto('?probe=exploreSurface&sample=page&slow=1500');
    const shelves = page.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(8);
    await expect(shelves.nth(2).locator('[data-explore-card]').last()).toHaveCSS('opacity', '1');

    // A row: four places after its cards, in the shape of its last one, and the first of them at the row's start.
    const mixes = shelves.nth(2);
    await mixes.locator('[data-explore-more]').click();
    const places = mixes.locator('[data-explore-row] [data-explore-ghost]');
    await expect(places).toHaveCount(4);
    await expect(mixes.locator('[data-explore-card]')).toHaveCount(6);
    expect(await places.first().evaluate(place => place.clientWidth)).toBe(288);
    const startOf = (selector: string, index: number) => mixes.locator('[data-explore-row]').evaluate((row, [chosen, at]) => (
        Math.round((row.querySelectorAll(chosen as string)[at as number]?.getBoundingClientRect().left ?? NaN) - row.getBoundingClientRect().left)
    ), [selector, index]);
    // As near the row's start as the row can be scrolled: four places do not fill the window.
    await expect.poll(() => startOf('[data-explore-ghost]', 0)).toBeLessThan(20);
    const held = await startOf('[data-explore-ghost]', 0);
    // The cards take those places. The first of them stands at the row's start, which is where
    // its place was held, to the few pixels the row could not be scrolled before.
    await expect(mixes.locator('[data-explore-card]')).toHaveCount(12);
    await expect(places).toHaveCount(0);
    await expect(mixes.locator('[data-explore-card]').last()).toHaveCSS('opacity', '1');
    await expect.poll(() => startOf('[data-explore-card]', 6)).toBe(8);
    expect(held - 8).toBeLessThan(8);
    expect(await mixes.locator('[data-explore-card]').evaluateAll(cards => cards.slice(6).map(card => card.getAttribute('data-explore-order')))).toEqual(['0', '1', '2', '3', '4', '5']);

    // The opening section: a column of five places after its lines, which the lines then take.
    const lead = shelves.first();
    await lead.locator('[data-explore-more]').click();
    const linePlaces = lead.locator('[data-explore-row] [data-explore-ghost]');
    const leadLines = lead.locator('[data-explore-row] [data-explore-card]');
    await expect(linePlaces).toHaveCount(5);
    await expect(leadLines).toHaveCount(5);
    // The column of places has a head for the list to rest on, as the column of lines has.
    await expect(lead.locator('[data-explore-post]')).toHaveCount(2);
    // The places are a second column: the first of them stands beside the first line, a column further on.
    const cornerOf = async (entry: typeof leadLines) => { const box = (await entry.boundingBox())!; return [Math.round(box.x), Math.round(box.y)]; };
    await expect(linePlaces.first()).toHaveCSS('opacity', '1');
    const [firstLeft, firstTop] = await cornerOf(leadLines.first());
    await expect.poll(() => cornerOf(linePlaces.first())).toEqual([firstLeft + 404, firstTop]);
    await expect(leadLines).toHaveCount(11);
    await expect(lead.locator('[data-explore-ghost]')).toHaveCount(0);
    await expect.poll(() => cornerOf(leadLines.nth(5))).toEqual([firstLeft + 404, firstTop]);
});

test('explore tab opens with the songs last played in the app, newest first', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');
    const hear = component.locator('[data-probe-hear]');
    const own = shelves.first();
    const titles = () => own.locator('[data-explore-card]').evaluateAll(cards => cards.map(card => card.getAttribute('title')));
    await expect(shelves).toHaveCount(6);
    await expect(component.getByRole('heading', { name: 'Recently played' })).toHaveCount(0);

    // The first song played puts the app's own section before the provider's; the room for the page's own control moves to it.
    await hear.click();
    await expect(shelves).toHaveCount(7);
    await expect(own.locator('h2')).toHaveText('Recently played');
    await expect(own.locator('[data-explore-controls-room]')).toHaveCount(1);
    await expect(component.locator('[data-explore-controls-room]')).toHaveCount(1);
    expect(await titles()).toEqual(['Song number 101']);
    // What opened the page before is now a row.
    await expect(shelves.nth(1).locator('h2')).toHaveText('Picked for you');
    await expect(shelves.nth(1).locator('[data-explore-row] [data-explore-card]')).toHaveCount(6);

    // The newest song is the large one; a song heard again moves to the front and is not listed twice.
    for (let count = 0; count < 3; count += 1) await hear.click();
    await expect.poll(titles).toEqual(['Song number 104', 'Song number 103', 'Song number 102', 'Song number 101']);
    await component.locator('[data-probe-hear-again]').click();
    await expect.poll(titles).toEqual(['Song number 101', 'Song number 104', 'Song number 103', 'Song number 102']);
    await expect(own.locator('[data-explore-more]')).toHaveCount(0);
    // (Listened to a second time, it also stands in the app's other section, which follows this one.)
    await expect(shelves).toHaveCount(8);
    await expect(shelves.nth(1).locator('h2')).toHaveText('Play again');

    // All of them are in the section: there is nothing "more" could bring.
    for (let count = 0; count < 4; count += 1) await hear.click();
    await expect(own.locator('[data-explore-card]')).toHaveCount(8);
    await expect(own.locator('[data-explore-more]')).toHaveCount(0);
    await expect(own.locator('[data-explore-ghost]')).toHaveCount(0);

    // A song of it plays with the others as its queue.
    await own.locator('[data-explore-card]').nth(1).click();
    await expect(component.locator('[data-probe-played="song-107 of 8"]')).toBeVisible();

    // A refresh leaves the app's own section alone: it does not wait, and its entries stay the ones they were.
    await component.locator('[data-probe-no-further]').click();
    await component.evaluate(root => { for (const element of root.querySelectorAll('[data-explore-body]')) element.setAttribute('data-test-kept', ''); });
    await component.locator('[data-probe-hold]').click();
    await component.locator('[data-explore-refresh]').click();
    await expect(shelves.nth(2).locator('[data-explore-waiting]')).toHaveCount(1);
    // What waits is out of the keyboard's reach too.
    await expect(shelves.nth(2).locator('[data-explore-waiting]')).toHaveAttribute('inert', '');
    await expect(own.locator('[data-explore-waiting]')).toHaveCount(0);
    await expect(shelves.nth(1).locator('[data-explore-waiting]')).toHaveCount(0);
    await expect(own.locator('[data-explore-more]')).toHaveCount(0);
    await component.locator('[data-probe-release]').click();
    await expect(component.locator('[data-explore-refresh]')).toBeEnabled();
    await expect(shelves).toHaveCount(8);
    // Once the provider's sections have all exchanged their entries, the app's own two still hold theirs.
    await expect.poll(() => component.locator('[data-explore-body][data-test-kept]').count()).toBe(2);
    await expect(own.locator('[data-explore-body][data-test-kept]')).toHaveCount(1);
    await expect(shelves.nth(1).locator('[data-explore-body][data-test-kept]')).toHaveCount(1);
    await expect(own.locator('[data-explore-card]')).toHaveCount(8);

    // A song played joins at the front and moves the page nowhere, though the foot of the
    // section's list is out of a window this low.
    await page.setViewportSize({ width: 1280, height: 420 });
    const list = component.locator('[data-explore-surface]');
    await hear.click();
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 109');
    await page.waitForTimeout(500);
    expect(await list.evaluate(element => element.scrollTop)).toBe(0);
    await page.setViewportSize({ width: 1280, height: 720 });

    // However many songs were played, the section is as high as it was: its further columns
    // stand out of sight to the right, and its arrows scroll to them.
    const row = own.locator('[data-explore-row]');
    const scrolled = () => row.evaluate(element => element.scrollLeft);
    const height = Math.round((await own.boundingBox())!.height);
    // (A heading row of 32, 20 under it, five lines of 70, and the 72 that follow the section that opens the page.)
    expect(height).toBe(474);
    await expect(own.locator('[data-explore-scroll]')).toHaveCount(0);
    for (let count = 0; count < 20; count += 1) await hear.click();
    await expect(own.locator('[data-explore-card]')).toHaveCount(29);
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 129');
    expect(Math.round((await own.boundingBox())!.height)).toBe(height);
    await expect(own.locator('[data-explore-scroll="right"]')).toBeEnabled();
    await expect(own.locator('[data-explore-scroll="left"]')).toBeDisabled();
    // The lines that were pushed along did not take the list with them.
    await page.waitForTimeout(500);
    expect(await scrolled()).toBe(0);
    // An arrow moves the list by whole columns, and it stays there when a song joins at the front.
    await own.locator('[data-explore-scroll="right"]').click();
    await expect.poll(scrolled).toBe(808);
    const headed = () => row.evaluate(element => [...element.querySelectorAll('[data-explore-card]')]
        .find(card => Math.round(card.getBoundingClientRect().left - element.getBoundingClientRect().left) === 4)?.getAttribute('title'));
    await expect.poll(headed).toBe('Song number 118');
    await hear.click();
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 130');
    await expect.poll(headed).toBe('Song number 119');
    await page.waitForTimeout(500);
    expect(await scrolled()).toBe(808);
    expect(await list.evaluate(element => element.scrollTop)).toBe(0);
    // At its end too, where a song that joins adds a column: 31 entries are six columns of lines, then 32 are seven.
    for (let count = 0; count < 2; count += 1) await own.locator('[data-explore-scroll="right"]').click();
    await expect.poll(scrolled).toBe(1616);
    expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(1616);
    await hear.click();
    await expect(own.locator('[data-explore-card]')).toHaveCount(31);
    await hear.click();
    await expect(own.locator('[data-explore-card]')).toHaveCount(32);
    await page.waitForTimeout(500);
    expect(await scrolled()).toBe(1616);
    expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(2020);
    for (let count = 0; count < 2; count += 1) await own.locator('[data-explore-scroll="left"]').click();
    await expect.poll(scrolled).toBe(808);

    // The record is kept, and where the list was left: the section is there again after the home screen was taken down.
    const toggle = component.locator('[data-probe-toggle="surface"]');
    await toggle.click();
    await toggle.click();
    await expect(own.locator('h2')).toHaveText('Recently played');
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 132');
    expect(await scrolled()).toBe(808);
    // Also after a read of the page, which forgets where every row was left: this section's list stays on screen through it.
    await component.locator('[data-explore-refresh]').click();
    await expect(component.locator('[data-explore-refresh]')).toBeEnabled();
    await expect.poll(async () => (await component.locator('[data-explore-shelf] h2').allTextContents()).length).toBe(8);
    await toggle.click();
    await toggle.click();
    expect(await scrolled()).toBe(808);

    // A provider's page that cannot be read leaves the app's own section on screen, with the way to try again under it.
    await component.locator('[data-probe-refuse]').click();
    await component.locator('[data-probe-forget]').click();
    await expect(component.locator('[data-explore-retry-page]')).toBeVisible();
    await expect(shelves).toHaveCount(2);
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 132');
    await expect(component.locator('[data-explore-refresh]')).toHaveCount(0);
    // Asked for again, the provider's page is read with none of it on screen: the app's own
    // sections stay through that too, with the wait shown under them.
    await component.locator('[data-probe-hold]').click();
    await component.locator('[data-explore-retry-page]').click();
    await expect(component.locator('[aria-busy="true"]')).toBeVisible();
    await expect(shelves).toHaveCount(2);
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 132');
    await expect(component.locator('[data-explore-retry-page]')).toHaveCount(0);
    await component.locator('[data-probe-release]').click();
    await expect(shelves).toHaveCount(8);
    await expect(component.locator('[aria-busy="true"]')).toHaveCount(0);
    await expect(own.locator('[data-explore-card]').first()).toHaveAttribute('title', 'Song number 132');
});

test('the opening section shows one column at a time where two have no room, and brings the places it holds for further entries into sight', async ({ mount, page }) => {
    // A window in which the list beside the large entry is 604px wide: under the 704px that two columns take.
    await page.setViewportSize({ width: 1100, height: 720 });
    const component = await mount('exploreSurface');
    const lead = component.locator('[data-explore-shelf]').first();
    const row = lead.locator('[data-explore-row]');
    const lines = row.locator('[data-explore-card]');
    const scrolled = () => row.evaluate(element => element.scrollLeft);
    const heightOf = async () => Math.round((await lead.boundingBox())!.height);
    // The provider's first section opens the page: five lines beside the large entry, one column.
    await expect(lines).toHaveCount(5);
    expect(await heightOf()).toBe(474);
    expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0);

    // "More": a column of places is held after the lines, and brought to the list's start. The
    // three songs that come stand in it; the section is as high as it was.
    await lead.locator('[data-explore-more]').click();
    await expect.poll(scrolled).toBe(628);
    await expect(lines).toHaveCount(8);
    await expect(lines.last()).toHaveCSS('opacity', '1');
    expect(await scrolled()).toBe(628);
    expect(await row.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(628);
    await expect(lines.nth(5)).toHaveAttribute('title', 'Song number 10');
    await expect(lines.nth(5)).toBeInViewport();
    expect(await heightOf()).toBe(474);

    // Twelve songs played here: the app's own section opens the page now, the newest large and
    // the other eleven in three columns of lines. Nobody asked for them, and the list is moved nowhere.
    for (let count = 0; count < 12; count += 1) await component.locator('[data-probe-hear]').click();
    await expect(lead.locator('h2')).toHaveText('Recently played');
    await expect(lines).toHaveCount(11);
    await expect(lines.last()).toHaveCSS('opacity', '1');
    await page.waitForTimeout(500);
    expect(await heightOf()).toBe(474);
    expect(await scrolled()).toBe(0);

    // Each column is as wide as the list: the second one is out of sight whole, not cut.
    const boxOf = async (index: number) => { const box = (await lines.nth(index).boundingBox())!; return [Math.round(box.x), Math.round(box.width)]; };
    const [firstLeft, width] = await boxOf(0);
    expect(width).toBe(604);
    expect(await boxOf(5)).toEqual([firstLeft + 628, 604]);
    await lead.locator('[data-explore-scroll="right"]').click();
    await expect.poll(scrolled).toBe(628);
    await expect.poll(() => boxOf(5)).toEqual([firstLeft, 604]);
    await lead.locator('[data-explore-scroll="left"]').click();
    await expect.poll(scrolled).toBe(0);
});

test('the songs listened to more than once in the app stand in a section of their own, the one listened to most first', async ({ mount }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');
    const hear = component.locator('[data-probe-hear]');
    const recent = shelves.first();
    const again = shelves.nth(1);
    const titlesOf = (shelf: typeof again) => shelf.locator('[data-explore-card]').evaluateAll(cards => cards.map(card => card.getAttribute('title')));
    await expect(shelves).toHaveCount(6);

    // Three songs, each listened to once: there is nothing to play again.
    for (let count = 0; count < 3; count += 1) await hear.click();
    await expect(shelves).toHaveCount(7);
    await expect(component.getByRole('heading', { name: 'Play again' })).toHaveCount(0);

    // The first of them is listened to a second time: the section is there, after "recently played" and before the provider's.
    await component.locator('[data-probe-hear-again]').click();
    await expect(shelves).toHaveCount(8);
    await expect(recent.locator('h2')).toHaveText('Recently played');
    await expect(again.locator('h2')).toHaveText('Play again');
    await expect(shelves.nth(2).locator('h2')).toHaveText('Picked for you');
    await expect.poll(() => titlesOf(again)).toEqual(['Song number 101']);
    await expect(again.locator('[data-explore-more]')).toHaveCount(0);

    // The second song a second time: of two listened to as often on a day, the one played later stands first.
    await component.locator('[data-probe-hear-second-again]').click();
    await expect.poll(() => titlesOf(again)).toEqual(['Song number 102', 'Song number 101']);
    // The first a third time: the one listened to most stands first.
    await component.locator('[data-probe-hear-again]').click();
    await expect.poll(() => titlesOf(again)).toEqual(['Song number 101', 'Song number 102']);
    await expect.poll(() => titlesOf(recent)).toEqual(['Song number 101', 'Song number 102', 'Song number 103']);

    // A song of it plays with the section's songs as its queue.
    await again.locator('[data-explore-card]').nth(1).click();
    await expect(component.locator('[data-probe-played="song-102 of 2"]')).toBeVisible();

    // A read of the provider's page leaves it alone, as it leaves the app's other section.
    await component.locator('[data-probe-no-further]').click();
    await component.locator('[data-probe-hold]').click();
    await component.locator('[data-explore-refresh]').click();
    await expect(shelves.nth(2).locator('[data-explore-waiting]')).toHaveCount(1);
    await expect(again.locator('[data-explore-waiting]')).toHaveCount(0);
    await component.locator('[data-probe-release]').click();
    await expect(component.locator('[data-explore-refresh]')).toBeEnabled();
    await expect(shelves).toHaveCount(8);
    expect(await titlesOf(again)).toEqual(['Song number 101', 'Song number 102']);

    // The record is kept: the section is there again after the home screen was taken down.
    const toggle = component.locator('[data-probe-toggle="surface"]');
    await toggle.click();
    await toggle.click();
    await expect(again.locator('h2')).toHaveText('Play again');
    expect(await titlesOf(again)).toEqual(['Song number 101', 'Song number 102']);
});

test('the page\'s own control is an icon that stays within reach while the list scrolls under it', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const list = component.locator('[data-explore-surface]');
    const refresh = component.locator('[data-explore-refresh]');
    const room = component.locator('[data-explore-controls-room]');
    const boxOf = async (element: typeof refresh) => { const box = (await element.boundingBox())!; return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]; };
    const fade = () => list.evaluate(element => element.style.getPropertyValue('--ex-top-fade'));
    await expect(component.locator('[data-explore-shelf]')).toHaveCount(6);

    // An icon with a name and no words, of the size of the heading rows' own buttons. At the top
    // of the list it stands where the first heading row leaves it room, and nothing fades.
    await expect(refresh).toHaveText('');
    await expect(refresh).toHaveAttribute('aria-label', 'Refresh');
    await expect(refresh).toHaveAttribute('title', 'Refresh');
    const atTop = await boxOf(refresh);
    expect(atTop.slice(2)).toEqual([32, 32]);
    await expect.poll(async () => {
        const roomAtTop = await boxOf(room);
        return [Math.abs(atTop[0] - roomAtTop[0]) <= 1, Math.abs(atTop[1] - roomAtTop[1]) <= 1, ...roomAtTop.slice(2)];
    }).toEqual([true, true, 32, 32]);
    expect(await fade()).toBe('0px');
    await expect(component.locator('[data-floating]')).toHaveCount(0);

    // The list scrolls: the room goes up with its row, the control stays where it was, over the
    // list, and what passes under the list's top edge fades out.
    await list.evaluate(element => { element.scrollTop = 20; });
    await expect.poll(fade).toBe('20px');
    await expect(component.locator('[data-floating]')).toHaveCount(1);
    await list.evaluate(element => { element.scrollTop = 400; });
    await expect.poll(fade).toBe('56px');
    await expect(room).not.toBeInViewport();
    expect(await boxOf(refresh)).toEqual(atTop);

    // Pressed from there, the page is read anew and the list stays where the listener stands.
    await component.locator('[data-probe-no-further]').click();
    await component.locator('[data-probe-hold]').click();
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await component.locator('[data-probe-release]').click();
    await expect(refresh).toBeEnabled();
    await page.waitForTimeout(300);
    expect(await list.evaluate(element => element.scrollTop)).toBe(400);
    await expect(component.locator('[data-floating]')).toHaveCount(1);

    // The home screen is taken down and comes back to that place: the control floats there at once.
    const toggle = component.locator('[data-probe-toggle="surface"]');
    await toggle.click();
    await toggle.click();
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(400);
    await expect(component.locator('[data-floating]')).toHaveCount(1);
    expect(await fade()).toBe('56px');

    // Back at the top it is one of the first heading row's buttons again.
    await list.evaluate(element => { element.scrollTop = 0; });
    await expect.poll(fade).toBe('0px');
    await expect(component.locator('[data-floating]')).toHaveCount(0);
    expect(await boxOf(refresh)).toEqual(atTop);
});

// Notes, from now on, how each entry that has a picture to uncover (a row's card, the large
// entry; not a line of the list) is drawn at the moment it is put on the page: how much of its
// picture is cut off (`clip-path`), and whether the entry itself is turned (`turned`) or not (`flat`).
const watchArrivals = (page: { evaluate: (run: () => void) => Promise<void> }) => page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { exploreArrivalsSeen: string[] }).exploreArrivalsSeen = seen;
    new MutationObserver(records => {
        for (const node of records.flatMap(record => [...record.addedNodes])) {
            if (!(node instanceof HTMLElement)) continue;
            for (const card of node.querySelectorAll('[data-explore-card]')) {
                const picture = card.querySelector('img')?.parentElement;
                if (!picture || card.parentElement?.matches('[data-explore-row]')) continue;
                seen.push(`${getComputedStyle(picture).clipPath} ${getComputedStyle(card).transform === 'none' ? 'flat' : 'turned'}`);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
});
const arrivalsSeen = (page: { evaluate: <T>(run: () => T) => Promise<T> }) => page.evaluate(() => (window as unknown as { exploreArrivalsSeen: string[] }).exploreArrivalsSeen.splice(0));
const arrivalsCounted = (page: { evaluate: <T>(run: () => T) => Promise<T> }) => page.evaluate(() => (window as unknown as { exploreArrivalsSeen: string[] }).exploreArrivalsSeen.length);

test('a page seen for the first time uncovers its pictures, and one read in its place turns its entries over', async ({ page }) => {
    // The probe answers every read after 600 ms here: the page is watched from before it is there.
    await page.goto('?probe=exploreSurface&slow=600');
    await watchArrivals(page);
    const shelves = page.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(6);
    const card = shelves.nth(2).locator('[data-explore-card]').last();
    const picture = card.locator('img').locator('..');

    // Every picture starts covered, to be uncovered from the left, in an entry that lies flat.
    const first = await arrivalsSeen(page);
    expect(first.length).toBeGreaterThan(20);
    expect(new Set(first)).toEqual(new Set(['inset(0% 100% 0% 0%) flat']));
    // The heading is drawn with it: its rule runs out to its full length.
    await expect(shelves.nth(2).locator('[data-explore-rule]')).toHaveCSS('transform', 'none');
    // At rest nothing of an entry is cut, filtered or transformed.
    await expect(picture).toHaveCSS('clip-path', 'none');
    await expect(picture).toHaveCSS('filter', 'none');
    await expect(picture).toHaveCSS('transform', 'none');
    await expect(card).toHaveCSS('transform', 'none');

    // Read anew. The entries shown turn away, section after section down the page: the first card
    // of the fifth section starts three sections' wait (0.15 s) after that of the second.
    await page.evaluate(() => {
        const started: number[] = [];
        (window as unknown as { exploreTurnsStarted: number[] }).exploreTurnsStarted = started;
        const cards = [1, 4].map(index => document.querySelectorAll('[data-explore-shelf]')[index].querySelector('[data-explore-place] [data-explore-card]')!);
        const watch = () => {
            cards.forEach((entry, at) => { if (started[at] === undefined && getComputedStyle(entry).transform !== 'none') started[at] = performance.now(); });
            if (started[0] === undefined || started[1] === undefined) requestAnimationFrame(watch);
        };
        watch();
    });
    // (The page is read for it: the probe's sections have no further entries from here on.)
    await page.locator('[data-probe-no-further]').click();
    await page.locator('[data-explore-refresh]').click();
    const turnsStarted =() => page.evaluate(() => [...(window as unknown as { exploreTurnsStarted: number[] }).exploreTurnsStarted]);
    await expect.poll(async () => (await turnsStarted()).filter(at => at !== undefined && at !== null).length).toBe(2);
    const [second, fifth] = await turnsStarted();
    expect(fifth - second).toBeGreaterThan(80);
    expect(fifth - second).toBeLessThan(400);
    // As many entries come, down to the last section, whole and turned away, and turn in.
    await expect.poll(() => arrivalsCounted(page)).toBe(first.length);
    expect(new Set(await arrivalsSeen(page))).toEqual(new Set(['none turned']));
    await expect(card).toHaveCSS('opacity', '1');
    await expect(card).toHaveCSS('transform', 'none');
    await expect(picture).toHaveCSS('clip-path', 'none');
});

test('the page has one light, under its first entry until another one is pointed at', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(6);
    const light = component.locator('[data-explore-light]');
    const list = component.locator('[data-explore-surface]');
    const pictureOf = (entry: ReturnType<typeof shelves.locator>) => entry.locator('img').first().evaluate(image => (image as HTMLImageElement).src);
    const lightPictures = () => light.locator('img').evaluateAll(images => images.map(image => (image as HTMLImageElement).src));
    // Where the light stands: its middle, which is the corner of the layer that carries it.
    const lightAt = () => light.locator(':scope > div').evaluate(layer => { const box = layer.getBoundingClientRect(); return [Math.round(box.left), Math.round(box.top)]; });
    const middleOf = (entry: ReturnType<typeof shelves.locator>) => entry.locator('img').first().evaluate(image => { const box = image.getBoundingClientRect(); return [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)]; });
    // (To the few pixels by which an entry that is pointed at stands higher than it did when the light was sent to it.)
    const near = ([x, y]: number[], [toX, toY]: number[]) => Math.abs(x - toX) <= 5 && Math.abs(y - toY) <= 5;

    // It is made of the first entry's picture and lies under it. It stands behind the list, not in
    // it: whatever it reaches, the list scrolls no further for it.
    const large = shelves.first().locator('[data-explore-card]').first();
    await expect.poll(lightPictures).toEqual([await pictureOf(large)]);
    await expect.poll(async () => near(await lightAt(), await middleOf(large))).toBe(true);
    expect(await light.evaluate(layer => layer.parentElement!.querySelector('[data-explore-surface]')!.contains(layer))).toBe(false);

    // Pointed at, another entry has it: it becomes that one's picture and drifts under it, and
    // stays there when the pointer has left the list.
    const other = shelves.nth(2).locator('[data-explore-card]').nth(3);
    await other.hover();
    await page.mouse.move(2, 2);
    await expect.poll(lightPictures).toEqual([await pictureOf(other)]);
    await expect.poll(async () => near(await lightAt(), await middleOf(other))).toBe(true);
    // It goes up with the list: by as much as the list is scrolled, at once. (Read within two frames of the scroll.
    // The scroll brings the list's end into reach, and what is read there has the light sent to its entry anew,
    // now that the entry stands where it rests: it then drifts those few pixels, slowly.)
    await page.waitForTimeout(1500);
    const [lightWent, listWent] = await list.evaluate(async element => {
        const layer = element.parentElement!.querySelector('[data-explore-light] > div')!;
        const [lightBefore, listBefore] = [layer.getBoundingClientRect().top, element.scrollTop];
        element.scrollTop += 75;
        await new Promise(resolve => { requestAnimationFrame(() => requestAnimationFrame(resolve)); });
        return [lightBefore - layer.getBoundingClientRect().top, element.scrollTop - listBefore];
    });
    expect(listWent).toBeGreaterThan(30);
    expect(Math.abs(lightWent - listWent)).toBeLessThanOrEqual(1);
    await expect.poll(async () => near(await lightAt(), await middleOf(other))).toBe(true);
    expect(await lightPictures()).toEqual([await pictureOf(other)]);

    // The entry it lies under leaves with a read of the page: the light is the first entry's again.
    await component.locator('[data-probe-no-further]').click();
    await component.locator('[data-explore-refresh]').click();
    await expect(component.locator('[data-explore-refresh]')).toBeEnabled();
    await expect.poll(async () => (await lightPictures()).join() === await pictureOf(shelves.first().locator('[data-explore-card]').first())).toBe(true);

    // A page without an entry has no light.
    await component.locator('[data-probe-hold]').click();
    await component.locator('[data-probe-forget]').click();
    await expect(shelves).toHaveCount(0);
    await expect.poll(lightPictures).toEqual([]);
});

test('a picture leans to the pointer over its entry, and the song on the player is marked and takes the beat', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const shelves = component.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(6);
    const list = component.locator('[data-explore-surface]');
    const card = shelves.nth(2).locator('[data-explore-card]').first();
    await expect(card).toHaveCSS('opacity', '1');
    // (What is written under its picture is below a window this high.)
    await card.locator('span.line-clamp-2').scrollIntoViewIfNeeded();
    const picture = card.locator('[data-explore-tilt]');
    const leanOf = (entry: typeof picture) => entry.evaluate(element => ['--ex-ry', '--ex-rx', '--ex-py'].map(name => element.style.getPropertyValue(name)));

    // Nine tenths across the picture and a fifth down it: the right and the top go back, by that share of six degrees.
    const box = (await picture.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.2);
    await expect(picture).toHaveAttribute('data-explore-tilting', '');
    await expect.poll(() => leanOf(picture)).toEqual(['4.80deg', '3.60deg', '-0.600']);
    await expect(picture).not.toHaveCSS('transform', 'none');
    // Over what is written under the picture it leans as far as it goes; over another entry, that one leans instead.
    const caption = (await card.locator('span.line-clamp-2').boundingBox())!;
    await page.mouse.move(caption.x + 4, caption.y + caption.height / 2);
    await expect.poll(async () => (await leanOf(picture))[2]).toBe('1.000');
    const next = shelves.nth(2).locator('[data-explore-card]').nth(1).locator('[data-explore-tilt]');
    await next.hover();
    await expect(next).toHaveAttribute('data-explore-tilting', '');
    await expect(picture).not.toHaveAttribute('data-explore-tilting');
    await expect(picture).toHaveCSS('transform', 'none');
    // The list scrolled under a pointer that stands still: the picture that went from under it
    // leans no more, and the next move of the pointer has the one under it lean.
    await list.evaluate(element => { element.scrollTop += 6; });
    await expect(component.locator('[data-explore-tilting]')).toHaveCount(0);
    await next.hover();
    await expect(next).toHaveAttribute('data-explore-tilting', '');
    // The pointer gone from the list, nothing leans.
    await page.mouse.move(2, 2);
    await expect(component.locator('[data-explore-tilting]')).toHaveCount(0);
    await expect(next).toHaveCSS('transform', 'none');

    // A steady bass sounds, and a song is played: it alone is marked, with levels where its length was written.
    await expect(component.locator('[data-explore-playing], [data-explore-levels]')).toHaveCount(0);
    await component.locator('[data-probe-hum]').click();
    await card.click();
    await page.mouse.move(2, 2);
    await expect(card).toHaveAttribute('data-explore-playing', 'sounding');
    await expect(card).toHaveAttribute('aria-current', 'true');
    await expect(card.locator('[data-explore-levels]')).toHaveCount(1);
    await expect(card.locator('span.font-mono')).toHaveCount(0);
    await expect(component.locator('[data-explore-playing]')).toHaveCount(1);
    // What the entry is told of the beat is noted from now on: the most it was, and the largest its picture was drawn.
    await card.evaluate(element => {
        const told = { beat: 0, scale: 1 };
        (window as unknown as { exploreBeatTold: typeof told }).exploreBeatTold = told;
        const beaten = element.querySelector('[data-explore-beat]')!;
        new MutationObserver(() => {
            told.beat = Math.max(told.beat, Number(element.style.getPropertyValue('--ex-beat')));
            told.scale = Math.max(told.scale, Number(getComputedStyle(beaten).scale) || 1);
        }).observe(element, { attributes: true, attributeFilter: ['style'] });
    });
    const told = () => page.evaluate(() => ({ ...(window as unknown as { exploreBeatTold: { beat: number; scale: number } }).exploreBeatTold }));
    const beatNow = () => card.evaluate(element => Number(element.style.getPropertyValue('--ex-beat') || 'NaN'));
    // It is told of the sound, and a bass that only goes on is no beat.
    await expect.poll(() => card.evaluate(element => Number(element.style.getPropertyValue('--ex-low')))).toBeGreaterThan(0.2);
    await page.waitForTimeout(500);
    expect((await told()).beat).toBeLessThan(0.1);
    // A kick is one: the entry is told so, its picture is larger for it, and then it is over.
    await component.locator('[data-probe-kick]').click();
    await expect.poll(async () => (await told()).beat).toBeGreaterThan(0.5);
    expect((await told()).scale).toBeGreaterThan(1.01);
    await expect.poll(beatNow).toBeLessThan(0.1);
    // Held: it is still the song on the player, and nothing of the sound is left on it.
    await component.locator('[data-probe-pause]').click();
    await expect(card).toHaveAttribute('data-explore-playing', 'held');
    await expect(card.locator('[data-explore-levels]')).toHaveCount(1);
    expect(await card.evaluate(element => element.style.getPropertyValue('--ex-beat'))).toBe('');
    await expect(picture).toHaveCSS('scale', 'none');
    // Another song, in the list beside the large entry: the mark goes to it, where that line's length was written.
    const line = shelves.first().locator('[data-explore-row] [data-explore-card]').nth(1);
    await expect(line.locator('span.font-mono')).toHaveCount(1);
    await line.click();
    await expect(line).toHaveAttribute('data-explore-playing', 'sounding');
    await expect(line.locator('[data-explore-levels]')).toHaveCount(1);
    await expect(line.locator('span.font-mono')).toHaveCount(0);
    await expect(component.locator('[data-explore-playing]')).toHaveCount(1);
});

test('with reduced motion the page fades in place: nothing is uncovered, turned or leant', async ({ page }) => {
    // (After the fixture's own script, which empties the store this is read from.)
    await page.addInitScript(() => { localStorage.setItem('reduce_motion_uiMicroMotion', 'true'); });
    await page.goto('?probe=exploreSurface&slow=600');
    await watchArrivals(page);
    const shelves = page.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(6);
    const card = shelves.nth(2).locator('[data-explore-card]').first();
    await expect(card).toHaveCSS('opacity', '1');
    const first = await arrivalsSeen(page);
    expect(first.length).toBeGreaterThan(20);
    expect(new Set(first)).toEqual(new Set(['none flat']));
    await page.locator('[data-probe-no-further]').click();
    await page.locator('[data-explore-refresh]').click();
    await expect.poll(() => arrivalsCounted(page)).toBe(first.length);
    expect(new Set(await arrivalsSeen(page))).toEqual(new Set(['none flat']));
    await expect(card).toHaveCSS('opacity', '1');
    await card.hover();
    await page.waitForTimeout(200);
    await expect(page.locator('[data-explore-tilting]')).toHaveCount(0);
    // The song played is marked all the same, and is told nothing of the sound.
    await page.locator('[data-probe-hum]').click();
    await card.click();
    await expect(card).toHaveAttribute('data-explore-playing', 'sounding');
    await page.locator('[data-probe-kick]').click();
    await page.waitForTimeout(300);
    expect(await card.evaluate(element => element.style.getPropertyValue('--ex-low') + element.style.getPropertyValue('--ex-beat'))).toBe('');
});

// Notes, frame by frame for `ms`, how high the list's content is and where each section's heading stands in the window.
interface ListFrame { high: number; tops: Record<string, number> }
const watchList = (page: Page, ms: number) => page.evaluate(duration => {
    const surface = document.querySelector('[data-explore-surface]')!;
    const frames: ListFrame[] = [];
    (window as unknown as { exploreListFrames: ListFrame[] }).exploreListFrames = frames;
    const start = performance.now();
    const note = () => {
        const tops: Record<string, number> = {};
        for (const heading of surface.querySelectorAll('[data-explore-shelf] h2')) tops[heading.textContent ?? ''] = Math.round(heading.getBoundingClientRect().top);
        frames.push({ high: surface.scrollHeight, tops });
        if (performance.now() - start < duration) requestAnimationFrame(note);
    };
    requestAnimationFrame(note);
}, ms);
const listFrames = (page: Page) => page.evaluate(() => (window as unknown as { exploreListFrames: ListFrame[] }).exploreListFrames);
const travelOf = (frames: ListFrame[], heading: string) => {
    const tops = frames.map(frame => frame.tops[heading]);
    return Math.max(...tops) - Math.min(...tops);
};

test('a refresh takes no section off the page: the list stays as high as it was, and a listener at its end where they stand', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    const list = component.locator('[data-explore-surface]');
    const shelves = component.locator('[data-explore-shelf]');
    const refresh = component.locator('[data-explore-refresh]');
    const toEnd = () => list.evaluate(element => element.scrollTo(0, element.scrollHeight));
    // The page's further section has been read, and the listener stands at it, at the list's end.
    await toEnd();
    await component.locator('[data-explore-retry]').click();
    await expect(shelves).toHaveCount(7);
    await toEnd();
    await page.waitForTimeout(1500);
    await component.evaluate(root => { for (const body of root.querySelectorAll('[data-explore-body]')) body.setAttribute('data-test-kept', ''); });
    const before = await list.evaluate(element => ({ top: element.scrollTop, high: element.scrollHeight }));
    expect(before.top).toBeGreaterThan(400);

    // (A refresh that reads the page: the probe's sections have no further entries from here on.)
    await component.locator('[data-probe-no-further]').click();
    await watchList(page, 3000);
    await refresh.click();
    await page.waitForTimeout(3200);
    await expect(refresh).toBeEnabled();
    const frames = await listFrames(page);
    expect(frames.length).toBeGreaterThan(60);
    // At no moment was a section gone or the list lower, and what the listener was looking at did not move.
    expect(Math.min(...frames.map(frame => Object.keys(frame.tops).length))).toBe(7);
    expect([Math.min(...frames.map(frame => frame.high)), Math.max(...frames.map(frame => frame.high))]).toEqual([before.high, before.high]);
    expect(travelOf(frames, 'A shelf from the next page')).toBe(0);
    expect(travelOf(frames, 'Shelf 80')).toBe(0);
    expect(await list.evaluate(element => element.scrollTop)).toBe(before.top);
    // The read did happen: the six sections of the first page have other entries (the probe's platform hands
    // other ones with every read); the further one, which that page does not have, has the ones it had.
    await expect(component.locator('[data-explore-body][data-test-kept]')).toHaveCount(1);
    await expect(shelves.last().locator('[data-explore-body]')).toHaveAttribute('data-test-kept', '');
    await expect(shelves.last().locator('[data-explore-waiting]')).toHaveCount(0);
});

test('further sections join at the list\'s end without the list losing height first', async ({ page }) => {
    // (Every read takes a while here: what stands at the list's end while one is under way is seen for some frames.)
    await page.goto('?probe=exploreSurface&slow=300');
    const component = page.locator('body');
    const list = component.locator('[data-explore-surface]');
    const shelves = component.locator('[data-explore-shelf]');
    await expect(shelves).toHaveCount(6);
    const toEnd = () => list.evaluate(element => element.scrollTo(0, element.scrollHeight));
    await toEnd();
    const retry = component.locator('[data-explore-retry]');
    await expect(retry).toBeVisible();
    await toEnd();
    await page.waitForTimeout(600);
    const before = await list.evaluate(element => ({ top: element.scrollTop, high: element.scrollHeight }));

    // What stands at the list's end (the offer to try again, then the mark that more is being read) goes
    // as the section comes: the list only grows, and what the listener was looking at stays where it was.
    await watchList(page, 2000);
    await retry.click();
    await expect(shelves).toHaveCount(7);
    await page.waitForTimeout(2100);
    const frames = await listFrames(page);
    expect(frames.length).toBeGreaterThan(60);
    expect(Math.min(...frames.map(frame => frame.high))).toBe(before.high);
    expect(frames.at(-1)!.high).toBeGreaterThan(before.high);
    expect(travelOf(frames.filter(frame => 'Shelf 80' in frame.tops), 'Shelf 80')).toBe(0);
    expect(await list.evaluate(element => element.scrollTop)).toBe(before.top);
    // The section that came is shown: its entries arrived as a first page's do.
    await expect(shelves.last().locator('[data-explore-card]').first()).toHaveCSS('opacity', '1');
    await expect(shelves.last()).toHaveCSS('opacity', '1');
});

test('a refresh shows the entries that follow the ones shown, and reads the page only once all were shown', async ({ mount }) => {
    const component = await mount('exploreSurface');
    const list = component.locator('[data-explore-surface]');
    const high = () => list.evaluate(element => element.scrollHeight);
    const shelves = component.locator('[data-explore-shelf]');
    const refresh = component.locator('[data-explore-refresh]');
    const first = shelves.first().locator('[data-explore-card]');
    const mark = () => component.evaluate(root => { for (const body of root.querySelectorAll('[data-explore-body]')) body.setAttribute('data-test-kept', ''); });
    const read = async () => {
        await mark();
        await refresh.click();
        await expect(refresh).toBeEnabled();
    };
    await expect(shelves).toHaveCount(6);
    await expect(first).toHaveCount(6);
    await component.locator('[data-probe-same-entries]').click();
    const before = await high();

    // The first section has three further songs behind its "more": they take the place of the six shown.
    // No other section has anything further: each keeps its entries, which were not exchanged for themselves.
    await read();
    await expect(first).toHaveCount(3);
    await expect(first).toContainText(['Song number 10', 'Song number 11', 'Song number 12']);
    await expect(shelves.first().locator('[data-explore-more]')).toHaveCount(0);
    await expect(component.locator('[data-explore-body][data-test-kept]')).toHaveCount(5);
    await expect(shelves.first().locator('[data-explore-body][data-test-kept]')).toHaveCount(0);
    await expect(component.locator('[data-explore-waiting]')).toHaveCount(0);
    // The section is as high with three entries as it was with six: the list below it stays where it was.
    await expect(shelves.first().locator('[data-explore-card]').last()).toHaveCSS('opacity', '1');
    expect(await high()).toBe(before);

    // Every entry was shown: the page is read (it hands the same entries back), and the section starts over.
    await read();
    await expect(first).toContainText([1, 2, 3, 4, 5, 6].map(number => `Song number ${number}`));
    await expect(shelves.first().locator('[data-explore-more]')).toHaveCount(1);
    await expect(component.locator('[data-explore-body][data-test-kept]')).toHaveCount(5);
    await read();
    await expect(first).toContainText(['Song number 10', 'Song number 11', 'Song number 12']);
});

test('an entry that opens a collection carries the mark a cover flies from, and a song none', async ({ mount, page }) => {
    const component = await mount('exploreSurface');
    await expect(component.locator('[data-explore-card]').first()).toBeVisible();
    const marks = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-explore-card]')];
        const isSong = (card: Element) => card.getAttribute('data-explore-card') === 'song';
        return {
            collections: cards.filter(card => !isSong(card)).length,
            marked: cards.filter(card => !isSong(card) && /^[a-z]+:.+/.test(card.getAttribute('data-folia-morph-source') ?? '')).length,
            markedSongs: cards.filter(card => isSong(card) && card.hasAttribute('data-folia-morph-source')).length,
        };
    });
    expect(marks.collections).toBeGreaterThan(0);
    expect(marks.marked).toBe(marks.collections);
    expect(marks.markedSongs).toBe(0);
});
