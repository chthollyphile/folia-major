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

- **媒体键**：这种方式开着、Folia 在运行时，媒体键一直由 Folia 接管，上一首/播放暂停/下一首都走 Folia 的队列，不会让 Spotify 在它自己的队列里往下走；只在换回标准/Soloist 方式或退出 Folia 时还给系统。接管范围只限这种方式：Soloist 和 Apple Music 的媒体键还是上游本来的行为（走 `useMediaSessionBridge` 的媒体会话）。按键在各种状态下都由 Folia 处理：
  - **外部播放停了**（手动停、失败中止）：按播放=用户主动操作，重新唤起 Spotify 并从停下时的歌曲与进度继续（沿用"拉起、最多强杀 1 次、拉起时进托盘"的规则）；上一首/下一首照常走 Folia 的队列。
  - **队列放完**（最后一首结束、没有下一首）：按播放或下一首=从当前队列第一首重新开始（随机是队列本身的顺序，循环在队尾结束的情形已经不存在）；上一首=重放刚放完的最后一首。
  - **离开外部路由**（在放本地歌、Navidrome 或其他平台的歌，Folia 自己出声）：按键照常控制 Folia——播放/暂停当前歌、Folia 队列的上一首/下一首。
  一直不放手是实测的结论：Spotify 客户端自己注册了一个系统媒体会话，而且这会话常驻——暂停时 Windows 的当前会话仍是 Spotify（`GlobalSystemMediaTransportControlsSessionManager.GetCurrentSession()` 是 `SpotifyAB.SpotifyMusic…!Spotify`，状态 Paused），队列放完、Folia 自己出声、Spotify 停下时也都还在。只要 Folia 一释放，系统就把按键交给这个会话，Spotify 会自己恢复、并在它自己的队列里往下走，绕过 Folia。
