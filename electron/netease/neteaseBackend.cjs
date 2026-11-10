"use strict";

const { createNeteaseApiHost } = require('./neteaseApiHost.cjs');
const { startsAgainWhenNeeded } = require('./neteaseApiStartup.cjs');
const { createBackendStatus, describeError } = require('../backendLifecycle.cjs');

// electron/netease/neteaseBackend.cjs
// 网易云本地 API（@neteasecloudmusicapienhanced/api）在主进程这一侧的控制面。包本身在工作线程里加载和运行
// （neteaseApiWorker.cjs，原因写在那里；线程由 neteaseApiHost.cjs 开），这里只管状态、并发与对外的形状：
// - preload()：开线程，让它先加载包；
// - start(reason)：让线程拉起服务，状态经 netease-api-status-changed 广播；并发调用共用同一次拉起
//   （serveNcmApi 没有关闭入口，第二次会泄漏一个监听端口）；
// - getDiagnostics()：后端状态 + 线程里的拉起步骤、登录请求记录、扫码身份、最近的上游连接（都记在线程里，请求在那里发出）。

const STATUS_CHANNEL = 'netease-api-status-changed';
// 只监听 IPv4 回环：本地 API 只给本进程和渲染进程用，不该暴露到局域网；固定地址也让渲染进程
// 不再随 localhost 解析到 ::1 还是 127.0.0.1 而走不同的来源 IP 分支（见 withoutImplicitClientIp）。
const LISTEN_HOST = '127.0.0.1';
// 自检时要连的上游：扫码走 eapi（interfacepc）；拉起时取 xeapi 公钥与匿名注册走 interface3；其余接口多走 interface。
const SELF_CHECK_HOSTS = ['interfacepc.music.163.com', 'interface3.music.163.com', 'interface.music.163.com'];

/**
 * 返回网易后端的控制面。broadcast(channel, status) 把状态推给所有窗口；
 * onUnhandledRejection 接线程里没人接的 rejection；createWorker 只给测试换线程用。
 */
function createNeteaseBackend({
  broadcast,
  logger = console,
  now = Date.now,
  onUnhandledRejection,
  createWorker,
}) {
  const status = createBackendStatus({ channel: STATUS_CHANNEL, broadcast, now });
  let startPromise = null;

  // 本地服务用不了了（没拉起来，或者线程自己结束了）：清掉端口，把状态改成 error。`offline`：没拉起来是因为
  // 断网（线程认出来的），页面据此说连不上，下一次要用它时它会再拉起（startsAgainWhenNeeded）。
  const markDown = (error) => {
    status.update({ status: 'error', port: null, error: describeError(error), offline: error?.offline === true });
  };

  const host = createNeteaseApiHost({
    createWorker,
    logger,
    onUnhandledRejection,
    // 线程结束了，它开的服务也就没了。拉起途中结束的不用另管：等着的那次拉起会失败。已经在监听的要在这里
    // 改状态，页面才看得到失败，「重启后端」才会去开新的线程。
    onExit: (_code, error) => {
      if (status.get().status === 'running') markDown(error);
    },
  });

  const startOnce = async () => {
    status.update({ status: 'starting', port: null, error: null, offline: false });
    try {
      const { port } = await host.start({ host: LISTEN_HOST });
      status.update({ status: 'running', port, error: null, offline: false });
    } catch (error) {
      markDown(error);
    }
    return status.get();
  };

  // reason 'needed'：一个请求要用它、它却因为断网没起来（规则和次数的限制在 startsAgainWhenNeeded）。
  // 不带是用的人按了「重启后端服务」或应用刚启动，照旧拉起。
  const start = (reason) => {
    const current = status.get();
    if (reason === 'needed' && !startsAgainWhenNeeded(current, now())) return Promise.resolve(current);
    if (current.status === 'running') return Promise.resolve(current);
    if (!startPromise) {
      startPromise = startOnce().finally(() => {
        startPromise = null;
      });
    }
    return startPromise;
  };

  const getDiagnostics = async () => ({
    backend: { ...status.get() },
    ...(await host.diagnostics()),
  });

  return {
    statusChannel: STATUS_CHANNEL,
    preload: () => host.preload(),
    start,
    getStatus: () => status.get(),
    /** 服务真正在监听时的端口；没起来时为 null（渲染进程据此等待或显示故障，而不是去连一个假端口）。 */
    getPort: () => (status.get().status === 'running' ? status.get().port : null),
    getDiagnostics,
    selfCheckHosts: SELF_CHECK_HOSTS,
  };
}

module.exports = {
  NETEASE_SELF_CHECK_HOSTS: SELF_CHECK_HOSTS,
  createNeteaseBackend,
};
