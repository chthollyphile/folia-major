import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import { type AudioBands, type Line, type Theme, type Word } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { mixColors } from '../colorMix';
import { shouldPreheatLine, useVisualizerRuntime, type VisualizerPreheatWindow } from '../runtime';
import VisualizerShell from '../VisualizerShell';
import VisualizerSubtitleOverlay from '../VisualizerSubtitleOverlay';

// src/components/visualizer/cappella/VisualizerCappella.tsx
// Renders parsercore-timed lyrics as a chat-style cappella conversation.
interface VisualizerCappellaProps {
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    coverUrl?: string | null;
    useCoverColorBg?: boolean;
    seed?: string | number;
    staticMode?: boolean;
    backgroundOpacity?: number;
    lyricsFontScale?: number;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    paused?: boolean;
    onBack?: () => void;
}

type ChatSide = 'left' | 'right';

interface CappellaLineMessage {
    id: string;
    kind: 'lyric';
    line: Line;
    lineIndex: number;
    side: ChatSide;
    avatarIndex: number;
}

interface CappellaTitleMessage {
    id: string;
    kind: 'title';
    text: string;
    side: ChatSide;
    avatarIndex: number;
}

type CappellaMessage = CappellaTitleMessage | CappellaLineMessage;

const SHORT_LINE_CHAR_LIMIT = 12;
const MAX_VISIBLE_MESSAGES = 10;
const AVATAR_GRID_SIZE = 3;
const FORCE_RIGHT_EVERY_LINES = 5;
const LEFT_AVATAR_INDICES = [0, 3, 6, 1, 4];
const RIGHT_AVATAR_INDEX = 8;
const SIDE_SEQUENCE: ChatSide[] = ['left', 'right', 'left', 'right', 'right'];
const CAPPELLA_PREHEAT_WINDOW: VisualizerPreheatWindow = {
    minLead: 0.18,
    maxLead: 1.1,
};
const CAPPELLA_LAYOUT_CACHE_LIMIT = 32;
const CAPPELLA_LOOKAHEAD_CHARACTERS = 2;

interface BubbleSize {
    width: number;
    height: number;
}

interface PreparedBubbleMetrics {
    characters: string[];
    sizes: BubbleSize[];
}

const countCompactChars = (text: string) => Array.from(text.replace(/\s/g, '')).length;

// Assigns stable chat senders so short lyric fragments feel like consecutive messages from one user.
const buildCappellaMessages = (lines: Line[], titleText: string): CappellaMessage[] => {
    const messages: CappellaMessage[] = [{
        id: 'title',
        kind: 'title',
        text: titleText,
        side: 'right',
        avatarIndex: AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1,
    }];

    let sideSequenceCursor = 0;
    let nextLeftAvatarCursor = 0;
    let lastLyricSender: Pick<CappellaLineMessage, 'side' | 'avatarIndex'> | null = null;

    lines.forEach((line, lineIndex) => {
        const isShortLine = countCompactChars(line.fullText) <= SHORT_LINE_CHAR_LIMIT;
        const shouldForceRight = (lineIndex + 1) % FORCE_RIGHT_EVERY_LINES === 0;
        const sender = shouldForceRight
            ? {
                side: 'right' as const,
                avatarIndex: RIGHT_AVATAR_INDEX,
            }
            : isShortLine && lastLyricSender
            ? lastLyricSender
            : {
                side: SIDE_SEQUENCE[sideSequenceCursor % SIDE_SEQUENCE.length],
                avatarIndex: SIDE_SEQUENCE[sideSequenceCursor % SIDE_SEQUENCE.length] === 'left'
                    ? LEFT_AVATAR_INDICES[nextLeftAvatarCursor % LEFT_AVATAR_INDICES.length]
                    : RIGHT_AVATAR_INDEX,
            };

        messages.push({
            id: `line-${line.startTime}-${lineIndex}`,
            kind: 'lyric',
            line,
            lineIndex,
            side: sender.side,
            avatarIndex: sender.avatarIndex,
        });

        if (shouldForceRight) {
            sideSequenceCursor = 0;
            lastLyricSender = null;
        } else if (!isShortLine) {
            if (sender.side === 'left') {
                nextLeftAvatarCursor += 1;
            }
            sideSequenceCursor += 1;
            lastLyricSender = sender;
        } else {
            lastLyricSender = sender;
        }
    });

    return messages;
};

