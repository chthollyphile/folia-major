import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
import type { PlayerControlSlotActionId } from './playerControlSlotActions';
import type { PlayerControlSlotSide } from './PlayerControlSlotPicker';
import { usePlayerControlSlotSuggestionStore } from './playerControlSlotSuggestionStore';

// src/components/floating-player/usePlayerControlSlotCustomization.ts
// 胶囊上换槽位的两条入口共用的状态：右键 / 长按打开的原地更换浮层，和「常用命令放上来？」的提议。

export type PlayerControlSlotPickerState = { side: PlayerControlSlotSide; anchorRect: DOMRect; };

/** 换完按钮后胶囊再展开这么久：指针多半已经不在胶囊上，不撑一下用户看不到换上去的是什么。 */
const CHANGE_HOLD_MS = 1600;

export const usePlayerControlSlotCustomization = (
    slotPrimary: PlayerControlSlotActionId,
    slotSecondary: PlayerControlSlotActionId,
) => {
    const [slotPicker, setSlotPicker] = useState<PlayerControlSlotPickerState | null>(null);
    const setSlot = usePlayerChromeSettingsStore(state => state.handleSetPlayerControlSlot);
    const [isShowingChange, setIsShowingChange] = useState(false);
    const changeHoldTimerRef = useRef<number | null>(null);
    useEffect(() => () => {
        if (changeHoldTimerRef.current !== null) {
            window.clearTimeout(changeHoldTimerRef.current);
        }
    }, []);

    const closeSlotPicker = useCallback(() => setSlotPicker(null), []);
    const openPrimaryPicker = useCallback((anchorRect: DOMRect) => setSlotPicker({ side: 'primary', anchorRect }), []);
    const openSecondaryPicker = useCallback((anchorRect: DOMRect) => setSlotPicker({ side: 'secondary', anchorRect }), []);

    // 选中另一个槽位正放着的动作时两个槽位互换，不让两个按钮变成同一个。
    const assignSlot = useCallback((side: PlayerControlSlotSide, actionId: PlayerControlSlotActionId) => {
        const current = side === 'primary' ? slotPrimary : slotSecondary;
        const other = side === 'primary' ? slotSecondary : slotPrimary;
        if (actionId === current) {
            return;
        }
        if (actionId === other) {
            setSlot(side === 'primary' ? 'secondary' : 'primary', current);
        }
        setSlot(side, actionId);
        setIsShowingChange(true);
        if (changeHoldTimerRef.current !== null) {
            window.clearTimeout(changeHoldTimerRef.current);
        }
        changeHoldTimerRef.current = window.setTimeout(() => {
            changeHoldTimerRef.current = null;
            setIsShowingChange(false);
        }, CHANGE_HOLD_MS);
    }, [setSlot, slotPrimary, slotSecondary]);

    const pendingSuggestion = usePlayerControlSlotSuggestionStore(state => state.pending);
    const dismissSuggestion = usePlayerControlSlotSuggestionStore(state => state.dismiss);
    // 提议排着队时用户可能已经自己把它放进槽位了，那就不必再提。
    const slotSuggestion = pendingSuggestion && pendingSuggestion !== slotPrimary && pendingSuggestion !== slotSecondary
        ? pendingSuggestion
        : null;

    const acceptSuggestion = useCallback((side: PlayerControlSlotSide) => {
        if (slotSuggestion) {
            assignSlot(side, slotSuggestion);
        }
        dismissSuggestion();
    }, [assignSlot, dismissSuggestion, slotSuggestion]);

    return {
        slotPicker,
        closeSlotPicker,
        openPrimaryPicker,
        openSecondaryPicker,
        assignSlot,
        /** 刚换过按钮，胶囊要展开着让人看见结果。 */
        isShowingChange,
        slotSuggestion,
        acceptSuggestion,
        dismissSuggestion,
    };
};
