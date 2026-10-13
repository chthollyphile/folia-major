// src/utils/networkStatus.ts
// 轻量网络状态检测：navigator.onLine + online/offline 事件。
// 用于请求层在离线时直接降级，避免无意义的网络等待。

type NetworkStatusListener = (online: boolean) => void;

const listeners = new Set<NetworkStatusListener>();

const notify = (online: boolean) => {
    listeners.forEach(listener => listener(online));
};

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => notify(true));
    window.addEventListener('offline', () => notify(false));
}

export const isOnline = (): boolean => {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return true;
    return navigator.onLine;
};

export const onNetworkStatusChange = (listener: NetworkStatusListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
