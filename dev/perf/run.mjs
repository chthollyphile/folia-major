import fs from 'node:fs';
import path from 'node:path';
import { holdMeasuringLock } from './lock.mjs';
import { writeReport } from './report.mjs';
import {
    buildPage,
    gitState,
    keepAwake,
    launchEngine,
    log,
    mean,
    median,
    notesDir,
    openScenario,
    outsideLoad,
    percentile,
    resolveProfile,
    sleep,
    startSampler,
    startServer,
    stopStrayEngines,
    summarize,
} from './rig.mjs';
import {
    BENCHMARK_SCENARIO,
    LARGE_VIEWPORT,
    NOISE_SCENARIOS,
    PLAY,
    SAMPLER_SETTLE_SECONDS,
    SCENARIOS,
    SCREEN_RATE_SHARE,
    TRUTH_SCENARIO,
    VIEWPORT,
    baselinePlan,
    findScenarios,
} from './scenarios.mjs';
import { WINDOW } from './song.mjs';

// dev/perf/run.mjs
// The measuring runner. dev/perf/README.md says what each number means and what is not measured.
//
//   node dev/perf/run.mjs --baseline
//       Everything in one go: all scenarios under the laptop and the old profile, the core set
//       under host, the ten heaviest on the graphics card again at the large viewport, the noise
//       check and the truth check, then the table. It first says how long it will take, and it
//       refuses to start while other programs keep the processors or the graphics card busy.
//       It writes into `<folder>.partial` and gives the folder its name only when all of it is done.
//   node dev/perf/run.mjs --profile laptop|old|host [--only <id>[,<id>]] [--set core|second]
//                         [--viewport 2560x1440@1.5] [--label <name>] [--out <folder>] [--check]
//   node dev/perf/run.mjs --noise [--profile laptop]    the two noise scenarios, five runs each
//   node dev/perf/run.mjs --truth [--profile laptop]    one scenario without and with 4 ms added per frame
//   Common: --windows <n> (3), --no-build (use the page built before),
//           --allow-disturbed (measure although other programs are busy; results are marked).
//
//   node dev/perf/run.mjs --plan                       says what --baseline would run and for how long, and
//                                                      writes that at the top of the result file while there is no baseline yet
//
// One scenario is one launch of the engine and one load of the page, in every way to run: what an
// earlier scenario left in the renderer and the GPU process (memory above all) never reaches the
// next one, so a scenario measured alone later compares with the same scenario in the baseline.
// The song's window (40 s to 48 s) is played three times per load; each time is one measurement,
// and the result is the median of the three with the lowest and the highest beside it. A window
// during which other programs were busy is thrown away and played again (OUTSIDE_LOAD in
// scenarios.mjs); a scenario that never got three quiet windows is marked disturbed.
//
// The window takes its frame rate from the screen, and only while the screen is on. So a run turns
// the screen on and keeps it on until it ends (keepAwake in rig.mjs), every launch notes the rate
// its empty window is paced at, and a result taken off the screen's rate is marked.
//
// Every folder of results holds `_run.json`: for each run that wrote into it the start and the end,
// the commit and whether the working tree differed from it, the command line, the passes that
// finished and how many scenarios failed or were disturbed.

const FRAME_BUDGET_MS = 1000 / 60;
/** A window needs this many of the sampler's one-a-second lines; with fewer its GPU and memory numbers are not trusted. */
const MIN_WINDOW_SAMPLES = 6;
const SAMPLER_SETTLE_MS = SAMPLER_SETTLE_SECONDS * 1000;

const parseArgs = (argv) => {
    // laptop is the Windows default; macOS has only host (resolveProfile in rig.mjs refuses the
    // others), so a plain `node dev/perf/run.mjs --only ...` there works without typing --profile.
    const args = { profile: process.platform === 'darwin' ? 'host' : 'laptop', windows: PLAY.windowsPerLoad };
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        if (!name.startsWith('--')) {
            throw new Error(`unexpected argument "${name}"`);
        }
        const key = name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
        if (['baseline', 'noise', 'truth', 'plan', 'noBuild', 'check', 'allowDisturbed'].includes(key)) {
            args[key] = true;
        } else {
            args[key] = argv[index + 1];
            index += 1;
        }
    }
    args.windows = Number(args.windows);
    return args;
};

const parseViewport = (text) => {
    const match = /^(\d+)x(\d+)@([\d.]+)$/.exec(text ?? '');
    if (!match) {
        throw new Error(`a viewport is written like 1920x1080@1, not "${text}"`);
    }
    return { width: Number(match[1]), height: Number(match[2]), deviceScale: Number(match[3]) };
};

const viewportName = viewport => `${viewport.width}x${viewport.height}@${viewport.deviceScale}`;
const megabytes = bytes => bytes / (1024 * 1024);
const round = (value, digits = 3) => Number(value.toFixed(digits));
const roundAll = (record) => {
    Object.entries(record).forEach(([key, value]) => {
        if (typeof value === 'number') {
            record[key] = round(value);
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            roundAll(value);
        }
    });
    return record;
};
const sumOf = record => Object.values(record ?? {}).reduce((sum, value) => sum + Number(value), 0);

const writeJson = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};

