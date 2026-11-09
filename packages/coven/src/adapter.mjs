import { ACTIONS, isRelativePath } from './contract.mjs';
// packages/coven/src/adapter.mjs
// 适配层接口：harness 和具体项目之间唯一的接缝。项目的东西（工作从哪来、怎么验证、哪些验收种类、角色提示里的项目规则、
// 怎么准备 worktree）都由适配层给；harness 负责认领、契约和关口、阶段、开 PR 和合并、运行记录和审计。
// 宿主仓库在配置里写 "adapter": "<模块路径>"，模块默认导出一个用 defineAdapter 包着的对象。字段见下面的 typedef 和 README。

/**
 * 范围里的一个条目（由适配层的来源给出，harness 再补上 risk 和 reasons）。
 * @typedef {{ key: string, kind: string, action: string, paths: string[], code?: string, riskPaths?: string[], note?: string, [extra: string]: unknown }} CovenItem
 *
 * 一项确定性验收跑完的结果。
 * @typedef {{ ok: boolean, summary: string, code?: string, data?: unknown }} CheckResult
 *
 * 跑一项确定性验收时拿到的东西。
 * @typedef {{
 *   root: string, worktree: string, base: string, mergeBase: string, head: string,
 *   contract: any, criterion: any, changed: Array<{ status: string, path: string, oldPath?: string }>,
 *   run: (command: string, args: string[], env?: Record<string, string>) => { ok: boolean, status: number|null, seconds: number, output: string },
 *   readAt: (ref: string, file: string) => string|null,
 *   memo: <T>(key: string, compute: () => T) => T,
 * }} CheckContext
 *
 * @typedef {{
 *   id: string,
 *   sources: Record<string, { describe: string, options?: string[], list: (ctx: { root: string, options: Record<string, string[]> }) => CovenItem[],
 *     hints?: (ctx: { root: string }) => Record<string, Array<{ value: string, label?: string, count?: number }>> }>,
 *   itemKeyPattern?: RegExp,
 *   baseRisk: (item: CovenItem) => string,
 *   ledger?: { files: string[], growth: (ctx: { readBase: (file: string) => string|null, readHead: (file: string) => string|null, renameMap: Map<string, string>, newFiles: Set<string> }) => string[] },
 *   checks: Record<string, { deterministic: boolean, order?: number, runsApp?: boolean, validate?: (verify: any) => string|null, run?: (ctx: CheckContext) => CheckResult }>,
 *   requiredKinds?: Record<string, string[]>,
 *   worktree?: { flags?: string[], setup?: (ctx: { root: string, worktree: string, flags: Record<string, boolean> }) => void, inspect?: (worktree: string) => string[] },
 *   prompts: { planner: (ctx: any) => Record<string, string>, generator: (ctx: any) => Record<string, string>, evaluator: (ctx: any) => Record<string, string> },
 * }} CovenAdapter
 */

/**
 * 角色模板（roles/*.md）里 {{project.*}} 要的字段。example（planner 的输出例子）和 runApp（怎么真跑应用）可选。
 * 适配层加载时就用桩数据调一次 prompts 核对，不要等到运行中途 coven prompt 才报缺字段。
 */
export const PROMPT_FIELDS = {
    planner: ['itemsIntro', 'reading', 'escalateWhen', 'scopeNote', 'criteria', 'extraRules'],
    generator: ['setup', 'steps', 'commitExample', 'forbidden', 'selfChecks'],
    evaluator: ['reviewChecks', 'severity'],
};

/** coven scope 自己用的选项，来源的选项不能和它们重名。 */
export const RESERVED_SCOPE_OPTIONS = ['name', 'from', 'show', 'help'];

/**
 * 写适配层时包一层，编辑器能按接口补全；运行时原样返回。
 * @param {CovenAdapter} adapter
 * @returns {CovenAdapter}
 */
export const defineAdapter = adapter => adapter;

const isFunction = value => typeof value === 'function';

/** 按验收种类找检查。只认适配层自己写的键：`constructor`、`toString` 这类原型上的名字不算。 */
export const checkOf = (checks, kind) => (typeof kind === 'string' && Object.hasOwn(checks ?? {}, kind) ? checks[kind] : undefined);

function promptProblems(adapter, config) {
    const problems = [];
    const stubContract = { task: 'op1-no1', title: 'stub', items: ['stub'], risk: 'R2', action: 'refactor', goal: '', nonGoals: [], scope: { paths: [] }, criteria: [] };
    const stubState = { run: 'op1', scope: 'fugue', items: {}, tasks: {} };
    for (const [role, fields] of Object.entries(PROMPT_FIELDS)) {
        if (!isFunction(adapter.prompts?.[role])) {
            problems.push(`prompts.${role} 要是函数（返回拼进角色模板的项目片段）`);
            continue;
        }
        let fragment;
        try {
            fragment = adapter.prompts[role]({ state: stubState, scope: { items: [] }, config, contract: stubContract });
        } catch (error) {
            problems.push(`prompts.${role} 用桩数据调用时出错：${error?.message ?? error}`);
            continue;
        }
        const missing = fields.filter(field => typeof fragment?.[field] !== 'string');
        if (missing.length > 0) problems.push(`prompts.${role} 返回的片段缺字段（要是字符串）：${missing.join('、')}`);
    }
    return problems;
}

