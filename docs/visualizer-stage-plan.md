# 歌词舞台 GPU 重构与桌面壳评估

<!-- docs/visualizer-stage-plan.md
     2026-11-09 调查后写下的计划，尚未讨论、未开工。两个问题：
     1. 给桌面版压力最重的界面组件设计一个高性能重构方案（候选：wgpu）；
     2. 桌面版能不能去掉 Electron（候选：只给关键组件用 webview）。
     代码事实核对到 main 的 185e60fe；外部事实（各 webview 的 WebGPU 支持等）查于同日，出处在文末。
     本文没有新的实测数据：本仓库不带画面底数（dev/perf 的结果写在维护者本机的 claude-notes/perf/），
     下面凡是排名和收益判断，依据都是代码结构、注释里记下的数字和 issue，第 0 阶段先补实测。 -->

## 结论

1. **压力最重的组件是歌词舞台**：`VisualizerRenderer` → `VisualizerBackdrop`（背景 + 当前歌词样式 + 叠层）。
   它有 11.8 万行（`src/` 的 27%），除 Lattice 和「首页实色完全盖住」两种情况外一直挂着
   （`playerVisualizerMount.ts`），壁纸模式下不停地画。
2. **重构方案是「一个 GPU 舞台」，不是「把样式用原生 wgpu 重写一遍」**。现在背景和样式各开各的 WebGL
   上下文、各跑各的帧循环、各自光栅化文字，再交给 Chromium 用 CSS 滤镜合成。改成一个设备、一张画布、
   一条在 Worker 里的帧循环、一份帧图。引擎用 Rust + wgpu 写，编译成 WASM 在 webview 里跑
   （同一个包带 WebGPU 和 WebGL2 两个后端），样式的排版和时间线留在 TypeScript。
3. **收益来自结构，不来自 wgpu 本身**。Chromium 的 WebGPU 实现（Dawn）和 wgpu 是同一级别的原生实现；
   片元着色器该花多少还是花多少。能省的是：多个上下文的合成和显存、主线程上的每帧脚本、CSS 滤镜对整屏画布的
   重复模糊、各样式重复的文字光栅化。省多少，要第 0 阶段量出来再定后面的顺序。
4. **去掉 Electron：现在不建议**。
   - 整个应用换成系统 webview：Windows（v0.7.27 下载量约 84%）上系统 webview 就是 Chromium（WebView2），
     画面性能不变，换来的是丢掉内核版本锁定；macOS、Linux 换成 WebKit，11.8 万行按 Chromium 调过的画面代码要重新适配。
     安装包大约能小四分之一（估算），因为安装包的一半以上是两个模型（133 MB），不是 Electron。
   - 「原生界面 + 只给关键组件用 webview」：要用原生界面库重写约 18 万行界面代码（`src/components` 去掉歌词舞台，加 `src/library`、`src/mods`），网页版和模组（Folium）
     还得留着 React 那一套，等于永久维护两套界面。不可行。
   - 「原生壳 + 原生 wgpu 舞台 + webview 画界面」：DOM 的 `backdrop-filter`（歌词舞台之外约 70 个文件在用）采样不到
     webview 下面的原生表面，整套「毛玻璃盖在歌词上」的观感要重做。代价高于收益。
5. **推荐路线**：留在 Electron；先做舞台（第 0–2 阶段，每阶段有验收关口）；同时只做本身有独立收益的解耦
   （视频导出挪到舞台上、平台后端挪进不依赖 Electron 的 Node 子进程）。文末列了重新评估 Electron 的条件。

---

## 一、现状：压力在哪

### 舞台由什么组成

| 层 | 现在的实现 | 每帧在做什么 |
|---|---|---|
| 背景（默认 `latent`） | 两张 `@paper-design/shaders-react` 的 WebGL 画布（`Dithering` + `MeshGradient`），上限 1280×720（`LatentBackground.tsx:44`）；其余背景各用各的：paper shaders、twgl、Canvas2D、CSS `blur()` | 每张画布自己的帧循环，再加一条写 uniform 的 rAF |
| 歌词样式 | 17 个内置样式，5 种技术（见下表） | 各自的 ticker / rAF，读 `currentTime.get()` |
| 宿主效果 | 首页墙下面对整个舞台 `filter: blur(24px)`（`playerVisualizerBackdrop.ts:16`）；切样式时 `blur(8px)` + `scale(1.02)`；整体不透明度 | Chromium 合成器对整屏画布做 |
| 叠层 | 字幕、和声、模组舞台层（DOM），浮层的 `backdrop-blur` | 合成器 |

