import { create } from 'zustand';

// src/stores/useCapsulePaletteStore.ts
// 进度条胶囊和命令面板之间的约定：胶囊在场时把自己登记在这里，面板打开那一刻看见它就从它
// 原地长出来；面板开着时告诉胶囊「你现在是我」，胶囊就淡出，免得两个叠在一起。

type CapsulePaletteState = {
    /** 能让面板从它长出来的胶囊节点；胶囊被隐藏、在定位模式里或不渲染时为 null。 */
    anchor: HTMLElement | null;
    /** 面板正以胶囊为外壳开着（含收起动画期间之前的那一刻）。 */
    isMorphed: boolean;
    setAnchor: (anchor: HTMLElement | null) => void;
    setIsMorphed: (isMorphed: boolean) => void;
};

export const useCapsulePaletteStore = create<CapsulePaletteState>(set => ({
    anchor: null,
    isMorphed: false,
    setAnchor: anchor => set(state => (state.anchor === anchor ? state : { anchor })),
    setIsMorphed: isMorphed => set(state => (state.isMorphed === isMorphed ? state : { isMorphed })),
}));
