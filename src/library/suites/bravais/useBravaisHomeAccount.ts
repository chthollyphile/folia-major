import { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { ProviderAccountSummary } from '../../../types/onlineMusic';
import type { LibraryAccountController } from '../../core/account/account.contract';
import type { LibraryHomeOnlineSource } from '../../core/home/homeModel.contract';
import { useLibraryAccountProviders } from '../../core/account/useLibraryAccount';
import { openLoginWindow } from '../../../components/login/loginWindowStore';
import type { BravaisHomeAccount } from './bravaisHomeModels';

// src/library/suites/bravais/useBravaisHomeAccount.ts
// 首页在线页签窄缝里账户入口的投影：订阅账户 controller 的 provider 列表与当前平台，投影成 BravaisHomeAccount 交给首页层的缝。
// 入口打开共用的登录窗口（和 grid 的切换器一样）：已登录时开在正在用的平台上，没有人登录时不替用的人选平台。
// 换平台、登录、退出都在窗口里，规则在账户 controller。层描述只在显示的东西变了时换身份。

/** 入口的读屏名与 title 里的账户状态：未配置、无需登录、昵称或未登录。 */
const describeProviderStatus = (provider: ProviderAccountSummary, t: TFunction): string => {
    if (!provider.availability.configured) return t('libraryBravaisAccount.notConfigured');
    if (provider.requiresAccount === false) return t('home.providerNoAccount');
    return provider.user?.nickname || t('libraryBravaisAccount.notSignedIn');
};

export const useBravaisHomeAccount = (account: LibraryAccountController, online: LibraryHomeOnlineSource): BravaisHomeAccount => {
    const { t } = useTranslation();
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const current = providers.find(provider => provider.providerId === activeProviderId);
    const detail = current ? describeProviderStatus(current, t) : '';
    const nickname = current?.availability.configured && current.requiresAccount !== false ? current.user?.nickname || null : null;
    const avatarUrl = nickname ? current?.user?.avatarUrl || null : null;
    const guest = online.accountView === 'guest';
    const opensOn = guest ? null : activeProviderId;
    const onOpen = useCallback((pressed: Element | null) => openLoginWindow(opensOn, pressed), [opensOn]);
    return useMemo<BravaisHomeAccount>(() => ({
        providerId: online.providerId,
        providerLabel: online.providerLabel,
        detail,
        nickname,
        avatarUrl,
        guest,
        connectLabel: t('libraryBravaisHome.connect'),
        toggleLabel: t('home.switchOnlineProvider'),
        onOpen,
    }), [avatarUrl, detail, guest, nickname, onOpen, online.providerId, online.providerLabel, t]);
};
