# 调查计划：Linux 下播放时 renderer fd 持续泄漏

> 给 Claude Code 的执行计划。在一台能打开 Folia 窗口的 Linux 桌面机上执行（Hyprland / KDE 均可）。
> 开始前先读仓库根目录的 `AGENTS.md`，按其中的项目规则工作。

## 目标

找出播放期间 renderer 与 GPU 进程 fd 数量持续增长的**真正原因**，并落到以下两种结论之一：

- **A. 应用代码触发**：定位到具体文件和写法，给出修复并验证泄漏停止；
- **B. Chromium / Electron 自身缺陷**：给出一个不依赖 Folia 的最小复现页面，确认当前 Electron 版本是否已修复，整理成可提交到 crbug 的报告。

PR #428（启动脚本抬高 fd 上限）只是兜底，不算根因修复。

## 已知事实（来自 PR #428，尚未独立复现）

- 播放时 renderer 与 GPU 进程各以约 0.4–0.9 个/秒的速度增加 fd，每个对应一块 4 KiB 共享内存。
- PR 作者的判断是"栅格化路径的 transfer buffer 只注册不销毁"，触顶后日志出现
  `CommandBufferHelper::AllocateRingBuffer() failed`，画面停住，但进程仍在运行，音频照常播放。
- 原版 Arch 上 soft 上限是 1024，约 35 分钟触顶。Omarchy 通过 systemd drop-in 把 soft 设成 65536，
  所以在 Omarchy 上要约 36 小时才触顶。**但泄漏本身应当照样发生，所以在 Omarchy 上同样能调查。**
- Electron 版本：`package.json` 中 `electron ^43.3.0`。
- `electron/main.cjs` 在 Linux 上会调用 `appendSwitch('disable-features', 'Vulkan')`、
  `ozone-platform-hint=auto` 等。**`base::CommandLine` 每个开关只保留一个值**，所以在命令行上传入的
  `--disable-features=...` / `--enable-features=...` 会被覆盖。要做基于 feature 的实验，
  必须临时修改 `main.cjs`，把 feature 合并进去（参照其中的 `appendChromiumFeature` 写法）。
  普通开关（如 `--disable-gpu-rasterization`）可以直接从命令行传入。

## 约束

- 所有实验性改动放在单独的分支 `investigate/fd-leak` 上，不要合并进 main。
- 测量脚本和结果放在 `dev/fd-leak/` 下。结果写入 `dev/fd-leak/RESULTS.md`，**每做完一组实验立即追加**，
  上下文被压缩后也能接着做。
- 需要用户在界面上操作（切换可视化模式、播放、最小化窗口等）时，明确告诉用户要做哪一步，等用户确认后再计时。
  不要猜测界面状态。
- 需要 `sudo` 的步骤（strace / perf / bpftrace）先征求用户同意。
- 不要为了让实验"跑通"而抬高 fd 上限，那样会掩盖问题。

## 第 0 步：准备

1. `git switch -c investigate/fd-leak`
2. 确认能用开发方式启动接近生产环境的构建：`npm run dev:electron:dist`（vite build 之后运行 `electron .`）。
   另外确认可以带额外参数启动，例如 `npx electron . --disable-gpu-rasterization`，需要时写一个小的启动脚本。
3. 记录环境信息到 `RESULTS.md`：发行版、桌面环境 / 合成器、GPU 型号与驱动、Wayland 还是 X11、
   `ulimit -Sn` / `ulimit -Hn`、Electron 版本（`npx electron --version`）。

## 第 1 步：测量工具

写 `dev/fd-leak/fdwatch.sh`（POSIX sh 即可），要求：

- 每 N 秒（默认 10）找出 Folia 的 renderer 与 gpu-process 进程
  （用 `/proc/<pid>/cmdline` 中的 `--type=renderer` / `--type=gpu-process` 识别，只取 Folia 的进程）；