const getVisibleWordCharacters = (word: Word, currentTime: number) => {
    if (currentTime < word.startTime) {
        return [];
    }

    if (currentTime >= word.endTime) {
        return Array.from(word.text);
    }

    const characters = Array.from(word.text);
    const duration = Math.max(word.endTime - word.startTime, 0.001);
    const progress = Math.min(1, Math.max(0, (currentTime - word.startTime) / duration));
    const visibleCount = Math.max(1, Math.floor(characters.length * progress));

    return characters.slice(0, visibleCount);
};

const getLineCharacters = (line: Line) => Array.from(line.words.map(word => word.text).join(''));

const getVisibleLineText = (line: Line, currentTime: number) =>
    line.words.map(word => getVisibleWordCharacters(word, currentTime).join('')).join('');

const getVisibleCharacterCount = (line: Line, currentTime: number) =>
    Array.from(getVisibleLineText(line, currentTime)).length;

const getAvatarPosition = (avatarIndex: number) => {
    const safeIndex = ((avatarIndex % 9) + 9) % 9;
    const col = safeIndex % AVATAR_GRID_SIZE;
    const row = Math.floor(safeIndex / AVATAR_GRID_SIZE);

    return {
        backgroundPosition: `${col * 50}% ${row * 50}%`,
        backgroundSize: `${AVATAR_GRID_SIZE * 100}% ${AVATAR_GRID_SIZE * 100}%`,
    };
};

const getVisibleMessages = (messages: CappellaMessage[], visibleLineIndex: number, maxVisibleMessages: number) => {
    const visible = messages.filter(message => (
        message.kind === 'title' || message.lineIndex <= visibleLineIndex
    ));

    return visible.slice(-maxVisibleMessages);
};

const getMaxVisibleMessages = (viewportHeight: number) => {
    if (viewportHeight < 560) {
        return 4;
    }

    if (viewportHeight < 700) {
        return 6;
    }

    return MAX_VISIBLE_MESSAGES;
};

const getVisibleLineIndexAtTime = (lines: Line[], currentTime: number) => {
    for (let index = lines.length - 1; index >= 0; index--) {
        if (currentTime >= lines[index].startTime) {
            return index;
        }
    }

    return -1;
};

const getBubbleColors = (message: CappellaMessage, theme: Theme) => {
    if (message.side === 'right') {
        return {
            backgroundColor: mixColors(theme.accentColor, theme.primaryColor, 0.18, 0.94),
            borderColor: mixColors(theme.accentColor, theme.primaryColor, 0.34, 0.3),
            textColor: theme.backgroundColor,
        };
    }

    const avatarTone = (message.avatarIndex % (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE)) / (AVATAR_GRID_SIZE * AVATAR_GRID_SIZE - 1);
    const accentMix = 0.18 + avatarTone * 0.62;

    return {
        backgroundColor: mixColors(theme.secondaryColor, theme.accentColor, accentMix, 1),
        borderColor: mixColors(theme.secondaryColor, theme.accentColor, Math.min(accentMix + 0.18, 1), 0.26),
        textColor: theme.primaryColor,
    };
};

const formatTimestamp = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }

    const totalSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

const measureBubbleText = ({
    text,
    theme,
    fontSize,
    lineHeightPx,
    maxTextWidth,
    paddingX,
    paddingY,
}: {
    text: string;
    theme: Theme;
    fontSize: number;
    lineHeightPx: number;
    maxTextWidth: number;
    paddingX: number;
    paddingY: number;
}) => {
    const bubbleBorderWidth = 1;
    const safeText = text || ' ';
    const prepared = prepareWithSegments(safeText, `640 ${fontSize}px ${resolveThemeFontStack(theme)}`);
    const layout = layoutWithLines(prepared, Math.max(1, maxTextWidth), Math.round(lineHeightPx));
    const textWidth = Math.max(...layout.lines.map(line => line.width), fontSize);
    const textHeight = Math.max(layout.lines.length, 1) * lineHeightPx;

    return {
        width: Math.ceil(
            Math.min(textWidth, maxTextWidth)
            + paddingX * 2
            + bubbleBorderWidth * 2
        ),
        height: Math.ceil(textHeight + paddingY * 2 + bubbleBorderWidth * 2),
    };
};

