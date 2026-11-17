import { type Line, type Theme } from '../../../types';
import { mixColors } from '../../../utils/colorMix';
import { type CappellaIntensityConfig, type CappellaMessage, type CappellaTimedMessage, isTimedMessage } from './cappellaTypes';
import { AVATAR_GRID_SIZE, MAX_VISIBLE_MESSAGES } from './cappellaConstants';
import { measureBubbleText } from './cappellaBubbleMetrics';

// src/components/visualizer/cappella/cappellaMessageLayout.ts
// 消息列表的视口取舍与展示派生：头像位置、高度估算、可见消息筛选、消息状态、气泡配色、时间戳格式。

export const getAvatarPosition = (avatarIndex: number) => {
    const safeIndex = ((avatarIndex % 9) + 9) % 9;
    const col = safeIndex % AVATAR_GRID_SIZE;
    const row = Math.floor(safeIndex / AVATAR_GRID_SIZE);

    return {
        backgroundPosition: `${col * 50}% ${row * 50}%`,
        backgroundSize: `${AVATAR_GRID_SIZE * 100}% ${AVATAR_GRID_SIZE * 100}%`,
    };
};

/**
 * 估算特定消息渲染后的高度，用于动态控制可见消息列表的行数，避免超出视口。
 */
const getEstimatedMessageHeight = (
    message: CappellaMessage,
    isActive: boolean,
    motionConfig: CappellaIntensityConfig['motion'],
    theme: Theme,
    baseFontSize: number,
    maxTextWidth: number
): number => {
    if (message.kind === 'emo') {
        const imageSize = isActive ? motionConfig.emoActiveSize : motionConfig.emoInactiveSize;
        const scaleOverflow = isActive && motionConfig.activeScale > 1
            ? Math.ceil(imageSize * (motionConfig.activeScale - 1))
            : 0;
        return imageSize + scaleOverflow + 48 + 12; // 图像高度 + 缩放上溢 + pt-12 (48px) padding + gap-3 (12px) 间距
    }

    const fontSize = message.kind === 'title'
        ? baseFontSize
        : baseFontSize * (isActive ? motionConfig.activeFontMultiplier : motionConfig.inactiveFontMultiplier);
    const paddingX = isActive ? motionConfig.activePaddingX : motionConfig.inactivePaddingX;
    const paddingY = isActive ? motionConfig.activePaddingY : motionConfig.inactivePaddingY;
    const lineHeightPx = fontSize * 1.45;
    const measuredHeight = measureBubbleText({
        text: message.kind === 'title' ? message.text : message.line.fullText,
        theme,
        fontSize,
        lineHeightPx,
        maxTextWidth,
        paddingX,
        paddingY,
    }).height;
    const minHeight = Math.max(
        isActive ? motionConfig.activeMinHeight : motionConfig.inactiveMinHeight,
        lineHeightPx + paddingY * 2
    );
    const renderedHeight = Math.max(measuredHeight, minHeight);
    const scaleOverflow = isActive && motionConfig.activeScale > 1
        ? Math.ceil(renderedHeight * (motionConfig.activeScale - 1))
        : 0;

    return renderedHeight + scaleOverflow + 12; // 气泡实际高度 + 缩放上溢 + gap-3 (12px) 间距
};

/**
 * 根据视口高度以及所有消息的累积估算高度，动态筛选在视口中展示的最新歌词消息列表，从而防止底部超出。
 */
export const getVisibleMessages = (
    messages: CappellaMessage[],
    visibleLineIndex: number,
    viewportHeight: number,
    currentLineIndex: number,
    currentTime: number,
    motionConfig: CappellaIntensityConfig['motion'],
    theme: Theme,
    baseFontSize: number,
    maxTextWidth: number
) => {
    const visible = messages.filter(message => {
        if (message.kind === 'title') {
            return true;
        }

        if (message.kind === 'emo') {
            return currentTime >= message.activationStartTime;
        }

        return message.lineIndex <= visibleLineIndex;
    });

    // 计算气泡展示区域的可用高度：总高度减去底部播放控制条区域 (~160px) 和顶部状态栏/间距 (~80px)
    const usableHeight = Math.max(200, viewportHeight - 240);
    let accumulatedHeight = 0;
    const result: CappellaMessage[] = [];

    // 从最新消息（数组末尾）反向往前进行累加，防止下方溢出
    for (let i = visible.length - 1; i >= 0; i--) {
        const message = visible[i];
        const timedData = isTimedMessage(message) ? message : null;
        const isActive = timedData ? getTimedMessageState(timedData, currentTime, currentLineIndex).isActive : false;
        const estHeight = getEstimatedMessageHeight(
            message,
            isActive,
            motionConfig,
            theme,
            baseFontSize,
            maxTextWidth
        );

        if (accumulatedHeight + estHeight > usableHeight && result.length >= 2) {
            // 保留至少 2 条消息做为上下文，其余超出高度的不再包括
            break;
        }

        accumulatedHeight += estHeight;
        result.unshift(message);

        if (result.length >= MAX_VISIBLE_MESSAGES) {
            break;
        }
    }

    return result;
};

export const getVisibleLineIndexAtTime = (lines: Line[], currentTime: number) => {
    for (let index = lines.length - 1; index >= 0; index--) {
        if (currentTime >= lines[index].startTime) {
            return index;
        }
    }

    return -1;
};

export const getTimedMessageState = (message: CappellaTimedMessage, currentTime: number, currentLineIndex: number) => {
    if (message.kind === 'emo') {
        return {
            isActive: currentTime >= message.activationStartTime && currentTime < message.activationEndTime,
            isPassed: currentTime >= message.activationEndTime,
        };
    }

    return {
        isActive: message.lineIndex === currentLineIndex,
        isPassed: message.lineIndex < currentLineIndex,
    };
};

export const getBubbleColors = (message: CappellaMessage, theme: Theme) => {
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

export const formatTimestamp = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '0:00';
    }

    const totalSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};
