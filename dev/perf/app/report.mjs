import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dev/perf/app/report.mjs
// Writes a folder of results of dev/perf/app/run.mjs as one table in plain Chinese.
//   node dev/perf/app/report.mjs <results folder> <table.md>

const PROFILES = ['host', 'laptop', 'old'];
const PROFILE_LABEL = { host: 'host（不限）', laptop: 'laptop（4 个小核）', old: 'old（2 个小核）' };
const BASELINE_COMMAND = 'node dev/perf/app/run.mjs --baseline';
/** What `run.mjs --baseline --plan` prints with its own settings (3 cold and 5 warm launches, 2 launches of 5 rounds, 2 memory series). */
const BASELINE_MINUTES = 117;

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
/** A number as the table prints it. (A time a hair under zero, in the frame the input arrived in, is printed as 0, not as "-0".) */
const shown = (value, digits = 0) => (typeof value === 'number' ? value.toFixed(digits).replace(/^-(0(?:\.0+)?)$/, '$1') : '—');

/**
 * "中位数（最小～最大）" of one number of a summary; "—" when it was never measured. `expected` is
 * the count the table gives for the row or the column: a cell that rests on fewer says on how many.
 */
const cell = (summary, name, digits = 0, expected = null) => {
    const entry = summary?.[name];
    if (!entry || entry.median === null || entry.runs === 0) {
        return '—';
    }
    const fewer = expected !== null && typeof entry.runs === 'number' && entry.runs < expected ? `〔${entry.runs} 次〕` : '';
    return `${entry.min === entry.max ? shown(entry.median, digits) : `${shown(entry.median, digits)}（${shown(entry.min, digits)}～${shown(entry.max, digits)}）`}${fewer}`;
};
const runsOf = (summary, name) => summary?.[name]?.runs ?? 0;

/**
 * What a result was meant to hold and does not: launches, start-ups or series that failed while
 * others of the same kind were measured, and single switches or steps that failed inside one.
 * Each entry is `{ what, planned, measured, errors }` (`planned` null for single steps). An empty
 * list: everything that was asked for is there. Used by the runner (what it files as measured only
 * in part) and by the table.
 */
export const shortfalls = (result) => {
    const lost = [];
    if (!result || result.error) {
        return lost;
    }
    Object.entries(result.kinds ?? {}).forEach(([kind, entry]) => {
        if (entry.errors?.length) {
            lost.push({ what: `${kind} start-ups`, planned: entry.runs.length + entry.errors.length, measured: entry.runs.length, errors: entry.errors });
        }
    });
    if (result.failedLaunches?.length) {
        lost.push({ what: 'launches', planned: (result.launches ?? 0) + result.failedLaunches.length, measured: result.launches ?? 0, errors: result.failedLaunches });
    }
    const failedSeries = (result.series ?? []).filter(entry => entry.error);
    if (failedSeries.length) {
        lost.push({ what: 'series', planned: result.series.length, measured: result.series.length - failedSeries.length, errors: failedSeries.map(entry => entry.error) });
    }
    const inside = [...(result.failures ?? []), ...(result.series ?? []).flatMap(entry => entry.failures ?? [])];
    if (inside.length) {
        lost.push({ what: 'single steps', planned: null, measured: null, errors: inside });
    }
    return lost;
};

const LOST_WHAT = { 'cold start-ups': '冷启动', 'warm start-ups': '热启动', launches: '整组的启动', series: '内存的整组' };
/** The same as one bold sentence for the table, or nothing. */
const lostText = (result) => {
    const lost = shortfalls(result);
    if (!lost.length) {
        return '';
    }
    const errorsOf = entry => entry.errors.slice(0, 3).map(text => String(text).replace(/\s+/g, ' ').slice(0, 160)).join('；');
    return `**${lost.map(entry => (entry.planned === null
        ? `有 ${entry.errors.length} 步没量成：${errorsOf(entry)}`
        : `${LOST_WHAT[entry.what] ?? entry.what}计划 ${entry.planned} 次，只量成 ${entry.measured} 次，没量成的：${errorsOf(entry)}`)).join('。')}。**`;
};

/**
 * Growth per round from a series' readings: the slope of the straight line through them, each
 * reading at its own round. With `lateOnly`, through the readings of the second half of the rounds.
 */
