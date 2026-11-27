import type { FontDemandChar } from '../fontStrokes/fontStrokesQueue';
import type { StrokeReveal } from '../fontStrokes/strokeReveal';
import { easeOutCubic } from './fumeMath';
import type { FumeBlock } from './fumeTypes';

// src/components/visualizer/fume/fumeHandwriting.ts
// 浮名「手写笔画」的纯逻辑：一个字的书写窗口和进度、「用不用手写」的冻结规则、要向笔顺队列报哪些字。
// 画法在 fumeCanvasText.ts（drawFumeLiveBlock），队列的接线在 useFumeHandwriting.ts。

/** 一个字的书写时长下限 / 上限（秒）：字的时长夹在中间，可以拖进下一个字。 */
export const HANDWRITING_MIN_SECONDS = 0.3;
export const HANDWRITING_MAX_SECONDS = 1.0;
/** 往后这几句（连同当前句）的字用 onScreen 紧迫度算，其余后台算。 */
export const HANDWRITING_NEAR_LINES = 4;

/** 画一帧手写需要的东西：字体、遮罩查询和每个字的冻结决定（跟着文章走，换歌就换一张）。 */
export interface FumeHandwritingFrame {
    family: string;
    weightOf: (variant: FumeBlock['variant']) => number;
    getReveal: (ch: string, family: string, weight: number) => StrokeReveal | null;
    decisions: Map<string, boolean>;
}

/**
 * 一个字此刻的书写进度（已缓出，0..1）：从字的开始时间 start 起写 clamp(字时长, 0.3, 1.0) 秒；
 * 还没开始或已写完（该用普通画法）返回 null。
 */
export const resolveHandwritingProgress = (start: number, end: number, time: number): number | null => {
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const duration = Math.min(HANDWRITING_MAX_SECONDS, Math.max(HANDWRITING_MIN_SECONDS, end - start));
    const t = (time - start) / duration;
    if (!(t >= 0) || t >= 1) return null;
    return easeOutCubic(t);
};

/**
 * 开写之前的那一小段（字时长的 20%，比普通画法 +0.16 的提前量略长）：这个字有遮罩、马上要被写出来时，
 * 这段时间里它保持等待的样子，不然普通画法会在开写前先把它亮起来，开写又从零写，看着一闪。
 */
export const isBeforeHandwritingLead = (time: number, start: number, duration: number): boolean => (
    time < start && time > start - duration * 0.2
);

/**
 * 冻结规则：这个字用手写还是普通画法，在它的书写窗口开始的第一帧定下（那一刻遮罩有就手写），窗口里不再改，
 * 遮罩中途才到的字这一遍仍是普通画法。不在窗口里时清掉记录，拖回去重放时按新的情况重新定。
 */
export const decideHandwriting = (
    decisions: Map<string, boolean>,
    key: string,
    inWindow: boolean,
    hasReveal: () => boolean,
): boolean => {
    if (!inWindow) {
        if (decisions.size) decisions.delete(key);
        return false;
    }
    const held = decisions.get(key);
    if (held !== undefined) return held;
    const decided = hasReveal();
    decisions.set(key, decided);
    return decided;
};

/** 时间 time 时的当前句：开始时间不晚于它的最后一句（都没开始时是第一句）。blocks 按开始时间排好。 */
export const findHandwritingAnchor = (blocks: readonly FumeBlock[], time: number): number => {
    let lo = 0, hi = blocks.length - 1, found = 0;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (blocks[mid].line.startTime <= time) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
};

/**
 * 按顺序的需求：当前句和后 4 句的字 near，其余往后的句子，再是更早的句子（拖回去时用）。
 * 主歌词和标题字重不同，每个字带自己的字重。
 */
export const buildHandwritingDemand = (
    blocks: readonly FumeBlock[],
    anchor: number,
    weightOf: (variant: FumeBlock['variant']) => number,
    isModelChar: (ch: string) => boolean,
): FontDemandChar[] => {
    const out: FontDemandChar[] = [], seen = new Set<string>();
    const push = (block: FumeBlock, near: boolean) => {
        const weight = weightOf(block.variant);
        for (const ch of block.graphemes) {
            const key = `${weight}|${ch}`;
            if (!isModelChar(ch) || seen.has(key)) continue;
            seen.add(key);
            out.push({ ch, near, weight });
        }
    };
    for (let i = anchor; i < blocks.length; i += 1) push(blocks[i], i - anchor <= HANDWRITING_NEAR_LINES);
    for (let i = anchor - 1; i >= 0; i -= 1) push(blocks[i], false);
    return out;
};
