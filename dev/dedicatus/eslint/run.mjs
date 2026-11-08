import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ESLINT_SUPPRESSIONS_FILE, suppressionGrowthWithTransfers } from '../baseline.mjs';
import { ESLINT_RULE_CODES } from '../codes.mjs';
import { showAt } from '../git.mjs';
// dev/dedicatus/eslint/run.mjs
// 调用隔离环境（dev/dedicatus/lint）里的 ESLint，把结果换成 Dedicatus 的代码。
// 现有违规由 ESLint 的批量抑制（eslint-suppressions.json，按“文件 × 规则”计数）挡掉。计数一超，ESLint 会把这个文件里
// 这条规则的所有旧违规一起报出来；selectNewFindings 把它收窄到这次新写的行，收不窄的合成一条，不刷屏。
// 有比较基点时只检查这次改过的文件（scopedLintTargets）：结果本来就只对碰过的文件下结论，全仓跑一遍要 7 GB 内存、
// 两分钟，有的机器会 OOM；只跑改过的文件 2～3 GB、二十秒以内，每个文件的结果和全仓跑一样（2026-11-08 实测）。

const RUNTIME = 'dev/dedicatus/lint';

/** 要检查的目录和文件。显式列出而不是扫 `.`：主检出里 .claude/worktrees 下还嵌着别的工作树。 */
export const LINT_TARGETS = [
    'src', 'test', 'dev', 'electron', 'shared', 'api', 'api-ts', 'worker', 'packaging', 'build', 'deploy', 'public',
    'skills', 'sync-server', '.github/scripts', '*.ts', '*.js', '*.mjs',
];
const LINTABLE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
/** 一次交给 ESLint 的文件太多时改成全仓跑：Windows 的命令行最长 32767 个字符。 */
const MAX_SCOPED_CHARS = 20000;

/** 这个文件（仓库相对路径，正斜杠）是不是全仓跑时会检查的代码文件。 */
export function isLintTarget(file) {
    if (!LINTABLE.test(file)) return false;
    return LINT_TARGETS.some(target => (target.startsWith('*.')
        ? !file.includes('/') && file.endsWith(target.slice(1))
        : file.startsWith(`${target}/`)));
}

/**
 * 有比较基点时要检查的文件：这次改过、现在还在的代码文件。没有就是空数组（不用跑 ESLint）；
 * 太多（命令行装不下）时返回 LINT_TARGETS。
 * @param {{ newPath: string | null }[]} files parseDiff 的结果
 */
export function scopedLintTargets(files) {
    const targets = [...new Set(files.map(file => file.newPath).filter(file => file && isLintTarget(file)))].sort();
    return targets.join(' ').length > MAX_SCOPED_CHARS ? LINT_TARGETS : targets;
}

/** 风格类代码：文件本来就是旧风格（已有这条规则的抑制）时不追究新行，等以后整文件格式化。 */
const STYLE_CODES = new Set(['D430', 'D431', 'D432']);

export function eslintBin(root) {
    const bin = path.join(root, RUNTIME, 'node_modules', 'eslint', 'bin', 'eslint.js');
    if (!fs.existsSync(bin)) throw new Error('lint 环境还没装：先跑 npm run lint:install');
    return bin;
}

/** 以仓库根目录为工作目录跑 ESLint。类型感知的检查吃内存，给足堆。 */
export function spawnEslint(root, args, { capture = false } = {}) {
    return spawnSync(process.execPath, ['--max-old-space-size=8192', eslintBin(root), ...args], {
        cwd: root,
        encoding: 'utf8',
        stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        maxBuffer: 512 * 1024 * 1024,
    });
}

/** 消息里的代码（项目约定规则把它写在消息里；no-restricted-* 会在前面加自己的话，所以不一定在开头）。 */
const CODE_IN_MESSAGE = /(?:^|\s)(D\d{3})[：:]\s*/;

