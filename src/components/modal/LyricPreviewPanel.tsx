import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Music, Sparkles, Languages } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { SongResult, LyricData, Line } from '../../types';
import { neteaseApi } from '../../services/netease';
import { processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { fetchQQLyrics } from '../../utils/lyrics/providers/qqLyricProvider';
import { fetchKugouLyrics } from '../../utils/lyrics/providers/kugouLyricProvider';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';

// src/components/modal/LyricPreviewPanel.tsx
// 歌词预览面板组件：支持逐字高亮与自适应水平滚动，切换行带平滑淡入淡出动画，右上角绝对定位状态标签。

interface LyricPreviewPanelProps {
    selectedResult: SongResult | null;
    source: 'netease' | 'qq' | 'kugou';
    isDaylight: boolean;
}

type RemoteLyricDisplay = {
    currentLine: Line | null;
    nextLine: Line | null;
};

const EMPTY_DISPLAY: RemoteLyricDisplay = {
    currentLine: null,
    nextLine: null,
};

const clampProgress = (value: number) => Math.max(0, Math.min(100, value));

const buildGradient = (activeColor: string, baseColor: string, progress: number) => (
    `linear-gradient(to right, ${activeColor} ${progress}%, ${baseColor} ${progress}%)`
);

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

export const LyricPreviewPanel: React.FC<LyricPreviewPanelProps> = ({
    selectedResult,
    source,
    isDaylight
}) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [lyricData, setLyricData] = useState<LyricData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryTrigger, setRetryTrigger] = useState(0);

    const [prevResultId, setPrevResultId] = useState<number | string | null>(null);
    const [prevSource, setPrevSource] = useState<'netease' | 'qq' | 'kugou' | null>(null);

    const [display, setDisplay] = useState<RemoteLyricDisplay>(EMPTY_DISPLAY);
    const displayRef = useRef(display);
    
    // DOM 引用及滚动状态 Ref
    const containerRef = useRef<HTMLDivElement | null>(null);
    const wordRefs = useRef<HTMLElement[]>([]);
    const singleLineRef = useRef<HTMLSpanElement | null>(null);
    const wordCentersRef = useRef<number[]>([]);
    const scrollMetricsRef = useRef({ containerWidth: 0, maxScroll: 0 });

    // 同步更新显示 Ref，以便在全局 change 事件中使用最新值
    useEffect(() => {
        displayRef.current = display;
    }, [display]);

    // 选中曲目或源变更时，同步清空歌词并开启 loading，避免旧歌词闪烁
    if (selectedResult && (selectedResult.id !== prevResultId || source !== prevSource)) {
        setPrevResultId(selectedResult.id);
        setPrevSource(source);
        setLyricData(null);
        setError(null);
        setIsLoading(true);
        setDisplay(EMPTY_DISPLAY);
    }

    // 样式颜色配置
    const textPrimary = isDaylight ? 'text-zinc-900' : 'text-white';
    const textSecondary = isDaylight ? 'text-zinc-500' : 'text-zinc-400';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const btnBg = isDaylight ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-600' : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300';
    const previewBoxBg = isDaylight ? 'bg-black/[0.02] border-black/5' : 'bg-white/[0.02] border-white/5';
    
    const activeColor = isDaylight ? '#2563eb' : '#60a5fa';
    const mutedColor = isDaylight ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.3)';

    // 获取并解析预览歌词
    useEffect(() => {
        if (!selectedResult) {
            setLyricData(null);
            setError(null);
            setIsLoading(false);
            return;
        }

        let isCancelled = false;

        const loadPreview = async () => {
            setIsLoading(true);
            setError(null);
            try {
                let processed: { lyrics: any; isPureMusic: boolean } | null = null;
                if (source === 'netease') {
                    const lyricRes = await neteaseApi.getLyric(selectedResult.id);
                    if (isCancelled) return;
                    processed = await processNeteaseLyrics(
                        {
                            type: 'netease',
                            ...lyricRes
                        },
                        { songId: selectedResult.id }
                    );
                } else if (source === 'qq') {
                    const parsedLyrics = await fetchQQLyrics(selectedResult);
                    if (isCancelled) return;
                    processed = {
                        lyrics: parsedLyrics,
                        isPureMusic: false,
                    };
                } else if (source === 'kugou') {
                    const parsedLyrics = await fetchKugouLyrics(selectedResult);
                    if (isCancelled) return;
                    processed = {
                        lyrics: parsedLyrics,
                        isPureMusic: false,
                    };
                }

                if (isCancelled) return;

                if (processed && processed.lyrics) {
                    setLyricData(processed.lyrics);
                } else if (processed && processed.isPureMusic) {
                    setLyricData({
                        lines: [
                            {
                                startTime: 0,
                                endTime: 999,
                                fullText: t('status.bestLyricsPureMusic') || '纯音乐，无需匹配歌词',
                                words: []
                            }
                        ]
                    });
                } else {
                    setError(t('localMusic.noLyricsAvailable'));
                }
            } catch (e) {
                console.error('Failed to load lyric preview:', e);
                if (!isCancelled) {
                    setError(t('localMusic.matchFailed'));
                }
            } finally {
                if (!isCancelled) {
                    setIsLoading(false);
                }
            }
        };

        loadPreview();

        return () => {
            isCancelled = true;
        };
    }, [selectedResult?.id, source, retryTrigger, t]);

    /**
     * 测量并记录滚动参数，计算各个字符/单词的中点，防范 text-center 下的溢出截断
     */
    const measureScrollTargets = useCallback(() => {
        const container = containerRef.current;
        if (!container) {
            wordCentersRef.current = [];
            scrollMetricsRef.current = { containerWidth: 0, maxScroll: 0 };
            return;
        }

        // 临时将对齐方式重置为 left，以便准确测算容器原生的 scrollWidth
        container.style.textAlign = 'left';

        const containerWidth = container.clientWidth;
        const scrollWidth = container.scrollWidth;
        const maxScroll = Math.max(0, scrollWidth - containerWidth);
        scrollMetricsRef.current = { containerWidth, maxScroll };

        if (maxScroll > 0) {
            // 长度超出时采用靠左对齐，并记录各个字符的中点偏移
            container.style.textAlign = 'left';
            wordCentersRef.current = wordRefs.current.map(child => {
                if (!child) return 0;
                return child.offsetLeft + child.offsetWidth / 2;
            });
        } else {
            // 长度较短时直接居中对齐，不跑滚动
            container.style.textAlign = 'center';
            container.scrollLeft = 0;
            wordCentersRef.current = [];
        }
    }, []);

    /**
     * 根据当前播放时间更新 DOM 节点上的渐变进度 (防范 React 重新渲染时序)
     */
    const updateLineProgress = useCallback((latest: number) => {
        // 利用 DOM 自定义属性读取该单词的 start 和 end 字段，不受 React render 时序阻碍
        wordRefs.current.forEach(node => {
            if (!node) return;
            const start = parseFloat(node.getAttribute('data-start') || '0');
            const end = parseFloat(node.getAttribute('data-end') || '0');
            const progress = end > start
                ? clampProgress(((latest - start) / (end - start)) * 100)
                : (latest >= start ? 100 : 0);
            node.style.backgroundImage = buildGradient(activeColor, mutedColor, progress);
        });

        if (singleLineRef.current) {
            const node = singleLineRef.current;
            const start = parseFloat(node.getAttribute('data-start') || '0');
            const end = parseFloat(node.getAttribute('data-end') || '0');
            const progress = end > start
                ? clampProgress(((latest - start) / (end - start)) * 100)
                : (latest >= start ? 100 : 0);
            node.style.backgroundImage = buildGradient(activeColor, mutedColor, progress);
        }
    }, [activeColor, mutedColor]);

    /**
     * 根据高亮文字中点自动滚动容器，确保当前播放的字处于可视区居中位置
     */
    const updateScroll = useCallback((latest: number) => {
        const container = containerRef.current;
        if (!container) return;

        const { containerWidth, maxScroll } = scrollMetricsRef.current;
        if (maxScroll <= 0) {
            container.scrollLeft = 0;
            return;
        }

        const line = displayRef.current.currentLine;
        if (!line) return;

        let targetScroll = maxScroll;
        if (line.words?.length) {
            const activeIndex = line.words.findIndex(word => latest >= word.startTime && latest <= word.endTime);
            if (activeIndex !== -1) {
                const center = wordCentersRef.current[activeIndex];
                if (center !== undefined) {
                    targetScroll = center - containerWidth / 2;
                } else {
                    targetScroll = 0;
                }
            } else if (latest < line.words[0].startTime) {
                targetScroll = 0;
            }
        } else if (latest >= line.startTime && latest <= line.endTime && line.endTime > line.startTime) {
            targetScroll = ((latest - line.startTime) / (line.endTime - line.startTime)) * maxScroll;
        } else if (latest < line.startTime) {
            targetScroll = 0;
        }

        container.scrollLeft = Math.max(0, Math.min(maxScroll, targetScroll));
    }, []);

    // 订阅全局时间，触发极高性能的 DOM 直接高亮更新与滚动
    useEffect(() => {
        const timeValue = (window as any).__folia_current_time;
        if (!timeValue || !lyricData || !lyricData.lines || lyricData.lines.length === 0) {
            return;
        }

        const unsubscribe = timeValue.on("change", (latest: number) => {
            const nextDisplay = resolveDisplay(lyricData, latest);
            if (
                displayRef.current.currentLine !== nextDisplay.currentLine ||
                displayRef.current.nextLine !== nextDisplay.nextLine
            ) {
                displayRef.current = nextDisplay;
                setDisplay(nextDisplay);
            }

            updateLineProgress(latest);
            updateScroll(latest);
        });

        // 初始化
        const initialVal = timeValue.get();
        const initialDisplay = resolveDisplay(lyricData, initialVal);
        displayRef.current = initialDisplay;
        setDisplay(initialDisplay);

        return () => {
            unsubscribe();
        };
    }, [lyricData, updateLineProgress, updateScroll]);

    // 窗口大小变更自适应重新测量
    useEffect(() => {
        window.addEventListener('resize', measureScrollTargets);
        return () => window.removeEventListener('resize', measureScrollTargets);
    }, [measureScrollTargets]);

    const currentLine = display.currentLine;
    const nextLine = display.nextLine;
    const hasLyrics = Boolean(lyricData?.lines.length);
    const lineKey = getLineKey(currentLine);

    const words = useMemo(() => currentLine?.words ?? [], [currentLine]);

    // 重置并测量新行
    const setContainerRef = useCallback((node: HTMLDivElement | null) => {
        containerRef.current = node;
        if (node) {
            if (wordRefs.current.length > words.length) {
                wordRefs.current.length = words.length;
            }
            requestAnimationFrame(() => {
                measureScrollTargets();
                const timeValue = (window as any).__folia_current_time;
                const latest = timeValue ? timeValue.get() : 0;
                updateLineProgress(latest);
                updateScroll(latest);
            });
        }
    }, [measureScrollTargets, updateLineProgress, updateScroll, words.length]);

    // 重置 word refs，防止多句词汇索引混淆
    useEffect(() => {
        wordRefs.current = [];
    }, [currentLine]);

    if (!selectedResult) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl border-dashed opacity-40 ${borderColor} ${textSecondary}`}>
                <Music size={24} className="mb-1" />
                <span className="text-xs">{t('localMusic.noSelection')}</span>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl ${previewBoxBg}`}>
                <Loader2 className="animate-spin opacity-50 mb-2" size={20} />
                <span className={`text-xs opacity-60 ${textPrimary}`}>{t('localMusic.loadingLyrics')}</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className={`w-full flex-1 flex flex-col items-center justify-center p-4 border rounded-xl ${previewBoxBg} ${textSecondary}`}>
                <span className="text-xs mb-2">{error}</span>
                <button
                    onClick={() => setRetryTrigger(prev => prev + 1)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${btnBg}`}
                >
                    {t('localMusic.reload')}
                </button>
            </div>
        );
    }

    if (!lyricData) {
        return null;
    }

    // 检测当前歌词源包含的特征
    const isWordByWord = !!lyricData.isWordByWord;
    const hasTranslation = lyricData.lines?.some(line => !!line.translation);

    const timeValue = (window as any).__folia_current_time;
    const initialVal = timeValue ? timeValue.get() : 0;

    let subLineText = '';
    let isTranslation = false;

    if (currentLine) {
        if (currentLine.translation) {
            subLineText = currentLine.translation;
            isTranslation = true;
        } else if (nextLine) {
            subLineText = nextLine.fullText;
        }
    } else if (hasLyrics && lyricData.lines.length > 0) {
        const firstLine = lyricData.lines[0];
        if (firstLine.translation) {
            subLineText = firstLine.translation;
            isTranslation = true;
        } else if (lyricData.lines.length > 1) {
            subLineText = lyricData.lines[1].fullText;
        }
    }

    return (
        <div className={`w-full flex-1 flex flex-col min-h-0 border rounded-xl relative ${previewBoxBg} overflow-hidden`}>
            {/* 右上角绝对定位状态标签，最大程度为上部留出可用空间 */}
            <div className="absolute top-2.5 right-2.5 z-10 flex gap-1.5 pointer-events-none select-none">
                {isWordByWord && (
                    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-indigo-500/10 text-indigo-400 rounded font-medium border border-indigo-500/10 backdrop-blur-sm">
                        <Sparkles size={7} />
                        {t('localMusic.wordByWord')}
                    </span>
                )}
                
                {hasTranslation && (
                    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 rounded font-medium border border-emerald-500/10 backdrop-blur-sm">
                        <Languages size={7} />
                        {t('localMusic.hasTranslation')}
                    </span>
                )}
            </div>

            {/* 逐字高亮与翻译/下一句预览区 */}
            <div className="flex-1 flex flex-col items-center justify-center p-3 text-center min-h-0 relative">
                {hasLyrics ? (
                    <div className="w-full max-w-full px-2 flex flex-col items-center justify-center">
                        {/* 第一行：原词 (支持逐字高亮与滚动，带有行切换淡入淡出动效) */}
                        <div className="w-full h-7 flex items-center justify-center overflow-hidden">
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={`line-${lineKey}`}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    transition={{ opacity: { duration: 0.15, ease: 'easeOut' }, y: { duration: 0.15, ease: 'easeOut' } }}
                                    className="w-full min-w-0"
                                >
                                    <div
                                        ref={setContainerRef}
                                        className="w-full overflow-hidden whitespace-nowrap relative text-sm font-bold select-none"
                                        style={{ textAlign: 'center' }}
                                    >
                                        {currentLine ? (
                                            words.length > 0 ? (
                                                words.map((word, index) => {
                                                    const progress = word.endTime > word.startTime
                                                        ? clampProgress(((initialVal - word.startTime) / (word.endTime - word.startTime)) * 100)
                                                        : (initialVal >= word.startTime ? 100 : 0);

                                                    return (
                                                        <span
                                                            key={`${word.startTime}-${word.endTime}-${index}`}
                                                            ref={node => {
                                                                if (node) {
                                                                    wordRefs.current[index] = node;
                                                                }
                                                            }}
                                                            data-start={word.startTime}
                                                            data-end={word.endTime}
                                                            style={{
                                                                backgroundImage: buildGradient(activeColor, mutedColor, progress),
                                                                WebkitBackgroundClip: 'text',
                                                                WebkitTextFillColor: 'transparent',
                                                                display: 'inline-block',
                                                                marginRight: '0.25em',
                                                            }}
                                                        >
                                                            {word.text}
                                                        </span>
                                                    );
                                                })
                                            ) : (
                                                <span
                                                    ref={singleLineRef}
                                                    data-start={currentLine.startTime}
                                                    data-end={currentLine.endTime}
                                                    style={{
                                                        backgroundImage: buildGradient(activeColor, mutedColor, 
                                                            currentLine.endTime > currentLine.startTime
                                                                ? clampProgress(((initialVal - currentLine.startTime) / (currentLine.endTime - currentLine.startTime)) * 100)
                                                                : (initialVal >= currentLine.startTime ? 100 : 0)
                                                        ),
                                                        WebkitBackgroundClip: 'text',
                                                        WebkitTextFillColor: 'transparent',
                                                        display: 'inline-block',
                                                    }}
                                                >
                                                    {currentLine.fullText}
                                                </span>
                                            )
                                        ) : (
                                            '\u00A0'
                                        )}
                                    </div>
                                </motion.div>
                            </AnimatePresence>
                        </div>
                        
                        {/* 第二行：翻译或下一句 (带有行切换淡入淡出动效) */}
                        <div className="w-full h-5 flex items-center justify-center overflow-hidden mt-1.5">
                            <AnimatePresence mode="wait">
                                <motion.p 
                                    key={`sub-${nextLine?.startTime ?? 'none'}-${nextLine?.fullText ?? ''}-${subLineText}`}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -6 }}
                                    transition={{ 
                                        opacity: { duration: 0.15, ease: 'easeOut', delay: 0.04 }, 
                                        y: { duration: 0.15, ease: 'easeOut', delay: 0.04 } 
                                    }}
                                    className={`text-xs text-center truncate max-w-full font-medium leading-none ${
                                        isTranslation 
                                            ? (isDaylight ? 'text-emerald-600' : 'text-emerald-400/80') 
                                            : (isDaylight ? 'text-zinc-400' : 'text-zinc-500')
                                    }`}
                                >
                                    {subLineText || '\u00A0'}
                                </motion.p>
                            </AnimatePresence>
                        </div>
                    </div>
                ) : (
                    <div className={`text-center py-4 text-xs opacity-50 ${textSecondary}`}>
                        {t('localMusic.statusNone')}
                    </div>
                )}
            </div>
        </div>
    );
};