时间来自一条全应用共用的 rAF（`usePlaybackVisualizerBridge.ts`），把播放时间、五段频谱、拍点写进模块级的
MotionValue；每个样式再在自己的循环里读。

### 样式按渲染技术分

| 技术 | 样式（行数） | 备注 |
|---|---|---|
| three.js | 町景 machi（15.3k）、镜台 diorama（7.1k） | 町景有完整的 HDR 后处理链（MSAA、雾、5 级 bloom、景深、SMAA、反射、阴影），是唯一带自动降档的样式（`machi/engine/quality.ts`） |
| Pixi v8，全部钉在 WebGL（`preference: 'webgl'`） | 花火 hanabi（13.7k）、凝彩 tempera（12.6k）、商籁 sonnet（11.7k）、绘光 lumiere（11.4k）；另有 Lattice 的歌词条 | 叠 `BlurFilter`（商籁里 19 处）、bloom、噪点；为省显存不开 MSAA 画布（商籁开了要多约 190 MB，凝彩约 70 MB，见各自 runtime 的注释） |
| 手写 WebGL2 | 雾笺 nebbia（7.5k）、时计 pendolo 的机芯（5.5k） | 雾笺 6 个 program，冷编译约 1 秒，D3D11 上合成一个 program 要 6 秒多，所以有预热 |
| Canvas2D | 烟 fume（4.5k）、cadenza（1.9k） | 整屏画布每帧重画，`shadowBlur`；fume 在 Linux 修复前主线程约 55% |
| DOM + framer-motion | classic、partita、tilt、cappella、claddagh、monet、still | 每帧脚本加排版 1–4 ms（`dev/perf/scenarios.mjs:19-24` 记的试跑数） |

文字没有共用的光栅化：花火用 Canvas2D 字形图集，绘光把整行画成纹理再切，镜台和町景画成 `CanvasTexture`，
商籁和凝彩用 `pixi.Text`，fume 每帧 `fillText`。没有任何样式用 SDF。

### 用户报告过的问题

- #605：整屏画布每帧更新，上面叠 `backdrop-blur-xl`，合成器整屏重绘，INP 864 ms，风扇拉满。
- #962：町景开销大，切到町景卡顿。
- #352、#837、#375、#907：歌词模式吃性能，轻薄本常驻时内存、风扇、温度偏高。
- #1046：商籁、凝彩、绘光在 144 Hz 屏上观感约 29 fps，因为每帧直读媒体时钟。
- #929：1 倍屏上字形 1 倍光栅化再缩放，没有 mipmap，出台阶。
- #806、#575：GPU 进程连续崩溃。
- #433 与 `docs/linux-glyph-cache-fd-leak.md`：连续动画的 `text-shadow` / `shadowBlur` 让 Chromium 的字形缓存漏 fd。

### 今天哪里用了 WebGPU

画面一处都没有。WebGPU 只用于推理：`beatThisWgsl` 和 `htdemucsWgsl` 是手写的 WGSL 运行时，在渲染进程的
Worker 里跑（`src/workers/beatThisGpu.worker.ts`）。它和画面共用一块显卡，调度层已经会在画面掉帧时让路
（`services/analysis/scheduler.ts`）。Linux 的 X11 后端默认不开 Vulkan，WebGPU 拿不到 adapter（`electron/linuxVulkan.cjs`）。

---

## 二、重构方案：一个 GPU 舞台

### 为什么不是原生 wgpu 渲染器

把舞台搬出 webview、用原生 wgpu 画，有三个问题：

1. **合成**。原生表面放在透明 webview 下面，DOM 的 `backdrop-filter` 采样不到它。反过来把原生纹理送进页面，
   只有 Electron 有接口（`sharedTexture` 模块把共享纹理句柄变成 `VideoFrame`，标着 experimental）；系统 webview 没有对应的公开接口。
   所以「原生舞台」在 Electron 里才做得好，而在 Electron 里它又不比页面内的 WebGPU 快：帧还是要过 Chromium 的合成器。
