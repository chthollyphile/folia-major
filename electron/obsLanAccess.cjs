'use strict';

const os = require('os');

// electron/obsLanAccess.cjs
// OBS 浏览器源的局域网访问：监听地址的选择、本机局域网 IPv4 地址枚举、局域网链接拼装，
// 以及不含 token 的公开状态。从 main.cjs 里抽出来，是为了不启动 Electron 也能单测。
//
// 默认只监听回环地址；用户在设置里显式打开「允许局域网访问」后才监听 0.0.0.0，
// 让同一网络里的平板、手机直接打开浏览器源页面。页面与事件流仍然要求 token。

const LOOPBACK_HOST = '127.0.0.1';
const ALL_INTERFACES_HOST = '0.0.0.0';

const resolveObsListenHost = (lanAccess) => (lanAccess ? ALL_INTERFACES_HOST : LOOPBACK_HOST);

const isPrivateIpv4 = (address) => (
  address.startsWith('10.')
  || address.startsWith('192.168.')
  || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
);

// Node 18.0–18.3 把 family 报成数字 4，之后是字符串 'IPv4'，两种都认。
const isIpv4Entry = (entry) => entry && (entry.family === 'IPv4' || entry.family === 4);

/**
 * 列出本机可供局域网设备访问的 IPv4 地址：去掉回环、链路本地（169.254.x.x）和重复项，
 * 私有网段排在前面，因为家用路由器分配的地址几乎总在私有网段里。
 */
const listLanIpv4Addresses = (interfaces = os.networkInterfaces()) => {
  const addresses = [];
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      if (!isIpv4Entry(entry) || entry.internal) continue;
      const address = String(entry.address || '');
      if (!address || address.startsWith('169.254.') || addresses.includes(address)) continue;
      addresses.push(address);
    }
  }
  return [
    ...addresses.filter(isPrivateIpv4),
    ...addresses.filter(address => !isPrivateIpv4(address)),
  ];
};

const buildObsLanUrls = ({ addresses, port, token }) => {
  if (!token) return [];
  return addresses.map(address => `http://${address}:${port}/obs?obs=1&token=${encodeURIComponent(token)}`);
};

/**
 * `/obs/health` 不校验 token，开了局域网访问后同网段的任何设备都能请求它，
 * 所以只返回不含 token 与带 token 链接的字段。
 */
const buildPublicObsStatus = (status) => ({
  enabled: Boolean(status.enabled),
  port: status.port,
  lanAccess: Boolean(status.lanAccess),
  clientCount: status.clientCount,
});

module.exports = {
  LOOPBACK_HOST,
  ALL_INTERFACES_HOST,
  resolveObsListenHost,
  listLanIpv4Addresses,
  buildObsLanUrls,
  buildPublicObsStatus,
};
