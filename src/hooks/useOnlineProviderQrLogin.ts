import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineProviderId, QrLoginState } from '../types/onlineMusic';
import { omni } from '../services/onlineMusic/omni';

// src/hooks/useOnlineProviderQrLogin.ts

type QrUiState = 'idle' | 'loading' | QrLoginState['state'];

const QR_POLL_INTERVAL_MS = 2000;

// 记住活跃会话归谁：stopChecking 是 useCallback(..., [])，拿不到 start() 传进来的 provider，
// 只存 key 就不知道该向谁取消。
type ActiveQrSession = { providerId: OnlineProviderId; key: string };

const clearTimer = (timeoutRef: { current: number | null }): void => {
    if (timeoutRef.current === null) return;
    window.clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
};

// 取消是 keyed 的，只放掉自己这一把 key；全局清空会在多客户端场景下杀掉别人正在手机上确认的会话。
// Fire-and-forget：关窗时不该等后端回话，取消失败最多留下一个会自己过期的会话。
const releaseSession = (session: ActiveQrSession | null): void => {
    if (!session) return;
    void omni.cancelQrLogin(session.providerId, session.key).catch(error => {
        console.warn('[ProviderQrLogin] cancel:error', {
            providerId: session.providerId,
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
        });
    });
};

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
    const qrTtlTimeoutRef = useRef<number | null>(null);
    const activeSessionRef = useRef<ActiveQrSession | null>(null);
    const sessionIdRef = useRef(0);
    const onConfirmedRef = useRef(onConfirmed);
    const lastLoggedQrStateRef = useRef<QrUiState>('idle');

    useEffect(() => {
        onConfirmedRef.current = onConfirmed;
    }, [onConfirmed]);

    const stopChecking = useCallback(() => {
        sessionIdRef.current += 1;
        clearTimer(qrCheckTimeoutRef);
        clearTimer(qrTtlTimeoutRef);
        releaseSession(activeSessionRef.current);
        activeSessionRef.current = null;
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
            if (sessionId !== sessionIdRef.current) {
                // 这一轮已被更新的 start 取代（例如连点刷新）：把刚拿到的会话还回去，
                // 否则它会一直占着后端直到 TTL 到期。
                releaseSession({ providerId: targetProviderId, key });
                return;
            }
            activeSessionRef.current = { providerId: targetProviderId, key };
            setQrCodeImg(imageUrl);
            setQrState('waiting');
            lastLoggedQrStateRef.current = 'waiting';
            console.info('[ProviderQrLogin] ready', { providerId: targetProviderId });
            // 只有声明了二维码寿命的 provider 才由前端计时；其余仍旧等后端把过期报上来。
            const ttlMs = omni.getQrTtlMs(targetProviderId);
            if (ttlMs !== null) {
                qrTtlTimeoutRef.current = window.setTimeout(() => {
                    console.info('[ProviderQrLogin] state', { providerId: targetProviderId, state: 'expired' });
                    // 先停轮询并取消会话，再报「已过期」——此时 modal 的重试按钮已经可用。
                    stopChecking();
                    setQrState('expired');
                }, ttlMs);
            }
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
                        clearTimer(qrCheckTimeoutRef);
                        clearTimer(qrTtlTimeoutRef);
                        // 会话已经换成登录凭据，不该再取消：后端要让在途的轮询继续读到 803。
                        activeSessionRef.current = null;
                        await onConfirmedRef.current(targetProviderId);
                    } else if (result.state === 'expired' || result.state === 'error') {
                        qrCheckTimeoutRef.current = null;
                        // 终态不再轮询，留着 TTL 计时器只会在弹窗关掉后才触发。
                        clearTimer(qrTtlTimeoutRef);
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
                    clearTimer(qrTtlTimeoutRef);
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
