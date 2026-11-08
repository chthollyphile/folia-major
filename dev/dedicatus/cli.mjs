#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModuleGraph } from '../mcp/ts-code-map/graph/modules.mjs';
import {
    BASELINE_FILE,
    ESLINT_SUPPRESSIONS_FILE,
    baselineGrowthWithTransfers,
    compareWithBaseline,
    migrateBaseline as migrateKeys,
    loadBaseline,
    migrateBaseline,
    migrateSuppressions,
    parseBaseline,
    saveBaseline,
} from './baseline.mjs';
import { checkBoundaries } from './checks/boundaries.mjs';
import { checkCycles } from './checks/cycles.mjs';
import { checkFoliumApi } from './checks/foliumApi.mjs';
import { checkForeignCredentials } from './checks/foreignCredentials.mjs';
import { checkModIntegration } from './checks/modIntegration.mjs';
import { checkStartupWeight } from './checks/startupWeight.mjs';
import { checkNotes } from './checks/notes.mjs';
import { CODE_PATTERN, DEFAULT_MODE, codeInfo } from './codes.mjs';
import { addedFiles, movedLines, parseDiff, renames, withUntracked, writtenLines } from './diff.mjs';
import { diffFrom, extractTree, hasRef, resolveBase, showAt, untrackedFiles } from './git.mjs';
import { levelOf, printGithub, printJson, printText } from './report.mjs';
// dev/dedicatus/cli.mjs
// Dedicatus 的命令行入口（npm run dedicatus）。默认跑模块图检查（分层边界、循环依赖）并和基线对账；
// 有比较基点时再查基线有没有变大（D001）和 `@note` 有没有被动（D506）；--lint / --all 跑 ESLint。
//
//   npm run dedicatus                        文本输出；本机有 origin/main 时自动拿它当比较基点
//   npm run dedicatus -- --base <ref>        指定比较基点（CI 传 PR 合并提交的第一个父提交）
//   npm run dedicatus -- --no-base           不和任何分支比
//   npm run dedicatus -- --json              JSON（Aeolian 用）
//   npm run dedicatus -- --github            GitHub 注解 + job summary（CI 用）
//   npm run dedicatus -- --prune             删掉基线里已经修好的条目（只删不加）
//   npm run dedicatus -- --migrate-renames   挪了文件以后，把基线和 ESLint 抑制里的旧路径换成新路径
//   npm run dedicatus -- --adopt-moved       拆文件以后，把新文件里搬过去的旧违规登记进基线和抑制（CI 核对只是搬家）
//   npm run dedicatus -- --lint              只跑 ESLint
//   npm run dedicatus -- --all               模块图检查 + ESLint
//   npm run dedicatus -- --show-known        连基线内的已知问题一起列
//
// 模式：report 照常输出但退出码恒为 0；enforce 有新的 error 就退出 1。默认见 codes.mjs，--mode 或环境变量 DEDICATUS_MODE 覆盖。

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AUTO_BASE = 'origin/main';

/** 当前生效的模式；参数解析之前出错时按环境变量和默认值算。 */
let activeMode = process.env.DEDICATUS_MODE ?? DEFAULT_MODE;

function parseArgs(argv) {
    const options = { format: 'text', base: undefined, prune: false, migrate: false, adopt: false, lint: false, all: false, showKnown: false, mode: null };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--json') options.format = 'json';
        else if (arg === '--github') options.format = 'github';
        else if (arg === '--base') {
            options.base = argv[++i];
            if (!options.base) throw new Error('--base 后面要跟一个 git ref');
        } else if (arg === '--no-base') options.base = null;
        else if (arg === '--prune') options.prune = true;
        else if (arg === '--migrate-renames') options.migrate = true;
        else if (arg === '--adopt-moved') options.adopt = true;
        else if (arg === '--lint') options.lint = true;
        else if (arg === '--all') options.all = true;
        else if (arg === '--show-known') options.showKnown = true;
        else if (arg === '--mode') options.mode = argv[++i];
        else if (arg === '') continue;
        else throw new Error(`不认识的参数：${arg}`);
    }
    // --all 不论和 --lint 谁先谁后都是两样都跑；只有 --lint 时才只跑 ESLint。
    options.runGraph = options.all || !options.lint;
    options.runLint = options.all || options.lint;
    return options;
}

/** 比较基点和这次的 diff（含还没 git add 的新文件）。没指定时本机有 origin/main 就用它。 */
function loadDiffContext(options) {
    const ref = options.base === undefined ? (hasRef(root, AUTO_BASE) ? AUTO_BASE : null) : options.base;
    if (!ref) return { base: null, files: [], written: null, moved: new Map(), renameMap: new Map(), newFiles: new Set(), touched: new Set() };
    const base = resolveBase(root, ref);
    const files = withUntracked(parseDiff(diffFrom(root, base)), untrackedFiles(root));
    const touched = new Set(files.flatMap(file => [file.oldPath, file.newPath]).filter(Boolean));
    return { base, files, written: writtenLines(files), moved: movedLines(files), renameMap: renames(files), newFiles: addedFiles(files), touched };
}

