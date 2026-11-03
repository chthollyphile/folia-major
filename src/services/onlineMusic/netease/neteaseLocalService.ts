import { useNeteaseApiStatusStore } from './useNeteaseApiStatusStore';
import type { LoginLocalService, LoginLocalServiceStatus, ProviderNotice } from '../../../types/onlineMusic';

// src/services/onlineMusic/netease/neteaseLocalService.ts
// 网易云的本地后端在登录窗口里的样子：它起没起来、它自己的错误原话、重启。它起不来时取二维码的请求
// 必然失败，登录窗口据此显示原因和重启的按钮。状态本身在 useNeteaseApiStatusStore.ts。
// 应用开着的时候由 watchNeteaseLocalService 盯着它：把它的状态抄进那个仓库，起不来时告诉用的人。

let last: LoginLocalServiceStatus = { failed: false, error: null, restarting: false };

export const neteaseLocalService: LoginLocalService = {
    subscribe: listener => useNeteaseApiStatusStore.subscribe(listener),
    getStatus() {
        const { supported, status, restarting } = useNeteaseApiStatusStore.getState();
        const failed = supported && status?.status === 'error';
        const error = failed ? status?.error ?? null : null;
        if (last.failed !== failed || last.error !== error || last.restarting !== restarting) last = { failed, error, restarting };
        return last;
    },
    async restart() {
        await useNeteaseApiStatusStore.getState().restart();
        return useNeteaseApiStatusStore.getState().status?.status === 'running';
    },
};

// When the failure last told was reported: a watch that is started again does not tell it twice.
let lastToldFailureAt: number | null = null;

/**
 * Watches the desktop app's local service for as long as the app is open: mirrors its state into
 * the store the sign-in window reads, and tells the listener when it failed to start. Does
 * nothing where there is no desktop bridge (the web build). Answers with the way to stop.
 */
export const watchNeteaseLocalService = (tell: (notice: ProviderNotice) => void): (() => void) => {
    const bridge = typeof window === 'undefined' ? undefined : window.electron;
    if (!bridge?.getNeteaseApiStatus) return () => {};

    let stopped = false;
    useNeteaseApiStatusStore.getState().setSupported(true);

    const reportStatus = (status: ElectronNeteaseApiStatus) => {
        if (stopped) return;
        useNeteaseApiStatusStore.getState().setStatus(status);
        if (status.status !== 'error' || lastToldFailureAt === status.updatedAt) return;

        lastToldFailureAt = status.updatedAt;
        // The service's own sentence, for the log line and for the message on screen.
        const reason = status.error?.trim() ?? '';
        console.warn('[Electron] Netease API failed to start', reason);
        // 断网时没起来，不说「接口启动失败」：要用它的请求会说连不上，网通了它会在下一次被用到时再启动。
        if (status.offline === true) return;
        // The reason travels with the toast: user reports of this failure previously arrived
        // with nothing to go on, because the cause only ever reached the main-process stdout.
        tell({
            type: 'error',
            textKey: reason ? 'status.neteaseApiStartupFailedDetail' : 'status.neteaseApiStartupFailed',
            ...(reason ? { params: { reason } } : {}),
            nonce: status.updatedAt,
            durationMs: 8000,
        });
    };

    void bridge.getNeteaseApiStatus()
        .then(reportStatus)
        .catch((error) => {
            console.warn('[Electron] Failed to read Netease API status', error);
        });
    const unsubscribe = bridge.onNeteaseApiStatusChanged?.(reportStatus);

    return () => {
        stopped = true;
        unsubscribe?.();
    };
};
