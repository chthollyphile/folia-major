# 酷狗播放 Console 诊断

让用户在出现酷狗歌曲无法播放后执行：

1. 保持 Folia Electron 应用和失败歌曲现场不变。
2. 按 `F12` 打开开发者工具，切换到 Console（控制台）。
3. 全选复制 `kugou-playback-console.js` 的内容，粘贴到 Console 后回车。
4. 如果 Chromium 阻止粘贴，按控制台提示手动输入 `allow pasting`，然后重新粘贴。
5. 等待控制台显示 `Finished`，把自动下载的
   `Folia-KuGou-Diagnostic-*.json` 发给开发者。

脚本会自动使用当前 `<audio>` 的地址；如果播放器已经切歌，则回退到
Performance API 中最近一次酷狗资源请求。

## 报告内容

- Electron/Chrome、操作系统 UA、语言、时区、网络在线状态与 Network Information；
- 当前 `<audio>` 的 `MediaError`、`networkState`、`readyState`、时间、缓冲区；
- 最近 12 条酷狗 Resource Timing，包括状态码（运行时支持时）、HTTP 协议与耗时；
- Electron 酷狗 API bridge 是否可用；
- 只读调用 `user_detail` 判断服务端登录是否仍有效；
- 登录有效时只读调用 `user_vip_detail`，提取 VIP 类型、业务产品状态和到期时间；
- 对同一个音源分别执行 HTTP 与 HTTPS 的两字节 Range 请求。

## 隐私与限制

- 不导出 Cookie、token、dfid、userid、昵称、头像或响应正文；
- URL 路径会保留，所有查询参数值会替换为 `<redacted>`；
- 音频响应最多只在内存读取首个 chunk，并只记录前 16 字节的十六进制；
- Console 的 Fetch API 不能强制选择 IPv4 或 IPv6，因此报告无法独立测试两个地址族；
- `kugouRequest` 会沿用 Folia 现有 Electron bridge 行为，遇到设备验证状态时可能自动刷新
  `dfid`，但脚本不会调用领取或升级 VIP 的接口。
