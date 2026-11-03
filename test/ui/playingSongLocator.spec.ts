import { expect, test, type Page } from '@playwright/test';
import { installBaseState, localImportFixture, mockNavidromeApi, mockNeteaseApi, NAVIDROME_SERVER, openApp } from './helpers/appFixtures';

// test/ui/playingSongLocator.spec.ts
// “定位正在播放的歌”横跨歌单页、导航和播放页面板，单个组件的测试看不到它们接没接上：
// 从播放页面板的“播放自 …”回到那张歌单，落在那首歌的卡片上，不能说“这里没有”；
// 在另一张歌单的页面上按它自己的定位按钮，只在那一页找：说“这里没有”，不换页。
// Navidrome 的页面不自己读歌，歌是首页读好给它的：读取失败时页面得知道，说“没读完”，不说“这里没有”。

const NOT_HERE = 'The playing song is not in this list';
const NOT_WHOLE = 'This list is not fully loaded yet, so the song cannot be located';

const view = (page: Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useAppViewStore.ts';
    const { useAppViewStore } = await import(storeModulePath);
    return useAppViewStore.getState().view as string;
});
// The name of the collection whose page is open, '' when none is.
const openCollection = (page: Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useCollectionNavigationStore.ts';
    const { useCollectionNavigationStore } = await import(storeModulePath);
    const stack = useCollectionNavigationStore.getState().snapshot?.stack ?? [];
    return String(stack[stack.length - 1]?.name ?? '');
});
// From here on every status line the app shows is kept, also one that came and went.
const watchStatus = (page: Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/useStatusMessageStore.ts';
    const { useStatusMessageStore } = await import(storeModulePath);
    const said: string[] = [];
    (window as unknown as { saidLines: string[] }).saidLines = said;
    useStatusMessageStore.subscribe((state: { message: { text?: string } | null }) => {
        if (state.message?.text) said.push(state.message.text);
    });
});
const saidLines = (page: Page) => page.evaluate(() => (window as unknown as { saidLines: string[] }).saidLines);
// Whether a question still waits for a page to answer it.
const isAsked = (page: Page) => page.evaluate(async () => {
    const storeModulePath = '/src/stores/usePlayingSongLocatorStore.ts';
    const { usePlayingSongLocatorStore } = await import(storeModulePath);
    return usePlayingSongLocatorStore.getState().request !== null;
});
const importFixtureFolder = async (page: Page, navidromeEnabled = false) => {
    await installBaseState(page, { neteaseMode: 'guest', navidromeEnabled, localImportFixture });
    await mockNeteaseApi(page, 'guest');
    if (navidromeEnabled) await mockNavidromeApi(page);
    await openApp(page);
    await page.getByRole('button', { name: 'Folder' }).last().click();
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByText('All Songs').first()).toBeVisible();
};
// Makes the folder picker give a second folder, holding one song the first folder does not.
const offerSecondFolder = (page: Page) => page.evaluate(() => {
    const file = {
        kind: 'file' as const,
        name: 'Other Artist - Daybreak.mp3',
        getFile: async () => new File(['other-fake-audio-data'], 'Other Artist - Daybreak.mp3', { type: 'audio/mpeg', lastModified: 1710000001000 }),
    };
    Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => ({
            kind: 'directory' as const,
            name: 'Second Library',
            async *values() { yield file; },
            getFileHandle: async (name: string) => {
                if (name !== file.name) throw new DOMException(`Missing file: ${name}`, 'NotFoundError');
                return file;
            },
            getDirectoryHandle: async () => { throw new DOMException('No nested directories', 'NotFoundError'); },
            queryPermission: async () => 'granted',
            requestPermission: async () => 'granted',
        }),
    });
});
// A card that is not in the middle of the home screen comes there on the first press and opens on the next.
const openPage = async (page: Page, name: string) => {
    await expect.poll(async () => {
        if (await openCollection(page) !== name) await page.getByRole('heading', { name }).first().click();
        return openCollection(page);
    }).toBe(name);
    await expect(page.locator('[data-folia-grid-item-id]').first()).toBeVisible();
};
// Plays the card in the middle of the collection page, which takes the listener to the player.
const playFocusedCard = async (page: Page) => {
    await expect.poll(async () => {
        if (await view(page) !== 'player') await page.keyboard.press('Enter');
        return view(page);
    }).toBe('player');
};

test('"playing from" on the panel leads from the player back to the collection and the playing song in it', async ({ page }) => {
    await importFixtureFolder(page);
    await openPage(page, 'All Songs');
    // Nothing plays yet: the page offers nothing to locate.
    await expect(page.locator('[data-grid-locate]')).toHaveCount(0);
    await playFocusedCard(page);
    await watchStatus(page);

    await page.getByTestId('panel-toggle').locator('button').last().click();
    const cover = page.locator('[data-ponder-panel-artwork]');
    await expect(cover).toBeVisible();
    // The pointer over the cover shows what stands on it; where there is no hover, a tap on the cover does.
    await cover.click();
    const from = page.locator('[data-panel-locate]');
    await expect(from).toContainText('All Songs');
    await from.click();
    await expect.poll(() => view(page)).toBe('home');
    expect(await openCollection(page)).toBe('All Songs');
    const locate = page.locator('[data-grid-locate]');
    // The page has answered: the question is gone, and it was not answered with "not here".
    await expect.poll(() => isAsked(page)).toBe(false);
    await expect(locate).toHaveAttribute('data-grid-locate', 'here');
    await expect(locate).toHaveAttribute('data-grid-locate-seeking', 'no');
    expect(await saidLines(page)).not.toContain(NOT_HERE);
});

