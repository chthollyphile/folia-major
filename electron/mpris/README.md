# MPRIS（Linux）

Stage 的 MPRIS 源：读 Linux 会话总线上别的播放器（KDE / GNOME 媒体面板里显示的那些），让 Folia 显示
系统当前正在放的那首歌。和 Now Playing、PlayerCap 一样是被动源：Folia 不放音频，只镜像曲目、播放状态和进度，
再按曲目找歌词。

## 文件

- `mprisMetadata.cjs`：纯变换。解码后的 `a{sv}` → 播放器快照（曲目、歌手、专辑、封面、时长、微秒换成秒的
  位置、`xesam:asText` 歌词），以及多播放器时挑「当前」的那个。单测在 `test/unit/mpris/`。
- `mprisReader.cjs`：轮询。每秒 `ListNames` 一次，对每个 `org.mpris.MediaPlayer2.*` 调
  `GetAll(org.mpris.MediaPlayer2.Player)`，Identity 取一次就缓存；把快照推给 `mprisSourceIpc.cjs`。
  不订阅 `PropertiesChanged`：一秒一次的轮询足够跟歌，也避开各播放器在信号上的实现差异。
- `mprisSourceIpc.cjs`：`mpris:start` / `mpris:stop`，快照走 `mpris:state`，连接状态走
  `mpris:status`；只答主窗口。
- `src/hooks/useMprisSession.ts`：渲染进程入口。位置只进 ref（每秒一次的快照不触发 App 重绘），
  曲目、歌词、播放状态变了才 setState。
- `src/services/mpris/mprisLyrics.ts`：歌词。播放器自己带时间轴歌词（`xesam:asText`）就直接解析，
  否则按标题/歌手/时长在线匹配；没有 `xesam:artist` 的（浏览器里的视频、直播）不匹配，免得搜到不相干的歌。

## 选哪个播放器

1. 正在放的优先；都暂停时取最近变化的那个。
2. 同分时按总线上次变化的时间（`activeAtMs`）比，再按总线名。
3. 排除 Folia 自己登记的 MPRIS：`org.mpris.MediaPlayer2.folia`（HiFi 路线）和
   `org.mpris.MediaPlayer2.chromium.instance<主进程 pid>`（普通路线，Chromium 自己登记的那个）。
   别的 Chromium 窗口（pid 不同）照常算作系统里的播放器。

## 限制

- 只在 Linux D-Bus 桌面环境提供；网页版没有 D-Bus，设置里不列这一项。
- 封面只收 `http(s)` 和 `data:image`；播放器给 `file://` 封面时暂不显示（要主进程读文件再交给页面）。
- 没有播放器选择器：多个播放器同时活动时按上面的规则自动挑。要固定跟某一个，得另加设置项。
- 位置按采样外推，拖进度条后最多晚一秒对上。
