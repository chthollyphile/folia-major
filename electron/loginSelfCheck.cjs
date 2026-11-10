"use strict";

const dns = require('dns');
const http = require('http');
const https = require('https');
const tls = require('tls');

// electron/loginSelfCheck.cjs
// 扫码登录失败后的主动自检（主进程）：按顺序回答「卡在哪一层」——
// 1. 本地后端：状态是不是 running，对它发一个 HTTP 请求有没有回应；
// 2. 代理：环境变量里的代理、系统代理（Electron 按系统设置解析的结果）；内嵌后端的请求不走系统代理，
//    但 TUN 模式的代理会在网络层接管，表现为 DNS 返回 198.18.0.0/15 的 fake-ip；
// 3. 每个上游域名：DNS 给了哪些地址 → 对第一个 IPv4、第一个 IPv6 地址各做一次 TCP + TLS 握手（分开测，
//    才分得清「只有 IPv6 这条路被重置」）→ 一次真实的 HTTPS 请求（用服务器的 Date 头算本机时钟偏差）。
// 结果是结构化数据，结论（verdict）由渲染进程的 core/account/loginSelfCheckRules 推出，报告里两者都有。
// 每一项都有超时，各域名并行，整体在十秒左右结束。

const DEFAULT_TIMEOUT_MS = 5000;
const BACKEND_TIMEOUT_MS = 3000;
const PROXY_ENV_NAMES = ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY'];

const errorOf = (error, phase) => ({
  code: typeof error?.code === 'string' ? error.code : null,
  message: error instanceof Error ? error.message : String(error ?? ''),
  ...(phase ? { phase } : {}),
});

// 代理地址里的账号密码是凭据，换成 ***；其余原样保留。
const maskProxyCredentials = (value) => String(value).replace(/\/\/([^/@\s]+)@/, '//***@');

// 198.18.0.0/15 是基准测试保留段，Clash 等代理的 fake-ip 默认用它：DNS 返回这段地址说明有 TUN 代理在接管连接。
const isFakeIp = (address) => {
  const match = /^(\d+)\.(\d+)\./.exec(address);
  return Boolean(match) && Number(match[1]) === 198 && (Number(match[2]) === 18 || Number(match[2]) === 19);
};

