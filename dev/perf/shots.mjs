import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { holdMeasuringLock, isAlive } from './lock.mjs';
import { BUILD_DIR, HERE, SHOTS_DIST_DIR, buildPage, gitState, launchEngine, log, openScenario, sleep, startServer } from './rig.mjs';
import { SHOT_GRAIN, SHOT_PLANS, shotUnits } from './scenarios.mjs';

// dev/perf/shots.mjs
// The looks-the-same tool: pictures of every scenario at fixed moments of the song, and a
// comparison of two folders of such pictures.
//
//   node dev/perf/shots.mjs capture <folder> [--only <name>[,<name>]] [--lanes <n>] [--no-build] [--inject-css <css>]
//   node dev/perf/shots.mjs floor <capture> <capture> [<capture> ...] --out <floor.json>
//   node dev/perf/shots.mjs compare <folder A> <folder B> [--floor <floor.json>] [--out <result.json>] [--only <name>[,<name>]] [--all]
//   node dev/perf/shots.mjs list
//
// capture: dev/perf/clock.js goes into the page before its own scripts and takes it off real time
// (the clock, animation frames, timers, CSS and Web Animations, and a wait for every load between
// two steps). Every scenario has a launch of the engine of its own and a page built as one file.
// The page then goes through a plan (dev/perf/scenarios.mjs, SHOT_PLANS) in steps of 1/60 s and a
// picture is taken where the plan says. A scenario whose page logged an error, whose
// style did not draw, or whose picture is one flat colour fails: its pictures are removed, the
// failure is written into manifest.json, and the command ends with code 1.
//
// floor: what the pictures of the same code differ by, by themselves. Give it captures of the same
// code (five is the rule); for every picture and every number it keeps the largest value over all
// pairs of captures.
//
// compare: per picture the worst pixel (the largest difference that more than a few pixels reach),
// the share of pixels that differ, the share that differ by more than 8 levels, the mean
// difference, and the block shift (the most the mean colour of one block of the picture moves).
// With a floor, a picture is CHANGED when one of the five is above its floor by more
// than the margin in MARGINS. It ends with code 1 when a picture
// is CHANGED, when a picture is in one folder only, or when the folders share none; without a
// floor, when any picture differs at all.

/** A channel difference of this much or less is counted as small. */
const SMALL_DIFFERENCE = 8;
/**
 * The worst pixel of a comparison is the largest difference that more than this share of the
 * pixels reach: 41 pixels at 1920x1080. Fewer than that is what one cell of a dither pattern
 * covers, and the graphics card draws such a cell one way or the other from launch to launch for
 * the same commands (the default background has cells that sit exactly on their threshold). So a
 * difference on that few pixels is never marked, whatever its size.
 */
const FEW_PIXELS_SHARE = 0.00002;
/**
 * The side, in pixels, of the blocks a picture is cut into for the block shift: per block and
 * colour channel the differences are added up with their sign and divided by the block's pixels,
 * and the block shift is the largest of those. Grain that comes out as another field is brighter
 * on one pixel and darker on the next, and adds up to nearly nothing over a block; a faint change
 * that covers a block moves it by its whole size. So this number sees a change of a few levels
 * over an area in a picture whose other floors are as high as its grain.
 *
 * The picture is cut twice, the second time half a block further right and down, and the larger
 * result counts: a small change on the corner of four blocks of one cut lies inside a block of
 * the other.
 */
const BLOCK_PIXELS = 64;
/**
 * How far above its floor a number may be before the picture counts as CHANGED:
 *   worst pixel        2 levels more where the floor is 8 levels or less, 16 more above that;
 *   differing pixels   half as many again as the floor, plus 0.5% of the picture;
 *   over 8 levels      half as many again, plus 0.1% of the picture;
 *   mean difference    half as much again, plus 0.1 of a level;
 *   block shift        half as much again, plus 0.25 of a level.
 * So on a picture that is the same in every capture, a shift of one level over 0.5% of the picture
 * is marked, and so is a difference of 3 levels on more than a few pixels (FEW_PIXELS_SHARE), and
 * one level over more than a quarter of a block (1024 pixels that lie in one block).
 */
const MARGINS = { largest: 2, largestAboveSmall: 16, shareDiffering: 0.005, shareOverSmall: 0.001, mean: 0.1, blockShift: 0.25, factor: 1.5 };
/**
 * The least floor of a picture of a scenario with a grain pass (scenarios.mjs, SHOT_GRAIN). The
 * grain comes out as one of two fields; how far the two are apart differs from picture to picture,
 * and whether five captures show the other field at all is luck: of the seven captures behind the
 * reference of 2026-10-12, Tempera's grain was the same field in every one (and the other field
 * on one picture of a capture taken later that day), and Sonnet's largest difference came in a
 * capture taken after the floor was built. So the floor of these pictures is not left to what
 * the captures happen to show. The largest differences between two fields seen so far: worst
 * pixel 15, 38.9% of the pixels differing, 0.645% by more than 8 levels, mean 0.888 (Tempera),
 * block shift 0.384 (Sonnet at the large size; second reference of 2026-10-12).
 * With the margins a picture with grain is CHANGED above: worst pixel 32, differing 75.5%, over 8
 * levels 1.6%, mean 1.6, block shift 0.55. The first four hardly ever decide there; the block
 * shift does, and the twin without grain sees the rest.
 */
const GRAIN_FLOOR = { largest: 16, shareDiffering: 0.5, shareOverSmall: 0.01, mean: 1, blockShift: 0.2 };
/** Seconds of stepped time before the song starts: the style's start-up. Taken in pieces, with a look at the network after each. */
const WARM_SECONDS = 1.5;
const WARM_PIECE_SECONDS = 0.1;
/** After a song change the first half second is taken in pieces of three steps, for the same reason. */
const CHANGE_WATCHED_SECONDS = 0.5;
const CHANGE_PIECE_SECONDS = 0.05;
/** Engines at work at once on the scenarios of the usual size (the large ones have one more). */
const DEFAULT_LANES = 3;

