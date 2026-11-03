const { isConnectionResetMessage } = require('../../shared/networkErrorText.cjs');
const { readCookieField } = require('./neteaseLoginDiagnostics.cjs');

// electron/netease/neteaseLoginIdentity.cjs
// 扫码请求被网易直接断开（连接被重置）后，同一设备标识和出口 IP 下继续扫码多半还是被断；用户反馈要重新联网
// （换出口 IP）或重启应用才恢复。扫码请求走 eapi，Cookie 只带 header 里的几项，其中重启会换掉的是：
// - deviceId：取 global.deviceId，每次启动随机生成。「重启后端」只在后端故障时重新初始化，届时上游
//   register_anonimous 也会换它；后端正常时不换。
// - MUSIC_A：上游 util/request 在加载时读一次匿名 token 文件并缓存到进程结束，重启后才读到启动流程写回的 token。
//   文件只在启动时刷新，所以只有第一次轮换可能换到不同的 token，之后的轮换只换 deviceId。
// 被重置时只记「待轮换」，到下一次要码（unikey）前才真正换：同一轮的 key 与轮询始终是同一个身份，
// 上一轮晚到的重置也不会在新一轮中途换掉 deviceId。若网易按出口 IP 限制，这样做无效也无害。
// 整个机制只在本文件和 main.cjs 的接线里，回退时一起删掉。

const LOGIN_QR_URI_PREFIX = '/api/login/qrcode/';
const LOGIN_QR_KEY_URI = '/api/login/qrcode/unikey';

// 上游 request 把网络错误 reject 成 { status: 502, body: { code: 502, msg: err.message } }。
const isConnectionReset = (error) => Boolean(
  error
  && typeof error === 'object'
  && Number(error.status) === 502
  && isConnectionResetMessage(error.body?.msg),
);

const withCookieField = (options, name, value) => {
  const { cookie } = options;
  if (typeof cookie === 'string' && cookie.trim()) return { ...options, cookie: `${cookie}; ${name}=${value}` };
  if (cookie && typeof cookie === 'object') return { ...options, cookie: { ...cookie, [name]: value } };
  return { ...options, cookie: { [name]: value } };
};

// 创建扫码身份轮换器：wrapRequest 包住上游 request，describe 给诊断报告。
function createNeteaseLoginIdentity({
  generateDeviceId,
  readAnonymousToken,
  // 上游 util/request 加载时读到的那份 token，用来判断轮换时是否真的换到了新 token。
  initialAnonymousToken = '',
  setDeviceId = (deviceId) => { global.deviceId = deviceId; },
  getDeviceId = () => global.deviceId,
  now = Date.now,
  logger = console,
} = {}) {
  const processStartedAt = now();
  // null：沿用上游加载时读到的匿名 token。
  let anonymousToken = null;
  let pendingRotation = false;
  let rotations = 0;
  let lastRotatedAt = null;
  let lastTokenRenewed = null;
  let connectionResets = 0;

  const readToken = () => {
    try {
      return String(readAnonymousToken() ?? '').trim() || null;
    } catch {
      return null;
    }
  };

  // 换 deviceId；token 读到了、且与当前在用的不同才算换到了新 token（读不到时保留原来那个）。
  const rotate = () => {
    pendingRotation = false;
    setDeviceId(generateDeviceId());
    const token = readToken();
    const current = anonymousToken ?? (String(initialAnonymousToken ?? '').trim() || null);
    lastTokenRenewed = Boolean(token && token !== current);
    if (token) anonymousToken = token;
    rotations += 1;
    lastRotatedAt = now();
    logger.warn('[Netease API] login identity rotated after connection reset', {
      rotations,
      tokenRenewed: lastTokenRenewed,
    });
  };

  // 只补上游本来会用缓存 token 兜底的请求：没有 MUSIC_U，也没自带 MUSIC_A（渲染进程的匿名 cookie 不动）。
  const applyAnonymousToken = (options) => {
    if (!anonymousToken || readCookieField(options.cookie, 'MUSIC_U') || readCookieField(options.cookie, 'MUSIC_A')) {
      return options;
    }
    return withCookieField(options, 'MUSIC_A', anonymousToken);
  };

  const wrapRequest = (request) => (uri, data, options = {}) => {
    const isQrRequest = typeof uri === 'string' && uri.startsWith(LOGIN_QR_URI_PREFIX);
    if (pendingRotation && uri === LOGIN_QR_KEY_URI) rotate();
    return Promise.resolve(request(uri, data, applyAnonymousToken(options))).catch((error) => {
      if (isQrRequest && isConnectionReset(error)) {
        connectionResets += 1;
        pendingRotation = true;
      }
      throw error;
    });
  };

  const describe = () => ({
    processStartedAt,
    deviceId: typeof getDeviceId() === 'string' ? getDeviceId() : null,
    connectionResets,
    rotations,
    lastRotatedAt,
    lastTokenRenewed,
    pendingRotation,
  });

  return { wrapRequest, describe };
}

module.exports = {
  createNeteaseLoginIdentity,
};
