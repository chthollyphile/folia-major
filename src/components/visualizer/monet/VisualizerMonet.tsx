import React, { useMemo } from 'react';
import { AnimatePresence, motion, useTransform, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_MONET_TUNING,
    type Line,
    type MonetBackgroundImage,
    type MonetTuning,
} from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSharedProps } from '../definition';
import { useVisualizerRuntime } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import MonetBackground from './MonetBackground';
import AudioOverlay from './AudioOverlay';

// src/components/visualizer/monet/VisualizerMonet.tsx
// Monet keeps lyrics and translation in one aligned rail so the poster layout reads as a single synchronized group.
type VisualizerMonetProps = VisualizerSharedProps;

interface MonetDisplayToken {
    text: string;
    startTime: number | null;
    endTime: number | null;
    key: string;
}

export interface MonetLyricContext {
    previousLine: Line | null;
    activeLine: Line | null;
    nextLine: Line | null;
}

/** Builds a stable display-token list so fullText punctuation and spaces survive around timed lyric words. */
export const buildMonetDisplayTokens = (line: Line): MonetDisplayToken[] => {
    if (line.words.length === 0) {
        return [{
            text: line.fullText,
            startTime: line.startTime,
            endTime: getLineRenderEndTime(line),
            key: `${line.startTime}-full`,
        }];
    }

    const tokens: MonetDisplayToken[] = [];
    let cursor = 0;
    line.words.forEach((word, index) => {
        const matchIndex = line.fullText.indexOf(word.text, cursor);
        if (matchIndex > cursor) {
            tokens.push({
                text: line.fullText.slice(cursor, matchIndex),
                startTime: index > 0 ? line.words[index - 1].endTime : line.startTime,
                endTime: word.startTime,
                key: `${line.startTime}-static-${cursor}`,
            });
        }

        tokens.push({
            text: word.text,
            startTime: word.startTime,
            endTime: word.endTime,
            key: `${line.startTime}-${index}-${word.startTime}`,
        });

        cursor = matchIndex === -1 ? cursor : matchIndex + word.text.length;
    });

    if (cursor < line.fullText.length) {
        tokens.push({
            text: line.fullText.slice(cursor),
            startTime: line.words[line.words.length - 1]?.endTime ?? line.startTime,
            endTime: getLineRenderEndTime(line),
            key: `${line.startTime}-tail`,
        });
    }

    return tokens;
};

export const resolveMonetLyricContext = (
    lines: Line[],
    currentLineIndex: number,
    activeLine: Line | null,
    recentCompletedLine: Line | null,
    nextLine: Line | null,
): MonetLyricContext => {
    if (!activeLine) {
        return {
            previousLine: recentCompletedLine,
            activeLine: null,
            nextLine,
        };
    }

    return {
        previousLine: currentLineIndex > 0 ? lines[currentLineIndex - 1] ?? null : null,
        activeLine,
        nextLine: lines[currentLineIndex + 1] ?? nextLine,
    };
};

const MonetTimedTokenSpan: React.FC<{
    token: MonetDisplayToken;
    currentTime: MotionValue<number>;
    isActive: boolean;
    accentColor: string;
}> = ({ token, currentTime, isActive, accentColor }) => {
    const opacity = useTransform(currentTime, latest => {
        if (!isActive || token.startTime === null || token.endTime === null) {
            return isActive ? 1 : 0.48;
        }

        if (latest <= token.startTime) {
            return 0.28;
        }
        if (latest >= token.endTime) {
            return 1;
        }

        return 0.28 + ((latest - token.startTime) / Math.max(0.001, token.endTime - token.startTime)) * 0.72;
    });
    const y = useTransform(currentTime, latest => {
        if (!isActive || token.startTime === null || token.endTime === null) {
            return 0;
        }
        if (latest <= token.startTime || latest >= token.endTime) {
            return 0;
        }

        const progress = (latest - token.startTime) / Math.max(0.001, token.endTime - token.startTime);
        return (1 - progress) * 5;
    });

    return (
        <motion.span
            style={{
                opacity,
                y,
                color: isActive ? accentColor : undefined,
                display: 'inline-block',
                whiteSpace: 'pre-wrap',
            }}
        >
            {token.text}
        </motion.span>
    );
};

