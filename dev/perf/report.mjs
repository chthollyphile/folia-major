import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './rig.mjs';
import { BASELINE_COMMAND, LARGE_VIEWPORT, NOISE_SCENARIOS, OUTSIDE_LOAD, SCENARIOS, SCREEN_RATE_SHARE, VIEWPORT, baselinePlan } from './scenarios.mjs';

// dev/perf/report.mjs
// Turns a folder of results from dev/perf/run.mjs into the table people read (in Chinese).
//
//   node dev/perf/report.mjs <results folder> <table.md> [--heading "<a line put at the very top>"]
//
// The folder holds one sub-folder per profile (laptop, old, host, and laptop-<large viewport>),
// one JSON per scenario in each, `_check.json` per profile, `noise.json` / `truth.json` when
// those checks were run, and `_run.json` (which runs wrote into the folder, and whether they
// finished). Whatever is missing is left out of the table; a folder with nothing in it gives a
// page that only says how to take the baseline. A folder without `_run.json`, or with a run in it
// that did not finish, is said so at the top of the table.
//
// The graphics-card classes come from claude-notes/perf/显卡换算.md (figures collected from search
// summaries and marked unverified there): this file only applies that table's lines.

const PROFILE_ORDER = ['laptop', 'old', 'host'];
const PROFILE_WORDS = {
    laptop: '所有进程只许用 4 个小核',
    old: '所有进程只许用 2 个小核',
    host: '不限制（只作参照）',
};
const LIMIT_WORDS = { processors: '处理器', 'held processors': '限定的核', 'graphics card': '显卡', 'frame rate': '窗口的帧率没跟着屏幕' };
/** A scenario that ran at less than this share of its profile's empty-page frame rate is marked: its per-frame numbers do not compare with full-rate rows. */
const FULL_RATE_SHARE = 0.95;

