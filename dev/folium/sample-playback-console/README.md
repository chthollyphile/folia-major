# 播放控制台样例（sample-playback-console）

写给 Folium 1.5（桌面版）。在首页加一个「播放控制台」页面：调音量、静音和循环模式，分页浏览并点播播放队列，
列出最近放不了的歌；main 入口把这些失败记录追加写进模组自己的数据目录。Folium 1.7 起还有「把队列倒过来」（`playback.replaceQueue`）。

权限：`playback.control`（设音量、静音、循环模式，点播队列）、`playback.queue`（1.7，整表替换队列）、`filesystem.data`（main 入口的 `api.storage.paths`）。
不用实验接口，不需要账号或网络。清单声明了 1.7 的 `playback.queue`，所以要 Folium 1.7 的宿主：1.6 不认识这个权限，会整份拒绝这份清单。

## 安装

这个目录**没有签名**，开发版也**不会自动扫描** `dev/folium/`，需要手动安装（装好后在模组面板里显示为「未验证」）：

- **打 zip 拖进去**：把整个目录打成 zip，拖到模组面板上。`mod.json` 在 zip 里唯一的顶层文件夹里也可以：

  ```powershell
  Compress-Archive -Path dev/folium/sample-playback-console -DestinationPath sample-playback-console.zip
  ```

- **复制到用户模组目录**：模组面板右上角「打开模组目录」，把 `sample-playback-console` 目录复制进去，再点「重载」。
- 开发时也可以临时复制到仓库的 `mods/` 下，享受开发目录「改了文件不用重新确认」的豁免；但不要提交到那里：`mods/` 里的模组必须带官方签名，
  `test/unit/mod-system/sampleMods.test.ts` 会失败。

然后在模组面板里启用「播放控制台（样例）」并确认。

## 试用

1. 在 Grid 或 Bravais 首页的导航里选「播放控制台」，或在命令面板里运行「打开播放控制台」。
2. 拖动音量滑块、点「静音」、切换循环模式；再用宿主自己的音量面板或循环按钮改一下，页面跟着变（`playback.volumeChanged` / `loopModeChanged`）。
   松手时才调用一次 `setVolume`：宿主每次调用都会保存。
3. 播放队列每页 50 首，打开时以正在播放的歌为中心；「上一页」「下一页」翻页，「回到当前」重新居中。点一首就播放它。
   队列在这期间变了（打乱、入队、切到私人 FM）时页面自动刷新（`playback.queueChanged`）；如果点的那一刻那个位置已经换了歌，
   `playQueueItem` 带着 `ref` 会拒绝，页面提示并刷新。私人 FM 下照常点播；外部 Stage 播放时列表只能看，不能点。
4. 放一首当前账号放不了的歌（例如需要会员的），「最近无法播放」里会多一条，写明原因、阶段，以及宿主是否在倒计时跳过。
   记录同时追加到 `<userData>/mods-data/sample-playback-console/files/failures.log`（每行一个 JSON，超过 256 KB 时换到 `failures.1.log`）。
5. 在模组面板展开这个模组，能看到「数据」「缓存」的占用。点「清空缓存」会删掉 `mods-cache/sample-playback-console/recent-failures.json`；
   下次记录失败或重载模组时，main 入口从日志重建它。页面上已经显示的记录不受影响。
6. （1.7）点「把队列倒过来」：页面在同一个 `version` 下按 500 首一页读完整个队列（超过 5,000 首就提示太长），倒序后用
   `replaceQueue(songs, { expectedVersion })` 一次换上去。正在放的歌接着放，私人 FM 会结束；宿主的提示条写明是这个模组换的，点「撤销」或在
   命令面板里运行「撤销模组替换的队列」能换回来。队列卡片里显示「这是本模组的替换」，靠的是 `queueChanged` 的 `byThisMod`。
   被拒绝时按原因处理：`stale-version` 提示「队列刚变过，已刷新」并重读；`transition`（automix 过渡中）等 `queueChanged` 再试，过渡中途也会来
   `queueChanged`（下一首落进队列），那时再试又被拒 `transition` 就接着等，直到过渡结束；`stage`（外部 Stage 播放）等到 `getQueue().kind`
   不再是 `stage` 的那个 `queueChanged` 再试；`rate-limited` 等 `retryAfterMs` 再试一次；`stale-ref` 重新读一遍队列再来。过渡中点一下可以看到它在
   过渡结束后自动完成。

## 演示了哪些接口

| 接口 | 在哪 |
| --- | --- |
| `registries.homeTabs`、`ui.openHomeTab` | `client.mjs` 的 `activate`：注册页面和打开它的命令 |
| `playback.getVolume` / `setVolume` / `setMuted` | 音量卡片 |
| `playback.getLoopMode` / `setLoopMode` | 循环模式卡片 |
| `playback.getQueue({ offset, limit })` | 队列分页；不传 `offset` 时以当前歌曲为中心 |
| `playback.playQueueItem(index, ref)` | 点队列里的一首 |
| `playback.volumeChanged` / `loopModeChanged` / `queueChanged` / `failed` | 页面挂载时订阅、卸载时取消 |
| `playback.failed` 的 `priority: 'high'` 处理器 | `createFailureLog`：模组活着就记录，页面关着也记；`willAutoSkip` 只是事件发出那一刻宿主的打算 |
| `api.storage.paths.data` | `index.cjs`：追加写 `failures.log` |
| `api.storage.paths.cache` | `index.cjs`：最多 30 条的 `recent-failures.json`，清空后从日志重建 |
| `folium.rpc` / `api.rpc.handle` | `recordFailure`、`recentFailures` |
| `playback.replaceQueue(songs, { expectedVersion })`（1.7） | 「把队列倒过来」：`readWholeQueue` 按同一个 `version` 翻页读完，`reverseQueue` 按拒绝原因重试 |
| `playback.queueChanged` 的 `version` / `byThisMod`（1.7） | 队列卡片里的「这是本模组的替换」；被 `transition` / `stage` 拒绝时等事件再试，原因还在就接着等 |

`test/unit/mod-system/devFoliumSamples.test.ts` 校验清单，用真实的 `createModApi` 跑 main 入口（追加、缓存、清空后重建），
并在 jsdom 里用一个替身 `folium` 跑 client 页面。
