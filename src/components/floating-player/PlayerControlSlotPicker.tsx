import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { capsuleGlassClass, capsuleGlassStyle } from './capsuleGlass';
import { PLAYER_CONTROL_SLOT_OPTIONS, type PlayerControlSlotActionId } from './playerControlSlotActions';

// src/components/floating-player/PlayerControlSlotPicker.tsx
// 在槽位正上方原地换按钮的小浮层：右键（触屏长按）槽位打开，选一个就换上，底部一行通往设置页。

const PICKER_WIDTH_PX = 296;
const VIEWPORT_MARGIN_PX = 8;
const ANCHOR_GAP_PX = 12;

export type PlayerControlSlotSide = 'primary' | 'secondary';

interface PlayerControlSlotPickerProps {
    /** 打开那一刻量到的槽位按钮位置；胶囊在浮层打开期间保持展开，位置不会再变。 */
    anchorRect: DOMRect;
    side: PlayerControlSlotSide;
    current: PlayerControlSlotActionId;
    /** 另一个槽位放着的动作：选它等于两个槽位互换。 */
    other: PlayerControlSlotActionId;
    onSelect: (actionId: PlayerControlSlotActionId) => void;
    onOpenSettings: () => void;
    onClose: () => void;
    isDaylight?: boolean;
}

const PlayerControlSlotPicker: React.FC<PlayerControlSlotPickerProps> = ({
    anchorRect,
    side,
    current,
    other,
    onSelect,
    onOpenSettings,
    onClose,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    const panelRef = useRef<HTMLDivElement | null>(null);
    const currentOptionRef = useRef<HTMLButtonElement | null>(null);

    useEffect(() => {
        currentOptionRef.current?.focus({ preventScroll: true });
    }, []);

    // 点浮层以外、按 Esc、窗口尺寸变了都收起：位置是打开时量的，尺寸一变就对不上了。
    useEffect(() => {
        const onPointerDown = (event: PointerEvent) => {
            if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onClose);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('resize', onClose);
        };
    }, [onClose]);

    const viewportWidth = typeof window === 'undefined' ? PICKER_WIDTH_PX : window.innerWidth;
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
    const width = Math.min(PICKER_WIDTH_PX, viewportWidth - VIEWPORT_MARGIN_PX * 2);
    const left = Math.min(
        Math.max(anchorRect.left + anchorRect.width / 2 - width / 2, VIEWPORT_MARGIN_PX),
        viewportWidth - width - VIEWPORT_MARGIN_PX,
    );
    const bottom = viewportHeight - anchorRect.top + ANCHOR_GAP_PX;

    if (typeof document === 'undefined') {
        return null;
    }

    return createPortal(
        <motion.div
            ref={panelRef}
            role="dialog"
            aria-label={t(side === 'primary' ? 'options.playerControlSlotPrimary' : 'options.playerControlSlotSecondary')}
            data-testid="player-control-slot-picker"
            className={`fixed z-[140] rounded-3xl p-2 ${capsuleGlassClass(isDaylight)}`}
            // 和进度条胶囊同一层玻璃，边沿是播放页面板那条 1px 线。
            style={{ left, bottom, width, ...capsuleGlassStyle(isDaylight) }}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            // 浮层是 portal，React 事件仍沿组件树往上冒泡；拦在这里，宿主外层的点击处理就碰不到浮层里的点按。
            onClick={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
            onContextMenu={event => event.preventDefault()}
        >
            <div className="px-2 pb-1.5 pt-1 text-[11px] font-medium opacity-55">
                {t(side === 'primary' ? 'options.playerControlSlotPrimary' : 'options.playerControlSlotSecondary')}
            </div>
            <div className="grid grid-cols-4 gap-1">
                {PLAYER_CONTROL_SLOT_OPTIONS.map(option => {
                    const Icon = option.icon;
                    const label = t(option.labelKey);
                    const isCurrent = option.id === current;
                    const isOther = option.id === other;
                    return (
                        <button
                            key={option.id}
                            ref={isCurrent ? currentOptionRef : undefined}
                            type="button"
                            data-slot-option={option.id}
                            aria-pressed={isCurrent}
                            title={isOther ? t('player.slotPickerSwapHint', { action: label }) : label}
                            onClick={() => onSelect(option.id)}
                            className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl px-1 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-current/40 ${
                                isCurrent ? 'bg-current/12' : 'hover:bg-current/8'
                            }`}
                        >
                            <Icon size={18} className={isCurrent ? '' : 'opacity-70'} />
                            <span className={`line-clamp-2 w-full break-words text-center text-[10.5px] leading-tight ${isCurrent ? 'font-semibold' : 'opacity-65'}`}>
                                {label}
                            </span>
                            {isOther && (
                                <span className="text-[9px] leading-none opacity-45">{t('player.slotPickerInOtherSlot')}</span>
                            )}
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                onClick={onOpenSettings}
                className="mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs opacity-60 transition-opacity hover:bg-current/8 hover:opacity-100"
            >
                <Settings2 size={14} />
                <span>{t('player.slotPickerMoreSettings')}</span>
            </button>
        </motion.div>,
        document.body,
    );
};

export default PlayerControlSlotPicker;
