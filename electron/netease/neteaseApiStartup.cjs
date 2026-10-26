const { isNetworkFailureMessage } = require('../../shared/networkErrorText.cjs');
const { waitUntilListening: waitUntilBound } = require('../backendLifecycle.cjs');

// electron/netease/neteaseApiStartup.cjs
// 网易本地 API 的启动与请求管线上用到的纯函数：启动期网络调用的超时与重试、xeapi 公钥与匿名 token 的刷新、
// 来源 IP 策略、扫码请求的网络层重试、替换上游 login_qr_check。装配顺序见 neteaseApiWorker.cjs。

// 推迟 jsdom 也是启动的一步：从这里一并交出去，用的地方不用多认一个文件。
const { deferJsdom } = require('./lazyJsdom.cjs');

const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;
const DEFAULT_RETRY_JITTER_MS = 100;
const DEFAULT_OPERATION_TIMEOUT_MS = 10000;

const wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

// Bounds a single startup network call. The upstream api-enhanced requests carry no axios timeout,
// so a black-holed route to interface.music.163.com would otherwise stall startup until the OS
// gives up on the socket (minutes on some platforms). Pass timeoutMs = 0 to opt out.
function withTimeout(promise, timeoutMs, label) {
  if (!(timeoutMs > 0)) {
    return promise;
  }

  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(
        // 和网络层自己的超时同一个码：isNetworkFailure 认它。
        () => reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

// 请求没有拿到任何回答：域名解析不了、连不上、连接断了、超时。是网络的事，不是网易云说了什么。
// 按码认，不按「axios 的错没带回答」认：取消（ERR_CANCELED）、地址或选项写错（ERR_INVALID_URL、
// ERR_BAD_OPTION_VALUE）也不带回答，却不会因为网通了就好。这个包用的 axios 1.20.0 在 Node 下实测：
// 域名解析不了是 ENOTFOUND，连接被拒是 ECONNREFUSED，它自己的超时是 ECONNABORTED；ERR_NETWORK 是它在
// 浏览器里的说法。启动用的 withTimeout 超时带 ETIMEDOUT。
const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENETUNREACH', 'ENETDOWN', 'EHOSTUNREACH',
  'ERR_NETWORK',
]);
function isNetworkFailure(error) {
  // 带着回答的错，请求是到了的（回答之后连接才断的也算到了）。
  if (!error || typeof error !== 'object' || error.response) return false;
  return NETWORK_ERROR_CODES.has(error.code);
}

function getErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return typeof error === 'string' && error.trim() ? error : 'Unknown error';
}

function hasUsableXeapiPublicKey(publicKey) {
  return Boolean(
    publicKey
    && typeof publicKey === 'object'
    && typeof publicKey.sk === 'string'
    && publicKey.sk.trim(),
  );
}

function getAnonymousCookie(registration) {
  const bodyCookie = registration?.body?.cookie;
  if (typeof bodyCookie === 'string' && bodyCookie.trim()) {
    return bodyCookie;
  }

  const responseCookies = registration?.cookie;
  if (Array.isArray(responseCookies)) {
    return responseCookies
      .filter((cookie) => typeof cookie === 'string' && cookie.trim())
      .join(';');
  }

  return typeof responseCookies === 'string' ? responseCookies : '';
}

function describeAnonymousRegistration(registration) {
  const status = registration?.status;
  const code = registration?.body?.code;
  const message = registration?.body?.message || registration?.body?.msg;
  const details = [
    status !== undefined ? `status=${status}` : '',
    code !== undefined ? `code=${code}` : '',
    typeof message === 'string' && message.trim() ? `message=${message.trim()}` : '',
  ].filter(Boolean);

  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

// Retries a short startup operation with bounded exponential backoff and jitter.
async function retryStartupOperation(operation, options = {}) {
  const attempts = options.attempts || DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const jitterMs = options.jitterMs ?? DEFAULT_RETRY_JITTER_MS;
  const sleep = options.sleep || wait;
  const random = options.random || Math.random;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }

      options.onRetry?.(error, attempt);
      const exponentialDelay = baseDelayMs * (2 ** (attempt - 1));
      const jitter = Math.floor(random() * jitterMs);
      await sleep(exponentialDelay + jitter);
    }
  }

  throw new Error('Startup operation exhausted its retry attempts');
}

