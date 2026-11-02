import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COMMAND_PALETTE_COMMANDS } from '../command-palette/commandRegistry';
import { readCommandFrequencyState } from '../command-palette/commandFrequency';
import { getCommandTitle } from '../command-palette/commandText';
import type { CommandPaletteCommand } from '../command-palette/types';
import { capsuleGlassClass, capsuleGlassStyle } from './capsuleGlass';
import { resolveCapsuleQuickActions } from './capsuleQuickActionSelection';
import {
    playerControlSlotActionForCommand,
    resolvePlayerControlSlot,
    type PlayerControlSlotActionId,
    type PlayerControlSlotContext,
} from './playerControlSlotActions';

// src/components/floating-player/CapsuleQuickActions.tsx
// 胶囊上方浮出的一排命令：指针在胶囊上停一会儿才出现，挑哪几条见 capsuleQuickActionSelection。

/** 胶囊悬停展开后再停这么久才浮出：路过的指针不该每次都带出一排按钮。 */
const DWELL_MS = 400;

/**
 * 指针在胶囊上停够了没有。只看悬停：暂停时胶囊自己展开不算停留。
 * 只在悬停状态翻转时起停一个定时器，不进任何高频路径。
 */
export const useCapsuleQuickActionsDwell = (isHovered: boolean) => {
    const [hasDwelled, setHasDwelled] = useState(false);
    useEffect(() => {
        if (!isHovered) {
            setHasDwelled(false);
            return;
        }
        const timer = window.setTimeout(() => setHasDwelled(true), DWELL_MS);
        return () => window.clearTimeout(timer);
    }, [isHovered]);
    return isHovered && hasDwelled;
};

interface CapsuleQuickActionsProps {
    slotPrimary: PlayerControlSlotActionId;
    slotSecondary: PlayerControlSlotActionId;
    context: PlayerControlSlotContext;
    isDaylight?: boolean;
}

/** 一条命令画成按钮要的东西。能放进槽位的命令借槽位的解析，喜爱的实心心、打乱的可用性才跟胶囊一致。 */
const resolveButton = (command: CommandPaletteCommand, context: PlayerControlSlotContext) => {
    const slotAction = playerControlSlotActionForCommand(command.id);
    if (slotAction) {
        const slot = resolvePlayerControlSlot(slotAction, context);
        return { icon: slot.icon, filled: slot.filled, active: slot.active, disabled: slot.disabled, onActivate: slot.onActivate };
    }
    return {
        icon: command.icon ?? Command,
        filled: false,
        active: false,
        disabled: false,
        onActivate: () => context.invokeCommandById(command.id),
    };
};

const CapsuleQuickActions: React.FC<CapsuleQuickActionsProps> = ({
    slotPrimary,
    slotSecondary,
    context,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    // 频次只在放不下时用来取舍，浮出那一刻读一次就够，不跟着播放刷新。
    const [counts] = useState(() => readCommandFrequencyState().counts);
    // 不可用的在截断之前就去掉：灰掉的按钮占着位置，还会把能用的挤出这一排。
    const commands = useMemo(() => resolveCapsuleQuickActions({
        commands: COMMAND_PALETTE_COMMANDS,
        slots: [slotPrimary, slotSecondary],
        canInvoke: commandId => {
            if (!context.canInvokeCommandById(commandId)) {
                return false;
            }
            const slotAction = playerControlSlotActionForCommand(commandId);
            return !slotAction || !resolvePlayerControlSlot(slotAction, context).disabled;
        },
        counts,
    }), [context, counts, slotPrimary, slotSecondary]);

    if (commands.length === 0) {
        return null;
    }

    return (
        <motion.div
            // 下边距画在自己身上而不是外层：指针从胶囊往上挪到这排按钮时一直在悬停区里，胶囊不会中途收起。
            className="pointer-events-auto pb-3"
            data-testid="capsule-quick-actions"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            onClick={event => event.stopPropagation()}
        >
            <div
                role="group"
                aria-label={t('player.capsuleQuickActions')}
                className={`flex items-center gap-0.5 rounded-full p-1 ${capsuleGlassClass(isDaylight)}`}
                // 和进度条胶囊同一层玻璃。
                style={capsuleGlassStyle(isDaylight)}
            >
                {commands.map(command => {
                    const button = resolveButton(command, context);
                    const Icon = button.icon;
                    const title = getCommandTitle(command, t);
                    return (
                        <button
                            key={command.id}
                            type="button"
                            data-capsule-action={command.id}
                            disabled={button.disabled}
                            onClick={() => button.onActivate()}
                            className={`rounded-full p-2 transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
                                button.active ? 'bg-current/12' : 'opacity-70 hover:bg-current/10 hover:opacity-100'
                            }`}
                            title={title}
                            aria-label={title}
                        >
                            <Icon size={16} fill={button.filled ? 'currentColor' : 'none'} />
                        </button>
                    );
                })}
            </div>
        </motion.div>
    );
};

export default CapsuleQuickActions;
