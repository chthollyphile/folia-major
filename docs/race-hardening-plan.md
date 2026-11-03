# 竞态与数据一致性加固：实施计划

基点：`731cfd2`。下文行号以这个提交为准，动手前先按符号名重新定位。

来源：一次只读审查，覆盖播放请求、automix 双 deck、账户切换与队列、本地曲库与持久化、跨设备同步、Electron 主进程。审查里的关键结论都对照源码核实过，但没有跑测试复现。所以每一步都**先写能复现的测试，再修**。测试复现不出来的，在交付里写明，不硬修。

## 总体思路

- 大多数问题是同一种写法：**先拿一份状态的副本，`await`，再把副本整个写回去**。所以先修会丢数据的地方，再给这种写法换一个统一的写入方式，最后用代码扫描测试拦住这种写法再出现。
- 形式化手段按性价比排：fast-check 随机交错测试优先；只有它还压不住的协议，才写 TLA+。
- 每个阶段是一个独立的 PR。所有阶段都会碰异步时序或持久化，都不算简单修复，都按 `skills/development-workflow` 走完整流程，包括收尾时的独立审查。
- 每个 PR 都要过 `npm run typecheck` 和 `npm run test:unit`；碰主进程的，再按 `skills/run-desktop` 在真桌面版里看一遍。

## 阶段 0：先修会丢数据的地方（不需要新工具）

### 0.1 读一次失败，所有歌单被清空

**最高优先级。**

- **问题：**
  - `src/services/db.ts:201`：`getLocalSongs` 出任何错误都返回 `[]`。
  - `src/services/localPlaylistService.ts`：`getLocalPlaylists`（约 249 行起）用这个列表做 `repairPlaylistSongIds`，找不到对应歌曲的 id 全部删掉，然后 `persistPlaylists` 写回。读失败一次，所有歌单（含“我喜欢”）都会被清空并保存。
- **改法：**
  - 给歌单修复用的读取换一个能区分“读失败”和“确实没有歌”的入口。比如新加 `readLocalSongsOrThrow`，或者返回 `{ ok, songs }`。
  - 读失败时，歌单原样返回，**不修复、不写回**。
  - 别的调用方继续用 `getLocalSongs`，行为不变。
  - 顺手排查：其他“读出来是空列表就当没有数据并写回”的地方（`removeDeletedSongIdsFromPlaylists` 等）有没有同样的问题。
- **测试：** `test/unit/localLibrary/`（或现有歌单测试旁）。
  - 让 `readLocalSongs` 抛错，断言歌单内容不变、`persistPlaylists` 没有被调用。
  - 另加一条：真的删了歌以后，修复照常生效。

### 0.2 音频缓存原子写入，删除前的大小核对和删除放进同一个锁

- **问题：**
  - `electron/main.cjs:4692` 用两个并行的 `fsp.writeFile` 直接写数据和元数据，写到一半时被读取或崩溃，会得到被截断但被当作命中的缓存。
  - `electron/audioCacheRemove.cjs:18-23` 先 stat 比较大小，`await` 之后才删除，中间可能有新的完整文件写进来，结果被误删。
- **改法：**
  - 照 `electron/spotify/audioFiles.cjs:71-83` 的写法：先写 `.part`，fsync，再 rename。先 rename 数据文件，再 rename 元数据文件。
  - 读取时，用元数据里的 `size` 核对文件实际大小，对不上就当没有命中。
  - 加一个按缓存键的锁（简单的 `Map<key, Promise>` 串行链就够），保存、按大小删除、整体清理都走它。
- **测试：** `test/unit/electron/`，用临时目录。
  - 并发保存同一个键，最后数据和元数据来自同一次写入。
  - 删除和保存交错时，不会删掉新写入的完整文件。
  - 截断的数据文件不算命中。

### 0.3 缓存清理的健壮性

- 列出缓存条目时（`main.cjs` 约 4623 行），每个条目的 stat 单独 catch。一个文件在列目录和 stat 之间被删掉，不应该让整个列表变成 `[]`。
- `electron/spotify/audioFiles.cjs` 的 `remove` 要捕获错误（比如 Windows 上的 EBUSY），一个文件删不掉时跳过它，继续清理别的。
- Spotify 保留下来的文件是按 Range 从磁盘流式读取的，要像转码键一样被锁定，不参与清理（`main.cjs` 约 4663 行）。

