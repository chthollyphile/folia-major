import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import type { Line, LyricData } from '../../../types';
import { findLatestActiveLineIndex } from '../../../utils/appPlaybackHelpers';
import { kitTransition, useKitReducedMotion } from './kit/motion';

// src/components/modal/settings/GlobalLyricOffsetPreview.tsx
// 全局时间偏移校准窗口的实时歌词预览：沿用 LyricPreviewPanel 的逐字渐变高亮做法，
// 但时间源是已应用偏移的歌词时钟，再叠加“草稿偏移 - 已生效偏移”的差值，
// 让用户在点击应用前就能看到调整后的推进位置。高频更新只写 DOM，行切换才进 React state。
// 当前行下面有一条细线，线上的圆点是声音此刻唱到的位置：填色的边和圆点之间的距离就是草稿偏移。

type GlobalLyricOffsetPreviewProps = {
    lyrics: LyricData | null;
    lyricCurrentTime: MotionValue<number>;
    /** 相对已生效偏移的草稿增量（毫秒），正值表示歌词更晚出现。 */
    draftDeltaMs: number;
    /** 草稿偏移本身（毫秒）：声音比预览里的歌词早这么多。 */
    draftOffsetMs: number;
};

type PreviewDisplay = {
    currentLine: Line | null;
    nextLine: Line | null;
};

const EMPTY_DISPLAY: PreviewDisplay = { currentLine: null, nextLine: null };

// 唱过的部分和还没唱到的部分，取设置外框给的文字颜色。
const SUNG_COLOR = 'var(--st-t1)';
const UNSUNG_COLOR = 'var(--st-t3)';

const BOX_CLASS = 'flex h-32 flex-col items-center justify-center gap-1.5 rounded-xl bg-[var(--st-pv)] px-4';

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

const buildGradient = (progress: number) => (
    `linear-gradient(to right, ${SUNG_COLOR} ${progress}%, ${UNSUNG_COLOR} ${progress}%)`
);

/** 一段带 data-start / data-end 的文字在 time 这一刻唱到了百分之几。 */
const readProgress = (node: HTMLElement, time: number): number => {
    const start = Number.parseFloat(node.getAttribute('data-start') || '0');
    const end = Number.parseFloat(node.getAttribute('data-end') || '0');
    return end > start
        ? clampProgress(((time - start) / (end - start)) * 100)
        : (time >= start ? 100 : 0);
};

const resolveDisplay = (lyrics: LyricData | null, time: number): PreviewDisplay => {
    if (!lyrics?.lines.length) {
        return EMPTY_DISPLAY;
    }

    const index = findLatestActiveLineIndex(lyrics.lines, time);
    if (index !== -1) {
        return { currentLine: lyrics.lines[index] ?? null, nextLine: lyrics.lines[index + 1] ?? null };
    }

    const upcomingIndex = lyrics.lines.findIndex(line => line.startTime > time);
    return {
        currentLine: null,
        nextLine: upcomingIndex === -1 ? null : lyrics.lines[upcomingIndex] ?? null,
    };
};

const getLineKey = (line: Line | null) => (
    line ? `${line.startTime}-${line.endTime}-${line.fullText}` : 'empty'
);

