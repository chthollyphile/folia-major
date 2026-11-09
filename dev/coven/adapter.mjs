import fs from 'node:fs';
import path from 'node:path';
import { defineAdapter, isRelativePath } from '../../packages/coven/src/index.mjs';
import { baselineGrowthWithTransfers, loadBaseline, parseBaseline, suppressionGrowth } from '../dedicatus/baseline.mjs';
import { ESLINT_RULE_CODES, codeInfo } from '../dedicatus/codes.mjs';
import { missingPackageNotes, setupWorktree } from './setupWorktree.mjs';
// dev/coven/adapter.mjs
// Coven 的 Folia 适配层（harness 在 packages/coven/，接口见那里的 README 和 src/adapter.mjs）。
// 工作从 Dedicatus 来：基线条目（边界、环……）和 ESLint 抑制；验证用 tsc、vitest、Dedicatus；
// 账本是基线和抑制文件，只减不增；角色提示里的项目规则指向 AGENTS.md 和 skills/。

const BASELINE_FILE = 'dev/dedicatus/baseline.json';
const SUPPRESSIONS_FILE = 'eslint-suppressions.json';
/** 只动空白和引号的风格规则（R0），可自动修复的 lint（R1）。其余 R2。 */
const STYLE_CODES = new Set(['D430', 'D431', 'D432']);
const AUTOFIX_CODES = new Set(['D405']);

// ---- 条目 ----

/** 基线 key 里涉及的路径：`D102:a->b` 是 a、b，`D301:a` 是 a。 */
export function pathsOfKey(key) {
    const colon = key.indexOf(':');
    return key.slice(colon + 1).split('->');
}

/** 抑制条目的 key：`lint:<规则>@<路径前缀>`。 */
export const lintKey = (rule, prefix) => `lint:${rule}@${prefix}`;

/**
 * 基线条目变成范围条目。codes 按前缀匹配（D1 匹配 D101–D190）；已废弃、不存在的代码跳过。
 * @param {string[]} entries
 * @param {{ codes?: string[] }} options
 */
export function baselineItems(entries, { codes = [] } = {}) {
    return entries
        .filter(key => {
            const code = key.split(':')[0];
            return codeInfo(code) && (codes.length === 0 || codes.some(prefix => code.startsWith(prefix)));
        })
        .map(key => ({ key, kind: 'baseline', code: key.split(':')[0], action: 'refactor', paths: pathsOfKey(key) }));
}

/**
 * eslint-suppressions.json 里的抑制变成范围条目，每个“规则 × 路径前缀”一项（一个目录几十个文件，逐个认领会刷屏）。
 * 风险按其中每个文件算（riskPaths）。同时给了 `src/` 和 `src/demo/` 这样套在一起的前缀时，只按外面那个出条目：
 * 两个条目会盖住同样的文件，分进两个任务就会改同一批文件。
 * @param {Record<string, Record<string, { count: number }>>} suppressions
 * @param {{ rules: string[], prefixes: string[] }} options
 */
export function lintItems(suppressions, { rules, prefixes }) {
    const items = [];
    const outer = [...new Set(prefixes)].filter((prefix, _index, all) => !all.some(other => other !== prefix && prefix.startsWith(other)));
    for (const rule of rules) {
        for (const prefix of outer) {
            const files = Object.keys(suppressions).filter(file => file.startsWith(prefix) && suppressions[file][rule]).sort();
            if (files.length === 0) continue;
            const count = files.reduce((sum, file) => sum + suppressions[file][rule].count, 0);
            items.push({
                key: lintKey(rule, prefix), kind: 'lint', code: ESLINT_RULE_CODES[rule] ?? 'D490', rule, action: 'refactor',
                paths: [prefix], riskPaths: files, files, count, note: `${files.length} 个文件，${count} 处`,
            });
        }
    }
    return items;
}

// ---- Compass 里来源选项的候选值 ----

