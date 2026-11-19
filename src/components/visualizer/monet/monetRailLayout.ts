import { type Theme, type Line } from '../../../types';
import { colorWithAlpha } from '../../../utils/colorMix';
import { resolveWordColor } from '../wordColoring';
import { MONET_SCROLL_SPRING, MONET_SCALE_SPRING } from './monetLyricMotion';
import { buildMonetLayoutCacheKey, measureMonetLineLayout, type MonetLineLayoutInputs, type MonetLineStatus, type MonetMeasuredLineLayout, type MonetVisibleLineEntry } from './monetLyricsModel';
import { rememberBounded } from '../../../utils/textMeasureCache';

// src/components/visualizer/monet/monetRailLayout.ts
// Monet 歌词栏的排布：栏尺寸与间距常量、行色调与状态、可滚动条目、测量缓存，以及按固定轨道算出的行位置。

export interface MonetRailSize {
    width: number;
    height: number;
}

interface MonetLineTone {
    opacity: number;
    scale: number;
    blurPx: number;
    baseColor: string;
    fontWeight: number;
    zIndex: number;
}

export interface PositionedMonetLineEntry extends MonetVisibleLineEntry {
    y: number;
    tone: MonetLineTone;
    layout: MonetMeasuredLineLayout;
    scaledHeight: number;
}

export type MonetLayoutCache = Map<string, MonetMeasuredLineLayout>;

const MONET_RAIL_WIDTH_FALLBACK_PX = 680;
const MONET_RAIL_HEIGHT_FALLBACK_PX = 340;
// Stagger between subtitle rows when they fade in, so the second row reads as following the first.
export const MONET_SUBTITLE_TRACK_STAGGER_S = 0.04;
const MONET_ACTIVE_GAP_PX = 18;
const MONET_INACTIVE_GAP_PX = 14;
// Ratios reproduce the fixed gaps above at the default 36.5px lyric font, so nothing changes at
// normal sizes; past that the gaps grow with the text instead of collapsing into it.
// The height cap must clear the active block at large font scales, where a narrow column pushes
// a normal lyric past four rows. Seven rows stays below the base cap at default sizes, so this
// only ever raises the ceiling for oversized text on a tall display.
export const MONET_RAIL_MIN_ROWS = 7;
const MONET_ACTIVE_GAP_RATIO = 0.49;
const MONET_INACTIVE_GAP_RATIO = 0.38;
export const MONET_SCROLL_IDLE_RESET_MS = 1800;
export const MONET_SCROLL_STEP_PX = 72;
export const MONET_TOUCH_STEP_PX = 52;
const MONET_SCROLL_BEFORE = 4;
const MONET_SCROLL_AFTER = 4;
const MONET_LAYOUT_CACHE_LIMIT = 240;
export const MONET_RAIL_SCROLL_EVENT_OPTIONS: AddEventListenerOptions = { passive: false };
export const MONET_SCROLL_TRANSITION = {
    y: { type: 'spring', ...MONET_SCROLL_SPRING },
    scale: { type: 'spring', ...MONET_SCALE_SPRING },
    opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
    filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
} as const;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export const clampScrollSteps = (steps: number) => Math.max(-1, Math.min(1, steps));
export const getScrollDirection = (delta: number) => (delta === 0 ? 0 : delta > 0 ? 1 : -1);

export const resolveMonetWordColor = (
    wordText: string,
    theme: Theme,
    fallbackColor: string,
    keywordColoringEnabled = true,
): string => {
    return resolveWordColor(wordText, theme.wordColors, fallbackColor, {
        keywordColoringEnabled,
        cjkMatchMode: 'exact',
    });
};

const resolveLineTone = (
    entry: MonetVisibleLineEntry,
    theme: Theme,
    inactiveScale: number,
): MonetLineTone => {
    if (entry.status === 'active') {
        return {
            opacity: 1,
            scale: 1,
            blurPx: 0,
            baseColor: colorWithAlpha(theme.primaryColor, 0.34),
            fontWeight: 600,
            zIndex: 4,
        };
    }

    const distance = Math.max(Math.abs(entry.offset), 1);
    const isWaiting = entry.status === 'waiting';
    const scale = clamp(inactiveScale * Math.pow(0.9, distance - 1), 0.68, 0.92);

    return {
        opacity: isWaiting
            ? clamp(0.72 - (distance - 1) * 0.18, 0.36, 0.72)
            : clamp(0.52 - (distance - 1) * 0.12, 0.28, 0.52),
        scale,
        blurPx: isWaiting
            ? distance === 1 ? 0.7 : 1.8 + (distance - 2) * 0.8
            : 1.1 + (distance - 1) * 0.7,
        baseColor: colorWithAlpha(theme.primaryColor, isWaiting ? 0.46 : 0.36),
        fontWeight: 500,
        zIndex: isWaiting ? 3 - distance : 2 - distance,
    };
};

