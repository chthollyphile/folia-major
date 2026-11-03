const os = require('os');

// electron/netease/neteaseLoginDiagnostics.cjs
// 网易登录请求的记录：包在上游 util/request 外面，只记登录相关的接口（扫码、匿名注册、账户读取），
// 每次调用记下 uri、加密方式、来源 IP 头、deviceId、cookie 里有没有登录 / 匿名凭据、耗时与结果（状态码、返回码、原文），
// 并经连接层记录器（electron/networkRecorder.cjs）对上这一次调用实际发出的连接：连了哪个地址、v4 还是 v6、
// 失败在 TCP / TLS / 等响应的哪一步、Node 错误码。快照给诊断报告，同一条记录也打到主进程日志。
// 上游 login_qr_check 出错时会把网易的真实返回码（风控 8821 等）吞成一个 404，应用已换掉它
// （见 neteaseApiStartup.cjs 的 createLoginQrCheck）。
// cookie 只记有没有 MUSIC_U / MUSIC_A，不记值：值对排查没有用，贴进公开 issue 却等于交出账号。

const LOGIN_URI_PATTERN = /^\/api\/(login\/|register\/anonimous|w\/nuser\/account\/get|nuser\/account\/get)/;
const MAX_ENTRIES = 40;
const MAX_MESSAGE_LENGTH = 300;
// 报告里一行一个请求，deviceId 只留末尾几位就能看出前后是不是同一个设备；完整值在 identity 行。
const DEVICE_ID_TAIL_LENGTH = 8;

const truncate = (value) => {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return text.length > MAX_MESSAGE_LENGTH ? `${text.slice(0, MAX_MESSAGE_LENGTH)}…` : text;
};

const readCookieField = (cookie, name) => {
  if (typeof cookie === 'string') {
    return new RegExp(`(?:^|;\\s*)${name}=([^;]*)`).exec(cookie)?.[1] || '';
  }
  if (cookie && typeof cookie === 'object' && typeof cookie[name] === 'string') {
    return cookie[name];
  }
  return '';
};

// 与 util/request.js 取来源 IP 的优先级一致（realIP 优先于 ip），记录的是最终真正会发出去的那个头。
const describeIpHeader = (options) => {
  if (options.realIP) return 'real-ip';
  if (!options.ip) return 'none';
  return options.randomCNIP ? 'random-cn' : 'client';
};

// 成功时 request 返回 { status, body }；失败时 reject 的也是同样形状的 answer，网络错误则 body 为 { code: 502, msg }。
const describeOutcome = (settled, value) => {
  if (value && typeof value === 'object' && ('status' in value || 'body' in value)) {
    const body = value.body && typeof value.body === 'object' ? value.body : {};
    return {
      settled,
      status: Number(value.status) || null,
      code: body.code ?? null,
      message: truncate(body.message || body.msg || ''),
    };
  }
  return {
    settled,
    status: null,
    code: null,
    message: truncate(value instanceof Error ? `${value.name}: ${value.message}` : value),
  };
};

// 连接层记录里与这一行有关的部分（一次调用通常只有一个连接；带反作弊 token 的接口会多出几个）。
const compactConnection = (entry) => ({
  host: entry.host,
  path: entry.path,
  dns: entry.dns,
  attempts: entry.attempts,
  remote: entry.remote,
  reusedSocket: entry.reusedSocket,
  connectMs: entry.connectMs,
  tlsMs: entry.tlsMs,
  responseMs: entry.responseMs,
  totalMs: entry.totalMs,
  status: entry.status,
  error: entry.error,
});

// 列出每块网卡的名字与地址。Teredo、6to4、TUN 一类的代理网卡、有没有公网 IPv6，都是排查连接被重置时要先看的。
const describeNetwork = (networkInterfaces) => {
  let interfaces = {};
  try {
    interfaces = networkInterfaces() || {};
  } catch (error) {
    return { interfaces: [], error: error instanceof Error ? error.message : String(error) };
  }
  return {
    interfaces: Object.entries(interfaces).flatMap(([name, addresses]) => {
      const external = (addresses || []).filter(item => !item.internal);
      if (external.length === 0) return [];
      return [{
        name,
        addresses: external.map(item => ({
          address: item.address,
          family: item.family === 'IPv6' || item.family === 6 ? 6 : 4,
          ...(item.scopeid ? { scopeId: item.scopeid } : {}),
        })),
      }];
    }),
  };
};

// 创建一份登录诊断记录：wrapRequest 包住上游 request，snapshot 给渲染进程生成诊断报告。
function createNeteaseLoginDiagnostics({
  now = Date.now,
  getDefaultDeviceId = () => global.deviceId,
  networkInterfaces = os.networkInterfaces,
  networkRecorder = null,
  logger = console,
} = {}) {
  const entries = [];
  const startup = {};
  let seq = 0;

  const record = (entry) => {
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
  };

  // 必须包在 withoutImplicitClientIp 里面，看到的才是最终发出去的 options。
  const wrapRequest = (request) => (uri, data, options = {}) => {
    if (typeof uri !== 'string' || !LOGIN_URI_PATTERN.test(uri)) {
      return request(uri, data, options);
    }

    const startedAt = now();
    const cookie = options.cookie;
    const deviceId = readCookieField(cookie, 'deviceId') || getDefaultDeviceId() || '';
    const tag = `netease-login#${++seq}`;
    const entry = {
      at: startedAt,
      uri,
      crypto: options.crypto || '',
      ipHeader: describeIpHeader(options),
      deviceIdTail: deviceId ? deviceId.slice(-DEVICE_ID_TAIL_LENGTH) : '',
      hasMusicU: Boolean(readCookieField(cookie, 'MUSIC_U')),
      hasMusicA: Boolean(readCookieField(cookie, 'MUSIC_A')),
      durationMs: null,
      outcome: { settled: 'pending', status: null, code: null, message: '' },
      connections: [],
    };
    record(entry);

    const finish = (settled, value) => {
      entry.durationMs = now() - startedAt;
      entry.outcome = describeOutcome(settled, value);
      entry.connections = networkRecorder ? networkRecorder.entriesForTag(tag).map(compactConnection) : [];
      const last = entry.connections[entry.connections.length - 1];
      logger[settled === 'rejected' ? 'warn' : 'info']('[Netease API] login request', {
        uri,
        settled,
        status: entry.outcome.status,
        code: entry.outcome.code,
        message: entry.outcome.message,
        durationMs: entry.durationMs,
        ipHeader: entry.ipHeader,
        deviceIdTail: entry.deviceIdTail,
        ...(last ? {
          remote: last.remote ? `${last.remote.address} (IPv${last.remote.family ?? '?'})` : null,
          connectMs: last.connectMs,
          tlsMs: last.tlsMs,
          networkError: last.error,
        } : {}),
      });
    };

    const run = () => Promise.resolve(request(uri, data, options));
    return (networkRecorder ? networkRecorder.run(tag, run) : run()).then(
      (result) => {
        finish('resolved', result);
        return result;
      },
      (error) => {
        finish('rejected', error);
        throw error;
      },
    );
  };

  const noteStartup = (patch) => {
    Object.assign(startup, patch);
  };

  const snapshot = () => ({
    capturedAt: now(),
    startup: { ...startup },
    network: describeNetwork(networkInterfaces),
    requests: entries.map(entry => ({
      ...entry,
      outcome: { ...entry.outcome },
      connections: entry.connections.map(connection => ({ ...connection })),
    })),
  });

  return { wrapRequest, noteStartup, snapshot };
}

module.exports = {
  createNeteaseLoginDiagnostics,
  describeNetwork,
  readCookieField,
};
