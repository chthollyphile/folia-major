import path from 'node:path';
import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import { startQqApi } from './qqApiStartup.cjs';
import { createQqAuthSessionRepository, type QqSafeStorage } from './qqAuthSessionRepository.cjs';
import { createQqBackend, type QqBackend } from './qqBackend.cjs';
import { packageRootOf, qqApiExportsOf } from './qqApiExports';

// sources/qq/main/index.ts
// QQ 音乐音源模组的 main 入口：迁之前 main.cjs 里的那几块（createQqBackend、createQqAuthSessionRepository、get-qq-port /
// get-qq-api-status 通道与状态推送、媒体跨域与歌词中转的 QQ 主机、诊断与自检）接到 api.* 上，三个 .cjs 搬来，
// 只把它们 require 宿主的 backendLifecycle.cjs、osEncryption.cjs 换成自带的拷贝：
//   - qq-music-api：package.json 声明成 asar，构建把它装进 deps.<指纹>.asar。包在加载时就监听 PORT，所以 client 第一次问
//     `status` 时才拉起（qqBackend.start：找空端口、设好环境变量再从归档加载、装诊断钩子），以后照答；只用于匹配歌词时
//     宿主同样一启动就加载这个入口，后端也同样等第一次 `status`：歌词与匿名搜歌（`musicu`）不用后端。
//     模组停下时（onBeforeUnload / onBeforeQuit）关掉 server；再启用时宿主清掉模组目录的模块缓存（含归档里的包），重新加载
//     这个入口，`status` 拉起的是新的一个；
//   - 环境变量：PORT、AUTO_OPEN_EXPLORER、QQ_DISABLE_UPDATE_CHECK、QQ_AUTH_STATE_PATH 只在加载包的那一刻设上，加载完还原
//     （qqApiStartup.cjs）。包的设备标识文件照旧在 <userData>/qq-auth-state/qq-device.json（受信表认领的文件夹）；
//   - 会话：api.legacy.store 的 QQ_API_AUTH_SESSION_V1（受信表认领，升级来的登录还在），加密用 api.seal；
//   - 状态：每次变化经 api.rpc.send('status') 告诉 client（以前推给所有窗口的 qq-api-status-changed）；
//   - musicu（歌词、匿名搜歌、单曲详情）：以前页面经宿主的歌词中转发，现在 main 只发这一个固定地址（不是任意地址的中转），
//     经 api.net.fetch、不带默认分区的 cookie，答 QQ 的状态与正文，或问不到；
//   - 诊断与自检：后端登记在 api.diagnostics，client 经 `diagnostics`、`selfCheck` 取报告的那一段（上游连接由宿主补）；
//   - 媒体跨域：api.media.allow 放行 qq.com、*.qq.com 与 y.gtimg.cn（以前 main.cjs 的 CORS 名单），封面取色与音频读得到。

const QQ_MUSICU_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
// musicu 一次请求最多等多久：client 交来它自己的时限（歌词与匿名搜歌 20 s），这里只取不超过 30 s 的那部分。
const MUSICU_LIMIT_MS = 30_000;
const MUSICU_MIN_LIMIT_MS = 1_000;
// 一份 musicu 正文的上限：歌词与详情的请求都是几 KB。
const MUSICU_MAX_BODY = 256 * 1024;

/** api.seal in the shape the repository reads (Electron's safeStorage): it is what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): QqSafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    // QQ's own hosts: media, xhr and image reads get CORS headers (main.cjs's list before).
    api.media.allow({ hosts: ['qq.com', '*.qq.com', 'y.gtimg.cn'] });

    const authSessionRepository = createQqAuthSessionRepository({ store: api.legacy.store, safeStorage: sealAsSafeStorage(api.seal) });
    let loaded: unknown;
    const backend: QqBackend = createQqBackend({
        broadcast: (_channel, status) => {
            api.rpc.send('status', status);
        },
        getStateFilePath: () => path.join(api.paths.legacy('qq-auth-state'), 'qq-device.json'),
        authSessionRepository,
        startServer: options => startQqApi({
            ...options as { port: number },
            // A literal import: the build loads it from the deps archive.
            loadModule: async () => {
                loaded = qqApiExportsOf(await import('@yakult-green-tea/qq-music-api'));
                return loaded;
            },
        }),
        resolvePackageRoot: () => packageRootOf(loaded),
    });
    api.diagnostics.register('qq', backend);

    // Started the first time the client asks (a request to the backend); every later ask waits for that start.
    let started: Promise<void> | null = null;
    let stopping = false;
    api.rpc.handle('status', async () => {
        if (!stopping) started ??= backend.start();
        await started;
        return backend.getStatus();
    });

    api.rpc.handle('musicu', async (payload: unknown, limitMs?: unknown) => {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            throw new TypeError('musicu: a request body (an object)');
        }
        const body = JSON.stringify(payload);
        if (body.length > MUSICU_MAX_BODY) throw new TypeError('musicu: the request body is too large');
        const limit = typeof limitMs === 'number' && Number.isFinite(limitMs)
            ? Math.min(MUSICU_LIMIT_MS, Math.max(MUSICU_MIN_LIMIT_MS, limitMs))
            : MUSICU_LIMIT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), limit);
        try {
            const response = await api.net.fetch(QQ_MUSICU_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                credentials: 'omit',
                signal: controller.signal,
            });
            return {
                status: response.status,
                text: response.ok ? await response.text() : '',
                retryAfter: response.headers.get('Retry-After'),
            };
        } catch (error) {
            return { unreachable: true, message: controller.signal.aborted ? `not answered in ${limit / 1000} s` : messageOf(error) };
        } finally {
            clearTimeout(timer);
        }
    });

    api.rpc.handle('diagnostics', () => api.diagnostics.snapshot('qq'));
    api.rpc.handle('selfCheck', () => api.diagnostics.selfCheck('qq'));

    // The mod stops, or the app quits: the server goes with it (a start under way is waited for first).
    const stop = async () => {
        stopping = true;
        await started?.catch(() => undefined);
        await backend.stop();
    };
    api.onBeforeUnload(stop);
    api.onBeforeQuit(stop);
}
