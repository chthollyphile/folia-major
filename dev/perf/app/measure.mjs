import fs from 'node:fs';
import path from 'node:path';
import { flattenNumbers, log, mean, median, outsideLoad, percentile, sleep, startSampler } from '../rig.mjs';
import { SAMPLER_SETTLE_SECONDS, SCREEN_RATE_SHARE } from '../scenarios.mjs';
import {
    AT,
    KEYS,
    ask,
    awayFromSongEnd,
    centreCard,
    clickOn,
    isThere,
    locate,
    openCollection,
    playingAudio,
    waitFor,
    waitForSound,
    waitGone,
    waitUntil,
} from './drive.mjs';
import { FIRST_WORD_AT_SECONDS } from './fixtures.mjs';
import { APP_DIST, attachPage, copyProfile, launchApp, processTree } from './launch.mjs';

// dev/perf/app/measure.mjs
// The four things measured of the whole app: start-up, a change of song, a switch of page, and
// memory. dev/perf/app/README.md says what starts and what stops every clock.

const round = (value, digits = 1) => (typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const megabytes = bytes => bytes / (1024 * 1024);

/** The median, the lowest and the highest of every number several records hold (a record without the number is left out of it). */
export const spreadOf = (records) => {
    const flat = records.map(record => flattenNumbers(record));
    const names = [...new Set(flat.flatMap(entry => Object.keys(entry)))];
    return Object.fromEntries(names.map((name) => {
        const values = flat.map(entry => entry[name]).filter(value => typeof value === 'number');
        return [name, { median: round(median(values), 2), min: round(Math.min(...values), 2), max: round(Math.max(...values), 2), runs: values.length }];
    }));
};

/**
 * Growth per round of a series of readings: the slope of the straight line through them. A reading
 * stands at its own round, so a number that is only read every fifth round (left out in between)
 * still gives growth per round.
 */
export const slopeOf = (values) => {
    const points = values.map((value, index) => [index, value]).filter(([, value]) => typeof value === 'number');
    if (points.length < 3) {
        return null;
    }
    const meanX = mean(points.map(([x]) => x));
    const meanY = mean(points.map(([, y]) => y));
    const over = points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0);
    const under = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
    return under ? over / under : null;
};

// ---------------------------------------------------------------------------------------------
// A session: one launch of the app from a copy of a prepared profile, under one machine profile
// ---------------------------------------------------------------------------------------------

/** Every process of the app is held to the profile's processors, or the launch does not count. */
const checkAffinity = (running, profile) => {
    const tree = processTree(running);
    if (tree.length === 0) {
        throw new Error('the app is gone');
    }
    const strays = profile.affinityMask ? tree.filter(entry => entry.affinity.toUpperCase() !== profile.affinityMask) : [];
    if (strays.length) {
        throw new Error(`not every process is held to ${profile.affinityMask}: ${JSON.stringify(strays.map(entry => [entry.pid, entry.kind, entry.affinity]))}`);
    }
    return tree;
};

const pacedRate = gaps => (gaps.length ? 1000 / percentile(gaps, 0.25) : 0);

/**
 * Waits until the recorder in the page says the first page can be used (pictures in, main thread
 * quiet for a second). `homePictures` is how many pictures the launch told the recorder to wait
 * for: a recorder that did not get the number would call the page usable with any, so that is an error.
 */
export const waitUsable = async (page, homePictures = 0) => {
    let usable = null;
    // Asked twice a second with the short question; everything the recorder holds is read once, afterwards.
    await waitUntil(async () => {
        usable = await ask(page, 'usable');
        return usable.decidedAt;
    }, { timeoutMs: 180_000, everyMs: 500, what: 'the first page to be usable' }).catch((error) => {
        throw new Error(`${error.message} (pictures inside the window: ${usable?.picturesShown}, waited for: ${usable?.picturesWanted})`);
    });
    const startup = await ask(page, 'startup');
    if (startup.usable.picturesWanted !== homePictures) {
        throw new Error(`[perf] the recorder waited for ${startup.usable.picturesWanted} pictures on the first page, not for the ${homePictures} the prepared profile shows`);
    }
    return startup;
};

/** How many pictures the first page of a prepared profile shows when it is whole: counted when run.mjs made the profile. */
const homePicturesOf = (template) => {
    const file = path.join(template, 'template.json');
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')).homePictures ?? 0) : 0;
};

export const openSession = async ({ profile, template, name, viewport }) => {
    const profileDir = copyProfile(template, name);
    const homePictures = homePicturesOf(template);
    const running = await launchApp({ profileDir, affinityMask: profile.affinityMask, homePictures, ...viewport });
    let sampler = null;
    const session = {
        profile,
        running,
        page: null,
        startup: null,
        /** One frame of the screen, in milliseconds: what "twice the frame time" is counted from. */
        frameMs: 1000 / (profile.screenRefreshRate || 60),
        idleFrameRate: 0,
        disturbedBy: [],
        /** Starts the counter sampler for the app's processes as they are now, and waits out its first seconds. */
        sample: async () => {
            sampler?.stop();
            const { processInfo } = await running.cdp.send('SystemInfo.getProcessInfo');
            sampler = startSampler({ pids: processInfo.map(process => process.id).sort((left, right) => left - right), processors: profile.heldProcessors, selfMask: profile.samplerMask });
            await sampler.ready;
            await sleep(SAMPLER_SETTLE_SECONDS * 1000);
        },
        /** What other programs did between two moments (Date.now()), with the limits that broke. */
        outside: (fromMs, toMs) => {
            const lines = sampler ? sampler.samples.filter(sample => sample.t >= fromMs && sample.t <= toMs + 500) : [];
            return { lines: lines.length, ...(lines.length ? outsideLoad(lines, profile) : { brokenLimits: ['no counter lines'] }) };
        },
        /** The app's share of the graphics card's 3D engine between two moments, from the sampler. */
        gpuPercent: (fromMs, toMs) => {
            const lines = sampler ? sampler.samples.filter(sample => sample.t >= fromMs && sample.t <= toMs + 500) : [];
            return lines.length ? mean(lines.map(sample => Object.values(sample.gpu ?? {}).reduce((sum, value) => sum + Number(value), 0))) : null;
        },
        checkAffinity: () => checkAffinity(running, profile),
        close: async () => {
            sampler?.stop();
            sampler = null;
            await running.close();
        },
    };
    try {
        await running.waitFor('did-finish-load', 120_000);
        session.page = await attachPage(running);
        session.startup = await waitUsable(session.page, homePictures);
        await session.page.enable();
        session.checkAffinity();
        session.idleFrameRate = pacedRate(await ask(session.page, 'frameGaps', 1500));
        if (profile.screenRefreshRate && session.idleFrameRate < profile.screenRefreshRate * SCREEN_RATE_SHARE) {
            session.disturbedBy.push('frame rate');
        }
        return session;
    } catch (error) {
        await session.close();
        throw error;
    }
};

