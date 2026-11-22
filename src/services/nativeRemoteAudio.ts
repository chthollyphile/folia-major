// src/services/nativeRemoteAudio.ts
// 桌面版：把远端音频地址换成本地自定义协议，由主进程转发并补 CORS 头。
// 安卓那套「本地回环 HTTP 服务」在桌面端用不上——electron/lxmusic/lxBridge.cjs 的 folia-lx://stream
// 直接透传 Range，播放器（含 WebAudio 分析）都能正常读。
// 函数签名与安卓版保持一致，洛雪的 provider 不用改。

const toBase64Utf8 = (text: string): string => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

export const proxyNativeRemoteAudioUrl = async (
    url: string | null | undefined,
    options: { headers?: Record<string, string>; allowAnyHost?: boolean } = {},
): Promise<string> => {
    const value = String(url || '').trim();
    if (!value) return '';
    // 本地地址（blob / data）本来就同源，套代理纯属多此一举。
    if (value.startsWith('blob:') || value.startsWith('data:')) return value;
    if (typeof window === 'undefined' || !window.electron?.lxFetch) return value;
    const encodedHeaders =
        options.headers && Object.keys(options.headers).length > 0
            ? `&h=${encodeURIComponent(toBase64Utf8(JSON.stringify(options.headers)))}`
            : '';
    return `folia-lx://stream?url=${encodeURIComponent(value)}${encodedHeaders}`;
};

export const unregisterNativeRemoteAudioUrl = async (_url?: string): Promise<void> => {
    // 协议地址是一次性拼出来的，没有需要撤销的注册。
};
