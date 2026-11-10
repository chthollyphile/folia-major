import { sleep } from '../rig.mjs';

// dev/perf/app/drive.mjs
// What a person does in the app, done through the DevTools protocol: real mouse clicks at the place
// an element is drawn and real key presses. Nothing here calls into the app's code; the app is
// found by what it shows (the English names of its buttons: the app is started with --lang=en-US).

/** Calls one function of the recorder in the page (dev/perf/app/probe.cjs). */
export const ask = (page, name, ...args) => page.evaluate(`window.__perfApp.${name}(${args.map(arg => JSON.stringify(arg)).join(', ')})`);

export const KEYS = {
    escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
    enter: { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' },
    // Ctrl + arrow: the app's keys for the next and the previous track.
    nextTrack: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, modifiers: 2 },
    previousTrack: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, modifiers: 2 },
    selectAll: { key: 'a', code: 'KeyA', keyCode: 65, modifiers: 2 },
};

/** The places of the app the runner looks for, by what the app shows. */
export const AT = {
    releaseNotesClose: { selector: '[data-testid=release-notes-close]' },
    useThisView: { selector: 'button', text: 'Use this', exact: true },
    ponderOpen: { selector: '[data-testid=ponder-onboarding-open-button]' },
    ponderStage: { selector: '[data-testid=ponder-stage]' },
    folderTab: { selector: 'button', label: 'Folder', text: 'Folder', exact: true },
    importFolder: { selector: 'button', text: 'Import Folder', exact: true },
    options: { selector: 'button', label: 'Options' },
    settings: { selector: '[role=dialog]', label: 'Settings', labelExact: true },
    searchBox: { selector: 'input' },
    searchPage: { selector: 'section' },
    backToPlayer: { selector: 'button', label: 'Back to Player' },
    latticePill: { selector: '[data-testid=home-lattice-pill]' },
    latticeLayer: { selector: 'div.absolute.inset-0.z-10.pointer-events-auto' },
    latticeWall: { selector: 'section.lattice-root' },
    latticeBack: { selector: 'button', label: 'The top-left button returns' },
    collectionPlay: { selector: 'button', label: 'Play', labelExact: true },
    collectionBack: { selector: 'button.absolute.left-6.top-5' },
    // The whole page of an album: the layer around its Back button, which is what fades when it is left.
    collectionPage: { selector: 'button.absolute.left-6.top-5', closest: 'div.fixed.inset-0' },
    // The Home surface: the layer App.tsx hides while the player page is in front, and the layer inside it that fades.
    homeMount: { selector: 'div.absolute.inset-0.z-10:not(.pointer-events-auto)' },
    homeLayer: { selector: 'div.absolute.inset-0.z-10:not(.pointer-events-auto) > div.absolute.inset-0' },
    visualSurface: '[data-testid=player-visual-surface]',
    // The card on the player page that names the playing song, with its small cover.
    songCard: 'button[aria-label="Open the song card"], button[title="Open the song card"]',
};

export const waitUntil = async (test, { timeoutMs = 20_000, everyMs = 100, what = 'a condition' } = {}) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await test();
        if (value) {
            return value;
        }
        if (Date.now() > deadline) {
            throw new Error(`[perf] waited ${timeoutMs} ms for ${what}`);
        }
        await sleep(everyMs);
    }
};

/**
 * Where an element is, once it is in the page, inside the window, nothing lies over it and it has
 * stopped moving: `looks` looks 120 ms apart find it in the same place with nothing over it. A
 * button that is still flying in, or that other things still fly across, would not be under the
 * click any more.
 */
export const locate = async (page, query, { timeoutMs = 15_000, looks = 2 } = {}) => {
    let last = null;
    try {
        return await waitUntil(async () => {
            last = await ask(page, 'locate', query);
            if (!last?.reachable) {
                return null;
            }
            for (let look = 1; look < looks; look += 1) {
                await sleep(120);
                const again = await ask(page, 'locate', query);
                if (!again?.reachable || again.x !== last.x || again.y !== last.y || again.width !== last.width) {
                    return null;
                }
            }
            return last;
        }, { timeoutMs, what: JSON.stringify(query) });
    } catch (error) {
        const offered = await ask(page, 'list', { selector: 'button, [role=button], input, [data-testid]' }, 30);
        throw new Error(`${error.message}${last ? ' (it is there, but something lies over it)' : ''}; the page offers: ${offered.map(entry => entry.label || entry.text || entry.testId).filter(Boolean).join(' | ').slice(0, 600)}`);
    }
};

export const clickOn = async (page, query, options) => {
    const at = await locate(page, query, options);
    await page.click(at.x, at.y);
    return at;
};

export const isThere = async (page, query) => (await ask(page, 'count', query)) > 0;
export const waitFor = (page, query, options = {}) => waitUntil(() => isThere(page, query), { what: JSON.stringify(query), ...options });
export const waitGone = (page, query, options = {}) => waitUntil(async () => !(await isThere(page, query)), { what: `${JSON.stringify(query)} to go`, ...options });

/**
 * A new user's first minutes: the release notes, the choice of the view Play opens (the default,
 * the visualizer, is kept) and the Ponder introduction. Each is answered the way a person would,
 * so the profile that is measured afterwards is one that has been used.
 */
