# Dux 舞台来源

Linux 桌面版的舞台模式里，**Dux** 是一个独立的来源：Dux Shell 里正在放什么，Folia 的舞台就显示什么；歌词来自 Dux 自己的歌词引擎（含逐字时间），封面来自这条播放器的 MPRIS 元数据。播放、暂停、切歌仍然由 Dux 控制，Folia 只负责显示。

它和 **Now Playing** 来源互不影响：Now Playing 仍然连接本机的 Now Playing 软件（`127.0.0.1:9863`），Dux 用自己的本机端口 `127.0.0.1:9864`，只在来源选成 Dux 时才启动。

## 用法

1. 桌面版里打开「设置 → 集成 → 舞台模式」，把来源选成 **Dux**。
2. 在首页打开 **Stage**。
3. 不需要另外启动服务；Dux 的媒体歌词开着即可。

## 它怎么工作

- Folia 主进程（`electron/dux/`）只在 Dux 来源被选中后，在 `127.0.0.1:9864` 上提供 Folia 现有远程来源已经会读的协议：`/api/ws/lyric` 的 WebSocket 事件、`/api/query/progress` 的进度 JSON，以及 `/art/<token>` 的封面。
- 播放器：每秒读一次会话总线上的 MPRIS 播放器，挑一个在放、可控制的作为 Dux 正在显示的那个；`PropertiesChanged` 和 `NameOwnerChanged` 只用来让下一次读取提前。Folia 自己的 MPRIS（包括它网页音频的 Chromium 播放器）会被排除。
- 歌词：曲目变化时，把标题、艺人、专辑、时长交给 Dux 的 `lyrics.get`（Dux 自己的 `dms-*.sock`），拿回 `synced` 行和逐字时间，转成 QRC 交给 Folia 的歌词解析器。没有逐字时间时退回 LRC；Dux 返回 `plain` 时退回纯文本。
- 翻译过的标题：Apple Music 经常把日文歌名交给 MPRIS 时换成英文/罗马字（`Spring Thief` 而不是 `春泥棒`）。Dux 找不到时，如果播放器 identity 是 Apple Music，桥再用 iTunes 日本区目录查一次原题（标题 + 艺人，查不到时只按标题），把 `trackName` / `artistName` / `collectionName` 和时长交给 Dux 再查；这一步只发标题、艺人和专辑名，其他播放器的元数据不会发出去。
- 封面：`mpris:artUrl` 可能是 `file://`（KDE Connect 的缓存）、`http(s)` 或 `data:`；Folia 的页面读不到这些来源，所以桥只把真正的图片字节转发到本机。只有看起来像图片的内容会发出去。

## 要求

- Linux，且 Dux Shell 2.x 正在运行（它的 IPC socket 在 `$XDG_RUNTIME_DIR` 下）。
- Dux 的媒体歌词开着（「媒体」页的 Lyrics 开关；歌词提供方在 Dux 设置里启用）。
- Dux 的歌词引擎没找到时，Folia 的舞台会显示曲目和封面，但没有歌词；换一首或重新打开 Dux 来源会重试。

## 行为与限制

- **跟随哪个播放器**：在放的、可控制的播放器优先；都停着时保留暂停的那个。Dux 里手动 pin 的播放器、排除列表都不会被读取，多播放器同时出声时可能与 Dux 选的不一致。Folia 自己的播放器按主进程 pid 排除。
- **歌词提供方**：请求 Dux 的 `lyrics.get` 时不带 `providers`，用 Dux 的默认顺序（Better Lyrics、Unison、LyricsPlus、KuGou、LRCLIB、YouTube Music）；在 Dux 里关掉的提供方仍可能被用到。
- **位置**：多数播放器会报 `Position`。不报的（例如 KDE Connect 代理的手机播放）从桥第一次看到这首时按 0 开始外推，所以中途打开 Folia 会对不上已播的部分。
- **没有翻译/音译**：Dux 的 `lyrics.get` 结果里没有这两项，Folia 不会另找。
- **原名回退**：iTunes 目录没有这首（地区、下架、非 Apple 曲库）时还是只能用原 metadata 查；原名回退只处理标题被翻译的情况，不会把已有歌词换成另一个版本。
- **端口 9864**：已被别的程序占用时，Dux 来源会连不上；它不会去动 Now Playing 的 9863。
- **不控制播放**：Folia 的播放键在 Dux 舞台里不会转发给 Dux；用 Dux 自己的媒体控制。
- 桥只在 Dux 来源被选中时启动，切回别的来源就停止，不会长期占着 9864。

## 调试

```bash
curl http://127.0.0.1:9864/health          # {"ok":true,"clients":n}
curl http://127.0.0.1:9864/api/query/progress
```

主进程日志里搜 `[Dux]`。曲目/歌词没出来时先确认 Dux 的「媒体」页自己能显示这首歌的歌词，再确认 `$XDG_RUNTIME_DIR/dms-*.sock` 存在。