/** yyyymmdd-hhmm of now, local time: the end of a folder name that was moved aside. */
const stamp = () => {
    const now = new Date();
    const two = value => String(value).padStart(2, '0');
    return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}`;
};

/** Renames a folder. Windows refuses while another program holds a file in it, so it is tried a few times. */
const moveFolder = async (from, to) => {
    for (let attempt = 0; ; attempt += 1) {
        try {
            fs.renameSync(from, to);
            return;
        } catch (error) {
            if (attempt >= 4) {
                throw error;
            }
            await sleep(1000);
        }
    }
};

// ---------------------------------------------------------------------------------------------
// The run: which code it measures, what it has finished, and what to close when it is stopped
// ---------------------------------------------------------------------------------------------

/** The commit and the dirty flag of the working tree, read once at the start; every result file carries them. */
let identity = { commit: null, dirty: null };
/** This run's entry in `_run.json` of the folder it writes into, and the entries earlier runs left there. */
let runRecord = null;
let runFile = null;
let runsBefore = [];
/** What has to be closed when the runner is stopped from outside: a session (the engine with its sampler), a lone sampler, the server. */
const open = new Set();
let stopping = false;

const saveRun = () => {
    if (runFile) {
        writeJson(runFile, { runs: [...runsBefore, runRecord] });
    }
};

const beginRun = (out) => {
    runFile = path.join(out, '_run.json');
    runsBefore = fs.existsSync(runFile) ? (JSON.parse(fs.readFileSync(runFile, 'utf8')).runs ?? []) : [];
    runRecord = {
        startedAt: new Date().toISOString(),
        endedAt: null,
        // True only when everything the command asked for ran to its end.
        finished: false,
        ...identity,
        commandLine: `node dev/perf/run.mjs ${process.argv.slice(2).join(' ')}`,
        passesFinished: [],
        scenariosMeasured: 0,
        scenariosFailed: 0,
        scenariosDisturbed: 0,
    };
    saveRun();
};

const noteScenario = (result) => {
    if (result.error) {
        runRecord.scenariosFailed += 1;
    } else {
        runRecord.scenariosMeasured += 1;
        runRecord.scenariosDisturbed += result.disturbed ? 1 : 0;
    }
    saveRun();
};

const notePass = (name) => {
    runRecord.passesFinished.push(name);
    saveRun();
};

const endRun = (how) => {
    if (runRecord) {
        Object.assign(runRecord, { endedAt: new Date().toISOString(), ...how });
        saveRun();
    }
};

/**
 * Ctrl+C, Ctrl+Break or a polite kill: the engine and the sampler are closed before the runner
 * goes, and `_run.json` says the run was stopped. (A runner killed outright runs nothing of this:
 * the shell and the sampler then end by themselves, see shell.cjs and win.ps1.)
 */
const stopRun = async (signal) => {
    if (stopping) {
        return;
    }
    stopping = true;
    console.error(`[perf] stopped by ${signal}: closing the engine and the sampler`);
    endRun({ finished: false, stoppedBy: signal });
    await Promise.allSettled([...open].map(thing => thing.close()));
    process.exit(130);
};
['SIGINT', 'SIGTERM', 'SIGBREAK'].forEach((signal) => {
    process.on(signal, () => { void stopRun(signal); });
});

/** While the runner is being stopped nothing more is written or started: this never resolves, process.exit ends it. */
const unlessStopping = () => (stopping ? new Promise(() => {}) : Promise.resolve());

/**
 * Waits until a sampler's first seconds are over. Its lines then read high (about 9 points of all
 * processors on this PC: the sampler's own start-up), so nothing is read from them. `aheadMs` is
 * time that passes anyway before the first line that will be used.
 */
const samplerSettled = (sampler, aheadMs = 0) => sleep(Math.max(0, sampler.readyAt + SAMPLER_SETTLE_MS - aheadMs - Date.now()));

/** The gaps between the animation frames of the page as it stands, over some milliseconds. */
const frameGaps = (engine, forMs) => engine.evaluate(`new Promise((resolve) => {
    const gaps = []; let last = 0; const startedAt = performance.now();
    const tick = (now) => { if (last) gaps.push(now - last); last = now; if (now - startedAt < ${forMs}) requestAnimationFrame(tick); else resolve(gaps); };
    requestAnimationFrame(tick);
})`);

/**
 * The rate a window is paced at, from the gaps between its frames: the gap a quarter of the way up,
 * not the middle one, so that a window whose frames come late half the time (an engine still
 * starting on two slow cores) is not taken for one on a slower pace.
 */
const pacedRate = gaps => (gaps.length ? 1000 / percentile(gaps, 0.25) : 0);

/** Whether a window that draws nothing makes a frame for every refresh of the screen (SCREEN_RATE_SHARE in scenarios.mjs says why it may not). */
const followsScreen = (profile, emptyFrameRate) => !profile.screenRefreshRate || emptyFrameRate >= profile.screenRefreshRate * SCREEN_RATE_SHARE;
let saidWindowIsOffTheScreenRate = false;

// ---------------------------------------------------------------------------------------------
// A session: one launch of the engine under one profile and one viewport
// ---------------------------------------------------------------------------------------------

const openSession = async (profileName, viewport) => {
    const profile = resolveProfile(profileName);
    const engine = await launchEngine({ ...viewport, affinityMask: profile.affinityMask });
    let sampler = null;
    const session = {
        profile,
        viewport,
        engine,
        tree: [],
        /** Frames a second the window was paced at while it was still empty (pacedRate). */
        emptyFrameRate: 0,
        /** Every process of the app as Windows lists it now. Throws when one of them is not held to the profile's processors. */
        checkAffinity: () => {
            const tree = engine.tree();
            if (tree.length === 0) {
                throw new Error('the engine is gone');
            }
            const strays = profile.affinityMask ? tree.filter(entry => entry.affinity.toUpperCase() !== profile.affinityMask) : [];
            if (strays.length) {
                throw new Error(`not every process is held to ${profile.affinityMask}: ${JSON.stringify(strays)}`);
            }
            return tree;
        },
        /** Whether the sampler reads GPU counters (win.ps1 does, darwinSampler.mjs does not); before one runs, the platform's answer. */
        gpuCounters: () => (sampler ? sampler.gpuCounters() : process.platform !== 'darwin'),
        /** The sampler follows the app's processes; it is started again when one of them was replaced, and when it has ended. */
        ensureSampler: async () => {
            const processes = await engine.processes();
            const pids = processes.map(process => process.id).sort((left, right) => left - right);
            if (!sampler || sampler.hasExited() || sampler.pids.join() !== pids.join()) {
                sampler?.stop();
                // Cleared before anything can throw: a sampler that failed is never taken for a working one.
                sampler = null;
                const started = startSampler({ pids, processors: profile.heldProcessors, selfMask: profile.samplerMask });
                try {
                    await started.ready;
                    // Windows lists the app's 3D engines from the first line on; macOS has no such
                    // counters (darwinSampler.mjs says so in its ready line) and the run goes on without them.
                    if (started.gpuCounters() && !started.samples[0].ownEngines) {
                        throw new Error('Windows lists no 3D engine counter for the app\'s processes');
                    }
                } catch (error) {
                    started.stop();
                    throw error;
                }
                sampler = started;
            }
            return { sampler, processes };
        },
        close: async () => {
            open.delete(session);
            sampler?.stop();
            sampler = null;
            await engine.close();
        },
    };
    open.add(session);
    try {
        // A second and a half for the engine's processes to come up; the empty window is watched meanwhile.
        session.emptyFrameRate = pacedRate(await frameGaps(engine, 1500));
        session.tree = session.checkAffinity();
    } catch (error) {
        await session.close();
        throw error;
    }
    log(`engine up: ${engine.browser}, profile ${profile.name}${profile.affinityMask ? ` (processors ${profile.heldProcessors.join(',')})` : ''}, ${viewportName(viewport)}, ${session.tree.length} processes, empty window ${session.emptyFrameRate.toFixed(0)} fps`);
    if (!followsScreen(profile, session.emptyFrameRate) && !saidWindowIsOffTheScreenRate) {
        saidWindowIsOffTheScreenRate = true;
        log(`the empty window makes ${session.emptyFrameRate.toFixed(0)} frames a second where the screen refreshes ${profile.screenRefreshRate} times: it does not follow the screen (a screen that is off does this, and the runner has asked Windows to turn it on). Results are marked "frame rate"; their per-frame numbers do not compare with results taken while the window follows the screen.`);
    }
    return session;
};

/**
 * What the sampler saw between two moments: the app's GPU use, video memory and working sets, and
 * what other programs did. A window the sampler has too few lines for, or lines without the app in
 * them, is an error: zeros would read as "no load", and nothing in the table could tell them apart.
 */
const readSamples = (session, sampler, processes, beganAt, endedAt) => {
    const inside = sampler.samples.filter(sample => sample.t >= beganAt + 900 && sample.t <= endedAt + 250);
    if (inside.length < MIN_WINDOW_SAMPLES) {
        throw new Error(`the counter sampler gave ${inside.length} lines for this window, it takes ${MIN_WINDOW_SAMPLES}${sampler.hasExited() ? ' (the sampler has ended)' : ''}`);
    }
    const gpuCounters = sampler.gpuCounters();
    if (gpuCounters && !inside.some(sample => sample.ownEngines > 0)) {
        throw new Error('the counter sampler listed no 3D engine of the app during this window');
    }
    const kindOf = new Map(processes.map(process => [String(process.id), process.type]));
    const last = inside[inside.length - 1];
    const workingSetMb = { renderer: 0, gpuProcess: 0, browser: 0, other: 0, total: 0 };
    Object.entries(last.workingSet ?? {}).forEach(([pid, bytes]) => {
        const kind = kindOf.get(pid);
        const slot = kind === 'renderer' ? 'renderer' : kind === 'GPU' ? 'gpuProcess' : kind === 'browser' ? 'browser' : 'other';
        workingSetMb[slot] += megabytes(Number(bytes));
        workingSetMb.total += megabytes(Number(bytes));
    });
    if (workingSetMb.renderer === 0 || workingSetMb.gpuProcess === 0) {
        throw new Error('the counter sampler did not find the app\'s page process or GPU process at the end of this window');
    }
    return {
        lines: inside.length,
        // macOS reads no graphics card (darwinSampler.mjs): the gpu and video-memory numbers are
        // left out entirely rather than written as zeros, so no table can mistake n/a for none.
        ...(gpuCounters ? {
            gpuPercent: mean(inside.map(sample => sumOf(sample.gpu))),
            videoMemoryMb: megabytes(sumOf(last.videoMemory)),
        } : {}),
        workingSetMb,
        outside: outsideLoad(inside, session.profile),
    };
};

const metricsOf = async (engine) => {
    const [{ metrics }, processes] = await Promise.all([engine.send('Performance.getMetrics'), engine.processes()]);
    return { metrics: Object.fromEntries(metrics.map(metric => [metric.name, metric.value])), processes };
};

/** Plays the song's window once and measures it. */
const measureWindow = async (session, scenario, isFirst) => {
    const { engine } = session;
    const { sampler, processes } = await session.ensureSampler();
    const preRoll = isFirst ? PLAY.firstWarmSeconds : (scenario.songChange ? PLAY.songChangePreRollSeconds : PLAY.preRollSeconds);
    // A sampler that was just started (the first window; a later one after a process of the app was replaced).
    await samplerSettled(sampler, preRoll * 1000);
    if (scenario.songChange) {
        await engine.evaluate('window.__perf.useSong("a")');
    }
    await engine.evaluate(`window.__perf.playFrom(${WINDOW.startSeconds - preRoll})`);
    await engine.evaluate(`window.__perf.waitForSongTime(${WINDOW.startSeconds}).then(() => { window.__perf.startWindow(); })`);
    const beganAt = Date.now();
    const before = await metricsOf(engine);
    const options = scenario.songChange ? `, { swapSongAfterSeconds: ${PLAY.songChangeAfterSeconds} }` : '';
    const report = await engine.evaluate(`window.__perf.endWindowAfter(${WINDOW.lengthSeconds}${options})`);
    const after = await metricsOf(engine);
    const endedAt = Date.now();
    await engine.evaluate('window.__perf.pause()');

    const delta = name => after.metrics[name] - before.metrics[name];
    const gaps = report.frameGapsMs;
    if (gaps.length < 2 || !(report.elapsedMs > 0)) {
        throw new Error(`the page produced ${gaps.length + 1} frames in this window`);
    }
    const framesPerSecond = gaps.length / (report.elapsedMs / 1000);
    const spanSeconds = delta('Timestamp');
    // The DevTools numbers cover a span a few milliseconds longer than the page's own recording.
    const framesInSpan = framesPerSecond * spanSeconds;
    const perFrame = name => (delta(name) * 1000) / framesInSpan;
    const perSecond = name => (delta(name) * 1000) / spanSeconds;
    const scriptMs = perFrame('ScriptDuration');
    const styleMs = perFrame('RecalcStyleDuration');
    const layoutMs = perFrame('LayoutDuration');
    const totalMs = perFrame('TaskDuration') - perFrame('DevToolsCommandDuration');
    const cpuCores = { gpuProcess: 0, renderer: 0, browser: 0, other: 0 };
    after.processes.forEach((process) => {
        const earlier = before.processes.find(entry => entry.id === process.id);
        if (!earlier) {
            return;
        }
        const slot = process.type === 'renderer' ? 'renderer' : process.type === 'GPU' ? 'gpuProcess' : process.type === 'browser' ? 'browser' : 'other';
        cpuCores[slot] += (process.cpuTime - earlier.cpuTime) / spanSeconds;
    });
    const { lines, gpuPercent, videoMemoryMb, workingSetMb, outside: { brokenLimits, ...outside } } = readSamples(session, sampler, processes, beganAt, endedAt);

    return {
        result: roundAll({
            frames: {
                perSecond: framesPerSecond,
                count: gaps.length,
                meanMs: mean(gaps),
                p50Ms: median(gaps),
                p95Ms: percentile(gaps, 0.95),
                p99Ms: percentile(gaps, 0.99),
                worstMs: Math.max(...gaps),
                shareOver16_7: gaps.filter(gap => gap > 16.7).length / gaps.length,
                shareOver33_3: gaps.filter(gap => gap > 33.3).length / gaps.length,
            },
            // Main-thread milliseconds per frame the page produced.
            perFrame: {
                scriptMs,
                styleMs,
                layoutMs,
                styleAndLayoutMs: styleMs + layoutMs,
                otherMs: Math.max(0, totalMs - scriptMs - styleMs - layoutMs),
                totalMs,
                budgetPercent: (totalMs / FRAME_BUDGET_MS) * 100,
                layouts: delta('LayoutCount') / framesInSpan,
                styleRecalcs: delta('RecalcStyleCount') / framesInSpan,
            },
            // Main-thread milliseconds per second of playback as they were really spent, at the frame
            // rate the page ran at: the DevTools numbers over their span, nothing assumed.
            perSecond: {
                scriptMs: perSecond('ScriptDuration'),
                styleAndLayoutMs: perSecond('RecalcStyleDuration') + perSecond('LayoutDuration'),
                totalMs: perSecond('TaskDuration') - perSecond('DevToolsCommandDuration'),
            },
            // Per frame x 60. On a 60 Hz screen a second costs AT LEAST this: work that goes by time
            // and not by frame (once per lyric line or word, timers, a canvas with a rate of its own)
            // was divided by more frames here than a 60 Hz screen has. The truth lies between this and
            // `perSecond`. (A page that ran below 60 frames a second has the two the other way round.)
            perSecondAt60: {
                scriptMs: scriptMs * 60,
                styleAndLayoutMs: (styleMs + layoutMs) * 60,
                totalMs: totalMs * 60,
            },
            longFrames: {
                count: report.longFrames.count,
                blockingMs: report.longFrames.blockingDurationMs,
                totalMs: report.longFrames.totalDurationMs,
            },
            // CPU time of whole processes (all their threads), in processors kept busy.
            cpuCores,
            cpuMsPerFrame: {
                gpuProcess: (cpuCores.gpuProcess * 1000) / framesPerSecond,
                renderer: (cpuCores.renderer * 1000) / framesPerSecond,
            },
            heapMb: { start: megabytes(before.metrics.JSHeapUsedSize), end: megabytes(after.metrics.JSHeapUsedSize) },
            domNodes: { start: before.metrics.Nodes, end: after.metrics.Nodes },
            // The app's share of the graphics card's 3D engine, as Windows counts it; at 60 frames a
            // second it is at least `percentAt60`, for the same reason as above. Absent on macOS,
            // where nothing an unprivileged process may read counts the card (darwin.mjs).
            ...(gpuPercent === undefined ? {} : {
                gpu: {
                    percent: gpuPercent,
                    percentAt60: (gpuPercent * 60) / framesPerSecond,
                },
                videoMemoryMb,
            }),
            workingSetMb,
            // How many of the sampler's lines the GPU, memory and outside numbers of this window rest on.
            samplerLines: lines,
            // What programs that are not the app did meanwhile.
            outside,
        }),
        brokenLimits,
        longFrameScripts: report.longFrames.scripts,
    };
};

const mergeScripts = (lists) => {
    const merged = new Map();
    lists.flat().forEach((script) => {
        const held = merged.get(script.name) ?? { name: script.name, count: 0, durationMs: 0, forcedStyleAndLayoutMs: 0 };
        held.count += script.count;
        held.durationMs += script.duration;
        held.forcedStyleAndLayoutMs += script.forcedStyleAndLayout;
        merged.set(script.name, held);
    });
    return [...merged.values()].sort((left, right) => right.durationMs - left.durationMs).slice(0, 8).map(roundAll);
};

/** One load of a scenario: its windows, the median of each number, and what was thrown away. */
const measureScenario = async (session, scenario, { windows, busyMs = 0, allowDisturbed = false }) => {
    const { engine } = session;
    const startedAt = new Date().toISOString();
    // `info` holds what the page really runs: the style, the background and the options as they stand in the store.
    const info = await openScenario(engine, scenario);
    if (busyMs > 0) {
        // The truth check: a known cost in every animation frame, added from outside the page's code.
        await engine.evaluate(`(() => { const burn = () => { const until = performance.now() + ${busyMs}; while (performance.now() < until) {} requestAnimationFrame(burn); }; requestAnimationFrame(burn); })()`);
    }
    const kept = [];
    const spoilt = [];
    const attempts = windows + (allowDisturbed ? 0 : PLAY.extraWindows);
    for (let attempt = 0; kept.length < windows && attempt < attempts; attempt += 1) {
        const measured = await measureWindow(session, scenario, attempt === 0);
        if (measured.brokenLimits.length && !allowDisturbed) {
            spoilt.push(measured);
            log(`  ${scenario.id}: window thrown away, other programs kept busy: ${measured.brokenLimits.join(', ')}`);
            await sleep(5000);
        } else {
            kept.push(measured);
        }
    }
    // Other programs never left the machine alone: keep the least disturbed windows and mark the result.
    if (kept.length < windows) {
        spoilt.sort((left, right) => left.brokenLimits.length - right.brokenLimits.length || left.result.outside.ofAllProcessors - right.result.outside.ofAllProcessors);
        kept.push(...spoilt.splice(0, windows - kept.length));
    }
    const disturbedBy = [...new Set(kept.flatMap(window => window.brokenLimits))];
    // Not a window's doing and not cured by playing it again: the whole launch ran off the screen's rate.
    if (!followsScreen(session.profile, session.emptyFrameRate)) {
        disturbedBy.push('frame rate');
    }
    return {
        scenario,
        profile: session.profile.name,
        viewport: session.viewport,
        ...identity,
        startedAt,
        // The frame rate of this launch's window while it was empty, and the screen's refresh rate.
        emptyFrameRate: round(session.emptyFrameRate, 1),
        screenRefreshRate: session.profile.screenRefreshRate,
        page: info,
        windowSeconds: WINDOW,
        ...(busyMs > 0 ? { busyMsPerFrame: busyMs } : {}),
        disturbed: disturbedBy.length > 0,
        disturbedBy,
        summary: summarize(kept.map(window => window.result)),
        windows: kept.map(window => window.result),
        thrownAway: spoilt.map(window => ({ ...window.result.outside, brokenLimits: window.brokenLimits })),
        longFrameScripts: mergeScripts(kept.map(window => window.longFrameScripts)),
        pageLog: [...new Set(engine.pageLog)].slice(0, 12),
    };
};

const describe = (result) => {
    const value = name => result.summary[name]?.median ?? 0;
    const gpu = result.summary['gpu.percent'] ? `, GPU ${value('gpu.percent').toFixed(1)}%` : ', GPU n/a (macOS reads none)';
    return `${value('frames.perSecond').toFixed(0)} fps, main thread ${value('perFrame.totalMs').toFixed(2)} ms/frame (script ${value('perFrame.scriptMs').toFixed(2)}, style+layout ${value('perFrame.styleAndLayoutMs').toFixed(2)}), p95 gap ${value('frames.p95Ms').toFixed(1)} ms${gpu}${result.disturbed ? ` [disturbed: ${result.disturbedBy.join(', ')}]` : ''}`;
};

/**
 * Measures one scenario in a launch of the engine of its own and writes its file. A scenario that
 * fails is written as an error file, never as numbers, and the run goes on.
 */
const runScenario = async (profileName, viewport, scenario, file, options) => {
    const beganAt = Date.now();
    let session = null;
    let result;
    try {
        session = await openSession(profileName, viewport);
        const measured = await measureScenario(session, scenario, options);
        // Looked at again at the end: a process that started while the scenario ran has to be held too.
        result = { ...measured, processesAtEnd: session.checkAffinity() };
    } catch (error) {
        result = { scenario, profile: profileName, viewport, ...identity, error: String(error.message ?? error), pageLog: session?.engine.pageLog ?? [] };
    } finally {
        await session?.close();
    }
    await unlessStopping();
    result.tookSeconds = round((Date.now() - beganAt) / 1000, 1);
    writeJson(file, result);
    noteScenario(result);
    log(result.error ? `${profileName} ${scenario.id}: FAILED ${result.error}` : `${profileName} ${scenario.id}: ${describe(result)}`);
    return result;
};

/**
 * What a profile is checked for before its numbers are trusted, in a launch of its own: the frame
 * rate and the GPU reading of an empty page, and the time of the fixed single-thread benchmark
 * under this profile.
 */
const checkSession = async (session, folder) => {
    const { engine } = session;
    await engine.navigate('data:text/html,<body style="margin:0;background:%2309090b"></body>');
    const { sampler } = await session.ensureSampler();
    await samplerSettled(sampler);
    const beganAt = Date.now();
    const gaps = await frameGaps(engine, 5000);
    const endedAt = Date.now();
    const emptySamples = sampler.samples.filter(sample => sample.t >= beganAt + 900 && sample.t <= endedAt + 250);
    if (emptySamples.length < 3 || gaps.length < 2) {
        throw new Error(`the empty-page check got ${emptySamples.length} lines from the counter sampler and ${gaps.length + 1} frames`);
    }
    const glRenderer = await engine.evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl2'); const info = gl && gl.getExtension('WEBGL_debug_renderer_info'); return gl ? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL'; })()`);

    await openScenario(engine, SCENARIOS.find(scenario => scenario.id === BENCHMARK_SCENARIO));
    const benchmarkMs = [];
    for (let run = 0; run < 7; run += 1) {
        benchmarkMs.push(await engine.evaluate('window.__perf.benchmark()'));
    }
    const { brokenLimits, ...outside } = outsideLoad(emptySamples, session.profile);
    if (!followsScreen(session.profile, pacedRate(gaps))) {
        brokenLimits.push('frame rate');
    }
    const check = roundAll({
        profile: session.profile,
        viewport: session.viewport,
        ...identity,
        engine: engine.browser,
        glRenderer,
        processes: session.tree,
        emptyPage: {
            framesPerSecond: gaps.length / 5,
            p50Ms: median(gaps),
            p95Ms: percentile(gaps, 0.95),
            worstMs: Math.max(...gaps),
            ...(session.gpuCounters()
                ? { gpuPercent: mean(emptySamples.map(sample => sumOf(sample.gpu))) }
                : {}),
        },
        benchmark: { runsMs: benchmarkMs.map(value => round(value, 1)), medianMs: median(benchmarkMs), bestMs: Math.min(...benchmarkMs) },
        outside,
        disturbed: brokenLimits.length > 0,
        disturbedBy: brokenLimits,
    });
    writeJson(path.join(folder, '_check.json'), check);
    const gpuText = session.gpuCounters() ? `, GPU ${check.emptyPage.gpuPercent}%` : ', GPU n/a (macOS reads none)';
    log(`${session.profile.name} check: empty page ${check.emptyPage.framesPerSecond} fps (p95 gap ${check.emptyPage.p95Ms} ms${gpuText}), benchmark best ${check.benchmark.bestMs} ms, ${glRenderer}`);
    return check;
};

