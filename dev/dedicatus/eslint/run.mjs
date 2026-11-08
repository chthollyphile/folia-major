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

const RUNTIME = 'dev/dedicatus/lint';

/** 要检查的目录和文件。显式列出而不是扫 `.`：主检出里 .claude/worktrees 下还嵌着别的工作树。 */
export const LINT_TARGETS = [
    'src', 'test', 'dev', 'electron', 'shared', 'api', 'api-ts', 'worker', 'packaging', 'build', 'deploy', 'public',
    'skills', 'sync-server', '.github/scripts', '*.ts', '*.js', '*.mjs',
];

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

/** ESLint 的 JSON 结果 → Dedicatus 的统一格式。 */
export function toFindings(root, results) {
    const findings = [];
    for (const result of results) {
        const file = path.relative(root, result.filePath).split(path.sep).join('/');
        for (const message of result.messages) {
            const code = codeForMessage(message);
            findings.push({
                code,
                file,
                line: message.line,
                column: message.column,
                rule: message.ruleId ?? undefined,
                message: message.message.replace(CODE_IN_MESSAGE, (_, _code, offset) => (offset === 0 ? '' : ' ')).trim(),
                key: `${code}:${file}:${message.line}:${message.column}:${message.ruleId ?? ''}`,
            });
        }
    }
    return findings;
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
 * @param {import('../baseline.mjs').Finding[]} findings
 * @param {{ suppressions: object, written: Map<string, Set<number>> | null, moved?: Map<string, Set<number>>,
 *   renameMap?: Map<string, string>, newFiles?: Set<string>, touched?: Set<string> }} context
 * @returns {import('../baseline.mjs').Finding[]}
 */
export function selectNewFindings(findings, { suppressions, written, moved = new Map(), renameMap = new Map(), newFiles = new Set(), touched = new Set() }) {
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
        const rest = group.length - onWritten.length - recorded;
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
    return selected;
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

/** 跑一遍 ESLint，返回原始结果（JSON）。抑制文件有过期条目时 ESLint 以退出码 2 结束，但结果照常写出。 */
export function lintResults(root, extraArgs = []) {
    const output = path.join(os.tmpdir(), `dedicatus-eslint-${process.pid}-${Date.now()}.json`);
    const run = spawnEslint(root, ['--format', 'json', '--output-file', output, ...extraArgs, ...LINT_TARGETS], { capture: true });
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
    const { base = null, written = null, moved = new Map(), renameMap = new Map(), newFiles = new Set(), touched = new Set() } = context;
    const results = lintResults(root);
    const suppressions = readSuppressions(root);
    const counts = actualCounts(root, results);
    const fresh = selectNewFindings(toFindings(root, results), { suppressions, written, moved, renameMap, newFiles, touched });

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

/** 把这次新建的文件里现有的违规登记进抑制文件（拆文件时搬过去的旧账），再删掉别处记多了的。CI 会核对只是搬家。 */
export function adoptSuppressions(root, files) {
    const lintable = files.filter(file => /\.(ts|tsx|mts|js|cjs|mjs)$/.test(file));
    if (lintable.length > 0) spawnEslint(root, ['--suppress-all', '--pass-on-unpruned-suppressions', ...lintable], { capture: true });
    spawnEslint(root, ['--prune-suppressions', ...LINT_TARGETS], { capture: true });
    return lintable.length;
}