const resolveLineGap = (
    previous: PositionedMonetLineEntry,
    next: PositionedMonetLineEntry,
    lyricFontPx: number,
): number => (
    previous.status === 'active' || next.status === 'active'
        ? Math.max(MONET_ACTIVE_GAP_PX, lyricFontPx * MONET_ACTIVE_GAP_RATIO)
        : Math.max(MONET_INACTIVE_GAP_PX, lyricFontPx * MONET_INACTIVE_GAP_RATIO)
);

const resolveRailLineStatus = (lineIndex: number, activeLineIndex: number): MonetLineStatus => {
    if (lineIndex === activeLineIndex) {
        return 'active';
    }
    if (activeLineIndex >= 0 && lineIndex < activeLineIndex) {
        return 'passed';
    }
    return 'waiting';
};

export const buildScrollableRailEntries = (
    lines: Line[],
    anchorIndex: number,
    activeLineIndex: number,
): MonetVisibleLineEntry[] => {
    if (lines.length === 0) {
        return [];
    }

    const safeAnchorIndex = Math.round(clamp(anchorIndex, 0, lines.length - 1));
    const startIndex = Math.max(0, safeAnchorIndex - MONET_SCROLL_BEFORE);
    const endIndex = Math.min(lines.length - 1, safeAnchorIndex + MONET_SCROLL_AFTER);
    const nextEntries: MonetVisibleLineEntry[] = [];

    for (let index = startIndex; index <= endIndex; index += 1) {
        const line = lines[index];
        nextEntries.push({
            key: `${index}-${line.startTime}-${line.fullText}`,
            line,
            index,
            offset: index - safeAnchorIndex,
            status: resolveRailLineStatus(index, activeLineIndex),
        });
    }

    return nextEntries;
};

const getOrMeasureMonetLineLayout = (
    cache: MonetLayoutCache,
    entry: MonetVisibleLineEntry,
    inputs: MonetLineLayoutInputs,
) => {
    const cacheKey = buildMonetLayoutCacheKey(entry, inputs);
    const cached = cache.get(cacheKey);
    if (cached) {
        return cached;
    }

    const layout = measureMonetLineLayout({
        line: entry.line,
        status: entry.status,
        ...inputs,
    });
    return rememberBounded(cache, cacheKey, layout, MONET_LAYOUT_CACHE_LIMIT);
};

export const buildPositionedEntries = (
    entries: MonetVisibleLineEntry[],
    railSize: MonetRailSize,
    theme: Theme,
    lyricFontPx: number,
    inactiveFontPx: number,
    layoutInputs: Omit<MonetLineLayoutInputs, 'fontPx' | 'maxWidthPx'>,
    glowBufferPx: number,
    layoutCache: MonetLayoutCache,
): PositionedMonetLineEntry[] => {
    const railWidth = railSize.width || MONET_RAIL_WIDTH_FALLBACK_PX;
    const railHeight = railSize.height || MONET_RAIL_HEIGHT_FALLBACK_PX;
    const inactiveScale = clamp(inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92);
    const contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 0);
    const measureInputs: MonetLineLayoutInputs = {
        ...layoutInputs,
        fontPx: lyricFontPx,
        maxWidthPx: contentWidthPx - 8,
    };

    const measuredEntries: PositionedMonetLineEntry[] = entries.map(entry => {
        const tone = {
            ...resolveLineTone(entry, theme, inactiveScale),
            fontWeight: layoutInputs.fontWeight,
        };
        const layout = getOrMeasureMonetLineLayout(layoutCache, entry, measureInputs);

        return {
            ...entry,
            y: 0,
            tone,
            layout,
            scaledHeight: layout.visualHeightPx * tone.scale,
        };
    });

    if (measuredEntries.length === 0) {
        return [];
    }

    const anchorIndex = Math.max(0, measuredEntries.findIndex(entry => entry.offset === 0));
    const focusCenterY = railHeight * 0.46;
    measuredEntries[anchorIndex].y = focusCenterY - measuredEntries[anchorIndex].scaledHeight / 2;

    for (let index = anchorIndex + 1; index < measuredEntries.length; index += 1) {
        const previous = measuredEntries[index - 1];
        const current = measuredEntries[index];
        current.y = previous.y + previous.scaledHeight + resolveLineGap(previous, current, lyricFontPx);
    }

    for (let index = anchorIndex - 1; index >= 0; index -= 1) {
        const current = measuredEntries[index];
        const next = measuredEntries[index + 1];
        current.y = next.y - current.scaledHeight - resolveLineGap(current, next, lyricFontPx);
    }

    return measuredEntries;
};
