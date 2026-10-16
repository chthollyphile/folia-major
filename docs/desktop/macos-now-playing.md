# macOS：用 Music.app / Apple Music 驱动 Folia 歌词舞台

桌面版在 macOS 上选择 **舞台模式 → Now Playing** 后，会在应用内启动 Music.app 桥接，无需再单独运行 `tools/macos-nowplaying`。协议仍是：

```text
ws://localhost:9863/api/ws/lyric
```

上游常用的 [Now Playing](https://github.com/Widdit/now-playing-service/) / [Nexus PlayerCap](https://github.com/VTB-LINK/Metabox-Nexus-PlayerCap) 中间件目前以 Windows 为主。macOS 可用本仓库自带的兼容桥接：

```text
tools/macos-nowplaying
```

它不把 Apple Music 做成 Folia 内嵌音源，只做 Folia 已支持的 Now Playing 协议，让 **Music.app 出声、Folia 出歌词特效**。

## 快速开始

```bash
cd tools/macos-nowplaying
npm install
npm start
```

然后在 Folia：

1. **设置 → 选项 → 连接与集成**
2. 开启 **舞台模式**
3. 来源选择 **Now Playing**
4. 用 Music.app 播放歌曲，打开 Folia 舞台 / 可视化页

健康检查：

```bash
curl http://127.0.0.1:9863/health
curl http://127.0.0.1:9863/api/query/progress
```

### 歌词比歌曲快 / 慢

桥接默认带 `350ms` 延迟（`FOLIA_NP_OFFSET_MS`），并实现 Folia 的 `/api/query/progress` 校正。

- 歌词仍偏快：`FOLIA_NP_OFFSET_MS=700 npm start`（可再加大）
- 歌词偏慢：`FOLIA_NP_OFFSET_MS=0 npm start` 或负值如 `-200`
- 画面卡顿：已用常驻 Music 监视进程 + 降低进度推送频率；仍卡时可 `FOLIA_NP_PROGRESS_PUSH_MS=2000 npm start`
- 也可在 Folia **设置 → 播放控制 → 全局时间偏移** 微调
- 内存：无 Folia 连接时会自动停掉 Music 监视进程；可用 `curl http://127.0.0.1:9863/health` 查看 `memory.rssMb` / `memory.monitor`

首次运行时，系统可能提示允许终端 / Node 控制「音乐」应用，请允许。

## 协议事件

桥接服务向 Folia 发送与现有客户端一致的事件：

| event | 含义 |
| --- | --- |
| `Track` | 当前曲目元数据 |
| `Lyric` | LRC / 翻译 / 逐字歌词载荷 |
| `PlayerPauseState` | 播放 / 暂停与粗进度 |
| `PlayerProgress` | 毫秒级进度 |
| `PlayerProgressReplay` | 切歌或进度重置 |

歌词默认从 [lrclib.net](https://lrclib.net) 匹配；匹配失败时仍会推送曲目与进度，只是可能没有逐行动画。

更完整的说明见 [`tools/macos-nowplaying/README.md`](../../tools/macos-nowplaying/README.md)。
