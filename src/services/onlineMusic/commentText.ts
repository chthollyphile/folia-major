// src/services/onlineMusic/commentText.ts
// 三家评论正文的共享清洗。上游（尤其 QQ/酷狗）会把换行和斜杠**双重转义**：
// 字面量 `\n`、`\/` 原样显示在界面上（用户看到的是 "/ 加 n" 而不是换行）；
// QQ 的表情是 [em]e401203[/em] 标记，剥掉只留文字。只做这两类有据的清洗，
// 其余字符（含真 emoji、[图片] 占位）原样保留。

export const normalizeCommentText = (value: unknown): string =>
    String(value ?? '')
        // 反转义常见的字面转义残留（顺序：单反斜杠序列在前，双反斜杠最后）
        .replace(/\\n/g, '\n')
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\[em\][^[]*\[\/em\]/g, '')
        .trim();