### 0.4 网易云后端的 worker 请求加超时

- **问题：** `electron/netease/neteaseApiHost.cjs:67-72` 的待处理请求只在 worker 退出时才失败。worker 卡住但没退出时，后端一直停在“启动中”，点重启也只会拿回同一个卡住的 promise。
- **改法：**
  - 每个请求加超时，超时就 reject 并从待处理表里删掉。
  - 启动超时时清掉 `startPromise`，让重启能真正重来。
- **测试：** 用一个永不回复的假 worker，断言超时后请求被拒，重启能重新开始。

### 0.5 模组文件加载后被改动，仍然照常提供（先决定威胁模型）

- **问题：** `electron/modSystem/modProtocol.cjs:144` 每次请求都从磁盘读文件，不核对已经批准的摘要。
- **决定点（先问维护者）：** 模组目录可写算不算“已经失守”？如果算，这条只是加固，可以往后排。
- **可选改法：**
  - **A：** 加载时为每个文件记下 hash，提供文件时核对，对不上就返回 409，并把模组标成需要重新批准。
  - **B：** 加载时把模组复制到按内容寻址的只读目录，之后只从那里提供。
  - B 更干净，但对开发者正在调试的本地模组不友好。可以只对非开发模组启用。
- Node 侧在启用之后再 `require` 的辅助模块，也有同样的空档，一并处理或写进说明。

## 阶段 1：测试基础设施，先拿一个容易的目标试点

### 1.1 引入 fast-check

- 加到 devDependencies，锁定精确版本。这是依赖改动，走完整流程。
- 在 `test/helpers/` 加三样：
  - `scheduledPromise.ts`：把 `fc.scheduler()` 包成“可控的异步端口”。业务代码里的 `await x()` 通过注入的端口拿到 promise，测试决定它们按什么顺序完成。
  - `invariants.ts`：每一步之后都跑的断言工具。失败时打印 fast-check 缩小后的操作序列。
  - 假的音频元素和 deck 端口：带 `play`/`pause`/`load`，能手动触发 `playing`、`waiting`、`ended`、`timeupdate` 事件。
- `vitest.config.ts` 不需要改；属性测试的 `numRuns` 默认 100，CI 里可以用环境变量调高。

### 1.2 试点：同步服务器的分桶计数

- **问题：** `sync-server/src/app.ts` 的 `/themes/put`（约 404-470 行）在批处理之外读旧记录、算增量，再以累加方式写入。并发或重复上传会让分桶的计数和哈希永久不准。不会丢数据，但那个分桶从此每次同步都要重新扫描。
- **先写属性测试：**
  - 用内存里的 D1 替身。D1 的 `batch` 本身是原子的，替身只需要让两个请求的“读”和“批”能交错。
  - 随机生成并发和重复的上传批次，断言 manifest 和 `buildThemeBucketSummaries(实际记录)` 一致。预期很快就能跑出反例。
- **改法（二选一）：**
  - 在同一个批处理里，对涉及的分桶按实际记录重新计算摘要（`INSERT ... SELECT count(*), ...`）。不再做增量累加。
  - 再加一个修复入口，在服务器侧按记录重算所有分桶，用来修好已经错掉的数据。
- 这一条风险小、范围清楚，适合用来跑通 fast-check 的写法和团队约定。

## 阶段 2：统一“先拿副本、await、再写回”的写入方式

### 2.1 队列：每一次写入都计数，不只是模组的写入

- **问题：** `usePlaybackQueueController.ts:953-964` 只有在 `queueRewritten()` 为真时才改用最新的队列，而这个计数器（`src/services/wholeQueueWrites.ts` 的 `noteWholeQueueWrite`）只统计模组的 `replaceQueue`。用户编辑、退出账户时的 `setPlayQueue` 都不会让它变。
- **改法：**
  - 在 `usePlaybackStore` 里给队列加一个版本号，**每一次** `setPlayQueue` 都递增。也可以在 store 的 setter 里统一调用 `noteWholeQueueWrite`。
  - `playSong` 开始时记下版本号；写回时如果版本变了，就在最新队列上做“把这首歌换进它所在的位置，不在就插到当前位置后面”，不再整个写回旧副本。
  - 这件事的语义（“在等待期间被编辑过的队列，最后应该是什么样”）要先和维护者确认，写进代码注释。
