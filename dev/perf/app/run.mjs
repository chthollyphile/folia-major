import fs from 'node:fs';
import path from 'node:path';
import { holdMeasuringLock } from '../lock.mjs';
import { gitState, keepAwake, log, notesDir, outsideLoad, resolveProfile, sleep, startSampler } from '../rig.mjs';
import { SAMPLER_SETTLE_SECONDS } from '../scenarios.mjs';
import { AT, ask, clickOn, importFolder, passFirstRun, waitUntil } from './drive.mjs';
import { FIXTURE_VERSION, writeLibrary } from './fixtures.mjs';
import { APP_DIST, PROFILES_DIR, attachPage, buildApp, distShape, freshProfile, launchApp, removeFolder } from './launch.mjs';
import { measureMemory, measurePages, measureRecorderCost, measureSongs, measureStartup, memoryNumbers, openSession, spreadOf, waitUsable } from './measure.mjs';
import { shortfalls, writeAppReport } from './report.mjs';

// dev/perf/app/run.mjs
// Measures the whole app: start-up, a change of song, a switch of page, memory. The app is the
// real one (electron/main.cjs and a production build), started behind dev/perf/app/guard.cjs, which
// keeps it inside one folder of this run and off the network, the screen and the speakers.
// dev/perf/app/README.md says what every number means.
//
//   node dev/perf/app/run.mjs --baseline
//       Everything under the three profiles (host, laptop, old), then the check against a known
//       change, then the table. It says first how long it takes, and it does not start while other
//       programs keep the processors or the graphics card busy.
//   node dev/perf/app/run.mjs --trial [--label <name>]
//       The same on a PC that is in use: nothing is refused, every result says what disturbed it.
//   node dev/perf/app/run.mjs --profile laptop [--only startup,songs,pages,memory] [--label <name>]
//   node dev/perf/app/run.mjs --truth [--profile laptop]
//       Song changes without and with the main thread held for 200 ms after the input.
//   node dev/perf/app/run.mjs --recorder [--profile old]
//       What the recorder in the page costs: song changes with its looks of every frame and without.
//   node dev/perf/app/run.mjs --plan            what --baseline runs and for how long
//   Common: --no-build (use dist/ and the prepared profiles as they are), --quick (fewer runs),
//           --cold <n> --warm <n> --launches <n> --rounds <n> --memory-series <n>, --out <folder>.

const AREAS = ['startup', 'songs', 'pages', 'memory'];
const PROFILE_NAMES = ['host', 'laptop', 'old'];
/** The main thread is held this long in the check against a known change. */
const BURN_MS = 200;

export const BASELINE_COMMAND = 'node dev/perf/app/run.mjs --baseline';

const parseArgs = (argv) => {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        if (!name.startsWith('--')) {
            throw new Error(`unexpected argument "${name}"`);
        }
        const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (['baseline', 'trial', 'truth', 'recorder', 'plan', 'noBuild', 'quick', 'allowDisturbed'].includes(key)) {
            args[key] = true;
        } else {
            args[key] = argv[index + 1];
            index += 1;
        }
    }
    return args;
};

const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** Renames a folder, trying again for 15 s: on Windows a rename fails while another program has something inside it open. */
const renamePatiently = async (from, to) => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (error) {
            if (attempt >= 10) {
                throw error;
            }
            await sleep(1500);
        }
    }
};

const stamp = () => {
    const now = new Date();
    const two = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
};

// ---------------------------------------------------------------------------------------------
// The run: what it measures, what it has finished, what to close when it is stopped
// ---------------------------------------------------------------------------------------------

let identity = { commit: null, dirty: null };
let runRecord = null;
let runFile = null;
let runsBefore = [];
/** What has to be closed when the runner is stopped from outside. */
const open = new Set();
let stopping = false;

const saveRun = () => {
    if (runFile) {
        writeJson(runFile, { runs: [...runsBefore, runRecord] });
    }
};

const beginRun = (out, trial) => {
    runFile = path.join(out, '_run.json');
    runsBefore = fs.existsSync(runFile) ? (JSON.parse(fs.readFileSync(runFile, 'utf8')).runs ?? []) : [];
    runRecord = {
        startedAt: new Date().toISOString(),
        endedAt: null,
        finished: false,
        // True for numbers taken on a PC that was in use: they are not a baseline.
        trial,
        ...identity,
        commandLine: `node dev/perf/app/run.mjs ${process.argv.slice(2).join(' ')}`,
        measured: [],
        failed: [],
        // Measured, but not all of it: a launch, a start-up, a series or a single switch failed while the rest went through.
        partial: [],
        disturbed: [],
    };
    // Every result file says which run wrote it: a folder that is used again keeps the files of earlier runs.
    identity = { ...identity, run: runRecord.startedAt };
    saveRun();
};

