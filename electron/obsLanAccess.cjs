'use strict';

const os = require('os');

// electron/obsLanAccess.cjs
// OBS 浏览器源的局域网访问：监听地址的选择、本机局域网 IPv4 地址枚举与分类、局域网链接拼装，
// 以及不含 token 的公开状态。从 main.cjs 里抽出来，是为了不启动 Electron 也能单测。
//
// 默认只监听回环地址；用户在设置里显式打开「允许局域网访问」后才监听 0.0.0.0，
// 让同一网络里的平板、手机直接打开浏览器源页面。页面与事件流仍然要求 token。

const LOOPBACK_HOST = '127.0.0.1';
const ALL_INTERFACES_HOST = '0.0.0.0';

// 虚拟机、WSL、容器和 VPN / 加速器建的网卡：其他设备通常连不到这些地址。
// 按网卡名识别（Windows 的网卡别名、macOS / Linux 的接口名）。
const VIRTUAL_INTERFACE_PATTERN = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|vmnet|Parallels|TAP|TUN|utun|Tailscale|ZeroTier|WireGuard|wg\d|Clash|VPN|docker|br-|veth|virbr|Loopback|Npcap|Bluetooth|蓝牙/i;
// 网卡名看不出来时（例如 TAP 网卡在 Windows 上叫「本地连接」）再按 MAC 前缀识别：
// TAP-Windows 00:ff、Hyper-V / WSL 00:15:5d、VMware、VirtualBox、Parallels、Docker。
const VIRTUAL_MAC_PREFIXES = ['00:ff:', '00:15:5d', '00:50:56', '00:0c:29', '00:05:69', '00:1c:14', '08:00:27', '0a:00:27', '00:1c:42', '02:42:'];
// Windows「移动热点」（ICS）固定使用 192.168.137.0/24，电脑自己是 .1。
const WINDOWS_HOTSPOT_PATTERN = /^192\.168\.137\./;

const resolveObsListenHost = (lanAccess) => (lanAccess ? ALL_INTERFACES_HOST : LOOPBACK_HOST);

const isPrivateIpv4 = (address) => (
  address.startsWith('10.')
  || address.startsWith('192.168.')
  || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
);

// Node 18.0–18.3 把 family 报成数字 4，之后是字符串 'IPv4'，两种都认。
const isIpv4Entry = (entry) => entry && (entry.family === 'IPv4' || entry.family === 4);

/** 给地址分类：'network' 实体网卡上的私有地址、'hotspot' 本机移动热点、'virtual' 虚拟网卡、'public' 其他。 */
const classifyLanAddress = (address, interfaceName, mac = '') => {
  const normalizedMac = String(mac).toLowerCase().replace(/-/g, ':');
  if (VIRTUAL_INTERFACE_PATTERN.test(interfaceName) || VIRTUAL_MAC_PREFIXES.some(prefix => normalizedMac.startsWith(prefix))) {
    return 'virtual';
  }
  if (WINDOWS_HOTSPOT_PATTERN.test(address)) return 'hotspot';
  return isPrivateIpv4(address) ? 'network' : 'public';
};

const KIND_ORDER = { network: 0, hotspot: 1, public: 2, virtual: 3 };

/**
 * 列出本机可供局域网设备访问的 IPv4 地址：去掉回环、链路本地（169.254.x.x）和重复项，
 * 按「实体网卡 → 移动热点 → 公网 → 虚拟网卡」排序，第一个就是最可能连得上的地址。
 */
const listLanIpv4Addresses = (interfaces = os.networkInterfaces()) => {
  const entries = [];
  for (const [interfaceName, interfaceEntries] of Object.entries(interfaces || {})) {
    for (const entry of interfaceEntries || []) {
      if (!isIpv4Entry(entry) || entry.internal) continue;
      const address = String(entry.address || '');
      if (!address || address.startsWith('169.254.') || entries.some(item => item.address === address)) continue;
      entries.push({ address, interfaceName, kind: classifyLanAddress(address, interfaceName, entry.mac) });
    }
  }
  // Array.prototype.sort 是稳定排序，同类地址保持系统给出的顺序。
  return entries.sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]);
};

/** 为每个地址拼出带 token 的局域网链接；没有 token 时不给链接。 */
const buildObsLanEndpoints = ({ addresses, port, token }) => {
  if (!token) return [];
  return addresses.map(item => ({
    ...item,
    url: `http://${item.address}:${port}/obs?obs=1&token=${encodeURIComponent(token)}`,
  }));
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
  classifyLanAddress,
  listLanIpv4Addresses,
  buildObsLanEndpoints,
  buildPublicObsStatus,
};
