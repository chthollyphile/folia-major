import { useEffect, useRef, useState } from 'react';
import type { OnlineProviderId } from '../../types/onlineMusic';
import type {
    LibraryAccountController,
    LibraryProviderSwitchCleanupPort,
} from '../core/account/account.contract';
import { createProviderAccountController } from '../core/account/providerAccountController.service';
import { createProviderAccountDeps } from '../core/account/providerAccountDeps.service';

// src/library/app/useLibraryAccountController.ts
// 应用持有的在线账户 controller（Library v2 · A4）：App 里调用一次——退出前的确认框与播放器的句柄只有 App 有。
// controller 只建一次，寿命跟着调用方（App 卸载时 dispose）；退出、那一问与播放器端口经 ref 指向每次渲染的最新实现，
// 所以 controller 不随渲染重建。读账号走默认装配（omni.readAccount）。

export type LibraryAccountHostTables = {
    /** 退出一个平台的登录（App 的 useProviderSignOut：omni.signOutAccount 与「已退出登录」的提示）。 */
    logout: (providerId: OnlineProviderId) => Promise<void>;
    /** 退出之前问用的人（App 的 useProviderSignOut 的确认框）；回 false 就不退。 */
    confirmLogout: (request: { providerId: OnlineProviderId; removesSongs: boolean }) => Promise<boolean>;
    /** 平台换了时的播放器端口（createLibraryAccountSwitchCleanupPort）。 */
    switchCleanup: LibraryProviderSwitchCleanupPort;
};

export const useLibraryAccountController = (tables: LibraryAccountHostTables): LibraryAccountController => {
    // 渲染时赋值（不放 effect）：effect 之前的窗口里事务会读到上一次渲染的表。
    const tablesRef = useRef(tables);
    tablesRef.current = tables;

    const createController = () => createProviderAccountController(createProviderAccountDeps({
        logout: providerId => tablesRef.current.logout(providerId),
        confirmLogout: request => tablesRef.current.confirmLogout(request),
        switchCleanup: {
            leaveProvider: (previous, next) => tablesRef.current.switchCleanup.leaveProvider(previous, next),
            holdsSongsOf: providerId => tablesRef.current.switchCleanup.holdsSongsOf(providerId),
            dropSongsOf: providerId => tablesRef.current.switchCleanup.dropSongsOf(providerId),
        },
    }));
    // StrictMode 会把 useState 的初始化函数调两次：经 ref 让两次拿到同一个实例，不留一个没人 dispose 的订阅者。
    const seedRef = useRef<LibraryAccountController | null>(null);
    const [controller, setController] = useState(() => (seedRef.current ??= createController()));

    // 卸载时 dispose。开发版 StrictMode 会先模拟一次卸载再挂载：那次 dispose 之后换一个新 controller，
    // 真正卸载时才只 dispose 不重建。
    const disposedRef = useRef(false);
    useEffect(() => {
        if (disposedRef.current) {
            disposedRef.current = false;
            setController(createController());
            return undefined;
        }
        return () => {
            controller.dispose();
            disposedRef.current = true;
        };
        // createController 只读 ref，不进依赖。
    }, [controller]);

    return controller;
};