/** 模块图上的全部检查：分层边界、循环依赖、模组接入点、首屏重型包。结果都能进基线。dir 是这张图对应的代码目录。 */
const graphFindings = (graph, dir = root) => [
    ...checkBoundaries(graph), ...checkCycles(graph), ...checkModIntegration(graph), ...checkStartupWeight(dir, graph),
];

/** 比较基点上的模块图检查结果（key 已按这次的改名换成新路径），以及那时的基线。 */
const BASE_TREE_PATHS = ['src', 'electron', 'dev', 'test', 'shared', 'worker', 'api-ts', 'api'];
function baseGraphState(context) {
    const tree = extractTree(root, context.base, BASE_TREE_PATHS);
    try {
        const graph = buildModuleGraph(tree.dir);
        const keys = graphFindings(graph, tree.dir).map(finding => finding.key);
        return { findings: new Set(migrateKeys(keys, context.renameMap)), readOld: file => {
            const full = path.join(tree.dir, file);
            return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : showAt(root, context.base, file);
        }, cleanup: tree.cleanup };
    } catch (error) {
        tree.cleanup();
        throw error;
    }
}

/** 挪了文件以后，把基线和 ESLint 抑制里的旧路径换成新路径（不增不减）。 */
function migrateRenames(context) {
    if (!context.base) throw new Error('--migrate-renames 需要比较基点（--base <ref>，或本机有 origin/main）');
    if (context.renameMap.size === 0) {
        console.error('[Dedicatus] 和比较基点比没有改名的文件，不用迁移。');
        return;
    }
    saveBaseline(root, migrateBaseline(loadBaseline(root), context.renameMap));
    const suppressionsPath = path.join(root, ESLINT_SUPPRESSIONS_FILE);
    if (fs.existsSync(suppressionsPath)) {
        const raw = fs.readFileSync(suppressionsPath, 'utf8');
        const migrated = migrateSuppressions(JSON.parse(raw), context.renameMap);
        fs.writeFileSync(suppressionsPath, JSON.stringify(migrated, null, 2) + (raw.endsWith('\n') ? '\n' : ''));
    }
    console.error(`[Dedicatus] 已按 ${context.renameMap.size} 个改名迁移 ${BASELINE_FILE} 和 ${ESLINT_SUPPRESSIONS_FILE}。`);
}

/** 拆文件以后：把新文件里现有的违规登记进基线和 ESLint 抑制，再删掉别处记多了的。只是搬家，CI 会按挪过来的行核对。 */
async function adoptMoved(context) {
    if (!context.base) throw new Error('--adopt-moved 需要比较基点（--base <ref>，或本机有 origin/main）');
    const files = [...context.newFiles];
    if (files.length === 0) {
        console.error('[Dedicatus] 和比较基点比没有新建的文件，不用登记。');
        return;
    }
    const graph = buildModuleGraph(root);
    const current = graphFindings(graph);
    const present = new Set(current.map(finding => finding.key));
    const adopted = current.filter(finding => context.newFiles.has(finding.file)).map(finding => finding.key);
    saveBaseline(root, [...loadBaseline(root).filter(key => present.has(key)), ...adopted]);
    const { adoptSuppressions, scopedLintTargets } = await import('./eslint/run.mjs');
    const linted = adoptSuppressions(root, files, scopedLintTargets(context.files));
    console.error(`[Dedicatus] 已登记 ${adopted.length} 条基线、${linted} 个文件的 ESLint 抑制，并删掉了记多的条目。`);
}

/** 比较基点上没有某个记账文件时的提醒（warning，不阻断）。 */
const staleBaseWarning = (base, file) => ({
    code: 'D004',
    level: 'warning',
    file,
    message: `比较基点 ${base.slice(0, 9)} 上还没有 ${file}：基点可能太旧（本机先 git fetch 再跑，或者用 --base 指定），这次没查它有没有变大（D001）`,
    key: `D004:${file}:stale-base`,
});

/** 模块图检查：边界 + 环，和基线对账；有比较基点时再查基线增长与 @note。 */
function runGraphChecks(options, context) {
    const graph = buildModuleGraph(root);
    const findings = graphFindings(graph);
    const entries = loadBaseline(root);
    const comparison = compareWithBaseline(findings, entries);
    const baseState = context.base ? baseGraphState(context) : null;
    try {
        return finishGraphChecks(options, context, entries, comparison, baseState);
    } finally {
        baseState?.cleanup();
    }
}

