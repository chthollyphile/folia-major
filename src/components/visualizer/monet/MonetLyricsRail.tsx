import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, MotionValue } from 'framer-motion';
import { type Theme, type AudioBands, type Line, type SubtitleContentMode } from '../../../types';
import { resolveThemeFontWeight } from '../../../utils/fontStacks';
import { SECONDARY_TRACK_FONT_WEIGHT_FALLBACK } from '../../../utils/lyrics/subtitleTrackStyle';
import { useFontsEpoch } from '../../../hooks/useFontsEpoch';
import { prepareWordColorMatchers } from '../wordColoring';
import { MONET_RAIL_BASE_MAX_HEIGHT_PX, MONET_RAIL_BASE_MAX_WIDTH_PX, clearMonetMeasurementCaches, type MonetVisibleLineEntry } from './monetLyricsModel';
import { MONET_RAIL_MIN_ROWS, MONET_RAIL_SCROLL_EVENT_OPTIONS, MONET_SCROLL_IDLE_RESET_MS, MONET_SCROLL_STEP_PX, MONET_TOUCH_STEP_PX, type MonetLayoutCache, buildPositionedEntries, buildScrollableRailEntries, clamp, clampScrollSteps, getScrollDirection } from './monetRailLayout';
import { useMonetRailSize } from './useMonetRailSize';
import { MonetRailLine } from './MonetRailLine';

// src/components/visualizer/monet/MonetLyricsRail.tsx
// Renders Monet lyrics on fixed transform tracks so scrolling stays smooth without layout reflow jumps.

interface MonetLyricsRailProps {
    entries: MonetVisibleLineEntry[];
    lines: Line[];
    currentLineIndex: number;
    currentTime: MotionValue<number>;
    theme: Theme;
    lyricFontPx: number;
    inactiveFontPx: number;
    translationFontPx: number;
    fontStack: string;
    translationFontStack?: string;
    subtitleTheme?: Theme;
    keywordColoringEnabled: boolean;
    emptyText: string;
    /** Which subtitle rows sit under the active lyric; 'both' stacks romanization over translation. */
    subtitleContentMode?: SubtitleContentMode;
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    seekDisabled?: boolean;
    /** Shared large-screen factor. Owned by VisualizerMonet so the column and the font scale together. */
    layoutScale?: number;
    /** Mirrored layout (#1124): the rail sits at the column's right edge and its lines are set flush right. */
    alignEnd?: boolean;
}