/** 基线里有哪些代码，各几条（Compass 的 --codes 选项）。 */
export function baselineHints(entries) {
    const counts = new Map();
    for (const key of entries) {
        const code = key.split(':')[0];
        if (codeInfo(code)) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return { codes: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ value: code, label: codeInfo(code).name, count })) };
}

/** 抑制文件里有哪些规则、哪些目录（到第三层）有抑制，各多少处（Compass 的 --rules、--paths 选项）。 */
export function lintHints(suppressions, { maxPaths = 80 } = {}) {
    const rules = new Map();
    const dirs = new Map();
    for (const [file, byRule] of Object.entries(suppressions)) {
        const total = Object.values(byRule).reduce((sum, entry) => sum + (entry.count ?? 0), 0);
        for (const [rule, entry] of Object.entries(byRule)) rules.set(rule, (rules.get(rule) ?? 0) + (entry.count ?? 0));
        const parts = file.split('/').slice(0, -1);
        for (let depth = 1; depth <= Math.min(3, parts.length); depth++) {
            const dir = `${parts.slice(0, depth).join('/')}/`;
            dirs.set(dir, (dirs.get(dir) ?? 0) + total);
        }
    }
    return {
        rules: [...rules].sort((a, b) => b[1] - a[1]).map(([rule, count]) => ({ value: rule, label: ESLINT_RULE_CODES[rule] ?? 'D490', count })),
        // 计数是这个目录下所有规则的抑制合计（不随选的规则变）
        paths: [...dirs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxPaths).map(([dir, count]) => ({ value: dir, label: '各规则合计', count })),
    };
}

/** 条目本身的基础风险级。 */
export function baseRisk(item) {
    if (STYLE_CODES.has(item.code)) return 'R0';
    if (AUTOFIX_CODES.has(item.code)) return 'R1';
    return 'R2';
}

// ---- 账本：基线和抑制只减不增 ----

const parseJsonOr = (text, fallback) => (text === null ? fallback : JSON.parse(text));

const readSuppressions = root => JSON.parse(fs.readFileSync(path.join(root, SUPPRESSIONS_FILE), 'utf8'));

/**
 * 基线和抑制有没有增长（harness 的 D841）：不看契约写没写 dedicatus 项，每次都查。
 * 修掉两条、顺手登记一条新违规，或者把抑制从一个文件挪到另一个文件，总数照样变小，只比总数是挡不住的。
 * 挪文件时条目跟着改名走不算增长；拆文件时搬进新文件的基线条目按 Dedicatus 的规则抵扣。
 * 抑制这边比 CI 严：CI 能把搬进新文件的抑制按挪过来的行抵扣；这个关口只比账本文件、不看搬了哪些行，拆文件带走抑制的重构会被拦下，交给维护者。
 * @param {{ baseEntries: string[], headEntries: string[], baseSuppressions: object, headSuppressions: object, renameMap: Map<string, string>, newFiles: Set<string> }} input
 * @returns {string[]}
 */
export function growthProblems({ baseEntries, headEntries, baseSuppressions, headSuppressions, renameMap, newFiles }) {
    const { growth } = baselineGrowthWithTransfers(headEntries, baseEntries, renameMap, newFiles);
    return [
        ...growth.map(key => `基线多了 ${key}`),
        ...suppressionGrowth(headSuppressions, baseSuppressions, renameMap).map(entry => `${entry.file} 的 ${entry.rule} 抑制 ${entry.before} → ${entry.after}`),
    ];
}

const suppressionTotal = suppressions => Object.values(suppressions).reduce((sum, rules) => sum + Object.values(rules).reduce((inner, entry) => inner + (entry.count ?? 0), 0), 0);

/**
 * 重构有没有让基线变小（D806），以及契约里的条目是不是真的消掉了。
 * 基线条目：HEAD 的基线里没有它，Dedicatus 也查不出它（防止只删基线不修代码，D190 这种 warning 级的尤其要看）。
 * lint 条目（`lint:<规则>@<前缀>`）：前缀下这条规则的抑制计数要降到 0。
 * @param {{ items: string[], baseEntries: string[], headEntries: string[], baseSuppressions: object, headSuppressions: object, findingKeys: Set<string> }} input
 * @returns {{ ok: boolean, shrank: boolean, items: Record<string, { ok: boolean, detail: string }> }}
 */
