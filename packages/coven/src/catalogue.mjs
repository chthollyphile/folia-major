// packages/coven/src/catalogue.mjs
// Coven 的代号按古典乐谱编目：一次真跑是一个作品号 Op. n，干跑是 WoO n（没有作品号的作品，没正式发表），
// 运行里的任务是 No. k，planner 起的名字做标题；范围用音乐体裁起名；风险级在给人看的地方配速度术语。
// 显示名给人读（`Op. 3 No. 2 "lyric-match-sources"`），机器名进分支、文件名和 id（`op3-no2`），两者在这里互转。
// 号只增不回收：放弃的运行、释放的任务，号都不再用。真跑占号时除了集成分支还推一个永久的标签 coven-op<n>，
// 分支合完删掉以后，别的维护者在别的检出里取号也看得到这个号用过。

export const BRANCH_PREFIX = 'coven/';
export const TAG_PREFIX = 'coven-';

const RUN_ID = /^(op|woo)([1-9]\d{0,4})$/;
const TASK_ID = /^((?:op|woo)[1-9]\d{0,4})-no([1-9]\d{0,3})$/;
/** planner 起的标题、范围名里体裁后面的标题：小写字母、数字和连字符。 */
export const TITLE = /^[a-z0-9][a-z0-9-]{0,47}$/;

/** 一次运行的机器名：真跑 op<n>，干跑 woo<n>。 */
export const runIdOf = ({ dryRun, number }) => `${dryRun ? 'woo' : 'op'}${number}`;

/** @returns {{ kind: 'op'|'woo', number: number } | null} */
export function parseRunId(run) {
    const match = RUN_ID.exec(String(run ?? ''));
    return match ? { kind: /** @type {'op'|'woo'} */ (match[1]), number: Number(match[2]) } : null;
}

export const isRunId = run => parseRunId(run) !== null;

/** 任务的机器名：<运行>-no<k>。 */
export const taskIdOf = (run, number) => `${run}-no${number}`;

/** @returns {{ run: string, number: number } | null} */
export function parseTaskId(task) {
    const match = TASK_ID.exec(String(task ?? ''));
    return match ? { run: match[1], number: Number(match[2]) } : null;
}

export const isTaskId = task => parseTaskId(task) !== null;

/** `op3` → `Op. 3`，`woo2` → `WoO 2`；认不出的原样返回。 */
export function runLabel(run) {
    const parsed = parseRunId(run);
    if (!parsed) return String(run);
    return parsed.kind === 'op' ? `Op. ${parsed.number}` : `WoO ${parsed.number}`;
}

/**
 * `op3-no2` → `Op. 3 No. 2`，带标题时 `Op. 3 No. 2 "lyric-match-sources"`；认不出的原样返回。
 * @param {string} task
 * @param {string|null} [title]
 */
export function taskLabel(task, title = null) {
    const parsed = parseTaskId(task);
    if (!parsed) return String(task);
    return `${runLabel(parsed.run)} No. ${parsed.number}${title ? ` "${title}"` : ''}`;
}

/** 认领评论、PR 正文里的代号：有任务写任务，没有写运行。 */
export const catalogueLabel = ({ run, task }) => (task ? taskLabel(task) : run ? runLabel(run) : '');

export const integrationBranchOf = run => `${BRANCH_PREFIX}${run}`;
/** 占号的标签：不要删，删了这个号就可能被再用一次。 */
export const catalogueTagOf = run => `${TAG_PREFIX}${run}`;
export const taskBranchOf = task => `${BRANCH_PREFIX}${task}`;
export const isIntegrationBranch = branch => typeof branch === 'string' && branch.startsWith(BRANCH_PREFIX) && isRunId(branch.slice(BRANCH_PREFIX.length));
export const isTaskBranch = branch => typeof branch === 'string' && branch.startsWith(BRANCH_PREFIX) && isTaskId(branch.slice(BRANCH_PREFIX.length));

