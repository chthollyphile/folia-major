// src/components/visualizer/backgrounds/tide/tideGlyphDom.ts
// Turns the on-screen lyric text (the foreground visualizer's own DOM) into measurable glyph
// positions. The background never renders lyrics itself: it only asks where the sung characters
// currently sit, a few of them at a time, so it can stir the fluid where the lyrics move.

export interface TideGlyphRef {
    node: Text;
    offset: number;
}

export interface TideRect {
    left: number;
    top: number;
    width: number;
    height: number;
}

/** Characters that never carry a lyric anchor and would only confuse text alignment. */
const TIDE_SKIPPED_SELECTOR = 'canvas,svg,[data-tide-skip-anchor]';

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

/** Finds the occurrence of one word that is closest to where the line reading has arrived. */
export const findTideClusterIndex = (text: string, needle: string, searchFrom: number): number => {
    if (!needle) {
        return -1;
    }

    let index = text.indexOf(needle, Math.max(0, searchFrom));
    const nearest = text.indexOf(needle);
    if (index < 0) {
        return nearest;
    }

    if (nearest >= 0 && index - searchFrom > needle.length * 3 + 12) {
        return nearest;
    }

    return index;
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