export function baselineShrink({ items, baseEntries, headEntries, baseSuppressions, headSuppressions, findingKeys }) {
    const head = new Set(headEntries);
    const result = {};
    for (const item of items) {
        const lint = /^lint:(.+)@(.+)$/.exec(item);
        if (lint) {
            const [, rule, prefix] = lint;
            const count = suppressions => Object.entries(suppressions).filter(([file]) => file.startsWith(prefix)).reduce((sum, [, rules]) => sum + (rules[rule]?.count ?? 0), 0);
            const before = count(baseSuppressions);
            const after = count(headSuppressions);
            result[item] = { ok: after === 0 && before > 0, detail: `${rule} 在 ${prefix} 下的抑制 ${before} → ${after}` };
            continue;
        }
        const stillListed = head.has(item);
        const stillFound = findingKeys.has(item);
        result[item] = {
            ok: !stillListed && !stillFound,
            detail: stillFound ? 'Dedicatus 还能查出这条（只删了基线，没修代码？）' : stillListed ? '还在基线里（修好了的话跑 npm run dedicatus -- --prune）' : '已消掉',
        };
    }
    const baseCount = baseEntries.length + suppressionTotal(baseSuppressions);
    const headCount = headEntries.length + suppressionTotal(headSuppressions);
    const shrank = headCount < baseCount;
    return { ok: shrank && Object.values(result).every(entry => entry.ok), shrank, items: result };
}

const ledgersAt = (read, ref) => ({
    entries: parseBaseline(read(ref, BASELINE_FILE) ?? '{"entries":[]}'),
    suppressions: parseJsonOr(read(ref, SUPPRESSIONS_FILE), {}),
});

// ---- 确定性验收项 ----

const tail = (text, lines = 40) => text.split('\n').slice(-lines).join('\n');

/** Node 25 的 jsdom 没有 localStorage，本机跑单测要加这个参数。 */
function vitestEnv() {
    const major = Number(process.versions.node.split('.')[0]);
    const current = process.env.NODE_OPTIONS ?? '';
    return major >= 25 && !current.includes('--no-experimental-webstorage') ? { NODE_OPTIONS: `${current} --no-experimental-webstorage`.trim() } : {};
}

/**
 * 模块图检查加上改过的文件的 ESLint（有基点时 Dedicatus 只 lint 改过的文件，和 CI 的 lint job 查的一样）。
 * 不能只跑模块图：ESLint 有按路径生效的规则，挪文件会换规则。Op. 1 里 exploreFeedMemory 从 src/components/ 挪进 src/stores/，
 * 直接用 localStorage 从 D411（有抑制）变成 D508（没有抑制），只跑模块图的 verify 照样全绿，要到 CI 才暴露。
 */
function runDedicatus(ctx) {
    const args = ['dev/dedicatus/cli.mjs', '--json', '--base', ctx.mergeBase, '--all'];
    if (!fs.existsSync(path.join(ctx.worktree, 'dev/dedicatus/lint/node_modules'))) {
        // 在这次改动之前切出的集成分支上，worktree 里的 coven:setup 还是旧版（要 --lint 才装），所以直接给 lint:install
        return { ok: false, summary: 'worktree 里没装 ESLint 隔离环境：在那里跑 npm run lint:install', findings: null };
    }
    const run = ctx.run(process.execPath, args);
    let parsed;
    try {
        parsed = JSON.parse(run.output.slice(run.output.indexOf('{')));
    } catch {
        return { ok: false, summary: `Dedicatus 没有输出 JSON（退出码 ${run.status}）：${tail(run.output, 10)}`, findings: null };
    }
    const errors = parsed.fresh.filter(finding => finding.level === 'error');
    return {
        ok: errors.length === 0,
        summary: errors.length === 0 ? `没有新的 error（warning ${parsed.fresh.length} 条）` : `${errors.length} 条新的 error：${errors.slice(0, 10).map(finding => `${finding.code} ${finding.file}${finding.line ? `:${finding.line}` : ''}`).join('；')}`,
        findings: parsed,
    };
}

