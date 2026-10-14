"use strict";

const { createSenderGuardedHandler } = require('./ipcAccessGuard.cjs');

const os = require('os');
const { runLoginSelfCheck } = require('./loginSelfCheck.cjs');

// electron/loginBackendIpc.cjs
// 内嵌后端（网易、QQ）对渲染进程的全部 IPC：端口、状态、重启（只有网易能重启）、诊断快照、主动自检。
// 诊断快照 = 应用与系统环境 + 凭据加密后端 + 那个后端自己的 getDiagnostics()（拉起步骤、请求与连接记录等）。
// 报告会原样贴进 GitHub issue，界面上已告知用户其中包含哪些数据；登录凭据（cookie、token）的值不在其中。

const describeCredentialStore = (safeStorage) => {
  try {
    return {
      encryptionAvailable: Boolean(safeStorage?.isEncryptionAvailable?.()),
      // 只有 Linux 有可选后端；basic_text 意味着没有系统钥匙串，QQ 的凭据仓库会拒绝保存（见 qqAuthSessionRepository）。
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
 * 注册内嵌后端的 IPC。getDefaultSession() 返回 Electron 的默认 session（app ready 之后才可用），自检用它解析系统代理。
 * isTrustedSender(event) 由宿主注入（见 electron/main.cjs）：只有第一方窗口的请求才回真实数据。
 */
function registerLoginBackendIpc({
  ipcMain,
  app,
  safeStorage,
  getDefaultSession,
  neteaseBackend,
  qqBackend,
  runSelfCheck = runLoginSelfCheck,
  isTrustedSender,
}) {
  const backends = { netease: neteaseBackend, qq: qqBackend };
  const backendOf = (providerId) => (
    Object.prototype.hasOwnProperty.call(backends, providerId) ? backends[providerId] : null
  );

  // 来源校验：与既有的 IPC 来源校验通道同一个边界、同一个工厂（electron/ipcAccessGuard.cjs）。比 event.sender 的
  // webContents 身份，挡得住其它窗口——包括 window.open 出来的、带着同一个 preload 的那些；挡不住
  // 已经注入第一方窗口的脚本，那是 CSP/preload 层的事，不在这个校验的职责内。
  // 未注入 isTrustedSender 时按不信任处理（fail closed）：读通道回 null，调用方走 unavailable 分支；
  // restart 是写通道，走工厂默认的抛错。端口与诊断快照不该被任何窗口免费问走。
  const guarded = (channel, handler, onUntrusted) => createSenderGuardedHandler({
    channel,
    isTrusted: (event) => typeof isTrustedSender === 'function' && isTrustedSender(event),
    handler,
    ...(onUntrusted ? { onUntrusted } : {}),
  });

  // null 直到服务真正在监听：渲染进程据此等待或报故障，而不是去连一个不存在的端口。
  ipcMain.handle('get-netease-port', guarded('get-netease-port', () => neteaseBackend.getPort(), () => null));
  ipcMain.handle('get-netease-api-status', guarded('get-netease-api-status', () => neteaseBackend.getStatus(), () => null));
  // reason 'needed'：页面上一个请求要用它、它却因为断网没起来；规则在后端的 start 里。
  ipcMain.handle('restart-netease-api', guarded('restart-netease-api', (_event, reason) => neteaseBackend.start(reason)));
  ipcMain.handle('get-qq-port', guarded('get-qq-port', () => qqBackend.getPort(), () => null));
  ipcMain.handle('get-qq-api-status', guarded('get-qq-api-status', () => qqBackend.getStatus(), () => null));

  // 扫码登录失败后渲染进程用它生成可以直接贴进 issue 的诊断报告。没有内嵌后端的 provider 回 null。
  // 有的后端的 getDiagnostics 要问工作线程，是异步的；await 同步、异步都接得住。
  ipcMain.handle('get-login-diagnostics', guarded('get-login-diagnostics', async (_event, providerId) => {
    const backend = backendOf(providerId);
    if (!backend) return null;
    const capturedAt = Date.now();
    return {
      providerId,
      capturedAt,
      app: describeApp({ app, safeStorage }),
      ...(await backend.getDiagnostics()),
    };
  }, () => null));

  ipcMain.handle('run-login-self-check', guarded('run-login-self-check', async (_event, providerId) => {
    const backend = backendOf(providerId);
    if (!backend) return null;
    const session = getDefaultSession?.();
    const result = await runSelfCheck({
      providerId,
      backend: backend.getStatus(),
      hosts: backend.selfCheckHosts,
      resolveSystemProxy: session?.resolveProxy ? (url) => session.resolveProxy(url) : null,
    });
    return { ...result, credentialStore: describeCredentialStore(safeStorage) };
  }, () => null));
}

module.exports = {
  describeApp,
  describeCredentialStore,
  registerLoginBackendIpc,
};
