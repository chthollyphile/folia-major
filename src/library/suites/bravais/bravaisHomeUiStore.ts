import { create } from 'zustand';

// src/library/suites/bravais/bravaisHomeUiStore.ts
// 首页缝里的全局搜索框开没开（B9）。它不是导航（不写 history），也不是缝的等级：开着时首页窄缝临时展开成完整宽度的
// 搜索框（bravaisSeamTarget 的 search 变体），提交（走 onSearchCommitted 去 SearchWorkspace）、「关闭搜索」、Esc、
// 折叠缝、换 suite（stage 卸载）都会关上。模块作用域，stage 与 surface 共用。
// fb3：书脊上的「⋯」要先把缝展开成窄缝、再打开窄缝里的菜单。书脊与窄缝是同一个组件的两种
// 排版，但翻转换内容时不保证是同一个实例，所以「展开后要打开什么」记在这里（openRequest），窄缝渲染出来时消费掉。
// 窄缝里的弹层（工具格的「⋯」菜单）开没开记在 popover。

/** 书脊展开成窄缝后要打开的东西：工具格的「⋯」菜单。 */
export type BravaisHomeOpenRequest = 'menu';

/** 首页窄缝里此刻开着的弹层（与 openRequest 同一组取值）。 */
export type BravaisHomePopover = BravaisHomeOpenRequest;

type BravaisHomeUiState = {
    searchOpen: boolean;
    openRequest: BravaisHomeOpenRequest | null;
    popover: BravaisHomePopover | null;
};

export const useBravaisHomeUiStore = create<BravaisHomeUiState>(() => ({ searchOpen: false, openRequest: null, popover: null }));

export const setBravaisSearchOpen = (open: boolean) => {
    if (useBravaisHomeUiStore.getState().searchOpen !== open) useBravaisHomeUiStore.setState({ searchOpen: open });
};

/** 记下 / 清掉书脊展开后要打开的东西。 */
export const setBravaisHomeOpenRequest = (request: BravaisHomeOpenRequest | null) => {
    if (useBravaisHomeUiStore.getState().openRequest !== request) useBravaisHomeUiStore.setState({ openRequest: request });
};

/** 开一个弹层（另一个随之收起），或收起全部（null）。 */
export const setBravaisHomePopover = (popover: BravaisHomePopover | null) => {
    if (useBravaisHomeUiStore.getState().popover !== popover) useBravaisHomeUiStore.setState({ popover });
};

/** 收起某一个弹层：此刻开着的正是它才收（别的弹层开着时不动）。 */
export const closeBravaisHomePopover = (popover: BravaisHomePopover) => {
    if (useBravaisHomeUiStore.getState().popover === popover) useBravaisHomeUiStore.setState({ popover: null });
};