const MonetLyricPair: React.FC<{
    line: Line;
    currentTime: MotionValue<number>;
    theme: VisualizerSharedProps['theme'];
    isActive: boolean;
    isNext?: boolean;
    lyricsFocusScale: number;
}> = ({ line, currentTime, theme, isActive, isNext = false, lyricsFocusScale }) => {
    const tokens = useMemo(() => buildMonetDisplayTokens(line), [line]);
    const primaryColor = isNext ? colorWithAlpha(theme.primaryColor, 0.54) : theme.primaryColor;
    const secondaryColor = isNext ? colorWithAlpha(theme.secondaryColor, 0.5) : theme.secondaryColor;

    return (
        <motion.div
            layout
            className="space-y-2"
            initial={{ opacity: isActive ? 0.45 : 0.3, y: 10 }}
            animate={{
                opacity: isActive ? 1 : isNext ? 0.48 : 0.62,
                y: 0,
                scale: isActive ? lyricsFocusScale : isNext ? 0.96 : 0.985,
            }}
            exit={{ opacity: 0, y: -14 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
        >
            <div
                className="font-semibold tracking-[-0.02em] leading-[1.08] whitespace-pre-wrap"
                style={{
                    color: primaryColor,
                    fontSize: isActive ? 'clamp(2.3rem, 5.6vw, 4.8rem)' : 'clamp(1.15rem, 2.7vw, 1.8rem)',
                    textShadow: isActive ? `0 12px 28px ${colorWithAlpha(theme.backgroundColor, 0.32)}` : 'none',
                }}
            >
                {tokens.map(token => (
                    <MonetTimedTokenSpan
                        key={token.key}
                        token={token}
                        currentTime={currentTime}
                        isActive={isActive}
                        accentColor={primaryColor}
                    />
                ))}
            </div>
            <AnimatePresence initial={false}>
                {line.translation ? (
                    <motion.div
                        key={`translation-${line.startTime}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: isActive ? 0.98 : 0.6, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.28, ease: 'easeOut' }}
                        className="whitespace-pre-wrap leading-[1.25]"
                        style={{
                            color: secondaryColor,
                            fontSize: isActive ? 'clamp(1rem, 2vw, 1.55rem)' : 'clamp(0.88rem, 1.5vw, 1.05rem)',
                            paddingLeft: isActive ? '0.12rem' : '0.08rem',
                        }}
                    >
                        {line.translation}
                    </motion.div>
                ) : (
                    <div className="h-5" />
                )}
            </AnimatePresence>
        </motion.div>
    );
};

const VisualizerMonet: React.FC<VisualizerMonetProps> = (props) => {
    const {
        currentTime,
        currentLineIndex,
        lines,
        theme,
        audioPower,
        audioBands,
        showText = true,
        songTitle,
        coverUrl,
        staticMode = false,
        transparentBackground = false,
        isPreviewMode = false,
        monetTuning = DEFAULT_MONET_TUNING,
        monetBackgroundImage = null,
    } = props;
    const { t } = useTranslation();

    const {
        activeLine,
        recentCompletedLine,
        nextLines,
        upcomingLine,
    } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    const lyricContext = useMemo(
        () => resolveMonetLyricContext(lines, currentLineIndex, activeLine, recentCompletedLine, nextLines[0] ?? upcomingLine),
        [activeLine, currentLineIndex, lines, nextLines, recentCompletedLine, upcomingLine],
    );
    const leftBasis = `${Math.round((1 - monetTuning.coverPaneRatio) * 100)}%`;
    const coverShadow = `0 28px 60px ${colorWithAlpha(theme.backgroundColor, 0.38)}`;
    const sourceLabel = theme.provider || theme.name || 'Monet';

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            sharedProps={{
                ...props,
                transparentBackground: true,
                staticMode: true,
            }}
        >
            <MonetBackground
                coverUrl={coverUrl}
                monetBackgroundImage={monetBackgroundImage}
                theme={theme}
                tuning={monetTuning}
                transparentBackground={transparentBackground}
            />

            <div className="relative z-10 flex h-full w-full flex-col px-6 py-8 sm:px-10 lg:px-16">
                <div className="grid min-h-0 flex-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.78fr)] lg:items-center">
                    <div className="flex min-h-0 flex-col justify-between gap-8" style={{ minWidth: leftBasis }}>
                        <div className="space-y-2">
                            <div
                                className="text-[clamp(1.25rem,2.4vw,2.4rem)] italic tracking-[-0.04em]"
                                style={{ color: colorWithAlpha(theme.primaryColor, 0.96) }}
                            >
                                {sourceLabel}
                            </div>
                            <div
                                className="h-24 w-px rounded-full"
                                style={{ background: `linear-gradient(180deg, ${colorWithAlpha(theme.primaryColor, 0.72)}, transparent)` }}
                            />
                        </div>

                        <div className="space-y-4">
                            <div className="space-y-1">
                                <div
                                    className="font-semibold tracking-[-0.05em] leading-[0.96]"
                                    style={{
                                        color: theme.primaryColor,
                                        fontSize: 'clamp(2.8rem, 7vw, 5.8rem)',
                                        textShadow: `0 14px 36px ${colorWithAlpha(theme.backgroundColor, 0.28)}`,
                                    }}
                                >
                                    {songTitle || 'Monet'}
                                </div>
                                <div
                                    className="text-sm uppercase tracking-[0.26em]"
                                    style={{ color: colorWithAlpha(theme.secondaryColor, 0.84) }}
                                >
                                    {theme.name}
                                </div>
                            </div>

                            {showText ? (
                                <div className="max-w-[720px] min-h-[240px] space-y-5">
                                    {lyricContext.previousLine ? (
                                        <MonetLyricPair
                                            line={lyricContext.previousLine}
                                            currentTime={currentTime}
                                            theme={theme}
                                            isActive={false}
                                            lyricsFocusScale={1}
                                        />
                                    ) : null}

                                    {lyricContext.activeLine ? (
                                        <MonetLyricPair
                                            line={lyricContext.activeLine}
                                            currentTime={currentTime}
                                            theme={theme}
                                            isActive
                                            lyricsFocusScale={monetTuning.lyricsFocusScale}
                                        />
                                    ) : (
                                        <motion.div
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 0.72 }}
                                            className="space-y-2"
                                        >
                                            <div
                                                className="font-semibold tracking-[-0.03em]"
                                                style={{
                                                    color: theme.primaryColor,
                                                    fontSize: 'clamp(1.8rem, 4.2vw, 3.2rem)',
                                                }}
                                            >
                                                {t('ui.waitingForMusic') || 'Waiting for music'}
                                            </div>
                                        </motion.div>
                                    )}

                                    {lyricContext.nextLine ? (
                                        <MonetLyricPair
                                            line={lyricContext.nextLine}
                                            currentTime={currentTime}
                                            theme={theme}
                                            isActive={false}
                                            isNext
                                            lyricsFocusScale={1}
                                        />
                                    ) : null}
                                </div>
                            ) : (
                                <div className="min-h-[240px]" />
                            )}
                        </div>

                        <div className="space-y-4">
                            <div className="inline-flex items-center gap-3 rounded-full border px-4 py-2 backdrop-blur-md" style={{
                                borderColor: colorWithAlpha(theme.primaryColor, 0.16),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.18),
                                color: colorWithAlpha(theme.primaryColor, 0.9),
                            }}>
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                                <span className="text-xs uppercase tracking-[0.28em]">{sourceLabel}</span>
                            </div>

                            <div className="h-16 w-full max-w-[720px] overflow-hidden rounded-full border px-3 py-2 backdrop-blur-md" style={{
                                borderColor: colorWithAlpha(theme.primaryColor, 0.12),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.18),
                            }}>
                                <AudioOverlay
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    theme={theme}
                                    mode={monetTuning.audioStyle}
                                    staticMode={staticMode}
                                    isPreviewMode={isPreviewMode}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-center lg:justify-end">
                        <div
                            className="relative w-full max-w-[430px] overflow-hidden rounded-[2rem] border p-4 backdrop-blur-sm"
                            style={{
                                borderColor: colorWithAlpha(theme.primaryColor, 0.18),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, 0.18),
                                boxShadow: coverShadow,
                            }}
                        >
                            <div
                                className="aspect-[0.74] w-full rounded-[1.6rem] bg-cover bg-center"
                                style={{
                                    backgroundImage: coverUrl ? `url(${coverUrl})` : undefined,
                                    backgroundColor: colorWithAlpha(theme.primaryColor, 0.08),
                                }}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </VisualizerShell>
    );
};

export default VisualizerMonet;