// ---------------------------------------------------------------------------------------------
// The ways to run
// ---------------------------------------------------------------------------------------------

const folderOf = (out, profileName, viewport) => path.join(out, viewportName(viewport) === viewportName(VIEWPORT) ? profileName : `${profileName}-${viewport.width}x${viewport.height}x${viewport.deviceScale}`);

/** One profile at one viewport: its check when asked for, then every scenario, each in a launch of its own. */
const runPass = async (out, profileName, viewport, scenarios, options) => {
    const folder = folderOf(out, profileName, viewport);
    if (options.check) {
        // The check has no numbers of a scenario in it, so one failure is worth a second try before the run ends over it.
        for (let attempt = 0; ; attempt += 1) {
            let session = null;
            try {
                session = await openSession(profileName, viewport);
                await checkSession(session, folder);
                break;
            } catch (error) {
                await unlessStopping();
                if (attempt >= 1) {
                    throw error;
                }
                log(`${profileName} check failed (${error.message}), once more`);
            } finally {
                await session?.close();
            }
        }
    }
    const results = [];
    for (const scenario of scenarios) {
        const result = await runScenario(profileName, viewport, scenario, path.join(folder, `${scenario.id}.json`), options);
        if (!result.error) {
            results.push(result);
        }
    }
    notePass(path.basename(folder));
    return results;
};

