import type { Line, LyricData, Word } from '../../types';
import { isInterludeLine } from './parserCore';
import { formatLrcTimestamp } from './lrcTimestamp';

// src/utils/lyrics/enhancedLrcSerializer.ts
// 把 LyricData 写成增强型 LRC（A2 扩展）：`[mm:ss.xx]<mm:ss.xxx>词<mm:ss.xxx>词…<行尾>`。
//
// 输出要能被 Folia 自己的 LocalFileLyricAdapter 原样读回来：
// - 翻译、罗马音写成与原文同一个 `[mm:ss.xx]` 的后续行，这是 splitCombinedTimeline 认的合并布局；
// - 解析器自动插入的间奏行（`......`）不写，否则读回来会多出一行；
// - 逐行歌词的 words 是解析器按字数均分出来的假时轴，只写行首时间，不把它们冒充成逐字；
// - 每一行原文的行首标签互不相同，否则读回时同一时间戳的第二行会被当成上一行的翻译吞掉。
//
// 这是有损格式：背景和声、agent、ruby、音节、wordSegments 都没有位置可放，需要无损请用 `.fia`。

export interface EnhancedLrcMetadata {
    title?: string;
    artist?: string;
    album?: string;
    durationMs?: number;
}

export interface EnhancedLrcSerializeOptions {
    metadata?: EnhancedLrcMetadata;
    includeTranslation?: boolean;
    includeRomanization?: boolean;
    /** 'auto' 按 inferLyricWordTiming 判断；显式指定时直接采用。 */
    wordTiming?: 'auto' | 'word' | 'line';
}

const MAX_TIMESTAMP_MS = (99 * 60 + 59) * 1000 + 999;

const clampTimestampMs = (seconds: number): number => (
    Math.min(Math.max(Math.round(seconds * 1000), 0), MAX_TIMESTAMP_MS)
);

const splitTimestamp = (seconds: number) => {
    const totalMs = clampTimestampMs(seconds);
    return {
        minutes: Math.floor(totalMs / 60000),
        seconds: Math.floor((totalMs % 60000) / 1000),
        millis: totalMs % 1000,
    };
};

const pad2 = (value: number) => `${value}`.padStart(2, '0');

/** 行首标签 `[mm:ss.xx]`：两位小数，兼容面最广。 */
export const formatLrcLineTimestamp = (seconds: number): string => formatLrcTimestamp(clampTimestampMs(seconds));

/** 逐字标签 `<mm:ss.xxx>`：三位小数，逐字时轴对 10ms 的误差敏感。 */
export const formatLrcWordTimestamp = (seconds: number): string => {
    const { minutes, seconds: secs, millis } = splitTimestamp(seconds);
    return `<${pad2(minutes)}:${pad2(secs)}.${`${millis}`.padStart(3, '0')}>`;
};

/**
 * 这份歌词是否真的带逐字时轴，只看 `isWordByWord`。
 *
 * 逐行歌词的 words 是解析器按字数均分出来的占位（parserCore 的 buildTimedWords），
 * 从数值上猜不出来：行尾的全角标点、字数多的短行都会让它的结尾偏离任何固定比例。
 * 所以由各个解析器在产出时写明；没有写的旧数据一律按逐行导出，宁可丢掉逐字，也不编造逐字。
 */
export const inferLyricWordTiming = (lyrics: LyricData): 'word' | 'line' => (
    lyrics.isWordByWord === true ? 'word' : 'line'
);

/**
 * 把一行的 words 对齐回 fullText，拿到每个词之后紧跟的空白和标点。
 * 西文歌词的 words 常常不带空格（空格只在 fullText 里），直接拼接会变成 `HelloWorld`。
 * 对齐失败（words 与 fullText 对不上）时退回 words 自身的文本。
 */
