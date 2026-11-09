

// src/components/visualizer/monet/monetRailMasks.ts
// 行的遮罩：上下裁切渐隐、超宽 token 行尾一侧渐隐（RTL 行在左缘），以及两者的合成。

export const getLineMask = (isClipped: boolean, fadePx: number) => (
    isClipped
        ? `linear-gradient(180deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
        : undefined
);

/**
 * Cuts a truncated context line at its last visible text row rather than at the box edge.
 * `overflow: hidden` clips at the padding box, and that padding carries `vGlowBufferPx`
 * (1.2x the lyric font) of glow headroom — at large font scales that is more than a whole line,
 * so the clipped row stays visible and lands on top of the neighbouring lyric.
 */
export const getClippedTextMask = (
    isClipped: boolean,
    contentBottomPx: number,
    fadePx: number,
) => {
    if (!isClipped) {
        return undefined;
    }

    const solidEndPx = Math.max(contentBottomPx - fadePx, 0);
    return `linear-gradient(180deg, black 0px, black ${solidEndPx}px, transparent ${contentBottomPx}px)`;
};

/**
 * Softens the line-end edge so a token wider than the column fades out instead of being sliced mid-glyph:
 * the right edge, or the left one for an RTL line, which overflows to its left.
 */
export const getEdgeFadeMask = (isOverflowing: boolean, fadePx: number, rtl = false) => (
    isOverflowing
        ? `linear-gradient(${rtl ? 270 : 90}deg, black 0%, black calc(100% - ${fadePx}px), transparent 100%)`
        : undefined
);

/** Intersects the vertical clip fade with the horizontal edge fade, so a line can carry both. */
export const composeLineMasks = (...masks: (string | undefined)[]) => {
    const layers = masks.filter((mask): mask is string => Boolean(mask));
    if (layers.length === 0) {
        return undefined;
    }

    return {
        WebkitMaskImage: layers.join(', '),
        maskImage: layers.join(', '),
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskSize: '100% 100%',
        maskSize: '100% 100%',
        ...(layers.length > 1
            ? { WebkitMaskComposite: 'source-in', maskComposite: 'intersect' }
            : {}),
    } as const;
};
