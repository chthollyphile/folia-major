import type { FoliumSourceMainApi } from '@folia/folium';
import { createCompanionClient } from './companionClient.cjs';

// sources/appleMusic/main/index.ts
// Apple Music 音源模组的 main 入口：迁之前 main.cjs 里的那一块（createCompanionClient、apple-music-request 通道、
// 没人接手时暂停、will-quit 时关掉）接到 api.* 上：
//   - 伴侣程序：可执行文件经 api.native.path('apple-music-companion')（宿主按名字找：打包后在 resources/apple-music，
//     开发时在 build/apple-music-native；Linux 没有，请求照旧答 runtime-unavailable）；它的资料夹是受信表认领的
//     userData 目录 apple-music-companion（api.paths.legacy），登录、storefront 和网页数据都在里面，升级来的登录还在；
//   - 请求：窗口经 folium.rpc 的 `request` 发操作（宿主只放主窗口主框架的调用进来，和以前 companionIpc.cjs 的
//     来源校验一样），操作白名单仍由 companionRequests.cjs 核对；
//   - 主窗口重建后没有窗口接手播放（api.onPlayersOrphaned）：伴侣程序在运行就暂停它，以前是 main.cjs 的
//     pauseExternalPlayersNobodyFollows 直接调；
//   - 停用或清除数据（api.onBeforeUnload）时关掉伴侣程序（断开父进程通道，它自己退出），并等它真退出（最多 2.5 秒），
//     资料夹里的文件才放开；退出时同样关掉（api.onBeforeQuit，
//     只在伴侣程序运行时登记：登记着就让宿主每次退出都多等一轮），以前是 main.cjs 的 will-quit。
// Windows 上隐藏宿主只在启播时保持可见、大陆 storefront 在页面里改 storefrontId / playbackMode，都在原样搬来的
// nativeSpawn.cjs、companionRequests.cjs、companionStorefront.cjs 里。

const NATIVE_NAME = 'apple-music-companion';
// The companion's profile folder under userData, which the trusted table's row claims (same word as the native file).
const PROFILE_DIR = 'apple-music-companion';

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    // A platform the app ships no companion for, or an app whose companion file is missing (a development run that has
    // not built it), answers every request with runtime-unavailable at once.
    let nativeExecutablePath = '';
    try {
        nativeExecutablePath = api.native.path(NATIVE_NAME);
    } catch (error) {
        console.info('[AppleMusic] No companion here', error instanceof Error ? error.message : String(error));
    }

    let quitHold: (() => void) | null = null;
    const client = createCompanionClient({
        nativeExecutablePath,
        profilePath: api.paths.legacy(PROFILE_DIR),
        // The quit is held only while a companion runs: a handler that is there at all holds every quit for a round.
        onRunningChanged: running => {
            if (running) {
                quitHold ??= api.onBeforeQuit(() => { void client.close(); });
            } else if (quitHold) {
                const release = quitHold;
                quitHold = null;
                release();
            }
        },
    });

    api.rpc.handle('request', (operation: unknown, params: unknown) => (
        client.request(String(operation), params && typeof params === 'object' ? params as Record<string, unknown> : {})
    ));
    // The window that followed the player went and no window took the playback over: nobody can stop it any more.
    api.onPlayersOrphaned(() => {
        client.pauseIfRunning().catch((error: unknown) => {
            console.warn('[AppleMusic] The companion player could not be paused', error);
        });
    });
    // Turned off or its data cleared: waits for the companion to exit, so the profile folder is free to remove.
    api.onBeforeUnload(() => client.close());
}
