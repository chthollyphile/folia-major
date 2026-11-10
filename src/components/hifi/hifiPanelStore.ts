import { create } from 'zustand';

// src/components/hifi/hifiPanelStore.ts
// 信号链路面板开没开。面板本身（HifiSignalPathPanel）读它；音质页、HiFi 徽标和命令面板的 hifi-signal-path 命令写它。

type HifiPanelState = {
    isSignalPathOpen: boolean;
    openSignalPath: () => void;
    closeSignalPath: () => void;
};

export const useHifiPanelStore = create<HifiPanelState>(set => ({
    isSignalPathOpen: false,
    openSignalPath: () => set({ isSignalPathOpen: true }),
    closeSignalPath: () => set({ isSignalPathOpen: false }),
}));

/** 给 React 之外的调用方（命令、徽标的点击处理）用。 */
export const openHifiSignalPath = () => useHifiPanelStore.getState().openSignalPath();

export const closeHifiSignalPath = () => useHifiPanelStore.getState().closeSignalPath();
