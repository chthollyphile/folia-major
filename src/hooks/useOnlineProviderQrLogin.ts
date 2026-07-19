import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineProviderId, QrLoginState } from '../types/onlineMusic';
import { omni } from '../services/onlineMusic/omni';

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
    onConfirmed: (providerId: OnlineProviderId) => void;
    t: (key: string) => string;
}) => {
    const [qrCodeImg, setQrCodeImg] = useState('');
    const [qrState, setQrState] = useState<QrUiState>('idle');
    const qrCheckIntervalRef = useRef<number | null>(null);
    const lastLoggedQrStateRef = useRef<QrUiState>('idle');

    const stopChecking = useCallback(() => {
        if (qrCheckIntervalRef.current !== null) {
            window.clearInterval(qrCheckIntervalRef.current);
            qrCheckIntervalRef.current = null;
        }
    }, []);

    const start = useCallback(async (providerIdOverride?: OnlineProviderId) => {
        const targetProviderId = providerIdOverride || providerId;
        stopChecking();
        setQrCodeImg('');
        setQrState('loading');
        lastLoggedQrStateRef.current = 'loading';
        console.info('[ProviderQrLogin] start', { providerId: targetProviderId });
        if (!omni.getProviderCapabilities(targetProviderId).auth) {
            setQrState('error');
            return;
        }

        try {
            const { key, imageUrl } = await omni.createQrLogin(targetProviderId);
            setQrCodeImg(imageUrl);
            setQrState('waiting');
            lastLoggedQrStateRef.current = 'waiting';
            console.info('[ProviderQrLogin] ready', { providerId: targetProviderId });
            qrCheckIntervalRef.current = window.setInterval(async () => {
                try {
                    const result = await omni.checkQrLogin(targetProviderId, key);
                    setQrState(result.state);
                    if (lastLoggedQrStateRef.current !== result.state) {
                        lastLoggedQrStateRef.current = result.state;
                        console.info('[ProviderQrLogin] state', { providerId: targetProviderId, state: result.state });
                    }
                    if (result.state === 'confirmed') {
                        stopChecking();
                        window.setTimeout(() => onConfirmed(targetProviderId), 1000);
                    } else if (result.state === 'expired' || result.state === 'error') {
                        stopChecking();
                    }
                } catch (error) {
                    console.warn('[ProviderQrLogin] check:error', {
                        providerId: targetProviderId,
                        name: error instanceof Error ? error.name : 'Error',
                        message: error instanceof Error ? error.message : String(error),
                    });
                    setQrState('error');
                    stopChecking();
                }
            }, 3000);
        } catch (error) {
            console.warn('[ProviderQrLogin] start:error', {
                providerId: targetProviderId,
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
            });
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