- **同样处理：**
  - `restorePlaybackSource.ts:174-183` 的 `queueAfterRestore`；
  - `useSessionRestoreController.ts:160`；
  - 模组和舞台模式里所有“先读 `last_queue`、再写回”的地方（`useStagePlaybackController.ts` 约 901-921 行）。

### 2.2 退出账户之后，不再写回该平台的歌

- 恢复路径（会话恢复、窗口交接）在开始时也记下 `providerDropsSoFar`，写回前用 `keepSongsOfProvidersStanding` 过滤。`startRestore`（`currentSong.ts` 约 197 行）也要检查平台丢弃标记。
- `dropProviderSongs` 在播放器为空时，也要清理存档里该平台的会话（`createLibraryAccountPort.ts` 约 98-115 行）。
- 测试：退出账户，然后让恢复的异步操作完成，断言 store 和存档里都没有该平台的歌。

### 2.3 歌单写入串行化

- **问题：** `localPlaylistService.ts` 的增删改和收藏（`updateLocalPlaylist` 约 314 行、`setLocalSongFavorite`，以及 `localMusicService.ts:124-146` 的 `removeDeletedSongIdsFromPlaylists`）都是读、await、写，没有锁。
- **改法：**
  - 加一个 `runPlaylistMutation(fn)`。模块内用 promise 链串行；有 `navigator.locks` 时再加一个跨标签页的锁。
  - 所有写歌单的地方，包括 `getLocalPlaylists` 里的修复写回，都走它。
  - 在锁内重新读最新值再修改，不用锁外读到的副本。
- **测试：** 用 fast-check 随机交错“收藏、加入歌单、删除歌曲、修复”，断言每个操作的效果都保留了下来。

### 2.4 曲库记录：写回时只合并自己改的字段

- **问题：**
  - `localMusicService.ts:1032-1061`：后台补全标签时，把导入时的整条记录 `bulkPut` 回去，会覆盖用户在此期间手动匹配的元数据，也会把已删除的歌写回去。
  - 同样的写法还出现在 `recoverFileHandleFromPersistedDirectory`（约 1564 行）、`extractAndPersistSongCover`（约 1706 行）、`repositories/localSongRepository.ts:36-52` 的迁移写回。
- **改法：**
  - 在一个 rw 事务里重新读出当前记录。记录已经被删除就跳过；否则只合并这次负责的字段（标签字段、封面字段、迁移字段），其余字段保留数据库里的值。
  - 抽成一个 `patchLocalSongs(ids, patchFn)`，上面几处都改用它。
- **测试：** 用 fast-check 随机交错“补全标签、手动匹配、删除”，断言最后一次用户写入胜出，删除的歌不会复活。

### 2.5 封面资源的引用计数回收

- **问题：** `localCoverAssetService.ts:148-159` 的“数引用数再删除”在事务之外进行，可能和一次正在保存、引用同一张封面的歌曲交错，删掉之后那首歌就指向一张不存在的封面。
- **改法：**
  - 计数和删除放进同一个覆盖歌曲表和资源表的 rw 事务。
  - 保存歌曲的事务里，再确认一次资源是否存在，不存在就重新写入。
- **测试：** 用 fast-check 断言“每个 `localCoverAssetId` 都指向一个存在的资源”。

### 2.6 切歌时的附带加载，都核对“还是不是这首歌”

- **主题恢复：** `restoreCachedThemeForSong` 接收一个 `isCurrent()` 回调，`await` 读缓存之后先核对，再应用（`src/hooks/useThemeController.ts:522-536`）。本地和 Navidrome 的调用方（`useLibraryPlaybackController.ts` 约 819、859、1146 行）也要传这个回调。
- **舞台模式的加载：** `useStagePlaybackController.ts` 的 `loadStageLyricsIntoPlayback` 和 `loadStageSessionIntoPlayback` 加一个舞台加载请求号。主播放器开始切歌时同步递增它，不要放在 passive effect 里。
- **连按下一首和上一首：** `usePlaybackQueueController.ts` 约 1258、1349 行改成从“正在请求的那首”（`askedSongKeyRef`）起算，不用界面上显示的那首。保留现有 `heldSong` 和 `fromSong` 的语义。
- **自动播放的 `play()`：** `usePlaybackAudioBridge.ts:376-397` 像 `resumePlayback` 一样记下 `transportRevision`。`play()` 回来时，如果版本变了，就不再设置 `shouldAutoPlayRef`，也不设 PLAYING。
- 这一组的测试放进阶段 4 的协议模型测试里一起写。阶段 2 先给每条各写一个确定顺序的复现测试。

