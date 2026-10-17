# 分析服务重构计划（搁置中）

<!-- docs/analysis-service-plan.md
     2026-10-17 与用户讨论定下的方向，用户说「先放一放」。动手前先回来读这份，并确认末尾「待定」三条。 -->

## 起因：现在的浪费

智能动感模式（beat FX）和 automix 各跑各的分析，同一首歌会被重复处理：

| 浪费 | 现状 |
|---|---|
| 读文件、解码 | 拍点、automix 分析、鼓轨各读各解，一首最多解码 3 次 |
| 拍点 | automix 用 final0（下载），智能动感用 small0（内置），同一首跑两遍 |
| htdemucs | automix 在 CPU（MNN）上分头尾各 30 秒的四轨（`services/automix/stems.ts`，只在内存里）；智能动感在 GPU 上整首再分一遍，只留鼓轨（`services/analysis/drumStem.ts` → `drumHits.ts`） |
| 显存 / 内存 | 两边各自常驻，没有统一预算。GPU Worker 空闲 2 分钟才释放（`beatThisGpu.ts` `IDLE_MS`），开着 automix 时它几乎不空闲，htdemucs 约 370 MB 显存一直在；automix 的 CPU 分离峰值约 530 MB，两边同时跑约 1.1 GB |

现在两者一起用不会算错：GPU 任务在 `beatThisGpu.ts` 的 `queue` 里串行，节拍时钟和鼓点都跟显示中的那首和它的 deck（`usePlaybackVisualizerBridge.ts` `getDisplayElement`），过渡时不会错位。问题只有互相等待和重复计算。

## 目标架构：一个分析服务，两个执行器

```
  automix ──┐                    ┌─ GPU 执行器（现有渲染进程 Worker，beatThisGpu.worker.ts）
            ├─> 分析服务 ────────┤    beat_this final0/small0、htdemucs 四轨
 智能动感 ──┘   去重 · 缓存 · 排队 └─ CPU 执行器（现有 MNN 子进程，electron/analysis）
                                      beat_this final0、htdemucs，只作后备
```

- 功能只提需求（这首的拍点 / 鼓点 / 结尾 30 秒四轨）和紧急程度，不管模型和在哪跑。
- 服务按「歌的分析 key + 数据种类」查缓存 → 有没有正在跑的同一个任务（有就等同一份）→ 都没有才排队。
- 执行器只有两个，GPU 优先、CPU 后备；智能动感仍只走 GPU，automix 没有 GPU 时照旧走 CPU。

两条复用规则：

1. **顺带的结果也要留**：GPU 上的 htdemucs 本来就算出四轨。整首分离时，鼓轨照旧变成鼓点存盘，同时把头尾各 30 秒的四轨按 16 位存下（每段约 21 MB，就是 automix 要的那份），automix 过渡时直接拿。
2. **拍点用装了的最好模型**：装了 final0 就只跑 final0、两边共用，没装才用 small0。代价是商籁和镜台的拍点从 small0 换成 final0，画面会有细微不同；时计只用鼓点，不受影响。

## 分阶段（每步可单独验证、单独回退）

| 阶段 | 内容 | 对 automix | 验证 |
|---|---|---|---|
| 1 | 统一读文件和解码：一首只读一次、只解一次，各功能共用（LRU） | 只换取音频的入口 | 单测 + automix 实测一轮 |
| 2 | 分析服务和统一队列：去重，按紧急程度排队，分段之间可插队；automix 赶过渡的任务优先 | 不改逻辑 | 单测 + 日志看等待时间 |
| 3 | 拍点复用（规则 2） | 结果不变，智能动感读它的 | 7 首拍点比对 |
| 4 | htdemucs 复用（规则 1）：automix 分轨请求先查头尾四轨缓存，没有再走 GPU，最后 CPU | 分轨来源变，用法不变 | GPU 四轨对 MNN 红线（每轨 ≤ 0.01 dB）+ automix 过渡实测 |
| 5 | 模型常驻：每个执行器一份预算，用完的模型按预算释放（含「鼓轨分完就释放 htdemucs」） | 无 | 实测内存 |

预计效果：解码 3 → 1 次；装了 final0 时拍点 2 → 1 次；有 GPU 的机器 htdemucs 2 → 1 次，automix 不再占 CPU 那约 530 MB 的峰值。htdemucs 的 GPU 模型内置进安装包后，有 GPU 的机器做 automix 也不必下载 190 MB 的 CPU 模型（`htdemucs-v3.mnn` 只留给没 GPU 的机器）。

## 相关、同样搁置中的事

- **htdemucs 打进安装包**：代码没改。要做的是：`modelPaths.cjs` 把 `htdemucs_gpu` 从 `MODEL_NAMES` 挪到 `BUNDLED_MODEL_NAMES`；从 `shared/modelManifest.json` 去掉它；照 `packaging/beat-this-small/` 写一个钉住 tag + sha256 的取文件脚本，并接进 `build/beforePack.cjs` 和 `build/fetchModels.mjs`；`package.json` 的 extraResources filter 加 `htdemucs-wgsl.bin`；`automix-models-present` 要能答内置模型；设置页去掉它的下载项；改 `options.beatEffectNeedsDrums` 文案和 `test/unit/electron/modelPaths.test.ts`。安装包大约 +92 MB。
- **上传**：新建公开仓库 `lantudou/folia-htdemucs-wgsl` 被自动模式拦了（没有绕过）。README、LICENSE（MIT，Meta）、SHA256SUMS 已备在 `~/.claude/jobs/ebf17ecc/tmp/htw-release/`（job 目录，删 job 会一起没）。文件：`htdemucs-wgsl.bin`，91838176 字节，sha256 `27d5331a74a4e23b18172b3d59d0378e698fd79bc0d0fed3316da77e3a37d8d1`，release tag 打算用 `htdemucs-wgsl-v1`。

## 待定（动手前问用户）

1. 拍点统一用 final0（装了的话）可以吗？
2. 阶段 3、4 会改 automix 拿数据的入口（逻辑不改），能接受吗？还是先只做 1、2、5？
3. htdemucs 内置是并进这次重构，还是先单独做完？上传由用户自己执行，还是给放行规则？
