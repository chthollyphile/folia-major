const dns = require('dns');
const net = require('net');

// electron/netease/upstreamAddressOrder.cjs
// 网易云工作线程连上游时先试 IPv4、IPv4 连不上再试 IPv6（#1068）。只在 neteaseApiWorker.cjs 里调用。
//
// 为什么：上游（util/request）每个请求都新建一个 https.Agent，所以每次都是一条新的 TCP + TLS 连接，不存在
// keep-alive 复用了已断连接的问题。Node 默认按系统给的顺序（verbatim）试地址，网卡有 IPv6 默认路由时 Windows
// 把 AAAA 排在前面，interface.music.163.com（eapi）就走 IPv6。#1068 的环境里 IPv6 握手是通的，连接在请求
// 途中被对端重置（read ECONNRESET），上游把它答成 502。握手已经成功，Node 的 Happy Eyeballs（autoSelectFamily）
// 不会回落到 IPv4；关掉网卡的 IPv6 后同一歌单 45+ 次请求零失败。
//
// 为什么用 ipv4first：网易云的服务都有 IPv4；只有 IPv6 的网络里，IPv4 连不上（通常立刻 ENETUNREACH），
// autoSelectFamily 照旧接着试 IPv6，不会因此断网。
// ipv4first 只是让 IPv4 先试：一次尝试超过 autoSelectFamily 的时限，Node 关掉它改试 IPv6，又回到会被重置的路上。
// Electron 43（Node 24.21）的默认时限是 250ms，海外到网易云的往返常在这个数上下，所以把这个线程的时限放到
// UPSTREAM_ATTEMPT_TIMEOUT_MS。代价：IPv4 路由在、却悄悄丢包的双栈网络里，每个请求最多多等这么久再走 IPv6。
// SYN 丢包要等系统重传（Windows 首次约 3 秒），这里不去覆盖。
// 为什么不另加重试：上游所有请求都是 POST，里面有写操作（收藏、加歌、播放上报），按路径挑出能重发的读请求
// 牵涉面大；重置在 IPv6 上成串出现，重试也躲不开。
// 影响面：dns 的默认顺序和 net 的尝试时限都是每个线程各自一份（2026-11-05 用 worker_threads 实测），这里只改网易云工作线程，
// 主进程和别的平台不受影响。
const UPSTREAM_RESULT_ORDER = 'ipv4first';
const UPSTREAM_ATTEMPT_TIMEOUT_MS = 1000;

// 把这个线程之后的连接改成 IPv4 在前，并放宽每个地址的尝试时限。要在任何上游请求发出之前调用。
function preferIpv4Upstream({ dnsModule = dns, netModule = net, logger = console } = {}) {
  const previousOrder = typeof dnsModule.getDefaultResultOrder === 'function' ? dnsModule.getDefaultResultOrder() : 'unknown';
  const previousTimeout = typeof netModule.getDefaultAutoSelectFamilyAttemptTimeout === 'function'
    ? netModule.getDefaultAutoSelectFamilyAttemptTimeout()
    : 'unknown';
  dnsModule.setDefaultResultOrder(UPSTREAM_RESULT_ORDER);
  netModule.setDefaultAutoSelectFamilyAttemptTimeout(UPSTREAM_ATTEMPT_TIMEOUT_MS);
  logger.log(
    `[Netease API] upstream address order set to ${UPSTREAM_RESULT_ORDER} (was ${previousOrder}), `
    + `attempt timeout ${UPSTREAM_ATTEMPT_TIMEOUT_MS}ms (was ${previousTimeout}ms)`,
  );
}

module.exports = {
  UPSTREAM_ATTEMPT_TIMEOUT_MS,
  UPSTREAM_RESULT_ORDER,
  preferIpv4Upstream,
};