- 输出 CSV：`时间戳, pid, 进程类型, fd 总数, 按目标分类的计数`。分类方法：对 `/proc/<pid>/fd/*` 取
  `readlink`，把数字和 `(deleted)` 去掉后归类（例如 `memfd:…`、`/dev/shm/.org.chromium…`、`socket:`、`anon_inode:…`）；
- 结束时（Ctrl-C 或到达指定时长）打印每个进程的**增长速率（fd/秒，用线性回归或首尾差计算）**；
- 另外写一个小工具，列出新增 fd 的大小：`stat -L -c %s /proc/<pid>/fd/<n>`，用来确认是不是 4 KiB。

再写 `dev/fd-leak/run-trial.sh <名称> <秒数> [额外 electron 参数...]`：启动应用，提示用户完成操作，
然后运行 fdwatch 指定时长，把 CSV 存为 `dev/fd-leak/trials/<名称>.csv`，并把速率追加到 `RESULTS.md`。

**完成标准**：在默认设置下播放 5 分钟，能测出一个稳定的增长速率。
如果速率约等于 0，说明本机不复现：先记录下来，再向用户询问报告者用的可视化模式和设置，照那套设置重试。

## 第 2 步：缩小范围

所有实验都用**同一首歌、同一窗口尺寸、同一帧率设置**，每组至少 3 分钟，
与第 1 步的基准速率对比。按下表顺序执行，每一行填一次结果：

| # | 条件 | 如果泄漏停止或明显变慢，说明 |
|---|---|---|
| 1 | 暂停播放、窗口保持可见 | 和出帧或动画有关 |
| 2 | 播放中把窗口最小化或切到别的工作区 | 和实际绘制或合成有关 |
| 3 | 逐个切换内置可视化模式：`classic` `cadenza` `partita` `fume` `monet`（见 `src/types.ts` 的 `BuiltinVisualizerMode`），以及已安装的 mod 模式 | 问题在某个模式里 ← **最关键** |
| 4 | 同一模式下切换背景（如 FluidBackground、tempera 图层等）或关闭背景 | 问题在背景层 |
| 5 | 可视化帧率设置：`off` / 60 / 90 / 120（`VisualizerFrameRate`） | 速率随帧率线性变化 → 每帧都泄漏一次 |
| 6 | `--disable-gpu-rasterization` | GPU 栅格化路径 |
| 7 | `--disable-accelerated-2d-canvas` | 加速 Canvas 2D |
| 8 | `FOLIA_LINUX_GRAPHICS_MODE=swiftshader` / `software`（已有的 npm 脚本） | GPU 驱动 / 硬件路径 |
| 9 | `--ozone-platform=x11`，与 `wayland` 对比 | Wayland 相关 |

判断规则：

- 只有某个模式或某个背景泄漏 → 进入第 3 步 A（应用代码）。
- 速率和帧率成正比 → 每帧一次，重点找"每帧都新建"的资源。
- 所有模式都泄漏，但第 6 或第 7 项能止住 → 仍然先做第 3 步 A，找出触发这条路径的写法；同时准备第 4 步。
- 暂停后仍然泄漏 → 和绘制无关，查定时器、音频可视化分析、IPC 等非绘制路径。

## 第 3 步：定位

### A. 在应用代码里二分（优先）

在第 2 步锁定的模式或背景里，逐层注释掉或跳过子层，每次都用 run-trial 测速率，直到找到最小的触发单元。
优先检查这些直接操作 canvas 或位图的文件：

- `src/components/visualizer/backgrounds/common/FluidBackground.tsx`
- `src/components/visualizer/monet/monetBackgroundPipeline.ts`、`monetLyricsModel.ts`、`MonetLyricsRail.tsx`
- `src/components/visualizer/tempera/createTemperaPixiRuntime.ts`、`src/services/temperaLayerImages.ts`
- `src/components/visualizer/diorama/dioramaTextRaster.ts`
- `src/components/app/lattice/lyrics/latticeLyricRaster.ts`
- `src/components/visualizer/fume/VisualizerFume.tsx`
- `src/components/visualizer/classic/Visualizer.tsx`、`partita/VisualizerPartita.tsx`（`blur` / `backdrop-filter` 用得多）
- `src/utils/colorExtractor.ts`

