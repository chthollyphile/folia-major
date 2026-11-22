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
 * 在线账户（扫码登录、选平台、切换、登出）的行为回归探针：挂真实的 `Home`（registry 解析出的首页 surface，
 * 网格 suite 下就是 Grid3D，右下角的切换器与未登录时的「登录」按钮都在里面），和 App 一样在旁边挂一个共用的
 * 登录窗口（LoginHost：选平台、登录、切换、退出登录都在那个窗口里）。账户状态来自真实的账户 controller
 * （useLibraryAccountController），登出表与 App 同形，读账号走默认装配（omni.readAccount → 假 provider），
 * 切换清理是应用的端口外包一层记账（accountBehavior/probeSwitchCleanup.ts）。账户面板（AccountTab）按
 * UnifiedPanel 的方式可选挂上。
 *
 * 选中 TUI 时首页是 TUI 首页（在线页签的平台列表）：选已登录的平台直接切，选未登录的平台打开同一个登录窗口。
 *
 * 它是 Library v2 账户重构（A0 起）的回归闸门：test/component/accountBehavior.spec.ts 通过 window.__accountProbe
 * 编排假 auth provider、网易本地后端与账户种子，读调用账（要码 / 轮询 / 取消 / 读账号 / 登出 / 切换清理）。
 * 读到的账号会照应用的做法存一份快照（IndexedDB），每条用例是新的浏览器上下文，互不影响。
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
    title: '在线账户行为回归（真实 Home / 共用登录窗口 / 切换器）',
    description: '假扫码 provider（可编排状态、TTL、多登录方式、刷新失败）+ 网易后端故障 + 真实的账户 controller 与宿主；Library v2 账户重构的回归闸门。',
    Component: AccountBehaviorProbe,
} satisfies ProbeDefinition;
