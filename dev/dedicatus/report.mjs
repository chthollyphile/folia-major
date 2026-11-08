import fs from 'node:fs';
import { codeInfo } from './codes.mjs';
// dev/dedicatus/report.mjs
// 把检查结果写出来：给人读的文本、给 Aeolian 读的 JSON、给 GitHub 的注解和 job summary。
// 对外输出要克制（README 的“输出”一节）：每条一行，只写代码和位置；不发 PR 评论，job summary 最多列 SUMMARY_LIMIT 条。

const SUMMARY_LIMIT = 30;

/** 一条结果的级别：结果自己带的（合成的提示是 notice），否则按代码表。 */
export const levelOf = finding => finding.level ?? codeInfo(finding.code)?.level ?? 'error';

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
    for (const finding of result.fresh) lines.push(formatLine(finding));
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
    for (const finding of result.fresh) {
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
    if (result.fresh.length > 0) {
        out.push('```');
        for (const finding of result.fresh.slice(0, SUMMARY_LIMIT)) out.push(`${finding.code} ${location(finding)}`);
        out.push('```');
        if (result.fresh.length > SUMMARY_LIMIT) out.push(`另有 ${result.fresh.length - SUMMARY_LIMIT} 条，见注解 / ${result.fresh.length - SUMMARY_LIMIT} more in annotations.`);
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
