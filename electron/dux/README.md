# electron/dux

Linux 桌面版跟随 Dux Shell（DMS）当前播放器的本机桥。面向用户的说明在 [`docs/dux-now-playing.md`](../../docs/dux-now-playing.md)。

```text
nowPlayingBridge.cjs   编排：活动播放器 → 曲目/封面 → 歌词 → 协议广播
mprisClient.cjs        会话总线上的 MPRIS 读取（轮询 + 信号）、播放器挑选
dmsLyricsClient.cjs    Dux 的 lyrics.get（Unix socket，先 capabilities 后 JSON 行）
titleResolver.cjs      翻译标题 → iTunes 日本区目录里的原名（Dux 查不到时再试）
qrcLyrics.cjs          Dux synced 行 → QRC / LRC
progressClock.cjs      没有 Position 的播放器的位置外推
artwork.cjs            artUrl → 图片字节（file/http/data，只认图片）
nowPlayingServer.cjs   127.0.0.1:9863：WS 事件、进度 JSON、封面代理
```

## 生命周期

主进程只在渲染端报告 `stageSource === 'now-playing'` 后调用 `duxNowPlaying.enable()`（`dux-now-playing-enable`）。桥绑定 9863 失败（已有 now-playing 服务）时只记一条日志，不影响应用。`will-quit` 时关掉。

## 协议

- `GET /api/ws/lyric`：`Track`（`author` 是艺人）、`Lyric`、`PlayerPauseState`、`PlayerProgress`、`PlayerProgressReplay`；新客户端连上先收当前快照。
- `GET /api/query/progress`：`{ "progress": <毫秒> }`。
- `GET /art/<sha1 前 32 位>`：`image/*` 字节。

## 共用

`titleResolver.cjs` 只在 Dux 第一次查不到歌词、且当前播放器 identity 是 Apple Music 时访问 iTunes Search API，只发标题、艺人、专辑；只有找到的候选才缓存。

`mprisClient.cjs` 用 `electron/hifi/mpris/` 里的 `dbusWire.cjs` / `dbusConnection.cjs`（会话总线的线上格式和连接），
不另写一份。它们是通用的 D-Bus 原语，挪到共用目录是另一次重构，这次不动 HiFi 那边的路径。

## 安全

- 只监听 `127.0.0.1`；WebSocket 只读，不接收应用消息。
- 封面代理只读播放器给的 URL，只发图片魔数匹配的内容，有大小上限；URL 不写日志（可能带凭据）。
- Dux 请求只读 `lyrics.get`，不写设置、不执行命令。

## 测试

`test/unit/dux/`：候选播放器挑选、MPRIS 值解码、QRC/LRC 转换、Dux socket 往返、进度外推、WebSocket 帧与 HTTP 路由。运行：

```bash
npm run test:unit -- test/unit/dux
```