/**
 * 检查适配层的形状，补上可选字段的默认值。不合格直接报错，列出全部问题。
 * config 是宿主的配置：用桩数据调 prompts 核对字段时传给它，和真正调用时一样。
 * @param {any} adapter
 * @param {{ config?: any }} [options]
 * @returns {CovenAdapter & { ledger: { files: string[], growth: Function }, requiredKinds: Record<string, string[]>, worktree: { flags: string[], setup?: Function, inspect?: Function } }}
 */
export function validateAdapter(adapter, { config = {} } = {}) {
    const problems = [];
    if (!adapter || typeof adapter !== 'object') throw new Error('适配层模块要默认导出一个对象（defineAdapter({...})）');
    if (typeof adapter.id !== 'string' || !adapter.id) problems.push('id 要是非空字符串');
    const sources = Object.entries(adapter.sources ?? {});
    if (sources.length === 0) problems.push('sources 至少要有一种来源');
    for (const [name, source] of sources) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`来源名 ${name} 要用小写字母、数字和连字符`);
        if (!isFunction(source?.list)) problems.push(`sources.${name}.list 要是函数`);
        if (source?.hints !== undefined && !isFunction(source.hints)) problems.push(`sources.${name}.hints 要是函数（给 Compass 列选项的候选值）`);
        if (typeof source?.describe !== 'string') problems.push(`sources.${name}.describe 要写一句说明`);
        for (const option of source?.options ?? []) {
            if (RESERVED_SCOPE_OPTIONS.includes(option)) problems.push(`sources.${name} 的选项 ${option} 和 coven scope 自己的选项重名`);
        }
    }
    if (adapter.itemKeyPattern !== undefined) {
        if (!(adapter.itemKeyPattern instanceof RegExp)) problems.push('itemKeyPattern 要是正则');
        // g、y 标志会让 exec 记住上次的位置，同一条正则反复用时结果时对时错
        else if (/[gy]/.test(adapter.itemKeyPattern.flags)) problems.push('itemKeyPattern 不能带 g 或 y 标志');
    }
    if (!isFunction(adapter.baseRisk)) problems.push('baseRisk 要是函数');
    if (adapter.ledger !== undefined) {
        if (!Array.isArray(adapter.ledger.files)) problems.push('ledger.files 要是数组');
        else for (const file of adapter.ledger.files) if (!isRelativePath(file) || file.endsWith('/')) problems.push(`ledger.files 里的 ${file} 要是仓库内的相对文件路径（不能是目录）`);
        if (!isFunction(adapter.ledger.growth)) problems.push('ledger.growth 要是函数');
    }
    const checks = Object.entries(adapter.checks ?? {});
    if (checks.length === 0) problems.push('checks 至少要有一种验收');
    for (const [kind, check] of checks) {
        if (typeof check?.deterministic !== 'boolean') problems.push(`checks.${kind}.deterministic 要写 true 或 false`);
        if (check?.deterministic && !isFunction(check.run)) problems.push(`checks.${kind} 是确定性的，要有 run`);
        if (check?.validate !== undefined && !isFunction(check.validate)) problems.push(`checks.${kind}.validate 要是函数`);
    }
    for (const [action, kinds] of Object.entries(adapter.requiredKinds ?? {})) {
        if (!ACTIONS.includes(action)) problems.push(`requiredKinds 的 ${action} 不是认识的动作（${ACTIONS.join('、')}）`);
        if (!Array.isArray(kinds)) {
            problems.push(`requiredKinds.${action} 要是验收种类的数组`);
            continue;
        }
        for (const kind of kinds) if (!checkOf(adapter.checks, kind)) problems.push(`requiredKinds.${action} 里的 ${kind} 不在 checks 里`);
    }
    for (const hook of ['setup', 'inspect']) {
        if (adapter.worktree?.[hook] !== undefined && !isFunction(adapter.worktree[hook])) problems.push(`worktree.${hook} 要是函数`);
    }
    const flags = adapter.worktree?.flags ?? [];
    if (!Array.isArray(flags) || flags.some(flag => !/^[a-z][a-z0-9-]*$/.test(flag) || flag === 'worktree' || flag === 'help')) problems.push('worktree.flags 要是小写的选项名列表，不能用 worktree、help');
    problems.push(...promptProblems(adapter, config));
    if (problems.length > 0) throw new Error(`适配层 ${adapter.id ?? '?'} 不合格：\n${problems.map(problem => `- ${problem}`).join('\n')}`);
    return {
        ...adapter,
        ledger: adapter.ledger ?? { files: [], growth: () => [] },
        requiredKinds: adapter.requiredKinds ?? {},
        worktree: { ...adapter.worktree, flags },
    };
}

/** 确定性的验收种类（verify 自己跑出结果的）。 */
export const deterministicKinds = adapter => Object.keys(adapter.checks).filter(kind => checkOf(adapter.checks, kind)?.deterministic);
