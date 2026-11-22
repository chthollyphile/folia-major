import type { FoliumSourceSelfCheck } from '@folia/folium';
import { isNeteaseDesktop, neteaseEnv } from './neteaseEnv';

// sources/netease/core/neteaseSelfCheck.ts
// 网易扫码登录的自检（auth@1.runLoginSelfCheck）。桌面版问 main 入口（rpc `selfCheck` → api.diagnostics.selfCheck：本地后端、
// 代理、DNS、分协议族的 TCP / TLS、HTTPS，宿主补凭据仓库）；网页版浏览器做不了这些，只检查配置的远端 API 能不能连上
// （宿主 src/services/onlineMusic/loginSelfCheck.ts 的网页版那一半，搬来的）。网易的 cookie 存在页面里，不是加密保存的，
// 所以结果不带 keepsSignInEncrypted（和迁之前一样）。

const WEB_PROBE_TIMEOUT_MS = 8000;

const isLoopbackHost = (hostname: string): boolean => (
    hostname === 'localhost' || hostname.endsWith('.localhost') || /^127\./.test(hostname) || hostname === '[::1]' || hostname === '::1'
);

const MOBILE_UA = /Android|iPhone|iPad|iPod/i;

/**
 * API 地址指向本机却不可能有 API 服务：页面不在本机上，或者跑在手机上。常见于照抄 .env.example 的
 * http://localhost:3000 再部署或打包。这时 no-cors 探测可能拿到本机别的服务的不透明响应，被当成可达，所以先单独判断。
 */
const isMisplacedLoopbackApi = (remoteBase: string): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const api = new URL(remoteBase, window.location.href);
        if (!isLoopbackHost(api.hostname)) return false;
        const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
        return !isLoopbackHost(window.location.hostname) || MOBILE_UA.test(userAgent);
    } catch {
        return false;
    }
};

// no-cors 请求只要拿到任何响应（哪怕是不透明的）就说明远端可达；网络层失败才会抛 TypeError。
const probeRemoteApi = async (remoteBase: string): Promise<FoliumSourceSelfCheck> => {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WEB_PROBE_TIMEOUT_MS);
    let probe: { ok: boolean; httpStatus: number | null; durationMs: number; error: { code: string | null; message: string } | null };
    try {
        if (isMisplacedLoopbackApi(remoteBase)) {
            throw Object.assign(new Error('API address points to this device (localhost); no API service runs here'), { code: 'ELOOPBACK' });
        }
        const response = await fetch(`${remoteBase.replace(/\/$/, '')}/`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
        probe = { ok: true, httpStatus: response.status || null, durationMs: Date.now() - startedAt, error: null };
    } catch (error) {
        probe = {
            ok: false,
            httpStatus: null,
            durationMs: Date.now() - startedAt,
            error: {
                code: error instanceof DOMException && error.name === 'AbortError'
                    ? 'ETIMEDOUT'
                    : (error as { code?: unknown } | null)?.code === 'ELOOPBACK' ? 'ELOOPBACK' : null,
                message: error instanceof Error ? error.message : String(error),
            },
        };
    } finally {
        clearTimeout(timer);
    }
    return {
        runtime: 'web',
        startedAt,
        durationMs: Date.now() - startedAt,
        backend: { status: 'remote', port: null, error: null, probe, url: remoteBase },
        proxy: null,
        hosts: [],
    };
};

/** 此刻能不能自检：桌面版总能；网页版要配置了远端 API。 */
export const canRunNeteaseSelfCheck = (): boolean => isNeteaseDesktop() || Boolean(neteaseEnv().web?.apiBase.trim());

/** 跑一次自检；没有可检查的对象时返回 null。自己不抛错：失败写进结果里（桌面版问不到 main 入口时是 null）。 */
export const runNeteaseSelfCheck = async (): Promise<FoliumSourceSelfCheck | null> => {
    let result: FoliumSourceSelfCheck | null;
    if (isNeteaseDesktop()) {
        try {
            result = await neteaseEnv().call<FoliumSourceSelfCheck | null>('selfCheck');
        } catch (error) {
            console.warn('[NeteaseProvider] self-check:failed', error);
            return null;
        }
    } else {
        const remoteBase = neteaseEnv().web?.apiBase.trim() ?? '';
        if (!remoteBase) return null;
        result = await probeRemoteApi(remoteBase);
    }
    return result;
};
