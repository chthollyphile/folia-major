import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// test/unit/electron/ipcSecurity.test.ts
//
// 主进程 IPC 与外部协议的静态契约防线。
//
// 为什么用读源码而不是加载 main.cjs：它在 require 时会启动整个 app（建窗口、起后端、
// 注册托盘），单测里加载不了。仓库里 electron/main.cjs 的既有测试（linuxDesktopIntegration
// 等）走的都是这条路。
//
// 这些断言钉的是「不变量」而非实现细节：
//   - 打开外部链接只允许 http(s)——否则渲染进程一旦被注入，就能借这个 IPC 拉起
//     file:// / ms-settings: / 任意自定义协议；
//   - 回传明文凭据、驱动内嵌 API 的通道必须校验来源——窗口只加载第一方本地内容，
//     但 window.open 出来的窗口同样带着 preload。
//
// 上游 v0.7.18 把内嵌后端的端口/状态搬进了 electron/loginBackendIpc.cjs（registerLoginBackendIpc），
// QQ 那两道通道跟着搬家，来源校验也必须跟着走——否则安全修复会在重构里静默丢失。

const rootDir = path.resolve(__dirname, '../../../');
const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');
const loginBackendIpcCjs = readFileSync(path.join(rootDir, 'electron/loginBackendIpc.cjs'), 'utf8');

describe('main.cjs external protocol gate', () => {
  it('gates openExternal behind an http(s) allowlist', () => {
    // 白名单而非黑名单：黑名单永远漏协议，白名单默认拒绝。
    expect(mainCjs).toContain('OPEN_EXTERNAL_ALLOWED_PROTOCOLS');
    expect(mainCjs).toMatch(/OPEN_EXTERNAL_ALLOWED_PROTOCOLS\s*=\s*new Set\(\[\s*'http:'\s*,\s*'https:'\s*\]\)/);

    // shell.openExternal 只能收到解析过、校验过的 URL。
    expect(mainCjs).toMatch(/await shell\.openExternal\(parsed\.toString\(\)\)/);
    expect(mainCjs).not.toMatch(/await shell\.openExternal\(url\.trim\(\)\)/);
  });
});

describe('main.cjs ipc source gates', () => {
  // 每个条目：会把凭据或内嵌 API 能力交给渲染进程、且 handler 仍在 main.cjs 里的通道。
  const gatedChannels = [
    // 回包里带明文 token + 完整 URL；同组其余三个 handler 都校验了来源，只有它漏过。
    'obs-browser-source-get-status',
    // 本地 HTTP 桥：把 renderer 给的 operation 直接透传给内嵌酷狗 API。
    'kugou-api-status',
    'kugou-api-request',
  ];

  for (const channel of gatedChannels) {
    it(`checks the sender on ${channel}`, () => {
      const handler = mainCjs.match(new RegExp(`ipcMain\\.handle\\('${channel}'[\\s\\S]{0,700}?\\}\\);`));
      expect(handler, `no handler found for ${channel}`).not.toBeNull();
      expect(handler?.[0]).toMatch(/isTrustedMainWindowContents\(event\.sender\)|isFirstPartyWindowContents\(event\)/);
    });
  }
});

describe('loginBackendIpc.cjs ipc source gates', () => {
  // 这两道是内嵌后端的本地 HTTP 桥入口：报出监听端口/状态，渲染进程拿到端口就能绕过 preload 直连。
  const gatedChannels = ['get-qq-port', 'get-qq-api-status'];

  for (const channel of gatedChannels) {
    it(`checks the sender on ${channel}`, () => {
      const handler = loginBackendIpcCjs.match(new RegExp(`ipcMain\\.handle\\('${channel}'[^\\n]*`));
      expect(handler, `no handler found for ${channel}`).not.toBeNull();
      expect(handler?.[0]).toMatch(/isTrustedSender\?\.\(event\)/);
    });
  }

  it('wires the first-party predicate through from main.cjs', () => {
    // 判据必须真的从 main.cjs 注进来：没人传时 isTrustedSender 是 undefined，两道 handler
    // 恒回 null——功能会静默坏掉，这道静态防线要能立刻把它照出来。
    expect(mainCjs).toMatch(/registerLoginBackendIpc\(\{[\s\S]{0,300}?isTrustedSender:\s*isFirstPartyWindowContents/);
    expect(mainCjs).toContain('const isFirstPartyWindowContents = (event)');
  });
});
