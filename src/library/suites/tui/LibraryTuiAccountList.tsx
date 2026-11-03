import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderAccountSummary } from '../../../types/onlineMusic';
import type { LibraryAccountController } from '../../core/account/account.contract';
import { useLibraryAccountProviders, useLibraryAccountSelector } from '../../core/account/useLibraryAccount';
import { canLogoutProvider, resolveProviderSelectLabel } from '../../core/account/accountRules';
import { canSwitchToProviderDirectly } from '../../core/account/onlineProviderAccountView';
import { translateHomeMessage } from '../../core/home/homeSources';
import { providerDisplayName } from '../../../i18n/providerName';
import { colorWithAlpha } from '../../../components/visualizer/colorMix';
import { openLoginWindow } from '../../../components/login/loginWindowStore';
import { useLibraryTuiAccountListKeys } from './useLibraryTuiHomeKeyboard';

// src/library/suites/tui/LibraryTuiAccountList.tsx
// TUI 首页在线页签的平台列表（account-select / account-logout）：每个在线平台一行——当前标记、名称、账户状态
// （昵称 / 未登录 / 无需登录 / 未配置）、选它会做什么（切换到 / 登录）。未登录（guest）时它就是在线页签的内容，
// 已登录时由 F2 打开（替换目录列表，Esc / F2 关掉）。
// - ↑↓ / Home / End 移动焦点，Enter 调 account.selectProvider（能直接切的切过去、播放器里有歌先问，要登录的打开共用的
//   登录窗口，未配置的忽略）；
// - Delete 只对「当前且已登录」的平台登出（canLogoutProvider，且没有登出在途，与 AccountTab 同一条规则），controller 先问。
// 数据来自账户 controller 的绑定，动作全部调 controller；确认框由 account surface（LibraryTuiAccount）画，登录在窗口里。

type LibraryTuiAccountListProps = {
    account: LibraryAccountController;
    isInteractive: boolean;
    accentColor: string;
    isDaylight: boolean;
    /** 列表上方的一句话（未登录的原因，或「平台」标题）。 */
    heading: React.ReactNode;
    /** F2 打开的：Esc 关掉。未登录时列表就是页签内容，没有关闭。 */
    onClose?: () => void;
};

const statusOf = (provider: ProviderAccountSummary, t: ReturnType<typeof useTranslation>['t']): string => {
    if (!provider.availability.configured) return t('home.providerNotConfigured');
    if (provider.requiresAccount === false) return t('home.providerNoAccount');
    return provider.user?.nickname || t('libraryTui.accountNotSignedIn');
};

const LibraryTuiAccountList: React.FC<LibraryTuiAccountListProps> = ({ account, isInteractive, accentColor, isDaylight, heading, onClose }) => {
    const { t } = useTranslation();
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const logout = useLibraryAccountSelector(account, snapshot => snapshot.logout);
    const logoutPending = logout.status === 'pending';

    // 焦点按平台 id 记；没记过（或那个平台不见了）时落在当前平台上。
    const [focusedId, setFocusedId] = useState<string | null>(null);
    const focusedIndex = Math.max(0, providers.findIndex(provider => provider.providerId === (focusedId ?? activeProviderId)));
    const focused = providers[focusedIndex];
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        listRef.current?.querySelector('[data-focused="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [focusedIndex]);

    const select = (provider: ProviderAccountSummary | undefined) => {
        if (!provider || !provider.availability.configured) return;
        setFocusedId(provider.providerId);
        void account.selectProvider(provider.providerId).then(result => {
            if (result.action === 'login') openLoginWindow(result.providerId);
        });
    };
    const canLogout = (provider: ProviderAccountSummary | undefined) => (
        provider?.providerId === activeProviderId && canLogoutProvider(provider) && !logoutPending
    );
    const runLogout = (provider: ProviderAccountSummary | undefined) => {
        if (!provider || !canLogout(provider)) return;
        void account.logout(provider.providerId);
    };

    useLibraryTuiAccountListKeys({
        isActive: isInteractive,
        rowCount: providers.length,
        moveFocus: resolve => {
            if (providers.length === 0) return;
            const next = Math.max(0, Math.min(resolve(focusedIndex), providers.length - 1));
            setFocusedId(providers[next].providerId);
        },
        onSelect: () => select(focused),
        onLogout: () => runLogout(focused),
        onEscape: onClose,
    });

    const accentBackground = colorWithAlpha(accentColor, isDaylight ? 0.16 : 0.22);
    const hints = onClose ? t('libraryTui.accountsHints') : t('libraryTui.accountsGuestHints');

    return (
        <div className="flex min-h-0 flex-1 flex-col" data-tui-accounts={onClose ? 'panel' : 'guest'}>
            <div className="flex shrink-0 flex-col gap-1 border-b border-current/10 px-4 py-2 text-[13px]">{heading}</div>
            <div ref={listRef} role="listbox" aria-label={t('libraryTui.accountsTitle')} className="min-h-0 flex-1 overflow-y-auto py-1 text-[13px]">
                {providers.map((provider, index) => {
                    const active = provider.providerId === activeProviderId;
                    const isFocused = index === focusedIndex;
                    const configured = provider.availability.configured;
                    const showLogout = active && canLogoutProvider(provider);
                    const actionLabel = active || !configured
                        ? ''
                        : translateHomeMessage(t, resolveProviderSelectLabel(provider));
                    return (
                        <div
                            key={provider.providerId}
                            role="option"
                            aria-selected={isFocused}
                            aria-disabled={!configured || undefined}
                            data-tui-account-provider={provider.providerId}
                            data-focused={isFocused ? 'true' : undefined}
                            data-current={active ? 'true' : undefined}
                            data-direct={canSwitchToProviderDirectly(provider) ? 'true' : undefined}
                            onClick={() => setFocusedId(provider.providerId)}
                            onDoubleClick={() => select(provider)}
                            className={`grid cursor-default grid-cols-[2ch_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_10ch] items-center gap-x-3 px-4 py-0.5 ${configured ? '' : 'line-through opacity-40'}`}
                            style={isFocused ? { backgroundColor: accentBackground } : undefined}
                        >
                            <span style={active ? { color: accentColor } : undefined}>{active ? '*' : ' '}</span>
                            <span className={`truncate ${active ? 'font-bold' : ''}`} style={active ? { color: accentColor } : undefined}>
                                {providerDisplayName(t, provider)}
                            </span>
                            <span className="truncate opacity-70" data-tui-account-status>{statusOf(provider, t)}</span>
                            <span className="truncate text-[12px] opacity-50">{actionLabel}</span>
                            <span className="text-right">
                                {showLogout ? (
                                    <button
                                        type="button"
                                        data-tui-account-logout={provider.providerId}
                                        disabled={logoutPending}
                                        onClick={() => runLogout(provider)}
                                        className="opacity-70 hover:opacity-100 disabled:opacity-30"
                                    >
                                        <span aria-hidden="true">[</span>
                                        {logoutPending && logout.providerId === provider.providerId ? t('libraryTui.accountLoggingOut') : t('account.logout')}
                                        <span aria-hidden="true">]</span>
                                    </button>
                                ) : null}
                            </span>
                        </div>
                    );
                })}
            </div>
            <div className="shrink-0 border-t border-current/10 px-4 py-1 text-[11px] opacity-50" data-tui-accounts-hints>{hints}</div>
        </div>
    );
};

export default LibraryTuiAccountList;
