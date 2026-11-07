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

- Folia 用本机调试端口启动 Spotify：`--remote-debugging-port=0`，让 Spotify 自己挑一个空闲端口，只监听 `127.0.0.1`。端口每次启动都不同，Folia 这样找出它：先读 Spotify 写在自己配置目录里的 `DevToolsActivePort`（商店版在 `%LOCALAPPDATA%\Packages\SpotifyAB.SpotifyMusic_zpdnekdrzrea0\LocalCache\Spotify\`，安装版在 `%APPDATA%\Spotify\`），再扫本机回环地址上的监听端口，逐个问 `/json/version` 是不是 Spotify 自己；都找不到时才试以前的固定端口 9283。找出来的端口只连 `127.0.0.1`，并且一定要回显自己是 Spotify（另一个程序占着端口时不会被当成它）。微软商店版要通过它的 App Execution Alias 启动，直接启动 exe 会被拒绝。
- Folia 通过这个端口找到 Spotify 页面里的播放器，调用它的播放、暂停、跳转、音量和队列。调试端口连不上时，退到 Windows 的系统媒体会话（SMTC），只能暂停、继续和跳转，精度较低，界面会提示一次。
- 队列归 Folia。当前歌后面的两首会提前放进 Spotify 自己的队列，衔接时不留空隙。
- 调试端口能控制 Spotify 页面，所以只绑定本机回环地址，也只在这种方式开着时才会用。端口随机只是让别的程序没法事先猜到它：**本机上任何进程都能连上这个调试端口，进而控制已登录的 Spotify。**

## 功能

进度、播放/暂停、切歌、循环、随机、打乱、歌单播放与编辑、音量（含静音）、插队、喜欢，都由 Folia 的队列和控件完成。另外：

- **媒体键**：这种方式放歌期间，Folia 接管系统的上一首/播放暂停/下一首，走 Folia 的队列，不会让 Spotify 在它自己的队列里往下走。接管范围只限这种方式：Soloist 和 Apple Music 的媒体键还是上游本来的行为（走 `useMediaSessionBridge` 的媒体会话）。接管从这首在 Spotify 里开始，一直持续到它结束（暂停时也不放手），外部播放停了、离开外部播放、队列放完或换回别的方式才还给系统。暂停时不放手是实测的结论：Spotify 客户端自己注册了一个系统媒体会话，暂停时 Windows 的当前会话仍是 Spotify（`GlobalSystemMediaTransportControlsSessionManager.GetCurrentSession()` 是 `SpotifyAB.SpotifyMusic…!Spotify`，状态 Paused），这时把播放键还回去，系统会直接交给 Spotify 自己恢复、切歌也走它自己的队列，绕过 Folia。
- **在 Spotify 里手动切歌**：在 Spotify 窗口里点上一首/下一首，Folia 会拉回自己的队列：往前走就是 Folia 的下一首，往回走就是 Folia 的上一首，队首时从头重放当前这首。
- **手动关了 Spotify**：之后点播放，Folia 重新拉起它，并从原来的进度继续。自动续播和暂停永远不会拉起 Spotify。
- **自动续播失败时**：只有"连不上 Spotify"（客户端被关掉、调试端口没有回应、请求没送到）才停在这首、提示"连不上 Spotify"；这首歌本身放不了（Spotify 不给它加载）或者电脑上没装客户端，还是走原来的失败流程：说出真正的原因，并按"无法播放时自动跳过"的设置在倒数后跳过。
- **每次运行最多强杀 1 次**：Spotify 已在运行但没带调试端口时，Folia 要关掉再带端口启动，这一次只允许一次；用完后只走媒体会话，直到下次启动 Folia。
- **拉起时隐藏到托盘**：用 `--minimized` 启动，并且只对这一次启动出来的窗口隐藏，不碰你自己开着的其他 Spotify 窗口。
- **两个开关**（设置里的集成页，也在命令面板里，默认都关）：
  - 打开 Folia 时唤起外部播放器（只在官方客户端播放开着时生效）；
  - Folia 退出时关闭它启动的 Spotify，或带着 Folia 的调试端口运行的 Spotify。

## 找不到 Spotify 桌面版时

这种方式开着、而电脑上没装 Spotify 桌面版时，播放会失败，并打开"播放设置"清单：清单里写明没找到，也给"改回标准播放"和"改用 Soloist 播放"。**不会**悄悄退回 Folia 自己播放：免费账号用它必然失败，悄悄退回只会换来一条看不懂的错误。装好 Spotify 桌面版后再点播放即可，不用重启 Folia。

## 风险

- **非官方方式，账号风险自负**：这种方式控制的是 Spotify 自己的客户端（走它的调试端口和页面内部的播放器），不在 Spotify 的公开 API 里。Spotify 改版会让它失效；用它是否违反 Spotify 的使用条款、会不会影响账号，由用的人自己判断和承担。Folia 不做任何绕过付费、屏蔽广告或改动账号数据的事。
- **调试端口对本机程序开放，对网页不开放**：端口只绑 `127.0.0.1`，而且从来不把任何来源写进 `--remote-allow-origins`（端口是 Spotify 自己挑的，没有能写进去的来源）；Folia 自己的调试客户端不发 `Origin` 头，所以正常可用。浏览器里的网页一定会带 `Origin`，Chromium 会直接拒绝这种连接——网页扫到端口也连不上。但**本机上不带 Origin 的普通进程仍然可以连上这个端口，进而控制当前已登录的 Spotify**，这一点没有鉴权；端口每次启动随机（见上面"它怎么工作"）只是让这类程序没法事先写好端口号。不用这种方式播放时不会开这个端口。

## 限制

- **只验证了 Windows**：Windows 11、微软商店版 Spotify 1.3.6、免费账号。其他版本和安装方式没有测。
- **调试端口的发现依赖 Spotify 自己的行为**：随机端口靠 Spotify 的 CEF 写出的 `DevToolsActivePort`，或者它在本机回环地址上开的监听端口。两者都读不到时会退到固定端口 9283；如果哪个版本连这两样都不给，这种方式就连不上 Spotify 页面，只能靠系统媒体会话粗放地暂停和继续。这一条要在真机上确认（见下）。
- **声音不经过 Folia**：均衡器、音效、ReplayGain、Automix 和跟着音频跳动的效果都不处理它，视频导出也不可用。
- **广告照常播放**：免费账号在歌与歌之间会有广告。Folia 不做任何屏蔽或静音（Spotify 的条款禁止屏蔽广告），音量也不动。Folia 只是认得出它是广告，所以它既不会被当成当前这首的结束，也不会被当成你在 Spotify 窗口里切了歌：队列和进度都停在这首上。
- **起播时的片头广告**：免费账号点歌时常常先放一段广告，再放点的那首。等起播时广告的时间不算在 5 秒的等待里（整段等待最多 60 秒），广告结束后点的那首出现就算起播成功；广告长到 60 秒还没结束时，这次起播按"已接受、广告中"交给状态轮询接着跟，既不报成这首放不了，也不会触发"无法播放时自动跳过"。
- **Spotify 的页面结构会变**：播放器是在页面的 React 树里找到的，Spotify 改版后可能找不到，这时会退到媒体会话，精度降低。

## 真机复测（待补）

改完这一版之后要在真机上按下面几项过一遍，结果填在这里（合并前至少要有免费账号那一段）：

| 项 | 怎么测 | 结果 |
| --- | --- | --- |
| 随机调试端口 | 用这种方式放一首，看日志里 `[SpotifyClient] Spotify's DevTools port is …` 报出的端口是否每次不同、是否读自 `DevToolsActivePort` 或监听端口扫描 | 待补 |
| 免费账号片头广告 | 免费账号点一首平时会先出广告的歌：广告期间不报"无法播放"、不触发自动跳过，广告结束后正常起播 | 待补 |
| 暂停时的媒体键 | 暂停后按键盘播放键 / 任务栏媒体控件：应当由 Folia 恢复，而不是 Spotify 自己恢复 | 待补 |
| 媒体键不越界 | 切到 Soloist 或 Apple Music 播放，媒体键应当回到上游行为（不再由 Folia 接管） | 待补 |
| 自动续播的三类失败 | 正常续播；手动退出 Spotify 后续播（应停在这首并提示连不上）；播放一首放不了的歌（应走原来的失败流程与跳过倒计时） | 待补 |
| 退出时关闭 Spotify | 打开"Folia 退出时关闭它启动的 Spotify"，退出一次（中途取消后再退出一次），Spotify 只关一次且第二次退出仍会走关闭流程 | 待补 |

## 实现

- 主进程：`electron/spotify/officialClient.cjs`（启动、调试端口与端口发现、播放器调用、媒体会话）、`mediaKeys.cjs`（只服务这种方式：它放歌期间接管媒体键）、`spotifyApiBridge.cjs`（`playback_mode`、`client_*` 操作、退出时关闭）、`../quitShutdown.cjs`（哪一次退出去问各个 bridge 关闭）。
- 页面：`src/services/onlineMusic/spotify/spotifyClientPlayback.ts`（外部播放路由的实现），`spotifyExternalPlayback.ts`（按当前方式在 Soloist 和官方客户端之间分派），`spotifySetup.ts`（配置清单）。
- 公共部分：`externalPlayback.ts` 里的 `skipped`（播放器被它自己的控件换了歌）和降级状态，`externalPlayerWake.ts`（启动时唤起）。