const parseArgs = (argv) => {
    const positional = [];
    const flags = {};
    for (let index = 0; index < argv.length; index += 1) {
        if (!argv[index].startsWith('--')) {
            positional.push(argv[index]);
        } else if (argv[index] === '--no-build' || argv[index] === '--all') {
            flags[argv[index] === '--all' ? 'all' : 'noBuild'] = true;
        } else {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith('--')) {
                throw new Error(`${argv[index]} needs a value`);
            }
            flags[argv[index].slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
            index += 1;
        }
    }
    return { positional, flags };
};

// ---------------------------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------------------------

/**
 * Reads an 8-bit RGB or RGBA PNG without interlacing (what the engine's screenshots are). The
 * pixel rows stay as the file has them, one filter byte before each, with the filters undone: the
 * channel `c` of pixel (x, y) is at `y * (stride + 1) + 1 + x * channels + c`.
 */
const readPicture = (file) => {
    const buffer = fs.readFileSync(file);
    let offset = 8;
    let width = 0;
    let height = 0;
    let channels = 4;
    const data = [];
    while (offset < buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const body = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'IHDR') {
            width = body.readUInt32BE(0);
            height = body.readUInt32BE(4);
            const colourType = body[9];
            if (body[8] !== 8 || (colourType !== 2 && colourType !== 6) || body[12] !== 0) {
                throw new Error(`${file}: a PNG of a kind this tool does not read`);
            }
            channels = colourType === 6 ? 4 : 3;
        } else if (type === 'IDAT') {
            data.push(body);
        }
        offset += 12 + length;
    }
    const rows = zlib.inflateSync(Buffer.concat(data));
    const stride = width * channels;
    const line = stride + 1;
    if (rows.length !== line * height) {
        throw new Error(`${file}: the PNG is cut short`);
    }
    for (let y = 0; y < height; y += 1) {
        const at = y * line + 1;
        const up = at - line;
        const filter = rows[at - 1];
        if (filter === 1) {
            for (let x = channels; x < stride; x += 1) {
                rows[at + x] = (rows[at + x] + rows[at + x - channels]) & 255;
            }
        } else if (filter === 2) {
            if (y > 0) {
                for (let x = 0; x < stride; x += 1) {
                    rows[at + x] = (rows[at + x] + rows[up + x]) & 255;
                }
            }
        } else if (filter === 3) {
            for (let x = 0; x < stride; x += 1) {
                const left = x >= channels ? rows[at + x - channels] : 0;
                const above = y > 0 ? rows[up + x] : 0;
                rows[at + x] = (rows[at + x] + ((left + above) >> 1)) & 255;
            }
        } else if (filter === 4) {
            for (let x = 0; x < stride; x += 1) {
                const left = x >= channels ? rows[at + x - channels] : 0;
                const above = y > 0 ? rows[up + x] : 0;
                const aboveLeft = y > 0 && x >= channels ? rows[up + x - channels] : 0;
                const estimate = left + above - aboveLeft;
                const dLeft = Math.abs(estimate - left);
                const dAbove = Math.abs(estimate - above);
                const dAboveLeft = Math.abs(estimate - aboveLeft);
                const add = dLeft <= dAbove && dLeft <= dAboveLeft ? left : (dAbove <= dAboveLeft ? above : aboveLeft);
                rows[at + x] = (rows[at + x] + add) & 255;
            }
        } else if (filter !== 0) {
            throw new Error(`${file}: a PNG row filter this tool does not know`);
        }
    }
    return { width, height, channels, stride, rows };
};

/** The width and height a PNG's header gives. */
const pictureSize = bytes => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

/** True when every pixel of the picture has (nearly) the same colour: nothing was drawn. */
const isFlat = (picture) => {
    const { width, height, channels, stride, rows } = picture;
    const low = [255, 255, 255];
    const high = [0, 0, 0];
    for (let y = 0; y < height; y += 1) {
        let at = y * (stride + 1) + 1;
        for (let x = 0; x < width; x += 1) {
            for (let channel = 0; channel < 3; channel += 1) {
                const value = rows[at + channel];
                if (value < low[channel]) {
                    low[channel] = value;
                }
                if (value > high[channel]) {
                    high[channel] = value;
                }
            }
            at += channels;
        }
    }
    return high.every((value, channel) => value - low[channel] <= 2);
};

/**
 * What two pictures differ by: the worst pixel (the largest difference of one colour channel, 0 to
 * 255, that more than a few pixels reach: FEW_PIXELS_SHARE), the share of pixels that differ at
 * all, the share that differ by more than SMALL_DIFFERENCE, the mean difference of a colour
 * channel over the whole picture, and the block shift (BLOCK_PIXELS; the larger of the two cuts; a
 * block that the edge of the picture cuts off counts as if the rest of it were unchanged). `peak` is the largest difference of
 * any single pixel and `box` the rectangle that holds every differing pixel (left, top, right,
 * bottom): both are for the reader, no verdict rests on them.
 */
