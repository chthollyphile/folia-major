import type { PlayerControlSlotActionId } from '../../types/playerControlSlots';

// src/components/floating-player/capsuleQuickActionSelection.ts
// 胶囊上方那排浮动控件（浮岛）此刻画哪几个。
//
// 放什么、按什么顺序是用户在设置里摆的（usePlayerChromeSettingsStore 的 playerCapsuleIsland，和两个槽位共用一个控件池）。
// 这里只做三件事：已经在槽位里的不重复（存储层已经保证，这里再防一手），此刻用不了的不画（灰掉的按钮占着位置，
// 还会把能用的挤出这一排），放不下时从末尾截掉。

/** 手指点开的那一排不放音量：手机有实体音量键，音量滑块也不好用手指拖。 */
const MOUSE_ONLY: ReadonlySet<PlayerControlSlotActionId> = new Set(['volume']);

export type CapsuleQuickActionsInput = {
    island: readonly PlayerControlSlotActionId[];
    slots: readonly PlayerControlSlotActionId[];
    /** 此刻能不能用：槽位解析出的 disabled 取反。 */
    isAvailable: (id: PlayerControlSlotActionId) => boolean;
    /** 最多几个；缺省不截。 */
    limit?: number;
    /** 这一排是手指点开的。 */
    touch?: boolean;
};

export const resolveCapsuleQuickActions = ({
    island,
    slots,
    isAvailable,
    limit = Number.POSITIVE_INFINITY,
    touch = false,
}: CapsuleQuickActionsInput): PlayerControlSlotActionId[] => island
    .filter(id => !slots.includes(id) && !(touch && MOUSE_ONLY.has(id)) && isAvailable(id))
    .slice(0, Math.max(0, limit));
