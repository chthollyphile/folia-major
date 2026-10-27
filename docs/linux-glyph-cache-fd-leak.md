# Linux 下长时间播放后歌词动画卡死 — 字形缓存 fd 泄漏

> 状态（2026-09-26）：已定位、已修复。修复挂在实验室开关「修复 Linux 歌词动画卡死」（`utils/glowBlurQuantize.ts`，
> 存储键 `visualizer_glow_blur_quantize`）上，Linux 默认开启，其它平台默认关闭。调查过程和全部实测数据不在仓库里。

## 1. 现象

Linux 上播放约 30–40 分钟后，歌词动画定格，画面不再更新（音频照常）。renderer 与 GPU 进程的 fd 数随播放线性增长，
约 0.4–0.9 fd/s；增量全部是 `/dev/shm/.org.chromium.Chromium.*`，每个 4 KiB，并各带一条内存映射。renderer 的
fd 软上限是 1024，耗尽后共享内存分配失败，合成器停止出帧。Windows / macOS 同样在涨，只是没有这么低的上限，
代价是每天几 MB。

排查时看 调试 > 内存监视器：Linux 上会画出 renderer / GPU 进程 fd 数的曲线，按进程表里也有 fd 列。
播放时两条曲线持续上升，就是这个问题。

## 2. 原因

Chromium（GPU 光栅化）按 strike 缓存字形，strike 的 key 包含字体、字号、设备缩放和 mask filter（带模糊的阴影
就是一个 mask filter，其 sigma 在设备空间里计）。每个新 strike 在 renderer 里拿一个 discardable handle，handle
按 4 KiB 一块的共享内存分配，块不归还。所以只要动画每帧给出一个新的组合——模糊半径在变，或者设备字号在变——
就不断新建 strike，大约每一千个新组合多一个 fd。

在本项目里触发它的写法：

| 写法 | 出处 |
|---|---|
| framer-motion 把 `text-shadow` 从 `none` 插值到 `0 0 20px c`（半径逐帧变化） | classic、partita 的逐字发光 |
| 逐字 `text-shadow`（半径取整也不行）叠加逐帧变化的 `scale()` | claddagh |
| 固定 40px `text-shadow`，但外层逐帧改 `scale()` 且不是合成层（每帧按新尺寸重画） | cadenza 叠加词 |
| canvas `shadowBlur` 跟随音频 / 进度连续变化 | fume、cadenza、claddagh 的 canvas 发光 |

以下写法不触发：半径固定只动颜色 alpha；`steps()` 这类只取有限个值的半径动画；`filter: drop-shadow()` / `blur()`
（合成器或图层滤镜，不经过字形缓存）；合成层上由合成器执行的 transform 动画。

升级 Electron（44.4.5）或换到上游 Chromium 152 都一样，属于 Chromium 本身的行为。

## 3. 修复

开关开启时：

- **classic、partita**（`visualizer/wordGlow.ts`）：逐字发光改为发光层把字形画成高亮色，再加两层
  `filter: drop-shadow()`，半径可以连续动画。半径和 alpha 按像素差拟合原来的 `text-shadow`（半径 × 0.4，内层
  alpha 0.7）。`passed` 变体必须显式保留 `color`：framer 会把新变体没写的键立刻重置成 `initial` 的 transparent，
  字形透明就没有阴影可投。
- **claddagh**：逐字发光改成 filter 链 `drop-shadow(...) blur(...)`（先投影再模糊，与原来的绘制顺序一致）。单层
  取 text-shadow 半径 × 0.5；副歌三层取 × 0.4、中间层 alpha × 0.2（链式 drop-shadow 会互相叠加）。字形本身带
  alpha，drop-shadow 会再乘一次，所以阴影颜色只带 `shadowFade`。
