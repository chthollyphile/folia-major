import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import { createQishuiApiBridge } from './qishuiApiBridge.cjs';
import { createQishuiMediaPolicy } from './mediaCors.cjs';
import type { QishuiSafeStorage } from './session.cjs';

// sources/qishui/main/index.ts
// 汽水音源模组的 main 入口：迁之前 main.cjs 里的那一块（createQishuiApiBridge、createQishuiMediaPolicy、
// qishui-api-request 通道）接到 api.* 上，三个 .cjs 原样搬来不改：
//   - 会话和设备 id：api.legacy.store（受信表认领的 QISHUI_SESSION_V1、QISHUI_DEVICE_ID，升级来的登录还在），
//     加密用 api.seal（Linux 的 basic_text 读作不可用，和以前 session.cjs 自己的判断一致）；
//   - 请求：api.net.fetch（Electron 的 net.fetch，默认分区，和以前 main.cjs 交进去的一样）；桥自己给每个请求加上
//     credentials: 'omit'，默认分区的 cookie 不带出去，平台的 Set-Cookie 也不写进来；
//   - 媒体跨域：两条 api.media.allow。签发过的音频地址（不管在哪家 CDN）是一条地址规则；场景图标与封面的公共
//     图片主机是另一条，它的 test 就是原来的策略（只放图片和声明为图片的 xhr），宿主只在这些主机上问它。重定向的
//     去处由宿主按规则的时限记下（和策略自己登记的两小时相同）；
//   - 窗口经 folium.rpc 的 `request` 发操作（宿主只放主窗口的调用进来，和以前 qishui-api-request 的来源校验一样）。

// How long an address the policy let through, or the CDN hop of one, stays allowed (mediaCors.cjs's own ttl).
const ISSUED_URL_TTL_MS = 2 * 60 * 60 * 1000;

// The public image hosts of scene icons and covers (mediaCors.cjs's own list).
const IMAGE_HOSTS = ['byteimg.com', 'douyinpic.com', 'douyinstatic.com', 'pstatp.com'].flatMap(host => [host, `*.${host}`]);

/** Whether `url` is an https address: the only ones the policy registered. */
const isHttps = (url: string): boolean => {
    try { return new URL(url).protocol === 'https:'; } catch { return false; }
};

/** api.seal in the shape session.cjs reads (Electron's safeStorage): it is what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): QishuiSafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const mediaPolicy = createQishuiMediaPolicy();
    // The addresses the package issued, wherever their CDN is (the policy's own issued list, as a rule of URLs).
    const issued = api.media.allow({ followRedirects: true, ttlMs: ISSUED_URL_TTL_MS });
    // The image hosts, read as the policy reads them: the host asks the test only for reads on them.
    api.media.allow({
        hosts: IMAGE_HOSTS,
        test: request => mediaPolicy.allows(request),
        followRedirects: true,
        ttlMs: ISSUED_URL_TTL_MS,
    });
    const bridge = createQishuiApiBridge({
        store: api.legacy.store,
        safeStorage: sealAsSafeStorage(api.seal),
        fetch: (url, options) => api.net.fetch(url, options),
        onAudioSource: (url) => {
            mediaPolicy.register(url);
            // The policy kept https addresses only (mediaCors.cjs's normalize); the host's rule would take http too.
            if (isHttps(url)) issued.add(url);
        },
    });
    api.rpc.handle('request', (operation: unknown, params: unknown) => (
        bridge.request(String(operation), params && typeof params === 'object' ? params as Record<string, never> : {})
    ));
}