## 阶段 3：用代码扫描测试守住写法

仓库没有 ESLint。现有的约定是用测试扫描源码（`test/unit/onlineMusic/omniArchitecture.test.ts`、`platformNamePlaces.ts`），也可以扩展 `dev/mcp/ts-code-map/codemap.mjs`。沿用这个做法，用 TypeScript 编译器 API 做 AST 检查：

1. **写入入口白名单：**
   - `setPlayQueue(`、`persistPlaylists(`、`local_music.bulkPut(` 和 `saveLocalSongs(` 只能在白名单文件里直接调用。其余地方必须走阶段 2 的入口（版本化的队列写入、`runPlaylistMutation`、`patchLocalSongs`）。
   - 白名单记在 `test/unit/architecture/writeEntryPoints.ts`，新增调用点要显式登记。
2. **不允许把失败吞成空集合：**
   - `src/services/db.ts` 和 `src/services/repositories/` 里，`catch` 块不能直接 `return []` 或 `return {}`。确实需要的，加注释标记并登记。
3. **`await` 之后的过期检查（只覆盖一个范围）：**
   - 在 `src/components/app/playback/**` 里，函数体内有 `await`、之后又调用了 `setAudioSrc`、`makeSongCurrent`、`showSong`、`applyDualTheme` 的，最后一个 `await` 和调用之间必须出现一次过期检查（`isLatestPlaybackRequest`、`isCurrent`、请求号比较等）。
   - 这一条会有误报，先只报告不让测试失败，跑一段时间再决定是否收紧。

## 阶段 4：automix 修复，加会话状态机的模型测试

### 4.1 修复

- **淡入淡出期间的 `playing` 事件：** `automixSession.ts:900-905` 的 `handleActiveDeckPlaying` 在 `phase` 为 `fading` 时不调用 `rampGain`，也不重置 deck 时钟。只在真正空闲时才把音量放回 1。
- **取消要让进行中的切歌失效：** `src/App.tsx` 约 1940-1995 行的 `cancelBlendToDisplayedTrack` 要让那次切歌失效，比如调用 `dropPlaysInFlight` 或递增一次播放请求，确保它 `await` 回来后不再写入。按 `file-modularization` 的要求，这段逻辑顺手从 `App.tsx` 挪到 `components/app/playback/` 或 automix 目录。
- **`suppressAutoplayRef`：** 从布尔值改成“对哪首歌、哪次请求生效”，消费时核对，对不上就忽略（`useAutomixDecks.ts:854-856`）。
- **卡顿检查定时器：** 加代数号，开新的检查链前取消旧的（`useAutomixDecks.ts:338-369`）。

### 4.2 模型测试

- 对 `createAutomixSession` 注入假端口，用 fast-check 的 `fc.commands()` 随机生成事件序列：`timeupdate` 到达切入点、`playing`、`waiting`、`ended`、拖动进度、暂停、播放、选另一首歌、播放地址解析完成或失败。
- 每一步之后检查这些不变量：
  - 任何时刻最多一个 deck 是主 deck；
  - `fading` 期间，两个 deck 的音量只按计划好的曲线变化；
  - 取消以后，store 里的当前歌曲就是主 deck 在放的那首；
  - 用户的暂停不会被一次自动播放撤销；
  - 会话回到 `idle` 以后，没有残留的定时器。

## 阶段 5：播放请求协议的模型测试

这是最核心、也最大的一块。

