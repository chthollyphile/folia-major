'use strict';

// electron/ipcAccessGuard.cjs
// 给「只该由第一方窗口调用」的 IPC handler 包一层来源校验。抽成工厂的原因有两个：
// 一是能在不启动 Electron 的前提下断言「不可信来源确实没被执行」（main.cjs 加载即建窗口）；
// 二是让每条通道各自声明拒绝时的行为（读接口回受限值、写接口直接拒），避免一处误配影响全部。
//
// **保护边界（评审要求写明）**：这里比的是 `event.sender` 对应的 webContents 是不是已知的第一方窗口。
// 它能拒绝其它窗口——包括 window.open 出来的、带着同一个 preload 的那些；它**挡不住主窗口里
// 已经注入的脚本**（那种情况下 sender 就是主窗口本身）。页面 URL / senderFrame / CSP 是另一层的事，
// 不在这个校验的职责内。所以它是一个收窄调用面的防御性措施，不是「已确认漏洞」的封堵。
const createSenderGuardedHandler = ({ isTrusted, handler, onUntrusted, channel }) => (event, ...args) => {
  if (!isTrusted(event)) {
    if (typeof onUntrusted === 'function') {
      return onUntrusted(event);
    }
    // 默认：写通道直接拒，先把「不该来的人不许执行」这件事做对。
    throw new Error(`Untrusted renderer attempted to call the ${channel} channel.`);
  }
  return handler(event, ...args);
};

module.exports = { createSenderGuardedHandler };
