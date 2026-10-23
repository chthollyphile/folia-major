import { LyricData } from '../../types';
import type { LyricParseFormat } from './parserCore';
import type { StructuredLyric, StructuredLyricLine } from '../../types/navidrome';

export type UnifiedLyric = LyricData;

export interface LyricProcessingOptions {
    includeInterludes?: boolean;
    filterPattern?: string | null;
    songId?: number;
    fetchChorusRanges?: (songId: number) => Promise<Array<{ startTime: number; endTime: number }>>;
}

// 歌词制作人员（staff / credits）块的处理契约，跨 utils / store / 设置面板共用。
export type LyricStaffPolicy = 'keep' | 'smart' | 'hide';
export type LyricStaffVerdict = 'none' | 'keep' | 'retime' | 'hide';

// 是否把开头署名块相邻的行并入块：off 不吸收，before 只吸收块之前的行，both 前后都吸收。
// 判据是单行耗时（低于「每行最少停留」），不是字数。
export type LyricStaffAbsorbMode = 'off' | 'before' | 'both';

export interface LyricStaffPolicyOptions {
    policy?: LyricStaffPolicy;
    minDwellSeconds?: number;
    /** 自定义识别正则；留空使用内置词表。 */
    pattern?: string | null;
    /** 是否把开头署名块相邻的行并入块；缺省 'off' 保证旧调用行为不变。 */
    absorbMode?: LyricStaffAbsorbMode;
}

export interface LyricStaffDecision {
    verdict: LyricStaffVerdict;
    /** 命中的 staff 行数，不含吸收进来的行。 */
    blockLineCount: number;
    /** 从块首到第一句歌词之间的可用秒数。 */
    windowSeconds: number;
    /** 完整展示这些 staff 行所需的秒数，吸收行也算一行。 */
    requiredSeconds: number;
    /**
     * 窗口预算的种类：缺省是正常预算（开头块看前奏、中间块看间奏）。末尾块没有下一句正文，
     * 只看行距（'tail'）；整首都是署名时一律保留（'whole-song'）。后两种情况下
     * windowSeconds / requiredSeconds 只是报告值，可能出现窗口 >= 需求却仍判 hide，
     * UI 不该把这两个数当成矛盾。
     */
    windowKind?: 'budget' | 'tail' | 'whole-song';
    /** 判定为署名的行下标。 */
    staffIndexes: number[];
    /** 块占据的全部行下标，含分隔符行与吸收行；隐藏时整组一起去掉。 */
    memberIndexes: number[];
    /** 吸收进块的相邻行数量。 */
    absorbedLineCount: number;
    /** 吸收进块的行下标，升序；始终是 memberIndexes 的子集。 */
    absorbedIndexes: number[];
}

export interface RawEmbeddedLyric {
    type: 'embedded';
    // Raw USLT tags parsed from music-metadata.
    usltTags?: Array<{ language?: string, descriptor?: string, text: string }>;
    // Fallback simple strings (e.g. from IndexedDB cache).
    textContent?: string;
    translationContent?: string;
}

export interface RawLocalFileLyric {
    type: 'local';
    lrcContent: string;
    tLrcContent?: string;
    // Separate romanization track; wins over one split out of a combined timeline, like tLrcContent.
    rLrcContent?: string;
    formatHint?: LyricParseFormat;
}

export interface RawQrcLyric {
    type: 'qrc';
    qrcContent: string;
    translationContent?: string;
}

export interface RawNeteaseLyric {
    type: 'netease';
    lrc?: {
        lyric?: string;
        pureMusic?: boolean;
        yrc?: { lyric?: string; pureMusic?: boolean };
        ytlrc?: { lyric?: string; pureMusic?: boolean };
        yromalrc?: { lyric?: string; pureMusic?: boolean };
        romalrc?: { lyric?: string; pureMusic?: boolean };
    };
    yrc?: { lyric?: string; pureMusic?: boolean };
    ytlrc?: { lyric?: string; pureMusic?: boolean };
    yromalrc?: { lyric?: string; pureMusic?: boolean };
    tlyric?: { lyric?: string; pureMusic?: boolean };
    romalrc?: { lyric?: string; pureMusic?: boolean };
    pureMusic?: boolean;
}

export interface RawNavidromeLyric {
    type: 'navidrome';
    // OpenSubsonic structured lyrics
    structuredLyrics?: StructuredLyric | StructuredLyric[] | StructuredLyricLine[];
    // Standard Subsonic plain lyrics string
    plainLyrics?: string;
}

export type RawLyricSource = 
    | RawEmbeddedLyric 
    | RawLocalFileLyric 
    | RawQrcLyric
    | RawNeteaseLyric 
    | RawNavidromeLyric;
