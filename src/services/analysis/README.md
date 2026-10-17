# services/analysis

曲目分析的公共底层。automix（`../automix/`）和节拍效果（`../beatFx/`，智能动感模式）都从这里读，beatFx 不依赖 automix。

例外：这里还借用了 automix 下三个与 automix 本身无关的工具模块——`signalAnalysis`（梅尔滤波等信号处理）、`uiYield`（让出主线程）、`analysisOffThread`（频谱放到 worker 算）。它们都是无状态的纯计算（`analysisOffThread` 的 worker 还连带 `trackProfile`，同样无状态），不碰 automix 的队列、缓存或播放状态；以后要彻底分层，就把这几个搬进来。

| 文件 | 职责 |
|---|---|
| `trackAudio.ts` | 读一首歌**已经在本机**的字节：播放 representation → 媒体缓存 → 本地 URL → 本地文件句柄（App 注册的读取器）。从不下载在线歌曲（Navidrome 这类以 http 提供的曲库源会读，但会检查响应确实是音频）；要不要下载由调用方决定（automix 的 profile 会；智能动感模式在在线歌还没进缓存时，用播放已解析出的这首歌的音源地址再读一份来分析，不写缓存，见 `services/beatFx/beatFxSource.ts`）。另含按分析采样率解码、拆 mid/side。 |
| `beatThis.ts` | Beat This! 的前处理契约：梅尔频谱、1500 帧分块、峰值挑选、网格折算。推理先走 GPU，`cpuFallback` 决定能否退到 CPU（只有 final0 有 CPU 路径）。`model` 选模型：`beat_this`（final0，automix 用，需下载）或 `beat_this_small`（small0，智能动感模式用，随应用打包）。 |
| `beatThisGpu.ts` + `beatThisWgsl/` | 渲染进程 Worker 里的 WebGPU 推理，两个模型共用同一套 kernel 和同一个 GPU device，Worker 里各加载一次、同时常驻，交替使用不重新加载；`probeBeatThisGpu` 给设置页判断有没有可用 GPU。 |
| `beatGrid.ts` | 整首歌的拍点，按模型分开：先读存盘结果，正在跑就等同一次，否则跑一次并存盘（final0 存 `beat_this_grid_<分析 key>`，small0 存 `beat_this_small_grid_<分析 key>`，都归入「分析」缓存类别）。两个模型的结果互不读取、互不合并。只存整首；只读了开头的 automix 分析自己跑、不存。 |
| `beatAccents.ts` | 每拍的重音：强度、低 / 中 / 高三段占比、整曲动感系数。强度 = 拍点那一下的突起（占 40%）和前后约半秒整体有多响（占 60%），各自在全曲里归一后混合；只看突起时，空旷前奏里每一下都显得很强、人声铺满的段落反而偏弱（版本 10，旧版本存档会重算）。在 small0 的同一次分析里，用同一份梅尔频谱算出，作为可选字段 `accents` 和拍点存在一起（不升拍点版本号，automix 的 final0 存档不写这个字段）。旧存档没有这个字段时，`getTrackBeatAccents` 在 worker 上重新解码、补算并写回。另有 `rhythmic`（每拍 0/1）：每小节的打击成分占比低于全曲中位数的 0.45 时，这一小节的拍不出特效（只有喇叭、铺底的前奏）。打击占比由 HPSS 在 GPU 上和 beat_this 同一次运行算出（`beatThisWgsl/percussive.ts`），补算时单独跑一次 HPSS；GPU 不可用时所有拍都算有节奏；全曲中位小节的打击占比低于 0.15 的歌（完全没鼓，如雪绒花 0.10）不做这道门，否则占比只随编配起伏，整句整句地时有时无。模型拿不准拍子的一长段也不出特效：按实际触发的拍，前后各 4 拍的 logit 平均低于全曲第 75 百分位的 0.55，且连续 8 拍以上（夢灯籠自由节奏的钢琴人声前奏 0–27 秒，模型硬套了一个等间隔拍，logit 约 3，乐队进来后约 7）；只看触发的拍，双倍速数出来的弱拍不算，不会把走马这种歌切碎。`[BeatMeter]` 行末尾的 `unsure N` 是这样关掉的拍数。鼓驱动的歌（全曲打击占比 ≥ 0.3）被减半后，按段落再看一次：前后各 8 组里，被拿掉的拍 logit 平均达到保留拍的 0.6 倍，说明这一段确实按数出来的速度在跑，就把拍放回来（梦灯笼后半段 0.63–0.92 恢复全速，主歌 0.53–0.57 仍减半）；理想三旬（0.23）、走马（0.19）这类扫弦为主的歌整首减半，它们的反拍 logit 也有 0.7–0.85，光看 logit 分不开。末尾的 `driven N` 是放回的拍数。还有 `pulse`（每拍 0/1）：模型不给拍号，有时会数到比听感更细的一层——复合拍子（6/8 等）里数八分音符，密三倍（小半、麦恩莉）；慢歌被数成双倍速，密一倍（走马，听感约 70 BPM，数成 143）。全曲最常见的小节是组长（先试 3，再试 2）的倍数，且每组头一拍的模型把握（beat logit 中位数）比两侧高 0.7 以上（正确的 4/4 只有 0.3–0.4），平均突起也比两侧高（3 拍组 1.2 倍以上；2 拍组不看突起，只看 logit——理想三旬这种均匀扫弦每个八分音符一样响，梦灯笼这种鼓镲打在八分音符上的歌反拍突起更大；没有 logit 时 2 拍组要突起 1.5 倍），速度也够（3 拍组 ≥120、2 拍组 ≥90 BPM）时，从每个重拍起每组记一个 1。每小节 3 拍的华尔兹，重拍比两侧都突出时（雪绒花、第二圆舞曲）整小节算一拍，只有重拍记 1。另外，模型在某一段临时数到更细一层时（雪绒花前奏在 0.58 秒和 0.30 秒之间来回跳），离上一个保留拍不到平常间隔 0.7 的拍也记 0，两拍太近时保留重拍。logit 来自 small0 同一次推理；旧存档补算重音时会在 GPU 上再跑一次 small0（约 0.5 秒）取它，跑不了时只看突起；模型偶尔把重拍标偏、小节数成 5 或 7 拍时也照此稀疏，不会突然变密。每次算完重音，控制台会打一行 `[BeatMeter] <曲目键>: bpm … | bars 6x92 3x13 … | usual 6 rise by position … | logit by position … | 1 in 3 (240/684)`：模型数的速度、各种小节长度的个数、平常小节各位置的平均突起和 logit、最后是全拍还是每几拍一拍；哪首歌拍点特效不对劲，看这一行就能先判断是不是拍子数错了。华尔兹被数成每小节 3 拍（雪绒花、第二圆舞曲），不受影响。 |
| `modelAvailability.ts` | 两个模型（beat_this / htdemucs）的权重是否在盘上，可同步读取。 |

约定：

- 存结果的调用方用 `getPlaybackAnalysisTarget` 一次取出 key 和 representation，读字节用同一个 representation，避免转码中途注册导致结果存错 key。
- 节拍效果只用 small0、只走 GPU；automix 用 final0，可以退到 CPU。两边各跑各的、各存各的。同一模型的多个调用方同时要同一首歌时，`beatGrid.ts` 合并成一次推理；只有 GPU 跑空、而调用方允许 CPU 时才会再跑一次。
- small0 的权重不进 git，也不是用户下载项：单独仓库 `lantudou/folia-beat-this-small` 的 Release 按 tag + sha256 固定，打包时由 `packaging/beat-this-small/fetch-beat-this-small.mjs`（`build/beforePack.cjs` 调用，开发时 `npm run build:beat-this-small`）拉到 `models/`，再经 extraResources 进安装包的 `resources/models`。
