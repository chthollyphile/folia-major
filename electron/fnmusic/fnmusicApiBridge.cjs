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
//  - 认证：POST /music/api/v1/user/password-login {username, password: sha256(password)} →
//    {userToken, user}；后续请求带 Cookie: music-token={userToken}（不再使用 authx 签名头）
//  - 响应信封：{ code, msg, data }，code ∈ {0, 200} 视为成功；code 120001 = 账号或密码错误
//  - 播放流：GET /music/api/v1/track/stream?guid= 直接回原始音频文件（实测 200 audio/x-flac），不分音质
//
// FN Connect 中继（外网登录）：
//  - 飞牛有两个中继集群：5ddd.com（新）与 fnos.net（旧），两者并存，一个 FN ID 只开在其中一个上
//    （NAS 端「设置 → 远程访问」里选集群）。
//  - 登录框整段只填一个 FN ID（DNS 标签字符，不含协议 / 端口 / 路径）→ 先试 https://<fnid>.5ddd.com，
//    没拿到 fnOS 的答复（解析不到、连不上、回的不是 JSON）再试 https://<fnid>.fnos.net；填 IP / 域名 / 带协议或端口的地址（含 http://mynas 这类
//    局域网单段主机名）→ 原样走局域网直连。
//  - 网页入口的路径式写法 5ddd.com/<fnid>、fnos.net/<fnid>（含 www.）改写成对应的子域名（路径式地址回的是网页，不转发 API）。
//  - 中继主机一律走 https、只取主机不留路径（用户可能整段复制浏览器地址栏）。
//  - Cookie: mode=relay 只对 fnos.net 集群携带（每次请求按地址现算，不另存标志）；5ddd.com 实测不带即可登录（issue #1149）。
//  - 中继走公网，证书校验严格（rejectUnauthorized 只对私网自签名 NAS 放行）。
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
const SHA256 = value => crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
const CONFIG_STORE_KEY = 'fnmusic-config';
// deviceId 不是凭据（登录还要密码），单独明文存：登出清掉配置后再登录仍用同一台设备，不在 NAS 上多出一台 Folia。
const DEVICE_STORE_KEY = 'fnmusic-device-id';

// —— FN Connect 中继（外网登录）支持：登录框填纯 FN ID → 依次试两个集群的 https://<fnid>.<集群域名> ——
// 顺序即尝试顺序：新集群 5ddd.com 在前（飞牛要求迁过去，多数 FN ID 在这里），旧集群 fnos.net 在后。
// relayCookie：fnos.net 网关要求带 Cookie: mode=relay 才放行（cf25ce57 起的约定）；
// 5ddd.com 实测不带就能登录（issue #1149），没验证过带上的效果，先不带。
const RELAY_CLUSTERS = [
  { domain: '5ddd.com', relayCookie: false },
  { domain: 'fnos.net', relayCookie: true },
];
const RELAY_COOKIE = 'mode=relay';

// FN ID 是集群域名下的一段主机名：只收 DNS 标签字符。# ? @ \ 之类的字符会被 URL 解析成别的主机或片段，不能拼。
const FN_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** 智能识别服务器地址，返回按顺序尝试的候选地址：整段输入就是一个 FN ID → 每个集群一个
 *  https://<fnid>.<集群域名>（FN Connect 中继）；其余原样返回一个（交给 normalizeBase 补协议/校验）。
 *  写了协议、端口、路径的单段主机名（http://mynas、mynas:5666）照旧直连；localhost 永远是本机。 */
const resolveServerCandidates = (input) => {
  const s = String(input ?? '').trim();
  if (FN_ID_PATTERN.test(s) && s.toLowerCase() !== 'localhost') {
    return RELAY_CLUSTERS.map(cluster => `https://${s.toLowerCase()}.${cluster.domain}`);
  }
  return [s];
};

/** 主机名所在的 FN Connect 中继集群（<fnid>.5ddd.com / <fnid>.fnos.net），不是中继回 null。 */
const relayClusterOf = (hostname) => {
  const host = String(hostname || '').toLowerCase();
  return RELAY_CLUSTERS.find(cluster => host.endsWith(`.${cluster.domain}`)) ?? null;
};

/** 已规范化的服务器地址是否要带 mode=relay：按主机名判定所在集群，不看路径。 */
const usesRelayCookie = (base) => {
  try {
    return Boolean(relayClusterOf(new URL(base).hostname)?.relayCookie);
  } catch {
    return false;
  }
};

/** 构造请求 Cookie 头：token + 中继标志（登录请求无 token 时只带 mode=relay）。 */
const buildAuthCookie = ({ token, relay }) => {
  const parts = [];
  if (token) parts.push(`music-token=${encodeURIComponent(token)}`);
  if (relay) parts.push(RELAY_COOKIE);
  return parts.length ? parts.join('; ') : null;
};