2. **两套实现**。网页版、Docker 版、OBS 浏览器源、模组样式都只能跑在浏览器里。原生渲染器意味着同一个样式写两遍。
3. **文字**。歌词是这个应用的内容本身，要支持 CJK、注音、用户选的本机字体。原生一侧要另起一套整形和光栅化
   （DirectWrite / CoreText / FreeType），和 Chromium 画出来的字不会逐像素一致。

结论：只要壳是 Chromium（Electron 或 WebView2），舞台就画在页面里；引擎写成可以原生链接的形式，
给以后换壳留门，但现在不走那条路。

### 引擎用什么写

| 方案 | 没有 WebGPU 的环境 | 能否原生复用 | 代价 |
|---|---|---|---|
| A. Rust + wgpu，编成 WASM（**推荐**） | 同一个 wasm 里带 WebGL2 后端，运行时选 | 能，同一个 crate | Rust 工具链进主构建（仓库里壁纸 helper 已经是 Rust）；wasm 体积；引擎只能用 WebGL2 也有的能力（无 compute、无 storage buffer） |
| B. TypeScript 直接调 WebGPU | 没有。迁过的样式要永久留一份旧实现兜底 | 不能 | 兜底的旧实现会和新实现一起长功能，或者烂掉 |
| C. 换成 Pixi 的 WebGPU 渲染器 / three 的 `WebGPURenderer` | 两者自带 WebGL 回退 | 不能 | 自定义滤镜和 39 个 `ShaderMaterial` 都是 GLSL，要全部重写成两种后端的版本；上下文还是每样式一个，结构没变 |

没有 WebGPU 的环境不是边角：Linux X11 默认配置、SwiftShader / 软件渲染模式、OBS 的浏览器源、macOS 26 之前的 Safari。
这是选 A 的主要理由，原生复用是次要理由。A 在 WASM 里每次 WebGPU 调用要过一层 JS 胶水，
所以引擎接口必须是批量的（一帧几十次调用，不是每个字一次）。

A 成立与否在第 1 阶段第一周验证（见「第 1 阶段」的先行验证）；不成立就退到 B，舞台的结构设计不变。

### 结构

```
主线程（React）                                渲染 Worker
────────────────────                         ─────────────────────────────────────────────
usePlaybackVisualizerBridge
  时钟锚点（约 10 Hz，seek/暂停时立即）──────▶ 舞台时钟：按锚点外推，自己的 rAF
  频谱五段 + 拍点（每帧，几百字节）────────▶ 每帧 uniform
VisualizerRenderer
  <StageCanvas> transferControlToOffscreen ─▶ 舞台（wasm：Rust + wgpu）
  离散事件：换歌、换样式、调参、尺寸 ──────▶  ├ 背景通道（≤720p）
                                              ├ 场景通道：字形实例 + 样式自己的 WGSL
样式的 scene.ts（纯 TS，无 DOM）在 Worker 里： ├ 后处理链：共用的降采样金字塔（bloom / 模糊 / 噪点）
  排版（pretext）+ 时间线 → 帧描述 ─────────▶ └ 合成通道：不透明度、首页模糊、样式切换、换歌交接
```

要点：

- **一个设备、一张画布**。背景和样式共用封面纹理、模糊金字塔、字形图集。首页那层 24 px 模糊、样式切换的柔焦、
  换歌交接的淡入淡出，都在合成通道里用低分辨率做，不再让 Chromium 对整屏画布跑 CSS 滤镜。
- **帧循环在 Worker**。主线程卡顿（React 提交、GC、列表滚动）不再让歌词掉帧。主线程只发离散事件。
- **时钟按锚点外推**。主线程发「媒体时间 t 对应 performance.now() 的 p」，Worker 每帧外推。
  #1046 那类「媒体时钟 34.6 ms 才跳一次」的问题在结构上消失。不用 `SharedArrayBuffer`（要跨源隔离，封面和媒体是跨源的）。
- **文字仍由浏览器光栅化**。Worker 里用 `OffscreenCanvas` 的 `fillText` 把字形画进图集，和今天是同一个光栅器，
  观感不变；图集带 mipmap（解决 #929 的缩小采样台阶）。一个字只光栅化一次，不再每帧 `fillText` / `shadowBlur`，
  预期连带去掉 Linux 字形缓存漏 fd 的触发条件（要验证）。用户的本机字体由主线程 `queryLocalFonts` 取出字节，传给 Worker 注册。
