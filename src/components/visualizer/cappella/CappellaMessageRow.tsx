import React, { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValueEvent, type MotionValue } from 'framer-motion';
import { type CappellaTuning, type Theme } from '../../../types';
import { resolveThemeFontWeight } from '../../../utils/fontStacks';
import { mixColors } from '../colorMix';
import { builtinAvatarImages, type CappellaAvatarImage, resolveCappellaAvatarUrl } from './avatarImages';
import { type CappellaIntensityConfig, type CappellaMessage, type CappellaTimedMessage, type PreparedBubbleMetrics, isTimedMessage } from './cappellaTypes';
import { CAPPELLA_BUBBLE_FONT_WEIGHT } from './cappellaConstants';
import { getBubbleTargetCharacterCount, getCharacterCountAtTime, getTimestampReadyTime } from './cappellaReveal';
import { getBubbleColors, getTimedMessageState } from './cappellaMessageLayout';
import { getOrBuildBubbleMetrics, measureBubbleText } from './cappellaBubbleMetrics';
import { ActiveCappellaText, AnimatedBubbleFrame, CappellaAvatar, CappellaBubbleGlow, CappellaText, CappellaTimestamp } from './CappellaBubbleParts';

// src/components/visualizer/cappella/CappellaMessageRow.tsx
// 单条聊天消息行：订阅播放时间算出当前字数与状态，组合头像、气泡与时间戳。

interface CappellaMessageRowProps {
    message: CappellaMessage;
    currentTime: MotionValue<number>;
    currentLineIndex: number;
    theme: Theme;
    coverUrl?: string | null;
    cappellaTuning: CappellaTuning;
    avatarSeed?: string | number;
    baseFontSize: number;
    maxTextWidth: number;
    metricsCache: React.MutableRefObject<Map<string, PreparedBubbleMetrics>>;
    intensityConfig: CappellaIntensityConfig;
    customAvatarImages?: CappellaAvatarImage[];
}

