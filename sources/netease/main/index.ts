import path from 'node:path';
import type { FoliumSourceMainApi } from '@folia/folium';
import { depsRequire } from '@folia/source-deps';
import { createNeteaseBackend, type NeteaseBackendStatusRecord } from './neteaseBackend.cjs';
import { neteasePackageRoot } from './packageRoot';

// sources/netease/main/index.ts
// 网易云音乐音源模组的 main 入口：迁之前 main.cjs 里的那几块（createNeteaseBackend、应用一启动就开线程并拉起、
// get-netease-port / get-netease-api-status / restart-netease-api 三个通道与 netease-api-status-changed 推送、诊断与自检）
// 接到 api.* 上；main/ 下的 .cjs 是搬来的，只把它们 require 宿主的 backendLifecycle.cjs、networkRecorder.cjs、
// networkErrorText.cjs 换成自带的拷贝：
//   - @neteasecloudmusicapienhanced/api：package.json 声明成 asar，构建把它装进 deps.<指纹>.asar。包在工作线程里加载和运行
//     （worker.cjs，源码 neteaseApiWorker.cjs）：这里经 @folia/source-deps 找到包在归档里的目录，开线程时交过去
//     （workerData.packageRoot），线程从那里按路径加载、替换它的 util/request 与 login_qr_check；
//   - 这个入口一加载就开线程并拉起（迁之前是应用一启动）：完整启用和只用于匹配时宿主一启动都加载它（匹配要后端
//     随时能答，不等第一次匹配时冷启动）；
//   - `status` 答现在的状态，不等拉起（client 自己隔一会儿再问）；`restart` 等这一次拉起（reason `needed`：一个请求要用它、
//     它却因为断网没起来，规则在 startsAgainWhenNeeded）；每次变化经 api.rpc.send('status') 告诉 client；
//   - 诊断与自检：后端登记在 api.diagnostics，client 经 `diagnostics`、`selfCheck` 取（线程里记着自己的上游连接）；
//   - 线程里没人接的 rejection 交 api.reportError（迁之前进宿主的崩溃报告，不打断用户）；
//   - 模组停下（onBeforeUnload）或应用退出（onBeforeQuit）时结束线程，服务随之关掉；线程给整个进程设的
//     ENABLE_GENERAL_UNBLOCK（只有这个包读）还原成加载前的样子。再启用时宿主重新加载这个入口，开的是新的线程。

const restartReason = (reason: unknown): 'needed' | undefined => (reason === 'needed' ? 'needed' : undefined);

/** main 入口。 */
export default function activate(api: FoliumSourceMainApi): void {
    const unblockBefore = process.env.ENABLE_GENERAL_UNBLOCK;
    const backend = createNeteaseBackend({
        broadcast: (_channel, status: NeteaseBackendStatusRecord) => {
            api.rpc.send('status', status);
        },
        onUnhandledRejection: (reason) => {
            api.reportError(reason, 'NetEase API worker');
        },
        // An exception the worker did not catch: reported as the mod's, not thrown in the main process (a source mod
        // must not take the app down). The worker ends with it; onExit marks the backend down for a restart.
        onWorkerError: (error) => {
            api.reportError(error, 'NetEase API worker');
        },
        workerPath: path.join(__dirname, 'worker.cjs'),
        workerData: { packageRoot: neteasePackageRoot(request => depsRequire.resolve(request)) },
    });
    api.diagnostics.register('netease', backend);

    let stopping = false;
    backend.preload();
    void backend.start();

    // The state now, never waiting for a start: the client asks again a little later while it is starting.
    api.rpc.handle('status', () => backend.getStatus());
    // Waits for this start; once the mod is stopping, the state as it is.
    api.rpc.handle('restart', (reason?: unknown) => (stopping ? backend.getStatus() : backend.start(restartReason(reason))));
    api.rpc.handle('diagnostics', () => api.diagnostics.snapshot('netease'));
    api.rpc.handle('selfCheck', () => api.diagnostics.selfCheck('netease'));

    const stop = async () => {
        if (stopping) return;
        stopping = true;
        await backend.stop();
        if (unblockBefore === undefined) delete process.env.ENABLE_GENERAL_UNBLOCK;
        else process.env.ENABLE_GENERAL_UNBLOCK = unblockBefore;
    };
    api.onBeforeUnload(stop);
    api.onBeforeQuit(stop);
}
