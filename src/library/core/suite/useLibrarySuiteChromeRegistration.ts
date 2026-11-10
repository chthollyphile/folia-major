import { useEffect, useRef } from 'react';
import type { LibrarySuiteChromeHandler, LibrarySuiteChromeHandlers } from './suiteChrome.contract';
import { registerLibrarySuiteChrome } from './useLibrarySuiteChromeStore';

// src/library/core/suite/useLibrarySuiteChromeRegistration.ts
// 把一套 suite 的外观动作交给命令面板（B2），做法与 useLibraryArtistSurfaceRegistration 相同：只在可交互时注册，
// isInteractive 变假或组件卸载（换 suite 时随组件卸载）就注销；面板拿到的句柄经 latest-ref 读最近一次渲染的
// handlers，不读注册那一刻的闭包，handlers 每次渲染换新对象也不会重新注册。
// 动作的元数据（文案、关键词、执行键）在 manifest 的 chromeActions 里，这里只有实现。

/** 自有属性才算实现（handlers 是普通对象，`constructor` 之类的原型键不是动作）。 */
const handlerOf = (handlers: LibrarySuiteChromeHandlers, actionId: string): LibrarySuiteChromeHandler | null => (
    Object.prototype.hasOwnProperty.call(handlers, actionId) ? handlers[actionId] : null
);

export const useLibrarySuiteChromeRegistration = ({
    suiteId,
    isInteractive,
    handlers,
}: {
    /** 注册方所属的 suite（manifest 的 id）：命令面板只让这套 suite 声明的外观动作可用。 */
    suiteId: string;
    /** 只有用户正看着的那套外观发布动作。 */
    isInteractive: boolean;
    /** 动作 id → 实现；可以每次渲染给新对象。 */
    handlers: LibrarySuiteChromeHandlers;
}) => {
    // 渲染时赋值而不是在 effect 里：effect 之前的窗口里面板会读到上一次渲染的闭包。
    const latestRef = useRef(handlers);
    latestRef.current = handlers;

    useEffect(() => {
        if (!isInteractive) return undefined;
        return registerLibrarySuiteChrome({
            suiteId,
            isAvailable: (actionId) => handlerOf(latestRef.current, actionId)?.isAvailable() ?? false,
            run: (actionId) => {
                const handler = handlerOf(latestRef.current, actionId);
                // 执行时再问一次：面板打开后状态可能已经变了（执行模式按键直达，不经过列表）。
                if (!handler?.isAvailable()) return false;
                handler.run();
                return true;
            },
        });
    }, [isInteractive, suiteId]);
};