const note = (name, result) => {
    if (result.error) {
        runRecord.failed.push(name);
    } else {
        runRecord.measured.push(name);
        const lost = shortfalls(result);
        if (lost.length) {
            runRecord.partial.push({ name, lost });
            log(`${name}: NOT ALL OF IT WAS MEASURED: ${lost.map(entry => (entry.planned === null ? `${entry.errors.length} ${entry.what} failed` : `${entry.measured} of ${entry.planned} ${entry.what}`)).join(', ')}`);
        }
        if (result.disturbedBy?.length) {
            runRecord.disturbed.push(name);
        }
    }
    saveRun();
};

const endRun = (how) => {
    if (runRecord) {
        Object.assign(runRecord, { endedAt: new Date().toISOString(), ...how });
        saveRun();
    }
};

const stopRun = async (signal) => {
    if (stopping) {
        return;
    }
    stopping = true;
    console.error(`[perf] stopped by ${signal}: closing the app and the sampler`);
    // A run that had finished (stopped while its table is written or its folder renamed) stays finished.
    if (!runRecord?.finished) {
        endRun({ finished: false, stoppedBy: signal });
    }
    await Promise.allSettled([...open].map(thing => thing.close()));
    process.exit(130);
};
['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((signal) => {
    process.on(signal, () => { void stopRun(signal); });
});

/** Runs something that holds a launch of the app; the launch is closed when the runner is stopped meanwhile. */
const holding = async (thing, work) => {
    open.add(thing);
    try {
        return await work(thing);
    } finally {
        open.delete(thing);
        await thing.close();
    }
};

// ---------------------------------------------------------------------------------------------
// Other programs
// ---------------------------------------------------------------------------------------------

/**
 * One sampler for everything on the machine, for the stretches in which no app of this run is up:
 * it says what other programs did in the seconds before a launch.
 */
const machineWatch = async () => {
    const profile = resolveProfile('host');
    let sampler = null;
    /**
     * A new sampler in place of the one before. A sampler does not see the graphics-card use of a
     * program that was started after it (measured for the rig: 0.00% from the earlier sampler, 4.64%
     * from a later one), so one that lived for the whole run could only tell of the programs of
     * minute 0. It is renewed before each start-up series.
     */
    const renew = async () => {
        // Held to the fast cores (where the PC has two kinds), off the ones a measured app is held to.
        const next = startSampler({ pids: [], processors: null, selfMask: resolveProfile('laptop').samplerMask });
        try {
            await next.ready;
        } catch (error) {
            next.stop();
            // The first one has to work. A later one that does not must not end a run that is an hour in: the one before goes on.
            if (!sampler) {
                throw error;
            }
            log(`the sampler for the whole machine could not be started anew (${String(error.message).slice(0, 200)}); the one before goes on`);
            return;
        }
        sampler?.stop();
        sampler = next;
        await sleep(SAMPLER_SETTLE_SECONDS * 1000);
    };
    await renew();
    return {
        /** What ran on the machine in the last `seconds` (the app of this run must not be up meanwhile). */
        lately: (seconds = 3) => {
            const lines = sampler.samples.filter(sample => sample.t >= Date.now() - seconds * 1000 - 400);
            return lines.length ? outsideLoad(lines, profile) : { brokenLimits: ['no counter lines'] };
        },
        renew,
        close: async () => { sampler?.stop(); },
    };
};

// ---------------------------------------------------------------------------------------------
// The prepared profiles: an app that has been used, with a library
// ---------------------------------------------------------------------------------------------

const TEMPLATE = { songs: path.join(PROFILES_DIR, 'template-songs'), large: path.join(PROFILES_DIR, 'template-large') };
const distStamp = () => {
    const stat = fs.statSync(path.join(APP_DIST, 'index.html'));
    return `${stat.size}-${Math.round(stat.mtimeMs)}`;
};
/** A prepared profile holds the library as this build of the app stored it: it is made again when the build or the music files change. */
const templateStamp = () => `${distStamp()}-fixtures${FIXTURE_VERSION}`;
const templateIsCurrent = (name) => {
    const file = path.join(TEMPLATE[name], 'template.json');
    const made = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
    // One without the count of its first page's pictures was made by the first version of this tool.
    return made !== null && made.stamp === templateStamp() && made.homePictures > 0;
};

