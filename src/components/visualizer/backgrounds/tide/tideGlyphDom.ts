import type { Line } from '../../../../types';
import { segmentLyricWords } from '../../../../utils/lyrics/wordSegmentation';

// src/components/visualizer/backgrounds/tide/tideGlyphDom.ts
// Turns the on-screen lyric text (the foreground visualizer's own DOM) into measurable glyph
// positions. The background never renders lyrics itself: it only asks where the sung characters
// currently sit, a few of them at a time, so it can stir the fluid where the lyrics move.

export interface TideGlyphRef {
    node: Text;
    offset: number;
}

/** 一个词在汇总字形串里占用的区间；length 为 0 的词不占位。 */
export interface TideGlyphRange {
    start: number;
    length: number;
}

export interface TideRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Characters that never carry a lyric anchor and would only confuse text alignment. */
const TIDE_SKIPPED_SELECTOR = 'canvas,svg,[data-tide-skip-anchor]';

/**
 * 前台可视化暴露的「动态标记」锚点（data-tide-playhead / data-tide-jet）。
 * canvas 类可视化没有文字 DOM，在自己的容器里放零尺寸标记代替歌词字形 ——
 * 内置 canvas 模式走 tideAnchorBridge，这条 DOM 标记通道留给外置模组
 * （模组读不到宿主模块状态，DOM 标记是它们唯一能发布的通道）。
 */
export const TIDE_MARK_SELECTOR = '[data-tide-playhead],[data-tide-jet]';

export interface TideMarkAnchor {
    /**
     * 标记的唯一 key。下游 glideTideAnchors 按 key 建 Map 配对锚点，
     * 所以同类标记必须带序号 —— 否则多个标记会被折叠成一个。
     */
    key: string;
    /** 标记身份：playhead（「现在」的位置）或 jet（交界处那股沿滚动方向、动量随音乐而变的向量）。 */
    kind: 'playhead' | 'jet';
    /** 相对舞台左下原点的归一化位置（0..1）。 */
    x: number;
    y: number;
    /** 0..1：标记自报的强度（波环给的是所在位置的波形振幅）。 */
    strength: number;
    /** 单位化的自报方向（屏幕坐标：x 向右、y 向下）；没有方向时为 (0,0)。 */
    outX: number;
    outY: number;
    /** 自报的推力大小 0..1（配合 outX/outY 决定这股向量多强）；缺省 1。 */
    push: number;
}

/** 解析一个标记的自报强度：垃圾值回落到中性 0.5。 */
const readMarkStrength = (mark: HTMLElement): number => {
    const parsed = Number.parseFloat(mark.dataset.tideStrength ?? '');
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;
};

/**
 * 解析一个标记自报的外推方向（data-tide-out="x,y"，屏幕坐标）：交界向量用它把流体朝滚动方向推。
 * 缺失、非数值或零向量都归零 —— 没有方向就只靠自移动推水，不额外外推。
 */
const readMarkOutward = (mark: HTMLElement): { outX: number; outY: number } => {
    const raw = mark.dataset.tideOut;
    if (!raw) {
        return { outX: 0, outY: 0 };
    }

    const [rawX, rawY] = raw.split(',');
    const outX = Number.parseFloat(rawX ?? '');
    const outY = Number.parseFloat(rawY ?? '');
    const length = Math.hypot(outX, outY);
    if (!Number.isFinite(length) || length < 1e-6) {
        return { outX: 0, outY: 0 };
    }

    return { outX: outX / length, outY: outY / length };
};

/**
 * 解析一个标记自报的推力大小（data-tide-push，0..1）：缺省 1（有方向就按满推力）。
 * 属性存在但解析不出数值时归零 —— 坏值不该换来一股满推力。
 */
const readMarkPush = (mark: HTMLElement): number => {
    const raw = mark.dataset.tidePush;
    if (raw === undefined) {
        return 1;
    }

    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
};

/**
 * 读取前台可视化的全部动态标记锚点，按 DOM 顺序返回（播放头在前、交界向量在后）。
 * canvas 类可视化（如波环）没有文字 DOM，靠它们把「现在」和交界处那股向量交给潮汐背景。
 */
export const readTideMarkAnchors = (
    stage: HTMLElement,
    bounds: { left: number; top: number; width: number; height: number },
): TideMarkAnchor[] => {
    if (bounds.width <= 1 || bounds.height <= 1) {
        return [];
    }

    const anchors: TideMarkAnchor[] = [];
    let jetIndex = 0;
    stage.querySelectorAll<HTMLElement>(TIDE_MARK_SELECTOR).forEach(mark => {
        const kind: TideMarkAnchor['kind'] = mark.hasAttribute('data-tide-jet') ? 'jet' : 'playhead';
        // 每个标记一个唯一 key：playhead 只有一个，交界向量带序号。
        const key = kind === 'playhead' ? 'playhead' : `jet:${jetIndex++}`;
        const rect = mark.getBoundingClientRect();
        // 零尺寸标记：位置在 rect 的左上角（left/top），不取中心。
        const anchorLeft = rect.width <= 0 && rect.height <= 0 ? rect.left : rect.left + rect.width / 2;
        const anchorTop = rect.width <= 0 && rect.height <= 0 ? rect.top : rect.top + rect.height / 2;
        const x = (anchorLeft - bounds.left) / bounds.width;
        const y = 1 - (anchorTop - bounds.top) / bounds.height;
        if (x < -0.15 || x > 1.15 || y < -0.15 || y > 1.15) {
            return;
        }

        const { outX, outY } = readMarkOutward(mark);
        anchors.push({ key, kind, x, y, strength: readMarkStrength(mark), outX, outY, push: readMarkPush(mark) });
    });
    return anchors;
};

