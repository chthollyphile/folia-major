import crypto from 'node:crypto';
import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import { createKugouApiBridge, type KugouSafeStorage } from './kugouApiBridge.cjs';
import { buildKugouAnonymousSearch, buildKugouLegacyPlayInfo, isKugouHash, type KugouPlainAnswer, type KugouPlainRequest } from '../core/kugouRequests';
import type { KugouBridgeResult } from '../core';

// sources/kugou/main/index.ts
// 酷狗音源模组的 main 入口：迁之前 main.cjs 里的那几块（createKugouApiBridge、kugou-api-request 通道、证书例外、
// 媒体跨域）接到 api.* 上，kugouApiBridge.cjs 原样搬来，只把它 require 宿主的 osEncryption.cjs 换成自带的同一个判断：
//   - KuGouMusicApi：package.json 声明成 asar，构建把它装进 deps.<指纹>.asar；第一次请求前设 process.env.platform =
//     'lite'（包在加载时读它）再从归档加载，交给桥。加载失败时每个请求都答 `api=unloaded`（client 说本地服务没在跑）；
//   - 会话：api.legacy.store（受信表认领的 KUGOU_API_SESSION_V2、旧的 V1，升级来的登录还在），加密用 api.seal；
//   - 窗口经 folium.rpc 的 `request` 发操作（宿主只放主窗口的调用进来；以前 kugou-api-request 还放遥控窗口，遥控窗口不调音源，没有功能差别）。
//     答复是 { ok, data } 或 { ok: false, message }：桥的那一行 `KuGouApi[...]` 原样交回，里面没有凭据；
//   - 匿名搜索（`anonymousSearch`）与旧的手机版播放信息接口（`legacyPlayInfo`）：以前窗口直接 fetch 或经宿主的歌词代理，
//     现在 main 按 core/kugouRequests.ts 自己拼地址（只拼这两种，不是任意地址的中转），经 api.net.fetch 去问，
//     不带默认分区的 cookie，答 KuGou 的状态与正文，或问不到；
//   - 媒体跨域：api.media.allow 放行 kugou.com 与 *.kugou.com 的媒体、xhr 与图片读取（以前 main.cjs 的 CORS 名单）；
//   - 证书：fs.youthandroid2.kugou.com 的证书名不对，由清单的 certificateExceptions 放宽（只放 ERR_CERT_COMMON_NAME_INVALID）。
// 以前 main.cjs 给 *.kugou.com 的媒体请求出错时记一行 `[KuGouMedia] request:error`（onErrorOccurred）：模组没有这个钩子，
// 不搬；播放失败时 client 自己的日志和宿主的失败报告仍在。

/** api.seal in the shape the bridge reads (Electron's safeStorage): it is what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): KugouSafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

const md5 = (text: string): string => crypto.createHash('md5').update(text).digest('hex');

// What the rpc takes: a keyword of a search box's length, and the page numbers a list asks.
const MAX_KEYWORD_LENGTH = 200;
const isPageNumber = (value: unknown, max: number): value is number => (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
);

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    // KuGou's own hosts: media, xhr and image reads get CORS headers (main.cjs's list before).
    api.media.allow({ hosts: ['kugou.com', '*.kugou.com'] });

    let loaded: Record<string, unknown> | null = null;
    let loadError: Error | null = null;
    let loading: Promise<void> | null = null;
    // KuGouMusicApi reads process.env.platform when it loads: the lite client's, as the host set it before.
    const ensureLoaded = (): Promise<void> => {
        loading ??= (async () => {
            try {
                process.env.platform = 'lite';
                const module = await import('kugoumusicapi') as Record<string, unknown> & { default?: Record<string, unknown> };
                loaded = { ...(module.default ?? {}), ...module };
            } catch (error) {
                loadError = error instanceof Error ? error : new Error(String(error));
            }
        })();
        return loading;
    };

    const bridge = createKugouApiBridge({
        store: api.legacy.store,
        safeStorage: sealAsSafeStorage(api.seal),
        apiLoader: () => {
            if (loaded) return loaded;
            throw loadError ?? new Error('KuGouMusicApi is not loaded');
        },
    });

    api.rpc.handle('request', async (operation: unknown, params: unknown): Promise<KugouBridgeResult> => {
        await ensureLoaded();
        try {
            const data = await bridge.request(String(operation), params && typeof params === 'object' ? params as Record<string, unknown> : {});
            return { ok: true, data };
        } catch (error) {
            // The bridge's own line (normalizeBridgeError): operation, status, KuGou's error_code and a short detail.
            return { ok: false, message: messageOf(error) };
        }
    });

    const askPlain = async (request: KugouPlainRequest): Promise<KugouPlainAnswer> => {
        try {
            const response = await api.net.fetch(request.url, { method: 'GET', headers: request.headers, credentials: 'omit' });
            return { status: response.status, bodyText: await response.text() };
        } catch (error) {
            return { unreachable: true, message: messageOf(error) };
        }
    };

    api.rpc.handle('anonymousSearch', (keyword: unknown, page: unknown, pagesize: unknown): Promise<KugouPlainAnswer> => {
        if (typeof keyword !== 'string' || !isPageNumber(page, 10000) || !isPageNumber(pagesize, 100)) {
            return Promise.reject(new TypeError('anonymousSearch: a keyword and two page numbers'));
        }
        // An over-long keyword (a long title joined for a lyric search) is cut, not refused: before, it went as it was.
        return askPlain(buildKugouAnonymousSearch(keyword.slice(0, MAX_KEYWORD_LENGTH), page, pagesize, md5));
    });

    api.rpc.handle('legacyPlayInfo', (hash: unknown): Promise<KugouPlainAnswer> => {
        if (!isKugouHash(hash)) return Promise.reject(new TypeError('legacyPlayInfo: a track hash'));
        return askPlain(buildKugouLegacyPlayInfo(hash));
    });
}
