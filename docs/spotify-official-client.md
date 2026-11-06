# Spotify：用官方客户端播放

免费账号用不了 Folia 的标准播放方式（librespot）：Spotify 不给它发音频密钥，播放时提示账号无法播放。Soloist 也要 Premium 账号生成 API 密钥。免费账号能放歌的只有 Spotify 自己的应用，所以这种方式让 **Spotify 桌面版**出声，Folia 控制它，并跟着它的进度显示歌词。歌单、歌词和搜索三种方式都一样。

只在 Windows 上验证过。其他系统不提供这个选项。

## 三种方式怎么选

| 方式 | 谁出声 | 适合 | 需要 |
| --- | --- | --- | --- |
| 标准播放 | Folia 自己 | Premium 且能拿到音频密钥的账号 | 无 |
| Soloist 播放 | Spotify 的 Soloist 程序 | 拿不到密钥的 Premium 账号 | 下载 Soloist、Premium 账号生成的 API 密钥、在 Spotify 应用里配对 |
| 官方客户端播放 | Spotify 桌面版 | **免费账号**；不想配置 Soloist 的账号 | 装好 Spotify 桌面版（Windows） |

能用标准播放就用标准播放：只有它的声音经过 Folia，均衡器、Automix、跟着音频跳动的效果和视频导出才有用。

入口和 Soloist 一样：

- 登录窗口里选"官方客户端播放"（Windows 上才有这一项）；
- 登录窗口账号那一页的"播放设置"，命令面板里的"平台播放设置"；
- 登录后"检查能否播放"没通过时，提示里除了"改用 Soloist 播放"，也给"改用官方客户端播放"；免费账号只给后者。

选择保存在主进程（`SPOTIFY_PLAYBACK_V1` 的 `client`），三种方式互不影响，随时能换。

## 它怎么工作

- Folia 用本机调试端口启动 Spotify：`--remote-debugging-port=9283`，只监听 `127.0.0.1`。微软商店版要通过它的 App Execution Alias 启动，直接启动 exe 会被拒绝。
- Folia 通过这个端口找到 Spotify 页面里的播放器，调用它的播放、暂停、跳转、音量和队列。调试端口连不上时，退到 Windows 的系统媒体会话（SMTC），只能暂停、继续和跳转，精度较低，界面会提示一次。
- 队列归 Folia。当前歌后面的两首会提前放进 Spotify 自己的队列，衔接时不留空隙。
- 调试端口能控制 Spotify 页面，所以只绑定本机回环地址，也只在这种方式开着时才会用。

## 功能

进度、播放/暂停、切歌、循环、随机、打乱、歌单播放与编辑、音量（含静音）、插队、喜欢，都由 Folia 的队列和控件完成。另外：

- **广告**：免费账号在歌与歌之间会有广告。广告期间 Folia 把 Spotify 静音并显示"广告"，歌曲时钟停住、不读歌词；广告结束恢复原音量。广告本身跳不过，只能静音。
- **媒体键**：外部播放期间，Folia 接管系统的上一首/播放暂停/下一首，走 Folia 的队列，不会让 Spotify 在它自己的队列里往下走。
- **在 Spotify 里手动切歌**：在 Spotify 窗口里点上一首/下一首，Folia 会拉回自己的队列：往前走就是 Folia 的下一首，往回走就是 Folia 的上一首，队首时从头重放当前这首。
- **手动关了 Spotify**：之后点播放，Folia 重新拉起它，并从原来的进度继续。自动续播和暂停永远不会拉起 Spotify。
- **每次运行最多强杀 1 次**：Spotify 已在运行但没带调试端口时，Folia 要关掉再带端口启动，这一次只允许一次；用完后只走媒体会话，直到下次启动 Folia。
- **拉起时隐藏到托盘**：用 `--minimized` 启动，并且只对这一次启动出来的窗口隐藏，不碰你自己开着的其他 Spotify 窗口。
- **两个开关**（设置里的集成页，也在命令面板里，默认都关）：
  - 打开 Folia 时唤起外部播放器（只在官方客户端播放开着时生效）；
  - Folia 退出时关闭它启动的 Spotify，或带着 Folia 的调试端口运行的 Spotify。

## 找不到 Spotify 桌面版时

这种方式开着、而电脑上没装 Spotify 桌面版时，播放会失败，并打开"播放设置"清单：清单里写明没找到，也给"改回标准播放"和"改用 Soloist 播放"。**不会**悄悄退回 Folia 自己播放：免费账号用它必然失败，悄悄退回只会换来一条看不懂的错误。装好 Spotify 桌面版后再点播放即可，不用重启 Folia。

## 限制

- **只验证了 Windows**：Windows 11、微软商店版 Spotify 1.3.6、免费账号。其他版本和安装方式没有测。
- **声音不经过 Folia**：均衡器、音效、ReplayGain、Automix 和跟着音频跳动的效果都不处理它，视频导出也不可用。
- **广告只能静音**。
- **Spotify 的页面结构会变**：播放器是在页面的 React 树里找到的，Spotify 改版后可能找不到，这时会退到媒体会话，精度降低。

## 实现

- 主进程：`electron/spotify/officialClient.cjs`（启动、调试端口连接、播放器调用、广告静音、媒体会话）、`mediaKeys.cjs`（外部播放期间接管媒体键）、`spotifyApiBridge.cjs`（`playback_mode`、`client_*` 操作、退出时关闭）。
- 页面：`src/services/onlineMusic/spotify/spotifyClientPlayback.ts`（外部播放路由的实现），`spotifyExternalPlayback.ts`（按当前方式在 Soloist 和官方客户端之间分派），`spotifySetup.ts`（配置清单）。
- 公共部分：`externalPlayback.ts` 里的 `skipped`（播放器被它自己的控件换了歌）、广告和降级状态，`externalPlayerWake.ts`（启动时唤起）。
