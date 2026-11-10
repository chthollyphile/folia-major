"use strict";

const diagnosticsChannel = require('diagnostics_channel');
const { AsyncLocalStorage } = require('async_hooks');

// electron/networkRecorder.cjs
// 出站请求的连接层记录：内嵌后端经 Node 的 http/https（axios、ws）访问上游。diagnostics_channel 只看得到
// 本线程的请求，所以每个线程各开一份：主进程里的记 QQ，网易的工作线程（neteaseApiWorker.cjs）里另有一份。
// 这里订阅 Node 的 diagnostics_channel，按域名认出属于哪个 provider，记下每个请求的完整连接过程：
// DNS 给了哪些地址、逐个尝试了哪些地址（Happy Eyeballs）、最后连上谁（v4 / v6）、TCP 与 TLS 各用了多久、
// 失败在哪一步（dns / tcp / tls / 等响应）、Node 的错误码。上游 request 会把 err.code 吞掉，只剩一句 message，
// 「连接被重置」到底发生在 TLS 握手还是请求发出之后、走的是不是 IPv6，只有这里看得到。
// - 用 http.client.request.created（构造时发布）而不是 .start：后者在 socket 分配之后才发布，会错过 lookup / connect。
// - 不给 request 挂 'response' / 'upgrade' / 'error' 监听：前两个会改变 Node 的默认处理（没人听时丢弃响应体 / 销毁
//   socket），'error' 会吞掉本该抛出的错误；响应与错误改走 diagnostics_channel，只在 socket 上听无副作用的事件。
// - run(tag, fn)：经 AsyncLocalStorage 给一段调用打标签，这段调用里发出的请求都带上它（网易登录请求记录据此对上号）。

// 每个 provider 各留最近这么多条：一个 provider 的日常请求（搜索、歌词）再多，也挤不掉另一个的记录。
const DEFAULT_MAX_ENTRIES = 60;

// 只记登录与后端初始化会访问的上游域名；别的请求（歌词、封面等）不进记录。
const DEFAULT_PROVIDER_HOSTS = {
  netease: ['163.com', '126.net', '163yun.com', 'netease.com'],
  qq: ['qq.com', 'tencentmusic.com'],
};

const hostMatches = (host, domain) => host === domain || host.endsWith(`.${domain}`);

// 订阅者与 socket 监听里的异常会被 Node 转抛成主进程的未捕获异常：记录失败只能丢掉这一条，不能牵连请求本身。
const guarded = (fn) => (...args) => {
  try {
    fn(...args);
  } catch (error) {
    console.warn('[NetworkRecorder] failed to record a request', error);
  }
};

// 按域名认 provider；不认识的域名返回 null（不记）。
const createHostClassifier = (providerHosts) => (host) => {
  const normalized = String(host || '').toLowerCase().replace(/\.$/, '');
  if (!normalized) return null;
  for (const [providerId, domains] of Object.entries(providerHosts)) {
    if (domains.some(domain => hostMatches(normalized, domain))) return providerId;
  }
  return null;
};

const familyOf = (value) => {
  if (value === 4 || value === 'IPv4') return 4;
  if (value === 6 || value === 'IPv6') return 6;
  return null;
};

const describeSocketError = (error) => ({
  code: typeof error?.code === 'string' ? error.code : null,
  message: error instanceof Error ? error.message : String(error ?? ''),
});

// 错误发生时请求走到了哪一步：没连上之前看有没有 DNS 结果；连上之后看 TLS 握手完没完、响应来没来。
const errorPhaseOf = (entry) => {
  if (entry.status !== null) return 'response';
  if (entry.tlsMs !== null) return 'request';
  if (entry.connectMs !== null) return entry.secure ? 'tls' : 'request';
  if (entry.dns.length === 0 && !entry.reusedSocket) return 'dns';
  return 'tcp';
};

/**
 * 创建连接层记录器。start() 之后开始订阅，stop() 取消订阅；snapshot(providerId) 给诊断报告，
 * entriesForTag(tag) 给按标签对号的调用方（网易登录请求记录）。
 */