/** Dedicatus 一次 verify 只跑一遍，dedicatus 和 baseline 两项共用结果。 */
const dedicatusFor = ctx => ctx.memo('dedicatus', () => runDedicatus(ctx));

const checks = {
    typecheck: {
        deterministic: true,
        run(ctx) {
            const run = ctx.run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
            return { ok: run.ok, summary: run.ok ? `通过（${run.seconds} 秒）` : `失败：${tail(run.output, 20)}` };
        },
    },
    unit: {
        deterministic: true,
        validate(verify) {
            const targets = [].concat(verify.target ?? []);
            return targets.length === 0 || targets.some(target => !isRelativePath(target)) ? 'unit 要写 target（测试文件的相对路径）' : null;
        },
        run(ctx) {
            const run = ctx.run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '-c', 'vitest.config.ts', ...[].concat(ctx.criterion.verify.target)], vitestEnv());
            return { ok: run.ok, summary: run.ok ? `通过（${run.seconds} 秒）` : `失败：${tail(run.output, 30)}` };
        },
    },
    dedicatus: {
        deterministic: true,
        // 不用写 target：模块图和改过的文件的 ESLint 总是一起跑。旧契约里的 graph、all 照样认，跑的都是这一套
        validate: verify => (verify.target !== undefined && !['graph', 'all'].includes(verify.target) ? 'dedicatus 不用写 target（模块图和 ESLint 总是一起跑）' : null),
        run(ctx) {
            const result = dedicatusFor(ctx);
            return { ok: result.ok, summary: result.summary };
        },
    },
    baseline: {
        deterministic: true,
        // 用 Dedicatus 的结果判断条目是不是真的消掉了，放在 dedicatus 之后
        order: 10,
        run(ctx) {
            const result = dedicatusFor(ctx);
            const findingKeys = new Set([...(result.findings?.fresh ?? []), ...(result.findings?.known ?? [])].map(finding => finding.key));
            const base = ledgersAt(ctx.readAt, ctx.mergeBase);
            const head = ledgersAt(ctx.readAt, 'HEAD');
            const shrink = baselineShrink({
                items: ctx.contract.items, baseEntries: base.entries, headEntries: head.entries,
                baseSuppressions: base.suppressions, headSuppressions: head.suppressions, findingKeys,
            });
            const details = Object.entries(shrink.items).map(([item, entry]) => `${entry.ok ? '✓' : '✗'} ${item}：${entry.detail}`);
            return {
                ok: shrink.ok && result.findings !== null,
                summary: `${shrink.shrank ? '基线变小了' : 'D806 基线没有变小'}；${details.join('；')}`,
                ...(shrink.shrank ? {} : { code: 'D806' }),
            };
        },
    },
    review: { deterministic: false },
    component: { deterministic: false },
    preview: { deterministic: false, runsApp: true },
    desktop: { deterministic: false, runsApp: true },
};

// ---- 角色提示里的 Folia 部分 ----

const PLANNER_EXAMPLE = `{
  "tasks": [
    {
      "title": "lyric-match-sources",
      "items": ["D102:src/utils/lyrics/lyricMatchSources.ts->src/stores/useOnlineProviderAccountStore.ts"],
      "risk": "R2",
      "action": "refactor",
      "goal": "做什么、为什么（不写实现细节）",
      "nonGoals": ["不做的事"],
      "scope": { "paths": ["src/utils/lyrics/", "test/unit/lyrics/"] },
      "criteria": [
        { "id": "c1", "description": "条目从基线消掉，Dedicatus 查不出来", "verify": { "kind": "baseline" }, "passes": false },
        { "id": "c2", "description": "模块图和改过的文件的 ESLint 都没有新的 error", "verify": { "kind": "dedicatus" }, "passes": false },
        { "id": "c3", "description": "类型检查通过", "verify": { "kind": "typecheck" }, "passes": false },
        { "id": "c4", "description": "相关单测通过", "verify": { "kind": "unit", "target": ["test/unit/lyrics/lyricMatchSources.test.ts"] }, "passes": false },
        { "id": "c5", "description": "只是搬移和改引用，没有行为变化", "verify": { "kind": "review" }, "passes": false }
      ]
    }
  ],
  "order": ["lyric-match-sources"],
  "escalations": [
    { "items": ["D190:…"], "code": "D812", "question": "要维护者决定的问题", "options": ["选项一", "选项二"], "lean": "你倾向哪个、为什么" }
  ]
}`;