/**
 * Removes what earlier runs in this worktree left under profiles/: the copy every measured launch
 * started from, and anything else. The two prepared profiles stay (a run with --no-build starts
 * from them), and the library is not touched: it is the same every time. Safe at the start of a
 * run: the measuring lock is held, so no other run is using these folders.
 */
const removeEarlierProfiles = () => {
    const kept = Object.values(TEMPLATE).map(folder => path.basename(folder));
    const left = fs.existsSync(PROFILES_DIR) ? fs.readdirSync(PROFILES_DIR).filter(name => !kept.includes(name)) : [];
    left.forEach(name => removeFolder(path.join(PROFILES_DIR, name)));
    if (left.length) {
        log(`removed ${left.length} profile folders an earlier run left (${left.slice(0, 4).join(', ')}${left.length > 4 ? ', …' : ''})`);
    }
};

/** A launch without limits, for getting a profile ready (not measured). */
const withApp = (profileDir, work) => launchApp({ profileDir }).then(running => holding(running, async () => {
    await running.waitFor('did-finish-load', 120_000);
    const page = await attachPage(running);
    await waitUsable(page);
    await page.enable();
    return work(page, running);
}));

/** Waits for the import to have ended: the count is shown, and the pictures of the home page stay loaded for five seconds. */
const importSettled = async (page, tracksText) => {
    await waitUntil(async () => (await ask(page, 'texts', '#root', tracksText, 1)).length > 0, { timeoutMs: 300_000, everyMs: 500, what: `"${tracksText}" on the home page` });
    let quietChecks = 0;
    await waitUntil(async () => {
        const { pending, shown } = await ask(page, 'pictures');
        quietChecks = pending === 0 && shown >= 2 ? quietChecks + 1 : 0;
        return quietChecks >= 5;
    }, { timeoutMs: 300_000, everyMs: 1000, what: 'the covers of the imported folder' });
    await sleep(4000);
};

/**
 * How many pictures the first page shows once it is whole: none is still loading and the count has
 * been the same for five looks a second apart. A measured launch from this profile is not called
 * usable before it shows as many (dev/perf/app/probe.cjs).
 */
const settledHomePictures = async (page) => {
    let last = -1;
    let same = 0;
    await waitUntil(async () => {
        const { pending, shown } = await ask(page, 'pictures');
        same = pending === 0 && shown > 0 && shown === last ? same + 1 : 0;
        last = shown;
        return same >= 5;
    }, { timeoutMs: 120_000, everyMs: 1000, what: 'the pictures of the first page to stop coming' });
    return last;
};

/**
 * Makes the two profiles every measured launch starts from a copy of:
 *   - `template-songs`: a first launch gone through as a person would (release notes, the choice
 *     of view, the Ponder introduction), the folder of 24 songs imported with the app's own button,
 *     the app closed and started twice more, so that it has left its caches the way a used app has;
 *   - `template-large`: the same, with the folder of 300 short tracks imported as well.
 */
const prepareTemplates = async (library, { rebuild }) => {
    const made = {};
    if (rebuild || !templateIsCurrent('songs')) {
        const startedAt = Date.now();
        const profileDir = freshProfile('template-songs');
        const firstRun = await withApp(profileDir, async (page) => {
            const passed = await passFirstRun(page);
            await clickOn(page, AT.folderTab);
            await sleep(800);
            await importFolder(page, library.songs.folder);
            await importSettled(page, `^${library.songs.tracks} Tracks • All Songs$`);
            return passed;
        });
        let homePictures = 0;
        for (let launch = 0; launch < 2; launch += 1) {
            homePictures = await withApp(profileDir, settledHomePictures);
        }
        made.songs = { firstRun, tracks: library.songs.tracks, homePictures, seconds: Math.round((Date.now() - startedAt) / 1000) };
        writeJson(path.join(profileDir, 'template.json'), { stamp: templateStamp(), builtAt: new Date().toISOString(), ...made.songs });
        log(`profile with ${library.songs.tracks} songs prepared in ${made.songs.seconds} s; its first page shows ${homePictures} pictures`);
        rebuild = true;
    }
    if (rebuild || !templateIsCurrent('large')) {
        const startedAt = Date.now();
        const profileDir = freshProfile('template-large');
        fs.cpSync(TEMPLATE.songs, profileDir, { recursive: true });
        fs.rmSync(path.join(profileDir, 'template.json'), { force: true });
        const total = library.songs.tracks + library.sketches.tracks;
        await withApp(profileDir, async (page) => {
            await importFolder(page, library.sketches.folder);
            await importSettled(page, `^${total} Tracks • All Songs$`);
        });
        let homePictures = 0;
        for (let launch = 0; launch < 2; launch += 1) {
            homePictures = await withApp(profileDir, settledHomePictures);
        }
        made.large = { tracks: total, homePictures, seconds: Math.round((Date.now() - startedAt) / 1000) };
        writeJson(path.join(profileDir, 'template.json'), { stamp: templateStamp(), builtAt: new Date().toISOString(), ...made.large });
        log(`profile with ${total} tracks prepared in ${made.large.seconds} s; its first page shows ${homePictures} pictures`);
    }
    return made;
};

