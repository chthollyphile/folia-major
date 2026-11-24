import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import { createFnmusicApiBridge } from './fnmusicApiBridge.cjs';
import type { FnMusicSafeStorage } from './fnmusicApiBridge.cjs';

// sources/fnmusic/main/index.ts
// 飞牛音源模组的 main 入口：迁之前 main.cjs 里的那一块（createFnmusicApiBridge、folia-fnmusic:// 协议、
// fnmusic-api-request 通道）接到 api.* 上：
//   - 服务器地址、token 与设备 id：api.legacy.store（受信表认领的 fnmusic-config、fnmusic-device-id，升级来的
//     登录还在），加密用 api.seal（Linux 的 basic_text 读作不可用，和以前桥自己的判断一致）；
//   - 请求：桥自己用 Node 的 http / https 连用户的 NAS（私网地址的自签名证书放行、公网中继严格校验），和迁之前
//     一样；api.net.fetch 是 Chromium 的网络栈，放不过局域网 NAS 的自签名证书；
//   - 播放与封面：两条 _media 路由 stream、cover（api.media.serve），桥转发到 NAS 并带上认证 cookie，回答带
//     Access-Control-Allow-Origin，<audio crossorigin> 和封面取色都读得到；旧的 folia-fnmusic:// 地址由宿主交到
//     同样的路由；
//   - 窗口经 folium.rpc 发操作（宿主只放主窗口的调用进来，和以前 fnmusic-api-request 的来源校验一样）。

/** api.seal in the shape the bridge reads (Electron's safeStorage): it is what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): FnMusicSafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

const record = (value: unknown): Record<string, unknown> => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

/** A value the window handed in, as text: strings as they are, numbers too; anything else is empty. */
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const bridge = createFnmusicApiBridge({
        store: api.legacy.store,
        safeStorage: sealAsSafeStorage(api.seal),
        mediaUrl: name => api.media.url(name),
    });
    api.media.serve('stream', request => bridge.serveStream(request));
    api.media.serve('cover', request => bridge.serveCover(request));
    api.rpc.handle('request', (operation: unknown, params: unknown) => {
        const values = record(params);
        switch (operation) {
            // deviceId is not handed in: the bridge keeps one (fnmusic-device-id) so a sign-in again is the same device.
            case 'login': return bridge.login({ base: text(values.base), username: text(values.username), password: text(values.password) });
            case 'logout': return bridge.logout();
            case 'request': return bridge.request({
                path: text(values.path),
                method: values.method === 'POST' ? 'POST' : 'GET',
                params: record(values.params),
                body: values.body ?? undefined,
            });
            case 'stream': return bridge.stream({ trackId: text(values.trackId) });
            case 'coverUrl': return bridge.coverUrl({ coverId: text(values.coverId), size: Number(values.size) || undefined });
            case 'getStatus': return { ok: true, data: bridge.getStatus() };
            default: return { ok: false, error: { code: 'unsupported', message: `Unknown FnMusic operation: ${String(operation)}` } };
        }
    });
}
