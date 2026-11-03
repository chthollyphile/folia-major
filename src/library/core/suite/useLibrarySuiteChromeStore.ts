import { create } from 'zustand';
import type { LibrarySuiteChromeHandle } from './suiteChrome.contract';

// src/library/core/suite/useLibrarySuiteChromeStore.ts
// 命令面板此刻能操作的 suite 外观（B2）：哪套 suite 的外观在前台、它的外观动作能不能做、怎么做。
// 与 grid / directory / artist surface 同一个做法：只有正在交互的那一份注册；注册顶替之前的持有者，旧实例晚一步
// 卸载时不会注销已经接手的新实例（换 suite 时两套组件的卸载与挂载顺序不保证）。

type LibrarySuiteChromeState = {
    chrome: LibrarySuiteChromeHandle | null;
    /** 返回注销函数。注册会顶替之前的持有者。 */
    registerChrome: (handle: LibrarySuiteChromeHandle) => () => void;
};

export const useLibrarySuiteChromeStore = create<LibrarySuiteChromeState>((set, get) => ({
    chrome: null,
    registerChrome: (handle) => {
        set({ chrome: handle });
        return () => {
            if (get().chrome === handle) {
                set({ chrome: null });
            }
        };
    },
}));

/** 注册 suite 外观（动作，不需要订阅）。 */
export const registerLibrarySuiteChrome: LibrarySuiteChromeState['registerChrome'] = (handle) => (
    useLibrarySuiteChromeStore.getState().registerChrome(handle)
);
