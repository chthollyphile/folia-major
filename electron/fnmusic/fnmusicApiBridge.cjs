// electron/fnmusic/fnmusicApiBridge.cjs
// 飞牛音乐（fnOS 官方音乐服务器）API 主进程桥。
//
// 为什么需要主进程桥：
//  1. 渲染进程 fetch 不允许设置 Cookie 请求头（Chromium 受限头），而飞牛音乐认证依赖
//     `music-token` cookie（网页端 credentials:'include' 自动携带）。
//  2. 跨域请求受 CORS 限制，NAS 不一定会放行；主进程 Node http/https 无此限制。
//  3. 用户 NAS 多为自签名 HTTPS 证书，主进程可直接 rejectUnauthorized:false。
//
// 协议（提取自飞牛音乐网页 JS bundle，见 docs/fnmusic-protocol.md）：
//  - 基础路径 {origin}/music/api/v1{path}
//  - 每个请求带 authx 头：nonce={6位随机}&timestamp={Date.now()}&sign={md5}
//    sign = md5("NDzZTVxnRKP8Z0jXg1VAMonaG8akvh" + "_" + pathname + "_" + nonce + "_" + timestamp + "_" + bodyHash + "_" + apiKey)
//    bodyHash(GET) = md5(decodeURIComponent(排序后的 query string))
//    bodyHash(POST) = md5(JSON.stringify(body))
//    apiKey = "6D5602D4-A342-4799-A0F0-BB795E7167D0"（bundle 内 XOR 混淆，已还原）
//  - 认证：登录返回 {userToken, user}；后续请求带 Cookie: music-token={userToken}
//  - 响应信封：{ code, msg, data }，code ∈ {0, 200} 视为成功
//  - 播放流：GET /music/api/v1/track/stream 返回播放源；若 url 为 hls://{fileId}?quality=，
//    则继续 GET {origin}/api/stream/unified?fileId=...&quality=...（此接口不签名）取 m3u8
//
// 安全约定（与桌面端其他平台的主进程桥一致）：
//  - 服务器地址与凭据（token）只存在主进程：safeStorage 加密后写入 store，渲染进程只发操作。
//  - 播放/封面走 folia-fnmusic:// 自定义协议转发：认证头实时取自主进程配置，请求 URL 不带凭据，
//    也不暴露本地 HTTP 代理（protocol.handle 在渲染进程侧如同同源，无 CORS 限制）。
//  - 证书校验只对私网地址放行（自签名局域网 NAS）；公网 FN Connect 中继等必须严格校验。
//  - 日志只走 console.* 加 [FnMusic] 前缀，不写文件（避免凭据落盘）。

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { Readable } = require('stream');

// 播放/封面走自定义协议（协议地址稳定、重启不变）：无 CORS 限制、
// 不暴露本地 HTTP 代理。privileges 必须在 app ready 前经 protocol.registerSchemesAsPrivileged 注册。
const FN_MUSIC_SCHEME = 'folia-fnmusic';
const FN_MUSIC_PRIVILEGED_SCHEME = {
  scheme: FN_MUSIC_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
};

// 实测登录与 stream 均不需要 authx 签名（2026-10-28 服务端验证），因此不内嵌
// 客户端标识/密钥、不为每个请求签名（与 UPSTREAMS 的约定一致）。
const SUCCESS_CODES = new Set([0, 200]);
const MD5 = value => crypto.createHash('md5').update(String(value), 'utf8').digest('hex');
const SHA256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const CONFIG_STORE_KEY = 'fnmusic-config';

/** 是否为私网地址（局域网 NAS 常见自签名证书，仅此类放行证书校验；公网中继必须严格校验）。 */
const isPrivateHost = (hostname) => {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local')) return true;
  const parts = host.split('.').map(Number);
  if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 保留段
  }
  return false;
};

const isRecord = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const log = (...args) => console.log('[FnMusic]', ...args);
const warn = (...args) => console.warn('[FnMusic]', ...args);

