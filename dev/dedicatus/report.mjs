import fs from 'node:fs';
import { codeInfo } from './codes.mjs';
// dev/dedicatus/report.mjs
// 把检查结果写出来：给人读的文本、给 Aeolian 读的 JSON、给 GitHub 的注解和 job summary。
// 对外输出要克制（README 的“输出”一节）：每条一行，只写代码和位置；不发 PR 评论，job summary 最多列 SUMMARY_LIMIT 行；
// 给人看的版本先排序，GitHub 上再合并（compressForReaders）。

const SUMMARY_LIMIT = 30;
/** 同一文件同一条通用规则超过这么多处，合成一行。 */
const FOLD_AT = 3;
/** 风格类（缩进、引号、换行）：都能自动修。 */
const STYLE_CODE = /^D43[0-2]$/;
/** 通用的 ESLint 规则（typescript-eslint、react-hooks、通用约定、抑制注释、其他严格规则）。 */
const GENERIC_CODE = /^D4([0-2]\d|90)$/;
export const FIX_STYLE_COMMAND = 'npm run lint:fix-style';

/** 一条结果的级别：结果自己带的（合成的提示是 notice），否则按代码表。 */
export const levelOf = finding => finding.level ?? codeInfo(finding.code)?.level ?? 'error';

/** 排序：项目规则（边界、播放、凭据、IPC……）在前，通用 ESLint 规则其次，风格最后。 */
const rankOf = finding => (STYLE_CODE.test(finding.code) ? 2 : GENERIC_CODE.test(finding.code) ? 1 : 0);

/**
 * 给人看的版本：项目规则排在最前面。GitHub 注解和 job summary 还要合并（fold）：风格问题每个“文件 × 规则”合成一行，
 * 指向自动修复的命令；同一文件同一条通用规则超过 FOLD_AT 处的也合成一行。GitHub 每个步骤只显示前 10 个注解、
 * summary 只列前 SUMMARY_LIMIT 行，不合并的话一个 2 空格缩进的新文件就能把真正要看的问题全挤掉。
 * 本机的文字输出只排序不合并：要改的人得看到每一处在哪一行。JSON（给 Aeolian）既不排序也不合并。
 * @param {import('./baseline.mjs').Finding[]} fresh
 * @param {{ fold?: boolean }} [options]
 * @returns {{ findings: import('./baseline.mjs').Finding[], styleCount: number }}
 */
export function compressForReaders(fresh, { fold = true } = {}) {
    const groups = new Map();
    const kept = [];
    let styleCount = 0;
    for (const finding of fresh) {
        const rank = rankOf(finding);
        if (rank === 2 && finding.line) styleCount += 1;
        if (!fold || rank === 0 || !finding.rule || !finding.line) {
            kept.push(finding);
            continue;
        }
        const key = `${finding.file}\u0000${finding.rule}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(finding);
    }
    for (const group of groups.values()) {
        const [first] = group;
        if (rankOf(first) === 2) {
            kept.push({ ...first, message: `${first.rule}：这个文件有 ${group.length} 处，都能自动修（${FIX_STYLE_COMMAND}）`, key: `${first.code}:${first.file}:style:${first.rule}` });
        } else if (group.length > FOLD_AT) {
            kept.push({ ...first, message: `${first.message}（这个文件里这条规则共 ${group.length} 处）`, key: `${first.code}:${first.file}:many:${first.rule}` });
        } else {
            kept.push(...group);
        }
    }
    const findings = kept
        .map((finding, index) => ({ finding, index }))
        .sort((a, b) => rankOf(a.finding) - rankOf(b.finding) || a.index - b.index)
        .map(({ finding }) => finding);
    return { findings, styleCount };
}

const location = finding => {
    const at = finding.line ? `${finding.file}:${finding.line}${finding.column ? `:${finding.column}` : ''}` : finding.file;
    return finding.to ? `${at} → ${finding.to}` : at;
};

export const formatLine = finding => {
    const rule = finding.rule && finding.code === 'D490' ? ` [${finding.rule}]` : '';
    return `${finding.code}${rule} [${levelOf(finding)}] ${location(finding)}：${finding.message}`;
};

export function printText(result, { showKnown = false } = {}) {
    const lines = [];
    const { findings, styleCount } = compressForReaders(result.fresh, { fold: false });
    for (const finding of findings) lines.push(formatLine(finding));
    if (styleCount > 0) lines.push('', `风格问题 ${styleCount} 处（缩进、引号、换行），都能自动修：${FIX_STYLE_COMMAND}`);
    if (showKnown && result.known.length > 0) {
        lines.push('', `基线内的已知问题（${result.known.length} 条）：`);
        for (const finding of result.known) lines.push(`  ${formatLine(finding)}`);
    }
    if (lines.length > 0) lines.push('');
    lines.push(summaryLine(result));
    console.log(lines.join('\n'));
}

export function summaryLine(result) {
    const errors = result.fresh.filter(finding => levelOf(finding) === 'error').length;
    const parts = [`新问题 ${result.fresh.length} 条（error ${errors}）`];
    if (result.knownCount !== undefined) parts.push(`基线内 ${result.knownCount} 条`);
    parts.push(`模式 ${result.mode}`);
    return `Dedicatus：${parts.join('，')}`;
}

/** GitHub 工作流命令的转义：消息里转义 % \r \n，属性里再加 : 和 ,。 */
const escapeData = text => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = text => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

export function printGithub(result) {
    const { findings, styleCount } = compressForReaders(result.fresh);
    for (const finding of findings) {
        const level = levelOf(finding);
        const command = level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'notice';
        const props = [`file=${escapeProperty(finding.file)}`];
        if (finding.line) props.push(`line=${finding.line}`);
        if (finding.column) props.push(`col=${finding.column}`);
        props.push(`title=${escapeProperty(finding.code)}`);
        const message = finding.to ? `→ ${finding.to}：${finding.message}` : finding.message;
        console.log(`::${command} ${props.join(',')}::${escapeData(message)}`);
    }
    console.log(summaryLine(result));

    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (!summaryFile) return;
    const out = [`**${summaryLine(result)}**`, ''];
    if (findings.length > 0) {
        out.push('```');
        for (const finding of findings.slice(0, SUMMARY_LIMIT)) out.push(`${finding.code} ${location(finding)}`);
        out.push('```');
        if (findings.length > SUMMARY_LIMIT) out.push(`另有 ${findings.length - SUMMARY_LIMIT} 行，见注解 / ${findings.length - SUMMARY_LIMIT} more in annotations.`);
        if (styleCount > 0) out.push('', `风格问题 ${styleCount} 处（缩进、引号、换行），都能自动修：\`${FIX_STYLE_COMMAND}\` / ${styleCount} style issues, all auto-fixable: \`${FIX_STYLE_COMMAND}\``);
        out.push('', '代码说明见 `dev/dedicatus/README.md` 和 `dev/dedicatus/codes.mjs`。');
    }
    fs.appendFileSync(summaryFile, `${out.join('\n')}\n`);
}

export function printJson(result) {
    console.log(JSON.stringify({
        mode: result.mode,
        exitCode: result.exitCode,
        fresh: result.fresh.map(finding => ({ ...finding, level: levelOf(finding) })),
        known: result.known.map(finding => ({ ...finding, level: levelOf(finding) })),
    }, null, 2));
}
