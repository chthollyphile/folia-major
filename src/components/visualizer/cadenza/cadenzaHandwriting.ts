import { isModelChar } from '../../../services/fontStrokes/fontStrokesRaster';
import { colorWithAlpha } from '../../../utils/colorMix';
import { resolveSourceGlyphState, type StrokeWriteSource } from '../fontStrokes/strokeWriteSource';
import { StrokeWriteSlot } from '../fontStrokes/strokeWriteSlot';
import { clamp } from './cadenzaEnvelopes';
import type { OverlayWordNodes, WordPlacement } from './cadenzaTypes';

// src/components/visualizer/cadenza/cadenzaHandwriting.ts
// 心象叠层的「手写笔画」（开关开着、这个落点里有汉字 / 假名时才接上）：正文 span 拆成逐字，汉字 / 假名各包两层 inline-block span
// （外层放光晕滤镜，里层套 SVG 遮罩，fontStrokes/strokeWriteSlot.ts）。光晕层同一个字在没写完时隐藏（它的 text-shadow 会被遮罩硬切），
// 正在写时光晕改由正文外层的 drop-shadow 画，只跟着写出来的墨；写完还原成原来的 text-shadow。开关关着时这里什么都不做。

/** 一个落点的手写节点：逐字的外层 / 里层 span 和各字的写字状态（下标 = 落点里第几个字，不是汉字时 null）。 */
export interface CadenzaHwNodes {
    glyphs: string[];
    wraps: (HTMLSpanElement | null)[];
    inks: (HTMLSpanElement | null)[];
    slots: (StrokeWriteSlot | null)[];
    /** 各字外层当前的滤镜，没变就不写。 */
    filters: string[];
}

/** text-shadow 光晕（buildDomTextShadow，三层 40px）换成 drop-shadow：半径 × 0.4（同 wordGlow.ts 拟合的比例），只取前两层。 */
export const buildDomGlowFilter = (color: string, intensity: number): string => {
    const glow = clamp(intensity, 0, 1.6);
    if (glow <= 0.01) return 'none';
    return `drop-shadow(0 0 16px ${colorWithAlpha(color, Math.min(0.98, glow) * 0.7)}) drop-shadow(0 0 16px ${colorWithAlpha(color, Math.min(0.92, glow * 0.92))})`;
};

export const hasModelGlyph = (glyphs: readonly string[]): boolean => glyphs.some(isModelChar);

/** 把正文 span 换成逐字的内容（汉字 / 假名包两层 span，其余连着的字是文字节点），记在 nodes.hw 上。之后 writeOverlayWord 不再改正文文字。 */
export const attachCadenzaHandwriting = (nodes: OverlayWordNodes, glyphs: string[]) => {
    const doc = nodes.body.ownerDocument;
    const hw: CadenzaHwNodes = { glyphs, wraps: [], inks: [], slots: [], filters: [] };
    nodes.body.replaceChildren();
    let run = '';
    glyphs.forEach((glyph, index) => {
        hw.wraps.push(null);
        hw.inks.push(null);
        hw.slots.push(null);
        hw.filters.push('');
        if (!isModelChar(glyph)) {
            run += glyph;
            return;
        }
        if (run) nodes.body.append(run);
        run = '';
        const wrap = doc.createElement('span');
        wrap.style.display = 'inline-block';
        const ink = doc.createElement('span');
        ink.style.display = 'inline-block';
        ink.textContent = glyph;
        wrap.appendChild(ink);
        nodes.body.appendChild(wrap);
        hw.wraps[index] = wrap;
        hw.inks[index] = ink;
    });
    if (run) nodes.body.append(run);
    nodes.hw = hw;
};

/**
 * 一帧：每个汉字 / 假名按书写时序切换状态（字的时间取词的逐字时间，没有时按字数均分）。glowIntensity 是这一帧整个词的光晕强度
 * （汉字的光晕本来就不逐字），正在写的字把它画在正文外层的 drop-shadow 上。光晕层逐字 span（nodes.glyphSpans）要已经按 glyphs 拆好。
 */
export const updateCadenzaHandwriting = (
    nodes: OverlayWordNodes,
    placement: WordPlacement,
    time: number,
    source: StrokeWriteSource,
    glowIntensity: number,
) => {
    const hw = nodes.hw;
    if (!hw) return;
    const word = placement.word;
    const count = Math.max(placement.wordGraphemeCount, 1);
    const wordDuration = Math.max(word.endTime - word.startTime, 0.08);
    for (let i = 0; i < hw.glyphs.length; i += 1) {
        const ink = hw.inks[i];
        if (!ink) continue;
        let slot = hw.slots[i];
        if (!slot) {
            slot = new StrokeWriteSlot(hw.glyphs[i], { masked: [ink], hiddenUntilDone: nodes.glyphSpans.slice(i, i + 1) });
            hw.slots[i] = slot;
        }
        const at = placement.fragmentStartInWord + i;
        const timing = at < placement.wordGraphemeTimings.length ? placement.wordGraphemeTimings[at] : null;
        const start = timing ? timing.startTime : word.startTime + (at / count) * wordDuration;
        const end = timing ? timing.endTime : word.startTime + ((at + 1) / count) * wordDuration;
        const state = resolveSourceGlyphState(source, `${placement.id}:${i}`, hw.glyphs[i], time, start, end);
        slot.apply(state, typeof state === 'number' ? source.getStrokes(hw.glyphs[i]) : null);
        const filter = slot.writing ? buildDomGlowFilter(placement.color, glowIntensity) : '';
        if (filter !== hw.filters[i]) {
            hw.filters[i] = filter;
            (hw.wraps[i] as HTMLSpanElement).style.filter = filter;
        }
    }
};

/** 还原 / 删掉一个落点的写字遮罩（节点移除前调）。 */
export const disposeCadenzaHandwriting = (nodes: OverlayWordNodes) => {
    nodes.hw?.slots.forEach(slot => slot?.dispose());
};