// ---------------------------------------------------------------------------------------------
// The four areas, under one profile
// ---------------------------------------------------------------------------------------------

const failed = error => ({ error: String(error.message ?? error).slice(0, 600) });

const runStartup = async (out, profileName, library, options, watch) => {
    const profile = resolveProfile(profileName);
    const result = { area: 'startup', profile: profileName, ...identity, library: library.songs.tracks, kinds: {} };
    for (const [kind, count] of [['cold', options.cold], ['warm', options.warm]]) {
        const runs = [];
        const errors = [];
        const disturbedBy = new Set();
        if (count > 0) {
            await watch.renew();
        }
        for (let launch = 0; launch < count; launch += 1) {
            // Two seconds for the launch before to be gone from the processors; then what else is busy.
            await sleep(2500);
            const before = watch.lately(2);
            before.brokenLimits.forEach(limit => disturbedBy.add(limit));
            try {
                const run = await measureStartup({ profile, template: TEMPLATE.songs, name: `run-${profileName}-startup`, cold: kind === 'cold' });
                runs.push({ ...run, outsideBefore: before });
                log(`${profileName} start-up ${kind} ${launch + 1}/${count}: window ${run.milestones.windowCreated} ms, first screen ${run.milestones.firstScreen} ms, usable ${run.milestones.homeUsable} ms${before.brokenLimits.length ? ` [busy before: ${before.brokenLimits.join(', ')}]` : ''}`);
            } catch (error) {
                errors.push(failed(error).error);
                log(`${profileName} start-up ${kind} ${launch + 1}/${count}: FAILED ${error.message}`);
            }
        }
        result.kinds[kind] = {
            summary: runs.length ? spreadOf(runs.map(run => ({ milestones: run.milestones, where: run.where, memoryMb: run.memoryMb }))) : null,
            runs,
            errors,
            disturbedBy: [...disturbedBy],
        };
    }
    result.disturbedBy = [...new Set(Object.values(result.kinds).flatMap(kind => kind.disturbedBy))];
    if (Object.values(result.kinds).every(kind => kind.runs.length === 0)) {
        result.error = Object.values(result.kinds).flatMap(kind => kind.errors)[0] ?? 'no launch was measured';
    }
    writeJson(path.join(out, profileName, 'startup.json'), result);
    note(`${profileName}/startup`, result);
    return result;
};

/** What the guard kept the app from during a launch: the hosts it refused, with how often, and everything else it stood in for. */
const guardNotes = (running) => {
    const refused = {};
    running.events.filter(event => event.kind === 'refused').forEach((event) => { refused[`${event.via} ${event.host}`] = (refused[`${event.via} ${event.host}`] ?? 0) + 1; });
    const others = {};
    running.events.filter(event => ['suppressed', 'write-refused', 'spawn-refused', 'guard-warning', 'uncaught-exception'].includes(event.kind)).forEach((event) => {
        const text = `${event.kind}: ${event.what ?? event.operation ?? ''} ${event.path ?? event.command ?? event.text ?? ''}`.trim().slice(0, 200);
        others[text] = (others[text] ?? 0) + 1;
    });
    return {
        refused,
        others,
        listening: running.events.filter(event => event.kind === 'listen').map(event => `${event.bound}:${event.port} (asked for ${event.asked})`),
        callsIgnored: [...new Set(running.events.filter(event => event.kind === 'window-call-ignored').map(event => event.name))],
    };
};

