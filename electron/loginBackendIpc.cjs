"use strict";

const { createSenderGuardedHandler } = require('./ipcAccessGuard.cjs');

const os = require('os');
const { runLoginSelfCheck } = require('./loginSelfCheck.cjs');

// electron/loginBackendIpc.cjs
// 内嵌后端对渲染进程的 IPC：诊断快照、主动自检。两条都按登记表找后端（createLoginDiagnosticsRegistry，音源模组的
// api.diagnostics 登记在这里）。端口、状态、重启原来是网易自己的通道，S5 随平台迁走：迁走的平台由模组的 main 入口经 rpc 答。
// 诊断快照 = 应用与系统环境 + 凭据加密后端 + 那个后端自己的 getDiagnostics()（拉起步骤、请求与连接记录等）。
// 报告会原样贴进 GitHub issue，界面上已告知用户其中包含哪些数据；登录凭据（cookie、token）的值不在其中。

const describeCredentialStore = (safeStorage) => {
  try {
    return {
      encryptionAvailable: Boolean(safeStorage?.isEncryptionAvailable?.()),
      // 只有 Linux 有可选后端；basic_text 意味着没有系统钥匙串，要加密保存登录的凭据仓库会拒绝保存（音源模组的 api.seal 这时不可用）。
      backend: process.platform === 'linux' ? safeStorage?.getSelectedStorageBackend?.() ?? null : null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const describeApp = ({ app, safeStorage }) => {
  const credentialStore = describeCredentialStore(safeStorage);
  return {
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: typeof os.version === 'function' ? os.version() : null,
    locale: typeof app.getLocale === 'function' ? app.getLocale() : null,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    uptimeSec: Math.round(process.uptime()),
    credentialStore,
  };
};

/**
 * 登录诊断的登记表：哪个音源有内嵌后端可以交诊断快照、跑自检。登记的是一个对象，要有 getStatus()、
 * getDiagnostics()（同步、异步都行）和 selfCheckHosts。register 回一个撤销函数。`initial` 是一开始就登记的
 * { 音源 id: 后端 }。
 *
 * Folium 2.0：内嵌后端都已随平台搬进音源模组，由模组的 api.diagnostics.register 登记到这张表；
 * get-login-diagnostics、run-login-self-check 两个通道按它找。
 */
function createLoginDiagnosticsRegistry(initial = {}) {
  const backends = new Map(Object.entries(initial).filter(([, backend]) => Boolean(backend)));
  return {
    register(providerId, backend) {
      backends.set(providerId, backend);
      return () => {
        if (backends.get(providerId) === backend) backends.delete(providerId);
      };
    },
    get(providerId) {
      return typeof providerId === 'string' ? backends.get(providerId) ?? null : null;
    },
  };
}

/**
 * 注册内嵌后端的 IPC。getDefaultSession() 返回 Electron 的默认 session（app ready 之后才可用），自检用它解析系统代理。
 * isTrustedSender(event) 由宿主注入（见 electron/main.cjs）：只有第一方窗口的请求才回真实数据。
 */
function registerLoginBackendIpc({
  ipcMain,
  app,
  safeStorage,
  getDefaultSession,
  diagnostics,
    networkRecorder = null,
  runSelfCheck = runLoginSelfCheck,
  isTrustedSender,
}) {
    // 诊断与自检按音源 id 查登记表（createLoginDiagnosticsRegistry）。没给登记表时建一张空的，并交回去。
    const registry = diagnostics ?? createLoginDiagnosticsRegistry();
  const backendOf = (providerId) => registry.get(providerId);

  // 来源校验：与既有的 IPC 来源校验通道同一个边界、同一个工厂（electron/ipcAccessGuard.cjs）。比 event.sender 的
  // webContents 身份，挡得住其它窗口——包括 window.open 出来的、带着同一个 preload 的那些；挡不住
  // 已经注入第一方窗口的脚本，那是 CSP/preload 层的事，不在这个校验的职责内。
  // 未注入 isTrustedSender 时按不信任处理（fail closed）：读通道回 null，调用方走 unavailable 分支。
  // 诊断快照不该被任何窗口免费问走。
  const guarded = (channel, handler, onUntrusted) => createSenderGuardedHandler({
    channel,
    isTrusted: (event) => typeof isTrustedSender === 'function' && isTrustedSender(event),
    handler,
    ...(onUntrusted ? { onUntrusted } : {}),
  });

    // 诊断快照：应用与系统环境 + 那个后端自己的 getDiagnostics()（同步、异步都行，有的要问工作线程）。没有内嵌后端的
    // provider 回 null。音源模组的后端在模组里，拿不到主进程的网络记录：它没交 connections 时宿主按音源 id 补上
    // （networkRecorder.cjs 按域名认出是哪家）。
    const snapshot = async (providerId) => {
        const backend = backendOf(providerId);
        if (!backend) return null;
        const capturedAt = Date.now();
        const own = await backend.getDiagnostics();
        const connections = networkRecorder && !(own && typeof own === 'object' && 'connections' in own)
            ? { connections: networkRecorder.snapshot(providerId) }
            : {};
        return {
            providerId,
            capturedAt,
            app: describeApp({ app, safeStorage }),
            ...connections,
            ...own,
        };
    };

    // 自检：后端的状态、它声明的域名，宿主补系统代理（默认 session 解析）和凭据加密后端。
    const selfCheck = async (providerId) => {
        const backend = backendOf(providerId);
        if (!backend) return null;
        const session = getDefaultSession?.();
        const result = await runSelfCheck({
            providerId,
            backend: typeof backend.getStatus === 'function' ? backend.getStatus() : null,
            hosts: backend.selfCheckHosts,
            resolveSystemProxy: session?.resolveProxy ? (url) => session.resolveProxy(url) : null,
        });
        return { ...result, credentialStore: describeCredentialStore(safeStorage) };
    };

    // 扫码登录失败后渲染进程用它生成可以直接贴进 issue 的诊断报告。
    ipcMain.handle('get-login-diagnostics', guarded('get-login-diagnostics', (_event, providerId) => snapshot(providerId), () => null));
    ipcMain.handle('run-login-self-check', guarded('run-login-self-check', (_event, providerId) => selfCheck(providerId), () => null));

    // 交回登记表：别处（S2 起是音源模组的 api.diagnostics）往里登记后端；快照与自检同 IPC 两个通道一样，
    // 也交给音源模组（api.diagnostics.snapshot / selfCheck），模组的界面一侧经自己的 main 入口取。
    return { diagnostics: registry, snapshot, selfCheck };
}

module.exports = {
  createLoginDiagnosticsRegistry,
  describeApp,
  describeCredentialStore,
  registerLoginBackendIpc,
};