/** 排序后的 key=value 串（与网页端 yO + decodeURIComponent 等价的输入串）。 */
const sortedQueryString = (params) => {
  if (!params) return '';
  return Object.keys(params)
    .filter(key => params[key] != null)
    .sort()
    .map(key => `${key}=${String(params[key])}`)
    .join('&');
};

const encodeQuery = (params) => {
  if (!params) return '';
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value != null) usp.set(key, String(value));
  });
  return usp.toString();
};

const requestOnce = (url, { method, headers, body }) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const req = transport.request(parsed, {
    method,
    headers,
    // 只对私网地址（局域网自签名 NAS）放行证书校验；公网 FN Connect 中继等必须严格校验，
    // 防止中间人拿到密码摘要与 userToken。
    rejectUnauthorized: parsed.protocol !== 'https:' || isPrivateHost(parsed.hostname),
    timeout: 12000, // 12s 无响应即失败：NAS 关机/断网时快速返回错误，界面不永久转圈
  }, res => {
    const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    res.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve({ status: res.statusCode, raw });
    });
  });
  req.on('timeout', () => {
    req.destroy(new Error(`请求超时（12s）: ${url}`));
  });
  req.on('error', reject);
  if (body !== undefined && body !== null) req.write(body);
  req.end();
});

const parseJsonEnvelope = (raw) => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * 发一次请求并解信封。
 * @returns {{ok:true,data:any,status:number} | {ok:false,error:{code?,msg?,status?},status:number}}
 */
const performRequest = async ({
  base, method, path, params, body, token,
}) => {
  const pathname = path.startsWith('/') ? path : `/${path}`;
  const query = encodeQuery(params);
  const url = `${base.replace(/\/+$/, '')}${pathname}${query ? `?${query}` : ''}`;
  const headers = { Accept: 'application/json' };
  if (token) headers.Cookie = `music-token=${encodeURIComponent(token)}`;
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json';
  const payload = body === undefined || body === null ? undefined : JSON.stringify(body);

  let response;
  try {
    response = await requestOnce(url, { method, headers, body: payload });
  } catch (error) {
    log(`FAIL ${method} ${pathname} query=${query}`, error instanceof Error ? error : new Error(String(error)));
    return {
      ok: false,
      status: 0,
      error: { code: 'network', message: error instanceof Error ? error.message : String(error) },
    };
  }
  const envelope = parseJsonEnvelope(response.raw);
  if (envelope && typeof envelope.code === 'number' && !SUCCESS_CODES.has(envelope.code)) {
    log(`BIZ-ERR ${method} ${pathname} query=${query} status=${response.status} code=${envelope.code} msg=${envelope.msg || ''}`);
    return {
      ok: false,
      status: response.status,
      error: { code: envelope.code, message: envelope.msg || `业务错误 code=${envelope.code}` },
    };
  }
  if (!response.raw || !envelope) {
    log(`BAD-RESP ${method} ${pathname} query=${query} status=${response.status}`);
    return {
      ok: false,
      status: response.status,
      error: { code: 'invalid-response', message: response.raw?.slice(0, 200) || '空响应' },
    };
  }
  log(`OK ${method} ${pathname} query=${query} status=${response.status} dataKeys=${Object.keys(envelope.data || {}).join(',')}`);
  return { ok: true, status: response.status, data: envelope.data ?? null };
};

/**
 * 主进程桥。服务器地址与 token 用 safeStorage 加密存进 store（渲染进程只发操作）。
 * @param {{ store: import('electron').ElectronStore, safeStorage: import('electron').safeStorage }} deps
 */