export const CappellaMessageRow = React.forwardRef<HTMLDivElement, CappellaMessageRowProps>(({
    message,
    currentTime,
    currentLineIndex,
    theme,
    coverUrl,
    cappellaTuning,
    avatarSeed,
    baseFontSize,
    maxTextWidth,
    metricsCache,
    intensityConfig,
    customAvatarImages,
}, ref) => {
    const isRight = message.side === 'right';
    const timedData: CappellaTimedMessage | null = isTimedMessage(message) ? message : null;
    const timedState = timedData ? getTimedMessageState(timedData, currentTime.get(), currentLineIndex) : null;
    const isActiveMessage = timedState?.isActive ?? false;
    const isPassedMessage = timedState?.isPassed ?? false;
    const isEmoMessage = message.kind === 'emo';
    const motionConfig = intensityConfig.motion;
    const bubbleFontSize = isActiveMessage
        ? baseFontSize * motionConfig.activeFontMultiplier
        : message.kind === 'title'
            ? baseFontSize
            : baseFontSize * motionConfig.inactiveFontMultiplier;
    const bubblePaddingX = isActiveMessage ? motionConfig.activePaddingX : motionConfig.inactivePaddingX;
    const bubblePaddingY = isActiveMessage ? motionConfig.activePaddingY : motionConfig.inactivePaddingY;
    const bubbleColors = getBubbleColors(message, theme);
    const avatarUrl = resolveCappellaAvatarUrl({
        avatarSource: cappellaTuning.avatarSource,
        coverUrl,
        avatarIndex: message.avatarIndex,
        side: message.side,
        seed: avatarSeed,
        avatars: builtinAvatarImages,
        customAvatarImages,
    });
    const useAvatarGridCrop = cappellaTuning.avatarSource === 'cover' && Boolean(coverUrl);
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
    const [visibleCharacterCount, setVisibleCharacterCount] = useState(() => (
        preparedMetrics ? getCharacterCountAtTime(preparedMetrics.revealTimes, currentTime.get()) : 0
    ));
    const [targetCharacterCount, setTargetCharacterCount] = useState(() => (
        preparedMetrics ? getBubbleTargetCharacterCount(preparedMetrics, currentTime.get()) : 0
    ));
    const [isTimestampVisible, setIsTimestampVisible] = useState(() => (
        timedData !== null && (
            timedData.kind === 'emo'
                ? currentTime.get() >= timedData.activationEndTime
                : isPassedMessage || currentTime.get() >= getTimestampReadyTime(preparedMetrics, timedData.line)
        )
    ));
    // 表情图片：active 时更大
    const emoImageSize = isActiveMessage ? motionConfig.emoActiveSize : motionConfig.emoInactiveSize;
    const targetSize = useMemo(() => {
        if (isEmoMessage) {
            return { width: emoImageSize, height: emoImageSize };
        }

        if (message.kind !== 'lyric') {
            return null;
        }

        if (isActiveMessage) {
            const prepared = preparedMetrics ?? getOrBuildBubbleMetrics(metricsCache.current, {
                line: message.line,
                theme,
                fontSize: bubbleFontSize,
                lineHeightPx,
                maxTextWidth,
                paddingX: bubblePaddingX,
                paddingY: bubblePaddingY,
            });
            const clampedTargetCount = Math.max(0, Math.min(targetCharacterCount, prepared.sizes.length - 1));

            return prepared.sizes[clampedTargetCount];
        }

        // 对非 active 歌词也计算显式尺寸，使 active→passed 过渡时
        // width/height 连续动画，避免头像因布局瞬变而跳跃
        return measureBubbleText({
            text: message.line.fullText,
            theme,
            fontSize: bubbleFontSize,
            lineHeightPx,
            maxTextWidth,
            paddingX: bubblePaddingX,
            paddingY: bubblePaddingY,
        });
    }, [
        bubbleFontSize,
        bubblePaddingX,
        bubblePaddingY,
        emoImageSize,
        isActiveMessage,
        isEmoMessage,
        lineHeightPx,
        maxTextWidth,
        message,
        metricsCache,
        preparedMetrics,
        theme,
        targetCharacterCount,
    ]);
    // scale(origin=bottom) 的视觉上溢量，作为同元素的 marginTop 补偿。
    // 使用完整文本的最终高度而非逐字变化的 targetSize，避免逐帧触发 marginTop 布局重排。
    const scaleOverflow = isActiveMessage && motionConfig.activeScale > 1
        ? Math.ceil(
            Math.max(
                isEmoMessage
                    ? emoImageSize
                    : (message.kind === 'lyric' && preparedMetrics
                        ? (preparedMetrics.sizes[preparedMetrics.sizes.length - 1]?.height ?? motionConfig.activeMinHeight)
                        : motionConfig.activeMinHeight),
                40
            ) * (motionConfig.activeScale - 1)
        )
        : 0;
    useEffect(() => {
        if (message.kind !== 'lyric' && message.kind !== 'emo') {
            return;
        }

        const latest = currentTime.get();
        const nextVisibleCount = message.kind === 'lyric' && preparedMetrics
            ? getCharacterCountAtTime(preparedMetrics.revealTimes, latest)
            : 0;
        const nextTargetCount = message.kind === 'lyric' && preparedMetrics
            ? getBubbleTargetCharacterCount(preparedMetrics, latest)
            : 0;

        setVisibleCharacterCount(current => current === nextVisibleCount ? current : nextVisibleCount);
        setTargetCharacterCount(current => current === nextTargetCount ? current : nextTargetCount);
        const nextTimestampVisible = message.kind === 'emo'
            ? latest >= message.activationEndTime
            : isPassedMessage || latest >= getTimestampReadyTime(preparedMetrics, message.line);
        setIsTimestampVisible(nextTimestampVisible);
    }, [currentTime, isActiveMessage, isPassedMessage, message, preparedMetrics]);

    useMotionValueEvent(currentTime, 'change', latest => {
        if (message.kind === 'lyric' || message.kind === 'emo') {
            const nextTimestampVisible = message.kind === 'emo'
                ? latest >= message.activationEndTime
                : isPassedMessage || latest >= getTimestampReadyTime(preparedMetrics, message.line);
            setIsTimestampVisible(current => current === nextTimestampVisible ? current : nextTimestampVisible);
        }

        if (isActiveMessage) {
            const nextVisibleCount = message.kind === 'lyric' && preparedMetrics
                ? getCharacterCountAtTime(preparedMetrics.revealTimes, latest)
                : 0;
            const nextTargetCount = message.kind === 'lyric' && preparedMetrics
                ? getBubbleTargetCharacterCount(preparedMetrics, latest)
                : 0;
            setVisibleCharacterCount(current => current === nextVisibleCount ? current : nextVisibleCount);
            setTargetCharacterCount(current => current === nextTargetCount ? current : nextTargetCount);
        }
    });

    return (
        <motion.div
            ref={ref}
            layout="position"
            initial={{ opacity: 0, y: motionConfig.rowEnterY, scale: motionConfig.rowEnterScale }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{
                opacity: 0,
                y: motionConfig.rowExitY,
                scale: motionConfig.rowExitScale,
                transition: { duration: motionConfig.rowExitDuration, ease: 'easeIn' },
            }}
            transition={{ duration: motionConfig.rowEnterDuration, ease: 'easeOut' }}
            className={`flex w-full items-end gap-3 ${isRight ? 'justify-end' : 'justify-start'} ${isEmoMessage ? 'pt-12' : ''}`}
        >
            <motion.div
                animate={{
                    opacity: isPassedMessage ? motionConfig.passedOpacity : 1,
                    scale: isActiveMessage ? motionConfig.activeScale : isPassedMessage ? motionConfig.passedScale : 1,
                    marginTop: scaleOverflow,
                }}
                transition={{ type: 'spring', ...motionConfig.avatarSpring }}
                // w-full 用于防止右侧气泡宽度变化导致的次像素抖动
                className={`flex w-full max-w-[78%] items-end gap-3 sm:max-w-[68%] ${isRight ? 'flex-row-reverse' : 'flex-row'}`}
                style={{
                    transformOrigin: isRight ? '100% 100%' : '0% 100%',
                }}
            >
                <CappellaAvatar
                    avatarUrl={avatarUrl}
                    avatarIndex={message.avatarIndex}
                    theme={theme}
                    side={message.side}
                    useAvatarGridCrop={useAvatarGridCrop}
                />
                {isEmoMessage
                    ? (
                        <motion.div
                            className="relative shrink-0"
                            animate={{
                                width: emoImageSize,
                                height: emoImageSize,
                            }}
                            transition={{
                                width: { duration: motionConfig.emoSizeTransitionDuration, ease: 'easeOut' as const },
                                height: { duration: motionConfig.emoSizeTransitionDuration, ease: 'easeOut' as const },
                            }}
                            style={{ width: emoImageSize, height: emoImageSize }}
                        >
                            {timedData && (
                                <CappellaTimestamp
                                    line={timedData.line}
                                    color={theme.secondaryColor}
                                    isVisible={isTimestampVisible}
                                    style={{
                                        bottom: -2,
                                        [isRight ? 'right' : 'left']: 'calc(100% + 8px)',
                                    }}
                                />
                            )}
                            <motion.div
                                initial={{ opacity: 0, scale: motionConfig.emoEnterScale }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: motionConfig.rowEnterDuration, ease: 'easeOut' }}
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    display: 'block',
                                }}
                            >
                                <img
                                    src={message.emoImageUrl}
                                    alt="emo"
                                    className="rounded-2xl"
                                    style={{
                                        width: '100%',
                                        height: '100%',
                                        objectFit: 'contain',
                                        display: 'block',
                                        animation: 'cappella-emo-wiggle 1.9s ease-in-out infinite',
                                        willChange: 'transform',
                                    }}
                                />
                            </motion.div>
                        </motion.div>
                    )
                    : (
                        <AnimatedBubbleFrame
                            className={`relative rounded-3xl shadow-lg transition-[min-height,box-shadow,background-color] duration-200 ease-out ${isRight ? 'rounded-br-md' : 'rounded-bl-md'
                                }`}
                            floatingAdornment={timedData ? (
                                <CappellaTimestamp
                                    line={timedData.line}
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
                                fontWeight: resolveThemeFontWeight(theme, CAPPELLA_BUBBLE_FONT_WEIGHT),
                                lineHeight: 1.45,
                                maxWidth: maxTextWidth + bubblePaddingX * 2 + 2,
                                minHeight: Math.max(
                                    isActiveMessage ? motionConfig.activeMinHeight : motionConfig.inactiveMinHeight,
                                    bubbleFontSize * 1.45 + bubblePaddingY * 2
                                ),
                                minWidth: isActiveMessage ? 72 : undefined,
                                padding: `${bubblePaddingY}px ${bubblePaddingX}px`,
                                boxShadow: isActiveMessage
                                    ? `0 18px 48px ${mixColors(theme.backgroundColor, theme.accentColor, 0.2, motionConfig.activeShadowAlpha)}`
                                    : undefined,
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                            }}
                        >
                            <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                                <CappellaBubbleGlow isActive={isActiveMessage} isRight={isRight} motionConfig={motionConfig} />
                            </div>
                            <span className="relative z-10">
                                {message.kind === 'lyric' && isActiveMessage && preparedMetrics
                                    ? (
                                        <ActiveCappellaText
                                            line={message.line}
                                            visibleCharacterCount={visibleCharacterCount}
                                        />
                                    )
                                    : (
                                        <CappellaText message={message} />
                                    )}
                            </span>
                        </AnimatedBubbleFrame>
                    )}
            </motion.div>
        </motion.div>
    );
});

CappellaMessageRow.displayName = 'CappellaMessageRow';
