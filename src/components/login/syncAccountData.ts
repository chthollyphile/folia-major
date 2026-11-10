import type { TFunction } from 'i18next';
import type { LibraryAccountController, LibraryAccountSyncResult } from '../../library/core/account/account.contract';
import type { OnlineProviderId } from '../../types/onlineMusic';
import { setStatusMessage } from '../../stores/useStatusMessageStore';

// src/components/login/syncAccountData.ts
// 「同步数据」按钮按下去之后的那一件事：经账户 controller 重新读这个平台的账号，再用一句提示告诉用的人结果。
// 面板的账户页（经 App）与登录窗口账号那一幅都调它，提示的说法只有这一份。

/** 同步这个平台的账户数据并提示结果；已经有一个在同步、或者这个平台没登录着时什么都不说。 */
export const syncAccountData = async (
    account: LibraryAccountController,
    providerId: OnlineProviderId,
    t: TFunction,
): Promise<LibraryAccountSyncResult> => {
    const result = await account.syncAccount(providerId);
    if (result.status === 'synced') {
        setStatusMessage({ type: 'success', text: t('status.dataSynced') });
    } else if (result.status === 'ran-out') {
        setStatusMessage({ type: 'error', text: t('status.loginExpired') });
    } else if (result.status === 'failed') {
        setStatusMessage({ type: 'error', text: t('status.syncFailed') });
    }
    return result;
};
