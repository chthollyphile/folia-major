const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const { parentPort } = require('worker_threads');
const {
  deferJsdom,
  installLoginQrCheck,
  refreshAnonymousToken,
  resolveXeapiPublicKey,
  waitUntilListening,
  withQrNetworkRetry,
  withoutImplicitClientIp,
} = require('./neteaseApiStartup.cjs');
const { createNeteaseLoginDiagnostics } = require('./neteaseLoginDiagnostics.cjs');
const { createNeteaseLoginIdentity } = require('./neteaseLoginIdentity.cjs');
const { createNetworkRecorder } = require('../networkRecorder.cjs');
const {
  createStartupRecorder,
  describeError,
  findFreePort,
  keepServerErrorsLogged,
} = require('../backendLifecycle.cjs');

// electron/netease/neteaseApiWorker.cjs
// 网易云本地 API 在这个工作线程里加载和运行（由 neteaseApiHost.cjs 开出来，主进程那一侧是 neteaseBackend.cjs）。
// 这个包连同依赖有近 900 个文件（不算已经推迟的 jsdom），在慢处理器上 require 一遍要几百毫秒。放在主线程时，
// 这段时间主进程什么都做不了：窗口建不出来，页面的 IPC 也没人答。放在这里，主进程只管状态和 IPC；
// 页面照旧直接向 127.0.0.1:<port> 发 HTTP。
// 这个文件里不能 require 'electron'：工作线程里没有主进程的那套接口。
// 按顺序分三段：
// 1. 加载（线程一开就做）：准备匿名 token 文件，经 require.cache 换掉上游的 util/request（请求管线）与
//    module/login_qr_check（修正上游吞错的 bug），再加载上游。替换必须赶在上游 main / server 首次 require 它们之前。
//    请求管线从外到内：身份轮换 → 扫码网络层重试 → 来源 IP 策略 → 登录请求记录 → 上游 request。
//    记录在最里层，看到的是每一次真正发出去的请求（重试的每一次都单独成行）；身份轮换在最外层，只看重试之后的结局。
// 2. 拉起（主进程发来 start）：port → runtime（cnIp、deviceId）→ xeapi-key → anonymous-token → listen，
//    每一步经启动记录留下耗时与结果。
// 3. 诊断（主进程发来 diagnostics）：各轮拉起的步骤、登录请求记录（含连接层细节）、扫码身份、最近的上游连接。

const NCM_PACKAGE = '@neteasecloudmusicapienhanced/api';
// 报告里附带的最近上游连接条数（登录请求自带的连接不算在内）。
const RECENT_CONNECTIONS = 20;

// 主进程接管了自己的 console（electron/debug/debugHost.cjs），工作线程的 console 不经过它。
// 这里把每一行交回主线程去写，包自己的日志和登录诊断的那一行才会照旧出现在应用内的日志里。
['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
  console[level] = (...args) => {
    try {
      parentPort.postMessage({ type: 'log', level, args });
    } catch {
      // 带函数之类不能跨线程传的参数：改成文字再传。
      parentPort.postMessage({ type: 'log', level, args: args.map((arg) => (typeof arg === 'string' ? arg : util.inspect(arg, { depth: 3 }))) });
    }
  };
});

// 主线程里没人接的 rejection 只写一份崩溃报告，应用照常运行（electron/debug/crashLog.cjs）。
// 工作线程默认会把它当成未捕获的异常、结束线程，所以这里接住，交给主线程按原来的办法记。
process.on('unhandledRejection', (reason) => {
  try {
    parentPort.postMessage({ type: 'unhandled-rejection', reason });
  } catch {
    parentPort.postMessage({ type: 'unhandled-rejection', reason: util.inspect(reason, { depth: 3 }) });
  }
});

// Provide Netease API unblock parameter as requested
// 只有这个包读它（server.js）。线程和主线程用的是同一份环境变量（neteaseApiHost.cjs 里的 SHARE_ENV），
// 所以这是给整个进程设的，之后起的子进程也会带上它：和这个包在主线程里运行时一样。
process.env.ENABLE_GENERAL_UNBLOCK = 'false';

// 上游自己按 os.tmpdir() 读这两个文件，路径必须一致，不能另选目录。
const tokenPath = path.resolve(os.tmpdir(), 'anonymous_token');
const xeapiPublicKeyPath = path.resolve(os.tmpdir(), 'xeapi_public_key');