const prompts = {
    planner: () => ({
        itemsIntro: 'Dedicatus 基线的 key，或者 `lint:<规则>@<路径前缀>` 形式的 ESLint 抑制',
        reading: [
            '- `AGENTS.md`：目录、模块边界。',
            '- `skills/file-modularization/SKILL.md`：哪些文件不能挪、怎么挪。',
            '- `skills/development-workflow/SKILL.md`：严重度标准、什么算简单修复。',
            '- `dev/dedicatus/README.md`、`dev/dedicatus/rules.mjs`：每个代码的含义和规则。',
            '- `docs/CODEMAP.md`：模块图。',
            '',
            '对每一条，用 rg 查引用方，也查目标文件是不是被**按路径**找到的（`import.meta.glob`、测试的收集范围、检查脚本扫的目录）。',
            '要挪的文件，再查它在新位置要守哪些 ESLint 规则：有的规则按目录生效，`dev/dedicatus/eslint/` 和 `eslint-suppressions.json` 里看得到它现在被抑制了什么。',
        ].join('\n'),
        escalateWhen: '   - 修它要挪一个按路径被找到的文件（`import.meta.glob` 等）。这类文件不能挪，见 `file-modularization`。',
        scopeNote: '基线和抑制文件不用写：它们总是允许改，但只许变小。',
        criteria: [
            '   - 重构必须有一项 `{"kind":"baseline"}`：条目从基线消掉，Dedicatus 也查不出来。',
            '   - 一项 `{"kind":"dedicatus"}`：模块图和改过的文件的 ESLint 都没有新的 error（和 CI 查的一样）。',
            '   - 一项 `{"kind":"typecheck"}`。',
            '   - 相关单测 `{"kind":"unit","target":["test/unit/…"]}`，只写确实存在的测试文件。',
            '   - 一项 `{"kind":"review"}`：evaluator 读 diff，确认只是搬移和改引用，没有行为变化。',
            '   - R3 再加一项 `{"kind":"preview"}` 或 `{"kind":"desktop"}`，写清楚真跑应用时要看的场景。',
        ].join('\n'),
        extraRules: [
            '要挪文件的任务，在 `goal` 里写明“挪文件单独一个提交，只挪不改”。',
            '',
            '挪出或挪进某个目录时，按路径生效的 ESLint 规则会变，旧路径上的抑制带不过去。例如组件里直接读写 `localStorage` 报 D411，挪进 `src/stores/` 以后报 D508。这类条目在 `goal` 里写清在新位置怎么满足规则；要放宽规则或者有几种做法要选的，升级。',
        ].join('\n'),
        example: PLANNER_EXAMPLE,
    }),
    generator: () => ({
        setup: '先 cd 进你的 worktree 根目录，跑 `npm run coven:setup`（装依赖和 ESLint 隔离环境），不要链接主检出的 `node_modules`。有包装不上时不要自己想办法绕：`coven:setup` 已经按约定处理（比如云端装不上 KuGouMusicApi 时跳过它），verify 会记下来。',
        steps: [
            '- 按 `skills/development-workflow` 的第 1–3 步做：读相关代码 → 改 → 自检。只改 `scope.paths` 里的文件（基线和抑制文件除外）。',
            '- 挪文件：单独一个提交，只挪不改。`git mv` 之后改引用路径的另起一个提交，做法见 `skills/file-modularization`。挪完跑 `npm run dedicatus -- --migrate-renames`。',
            '- 修好一条违规后，跑 `npm run dedicatus -- --prune`（基线）或 `npm run lint:prune`（抑制）删掉对应的条目。',
            '- 自检：`npm run typecheck`、契约里列的单测、`npm run dedicatus -- --all`（模块图加改过的文件的 ESLint，verify 和 CI 都查这个）。',
            '- 提交信息写中文：类型和范围照 Conventional Commits，描述用中文。',
        ].join('\n'),
        commitExample: 'refactor(lyrics): 把歌词来源的登录判断交给调用方',
        forbidden: [
            '- 改 `dev/coven/`、`packages/coven/`、`dev/dedicatus/` 的规则、`AGENTS.md`、`skills/`。',
            '- 碰 `.dev-credentials/`。',
            '- 加 `eslint-disable`。',
        ].join('\n'),
        selfChecks: 'typecheck、单测、`dedicatus -- --all`',
    }),
    evaluator: () => ({
        reviewChecks: '   - review：diff 是不是只有搬移和改引用、没有行为变化；挪文件的提交是不是只挪不改；有没有出 `scope.paths`；有没有新加的 `eslint-disable`、基线条目或抑制条目。',
        severity: ' `skills/development-workflow` 的严重度标准',
        runApp: '必须真跑应用：浏览器预览（开发服务器 + `?skipStartup&mockSong`）或 skills/run-desktop，写清做了什么、看到了什么；没跑成就判不过。verify 结果里写了“没装某个包”的，涉及那个包的部分不算这次改动的问题。',
    }),
};

