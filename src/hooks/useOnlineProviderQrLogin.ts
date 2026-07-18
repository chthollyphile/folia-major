import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineProviderId, QrLoginState } from '../types/onlineMusic';
import { getOnlineMusicProvider, providerSupports } from '../services/onlineMusic/providerRegistry';

// src/hooks/useOnlineProviderQrLogin.ts

type QrUiState = 'idle' | 'loading' | QrLoginState['state'];

const getQrStatusText = (state: QrUiState, t: (key: string) => string): string => {
    if (state === 'loading') return t('home.loadingQr');
    if (state === 'waiting') return t('home.scanQr');
    if (state === 'scanned') return t('home.qrScanned');
    if (state === 'confirmed') return t('home.loginSuccess');
    if (state === 'expired') return t('home.qrExpired');
    if (state === 'error') return t('home.loginError');
    return '';
};

// Drives the provider-neutral QR state machine while the provider maps backend status codes.
export const useOnlineProviderQrLogin = ({
    providerId,
    onConfirmed,
    t,
}: {
    providerId: OnlineProviderId;
    onConfirmed: () => void;
    t: (key: string) => string;
}) => {
    const [qrCodeImg, setQrCodeImg] = useState('');
    const [qrState, setQrState] = useState<QrUiState>('idle');
    const qrCheckIntervalRef = useRef<number | null>(null);

    const stopChecking = useCallback(() => {
        if (qrCheckIntervalRef.current !== null) {
            window.clearInterval(qrCheckIntervalRef.current);
            qrCheckIntervalRef.current = null;
        }
    }, []);

    const start = useCallback(async () => {
        stopChecking();
        setQrCodeImg('');
        setQrState('loading');
        const provider = getOnlineMusicProvider(providerId);
        const auth = provider?.auth;
        if (!providerSupports(provider, 'auth') || !auth?.getQrKey || !auth.createQr || !auth.checkQr) {
            setQrState('error');
            return;
        }

        try {
            const key = await auth.getQrKey();
            setQrCodeImg(await auth.createQr(key));
            setQrState('waiting');
            qrCheckIntervalRef.current = window.setInterval(async () => {
                try {
                    const result = await auth.checkQr!(key);
                    setQrState(result.state);
                    if (result.state === 'confirmed') {
                        stopChecking();
                        window.setTimeout(onConfirmed, 1000);
                    } else if (result.state === 'expired' || result.state === 'error') {
                        stopChecking();
                    }
                } catch (error) {
                    console.warn(`[ProviderQrLogin] ${providerId} status check failed`, error);
                    setQrState('error');
                    stopChecking();
                }
            }, 3000);
        } catch (error) {
            console.warn(`[ProviderQrLogin] ${providerId} QR initialization failed`, error);
            setQrState('error');
        }
    }, [onConfirmed, providerId, stopChecking]);

    useEffect(() => stopChecking, [stopChecking]);

    return {
        qrCodeImg,
        qrState,
        qrStatusText: getQrStatusText(qrState, t),
        isConfirmed: qrState === 'confirmed',
        start,
        stop: stopChecking,
    };
};