// 出站连接记录：diagnostics_channel 按线程各自一份，主进程的记录器看不到这里发出的请求，所以在这里另开一个。
// 要在任何请求发出之前开始订阅。
const networkRecorder = createNetworkRecorder();
networkRecorder.start();
const startup = createStartupRecorder({ name: 'Netease API' });

// 读缓存的 xeapi 公钥：不存在、读不出都不算错，交给刷新步骤处理；返回值同时说明缓存的状态。
const readCachedXeapiKey = (keyPath) => {
  if (!fs.existsSync(keyPath)) return { key: {}, cache: 'missing' };
  try {
    return { key: JSON.parse(fs.readFileSync(keyPath, 'utf-8')), cache: 'present' };
  } catch (error) {
    return { key: {}, cache: `unreadable: ${describeError(error)}` };
  }
};

// 第 1 段：准备匿名 token 文件、替换上游模块、加载上游。全程同步，任何一步抛错都原样抛出。
function loadUpstream() {
  const startedAt = Date.now();
  // util/request 在首次 require 时同步读一次匿名 token，文件不存在就抛 ENOENT，所以先建好。
  if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');
  // 它读到的值会缓存到进程结束，之后写回的新 token 要到下次启动才生效。
  // 记下这一刻文件是否为空，诊断时才知道登录请求有没有匿名凭据兜底。
  const anonymousTokenAtLoad = fs.readFileSync(tokenPath, 'utf-8');

  const loginDiagnostics = createNeteaseLoginDiagnostics({ networkRecorder });
  loginDiagnostics.noteStartup({ anonymousTokenAtLoad: anonymousTokenAtLoad.trim() ? 'present' : 'empty' });

  // util/index 不依赖 util/request，可以先取：身份轮换要用它生成新的 deviceId。
  const ncmUtil = require(`${NCM_PACKAGE}/util/index`);
  const loginIdentity = createNeteaseLoginIdentity({
    generateDeviceId: () => ncmUtil.generateDeviceId(),
    readAnonymousToken: () => fs.readFileSync(tokenPath, 'utf-8'),
    initialAnonymousToken: anonymousTokenAtLoad,
  });

  const requestPath = require.resolve(`${NCM_PACKAGE}/util/request`);
  // jsdom 占这个包加载时间的一多半，而只有带 checkToken 的请求才用它：先放替身，用到时再加载。
  deferJsdom(requestPath);
  // 先 require 再改缓存项：赋值左侧会先求值，写成一行时缓存项还不存在。
  const upstreamRequest = require(requestPath);
  require.cache[requestPath].exports = loginIdentity.wrapRequest(
    withQrNetworkRetry(withoutImplicitClientIp(loginDiagnostics.wrapRequest(upstreamRequest))),
  );
  // 上游的 login_qr_check 把每一个被拒绝的请求都回成 404（原因见 createLoginQrCheck），换成应用自己的。
  installLoginQrCheck();

  const { register_anonimous: registerAnonymous } = require(`${NCM_PACKAGE}/main`);
  const { getXeapiPublicKey } = require(`${NCM_PACKAGE}/util/xeapiKey`);
  const { serveNcmApi } = require(`${NCM_PACKAGE}/server`);
  console.log(`[Netease API] package loaded in the worker thread in ${Date.now() - startedAt}ms`);

  return { ncmUtil, loginDiagnostics, loginIdentity, registerAnonymous, getXeapiPublicKey, serveNcmApi };
}

// 线程一开就加载，不等「拉起」的消息：主进程这时还在建窗口，两边同时进行。
// 加载失败不带崩线程：失败留在 loadError 里，每次拉起把它记成 load 步骤的失败。上游可能已经加载了一半、
// 缓存项可能已被替换，所以不重试加载，只如实再报一次同样的错误（#690：临时目录不可用就是这样报出来的）。
let upstream = null;
let loadError = null;
try {
  upstream = loadUpstream();
} catch (error) {
  loadError = error;
  console.error('[Netease API] failed to load upstream package', error);
}

