// dev/dedicatus/checks/notes.mjs
// D506：`@note` 注释被删除、改写或翻译。AGENTS.md 规定没有明确指令不能动 `@note`，这里拿 diff 机器核对。
// 保护的是整条注释：`@note` 那一行，加上紧跟着的注释续行（多行说明、水印下面配套的那行）。
// 字符串和文档里提到这个词不算。只是挪了位置（同一行原样出现在新增的行里，哪个文件都算，按出现次数配对）不报。

const NOTE_COMMENT = /^\s*(?:\/\/+|\/\*+|\*+|#+)\s*@note\b/;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#)/;

/** 一行是不是 `@note` 注释的开头。 */
export const isNoteComment = text => NOTE_COMMENT.test(text);

/**
 * 一个文件里属于 `@note` 注释的行号（从 1 起）：`@note` 那行，以及紧跟着的、不空的注释行。
 * @param {string} text
 * @returns {Set<number>}
 */
export function noteBlockLines(text) {
    const lines = new Set();
    let inBlock = false;
    text.split('\n').forEach((line, index) => {
        if (isNoteComment(line)) inBlock = true;
        else if (!inBlock || !COMMENT_LINE.test(line) || line.trim() === '') inBlock = false;
        if (inBlock) lines.add(index + 1);
    });
    return lines;
}

/**
 * 被删掉、且没有原样出现在新增行里的 `@note` 注释行（含续行）。
 * @param {import('../diff.mjs').FileDiff[]} files parseDiff 的结果
 * @param {(oldPath: string) => string | null} readOld 改动前的文件内容（用来认出续行）；读不到就只认 `@note` 那一行
 * @returns {{ file: string, line: number | null, text: string }[]} file、line 尽量给改动后的位置（注解要落在 PR 的新代码上）
 */
export function findNoteChanges(files, readOld = () => null) {
    const addedCounts = new Map();
    for (const file of files) {
        for (const entry of file.added) {
            const text = entry.text.trim();
            addedCounts.set(text, (addedCounts.get(text) ?? 0) + 1);
        }
    }
    const changes = [];
    for (const file of files) {
        if (file.removed.length === 0) continue;
        const old = file.oldPath ? readOld(file.oldPath) : null;
        const blocks = old === null ? null : noteBlockLines(old);
        for (const entry of file.removed) {
            const protectedLine = isNoteComment(entry.text) || Boolean(blocks?.has(entry.oldLine));
            if (!protectedLine) continue;
            const text = entry.text.trim();
            const left = addedCounts.get(text) ?? 0;
            if (left > 0) {
                addedCounts.set(text, left - 1);
                continue;
            }
            changes.push(file.newPath
                ? { file: file.newPath, line: entry.newLine, text }
                : { file: file.oldPath ?? '', line: null, text });
        }
    }
    return changes;
}

export function checkNotes(files, readOld) {
    return findNoteChanges(files, readOld).map(entry => ({
        code: 'D506',
        file: entry.file,
        ...(entry.line ? { line: entry.line } : {}),
        message: `@note 注释被删除或改写：${entry.text.length > 80 ? `${entry.text.slice(0, 80)}…` : entry.text}`,
        key: `D506:${entry.file}:${entry.text}`,
    }));
}
