import type { FoliumSourceLoginFailure, FoliumSourceLoginStep } from '@folia/folium';
import { isKugouApiUnloaded, kugouTransportFailure } from './kugouFailure';

// sources/kugou/core/kugouLoginFailure.ts
// 酷狗登录失败时交给登录窗口的事实。酷狗自己的错误是什么意思，只在这里说。

// 登录的某一步抛了错（都出自 kugouTransport.ts 的 transport）。
export const describeKugouLoginFailure = (_step: FoliumSourceLoginStep, error: unknown): FoliumSourceLoginFailure | null => {
    // Web 端的请求是裸 fetch：连不上时它抛 TypeError。
    if (error instanceof TypeError) return { case: 'unreachable' };
    // 主进程没能加载 KuGouMusicApi：登录窗口重启不了它，只能重来。
    if (isKugouApiUnloaded(error)) return { case: 'local-service-unavailable' };
    const facts = kugouTransportFailure(error);
    // 网页版没有配置 KuGouMusicApi 的地址：登录窗口没有这一种情况，说原因不明。
    if (facts?.case === 'not-configured') return { ...facts, case: 'unknown' };
    return facts as FoliumSourceLoginFailure | null;
};

// login_qr_check 回了 0 到 4 之外的状态：把酷狗的状态和原话交出去，有哪样交哪样。
export const kugouCheckFailure = (status: number, message: string): FoliumSourceLoginFailure => ({
    ...(Number.isFinite(status) ? { code: String(status) } : {}),
    ...(message ? { message } : {}),
});