/** The noise check: the light and the heavy scenario, five runs each. */
const runNoise = async (out, options) => {
    const scenarios = findScenarios({ only: NOISE_SCENARIOS.join(',') });
    const runs = Object.fromEntries(scenarios.map(scenario => [scenario.id, []]));
    let failedRuns = 0;
    for (let round = 0; round < 5; round += 1) {
        for (const scenario of scenarios) {
            const result = await runScenario(options.profile, VIEWPORT, scenario, path.join(out, 'noise', `${scenario.id}.run${round + 1}.json`), options);
            if (result.error) {
                failedRuns += 1;
            } else {
                runs[scenario.id].push(result);
            }
        }
    }
    const noise = { profile: options.profile, viewport: VIEWPORT, ...identity, runsEach: 5, failedRuns, disturbedRuns: 0, scenarios: {} };
    Object.entries(runs).forEach(([id, results]) => {
        if (results.length === 0) {
            return;
        }
        noise.disturbedRuns += results.filter(result => result.disturbed).length;
        noise.scenarios[id] = Object.fromEntries(Object.keys(results[0].summary).map((name) => {
            const values = results.map(result => result.summary[name].median);
            const middle = median(values);
            const spread = Math.max(...values) - Math.min(...values);
            return [name, roundAll({ median: middle, min: Math.min(...values), max: Math.max(...values), spread, spreadPercent: middle ? (spread / Math.abs(middle)) * 100 : 0 })];
        }));
    });
    writeJson(path.join(out, 'noise.json'), noise);
    notePass('noise');
    log(`noise written to ${path.join(out, 'noise.json')}`);
};