// ---------------------------------------------------------------------------------------------
// Start-up
// ---------------------------------------------------------------------------------------------

/**
 * What Chromium keeps in the profile so that a later launch is faster. For this app that is the
 * graphics caches (compiled shaders and pipelines: `GPUCache`, the Dawn and shader folders) and
 * the cache of responses (`Cache`). `Code Cache`, where compiled scripts would be, is in the list
 * but is empty after any number of launches: the page is loaded from file://, for which Chromium
 * keeps no compiled scripts. So a cold launch compiles its scripts exactly as a warm one does.
 */
const CACHE_FOLDERS = ['Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GraphiteDawnCache', 'GrShaderCache', 'ShaderCache', 'Cache'];

export const clearCaches = (profileDir) => {
    CACHE_FOLDERS.forEach(name => fs.rmSync(path.join(profileDir, 'userData', name), { recursive: true, force: true }));
};

/**
 * One launch, from the process's creation to a usable first page. `cold` removes the graphics
 * caches and the cache of responses an earlier launch left (see CACHE_FOLDERS); otherwise the
 * profile is as a launch before left it.
 */
export const measureStartup = async ({ profile, template, name, cold }) => {
    const profileDir = copyProfile(template, name);
    if (cold) {
        clearCaches(profileDir);
    }
    const homePictures = homePicturesOf(template);
    const running = await launchApp({ profileDir, affinityMask: profile.affinityMask, homePictures });
    try {
        await running.waitFor('did-finish-load', 120_000);
        // The page is only attached to, and asked twice a second whether it is done: nothing is switched on in it.
        const page = await attachPage(running);
        const startup = await waitUsable(page, homePictures);
        const tree = checkAffinity(running, profile);
        const resources = await page.send('Page.getResourceTree').catch(() => null);
        const serviceWorkers = await page.evaluate('navigator.serviceWorker ? navigator.serviceWorker.getRegistrations().then(list => list.length) : -1');
        return startupRecord(running, startup, tree, resources, serviceWorkers);
    } finally {
        await running.close();
    }
};

const sizeOfAsset = (url) => {
    const match = /\/dist\/(.+?)(?:\?.*)?$/.exec(decodeURI(url));
    const file = match ? path.join(APP_DIST, match[1]) : null;
    return file && fs.existsSync(file) ? fs.statSync(file).size : 0;
};