const withTimeout = (promise, timeoutMs, label) => {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

// 对本地后端发一个 GET /：两个后端在根路径都有回应（静态页或 404 都算活着），拿到任何 HTTP 响应即可。
const probeLocalBackend = ({ port, timeoutMs = BACKEND_TIMEOUT_MS, now = Date.now, httpModule = http }) => new Promise((resolve) => {
  const startedAt = now();
  const request = httpModule.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (response) => {
    response.resume();
    resolve({ ok: true, httpStatus: response.statusCode ?? null, durationMs: now() - startedAt, error: null });
  });
  request.on('timeout', () => request.destroy(Object.assign(new Error(`no response within ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
  request.on('error', (error) => {
    resolve({ ok: false, httpStatus: null, durationMs: now() - startedAt, error: errorOf(error) });
  });
});

const lookupHost = async ({ host, lookup, timeoutMs, now }) => {
  const startedAt = now();
  try {
    const answers = await withTimeout(lookup(host, { all: true, verbatim: true }), timeoutMs, `DNS lookup of ${host}`);
    const addresses = answers.map(answer => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }));
    return { addresses, durationMs: now() - startedAt, error: null, fakeIp: addresses.some(item => isFakeIp(item.address)) };
  } catch (error) {
    return { addresses: [], durationMs: now() - startedAt, error: errorOf(error, 'dns'), fakeIp: false };
  }
};

// 对一个具体地址做 TCP + TLS 握手，记下两段各自的耗时；失败时 phase 说明断在 TCP 还是 TLS。
const probeTlsHandshake = ({ host, address, family, timeoutMs, now, tlsModule = tls }) => new Promise((resolve) => {
  const startedAt = now();
  let tcpMs = null;
  let settled = false;
  const socket = tlsModule.connect({ host: address, port: 443, servername: host, timeout: timeoutMs });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    resolve({ address, family, tcpMs, tlsMs: null, error: null, ...result });
  };
  socket.once('connect', () => {
    tcpMs = now() - startedAt;
  });
  socket.once('secureConnect', () => {
    finish({ tlsMs: now() - startedAt, protocol: socket.getProtocol?.() ?? null });
  });
  socket.once('timeout', () => {
    finish({ error: errorOf(Object.assign(new Error(`no progress within ${timeoutMs}ms`), { code: 'ETIMEDOUT' }), tcpMs === null ? 'tcp' : 'tls') });
  });
  socket.once('error', (error) => {
    finish({ error: errorOf(error, tcpMs === null ? 'tcp' : 'tls') });
  });
});

// 一次真实的 HTTPS GET（走 Node 默认的地址选择，与内嵌后端发请求的方式相同）；任何 HTTP 响应都说明这条路通。
const probeHttps = ({ host, timeoutMs, now, httpsModule = https }) => new Promise((resolve) => {
  const startedAt = now();
  const request = httpsModule.get({ host, path: '/', timeout: timeoutMs, agent: false }, (response) => {
    response.resume();
    const serverDate = Date.parse(response.headers?.date ?? '');
    const finishedAt = now();
    resolve({
      httpStatus: response.statusCode ?? null,
      durationMs: finishedAt - startedAt,
      remote: response.socket?.remoteAddress
        ? { address: response.socket.remoteAddress, family: response.socket.remoteFamily === 'IPv6' ? 6 : 4 }
        : null,
      error: null,
      // Date 头只到秒；偏差在几秒以内都当作准确，结论只看大偏差。
      clockSkewMs: Number.isFinite(serverDate) ? Math.round(finishedAt - serverDate) : null,
    });
  });
  request.on('timeout', () => request.destroy(Object.assign(new Error(`no response within ${timeoutMs}ms`), { code: 'ETIMEDOUT' })));
  request.on('error', (error) => {
    resolve({ httpStatus: null, durationMs: now() - startedAt, remote: null, error: errorOf(error, 'http'), clockSkewMs: null });
  });
});

const probeHost = async ({ host, deps }) => {
  const { lookup, timeoutMs, now } = deps;
  const dnsResult = await lookupHost({ host, lookup, timeoutMs, now });
  const targets = [4, 6]
    .map(family => dnsResult.addresses.find(item => item.family === family))
    .filter(Boolean);
  const [connections, httpsResult] = await Promise.all([
    Promise.all(targets.map(target => probeTlsHandshake({ host, ...target, timeoutMs, now, tlsModule: deps.tlsModule }))),
    dnsResult.error ? Promise.resolve(null) : probeHttps({ host, timeoutMs, now, httpsModule: deps.httpsModule }),
  ]);
  return { host, dns: dnsResult, connections, https: httpsResult };
};

const readProxyEnv = (env) => {
  const found = {};
  for (const name of PROXY_ENV_NAMES) {
    const value = env[name] ?? env[name.toLowerCase()];
    if (typeof value === 'string' && value.trim()) found[name] = maskProxyCredentials(value.trim());
  }
  return found;
};

/**
 * 跑一次自检。backend 是后端此刻的状态（{ status, port, error }）；hosts 是要检查的上游域名；
 * resolveSystemProxy(url) 返回系统代理的解析结果（Electron 的 session.resolveProxy），不可用时为 null。
 */
async function runLoginSelfCheck({
  providerId,
  backend,
  hosts,
  resolveSystemProxy = null,
  env = process.env,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  lookup = dns.promises.lookup,
  httpModule = http,
  httpsModule = https,
  tlsModule = tls,
}) {
  const startedAt = now();
  const deps = { lookup, timeoutMs, now, httpsModule, tlsModule };

  const backendCheck = (async () => {
    if (!backend) return null;
    const probe = backend.status === 'running' && backend.port
      ? await probeLocalBackend({ port: backend.port, now, httpModule })
      : null;
    return { status: backend.status, port: backend.port ?? null, error: backend.error ?? null, probe };
  })();

  const proxyCheck = (async () => {
    let system = null;
    if (resolveSystemProxy && hosts.length > 0) {
      try {
        system = await withTimeout(Promise.resolve(resolveSystemProxy(`https://${hosts[0]}`)), timeoutMs, 'system proxy lookup');
      } catch (error) {
        system = `unavailable: ${errorOf(error).message}`;
      }
    }
    return { env: readProxyEnv(env), system: typeof system === 'string' ? system : null };
  })();

  const [backendResult, proxyResult, hostResults] = await Promise.all([
    backendCheck,
    proxyCheck,
    Promise.all(hosts.map(host => probeHost({ host, deps }))),
  ]);

  return {
    providerId,
    runtime: 'electron',
    startedAt,
    durationMs: now() - startedAt,
    backend: backendResult,
    proxy: proxyResult,
    hosts: hostResults,
  };
}

module.exports = {
  isFakeIp,
  maskProxyCredentials,
  probeTlsHandshake,
  runLoginSelfCheck,
};
