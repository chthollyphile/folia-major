import type { NebbiaSourceLine } from './nebbiaChars';
import { isModelChar } from './nebbiaFontStrokes';
import { nebbiaFontStrokes, type FontDemandChar, type NebbiaFontStrokesHandle } from './nebbiaFontStrokesQueue';
import type { NebbiaGlyphCache } from './nebbiaGlyphs';
import type { LaidLine } from './nebbiaScene';
import { swapLineGlyphs } from './nebbiaSceneUpdate';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaFontLines.ts
// 运行时和字体笔画队列之间的一层：按播放位置报「要哪些字」（还没开写的句子按顺序、前几句马上要用），
// 每批算完把还没开写、含新到的字的那几句就地换上模型的字形（nebbiaSceneUpdate.ts），已经开写的句子不动、整首不重排。

/** 开写前这么多秒起句子就不再换字形（字形换了画面会跳）。 */
export const FONT_LOCK_AHEAD = 1.5;
/** 往后这几句的字用 onScreen 紧迫度算，其余后台算。 */
const NEAR_LINES = 4;

/** 这句还能不能换字形。 */
const swappable = (line: LaidLine, T: number) => T < line.t - FONT_LOCK_AHEAD;

/** 按顺序的需求：第一个还能换的句子起往后（前几句 near），再是更早的句子（拖回去时用）。 */
export const fontDemandOf = (source: NebbiaSourceLine[], T: number): FontDemandChar[] => {
    const first = source.findIndex(l => T < l.t - FONT_LOCK_AHEAD);
    const from = first < 0 ? source.length : first;
    const out: FontDemandChar[] = [], seen = new Set<string>();
    const push = (line: NebbiaSourceLine, near: boolean) => {
        for (const c of line.chars) if (isModelChar(c.ch) && !seen.has(c.ch)) { seen.add(c.ch); out.push({ ch: c.ch, near }); }
    };
    for (let i = from; i < source.length; i += 1) push(source[i], i - from < NEAR_LINES);
    for (let i = from - 1; i >= 0; i -= 1) push(source[i], false);
    return out;
};

export interface NebbiaFontLinesHost {
    glyphs: NebbiaGlyphCache;
    laid: () => LaidLine[];
    source: () => NebbiaSourceLine[];
    tuning: () => NebbiaTuning;
    seed: () => string | number;
    time: () => number;
    /** 换了字形，要补画一帧。 */
    changed: () => void;
}

export class NebbiaFontLines {
    private readonly handle: NebbiaFontStrokesHandle;
    /** 上次报需求时第一个还能换的句子；播放位置越过它或往回拖才重新报。 */
    private anchor = -2;
    private disposed = false;

    constructor(private readonly host: NebbiaFontLinesHost) {
        this.handle = nebbiaFontStrokes.attach(this.handleBatch);
    }

    /** 整首重排之后（换歌、换字体、换尺寸）：重新报需求。 */
    sceneBuilt(T: number) {
        this.anchor = -2;
        this.tick(T);
    }

    /** 每帧调：只在第一个还能换的句子变了（播放走过、拖进度）时重新报需求，平时一次比较。 */
    tick(T: number) {
        if (this.disposed) return;
        const { glyphs } = this.host, source = this.host.source();
        if (!glyphs.fontStrokes) {
            if (this.anchor !== -1) { this.anchor = -1; this.handle.want([], glyphs.family, glyphs.weight); }
            return;
        }
        const prev = this.anchor;
        // 常见情形：还停在上次的位置，不用扫
        if (prev >= 0 && (prev >= source.length || T < source[prev].t - FONT_LOCK_AHEAD) && (prev === 0 || T >= source[prev - 1].t - FONT_LOCK_AHEAD)) return;
        const first = source.findIndex(l => T < l.t - FONT_LOCK_AHEAD);
        this.anchor = first < 0 ? source.length : first;
        this.handle.want(fontDemandOf(source, T), glyphs.family, glyphs.weight);
    }

    dispose() {
        this.disposed = true;
        this.handle.detach();
    }

    /** 一批算完：还没开写、含新字形的句子就地换（一批一次，暂停时也只做这个）。 */
    private handleBatch = () => {
        const { glyphs } = this.host;
        if (this.disposed || !glyphs.fontStrokes) return;
        const laid = this.host.laid(), source = this.host.source();
        const T = this.host.time();
        const lines: number[] = [];
        laid.forEach((line, li) => {
            if (!swappable(line, T) || line.chars.length !== source[li]?.chars.length) return;
            if (line.chars.some(c => isModelChar(c.ch) && glyphs.get(c.ch) !== c.base)) lines.push(li);
        });
        if (!lines.length) return;
        swapLineGlyphs(laid, source, glyphs, this.host.tuning(), this.host.seed(), lines);
        this.host.changed();
    };
}
