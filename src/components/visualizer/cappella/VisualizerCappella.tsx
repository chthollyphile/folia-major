import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValueEvent, type MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { type AudioBands, type Line, type Theme, type Word } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import { useVisualizerRuntime } from '../runtime';
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

const getTypedWordText = (word: Word, currentTime: number) => {
    if (currentTime < word.startTime) {
        return '';
    }

    if (currentTime >= word.endTime) {
        return word.text;
    }

    const characters = Array.from(word.text);
    const duration = Math.max(word.endTime - word.startTime, 0.001);
    const progress = Math.min(1, Math.max(0, (currentTime - word.startTime) / duration));
    const visibleCount = Math.floor(characters.length * progress);

    return characters.slice(0, visibleCount).join('');
};

const getAvatarPosition = (avatarIndex: number) => {
    const safeIndex = ((avatarIndex % 9) + 9) % 9;
    const col = safeIndex % AVATAR_GRID_SIZE;
    const row = Math.floor(safeIndex / AVATAR_GRID_SIZE);

    return {
        backgroundPosition: `${col * 50}% ${row * 50}%`,
        backgroundSize: `${AVATAR_GRID_SIZE * 100}% ${AVATAR_GRID_SIZE * 100}%`,
    };
};

const getVisibleMessages = (messages: CappellaMessage[], visibleLineIndex: number) => {
    const visible = messages.filter(message => (
        message.kind === 'title' || message.lineIndex <= visibleLineIndex
    ));

    return visible.slice(-MAX_VISIBLE_MESSAGES);
};

const getVisibleLineIndexAtTime = (lines: Line[], currentTime: number) => {
    for (let index = lines.length - 1; index >= 0; index--) {
        if (currentTime >= lines[index].startTime) {
            return index;
        }
    }

    return -1;
};

const CappellaAvatar: React.FC<{
    coverUrl?: string | null;
    avatarIndex: number;
    theme: Theme;
}> = ({ coverUrl, avatarIndex, theme }) => {
    const avatarPosition = getAvatarPosition(avatarIndex);

    return (
        <div
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
    currentTime: MotionValue<number>;
    isActive: boolean;
}> = ({ message, currentTime, isActive }) => {
    if (message.kind === 'title') {
        return <>{message.text}</>;
    }

    if (!isActive) {
        return <>{message.line.fullText}</>;
    }

    return <ActiveCappellaText line={message.line} currentTime={currentTime} />;
};

const ActiveCappellaText: React.FC<{
    line: Line;
    currentTime: MotionValue<number>;
}> = ({ line, currentTime }) => {
    const [activeTime, setActiveTime] = useState(() => currentTime.get());

    useMotionValueEvent(currentTime, 'change', latest => {
        setActiveTime(latest);
    });

    return (
        <>
            {line.words.map((word, index) => (
                <React.Fragment key={`${word.startTime}-${index}`}>
                    {getTypedWordText(word, activeTime)}
                </React.Fragment>
            ))}
        </>
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
    const [visibleLineIndex, setVisibleLineIndex] = useState(() => getVisibleLineIndexAtTime(lines, currentTime.get()));
    const visibleLineIndexRef = useRef(visibleLineIndex);
    const titleText = songTitle?.trim() || t('ui.noTrack');
    const messages = useMemo(() => buildCappellaMessages(lines, titleText), [lines, titleText]);
    const visibleMessages = useMemo(() => getVisibleMessages(messages, visibleLineIndex), [messages, visibleLineIndex]);
    const baseFontSize = Math.max(15, Math.min(26, 18 * lyricsFontScale));
    const { activeLine, recentCompletedLine, nextLines } = useVisualizerRuntime({
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

    useMotionValueEvent(currentTime, 'change', latest => {
        const nextVisibleLineIndex = getVisibleLineIndexAtTime(lines, latest);

        if (nextVisibleLineIndex !== visibleLineIndexRef.current) {
            visibleLineIndexRef.current = nextVisibleLineIndex;
            setVisibleLineIndex(nextVisibleLineIndex);
        }
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
                <div className="relative z-10 flex h-full w-full items-start justify-center px-4 pb-36 pt-16 sm:px-8 sm:pb-40 sm:pt-20 lg:px-14 lg:pt-24">
                    <div className="flex max-h-[72vh] w-full max-w-4xl flex-col justify-start gap-3 overflow-hidden">
                        {visibleMessages.map((message) => {
                            const isRight = message.side === 'right';
                            const bubbleColor = isRight
                                ? theme.accentColor
                                : 'rgba(255,255,255,0.12)';
                            const textColor = isRight
                                ? theme.backgroundColor
                                : theme.primaryColor;

                            return (
                                <motion.div
                                    key={message.id}
                                    initial={{ opacity: 0, y: 22, scale: 0.98 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    transition={{ duration: 0.32, ease: 'easeOut' }}
                                    className={`flex w-full items-end gap-3 ${isRight ? 'justify-end' : 'justify-start'}`}
                                >
                                    {!isRight && (
                                        <CappellaAvatar coverUrl={coverUrl} avatarIndex={message.avatarIndex} theme={theme} />
                                    )}
                                    <div
                                        className={`max-w-[78%] rounded-3xl px-4 py-3 shadow-lg sm:max-w-[68%] ${
                                            isRight ? 'rounded-br-md' : 'rounded-bl-md'
                                        }`}
                                        style={{
                                            backgroundColor: bubbleColor,
                                            border: '1px solid rgba(255,255,255,0.14)',
                                            color: textColor,
                                            fontSize: baseFontSize,
                                            lineHeight: 1.45,
                                            whiteSpace: 'pre-wrap',
                                            overflowWrap: 'anywhere',
                                        }}
                                    >
                                        <CappellaText
                                            message={message}
                                            currentTime={currentTime}
                                            isActive={message.kind === 'lyric' && message.lineIndex === currentLineIndex}
                                        />
                                    </div>
                                    {isRight && (
                                        <CappellaAvatar coverUrl={coverUrl} avatarIndex={message.avatarIndex} theme={theme} />
                                    )}
                                </motion.div>
                            );
                        })}
                    </div>
                </div>
            )}

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