- **统一的质量控制**。把町景的自动降档推广成舞台的一个控制器：按帧时间动态调各通道的分辨率倍率，
  上下限用现有的「歌词渲染质量」设置。推理调度层的「给画面让路」改读舞台报告的掉帧，不再自己猜。
- **设备丢失可恢复**。GPU 进程崩溃后重建设备和资源，由舞台统一处理，不用每个样式各写一遍。

### 样式怎么接

`VisualizerRegistryEntry`（`definition.ts`）加一个可选字段，例如 `stage?: () => Promise<StageSceneFactory>`：

- 样式有 `stage` 且舞台可用：`VisualizerRenderer` 挂共用的 `<StageCanvas>`，样式的画面由舞台画；
  样式的 `render` 只剩它的 DOM 部分（字幕叠层、点击区）。
- 否则照旧走 `render`。模组样式、DOM 样式、three.js 样式不用改。

迁过去的样式在自己的目录里是三样东西：`scene.ts`（Worker 里跑的排版和时间线，产出帧描述）、`*.wgsl`、
`entry.tsx` 里的登记。符合「加一个同类的东西只动它自己的目录和注册点」。调参（`tuning.ts`）、Folium 的
`foliumTunables`、设置面板都是数据，不受影响。

### 范围

| 进舞台 | 不进舞台 |
|---|---|
| 背景：latent、nomand、sora、fluid / geometric、monet 的背景 | `url` 背景（iframe） |
| 宿主效果：不透明度、首页模糊、样式切换、换歌交接 | 字幕、和声叠层、模组舞台层（DOM） |
| Pixi 一族：Lattice 歌词条、绘光、花火、商籁、凝彩 | DOM 样式：classic、partita、tilt、cappella、claddagh、monet 的歌词、still |
| 手写 GL：雾笺、时计的机芯 | three.js 样式：町景、镜台（见下） |
| Canvas2D：fume、cadenza | 模组样式（React `render`） |

DOM 样式每帧只有 1–4 ms，不值得迁。町景和镜台是完整的三维场景，迁进自写引擎等于重写一个三维引擎，
它们的开销主要是片元着色器，换后端不会变快；它们留在 three.js 上，要不要换 `WebGPURenderer` 是另一件事，不在本计划里。

### 分阶段

每个阶段结束有关口，不过就停在上一阶段，已合入的部分独立可用。

**第 0 阶段：量出钱花在哪（小）**

- 在 `laptop`、`old` 两档机器配置上跑 `dev/perf` 的底数，把结果里和本计划有关的部分放进仓库
  （现在只在维护者本机的 `claude-notes/perf/`）。
- 做四组对照，估出舞台能省的上限，不用先写引擎：背景开 / 关；首页 24 px 模糊开 / 关；
  画面上方的 `backdrop-blur` 浮层开 / 关；样式画布分辨率 1× / 0.5×。
- 每个样式记三个数：主线程每帧脚本时间、GPU 进程 CPU 和显存、p95 帧间隔。
- 关口：按数据重排第 2 阶段以后的顺序。如果合成和背景在重样式的帧开销里占比很小，第 1 阶段缩成只做引擎骨架，直接进试点样式。

**第 1 阶段：舞台骨架、背景、合成（中到大）**

- 先行验证（第一周）：wgpu 的 WASM 包在同一个二进制里带 WebGPU 和 WebGL2 两个后端并在运行时选择；
  在 Worker 的 `OffscreenCanvas` 上出图；wasm 体积和启动时间。任何一项不成立，引擎改用 TypeScript 直接调 WebGPU（方案 B）。
- 引擎骨架：设备与回退、帧图、封面纹理缓存、降采样金字塔、合成通道、质量控制器、设备丢失恢复。
  crate 放 `native/`（和 `folia-mnn` 并列），TypeScript 一侧放 `src/components/visualizer/stage/`。
- 时钟锚点、帧率上限、后台节流：`frameRateLimiter.ts` 改写的是 `window.requestAnimationFrame`，够不到 Worker，
  这三样要在舞台的帧循环里重新实现。