/** 一条 ESLint 消息的代码：消息里带代码的按消息，其余按规则 id 查表，查不到的是 D490。 */
export function codeForMessage(message) {
    if (!message.ruleId) return message.fatal ? 'D004' : 'D420';
    if (/^Definition for rule .* was not found/.test(message.message)) return 'D420';
    const inMessage = CODE_IN_MESSAGE.exec(message.message);
    if (inMessage) return inMessage[1];
    return ESLINT_RULE_CODES[message.ruleId] ?? 'D490';
}

/** hook 依赖（D407）报在依赖数组那一行，原因却在 hook 里面（新用到的变量），见 selectNewFindings。 */
const HOOK_DEPS_RULE = 'react-hooks/exhaustive-deps';
const HOOK_START = /\buse(?:Effect|LayoutEffect|InsertionEffect|Callback|Memo|ImperativeHandle)\s*\(/;
/** 往上找 hook 调用开始的那一行（hook 不能嵌套，最近的那个就是它）。 */
const hookStartLine = (lines, line) => {
    for (let index = line - 1; index >= Math.max(0, line - 400); index--) {
        if (HOOK_START.test(lines[index] ?? '')) return index + 1;
    }
    return null;
};

/**
 * ESLint 的 JSON 结果 → Dedicatus 的统一格式。hook 依赖的问题另带 span（hook 从哪一行到依赖数组那一行）
 * 和 names（消息里点名的变量），selectNewFindings 用完就去掉。
 */
export function toFindings(root, results) {
    const findings = [];
    for (const result of results) {
        const file = path.relative(root, result.filePath).split(path.sep).join('/');
        let sourceLines = null;
        for (const message of result.messages) {
            const code = codeForMessage(message);
            const finding = {
                code,
                file,
                line: message.line,
                column: message.column,
                rule: message.ruleId ?? undefined,
                message: message.message.replace(CODE_IN_MESSAGE, (_, _code, offset) => (offset === 0 ? '' : ' ')).trim(),
                key: `${code}:${file}:${message.line}:${message.column}:${message.ruleId ?? ''}`,
            };
            if (message.ruleId === HOOK_DEPS_RULE) {
                sourceLines ??= (result.source ?? (fs.existsSync(result.filePath) ? fs.readFileSync(result.filePath, 'utf8') : '')).split('\n');
                const start = hookStartLine(sourceLines, message.line);
                if (start !== null) finding.span = [start, message.line];
                finding.names = [...message.message.matchAll(/'([A-Za-z_$][\w$]*)/g)].map(match => match[1]);
            }
            findings.push(finding);
        }
    }
    return findings;
}

/** 去掉只给挑选用的字段（span、names），输出（JSON 给 Aeolian）里不带。 */
const forOutput = ({ span: _span, names: _names, ...finding }) => finding;

/**
 * 这次新写的行上出现的词（变量名等），按文件。hook 依赖的问题点名的变量在这里面，多半就是这次引起的。
 * @param {{ newPath: string | null, added: { newLine: number, text: string }[] }[]} files
 * @param {Map<string, Set<number>> | null} written
 */
export function writtenWordsOf(files, written) {
    const words = new Map();
    for (const file of files) {
        const lines = file.newPath ? written?.get(file.newPath) : null;
        if (!lines) continue;
        const set = new Set();
        for (const entry of file.added) {
            if (!lines.has(entry.newLine)) continue;
            for (const match of entry.text.matchAll(/[A-Za-z_$][\w$]*/g)) set.add(match[0]);
        }
        words.set(file.newPath, set);
    }
    return words;
}

/** 一组（文件 × 规则）问题合成的一条。level 为 notice 时不阻断。 */
const folded = (code, file, rule, message, level) => ({
    code, file, rule, message, key: `${code}:${file}:folded:${rule}`, ...(level ? { level } : {}),
});

/**
 * 从 ESLint 报出来的问题里挑出这次真正新增的，按“文件 × 规则”分组：
 * - 没有规则 id 的（失效的抑制注释、解析失败）原样保留；
 * - 风格类规则在本来就是旧风格的文件里不追究；
 * - 没有比较基点时（本机看全貌）：没有抑制记录的原样保留；计数超了的合成一条；
 * - 有比较基点时：落在“新写的行”上的原样保留（挪过来的行不算新写）。其余多出来的：挪来没迁移 / 没登记的合成一条 D002；
 *   这次碰过的文件里另外多出来的合成一条 notice（目标分支上已有的，或别处改动引起的）；没碰过的文件不追究（目标分支自己的 CI 会报）。
 * - hook 依赖（D407）报在依赖数组那一行，不在作者写的行上（#1048 演习：新加的 isRemoteStageSource 让好几个旧 hook 缺依赖，
 *   只出了一条 notice）。多出来的先按“hook 里有新写的行”认领，点名了新写的行上出现的变量的优先，最多认领多出来的条数。
 * @param {import('../baseline.mjs').Finding[]} findings
 * @param {{ suppressions: object, written: Map<string, Set<number>> | null, moved?: Map<string, Set<number>>,
 *   renameMap?: Map<string, string>, newFiles?: Set<string>, touched?: Set<string>, writtenWords?: Map<string, Set<string>> }} context
 * @returns {import('../baseline.mjs').Finding[]}
 */
export function selectNewFindings(findings, { suppressions, written, moved = new Map(), renameMap = new Map(), newFiles = new Set(), touched = new Set(), writtenWords = new Map() }) {
    const renamedFrom = new Map([...renameMap].map(([from, to]) => [to, from]));
    /** @type {Map<string, import('../baseline.mjs').Finding[]>} */
    const groups = new Map();
    /** @type {import('../baseline.mjs').Finding[]} */
    const selected = [];
    for (const finding of findings) {
        if (!finding.rule) {
            selected.push(finding);
            continue;
        }
        const key = `${finding.file}\u0000${finding.rule}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(finding);
    }

    const flagged = new Set();
    const flagOnce = (file, finding) => {
        if (flagged.has(file)) return;
        flagged.add(file);
        selected.push(finding);
    };

    for (const group of groups.values()) {
        const { file, rule, code } = group[0];
        const recorded = Number(suppressions?.[file]?.[rule]?.count ?? 0);
        if (STYLE_CODES.has(code) && recorded > 0) continue;

        if (written === null) {
            if (recorded === 0) selected.push(...group);
            else selected.push(folded(code, file, rule, `${rule}：比抑制记录多了 ${group.length - recorded} 条（记录 ${recorded} 条，现在 ${group.length} 条）`));
            continue;
        }

        const lines = written.get(file);
        const onWritten = lines ? group.filter(finding => lines.has(finding.line)) : [];
        selected.push(...onWritten);
        let rest = group.length - onWritten.length - recorded;
        if (rest > 0 && lines && rule === HOOK_DEPS_RULE) {
            const promoted = claimHookFindings(group.filter(finding => !lines.has(finding.line)), lines, writtenWords.get(file), rest);
            selected.push(...promoted);
            rest -= promoted.length;
        }
        if (rest <= 0) continue;

        const from = renamedFrom.get(file);
        if (recorded === 0 && from && suppressions?.[from]?.[rule]) {
            flagOnce(file, { code: 'D002', file, message: `这个文件是从 ${from} 挪来的，旧违规的抑制还记在旧路径上（跑 npm run dedicatus -- --migrate-renames）`, key: `D002:${file}:migrate` });
            continue;
        }
        const movedHere = moved.get(file);
        if (newFiles.has(file) && movedHere && group.some(finding => movedHere.has(finding.line))) {
            flagOnce(file, { code: 'D002', file, message: '这个新文件里有从别处挪来的旧违规，还没登记（跑 npm run dedicatus -- --adopt-moved）', key: `D002:${file}:adopt` });
            continue;
        }
        if (touched.has(file)) {
            selected.push(folded(code, file, rule, `${rule}：另有 ${rest} 条不在新写的行上（目标分支上已有，或由别处的改动引起）`, 'notice'));
        }
    }
    return selected.map(forOutput);
}

/**
 * hook 依赖的问题里，算这次引起的：hook 里有新写的行；点名的变量出现在新写的行上的排前面，其余按行号。最多 limit 条。
 * @param {import('../baseline.mjs').Finding[]} candidates 不在新写的行上的
 * @param {Set<number>} lines 这个文件新写的行
 * @param {Set<string> | undefined} words 新写的行上出现的词
 */
function claimHookFindings(candidates, lines, words, limit) {
    const inside = finding => finding.span && [...lines].some(line => line >= finding.span[0] && line <= finding.span[1]);
    const names = finding => (finding.names ?? []).some(name => words?.has(name));
    return candidates
        .filter(inside)
        .sort((a, b) => Number(names(b)) - Number(names(a)) || a.line - b.line)
        .slice(0, limit);
}

/**
 * 每个“文件 × 规则”实际有多少违规：报出来的加上被批量抑制挡掉的（行内 eslint-disable 挡掉的不算）。
 * @returns {Map<string, Map<string, { count: number, lines: number[] }>>}
 */
export function actualCounts(root, results) {
    const counts = new Map();
    const add = (file, message) => {
        if (!message.ruleId) return;
        if (!counts.has(file)) counts.set(file, new Map());
        const rules = counts.get(file);
        const entry = rules.get(message.ruleId) ?? { count: 0, lines: [] };
        entry.count += 1;
        entry.lines.push(message.line);
        rules.set(message.ruleId, entry);
    };
    for (const result of results) {
        const file = path.relative(root, result.filePath).split(path.sep).join('/');
        for (const message of result.messages) add(file, message);
        for (const message of result.suppressedMessages ?? []) {
            if ((message.suppressions ?? []).some(suppression => suppression.kind === 'file')) add(file, message);
        }
    }
    return counts;
}

/** 抑制文件里记多了的“文件 × 规则”（违规已经修好、或者文件已经不在了）。 */
export function staleSuppressions(suppressions, counts) {
    const stale = [];
    for (const [file, rules] of Object.entries(suppressions ?? {})) {
        for (const [rule, entry] of Object.entries(rules ?? {})) {
            const actual = counts.get(file)?.get(rule)?.count ?? 0;
            if (Number(entry?.count ?? 0) > actual) stale.push({ file, rule, recorded: Number(entry.count), actual });
        }
    }
    return stale;
}

/**
 * 跑一遍 ESLint，返回原始结果（JSON）。抑制文件有过期条目时 ESLint 以退出码 2 结束，但结果照常写出。
 * targets 是逐个列出的文件时，配置里忽略的文件（生成的、夹具）不报“被忽略了”。
 */
export function lintResults(root, extraArgs = [], targets = LINT_TARGETS) {
    if (targets.length === 0) return [];
    const output = path.join(os.tmpdir(), `dedicatus-eslint-${process.pid}-${Date.now()}.json`);
    const scoped = targets === LINT_TARGETS ? [] : ['--no-warn-ignored'];
    const run = spawnEslint(root, ['--format', 'json', '--output-file', output, ...scoped, ...extraArgs, ...targets], { capture: true });
    if (!fs.existsSync(output)) {
        throw new Error(`ESLint 没有跑完（退出码 ${run.status}）：${(run.stderr || run.stdout || '').trim().slice(0, 2000)}`);
    }
    const results = JSON.parse(fs.readFileSync(output, 'utf8'));
    fs.rmSync(output, { force: true });
    return results;
}

export function readSuppressions(root) {
    const file = path.join(root, ESLINT_SUPPRESSIONS_FILE);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/**
 * @param {string} root
 * @param {{ base?: string | null, written?: Map<string, Set<number>> | null, moved?: Map<string, Set<number>>,
 *   renameMap?: Map<string, string>, newFiles?: Set<string>, touched?: Set<string> }} context
 *   base 是已经解析好的比较基点（resolveBase 的结果），其余来自同一份 diff；没有基点时 written 为 null。
 */
export async function runEslint(root, context = {}) {
    const { base = null, files = [], written = null, moved = new Map(), renameMap = new Map(), newFiles = new Set(), touched = new Set() } = context;
    // 有比较基点时只检查改过的文件：没碰过的文件就算违规变多（别处改了类型），下面也不追究，全仓跑只是白占内存
    const results = lintResults(root, [], base ? scopedLintTargets(files) : LINT_TARGETS);
    const suppressions = readSuppressions(root);
    const counts = actualCounts(root, results);
    const fresh = selectNewFindings(toFindings(root, results), { suppressions, written, moved, renameMap, newFiles, touched, writtenWords: writtenWordsOf(files, written) });

    // 记多了的抑制（修好了没 prune）：有基点时只追究这次碰过的文件，没碰过的是目标分支自己的事。
    const stale = staleSuppressions(suppressions, counts).filter(entry => !base || touched.has(entry.file));
    if (stale.length > 0) {
        const files = [...new Set(stale.map(entry => entry.file))];
        fresh.push({
            code: 'D002',
            file: ESLINT_SUPPRESSIONS_FILE,
            message: `${files.length} 个文件的抑制记多了（违规已修好），跑 npm run lint:prune：${files.slice(0, 5).join('、')}${files.length > 5 ? ' 等' : ''}`,
            key: `D002:${ESLINT_SUPPRESSIONS_FILE}`,
        });
    }

    if (base) {
        const baseText = showAt(root, base, ESLINT_SUPPRESSIONS_FILE);
        if (baseText === null) {
            fresh.push({
                code: 'D004',
                level: 'warning',
                file: ESLINT_SUPPRESSIONS_FILE,
                message: `比较基点 ${base.slice(0, 9)} 上还没有 ${ESLINT_SUPPRESSIONS_FILE}：基点可能太旧（本机先 git fetch 再跑，或者用 --base 指定），这次没查它有没有变大（D001）`,
                key: `D004:${ESLINT_SUPPRESSIONS_FILE}:stale-base`,
            });
        }
        const movedCounts = new Map();
        for (const file of newFiles) {
            const movedHere = moved.get(file);
            if (!movedHere) continue;
            for (const [rule, entry] of counts.get(file) ?? []) {
                const n = entry.lines.filter(line => movedHere.has(line)).length;
                if (n > 0) movedCounts.set(`${file}\u0000${rule}`, n);
            }
        }
        const { growth } = suppressionGrowthWithTransfers(suppressions, baseText === null ? null : JSON.parse(baseText), renameMap, newFiles, movedCounts);
        for (const entry of growth) {
            fresh.push({
                code: 'D001',
                file: ESLINT_SUPPRESSIONS_FILE,
                message: `抑制计数变大：${entry.file} 的 ${entry.rule} 从 ${entry.before} 到 ${entry.after}（修掉违规而不是登记它）`,
                key: `D001:${entry.file}:${entry.rule}`,
            });
        }
    }
    return { fresh, known: [] };
}

/**
 * 把这次新建的文件里现有的违规登记进抑制文件（拆文件时搬过去的旧账），再删掉这次改过的文件里记多了的
 * （旧账搬走的那些文件）。CI 会核对只是搬家。
 * @param {string[]} files 新建的文件
 * @param {string[]} pruneTargets 要清理记多了的条目的文件（scopedLintTargets 的结果）
 */
export function adoptSuppressions(root, files, pruneTargets = LINT_TARGETS) {
    const lintable = files.filter(isLintTarget);
    if (lintable.length > 0) spawnEslint(root, ['--suppress-all', '--pass-on-unpruned-suppressions', '--no-warn-ignored', ...lintable], { capture: true });
    if (pruneTargets.length > 0) spawnEslint(root, ['--prune-suppressions', ...(pruneTargets === LINT_TARGETS ? [] : ['--no-warn-ignored']), ...pruneTargets], { capture: true });
    return lintable.length;
}