- **在 Spotify 里手动切歌**：在 Spotify 窗口里点上一首/下一首，Folia 会拉回自己的队列：往前走就是 Folia 的下一首，往回走就是 Folia 的上一首，队首时从头重放当前这首。
- **手动关了 Spotify**：之后点播放，Folia 重新拉起它，并从原来的进度继续。自动续播和暂停永远不会拉起 Spotify。
- **自动续播失败时**：只有"连不上 Spotify"（客户端被关掉、调试端口没有回应、请求没送到）才停在这首、提示"连不上 Spotify"；这首歌本身放不了（Spotify 不给它加载）或者电脑上没装客户端，还是走原来的失败流程：说出真正的原因，并按"无法播放时自动跳过"的设置在倒数后跳过。
- **每次运行最多强杀 1 次**：Spotify 已在运行但没带调试端口时，Folia 要关掉再带端口启动，这一次只允许一次；用完后只走媒体会话，直到下次启动 Folia。
- **拉起时不出现窗口**：Folia 启动 Spotify 之前先起一个隐藏的监视进程（`SetWinEventHook` 抓 `EVENT_OBJECT_SHOW`，再加 20ms 轮询兜住创建即可见的窗口），窗口一被显示就在同一帧用 `ShowWindow` 隐藏——实测（5ms 采样，三次冷启动）窗口一次都没被采样到，最差一次 ≤15ms；旧做法是页面就绪时才隐藏，同一次实测里可见约 1.5s。同时仍带 `--minimized`、仍对 STARTUPINFO 要 SW_HIDE：商店版两者都忽略（实测），所以真正起作用的是监视进程。只对这次启动出来的进程生效（启动前已存在的 PID 一律跳过），你自己开着的 Spotify 窗口不会被隐藏；监视进程随这次启动结束一起退出，之后从托盘点开一切照常。万一监视进程没起来，页面就绪时还会再扫一次同样的 SW_HIDE 兜底。
- **三个开关**（设置里的集成页「连接与集成」，也在命令面板里；都和这种方式一样只在 Windows 上出现）：
  - 打开 Folia 时唤起外部播放器（只在官方客户端播放开着时生效，默认关）；
  - Folia 退出时关闭**本次运行里它自己拉起的那个 Spotify**（默认关）：拉起它之后把这组进程的 PID 记下来（Spotify 是多进程，主窗口、渲染、GPU 都是 `Spotify.exe`），退出时先按这些 PID 正常关闭（`taskkill` 不带 `/F`、带 `/T`，等于给这些进程的窗口发关闭消息），这些 PID 还在就对同一组 PID 强制结束（`/F`）。记录之外的 Spotify 进程一个都不碰：启动 Folia 之前就已在运行的、Folia 运行期间你自己关掉又自己重开的（新进程不在记录里），都不关。窗口收在托盘时关闭消息可能只是又一次隐藏，所以关没关以 PID 为准，不看窗口；
  - **使用官方客户端时始终接管媒体键**（默认开）：按上面那条媒体键规则一直占着；关掉时回到这一版之前的规则——只在 Spotify 正放着 Folia 的歌（含暂停）时占着，队列放完、离开外部路由、外部播放停下就还给系统。占着期间浏览器等其它程序收不到媒体键。

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
| 媒体键不越界 | 切到 Soloist 或 Apple Music 播放，媒体键应当回到上游行为（不再由 Folia 接管）；关掉"始终接管媒体键"后，队列放完/离开外部路由/外部播放停下时也应该还给系统 | 待补 |
| 媒体键在三种状态下（始终接管开着） | 队列放完按播放/下一首=从第一首重新开始、上一首=重放最后一首；在放本地歌时按键控制 Folia；Spotify 停下后按播放=重新唤起并从停下处继续 | 待补 |
| 同一次按键只跑一次 | 占着时按一次键只应该有一次响应（`globalShortcut` 与 Folia 自己的媒体会话不应各跑一遍） | 待补 |
| 自动续播的三类失败 | 正常续播；手动退出 Spotify 后续播（应停在这首并提示连不上）；播放一首放不了的歌（应走原来的失败流程与跳过倒计时） | 待补 |
| 退出时关闭 Spotify | 打开"Folia 退出时关闭它启动的 Spotify"：先自己开着 Spotify 再启动 Folia，退出时它应当**不关**；让 Folia 自己拉起 Spotify 后退出，只关 Folia 拉起的那一组（先正常关闭，超时才强制），你自己另开的那份不动；中途取消退出后再退出一次，Spotify 只关一次且第二次退出仍会走关闭流程 | 待补 |

## 实现

- 主进程：`electron/spotify/officialClient.cjs`（启动、调试端口与端口发现、播放器调用、媒体会话）、`spotifyApiBridge.cjs`（`playback_mode`、`client_*` 操作、退出时关闭）、`../quitShutdown.cjs`（哪一次退出去问各个 bridge 关闭）。**媒体键是通用的**，不在这个目录里：`electron/mediaKeys.cjs`（与 `quitShutdown.cjs` 同级）只管在 `globalShortcut` 上占住三个键并把手势交给渲染进程；要不要占、按键做什么由下面这条通用 bridge 决定。
- 页面：`src/services/onlineMusic/spotify/spotifyClientPlayback.ts`（外部播放路由的实现），`spotifyExternalPlayback.ts`（按当前方式在 Soloist 和官方客户端之间分派，并声明"这种方式要一直占着媒体键"），`spotifySetup.ts`（配置清单）。
- 公共部分：`src/components/app/playback/bridges/useMediaKeyTakeoverBridge.ts`（通用的媒体键接管：问 omni 要不要占、按一次键跑播放暂停/上一首/下一首、队列放完时重新开始、外部停了之后重新唤起都在这里，路由无关），`externalPlayback.ts` 里的 `skipped`（播放器被它自己的控件换了歌）和降级状态，`externalPlayerWake.ts`（启动时唤起）。
- 平台只声明、通用层不认平台：`OnlineExternalPlaybackProvider` 的 `holdsMediaKeys`（它的会话在放时占着）和 `holdsMediaKeysWhileRunning`（它的程序在跑就一直占着）由 `spotifyExternalPlayback.ts` 按当前方式回答，omni 汇总成 `wantsMediaKeyTakeoverWhileRunning()`。
