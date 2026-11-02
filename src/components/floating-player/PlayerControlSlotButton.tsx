import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { resolvePlayerControlSlot, type PlayerControlSlotActionId, type PlayerControlSlotContext } from './playerControlSlotActions';

// src/components/floating-player/PlayerControlSlotButton.tsx
// 进度条胶囊右侧的一个可自定义槽位。样式沿用原来写死的循环 / 歌词时间轴按钮。

/** 触屏按住这么久算长按，打开原地更换浮层。 */
const LONG_PRESS_MS = 500;
/** 手指挪动超过这个距离就当是在滑动，不再算长按。 */
const LONG_PRESS_SLOP_PX = 10;

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

    const cancelLongPress = () => {
        if (longPressRef.current) {
            window.clearTimeout(longPressRef.current.timer);
            longPressRef.current = null;
        }
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
                if (!canCustomize || e.pointerType === 'mouse') {
                    return;
                }
                cancelLongPress();
                const target = e.currentTarget;
                longPressRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    timer: window.setTimeout(() => {
                        longPressRef.current = null;
                        suppressClickRef.current = true;
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
            className={`select-none rounded-full p-2 transition-colors [-webkit-touch-callout:none] ${stateClass} ${className}`}
            style={{ color: primaryColor }}
            title={canCustomize ? `${label}\n${t('player.slotCustomizeHint')}` : label}
            aria-label={label}
        >
            <Icon
                size={20}
                className="sm:h-[18px] sm:w-[18px]"
                fill={slot.filled ? 'currentColor' : 'none'}
            />
        </button>
    );
};

export default PlayerControlSlotButton;