function finishGraphChecks(options, context, entries, comparison, baseState) {
    // --prune 删掉所有已经修好的条目，包括目标分支上就已经过期的；报 D002 时才只追究这次的。
    const allStale = [...comparison.stale];
    const baseText = context.base ? showAt(root, context.base, BASELINE_FILE) : null;
    const baseEntries = baseText === null ? null : parseBaseline(baseText);
    if (baseState) {
        // 目标分支上就已经有的问题不算这次的（目标分支自己的 CI 会报）。
        comparison.fresh = comparison.fresh.filter(finding => !baseState.findings.has(finding.key));
        if (baseEntries) {
            const staleAtBase = new Set(migrateKeys(baseEntries, context.renameMap).filter(key => !baseState.findings.has(key)));
            comparison.stale = comparison.stale.filter(key => !staleAtBase.has(key));
        }
    }

    if (options.prune && allStale.length > 0) {
        const stale = new Set(allStale);
        entries = entries.filter(key => !stale.has(key));
        saveBaseline(root, entries);
        console.error(`[Dedicatus] 已从 ${BASELINE_FILE} 删掉 ${allStale.length} 条已经修好的条目。`);
        comparison.stale = [];
    }

    const fresh = [...comparison.fresh];
    for (const key of comparison.stale) {
        fresh.push({ code: 'D002', file: BASELINE_FILE, message: `已经修好、但还在基线里：${key}（跑 npm run dedicatus -- --prune；挪了文件的话跑 --migrate-renames）`, key: `D002:${key}` });
    }
    for (const key of comparison.unknown) {
        fresh.push({ code: 'D003', file: BASELINE_FILE, message: `基线条目的代码不存在或已废弃：${key}`, key: `D003:${key}` });
    }

    if (context.base) {
        // 基点上没有基线文件：基点太旧（本机的 origin/main 没 fetch），D001 没法查，要明说而不是悄悄跳过（2026-11-08 云端实测）
        if (baseEntries === null) fresh.push(staleBaseWarning(context.base, BASELINE_FILE));
        const { growth } = baselineGrowthWithTransfers(entries, baseEntries, context.renameMap, context.newFiles);
        for (const key of growth) {
            fresh.push({ code: 'D001', file: BASELINE_FILE, message: `基线新增了条目：${key}（基线只减不增，修掉违规而不是登记它）`, key: `D001:${key}` });
        }
        fresh.push(...checkNotes(context.files, baseState?.readOld ?? (file => showAt(root, context.base, file))));
        fresh.push(...checkForeignCredentials(context.files));
        const readBase = baseState?.readOld ?? (file => showAt(root, context.base, file));
        const readCurrent = file => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null);
        fresh.push(...checkFoliumApi(context.files, { readBase, readCurrent }));
    }

    return { fresh, known: comparison.known };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    activeMode = options.mode ?? activeMode;
    if (!['report', 'enforce'].includes(activeMode)) throw new Error(`模式只能是 report 或 enforce，收到 ${activeMode}`);

    const context = loadDiffContext(options);
    if (options.migrate) {
        migrateRenames(context);
        return;
    }
    if (options.adopt) {
        await adoptMoved(context);
        return;
    }

    const fresh = [];
    const known = [];
    if (options.runGraph) {
        const graph = runGraphChecks(options, context);
        fresh.push(...graph.fresh);
        known.push(...graph.known);
    }
    if (options.runLint) {
        const { runEslint } = await import('./eslint/run.mjs');
        const lint = await runEslint(root, context);
        fresh.push(...lint.fresh);
        known.push(...lint.known);
    }

    for (const finding of fresh) {
        if (!CODE_PATTERN.test(finding.code) || !codeInfo(finding.code)) {
            throw new Error(`检查产生了未登记的代码 ${finding.code}（${finding.file}）：先在 codes.mjs 登记`);
        }
    }

    const hasError = fresh.some(finding => levelOf(finding) === 'error');
    const exitCode = activeMode === 'enforce' && hasError ? 1 : 0;
    const result = { mode: activeMode, base: context.base, fresh, known, knownCount: known.length, exitCode };
    if (options.format === 'json') printJson(result);
    else if (options.format === 'github') printGithub(result);
    else printText(result, { showKnown: options.showKnown });
    process.exitCode = exitCode;
}

main().catch(error => {
    // 工具自己坏了（参数、配置、基线文件格式、找不到比较基点、ESLint 没跑完或没装）：D004，退出码 2，不能显示成“通过”
    // （2026-11-08 云端实测：被 OOM 杀掉的 lint 只留一条 D004，退出码却是 0，代理以为过了）。
    // 只有 GitHub Actions 上的 report 模式例外：模块图检查在必需的 “Run unit tests” 任务里，工具自己的故障不挡 PR，注解照样标红。
    const text = String(error?.message ?? error);
    console.error(`[Dedicatus] D004 配置或运行出错：${text}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=D004::${text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    process.exitCode = process.env.GITHUB_ACTIONS && activeMode === 'report' ? 0 : 2;
});