/** The truth check: the same scenario without and with a busy loop of 4 ms in every frame. */
const runTruth = async (out, options) => {
    const [scenario] = findScenarios({ only: TRUTH_SCENARIO });
    const plain = await runScenario(options.profile, VIEWPORT, scenario, path.join(out, 'truth', `${scenario.id}.plain.json`), options);
    const busy = await runScenario(options.profile, VIEWPORT, scenario, path.join(out, 'truth', `${scenario.id}.busy.json`), { ...options, busyMs: 4 });
    if (plain.error || busy.error) {
        throw new Error(`the truth check could not be measured: ${plain.error ?? busy.error}`);
    }
    const middle = (result, name) => result.summary[name].median;
    const truth = roundAll({
        scenario: scenario.id,
        profile: options.profile,
        ...identity,
        addedMsPerFrame: 4,
        scriptMsPerFrame: { plain: middle(plain, 'perFrame.scriptMs'), withBusyLoop: middle(busy, 'perFrame.scriptMs'), rise: middle(busy, 'perFrame.scriptMs') - middle(plain, 'perFrame.scriptMs') },
        totalMsPerFrame: { plain: middle(plain, 'perFrame.totalMs'), withBusyLoop: middle(busy, 'perFrame.totalMs') },
        framesPerSecond: { plain: middle(plain, 'frames.perSecond'), withBusyLoop: middle(busy, 'frames.perSecond') },
        disturbed: plain.disturbed || busy.disturbed,
    });
    writeJson(path.join(out, 'truth.json'), truth);
    notePass('truth');
    log(`truth: script per frame ${truth.scriptMsPerFrame.plain} ms, with 4 ms added ${truth.scriptMsPerFrame.withBusyLoop} ms (rise ${truth.scriptMsPerFrame.rise} ms)`);
};