/** One launch from a copy of a prepared profile, measured by `work`, written as one file. */
const runInSession = async (profileName, area, template, work) => {
    const profile = resolveProfile(profileName);
    const startedAt = Date.now();
    let result;
    try {
        const session = await openSession({ profile, template, name: `run-${profileName}-${area}` });
        result = await holding(session, async () => {
            const measured = await work(session);
            // Looked at again at the end: a process that started meanwhile (the audio service) has to be held too.
            // A process off the mask fails the launch. A look that could not be taken at all (Windows gave no
            // answer) keeps the numbers and marks them.
            let notLookedAt = null;
            try {
                session.checkAffinity();
            } catch (error) {
                if (/not every process is held/.test(error.message)) {
                    throw error;
                }
                notLookedAt = String(error.message).slice(0, 300);
            }
            return {
                area,
                profile: profileName,
                ...identity,
                ...measured,
                ...(notLookedAt ? { processorsAtEnd: `not looked at: ${notLookedAt}`, disturbedBy: [...measured.disturbedBy, 'processors not checked at the end'] } : { processorsAtEnd: 'held' }),
                guard: guardNotes(session.running),
                pageLog: [...new Set(session.page.pageLog)].slice(0, 12),
            };
        });
    } catch (error) {
        result = { area, profile: profileName, ...identity, ...failed(error) };
    }
    if (stopping) {
        await new Promise(() => {});
    }
    result.tookSeconds = Math.round((Date.now() - startedAt) / 1000);
    return result;
};

/**
 * Several launches of one area put together. The runs of all of them are summarised as one, and
 * `launchMedians` keeps each launch's own median of every number: two launches of the same code
 * differ by more than the runs inside one launch do, and a later comparison is between launches.
 */
const mergeLaunches = (launches, runsOf, withRuns) => {
    const good = launches.filter(launch => !launch.error);
    if (good.length === 0) {
        return { ...launches[0], launches: 0, failedLaunches: launches.map(launch => launch.error) };
    }
    const groups = Object.keys(runsOf(good[0]));
    const merged = withRuns(good[0], Object.fromEntries(groups.map(group => [group, good.flatMap(launch => runsOf(launch)[group] ?? [])])));
    const launchMedians = Object.fromEntries(groups.map((group) => {
        const perLaunch = good.map(launch => spreadOf(runsOf(launch)[group] ?? []));
        const names = [...new Set(perLaunch.flatMap(summary => Object.keys(summary)))];
        return [group, Object.fromEntries(names.map(name => [name, perLaunch.map(summary => summary[name]?.median ?? null)]))];
    }));
    return {
        ...merged,
        launches: good.length,
        // What is not a run of a series (guard, idleFrameRate, gpuPercent) is the first launch's above; here it is of each.
        ofEachLaunch: good.map(launch => ({ idleFrameRate: launch.idleFrameRate ?? null, gpuPercent: launch.gpuPercent ?? null, processorsAtEnd: launch.processorsAtEnd, guard: launch.guard, tookSeconds: launch.tookSeconds })),
        launchMedians,
        failedLaunches: launches.filter(launch => launch.error).map(launch => launch.error),
        outside: good.map(launch => launch.outside),
        disturbedBy: [...new Set(good.flatMap(launch => launch.disturbedBy))],
        tookSeconds: launches.reduce((sum, launch) => sum + (launch.tookSeconds ?? 0), 0),
    };
};

const runSongs = async (out, profileName, library, options) => {
    const launches = [];
    for (let launch = 0; launch < (options.launches ?? 1); launch += 1) {
        launches.push(await runInSession(profileName, 'songs', TEMPLATE.songs, session => measureSongs(session, library, options)));
    }
    const result = mergeLaunches(launches, launch => launch.runs, (first, runs) => ({
        ...first,
        runs,
        summary: Object.fromEntries(Object.entries(runs).filter(([, list]) => list.length).map(([kind, list]) => [kind, spreadOf(list)])),
    }));
    writeJson(path.join(out, profileName, options.file ?? 'songs.json'), result);
    note(`${profileName}/${options.file ?? 'songs'}`, result);
    const sound = result.summary?.nextOnPlayer?.soundMs;
    log(result.error ? `${profileName} song change: FAILED ${result.error}` : `${profileName} song change${options.burnMs ? ` (+${options.burnMs} ms held)` : ''}: next on the player page, first sound ${sound?.median} ms (${sound?.min} to ${sound?.max}), title ${result.summary.nextOnPlayer.titleMs?.median} ms, words ${result.summary.nextOnPlayer.lyricMs?.median} ms${result.disturbedBy.length ? ` [disturbed: ${result.disturbedBy.join(', ')}]` : ''}`);
    return result;
};