const MonetLyricsRail: React.FC<MonetLyricsRailProps> = ({
    entries,
    lines,
    currentLineIndex,
    currentTime,
    theme,
    lyricFontPx,
    inactiveFontPx,
    translationFontPx,
    fontStack,
    translationFontStack = fontStack,
    subtitleTheme,
    keywordColoringEnabled,
    emptyText,
    subtitleContentMode = 'translation',
    audioPower,
    audioBands,
    onLyricLineSeek,
    seekDisabled = false,
    layoutScale = 1,
    alignEnd = false,
}) => {
    const railRef = useRef<HTMLDivElement | null>(null);
    const layoutCacheRef = useRef<MonetLayoutCache>(new Map());
    const manualScrollResetRef = useRef<number | null>(null);
    const wheelAccumulatorRef = useRef(0);
    const wheelDirectionRef = useRef(0);
    const touchLastYRef = useRef<number | null>(null);
    const touchAccumulatorRef = useRef(0);
    const touchDirectionRef = useRef(0);
    const [manualScrollAnchorIndex, setManualScrollAnchorIndex] = useState<number | null>(null);
    const railSize = useMonetRailSize(railRef);
    const fontsEpoch = useFontsEpoch();
    const handledFontsEpochRef = useRef(0);
    const glowBufferPx = Math.round(lyricFontPx * 1.2);
    const vGlowBufferPx = Math.round(lyricFontPx * 1.2);
    // Grows with the same factor as the font, so the column-to-font ratio — and the wrapping — holds.
    const railMaxWidthPx = Math.round(MONET_RAIL_BASE_MAX_WIDTH_PX * layoutScale);
    const railMaxHeightPx = Math.round(Math.max(
        MONET_RAIL_BASE_MAX_HEIGHT_PX * layoutScale,
        lyricFontPx * 1.18 * MONET_RAIL_MIN_ROWS,
    ));
    const canSeek = Boolean(onLyricLineSeek) && !seekDisabled;
    const lyricFontWeight = resolveThemeFontWeight(theme, 600);
    const translationFontWeight = resolveThemeFontWeight(subtitleTheme ?? theme, 500);
    const secondaryTranslationFontWeight = resolveThemeFontWeight(subtitleTheme ?? theme, SECONDARY_TRACK_FONT_WEIGHT_FALLBACK);

    const visibleEntries = useMemo(
        () => manualScrollAnchorIndex === null
            ? entries
            : buildScrollableRailEntries(lines, manualScrollAnchorIndex, currentLineIndex),
        [currentLineIndex, entries, lines, manualScrollAnchorIndex],
    );
    const isManualScrolling = manualScrollAnchorIndex !== null;

    const positionedEntries = useMemo(
        () => {
            // A line measured against a fallback face wraps differently from what is painted, which
            // under-reserves its height and drops the translation onto the next lyric. Invalidate
            // here rather than in an effect, so the recompute below already sees fresh metrics.
            if (handledFontsEpochRef.current !== fontsEpoch) {
                handledFontsEpochRef.current = fontsEpoch;
                clearMonetMeasurementCaches();
                layoutCacheRef.current.clear();
            }

            return buildPositionedEntries(
                visibleEntries,
                railSize,
                theme,
                lyricFontPx,
                inactiveFontPx,
                {
                    translationFontPx,
                    fontStack,
                    translationFontStack,
                    fontWeight: lyricFontWeight,
                    translationFontWeight,
                    secondaryTranslationFontWeight,
                    subtitleContentMode,
                },
                glowBufferPx,
                layoutCacheRef.current,
            );
        },
        [visibleEntries, railSize, theme, lyricFontPx, inactiveFontPx, translationFontPx, fontStack, translationFontStack, lyricFontWeight, translationFontWeight, secondaryTranslationFontWeight, glowBufferPx, subtitleContentMode, fontsEpoch],
    );
    const wordColorMatchers = useMemo(
        () => prepareWordColorMatchers(theme.wordColors, keywordColoringEnabled),
        [keywordColoringEnabled, theme.wordColors],
    );
    const getFallbackAnchorIndex = useCallback(() => {
        if (manualScrollAnchorIndex !== null) {
            return manualScrollAnchorIndex;
        }
        if (currentLineIndex >= 0) {
            return currentLineIndex;
        }
        return entries.find(entry => entry.offset === 0)?.index ?? 0;
    }, [currentLineIndex, entries, manualScrollAnchorIndex]);

    const scheduleManualScrollReset = useCallback(() => {
        if (manualScrollResetRef.current !== null) {
            window.clearTimeout(manualScrollResetRef.current);
        }
        manualScrollResetRef.current = window.setTimeout(() => {
            setManualScrollAnchorIndex(null);
            wheelAccumulatorRef.current = 0;
            wheelDirectionRef.current = 0;
            touchAccumulatorRef.current = 0;
            touchDirectionRef.current = 0;
            manualScrollResetRef.current = null;
        }, MONET_SCROLL_IDLE_RESET_MS);
    }, []);

    const moveManualScrollAnchor = useCallback((steps: number) => {
        if (lines.length === 0) {
            return;
        }

        setManualScrollAnchorIndex(current => {
            const baseIndex = current ?? getFallbackAnchorIndex();
            return Math.round(clamp(baseIndex + steps, 0, lines.length - 1));
        });
        scheduleManualScrollReset();
    }, [getFallbackAnchorIndex, lines.length, scheduleManualScrollReset]);

    const handleRailWheel = useCallback((event: WheelEvent) => {
        if (lines.length === 0) {
            return;
        }

        if (event.cancelable) {
            event.preventDefault();
        }
        event.stopPropagation();
        const direction = getScrollDirection(event.deltaY);
        if (direction !== 0 && wheelDirectionRef.current !== 0 && direction !== wheelDirectionRef.current) {
            wheelAccumulatorRef.current = 0;
        }
        wheelDirectionRef.current = direction || wheelDirectionRef.current;
        wheelAccumulatorRef.current += event.deltaY;
        const steps = clampScrollSteps(Math.trunc(wheelAccumulatorRef.current / MONET_SCROLL_STEP_PX));
        if (steps !== 0) {
            wheelAccumulatorRef.current = 0;
            moveManualScrollAnchor(steps);
        } else {
            scheduleManualScrollReset();
        }
    }, [lines.length, moveManualScrollAnchor, scheduleManualScrollReset]);

    const handleRailTouchStart = useCallback((event: TouchEvent) => {
        if (lines.length === 0) {
            return;
        }

        event.stopPropagation();
        touchLastYRef.current = event.touches[0]?.clientY ?? null;
        touchAccumulatorRef.current = 0;
        touchDirectionRef.current = 0;
        setManualScrollAnchorIndex(getFallbackAnchorIndex());
        scheduleManualScrollReset();
    }, [getFallbackAnchorIndex, lines.length, scheduleManualScrollReset]);

    const handleRailTouchMove = useCallback((event: TouchEvent) => {
        if (lines.length === 0 || touchLastYRef.current === null) {
            return;
        }

        event.stopPropagation();
        const nextY = event.touches[0]?.clientY;
        if (typeof nextY !== 'number') {
            return;
        }

        const deltaY = touchLastYRef.current - nextY;
        touchLastYRef.current = nextY;
        const direction = getScrollDirection(deltaY);
        if (direction !== 0 && touchDirectionRef.current !== 0 && direction !== touchDirectionRef.current) {
            touchAccumulatorRef.current = 0;
        }
        touchDirectionRef.current = direction || touchDirectionRef.current;
        touchAccumulatorRef.current += deltaY;
        const steps = clampScrollSteps(Math.trunc(touchAccumulatorRef.current / MONET_TOUCH_STEP_PX));
        if (steps !== 0) {
            touchAccumulatorRef.current = 0;
            moveManualScrollAnchor(steps);
        } else {
            scheduleManualScrollReset();
        }
    }, [lines.length, moveManualScrollAnchor, scheduleManualScrollReset]);

    const handleRailTouchEnd = useCallback(() => {
        touchLastYRef.current = null;
        touchDirectionRef.current = 0;
        touchAccumulatorRef.current = 0;
        scheduleManualScrollReset();
    }, [scheduleManualScrollReset]);

    useEffect(() => {
        const rail = railRef.current;
        if (!rail) {
            return undefined;
        }

        rail.addEventListener('wheel', handleRailWheel, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchstart', handleRailTouchStart, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchmove', handleRailTouchMove, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchend', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        rail.addEventListener('touchcancel', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);

        return () => {
            rail.removeEventListener('wheel', handleRailWheel, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchstart', handleRailTouchStart, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchmove', handleRailTouchMove, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchend', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);
            rail.removeEventListener('touchcancel', handleRailTouchEnd, MONET_RAIL_SCROLL_EVENT_OPTIONS);
        };
    }, [handleRailTouchEnd, handleRailTouchMove, handleRailTouchStart, handleRailWheel]);

    const handleLineSeek = useCallback((line: Line) => {
        if (!canSeek) {
            return;
        }

        onLyricLineSeek?.(line.startTime);
        setManualScrollAnchorIndex(null);
    }, [canSeek, onLyricLineSeek]);

    useEffect(() => {
        return () => {
            if (manualScrollResetRef.current !== null) {
                window.clearTimeout(manualScrollResetRef.current);
            }
        };
    }, []);

    return (
        <div
            ref={railRef}
            className="relative select-none overflow-hidden"
            style={{
                height: `clamp(280px, 52vh, ${railMaxHeightPx}px)`,
                maxWidth: `${railMaxWidthPx}px`,
                // Flush right, the rail keeps its text edge on the column's right edge whatever its width.
                marginLeft: alignEnd ? 'auto' : `-${glowBufferPx}px`,
                marginRight: `-${glowBufferPx}px`,
                paddingLeft: `${glowBufferPx}px`,
                paddingRight: `${glowBufferPx}px`,
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 11%, black 88%, transparent 100%)',
                maskImage: 'linear-gradient(to bottom, transparent 0%, black 11%, black 88%, transparent 100%)',
            }}
        >
            {positionedEntries.length > 0 ? (
                <AnimatePresence initial={false}>
                    {positionedEntries.map(entry => (
                        <MonetRailLine
                            key={entry.key}
                            entry={entry}
                            currentTime={currentTime}
                            theme={theme}
                            lyricFontPx={lyricFontPx}
                            fontStack={fontStack}
                            translationFontStack={translationFontStack}
                            glowBufferPx={glowBufferPx}
                            vGlowBufferPx={vGlowBufferPx}
                            fontsEpoch={fontsEpoch}
                            wordColorMatchers={wordColorMatchers}
                            audioPower={audioPower}
                            onLineSeek={handleLineSeek}
                            canSeek={canSeek}
                            disableEntryMotion={isManualScrolling}
                            renderStaticPassed={isManualScrolling && entry.index !== currentLineIndex}
                            alignEnd={alignEnd}
                        />
                    ))}
                </AnimatePresence>
            ) : emptyText ? (
                <div
                    className={`absolute ${alignEnd ? 'right-0' : 'left-0'} top-1/2 -translate-y-1/2`}
                    style={{
                        color: theme.primaryColor,
                        fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
                        fontWeight: lyricFontWeight,
                        letterSpacing: 0,
                        opacity: 0.72,
                    }}
                >
                    {emptyText}
                </div>
            ) : null}
        </div>
    );
};

export default MonetLyricsRail;