const measure = (a, b) => {
    if (a.width !== b.width || a.height !== b.height) {
        return { sizeDiffers: true, largest: 255, peak: 255, shareDiffering: 1, shareOverSmall: 1, mean: 255, blockShift: 255 };
    }
    /** How many pixels differ by exactly each amount. */
    const byDifference = new Uint32Array(256);
    let sum = 0;
    /** How far the second cut into blocks lies right of and below the first. */
    const cuts = [0, BLOCK_PIXELS / 2];
    const blocksAcross = Math.ceil((a.width + cuts[1]) / BLOCK_PIXELS);
    /** Per cut, block and colour channel: A minus B added up with its sign. */
    const blockSums = cuts.map(() => new Int32Array(blocksAcross * Math.ceil((a.height + cuts[1]) / BLOCK_PIXELS) * 3));
    const box = [a.width, a.height, -1, -1];
    for (let y = 0; y < a.height; y += 1) {
        let ia = y * (a.stride + 1) + 1;
        let ib = y * (b.stride + 1) + 1;
        const blockRows = cuts.map(cut => Math.floor((y + cut) / BLOCK_PIXELS) * blocksAcross);
        for (let x = 0; x < a.width; x += 1) {
            const redShift = a.rows[ia] - b.rows[ib];
            const greenShift = a.rows[ia + 1] - b.rows[ib + 1];
            const blueShift = a.rows[ia + 2] - b.rows[ib + 2];
            const red = Math.abs(redShift);
            const green = Math.abs(greenShift);
            const blue = Math.abs(blueShift);
            const difference = Math.max(red, green, blue);
            if (difference > 0) {
                byDifference[difference] += 1;
                sum += red + green + blue;
                for (let cut = 0; cut < cuts.length; cut += 1) {
                    const block = (blockRows[cut] + Math.floor((x + cuts[cut]) / BLOCK_PIXELS)) * 3;
                    blockSums[cut][block] += redShift;
                    blockSums[cut][block + 1] += greenShift;
                    blockSums[cut][block + 2] += blueShift;
                }
                box[0] = Math.min(box[0], x);
                box[1] = Math.min(box[1], y);
                box[2] = Math.max(box[2], x);
                box[3] = Math.max(box[3], y);
            }
            ia += a.channels;
            ib += b.channels;
        }
    }
    const count = a.width * a.height;
    const few = Math.floor(count * FEW_PIXELS_SHARE);
    let differing = 0;
    let overSmall = 0;
    let peak = 0;
    let largest = 0;
    for (let difference = 255; difference >= 1; difference -= 1) {
        differing += byDifference[difference];
        if (peak === 0 && differing > 0) {
            peak = difference;
        }
        if (largest === 0 && differing > few) {
            largest = difference;
        }
        if (difference === SMALL_DIFFERENCE + 1) {
            overSmall = differing;
        }
    }
    const blockShift = Math.max(...blockSums.map(sums => sums.reduce((most, blockSum) => Math.max(most, Math.abs(blockSum)), 0))) / (BLOCK_PIXELS * BLOCK_PIXELS);
    return { largest, peak, shareDiffering: differing / count, shareOverSmall: overSmall / count, mean: sum / (count * 3), blockShift, ...(differing ? { box } : {}) };
};

/** The five numbers a verdict rests on. */
const NUMBERS = ['largest', 'shareDiffering', 'shareOverSmall', 'mean', 'blockShift'];
const noDifference = () => ({ largest: 0, peak: 0, shareDiffering: 0, shareOverSmall: 0, mean: 0, blockShift: 0 });
const percent = share => `${(share * 100).toFixed(3)}%`;
const shown = (name, value) => (name === 'largest' ? String(value) : (name === 'mean' || name === 'blockShift' ? value.toFixed(3) : percent(value)));
const WORDS = { largest: 'worst pixel', shareDiffering: 'differing', shareOverSmall: `over ${SMALL_DIFFERENCE} levels`, mean: 'mean', blockShift: 'block shift' };
const describe = numbers => `worst pixel ${numbers.largest}${numbers.peak > numbers.largest ? ` (a few pixels up to ${numbers.peak})` : ''}, differing ${percent(numbers.shareDiffering)}, over ${SMALL_DIFFERENCE} levels ${percent(numbers.shareOverSmall)}, mean ${numbers.mean.toFixed(3)}, block shift ${numbers.blockShift.toFixed(3)}${numbers.box ? `, inside ${numbers.box[0]},${numbers.box[1]} to ${numbers.box[2]},${numbers.box[3]}` : ''}`;

/** The most each number may be for a picture with this floor (see MARGINS). */
const limitsOf = floor => ({
    largest: floor.largest + (floor.largest <= SMALL_DIFFERENCE ? MARGINS.largest : MARGINS.largestAboveSmall),
    shareDiffering: floor.shareDiffering * MARGINS.factor + MARGINS.shareDiffering,
    shareOverSmall: floor.shareOverSmall * MARGINS.factor + MARGINS.shareOverSmall,
    mean: floor.mean * MARGINS.factor + MARGINS.mean,
    blockShift: floor.blockShift * MARGINS.factor + MARGINS.blockShift,
});

const picturesIn = folder => fs.readdirSync(folder).filter(name => name.endsWith('.png')).sort();
/** The scenario a picture belongs to: the part of its file name before the "@". */
const unitOf = picture => picture.split('@')[0];
const manifestOf = (folder) => {
    const file = path.join(folder, 'manifest.json');
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
/**
 * The scenarios named to --only, and with each one that has a grain pass its twin without one
 * (scenarios.mjs, SHOT_GRAIN): a small sharp change does not show under the floor of the grain,
 * so the one is never captured or compared without the other.
 */
const withTwins = (names) => {
    const all = shotUnits();
    const twins = names.map((name) => {
        const unit = all.find(candidate => candidate.name === name);
        const twin = unit && SHOT_GRAIN[unit.scenario.id];
        return twin && all.find(candidate => candidate.scenario.id === twin && candidate.plan === unit.plan).name;
    }).filter(twin => twin && !names.includes(twin));
    if (twins.length) {
        log(`--only: ${twins.join(', ')} added, the twin without grain of a scenario that was named`);
    }
    return [...names, ...new Set(twins)];
};
/** The state of the code a capture is of, as one string: the floor file keeps these, and compare holds them against a folder's. */
const codeOf = manifest => `${manifest.commit}${manifest.dirty ? ' with changes not committed' : ''}`;
/**
 * In words, why the pictures of a capture taken with --no-build may be of another state of the
 * code than its manifest names; an empty string when the page was built for the capture, or from
 * the very commit, with nothing uncommitted then or now.
 */
const staleBuildOf = ({ buildSkipped, builtFrom, commit, dirty }) => {
    if (!buildSkipped || (builtFrom && builtFrom.commit === commit && !builtFrom.dirty && !dirty)) {
        return '';
    }
    return `--no-build: the pictures are of the page as it was built, from ${builtFrom ? codeOf(builtFrom) : 'a state of the code that was not written down'}; the checkout is at ${codeOf({ commit, dirty })}`;
};
/** What is said of a folder whose capture did not get to its end. */
const UNFINISHED = 'its capture did not get to its end (its manifest says so), so pictures of an earlier capture may be left among its own: capture all of it again, or into a new folder';

// ---------------------------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------------------------

/** The profile folder of one lane: named after this process too, so that two captures at once do not share one. */
const userDataOf = laneName => `userdata-shots-${process.pid}-${laneName}`;

const removePictures = (folder, unitName) => {
    picturesIn(folder).filter(name => name.startsWith(`${unitName}@`)).forEach(name => fs.rmSync(path.join(folder, name)));
};

/** Starts the engine for one scenario, with the clock in every page it loads and a count of the requests under way. */
const openEngine = async (viewport, laneName) => {
    const engine = await launchEngine({ ...viewport, userDataName: userDataOf(laneName) });
    try {
        // The shell loads an empty page of its own when its window is made. A scenario sent while that
        // load is still on its way could be thrown out by it; so that page is waited for and then
        // loaded once more from here.
        for (let waited = 0; waited < 5000 && !engine.shellLog.some(line => line.includes('shell up')); waited += 25) {
            await sleep(25);
        }
        await engine.navigate('about:blank');
        await sleep(100);
        await engine.send('Page.addScriptToEvaluateOnNewDocument', { source: fs.readFileSync(path.join(HERE, 'clock.js'), 'utf8') });
        const network = { underWay: new Map(), lastEventAt: 0 };
        engine.on((method, params) => {
            if (method === 'Network.requestWillBeSent') {
                network.underWay.set(params.requestId, params.request.url);
            } else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
                network.underWay.delete(params.requestId);
            } else {
                return;
            }
            network.lastEventAt = Date.now();
        });
        await engine.send('Network.enable');
        engine.network = network;
        return engine;
    } catch (error) {
        // The caller has no engine yet that it could close: one that is up but could not be made
        // ready is closed here, or it would keep the lane's profile folder open for the next launch.
        await engine.close().catch(() => undefined);
        throw error;
    }
};

