import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineProviderId, QrLoginState } from '../types/onlineMusic';
import { omni } from '../services/onlineMusic/omni';

// src/hooks/useOnlineProviderQrLogin.ts

type QrUiState = 'idle' | 'loading' | QrLoginState['state'];

const QR_POLL_INTERVAL_MS = 2000;

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
    const qrCheckTimeoutRef = useRef<number | null>(null);
    const sessionIdRef = useRef(0);
    const onConfirmedRef = useRef(onConfirmed);
    const lastLoggedQrStateRef = useRef<QrUiState>('idle');

    useEffect(() => {
        onConfirmedRef.current = onConfirmed;
    }, [onConfirmed]);

    const stopChecking = useCallback(() => {
        sessionIdRef.current += 1;
        if (qrCheckTimeoutRef.current !== null) {
            window.clearTimeout(qrCheckTimeoutRef.current);
            qrCheckTimeoutRef.current = null;
        }
    }, []);

    // methodId 是可选的扫码登录方式（provider 通过 getQrLoginMethods 声明）；
    // 不传即由 provider 自己取默认值，只有单一方式的 provider 完全不受影响。
    const start = useCallback(async (providerIdOverride?: OnlineProviderId, methodId?: string) => {
        const targetProviderId = providerIdOverride || providerId;
        stopChecking();
        const sessionId = sessionIdRef.current;
        setQrCodeImg('');
        setQrState('loading');
        lastLoggedQrStateRef.current = 'loading';
        console.info('[ProviderQrLogin] start', { providerId: targetProviderId });
        if (!omni.getProviderCapabilities(targetProviderId).auth) {
            setQrState('error');
            return;
        }

        try {
            const { key, imageUrl } = await omni.createQrLogin(targetProviderId, methodId);
            if (sessionId !== sessionIdRef.current) return;
            setQrCodeImg(imageUrl);
            setQrState('waiting');
            lastLoggedQrStateRef.current = 'waiting';
            console.info('[ProviderQrLogin] ready', { providerId: targetProviderId });
            // Schedules the next check only after the current request settles, preventing overlapping polls.
            const poll = async () => {
                if (sessionId !== sessionIdRef.current) return;
                try {
                    const result = await omni.checkQrLogin(targetProviderId, key);
                    if (sessionId !== sessionIdRef.current) return;
                    setQrState(result.state);
                    if (lastLoggedQrStateRef.current !== result.state) {
                        lastLoggedQrStateRef.current = result.state;
                        console.info('[ProviderQrLogin] state', { providerId: targetProviderId, state: result.state });
                    }
                    if (result.state === 'confirmed') {
                        if (qrCheckTimeoutRef.current !== null) {
                            window.clearTimeout(qrCheckTimeoutRef.current);
                            qrCheckTimeoutRef.current = null;
                        }
                        await onConfirmedRef.current(targetProviderId);
                    } else if (result.state === 'expired' || result.state === 'error') {
                        qrCheckTimeoutRef.current = null;
                    } else {
                        qrCheckTimeoutRef.current = window.setTimeout(poll, QR_POLL_INTERVAL_MS);
                    }
                } catch (error) {
                    if (sessionId !== sessionIdRef.current) return;
                    console.warn('[ProviderQrLogin] check:error', {
                        providerId: targetProviderId,
                        name: error instanceof Error ? error.name : 'Error',
                        message: error instanceof Error ? error.message : String(error),
                    });
                    setQrState('error');
                    qrCheckTimeoutRef.current = null;
                }
            };
            qrCheckTimeoutRef.current = window.setTimeout(poll, QR_POLL_INTERVAL_MS);
        } catch (error) {
            if (sessionId !== sessionIdRef.current) return;
            console.warn('[ProviderQrLogin] start:error', {
                providerId: targetProviderId,
                name: error instanceof Error ? error.name : 'Error',
                message: error instanceof Error ? error.message : String(error),
            });
            setQrState('error');
        }
    }, [providerId, stopChecking]);

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
