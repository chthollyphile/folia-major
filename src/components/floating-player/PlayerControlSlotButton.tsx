import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { resolvePlayerControlSlot, type PlayerControlSlotActionId, type PlayerControlSlotContext } from './playerControlSlotActions';

// src/components/floating-player/PlayerControlSlotButton.tsx
// 进度条胶囊右侧的一个可自定义槽位。样式沿用原来写死的循环 / 歌词时间轴按钮。

/** 按住这么久算长按，打开原地更换浮层。 */
const LONG_PRESS_MS = 500;
/** 手指挪动超过这个距离就当是在滑动，不再算长按。 */
const LONG_PRESS_SLOP_PX = 10;
/**
 * 按下后过这么久才开始画蓄力圈：普通点一下不到这个时间就松开了，不该每次点都闪一圈。
 * 圈在剩下的时间里画满，画满的那一刻正好打开浮层。
 */
const PRESS_FEEDBACK_DELAY_MS = 140;

interface PlayerControlSlotButtonProps {
    actionId: PlayerControlSlotActionId;
    context: PlayerControlSlotContext;
    primaryColor: string;
    isDaylight?: boolean;
    /** 定位模式或播放源不可控时，整排按钮一起失效。 */
    controlsDisabled?: boolean;
    className?: string;
    /** 右键或长按时调用，交出按钮当下的位置；不传就没有原地更换。 */
    onCustomize?: (anchorRect: DOMRect) => void;
}

const PlayerControlSlotButton: React.FC<PlayerControlSlotButtonProps> = ({
    actionId,
    context,
    primaryColor,
    isDaylight,
    controlsDisabled = false,
    className = '',
    onCustomize,
}) => {
    const { t } = useTranslation();
    const slot = resolvePlayerControlSlot(actionId, context);
    const Icon = slot.icon;
    const disabled = slot.disabled || controlsDisabled;
    const label = t(slot.labelKey);
    const longPressRef = useRef<{ timer: number; x: number; y: number; } | null>(null);
    // 长按已经打开了浮层，紧跟着的那次 click 和 contextmenu 不能再当成一次点按。
    const suppressClickRef = useRef(false);
    // 正在按住、还没到长按：只在按下、松开、取消、触发时翻转，不跟指针移动。
    const [isPressing, setIsPressing] = useState(false);
    const reduceMotion = useReducedMotion();

    const cancelLongPress = () => {
        if (longPressRef.current) {
            window.clearTimeout(longPressRef.current.timer);
            longPressRef.current = null;
        }
        setIsPressing(false);
    };
    useEffect(() => cancelLongPress, []);

    // 三段视觉：已开启（循环非 off / 已喜爱）高亮，不可用压暗，其余是低透明度的常态。
    const stateClass = disabled
        ? 'cursor-not-allowed opacity-20'
        : slot.active
            ? (isDaylight ? 'bg-black/10 text-black' : 'bg-white/20')
            : `opacity-40 hover:opacity-100 ${isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10'}`;

    // 动作暂时不可用（比如没有歌词时的时间轴）时按钮仍要能右键更换，所以只有整排失效才用原生 disabled，
    // 原生 disabled 的按钮收不到 contextmenu 和 pointer 事件。
    const canCustomize = Boolean(onCustomize) && !controlsDisabled;

    return (
        <button
            type="button"
            // 思索教程按它认这个槽位放的是哪个动作。纯标记，不参与任何行为。
            data-ponder-slot={actionId}
            onClick={(e) => {
                e.stopPropagation();
                if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                }
                if (disabled) {
                    return;
                }
                slot.onActivate();
            }}
            onContextMenu={(e) => {
                if (!canCustomize) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                if (suppressClickRef.current) {
                    // 安卓长按之后浏览器还会补一个 contextmenu，浮层已经开了。
                    return;
                }
                onCustomize?.(e.currentTarget.getBoundingClientRect());
            }}
            onPointerDown={(e) => {
                suppressClickRef.current = false;
                // 鼠标、触屏、笔都能长按；鼠标只认主键按住，右键已经由 contextmenu 处理了。
                if (!canCustomize || (e.pointerType === 'mouse' && e.button !== 0)) {
                    return;
                }
                cancelLongPress();
                const target = e.currentTarget;
                setIsPressing(true);
                longPressRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    timer: window.setTimeout(() => {
                        longPressRef.current = null;
                        suppressClickRef.current = true;
                        setIsPressing(false);
                        onCustomize?.(target.getBoundingClientRect());
                    }, LONG_PRESS_MS),
                };
            }}
            onPointerMove={(e) => {
                const press = longPressRef.current;
                if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP_PX) {
                    cancelLongPress();
                }
            }}
            onPointerUp={cancelLongPress}
            onPointerCancel={cancelLongPress}
            onPointerLeave={cancelLongPress}
            disabled={controlsDisabled}
            aria-disabled={disabled}
            // 长按要换按钮，不能让 iOS 弹出系统的文本选择和长按菜单。
            className={`relative select-none rounded-full p-2 transition-colors [-webkit-touch-callout:none] ${stateClass} ${className}`}
            style={{
                color: primaryColor,
                // 按住时按钮慢慢缩一点、亮起来，和外圈一起读作「再按一会儿就会有事发生」；松开很快弹回。
                ...(isPressing ? { opacity: 1 } : null),
                ...(reduceMotion ? null : {
                    transform: isPressing ? 'scale(0.88)' : 'scale(1)',
                    transition: isPressing
                        ? `transform ${LONG_PRESS_MS - PRESS_FEEDBACK_DELAY_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1) ${PRESS_FEEDBACK_DELAY_MS}ms, background-color 150ms`
                        : 'transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 150ms',
                }),
            }}
            title={canCustomize ? `${label}\n${t('player.slotCustomizeHint')}` : label}
            aria-label={label}
        >
            <Icon
                size={20}
                className="sm:h-[18px] sm:w-[18px]"
                fill={slot.filled ? 'currentColor' : 'none'}
            />
            {/* 蓄力圈：从顶上顺时针画满，画满时浮层打开。 */}
            <AnimatePresence>
                {isPressing && !reduceMotion && (
                    <motion.svg
                        key="press-ring"
                        aria-hidden="true"
                        viewBox="0 0 36 36"
                        className="pointer-events-none absolute -inset-0.5 -rotate-90"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.12, delay: PRESS_FEEDBACK_DELAY_MS / 1000 } }}
                        exit={{ opacity: 0, transition: { duration: 0.15 } }}
                    >
                        <motion.circle
                            cx="18"
                            cy="18"
                            r="16.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            initial={{ pathLength: 0 }}
                            animate={{
                                pathLength: 1,
                                transition: {
                                    duration: (LONG_PRESS_MS - PRESS_FEEDBACK_DELAY_MS) / 1000,
                                    delay: PRESS_FEEDBACK_DELAY_MS / 1000,
                                    ease: 'linear',
                                },
                            }}
                        />
                    </motion.svg>
                )}
            </AnimatePresence>
        </button>
    );
};

export default PlayerControlSlotButton;