export default defineAdapter({
    id: 'folia',
    sources: {
        baseline: {
            describe: 'Dedicatus 基线（dev/dedicatus/baseline.json）里的条目：边界违规、循环依赖……',
            options: ['codes'],
            list: ({ root, options }) => baselineItems(loadBaseline(root), { codes: options.codes ?? [] }),
            hints: ({ root }) => baselineHints(loadBaseline(root)),
        },
        lint: {
            describe: 'eslint-suppressions.json 里某条规则在某个目录下的抑制，每个“规则 × 目录”一项',
            options: ['rules', 'paths'],
            list({ root, options }) {
                const rules = options.rules ?? [];
                const prefixes = options.paths ?? [];
                if (rules.length === 0 || prefixes.length === 0) throw new Error('lint 来源要配 --rules 和 --paths');
                return lintItems(readSuppressions(root), { rules, prefixes });
            },
            hints: ({ root }) => lintHints(readSuppressions(root)),
        },
    },
    itemKeyPattern: /(?:D\d{3}|lint):[^\s`·]+/,
    baseRisk,
    ledger: {
        files: [BASELINE_FILE, SUPPRESSIONS_FILE],
        growth({ readBase, readHead, renameMap, newFiles }) {
            const deleted = [BASELINE_FILE, SUPPRESSIONS_FILE].filter(file => readBase(file) !== null && readHead(file) === null);
            if (deleted.length > 0) return deleted.map(file => `删掉了 ${file}（账本只能变小，不能删）`);
            return growthProblems({
                baseEntries: parseBaseline(readBase(BASELINE_FILE) ?? '{"entries":[]}'),
                headEntries: parseBaseline(readHead(BASELINE_FILE) ?? '{"entries":[]}'),
                baseSuppressions: parseJsonOr(readBase(SUPPRESSIONS_FILE), {}),
                headSuppressions: parseJsonOr(readHead(SUPPRESSIONS_FILE), {}),
                renameMap, newFiles,
            });
        },
    },
    checks,
    requiredKinds: { refactor: ['baseline'] },
    worktree: {
        // verify 每次都跑 ESLint，隔离环境总要装
        setup: ({ worktree }) => setupWorktree(worktree, { lint: true }),
        inspect: worktree => missingPackageNotes(worktree),
    },
    prompts,
});