export const passFirstRun = async (page) => {
    const done = [];
    let quietRounds = 0;
    while (quietRounds < 6) {
        if (await isThere(page, AT.releaseNotesClose)) {
            await clickOn(page, AT.releaseNotesClose);
            done.push('release notes closed');
        } else if (await isThere(page, AT.useThisView)) {
            await clickOn(page, AT.useThisView);
            done.push('view opened by Play: the default kept');
        } else if (await isThere(page, AT.ponderStage)) {
            await page.press(KEYS.escape);
            done.push('Ponder introduction left');
        } else if (await isThere(page, AT.ponderOpen)) {
            await clickOn(page, AT.ponderOpen);
            await waitFor(page, AT.ponderStage);
            done.push('Ponder introduction opened');
        } else {
            quietRounds += 1;
            await sleep(500);
            continue;
        }
        quietRounds = 0;
        await sleep(900);
    }
    return done;
};

/**
 * Imports a folder the way the app does it, with one step replaced: the system's folder dialog.
 * The folder is dropped on the page (a real drop of a real path, through the DevTools protocol),
 * which gives the page the same kind of handle the dialog would; `showDirectoryPicker` is then
 * made to answer with that handle, and the app's own Import Folder button is clicked. Everything
 * after the dialog is the app's: the scan, the metadata reader, the covers, the stored library.
 */
export const importFolder = async (page, folder) => {
    await page.evaluate(`(() => {
        window.__perfDropped = null;
        const onOver = (event) => { event.preventDefault(); event.stopPropagation(); };
        const onDrop = (event) => {
            event.preventDefault();
            event.stopPropagation();
            window.removeEventListener('dragover', onOver, true);
            window.removeEventListener('drop', onDrop, true);
            event.dataTransfer.items[0].getAsFileSystemHandle().then((handle) => { window.__perfDropped = handle; });
        };
        window.addEventListener('dragover', onOver, true);
        window.addEventListener('drop', onDrop, true);
    })()`);
    const data = { items: [], files: [folder], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await page.send('Input.dispatchDragEvent', { type, x: 960, y: 600, data });
        await sleep(100);
    }
    const name = await waitUntil(() => page.evaluate('window.__perfDropped ? window.__perfDropped.name : null'), { what: 'the dropped folder\'s handle' });
    await page.evaluate(`(() => {
        const handle = window.__perfDropped;
        const real = window.showDirectoryPicker;
        window.showDirectoryPicker = async () => { window.showDirectoryPicker = real; return handle; };
    })()`);
    await clickOn(page, AT.importFolder);
    return name;
};

/** The pictures of the home page's row of cards, left to right, and which of them is in the middle. */
const homeCards = async (page) => {
    const pictures = (await ask(page, 'list', { selector: 'img' }, 80))
        .filter(picture => picture.width >= 60 && picture.width <= 500 && picture.y > 300 && picture.y < 700)
        .sort((left, right) => left.x - right.x);
    const centre = pictures.reduce((best, picture) => (!best || picture.width > best.width ? picture : best), null);
    return { pictures, centre };
};

/** The name under the home page's middle card: "4 Tracks • Perf Library/Glass Harbour" gives the part after the dot. */
export const centredCard = async (page) => {
    const [text] = await ask(page, 'texts', '#root', '^\\d+ Tracks? • ', 1);
    return text ? text.replace(/^\d+ Tracks? • /, '') : null;
};

/** Brings the card with this name to the middle of the home page's row, by clicking the cards beside the middle one. */
export const centreCard = async (page, name) => {
    let direction = 1;
    for (let step = 0; step < 90; step += 1) {
        const centred = await centredCard(page);
        if (centred === name) {
            return;
        }
        const { pictures, centre } = await homeCards(page);
        const beside = pictures.filter(picture => (direction > 0 ? picture.x > centre.x + 10 : picture.x < centre.x - 10));
        if (beside.length === 0) {
            if (direction < 0) {
                break;
            }
            direction = -1;
            continue;
        }
        const next = direction > 0 ? beside[0] : beside[beside.length - 1];
        await page.click(next.x, next.y);
        await waitUntil(async () => (await centredCard(page)) !== centred, { timeoutMs: 5000, what: 'the row of cards to move' });
        await sleep(350);
    }
    throw new Error(`[perf] no card named "${name}" on the home page`);
};

/** From the home page: opens the page of one folder (a collection page). */
export const openCollection = async (page, name) => {
    await centreCard(page, name);
    const { centre } = await homeCards(page);
    await page.click(centre.x, centre.y);
    await waitUntil(async () => (await ask(page, 'hash')).startsWith('#collection'), { what: `the page of "${name}"` });
    // The page's cards fly in for about a second (longer on a slow profile) and pass over its Play button meanwhile.
    await locate(page, AT.collectionPlay, { looks: 8 });
};

/** The state of the audio element that is playing (the app has two; one is used at a time outside automix). */
export const playingAudio = async (page) => {
    const elements = await ask(page, 'audio');
    return elements.find(element => !element.paused && element.src) ?? null;
};

/** Waits until a song is playing and its clock moves. */
export const waitForSound = (page, options = {}) => waitUntil(async () => {
    const audio = await playingAudio(page);
    return audio && audio.currentTime > 0.2 ? audio : null;
}, { what: 'a song to play', ...options });

/**
 * Keeps a measurement away from the end of a song: when the playing song has less than `needSeconds`
 * left, it waits for the next one to have started. (The queue goes on by itself; a change of song in
 * the middle of a page switch would be measured as part of the switch.)
 */
export const awayFromSongEnd = async (page, needSeconds = 8) => {
    for (;;) {
        const audio = await playingAudio(page);
        if (!audio) {
            return false;
        }
        if (audio.duration - audio.currentTime >= needSeconds && audio.currentTime >= 4) {
            return true;
        }
        await sleep(500);
    }
};
