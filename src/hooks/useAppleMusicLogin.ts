import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { omni } from '../services/onlineMusic/omni';
import { setStatusMessage } from '../stores/useStatusMessageStore';
import { stopAppleMusicForConnection } from './useAppleMusicLibrary';
import { useStableCallbacks } from './useStableCallbacks';

// src/hooks/useAppleMusicLogin.ts

// The account entry opens Apple's authorization directly, without another Folia dialog.
export function useAppleMusicLogin(onConnected: () => Promise<boolean>) {
    const { t } = useTranslation();
    const pending = useRef<Promise<void> | null>(null);
    return useStableCallbacks({
        login: () => {
            if (pending.current) return pending.current;
            pending.current = (async () => {
                try {
                    await stopAppleMusicForConnection();
                    await omni.configureProviderConnection('applemusic');
                    if (!await onConnected()) throw new Error('connection-failed');
                    setStatusMessage({ type: 'success', text: t('appleMusic.connected') });
                } catch (error) {
                    const code = error instanceof Error ? error.message : '';
                    setStatusMessage({ type: code === 'login-cancelled' ? 'info' : 'error',
                        text: t(`appleMusic.errors.${code}`, { defaultValue: t('appleMusic.connectionError') }) });
                } finally { pending.current = null; }
            })();
            return pending.current;
        },
    }).login;
}