/**
 * 下一个作品号：已经用过的名字（远端和本地的分支、占号标签、.coven/runs/ 下的运行记录）里同一类的最大号加 1。
 * 名字可以是 `refs/heads/coven/op3`、`refs/tags/coven-op3`、`op3`、`op3.json`、`op3-no2` 这样的，只看开头的运行名。
 * @param {string[]} usedNames
 * @param {boolean} dryRun 干跑数 WoO，真跑数 Op.
 */
export function nextRunNumber(usedNames, dryRun) {
    const kind = dryRun ? 'woo' : 'op';
    let top = 0;
    for (const name of usedNames) {
        const bare = String(name).replace(/^refs\/(?:heads|tags)\//, '').replace(/^coven[/-]/, '');
        const match = /^(op|woo)([1-9]\d{0,4})(?![0-9])/.exec(bare);
        if (match && match[1] === kind) top = Math.max(top, Number(match[2]));
    }
    return top + 1;
}

/** 这次运行里下一个 No.：已登记任务的最大号加 1（释放、blocked 的任务也占着号）。 */
export function nextTaskNumber(run, taskIds) {
    let top = 0;
    for (const id of taskIds) {
        const parsed = parseTaskId(id);
        if (parsed?.run === run) top = Math.max(top, parsed.number);
    }
    return top + 1;
}

/**
 * 范围名用的音乐体裁，按这次清理的性质挑。范围名是 `<体裁>` 或 `<体裁>-<标题>`，例如 `fugue-boundaries`。
 * 以后有新的清理性质，往这里加一个体裁。
 */
export const GENRES = {
    fugue: { label: 'Fugue', use: '理清几个模块之间的依赖：边界违规、循环依赖（基线条目）' },
    etude: { label: 'Étude', use: '机械、重复的格式清理（lint 抑制之类）' },
    variations: { label: 'Variations', use: '同一种改法用在许多处' },
    interlude: { label: 'Interlude', use: '两次大运行之间的零星小修' },
    prelude: { label: 'Prelude', use: '给后面的运行铺路：先挪文件、拆模块' },
    suite: { label: 'Suite', use: '一个功能目录里几类问题打包清理' },
    rondo: { label: 'Rondo', use: '反复出现的老问题再清一遍' },
    sonata: { label: 'Sonata', use: '一个模块较大的结构整理' },
};

/** @returns {{ genre: string, title: string|null } | null} */
export function parseScopeName(name) {
    const match = /^([a-z]+)(?:-(.+))?$/.exec(String(name ?? ''));
    if (!match || !GENRES[match[1]]) return null;
    if (match[2] !== undefined && !TITLE.test(match[2])) return null;
    return { genre: match[1], title: match[2] ?? null };
}

/** `fugue-boundaries` → `Fugue "boundaries"`；认不出的（旧的范围名）原样返回。 */
export function scopeLabel(name) {
    const parsed = parseScopeName(name);
    if (!parsed) return String(name);
    return `${GENRES[parsed.genre].label}${parsed.title ? ` "${parsed.title}"` : ''}`;
}

/** 范围名的格式要求，给报错用。 */
export const scopeNameHelp = () => `范围名写成 <体裁> 或 <体裁>-<标题>（标题用小写字母、数字和连字符），体裁可选：\n${Object.entries(GENRES).map(([key, genre]) => `  ${key.padEnd(10)} ${genre.label}：${genre.use}`).join('\n')}`;

/** 风险级配的速度术语：越危险越慢。只用在给人看的最终注解上（PR 正文、契约展示、运行总结），检查和代码仍然用 R0–R4。 */
export const TEMPOS = { R0: 'Presto', R1: 'Allegro', R2: 'Andante', R3: 'Adagio', R4: 'Grave' };

/** `R2` → `Andante（R2）`。 */
export const tempoLabel = risk => (TEMPOS[risk] ? `${TEMPOS[risk]}（${risk}）` : String(risk));

/** PR 标题末尾带上代号：`refactor(stores): …` → `refactor(stores): … [Op. 3 No. 2]`。已经带了就不重复加。 */
export function titleWithCatalogue(title, task) {
    const tag = `[${taskLabel(task)}]`;
    const trimmed = String(title).trim();
    return trimmed.endsWith(tag) ? trimmed : `${trimmed} ${tag}`;
}