/** The lines of 显卡换算.md: the share of this RTX 4090 at 1920x1080 and 60 frames a second that each class of graphics can carry. */
const GRAPHICS_CLASSES = [
    [1, 'UHD 620 一档的老核显'],
    [2, 'UHD 770'],
    [4, 'Iris Xe'],
    [6, 'Radeon 680M'],
    [10, '核显吃力'],
    [Infinity, '要独立显卡'],
];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readIfThere = file => (fs.existsSync(file) ? readJson(file) : null);
const fixed = (value, digits = 2) => (typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—');
const middle = (result, name) => result?.summary?.[name]?.median;

const readProfile = (folder) => {
    if (!fs.existsSync(folder)) {
        return null;
    }
    const results = {};
    fs.readdirSync(folder).filter(name => name.endsWith('.json') && !name.startsWith('_')).forEach((name) => {
        const result = readJson(path.join(folder, name));
        results[result.scenario.id] = result;
    });
    return { check: readIfThere(path.join(folder, '_check.json')), results };
};

const graphicsClass = (percentAt60) => {
    if (typeof percentAt60 !== 'number') {
        return '—';
    }
    return GRAPHICS_CLASSES.find(([limit]) => percentAt60 <= limit)[1];
};

const disturbedWords = result => (result.disturbed ? `是（${result.disturbedBy.map(limit => LIMIT_WORDS[limit] ?? limit).join('、')}）` : '');

/** A scenario's frame rate as a share of its profile's empty-page frame rate; marked when it is short of full rate. */
const rateWords = (result, emptyRate) => {
    const rate = middle(result, 'frames.perSecond');
    if (typeof rate !== 'number' || !emptyRate) {
        return '—';
    }
    const share = rate / emptyRate;
    return share < FULL_RATE_SHARE ? `**${fixed(share * 100, 0)}%，不满**` : `${fixed(share * 100, 0)}%`;
};

const TABLE_HEAD = [
    '| 画面 | 每秒帧数 | 帧率是空页面的百分之几 | 每帧脚本毫秒 | 每帧样式与布局毫秒 | 每帧主线程合计毫秒 | 每秒主线程毫秒（实际帧率下量到的） | 60 Hz 屏幕上每秒主线程毫秒，至少（每帧 × 60；括号里是它占一秒的百分之几） | 帧间隔 p95（毫秒） | 长帧数（8 秒内） | 占用 RTX 4090 的百分比（实际帧率下量到的 / 每秒 60 帧时至少） | 按「至少」那个数，最低哪一档显卡带得动 | 显存 MB | 内存 MB（合计（页面进程 / 显卡进程）） | 受打扰 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
];
const TABLE_COLUMNS = TABLE_HEAD[1].split('|').length - 2;

const scenarioRow = (result, emptyRate) => {
    if (result.error) {
        return `| ${[result.scenario.label, `没量成：${String(result.error).slice(0, 80)}`, ...new Array(TABLE_COLUMNS - 2).fill('—')].join(' | ')} |`;
    }
    const value = name => middle(result, name);
    return `| ${[
        result.scenario.label,
        fixed(value('frames.perSecond'), 0),
        rateWords(result, emptyRate),
        fixed(value('perFrame.scriptMs')),
        fixed(value('perFrame.styleAndLayoutMs')),
        fixed(value('perFrame.totalMs')),
        fixed(value('perSecond.totalMs'), 0),
        `${fixed(value('perSecondAt60.totalMs'), 0)}（${fixed(value('perFrame.budgetPercent'), 0)}%）`,
        fixed(value('frames.p95Ms'), 1),
        fixed(value('longFrames.count'), 0),
        `${fixed(value('gpu.percent'), 1)}% / ${fixed(value('gpu.percentAt60'), 1)}%`,
        graphicsClass(value('gpu.percentAt60')),
        fixed(value('videoMemoryMb'), 0),
        `${fixed(value('workingSetMb.total'), 0)}（${fixed(value('workingSetMb.renderer'), 0)} / ${fixed(value('workingSetMb.gpuProcess'), 0)}）`,
        disturbedWords(result),
    ].join(' | ')} |`;
};

const NOISE_COLUMNS = [
    ['frames.perSecond', '每秒帧数', 1],
    ['perFrame.scriptMs', '每帧脚本毫秒', 3],
    ['perFrame.styleAndLayoutMs', '每帧样式与布局毫秒', 3],
    ['perFrame.totalMs', '每帧主线程合计毫秒', 3],
    ['perSecond.totalMs', '每秒主线程毫秒（实际帧率下量到的）', 1],
    ['perSecondAt60.totalMs', '60 Hz 屏幕上每秒主线程毫秒，至少', 1],
    ['frames.p95Ms', '帧间隔 p95', 2],
    ['longFrames.count', '长帧数', 0],
    ['gpu.percent', '占用 RTX 4090 的百分比（实际帧率下量到的）', 2],
    ['gpu.percentAt60', '占用 RTX 4090 的百分比（每秒 60 帧时至少）', 2],
    ['videoMemoryMb', '显存 MB', 0],
    ['workingSetMb.total', '内存 MB', 0],
];

/**
 * What `_run.json` and the result files say about where the numbers come from: lines for the very
 * top of the table. A folder nobody recorded a run for, a run that did not finish and results of
 * more than one commit are each said in bold.
 */
const provenanceLines = (dataDir, results) => {
    const lines = [];
    const runs = readIfThere(path.join(dataDir, '_run.json'))?.runs ?? null;
    if (!runs) {
        lines.push('> **这个文件夹里没有 `_run.json`：不知道这些结果是哪一次运行写的，也不知道那次跑完了没有。**');
    } else {
        const open = runs.filter(run => !run.finished);
        if (open.length) {
            const why = open.map(run => (run.stoppedBy ? `被 ${run.stoppedBy} 停下` : run.error ? `出错停下：${String(run.error).slice(0, 80)}` : '没有写下结束（被杀掉，或者还在跑）')).join('；');
            lines.push(`> **这个文件夹里有没跑完的运行（${why}）：这张表不全，不能当底数。**`);
        }
        const failed = runs.reduce((sum, run) => sum + (run.scenariosFailed ?? 0), 0);
        if (failed) {
            lines.push(`> **有 ${failed} 次没量成**（表里写着「没量成」的行，或噪声、校验里的某一次）。`);
        }
        lines.push(`> 写进这个文件夹的运行：${runs.map(run => `\`${run.commandLine}\`（${String(run.startedAt).slice(0, 16).replace('T', ' ')} UTC 开始，${run.finished ? '跑完' : '没跑完'}）`).join('；')}。`);
    }
    const offRate = results.filter(result => result.disturbedBy?.includes('frame rate'));
    if (offRate.length) {
        const rates = offRate.map(result => result.emptyFrameRate);
        lines.push(`> **${offRate.length === results.length ? '这些结果' : `其中 ${offRate.length} 个结果`}是在窗口没跟着屏幕刷新率的时候量的**（空窗口每秒 ${fixed(Math.min(...rates), 0)}${Math.min(...rates) === Math.max(...rates) ? '' : ` 到 ${fixed(Math.max(...rates), 0)}`} 帧，屏幕每秒刷新 ${offRate[0].screenRefreshRate} 次；屏幕关掉以后就是这样）。它们「每帧」的数不能和屏幕亮着时量的比。`);
    }
    const commits = [...new Set(results.map(result => (result.commit ? `${result.commit.slice(0, 8)}${result.dirty ? '（当时工作区还有没提交的改动）' : ''}` : '没有记下提交')))];
    if (commits.length) {
        lines.push(`> 量的是哪个提交：${commits.join('、')}。${commits.length > 1 ? '**表里混着不止一份代码的结果。**' : ''}`);
    }
    // An empty quoted line between two keeps each statement a paragraph of its own.
    return lines.flatMap((line, index) => (index ? ['>', line] : [line]));
};

const labelOf = id => SCENARIOS.find(scenario => scenario.id === id)?.label ?? id;

/** Writes the table for one folder of results. */
export const writeReport = (dataDir, outFile, { heading } = {}) => {
    const profiles = Object.fromEntries(PROFILE_ORDER.map(name => [name, readProfile(path.join(dataDir, name))]));
    const large = readProfile(path.join(dataDir, `laptop-${LARGE_VIEWPORT.width}x${LARGE_VIEWPORT.height}x${LARGE_VIEWPORT.deviceScale}`));
    const noise = readIfThere(path.join(dataDir, 'noise.json'));
    const truth = readIfThere(path.join(dataDir, 'truth.json'));
    const plan = baselinePlan();
    const measured = PROFILE_ORDER.filter(name => profiles[name] && Object.keys(profiles[name].results).length > 0);
    const anyCheck = PROFILE_ORDER.map(name => profiles[name]?.check).find(Boolean);
    const lines = [];
    const push = (...text) => lines.push(...text);

    // A heading marks a table that is no baseline (a trial run): it is said in the title and first of all.
    push(`# ${heading ? '试跑（不是底数）' : '画面底数'}：每个歌词样式和背景每一帧花多少`, '');
    if (heading) {
        push(`> **${heading}**`, '');
    }
    push('## 怎么跑出这张表', '');
    push(`电脑空着的时候（没有游戏、没有别的测试在跑），在 ${ROOT.replaceAll(path.sep, '/')} 这个文件夹里跑这一条命令：`, '', '```', BASELINE_COMMAND, '```', '');
    push(`它一次跑完全部 ${plan.all.length} 个画面和三档，大约 ${plan.minutes} 分钟（有窗口被打扰要重放时更久）。开始前它先说要多久；别的程序占着处理器或显卡时它不开始。屏幕关着的话它会把屏幕点亮，一直亮到跑完（窗口的帧率跟着屏幕走，屏幕关着量出来的数不一样）。跑的时候数据先写在 \`claude-notes/perf/data/baseline.partial/\`，全部跑完才改名成 \`baseline/\`（原来的 \`baseline/\` 改名成 \`baseline-replaced-<日期时间>/\`，不会混在一起），再把这张表写进 \`claude-notes/perf/画面底数.md\`。`, '');

    if (measured.length === 0) {
        push('## 底数还没有跑', '', '这里现在没有数字。跑完上面那条命令，这个文件会被整张表替换。', '');
        if (fs.existsSync(dataDir)) {
            // A folder that is there without one result in it: a run that was stopped at its start.
            push(...provenanceLines(dataDir, []), '');
        }
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, `${lines.join('\n')}\n`);
        return;
    }

    push(`数据在 \`${path.relative(path.dirname(outFile), dataDir).replaceAll(path.sep, '/')}/\`，写表的时间 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}（UTC）。`, '');
    push(...provenanceLines(dataDir, [...measured.flatMap(name => Object.values(profiles[name].results)), ...Object.values(large?.results ?? {})]), '');

    // The PC, the engine and the profiles.
    if (anyCheck) {
        const { profile } = anyCheck;
        push('## 这台电脑和量的方式', '');
        push(`- 电脑：${profile.cpuName}（${profile.logicalProcessors} 个逻辑处理器${profile.hasSlowCores ? `，其中小核是第 ${profile.slowProcessors[0]} 到 ${profile.slowProcessors[profile.slowProcessors.length - 1]} 个` : ''}），内存 ${profile.memoryGb} GB，显卡 ${profile.videoCard}，屏幕 ${profile.screen}。`);
        push(`- 引擎：项目自己的 Electron（${anyCheck.engine}），显卡驱动报的名字：${anyCheck.glRenderer}。`);
        push(`- 画面大小：${VIEWPORT.width}×${VIEWPORT.height}，缩放 ${VIEWPORT.deviceScale}。窗口放在屏幕外面，不抢焦点，静音。`);
        const offScreenRate = anyCheck.disturbedBy?.includes('frame rate');
        push(`- 实际帧率：空页面每秒 ${fixed(anyCheck.emptyPage.framesPerSecond, 0)} 帧（帧间隔 p95 ${fixed(anyCheck.emptyPage.p95Ms, 1)} 毫秒），${offScreenRate ? `**没有跟着这块屏幕的刷新率走（屏幕每秒刷新 ${profile.screenRefreshRate} 次；屏幕关掉以后就是这样）**` : '跟这块屏幕的刷新率走'}。没有找到不改渲染方式就让窗口每秒只出 60 帧的办法，所以表里先给「每一帧」的数，再给两个「每秒」的数。`);
        push('- 「每秒主线程毫秒（实际帧率下量到的）」是 DevTools 的原始数除以时间，没有假设。「60 Hz 屏幕上每秒，至少」是每帧的数 × 60：按时间而不是按帧做的活（每句歌词、每个字做一次的，定时器，自己有帧率的画布）在这里被比 60 更多的帧摊薄了，所以它只是下限。60 Hz 屏幕上真正要花的在这两个数之间。帧率不到 60 的行，这两个数大小反过来，真正的数仍在两者之间。显卡占用的两个数同理：实际帧率下量到的，和 × 60 ÷ 实际帧率（至少）。');
        push(`- 「帧率是空页面的百分之几」低于 ${FULL_RATE_SHARE * 100}% 的行标了「不满」：这个画面自己把帧率拉低了，同样的活摊到的帧数和满帧率的行不一样，它「每帧」的几列不能和满帧率的行比，要比就比「每秒主线程毫秒（实际帧率下量到的）」。空页面的帧率来自同一档的 \`_check.json\`；没有它的档这一列是「—」。`);
        push(`- 每个画面单独启动一次引擎、载入一次页面，放同一段歌（第 40 到 48 秒）三遍，表里是三遍的中位数。之后单独重跑一个画面，和它在这一轮里的条件一样。`);
        push(`- 「受打扰」：量的时候别的程序占了超过 ${OUTSIDE_LOAD.ofAllProcessors * 100}% 的全部处理器，或超过 ${OUTSIDE_LOAD.ofHeldProcessors * 100}% 的限定的核，或它们的显卡 3D 占用超过 ${OUTSIDE_LOAD.gpuPercent}%。被打扰的窗口会重放，最多多放 4 遍；还是躲不开的画面在最后一列标出来，它的数不能当底数用。另一种是「窗口的帧率没跟着屏幕」：空窗口每秒出的帧不到屏幕刷新率的 ${SCREEN_RATE_SHARE * 100}%（屏幕关掉以后，窗口改由定时器带着走，这台电脑上是每秒 128 帧），这样量出来的「每帧」的数和屏幕亮着时量的不是一回事。`);
        push('');
        push('## 三档', '');
        push('| 档 | 条件 | 单线程基准（毫秒）：7 次的中位数 / 最快一次 | 比 host 慢几倍（按中位数） | 检查时受打扰 |', '| --- | --- | --- | --- | --- |');
        const hostMedian = profiles.host?.check?.benchmark.medianMs;
        PROFILE_ORDER.forEach((name) => {
            const check = profiles[name]?.check;
            if (!check) {
                return;
            }
            const held = check.profile.heldProcessors ? `（第 ${check.profile.heldProcessors.join('、')} 个逻辑处理器）` : '';
            push(`| ${name} | ${PROFILE_WORDS[name]}${held} | ${fixed(check.benchmark.medianMs, 0)} / ${fixed(check.benchmark.bestMs, 0)} | ${hostMedian ? fixed(check.benchmark.medianMs / hostMedian, 2) : '没有 host 可比'} | ${check.disturbed ? `是（${check.disturbedBy.map(limit => LIMIT_WORDS[limit] ?? limit).join('、')}）` : ''} |`);
        });
        push('', '一档就是「只许用哪几个核」，别的什么都不加（以前 old 档还用 DevTools 把主线程降速 2 倍，现在不用了：那个降速自己占掉大半个核，又压不慢短任务）。一档有多慢，看「单线程基准」这一列：在一台真机器上打开这个页面跑同一段基准，时间和哪一档接近，那一档就相当于那台机器。', '');
        push('限核只能压处理器。显卡压不了，所以量的是它被占了百分之几（Windows 自己的「GPU Engine」计数器，3D 引擎），再按 `显卡换算.md` 那张表折成别的显卡。', '');
    }

    // Noise and the two checks.
    push('## 噪声和校验', '');
    if (noise) {
        const ids = NOISE_SCENARIOS.filter(id => noise.scenarios[id]);
        push(`同一个画面重新启动、重量 ${noise.runsEach} 次，下面是各次结果里最大的减最小的（括号里是它占中位数的百分之几）。${noise.profile} 档。${noise.failedRuns ? `**有 ${noise.failedRuns} 次没量成，没算在里面。**` : ''}${noise.disturbedRuns ? `**${noise.disturbedRuns} 次是在受打扰时量的，这组噪声偏大，不能当空闲时的噪声用。**` : ''}`, '');
        push(`| 列 | ${ids.map(id => `${labelOf(id)}：中位数 | 最大减最小`).join(' | ')} |`, `| --- | ${ids.map(() => '--- | ---').join(' | ')} |`);
        NOISE_COLUMNS.forEach(([name, words, digits]) => {
            push(`| ${words} | ${ids.map((id) => {
                const entry = noise.scenarios[id][name];
                return entry ? `${fixed(entry.median, digits)} | ${fixed(entry.spread, digits)}（${fixed(entry.spreadPercent, 0)}%）` : '— | —';
            }).join(' | ')} |`);
        });
        push('', '改动前后的差比这里的「最大减最小」还小，就不能说变快了。', '');
    } else {
        push('噪声还没有量（`node dev/perf/run.mjs --noise`）。', '');
    }
    if (truth) {
        push(`- 量得准不准：从页面外面给每一帧加 ${truth.addedMsPerFrame} 毫秒的空转，「每帧脚本毫秒」从 ${fixed(truth.scriptMsPerFrame.plain, 3)} 变成 ${fixed(truth.scriptMsPerFrame.withBusyLoop, 3)}，多了 ${fixed(truth.scriptMsPerFrame.rise, 3)} 毫秒（应该多 ${truth.addedMsPerFrame}）。帧率从每秒 ${fixed(truth.framesPerSecond.plain, 0)} 帧变成 ${fixed(truth.framesPerSecond.withBusyLoop, 0)} 帧。${truth.disturbed ? '量的时候受打扰。' : ''}`);
    }
    const heaviestGpu = measured.flatMap(name => Object.values(profiles[name].results)).filter(result => !result.error)
        .sort((left, right) => middle(right, 'gpu.percent') - middle(left, 'gpu.percent'))[0];
    if (anyCheck && heaviestGpu) {
        push(`- 显卡计数器是活的：空页面读到 ${fixed(anyCheck.emptyPage.gpuPercent, 2)}%，读数最高的画面（${heaviestGpu.scenario.label}，${heaviestGpu.profile} 档）读到 ${fixed(middle(heaviestGpu, 'gpu.percent'), 1)}%。`);
    }
    push('');

    // One table per profile, all in the laptop table's order: the costliest main thread first.
    const orderSource = profiles[measured[0]].results;
    const order = Object.values(orderSource)
        .sort((left, right) => (middle(right, 'perFrame.totalMs') ?? -1) - (middle(left, 'perFrame.totalMs') ?? -1))
        .map(result => result.scenario.id);
    measured.forEach((name) => {
        const { results, check } = profiles[name];
        const ids = [...order.filter(id => results[id]), ...Object.keys(results).filter(id => !order.includes(id))];
        const disturbedCount = ids.filter(id => results[id].disturbed).length;
        const emptyRate = check?.emptyPage.framesPerSecond;
        const shortCount = emptyRate ? ids.filter(id => middle(results[id], 'frames.perSecond') < emptyRate * FULL_RATE_SHARE).length : 0;
        push(`## ${name} 档：${PROFILE_WORDS[name]}`, '');
        push(`${ids.length} 个画面，按 ${measured[0]} 档的「每帧主线程合计毫秒」从大到小排。${disturbedCount ? `**其中 ${disturbedCount} 个受打扰。**` : '没有受打扰的。'}${emptyRate ? `这一档空页面每秒 ${fixed(emptyRate, 0)} 帧；${shortCount ? `**${shortCount} 个画面帧率不满，它们「每帧」的几列不能和满帧率的行比。**` : '没有帧率不满的。'}` : '这一档没有空页面的帧率（跑的时候没带 --check），哪些行帧率不满标不出来。'}`, '');
        push(...TABLE_HEAD);
        ids.forEach(id => push(scenarioRow(results[id], emptyRate)));
        push('');
    });

    if (large && profiles.laptop) {
        const basePixels = VIEWPORT.width * VIEWPORT.height * VIEWPORT.deviceScale ** 2;
        const largePixels = LARGE_VIEWPORT.width * LARGE_VIEWPORT.height * LARGE_VIEWPORT.deviceScale ** 2;
        push('## 显卡占用随像素数怎么涨（laptop 档，显卡占用最高的十个画面）', '');
        push(`小的是 ${VIEWPORT.width}×${VIEWPORT.height} 缩放 ${VIEWPORT.deviceScale}（${fixed(basePixels / 1e6, 1)} 百万像素），大的是 ${LARGE_VIEWPORT.width}×${LARGE_VIEWPORT.height} 缩放 ${LARGE_VIEWPORT.deviceScale}（${fixed(largePixels / 1e6, 1)} 百万像素，${fixed(largePixels / basePixels, 1)} 倍）。占用都是按每秒 60 帧折算的（至少）；大画面帧率掉得多的行，折算掉的也多，倍数只能当下限看。`, '');
        push('| 画面 | 小画面占用（至少） | 大画面占用（至少） | 涨了几倍 | 大画面每秒帧数 | 大画面显存 MB | 受打扰 |', '| --- | --- | --- | --- | --- | --- | --- |');
        Object.values(large.results).filter(result => !result.error)
            .sort((left, right) => middle(right, 'gpu.percentAt60') - middle(left, 'gpu.percentAt60'))
            .forEach((result) => {
                const small = profiles.laptop.results[result.scenario.id];
                const smallShare = middle(small, 'gpu.percentAt60');
                const largeShare = middle(result, 'gpu.percentAt60');
                push(`| ${result.scenario.label} | ${fixed(smallShare, 1)}% | ${fixed(largeShare, 1)}% | ${smallShare ? fixed(largeShare / smallShare, 1) : '—'} | ${fixed(middle(result, 'frames.perSecond'), 0)} | ${fixed(middle(result, 'videoMemoryMb'), 0)} | ${disturbedWords(result) || (small?.disturbed ? '小画面那次受打扰' : '')} |`);
            });
        push('');
    }

    // Where the long frames went.
    const withLongFrames = measured.flatMap(name => Object.values(profiles[name].results))
        .filter(result => !result.error && result.longFrameScripts?.length);
    if (withLongFrames.length) {
        push('## 长帧里最费时间的脚本', '', '只列出现过长帧（一帧超过 50 毫秒）的画面。时间是三遍加起来的毫秒；函数名来自没压缩的构建。', '');
        push('| 画面 | 档 | 函数 @ 文件 | 次数 | 脚本毫秒 | 其中被迫做样式和布局的毫秒 |', '| --- | --- | --- | --- | --- | --- |');
        withLongFrames.forEach((result) => {
            result.longFrameScripts.slice(0, 3).forEach((script) => {
                push(`| ${result.scenario.label} | ${result.profile} | \`${script.name}\` | ${script.count} | ${fixed(script.durationMs, 0)} | ${fixed(script.forcedStyleAndLayoutMs, 0)} |`);
            });
        });
        push('');
    }

    push('## 这张表没量到的', '');
    push('- 显卡自己画一帧用多久。量到的是它被占了百分之几，占用很低时这个读数不准。');
    push('- 真实的 60 Hz 屏幕。这里每秒出的帧比 60 多，所以一句歌词开始时只做一次的活，摊到每一帧上比 60 Hz 时少；表里给的是 60 Hz 时的下限和实际帧率下量到的数，真正的数在两者之间。');
    push('- 应用里样式外面那一圈：底部控制条和进度条、标题栏、主页、面板、提示、整个 App 组件跟着每句歌词重画。清单在 `dev/perf/README.md`。');
    push('- 网络字体（量的时候不许连外网，中文衬线字体用的是系统里的替代字体）。');
    push('');

    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, `${lines.join('\n')}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [dataDir, outFile, ...rest] = process.argv.slice(2);
    if (!dataDir || !outFile) {
        console.error('[perf] usage: node dev/perf/report.mjs <results folder> <table.md> [--heading "<text>"]');
        process.exit(1);
    }
    const headingAt = rest.indexOf('--heading');
    writeReport(path.resolve(dataDir), path.resolve(outFile), { heading: headingAt >= 0 ? rest[headingAt + 1] : undefined });
    console.log(`[perf] table written to ${path.resolve(outFile)}`);
}