/** A few seconds of looking at what other programs are doing, before anything is launched. */
const outsideNow = async () => {
    const profile = resolveProfile('host');
    const sampler = startSampler({ pids: [], processors: null, selfMask: null });
    const held = { close: async () => { sampler.stop(); } };
    open.add(held);
    try {
        await sampler.ready;
        // The sampler's own first seconds are left out, then six seconds are read.
        await sleep(SAMPLER_SETTLE_MS + 6000);
    } finally {
        sampler.stop();
        open.delete(held);
    }
    return outsideLoad(sampler.samples.filter(sample => sample.t >= sampler.readyAt + SAMPLER_SETTLE_MS), profile);
};

/**
 * Why a baseline could not start right now: other programs are busy, or the window does not follow
 * the screen. An empty list when nothing stands in its way.
 */
const notReadyNow = async () => {
    const outside = await outsideNow();
    // One launch without limits, only to see what rate the empty window is paced at.
    const first = await openSession('host', VIEWPORT);
    await first.close();
    const gpuNow = outside.gpuPercent === undefined ? '' : ` and ${outside.gpuPercent.toFixed(0)}% of the graphics card's 3D engine`;
    log(`right now: other programs use ${(outside.ofAllProcessors * 100).toFixed(0)}% of all processors${gpuNow}; the empty window makes ${first.emptyFrameRate.toFixed(0)} frames a second, the screen refreshes ${first.profile.screenRefreshRate ?? '?'} times`);
    const reasons = [];
    if (outside.brokenLimits.length) {
        reasons.push(`other programs keep busy: ${outside.brokenLimits.join(', ')}`);
    }
    if (!followsScreen(first.profile, first.emptyFrameRate)) {
        reasons.push('the window does not follow the screen (the screen has gone off, or the window is paced by something else)');
    }
    return reasons;
};

