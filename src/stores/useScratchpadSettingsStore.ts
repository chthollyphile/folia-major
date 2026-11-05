import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';

// src/stores/useScratchpadSettingsStore.ts
// 速记簿的设置：左缘的悬浮把手显不显示、放在左缘的什么高度。设置页「主页与歌单」的「速记簿」一组、
// 命令面板和 ScratchpadHost 三处读写。把手藏起来以后 Ctrl / ⌘ + J 与命令面板照常能开合抽屉。

const SHOW_HANDLE_KEY = 'scratchpad_show_handle';
const HANDLE_POSITION_KEY = 'scratchpad_handle_position';

/** 把手在左缘的高度：0 是最上面（标题栏与左上角返回钮之下，原来的位置），1 是贴近窗口底部。 */
export const SCRATCHPAD_HANDLE_POSITION_DEFAULT = 0;

const clampPosition = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : SCRATCHPAD_HANDLE_POSITION_DEFAULT);

const readStoredPosition = () => clampPosition(Number.parseFloat(getStoredString(HANDLE_POSITION_KEY, String(SCRATCHPAD_HANDLE_POSITION_DEFAULT))));

export type ScratchpadSettingsState = {
    showHandle: boolean;
    handlePosition: number;
    setShowHandle: (show: boolean) => void;
    toggleShowHandle: () => void;
    setHandlePosition: (position: number) => void;
};

export const useScratchpadSettingsStore = create<ScratchpadSettingsState>((set, get) => ({
    showHandle: getStoredBoolean(SHOW_HANDLE_KEY, true),
    handlePosition: readStoredPosition(),
    setShowHandle: (show) => {
        set({ showHandle: show });
        setStoredBoolean(SHOW_HANDLE_KEY, show);
    },
    toggleShowHandle: () => get().setShowHandle(!get().showHandle),
    setHandlePosition: (position) => {
        const next = clampPosition(position);
        set({ handlePosition: next });
        setStoredString(HANDLE_POSITION_KEY, String(next));
    },
}));
