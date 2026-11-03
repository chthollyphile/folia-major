import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { omni } from '../../../services/onlineMusic/omni';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { setStatusMessage } from '../../../stores/useStatusMessageStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import { useConfirmDialog } from '../../shared/useConfirmDialog';

// src/components/app/dialogs/useProviderSignOut.ts
// The listener asked to sign out of an online platform. Every entry (the Account tab of the side
// panel, the sign-in window, a suite's platform list) goes through the account controller's
// `logout` (library/core/account/providerAccountController.service.ts); this hook gives it the two things
// only App has: the question asked first, and the sign-out with the notice after it. The question
// is App's dialog, so it shows from the player panel too, where the home screen is not mounted.

type AskConfirm = ReturnType<typeof useConfirmDialog>['ask'];
type Translate = (key: string, options?: Record<string, unknown>) => string;

// Asks first. `removesSongs`: the player holds songs of this platform (the one playing or queued ones),
// which the sign-out takes out of it; the question says so then. Other platforms' songs stay.
export const askProviderSignOut = (
    { providerId, removesSongs }: { providerId: OnlineProviderId; removesSongs: boolean },
    ask: AskConfirm,
    t: Translate,
): Promise<boolean> => ask({
    title: t('account.logoutConfirmTitle', { provider: omni.getProviderLabel(providerId) }),
    description: [
        useOnlineProviderAccountStore.getState().accounts[providerId]?.user?.nickname,
        removesSongs ? t('account.logoutRemovesSongs') : null,
    ].filter(Boolean).join('\n') || undefined,
    confirmText: t('account.logout'),
    confirmVariant: 'danger',
});

// The platform is signed out of and the listener is told.
export const signOutOfProvider = async (providerId: OnlineProviderId, t: Translate): Promise<void> => {
    await omni.signOutAccount(providerId);
    setStatusMessage({ type: 'info', text: t('status.loggedOut'), providerId });
};

// `confirmLogout` and `signOut` go to useLibraryAccountController; the caller renders `dialog` once.
export const useProviderSignOut = () => {
    const { t } = useTranslation();
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const { ask, dialog } = useConfirmDialog(isDaylight);
    const confirmLogout = useCallback(
        (request: { providerId: OnlineProviderId; removesSongs: boolean }) => askProviderSignOut(request, ask, t),
        [ask, t],
    );
    const signOut = useCallback((providerId: OnlineProviderId) => signOutOfProvider(providerId, t), [t]);
    return { confirmLogout, signOut, dialog };
};