/** Everything: laptop and old for all scenarios, host for the core set, the ten heaviest on the GPU again at the large viewport, noise and truth. */
const runBaseline = async (out, options) => {
    const startedAt = Date.now();
    const { all, core } = baselinePlan(options.windows);
    if (process.platform === 'darwin') {
        // macOS has one profile (darwin.mjs): everything under host, and the large-viewport pass
        // picks by main-thread time, the GPU share being a number Windows alone reads.
        const host = await runPass(out, 'host', VIEWPORT, all, { ...options, check: true });
        const heaviest = [...host].sort((left, right) => right.summary['perFrame.totalMs'].median - left.summary['perFrame.totalMs'].median).slice(0, 10).map(result => result.scenario);
        await runPass(out, 'host', LARGE_VIEWPORT, heaviest, options);
        await runNoise(out, { ...options, profile: 'host' });
        await runTruth(out, { ...options, profile: 'host' });
        log(`baseline measured in ${((Date.now() - startedAt) / 60000).toFixed(1)} min`);
        return;
    }
    const laptop = await runPass(out, 'laptop', VIEWPORT, all, { ...options, check: true });
    await runPass(out, 'old', VIEWPORT, all, { ...options, check: true });
    await runPass(out, 'host', VIEWPORT, core, { ...options, check: true });
    const heaviest = [...laptop]
        .sort((left, right) => right.summary['gpu.percentAt60'].median - left.summary['gpu.percentAt60'].median)
        .slice(0, 10)
        .map(result => result.scenario);
    await runPass(out, 'laptop', LARGE_VIEWPORT, heaviest, options);
    await runNoise(out, { ...options, profile: 'laptop' });
    await runTruth(out, { ...options, profile: 'laptop' });
    log(`baseline measured in ${((Date.now() - startedAt) / 60000).toFixed(1)} min`);
};

/**
 * A baseline that ran to its end takes its place. The one that was there before keeps its data
 * under another name; the two are never mixed in one folder.
 */