const alignWordSegments = (line: Line): Array<{ word: Word; text: string }> => {
    const segments = line.words.map(word => ({ word, text: word.text }));
    if (segments.map(segment => segment.text).join('') === line.fullText) {
        return segments;
    }

    let cursor = 0;
    const aligned: Array<{ word: Word; text: string }> = [];
    let leading = '';
    for (const word of line.words) {
        const needle = word.text.trim();
        const index = needle ? line.fullText.indexOf(needle, cursor) : -1;
        if (index < 0) return segments;
        const gap = line.fullText.slice(cursor, index);
        if (aligned.length > 0) {
            aligned[aligned.length - 1].text += gap;
        } else {
            leading = gap;
        }
        aligned.push({ word, text: needle });
        cursor = index + needle.length;
    }
    if (aligned.length > 0) {
        aligned[0].text = leading + aligned[0].text;
        aligned[aligned.length - 1].text += line.fullText.slice(cursor);
    }
    return aligned;
};

const serializeWordTimedBody = (line: Line): string => {
    const segments = alignWordSegments(line);
    let body = '';
    let previousEnd: number | null = null;

    for (const { word, text } of segments) {
        // 词与词之间有空档时补一个空段：`<上一词结束>` 后面紧跟 `<下一词开始>`，解析器会跳过空段。
        if (previousEnd !== null && word.startTime - previousEnd > 0.0005) {
            body += formatLrcWordTimestamp(previousEnd);
        }
        body += `${formatLrcWordTimestamp(word.startTime)}${text}`;
        previousEnd = word.endTime;
    }

    const lineEnd = Math.max(previousEnd ?? line.endTime, line.startTime);
    return `${body}${formatLrcWordTimestamp(lineEnd)}`;
};

const formatLengthTag = (durationMs: number): string => {
    const totalSeconds = Math.round(durationMs / 1000);
    return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
};

// 元数据值里的 `]` 会提前闭合标签。
const sanitizeTagValue = (value: string) => value.replace(/[\]\r\n]/g, ' ').trim();

const oneLine = (text: string) => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/** 生成增强型 LRC 全文（以换行结尾）。 */
export const serializeEnhancedLrc = (lyrics: LyricData, options: EnhancedLrcSerializeOptions = {}): string => {
    const {
        metadata = {},
        includeTranslation = true,
        includeRomanization = true,
        wordTiming = 'auto',
    } = options;
    const timing = wordTiming === 'auto' ? inferLyricWordTiming(lyrics) : wordTiming;
    const output: string[] = [];

    const title = metadata.title ?? lyrics.title;
    const artist = metadata.artist ?? lyrics.artist;
    if (title) output.push(`[ti:${sanitizeTagValue(title)}]`);
    if (artist) output.push(`[ar:${sanitizeTagValue(artist)}]`);
    if (metadata.album) output.push(`[al:${sanitizeTagValue(metadata.album)}]`);
    if (metadata.durationMs && metadata.durationMs > 0) output.push(`[length:${formatLengthTag(metadata.durationMs)}]`);
    output.push('[re:Folia]');

    let previousTagMs = Number.NEGATIVE_INFINITY;
    for (const line of lyrics.lines) {
        if (isInterludeLine(line)) continue;
        const text = oneLine(line.fullText);
        if (!text) continue;

        // 行首标签只有 10ms 精度。和上一行撞上同一个标签时往后推 10ms：读回时同一标签的
        // 连续几行会被 splitCombinedTimeline 当成「原文 + 翻译」，第二行就没了。
        // 超出 99:59.99 的行写不出合法标签，直接停止，不把它们夹到同一个时间上连锁合并。
        const tagMs = Math.max(Math.floor(Math.round(Math.max(line.startTime, 0) * 1000) / 10) * 10, previousTagMs + 10);
        if (tagMs > MAX_TIMESTAMP_MS) break;
        previousTagMs = tagMs;
        const lineTag = formatLrcLineTimestamp(tagMs / 1000);
        const useWordTiming = timing === 'word' && line.words.length > 0;
        output.push(`${lineTag}${useWordTiming ? serializeWordTimedBody({ ...line, fullText: text }) : text}`);

        const translation = includeTranslation && line.translation ? oneLine(line.translation) : '';
        if (translation) output.push(`${lineTag}${translation}`);
        const romanization = includeRomanization && line.romanization ? oneLine(line.romanization) : '';
        if (romanization) output.push(`${lineTag}${romanization}`);
    }

    return `${output.join('\n')}\n`;
};
