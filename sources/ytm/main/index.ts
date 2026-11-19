import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import { createYtmApiBridge } from './ytmApiBridge.cjs';
import type { YtmSafeStorage } from './ytmApiBridge.cjs';
import { createYtmSandbox } from './sandbox.cjs';

// sources/ytm/main/index.ts
// YouTube Music 音源模组的 main 入口：迁之前 main.cjs 里的那一块（createYtmApiBridge、createYtmSandbox、
// folia-ytm 协议、ytm-api-request 通道、退出前的等待）接到 api.* 上：
//   - 登录：api.legacy.store（受信表认领的 YTM_WEB_SESSION_V1 和旧的 YTM_SESSION_V1，升级来的登录还在），
//     加密用 api.seal（Linux 的 basic_text 读作不可用，和以前 webSignIn.cjs 自己的判断一致）；网页登录的浏览器
//     跑在认领的 userData 目录 ytm-sign-in（api.paths.legacy）；
//   - 请求：认领的内存分区 folia-ytm（api.net.session），跟系统代理，一律 credentials: 'omit'，和以前一样不留
//     Google 设的 cookie；页面语言是宿主的界面语言（api.host.locale）；
//   - 播放器脚本和 BotGuard 跑在认领的内存分区 folia-ytm-sandbox 的隐藏窗口里（api.windows.hidden，不节流）：
//     分区的 http(s) 由本地应答（intercept）、权限一律拒绝（refusePermissions）、其余走不存在的代理；主窗口
//     走了窗口跟着关（onMainWindowChanged），下次用到再开；
//   - 音频：以前的 folia-ytm://audio/<id>/<档位>?k=<key> 换成 folia-mod://ytm/_media/audio/<id>/<档位>?once=<key>
//     （api.media.serve），key 一次运行内有效，所以旧地址不必认；整首下进内存再按 Range 应答，和以前一样；
//   - 窗口经 folium.rpc 的 `request` 发操作（宿主只放主窗口的调用进来，和以前 ytm-api-request 的来源校验一样）；
//   - 退出和卸载前等进行中的网页登录收尾（bridge.shutdown，最多 3 秒），以前是 main.cjs 的 quitHoldingBridges。

/** api.seal in the shape the session repository reads (Electron's safeStorage): what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): YtmSafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

// A track's level and id, as the `_media/audio` route's path names them.
const AUDIO_PATH = /^([A-Za-z0-9_-]{1,64})\/([a-z]{1,16})$/;

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const sandbox = createYtmSandbox({
        session: api.net.session('folia-ytm-sandbox'),
        hidden: options => api.windows.hidden(options),
        isAllowed: () => api.windows.mainWindowPresent(),
    });
    // A hidden window would keep the app alive after the main window closes: it goes with it.
    api.windows.onMainWindowChanged(present => { if (!present) sandbox.destroy(); });

    // Google is asked from the source's own partition, without a cookie jar: the account is carried by a request
    // header, and stored cookies would tie the guest sessions to it. Like the update check, it follows the system proxy.
    const network = api.net.session('folia-ytm');
    let proxied: Promise<void> | null = null;

    // Work that must not be cut off: a web sign-in under way, whose ended browser leaves a folder holding a whole
    // sign-in session to remove. Waited for (3 seconds at most) when the app quits or the source is turned off.
    // The quit is held only while there is such work, as main.cjs held it for the built-in bridge: a handler that
    // is there at all makes the host hold every quit for a round.
    const settle = async () => { await bridge.shutdown(); };
    let quitHold: (() => void) | null = null;
    let latestWork: Promise<unknown> | null = null;
    const holdQuitFor = (work: Promise<unknown>) => {
        latestWork = work;
        quitHold ??= api.onBeforeQuit(settle);
        const release = () => {
            if (latestWork !== work) return;
            latestWork = null;
            quitHold?.();
            quitHold = null;
        };
        work.then(release, release);
    };
    const bridge = createYtmApiBridge({
        store: api.legacy.store,
        safeStorage: sealAsSafeStorage(api.seal),
        fetch: async (input, init) => {
            proxied ??= network.setProxy({ mode: 'system' }).catch(() => {});
            await proxied;
            if (typeof input === 'string' || input instanceof URL) {
                return network.fetch(input instanceof URL ? input.href : input, { ...init, credentials: 'omit' });
            }
            // youtubei.js hands a Request; Electron's session.fetch took it as it was, the host's takes an address and
            // its init. The Request's method, headers and body go in the init (what the caller adds over them wins).
            const request = input;
            const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
            return network.fetch(request.url, {
                method: request.method,
                headers: Object.fromEntries(request.headers),
                ...(body && body.byteLength > 0 ? { body } : {}),
                ...init,
                credentials: 'omit',
            });
        },
        evaluate: code => sandbox.evaluate(code),
        language: () => api.host.locale,
        // The browser window of the web sign-in runs on this folder; the bridge removes it when a sign-in ends.
        signInFolder: () => api.paths.legacy('ytm-sign-in'),
        audioUrl: (videoId, level, key) => `${api.media.url('audio', `${videoId}/${level}`)}?once=${encodeURIComponent(key)}`,
        onSignInWork: holdQuitFor,
    });

    // The host hands GET reads only (modProtocol.cjs answers any other method itself).
    api.media.serve('audio', read => {
        const match = AUDIO_PATH.exec(read.path);
        if (!match) return Response.error();
        return bridge.serveAudio({ videoId: match[1], level: match[2], key: Object.hasOwn(read.query, 'once') ? read.query.once : '', range: read.range });
    });
    api.rpc.handle('request', (operation: unknown, params: unknown) => (
        bridge.request(String(operation), params && typeof params === 'object' ? params as Record<string, unknown> : {})
    ));

    api.onBeforeUnload(async () => {
        sandbox.destroy();
        await settle();
    });
}
