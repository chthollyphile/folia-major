import type { NebbiaChar, NebbiaSourceLine } from './nebbiaChars';

// src/components/visualizer/nebbia/nebbiaCredits.ts
// 雾笺的片尾：最后一句唱完一会儿，前面的句子都起雾散掉，在玻璃正中手写出曲名，下面小一点写歌手，
// 写完一直留着。这里把曲名、歌手做成两句额外的歌词（`credits` 标记），排版（nebbiaLayout.ts 的
// creditsCandidate）、书写节奏和不起雾（nebbiaScene.ts）各自按这个标记处理。

/** 最后一句唱完后多久开写曲名。 */
export const CREDITS_DELAY = 2.5;

const graphemes = (text: string): string[] => {
    const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    return seg ? [...seg.segment(text)].map(s => s.segment) : [...text];
};

/**
 * 一段文字的词：按 Intl 分词（中日文曲名中间没有空格，只按空格切会只有一块，排版就没法分两行），
 * 没有分词器时按空格切。返回每个词的字素下标。
 */
const wordsOf = (text: string, chars: string[]): number[][] => {
    const starts: number[] = [];
    let offset = 0;
    for (const g of chars) { starts.push(offset); offset += g.length; }
    const words: number[][] = [];
    const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
    const pieces = seg ? [...seg.segment(text)].map(p => ({ at: p.index, text: p.segment }))
        : [...text.matchAll(/\S+/g)].map(m => ({ at: m.index ?? 0, text: m[0] }));
    for (const p of pieces) {
        if (!p.text.trim()) continue;
        const run = starts.flatMap((u, i) => (u >= p.at && u < p.at + p.text.length && chars[i].trim() ? [i] : []));
        if (run.length) words.push(run);
    }
    return words;
};

/** 一段文字做成一句：字间隔开一点时间（真正的书写节奏由场景排）。 */
const creditLine = (text: string, t: number, credits: 'title' | 'artist'): NebbiaSourceLine => {
    const gs = graphemes(text);
    const chars: NebbiaChar[] = gs.map((ch, i) => ({ ch, t: t + i * 0.1, d: 0.5 }));
    const last = chars[chars.length - 1];
    return { chars, words: wordsOf(text, gs), t, end: last ? last.t + last.d : t, next: Infinity, credits };
};

/** 在整首歌词后面接上片尾两句（没有歌词或没有曲名时不加）。歌手写在曲名写完之后，由场景对齐。 */
export const appendNebbiaCredits = (source: NebbiaSourceLine[], title?: string | null, artist?: string | null): NebbiaSourceLine[] => {
    const name = title?.trim();
    if (!source.length || !name) return source;
    const at = Math.max(...source.map(l => l.end)) + CREDITS_DELAY;
    const out = source.map((l, i) => (i === source.length - 1 ? { ...l, next: Math.min(l.next, at) } : l));
    const titleLine = creditLine(name, at, 'title');
    out.push(titleLine);
    const by = artist?.trim();
    if (by) {
        // 两句的 next 都留 Infinity：书写不赶时间，按自然速度写
        out.push(creditLine(by, titleLine.end + 0.2, 'artist'));
    }
    return out;
};
