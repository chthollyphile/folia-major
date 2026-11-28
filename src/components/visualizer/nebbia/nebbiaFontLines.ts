import type { NebbiaSourceLine } from './nebbiaChars';
import { isModelChar, registerFontStrokesConsumer, subscribeFontStrokes } from '../../../services/fontStrokes';
import type { NebbiaGlyphCache } from './nebbiaGlyphs';
import type { LaidLine } from './nebbiaScene';
import { swapLineGlyphs } from './nebbiaSceneUpdate';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaFontLines.ts
// 运行时和笔画服务（services/fontStrokes）之间的一层：字体笔画开着时登记「要这个字体的笔画」（算哪些字、什么时候算归服务），
// 服务来了新字，按句分批把字形做出来（一个字几毫秒，每批限时、两批之间隔一帧，把一整首的活摊开），一句做齐就把这句就地换上
// 字体笔画的字形（nebbiaSceneUpdate.ts）；已经开写的句子不动、整首不重排。往回拖进度时重新看一遍（又能换的句子用已经做好的字形）。

/** 开写前这么多秒起句子就不再换字形（字形换了画面会跳）。 */
export const FONT_LOCK_AHEAD = 1.5;
/** 每批做字形最多用这么多毫秒（至少做一个字），做不完隔 BUILD_GAP_MS 下一批接着做（定时器排队，暂停时也走）。 */
const BUILD_SLICE_MS = 5;
const BUILD_GAP_MS = 16;
/** 播放位置往回跳超过这么多秒算拖了进度。 */
const SEEK_BACK = 0.5;

/** 这句还能不能换字形。 */
const swappable = (line: LaidLine, T: number) => T < line.t - FONT_LOCK_AHEAD;

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
    /** 登记着的字体键和取消登记。 */
    private key: string | null = null;
    private release: (() => void) | null = null;
    private readonly unsubscribe: () => void;
    private disposed = false;
    /** 排着的下一批。 */
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** 上一帧的播放位置（看有没有往回拖）。 */
    private lastT = -Infinity;
    /** 登记时报给服务的本首文本。 */
    private chars = '';

    constructor(private readonly host: NebbiaFontLinesHost) {
        this.unsubscribe = subscribeFontStrokes(this.handleArrival);
    }

    /**
     * 整首重排之前（换歌、换字体、开关字体笔画、换尺寸）：字体键变了就换登记；已经锁住（快开写或正在写）、还没让位的句子
     * 这时不能再换，它们的字形当场做好（通常一两句），排出来就是字体笔画。
     */
    beforeBuild(source: readonly NebbiaSourceLine[]) {
        if (this.disposed) return;
        const key = this.host.glyphs.fontStrokesKey;
        // 本首要写的字也报给服务：预览、试玩台这类不跟播放走的文本也能拿到笔画
        const chars = key ? source.map(line => line.chars.map(c => c.ch).join('')).join('') : '';
        if (key !== this.key || chars !== this.chars) {
            if (key !== this.key) this.cancel();
            const previous = this.release;
            // 先登记新的再放掉旧的：服务不会因为中间没有使用方而停下
            this.release = key ? registerFontStrokesConsumer({ fontKey: key, chars }) : null;
            previous?.();
            this.key = key;
            this.chars = chars;
        }
        if (!key) return;
        const { glyphs } = this.host;
        const T = this.host.time();
        for (const line of source) {
            if (T < line.t - FONT_LOCK_AHEAD || T >= line.next) continue;
            for (const c of line.chars) glyphs.buildModel(c.ch);
        }
    }

    /** 整首排好以后：剩下的句子分批做。 */
    afterBuild() {
        this.schedule(0);
    }

    /** 每帧调（一次比较）：往回拖了进度就排一批，重新开放的句子换上已经做好或现做的字形。 */
    tick(T: number) {
        if (T < this.lastT - SEEK_BACK) this.schedule(0);
        this.lastT = T;
    }

    dispose() {
        this.disposed = true;
        this.cancel();
        this.unsubscribe();
        this.release?.();
        this.release = null;
    }

    private cancel() {
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
    }

    private schedule(delay: number) {
        if (this.disposed || !this.key || this.timer !== null) return;
        this.timer = setTimeout(this.pump, delay);
    }

    /** 服务来了一批新字（哪个字体键都会通知）：是这个字体的就排一批。 */
    private handleArrival = (fontKey: string) => {
        if (fontKey === this.key) this.schedule(0);
    };

    /**
     * 一批：从最先要开写的还能换的句子起，逐句把能做的字形做出来，限时 BUILD_SLICE_MS；做齐的句子里有字形变了的一起换掉
     * （一批一次 swapLineGlyphs），还有没做完的就隔一帧再排一批。
     */
    private pump = () => {
        this.timer = null;
        const { glyphs } = this.host;
        if (this.disposed || !this.key || glyphs.fontStrokesKey !== this.key) return;
        const laid = this.host.laid(), source = this.host.source();
        const T = this.host.time();
        const start = performance.now();
        const lines: number[] = [];
        let more = false;
        for (let li = 0; li < laid.length && !more; li += 1) {
            const line = laid[li];
            if (!swappable(line, T) || line.chars.length !== source[li]?.chars.length) continue;
            for (const c of line.chars) {
                if (!glyphs.modelPending(c.ch)) continue;
                if (performance.now() - start > BUILD_SLICE_MS) { more = true; break; }
                glyphs.buildModel(c.ch);
            }
            if (!more && line.chars.some(c => isModelChar(c.ch) && glyphs.get(c.ch) !== c.base)) lines.push(li);
        }
        if (lines.length) {
            swapLineGlyphs(laid, source, glyphs, this.host.tuning(), this.host.seed(), lines, li => !swappable(laid[li], T));
            this.host.changed();
        }
        if (more) this.schedule(BUILD_GAP_MS);
    };
}