// Refreshes the xeapi key and falls back only when the cached key is still usable.
async function resolveXeapiPublicKey({
  currentPublicKey,
  deviceId,
  getXeapiPublicKey,
  logger = console,
  retryOptions,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  // 所有重试都失败时调用（不论之后是回落到缓存还是抛出），启动步骤记录据此留下最终的错误原文。
  onFailure,
}) {
  try {
    const publicKey = await retryStartupOperation(
      async () => {
        const refreshedPublicKey = await withTimeout(
          getXeapiPublicKey(currentPublicKey, deviceId),
          timeoutMs,
          'xeapi public key refresh',
        );
        if (!hasUsableXeapiPublicKey(refreshedPublicKey)) {
          throw new Error('xeapi public key response missing sk');
        }
        return refreshedPublicKey;
      },
      {
        ...retryOptions,
        onRetry: (error, attempt) => {
          logger.warn(
            `[Netease API] Failed to refresh xeapi public key (attempt ${attempt}), retrying: ${getErrorMessage(error)}`,
          );
          retryOptions?.onRetry?.(error, attempt);
        },
      },
    );

    return { publicKey, refreshed: true };
  } catch (error) {
    onFailure?.(error);
    if (!hasUsableXeapiPublicKey(currentPublicKey)) {
      // 没有存下的密钥可用，这次启动只能失败。是网络造成的就在错上记一笔（offline）：主进程据此说连不上，
      // 网通了再启动一次就好，不用重启应用（startsAgainWhenNeeded）。
      if (isNetworkFailure(error)) error.offline = true;
      throw error;
    }

    logger.warn(
      `[Netease API] Failed to refresh xeapi public key, using cached key: ${getErrorMessage(error)}`,
    );
    return { publicKey: currentPublicKey, refreshed: false };
  }
}

// Refreshes the anonymous token without making this optional credential block startup.
async function refreshAnonymousToken({
  registerAnonymous,
  cookieToJson,
  persistToken,
  logger = console,
  retryOptions,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
  // 所有重试都失败时调用；匿名 token 是可选凭据，失败不阻塞启动，只把原因交给启动步骤记录。
  onFailure,
}) {
  try {
    await retryStartupOperation(async () => {
      const registration = await withTimeout(
        registerAnonymous(),
        timeoutMs,
        'anonymous registration',
      );
      const anonymousCookie = getAnonymousCookie(registration);
      if (!anonymousCookie.trim()) {
        throw new Error(
          `anonymous registration response missing cookie${describeAnonymousRegistration(registration)}`,
        );
      }

      const cookieObject = cookieToJson(anonymousCookie);
      if (typeof cookieObject.MUSIC_A !== 'string' || !cookieObject.MUSIC_A.trim()) {
        throw new Error('anonymous registration response missing MUSIC_A');
      }

      await persistToken(cookieObject.MUSIC_A);
    }, {
      ...retryOptions,
      onRetry: (error, attempt) => {
        logger.warn(
          `[Netease API] Failed to refresh anonymous token (attempt ${attempt}), retrying: ${getErrorMessage(error)}`,
        );
        retryOptions?.onRetry?.(error, attempt);
      },
    });
    return true;
  } catch (error) {
    onFailure?.(error);
    logger.warn(
      `[Netease API] Failed to refresh anonymous token, keeping existing token: ${getErrorMessage(error)}`,
    );
    return false;
  }
}

// 等一个已经调过 listen 的服务有结果：监听上了 resolve，监听不上（比如端口被别的程序占了）reject 那个错误
// （backendLifecycle.cjs，两个本地后端共用）。上游的 serveNcmApi 调完 listen 就返回，不等结果；Express 5 又把
// listen 的错误交给它自己的回调、不抛出来，所以不等的话端口被占也算启动成功。
// 调用的地方 await 完 serveNcmApi 紧接着就到这里，error 事件来不及先发（量过：连着 await 1000 次它还没发，
// 要到 process.nextTick 那一轮才发）。限时是防上游以后改了先后：真错过了，这次启动算失败，不会一直等。
function waitUntilListening(server, timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS) {
  return withTimeout(waitUntilBound(server), timeoutMs, 'local API server listen');
}

// 与 Docker 镜像（deploy/docker/scripts/patch-music-api-client-ip.mjs）同一策略：只有显式传了
// randomCNIP 的请求才带伪造的来源 IP，其余请求不写 X-Real-IP / X-Forwarded-For，由网易按连接本身
// 识别真实公网出口。上游默认会把本机请求的 127.0.0.1 写进去，从 ::1 进来的还会换成随机国内 IP；
// 后者与手机扫码时的位置对不上，会让扫码确认失败。
function withoutImplicitClientIp(request) {
  return (uri, data, options = {}) => request(uri, data, options.randomCNIP ? options : { ...options, ip: '' });
}

// 替换上游的 module/login_qr_check.js（installLoginQrCheck 把它放进 require 缓存）。上游在 catch 里读 try 里
// 声明的 result：请求一被拒绝（连不上网易云时 util/request 回 502，风控时是网易云的码）就抛 ReferenceError，
// server.js 把没有 body 的错一律回成 404「Not Found」，页面分不出连不上和被拒绝。这里是同一个请求，被拒绝的
// 回答不接住：server.js 照它的 status 和 body 回给页面，和 login_qr_key 一样。
function createLoginQrCheck(createOption) {
  return async (query, request) => {
    const result = await request('/api/login/qrcode/client/login', { key: query.key, type: 3 }, createOption(query));
    return {
      status: 200,
      body: { ...result.body, cookie: result.cookie.join(';') },
      cookie: result.cookie,
    };
  };
}

// 扫码的两步：要码与轮询。两者都可以安全地重发：重发要码只是换一把新 key，重发轮询只是多问一次同一把 key。
const QR_RETRY_URIS = new Set(['/api/login/qrcode/unikey', '/api/login/qrcode/client/login']);