// 第 2 段：一次完整的拉起，成功时回 { port }。失败时抛出的错带上失败的那一步，界面上的故障原因一眼能看出卡在哪；
// 是不是断网造成的（resolveXeapiPublicKey 记在错上）也带着。
async function startNcmApi({ host }) {
  startup.begin();
  let currentStep = '';
  const step = (id, fn) => {
    currentStep = id;
    return startup.step(id, fn);
  };
  try {
    if (loadError) {
      await step('load', () => {
        throw loadError;
      });
    }
    const { ncmUtil, registerAnonymous, getXeapiPublicKey, serveNcmApi } = upstream;

    const port = await step('port', async (note) => {
      const freePort = await findFreePort();
      note({ port: freePort });
      return freePort;
    });

    await step('runtime', async (note) => {
      global.cnIp = ncmUtil.generateRandomChineseIP();
      const reused = Boolean(global.deviceId);
      if (!reused) global.deviceId = ncmUtil.generateDeviceId();
      note({ deviceId: global.deviceId, deviceIdReused: reused });
    });

    await step('xeapi-key', async (note) => {
      const cached = readCachedXeapiKey(xeapiPublicKeyPath);
      note({ cache: cached.cache });
      const retries = [];
      const { publicKey, refreshed } = await resolveXeapiPublicKey({
        currentPublicKey: cached.key,
        deviceId: global.deviceId,
        getXeapiPublicKey,
        retryOptions: { onRetry: (error) => retries.push(describeError(error)) },
        onFailure: (error) => note({ refreshError: describeError(error) }),
      });
      if (refreshed) fs.writeFileSync(xeapiPublicKeyPath, JSON.stringify(publicKey), 'utf-8');
      note({
        source: refreshed ? 'network' : 'cache',
        version: publicKey?.version ?? 'unknown',
        ...(retries.length > 0 ? { retries } : {}),
      });
    });

    await step('anonymous-token', async (note) => {
      const retries = [];
      const refreshed = await refreshAnonymousToken({
        registerAnonymous,
        cookieToJson: ncmUtil.cookieToJson,
        persistToken: (token) => fs.writeFileSync(tokenPath, token, 'utf-8'),
        retryOptions: { onRetry: (error) => retries.push(describeError(error)) },
        onFailure: (error) => note({ error: describeError(error) }),
      });
      note({ refreshed, ...(retries.length > 0 ? { retries } : {}) });
    });

    await step('listen', async (note) => {
      const app = await serveNcmApi({ port, host });
      // serveNcmApi 调了 listen() 就返回，不等绑定结果；端口被抢时只会在 server 上发 'error'。
      await waitUntilListening(app.server);
      keepServerErrorsLogged(app.server, 'Netease API');
      note({ host, port });
    });

    startup.finish('running');
    return { port };
  } catch (error) {
    startup.finish('failed');
    throw Object.assign(new Error(`${currentStep}: ${describeError(error)}`), { offline: error?.offline === true });
  }
}

// 第 3 段：诊断报告里属于线程的那部分（主进程补上后端状态）。
const diagnostics = () => ({
  startup: startup.snapshot(),
  login: upstream ? upstream.loginDiagnostics.snapshot() : null,
  identity: upstream ? upstream.loginIdentity.describe() : null,
  connections: networkRecorder.snapshot('netease').filter(entry => entry.tag === null).slice(-RECENT_CONNECTIONS),
});

const answer = (id, run) => {
  Promise.resolve().then(run).then(
    (value) => {
      try {
        parentPort.postMessage({ type: 'result', id, ok: true, value });
      } catch (error) {
        // 结果不能跨线程传：也要回一句，不然主进程会一直等。回的是失败，带上传不过去的原因（包成对象的理由见下）。
        parentPort.postMessage({ type: 'result', id, ok: false, error: { inspected: util.inspect(error, { depth: 3 }) } });
      }
    },
    (error) => {
      // 失败是不是断网造成的（resolveXeapiPublicKey 记在错上）另外传：错过线程时只留下名字和那句话。
      const offline = error?.offline === true;
      try {
        parentPort.postMessage({ type: 'result', id, ok: false, error, offline });
      } catch {
        // 不能跨线程传的值（带函数的对象）。不直接传文字：主进程会把字符串原样当成错误信息放进状态，
        // 而状态会进登录诊断；包成对象，状态里和以前一样是「Unknown error」，文字只进日志。
        parentPort.postMessage({ type: 'result', id, ok: false, error: { inspected: util.inspect(error, { depth: 3 }) }, offline });
      }
    },
  );
};

parentPort.on('message', (message) => {
  if (message.type === 'start') {
    answer(message.id, () => startNcmApi(message));
  } else if (message.type === 'diagnostics') {
    answer(message.id, diagnostics);
  }
});