const placeBaseline = async (working, out) => {
    try {
        if (fs.existsSync(out)) {
            const aside = `${out}-replaced-${stamp()}`;
            await moveFolder(out, aside);
            log(`the earlier ${path.basename(out)} is now ${aside}`);
        }
        await moveFolder(working, out);
        return out;
    } catch (error) {
        log(`${working} could not be renamed to ${out} (${error.message}). The run is finished and its results are whole: rename the folder by hand.`);
        return working;
    }
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    const options = { windows: args.windows, profile: args.profile, check: Boolean(args.check), allowDisturbed: Boolean(args.allowDisturbed) };
    let label = args.label ?? `run-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;

    if (args.baseline || args.plan) {
        const plan = baselinePlan(options.windows);
        if (process.platform === 'darwin') {
            log(`baseline on macOS: all ${plan.all.length} scenarios under host (laptop and old are Windows' profiles), the ten heaviest again at the large viewport, noise and truth checks; every scenario in a launch of its own. The Windows figure of about ${plan.minutes} minutes is for two profiles and a core pass besides; a host-only run is shorter by roughly a pass and a half.`);
        } else {
            log(`baseline: ${plan.all.length} scenarios under laptop and old, ${plan.core.length} under host, 10 again at the large viewport, noise and truth checks; every scenario in a launch of its own`);
            log(`this takes about ${plan.minutes} minutes; longer when windows have to be repeated`);
        }
    }
    if (args.plan) {
        if (process.platform === 'darwin') {
            // The table is written for Windows' counters (report.mjs); the macOS results are the JSON.
            log('on macOS there is no 画面底数 table to write: run the baseline and read the JSON under claude-notes/perf/data/');
            return;
        }
        const table = path.join(notesDir(), '画面底数.md');
        if (fs.existsSync(path.join(notesDir(), 'data', 'baseline'))) {
            log(`a baseline exists already; ${table} left as it is`);
        } else {
            writeReport(path.join(notesDir(), 'data', 'baseline'), table);
            log(`no baseline yet: ${table} now says how to take one`);
        }
        return;
    }

    // One measuring run at a time on this PC, whichever tool and worktree: taken before the check of
    // what else is running, so that check reads a PC without another measuring run.
    await holdMeasuringLock(`dev/perf/run.mjs ${process.argv.slice(2).join(' ')}`);
    identity = gitState();
    log(`measuring commit ${identity.commit ?? '(unknown)'}${identity.dirty ? ', with changes that are not committed' : ''}`);
    const strays = stopStrayEngines();
    if (strays.length) {
        log(`stopped ${strays.length} engine${strays.length > 1 ? 's' : ''} an earlier run had left running (process ${strays.join(', ')})`);
    }
    // From here to the end of the run the screen is on: the window takes its frame rate from it.
    const awake = keepAwake();
    open.add(awake);
    if (await awake.ready) {
        // A screen that was off has been told to come on: a moment for the window to follow it again.
        await sleep(2000);
    } else {
        log('the helper that keeps the screen on did not start; the run goes on, and each launch says what rate its window is paced at');
    }

    if (args.baseline) {
        const notReady = await notReadyNow();
        if (notReady.length && !options.allowDisturbed) {
            console.error(`[perf] not starting: ${notReady.join('; ')}. Run it when the PC is idle and its screen is on, or add --allow-disturbed for a marked trial.`);
            process.exit(2);
        }
        // A baseline taken on a busy PC, or off the screen's rate, never lands where the real one goes.
        label = args.label ?? (notReady.length ? 'baseline-disturbed' : 'baseline');
    }

    const out = path.resolve(args.out ?? path.join(notesDir(), 'data', label));
    // A baseline is written beside its place and moved there only when all of it is done, so a
    // folder with the baseline's name is always a whole one.
    const working = args.baseline ? `${out}.partial` : out;
    if (args.baseline && fs.existsSync(working)) {
        const aside = `${working}-stopped-${stamp()}`;
        await moveFolder(working, aside);
        log(`an earlier baseline that did not finish is now ${aside}`);
    }
    buildPage({ skip: Boolean(args.noBuild) });
    beginRun(working);
    const server = await startServer();
    open.add(server);
    try {
        if (args.baseline) {
            await runBaseline(working, options);
            endRun({ finished: true });
            const placed = await placeBaseline(working, out);
            if (process.platform === 'darwin') {
                // report.mjs writes the Windows table (its GPU columns, the laptop/old passes); the
                // macOS numbers stay in the JSON, where no column can read n/a as 0.
                log(`results in ${placed} (no 画面底数 table on macOS: report.mjs is written for Windows' counters)`);
            } else {
                const table = path.join(notesDir(), label === 'baseline' ? '画面底数.md' : `画面底数-${label}.md`);
                writeReport(placed, table, label === 'baseline' ? {} : { heading: `这一轮的名字是 ${label}，不是底数（底数是不带 --label、电脑空着时跑的那一轮）` });
                log(`table written to ${table}`);
                log(`results in ${placed}`);
            }
        } else {
            if (args.noise) {
                await runNoise(working, options);
            } else if (args.truth) {
                await runTruth(working, options);
            } else {
                const viewport = args.viewport ? parseViewport(args.viewport) : VIEWPORT;
                await runPass(working, args.profile, viewport, findScenarios({ only: args.only, set: args.set }), options);
            }
            endRun({ finished: true });
            log(`results in ${out}`);
        }
        if (runRecord.scenariosFailed) {
            log(`${runRecord.scenariosFailed} scenario${runRecord.scenariosFailed > 1 ? 's' : ''} FAILED and ${runRecord.scenariosFailed > 1 ? 'have' : 'has'} no numbers`);
        }
    } finally {
        open.delete(server);
        await server.close();
    }
};

main().then(() => process.exit(0), (error) => {
    if (stopping) {
        return;
    }
    console.error('[perf]', error.message ?? error);
    endRun({ finished: false, error: String(error.message ?? error) });
    process.exit(1);
});
