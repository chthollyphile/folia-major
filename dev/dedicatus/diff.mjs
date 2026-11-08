// dev/dedicatus/diff.mjs
// 解析 `git diff -U0 -M`（固定 a/ b/ 前缀、不转义路径）的输出，给 Dedicatus 的几处用：
// `@note` 检查（D506）看删掉的行，ESLint 结果按改动的行过滤，基线和抑制按改名迁移。
// 文件头只在 `diff --git` 和第一个 `@@` 之间认：内容里以 `-- ` 开头的行删掉后会变成 `--- …`，不能当成文件头。

/**
 * @typedef {{ oldPath: string | null, newPath: string | null,
 *   removed: { oldLine: number, newLine: number, text: string }[],
 *   added: { newLine: number, text: string }[] }} FileDiff
 */

/** @param {string} text @returns {FileDiff[]} */
export function parseDiff(text) {
    const files = [];
    let current = null;
    let inHeader = false;
    let oldLine = 0;
    let newLine = 0;
    for (const raw of text.split('\n')) {
        if (raw.startsWith('diff --git ')) {
            const names = /^diff --git a\/(.+) b\/(.+)$/.exec(raw);
            current = { oldPath: names?.[1] ?? null, newPath: names?.[2] ?? null, removed: [], added: [] };
            files.push(current);
            inHeader = true;
            continue;
        }
        if (!current) continue;
        if (inHeader) {
            if (raw.startsWith('rename from ')) current.oldPath = raw.slice('rename from '.length);
            else if (raw.startsWith('rename to ')) current.newPath = raw.slice('rename to '.length);
            else if (raw.startsWith('new file mode')) current.oldPath = null;
            else if (raw.startsWith('deleted file mode')) current.newPath = null;
            else if (raw.startsWith('--- ')) current.oldPath = raw === '--- /dev/null' ? null : raw.slice(4).replace(/^a\//, '');
            else if (raw.startsWith('+++ ')) current.newPath = raw === '+++ /dev/null' ? null : raw.slice(4).replace(/^b\//, '');
        }
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
        if (hunk) {
            inHeader = false;
            oldLine = Number(hunk[1]);
            newLine = Number(hunk[2]);
            continue;
        }
        if (inHeader) continue;
        if (raw.startsWith('-')) {
            current.removed.push({ oldLine, newLine, text: raw.slice(1) });
            oldLine += 1;
        } else if (raw.startsWith('+')) {
            current.added.push({ newLine, text: raw.slice(1) });
            newLine += 1;
        }
    }
    return files;
}

/** 改动后的文件 → 新增或改写过的行号。 */
export function changedLines(files) {
    const lines = new Map();
    for (const file of files) {
        if (!file.newPath) continue;
        const set = lines.get(file.newPath) ?? new Set();
        for (const entry of file.added) set.add(entry.newLine);
        lines.set(file.newPath, set);
    }
    return lines;
}

/** 太短的行（`}`、`return null;` 这类）到处都有，不拿来判断“挪动”。 */
const MOVE_MIN_LENGTH = 12;
/**
 * 一段挪过来的代码至少要有这么多行配得上。单独一行配上多半是巧合（`<AnimatePresence>`、`} catch (error) {`），
 * 不算挪动：否则全新的文件会被要求跑 --adopt-moved，落在这些行上的问题也会漏掉。只有两行的一段，还要求删掉的那边
 * 也是同一个文件里隔得一样远的两行（挪了一个两行的小函数），两行各自在别处被删过的巧合不算。
 * 代价：挪的时候每隔一行就改一行、或者只挪了一行长代码的，不算挪动，那几行上的旧违规要当成新写的处理。
 */
const MOVE_MIN_RUN = 2;

/**
 * 挪过来的行：新增的行里，和别处删掉的行（任何文件）去掉首尾空白后一模一样的，按出现次数一对一配对；
 * 只有连成一段的才算（相邻的新增行里至少 MOVE_MIN_RUN 行配得上，中间的短行和空行不打断这一段）。
 * 凑不成一段的配对把额度还回去，免得一行巧合占掉别处真正挪过来的那一行。
 * 拆文件、调整顺序时搬过去的旧代码靠它和真正新写的代码分开。
 * @returns {Map<string, Set<number>>} 改动后的文件 → 挪过来的行号
 */
export function movedLines(files) {
    const removedCounts = new Map();
    /** 删掉的行在哪儿：两行的一段要核对删掉的那边是不是也挨在一起。 */
    const removedAt = new Map();
    for (const file of files) {
        for (const entry of file.removed) {
            const text = entry.text.trim();
            if (text.length < MOVE_MIN_LENGTH) continue;
            removedCounts.set(text, (removedCounts.get(text) ?? 0) + 1);
            if (!removedAt.has(text)) removedAt.set(text, []);
            removedAt.get(text).push({ file: file.oldPath ?? file.newPath, line: entry.oldLine });
        }
    }
    /** 两行在删掉的那边也是同一个文件里、隔得一样远的两行。 */
    const removedTogether = (first, second) => (removedAt.get(first.text) ?? []).some(a => (removedAt.get(second.text) ?? [])
        .some(b => a.file === b.file && b.line - a.line === second.line - first.line));
    const moved = new Map();
    for (const file of files) {
        if (!file.newPath) continue;
        const entries = [...file.added].sort((a, b) => a.newLine - b.newLine);
        /** @type {{ line: number, text: string }[]} */
        let run = [];
        let previousLine = null;
        const closeRun = () => {
            if (run.length > MOVE_MIN_RUN || (run.length === MOVE_MIN_RUN && removedTogether(run[0], run[1]))) {
                if (!moved.has(file.newPath)) moved.set(file.newPath, new Set());
                for (const { line } of run) moved.get(file.newPath).add(line);
            } else {
                for (const { text } of run) removedCounts.set(text, (removedCounts.get(text) ?? 0) + 1);
            }
            run = [];
        };
        for (const entry of entries) {
            if (previousLine !== null && entry.newLine !== previousLine + 1) closeRun();
            previousLine = entry.newLine;
            const text = entry.text.trim();
            if (text.length < MOVE_MIN_LENGTH) continue;
            const left = removedCounts.get(text) ?? 0;
            if (left === 0) {
                closeRun();
                continue;
            }
            removedCounts.set(text, left - 1);
            run.push({ line: entry.newLine, text });
        }
        closeRun();
    }
    return moved;
}

/** 真正新写或改写的行：改动的行去掉挪过来的。 */
export function writtenLines(files) {
    const changed = changedLines(files);
    const moved = movedLines(files);
    for (const [file, lines] of moved) {
        const set = changed.get(file);
        if (!set) continue;
        for (const line of lines) set.delete(line);
    }
    return changed;
}

/** 这次新建的文件（改名的目标不算）。 */
export function addedFiles(files) {
    return new Set(files.filter(file => !file.oldPath && file.newPath).map(file => file.newPath));
}

/** 改名：旧路径 → 新路径（只算两头都在的；新建和删除不算）。 */
export function renames(files) {
    const map = new Map();
    for (const file of files) {
        if (file.oldPath && file.newPath && file.oldPath !== file.newPath) map.set(file.oldPath, file.newPath);
    }
    return map;
}