const createFnmusicApiBridge = ({ store, safeStorage }) => {

  // 系统级加密不可用时的运行时配置（与其它主进程桥一致：加密不可用/基本存储时只在本次运行内保存）。
  let memoryConfig = null;
  const canEncrypt = () => Boolean(safeStorage?.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

  const readConfig = () => {
    if (memoryConfig) return memoryConfig;
    const encoded = store.get(CONFIG_STORE_KEY);
    if (!encoded) return null;
    try {
      if (!canEncrypt()) return null;
      return JSON.parse(safeStorage.decryptString(Buffer.from(String(encoded), 'base64')));
    } catch (error) {
      warn('无法解密已保存的飞牛配置（可能换了机器密钥）:', error instanceof Error ? error.message : String(error));
      return null;
    }
  };
  const writeConfig = (config) => {
    if (config && canEncrypt()) {
      const encrypted = safeStorage.encryptString(JSON.stringify(config));
      store.set(CONFIG_STORE_KEY, encrypted.toString('base64'));
      memoryConfig = config;
    } else if (config) {
      // 系统级加密不可用：退回只在本次运行内保存（不落盘）。
      memoryConfig = config;
    } else {
      if (typeof store.delete === 'function') {
        store.delete(CONFIG_STORE_KEY);
      } else {
        store.set(CONFIG_STORE_KEY, undefined);
      }
      memoryConfig = null;
    }
  };
  // 播放/封面协议转发：把 folia-fnmusic:// 请求转发到 NAS（认证头从主进程配置实时取，
  // 自签名私网证书放行）。返回 protocol.handle 需要的 Response。
  const forwardUpstream = (config, pathname, params, { range } = {}) => new Promise((resolve) => {
    const targetUrl = new URL(`${config.base.replace(/\/+$/, '')}${pathname}`);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) targetUrl.searchParams.set(key, String(value));
    }
    const headers = { Accept: '*/*' };
    if (config.token) headers.Cookie = `music-token=${encodeURIComponent(config.token)}`;
    if (range) headers.Range = range;
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const upstream = transport.request(targetUrl, {
      method: 'GET',
      headers,
      rejectUnauthorized: targetUrl.protocol !== 'https:' || isPrivateHost(targetUrl.hostname),
    }, (up) => {
      const out = {
        'Content-Type': up.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      };
      if (up.headers['content-length']) out['Content-Length'] = up.headers['content-length'];
      if (up.headers['accept-ranges']) out['Accept-Ranges'] = up.headers['accept-ranges'];
      if (up.headers['content-range']) out['Content-Range'] = up.headers['content-range'];
      // 渲染层取消请求（拖进度条/切歌）时销毁上游连接，不留下暂停着的请求。
      const web = Readable.toWeb(up);
      const originalCancel = web.cancel?.bind(web);
      if (originalCancel) {
        web.cancel = (reason) => {
          upstream.destroy();
          return originalCancel(reason);
        };
      }
      resolve(new Response(web, { status: up.statusCode || 200, headers: out }));
    });
    upstream.on('error', (error) => {
      warn('上游请求失败:', error instanceof Error ? error : new Error(String(error)));
      resolve(new Response(null, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } }));
    });
    upstream.end();
  });

  const denied = (status) => new Response(null, { status, headers: { 'Access-Control-Allow-Origin': '*' } });

  /** protocol.handle('folia-fnmusic') 处理器：/stream 与 /cover 两个端点，其余 404。
   *  端点两种写法都接受：`folia-fnmusic://stream?…`（stream 作 host）与
   *  `folia-fnmusic:///stream?…`（stream 作 path）。 */
  const handleProtocolRequest = async (request) => {
    const config = readConfig();
    if (!config?.base) return denied(403);
    const u = new URL(request.url);
    const endpoint = u.pathname === '/' || u.pathname === '' ? u.hostname : u.pathname.replace(/^\//, '');
    const range = request.headers.get('range') || undefined;
    if (endpoint === 'stream') {
      const guid = u.searchParams.get('guid');
      if (!guid) return denied(400);
      const params = { guid };
      const quality = u.searchParams.get('quality');
      if (quality) params.quality = quality;
      // 2026-10-28 服务端实测：track/stream 不带 authx 同样返回音频（200 audio/x-flac）。
      return forwardUpstream(config, '/music/api/v1/track/stream', params, { range });
    }
    if (endpoint === 'cover') {
      const coverId = u.searchParams.get('coverId');
      if (!coverId) return denied(400);
      const params = { coverId };
      const size = u.searchParams.get('size');
      if (size) params.size = size;
      return forwardUpstream(config, '/music/api/v1/static/cover', params);
    }
    return denied(404);
  }

  return {
    /** 当前桥状态：是否已配置、是否已登录（登录态由渲染层通过 getStatus 感知）。 */
    getStatus() {
      const config = readConfig();
      return {
        available: true,
        configured: Boolean(config?.base),
        authenticated: Boolean(config?.token),
        base: config?.base ?? null,
        username: config?.username ?? null,
      };
    },

    /** 登录：POST /music/api/v1/user/password-login，密码 SHA-256，成功后加密保存配置。 */
    async login({ base, username, password, deviceId }) {
      if (!base || !username || !password) {
        return { ok: false, status: 0, error: { code: 'invalid-params', message: '登录缺少服务器地址 / 账号 / 密码' } };
      }
      // 持久复用 deviceId：同一台机器登录同一 NAS 不产生新设备（与飞牛网页端一致）。
      const existing = readConfig();
      const effectiveDeviceId = deviceId || existing?.deviceId || crypto.randomBytes(16).toString('hex');
      const result = await performRequest({
        base,
        method: 'POST',
        path: '/music/api/v1/user/password-login',
        body: { username, password: SHA256(password), deviceId: effectiveDeviceId },
        // 登录接口实测不校验 authx 签名（2026-10-28 服务端实测：无 authx 同样 code 0 登录成功），
        // 全接口也不做签名（见文件头注释），排除电脑系统时钟偏差导致签名校验失败的变量。
      });
      if (!result.ok) return result;
      if (!result.data?.userToken || !result.data?.user) {
        return {
          ok: false,
          status: result.status,
          error: { code: 'invalid-response', message: '登录响应缺少 userToken 或 user' },
        };
      }
      writeConfig({ base: base.replace(/\/+$/, ''), username, token: result.data.userToken, deviceId: effectiveDeviceId });
      return { ok: true, status: result.status, data: { user: result.data.user } };
    },

    /** 登出：POST /music/api/v1/user/logout，随后清配置。 */
    async logout() {
      const config = readConfig();
      if (config?.base && config.token) {
        await performRequest({ base: config.base, method: 'POST', path: '/music/api/v1/user/logout', token: config.token });
      }
      writeConfig(null);
      return { ok: true, status: 200, data: null };
    },

    /** 通用请求（搜索/歌词/歌单等）：path 为完整 API 路径；base/token 由主进程配置提供。 */
    async request({ path, method, params, body }) {
      const config = readConfig();
      if (!config?.base) {
        return { ok: false, status: 0, error: { code: 'unconfigured', message: '飞牛尚未配置服务器' } };
      }
      return performRequest({ base: config.base, method: method || 'GET', path, params, body, token: config.token });
    },

    /** 播放地址：返回 folia-fnmusic:// 协议 URL（协议 handler 实时转发，URL 不带凭据）。 */
    async stream({ trackId, quality }) {
      const config = readConfig();
      if (!config?.base) return { ok: false, status: 0, error: { code: 'unconfigured', message: '飞牛尚未配置服务器' } };
      const q = new URLSearchParams({ guid: trackId });
      if (quality) q.set('quality', quality);
      return { ok: true, status: 200, data: { url: `folia-fnmusic://stream?${q.toString()}` } };
    },

    /** 封面地址：返回 folia-fnmusic:// 协议 URL（coverId 由歌曲携带，地址在显示时生成）。 */
    async coverUrl({ coverId, size }) {
      const config = readConfig();
      if (!config?.base) return { ok: false, status: 0, error: { code: 'unconfigured', message: '飞牛尚未配置服务器' } };
      const q = new URLSearchParams({ coverId });
      if (size) q.set('size', String(size));
      return { ok: true, status: 200, data: { url: `folia-fnmusic://cover?${q.toString()}` } };
    },
  };
};

module.exports = { createFnmusicApiBridge, performRequest, FN_MUSIC_SCHEME, FN_MUSIC_PRIVILEGED_SCHEME };
