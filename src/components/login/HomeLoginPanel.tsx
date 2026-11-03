import React from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryAccountController } from '../../library/core/account/account.contract';
import { useLibraryAccountProviders } from '../../library/core/account/useLibraryAccount';
import { providerDisplayName } from '../../i18n/providerName';
import { settingsTokens, useSettingsKitTheme } from '../modal/settings/kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from '../modal/settings/kit/motion';
import { openLoginWindow } from './loginWindowStore';
import { PlatformMark } from './PlatformMark';
import { orderRows, rowStatus } from './platformRows';
import './login.css';

// src/components/login/HomeLoginPanel.tsx
// 主页上没有人登录时的样子：一句标题、一句提示，和一个带着前三个平台记号的「登录」按钮。
// 按钮打开登录窗口，不替用的人选平台；正在用的平台登录失效时，标题和按钮换一句，窗口直接开在那个平台上。
// 平台和它们的账号来自账户 controller。

type HomeLoginPanelProps = {
    account: LibraryAccountController;
};

const HomeLoginPanel: React.FC<HomeLoginPanelProps> = ({ account }) => {
    const { t } = useTranslation();
    const { isDaylight, theme } = useSettingsKitTheme();
    const reduced = useKitReducedMotion();
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const rows = orderRows(providers, activeProviderId);
    const active = rows.find(row => row.providerId === activeProviderId);
    // 正在用的平台的登录失效了。
    const ranOut = active ? rowStatus(active) === 'ran-out' : false;
    const marks = rows.filter(row => rowStatus(row) !== 'off').slice(0, 3);

    return (
        <div
            className="flex w-full flex-1 flex-col items-center justify-center px-4 text-center text-[color:var(--st-t1)]"
            style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(reduced) }}
        >
            <h2 className="login-rise text-xl font-semibold leading-7 [text-wrap:balance]">
                {ranOut ? t('status.loginExpired') : t('home.guestTitle')}
            </h2>
            <p className="login-rise mt-2 max-w-[516px] whitespace-pre-line text-[13px] leading-5 text-[color:var(--st-t2)]" style={{ animationDelay: '40ms' }}>
                {ranOut
                    ? t('home.guestPromptProvider', { provider: active ? providerDisplayName(t, active, activeProviderId) : activeProviderId })
                    : t('home.guestPrompt')}
            </p>
            <button
                type="button"
                data-ponder="sign-in"
                onClick={event => openLoginWindow(ranOut ? activeProviderId : null, event.currentTarget)}
                className="login-rise st-t-fast mt-7 inline-flex h-12 max-w-full items-center gap-2.5 rounded-xl bg-[var(--st-accent)] pl-2.5 pr-[22px] text-[15px] font-semibold text-[color:var(--st-on-accent)] transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
                style={{ animationDelay: '80ms', '--login-edge': 'var(--st-accent)' } as React.CSSProperties}
            >
                <span className="flex shrink-0">
                    {marks.map((row, index) => (
                        <span key={row.providerId} className={`inline-flex rounded-full shadow-[0_0_0_2px_var(--st-accent)] ${index > 0 ? '-ml-2' : ''}`}>
                            <PlatformMark providerId={row.providerId} label={providerDisplayName(t, row)} size={28} />
                        </span>
                    ))}
                </span>
                <span className="truncate">{ranOut ? t('home.loginBrowserRetry') : t('home.login')}</span>
            </button>
        </div>
    );
};

export default HomeLoginPanel;