- **前置重构：** 把 `currentSong.ts` 的协议（`startPlay`、`askForSong`、`showSong`、`withdrawAsk`、`putBack`、`dropPlaysInFlight`、按平台的丢弃标记）和 `playSong` 的编排，从 hook 里抽成一个可以注入端口的纯模块。端口包括：取播放地址、取歌词、读主题缓存、`audio.play()`、store 写入。hook 只负责组装。这一步要单独一个 PR，不改行为，靠现有测试保证。
- **模型测试：** 用 `fc.commands()` 加 `fc.scheduler()`。
  - **操作：** 播放某首歌、下一首、上一首、暂停、播放、编辑队列（加入、删除、拖动）、退出某个平台的账户、进入或离开舞台模式、媒体出错并恢复、模组整体替换队列。
  - **异步端口的完成顺序：** 全部交给 scheduler 决定。
- **不变量：**
  - 界面显示的歌曲、歌词、封面、主题、音频地址都属于同一首歌；
  - 被取代的请求不会调用 `play()`，也不会写入当前歌曲；
  - 等待期间做的队列编辑都保留在最终的队列里；
  - 退出某个平台的账户后，除非用户重新播放该平台的歌，store 和存档里都不会再出现它的歌；
  - 用户的暂停不会被过期的加载撤销；
  - 连按 N 次下一首，最终停在起点之后第 N 首（受队列长度限制）；
  - 请求中的歌曲键不会停在一首没人显示的歌上。

## 阶段 6（可选）：TLA+ 规格

只有阶段 5 之后这一块仍然反复出 bug 时才做。

- **位置：** `dev/specs/playbackRequest/PlaybackRequest.tla` 和 `.cfg`，附一份 README 写明怎么本地运行 TLC（需要 Java）。
- **建模对象：** 阶段 5 抽出来的协议状态，包括各个计数器、请求中的歌曲键、显示的歌曲、队列版本号，以及进行中的请求，它们的 await 点按步骤拆开。
- **不变量：** 和阶段 5 相同。另加一条活性：“没有新操作时，请求中的歌曲最终会被显示或被撤回”。
- **其他候选：** automix 会话（阶段 4 的状态机）、封面引用计数回收（也可以用 Alloy 写一个小模型）。

## 待办（优先级低，各自单独处理）

- 同步服务器：哈希只覆盖 `fingerprint + updatedAt`，时间戳相同但内容不同的两份主题永远发现不了（`src/services/sync/syncMerkle.ts:41`）。可以把内容哈希也算进去。
- 同步服务器：按客户端时钟比较的后写者胜，设置被当作一整块合并。这是设计取舍，要改得先和维护者讨论，比如改成按字段合并、用服务器时间。
- 远程窗口的队列命令：同一首歌在队列里出现两次时，按键查找的回退可能删错行（`remoteQueueFeed.ts:35-41`）。可以改成和舞台模式一样按“来源、id、位置”严格核对。
- Stage API：请求超时（10 秒）之后，渲染进程可能仍然执行了操作，客户端重试 `next` 会执行两次（`stageApi.cjs:1589-1596`）。可以给控制类请求加幂等键。
- 窗口交接：超时以后才到的回复仍然会被存下来（`main.cjs` 约 5113 行），应该先检查请求是否还在等待，再保存。
- automix：暂停时会把正在淡出的那首记成已播完（`automixSession.ts` 约 1315 行），只影响统计数据。

## 建议的 PR 顺序

| PR | 内容 | 依赖 |
|---|---|---|
| 1 | 0.1 歌单被清空 | 无 |
| 2 | 0.2 + 0.3 音频缓存 | 无 |
| 3 | 0.4 网易云超时 | 无 |
| 4 | 1.1 fast-check 和测试工具 + 1.2 同步分桶 | 无 |
| 5 | 2.1 + 2.2 队列版本号、退出账户后的过滤 | 4 |
| 6 | 2.3 + 2.4 + 2.5 曲库和歌单写入 | 4 |
| 7 | 2.6 切歌附带加载的过期检查 | 5 |
| 8 | 3 代码扫描测试 | 5、6 |
| 9 | 4 automix | 4、5 |
| 10 | 5 的前置重构（不改行为） | 7 |
| 11 | 5 播放请求协议模型测试 | 10 |
| — | 0.5 模组，等维护者决定威胁模型 | — |
| — | 6 TLA+，按需 | 11 |

前三个 PR 互不依赖，可以并行。