/**
 * Removes the profile folders a capture that was killed left in the build folder: a capture
 * removes its own when it ends, and nothing else ever did.
 */
const removeLeftProfiles = () => {
    fs.readdirSync(BUILD_DIR).forEach((name) => {
        const pid = Number(/^userdata-shots-(\d+)-/.exec(name)?.[1]);
        if (pid && pid !== process.pid && !isAlive(pid)) {
            try {
                fs.rmSync(path.join(BUILD_DIR, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
                log(`removed ${name}: the profile folder of a capture that is gone`);
            } catch (error) {
                // Its engine may not have quit yet. No lane of this capture uses the folder: the next capture tries again.
                log(`NOTE: the profile folder ${name} of a capture that is gone could not be removed: ${error.message}`);
            }
        }
    });
};

/**
 * Waits until no request of the page is under way and none has begun or ended for `quietMs`. This
 * is for the loads the clock in the page cannot count (a dynamic import, a picture named in a style
 * sheet): at the points where those begin the steps are taken in small pieces with this in between.
 */
const networkQuiet = async (engine, quietMs) => {
    const { network } = engine;
    const askedAt = Date.now();
    for (;;) {
        const now = Date.now();
        if (network.underWay.size === 0 && now - Math.max(network.lastEventAt, askedAt) >= quietMs) {
            return;
        }
        if (now - askedAt > 30_000) {
            throw new Error(`a request did not end in 30 s: ${[...network.underWay.values()][0] ?? '(none under way, but new ones kept coming)'}`);
        }
        await sleep(5);
    }
};

/** One scenario by its plan: the pictures it wrote, as file names. Throws when the scenario cannot be trusted. */
const captureUnit = async (engine, unit, folder, flags) => {
    const { scenario, viewport } = unit;
    const page = (expression, timeoutMs = 300_000) => engine.evaluate(expression, timeoutMs);
    const failOnPageErrors = () => {
        const errors = engine.pageLog.filter(line => line.startsWith('exception:') || line.startsWith('error:'));
        if (errors.length) {
            throw new Error(`the page logged ${errors.length} error${errors.length > 1 ? 's' : ''}, the first: ${errors[0].split('\n')[0]}`);
        }
    };
    /** Stepped seconds in small pieces, with a look at the network after each. */
    const runWatched = async (seconds, pieceSeconds) => {
        for (let done = 0; done < seconds - 1e-9; done += pieceSeconds) {
            await page(`window.__perf.shot.run(${Math.min(pieceSeconds, seconds - done)})`);
            await networkQuiet(engine, 15);
        }
    };

    const info = await openScenario(engine, scenario, { shot: true }).catch(async (error) => {
        // Say what the page had to say: without it "did not start" cannot be told from a script that threw.
        const where = await engine.evaluate('location.href', 5000).catch(() => 'unknown');
        throw new Error(`${error.message} (the page is at ${where}; its log: ${engine.pageLog.slice(0, 3).map(line => line.split('\n')[0]).join(' | ') || 'empty'})`);
    });
    if (info.style !== scenario.style || info.background !== scenario.background) {
        throw new Error(`the page holds style "${info.style}" over "${info.background}", not "${scenario.style}" over "${scenario.background}"`);
    }
    if (info.deviceScale !== viewport.deviceScale) {
        throw new Error(`the page is at scale ${info.deviceScale}, not ${viewport.deviceScale}`);
    }
    // Windows holds a window to the screen plus its border, so on a screen that the large viewport
    // does not fit the page is another size than asked for, in the measurements as here. The
    // pictures are of the page as it is; the manifest says what that was.
    const window = { width: info.viewport[0], height: info.viewport[1] };
    const notes = window.width !== viewport.width || window.height !== viewport.height
        ? [`the page is ${window.width}x${window.height}, not the ${viewport.width}x${viewport.height} asked for: Windows held the window to the screen`]
        : [];
    await networkQuiet(engine, 150);
    await page('window.__perf.shot.rest()');
    await runWatched(WARM_SECONDS, WARM_PIECE_SECONDS);
    await networkQuiet(engine, 50);
    await page('window.__perf.shot.rest()');
    const state = await page('window.__perf.shot.state()');
    if (state.stageElements <= 2) {
        throw new Error(`style "${scenario.style}" drew nothing into the stage`);
    }
    failOnPageErrors();
    if (flags.injectCss) {
        await page(`(() => { const sheet = document.createElement('style'); sheet.textContent = ${JSON.stringify(flags.injectCss)}; document.head.append(sheet); })()`);
    }

    const pictures = [];
    const marks = {};
    const takePicture = async (label) => {
        await page('window.__perf.shot.rest()');
        // Where the page stands at this picture: the steps taken, the random numbers asked for, the
        // timers waiting and the animations held. Captures of the same code agree in all four.
        marks[label] = await page('(() => { const { steps, randoms, timers, animations } = window.__perfClock.state(); return { steps, randoms, timers, animations }; })()');
        const { data } = await engine.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }, 60_000);
        const bytes = Buffer.from(data, 'base64');
        const file = `${unit.name}@${label}.png`;
        const size = pictureSize(bytes);
        const expected = { width: window.width * viewport.deviceScale, height: window.height * viewport.deviceScale };
        if (Math.abs(size.width - expected.width) > 1 || Math.abs(size.height - expected.height) > 1) {
            throw new Error(`${file} is ${size.width}x${size.height}, not ${expected.width}x${expected.height}`);
        }
        fs.writeFileSync(path.join(folder, file), bytes);
        // A flat picture packs to almost nothing, so only a small file is worth reading back.
        if (bytes.length < size.width * size.height * 0.1 && isFlat(readPicture(path.join(folder, file)))) {
            throw new Error(`${file} is one flat colour: nothing was drawn`);
        }
        pictures.push(file);
    };
    let watchedLeft = 0;
    for (const [verb, value] of SHOT_PLANS[unit.plan]) {
        if (verb === 'play') {
            await page(`window.__perf.shot.play(${value})`);
        } else if (verb === 'jump') {
            await page(`window.__perf.shot.jumpTo(${value})`);
        } else if (verb === 'runTo') {
            await page(`window.__perf.shot.runTo(${value})`);
        } else if (verb === 'shot') {
            await page(`window.__perf.shot.runTo(${value})`);
            await takePicture(`${value.toFixed(1)}s`);
        } else if (verb === 'wait') {
            const watched = Math.min(watchedLeft, value);
            await runWatched(watched, CHANGE_PIECE_SECONDS);
            watchedLeft -= watched;
            await page(`window.__perf.shot.run(${value - watched})`);
        } else if (verb === 'pause') {
            await page('window.__perf.shot.pause()');
        } else if (verb === 'changeSong') {
            await page('window.__perf.shot.changeSong()');
            await networkQuiet(engine, 15);
            watchedLeft = CHANGE_WATCHED_SECONDS;
        } else if (verb === 'daylight') {
            await page('window.__perf.shot.setDaylight(true)');
        } else if (verb === 'picture') {
            await takePicture(value);
        } else {
            throw new Error(`the plan "${unit.plan}" has a step this tool does not know: ${verb}`);
        }
    }
    failOnPageErrors();
    return { pictures, marks, window, mountedAtStep: state.mountedAtStep, steps: (await page('window.__perfClock.state()')).steps, notes: [...notes, ...engine.pageLog.filter(line => line.includes('[perf clock]'))] };
};