const runPages = async (out, profileName, library, options) => {
    const launches = [];
    for (let launch = 0; launch < (options.launches ?? 1); launch += 1) {
        launches.push(await runInSession(profileName, 'pages', TEMPLATE.songs, session => measurePages(session, library, { rounds: options.rounds })));
    }
    const result = mergeLaunches(launches, launch => Object.fromEntries(launch.switches.map(entry => [entry.id, entry.runs])), (first, runs) => ({
        ...first,
        switches: first.switches.map(entry => ({ ...entry, runs: runs[entry.id], summary: runs[entry.id].length ? spreadOf(runs[entry.id]) : null })),
        failures: launches.flatMap(launch => launch.failures ?? []),
    }));
    writeJson(path.join(out, profileName, 'pages.json'), result);
    note(`${profileName}/pages`, result);
    log(result.error ? `${profileName} page switches: FAILED ${result.error}` : `${profileName} page switches: ${result.switches.map(entry => `${entry.id} ${entry.summary?.firstFrameMs?.median ?? '?'}/${entry.summary?.settledMs?.median ?? '?'}`).join(', ')} ms (first frame/settled)${result.failures.length ? `, ${result.failures.length} failed` : ''}${result.disturbedBy.length ? ` [disturbed: ${result.disturbedBy.join(', ')}]` : ''}`);
    return result;
};

const runMemory = async (out, profileName, library, options) => {
    const series = [];
    for (let run = 0; run < options.memorySeries; run += 1) {
        const result = await runInSession(profileName, 'memory', TEMPLATE.large, session => measureMemory(session, library, { rounds: options.memoryRounds }));
        series.push(result);
        log(result.error ? `${profileName} memory series ${run + 1}: FAILED ${result.error}` : `${profileName} memory series ${run + 1}: ${result.points.map(point => point.processes.total.private).join(' -> ')} MB private in all processes; held JS heap per song change ${result.growthPerSongChange.jsHeapHeld} MB, per page round ${result.growthPerPageRound.jsHeapHeld} MB`);
    }
    const good = series.filter(entry => !entry.error);
    const result = {
        area: 'memory',
        profile: profileName,
        ...identity,
        library: library.songs.tracks + library.sketches.tracks,
        summary: good.length ? spreadOf(good.map(memoryNumbers)) : null,
        pointNames: good[0]?.points.map(point => point.name) ?? [],
        series,
        disturbedBy: [...new Set(good.flatMap(entry => entry.disturbedBy))],
        ...(good.length ? {} : { error: series[0]?.error ?? 'no series was measured' }),
    };
    writeJson(path.join(out, profileName, 'memory.json'), result);
    note(`${profileName}/memory`, result);
    return result;
};

/** The check of the tool against a known change: the same song changes without and with the main thread held after the input. */
const runTruth = async (out, profileName, library) => {
    const plain = await runSongs(out, profileName, library, { short: true, launches: 1, file: 'truth-plain.json' });
    const held = await runSongs(out, profileName, library, { short: true, launches: 1, burnMs: BURN_MS, file: 'truth-held.json' });
    if (plain.error || held.error) {
        throw new Error(`the check against a known change could not be measured: ${plain.error ?? held.error}`);
    }
    const pair = name => {
        const without = plain.summary.nextOnPlayer[name]?.median ?? null;
        const withHold = held.summary.nextOnPlayer[name]?.median ?? null;
        return { plain: without, held: withHold, rise: without === null || withHold === null ? null : Number((withHold - without).toFixed(1)) };
    };
    const truth = {
        profile: profileName,
        ...identity,
        heldMs: BURN_MS,
        runsEach: plain.runs.nextOnPlayer.length,
        nextOnPlayer: { soundMs: pair('soundMs'), titleMs: pair('titleMs'), lyricMs: pair('lyricMs'), coverMs: pair('coverMs'), sourceSetMs: pair('sourceSetMs'), longestTaskMs: pair('longestTaskMs') },
        disturbedBy: [...new Set([...plain.disturbedBy, ...held.disturbedBy])],
    };
    writeJson(path.join(out, 'truth.json'), truth);
    log(`known change: ${BURN_MS} ms held after the input; first sound rose by ${truth.nextOnPlayer.soundMs.rise} ms, title by ${truth.nextOnPlayer.titleMs.rise} ms, longest task ${truth.nextOnPlayer.longestTaskMs.held} ms`);
    return truth;
};

/** What the recorder itself costs a song change: the same changes with its looks of every frame and without (one launch). */
const runRecorderCost = async (out, profileName, library) => {
    const result = await runInSession(profileName, 'recorder', TEMPLATE.songs, session => measureRecorderCost(session, library));
    writeJson(path.join(out, profileName, 'recorder.json'), result);
    note(`${profileName}/recorder`, result);
    const of = name => `${result.summary?.withLooks[name]?.median} against ${result.summary?.bare[name]?.median} ms`;
    log(result.error ? `${profileName} recorder: FAILED ${result.error}` : `${profileName} recorder, ${result.runs.withLooks.length} song changes with its looks against ${result.runs.bare.length} without: "playing" event ${of('playingEventMs')}, play() called ${of('playCalledMs')}, longest task ${of('longestTaskMs')}; its looks took ${result.summary.withLooks['recorder.perFrameWaitingMs']?.median} ms a frame, ${result.summary.withLooks['recorder.whileWaitingMs']?.median} ms in all per change${result.disturbedBy.length ? ` [disturbed: ${result.disturbedBy.join(', ')}]` : ''}`);
    return result;
};

