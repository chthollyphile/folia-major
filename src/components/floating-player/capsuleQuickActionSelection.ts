import type { CommandPaletteCommand } from '../command-palette/types';
import { PLAYER_CONTROL_SLOT_COMMAND_IDS, type PlayerControlSlotActionId } from './playerControlSlotActions';

// src/components/floating-player/capsuleQuickActionSelection.ts
// 胶囊上方那排浮动命令放哪几条。
//
// 只从声明了 capsuleAction 的命令里挑（喜爱、打乱、音量、歌词样式这类对正在播放的东西做的事），
// 和命令面板的高频区是两回事。已经在两个槽位里的不重复，此刻用不了的不显示，顺序跟注册表走、
// 固定不动；放不下时才用使用频次在这几条里决定留谁，留下的仍按原顺序排。

/**
 * 一排最多放几条。等于现在白名单的条数：默认槽位只占掉循环，剩下六条要全放得下，
 * 不然注册表里排最后的歌词样式选择器默认就被挤掉。以后白名单变长才会用到下面的取舍。
 */
export const CAPSULE_QUICK_ACTION_LIMIT = 6;

/** 槽位动作对应的命令 id；歌词时间轴没有命令，得 null。 */
export const slotCommandId = (actionId: PlayerControlSlotActionId): string | null => (
    actionId === 'lyrics-timeline' ? null : PLAYER_CONTROL_SLOT_COMMAND_IDS[actionId]
);

export type CapsuleQuickActionsInput = {
    commands: readonly CommandPaletteCommand[];
    slots: readonly PlayerControlSlotActionId[];
    /** 此刻能不能用：命令面板的那套判断，加上槽位解析出的不可用（比如平台不支持喜爱）。 */
    canInvoke: (commandId: string) => boolean;
    /** commandFrequency 的衰减计数，只在放不下时用来取舍。 */
    counts: Readonly<Record<string, number>>;
    limit?: number;
    /** 这一排是手指点开的：声明了 'mouse-only' 的（音量，手机有实体音量键）不上。 */
    touch?: boolean;
};

export const resolveCapsuleQuickActions = ({
    commands,
    slots,
    canInvoke,
    counts,
    limit = CAPSULE_QUICK_ACTION_LIMIT,
    touch = false,
}: CapsuleQuickActionsInput): CommandPaletteCommand[] => {
    const inSlots = new Set(slots.map(slotCommandId).filter((id): id is string => id !== null));
    const eligible = commands.filter(command => (
        (command.capsuleAction === true || (command.capsuleAction === 'mouse-only' && !touch))
        && !command.hidden
        && !inSlots.has(command.id)
        && canInvoke(command.id)
    ));
    if (eligible.length <= limit) {
        return eligible;
    }
    // Array.prototype.sort 是稳定的：次数相同的按注册表顺序取前面的。
    const kept = new Set(
        [...eligible]
            .sort((a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0))
            .slice(0, limit),
    );
    return eligible.filter(command => kept.has(command));
};
