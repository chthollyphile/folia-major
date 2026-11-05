const dns = require('dns');

// electron/netease/upstreamAddressOrder.cjs
// 网易云工作线程连上游时先试 IPv4、IPv4 连不上再试 IPv6（#1068）。只在 neteaseApiWorker.cjs 里调用。
//
// 为什么：上游（util/request）每个请求都新建一个 https.Agent，所以每次都是一条新的 TCP + TLS 连接，不存在
// keep-alive 复用了已断连接的问题。Node 默认按系统给的顺序（verbatim）试地址，网卡有 IPv6 默认路由时 Windows
// 把 AAAA 排在前面，interface.music.163.com（eapi）就走 IPv6。#1068 的环境里 IPv6 握手是通的，连接在请求
// 途中被对端重置（read ECONNRESET），上游把它答成 502。握手已经成功，Node 的 Happy Eyeballs（autoSelectFamily）
// 不会回落到 IPv4；关掉网卡的 IPv6 后同一歌单 45+ 次请求零失败。
//
// 为什么用 ipv4first：网易云的服务都有 IPv4，换到 IPv4 是确定能走通的那条路；只有 IPv6 的网络里，
// autoSelectFamily 在 IPv4 连不上时照旧接着试 IPv6，不会因此断网。
// 为什么不另加重试：上游所有请求都是 POST，里面有写操作（收藏、加歌、播放上报），按路径挑出能重发的读请求
// 牵涉面大；重置在 IPv6 上成串出现，重试也躲不开。
// 影响面：dns 的默认顺序是每个线程各自一份（2026-11-05 用 worker_threads 实测），这里只改网易云工作线程，
// 主进程和别的平台不受影响。
const UPSTREAM_RESULT_ORDER = 'ipv4first';

// 把这个线程之后的域名解析改成 IPv4 在前。要在任何上游请求发出之前调用。
function preferIpv4Upstream({ dnsModule = dns, logger = console } = {}) {
  const previous = typeof dnsModule.getDefaultResultOrder === 'function' ? dnsModule.getDefaultResultOrder() : 'unknown';
  dnsModule.setDefaultResultOrder(UPSTREAM_RESULT_ORDER);
  logger.log(`[Netease API] upstream address order set to ${UPSTREAM_RESULT_ORDER} (was ${previous})`);
}

module.exports = {
  UPSTREAM_RESULT_ORDER,
  preferIpv4Upstream,
};
