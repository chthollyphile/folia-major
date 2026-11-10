"use strict";

const path = require('path');
const { QQ_API_MODULE, isModuleNotFound, startQqApi } = require('./qqApiStartup.cjs');
const {
  createBackendStatus,
  createStartupRecorder,
  describeError,
  findFreePort,
} = require('../backendLifecycle.cjs');

// electron/qq/qqBackend.cjs
// QQ 音乐本地 API（@yakult-green-tea/qq-music-api）在主进程里的生命周期与诊断。
// start()：port → listen（加载包即监听，等绑定成功）→ login-hooks，每一步经启动记录留下耗时与结果。
// 包只回给客户端白名单过滤过的失败类别（failureStage / failureReason），扫码之后失败时界面只拿到一句
// 「QR login failed」，包自己的 qq-auth.session-failed 日志也只记了错误的 name。为了让诊断报告里有真实原因，
// login-hooks 在包加载后挂两处钩子（只读、透传，原逻辑照常执行）：
// - 扫码服务实例的 failSession / failBootstrap：记下原始错误（name、message、Node 错误码、上游 HTTP 状态、cause、栈顶几行）；
// - 包的 logger：记下 qq-auth.* 事件（会话被抢占、登录确认、凭据交换回退等），日志照常输出。
// 钩子依赖包的内部文件布局（package.json 把版本钉死在一个确切版本）；布局变了就只记一条「钩子不可用」，不影响启动。
// 「重启」不可能：require 缓存让第二次加载拿到的仍是旧的 server（见 qqApiStartup.cjs），所以这里没有 restart。

const STATUS_CHANNEL = 'qq-api-status-changed';
const MAX_RECORDS = 40;
const STACK_LINES = 4;
// 自检时要连的上游：扫码建码与凭据交换（musicu）、扫码事件（MQTT over wss）、设备初始化（QIMEI）、微信扫码。
const SELF_CHECK_HOSTS = ['u.y.qq.com', 'mu.y.qq.com', 'api.tencentmusic.com', 'open.weixin.qq.com'];
// 包内部文件（相对包根目录）。包的 exports 不导出它们，只能按绝对路径加载；模块缓存按文件路径作键，拿到的就是包自己在用的实例。
const QR_SERVICE_FILE = 'dist/src/services/auth/qrLogin.node.js';
const LOGGER_FILE = 'dist/src/util/logger.js';