重点排查以下写法：

- 每帧 / 每句歌词都 `document.createElement('canvas')` 或 `new OffscreenCanvas(...)`，用完不复用；
- 每帧给 `canvas.width` / `canvas.height` 赋值（即使数值没变，也会重建底层缓冲）；
- `createImageBitmap(...)` 的结果从不调用 `.close()`；
- 频繁 `getImageData` / `putImageData` / `toDataURL` / `toBlob` 回读 GPU canvas；
- Pixi / WebGL：纹理、RenderTexture、Graphics 只创建不 `destroy()`；
- 每帧变化的 `filter: blur()` / `backdrop-filter` / `will-change` 让合成器每帧新建图层。

同时用 `rg` 搜全仓库有没有同类写法，确认修复没有漏掉。

### B. 抓分配时的调用栈（A 走不通或需要佐证时使用，需要 sudo）

- `sudo strace -f -k -e trace=memfd_create,close -p <renderer pid>`：拿到每次新建共享内存的调用栈；
- Electron 二进制去掉了符号表：从 Electron 的 GitHub Release 下载同版本的
  `electron-v<版本>-linux-x64-symbols.zip`，解压后让 strace / gdb 能找到符号；
- 或者用 DevTools / Perfetto 录 10–20 秒 trace，勾选 `gpu`、`cc`、`viz` 类别，
  看每帧是否都有新的 transfer buffer / shared image 被创建。

## 第 4 步：判断并收尾

**如果是应用代码（结论 A）**

1. 写出最小修复（复用 canvas、补上 `.close()` / `destroy()`、避免每帧重设尺寸等）；
2. 用 run-trial 在同样条件下复测，速率应当接近 0，然后在 soft 上限 400 的情况下
   （`ulimit -Sn 400` 后启动 `electron .`）持续播放 30 分钟，确认画面不再停住；
3. 能写单测的写单测（例如断言资源被复用或释放），按 `skills/testing-strategy/SKILL.md` 决定要跑哪些测试；
4. 把修复整理成干净的提交，放到一个从 main 新开的分支上，不要带上实验性改动。

**如果是 Chromium / Electron（结论 B）**

1. 写一个不依赖 Folia 的最小 HTML 页面（例如一个持续动画的 canvas，加上第 2 步里定位到的特征），
   用纯 Electron（`npx electron@<当前版本>` 加上最小的 main.js）确认能复现；
2. 用最新的 Electron 稳定版复测，如果已修复，就记录修复它的版本，给出升级建议；
3. 去 crbug.com 搜索现有 issue，没有的话整理一份报告草稿（环境、复现页面、速率数据、调用栈），
   交给用户决定是否提交；
4. 在应用侧找出能避开这条路径的写法（第 2 步中能止住泄漏的条件），评估是否值得采用。

## 附带改进（任何结论下都做）

在 `electron/debug/memoryMonitor.cjs` / `debugHost.cjs` 的采样里，Linux 上为每个进程增加 fd 数量
（数 `/proc/<pid>/fd`，pid 取自 `app.getAppMetrics()`），让以后用户打开"设置 > 开发者"里的内存监视器
就能看到 fd 曲线。按仓库规则补上单测。这个改动单独成一个提交。

## 交付物

- `dev/fd-leak/RESULTS.md`：环境、每组实验的条件与速率、结论、依据；
- `dev/fd-leak/fdwatch.sh`、`run-trial.sh`；
- 结论 A：修复分支和测试；结论 B：最小复现、Electron 新版复测结果、crbug 报告草稿；
- 内存监视器的 fd 采样改动；
- 最后给用户一段简短总结：根因、证据、修复或下一步、PR #428 是否仍需保留。