- 背景移植成 WGSL。paper shaders 的效果移植前先确认它的许可证允许，否则按效果重写。
- 关口：
  - `test/ui` 的截图对比通过，或差异经人看过认可；
  - 重的前十个场景在 `laptop`、`old` 上 p95 帧间隔不劣于底数；
  - GPU 进程显存下降（少了两个背景上下文）；
  - WebGL2 回退在 Linux X11 默认配置、SwiftShader 模式、OBS 浏览器源里出图正确。

**第 2 阶段：试点样式（中到大）**

- 试点一：Lattice 的歌词条。代码量小，单独验证字形图集和实例批处理。
- 试点二：绘光。有代表性（整屏光场着色器 + 逐字显现 + bloom），是首页墙探针默认压在下面的样式，有现成的测量。
- 关口（阈值在第 0 阶段有底数后定稿，下面是建议值）：
  - 该样式主线程每帧脚本时间下降一半以上；
  - `laptop`、`old` 上 p95 帧间隔不劣于底数，144 Hz 屏上帧间隔均匀；
  - GPU 进程显存不高于底数；
  - 观感经维护者认可。
- 不过关就停：保留第 1 阶段的成果，Pixi 样式留在原处。

**第 3 阶段：Pixi 一族的其余样式（各为大）**

花火、商籁、凝彩，一个样式一个 PR。最后一个 Pixi 使用者迁完，去掉 `pixi.js` 依赖和 `visualizer/pixi/`。

**第 4 阶段：手写 GL 和 Canvas2D 样式（各为中到大）**

雾笺、时计的机芯（GLSL 改 WGSL，结构基本不动）；fume、cadenza（主线程开销最大的两个，改成字形实例后收益最直接）。

**第 5 阶段：导出和预览挪到舞台上（中）**

- 导出：舞台按合成时钟逐帧出图 → `VideoFrame` → WebCodecs `VideoEncoder` → 封装。不实时、不抓屏，
  分辨率和帧率不再受窗口大小和机器性能限制，也不再依赖抓窗口（#632 是这条路径在 Wayland 上出过的问题）。
  同时去掉对 `setDisplayMediaRequestHandler` 和 `capturePage` 的依赖。只对迁进舞台的样式有效，其余样式保留现在的抓屏导出。
- 样式选择器里的预览图由舞台离屏出图。

整件事是按季度算的工作量。第 0–2 阶段是决定要不要继续的部分，建议只先批这三段。

### 风险

| 风险 | 应对 |
|---|---|
| 迁移后观感和原样式有差别 | 每个样式一个 PR，截图对比 + 维护者看过；旧实现在该样式过关前不删 |
| wgpu 的 WebGL2 后端能力有限 | 引擎从第一天按 WebGL2 的下限写；第 1 阶段先行验证 |
| Worker 里拿不到的东西（DOM、`queryLocalFonts`、MotionValue） | `scene.ts` 规定为无 DOM 的纯 TS；字体字节和离散事件由主线程传 |
| 迁移期间两条路径并存 | 以样式为单位切换，登记表里有 `stage` 字段就走舞台，没有就走旧路径，不设全局开关 |
| 贡献者和模组作者要学新写法 | 模组样式的契约不变；内置样式的写法写进 `visualizer/README.md` 的「加一个歌词动画样式」 |
| 推理和画面抢显卡 | 两者都是页面内的 WebGPU，调度层已有让路机制，改成读舞台的掉帧报告 |

### 不重构也能先做的

调查里顺带看到的一处：`usePlaybackVisualizerBridge.ts:259` 每帧 `new Uint8Array(bufferLength)` 读频谱，可以改成复用一个缓冲。

---

## 三、能不能去掉 Electron

### Electron 现在提供什么

`electron/` 4.3 万行，`ipcMain` 注册 139 处（通道登记表 137 条），preload 暴露约 220 个函数，渲染进程 105 个文件碰 `window.electron`。

