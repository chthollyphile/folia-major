import React from 'react';
import { motion, MotionValue } from 'framer-motion';
import { type Theme, type Line } from '../../../types';
import { SECONDARY_TRACK_OPACITY } from '../../../utils/lyrics/subtitleTrackStyle';
import { colorWithAlpha } from '../colorMix';
import { type WordColorMatcher } from '../wordColoring';
import { MONET_SCROLL_TRANSITION, MONET_SUBTITLE_TRACK_STAGGER_S, type PositionedMonetLineEntry } from './monetRailLayout';
import { composeLineMasks, getClippedTextMask, getEdgeFadeMask, getLineMask } from './monetRailMasks';
import { MonetTimedTokenSpan } from './MonetRailTokens';

// src/components/visualizer/monet/MonetRailLine.tsx
// 歌词栏中的一行：位置、缩放、模糊与副字幕轨，按行状态切换静态或扫字渲染。

/** The chorus glow's [alpha, at %] stops: falls off smoothly to nothing at the ellipse's edge. */
const CHORUS_GLOW_STOPS: Array<[number, number]> = [[0.14, 0], [0.12, 15], [0.085, 35], [0.05, 55], [0.022, 72], [0.007, 87]];

export const MonetRailLine: React.FC<{
    entry: PositionedMonetLineEntry;
    currentTime: MotionValue<number>;
    theme: Theme;
    lyricFontPx: number;
    fontStack: string;
    translationFontStack: string;
    glowBufferPx: number;
    vGlowBufferPx: number;
    fontsEpoch: number;
    wordColorMatchers: WordColorMatcher[];
    audioPower?: MotionValue<number>;
    onLineSeek?: (line: Line) => void;
    canSeek?: boolean;
    disableEntryMotion?: boolean;
    renderStaticPassed?: boolean;
}> = ({ entry, currentTime, theme, lyricFontPx, fontStack, translationFontStack, glowBufferPx, vGlowBufferPx, fontsEpoch, wordColorMatchers, audioPower, onLineSeek, canSeek = false, disableEntryMotion = false, renderStaticPassed = false }) => {
    const initialOffset = entry.offset >= 0 ? 34 : -34;
    const exitOffset = entry.status === 'passed' || entry.offset < 0 ? -38 : 38;
    // The active lyric must never be truncated, so its box is sized by its own wrapped
    // content instead of the pre-measured height, and it carries no truncation fade.
    // Context lines keep the fixed two-line box that keeps the rail compact.
    const isActiveLine = entry.status === 'active';
    const textMask = isActiveLine
        ? undefined
        : getClippedTextMask(
            entry.layout.isTextClipped,
            vGlowBufferPx + entry.layout.textPaddingTopPx + entry.layout.textContentHeightPx,
            Math.max(lyricFontPx * 0.55, 12),
        );
    const textEdgeMask = getEdgeFadeMask(entry.layout.isTextOverflowingWidth, Math.max(lyricFontPx * 0.9, 24));
    const textMaskStyle = composeLineMasks(textMask, textEdgeMask);
    const handleSeek = (event: React.MouseEvent | React.KeyboardEvent) => {
        if (!canSeek) {
            return;
        }

        event.stopPropagation();
        onLineSeek?.(entry.line);
    };
    const handleClickSeek = (event: React.MouseEvent<HTMLDivElement>) => {
        handleSeek(event);
        event.currentTarget.blur();
    };

    return (
        <motion.div
            role={canSeek ? 'button' : undefined}
            tabIndex={canSeek ? 0 : undefined}
            onClick={canSeek ? handleClickSeek : undefined}
            onKeyDown={canSeek ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleSeek(event);
                }
            } : undefined}
            className={`absolute top-0 min-w-0 will-change-transform ${canSeek ? 'cursor-pointer' : ''}`}
            initial={disableEntryMotion ? false : {
                opacity: 0,
                y: entry.y + initialOffset,
                scale: entry.tone.scale * 0.98,
                filter: 'blur(5px)',
            }}
            animate={{
                opacity: entry.tone.opacity,
                y: entry.y,
                scale: entry.tone.scale,
                filter: `blur(${entry.tone.blurPx}px)`,
            }}
            exit={disableEntryMotion ? undefined : {
                opacity: 0,
                y: entry.y + exitOffset,
                scale: entry.tone.scale * 0.98,
                filter: 'blur(6px)',
                transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
            }}
            transition={MONET_SCROLL_TRANSITION}
            style={{
                left: `${glowBufferPx}px`,
                right: `${glowBufferPx}px`,
                height: entry.layout.visualHeightPx,
                transformOrigin: 'left top',
                zIndex: entry.tone.zIndex,
            }}
        >
            {entry.line.isChorus && (
                <motion.div
                    className="absolute inset-x-0 -inset-y-14 pointer-events-none -z-10"
                    initial={{ opacity: 0 }}
                    animate={{
                        opacity: entry.status === 'active' ? 1 : 0,
                        scale: entry.status === 'active' ? 1.02 : 0.96,
                    }}
                    transition={{ duration: 0.45, ease: 'easeOut' }}
                    style={{
                        // An ellipse touching the box's sides, reaching past the line above and below,
                        // gone before any edge: no straight edge shows, and no blur is needed to hide one.
                        background: `radial-gradient(closest-side, ${CHORUS_GLOW_STOPS.map(([alpha, at]) => `${colorWithAlpha(theme.accentColor, alpha)} ${at}%`).join(', ')}, transparent 100%)`,
                    }}
                />
            )}
            <div
                className="min-w-0 overflow-hidden pointer-events-none"
                style={{
                    marginLeft: `-${glowBufferPx}px`,
                    marginRight: `-${glowBufferPx}px`,
                    paddingLeft: `${glowBufferPx}px`,
                    paddingRight: `${glowBufferPx}px`,
                    marginTop: `-${vGlowBufferPx}px`,
                    marginBottom: `-${vGlowBufferPx}px`,
                    paddingTop: `${entry.layout.textPaddingTopPx + vGlowBufferPx}px`,
                    paddingBottom: `${entry.layout.textPaddingBottomPx + vGlowBufferPx}px`,
                    height: isActiveLine
                        ? undefined
                        : `${entry.layout.textHeightPx + vGlowBufferPx * 2}px`,
                    boxSizing: 'border-box',
                    fontFamily: fontStack,
                    fontSize: lyricFontPx,
                    fontWeight: entry.tone.fontWeight,
                    lineHeight: `${entry.layout.lineHeightPx}px`,
                    letterSpacing: 0,
                    ...textMaskStyle,
                    textShadow: entry.status === 'active'
                        ? `0 14px 34px ${colorWithAlpha(theme.backgroundColor, 0.22)}`
                        : 'none',
                }}
            >
                <MonetTimedTokenSpan
                    entry={entry}
                    currentTime={currentTime}
                    accentColor={colorWithAlpha(theme.primaryColor, 0.98)}
                    fontPx={lyricFontPx}
                    fontStack={fontStack}
                    fontsEpoch={fontsEpoch}
                    wordColorMatchers={wordColorMatchers}
                    isChorus={entry.line.isChorus}
                    chorusAccentColor={theme.accentColor}
                    audioPower={audioPower}
                    renderStaticPassed={renderStaticPassed}
                />
            </div>
            {entry.layout.subtitleTracks.map((track, trackIndex) => {
                // Each row is cut at its own row cap, so the fade is per track. The second row steps
                // down in colour alpha too (0.68 is the single-row alpha); size and weight were set at measure time.
                const trackMask = getLineMask(track.isClipped, Math.max(track.fontPx * 0.65, 10));
                return (
                    <motion.div
                        key={track.role}
                        data-subtitle-track={track.role}
                        className="min-w-0 overflow-hidden whitespace-pre-wrap break-words"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1], delay: trackIndex * MONET_SUBTITLE_TRACK_STAGGER_S }}
                        style={{
                            marginLeft: `-${glowBufferPx}px`,
                            marginRight: `-${glowBufferPx}px`,
                            paddingLeft: `${glowBufferPx}px`,
                            paddingRight: `${glowBufferPx}px`,
                            height: track.heightPx,
                            paddingTop: track.paddingTopPx,
                            paddingBottom: track.paddingBottomPx,
                            boxSizing: 'border-box',
                            color: colorWithAlpha(theme.primaryColor, trackIndex > 0 ? 0.68 * SECONDARY_TRACK_OPACITY : 0.68),
                            fontFamily: translationFontStack,
                            fontSize: track.fontPx,
                            fontWeight: track.fontWeight,
                            lineHeight: `${track.lineHeightPx}px`,
                            letterSpacing: 0,
                            WebkitMaskImage: trackMask,
                            maskImage: trackMask,
                            WebkitMaskRepeat: 'no-repeat',
                            maskRepeat: 'no-repeat',
                            WebkitMaskSize: '100% 100%',
                            maskSize: '100% 100%',
                        }}
                    >
                        {track.text}
                    </motion.div>
                );
            })}
        </motion.div>
    );
};
