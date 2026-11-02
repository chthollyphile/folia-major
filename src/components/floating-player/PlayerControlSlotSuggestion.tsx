import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { capsuleGlassClass, capsuleGlassStyle } from './capsuleGlass';
import { PLAYER_CONTROL_SLOT_OPTIONS, type PlayerControlSlotActionId } from './playerControlSlotActions';
import type { PlayerControlSlotSide } from './PlayerControlSlotPicker';
import { usePlayerControlSlotSuggestionStore } from './playerControlSlotSuggestionStore';

// src/components/floating-player/PlayerControlSlotSuggestion.tsx
// 胶囊上方的一次性提示：「常用『睡眠定时』，放到进度条上？」，点一个现有按钮就把它换掉。

/** 没人理会就自己收起；指针停在上面时不计时。 */
const AUTO_DISMISS_MS = 12_000;

interface PlayerControlSlotSuggestionProps {
    actionId: PlayerControlSlotActionId;
    slotPrimary: PlayerControlSlotActionId;
    slotSecondary: PlayerControlSlotActionId;
    onReplace: (side: PlayerControlSlotSide) => void;
    onDismiss: () => void;
    isDaylight?: boolean;
}

const optionOf = (actionId: PlayerControlSlotActionId) => (
    PLAYER_CONTROL_SLOT_OPTIONS.find(option => option.id === actionId) ?? PLAYER_CONTROL_SLOT_OPTIONS[0]
);

const PlayerControlSlotSuggestion: React.FC<PlayerControlSlotSuggestionProps> = ({
    actionId,
    slotPrimary,
    slotSecondary,
    onReplace,
    onDismiss,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    const markShown = usePlayerControlSlotSuggestionStore(state => state.markShown);
    const [isHovered, setIsHovered] = useState(false);
    const onDismissRef = useRef(onDismiss);
    onDismissRef.current = onDismiss;

    useEffect(() => {
        markShown(actionId);
    }, [actionId, markShown]);

    useEffect(() => {
        if (isHovered) {
            return;
        }
        const timer = window.setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
        return () => window.clearTimeout(timer);
    }, [actionId, isHovered]);

    const suggested = optionOf(actionId);
    const SuggestedIcon = suggested.icon;
    const suggestedLabel = t(suggested.labelKey);

    const replaceButton = (side: PlayerControlSlotSide, current: PlayerControlSlotActionId) => {
        const option = optionOf(current);
        const Icon = option.icon;
        const label = t(side === 'primary' ? 'player.slotSuggestionReplacePrimary' : 'player.slotSuggestionReplaceSecondary', {
            action: t(option.labelKey),
        });
        return (
            <button
                type="button"
                data-slot-suggestion-replace={side}
                onClick={() => onReplace(side)}
                className="flex shrink-0 items-center gap-1 rounded-full border border-current/15 px-2.5 py-1 text-[11px] font-medium transition-colors hover:bg-current/10"
                title={label}
                aria-label={label}
            >
                <span className="opacity-60">{t('player.slotSuggestionReplace')}</span>
                <Icon size={13} />
            </button>
        );
    };

    return (
        <motion.div
            data-testid="player-control-slot-suggestion"
            role="status"
            // 窄屏上一行放不下问句和三个按钮：问句独占第一行、可换行，按钮挪到第二行；sm 起才并成一条胶囊。
            className={`pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1.5 rounded-3xl px-3 py-2 ${capsuleGlassClass(isDaylight)} sm:flex-nowrap sm:rounded-full sm:py-1.5 sm:pl-3 sm:pr-1.5`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            // 和进度条胶囊同一层玻璃。
            style={capsuleGlassStyle(isDaylight)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={event => event.stopPropagation()}
        >
            <SuggestedIcon size={15} className="shrink-0 opacity-80" />
            <span className="min-w-0 flex-[1_1_calc(100%-1.5rem)] text-xs sm:flex-[0_1_auto] sm:truncate">
                {t('player.slotSuggestion', { action: suggestedLabel })}
            </span>
            {replaceButton('primary', slotPrimary)}
            {replaceButton('secondary', slotSecondary)}
            <button
                type="button"
                onClick={onDismiss}
                className="shrink-0 rounded-full p-1 opacity-50 transition-opacity hover:opacity-100"
                aria-label={t('ui.close')}
            >
                <X size={13} />
            </button>
        </motion.div>
    );
};

export default PlayerControlSlotSuggestion;