export const normalizeAnchorText = (value: string): string => value.replace(/\s+/gu, '');

const isSkippedAncestor = (element: Element | null): boolean => (
    Boolean(element?.closest(TIDE_SKIPPED_SELECTOR))
);

/**
 * Concatenates every visible glyph inside the stage into one string and records where each
 * character lives, so a word of the active line can be mapped back to real DOM positions.
 */
export const collectTideGlyphs = (stage: HTMLElement): { text: string; glyphs: TideGlyphRef[] } => {
    const glyphs: TideGlyphRef[] = [];
    let text = '';
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
        const textNode = node as Text;
        const parent = textNode.parentElement;
        const value = textNode.nodeValue ?? '';

        if (value && parent && !isSkippedAncestor(parent)) {
            for (let index = 0; index < value.length; index++) {
                const character = value[index];
                if (/\s/u.test(character)) {
                    continue;
                }

                glyphs.push({ node: textNode, offset: index });
                text += character;
            }
        }

        node = walker.nextNode();
    }

    return { text, glyphs };
};

/**
 * 一次性建立整行的「词下标 -> 字形区间」映射（下标对应 Line.words 的顺序）。
 *
 * 行文本交给宿主的分词工具 segmentLyricWords 重建 —— 它带上用户保存的 wordSegments，
 * 与前台可视化真正渲染到 DOM 的分词同源，拼接后再去掉空白就是舞台上这一行的字形序列。
 * 该序列只在汇总字形串里定位一次，随后按每个词自己的字形长度顺序切区间：同一个词在一行里
 * 出现多次时，第 n 个词拿到的是第 n 段字形，而不会像「每次从串首重新搜索」那样命中第一段。
 *
 * 定位失败或分词与字形长度对不上时返回空数组，调用方据此退回其他锚点，绝不硬切错位。
 */
export const buildTideLineWordRanges = (text: string, line: Line): (TideGlyphRange | null)[] => {
    const words = line.words;
    if (!text || words.length === 0) {
        return [];
    }

    const lineText = segmentLyricWords(line)
        .map(part => normalizeAnchorText(part.segment))
        .join('');
    const base = lineText ? text.indexOf(lineText) : -1;
    if (!lineText || base < 0) {
        return [];
    }

    const ranges: (TideGlyphRange | null)[] = [];
    let cursor = base;
    for (const word of words) {
        const length = normalizeAnchorText(word.text).length;
        // 词长度越界说明 DOM 分词与歌词分词不一致：整行放弃映射，避免把字切到别的词上。
        if (cursor + length > base + lineText.length) {
            return [];
        }

        ranges.push(length > 0 ? { start: cursor, length } : null);
        cursor += length;
    }

    return ranges;
};

/** Union of the client rects covering glyphs [start, start + length). */
export const measureTideGlyphRange = (
    glyphs: TideGlyphRef[],
    start: number,
    length: number,
): TideRect | null => {
    const rect: TideRect = { left: Infinity, top: Infinity, width: 0, height: 0 };
    let right = -Infinity;
    let bottom = -Infinity;
    let groupStart: TideGlyphRef | null = null;
    let groupNode: Text | null = null;
    let groupEnd = 0;

    const flush = () => {
        if (!groupStart || !groupNode) {
            return;
        }

        const range = document.createRange();
        range.setStart(groupStart.node, groupStart.offset);
        range.setEnd(groupNode, groupEnd);
        const rects = range.getClientRects();

        for (let index = 0; index < rects.length; index++) {
            const item = rects.item(index);
            if (!item || item.width < 0.5 || item.height < 0.5) {
                continue;
            }

            rect.left = Math.min(rect.left, item.left);
            rect.top = Math.min(rect.top, item.top);
            right = Math.max(right, item.right);
            bottom = Math.max(bottom, item.bottom);
        }
    };

    for (let index = start; index < start + length; index++) {
        const glyph = glyphs[index];
        if (!glyph) {
            break;
        }

        if (groupNode !== glyph.node) {
            flush();
            groupStart = glyph;
            groupNode = glyph.node;
        }

        groupEnd = glyph.offset + 1;
    }

    flush();

    if (!Number.isFinite(rect.left) || !Number.isFinite(right) || right - rect.left < 1) {
        return null;
    }

    rect.width = right - rect.left;
    rect.height = bottom - rect.top;
    return rect;
};
