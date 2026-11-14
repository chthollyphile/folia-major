// src/services/nativeAndroidBridge.ts
// 桌面端的取数桥：安卓包里这里是 Capacitor 原生 OkHttp（CORS 不适用），
// 桌面版改走主进程 IPC `lx-fetch`，效果一样——绕过渲染进程的 CORS。
// 签名与安卓版一致，洛雪的 provider / runtime / publicApi 不用改调用方式。
// 主进程侧只放行公网 http(s)（环回与私网在 electron/lxmusic/lxBridge.cjs 里被拒绝）。

export type NativeHttpOptions = {
    method?: string;
    headers?: Record<string, string>;
    bodyText?: string;
    bodyBase64?: string;
    timeoutMs?: number;
};

const getBridge = () => (typeof window === 'undefined' ? null : window.electron?.lxFetch ?? null);

export const hasNativeHttp = (): boolean => getBridge() !== null;

export const nativeHttpRequest = async (
    url: string,
    options: NativeHttpOptions = {},
): Promise<Response> => {
    const bridge = getBridge();
    if (!bridge) throw new Error('lx fetch bridge is not available');
    const result = await bridge(url, {
        method: (options.method || 'GET').toUpperCase(),
        headers: options.headers || {},
        ...(options.bodyText ? { bodyText: options.bodyText } : {}),
        ...(options.bodyBase64 ? { bodyBase64: options.bodyBase64 } : {}),
    });
    if (!result || typeof result.status !== 'number' || result.status === 0) {
        throw new Error(result?.error || 'lx fetch failed');
    }
    return new Response(result.bodyText ?? '', {
        status: result.status,
        statusText: result.statusText || '',
        headers: result.headers || {},
    });
};
