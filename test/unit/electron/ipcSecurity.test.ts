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

const rootDir = path.resolve(__dirname, '../../../');
const mainCjs = readFileSync(path.join(rootDir, 'electron/main.cjs'), 'utf8');

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
  // 每个条目：会把凭据或内嵌 API 能力交给渲染进程的通道。
  const gatedChannels = [
    // 回包里带明文 token + 完整 URL；同组其余三个 handler 都校验了来源，只有它漏过。
    'obs-browser-source-get-status',
    // 本地 HTTP 桥：报内嵌后端端口/状态，以及把 renderer 的 operation 透传给内嵌 API。
    'get-qq-port',
    'get-qq-api-status',
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