const GlobalLyricOffsetPreview: React.FC<GlobalLyricOffsetPreviewProps> = ({
    lyrics,
    lyricCurrentTime,
    draftDeltaMs,
    draftOffsetMs,
}) => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const [display, setDisplay] = useState<PreviewDisplay>(EMPTY_DISPLAY);
    const displayRef = useRef(display);
    const wordRefs = useRef<HTMLElement[]>([]);
    const singleLineRef = useRef<HTMLSpanElement | null>(null);
    const dotRef = useRef<HTMLSpanElement | null>(null);
    // 草稿增量和草稿偏移放进 ref，change 回调里读最新值，避免每次微调都重建订阅。
    const draftDeltaRef = useRef(draftDeltaMs);
    const draftOffsetRef = useRef(draftOffsetMs);
    // 最近一次预览时间：换行后新节点首帧就能按正确进度着色，不闪回未唱状态。
    const previewTimeRef = useRef(0);

    // 把圆点放到声音此刻唱到的位置：按和填色同一套字的位置来算，偏移为零时圆点正好压在填色的边上。
    const placeDot = useCallback(() => {
        const dot = dotRef.current;
        if (!dot) return;
        const soundTime = previewTimeRef.current + draftOffsetRef.current / 1000;
        const nodes = singleLineRef.current ? [singleLineRef.current] : wordRefs.current;
        let x = 0;
        for (const node of nodes) {
            if (!node || soundTime < Number.parseFloat(node.getAttribute('data-start') || '0')) break;
            x = node.offsetLeft + node.offsetWidth * (readProgress(node, soundTime) / 100);
        }
        // 太长被截断的行，圆点停在看得见的那一段的末尾。
        const railWidth = dot.parentElement?.clientWidth ?? x;
        dot.style.transform = `translateX(${Math.min(x, railWidth)}px)`;
    }, []);

    const updateProgress = useCallback((time: number) => {
        wordRefs.current.forEach(node => {
            if (!node) return;
            node.style.backgroundImage = buildGradient(readProgress(node, time));
        });

        const singleLine = singleLineRef.current;
        if (singleLine) {
            singleLine.style.backgroundImage = buildGradient(readProgress(singleLine, time));
        }
        placeDot();
    }, [placeDot]);

    const applyTime = useCallback((appliedLyricTime: number) => {
        const previewTime = appliedLyricTime - draftDeltaRef.current / 1000;
        previewTimeRef.current = previewTime;
        const nextDisplay = resolveDisplay(lyrics, previewTime);
        if (
            displayRef.current.currentLine !== nextDisplay.currentLine
            || displayRef.current.nextLine !== nextDisplay.nextLine
        ) {
            displayRef.current = nextDisplay;
            setDisplay(nextDisplay);
        }
        updateProgress(previewTime);
    }, [lyrics, updateProgress]);

    useEffect(() => {
        draftDeltaRef.current = draftDeltaMs;
        draftOffsetRef.current = draftOffsetMs;
        applyTime(lyricCurrentTime.get());
    }, [applyTime, draftDeltaMs, draftOffsetMs, lyricCurrentTime]);

    useEffect(() => {
        applyTime(lyricCurrentTime.get());
        const unsubscribe = lyricCurrentTime.on('change', applyTime);
        return () => unsubscribe();
    }, [applyTime, lyricCurrentTime]);

    const currentLine = display.currentLine;
    const nextLine = display.nextLine;
    const words = useMemo(() => currentLine?.words ?? [], [currentLine]);
    const subLineText = currentLine?.translation || nextLine?.fullText || '';
    const isTranslation = Boolean(currentLine?.translation);

    // 第一个词负责清空上一行残留的节点，逐字模式和整行模式互相排斥，各自持有自己的引用。
    const registerWordRef = useCallback((node: HTMLElement | null, index: number) => {
        if (index === 0) {
            wordRefs.current = [];
        }
        if (node) {
            wordRefs.current[index] = node;
        }
    }, []);

    const registerSingleLineRef = useCallback((node: HTMLSpanElement | null) => {
        wordRefs.current = [];
        singleLineRef.current = node;
    }, []);

    // 圆点排在这一行的字后面挂上，这时字的位置已经有了，首帧就放到位。
    const registerDotRef = useCallback((node: HTMLSpanElement | null) => {
        dotRef.current = node;
        placeDot();
    }, [placeDot]);

    const initialProgress = (startTime: number, endTime: number) => (
        endTime > startTime
            ? clampProgress(((previewTimeRef.current - startTime) / (endTime - startTime)) * 100)
            : (previewTimeRef.current >= startTime ? 100 : 0)
    );

    if (!lyrics?.lines.length) {
        return (
            <div className={`${BOX_CLASS} text-xs text-[color:var(--st-t3)]`}>
                {t('globalLyricOffset.noLyrics')}
            </div>
        );
    }

    return (
        <div className={BOX_CLASS}>
            <div className="flex h-12 w-full items-center justify-center overflow-hidden">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={`line-${getLineKey(currentLine)}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={kitTransition('fast', reduced)}
                        className="w-full min-w-0 select-none px-1 text-center text-2xl font-semibold leading-9"
                    >
                        {currentLine ? (
                            <span className="relative inline-block max-w-full pb-3 align-top">
                                <span className="block truncate">
                                    {words.length > 0 ? (
                                        words.map((word, index) => (
                                            <span
                                                key={`${word.startTime}-${word.endTime}-${index}`}
                                                ref={node => registerWordRef(node, index)}
                                                data-start={word.startTime}
                                                data-end={word.endTime}
                                                style={{
                                                    backgroundImage: buildGradient(initialProgress(word.startTime, word.endTime)),
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
                                            ref={registerSingleLineRef}
                                            data-start={currentLine.startTime}
                                            data-end={currentLine.endTime}
                                            style={{
                                                backgroundImage: buildGradient(initialProgress(currentLine.startTime, currentLine.endTime)),
                                                WebkitBackgroundClip: 'text',
                                                WebkitTextFillColor: 'transparent',
                                                display: 'inline-block',
                                            }}
                                        >
                                            {currentLine.fullText}
                                        </span>
                                    )}
                                </span>
                                <span aria-hidden className="absolute inset-x-0 bottom-0.5 h-0.5 rounded-full bg-[var(--st-line2)]">
                                    <span ref={registerDotRef} className="absolute -left-[3px] -top-0.5 h-1.5 w-1.5 rounded-full bg-[var(--st-accent)]" />
                                </span>
                            </span>
                        ) : (
                            <span className="text-sm font-normal text-[color:var(--st-t3)]">{t('globalLyricOffset.waitingForLine')}</span>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>

            <div className="flex h-5 w-full items-center justify-center overflow-hidden">
                <AnimatePresence mode="wait">
                    <motion.p
                        key={`sub-${subLineText || 'none'}`}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={kitTransition('fast', reduced)}
                        className={`max-w-full truncate text-center text-[13px] leading-none ${isTranslation ? 'text-[color:var(--st-t2)]' : 'text-[color:var(--st-t3)]'}`}
                    >
                        {subLineText || ' '}
                    </motion.p>
                </AnimatePresence>
            </div>
        </div>
    );
};

export default GlobalLyricOffsetPreview;