const slope = (readings, name, lateOnly = false) => {
    const from = lateOnly ? Math.ceil((readings.length - 1) / 2) : 0;
    const points = readings.map((entry, index) => [index, entry[name]]).filter(([index, value]) => index >= from && typeof value === 'number');
    if (points.length < 3) {
        return null;
    }
    const meanX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
    const under = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0);
    return under ? points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / under : null;
};
/** The same over several series: "median（lowest～highest）". */
const growthCell = (series, readingsName, name, digits, lateOnly = false) => {
    const values = series.map(entry => slope(entry[readingsName] ?? [], name, lateOnly)).filter(value => value !== null).sort((left, right) => left - right);
    if (values.length === 0) {
        return '—';
    }
    const middle = values.length % 2 ? values[values.length >> 1] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2;
    // A series with too few readings of this kind gave no slope: the cell says how many did.
    const fewer = values.length < series.length ? `〔${values.length} 次〕` : '';
    return `${values.length === 1 ? shown(middle, digits) : `${shown(middle, digits)}（${shown(values[0], digits)}～${shown(values[values.length - 1], digits)}）`}${fewer}`;
};

const table = (header, rows) => [
    `| ${header.join(' | ')} |`,
    `| ${header.map((_, index) => (index === 0 ? '---' : '---:')).join(' | ')} |`,
    ...rows.map(row => `| ${row.join(' | ')} |`),
].join('\n');

const DISTURBED = { processors: '处理器被别的程序占着', 'held processors': '限定的那几个核被别的程序占着', 'graphics card': '显卡被别的程序占着', 'frame rate': '窗口没跟着屏幕的刷新率', 'no counter lines': '采样器没有数据', 'processors not checked at the end': '结束时没能再查一遍进程限在哪几个核' };
const disturbedText = list => (list?.length ? list.map(name => DISTURBED[name] ?? name).join('、') : '没有');

const STARTUP_MILESTONES = [
    ['entryScript', '主进程开始跑脚本'],
    ['mainScriptEvaluated', 'main.cjs 从头跑到尾'],
    ['appReady', '主进程就绪（Electron 的 ready）'],
    ['windowCreated', '窗口建好'],
    ['navigationStart', '页面开始载入'],
    ['firstPaint', '窗口第一次有画面（启动画面的底色）'],
    ['firstScreen', '应用的第一屏挂上页面'],
    ['firstContentfulPaint', '第一次画出文字或图'],
    ['splashGone', '启动画面完全消失'],
    ['picturesIn', '首页的封面到齐'],
    ['homeUsable', '首页可用（封面到齐，主线程安静满 1 秒）'],
];

const STARTUP_WHERE = [
    ['electronToEntryScript', 'Electron 自己起来（进程创建到开始跑脚本）'],
    ['mainScript', '跑 main.cjs（含它 require 的全部模块）'],
    ['mainScriptToReady', 'main.cjs 跑完到 ready'],
    ['readyToWindow', 'ready 到建窗口（建窗口前等的那几步）'],
    ['windowToNavigation', '建窗口到页面开始载入'],
    ['navigationToFirstScreen', '页面开始载入到第一屏挂上'],
    ['firstScreenToUsable', '第一屏挂上到首页可用'],
    ['longTasksBeforeFirstScreen', '第一屏之前，主线程被占住的长任务合计'],
    ['longTasksAfterFirstScreen', '第一屏之后到可用，长任务合计'],
    ['longestTask', '最长的一个长任务'],
    ['modsListTook', '问主进程要模组列表（bootFolium 等的那一步）'],
    ['ipcTimeBeforeFirstScreen', '第一屏之前所有 IPC 在主进程里花的时间合计'],
    ['recorderMs', '其中量具自己：到首页可用为止，它在页面主线程上花的时间合计'],
];

const SONG_ROWS = [
    ['titleMs', '新歌名出现'],
    ['soundMs', '第一声（audio 元素真的在走）'],
    ['lyricMs', '新歌的第一个词出现（它排在歌的第 0.2 秒）'],
    ['lyricLateMs', '第一个词晚了多少（它出现的那一帧，歌自己的时钟走到了第几毫秒，减去 200）'],
    ['coverMs', '新封面出现'],
    ['sourceSetMs', '其中：新音源交给 audio 元素'],
    ['canPlayMs', '其中：audio 元素说可以播了'],
    ['playCalledMs', '其中：应用调用 play()'],
    ['sourceToPlayCalledMs', '音源给了以后，等了多久才调 play()'],
    ['playCalledToCanPlayMs', '调了 play() 以后，audio 元素又过多久才能播'],
    ['longestTaskMs', '期间最长的主线程任务'],
    ['frames.p95Ms', '期间帧间隔 p95'],
    ['frames.worstMs', '期间最长的一帧'],
    ['frames.overTwiceFrameTime', '超过两帧时间的帧数'],
    ['recorder.perFrameWaitingMs', '其中量具自己：还在等上面的东西出现时，它每帧看一遍页面花的主线程时间', 2],
    ['recorder.whileWaitingMs', '其中量具自己：这些帧合计', 1],
];