/** 规范化用户填的服务器地址：没写协议按 http（fnOS 默认 5666 端口是 HTTP），只收 http/https，去掉末尾斜杠。
 *  FN Connect 中继：路径式入口 <集群域名>/<fnid> 改写成 <fnid>.<集群域名>；中继主机一律 https、只留主机。不合法回 null。 */
const normalizeBase = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    // 路径式入口（浏览器里的 https://5ddd.com/<fnid>）回的是网页，不转发 API：改写成子域名。
    const host = url.hostname.toLowerCase();
    const firstSegment = url.pathname.split('/').filter(Boolean)[0] ?? '';
    const pathCluster = RELAY_CLUSTERS.find(cluster => host === cluster.domain || host === `www.${cluster.domain}`);
    if (pathCluster && FN_ID_PATTERN.test(firstSegment)) {
      return `https://${firstSegment.toLowerCase()}.${pathCluster.domain}`;
    }
    // 中继走公网：一律 https（用户漏写协议时也不明文发密码摘要），只留主机（API 挂在根路径，复制来的页面路径会拼坏请求）。
    if (relayClusterOf(url.hostname)) {
      return `https://${url.host}`;
    }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return null;
  }
};

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
    rejectUnauthorized: parsed.protocol !== 'https:' || !isPrivateHost(parsed.hostname),
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
  base, method, path, params, body, token, relay = false,
}) => {
  const pathname = path.startsWith('/') ? path : `/${path}`;
  const query = encodeQuery(params);
  const url = `${base.replace(/\/+$/, '')}${pathname}${query ? `?${query}` : ''}`;
  const headers = { Accept: 'application/json' };
  const authCookie = buildAuthCookie({ token, relay });
  if (authCookie) headers.Cookie = authCookie;
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
      // errno：Node 的系统错误码（如 ENOTFOUND），登录据此判断 FN ID 是否不在这个中继集群上。
      error: { code: 'network', message: error instanceof Error ? error.message : String(error), errno: error?.code ?? null },
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
      // 日志交错误本体（栈/字段都在），不只 message。
      warn('无法解密已保存的飞牛配置（可能换了机器密钥）:', error);
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
    const authCookie = buildAuthCookie({ token: config.token, relay: usesRelayCookie(config.base) });
    if (authCookie) headers.Cookie = authCookie;
    if (range) headers.Range = range;
    const transport = targetUrl.protocol === 'https:' ? https : http;
    const upstream = transport.request(targetUrl, {
      method: 'GET',
      headers,
      // 只对私网地址（局域网自签名 NAS）放行证书校验；公网必须严格校验，防止中间人窃取 token。
      rejectUnauthorized: targetUrl.protocol !== 'https:' || !isPrivateHost(targetUrl.hostname),
      timeout: 12000, // 12s 无响应即失败：NAS 关机/断网时快速返回错误，不挂死播放/封面请求
    }, (up) => {
      // 上面的 timeout 是套接字空闲超时，只用来等响应头；响应开始后关掉它——播放暂停时 Chromium 不再读，
      // 背压会让上游空闲远超 12s，不关会在暂停后把流掐断。
      upstream.setTimeout(0);
      const out = {
        'Content-Type': up.headers['content-type'] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      };
      if (up.headers['content-length']) out['Content-Length'] = up.headers['content-length'];
      if (up.headers['accept-ranges']) out['Accept-Ranges'] = up.headers['accept-ranges'];
      if (up.headers['content-range']) out['Content-Range'] = up.headers['content-range'];
      // Readable.toWeb 在 cancel 时本身会销毁源流（渲染层拖进度条/切歌即可断开上游），无需覆盖。
      resolve(new Response(Readable.toWeb(up), { status: up.statusCode || 200, headers: out }));
    });
    upstream.on('timeout', () => {
      upstream.destroy(new Error(`上游请求超时（12s）: ${targetUrl}`));
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
    /** protocol.handle('folia-fnmusic') 处理器：/stream 与 /cover（供 main.cjs 注册自定义协议）。 */
    handleProtocolRequest,
    /** 当前桥状态：是否已配置、是否已登录（登录态由渲染层通过 getStatus 感知）。 */
    getStatus() {
      const config = readConfig();
      return {
        available: true,
        configured: Boolean(config?.base),
        authenticated: Boolean(config?.token),
        base: config?.base ?? null,
        username: config?.username ?? null,
        userId: config?.userId ?? null,
        nickname: config?.nickname ?? null,
      };
    },

    /** 登录：POST /music/api/v1/user/password-login，密码 SHA-256，成功后加密保存配置。
     *  服务器地址支持：局域网直连（IP[:端口]）与 FN Connect 中继（纯 FN ID → 依次试 https://<fnid>.5ddd.com、https://<fnid>.fnos.net）。 */
    async login({ base: rawBase, username, password, deviceId }) {
      if (!rawBase || !username || !password) {
        return { ok: false, status: 0, error: { code: 'invalid-params', message: '登录缺少服务器地址 / 账号 / 密码' } };
      }
      // 先识别 FN ID（纯短码 → 各中继集群的候选地址），再交给 normalizeBase 补协议/校验。
      const bases = resolveServerCandidates(rawBase).map(normalizeBase);
      if (!bases.length || bases.some(base => !base)) {
        return { ok: false, status: 0, error: { code: 'invalid-base', message: '服务器地址无效' } };
      }
      // 持久复用 deviceId：同一台机器登录同一 NAS 不产生新设备（与飞牛网页端一致）；登出之后也留着。
      const storedDeviceId = store.get(DEVICE_STORE_KEY);
      const effectiveDeviceId = deviceId
        || (typeof storedDeviceId === 'string' && storedDeviceId ? storedDeviceId : '')
        || readConfig()?.deviceId
        || crypto.randomBytes(16).toString('hex');
      let base = bases[0];
      let result = null;
      const failures = [];
      for (const candidate of bases) {
        base = candidate;
        // 中继地址按集群决定是否带 mode=relay（fnos.net 带，5ddd.com 不带）；局域网直连不带。
        const relay = usesRelayCookie(base);
        log(`登录走${relayClusterOf(new URL(base).hostname) ? ' FN Connect 中继' : '局域网直连'} host=${new URL(base).host}`);
        result = await performRequest({
          base,
          method: 'POST',
          path: '/music/api/v1/user/password-login',
          body: { username, password: SHA256(password), deviceId: effectiveDeviceId },
          relay,
          // 登录接口实测不校验 authx 签名（2026-10-28 服务端实测：无 authx 同样 code 0 登录成功），
          // 全接口也不做签名（见文件头注释），排除电脑系统时钟偏差导致签名校验失败的变量。
        });
        // 拿到 fnOS 的 JSON 答复（登录成功，或业务码如 120001 密码错）就是找对了集群，到此为止。
        // 其余失败（域名解析不到、代理 fake-ip 下的连接重置或超时、劫持页证书不符、网关回的网页）都换下一个集群：
        // 不能只认 ENOTFOUND，很多网络对不存在的域名也会给出一个地址。两个集群都是飞牛官方的 https 中继，证书严格校验。
        if (result.ok || typeof result.error?.code === 'number') break;
        failures.push(`${new URL(base).host}: ${result.error?.errno || result.error?.code || 'unknown'}`);
      }
      if (!result.ok && typeof result.error?.code !== 'number' && bases.length > 1) {
        log(`FN Connect 两个中继集群都没有连上这个 FN ID: ${failures.join('; ')}`);
        return {
          ok: false,
          status: 0,
          error: { code: 'network', message: `FN Connect 上没有连上这个 FN ID：可能 FN ID 不对，或者当前网络连不上中继（${failures.join('；')}）`, errno: result.error?.errno ?? null },
        };
      }
      if (!result.ok) return result;
      if (!result.data?.userToken || !result.data?.user) {
        return {
          ok: false,
          status: result.status,
          error: { code: 'invalid-response', message: '登录响应缺少 userToken 或 user' },
        };
      }
      store.set(DEVICE_STORE_KEY, effectiveDeviceId);
      // 账号身份取登录答复里的 user（guid / 昵称），不只用登录名：两台 NAS 上同名的账号不是同一个人。
      const user = isRecord(result.data.user) ? result.data.user : {};
      const userId = String(user.guid ?? user.id ?? user.uid ?? '');
      const nickname = String(user.name ?? user.nickname ?? user.username ?? '');
      writeConfig({ base, username, token: result.data.userToken, deviceId: effectiveDeviceId, userId, nickname });
      return { ok: true, status: result.status, data: { user: result.data.user } };
    },

    /** 登出：POST /music/api/v1/user/logout，随后清配置。 */
    async logout() {
      const config = readConfig();
      if (config?.base && config.token) {
        await performRequest({ base: config.base, method: 'POST', path: '/music/api/v1/user/logout', token: config.token, relay: usesRelayCookie(config.base) });
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
      return performRequest({ base: config.base, method: method || 'GET', path, params, body, token: config.token, relay: usesRelayCookie(config.base) });
    },

    /** 播放地址：返回 folia-fnmusic:// 协议 URL（协议 handler 实时转发，URL 不带凭据）。 */
    async stream({ trackId }) {
      const config = readConfig();
      if (!config?.base) return { ok: false, status: 0, error: { code: 'unconfigured', message: '飞牛尚未配置服务器' } };
      // track/stream 回原始文件，不分音质（协议只验证过 guid 参数），不转发音质。
      const q = new URLSearchParams({ guid: trackId });
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

module.exports = { createFnmusicApiBridge, performRequest, resolveServerCandidates, normalizeBase, buildAuthCookie, FN_MUSIC_SCHEME, FN_MUSIC_PRIVILEGED_SCHEME };