| 能力 | 现在怎么做 | 换系统 webview 要怎么办 | 难度 |
|---|---|---|---|
| 画面内核 | 锁定的 Chromium（Electron 43） | Windows 是 WebView2（Chromium，但版本跟系统走；要锁版本就得随包带固定版本的运行时，体积回到原处）；macOS 是 WKWebView；Linux 是 WebKitGTK | 高 |
| 平台后端 | 8 个音乐平台的 npm 库跑在主进程的 Node 里（网易云在 worker 线程，QQ 的库一 require 就起 HTTP 服务），多处替换库的内部文件 | 这些库只有 JS 版，重写成 Rust 不现实；要带一个 Node 运行时当子进程 | 中，但 Node 去不掉 |
| 媒体 | 6 个自定义协议（含 `folia-ytm`、`folia-spotify` 边解密边流式播放）；`webRequest` 给 QQ、酷狗等 CDN 的响应补 CORS 头，Web Audio 才读得到 | 系统 webview 改不了响应头，自定义协议的流式支持各家不一；要改成本机流式代理 | 中 |
| 壁纸模式 | 取原生窗口句柄挂到桌面层；鼠标用 `webContents.sendInputEvent` 注入（文档里写了直接发 `WM_MOUSE*` 行不通） | WebView2 要改用合成宿主模式的 `SendMouseInput`；WKWebView 没有公开的注入接口；每个平台单独写 | 高 |
| 视频导出 | `setDisplayMediaRequestHandler` 抓自己的页面；模组导出用 `capturePage` | 没有对应接口。第 5 阶段把导出挪到舞台后才不依赖它 | 高（做完第 5 阶段后降为低） |
| YouTube 解签沙箱 | 隐藏窗口，会话级拦截 `https`，跑 YouTube 的播放器脚本 | 换成内嵌 JS 引擎，或各平台 webview 的请求拦截（WKWebView 拦不了 https） | 中 |
| 分析子进程 | `utilityProcess` 跑 MNN | 普通子进程 | 低 |
| 网络 | `session.setProxy` / `resolveProxy` / `net.fetch` 跟系统代理（含 PAC） | 自己实现系统代理解析；用户里走代理的很多，行为不能变 | 中 |
| 凭据 | `safeStorage`，约 19 个文件 | 系统钥匙串；老用户的密文要按 Chromium OSCrypt 的格式解出来迁走，否则所有平台全部重新登录 | 中 |
| 渲染进程的存储 | localStorage、IndexedDB 在 Chromium 的 profile 里 | 换内核后读不到。要先发一个 Electron 版本把数据导出，新壳再导入 | 中 |
| 媒体键 | `navigator.mediaSession`，靠 Chromium 内置的 SMTC / MPRIS / MediaRemote | WebView2 有；WKWebView、WebKitGTK 的行为要逐个验证 | 低到中 |
| 托盘、缩略图按钮、全局快捷键、单实例、自动更新（仅 Windows） | Electron API | Tauri 插件或自己写，Wayland 的全局快捷键要自己接 portal | 中 |
| 渲染进程用到的 Chromium 独有接口 | File System Access、`setSinkId`、`queryLocalFonts`、`getDisplayMedia`、WebGPU | WKWebView、WebKitGTK 大多没有，要走原生桥 | 中 |

已有的先例：Apple Music 已经是独立的原生程序加系统 webview（macOS 用 WKWebView，Windows 用 WebView2），
主程序通过子进程管道控制它。这是「只给一个功能用系统 webview」，它成立是因为那个 webview 只负责登录和 DRM 播放，不画界面。

### 去掉之后能得到什么

- **体积**：Windows 安装包 251 MB。两个模型 133 MB（fp16 权重，基本压不动），占 53%。
  Electron 自身估计在 90–100 MB（未拆包验证）。去掉 Electron 后要带回一个 Node 运行时（估计压缩后 25–30 MB），
  净省约 60–70 MB，约四分之一。
- **内存**：WebView2 同样是多进程的 Chromium（浏览器进程、GPU 进程、渲染进程），常驻内存和 Electron 是一个量级。
  macOS、Linux 上 WebKit 的基线更低，但那两个平台合计只占下载量约 16%。
- **画面性能**：Windows 上是同一个内核，不变。macOS、Linux 上换成 WebKit，对这套画面代码是未知数；
  WebKitGTK 没有确认的 WebGPU 支持，WKWebView 要 macOS 26 才默认有。
- **失去的**：内核版本锁定。现在遇到 Chromium 的问题（字形缓存漏 fd、瓦片内存、GPU 崩溃）可以按一个确定的版本定位和绕开；
  换成跟系统更新的 WebView2 后，同一个版本的 Folia 在不同用户机器上是不同的内核。

