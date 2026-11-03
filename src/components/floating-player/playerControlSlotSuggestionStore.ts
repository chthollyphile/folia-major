import { create } from 'zustand';
import { getStoredString, setStoredString } from '../../stores/storagePrimitives';
import { usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
import { isPlayerControlSlotActionId } from '../../types/playerControlSlots';
import { playerControlSlotActionForCommand, type PlayerControlSlotActionId } from './playerControlSlotActions';

// src/components/floating-player/playerControlSlotSuggestionStore.ts
// 「把常用的命令放到进度条上？」的一次性提议。
//
// 命令面板每成功用一次命令就报一次它的使用频次（commandFrequency 的衰减计数）；能放进槽位、
// 又不在槽位里、用到了门槛次数、以前没提过的，就记成待提议。每个动作一辈子只提一次：
// 提示真正出现在胶囊上方的那一刻才记下，胶囊不在场时攒着的提议不算提过。

export const PLAYER_CONTROL_SLOT_SUGGESTION_STORAGE_KEY = 'player_control_slot_suggestions_offered_v1';

/** 衰减后的使用次数到这里才提议：用过一两次的命令不值得占槽位。 */
export const PLAYER_CONTROL_SLOT_SUGGESTION_MIN_USES = 5;

export type PlayerControlSlotSuggestionInput = {
    commandId: string;
    useCount: number;
    slots: readonly PlayerControlSlotActionId[];
    offered: readonly PlayerControlSlotActionId[];
};

/** 这次使用该不该变成一条提议；该的话返回要提议的槽位动作。 */
export const resolvePlayerControlSlotSuggestion = ({
    commandId,
    useCount,
    slots,
    offered,
}: PlayerControlSlotSuggestionInput): PlayerControlSlotActionId | null => {
    const actionId = playerControlSlotActionForCommand(commandId);
    if (!actionId || slots.includes(actionId) || offered.includes(actionId)) {
        return null;
    }
    return useCount >= PLAYER_CONTROL_SLOT_SUGGESTION_MIN_USES ? actionId : null;
};

const readOffered = (): PlayerControlSlotActionId[] => {
    try {
        const parsed: unknown = JSON.parse(getStoredString(PLAYER_CONTROL_SLOT_SUGGESTION_STORAGE_KEY, '[]'));
        return Array.isArray(parsed) ? parsed.filter(isPlayerControlSlotActionId) : [];
    } catch {
        return [];
    }
};

type PlayerControlSlotSuggestionState = {
    /** 等着出现在胶囊上方的提议。 */
    pending: PlayerControlSlotActionId | null;
    offered: PlayerControlSlotActionId[];
    noteCommandUse: (commandId: string, useCount: number) => void;
    /** 提示已经画出来了：从此不再提这个动作。 */
    markShown: (actionId: PlayerControlSlotActionId) => void;
    dismiss: () => void;
};

export const usePlayerControlSlotSuggestionStore = create<PlayerControlSlotSuggestionState>((set, get) => ({
    pending: null,
    offered: readOffered(),
    noteCommandUse: (commandId, useCount) => {
        const { playerControlSlotPrimary, playerControlSlotSecondary } = usePlayerChromeSettingsStore.getState();
        const actionId = resolvePlayerControlSlotSuggestion({
            commandId,
            useCount,
            slots: [playerControlSlotPrimary, playerControlSlotSecondary],
            offered: get().offered,
        });
        if (actionId && get().pending !== actionId) {
            set({ pending: actionId });
        }
    },
    markShown: (actionId) => {
        const { offered } = get();
        if (offered.includes(actionId)) {
            return;
        }
        const next = [...offered, actionId];
        setStoredString(PLAYER_CONTROL_SLOT_SUGGESTION_STORAGE_KEY, JSON.stringify(next));
        console.info(`[PlayerControlSlots] suggested ${actionId} for the control bar`);
        set({ offered: next });
    },
    dismiss: () => set({ pending: null }),
}));