/** Pictures with the very same bytes under one label: two scenarios that look exactly alike there. */
const identicalPictures = (folder) => {
    const byLabel = new Map();
    picturesIn(folder).forEach((name) => {
        const unitName = unitOf(name);
        const label = name.slice(unitName.length + 1, -4);
        const key = `${label} ${crypto.createHash('sha1').update(fs.readFileSync(path.join(folder, name))).digest('hex')}`;
        byLabel.set(key, [...(byLabel.get(key) ?? []), unitName]);
    });
    return [...byLabel.entries()].filter(([, names]) => names.length > 1).map(([key, names]) => ({ label: key.split(' ')[0], units: names }));
};

const capture = async (folder, flags) => {
    const all = shotUnits();
    const wanted = flags.only ? withTwins(flags.only.split(',')) : null;
    const unknown = (wanted ?? []).filter(name => !all.some(unit => unit.name === name));
    if (unknown.length) {
        throw new Error(`nothing to capture named ${unknown.join(', ')} (node dev/perf/shots.mjs list)`);
    }
    const units = wanted ? all.filter(unit => wanted.includes(unit.name)) : all;
    // A capture starts engines, so it waits for a measuring run that is under way and holds off the next.
    await holdMeasuringLock(`dev/perf/shots.mjs ${process.argv.slice(2).join(' ')}`);
    const built = buildPage({ skip: Boolean(flags.noBuild), oneFile: true });
    // What state of the code the page was built from is kept beside the page: with --no-build the
    // pictures are of that state, whatever the checkout holds by now.
    const builtFromFile = path.join(SHOTS_DIST_DIR, 'built-from.json');
    if (built) {
        fs.writeFileSync(builtFromFile, `${JSON.stringify(gitState())}\n`);
    }
    const builtFrom = fs.existsSync(builtFromFile) ? JSON.parse(fs.readFileSync(builtFromFile, 'utf8')) : null;
    // The state of the code when the capture starts: what the pictures are of, whatever is committed while it runs.
    const state = gitState();
    const staleBuild = staleBuildOf({ buildSkipped: !built, builtFrom, ...state });
    if (staleBuild) {
        log(`WARNING: ${staleBuild}`);
    }
    fs.mkdirSync(folder, { recursive: true });
    const manifestFile = path.join(folder, 'manifest.json');
    const earlier = manifestOf(folder) ?? {};
    const server = await startServer({ dist: SHOTS_DIST_DIR });
    const startedAt = Date.now();
    const results = new Map();
    let engineName = null;
    removeLeftProfiles();
    // From here on pictures are replaced. Until the last scenario is done the manifest says that
    // the capture has not ended: one that is killed leaves the pictures of an earlier capture
    // beside its own, and compare and floor refuse it.
    fs.writeFileSync(manifestFile, `${JSON.stringify({ ...earlier, unfinished: true }, null, 2)}\n`);

    /**
     * One lane works through a queue, with a new launch of the engine for every scenario. An engine
     * that has drawn other scenarios before draws the next one differently (Fume's canvas text came
     * out with other edges, depending on what the engine had drawn earlier), and which scenarios
     * share a lane changes from capture to capture.
     */
    const lane = async (laneName, viewport, queue) => {
        while (queue.length) {
            const unit = queue.shift();
            const unitStartedAt = Date.now();
            // Old pictures of this scenario go first: what is in the folder afterwards is of this capture.
            removePictures(folder, unit.name);
            let engine = null;
            try {
                engine = await openEngine(viewport, laneName);
                engineName = engine.browser;
                const taken = await captureUnit(engine, unit, folder, flags);
                const seconds = (Date.now() - unitStartedAt) / 1000;
                results.set(unit.name, { ...taken, seconds });
                taken.notes.forEach(line => log(`${unit.name}: NOTE: ${line}`));
                log(`${unit.name}: ${taken.pictures.length} pictures, ${taken.steps} steps (the style drew at step ${taken.mountedAtStep}), ${seconds.toFixed(1)} s`);
            } catch (error) {
                removePictures(folder, unit.name);
                results.set(unit.name, { error: String(error.message ?? error) });
                log(`${unit.name}: FAILED: ${error.message ?? error}`);
            } finally {
                await engine?.close().catch(() => undefined);
            }
        }
        try {
            fs.rmSync(path.join(BUILD_DIR, userDataOf(laneName)), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch (error) {
            // Not a reason to lose the manifest of everything that was captured.
            log(`NOTE: the profile folder ${userDataOf(laneName)} could not be removed: ${error.message}`);
        }
    };

    try {
        const sizes = new Map();
        units.forEach((unit) => {
            const key = `${unit.viewport.width}x${unit.viewport.height}@${unit.viewport.deviceScale}`;
            sizes.set(key, { viewport: unit.viewport, queue: [...(sizes.get(key)?.queue ?? []), unit] });
        });
        const lanes = Math.max(1, Number(flags.lanes ?? DEFAULT_LANES));
        const work = [];
        [...sizes.entries()].forEach(([key, { viewport, queue }], sizeIndex) => {
            // The usual size is shared out over the lanes; a size with few scenarios gets one engine.
            const count = sizeIndex === 0 ? Math.min(lanes, queue.length) : 1;
            for (let index = 0; index < count; index += 1) {
                work.push(lane(`${key.replace(/[^0-9a-z]/gi, '-')}-${index}`, viewport, queue));
            }
        });
        await Promise.all(work);
    } finally {
        await server.close();
    }

    // The manifest describes the folder: this capture's scenarios replace their earlier entries.
    const entries = new Map((earlier.units ?? []).map(entry => [entry.name, entry]));
    units.forEach((unit) => {
        const result = results.get(unit.name);
        entries.set(unit.name, {
            name: unit.name,
            scenario: unit.scenario.id,
            plan: unit.plan,
            viewport: unit.viewport,
            takenAt: new Date().toISOString(),
            ...(result.error ? { failed: result.error, pictures: [] } : { window: result.window, pictures: result.pictures, marks: result.marks, mountedAtStep: result.mountedAtStep, steps: result.steps, seconds: Math.round(result.seconds * 10) / 10, ...(result.notes.length ? { notes: result.notes } : {}) }),
        });
    });
    const identical = identicalPictures(folder);
    const failures = [...entries.values()].filter(entry => entry.failed).map(entry => ({ name: entry.name, error: entry.failed }));
    fs.writeFileSync(manifestFile, `${JSON.stringify({
        takenAt: new Date().toISOString(),
        // In a folder whose last capture did not end, the pictures of scenarios this one did not take are still as that one left
        // them. (A picture of a scenario the tool no longer lists is not one a capture could take again: compare names it.)
        ...(earlier.unfinished && picturesIn(folder).some(name => all.some(unit => unit.name === unitOf(name)) && !units.some(unit => unit.name === unitOf(name))) ? { unfinished: true } : {}),
        ...state,
        buildSkipped: !built,
        builtFrom,
        engine: engineName ?? earlier.engine ?? null,
        injectedCss: flags.injectCss ?? null,
        tookSeconds: Math.round((Date.now() - startedAt) / 1000),
        failures,
        identical,
        units: [...entries.values()],
        pictures: picturesIn(folder),
    }, null, 2)}\n`);

    identical.forEach(({ label, units: names }) => {
        log(`WARNING: the same picture, byte for byte, at ${label}: ${names.join(', ')}. Look whether each shows its own style there.`);
    });
    const failedNow = units.filter(unit => results.get(unit.name).error);
    failedNow.forEach(unit => log(`FAILED ${unit.name}: ${results.get(unit.name).error}`));
    log(`${units.length - failedNow.length} of ${units.length} scenarios captured, ${picturesIn(folder).length} pictures in ${folder}, ${((Date.now() - startedAt) / 60000).toFixed(1)} minutes`);
    return failedNow.length === 0;
};

// ---------------------------------------------------------------------------------------------
// Floor and compare
// ---------------------------------------------------------------------------------------------

/**
 * What a floor file holds. Throws when the file is not one that `floor` wrote: a file without
 * floors would leave every picture without a verdict.
 */
const readFloor = (file) => {
    if (!fs.existsSync(file)) {
        throw new Error(`no floor file at ${file}`);
    }
    let held;
    try {
        held = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`${file} is not a floor file: ${error.message}`);
    }
    const pictures = held?.pictures;
    if (!pictures || typeof pictures !== 'object' || Array.isArray(pictures)) {
        throw new Error(`${file} is not a floor file: it has no "pictures" (node dev/perf/shots.mjs floor writes one)`);
    }
    const short = Object.keys(pictures).find(name => NUMBERS.some(number => typeof pictures[name]?.[number] !== 'number'));
    if (short) {
        throw new Error(`${file} does not hold the numbers this tool compares by (${short} has no "${NUMBERS.find(number => typeof pictures[short]?.[number] !== 'number')}"): another version of the tool wrote it, build the floor again`);
    }
    return held;
};

/**
 * What the pictures of the same code differ by, from several captures of it: for every picture and
 * every number the largest value over all pairs of captures (`measured` in the file), and then for
 * every picture the largest of those over all pictures of its scenario, its song change and its
 * large pictures among them (`pictures`, what compare uses). What is left unequal is the graphics
 * card giving one of two results for the same commands, and that falls on any picture of a
 * scenario: the grain of a post-process pass comes out as one of two fields, on this picture in
 * one capture and on that one in the next. Five captures show it on some pictures of a scenario
 * and not on the others.
 *
 * The two scenarios with a grain pass (scenarios.mjs, SHOT_GRAIN) are held to GRAIN_FLOOR at
 * least, whatever the captures show.
 */
const buildFloor = (folders, flags) => {
    if (!flags.out) {
        throw new Error('floor needs --out <floor.json>');
    }
    const names = picturesIn(folders[0]);
    const uneven = folders.flatMap(folder => [
        ...names.filter(name => !fs.existsSync(path.join(folder, name))).map(name => `${name} is missing in ${folder}`),
        ...picturesIn(folder).filter(name => !names.includes(name)).map(name => `${name} is only in ${folder}`),
    ]);
    if (uneven.length) {
        throw new Error(`the captures do not hold the same pictures:\n  ${uneven.slice(0, 20).join('\n  ')}`);
    }
    if (names.length === 0) {
        throw new Error('no pictures to build a floor from');
    }
    // Captures of the same code take the same steps: where they did not, the pictures are not of the same thing.
    const manifests = folders.map(manifestOf);
    manifests.forEach((manifest, index) => {
        if (manifest?.unfinished) {
            throw new Error(`${folders[index]}: ${UNFINISHED}`);
        }
        if (manifest?.failures?.length) {
            throw new Error(`${folders[index]} holds a capture with failed scenarios (${manifest.failures.map(failure => failure.name).join(', ')}): not a base for a floor`);
        }
    });
    const first = manifests[0];
    (first?.units ?? []).forEach((unit) => {
        manifests.slice(1).forEach((manifest, index) => {
            const other = manifest?.units?.find(entry => entry.name === unit.name);
            if (other && (other.steps !== unit.steps || other.mountedAtStep !== unit.mountedAtStep)) {
                log(`WARNING: ${unit.name} took ${unit.steps} steps and drew at step ${unit.mountedAtStep} in ${folders[0]}, ${other.steps} and ${other.mountedAtStep} in ${folders[index + 1]}`);
            }
            const apart = other ? Object.keys(unit.marks ?? {}).find(label => JSON.stringify(unit.marks[label]) !== JSON.stringify(other.marks?.[label])) : undefined;
            if (apart) {
                log(`WARNING: ${unit.name} did not run the same way in ${folders[index + 1]}: at ${apart} the page stood at ${JSON.stringify(other.marks?.[apart])}, in ${folders[0]} at ${JSON.stringify(unit.marks[apart])}`);
            }
        });
    });
    const commits = [...new Set(manifests.map(manifest => (manifest ? codeOf(manifest) : 'unknown')))];
    if (commits.length > 1) {
        log(`WARNING: the captures are not of one state of the code: ${commits.join('; ')}`);
    }
    const measured = {};
    const shared = {};
    const raise = (floor, result) => [...NUMBERS, 'peak'].forEach((number) => { floor[number] = Math.max(floor[number], result[number]); });
    /**
     * The scenario a picture is of: `songchange-tempera` and `large-style-tempera` are pictures of
     * `style-tempera`. By the tool's own list, so that it does not hang on a folder having its
     * manifest; by the manifest for a scenario the list no longer holds.
     */
    const listed = new Map(shotUnits().map(unit => [unit.name, unit.scenario.id]));
    const scenarioOf = name => listed.get(unitOf(name)) ?? first?.units?.find(unit => unit.name === unitOf(name))?.scenario ?? unitOf(name);
    names.forEach((name) => {
        const read = folders.map(folder => readPicture(path.join(folder, name)));
        measured[name] = noDifference();
        for (let first = 0; first < read.length; first += 1) {
            for (let second = first + 1; second < read.length; second += 1) {
                raise(measured[name], measure(read[first], read[second]));
            }
        }
        raise((shared[scenarioOf(name)] ??= noDifference()), measured[name]);
    });
    const held = { ...shared };
    Object.keys(SHOT_GRAIN).filter(id => shared[id]).forEach((id) => {
        held[id] = { ...shared[id], ...Object.fromEntries(NUMBERS.map(number => [number, Math.max(shared[id][number], GRAIN_FLOOR[number])])), grain: true };
    });
    const pictures = Object.fromEntries(names.map(name => [name, { ...held[scenarioOf(name)] }]));
    const unequal = names.filter(name => measured[name].shareDiffering > 0);
    fs.writeFileSync(path.resolve(flags.out), `${JSON.stringify({
        builtAt: new Date().toISOString(),
        code: commits,
        captures: folders,
        pairs: (folders.length * (folders.length - 1)) / 2,
        smallDifference: SMALL_DIFFERENCE,
        fewPixelsShare: FEW_PIXELS_SHARE,
        blockPixels: BLOCK_PIXELS,
        grainFloor: GRAIN_FLOOR,
        pictures,
        measured,
    }, null, 2)}\n`);
    unequal.sort((left, right) => measured[right].mean - measured[left].mean || measured[right].peak - measured[left].peak)
        .forEach(name => console.log(`${name.padEnd(52)} ${describe(measured[name])}`));
    const units = Object.keys(shared);
    const atZero = units.filter(unit => NUMBERS.every(number => held[unit][number] === 0));
    units.filter(unit => !atZero.includes(unit)).sort((left, right) => shared[right].mean - shared[left].mean || shared[right].shareDiffering - shared[left].shareDiffering)
        .forEach(unit => console.log(`the floor of every picture of ${unit}: ${describe(shared[unit])}${held[unit].grain ? `; it has a grain pass and is held to ${describe(held[unit])}` : ''}`));
    log(`floor of ${names.length} pictures from ${folders.length} captures (${(folders.length * (folders.length - 1)) / 2} pairs): ${names.length - unequal.length} pictures the same in every capture, ${unequal.length} not (listed above, each by itself); the pictures of a scenario share the largest floor among them: ${atZero.length} of ${units.length} scenarios have a floor of 0 in all five numbers; written to ${path.resolve(flags.out)}`);
};

const compare = (folderA, folderB, flags) => {
    const floorFile = flags.floor ? readFloor(flags.floor) : null;
    // What the manifests say against taking the pictures at their word.
    const manifests = [folderA, folderB].map(manifestOf);
    const warnings = [];
    [folderA, folderB].forEach((folder, index) => {
        const manifest = manifests[index];
        if (!manifest) {
            warnings.push(`${folder} has no manifest.json: nothing says what its pictures are of`);
            return;
        }
        if (manifest.unfinished) {
            throw new Error(`${folder}: ${UNFINISHED}`);
        }
        if (manifest.failures?.length) {
            warnings.push(`${folder} holds a capture with failed scenarios: ${manifest.failures.map(failure => failure.name).join(', ')}`);
        }
        if (manifest.injectedCss) {
            warnings.push(`${folder} was captured with --inject-css`);
        }
        if (staleBuildOf(manifest)) {
            warnings.push(`${folder} was captured with ${staleBuildOf(manifest)}`);
        }
    });
    if (manifests[0] && manifests[1] && manifests[0].engine !== manifests[1].engine) {
        warnings.push(`the two captures are of different engines: ${manifests[0].engine} and ${manifests[1].engine}`);
    }
    if (floorFile && manifests[0] && Array.isArray(floorFile.code) && !(floorFile.code.length === 1 && floorFile.code[0] === codeOf(manifests[0]))) {
        warnings.push(`the floor was built from captures of ${floorFile.code.join('; ')}, and ${folderA} is of ${codeOf(manifests[0])}: a floor says what the pictures of one state of the code differ by`);
    }
    const out = flags.out ? path.resolve(flags.out) : null;
    if (out && [folderA, folderB].some(folder => !path.relative(folder, out).startsWith('..') && !path.isAbsolute(path.relative(folder, out)))) {
        throw new Error('--out lies inside one of the compared folders: a result is never written among the pictures');
    }
    const floor = floorFile?.pictures ?? null;
    // --only: the scenarios to compare, for a capture that took only those.
    const wanted = flags.only ? withTwins(flags.only.split(',')) : null;
    const inA = picturesIn(folderA).filter(name => !wanted || wanted.includes(unitOf(name)));
    const inB = picturesIn(folderB).filter(name => !wanted || wanted.includes(unitOf(name)));
    const absent = (wanted ?? []).filter(name => ![...inA, ...inB].some(picture => unitOf(picture) === name));
    if (absent.length) {
        throw new Error(`--only names ${absent.join(', ')}: neither folder holds a picture of it (node dev/perf/shots.mjs list)`);
    }
    const onlyA = inA.filter(name => !inB.includes(name));
    const onlyB = inB.filter(name => !inA.includes(name));
    const names = inA.filter(name => inB.includes(name));
    const pictures = {};
    const counts = { identical: 0, within: 0, changed: 0, noFloor: 0 };
    names.forEach((name) => {
        const result = measure(readPicture(path.join(folderA, name)), readPicture(path.join(folderB, name)));
        let verdict = '';
        if (floor) {
            const own = floor[name] ?? noDifference();
            const limits = limitsOf(own);
            const over = result.sizeDiffers ? NUMBERS : NUMBERS.filter(number => result[number] > limits[number]);
            result.floor = own;
            result.changed = over.length > 0;
            counts.noFloor += floor[name] ? 0 : 1;
            verdict = result.changed
                ? `  CHANGED: ${result.sizeDiffers ? 'another size' : over.map(number => `${WORDS[number]} ${shown(number, result[number])} > ${shown(number, limits[number])}`).join(', ')}; its floor${floor[name] ? '' : ' (none in the file, taken as 0)'}: ${describe(own)}`
                : '  within its floor';
        }
        counts.identical += result.shareDiffering === 0 ? 1 : 0;
        counts.changed += result.changed ? 1 : 0;
        counts.within += floor && !result.changed && result.shareDiffering > 0 ? 1 : 0;
        pictures[name] = result;
        if (flags.all || result.shareDiffering > 0) {
            console.log(`${name.padEnd(52)} ${describe(result)}${verdict}`);
        }
    });
    onlyA.forEach(name => console.log(`${name.padEnd(52)} MISSING in ${folderB}`));
    onlyB.forEach(name => console.log(`${name.padEnd(52)} MISSING in ${folderA}`));
    if (out) {
        fs.writeFileSync(out, `${JSON.stringify({ folderA, folderB, floor: flags.floor ? path.resolve(flags.floor) : null, smallDifference: SMALL_DIFFERENCE, margins: MARGINS, onlyInA: onlyA, onlyInB: onlyB, pictures }, null, 2)}\n`);
    }
    warnings.forEach(line => log(`WARNING: ${line}`));
    log(`${names.length} pictures compared: ${counts.identical} identical${floor ? `, ${counts.within} differ within their floor, ${counts.changed} CHANGED` : `, ${names.length - counts.identical} differ (no floor given: no verdict, and any difference ends with code 1)`}; ${onlyA.length + onlyB.length} in one folder only${counts.noFloor ? `; ${counts.noFloor} have no floor in the file` : ''}${out ? `; written to ${out}` : ''}`);
    if (names.length === 0) {
        log('the two folders have no picture in common');
    }
    // Without a floor nothing says what two captures of the same code differ by: only equal pictures pass.
    const unchanged = floor ? counts.changed === 0 : counts.identical === names.length;
    return names.length > 0 && unchanged && onlyA.length + onlyB.length === 0;
};

const main = async () => {
    const [mode, ...rest] = process.argv.slice(2);
    const { positional, flags } = parseArgs(rest);
    if (mode === 'capture' && positional.length === 1) {
        return capture(path.resolve(positional[0]), flags);
    }
    if (mode === 'floor' && positional.length >= 2) {
        buildFloor(positional.map(folder => path.resolve(folder)), flags);
        return true;
    }
    if (mode === 'compare' && positional.length === 2) {
        return compare(path.resolve(positional[0]), path.resolve(positional[1]), flags);
    }
    if (mode === 'list') {
        shotUnits().forEach(unit => console.log(`${unit.name.padEnd(36)} ${unit.plan.padEnd(11)} ${unit.viewport.width}x${unit.viewport.height}@${unit.viewport.deviceScale}  ${unit.scenario.style} over ${unit.scenario.background}`));
        return true;
    }
    throw new Error('usage: node dev/perf/shots.mjs capture <folder> [--only names] [--lanes n] [--no-build] [--inject-css css] | floor <capture> <capture> ... --out <floor.json> | compare <folder A> <folder B> [--floor <floor.json>] [--out <result.json>] [--only names] | list');
};

main().then(ok => process.exit(ok ? 0 : 1), (error) => {
    console.error('[perf]', error.message ?? error);
    process.exit(1);
});
