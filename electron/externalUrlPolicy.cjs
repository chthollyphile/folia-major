'use strict';

// electron/externalUrlPolicy.cjs
// 「打开外部链接」的校验与工厂：从 main.cjs 里抽出来，是为了能在不启动 Electron 的前提下被测
// （main.cjs 一 require 就会建窗口、起内嵌后端、注册托盘）。main.cjs 用的是这里导出的同一个工厂，
// 所以测试跑的就是产品代码本身，不是复制一份的平行实现。
//
// 为什么要有这层：渲染进程一旦被注入、或某个调用面把不可信字符串交给这个 IPC，
// `shell.openExternal` 会让系统按注册的协议处理程序去打开它（file:// 开本地资源、
// ms-settings: 开系统设置页、任何自定义协议取决于机器上装了什么）。这不是「任意代码执行」本身，
// 能不能造成后果取决于系统与协议处理程序；白名单的意义是把这条触发面收窄到浏览器链接。
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * 校验一个外部链接：只接受 http(s)，返回规范化后的 URL；任何其它情况返回 null。
 * 返回 null 的三种情形都按「拒绝」处理：不是非空字符串、解析不了、协议不在白名单。
 */
const resolveExternalUrl = (url) => {
  if (typeof url !== 'string' || !url.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    return null;
  }
  return parsed.toString();
};

/**
 * 造一个 openExternalUrl：`openExternal` 由调用方注入（生产环境是 shell.openExternal，
 * 测试里是个 spy，这样「非法协议没有真的去开东西」这件事能被直接断言）。
 * 返回 true 表示已交给系统，false 表示被拒绝。
 */
const createExternalUrlOpener = ({ openExternal, onBlocked }) => async (url) => {
  const resolved = resolveExternalUrl(url);
  if (resolved === null) {
    if (typeof onBlocked === 'function') {
      onBlocked(url);
    }
    return false;
  }
  await openExternal(resolved);
  return true;
};

module.exports = {
  ALLOWED_EXTERNAL_PROTOCOLS,
  resolveExternalUrl,
  createExternalUrlOpener,
};