const getBubbleMetricsCacheKey = ({
    line,
    theme,
    fontSize,
    lineHeightPx,
    maxTextWidth,
    paddingX,
    paddingY,
}: {
    line: Line;
    theme: Theme;
    fontSize: number;
    lineHeightPx: number;
    maxTextWidth: number;
    paddingX: number;
    paddingY: number;
}) => [
    line.startTime,
    line.endTime,
    line.words.length,
    theme.id,
    fontSize.toFixed(3),
    lineHeightPx.toFixed(3),
    maxTextWidth,
    paddingX,
    paddingY,
].join('|');

// Precompute all bubble sizes for a line so playback only does O(1) lookups.
const getOrBuildBubbleMetrics = (
    cache: Map<string, PreparedBubbleMetrics>,
    {
        line,
        theme,
        fontSize,
        lineHeightPx,
        maxTextWidth,
        paddingX,
        paddingY,
    }: {
        line: Line;
        theme: Theme;
        fontSize: number;
        lineHeightPx: number;
        maxTextWidth: number;
        paddingX: number;
        paddingY: number;
    }
) => {
    const cacheKey = getBubbleMetricsCacheKey({
        line,
        theme,
        fontSize,
        lineHeightPx,
        maxTextWidth,
        paddingX,
        paddingY,
    });
    const cached = cache.get(cacheKey);

    if (cached) {
        cache.delete(cacheKey);
        cache.set(cacheKey, cached);
        return cached;
    }

    const characters = getLineCharacters(line);
    const sizes: BubbleSize[] = [];

    for (let visibleCount = 0; visibleCount <= characters.length; visibleCount += 1) {
        const measuredCount = Math.min(characters.length, visibleCount + CAPPELLA_LOOKAHEAD_CHARACTERS);
        const measuredText = characters.slice(0, measuredCount).join('');
        sizes.push(measureBubbleText({
            text: measuredText,
            theme,
            fontSize,
            lineHeightPx,
            maxTextWidth,
            paddingX,
            paddingY,
        }));
    }

    const prepared = { characters, sizes };
    cache.set(cacheKey, prepared);

    if (cache.size > CAPPELLA_LAYOUT_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey) {
            cache.delete(oldestKey);
        }
    }

    return prepared;
};