const startupRecord = (running, startup, tree, resources, serviceWorkers) => {
    const first = kind => running.events.find(event => event.kind === kind);
    const loaded = first('guard-loaded');
    const created = loaded.processCreatedAt;
    const at = event => (event ? event.t - created : null);
    /** From one moment to a later one; null when either was not noted (never a number made from half of it). */
    const between = (from, to) => (typeof from === 'number' && typeof to === 'number' ? round(to - from) : null);
    const inPage = value => (typeof value === 'number' ? round(startup.timeOrigin + value - created) : null);
    const mounted = startup.marks['root-mounted'];
    const usableAt = startup.usable.at;
    const tasks = startup.longTasks;
    const sumOf = list => round(list.reduce((sum, task) => sum + task.duration, 0));
    const evaluated = first('main-script-evaluated');
    const mods = running.events.find(event => event.kind === 'ipc' && event.channel === 'folia-mods:list');
    const ipcBefore = running.events.filter(event => event.kind === 'ipc' && event.t <= startup.timeOrigin + mounted);
    const scripts = (resources?.frameTree?.resources ?? []).filter(resource => resource.type === 'Script' || /\.js(\?|$)/.test(resource.url))
        .map(resource => ({ name: resource.url.replace(/^.*\/dist\//, ''), bytes: sizeOfAsset(resource.url) }))
        .sort((left, right) => right.bytes - left.bytes);
    const refused = {};
    running.events.filter(event => event.kind === 'refused').forEach((event) => { refused[`${event.via} ${event.host}`] = (refused[`${event.via} ${event.host}`] ?? 0) + 1; });
    const memory = memoryOfTree(tree);
    return {
        // Milliseconds from the creation of the app's process (as Windows dates it).
        milestones: {
            entryScript: at(loaded),
            mainScriptEvaluated: at(evaluated),
            appReady: at(first('app-ready')),
            windowCreated: at(first('window-created')),
            navigationStart: round(startup.timeOrigin - created),
            firstPaint: inPage(startup.paints['first-paint']),
            domContentLoaded: inPage(startup.navigation?.domContentLoaded),
            firstScreen: inPage(mounted),
            firstContentfulPaint: inPage(startup.paints['first-contentful-paint']),
            splashGone: inPage(startup.marks['splash-removed']),
            picturesIn: inPage(startup.usable.picturesIn),
            threadQuiet: inPage(startup.usable.quietFrom),
            homeUsable: inPage(usableAt),
        },
        // Where the time goes, each a duration in milliseconds.
        where: {
            electronToEntryScript: at(loaded),
            mainScript: evaluated?.ms ?? null,
            mainScriptToReady: between(at(evaluated), at(first('app-ready'))),
            readyToWindow: between(at(first('app-ready')), at(first('window-created'))),
            windowToNavigation: between(at(first('window-created')), startup.timeOrigin - created),
            navigationToFirstScreen: round(mounted),
            firstScreenToUsable: between(mounted, usableAt),
            longTasksBeforeFirstScreen: sumOf(tasks.filter(task => task.start < mounted)),
            longTasksAfterFirstScreen: sumOf(tasks.filter(task => task.start >= mounted && task.start < usableAt)),
            longestTask: round(Math.max(0, ...tasks.map(task => task.duration))),
            modsListAnsweredAt: mods ? round(mods.t + mods.ms - startup.timeOrigin) : null,
            modsListTook: mods?.ms ?? null,
            ipcCallsBeforeFirstScreen: ipcBefore.length,
            ipcTimeBeforeFirstScreen: round(ipcBefore.reduce((sum, event) => sum + event.ms, 0)),
            scriptsLoaded: scripts.length,
            scriptBytesLoaded: scripts.reduce((sum, script) => sum + script.bytes, 0),
            serviceWorkers,
            // Pictures inside the window when the page was called usable, and how many it had to wait for.
            picturesShown: startup.usable.picturesShown,
            picturesWanted: startup.usable.picturesWanted,
            // The recorder's own time on the page's main thread from the page's start until it was usable: it is inside the times above.
            recorderMs: startup.usable.recorderMs ?? null,
        },
        memoryMb: memory,
        detail: {
            slowestRequires: evaluated?.requires ?? [],
            longTasks: tasks,
            longFrames: startup.longFrames.slice(0, 12),
            scripts: scripts.slice(0, 40),
            refused,
            mainLog: running.events.filter(event => event.kind === 'log').slice(0, 40).map(event => `${event.t - created} ${event.level} ${event.text.slice(0, 140)}`),
            suppressed: running.events.filter(event => ['suppressed', 'write-refused', 'spawn-refused', 'guard-warning', 'uncaught-exception'].includes(event.kind)).map(event => `${event.kind}: ${event.what ?? event.operation ?? ''} ${event.path ?? event.command ?? event.text ?? ''}`.trim().slice(0, 200)),
        },
    };
};

// ---------------------------------------------------------------------------------------------
// One action: an input, and what it changes on screen
// ---------------------------------------------------------------------------------------------

/** On a slow profile an action may not be over when its time to watch is: it is then given this much more. */
const LATE_MS = 20_000;

/**
 * Arms the recorder, does the input, lets the page run for `observeMs`, and reads the recording.
 * While `notYet` still answers true after that, the page is left running (asked twice a second, for
 * at most 20 s more) and then for `afterLateMs`. Times in the result are milliseconds from the
 * input event (its own time stamp).
 */
const recordAction = async (page, spec, act, observeMs, notYet = null, afterLateMs = 1500) => {
    await ask(page, 'begin', spec);
    // A few frames before the input, so the frame rate just before it is in the record.
    await sleep(300);
    await act();
    await sleep(observeMs);
    if (notYet) {
        let late = false;
        for (let waited = 0; waited < LATE_MS && await notYet(); waited += 500) {
            late = true;
            await sleep(500);
        }
        if (late) {
            await sleep(afterLateMs);
        }
    }
    const record = await ask(page, 'end');
    if (record.t0 === null) {
        throw new Error('the page did not get the input');
    }
    return record;
};

/** The gaps between frames from the input to `untilMs`, counted against the screen's frame time. */
const frameStats = (record, untilMs, frameMs) => {
    const frames = record.frames.filter(at => at >= -frameMs && at <= untilMs + frameMs);
    const gaps = frames.slice(1).map((at, index) => at - frames[index]);
    if (gaps.length === 0) {
        return { count: 0, p95Ms: null, worstMs: null, overTwiceFrameTime: null };
    }
    return {
        count: gaps.length,
        p95Ms: round(percentile(gaps, 0.95)),
        worstMs: round(Math.max(...gaps)),
        overTwiceFrameTime: gaps.filter(gap => gap > frameMs * 2).length,
    };
};

/** The longest stretch the main thread was held, from the input on. Under 50 ms the browser reports none: 0 then. */
const longestTask = (record, untilMs) => {
    const durations = [...record.longTasks, ...record.longFrames].filter(entry => entry.start <= untilMs && entry.start + entry.duration >= 0).map(entry => entry.duration);
    return round(Math.max(0, ...durations));
};

/**
 * What the recorder's own looks took of the main thread during an action (it times them itself):
 * in all while something it watched for had not held yet, per frame in those frames and in the
 * frames after them, and the longest single look. These milliseconds are inside the times of the
 * same result.
 */
const recorderCost = ({ look }) => (look ? {
    whileWaitingMs: look.waitingMs,
    perFrameWaitingMs: look.waitingFrames ? round(look.waitingMs / look.waitingFrames, 3) : null,
    perFrameAfterMs: look.frames > look.waitingFrames ? round((look.ms - look.waitingMs) / (look.frames - look.waitingFrames), 3) : null,
    worstFrameMs: look.worstMs,
} : null);

/** The audio element's own events after the input: the way to the first sound in steps. They need no look at the page. */
const audioSteps = (record) => {
    const after = name => record.media.find(event => event.type === name && event.at >= 0)?.at ?? null;
    const sourceSet = after('loadstart');
    const afterSource = name => record.media.find(event => event.type === name && event.at >= (sourceSet ?? 0))?.at ?? null;
    return {
        sourceSetMs: sourceSet,
        canPlayMs: afterSource('canplay'),
        playCalledMs: afterSource('play'),
        playingEventMs: afterSource('playing'),
        sourceToPlayCalledMs: sourceSet !== null && afterSource('play') !== null ? round(afterSource('play') - sourceSet) : null,
        // Above zero: the app had already called play() when the element said it could play.
        playCalledToCanPlayMs: afterSource('canplay') !== null && afterSource('play') !== null ? round(afterSource('canplay') - afterSource('play')) : null,
    };
};

const topScripts = (records) => {
    const merged = new Map();
    records.flatMap(record => record.longFrames).flatMap(frame => frame.scripts).forEach((script) => {
        const held = merged.get(script.name) ?? { name: script.name, count: 0, durationMs: 0 };
        held.count += 1;
        held.durationMs = round(held.durationMs + script.duration);
        merged.set(script.name, held);
    });
    return [...merged.values()].sort((left, right) => right.durationMs - left.durationMs).slice(0, 8);
};

// ---------------------------------------------------------------------------------------------
// A change of song
// ---------------------------------------------------------------------------------------------

const SONG_OBSERVE_MS = 5000;

/**
 * The Home surface is not over the player page: its layer has faded below one half (the test the
 * switch from Home to the player page uses for its first frame), or is hidden or not there. The
 * player page lies under the Home surface in the same document, so its title, words and cover are
 * in the page, and pass for shown by their own box and opacity, before a person can see them.
 */
const homeOutOfTheWay = { kind: 'any', of: [
    { kind: 'gone', ...AT.homeLayer },
    { kind: 'style', ...AT.homeLayer, property: 'opacity', below: 0.5 },
] };

/**
 * One change of song. `expect` is the song it must arrive at (from the library's list), `onPlayer`
 * whether the player page is in front afterwards (the title, the words and the cover are only
 * looked for there), `burnMs` holds the main thread that long right after the input (the check of
 * the tool against a known change).
 */
const measureSongChange = async (session, library, { act, startOn, expect, onPlayer, burnMs = 0 }) => {
    const { page } = session;
    const watch = { sound: { kind: 'audio' } };
    if (onPlayer) {
        // What is looked for on the player page stands behind one gate: it counts from the frame in which
        // the Home surface is out of the way as well (the recorder looks at the gate once a frame).
        watch.title = { kind: 'text', scope: AT.songCard, texts: [expect.title], gated: true };
        // The song's own first word (dev/perf/app/fixtures.mjs), which its lyrics start with at 0.2 s.
        watch.lyric = { kind: 'text', scope: AT.visualSurface, texts: [expect.firstWord], gated: true };
        watch.cover = { kind: 'image', selector: AT.songCard.split(', ').map(card => `${card} img`).join(', '), gated: true };
    }
    if (burnMs > 0) {
        // In the page, from outside its code: the first real key press or click is held for a known time before the app sees it.
        await page.evaluate(`(() => {
            const burn = (event) => {
                if (!event.isTrusted) return;
                window.removeEventListener('keydown', burn, true);
                window.removeEventListener('click', burn, true);
                const until = performance.now() + ${burnMs};
                while (performance.now() < until) {}
            };
            window.addEventListener('keydown', burn, true);
            window.addEventListener('click', burn, true);
        })()`);
    }
    const startedAt = Date.now();
    const playingBefore = (await playingAudio(page))?.src ?? null;
    const record = await recordAction(page, { startOn, watch, gate: homeOutOfTheWay }, act, SONG_OBSERVE_MS, async () => {
        const audio = await playingAudio(page);
        return !audio || audio.src === playingBefore || audio.currentTime < 0.5;
    });
    if (record.firsts.sound === null) {
        throw new Error(`no sound ${Math.round(record.endedAt - record.t0)} ms after the input (media events: ${record.media.map(event => `${event.type}@${event.at}`).join(' ').slice(0, 300)})`);
    }
    // The song that plays now is the one expected: read from the page, not assumed.
    if (onPlayer) {
        const shown = await ask(page, 'texts', AT.songCard, '.', 6);
        if (!shown.includes(expect.title) && record.firsts.title === null) {
            throw new Error(`the player page names ${JSON.stringify(shown)}, not "${expect.title}"`);
        }
    }
    const input = record.eventTimings.find(entry => startOn.includes(entry.name));
    const last = Math.max(record.firsts.sound, record.firsts.title ?? 0, record.firsts.lyric ?? 0, record.firsts.cover ?? 0);
    return {
        result: {
            titleMs: record.firsts.title ?? null,
            soundMs: record.firsts.sound,
            lyricMs: record.firsts.lyric ?? null,
            // The song's first word is due 200 ms into the song. Where the song's own clock stood in the frame
            // the word was first on screen, less those 200 ms: how late the word was. (Not counted from the
            // first sound: the song is already some way in when the page sees that it plays.)
            lyricLateMs: typeof record.songClockAt?.lyric === 'number' ? round((record.songClockAt.lyric - FIRST_WORD_AT_SECONDS) * 1000) : null,
            coverMs: record.firsts.cover ?? null,
            ...audioSteps(record),
            longestTaskMs: longestTask(record, last + 500),
            inputDelayMs: input?.inputDelay ?? null,
            frames: frameStats(record, last + 500, session.frameMs),
            recorder: recorderCost(record),
        },
        record,
        span: [startedAt, Date.now()],
    };
};

/** Starts the first song of an album from its page on Home; returns the list of its songs in the order the queue plays them. */
const albumOf = (library, name) => library.songs.albums.find(entry => entry.album === name);
const collectionName = (library, album) => `${library.songs.name}/${album}`;

/**
 * The song-change series of one launch:
 *   - `playFromHome`: on an album's page (the Home surface in front), a click on Play: the song
 *     starts and the app goes to the player page. Five albums one after the other; the very first
 *     of the launch is kept apart (`firstPlay`), it also sets up the audio graph.
 *   - `nextOnPlayer`: on the player page, Ctrl+Right three times and Ctrl+Left three times.
 *   - `nextOnHome`: with the album's page in front, Ctrl+Right or Ctrl+Left, four times: the song
 *     changes and the app goes to the player page by itself.
 */
export const measureSongs = async (session, library, { burnMs = 0, short = false } = {}) => {
    const { page } = session;
    const kinds = { firstPlay: [], playFromHome: [], nextOnPlayer: [], nextOnHome: [] };
    const records = [];
    const spans = [];
    const keep = (kind, measured) => {
        kinds[kind].push(measured.result);
        records.push(measured.record);
        spans.push(measured.span);
    };
    const step = (key, expect, onPlayer) => measureSongChange(session, library, { act: () => page.press(key), startOn: ['keydown'], expect, onPlayer, burnMs });
    const playAlbum = async (album) => {
        await openCollection(page, collectionName(library, album.album));
        const play = await locate(page, AT.collectionPlay);
        return measureSongChange(session, library, { act: () => page.click(play.x, play.y), startOn: ['click'], expect: album.tracks[0], onPlayer: true, burnMs });
    };
    const backToHome = async () => {
        await page.press(KEYS.escape);
        await waitFor(page, AT.collectionBack);
        await sleep(600);
        await clickOn(page, AT.collectionBack);
        await waitFor(page, AT.importFolder);
        await sleep(800);
    };

    // Albums whose first songs have different lyrics one after the other, so the new words are told from the old.
    const order = ['Glass Harbour', 'Measured Nights', 'Night Bus Home', 'Orchard Static', '纸飞机', 'Slow Machines'].map(name => albumOf(library, name));
    const first = order[0];
    keep('firstPlay', await playAlbum(first));
    await session.sample();
    const sampledFrom = Date.now();

    let index = 0;
    for (const direction of short ? [1, 1, -1, -1] : [1, 1, 1, -1, -1, -1]) {
        index += direction;
        await sleep(1500);
        keep('nextOnPlayer', await step(direction > 0 ? KEYS.nextTrack : KEYS.previousTrack, first.tracks[index], true));
    }
    if (!short) {
        await page.press(KEYS.escape);
        await waitFor(page, AT.collectionBack);
        await sleep(1500);
        // The app goes to the player page when the song changes, so each of these starts from the
        // album's page again. Four, so that it ends on a song whose lyrics differ from the first
        // song of the album played next.
        for (const direction of [1, -1, 1, 1]) {
            index += direction;
            keep('nextOnHome', await step(direction > 0 ? KEYS.nextTrack : KEYS.previousTrack, first.tracks[index], true));
            await sleep(1000);
            await page.press(KEYS.escape);
            await waitFor(page, AT.collectionBack);
            await sleep(1500);
        }
        await clickOn(page, AT.collectionBack);
        await waitFor(page, AT.importFolder);
        await sleep(800);
        for (const album of order.slice(1)) {
            keep('playFromHome', await playAlbum(album));
            await sleep(1000);
            await backToHome();
        }
    }
    const outside = session.outside(sampledFrom, Date.now());
    return {
        summary: Object.fromEntries(Object.entries(kinds).filter(([, list]) => list.length).map(([kind, list]) => [kind, spreadOf(list)])),
        runs: kinds,
        longFrameScripts: topScripts(records),
        outside,
        idleFrameRate: round(session.idleFrameRate),
        disturbedBy: [...session.disturbedBy, ...outside.brokenLimits],
    };
};

/**
 * What the recorder's looks cost a song change: the same changes on the player page, by turns with
 * the whole recorder (every frame a look for the sound, the title, the words and the cover, and a
 * frame asked for at every refresh) and bare (no look, no frame asked for). The audio element's own
 * events and the browser's long tasks are noted without any look, so both kinds of turn have them,
 * and what the looks add is the difference. The turns alternate inside one launch and go up and
 * down the album equally often, so neither the launch nor the song tells the two kinds apart.
 */
export const measureRecorderCost = async (session, library, { passes = 4 } = {}) => {
    const { page } = session;
    const album = albumOf(library, 'Glass Harbour');
    await openCollection(page, collectionName(library, album.album));
    await clickOn(page, AT.collectionPlay);
    await waitForSound(page);
    await sleep(3000);
    await session.sample();
    const sampledFrom = Date.now();
    const runs = { withLooks: [], bare: [] };
    /** The numbers both kinds of turn have, over the same stretch: to 700 ms after the element said it plays. */
    const shared = (record) => {
        const steps = audioSteps(record);
        if (steps.playingEventMs === null) {
            throw new Error(`no "playing" event after the input (media events: ${record.media.map(event => `${event.type}@${event.at}`).join(' ').slice(0, 300)})`);
        }
        return { sourceSetMs: steps.sourceSetMs, playCalledMs: steps.playCalledMs, canPlayMs: steps.canPlayMs, playingEventMs: steps.playingEventMs, longestTaskMs: longestTask(record, steps.playingEventMs + 700) };
    };
    let index = 0;
    for (let pass = 0; pass < passes; pass += 1) {
        for (const [turn, direction] of [1, 1, 1, -1, -1, -1].entries()) {
            index += direction;
            const key = direction > 0 ? KEYS.nextTrack : KEYS.previousTrack;
            await sleep(1500);
            if ((turn + pass) % 2 === 0) {
                const { record } = await measureSongChange(session, library, { act: () => page.press(key), startOn: ['keydown'], expect: album.tracks[index], onPlayer: true });
                runs.withLooks.push({ ...shared(record), recorder: recorderCost(record) });
            } else {
                const playingBefore = (await playingAudio(page))?.src ?? null;
                const record = await recordAction(page, { startOn: ['keydown'], bare: true }, () => page.press(key), SONG_OBSERVE_MS, async () => {
                    const audio = await playingAudio(page);
                    return !audio || audio.src === playingBefore || audio.currentTime < 0.5;
                });
                runs.bare.push(shared(record));
            }
        }
    }
    const summary = { withLooks: spreadOf(runs.withLooks), bare: spreadOf(runs.bare) };
    const outside = session.outside(sampledFrom, Date.now());
    return {
        summary,
        // Median with the looks less median without, for what needs no look to be read.
        looksAdd: Object.fromEntries(['sourceSetMs', 'playCalledMs', 'canPlayMs', 'playingEventMs', 'longestTaskMs']
            .map(name => [name, round(summary.withLooks[name]?.median - summary.bare[name]?.median)])),
        runs,
        outside,
        idleFrameRate: round(session.idleFrameRate),
        disturbedBy: [...session.disturbedBy, ...outside.brokenLimits],
    };
};

// ---------------------------------------------------------------------------------------------
// A switch of page
// ---------------------------------------------------------------------------------------------

const PAGE_OBSERVE_MS = 2500;
const STILL_MS = 200;

const homeShown = { kind: 'all', of: [
    { kind: 'style', ...AT.homeLayer, property: 'opacity', above: 0.5 },
    { kind: 'style', ...AT.homeMount, property: 'visibility', equals: 'visible' },
] };

/**
 * The page switches, in the order one round does them. `first` is what holds on the first frame of
 * the new view, `content` what it needs to be of use (where that is more than its first frame; it
 * is only looked for once `first` has held), `track` the element whose place and fade are followed
 * until it stands still. A switch that is `leaving` goes back to a page that is underneath: its
 * first frame is the one in which the page in front starts to move or fade.
 */
const SWITCHES = [
    { id: 'homeToPlayer', label: 'Home to the player page (click Back to Player)', input: 'click', at: AT.backToPlayer,
        first: { kind: 'style', ...AT.homeLayer, property: 'opacity', below: 0.5 }, track: AT.homeMount },
    { id: 'playerToHome', label: 'player page to Home (Escape)', input: 'key', key: KEYS.escape,
        first: homeShown, content: { kind: 'pictures', min: 3, after: 'first' }, track: AT.homeLayer },
    { id: 'openSettings', label: 'open Settings (click Options)', input: 'click', at: AT.options,
        first: { kind: 'present', ...AT.settings }, track: AT.settings },
    { id: 'closeSettings', label: 'close Settings (Escape)', input: 'key', key: KEYS.escape, leaving: true,
        first: { kind: 'gone', ...AT.settings }, track: AT.settings },
    { id: 'openSearch', label: 'search (Enter in the search box)', input: 'key', key: KEYS.enter, before: 'typeSearch',
        first: { kind: 'present', ...AT.searchPage }, content: { kind: 'present', selector: 'section button', text: 'Paper Lanterns', exact: true, after: 'first' }, track: AT.searchPage },
    { id: 'closeSearch', label: 'close the search page (Escape)', input: 'key', key: KEYS.escape, leaving: true,
        first: { kind: 'gone', ...AT.searchPage }, track: AT.searchPage },
    { id: 'homeToCollection', label: 'Home to an album\'s page (click its card)', input: 'click', at: 'centreCard',
        first: { kind: 'present', ...AT.collectionPlay }, content: { kind: 'pictures', min: 2, after: 'first' }, track: AT.collectionPlay },
    { id: 'collectionToHome', label: 'album\'s page back to Home (click Back)', input: 'click', at: AT.collectionBack, leaving: true,
        first: { kind: 'gone', ...AT.collectionPage }, track: AT.collectionPage },
    { id: 'homeToLattice', label: 'Home to the wall (click Queue collage)', input: 'click', at: AT.latticePill,
        first: { kind: 'present', ...AT.latticeWall }, content: { kind: 'present', selector: 'button', label: 'Next track', after: 'first' }, track: AT.latticeWall },
    { id: 'latticeToHome', label: 'wall back to Home (click Back)', input: 'click', at: AT.latticeBack, leaving: true,
        first: { kind: 'gone', ...AT.latticeLayer }, track: AT.latticeLayer },
];

const centreOfRow = async (page) => {
    const pictures = (await ask(page, 'list', { selector: 'img' }, 80)).filter(picture => picture.width >= 60 && picture.width <= 500 && picture.y > 300 && picture.y < 700);
    return pictures.reduce((best, picture) => (!best || picture.width > best.width ? picture : best), null);
};

const measureSwitch = async (session, entry) => {
    const { page } = session;
    if (entry.before === 'typeSearch') {
        await clickOn(page, AT.searchBox);
        await page.press(KEYS.selectAll);
        await page.type('Lantern');
        await sleep(300);
    }
    await awayFromSongEnd(page);
    // A switch that leaves a page needs that page in front. After an opening switch that failed there is
    // none: "gone" would hold in the first frame after the key, and a switch that never happened would be
    // written down as one of a few milliseconds.
    if (entry.leaving && !(await isThere(page, entry.track))) {
        throw new Error(`${entry.id}: the page it leaves is not open`);
    }
    const at = entry.input === 'click' ? (entry.at === 'centreCard' ? await centreOfRow(page) : await locate(page, entry.at)) : null;
    const watch = { first: entry.first, ...(entry.content ? { content: entry.content } : {}) };
    const startedAt = Date.now();
    const record = await recordAction(page, { startOn: [entry.input === 'click' ? 'click' : 'keydown'], watch, track: entry.track },
        () => (at ? page.click(at.x, at.y) : page.press(entry.key)), PAGE_OBSERVE_MS,
        async () => !(await ask(page, 'holds', entry.first)) || (entry.content ? !(await ask(page, 'holds', { ...entry.content, after: undefined })) : false));
    if (record.firsts.first === null) {
        throw new Error(`${entry.id}: the new view did not appear within ${Math.round(record.endedAt - record.t0)} ms`);
    }
    const observed = record.endedAt - record.t0;
    // The last change of the followed element in the whole recording (2.5 s or more), taken as "settled"
    // when nothing changed in the 200 ms before the recording ended. An element that was still changing
    // then has no settled time (null): the table says on how many runs the cell rests.
    const settled = record.track.lastChangeAt !== null && observed - record.track.lastChangeAt >= STILL_MS ? record.track.lastChangeAt : null;
    // Leaving a page: the new view shows from the frame in which the page in front starts to go.
    const firstFrame = entry.leaving ? (record.track.firstChangeAt ?? record.firsts.first) : record.firsts.first;
    // The frame gaps are counted to the last change that was seen, settled or not.
    const until = Math.max(record.firsts.first, record.firsts.content ?? 0, record.track.lastChangeAt ?? 0);
    const input = record.eventTimings.find(timing => timing.name === (entry.input === 'click' ? 'click' : 'keydown'));
    return {
        result: {
            firstFrameMs: firstFrame,
            contentMs: entry.content ? record.firsts.content ?? null : null,
            // Only for a page that is left: the frame in which it is gone altogether.
            goneMs: entry.leaving ? record.firsts.first : null,
            settledMs: settled,
            longestTaskMs: longestTask(record, until + 200),
            inputDelayMs: input?.inputDelay ?? null,
            frames: frameStats(record, until, session.frameMs),
            recorder: recorderCost(record),
        },
        record,
        span: [startedAt, Date.now()],
    };
};

/** Gets the app to the state every round starts from: a song playing, Home in front, the test album's card in the middle. */
const readyForSwitches = async (session, library) => {
    const { page } = session;
    const album = albumOf(library, 'Glass Harbour');
    await openCollection(page, collectionName(library, album.album));
    await clickOn(page, AT.collectionPlay);
    await waitForSound(page);
    await sleep(3000);
    await page.press(KEYS.escape);
    await waitFor(page, AT.collectionBack);
    await sleep(800);
    await clickOn(page, AT.collectionBack);
    await waitFor(page, AT.importFolder);
    await sleep(800);
    await centreCard(page, collectionName(library, album.album));
};

export const measurePages = async (session, library, { rounds = 5 } = {}) => {
    await readyForSwitches(session, library);
    await session.sample();
    const sampledFrom = Date.now();
    const results = Object.fromEntries(SWITCHES.map(entry => [entry.id, []]));
    const records = Object.fromEntries(SWITCHES.map(entry => [entry.id, []]));
    const failures = [];
    for (let round = 0; round < rounds; round += 1) {
        for (const entry of SWITCHES) {
            try {
                const measured = await measureSwitch(session, entry);
                results[entry.id].push(measured.result);
                records[entry.id].push(measured.record);
            } catch (error) {
                failures.push(`round ${round + 1}: ${error.message}`.slice(0, 300));
                // Back to where a round starts, so one switch that failed does not take the next ones with it.
                await recoverToHome(session);
            }
            await sleep(700);
        }
    }
    const outside = session.outside(sampledFrom, Date.now());
    return {
        switches: SWITCHES.map(entry => ({
            id: entry.id,
            label: entry.label,
            summary: results[entry.id].length ? spreadOf(results[entry.id]) : null,
            runs: results[entry.id],
            longFrameScripts: topScripts(records[entry.id]),
        })),
        failures,
        outside,
        gpuPercent: round(session.gpuPercent(sampledFrom, Date.now()), 2),
        idleFrameRate: round(session.idleFrameRate),
        disturbedBy: [...session.disturbedBy, ...outside.brokenLimits],
    };
};

/** Escape and Back until the Home page is in front with nothing over it. */
const recoverToHome = async (session) => {
    const { page } = session;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        const hash = await ask(page, 'hash');
        const open = (await ask(page, 'count', AT.settings)) + (await ask(page, 'count', AT.searchPage));
        if (!open && (hash === '' || hash === '#home') && await ask(page, 'count', AT.importFolder)) {
            return;
        }
        if (await ask(page, 'count', AT.latticeBack)) {
            await clickOn(page, AT.latticeBack).catch(() => {});
        } else if (!open && await ask(page, 'count', AT.collectionBack)) {
            await clickOn(page, AT.collectionBack).catch(() => {});
        } else {
            await page.press(KEYS.escape);
        }
        await sleep(1200);
    }
};

// ---------------------------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------------------------

const memoryOfTree = (tree) => {
    const slots = { renderer: { workingSet: 0, private: 0 }, gpuProcess: { workingSet: 0, private: 0 }, browser: { workingSet: 0, private: 0 }, other: { workingSet: 0, private: 0 }, total: { workingSet: 0, private: 0 } };
    let video = 0;
    let sharedVideo = 0;
    tree.forEach((entry) => {
        const slot = entry.kind === 'renderer' ? 'renderer' : entry.kind === 'gpu-process' ? 'gpuProcess' : entry.kind === 'browser' ? 'browser' : 'other';
        [slot, 'total'].forEach((name) => {
            slots[name].workingSet = round(slots[name].workingSet + entry.workingSetMb);
            slots[name].private = round(slots[name].private + (entry.privateMb ?? 0));
        });
        video += entry.videoMemoryMb ?? 0;
        sharedVideo += entry.sharedVideoMemoryMb ?? 0;
    });
    // Windows gave no video-memory counters this time (win.ps1 then leaves them empty): no number, not 0 MB.
    const videoRead = tree.every(entry => typeof entry.videoMemoryMb === 'number');
    return { ...slots, videoMemory: videoRead ? round(video) : null, sharedVideoMemory: videoRead ? round(sharedVideo) : null, processes: tree.length };
};

/** The page's own numbers: JS heap, DOM nodes, event listeners (DevTools' Performance.getMetrics). */
const pageMemory = async (page) => {
    const metrics = await page.metrics();
    return {
        jsHeapUsed: round(megabytes(metrics.JSHeapUsedSize), 2),
        jsHeapTotal: round(megabytes(metrics.JSHeapTotalSize), 2),
        domNodes: metrics.Nodes,
        listeners: metrics.JSEventListeners,
        documents: metrics.Documents,
        layoutObjects: metrics.LayoutObjects,
    };
};

/**
 * A forced collection of the page's own JS heap (its main thread), twice. Nothing else is collected:
 * not the heaps of workers and worklets, not the main process, not the graphics process. So after
 * it the JS heap, the DOM nodes and the listeners are what is still held; private bytes and video
 * memory still hold what the other processes have not given back, and do not fall at once anyway.
 */
const collectGarbage = async (page) => {
    await page.send('HeapProfiler.collectGarbage');
    await page.send('HeapProfiler.collectGarbage');
};

/**
 * One memory series in one launch of its own. Five fixed points, each with every process's working
 * set and private bytes, the video memory, and the page's heap, nodes and listeners; and a reading
 * after every one of the 20 song changes and of the 20 page-switch rounds, taken after a forced
 * collection of the page's heap, so that what the page still holds shows as a slope. Points 3 and 4
 * follow such a reading directly, point 5 follows a collection of its own; points 1 and 2 follow none.
 */
export const measureMemory = async (session, library, { rounds = 20 } = {}) => {
    const { page, running } = session;
    const startedAt = Date.now();
    const points = [];
    const point = async (name) => {
        const entry = { name, atSeconds: round((Date.now() - startedAt) / 1000, 0), page: await pageMemory(page), processes: memoryOfTree(processTree(running)), counts: await ask(page, 'counts') };
        points.push(entry);
        log(`  memory, ${name}: page ${entry.processes.renderer.private} MB private, JS heap ${entry.page.jsHeapUsed} MB, ${entry.page.domNodes} nodes, ${entry.page.listeners} listeners, all processes ${entry.processes.total.private} MB private, video ${entry.processes.videoMemory} MB`);
        return entry;
    };
    /** A reading for a slope: the heap as it stands, then what is still held after a forced collection. */
    const reading = async (withProcesses) => {
        const asFound = (await pageMemory(page)).jsHeapUsed;
        await collectGarbage(page);
        const held = await pageMemory(page);
        const processes = withProcesses ? memoryOfTree(processTree(running)) : null;
        return { jsHeapAsFound: asFound, jsHeapHeld: held.jsHeapUsed, domNodes: held.domNodes, listeners: held.listeners, ...(processes ? { rendererPrivate: processes.renderer.private, gpuPrivate: processes.gpuProcess.private, totalPrivate: processes.total.private, videoMemory: processes.videoMemory } : {}) };
    };
    /** Growth per round over the readings from round `from` on (a reading keeps its own round, so the slope is still per round). */
    const slopes = (readings, from = 0) => Object.fromEntries(['jsHeapHeld', 'domNodes', 'listeners', 'rendererPrivate', 'totalPrivate', 'videoMemory']
        .map(name => [name, round(slopeOf(readings.map((entry, index) => (index >= from ? entry[name] : undefined))), 3)]));

    await sleep(30_000);
    await point('after start-up and 30 s idle');

    const album = albumOf(library, 'Glass Harbour');
    await openCollection(page, collectionName(library, album.album));
    await clickOn(page, AT.collectionPlay);
    await waitForSound(page);
    await session.sample();
    const sampledFrom = Date.now();
    await sleep(Math.max(0, 60_000 - SAMPLER_SETTLE_SECONDS * 1000));
    await point('after 60 s of playing on the player page');

    const songReadings = [await reading(true)];
    let index = 0;
    const pattern = [1, 1, 1, -1, -1, -1];
    for (let change = 0; change < rounds; change += 1) {
        const direction = pattern[change % pattern.length];
        index += direction;
        const before = (await playingAudio(page))?.src;
        await page.press(direction > 0 ? KEYS.nextTrack : KEYS.previousTrack);
        await waitUntil(async () => {
            const audio = await playingAudio(page);
            return audio && audio.src !== before && audio.currentTime > 0.2;
        }, { what: `song change ${change + 1}` });
        await sleep(2500);
        songReadings.push(await reading((change + 1) % 5 === 0));
    }
    await point(`after ${rounds} song changes`);

    // Back to the album's first song (it has the whole album ahead of it), then to Home.
    while (index > 0) {
        index -= 1;
        await page.press(KEYS.previousTrack);
        await sleep(1500);
    }
    await page.press(KEYS.escape);
    await waitFor(page, AT.collectionBack);
    await sleep(800);
    await clickOn(page, AT.collectionBack);
    await waitFor(page, AT.importFolder);
    await sleep(800);
    await centreCard(page, collectionName(library, album.album));

    /** One round of page switches: to the player page and back, Settings open and shut, an album's page and back. */
    const pageRound = async () => {
        await awayFromSongEnd(page, 14);
        await clickOn(page, AT.backToPlayer);
        await sleep(900);
        await page.press(KEYS.escape);
        await waitFor(page, AT.options);
        await sleep(700);
        await clickOn(page, AT.options);
        await waitFor(page, AT.settings);
        await sleep(700);
        await page.press(KEYS.escape);
        await waitGone(page, AT.settings);
        await sleep(500);
        const centre = await centreOfRow(page);
        await page.click(centre.x, centre.y);
        await waitFor(page, AT.collectionPlay);
        await sleep(900);
        await clickOn(page, AT.collectionBack);
        await waitFor(page, AT.importFolder);
        await sleep(900);
    };
    // One round that is not read, so that the first reading is taken where all the others are: on Home, after a round.
    await pageRound().catch(() => recoverToHome(session));
    const pageReadings = [await reading(true)];
    const failures = [];
    for (let turn = 0; turn < rounds; turn += 1) {
        try {
            await pageRound();
        } catch (error) {
            failures.push(`page round ${turn + 1}: ${error.message}`.slice(0, 300));
            await recoverToHome(session);
        }
        pageReadings.push(await reading((turn + 1) % 5 === 0));
    }
    await point(`after ${rounds} page-switch rounds`);

    // The music is stopped, as at the first point, then the page is left alone and its heap collected.
    await page.press({ key: ' ', code: 'Space', keyCode: 32, text: ' ' });
    // The key is the app's own; that the music did stop is read from the page, not assumed.
    await waitUntil(async () => !(await playingAudio(page)), { timeoutMs: 5000, what: 'the music to pause' }).catch(() => {
        failures.push('point 5: the music did not pause after Space; the point is of a playing app');
    });
    await sleep(20_000);
    await collectGarbage(page);
    await sleep(2000);
    await point('back on Home, music paused, 20 s idle, after a forced collection');

    const outside = session.outside(sampledFrom, Date.now());
    return {
        points,
        // Megabytes (or nodes, or listeners) gained per round, from the straight line through the readings.
        growthPerSongChange: slopes(songReadings),
        growthPerPageRound: slopes(pageReadings),
        // The same over the second half of the rounds only. The song changes go round the four songs of
        // one album, and the first rounds of anything fill caches: that reads as growth over the whole
        // series and is over by the second half. What still rises there is what one more round costs.
        growthPerSongChangeLate: slopes(songReadings, Math.ceil(rounds / 2)),
        growthPerPageRoundLate: slopes(pageReadings, Math.ceil(rounds / 2)),
        songReadings,
        pageReadings,
        failures,
        outside,
        disturbedBy: [...session.disturbedBy, ...outside.brokenLimits],
        tookSeconds: round((Date.now() - startedAt) / 1000, 0),
    };
};

/** The numbers of the fixed points as one flat record, for the spread over several series. */
export const memoryNumbers = series => Object.fromEntries(series.points.map((entry, index) => [`point${index + 1}`, { page: entry.page, processes: entry.processes }]).concat([
    ['growthPerSongChange', series.growthPerSongChange],
    ['growthPerPageRound', series.growthPerPageRound],
    ['growthPerSongChangeLate', series.growthPerSongChangeLate],
    ['growthPerPageRoundLate', series.growthPerPageRoundLate],
]));