// ---------------------------------------------------------------------------------------------
// The ways to run
// ---------------------------------------------------------------------------------------------

/** About how many minutes the measuring takes, from the lengths seen on the PC this was built on. */
const planMinutes = (options, profiles, areas, truth, recorder) => {
    const perProfile = (areas.includes('startup') ? (options.cold + options.warm) * 22 + 14 : 0)
        + (areas.includes('songs') ? options.launches * 150 : 0)
        + (areas.includes('pages') ? options.launches * (60 + options.rounds * 45) : 0)
        + (areas.includes('memory') ? options.memorySeries * (200 + options.memoryRounds * 19) : 0)
        + (recorder ? 230 : 0);
    return Math.ceil((perProfile * profiles.length + (truth ? 120 : 0) + 240) / 60);
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const whole = Boolean(args.baseline || args.trial);
    const quick = Boolean(args.quick);
    const options = {
        cold: Number(args.cold ?? (quick ? 2 : 3)),
        warm: Number(args.warm ?? (quick ? 3 : 5)),
        rounds: Number(args.rounds ?? (quick ? 3 : 5)),
        memorySeries: Number(args.memorySeries ?? (quick ? 1 : 2)),
        // Launches of the song series and of the page series: two, so that a result says how much two launches differ.
        launches: Number(args.launches ?? (quick ? 1 : 2)),
        memoryRounds: Number(args.memoryRounds ?? 20),
    };
    const profiles = whole ? PROFILE_NAMES : [args.profile ?? 'laptop'];
    // --truth or --recorder alone measure only that; with --baseline or --trial they are added to the four areas.
    const areas = args.only ? args.only.split(',') : (!whole && (args.truth || args.recorder) ? [] : AREAS);
    const unknown = areas.filter(area => !AREAS.includes(area));
    if (unknown.length) {
        throw new Error(`no area named ${unknown.join(', ')} (${AREAS.join(', ')})`);
    }
    const truth = whole || Boolean(args.truth);
    const recorder = Boolean(args.recorder);
    const minutes = planMinutes(options, profiles, areas, truth, recorder);
    log(`${profiles.join(', ')}: ${areas.join(', ') || 'no area'}${truth ? ', and the check against a known change' : ''}${recorder ? ', and what the recorder costs' : ''}; about ${minutes} minutes, and about 4 more when the app has to be built and the profiles prepared`);
    if (args.plan) {
        return;
    }

    // One measuring run at a time on this PC, whichever tool and worktree: this waits while another
    // one goes on, before anything here is started and before other programs are looked at.
    await holdMeasuringLock(`dev/perf/app/run.mjs ${process.argv.slice(2).join(' ')}`);
    identity = gitState();
    log(`measuring commit ${identity.commit ?? '(unknown)'}${identity.dirty ? ', with changes that are not committed' : ''}`);
    const trial = !args.baseline;
    const label = args.label ?? (args.baseline ? 'app-baseline' : `app-run-${stamp()}`);
    const out = path.resolve(args.out ?? path.join(notesDir(), 'data', label));
    const working = args.baseline ? `${out}.partial` : out;

    // From here to the end the screen is on: the window takes its frame rate from it.
    const awake = keepAwake();
    open.add(awake);
    if (await awake.ready) {
        await sleep(2000);
    }
    const watch = await machineWatch();
    open.add(watch);
    await sleep(3000);
    const now = watch.lately(3);
    log(`right now other programs use ${(now.ofAllProcessors * 100).toFixed(0)}% of all processors and ${now.gpuPercent?.toFixed(0)}% of the graphics card's 3D engine`);
    if (args.baseline && now.brokenLimits.length && !args.allowDisturbed) {
        console.error(`[perf] not starting: other programs keep busy: ${now.brokenLimits.join(', ')}. Run it when the PC is idle, or use --trial for numbers that are marked as taken on a busy PC.`);
        await Promise.allSettled([...open].map(thing => thing.close()));
        process.exit(2);
    }
    if (args.baseline && fs.existsSync(working)) {
        // What an earlier --baseline left: one that was stopped, or one that finished and could not be renamed into place.
        const earlier = fs.existsSync(path.join(working, '_run.json')) ? JSON.parse(fs.readFileSync(path.join(working, '_run.json'), 'utf8')).runs?.at(-1) : null;
        fs.renameSync(working, `${working}-${earlier?.finished ? 'finished-not-placed' : 'stopped'}-${stamp()}`);
    }

    removeEarlierProfiles();
    const build = buildApp({ skip: Boolean(args.noBuild) });
    const library = writeLibrary();
    beginRun(working, trial);
    const prepared = await prepareTemplates(library, { rebuild: !build.skipped });
    writeJson(path.join(working, '_setup.json'), {
        ...identity,
        machine: resolveProfile('host'),
        profiles: Object.fromEntries(PROFILE_NAMES.map((name) => { const { heldProcessors, affinityMask } = resolveProfile(name); return [name, { heldProcessors, affinityMask }]; })),
        build: { ...build, dist: distShape() },
        library: { songs: library.songs.tracks, albums: library.songs.albums.length, sketches: library.sketches.tracks, sketchAlbums: library.sketches.albums.length },
        prepared,
        options,
        outsideAtStart: now,
    });

    for (const profileName of profiles) {
        if (areas.includes('startup')) {
            await runStartup(working, profileName, library, options, watch);
        }
        if (areas.includes('songs')) {
            await runSongs(working, profileName, library, { launches: options.launches });
        }
        if (areas.includes('pages')) {
            await runPages(working, profileName, library, options);
        }
        if (areas.includes('memory')) {
            await runMemory(working, profileName, library, options);
        }
    }
    if (recorder) {
        for (const profileName of profiles) {
            await runRecorderCost(working, profileName, library);
        }
    }
    if (truth) {
        await runTruth(working, args.truth ? profiles[0] : 'laptop', library).catch((error) => {
            runRecord.failed.push('truth');
            log(`known change: FAILED ${error.message}`);
        });
    }
    endRun({ finished: true });

    // The table first, from the folder the results are in: nothing after this can lose it.
    const table = args.table ? path.resolve(args.table) : path.join(notesDir(), args.baseline ? '应用底数.md' : `应用试跑-${label}.md`);
    // A table that cannot be written must not turn a finished run into a failed one: the results are on disk.
    try {
        writeAppReport(working, table);
        log(`table written to ${table}`);
    } catch (error) {
        endRun({ tableNotWritten: String(error.stack ?? error).slice(0, 600) });
        console.error(`[perf] THE TABLE COULD NOT BE WRITTEN (${error.message}). The results are whole; once report.mjs is put right: node dev/perf/app/report.mjs <results folder> "${table}"`);
    }
    let placed = working;
    if (args.baseline) {
        // Windows does not rename a folder while another program has something inside it open (a dev
        // server that watches the checkout does). It is tried for a while; a baseline that cannot be put
        // in place is still a finished one, in the folder it was written to.
        try {
            if (fs.existsSync(out)) {
                await renamePatiently(out, `${out}-replaced-${stamp()}`);
            }
            await renamePatiently(working, out);
            placed = out;
            // The record of the run moved with its folder: what is saved from here on goes there.
            runFile = path.join(out, '_run.json');
        } catch (error) {
            endRun({ notPlaced: String(error.message ?? error) });
            console.error(`[perf] THE BASELINE IS MEASURED BUT NOT IN PLACE: ${working} could not be renamed to ${out} (${error.message}). The results are whole, in ${working}, and the table is written; close what holds the folder and rename it by hand.`);
            // The table was written before the rename was tried: once more, so that it says the folder is not in place.
            try {
                writeAppReport(working, table);
            } catch {
                // It was written once already, or its failure is reported above.
            }
        }
    }
    log(`results in ${placed}`);
    if (runRecord.failed.length) {
        log(`FAILED and without numbers: ${runRecord.failed.join(', ')}`);
    }
    if (runRecord.partial.length) {
        log(`MEASURED ONLY IN PART: ${runRecord.partial.map(entry => entry.name).join(', ')} (the table says what is missing)`);
    }
    await Promise.allSettled([...open].map(thing => thing.close()));
    // 3: the run went to its end, but something was not measured, or the baseline folder is not in place.
    return runRecord.failed.length || runRecord.partial.length || runRecord.notPlaced || runRecord.tableNotWritten ? 3 : 0;
};

main().then(code => process.exit(code ?? 0), async (error) => {
    if (stopping) {
        return;
    }
    console.error('[perf]', error.stack ?? error.message ?? error);
    endRun({ finished: false, error: String(error.message ?? error) });
    await Promise.allSettled([...open].map(thing => thing.close()));
    process.exit(1);
});
