import { useCallback, useEffect, useRef, useState } from 'react';
import type { OnlineProviderId, QrLoginFailureKind, QrLoginState } from '../types/onlineMusic';
import { omni } from '../services/onlineMusic/omni';
import {
    formatQrLoginDiagnosticReport,
    QR_LOGIN_TIMELINE_LIMIT,
    type QrLoginTimelineEvent,
} from '../utils/qrLoginDiagnosticReport';

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

const describeError = (providerId: OnlineProviderId, error: unknown) => providerId === 'qq' ? { reason: 'provider-error' } : ({
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
});

// 取消是 keyed 的，只放掉自己这一把 key；全局清空会在多客户端场景下杀掉别人正在手机上确认的会话。
// Fire-and-forget：关窗时不该等后端回话，取消失败最多留下一个会自己过期的会话。
const releaseSession = (session: ActiveQrSession | null): void => {
    if (!session) return;
    void omni.cancelQrLogin(session.providerId, session.key).catch(error => {
        console.warn('[ProviderQrLogin] cancel:error', { providerId: session.providerId, ...describeError(session.providerId, error) });
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
// onConfirmed 返回 false 表示扫码已确认、却没拿到登录态，这也算登录失败。
export const useOnlineProviderQrLogin = ({
    providerId,
    onConfirmed,
    t,
}: {
    providerId: OnlineProviderId;
    onConfirmed: (providerId: OnlineProviderId) => Promise<boolean | void> | boolean | void;
    t: (key: string) => string;
}) => {
    const [qrCodeImg, setQrCodeImg] = useState('');
    const [qrState, setQrState] = useState<QrUiState>('idle');
    const [failure, setFailure] = useState<QrLoginFailureKind | null>(null);
    // 最近一轮扫码的时间线：失败时连同 provider 的诊断一起生成报告。只保留一轮，重新开始即清空。
    const timelineRef = useRef<QrLoginTimelineEvent[]>([]);
    const sessionMetaRef = useRef<{ providerId: OnlineProviderId; methodId: string | null; startedAt: number }>({
        providerId,
        methodId: null,
        startedAt: 0,
    });
    const qrCheckTimeoutRef = useRef<number | null>(null);
    const qrTtlTimeoutRef = useRef<number | null>(null);
    const activeSessionRef = useRef<ActiveQrSession | null>(null);
    const sessionIdRef = useRef(0);
    const onConfirmedRef = useRef(onConfirmed);
    const lastLoggedQrStateRef = useRef<QrUiState>('idle');

    useEffect(() => {
        onConfirmedRef.current = onConfirmed;
    }, [onConfirmed]);

    // 同一条记录既进时间线，也照旧打到 console（打包版可在开发者设置的日志面板里看到）。
    const note = useCallback((event: string, detail: Record<string, unknown> = {}, level: 'info' | 'warn' = 'info') => {
        const at = Date.now();
        const meta = sessionMetaRef.current;
        const entry = { at, event, detail: { ...detail, elapsedMs: at - meta.startedAt } };
        timelineRef.current = [...timelineRef.current, entry].slice(-QR_LOGIN_TIMELINE_LIMIT);
        console[level](`[ProviderQrLogin] ${event}`, { providerId: meta.providerId, ...entry.detail });
    }, []);

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
        setFailure(null);
        lastLoggedQrStateRef.current = 'loading';
        timelineRef.current = [];
        sessionMetaRef.current = { providerId: targetProviderId, methodId: methodId ?? null, startedAt: Date.now() };
        // 扫过码之后才过期，多半是手机端的确认被拒了，要当失败处理。
        let scanned = false;
        let polls = 0;
        note('start', { methodId });
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
            note('ready');
            // 只有声明了二维码寿命的 provider 才由前端计时；其余仍旧等后端把过期报上来。
            const ttlMs = omni.getQrTtlMs(targetProviderId);
            if (ttlMs !== null) {
                qrTtlTimeoutRef.current = window.setTimeout(() => {
                    note('state', { state: 'expired', source: 'ttl', scanned, polls });
                    // 先停轮询并取消会话，再报「已过期」——此时 modal 的重试按钮已经可用。
                    stopChecking();
                    setQrState('expired');
                    if (scanned) setFailure('expired-after-scan');
                }, ttlMs);
            }
            // Schedules the next check only after the current request settles, preventing overlapping polls.
            const poll = async () => {
                if (sessionId !== sessionIdRef.current) return;
                try {
                    polls += 1;
                    const result = await omni.checkQrLogin(targetProviderId, key);
                    if (sessionId !== sessionIdRef.current) return;
                    setQrState(result.state);
                    if (result.state === 'scanned') scanned = true;
                    if (lastLoggedQrStateRef.current !== result.state) {
                        lastLoggedQrStateRef.current = result.state;
                        note('state', {
                            state: result.state,
                            polls,
                            ...(targetProviderId !== 'qq' && result.state === 'error' && result.message ? { message: result.message } : {}),
                        }, result.state === 'error' ? 'warn' : 'info');
                    }
                    if (result.state === 'confirmed') {
                        clearTimer(qrCheckTimeoutRef);
                        clearTimer(qrTtlTimeoutRef);
                        // 会话已经换成登录凭据，不该再取消：后端要让在途的轮询继续读到 803。
                        activeSessionRef.current = null;
                        const completed = await onConfirmedRef.current(targetProviderId);
                        if (sessionId !== sessionIdRef.current) return;
                        note('complete', { completed: completed !== false }, completed === false ? 'warn' : 'info');
                        if (completed === false) {
                            setQrState('error');
                            setFailure('account-refresh-failed');
                        }
                    } else if (result.state === 'expired' || result.state === 'error') {
                        qrCheckTimeoutRef.current = null;
                        // 终态不再轮询，留着 TTL 计时器只会在弹窗关掉后才触发。
                        clearTimer(qrTtlTimeoutRef);
                        if (result.state === 'error') setFailure('check-error');
                        else if (scanned) setFailure('expired-after-scan');
                    } else {
                        qrCheckTimeoutRef.current = window.setTimeout(poll, QR_POLL_INTERVAL_MS);
                    }
                } catch (error) {
                    if (sessionId !== sessionIdRef.current) return;
                    note('check:error', { polls, scanned, ...describeError(targetProviderId, error) }, 'warn');
                    setQrState('error');
                    setFailure('check-error');
                    qrCheckTimeoutRef.current = null;
                    clearTimer(qrTtlTimeoutRef);
                }
            };
            qrCheckTimeoutRef.current = window.setTimeout(poll, QR_POLL_INTERVAL_MS);
        } catch (error) {
            if (sessionId !== sessionIdRef.current) return;
            note('start:error', describeError(targetProviderId, error), 'warn');
            setQrState('error');
            setFailure('start-error');
        }
    }, [note, providerId, stopChecking]);

    useEffect(() => stopChecking, [stopChecking]);

    // 生成可以直接贴进 issue 的诊断报告：本轮时间线 + provider 自己的诊断（网易会带上主进程记录）。
    const buildDiagnosticReport = useCallback(async () => {
        const meta = sessionMetaRef.current;
        return formatQrLoginDiagnosticReport({
            generatedAt: Date.now(),
            appVersion: typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__,
            userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
            providerId: meta.providerId,
            methodId: meta.methodId,
            failure,
            timeline: timelineRef.current,
            providerLines: await omni.getQrLoginDiagnostics(meta.providerId),
        });
    }, [failure]);

    return {
        qrCodeImg,
        qrState,
        qrStatusText: getQrStatusText(qrState, t),
        isConfirmed: qrState === 'confirmed',
        failure,
        buildDiagnosticReport,
        start,
        stop: stopChecking,
    };
};
