import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Command } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COMMAND_PALETTE_COMMANDS } from '../command-palette/commandRegistry';
import { readCommandFrequencyState } from '../command-palette/commandFrequency';
import { getCommandTitle } from '../command-palette/commandText';
import type { CommandPaletteCommand } from '../command-palette/types';
import { capsuleGlassClass, capsuleGlassStyle } from './capsuleGlass';
import { openCommandPalette } from '../../stores/useAppViewStore';
import { resolveCapsuleQuickActions } from './capsuleQuickActionSelection';
import {
    playerControlSlotActionForCommand,
    resolvePlayerControlSlot,
    type PlayerControlSlotActionId,
    type PlayerControlSlotContext,
} from './playerControlSlotActions';

// src/components/floating-player/CapsuleQuickActions.tsx
// 胶囊上方浮出的一排命令：指针在胶囊上停一会儿才出现，挑哪几条见 capsuleQuickActionSelection。
// 最右边固定一个打开命令面板的按钮，不受名单、上限和频次影响。
// 手指没有悬停：播放页上点开胶囊、或者暂停时，由 FloatingPlayerControls 直接浮出 4 秒。

/** 胶囊悬停展开后再停这么久才浮出：路过的指针不该每次都带出一排按钮。 */
const DWELL_MS = 250;

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
    /** 手指点开的：按钮放大到手指点得准的 44px，音量不上（见 capsuleQuickActionSelection）。 */
    touch?: boolean;
    /** 紧凑档（progress-bar v3）：画成展开胶囊里的一行，不浮在胶囊外面；命令面板那一格推到最右。 */
    inline?: boolean;
    /** 最多几条（不算命令面板那一格）；窄胶囊里放不下默认那么多时由调用方给。 */
    limit?: number;
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
    touch = false,
    inline = false,
    limit,
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
        touch,
        limit,
    }), [context, counts, slotPrimary, slotSecondary, touch, limit]);
    const buttonPadding = touch ? 'p-3' : 'p-2';
    const iconSize = touch ? 20 : 16;

    return (
        <motion.div
            // 下边距画在自己身上而不是外层：指针从胶囊往上挪到这排按钮时一直在悬停区里，胶囊不会中途收起。
            // 紧凑档（inline）里这一排是展开胶囊里的一行，没有自己的玻璃，也不用垫下边距。
            className={inline ? 'pointer-events-auto w-full' : 'pointer-events-auto pb-3'}
            data-testid="capsule-quick-actions"
            // 紧凑档的这一行由外面那层的 compact-reveal 淡入，这里不再叠一层。
            initial={inline ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={inline ? undefined : { opacity: 0, y: 6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            onClick={event => event.stopPropagation()}
        >
            <div
                role="group"
                aria-label={t('player.capsuleQuickActions')}
                className={inline
                    ? 'flex w-full items-center gap-0.5'
                    : `flex items-center gap-0.5 rounded-full p-1 ${capsuleGlassClass(isDaylight)}`}
                // 和进度条胶囊同一层玻璃。
                style={inline ? { color: 'var(--text-primary)' } : capsuleGlassStyle(isDaylight)}
            >
                {/* 紧凑档的这一行把命令在整行里匀开，不挤在左边；命令面板那一格连同分隔线留在最右，和最下一行的挂件位上下对齐。 */}
                <div className={inline ? 'flex min-w-0 flex-1 items-center justify-between' : 'contents'}>
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
                                className={`rounded-full ${buttonPadding} transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
                                    button.active ? 'bg-current/12' : 'opacity-70 hover:bg-current/10 hover:opacity-100'
                                }`}
                                title={title}
                                aria-label={title}
                            >
                                <Icon size={iconSize} fill={button.filled ? 'currentColor' : 'none'} />
                            </button>
                        );
                    })}
                </div>
                {commands.length > 0 && (
                    <span aria-hidden="true" className={`h-4 w-px shrink-0 bg-current opacity-15 ${inline ? 'mx-2' : 'mx-0.5'}`} />
                )}
                {/* 固定在最右：不管上面挑出了几条，总有一条路通到完整的命令面板，从进度条原地长出来。 */}
                <button
                    type="button"
                    data-capsule-action="open-command-palette"
                    onClick={() => openCommandPalette()}
                    className={`rounded-full ${buttonPadding} opacity-70 transition-colors hover:bg-current/10 hover:opacity-100`}
                    title={t('help.openCommandPalette')}
                    aria-label={t('help.openCommandPalette')}
                >
                    <Command size={iconSize} />
                </button>
            </div>
        </motion.div>
    );
};

export default CapsuleQuickActions;