// 栈里的文件路径只留包内那一段（node_modules/ 或 app.asar/ 之后）：安装目录在用户文件夹下，整条交给诊断报告的
// 清洗规则，会连文件名和行号一起抹掉。
const packageFrame = (line) => {
  const cut = line.replace(/(\(|at )[^()]*[\\/](?:node_modules|app\.asar(?:\.unpacked)?)[\\/]/, '$1');
  return cut === line ? line : cut.replace(/\\/g, '/');
};

// 只取对排查有用、可以序列化的字段；axios 错误整个序列化会把请求头（含 Cookie）一起带出来，所以逐项挑。
const describeFailureError = (error) => {
  if (!(error instanceof Error)) return { message: String(error) };
  const record = /** @type {Record<string, any>} */ (error);
  const stack = typeof error.stack === 'string'
    ? error.stack.split('\n').slice(1, 1 + STACK_LINES).map(line => packageFrame(line.trim()))
    : [];
  return {
    name: error.name,
    message: error.message,
    ...(record.code !== undefined ? { code: String(record.code) } : {}),
    ...(record.response?.status !== undefined ? { httpStatus: record.response.status } : {}),
    ...(record.httpStatus !== undefined ? { httpStatus: record.httpStatus } : {}),
    ...(record.upstreamCode !== undefined ? { upstreamCode: record.upstreamCode } : {}),
    ...(record.globalCode !== undefined ? { globalCode: record.globalCode } : {}),
    ...(record.cause instanceof Error ? { cause: describeError(record.cause) } : {}),
    ...(stack.length > 0 ? { stack } : {}),
  };
};

const pushBounded = (list, item) => {
  list.push(item);
  if (list.length > MAX_RECORDS) list.shift();
};

/**
 * 在已加载的包上挂诊断钩子，返回 { installed, error }。failures / authEvents 是调用方持有的环形记录。
 */
function installQqLoginHooks({ packageRoot, loadFile = require, failures, authEvents, now = Date.now }) {
  const installed = [];
  const errors = [];

  try {
    const { qrLoginService } = loadFile(path.join(packageRoot, QR_SERVICE_FILE));
    for (const method of ['failSession', 'failBootstrap']) {
      const original = qrLoginService?.[method];
      if (typeof original !== 'function') {
        errors.push(`${method} not found`);
        continue;
      }
      // 3.1.2：failSession(session, error)、failBootstrap(error)；3.1.3 多一个 stage 参数。按位置读，全部透传。
      qrLoginService[method] = function hookedQqLoginFailure(...args) {
        const [first, second, third] = args;
        const isSession = method === 'failSession';
        const error = isSession ? second : first;
        pushBounded(failures, {
          at: now(),
          kind: isSession ? 'session' : 'bootstrap',
          stage: typeof (isSession ? third : second) === 'string' ? (isSession ? third : second) : null,
          channel: isSession && typeof first?.channel === 'string' ? first.channel : null,
          sessionState: isSession && typeof first?.state === 'string' ? first.state : null,
          error: describeFailureError(error),
        });
        return original.apply(this, args);
      };
      installed.push(method);
    }
  } catch (error) {
    errors.push(`qr service: ${describeError(error)}`);
  }

  try {
    const { logger } = loadFile(path.join(packageRoot, LOGGER_FILE));
    for (const level of ['info', 'warn', 'error']) {
      const original = logger?.[level];
      if (typeof original !== 'function') continue;
      logger[level] = (...args) => {
        const [event, details] = args;
        if (typeof event === 'string' && event.startsWith('qq-auth.')) {
          pushBounded(authEvents, {
            at: now(),
            level,
            event,
            details: details && typeof details === 'object' ? { ...details } : details ?? null,
          });
        }
        return original(...args);
      };
    }
    installed.push('logger');
  } catch (error) {
    errors.push(`logger: ${describeError(error)}`);
  }

  return { installed, error: errors.length > 0 ? errors.join('; ') : null };
}

/**
 * 建 QQ 后端的控制面。getStateFilePath() 给设备标识文件的路径（拉起时才取，userData 路径在 app ready 前可能还会变）；
 * authSessionRepository 是主进程的加密凭据仓库。
 */
function createQqBackend({
  broadcast,
  networkRecorder = null,
  getStateFilePath = () => null,
  authSessionRepository,
  logger = console,
  now = Date.now,
  resolvePackageRoot = () => path.dirname(require.resolve(`${QQ_API_MODULE}/package.json`)),
  startServer = startQqApi,
  loadFile = require,
}) {
  const status = createBackendStatus({ channel: STATUS_CHANNEL, broadcast, now });
  const startup = createStartupRecorder({ name: 'QQ API', now, logger });
  const failures = [];
  const authEvents = [];
  let hooks = { installed: [], error: null };
  let handle = null;
  let packageVersion = null;

  const start = async () => {
    status.update({ status: 'starting', port: null, error: null });
    startup.begin();
    let currentStep = '';
    const step = (id, fn) => {
      currentStep = id;
      return startup.step(id, fn);
    };
    try {
      const port = await step('port', async (note) => {
        const freePort = await findFreePort();
        note({ port: freePort });
        return freePort;
      });

      handle = await step('listen', async (note) => {
        const stateFilePath = getStateFilePath();
        const started = await startServer({ port, stateFilePath, authSessionRepository });
        note({ port, stateFile: stateFilePath || null, sessionRepository: authSessionRepository?.kind ?? null });
        return started;
      });

      // 加密的登录仓库这次没读出来（qqAuthSessionRepository）：后端里一个会话都没有，渲染进程不能把「后端不认这个 session」
      // 当成登录没了（qqProvider 的 getLoginStatus 据此报「查不到」）。仓库在加载包时就读过了（qqApiStartup）。
      // 渲染进程拿到的是 getStatus 每次现问的答案（sessionStoreUnreadable）：这次运行里一有新登录，仓库就把读不出的那份删了。
      if (authSessionRepository?.loadFailed?.()) logger.warn('[QQ API] the encrypted sign-in store could not be read; kept sign-ins are unknown this run');

      await step('login-hooks', async (note) => {
        try {
          const packageRoot = resolvePackageRoot();
          packageVersion = loadFile(path.join(packageRoot, 'package.json')).version ?? null;
          hooks = installQqLoginHooks({ packageRoot, loadFile, failures, authEvents, now });
        } catch (error) {
          hooks = { installed: [], error: describeError(error) };
        }
        // 钩子装不上只影响诊断的详细程度，不算拉起失败。
        note({ version: packageVersion, installed: hooks.installed, ...(hooks.error ? { error: hooks.error } : {}) });
      });

      status.update({ status: 'running', port, error: null });
      startup.finish('running');
    } catch (error) {
      handle = null;
      // 打包时漏了这个包：永远恢复不了，报 unavailable；其余（端口被抢、包内部抛错）是真正的运行时故障。
      if (isModuleNotFound(error)) {
        status.update({ status: 'unavailable', port: null, error: describeError(error) });
        startup.finish('unavailable');
        return;
      }
      status.update({ status: 'error', port: null, error: `${currentStep}: ${describeError(error)}` });
      startup.finish('failed');
    }
  };

  const stop = async () => {
    const current = handle;
    handle = null;
    if (!current) return;
    try {
      await current.close();
    } catch (error) {
      logger.error('[QQ API] failed to stop', error);
    }
  };

  // 这次启动没读出的加密登录仓库还在磁盘上（qqAuthSessionRepository 的 loadFailed）。后端在跑时才答：仓库是在拉起时读的。
  const sessionStoreUnreadable = () => status.get().status === 'running' && Boolean(authSessionRepository?.loadFailed?.());
  // 渲染进程问到的状态：主进程的状态加上上面那个现问的答案。
  const statusForRenderer = () => ({ ...status.get(), sessionStoreUnreadable: sessionStoreUnreadable() });

  const getDiagnostics = () => ({
    backend: statusForRenderer(),
    version: packageVersion,
    startup: startup.snapshot(),
    hooks: { installed: [...hooks.installed], error: hooks.error },
    failures: failures.map(item => ({ ...item, error: { ...item.error } })),
    authEvents: authEvents.map(item => ({ ...item })),
    connections: networkRecorder ? networkRecorder.snapshot('qq') : [],
  });

  return {
    statusChannel: STATUS_CHANNEL,
    start,
    stop,
    getStatus: statusForRenderer,
    getPort: () => (status.get().status === 'running' ? status.get().port : null),
    getDiagnostics,
    selfCheckHosts: SELF_CHECK_HOSTS,
  };
}

module.exports = {
  QQ_SELF_CHECK_HOSTS: SELF_CHECK_HOSTS,
  createQqBackend,
  describeFailureError,
  installQqLoginHooks,
};