// 只读的账户路由加入同一份重试表：启动后第一次问「谁登录着」时，偶尔会撞上上游一次连接级别的重置/超时
// （2026-10-26 实测：匿名 token 刚刷新完，紧随其后的 /api/w/nuser/account/get 两次 ETIMEDOUT 共 42 秒，
// 之后同一条链路 81ms 就通）。它们都是幂等读，重发一次没有副作用；不重试的话 UI 会看到 502、账号区停在
// 「问不到」。写操作（发送、收藏、播放上报）不在这里，重发会重复动作。
const READ_RETRY_URIS = new Set(['/api/w/nuser/account/get', '/api/nuser/account/get']);
const NETWORK_RETRY_URIS = new Set([...QR_RETRY_URIS, ...READ_RETRY_URIS]);
const DEFAULT_QR_RETRY_DELAY_MS = 300;

/** 上游 request 的网络层失败：axios 没拿到响应时上游 reject 成 { status: 502, body: { code: 502, msg } }。 */
const isUpstreamNetworkFailure = (error) => Boolean(
  error
  && typeof error === 'object'
  && Number(error.status) === 502
  && isNetworkFailureMessage(error.body?.msg),
);

// 上游每次请求都新建连接；用户贴回的报告里，被重置的扫码请求前后同一身份的请求照常成功（#445 #469 #502），
// 被重置是逐个连接的偶发事件。扫码两步遇到网络层失败时隔一小段再发一次，单次重置不再直接让登录失败。
// 每次尝试各自经过诊断记录（这一层包在诊断记录外面），报告里能看到重试本身。
// 传给上游的 data / options 每次都复制一份：上游会往 data 上写字段，重发不能带着上一次的改动。
function withQrNetworkRetry(request, {
  uris = NETWORK_RETRY_URIS,
  delayMs = DEFAULT_QR_RETRY_DELAY_MS,
  sleep = wait,
  logger = console,
} = {}) {
  const attempt = (uri, data, options) => request(uri, { ...data }, {
    ...options,
    ...(options?.cookie && typeof options.cookie === 'object' ? { cookie: { ...options.cookie } } : {}),
  });
  return async (uri, data = {}, options = {}) => {
    try {
      return await attempt(uri, data, options);
    } catch (error) {
      if (!uris.has(uri) || !isUpstreamNetworkFailure(error)) throw error;
      logger.warn('[Netease API] request failed at the network level, retrying once', {
        uri,
        message: error.body?.msg,
      });
      await sleep(delayMs);
      return attempt(uri, data, options);
    }
  };
}

// 断网时没启动成的本地 API（没有存下的 xeapi 密钥）在网通了以后才起得来，又没有别的东西会告诉它网通了。
// 所以由下一个要用它的请求来叫它再启动一次（渲染进程的 getApiBase 经 restart-netease-api 来问，带着
// 'needed'）：那一刻网可能已经通了，也正是有人要用它的时候。不用计时器在后台反复试：没人用时试了也白试。
// 同一时刻只有一次启动（主进程的 startNeteaseApi 本来就把启动排成一个）；离上一次断网失败不到
// OFFLINE_RETRY_GAP_MS 就不试，答当前的状态：断网时一页歌单的几十个请求不会变成几十次启动。断网时一次
// 启动约 1.2 秒（取密钥的三次都解析失败，2026-10-17 用工作线程实跑）；隔 10 秒，断网时一分钟至多六次，
// 网通了以后至多多等 10 秒。别的失败（端口被占、包本身出错）再试也一样，只由用的人按「重启后端服务」去试。
const OFFLINE_RETRY_GAP_MS = 10 * 1000;
function startsAgainWhenNeeded(status, now) {
  return status?.status === 'error' && status.offline === true && now - status.updatedAt >= OFFLINE_RETRY_GAP_MS;
}

// 把应用的 login_qr_check 放进 require 缓存，占住上游那个文件的位置。server.js 启动时按路径 require 它的
// module 目录，拿到的就是缓存里的这一个，所以要赶在那之前调用（neteaseApiWorker.cjs 在加载 main 和 server 之前）。
// 先 require 再改缓存项：缓存项要先有。
function installLoginQrCheck() {
  const qrCheckPath = require.resolve('@neteasecloudmusicapienhanced/api/module/login_qr_check');
  require(qrCheckPath);
  require.cache[qrCheckPath].exports = createLoginQrCheck(require('@neteasecloudmusicapienhanced/api/util/option'));
}

module.exports = {
  DEFAULT_OPERATION_TIMEOUT_MS,
  DEFAULT_QR_RETRY_DELAY_MS,
  OFFLINE_RETRY_GAP_MS,
  createLoginQrCheck,
  installLoginQrCheck,
  isUpstreamNetworkFailure,
  NETWORK_RETRY_URIS,
  READ_RETRY_URIS,
  deferJsdom,
  hasUsableXeapiPublicKey,
  isNetworkFailure,
  refreshAnonymousToken,
  resolveXeapiPublicKey,
  retryStartupOperation,
  startsAgainWhenNeeded,
  waitUntilListening,
  withQrNetworkRetry,
  withTimeout,
  withoutImplicitClientIp,
};
