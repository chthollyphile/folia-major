# services/analysis

曲目分析的公共底层。automix（`../automix/`）和节拍效果（`../beatFx/`，智能动感模式）都从这里读，beatFx 不依赖 automix。

例外：这里还借用了 automix 下三个与 automix 本身无关的工具模块——`signalAnalysis`（梅尔滤波等信号处理）、`uiYield`（让出主线程）、`analysisOffThread`（频谱放到 worker 算）。它们都是无状态的纯计算（`analysisOffThread` 的 worker 还连带 `trackProfile`，同样无状态），不碰 automix 的队列、缓存或播放状态；以后要彻底分层，就把这几个搬进来。

| 文件 | 职责 |
|---|---|
| `trackAudio.ts` | 读一首歌**已经在本机**的字节：播放 representation → 媒体缓存 → 本地 URL → 本地文件句柄（App 注册的读取器）。从不下载在线歌曲（Navidrome 这类以 http 提供的曲库源会读，但会检查响应确实是音频）；要不要下载由调用方决定（只有 automix 的 profile 会）。另含按分析采样率解码、拆 mid/side。 |
| `beatThis.ts` | Beat This! 的前处理契约：梅尔频谱、1500 帧分块、峰值挑选、网格折算。推理先走 GPU，`cpuFallback` 决定能否退到 CPU（只有 final0 有 CPU 路径）。`model` 选模型：`beat_this`（final0，automix 用，需下载）或 `beat_this_small`（small0，智能动感模式用，随应用打包）。 |
| `beatThisGpu.ts` + `beatThisWgsl/` | 渲染进程 Worker 里的 WebGPU 推理，两个模型共用同一套 kernel 和同一个 GPU device，Worker 里各加载一次、同时常驻，交替使用不重新加载；`probeBeatThisGpu` 给设置页判断有没有可用 GPU。 |
| `beatGrid.ts` | 整首歌的拍点，按模型分开：先读存盘结果，正在跑就等同一次，否则跑一次并存盘（final0 存 `beat_this_grid_<分析 key>`，small0 存 `beat_this_small_grid_<分析 key>`，都归入「分析」缓存类别）。两个模型的结果互不读取、互不合并。只存整首；只读了开头的 automix 分析自己跑、不存。 |
| `modelAvailability.ts` | 两个模型（beat_this / htdemucs）的权重是否在盘上，可同步读取。 |

约定：

- 存结果的调用方用 `getPlaybackAnalysisTarget` 一次取出 key 和 representation，读字节用同一个 representation，避免转码中途注册导致结果存错 key。
- 节拍效果只用 small0、只走 GPU；automix 用 final0，可以退到 CPU。两边各跑各的、各存各的。同一模型的多个调用方同时要同一首歌时，`beatGrid.ts` 合并成一次推理；只有 GPU 跑空、而调用方允许 CPU 时才会再跑一次。
- small0 的权重不进 git，也不是用户下载项：单独仓库 `lantudou/folia-beat-this-small` 的 Release 按 tag + sha256 固定，打包时由 `packaging/beat-this-small/fetch-beat-this-small.mjs`（`build/beforePack.cjs` 调用，开发时 `npm run build:beat-this-small`）拉到 `models/`，再经 extraResources 进安装包的 `resources/models`。
