import type { Line } from '../../../types';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { segmentLyricWords } from '../../../utils/lyrics/wordSegmentation';
import { createVisualizerRng, hashVisualizerSeed } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaChars.ts
// 把 Folia 的歌词行整理成雾笺要写的逐字序列：每个字 { ch, t, d }，时间来自 Line.words（逐字时间轴），
// 认得的 emoji 换成 lucide 图标记号 `icon:<名字>`（线稿可以直接当笔画写）；词的分组走共用的分词
// （用户保存的分词优先），排版据此挑主词。有的句子写完顺手画一个主题图标。

export interface NebbiaChar {
    /** 一个字素，或 `icon:<lucide 名>`。 */
    ch: string;
    t: number;
    d: number;
}

export interface NebbiaSourceLine {
    chars: NebbiaChar[];
    /** 一个词一组字的下标，按顺序；空格不在任何一组里。 */
    words: number[][];
    t: number;
    end: number;
    /** 下一句开始的时间，最后一句是 Infinity。 */
    next: number;
    /** 片尾的曲名、歌手（nebbiaCredits.ts），歌词没有。 */
    credits?: 'title' | 'artist';
}

export const ICON_PREFIX = 'icon:';
export const isIconChar = (ch: string) => ch.startsWith(ICON_PREFIX);

// emoji → lucide 图标（和商籁同一套线稿图标）
const EMOJI_ICON: Record<string, string> = {
    '❤': 'Heart', '♥': 'Heart', '💗': 'Heart', '⭐': 'Star', '★': 'Star', '☆': 'Star', '🌙': 'Moon', '☀': 'Sun', '🌞': 'Sun',
    '🎵': 'Music', '♪': 'Music2', '🎶': 'Music', '🌸': 'Flower', '✿': 'Flower2', '🌷': 'Flower2', '✨': 'Sparkles',
    '☁': 'Cloud', '🌧': 'CloudRain', '☂': 'Umbrella', '☔': 'Umbrella', '🐱': 'Cat', '😊': 'Smile', '🙂': 'Smile',
    '❄': 'Snowflake', '🍃': 'Leaf', '🌿': 'Leaf', '🪶': 'Feather',
};
/** 主题没有给图标时，句尾随手画的图标从这里挑。 */
export const NEBBIA_DEFAULT_DOODLES = ['Heart', 'Star', 'Moon', 'Music', 'Flower', 'Sparkles', 'CloudRain', 'Umbrella', 'Smile', 'Leaf'];

/** 歌词里出现的 emoji 要用到的图标名（换歌前先加载好）。 */
export const collectEmojiIcons = (lines: Line[]): string[] => {
    const out = new Set<string>();
    for (const line of lines) for (const ch of line.fullText.replace(/[️‍]/g, '')) if (EMOJI_ICON[ch]) out.add(EMOJI_ICON[ch]);
    return [...out];
};

const toChar = (grapheme: string) => {
    const bare = grapheme.replace(/[️‍]/g, '');
    return EMOJI_ICON[bare] ? ICON_PREFIX + EMOJI_ICON[bare] : bare;
};

// 分词结果（按 UTF-16 偏移）对到字素下标上；纯空白的段不成词，每个图标单独成词
const groupWords = (line: Line, graphemes: string[], chars: NebbiaChar[]): number[][] => {
    const starts: number[] = [];
    let offset = 0;
    for (const g of graphemes) { starts.push(offset); offset += g.length; }
    const indexAt = (unit: number) => {
        let k = 0;
        while (k + 1 < starts.length && starts[k + 1] <= unit) k += 1;
        return k;
    };
    const words: number[][] = [];
    for (const seg of segmentLyricWords(line)) {
        if (!seg.segment.trim()) continue;
        const from = indexAt(seg.index), to = indexAt(seg.index + seg.segment.length - 1);
        let run: number[] = [];
        for (let k = from; k <= to; k += 1) {
            if (!chars[k].ch.trim()) continue;
            if (isIconChar(chars[k].ch)) { if (run.length) words.push(run); words.push([k]); run = []; } else run.push(k);
        }
        if (run.length) words.push(run);
    }
    return words;
};

/**
 * 整首歌的逐字序列。seed 决定哪些句子句尾画图标、画哪个；doodle 是概率；doodles 是可用的图标名
 * （主题的，或默认的），空的时候不画。
 */
export const buildNebbiaLines = (
    lines: Line[],
    seed: string | number,
    doodle: number,
    doodles: string[],
): NebbiaSourceLine[] => {
    const base = hashVisualizerSeed(String(seed));
    return lines.map((line, index) => {
        const timeline = buildLineGraphemeTimeline(line);
        const chars = timeline.map(g => ({ ch: toChar(g.char), t: g.startTime, d: Math.max(0, g.endTime - g.startTime) }));
        const words = groupWords(line, timeline.map(g => g.char), chars);
        const end = Math.max(line.startTime, getLineRenderEndTime(line));
        const next = lines[index + 1]?.startTime ?? Infinity;
        const rng = createVisualizerRng((base + Math.imul(index + 1, 977) + 31) >>> 0);
        const last = chars[chars.length - 1];
        if (last && doodles.length && !chars.some(c => isIconChar(c.ch)) && rng() < doodle) {
            const at = last.t + last.d;
            chars.push({ ch: ' ', t: at, d: 0 }, { ch: ICON_PREFIX + doodles[Math.floor(rng() * doodles.length)], t: at + 0.08, d: 1.1 });
            words.push([chars.length - 1]);
        }
        return { chars, words, t: line.startTime, end, next };
    });
};
