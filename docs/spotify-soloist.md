# Spotify：用 Soloist 播放

有些 Spotify 账号，Spotify 不给发音频密钥（播放时提示"此 Spotify 账号无法播放"，日志里是 `audio key unavailable … AesKey`，见 #754）。这种账号用 Folia 的标准播放方式（librespot）放不了，可以改用 Spotify 官方的 Soloist 程序播放。歌单、歌词和搜索两种方式都一样。

Soloist 只是备用方式。标准方式能放的账号不需要它。

## 两种方式怎么选

登录窗口里 Spotify 有两种登录方式，两种都在浏览器里授权：

- **标准播放**：歌曲由 Folia 自己播放。登录后窗口会多走一步"检查能否播放"：拿账号最近喜欢的几首歌向 Spotify 要一次密钥，不下载音频。拿不到密钥，窗口停在说明上，提供"改用 Soloist 播放"。
- **Soloist 播放**：登录后直接进入 Soloist 的配置清单。

登录之后也能换方式：

- 登录窗口账号那一页的"播放设置"；
- 命令面板里的"平台播放设置"；
- 播放失败提示上的"播放设置"按钮。

## Soloist 的配置

清单有三步，做完一步打一个勾：

1. **Soloist 程序**：从 [Spotify 官方下载页](https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates) 下载适合这台电脑的构建，解压后在清单里选择 `soloist`（Windows 上是 `soloist.exe`）。Spotify 不许别人转发这个程序，所以 Folia 不附带它。
2. **API 密钥**：用 Premium 账号打开 [Spotify 开发者控制台](https://developer.spotify.com/dashboard)，生成 Soloist 的 API 密钥，填进清单。
3. **配对设备**：在同一局域网里的 Spotify 应用（手机或电脑）上打开设备列表，选择 **Folia**。只需要做一次，之后会自动登录。

清单开着时每隔两秒刷新一次。配对是在别的应用里完成的，刷新后这一步会自己打勾。

## 有效期

每个 Soloist 构建从构建日起 90 天后拒绝启动。清单显示版本、到期日和剩余天数，剩 14 天开始提醒。到期后下载新版、解压，在清单里重新选择即可。重新选择不会丢掉已保存的密钥和配对。

## 限制

- **密钥会出现在进程列表里**：Soloist 只能从命令行（`-k`）接收密钥，没有环境变量或密钥文件的选项。它运行时，这台电脑上的其他用户能在进程列表里看到它。密钥本身用系统钥匙串加密保存，不会发给页面。Linux 上钥匙串后端是 `basic_text` 时不保存密钥。
- **声音不经过 Folia**：Soloist 自己把声音送到系统输出。Folia 的均衡器、音效、ReplayGain、Automix 和跟着音频跳动的效果都不处理它，视频导出也不可用。音量滑杆会同步到 Soloist。
- **只有这些平台有构建**：Linux x86_64 / arm64 / armv7、macOS Apple Silicon、Windows x86_64。
- **配对的账号可能和登录的不同**：配对是在 Spotify 应用里选设备，Soloist 用的是选它的那个账号，Folia 没法核对两者是不是同一个。
- **结束判断**：Soloist 没有"一首歌放完"的事件，放完还可能自己续播推荐歌曲。Folia 按播放位置判断：离结尾 2.5 秒内停下或换了歌，就算这首放完，并立即暂停 Soloist 自己的下一首，由 Folia 的队列决定下一首放什么。

## 实现

- 主进程：`electron/spotify/soloist.cjs`（启动、控制连接、播放、结束判断）、`soloistBuild.cjs`（读构建版本和有效期）、`spotifyApiBridge.cjs`（`playback_mode`、`audio_probe`、`soloist_*` 操作）。
- 页面：`src/services/onlineMusic/spotify/spotifySoloistPlayback.ts`（外部播放路由的实现）、`spotifySetup.ts`（配置清单）。
- 登录窗口的"检查"和"配置清单"是通用契约（`OnlineAuthProvider.checkAfterLogin` / `getSetup` / `runSetupAction`），登录窗口里不写平台名。

思路参考了 PR #1078 和 [Duckey86/folia-major-spotify-aeskey-fix](https://github.com/Duckey86/folia-major-spotify-aeskey-fix)，代码重写。