function createNetworkRecorder({
  providerHosts = DEFAULT_PROVIDER_HOSTS,
  maxEntries = DEFAULT_MAX_ENTRIES,
  now = Date.now,
  channels = diagnosticsChannel,
} = {}) {
  const classify = createHostClassifier(providerHosts);
  const tags = new AsyncLocalStorage();
  const entriesByProvider = new Map();
  const byRequest = new WeakMap();
  let seq = 0;
  let subscriptions = null;

  const record = (entry) => {
    const entries = entriesByProvider.get(entry.providerId) ?? [];
    entries.push(entry);
    if (entries.length > maxEntries) entries.shift();
    entriesByProvider.set(entry.providerId, entries);
  };
  const allEntries = () => [...entriesByProvider.values()].flat();

  const watchSocket = (entry, socket, startedAt) => {
    entry.reusedSocket = Boolean(entry.request?.reusedSocket);
    // 复用的连接不会再有 lookup / connect：远端地址直接从 socket 上读。
    if (entry.reusedSocket || (!socket.connecting && socket.remoteAddress)) {
      entry.remote = { address: socket.remoteAddress || null, family: familyOf(socket.remoteFamily) };
      return;
    }
    socket.on('lookup', guarded((error, address, family) => {
      if (error) {
        entry.dnsError = describeSocketError(error);
        return;
      }
      if (address) entry.dns.push({ address, family: familyOf(family) });
    }));
    socket.on('connectionAttempt', guarded((address, _port, family) => {
      entry.attempts.push({ address, family: familyOf(family), outcome: 'pending', error: null });
    }));
    const settleAttempt = (address, outcome, error = null) => {
      const attempt = [...entry.attempts].reverse().find(item => item.address === address && item.outcome === 'pending');
      if (attempt) Object.assign(attempt, { outcome, error });
    };
    socket.on('connectionAttemptFailed', guarded((address, _port, _family, error) => {
      settleAttempt(address, 'failed', describeSocketError(error));
    }));
    socket.on('connectionAttemptTimeout', guarded((address) => {
      settleAttempt(address, 'timeout');
    }));
    socket.once('connect', guarded(() => {
      entry.connectMs = now() - startedAt;
      entry.remote = { address: socket.remoteAddress || null, family: familyOf(socket.remoteFamily) };
      if (entry.remote.address) settleAttempt(entry.remote.address, 'connected');
    }));
    socket.once('secureConnect', guarded(() => {
      entry.tlsMs = now() - startedAt;
    }));
  };

  const onCreated = guarded(({ request }) => {
    const host = request?.host;
    const providerId = classify(host);
    if (!providerId) return;
    const startedAt = now();
    const rawPath = typeof request.path === 'string' ? request.path : '';
    const entry = {
      id: ++seq,
      at: startedAt,
      providerId,
      tag: tags.getStore() ?? null,
      method: request.method || 'GET',
      host: String(host).toLowerCase(),
      // query 只会让一行变得很长（QQ 的 ptlogin 链接带一长串参数），路径足够认出是哪个接口。
      path: rawPath.split('?')[0] || '/',
      secure: request.protocol === 'https:' || request.agent?.protocol === 'https:',
      dns: [],
      dnsError: null,
      attempts: [],
      remote: null,
      reusedSocket: false,
      connectMs: null,
      tlsMs: null,
      responseMs: null,
      totalMs: null,
      status: null,
      error: null,
      settled: 'pending',
      request,
    };
    byRequest.set(request, entry);
    record(entry);
    request.once('socket', guarded(socket => watchSocket(entry, socket, startedAt)));
    request.once('close', guarded(() => {
      entry.totalMs = now() - startedAt;
      if (entry.settled === 'pending') entry.settled = entry.status !== null ? 'response' : 'closed';
      // 结算后不再持有 request，记录只剩可序列化的字段。
      entry.request = null;
    }));
  });

  const onError = guarded(({ request, error }) => {
    const entry = byRequest.get(request);
    if (!entry || entry.error) return;
    entry.error = { ...describeSocketError(error), phase: errorPhaseOf(entry) };
    entry.settled = 'error';
  });

  const onResponse = guarded(({ request, response }) => {
    const entry = byRequest.get(request);
    if (!entry) return;
    entry.status = Number(response?.statusCode) || null;
    entry.responseMs = now() - entry.at;
    entry.settled = 'response';
  });

  const start = () => {
    if (subscriptions) return;
    subscriptions = [
      ['http.client.request.created', onCreated],
      ['http.client.request.error', onError],
      ['http.client.response.finish', onResponse],
    ];
    for (const [name, handler] of subscriptions) channels.subscribe(name, handler);
  };

  const stop = () => {
    if (!subscriptions) return;
    for (const [name, handler] of subscriptions) channels.unsubscribe(name, handler);
    subscriptions = null;
  };

  const toPlain = ({ request: _request, ...entry }) => ({
    ...entry,
    dns: entry.dns.map(item => ({ ...item })),
    attempts: entry.attempts.map(item => ({ ...item })),
    remote: entry.remote ? { ...entry.remote } : null,
    error: entry.error ? { ...entry.error } : null,
    dnsError: entry.dnsError ? { ...entry.dnsError } : null,
  });

  return {
    start,
    stop,
    /** 在标签下运行 fn：fn 里（含其后的异步续体）发出的请求都带这个标签。 */
    run: (tag, fn) => tags.run(tag, fn),
    entriesForTag: (tag) => allEntries().filter(entry => entry.tag === tag).sort((a, b) => a.id - b.id).map(toPlain),
    snapshot: (providerId) => (entriesByProvider.get(providerId) ?? []).map(toPlain),
  };
}

module.exports = {
  DEFAULT_PROVIDER_HOSTS,
  createHostClassifier,
  createNetworkRecorder,
};
