import React from 'react';
import '../../src/i18n/config';
import Home from '../../src/components/app/Home';
import AccountTab from '../../src/components/panelTab/AccountTab';
import LoginHost from '../../src/components/login/LoginHost';
import { useOnlineProviderAccountStore } from '../../src/stores/useOnlineProviderAccountStore';
import type { ProbeDefinition } from './definition';
import type { LibraryAccountController } from '../../src/library/core/account/account.contract';
import { useAccountProbeEnvironment, useAccountProbeModel } from './accountBehavior/useAccountProbeHarness';
import { ACCOUNT_NETEASE } from './accountBehavior/accountFixtureRules';
// dev/probes/accountBehavior.probe.tsx

/**
 * 在线账户（扫码登录、选平台、切换确认、登出）的行为回归探针：挂真实的 `Home`（registry 解析出的首页 surface，
 * 网格 suite 下就是 Grid3D，切换器、连接面板都在里面；登录弹窗与切换确认框由 Home 里的账户宿主渲染），
 * 账户状态来自真实的账户 controller（useLibraryAccountController），刷新器 / 登出表与 App 同形，切换清理是应用的
 * 端口外包一层记账（accountBehavior/probeSwitchCleanup.ts）。账户面板（AccountTab）按 UnifiedPanel 的方式可选挂上。
 *
 * A6 起选中 TUI 时首页是 TUI 首页（在线页签的平台列表），登录框与切换确认由 TUI 的 account surface 渲染。
 *
 * 它是 Library v2 账户重构（A0 起）的回归闸门：test/component/accountBehavior.spec.ts 通过 window.__accountProbe
 * 编排假 auth provider、网易本地后端与账户种子，读调用账（要码 / 轮询 / 取消 / 刷新 / 登出 / 切换清理）。
 * 不写 IndexedDB，不需要沙盒模式。
 *
 * 宿主区域套了一层 transform：首页里的 fixed 层（确认框、弹窗）以这块区域为包含块。
 */
const AccountTabPanel: React.FC<{ account: LibraryAccountController }> = ({ account }) => {
    return (
        <div data-probe-account-tab className="absolute left-4 top-4 z-[150] w-80 rounded-2xl bg-zinc-900/95 p-4 text-white shadow-2xl">
            <AccountTab
                accountController={account}
                audioQuality="high"
                onAudioQualityChange={() => {}}
                onSyncData={() => {}}
                isSyncing={false}
                onNavigateHome={() => {}}
            />
        </div>
    );
};

const AccountProbeStage: React.FC = () => {
    const { model, account, accountTabVisible } = useAccountProbeModel();
    return (
        <>
            <Home model={model} />
            {/* 和 App.tsx 一样：登录窗口挂一个，接同一个账户 controller。 */}
            <LoginHost account={account} />
            {accountTabVisible && <AccountTabPanel account={account} />}
        </>
    );
};

const AccountBehaviorProbe: React.FC = () => {
    const ready = useAccountProbeEnvironment();
    return (
        <div
            data-probe-host
            className="fixed inset-0 overflow-hidden"
            style={{ transform: 'translateZ(0)', backgroundColor: 'var(--bg-color)', color: 'var(--text-primary)' }}
        >
            {ready && <AccountProbeStage />}
        </div>
    );
};

export default {
    id: 'accountBehavior',
    title: '在线账户行为回归（真实 Home / Grid3D 登录弹窗 / 切换器）',
    description: '假扫码 provider（可编排状态、TTL、多登录方式、刷新失败）+ 网易后端故障 + 真实的账户 controller 与宿主；Library v2 账户重构的回归闸门。',
    Component: AccountBehaviorProbe,
} satisfies ProbeDefinition;
