import type { FontStrokesGlyph } from '../../../services/fontStrokes/fontStrokesOutline';
import { measureInlineGlyphPlace, StrokeWriteSvgChar } from './strokeWriteSvg';
import type { WriteGlyphState } from './strokeWriteTiming';

// src/components/visualizer/fontStrokes/strokeWriteSlot.ts
// DOM 写字里一个字的生命周期（流光 / 云阶 / 心象共用）：按 resolveWriteGlyphState 的结果切换三种样子——
// 还没开写：字隐藏（visibility，占位不变）；正在写：字套上 SVG 遮罩（strokeWriteSvg.ts），逐帧更新；写完 / 普通：样式全部还原、遮罩删掉。
// 只在状态变化时改 DOM；正在写的那几帧只改遮罩里的一个 dashoffset。

export interface StrokeWriteSlotTargets {
    /** 套遮罩的字 span（inline-block、只装这一个字）；第一个用来量位置。 */
    masked: HTMLElement[];
    /** 还没写完时只隐藏、不套遮罩的元素（例如心象光晕层里的同一个字）。 */
    hiddenUntilDone?: HTMLElement[];
    /** 开写 / 写完时调（true / false）：调用方改光晕的画法（外层滤镜、字的颜色）。 */
    onWriting?: (writing: boolean) => void;
}

type SlotMode = 'plain' | 'hidden' | 'writing';

export class StrokeWriteSlot {
    private mode: SlotMode = 'plain';
    private writer: StrokeWriteSvgChar | null = null;

    constructor(private readonly grapheme: string, private readonly targets: StrokeWriteSlotTargets) {}

    get writing(): boolean {
        return this.mode === 'writing';
    }

    /** 应用这一帧的状态；glyph 是这个字的笔画（state 是数字时要有，没有就按普通画法）。 */
    apply(state: WriteGlyphState, glyph: FontStrokesGlyph | null): void {
        if (state === null) {
            this.toPlain();
            return;
        }
        if (state === 'hidden') {
            if (this.mode === 'hidden') return;
            this.toPlain();
            this.setHidden(true);
            this.mode = 'hidden';
            return;
        }
        if (this.mode !== 'writing') {
            const writer = glyph ? this.createWriter(glyph) : null;
            if (!writer) {
                this.toPlain();
                return;
            }
            this.setHidden(false);
            this.writer = writer;
            for (const el of this.targets.masked) {
                el.style.setProperty('mask', writer.url);
                el.style.setProperty('-webkit-mask', writer.url);
                // 正在写的字自己一层：改遮罩只重画这个字，不重画整块
                el.style.willChange = 'transform';
            }
            for (const el of this.targets.hiddenUntilDone ?? []) el.style.visibility = 'hidden';
            this.mode = 'writing';
            this.targets.onWriting?.(true);
        }
        this.writer?.update(state);
    }

    /** 还原成普通的字（卸载、换行、关开关时调）。 */
    dispose(): void {
        this.toPlain();
    }

    private createWriter(glyph: FontStrokesGlyph): StrokeWriteSvgChar | null {
        if (this.targets.masked.length === 0) return null;
        const el = this.targets.masked[0];
        const place = measureInlineGlyphPlace(el, this.grapheme);
        return place ? StrokeWriteSvgChar.create(el.ownerDocument, glyph, place) : null;
    }

    private setHidden(hidden: boolean) {
        const value = hidden ? 'hidden' : '';
        for (const el of this.targets.masked) el.style.visibility = value;
        for (const el of this.targets.hiddenUntilDone ?? []) el.style.visibility = value;
    }

    private toPlain() {
        if (this.mode === 'plain') return;
        const wasWriting = this.mode === 'writing';
        this.writer?.dispose();
        this.writer = null;
        for (const el of this.targets.masked) {
            el.style.removeProperty('mask');
            el.style.removeProperty('-webkit-mask');
            el.style.willChange = '';
        }
        this.setHidden(false);
        this.mode = 'plain';
        if (wasWriting) this.targets.onWriting?.(false);
    }
}