const SONG_KINDS = [
    ['nextOnPlayer', '在播放页按下一首 / 上一首（Ctrl+→ / Ctrl+←）'],
    ['playFromHome', '在首页的专辑页点播放（同时切到播放页）'],
    ['firstPlay', '启动后第一次点播放'],
    ['nextOnHome', '在首页的专辑页按下一首 / 上一首（应用会自己切到播放页）'],
];

const SWITCH_LABEL = {
    homeToPlayer: '首页 → 播放页',
    playerToHome: '播放页 → 首页',
    openSettings: '打开设置',
    closeSettings: '关掉设置',
    openSearch: '搜索（在搜索框按回车）',
    closeSearch: '关掉搜索页',
    homeToCollection: '首页 → 专辑页',
    collectionToHome: '专辑页 → 首页',
    homeToLattice: '首页 → 歌单墙',
    latticeToHome: '歌单墙 → 首页',
};

const POINT_LABEL = ['启动后空闲 30 秒（没有回收）', '在播放页放了 60 秒（没有回收）', '换了 20 次歌（刚回收过页面的 JS 堆）', '切了 20 轮页面（刚回收过页面的 JS 堆）', '回到首页，暂停，空闲 20 秒，再回收一次页面的 JS 堆之后'];

export const writeAppReport = (folder, file) => {
    const setup = readJson(path.join(folder, '_setup.json'));
    const run = readJson(path.join(folder, '_run.json'));
    const last = run?.runs?.[run.runs.length - 1] ?? null;
    const load = (profile, area) => readJson(path.join(folder, profile, `${area}.json`));
    const have = PROFILES.filter(profile => fs.existsSync(path.join(folder, profile)));
    const lines = [];
    const push = (...text) => lines.push(...text, '');

    const isTrial = last ? last.trial !== false : true;
    push(`# ${isTrial ? '应用试跑' : '应用底数'}：启动、换歌、切页面、内存`);
    if (isTrial) {
        push('**这是试跑的数，不是底数。** 量的时候这台电脑有人在用，别的程序也在跑。这些数只用来看量具能不能用、各项大概在什么量级，不能拿来判断一次改动是变快还是变慢。');
        push(`底数要等电脑空着的时候量，一条命令：\`${BASELINE_COMMAND}\`。它约跑 ${BASELINE_MINUTES} 分钟，开始前会先说要多久，电脑忙的时候不会开始。`);
    }
    /** Whether a result file was written by the folder's last run: told by the run it names, or (files of the first version of the tool) by its commit. */
    const fromLastRun = result => !result || !last || (result.run ? result.run === last.startedAt : result.commit === last.commit);
    /** Per profile, under a section: what failed altogether, what an earlier run left in the folder, and what is missing from a result. */
    const notesOf = (what, profile, result, { withError = true } = {}) => [
        withError && result?.error ? `**${profile} 的${what}没量成：${String(result.error).replace(/\s+/g, ' ').slice(0, 300)}**` : '',
        fromLastRun(result) ? '' : `**${profile} 的${what}不是最后这次运行量的：是提交 \`${String(result.commit ?? '?').slice(0, 8)}\`${result.run ? `、开始于 ${result.run} ` : ' '}的那次运行留下的。**`,
        lostText(result) && `${profile} 的${what}：${lostText(result)}`,
    ].filter(Boolean).join(' ');
    const pushNotes = (what, results, options) => have.map(profile => notesOf(what, profile, results[profile], options)).filter(Boolean).forEach(text => push(text));

    if (last) {
        const partial = (last.partial ?? []).map(entry => entry.name);
        push(`量的是提交 \`${(last.commit ?? '').slice(0, 8)}\`${last.dirty ? '（工作区还有没提交的改动）' : ''}，开始于 ${last.startedAt}，${last.finished ? '跑完了' : '**没有跑完**'}。命令：\`${last.commandLine}\`。${last.failed.length ? `**没量成的：${last.failed.join('、')}。**` : ''}${partial.length ? `**只量成一部分的：${partial.join('、')}（少了什么写在各节里）。**` : ''}${last.notPlaced ? `**结果文件夹没能改成正式的名字，还在 ${path.basename(folder)}。**` : ''}`);
        const earlier = have.flatMap(profile => ['startup', 'songs', 'pages', 'memory'].filter(area => !fromLastRun(load(profile, area))).map(area => `${profile}/${area}`));
        if (run.runs.length > 1 || earlier.length) {
            push(`这个文件夹被用过 ${run.runs.length} 次。更早的运行：${run.runs.slice(0, -1).map(entry => `提交 \`${(entry.commit ?? '').slice(0, 8)}\`，开始于 ${entry.startedAt}，量了 ${(entry.measured ?? []).join('、') || '（没有）'}`).join('；') || '（没有记下来）'}。${earlier.length ? `**下面这些不是最后这次运行量的，各节里标了出来：${earlier.join('、')}。「先看这几个数」里用到它们的也一样。**` : '下面的数都是最后这次运行量的。'}`);
        }
    }
    if (setup) {
        push(`电脑：${setup.machine.cpuName}，${setup.machine.logicalProcessors} 个逻辑处理器，${setup.machine.memoryGb} GB 内存，${setup.machine.videoCard}，屏幕 ${setup.machine.screen}。应用：Electron 加上 \`vite build\` 的正式构建（${setup.build.dist.files} 个文件，脚本共 ${(setup.build.dist.jsBytes / 1048576).toFixed(1)} MB）。窗口 1920×1080，缩放 1，放在屏幕外面，不出声。`);
        push(`曲库：${setup.library.songs} 首 96 秒的歌，分在 ${setup.library.albums} 张专辑里，每首带歌词、翻译和自己的封面；量内存时再加 ${setup.library.sketches} 首 2 秒的短曲（${setup.library.sketchAlbums} 张专辑）。全部是算出来的，没有真的音乐。`);
    }

    const startupOf = profile => readJson(path.join(folder, profile, 'startup.json'))?.kinds?.warm?.summary;
    const songsOf = profile => readJson(path.join(folder, profile, 'songs.json'))?.summary?.nextOnPlayer;
    const memoryOf = profile => readJson(path.join(folder, profile, 'memory.json'))?.summary;
    const each = (read, name, digits = 0) => have.map(profile => `${profile} ${shown(read(profile)?.[name]?.median, digits)}`).join('，');
    push('## 先看这几个数');
    push([
        `- 平常打开应用，到首页可用（毫秒）：${each(startupOf, 'milestones.homeUsable')}。其中到窗口建好：${each(startupOf, 'milestones.windowCreated')}。`,
        `- 在播放页按下一首，到第一声（毫秒）：${each(songsOf, 'soundMs')}；到新歌名出现：${each(songsOf, 'titleMs')}。`,
        `- 全部进程的私有内存（MB），启动后空闲时：${each(memoryOf, 'point1.processes.total.private')}；换 20 次歌、切 20 轮页面之后：${each(memoryOf, 'point4.processes.total.private')}；回到首页回收之后：${each(memoryOf, 'point5.processes.total.private')}。`,
    ].join('\n'));

    push('## 怎么读这张表');
    push([
        '- 三档是同一台电脑上的三种限制：`host` 不限；`laptop` 把应用的所有进程限制在 4 个小核上；`old` 限制在 2 个小核上。用来看在普通电脑上大概什么样。',
        '- 每格是「中位数（最小～最大）」。同一件事量了几次写在表头（切页面写在「次数」那一列）。两次改动之间的差别，比这个「最小～最大」的范围还小，就不算差别。',
        '- 一格后面带〔n 次〕的，是这一格只有 n 次量到了数，比表头或「次数」那一列写的少。',
        '- 时间的单位都是毫秒，内存是 MB。「—」是一次也没量到。',
        '- 应用被关在一个临时文件夹里跑，**连不上网**。走到联网那一步的地方，请求是立刻失败的，真联网会更慢。所以凡是标了「下限」的数，真实使用只会比它大。',
    ].join('\n'));

    // ---------------------------------------------------------------------------------------------
    push('## 1 启动');
    push('从 Windows 创建应用进程那一刻算起，到下面每件事发生，各是多少毫秒。「热」是平常再打开。「冷」是先清掉上一次启动留下的显卡缓存（编译好的着色器）和网络响应缓存再打开；**脚本在冷和热里都要重新编译**（页面是从 file:// 载入的，Chromium 不给它存编译好的脚本），所以冷和热只差在显卡缓存上，「冷」不等于应用更新之后第一次打开。曲库是那 24 首歌，停在首页的「文件夹」页。');
    const startup = Object.fromEntries(have.map(profile => [profile, load(profile, 'startup')]));
    const startupColumns = have.flatMap(profile => ['cold', 'warm'].filter(kind => startup[profile]?.kinds?.[kind]?.runs?.length).map(kind => ({ profile, kind, summary: startup[profile].kinds[kind].summary, runs: startup[profile].kinds[kind].runs.length })));
    if (startupColumns.length) {
        const header = ['到这件事发生（毫秒）', ...startupColumns.map(column => `${column.profile} ${column.kind === 'cold' ? '冷' : '热'}（${column.runs} 次）`)];
        push(table(header, STARTUP_MILESTONES.map(([name, label]) => [label, ...startupColumns.map(column => cell(column.summary, `milestones.${name}`, 0, column.runs))])));
        push('时间花在哪（每一行是一段的长度，毫秒）：');
        push(table(header.map((text, index) => (index === 0 ? '这一段' : text)), STARTUP_WHERE.map(([name, label]) => [label, ...startupColumns.map(column => cell(column.summary, `where.${name}`, ['modsListTook', 'ipcTimeBeforeFirstScreen', 'recorderMs'].includes(name) ? 1 : 0, column.runs))])));
        const sample = startupColumns.find(column => column.kind === 'warm') ?? startupColumns[0];
        const firstRun = startup[sample.profile].kinds[sample.kind].runs[0];
        push(`main.cjs 里最慢的几个 require（${sample.profile} ${sample.kind === 'cold' ? '冷' : '热'}，第 1 次）：${firstRun.detail.slowestRequires.slice(0, 6).map(entry => `\`${entry.request.replace(/^.*node_modules[\\/]/, '').replace(/\\/g, '/')}\` ${entry.ms} 毫秒`).join('，')}。`);
        push(`启动时页面载入了 ${firstRun.where.scriptsLoaded} 个脚本文件，共 ${(firstRun.where.scriptBytesLoaded / 1048576).toFixed(2)} MB；最大的几个：${firstRun.detail.scripts.slice(0, 6).map(script => `\`${script.name.replace('assets/', '')}\` ${(script.bytes / 1024).toFixed(0)} KB`).join('，')}。`);
        push(`注册了的 service worker：${firstRun.where.serviceWorkers} 个。首页上的图要到齐才算可用：算可用的那一刻窗口里有几张（括号里是各次启动的最少到最多），${startupColumns.map(column => `${column.profile} ${column.kind === 'cold' ? '冷' : '热'} ${cell(column.summary, 'where.picturesShown')}`).join('，')}；要等够 ${shown(firstRun.where.picturesWanted)} 张（备好档案时数出来的）。`);
        push(`启动时被拦下的联网请求（这一步在真联网时要花时间，所以「主进程就绪」之后和联网有关的事都是**下限**）：${Object.entries(firstRun.detail.refused).map(([host, count]) => `${host.replace(/^\w+ /, '')}（${count} 次）`).join('，') || '没有'}。`);
        push(`有没有受打扰：${have.map(profile => `${profile} ${disturbedText(startup[profile]?.disturbedBy)}`).join('；')}。`);
    } else {
        push('没有量成。');
    }
    pushNotes('启动', startup);

    // ---------------------------------------------------------------------------------------------
    push('## 2 换歌');
    push('从按键或点击那一刻算起（事件自己带的时间），到下面每件事第一次成立的那一帧。歌都是本地的 WAV，从本地歌换到本地歌。新歌名、第一个词、新封面的「出现」，是它在播放页上了、而且首页那一层已经淡到一半以下（或者已经不在）的那一帧：从首页的专辑页开始的那几种，播放页起初是被首页盖着的。');
    const songs = Object.fromEntries(have.map(profile => [profile, load(profile, 'songs')]));
    SONG_KINDS.forEach(([kind, label]) => {
        const columns = have.filter(profile => songs[profile]?.summary?.[kind]);
        if (!columns.length) {
            return;
        }
        push(`### ${label}`);
        const rows = SONG_ROWS.filter(([name]) => columns.some(profile => songs[profile].summary[kind][name]));
        push(table(['毫秒', ...columns.map(profile => `${profile}（${runsOf(songs[profile].summary[kind], 'soundMs')} 次）`)],
            rows.map(([name, text, digits = 0]) => [text, ...columns.map(profile => cell(songs[profile].summary[kind], name, digits, runsOf(songs[profile].summary[kind], 'soundMs')))])));
    });
    have.forEach((profile) => {
        const medians = songs[profile]?.launchMedians?.nextOnPlayer?.soundMs;
        if (medians && medians.length > 1) {
            push(`${profile} 档量了 ${medians.length} 次启动，每次启动自己的中位数（播放页按下一首到第一声）：${medians.map(value => shown(value)).join('、')} 毫秒。两次启动之间的差别比一次启动里面几次之间的大，比较改动前后要看这个。`);
        }
    });
    pushNotes('换歌', songs);
    if (have.some(profile => songs[profile]?.summary)) {
        push(`换歌这条路上没有联网的请求被拦（歌有本地歌词和封面，不去网上匹配）；如果一首歌没有歌词或封面，应用会去网上找，那时这些数是**下限**。有没有受打扰：${have.map(profile => `${profile} ${disturbedText(songs[profile]?.disturbedBy)}`).join('；')}。`);
    }

    // ---------------------------------------------------------------------------------------------
    push('## 3 切页面');
    push('从点击或按键那一刻算起。切的时候有一首歌在放。');
    push([
        '- 「第一帧」：打开一个页面（首页→播放页、打开设置、搜索、首页→专辑页、首页→歌单墙、播放页→首页）时，是新页面第一次出现的那一帧；退回下面的页面（关掉设置、关掉搜索页、专辑页→首页、歌单墙→首页）时，是盖在上面的那个页面开始动或开始变淡的那一帧。',
        '- 「内容到齐」：新页面要用的东西也到了（比如首页的封面都载入了）。不用等东西的切换是「—」。',
        '- 「停稳」：被盯着的那个页面（打开时是新页面，退回时是离开的那个页面）最后一次变位置、大小、透明度的时刻。每次至少录 2.5 秒；录到最后 200 毫秒它还在变的那一次没有这个数，这一格后面的〔n 次〕就是有数的次数。',
        '- 帧间隔算到最后一次看到它变为止。',
    ].join('\n'));
    const pages = Object.fromEntries(have.map(profile => [profile, load(profile, 'pages')]));
    have.forEach((profile) => {
        const result = pages[profile];
        if (!result) {
            return;
        }
        push(`### ${PROFILE_LABEL[profile]}`);
        if (result.error) {
            push(notesOf('切页面', profile, result));
            return;
        }
        // 内容到齐 only exists for the switches that wait for something: no count is expected of the others.
        push(table(['切换', '次数', '第一帧', '内容到齐', '停稳', '最长任务', '帧间隔 p95', '最长一帧', '超两帧时间的帧数'],
            result.switches.map(entry => [
                SWITCH_LABEL[entry.id] ?? entry.id,
                String(entry.runs.length),
                cell(entry.summary, 'firstFrameMs', 0, entry.runs.length),
                cell(entry.summary, 'contentMs', 0, entry.runs.some(one => one.contentMs !== null) ? entry.runs.length : null),
                cell(entry.summary, 'settledMs', 0, entry.runs.length),
                cell(entry.summary, 'longestTaskMs', 0, entry.runs.length),
                cell(entry.summary, 'frames.p95Ms', 1, entry.runs.length),
                cell(entry.summary, 'frames.worstMs', 0, entry.runs.length),
                cell(entry.summary, 'frames.overTwiceFrameTime', 0, entry.runs.length),
            ])));
        // One value for every launch the series was taken in.
        const launches = result.ofEachLaunch ?? [result];
        push(`空闲时窗口每秒 ${launches.map(launch => shown(launch.idleFrameRate)).join('、')} 帧（屏幕的一帧是 ${setup ? (1000 / setup.machine.screenRefreshRate).toFixed(1) : '?'} 毫秒，「超两帧时间」就是超过它的两倍）。切页面的时候应用占显卡 3D 引擎 ${launches.map(launch => shown(launch.gpuPercent, 1)).join('、')}%${launches.length > 1 ? `（${launches.length} 次启动各一个数）` : ''}。受打扰：${disturbedText(result.disturbedBy)}。`);
        const notes = notesOf('切页面', profile, result);
        if (notes) {
            push(notes);
        }
    });
    push('搜索会去问在线平台，这里连不上网，所以「搜索」那一行只有本地结果，是**下限**。「最长任务」写 0 的意思是没有超过 50 毫秒的任务（浏览器只报 50 毫秒以上的）。');

    // ---------------------------------------------------------------------------------------------
    push('## 4 内存');
    push('每一档是一次单独的启动（内存的读数受同一次启动里先前做过什么影响，所以不和别的测量混在一起）。曲库是 324 首。五个固定的点各读一次：');
    const memory = Object.fromEntries(have.map(profile => [profile, load(profile, 'memory')]));
    have.forEach((profile) => {
        const result = memory[profile];
        if (!result) {
            return;
        }
        const seriesCount = result.series.filter(entry => !entry.error).length;
        push(`### ${PROFILE_LABEL[profile]}（${seriesCount} 次）`);
        const notes = notesOf('内存', profile, result);
        if (notes) {
            push(notes);
        }
        if (result.error) {
            return;
        }
        const point = index => `point${index + 1}`;
        push(table(['在这个时候', '全部进程 私有内存', '全部进程 工作集', '页面进程 私有内存', '显卡进程 私有内存', '显存', 'JS 堆（在用）', 'DOM 节点', '事件监听器'],
            POINT_LABEL.map((label, index) => [
                label,
                cell(result.summary, `${point(index)}.processes.total.private`, 0, seriesCount),
                cell(result.summary, `${point(index)}.processes.total.workingSet`, 0, seriesCount),
                cell(result.summary, `${point(index)}.processes.renderer.private`, 0, seriesCount),
                cell(result.summary, `${point(index)}.processes.gpuProcess.private`, 0, seriesCount),
                cell(result.summary, `${point(index)}.processes.videoMemory`, 0, seriesCount),
                cell(result.summary, `${point(index)}.page.jsHeapUsed`, 1, seriesCount),
                cell(result.summary, `${point(index)}.page.domNodes`, 0, seriesCount),
                cell(result.summary, `${point(index)}.page.listeners`, 0, seriesCount),
            ])));
        push('强制回收只回收页面主线程的 JS 堆：worker、主进程、显卡进程的都不回收，进程的私有内存在回收之后也不会马上还给系统。所以上表里只有后三列（JS 堆、DOM 节点、事件监听器）在第 3、4、5 点是「还被拿着不放的」；私有内存、工作集和显存在每个点都还含着没还回去的。');
        push('每做一轮涨多少（把各轮的读数连成一条直线，取它的斜率）。每个读数前都回收过页面的 JS 堆，所以前三列涨的是页面还拿着不放的；后三列是进程的数，含着别的进程没回收的。「后半段」只用后一半轮次的读数：换歌是在一张专辑的 4 首歌里来回，头几轮在填缓存，全程的斜率会把填缓存算成涨；后半段还在涨的才是每多做一轮真的多占的。');
        push(table(['每一轮涨', '回收后的 JS 堆（MB）', 'DOM 节点（个）', '事件监听器（个）', '页面进程私有内存（MB）', '全部进程私有内存（MB）', '显存（MB）'],
            [['songReadings', '每换一次歌，全程', false], ['songReadings', '每换一次歌，后半段', true], ['pageReadings', '每切一轮页面（6 次切换），全程', false], ['pageReadings', '每切一轮页面，后半段', true]].map(([name, label, lateOnly]) => {
                const good = result.series.filter(entry => !entry.error);
                return [
                    label,
                    growthCell(good, name, 'jsHeapHeld', 3, lateOnly),
                    growthCell(good, name, 'domNodes', 1, lateOnly),
                    growthCell(good, name, 'listeners', 1, lateOnly),
                    growthCell(good, name, 'rendererPrivate', 2, lateOnly),
                    growthCell(good, name, 'totalPrivate', 2, lateOnly),
                    growthCell(good, name, 'videoMemory', 2, lateOnly),
                ];
            })));
        push(`进程内存每 5 轮读一次，所以后三列全程只有 5 个点、后半段只有 3 个点。受打扰：${disturbedText(result.disturbedBy)}。`);
    });

    // ---------------------------------------------------------------------------------------------
    const truth = readJson(path.join(folder, 'truth.json'));
    push('## 5 量具准不准');
    if (truth) {
        push(`做法：同样的换歌（${truth.profile} 档，播放页上按下一首，各 ${truth.runsEach} 次），一组照常，另一组在按键之后从页面外面把主线程占住 ${truth.heldMs} 毫秒。量出来的数应该涨这么多：`);
        push(table(['毫秒', '照常', `占住 ${truth.heldMs} 毫秒`, '涨了'], [
            ['第一声', shown(truth.nextOnPlayer.soundMs.plain), shown(truth.nextOnPlayer.soundMs.held), shown(truth.nextOnPlayer.soundMs.rise)],
            ['新歌名出现', shown(truth.nextOnPlayer.titleMs.plain), shown(truth.nextOnPlayer.titleMs.held), shown(truth.nextOnPlayer.titleMs.rise)],
            ['新歌的歌词出现', shown(truth.nextOnPlayer.lyricMs.plain), shown(truth.nextOnPlayer.lyricMs.held), shown(truth.nextOnPlayer.lyricMs.rise)],
            ['新音源交给 audio 元素', shown(truth.nextOnPlayer.sourceSetMs.plain), shown(truth.nextOnPlayer.sourceSetMs.held), shown(truth.nextOnPlayer.sourceSetMs.rise)],
            ['最长的主线程任务', shown(truth.nextOnPlayer.longestTaskMs.plain), shown(truth.nextOnPlayer.longestTaskMs.held), shown(truth.nextOnPlayer.longestTaskMs.rise)],
        ]));
        push(`受打扰：${disturbedText(truth.disturbedBy)}。${fromLastRun(truth) ? '' : `**这项校验不是最后这次运行做的：是提交 \`${String(truth.commit ?? '?').slice(0, 8)}\` 的那次运行留下的。**`}`);
    } else {
        push('这一轮没有做这项校验。');
    }
    // What the recorder itself costs (run.mjs --recorder): only when it was measured into this folder.
    const recorder = Object.fromEntries(have.map(profile => [profile, load(profile, 'recorder')]));
    const withRecorder = have.filter(profile => recorder[profile]?.summary);
    if (withRecorder.length) {
        push('量具自己的开销。同样的换歌（播放页上按下一首 / 上一首，同一次启动里轮流着来）：一半照常录，量具每帧看一遍页面；一半不逐帧看，只留一直开着的事件监听。audio 元素自己的事件和浏览器报的长任务不用看页面就有，两种都有，差的就是「逐帧看」加上去的。每格是「照常录 / 不逐帧看」的中位数（括号里是最小～最大）：');
        push(table(['毫秒', ...withRecorder.map(profile => `${profile}（各 ${runsOf(recorder[profile].summary.bare, 'playingEventMs')} 次）`)],
            [['sourceSetMs', '新音源交给 audio 元素'], ['playCalledMs', '应用调用 play()'], ['playingEventMs', 'audio 元素的 playing 事件'], ['longestTaskMs', '期间最长的主线程任务']]
                .map(([name, text]) => [text, ...withRecorder.map(profile => `${cell(recorder[profile].summary.withLooks, name)} / ${cell(recorder[profile].summary.bare, name)}`)])));
        push(`量具自己计的时（照常录的那一半）：还在等声音、歌名、歌词、封面出现的那些帧里，每帧看一遍花 ${withRecorder.map(profile => `${profile} ${cell(recorder[profile].summary.withLooks, 'recorder.perFrameWaitingMs', 2)}`).join('，')} 毫秒，一次换歌合计 ${withRecorder.map(profile => `${profile} ${cell(recorder[profile].summary.withLooks, 'recorder.whileWaitingMs', 1)}`).join('，')} 毫秒；这些都算在上面各表的时间里。受打扰：${withRecorder.map(profile => `${profile} ${disturbedText(recorder[profile].disturbedBy)}`).join('；')}。`);
        pushNotes('量具开销', recorder);
    }

    push('## 6 这些数没有包括什么');
    push([
        '- 声音真的从喇叭出来的那一刻。「第一声」是 audio 元素开始走的时刻，窗口是静音的，声卡那一段没有量。',
        '- 画面真的显示到屏幕上的那一刻。「第一帧」是页面做出这一帧的时刻，之后合成、上屏还有不到一帧的时间。',
        '- 联网。在线歌曲、在线歌词匹配、登录状态、更新检查都没有量。',
        '- 压缩格式的解码。测试歌是 WAV，不用解码；MP3、FLAC 会多一点。',
        '- 用户自己的设置。量的是新用户的默认设置：默认的歌词样式和背景，模组关着，没有登录任何平台。',
        '- 60 Hz 的屏幕。这台电脑的屏幕不是 60 Hz，帧间隔是按它自己的刷新率算的。',
    ].join('\n'));

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${lines.join('\n').trimEnd()}\n`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [folder, file] = process.argv.slice(2);
    if (!folder || !file) {
        console.error('usage: node dev/perf/app/report.mjs <results folder> <table.md>');
        process.exit(1);
    }
    writeAppReport(path.resolve(folder), path.resolve(file));
    console.log(`[perf] table written to ${path.resolve(file)}`);
}