test('a queue started with "play all" on a collection page is of that collection', async ({ page }) => {
    await importFixtureFolder(page);
    await openPage(page, 'All Songs');
    // The page's own title opens the panel that holds the button.
    await page.locator('h2', { hasText: 'All Songs' }).last().click();
    await page.getByRole('button', { name: 'Play All' }).click();
    await expect.poll(() => view(page)).toBe('player');
    await page.getByTestId('panel-toggle').locator('button').last().click();
    const cover = page.locator('[data-ponder-panel-artwork]');
    await expect(cover).toBeVisible();
    await cover.click();
    await expect(page.locator('[data-panel-locate]')).toContainText('All Songs');
});

test('the locate button on the page of another collection says the song is not there, and stays', async ({ page }) => {
    await importFixtureFolder(page);
    await offerSecondFolder(page);
    await page.getByRole('button', { name: 'Import Folder' }).last().click();
    await expect(page.getByRole('heading', { name: 'Second Library' }).first()).toBeVisible();

    // A song is played from the second folder's page, and the listener goes home.
    await openPage(page, 'Second Library');
    await playFocusedCard(page);
    await page.goBack();
    await expect.poll(() => view(page)).toBe('home');
    await page.goBack();
    await expect.poll(() => openCollection(page)).toBe('');

    // On the first folder's page, which does not hold that song, the button looks on that page alone.
    await openPage(page, localImportFixture.rootName);
    const locate = page.locator('[data-grid-locate]');
    await expect(locate).toHaveAttribute('data-grid-locate', 'elsewhere');
    await watchStatus(page);
    await locate.click();
    await expect.poll(() => saidLines(page)).toContain(NOT_HERE);
    await expect.poll(() => isAsked(page)).toBe(false);
    expect(await openCollection(page)).toBe(localImportFixture.rootName);
    await expect(locate).toHaveAttribute('data-grid-locate', 'elsewhere');
});

// A Navidrome page reads nothing itself: the home screen reads its tracks and gives them to it.
// A local song plays, the queue is made out to be the album's (playing a Navidrome song needs a
// stream this test has none of), and the player's "playing from" leads to the album's page.
// `refused` holds the ids of the albums whose read the server refuses.
const goToNavidromeAlbum = async (page: Page, album: string, refused: Set<string>) => {
    await importFixtureFolder(page, true);
    await page.route(url => url.origin === NAVIDROME_SERVER && url.pathname === '/rest/getAlbum', route => (
        refused.has(new URL(route.request().url()).searchParams.get('id') ?? '')
            ? route.fulfill({ status: 500, body: '' })
            : route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ 'subsonic-response': { status: 'ok', album: { id: album, name: 'Navi Album', song: [{ id: 'navi-song', title: 'Navi Song', artist: 'Navi Artist', album: 'Navi Album', duration: 200 }] } } }),
            })
    ));
    await openPage(page, 'All Songs');
    await playFocusedCard(page);
    await page.evaluate(async (id) => {
        const [locatorStorePath, playbackStorePath, guardsPath] = ['/src/stores/usePlayingSongLocatorStore.ts', '/src/stores/usePlaybackStore.ts', '/src/utils/appPlaybackGuards.ts'];
        const { usePlayingSongLocatorStore } = await import(locatorStorePath);
        const { usePlaybackStore } = await import(playbackStorePath);
        const { getPlaybackSongKey } = await import(guardsPath);
        const { currentSong, playQueue } = usePlaybackStore.getState();
        usePlayingSongLocatorStore.getState().setSource({
            collection: { source: 'navidrome', id, name: 'Navi Album', type: 'album' },
            songKeys: new Set([currentSong, ...playQueue].map(getPlaybackSongKey)),
        });
    }, album);
    await watchStatus(page);

    await page.getByTestId('panel-toggle').locator('button').last().click();
    const cover = page.locator('[data-ponder-panel-artwork]');
    await expect(cover).toBeVisible();
    await cover.click();
    const from = page.locator('[data-panel-locate]');
    await expect(from).toContainText('Navi Album');
    await from.click();
    await expect.poll(() => view(page)).toBe('home');
    expect(await openCollection(page)).toBe('Navi Album');
    // The page answers once the read is over.
    await expect.poll(() => isAsked(page)).toBe(false);
};

test('"playing from" on a Navidrome album whose tracks were read says the song is not there', async ({ page }) => {
    await goToNavidromeAlbum(page, 'navi-album', new Set());
    expect(await saidLines(page)).toEqual([NOT_HERE]);
    await expect(page.locator('[data-folia-grid-item-id]')).toHaveCount(1);
});

test('"playing from" on a Navidrome album whose read failed says the list is not whole, until a read succeeds', async ({ page }) => {
    const refused = new Set(['navi-album']);
    await goToNavidromeAlbum(page, 'navi-album', refused);
    expect(await saidLines(page)).toEqual([NOT_WHOLE]);
    // The page holds no card, and says that the read failed, not that the album is empty.
    await expect(page.locator('[data-folia-grid-item-id]')).toHaveCount(0);
    await expect(page.getByText('Failed to load', { exact: true })).toBeVisible();
    await expect(page.getByText('No content', { exact: true })).toHaveCount(0);

    // The server answers again, and the album is opened anew: its list is whole now, and the song is not in it.
    refused.clear();
    await page.evaluate(async () => {
        const storeModulePath = '/src/stores/useCollectionNavigationStore.ts';
        const { useCollectionNavigationStore } = await import(storeModulePath);
        useCollectionNavigationStore.getState().openRoot({ source: 'navidrome', id: 'navi-album', name: 'Navi Album', type: 'album' }, 'home');
    });
    await expect(page.locator('[data-folia-grid-item-id]')).toHaveCount(1);
    await page.locator('[data-grid-locate]').click();
    await expect.poll(() => saidLines(page)).toEqual([NOT_WHOLE, NOT_HERE]);
});