const CappellaAvatar: React.FC<{
    coverUrl?: string | null;
    avatarIndex: number;
    theme: Theme;
    side: ChatSide;
}> = ({ coverUrl, avatarIndex, theme, side }) => {
    const avatarPosition = getAvatarPosition(avatarIndex);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="h-10 w-10 shrink-0 overflow-hidden rounded-full border shadow-lg"
            style={{
                borderColor: 'rgba(255,255,255,0.24)',
                backgroundColor: theme.secondaryColor,
                backgroundImage: coverUrl
                    ? `url("${coverUrl}")`
                    : `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
                ...avatarPosition,
            }}
        />
    );
};

const CappellaText: React.FC<{
    message: CappellaMessage;
}> = ({ message }) => {
    if (message.kind === 'title') {
        return <>{message.text}</>;
    }

    return <>{message.line.fullText}</>;
};

const CappellaTimestamp: React.FC<{
    line: Line;
    color: string;
    isVisible: boolean;
    style?: React.CSSProperties;
}> = ({ line, color, isVisible, style }) => {
    if (!isVisible) {
        return null;
    }

    return (
        <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 0.62, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="pointer-events-none absolute text-[11px] font-medium tabular-nums"
            style={{ color, ...style }}
        >
            {formatTimestamp(line.endTime)}
        </motion.span>
    );
};

const AnimatedBubbleFrame: React.FC<{
    children: React.ReactNode;
    className: string;
    floatingAdornment?: React.ReactNode;
    targetSize?: { width: number; height: number };
    style: React.CSSProperties;
}> = ({ children, className, floatingAdornment, targetSize, style }) => {
    return (
        <motion.div
            className="relative shrink-0"
            animate={{
                ...(targetSize ? {
                    width: targetSize.width,
                    height: targetSize.height,
                } : {}),
            }}
            transition={{
                scale: {
                    type: 'spring',
                    stiffness: 340,
                    damping: 28,
                    mass: 0.72,
                },
                ...(targetSize ? {
                    width: { duration: 0.2, ease: 'easeOut' as const },
                    height: { duration: 0.2, ease: 'easeOut' as const },
                } : {}),
            }}
            style={{
                width: targetSize ? targetSize.width : 'fit-content',
                height: targetSize ? targetSize.height : 'auto',
            }}
        >
            <div
                className={className}
                style={{
                    ...style,
                    height: targetSize ? '100%' : 'auto',
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                }}
            >
                {children}
            </div>
            {floatingAdornment}
        </motion.div>
    );
};

const ActiveCappellaText: React.FC<{
    characters: string[];
    visibleCharacterCount: number;
}> = ({ characters, visibleCharacterCount }) => {
    return (
        <span className="inline-flex flex-wrap items-baseline">
            {characters.slice(0, visibleCharacterCount).map((character, index) => (
                <span
                    key={`${index}-${character}`}
                    className="inline-block"
                    style={{
                        whiteSpace: character.trim() ? 'pre' : 'pre-wrap',
                        animation: 'cappella-char-fade 220ms ease-out',
                    }}
                >
                    {character}
                </span>
            ))}
        </span>
    );
};

const CappellaBubbleGlow: React.FC<{
    isActive: boolean;
    isRight: boolean;
}> = ({ isActive, isRight }) => {
    if (!isActive) {
        return null;
    }

    return (
        <motion.div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
                background: isRight
                    ? 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.34) 46%, transparent 68%)'
                    : 'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.18) 46%, transparent 68%)',
                backgroundSize: '240% 100%',
            }}
            animate={{ backgroundPosition: ['160% 0%', '-80% 0%'] }}
            transition={{ duration: 1.8, ease: 'linear', repeat: Infinity }}
        />
    );
};

const CappellaMessageRow: React.FC<{
    message: CappellaMessage;
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    theme: Theme;
    coverUrl?: string | null;
    baseFontSize: number;
    maxTextWidth: number;
    metricsCache: React.MutableRefObject<Map<string, PreparedBubbleMetrics>>;
}> = ({
    message,
    currentTime,
    currentLineIndex,
    theme,
    coverUrl,
    baseFontSize,
    maxTextWidth,
    metricsCache,
}) => {
    const isRight = message.side === 'right';
    const isActiveMessage = message.kind === 'lyric' && message.lineIndex === currentLineIndex;
    const isPassedMessage = message.kind === 'lyric' && message.lineIndex < currentLineIndex;
    const bubbleFontSize = isActiveMessage
        ? baseFontSize * 1.34
        : message.kind === 'title'
            ? baseFontSize
            : baseFontSize * 0.94;
    const bubblePaddingX = isActiveMessage ? 20 : 16;
    const bubblePaddingY = isActiveMessage ? 16 : 12;
    const bubbleColors = getBubbleColors(message, theme);
    const [visibleCharacterCount, setVisibleCharacterCount] = useState(() => (
        message.kind === 'lyric' ? getVisibleCharacterCount(message.line, currentTime.get()) : 0
    ));
    const [isTimestampVisible, setIsTimestampVisible] = useState(() => (
        message.kind === 'lyric' && (isPassedMessage || currentTime.get() >= message.line.endTime)
    ));
    const lineHeightPx = bubbleFontSize * 1.45;
    const preparedMetrics = useMemo(
        () => message.kind === 'lyric' && isActiveMessage
            ? getOrBuildBubbleMetrics(metricsCache.current, {
                line: message.line,
                theme,
                fontSize: bubbleFontSize,
                lineHeightPx,
                maxTextWidth,
                paddingX: bubblePaddingX,
                paddingY: bubblePaddingY,
            })
            : null,
        [bubbleFontSize, bubblePaddingX, bubblePaddingY, isActiveMessage, lineHeightPx, maxTextWidth, message, metricsCache, theme]
    );
    const targetSize = useMemo(() => {
        if (message.kind !== 'lyric' || !isActiveMessage) {
            return null;
        }

        const prepared = preparedMetrics ?? getOrBuildBubbleMetrics(metricsCache.current, {
            line: message.line,
            theme,
            fontSize: bubbleFontSize,
            lineHeightPx,
            maxTextWidth,
            paddingX: bubblePaddingX,
            paddingY: bubblePaddingY,
        });
        const clampedVisibleCount = Math.max(0, Math.min(visibleCharacterCount, prepared.sizes.length - 1));

        return prepared.sizes[clampedVisibleCount];
    }, [
        bubbleFontSize,
        bubblePaddingX,
        bubblePaddingY,
        isActiveMessage,
        lineHeightPx,
        maxTextWidth,
        message,
        metricsCache,
        preparedMetrics,
        theme,
        visibleCharacterCount,
    ]);
    useEffect(() => {
        if (message.kind !== 'lyric') {
            return;
        }

        setVisibleCharacterCount(getVisibleCharacterCount(message.line, currentTime.get()));
        setIsTimestampVisible(isPassedMessage || currentTime.get() >= message.line.endTime);
    }, [currentTime, isActiveMessage, message]);

    useMotionValueEvent(currentTime, 'change', latest => {
        if (message.kind === 'lyric') {
            const nextTimestampVisible = isPassedMessage || latest >= message.line.endTime;
            setIsTimestampVisible(current => current === nextTimestampVisible ? current : nextTimestampVisible);
        }

        if (isActiveMessage) {
            const nextVisibleCount = message.kind === 'lyric'
                ? getVisibleCharacterCount(message.line, latest)
                : 0;
            setVisibleCharacterCount(current => current === nextVisibleCount ? current : nextVisibleCount);
        }
    });

    return (
        <motion.div
            initial={{ opacity: 0, y: 22, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: 'easeOut' }}
            className={`flex w-full items-end gap-3 ${isRight ? 'justify-end' : 'justify-start'}`}
        >
            <motion.div
                animate={{
                    opacity: isPassedMessage ? 0.82 : 1,
                    scale: isActiveMessage ? 1.12 : isPassedMessage ? 0.92 : 1,
                }}
                transition={{
                    type: 'spring',
                    stiffness: 340,
                    damping: 28,
                    mass: 0.72,
                }}
                className={`flex max-w-[78%] items-end gap-3 sm:max-w-[68%] ${isRight ? 'flex-row-reverse' : 'flex-row'}`}
                style={{
                    transformOrigin: isRight ? '100% 100%' : '0% 100%',
                }}
            >
                <CappellaAvatar
                    coverUrl={coverUrl}
                    avatarIndex={message.avatarIndex}
                    theme={theme}
                    side={message.side}
                />
                <AnimatedBubbleFrame
                    className={`relative rounded-3xl shadow-lg transition-[min-height,box-shadow,background-color] duration-200 ease-out ${
                        isRight ? 'rounded-br-md' : 'rounded-bl-md'
                    }`}
                    floatingAdornment={message.kind === 'lyric' ? (
                        <CappellaTimestamp
                            line={message.line}
                            color={theme.secondaryColor}
                            isVisible={isTimestampVisible}
                            style={{
                                bottom: 4,
                                [isRight ? 'right' : 'left']: 'calc(100% + 8px)',
                            }}
                        />
                    ) : undefined}
                    targetSize={targetSize ?? undefined}
                    style={{
                        backgroundColor: bubbleColors.backgroundColor,
                        border: `1px solid ${bubbleColors.borderColor}`,
                        color: bubbleColors.textColor,
                        fontSize: bubbleFontSize,
                        lineHeight: 1.45,
                        maxWidth: maxTextWidth + bubblePaddingX * 2,
                        minHeight: Math.max(
                            isActiveMessage ? 64 : 44,
                            bubbleFontSize * 1.45 + bubblePaddingY * 2
                        ),
                        minWidth: isActiveMessage ? 72 : undefined,
                        padding: `${bubblePaddingY}px ${bubblePaddingX}px`,
                        boxShadow: isActiveMessage
                            ? `0 18px 48px ${mixColors(theme.backgroundColor, theme.accentColor, 0.2, 0.34)}`
                            : undefined,
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                    }}
                    >
                    <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                        <CappellaBubbleGlow isActive={isActiveMessage} isRight={isRight} />
                    </div>
                    <span className="relative z-10">
                        {message.kind === 'lyric' && isActiveMessage && preparedMetrics
                            ? (
                                <ActiveCappellaText
                                    characters={preparedMetrics.characters}
                                    visibleCharacterCount={visibleCharacterCount}
                                />
                            )
                            : (
                                <CappellaText message={message} />
                            )}
                    </span>
                </AnimatedBubbleFrame>
            </motion.div>
        </motion.div>
    );
};

const VisualizerCappella: React.FC<VisualizerCappellaProps> = ({
    currentTime,
    currentLineIndex,
    lines,
    theme,
    audioPower,
    audioBands,
    showText = true,
    songTitle,
    coverUrl,
    useCoverColorBg = false,
    seed,
    staticMode = false,
    backgroundOpacity = 0.75,
    lyricsFontScale = 1,
    isPlayerChromeHidden = false,
    hideTranslationSubtitle = false,
    paused = false,
    onBack,
}) => {
    const { t } = useTranslation();
    const [viewportSize, setViewportSize] = useState(() => (
        typeof window === 'undefined'
            ? { width: 1280, height: 900 }
            : { width: window.innerWidth, height: window.innerHeight }
    ));
    const bubbleMetricsCacheRef = useRef(new Map<string, PreparedBubbleMetrics>());
    const [visibleLineIndex, setVisibleLineIndex] = useState(() => getVisibleLineIndexAtTime(lines, currentTime.get()));
    const visibleLineIndexRef = useRef(visibleLineIndex);
    const titleText = songTitle?.trim() || t('ui.noTrack');
    const maxVisibleMessages = useMemo(() => getMaxVisibleMessages(viewportSize.height), [viewportSize.height]);
    const messages = useMemo(() => buildCappellaMessages(lines, titleText), [lines, titleText]);
    const visibleMessages = useMemo(
        () => getVisibleMessages(messages, visibleLineIndex, maxVisibleMessages),
        [maxVisibleMessages, messages, visibleLineIndex]
    );
    const baseFontSize = Math.max(15, Math.min(26, 18 * lyricsFontScale));
    const maxPanelWidth = Math.min(Math.max(viewportSize.width - 32, 1), 896);
    const bubbleGroupRatio = viewportSize.width >= 640 ? 0.68 : 0.78;
    const maxTextWidth = Math.max(96, Math.floor(maxPanelWidth * bubbleGroupRatio - 56));
    const { activeLine, recentCompletedLine, upcomingLine, nextLines } = useVisualizerRuntime({
        currentTime,
        currentLineIndex,
        lines,
        getLineEndTime: getLineRenderEndTime,
    });

    useEffect(() => {
        const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, currentTime.get());

        visibleLineIndexRef.current = nextVisibleLineIndex;
        setVisibleLineIndex(nextVisibleLineIndex);
    }, [currentTime, lines]);

    useEffect(() => {
        const handleResize = () => {
            setViewportSize({
                width: window.innerWidth,
                height: window.innerHeight,
            });
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    useMotionValueEvent(currentTime, 'change', latest => {
        const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, latest);

        if (nextVisibleLineIndex !== visibleLineIndexRef.current) {
            visibleLineIndexRef.current = nextVisibleLineIndex;
            setVisibleLineIndex(nextVisibleLineIndex);
        }

        if (!upcomingLine || !shouldPreheatLine(upcomingLine, latest, CAPPELLA_PREHEAT_WINDOW)) {
            return;
        }

        getOrBuildBubbleMetrics(bubbleMetricsCacheRef.current, {
            line: upcomingLine,
            theme,
            fontSize: baseFontSize * 1.34,
            lineHeightPx: baseFontSize * 1.34 * 1.45,
            maxTextWidth,
            paddingX: 20,
            paddingY: 16,
        });
    });

    return (
        <VisualizerShell
            theme={theme}
            audioPower={audioPower}
            audioBands={audioBands}
            coverUrl={coverUrl}
            useCoverColorBg={useCoverColorBg}
            seed={seed}
            staticMode={staticMode}
            backgroundOpacity={backgroundOpacity}
            paused={paused}
            onBack={onBack}
        >
            {showText && (
                <div className="relative z-10 flex h-full w-full items-start justify-center overflow-visible px-4 pb-36 pt-12 sm:px-8 sm:pb-40 sm:pt-16 lg:px-14 lg:pt-20">
                    <div className="flex w-full max-w-4xl flex-col justify-start gap-3 overflow-visible">
                        {visibleMessages.map((message) => (
                            <CappellaMessageRow
                                key={message.id}
                                message={message}
                                currentTime={currentTime}
                                currentLineIndex={currentLineIndex}
                                theme={theme}
                                coverUrl={coverUrl}
                                baseFontSize={baseFontSize}
                                maxTextWidth={maxTextWidth}
                                metricsCache={bubbleMetricsCacheRef}
                            />
                        ))}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes cappella-char-fade {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
            `}</style>

            <VisualizerSubtitleOverlay
                showText={showText}
                activeLine={activeLine}
                recentCompletedLine={recentCompletedLine}
                nextLines={nextLines}
                theme={theme}
                translationFontSize={`${Math.max(14, 16 * lyricsFontScale)}px`}
                upcomingFontSize={`${Math.max(12, 14 * lyricsFontScale)}px`}
                isPlayerChromeHidden={isPlayerChromeHidden}
                hideTranslationSubtitle={hideTranslationSubtitle}
            />
        </VisualizerShell>
    );
};

export default VisualizerCappella;
