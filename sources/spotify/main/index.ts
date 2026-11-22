import os from 'node:os';
import path from 'node:path';
import type { FoliumSourceMainApi, FoliumSourceSeal } from '@folia/folium';
import { createSpotifyApiBridge } from './spotifyApiBridge.cjs';
import type { SpotifySafeStorage } from './spotifyApiBridge.cjs';

// sources/spotify/main/index.ts
// Spotify 音源模组的 main 入口：迁之前 main.cjs 里的那一块（createSpotifyApiBridge、folia-spotify 协议、
// spotify-api-request 通道、媒体缓存里的 spotify: 条目、没人接手时暂停 Soloist、退出前的等待）接到 api.* 上：
//   - 登录：api.legacy.store（受信表认领的 SPOTIFY_SESSION_V1、SPOTIFY_SOLOIST_V1、SPOTIFY_PLAYBACK_V1、
//     SPOTIFY_DEVICE_ID，升级来的登录、播放方式、Soloist 的设置和设备名都还在），加密用 api.seal（Linux 的
//     basic_text 读作不可用，和以前 soloist.cjs 自己的判断一致）；授权页经 api.shell.openExternal 在系统浏览器里
//     打开，回调仍由 signIn.cjs 在 127.0.0.1:5588 上听；
//   - 请求：认领的内存分区 folia-spotify（api.net.session），跟系统代理，一律 credentials: 'omit'；页面语言是
//     宿主的界面语言（api.host.locale）；
//   - 播放：librespot 由宿主按名字加载应用带的那份（api.native.load('librespot')，打包后在 asarUnpack 里）；
//     以前的 folia-spotify://audio/<id>?k=<key> 换成 folia-mod://spotify/_media/audio/<id>?once=<key>
//     （api.media.serve），key 一次运行内有效，所以旧地址不必认；
//   - 缓存：加密的音频文件仍在用户设的媒体缓存目录下的 spotify/（api.cache.legacyDir，受信表认领），经
//     api.cache.provideEntries 交给宿主的缓存预算一起算、一起清，写完一个文件请宿主按预算修剪（api.cache.requestPrune）；
//   - Soloist：可执行文件由用户自己选（api.dialog.pickFile），它的资料夹是认领的 userData 目录 soloist
//     （api.paths.legacy），升级来的配对还在；主窗口重建后没有窗口接手播放（api.onPlayersOrphaned）就暂停它；
//   - 窗口经 folium.rpc 的 `request` 发操作（宿主只放主窗口的调用进来，和以前 spotify-api-request 的来源校验一样），
//     操作白名单仍由 spotifyApiBridge.cjs 核对；
//   - 退出前停掉 Soloist、等进行中的换令牌存好（bridge.shutdown，最多 3 秒）。只在 Soloist 在跑或正在换令牌时登记
//     api.onBeforeQuit：登记着就让宿主每次退出都多等一轮，以前是 main.cjs 的 quitHoldingBridges；
//   - 停用或清除数据（api.onBeforeUnload）：同样停掉 Soloist、等换令牌，再关掉登录的本地端口和 librespot 的连接，
//     并撤掉进程退出时停 Soloist 的监听。

/** api.seal in the shape the session repository and Soloist read (Electron's safeStorage): what main.cjs handed in before. */
const sealAsSafeStorage = (seal: FoliumSourceSeal): SpotifySafeStorage => ({
    isEncryptionAvailable: () => seal.available(),
    encryptString: text => Buffer.from(seal.seal(text), 'base64'),
    decryptString: sealed => seal.open(sealed.toString('base64')),
});