- **cadenza**：叠加词外层加 `will-change: transform`，提升为合成层，栅格化缩放不再逐帧变化。这一项后来改为所有平台
  都开启、不再跟随开关：它不改变外观（与非合成层逐像素对比只有字形边缘抗锯齿的差别），在 120 Hz 的 Mac 上还让
  光栅化线程从约 150 ms/s 降到约 50 ms/s。
- **canvas 模糊半径**取整到整数像素（`quantizeShadowBlur`）。
- **fume**：
  - 当前行的文字发光改用 `ctx.filter = drop-shadow(shadowBlur / 2)`（`setCanvasTextGlow`；canvas 的 shadowBlur
    是两个 sigma，drop-shadow 是一个，二者都不随 CTM 缩放），并用 `fillGlowText` 把绘制 clip 到文字附近——canvas
    滤镜按 clip 大小开图层，不 clip 时整行发光每帧对整张画布做滤镜，会从 120 掉到约 90 fps。
  - 当前行原本在连续缩放的相机变换下 `fillText`，只改发光仍残余约 0.06 fd/s。现在由原来的绘制代码画进离屏 canvas
    （`fume/fumeLiveRaster.ts`）：只画屏幕内部分，栅格化缩放取当前设备缩放之上的最近一档（每倍频程 48 档），再
    `drawImage` 到舞台上，缩小不到 1.5%。相机仍然连续，只有纹理的像素密度分档。直接把相机缩放取整（1/32、1/64）
    也不泄漏，但镜头会明显跳动。
  - 静态块快照 15 秒未用即释放（不受开关控制）。

  曾用 Pixi 重写 fume 的渲染层做对比：同样不泄漏，但比 canvas 版多约 85 MiB 显存（i915 DRM），renderer 主线程
  只少 4 个百分点、GPU 进程多 10 个百分点，因此没有采用。

默认只在 Linux 开启：drop-shadow 的外观与原来非常接近但不完全相同，而其它平台上这个泄漏的代价很小。

不改变任何视觉效果的另一条路是提高上限：systemd 的 `DefaultLimitNOFILE`（用户会话的 FD 软上限）和
`vm.max_map_count`（每个泄漏的 fd 还带一条内存映射，很多发行版默认 65530，约 30 小时耗尽）。泄漏仍在继续，
只是远到用不完。面向用户的步骤在文档站的「Chromium FD 耗尽问题」（`guide/chromium-fd-exhaustion`），
实验室开关的说明链接到那里。

## 4. 实测（renderer fd/s，monet 背景，120 fps，每项 180 秒）

| 模式 | 修复前 / 开关关闭 | 开关开启 |
|---|---|---|
| classic | 0.835 / 0.925 | -0.003 |
| partita | 0.802 | -0.009 |
| cadenza | 0.129 / 0.111 | 0.002 |
| claddagh | 0.558 | -0.003 |
| fume | 0.575 / 0.609 | -0.001 |

fume 开关开启后，renderer 主线程 CPU 从约 55% 降到约 32%（单核百分比）：原来每帧都要为新尺寸生成带阴影的
字形遮罩，档位制下字形尺寸有限、缓存可以复用；这部分工作换到了 GPU 进程（多约 20 个百分点）。与改动前相比显存
少约 22 MiB，renderer PSS 多约 25 MiB。

## 5. 写新动画时

- 不要逐帧改变文字阴影的模糊半径（`text-shadow`、canvas `shadowBlur`）。要"扩散"效果用 `filter: drop-shadow()`，
  或者让半径只取有限几个值。
- 不要让带阴影的文字按连续变化的设备尺寸重新栅格化：DOM 上逐帧改 `scale()` 的文字要么是合成层（`will-change:
  transform`），要么不带 `text-shadow`；canvas 上不要在连续变化的缩放下画字，先按有限档位栅格化（参照
  `fumeLiveRaster`）。
- 新的缓解手段挂到同一个开关上（`isGlowBlurQuantized()`），关闭时保持原样。
- 验证：Linux 上打开内存监视器，播放几分钟，renderer / GPU 进程的 fd 曲线应当是平的。
