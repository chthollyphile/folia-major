import { execFileSync } from 'node:child_process';
import { areaOf, toDisplayLine } from '../format.mjs';
import { outlineOf } from '../resolve.mjs';
// dev/mcp/ts-code-map/tools/changeContext.mjs

const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const MAX_FILES = 20;
const MAX_SYMBOLS_PROBED = 15;
/**
 * 顶层的 Property/Key 一定是对象字面量的键（比如调用参数里的 `{ target: ..., depth: ... }`），
 * 不是声明，报出来只会是一串 0 引用的噪声。
 */
const NOISE_KINDS = new Set([7, 20]);

const git = (root, args) => {
    try {
        return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });
    } catch {
        return '';
    }
};

/** 从 `--unified=0` 的 diff 里抠出每个文件在新版本中被改动的行号区间。 */
function parseDiff(diff) {
    const perFile = new Map();
    let current = null;
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            const target = line.slice(4).trim();
            // 靠 --no-prefix 拿到干净路径：仓库可能开了 diff.mnemonicPrefix，
            // 那样前缀是 w/ i/ c/ 而不是 b/，写死剥 b/ 会得到错的路径。
            current = target === '/dev/null' ? null : target;
            if (current && !perFile.has(current)) perFile.set(current, []);
            continue;
        }
        if (!current || !line.startsWith('@@')) continue;
        const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (!match) continue;
        const start = Number(match[1]);
        const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count > 0) perFile.get(current).push([start, start + count - 1]);
    }
    return perFile;
}

export default {
    name: 'change_context',
    description:
        '总结当前 git 改动碰到了哪些符号，以及每个符号被谁引用。'
        + 'review 自己或别人的改动、判断这次改动的波及范围时用它，不用手动读 diff 再逐个查引用。',
    inputSchema: {
        type: 'object',
        properties: {
            base: { type: 'string', description: '对比基线，如 main 或某个 commit。省略则看工作区相对 HEAD 的改动。' },
        },
    },
    async run({ client, root }, { base } = {}) {
        let diff = base
            ? git(root, ['diff', '--unified=0', '--no-color', '--no-prefix', `${base}...HEAD`])
            : git(root, ['diff', '--unified=0', '--no-color', '--no-prefix', 'HEAD']);
        let scope = base ? `${base}...HEAD` : '工作区 vs HEAD';

        if (!diff.trim() && !base) {
            diff = git(root, ['diff', '--unified=0', '--no-color', '--no-prefix', 'HEAD~1', 'HEAD']);
            scope = 'HEAD~1..HEAD（工作区没有改动，退回看上一个 commit）';
        }
        if (!diff.trim()) return `${scope}：没有改动。`;

        const perFile = parseDiff(diff);
        const out = [`改动范围: ${scope}`, `涉及文件: ${perFile.size}`];
        const touched = [];
        let probed = 0;

        for (const [rel, ranges] of [...perFile].slice(0, MAX_FILES)) {
            if (!SOURCE_EXT.test(rel)) {
                out.push('', `${rel}  (非源码，跳过符号分析)`);
                continue;
            }
            let symbols;
            try {
                ({ symbols } = await outlineOf(client, rel));
            } catch {
                out.push('', `${rel}  (读不到，可能已删除)`);
                continue;
            }

            // 顶层符号的 range 覆盖到任何一个改动区间，就算这次改到了它。
            const hit = symbols.filter(node =>
                !NOISE_KINDS.has(node.kind)
                && ranges.some(([from, to]) =>
                    toDisplayLine(node.range.start.line) <= to && toDisplayLine(node.range.end.line) >= from));

            out.push('', `${rel}  (${ranges.length} 处改动)`);
            if (hit.length === 0) {
                out.push('  改动不在任何顶层符号内（import、常量或文件级代码）');
                continue;
            }

            for (const node of hit) {
                touched.push(rel);
                if (probed >= MAX_SYMBOLS_PROBED) {
                    out.push(`  ${node.name}  (已达引用探测上限，未统计)`);
                    continue;
                }
                probed++;
                const uri = await client.ensureOpen(rel);
                const refs = (await client.request('textDocument/references', {
                    textDocument: { uri },
                    position: (node.selectionRange ?? node.range).start,
                    context: { includeDeclaration: false },
                }).catch(() => null)) ?? [];
                const files = new Set(refs.map(ref => client.relFor(ref.uri)));
                const areas = [...new Set([...files].map(areaOf))].join(', ');
                out.push(`  ${node.name}  被 ${refs.length} 处引用，分布在 ${files.size} 个文件${areas ? ` (${areas})` : ''}`);
            }
        }

        if (perFile.size > MAX_FILES) out.push('', `… 还有 ${perFile.size - MAX_FILES} 个文件未展开`);
        out.push('', `提示: 想看某个符号的完整影响面用 impact，看具体引用位置用 references。`);
        return out.join('\n');
    },
};