// A track's id, as the `_media/audio` route's path names it.
const TRACK_PATH = /^[0-9A-Za-z]{22}$/;
// The folder under the media cache folder the encrypted audio files are kept in (the trusted table's row claims it).
const AUDIO_CACHE_DIR = 'spotify';
// Soloist's folder under userData (the row claims it).
const SOLOIST_DIR = 'soloist';

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    // Spotify is asked from the source's own partition, without a cookie jar; like the update check it follows
    // the system proxy.
    const network = api.net.session('folia-spotify');
    let proxied: Promise<void> | null = null;

    // What stops Soloist when the process ends without quitting (a crash, a relaunch): on macOS and Linux a child
    // outlives its parent. Taken off when the source stops, so a source turned off and on leaves no listener behind.
    const exitStops = new Set<() => void>();
    const onProcessExit = () => { exitStops.forEach(stop => stop()); };
    process.on('exit', onProcessExit);

    // The quit is held only while there is something to wait for: Soloist running (or being started or followed),
    // or a token renewal whose answer is not stored yet. A handler that is there at all holds every quit for a round.
    let soloistActive = false;
    const renewals = new Set<Promise<void>>();
    let quitHold: (() => void) | null = null;
    const updateQuitHold = () => {
        const wanted = soloistActive || renewals.size > 0;
        if (wanted) {
            quitHold ??= api.onBeforeQuit(async () => { await bridge.shutdown(); });
        } else if (quitHold) {
            const release = quitHold;
            quitHold = null;
            release();
        }
    };

    const bridge = createSpotifyApiBridge({
        store: api.legacy.store,
        safeStorage: sealAsSafeStorage(api.seal),
        fetch: async (input, init) => {
            proxied ??= network.setProxy({ mode: 'system' }).catch(() => {});
            await proxied;
            return network.fetch(input instanceof URL ? input.href : input, { ...init, credentials: 'omit' });
        },
        openExternal: url => api.shell.openExternal(url),
        language: () => api.host.locale,
        loadLibrespot: () => api.native.load('librespot'),
        audioUrl: (trackId, key) => `${api.media.url('audio', trackId)}?once=${encodeURIComponent(key)}`,
        onRenewing: done => {
            renewals.add(done);
            updateQuitHold();
            void done.finally(() => {
                renewals.delete(done);
                updateQuitHold();
            });
        },
        // Read anew on every use: the listener may move the media cache folder.
        audioDirectory: () => api.cache.legacyDir(AUDIO_CACHE_DIR),
        // The host trims the media cache to the listener's limit, which the main window names before it asks a
        // source to keep a file (set-media-cache-limit in electron/main.cjs).
        onAudioKept: () => { api.cache.requestPrune(); },
        soloistPaths: {
            data: () => path.join(api.paths.legacy(SOLOIST_DIR), 'data'),
            cache: () => path.join(api.paths.legacy(SOLOIST_DIR), 'cache'),
        },
        // The picker opens in the downloads folder, where Soloist is downloaded to.
        chooseSoloistFile: () => api.dialog.pickFile({
            defaultPath: path.join(os.homedir(), 'Downloads'),
            filters: process.platform === 'win32' ? [{ name: 'Soloist', extensions: ['exe'] }] : [],
        }),
        onSoloistActive: active => {
            soloistActive = active;
            updateQuitHold();
        },
        onProcessExit: stop => { exitStops.add(stop); },
    });

    // The encrypted audio files count in the host's media cache budget, and go with its prune and its clear.
    const files = bridge.audioFiles;
    if (files) {
        api.cache.provideEntries({
            list: async () => (await files.list()).map(file => ({ id: file.name, size: file.size, usedAt: file.usedAt })),
            remove: id => files.remove(id),
            clear: () => files.clear(),
        });
    }

    // The host hands GET reads only (modProtocol.cjs answers any other method itself).
    api.media.serve('audio', read => {
        if (!TRACK_PATH.test(read.path)) return Response.error();
        return bridge.serveAudio({ trackId: read.path, key: Object.hasOwn(read.query, 'once') ? read.query.once : '', range: read.range });
    });
    api.rpc.handle('request', (operation: unknown, params: unknown) => (
        bridge.request(String(operation), params && typeof params === 'object' ? params as Record<string, unknown> : {})
    ));
    // The window that followed Soloist went and no window took the playback over: nobody can stop it any more.
    api.onPlayersOrphaned(() => {
        bridge.pauseSoloist().catch((error: unknown) => {
            console.warn('[Spotify] Soloist could not be paused', error);
        });
    });
    // Turned off or its data cleared: Soloist stops and a renewal is stored, then the sign-in's port and the
    // playback component's connection close.
    api.onBeforeUnload(async () => {
        try {
            await bridge.shutdown();
        } finally {
            bridge.dispose();
            process.off('exit', onProcessExit);
            exitStops.clear();
        }
    });
}
