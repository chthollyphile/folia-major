import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import type { BodianRequestFactory } from 'bodian-music-api';
import { createBodianApiBridge } from './bodianApiBridge.cjs';
import { createBodianMediaPolicy } from './mediaCors.cjs';
import type { BodianSafeStorage } from './session.cjs';

// sources/bodian/main/index.ts
// 波点音源模组的 main 入口：迁之前 main.cjs 里的那一块（createBodianApiBridge、createBodianMediaPolicy、
// bodian-api-request 通道）接到 api.* 上，三个 .cjs 原样搬来不改：
//   - 会话和设备 id：api.legacy.store（受信表认领的 BODIAN_SESSION_V2、BODIAN_DEVICE_ID，升级来的登录还在），
//     加密用 api.seal（Linux 的 basic_text 读作不可用，和以前 session.cjs 自己的判断一致）；
//   - 请求：api.net.request（Electron 的 ClientRequest，默认分区；桌面接口要 GET 带 JSON 正文，web fetch 发不了）；
//   - 媒体跨域：两条 api.media.allow。签发过的音频地址（不管在哪家 CDN）是一条地址规则；酷我的主机是另一条，它的
//     test 就是原来的策略（音频路径与 content-type、封面主机），宿主只在酷我的主机上问它。重定向的去处由宿主按
//     规则的时限记下（和策略自己登记的两小时相同）；
//   - 窗口经 folium.rpc 的 `request` 发操作（宿主只放主窗口的调用进来，和以前 bodian-api-request 的来源校验一样）。

// How long an address the policy let through, or the CDN hop of one, stays allowed (mediaCors.cjs's own ttl).
const ISSUED_URL_TTL_MS = 2 * 60 * 60 * 1000;

/** api.seal in the shape session.cjs reads (Electron's safeStorage): it is what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): BodianSafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const mediaPolicy = createBodianMediaPolicy();
    // The addresses the package issued, wherever their CDN is (the policy's own issued list, as a rule of URLs).
    const issued = api.media.allow({ followRedirects: true, ttlMs: ISSUED_URL_TTL_MS });
    // Kuwo's hosts, read as the policy reads them (audio paths and content types, the image hosts): the host asks the
    // test only for reads on them.
    api.media.allow({
        hosts: ['kuwo.cn', '*.kuwo.cn'],
        test: request => mediaPolicy.allows(request),
        followRedirects: true,
        ttlMs: ISSUED_URL_TTL_MS,
    });
    const requestFactory: BodianRequestFactory = (options, onResponse) => {
        const request = api.net.request(options);
        request.on('response', onResponse as never);
        return request as never;
    };
    const bridge = createBodianApiBridge({
        store: api.legacy.store,
        safeStorage: sealAsSafeStorage(api.seal),
        onAudioSource: (url) => {
            mediaPolicy.register(url);
            issued.add(url);
        },
        requestFactory,
    });
    api.rpc.handle('request', (operation: unknown, params: unknown) => (
        bridge.request(String(operation), params && typeof params === 'object' ? params as Record<string, never> : {})
    ));
}