v0.7.27 发布两天的下载量：Windows 安装包 33,360，macOS 四个包合计 5,114，Linux 六个包合计 1,375
（不含网盘和 AUR）。Windows 约 84%。

### 四种走法

| 走法 | 判断 |
|---|---|
| 1. 整个应用换系统 webview（Tauri / wry）+ Node 子进程 | **现在不做**。上表「高」的四项都要重做，三个内核各适配一遍，换来四分之一的体积。Windows 上性能不变 |
| 2. 原生界面 + 只给关键组件用 webview | **不可行**。约 18 万行界面代码用原生界面库重写；网页版、Docker 版、模组（模组是在页面里跑的 JS，能加面板页签和舞台层）仍要 React 那一套，等于两套界面 |
| 3. 原生壳 + 原生 wgpu 舞台 + webview 画其余界面 | **不做**。`backdrop-filter` 采样不到原生表面，约 70 个文件的毛玻璃效果要换成「页面上报矩形、原生一侧模糊」的协议，动画时两边差一帧；视频导出、壁纸模式、透明窗口都要对两层分别处理；Linux 上透明 webview 叠原生表面没有查到可靠的先例 |
| 4. 留在 Electron，减少对它的依赖（**推荐**） | 见下 |

用 CEF 当运行时（Tauri 在做 CEF 运行时）能保住 Chromium 的版本锁定，但 CEF 的体积和 Electron 相当，
主进程 4.3 万行照样要重写，没有净收益。

### 留在 Electron 期间做什么

只做本身有独立收益的，不为换壳提前付钱：

1. **视频导出挪到舞台**（第 5 阶段）。独立收益：离线出图、不受窗口和性能限制、Wayland 可用。附带去掉两个最难替代的 Electron 接口。
2. **平台后端挪进一个不 `require('electron')` 的 Node 子进程**。独立收益：被改过内部文件的第三方库不再和窗口管理、IPC
   跑在同一个进程里，它们卡住或崩溃不拖垮主进程。附带让后端可以原样带到任何壳里。要先解决的是这些库现在经
   `electronNet` 走系统代理：代理由主进程解析后传给子进程。
3. 舞台本身。迁完后画面只依赖一个引擎的 WebGPU / WebGL2，不再依赖 Chromium 对多张画布和 CSS 滤镜的合成行为，
   这是以后换内核时最大的一块未知数。

### 什么时候重新评估

同时满足时再看走法 1：

- 舞台迁完主要样式（第 3 阶段结束），导出已不抓屏（第 5 阶段）；
- 平台后端已在独立的 Node 子进程里；
- WebKitGTK 有可用的 WebGPU，或者决定 Linux 版继续用 Chromium 内核；
- macOS 的最低支持版本到了 26（WKWebView 默认有 WebGPU）；
- 壁纸模式的鼠标注入在 WebView2 合成宿主模式下做过原型，行得通。

到那时走法 1 剩下的是壳本身的工作量（窗口、托盘、快捷键、更新、凭据和存储迁移），可以单独估。

---

## 外部事实的出处

- Electron `sharedTexture` 模块（experimental，把共享纹理句柄导入成 `VideoFrame`）：<https://electronjs.org/docs/latest/api/shared-texture>
- wry 的 wgpu 示例（原生表面 + 同窗口子 webview）：<https://docs.rs/crate/wry/latest/source/examples/wgpu.rs>
- WebGPU 各浏览器实现状态（Safari 26 / macOS 26 默认开启；Linux 仍在进行）：<https://github.com/gpuweb/gpuweb/wiki/Implementation-Status>、<https://web.dev/blog/webgpu-supported-major-browsers>
- WKWebView 的 WebGPU 跟随系统默认值，不受 Safari 的功能开关影响：<https://developer.apple.com/forums/thread/770862>
- WebKitGTK 2.50 的更新说明未提 WebGPU：<https://webkitgtk.org/2025/11/26/webkitgtk-2.50.html>
- WebView2 合成宿主模式与 `SendMouseInput`：<https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2compositioncontroller>
- cef-rs（Tauri 组织下的 CEF 绑定）：<https://github.com/tauri-apps/cef-rs>
