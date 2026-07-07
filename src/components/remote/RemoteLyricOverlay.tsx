import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlayerState, type Line, type LyricData } from '../../types';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';

// src/components/remote/RemoteLyricOverlay.tsx
// Renders remote-window lyrics while keeping continuous playback progress out of React state.
type RemoteLyricOverlayProps = {
    lyrics: LyricData | null | undefined;
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    hasTrack: boolean;
    visible: boolean;
    baseColor: string;
    activeColor: string;
};

type RemoteLyricDisplay = {
    currentLine: Line | null;
    nextLine: Line | null;
};

const EMPTY_DISPLAY: RemoteLyricDisplay = {
    currentLine: null,
    nextLine: null,
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

const getInterpolatedTime = (
    playerState: PlayerState,
    duration: number,
    sync: { snapshotTime: number; localTime: number },
) => {
    if (playerState !== PlayerState.PLAYING) {
        return sync.snapshotTime;
    }

    const elapsed = (performance.now() - sync.localTime) / 1000;
    const upperBound = Number.isFinite(duration) && duration > 0 ? duration : Number.POSITIVE_INFINITY;
    return Math.min(upperBound, sync.snapshotTime + elapsed);
};

const resolveDisplay = (lyrics: LyricData | null | undefined, time: number): RemoteLyricDisplay => {
    if (!lyrics?.lines.length) {
        return EMPTY_DISPLAY;
    }

    const index = findLatestActiveLineIndex(lyrics.lines, time);
    if (index !== -1) {
        return {
            currentLine: lyrics.lines[index] ?? null,
            nextLine: lyrics.lines[index + 1] ?? null,
        };
    }

    const upcomingIndex = lyrics.lines.findIndex(line => line.startTime > time);
    const previousIndex = upcomingIndex === -1 ? lyrics.lines.length - 1 : upcomingIndex - 1;
    return {
        currentLine: previousIndex >= 0 ? lyrics.lines[previousIndex] ?? null : null,
        nextLine: upcomingIndex === -1 ? null : lyrics.lines[upcomingIndex] ?? null,
    };
};

const getLineKey = (line: Line | null) => (
    line ? `${line.startTime}-${line.endTime}-${line.fullText}` : 'empty'
);

const buildGradient = (activeColor: string, baseColor: string, progress: number) => (
    `linear-gradient(to right, ${activeColor} ${progress}%, ${baseColor} ${progress}%)`
);

const RemoteLyricOverlay: React.FC<RemoteLyricOverlayProps> = ({
    lyrics,
    currentTime,
    duration,
    playerState,
    hasTrack,
    visible,
    baseColor,
    activeColor,
}) => {
    const { t } = useTranslation();
    const [display, setDisplay] = useState<RemoteLyricDisplay>(() => resolveDisplay(lyrics, currentTime));
    const syncRef = useRef({ snapshotTime: currentTime, localTime: performance.now() });
    const displayRef = useRef(display);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wordRefs = useRef<HTMLElement[]>([]);
    const singleLineRef = useRef<HTMLSpanElement | null>(null);
    const wordCentersRef = useRef<number[]>([]);
    const scrollMetricsRef = useRef({ containerWidth: 0, maxScroll: 0 });
    const targetScrollRef = useRef<number>(0);
    const scrollAnimationRef = useRef<number | null>(null);

    useEffect(() => {
        displayRef.current = display;
    }, [display]);

    const currentLine = display.currentLine;
    const nextLine = display.nextLine;
    const hasLyrics = Boolean(lyrics?.lines.length);
    const lineKey = getLineKey(currentLine);

    const words = useMemo(() => currentLine?.words ?? [], [currentLine]);

    const measureScrollTargets = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            wordCentersRef.current = [];
            scrollMetricsRef.current = { containerWidth: 0, maxScroll: 0 };
            return;
        }

        const containerWidth = container.clientWidth;
        const maxScroll = Math.max(0, container.scrollWidth - containerWidth);
        scrollMetricsRef.current = { containerWidth, maxScroll };
        wordCentersRef.current = wordRefs.current.map(child => child.offsetLeft + child.offsetWidth / 2);

        if (maxScroll <= 0) {
            container.scrollLeft = 0;
        }
    }, []);

    const updateLineProgress = useCallback((time: number) => {
        const line = displayRef.current.currentLine;
        if (!line) {
            return;
        }

        if (line.words?.length) {
            line.words.forEach((word, index) => {
                const node = wordRefs.current[index];
                if (!node) {
                    return;
                }

                const progress = word.endTime > word.startTime
                    ? clampProgress(((time - word.startTime) / (word.endTime - word.startTime)) * 100)
                    : (time >= word.startTime ? 100 : 0);
                node.style.backgroundImage = buildGradient(activeColor, baseColor, progress);
            });
            return;
        }

        if (singleLineRef.current) {
            const progress = line.endTime > line.startTime
                ? clampProgress(((time - line.startTime) / (line.endTime - line.startTime)) * 100)
                : (time >= line.startTime ? 100 : 0);
            singleLineRef.current.style.backgroundImage = buildGradient(activeColor, baseColor, progress);
        }
    }, [activeColor, baseColor]);

    const completeCurrentLineProgress = useCallback(() => {
        const line = displayRef.current.currentLine;
        if (!line) {
            return;
        }

        if (line.words?.length) {
            line.words.forEach((_, index) => {
                const node = wordRefs.current[index];
                if (node) {
                    node.style.backgroundImage = buildGradient(activeColor, baseColor, 100);
                }
            });
            return;
        }

        if (singleLineRef.current) {
            singleLineRef.current.style.backgroundImage = buildGradient(activeColor, baseColor, 100);
        }
    }, [activeColor, baseColor]);

    const animateScroll = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            scrollAnimationRef.current = null;
            return;
        }
        const { maxScroll } = scrollMetricsRef.current;
        if (maxScroll <= 0) {
            container.scrollLeft = 0;
            scrollAnimationRef.current = null;
            return;
        }

        const diff = targetScrollRef.current - container.scrollLeft;
        if (Math.abs(diff) > 0.5) {
            container.scrollLeft += diff * 0.14;
            scrollAnimationRef.current = requestAnimationFrame(animateScroll);
        } else {
            container.scrollLeft = targetScrollRef.current;
            scrollAnimationRef.current = null;
        }
    }, []);

    const updateScroll = useCallback((time: number) => {
        const container = containerRef.current;
        const line = displayRef.current.currentLine;
        const { containerWidth, maxScroll } = scrollMetricsRef.current;
        if (!container || !line || maxScroll <= 0) {
            return;
        }

        let targetScroll = maxScroll;
        if (line.words?.length) {
            const activeIndex = line.words.findIndex(word => time >= word.startTime && time <= word.endTime);
            if (activeIndex !== -1) {
                targetScroll = (wordCentersRef.current[activeIndex] ?? 0) - containerWidth / 2;
            } else if (time < line.words[0].startTime) {
                targetScroll = 0;
            }
        } else if (time >= line.startTime && time <= line.endTime && line.endTime > line.startTime) {
            targetScroll = ((time - line.startTime) / (line.endTime - line.startTime)) * maxScroll;
        } else if (time < line.startTime) {
            targetScroll = 0;
        }

        const boundedTarget = Math.max(0, Math.min(maxScroll, targetScroll));
        targetScrollRef.current = boundedTarget;

        if (playerState === PlayerState.PLAYING) {
            container.scrollLeft += (boundedTarget - container.scrollLeft) * 0.14;
        } else {
            if (!scrollAnimationRef.current) {
                scrollAnimationRef.current = requestAnimationFrame(animateScroll);
            }
        }
    }, [playerState, animateScroll]);

    const updateDisplay = useCallback((time: number) => {
        const nextDisplay = resolveDisplay(lyrics, time);
        const previous = displayRef.current;
        if (
            previous.currentLine === nextDisplay.currentLine &&
            previous.nextLine === nextDisplay.nextLine
        ) {
            return;
        }

        if (
            previous.currentLine &&
            previous.currentLine !== nextDisplay.currentLine &&
            time >= previous.currentLine.endTime
        ) {
            completeCurrentLineProgress();
        }

        displayRef.current = nextDisplay;
        setDisplay(nextDisplay);
    }, [completeCurrentLineProgress, lyrics]);

    const setContainerRef = useCallback((node: HTMLDivElement | null) => {
        containerRef.current = node;
        if (node) {
            if (wordRefs.current.length > words.length) {
                wordRefs.current.length = words.length;
            }
            requestAnimationFrame(() => {
                measureScrollTargets();
                const time = getInterpolatedTime(playerState, duration, syncRef.current);
                updateLineProgress(time);
                updateScroll(time);
            });
        }
    }, [measureScrollTargets, playerState, duration, updateLineProgress, updateScroll, words.length]);

    useEffect(() => {
        syncRef.current = { snapshotTime: currentTime, localTime: performance.now() };
        const time = getInterpolatedTime(playerState, duration, syncRef.current);
        updateDisplay(time);
        updateLineProgress(time);
        updateScroll(time);
    }, [currentTime, duration, playerState, updateDisplay, updateLineProgress, updateScroll]);

    useEffect(() => {
        return () => {
            if (scrollAnimationRef.current) {
                cancelAnimationFrame(scrollAnimationRef.current);
            }
        };
    }, []);

    useEffect(() => {
        window.addEventListener('resize', measureScrollTargets);
        return () => window.removeEventListener('resize', measureScrollTargets);
    }, [measureScrollTargets]);

    useEffect(() => {
        if (!visible || !lyrics?.lines.length) {
            return;
        }

        let frameId = 0;
        const tick = () => {
            const time = getInterpolatedTime(playerState, duration, syncRef.current);
            updateDisplay(time);
            updateLineProgress(time);
            updateScroll(time);

            if (playerState === PlayerState.PLAYING) {
                frameId = requestAnimationFrame(tick);
            }
        };

        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [duration, lyrics, playerState, updateDisplay, updateLineProgress, updateScroll, visible]);

    return (
        <motion.div
            key="lyrics-view"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.10 }}
            className="absolute inset-0 flex flex-col justify-center min-w-0"
        >
            <AnimatePresence mode="wait">
                <motion.div
                    key={`line-${lineKey}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ opacity: { duration: 0.15, ease: 'easeOut' }, y: { duration: 0.15, ease: 'easeOut' } }}
                    className="min-w-0"
                >
                    <div
                        ref={setContainerRef}
                        className="w-full overflow-hidden whitespace-nowrap relative text-base font-bold leading-snug select-none"
                    >
                        {currentLine ? (
                            words.length > 0 ? (
                                words.map((word, index) => (
                                    <span
                                        key={`${word.startTime}-${word.endTime}-${index}`}
                                        ref={node => {
                                            if (node) {
                                                wordRefs.current[index] = node;
                                            }
                                        }}
                                        style={{
                                            backgroundImage: buildGradient(activeColor, baseColor, 0),
                                            WebkitBackgroundClip: 'text',
                                            WebkitTextFillColor: 'transparent',
                                            display: 'inline-block',
                                            marginRight: '0.25em',
                                        }}
                                    >
                                        {word.text}
                                    </span>
                                ))
                            ) : (
                                <span
                                    ref={singleLineRef}
                                    style={{
                                        backgroundImage: buildGradient(activeColor, baseColor, 0),
                                        WebkitBackgroundClip: 'text',
                                        WebkitTextFillColor: 'transparent',
                                        display: 'inline-block',
                                    }}
                                >
                                    {currentLine.fullText}
                                </span>
                            )
                        ) : (
                            <span style={{ color: baseColor }}>
                                {hasTrack && !hasLyrics ? t('remote.noLyrics') : ''}
                            </span>
                        )}
                    </div>
                </motion.div>
            </AnimatePresence>
            <AnimatePresence mode="wait">
                <motion.div
                    key={`next-${nextLine?.startTime ?? 'none'}-${nextLine?.fullText ?? ''}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ 
                        opacity: { duration: 0.15, ease: 'easeOut', delay: 0.08 }, 
                        y: { duration: 0.15, ease: 'easeOut', delay: 0.08 } 
                    }}
                    className="truncate text-[11px] font-medium leading-none mt-1.5"
                    style={{ color: baseColor }}
                >
                    {nextLine?.fullText ?? ''}
                </motion.div>
            </AnimatePresence>
        </motion.div>
    );
};

export default RemoteLyricOverlay;
