# Automix 内存优化 — 诊断与方案

> 状态（2026-08-23）：诊断完成、方案定型、Phase 0＋1①＋**1③④** 已完成。**app 本体已改**：htdemucs 推理从 onnxruntime-node 搬到 Python sidecar（新增 `htdemucs_runner.py`/`sidecar.cjs`，改 `worker.cjs`/`modelPaths.cjs`/`package.json`），sidecar 输出与 runner 逐比特一致、缺件干净回退、27 单测全绿。**待做**：Phase 1②（运行时做成可下载件，代码可写＋单测；端到端测试等运行时 zip 上传到镜像）、Phase 2（app 内实测峰值＜1GB、健壮性、各态）。交付（PR）仅凭用户明确下令，绝不自行发起。
> 首选＝关掉 ORT 内存复用（`enable_mem_reuse=0`）→ 走 Python 旁挂进程 → 做成按需下载。
> 节奏：全做完 → 测试 → 确认稳定 → 再 PR。不赶。

## 目录
- [1. 结论](#1-结论)
- [2. 诊断事实](#2-诊断事实)
- [3. 峰值构成（第一性原理）](#3-峰值构成第一性原理)
- [4. 实测证据](#4-实测证据)
- [5. 方案](#5-方案) — 5.1 首选 · **5.2 备选（OpenVINO / 重导出）** · 5.3 已排除
- [6. 验收红线](#6-验收红线)
- [7. 执行计划](#7-执行计划)
- [8. 仓库归属](#8-仓库归属)
- [9. 后续可叠加优化（挂账）](#9-后续可叠加优化挂账)
- [10. 诊断工装去留](#10-诊断工装去留)

---

## 1. 结论

内存尖峰**只有一个来源**：人声分离 htdemucs 的单次推理（跑 CPU）。不是泄漏。那 ~2.7GB 里约 2GB 是 ORT "内存复用池"、**可关**；真正激活地板只 ~700MB。关掉 `enable_mem_reuse` 即把峰值砍到 <1GB，**输出逐比特不变、零质量风险**。坎：现用的 onnxruntime-node 设不了这个开关 → 用 Python 跑 htdemucs（唯一现成能设该开关的运行时），Python 运行时做成**按需下载**、不进安装包。

## 2. 诊断事实

主进程每 2 秒 `app.getAppMetrics()` 按进程采工作集，四组日志（Build/Packaged × 有/无缓存）一致：

| 观测 | 值 | 说明 |
|---|---|---|
| 换歌总内存尖峰 | 5760–6124 MB | 与缓存无关 |
| 尖峰归属 | worker.cjs（`Utility/node.mojom.NodeService`） | 全场唯一 >700MB 的进程 |
| htdemucs run 中 | ~2700 MB 持稳 / ~4680 MB 瞬时 | 峰值全在 `session.run()` 进行中 |
| 模型闲置 / 释放后 | 526–724 / 138–346 MB | idle 计时触发 `release()` |
| 平时地板 | ~1000–1200 MB | Electron 外壳固定开销 |
| 20 分钟净增长 | ≈ 0 | 锯齿落回同一地板，**无泄漏** |

> **代码注释里的"530MB"是采样盲区**：worker 只在 run 前/run 后/闲置三处采 rss，**从不在 run 进行中采**，而峰值全在 run 中。`enableCpuMemArena:false` 压的是驻留、不是 run 中激活。以外部 2 秒采样为准。

## 3. 峰值构成（第一性原理）

- **原子单位＝一段 7.8s（`SEGMENT=343980`）的一次前向。** 段长焊死在 .onnx（探针实测拒收别的长度；demucs-onnx 架构 `self.segment=Fraction(39,5)`），运行时不可改。
- **构成（以 -chunked 数量级拆）**：权重驻留 ~333MB ＋ **真实同时存活激活 ~350MB** ＋ **ORT 复用池 ~1600MB（reuse=1 时规划器攥住、可关）**。→ 大头是可关的复用池，不是激活。
- **不叠加**：30s 窗口切 ~5–6 段逐段 `run`，窗口/两首歌间单队列串行，峰值永远只一段。
- 落系统内存，因 htdemucs 跑 CPU（`PROVIDERS.htdemucs=[]`）。

## 4. 实测证据

**维护者（chthollyphile，-chunked / arena 关 / 4 线程）——决定性一组：**

| mem_pattern | mem_reuse | 峰值 | 耗时 |
|---|---|---|---|
| 1 | 1（默认） | 2282 MB | 1.64s |
| 1 | **0** | **683 MB** | 1.56s |
| 0 | 1 | 2236 MB | 1.71s |
| 0 | **0** | **566 MB** | 1.67s |

**维护者横向对比（同段测试，节选，支撑 §5.2 备选）：**

| 运行时·模型 | 峰值 | 闲置 | 单段 |
|---|---|---|---|
| ORT·node · -final · arena 开（≈现状） | 4972 | 4972 | 1.58s |
| ORT·node · -final · arena 关 | 2616–3860 | 333 | 1.67–1.89s |
| ORT·node · split3 · arena 关 | 1096–1239 | 545–660 | 1.85–2.13s |
| OpenVINO·node · -portable | 977–998 | 977–998 | 1.22–1.47s |

**我们 Phase 0（本地 Python ORT 1.29，线上 fp32 htdemucs.onnx，run 中每 8ms 采峰值）：**

| pattern | reuse | 峰值 | 单段 |
|---|---|---|---|
| 1 | 1（≈现状） | **2543 MB** | 2.12s |
| 1 | **0** | **790 MB** | 3.16s |

- reuse=1 的 2543MB 与 app diag 的 ~2.7GB 吻合（交叉验证）；**reuse=0 → 790MB，破 1GB（降 3.2×）**。
- pattern 单独无用；决定性的是 reuse——与维护者一致。
- **输出逐比特对比：`bit_identical=True, max_abs_diff=0.0`** → 零质量风险，免盲听。
- 代价：reuse=0 单段 +1s。htdemucs 无 deadline（分钟级提前量），不可见。

## 5. 方案

### 5.1 首选：`enable_mem_reuse=0` ＋ Python 旁挂（已选）

- **做什么：** htdemucs 会话设 `enable_mem_reuse=0`（仅此，不碰 beat_this）。
- **为什么非 Python：** 该开关是 ORT **内部 C++ struct 的 bool**，只有 Python pybind 直接绑到它；onnxruntime-node（1.27）无此字段、`extra` 仅 WASM、C-API 无 setter；自编 C++ 二进制会撞同一堵墙。→ **Python 是唯一现成、不自编就能设该开关的运行时。**
- **交付＝按需下载（不进安装包）：** app 早已把模型做成按需下载——`shared/modelManifest.json` 声明可下载件 → `%APPDATA%\Folia\models\`，走 hf-mirror→hf→github 多线 ＋ 网盘兜底（提取码），设置页 `AutomixModelsSection` 管，`modelCanRun()`＝磁盘在不在。**Python 运行时当作再加一个可下载件挂进这套系统**（~80–150MB，与 htdemucs 同量级）；stems 门＝htdemucs.onnx ＋ 运行时都在，缺则退普通交叉淡入。

### 5.2 备选（form B 稳不住时的保底，两条都能到 ~1GB）

- **OpenVINO（最轻的保底）：** ~977MB（§4 横表），同图不同引擎、质量基本安全。三个代价：① beat_this 与它同运行时，OV **上不了 N 卡** → beat_this 掉 GPU（有 deadline，风险）或两套运行时并存；② **闲置常驻 ~1GB 不还**（比 ORT 的 333MB 差）；③ 多一个 npm 依赖（openvino-node ＋ 模型转 OV IR）。
- **重导出缩短/动态段长：** 门槛已清——权重 `facebookresearch/demucs`、导出 `StemSplit/demucs-onnx`（`pip install 'demucs-onnx[export]'`，默认 fp32）。但段长焊死、**无 `--segment` 旗标**，缩段要改导出的 4 个 patch（STFT/segment/pos-embedding/MHA），是手术不是调参；缩段伤 transformer 上下文、**质量需盲听**。形态：A1 固定短段 / A2 动态轴（demucs-onnx README 称可导动态时间轴，但探针实测线上模型只认 343980，**矛盾待核**）。可叠在 mem_reuse 上更低（见 §9）。

### 5.3 已排除（不用）

| 方案 | 理由 |
|---|---|
| htdemucs 上 GPU | 撞可视化器换歌 ＋ 撞用户边听歌边打游戏（显卡被占）；与显存 2/4GB 无关 |
| 自编 onnxruntime-node/ORT fork | 要从源码编整个 ORT、每平台出二进制、每次升级重来；拿的是 Python 白送的同一数字 |
| int8/权重量化 | 只省权重、动不了激活；demucs-onnx 自述 fp16weights 运行时内存不变 |
| stock ort-node 调参 | reuse=1 最低也 2236MB（`extra`/pattern 都够不到 reuse），破不了 1GB |

## 6. 验收红线

1. **分离质量不降**——form B 靠 Phase 0 的逐比特一致证（免盲听）。
2. **beat_this 截止期不动**——它在 WebGPU、有 deadline，全程不碰。
3. **可视化器不卡**——分离撞每次换歌，不能让切歌掉帧。
4. **弱机兼容**——无运行时/无 WebGPU 时干净回退（现有 `pinnedToCpu` / 缺件退交叉淡入）。

## 7. 执行计划

- **Phase 0　证据　✅已完成**：Python 实测线上模型 reuse=0 → 790MB ＋ 输出逐比特一致（见 §4）。
- **Phase 1①　运行时包 ＋ runner　✅已完成**：把 uv 的 python-build-standalone（可整体搬走的独立 Python，非 embeddable）裁掉 tcl/tk/test/pip，塞 onnxruntime＋numpy，得**自足 sidecar 文件夹 137MB（裁后）/ 压缩下载 ~60MB**（对照：htdemucs 模型本身 158MB，同量级）。裸解释器（脱 venv、脱系统 Python）加载 onnxruntime 无碍。`htdemucs_runner.py` 把 worker.cjs 的切段/三角窗 overlap-add/归一逐行搬进 numpy，整段推理全落 Python 进程，Electron 侧完全不碰 ORT。**整窗峰值实测（同一会话，8/15/25/40s＝2/3/5/7 段）：933 / 944 / 962 / 986 MB**——[Phase 2① 悬案关闭]。**峰值近乎持平 ~960±30 MB、由「单段激活＋常驻权重」主宰、与窗口大小基本无关**；单段 795MB 只在窗口<7.8s（1 段）成立，真实歌曲窗口永远≥2 段 → 实际运行峰值就是 ~933–986MB，全程贴 1GB 线下方（余量仅 30–90MB）。地板＝权重驻留 ~450＋单段激活 ~450-500＋累加器 ~30-55MB。**没有便宜的余量杠杆**：实测「每段开新会话」更差（1288MB / 49s，重载权重 7 次、新旧会话瞬时叠加），持久会话既最省内存又最快。想再降只能走 §9 重导出缩段（质量风险、需盲听、已挂账）。
- **Phase 1③　worker 改 spawn sidecar　✅已完成**：htdemucs 整段推理搬出 onnxruntime-node，改由下载的 Python 运行时跑。落地文件：`electron/analysis/htdemucs_runner.py`（生产版，随 app 走、`asarUnpack` 解包，外部 python.exe 才读得到）、`electron/analysis/sidecar.cjs`（写临时文件→spawn→读回→切三轨的纯 Node 管道，含 120s 超时与 .part 原子落盘）、`modelPaths.cjs` 加 `resolveRuntime/runtimePresent`、`worker.cjs` 的 `runHtdemucs` 改为「查运行时＋权重都在→交 sidecar；缺任一→decline 回退」，并删掉已搬进 Python 的 JS 切段/三角窗/归一（PROVIDERS/IDLE_RELEASE 里的 htdemucs 死项一并清）。**worker 队列不变→永远只有一个 sidecar 存活→峰值保持单进程量级**；sidecar 退出即把内存全数还回（原来 30s idle-release 的活现在由「进程退出」干）。**验证**：① 30s 真实多段输入过 `sidecar.separate` 与 runner 直跑文件**逐比特一致**（顺序 drums/bass/vocals、长度、字节全对，maxdiff=0）；② `resolveRuntime` 有/无运行时分别正确解析/回 null（＝当前「有 htdemucs.onnx 无运行时」态干净回退）；③ 三个 .cjs `node --check` 过、27 个模型单测全绿。契约：flat float32 `[left,right]` 进 → `[drums.L/R,bass.L/R,vocals.L/R]` 出、总长走 argv。
- **Phase 1②　运行时做成可下载件　待做**：分两半——**(a) 代码**：manifest 加运行时条目（zip＋sha256，落地后解压到 `models/runtime/`）、modelStore 复用 `downloadTo`＋加解压、AutomixModelsSection 加第三行、`modelCanRun('htdemucs')` 改为「onnx＋运行时都在」；可独立写＋单测。**(b) 托管**：把裁剪版运行时打成 zip、算 hash、传到 hf-mirror/hf/github 三镜像（与现有模型同套，属你的 `folia-models` 仓库），端到端下载测试等这步。zip 由我们打好交付，上传是你的动作。
- **Phase 1④　beat_this 不动　✅已确认**：改动只碰 htdemucs 路径；beat_this 仍在 worker 内走 WebGPU，PROVIDERS 里只剩它一项，代码与调度未变。
- **Phase 2　测试＋稳定**：① 整窗峰值 <1GB **✅已在独立脚本验（40s 满窗 986MB）**，Phase 2 复测＝在 app 内接线后复现；② sidecar 崩溃/超时/被重启/用完释放；③ 各态（弱机/无运行时/下载失败/网盘兜底）；④ beat 不迟到、换歌不掉帧。
- **Phase 3　清理**：删诊断工装；整理 worker/manifest/UI 改动到「可交付」状态。
- **交付（PR）＝仅凭用户明确下令**：全做完、测好、确认稳定后**停在此处等命令**；PR/推送到上游 `chthollyphile/folia-major` 由用户拍板才执行，绝不由计划自动触发、绝不自行发起。审计整条分支范围后再推（见记忆 no-claude-attribution）。
- **分叉**：Phase 2 整窗仍破 1GB 或 sidecar 稳不住 → 退 OpenVINO；重导出仅全不行才回。

## 8. 仓库归属

- `origin` = `AZURE-HUAI/folia-major`（你的 fork）；`upstream` = `chthollyphile/folia-major`（维护者，原始仓库）。
- **完全我们做**（功能起于贡献者，长期责任自扛，维护者回归维护者）。
- worker/manifest/UI 改动 → PR 回 upstream；重导出（§9）→ `StemSplit/demucs-onnx`（权重来自 `facebookresearch/demucs`）。

## 9. 后续可叠加优化（挂账）

内存优化是**一叠可叠加措施**，mem_reuse 只是先落地的一块。以下挂账、不动，现件稳定后再逐个评估（也待用户补充）：

- **fp16weights 模型**：不降运行时内存，但**下载体积砍半**（~158→~80MB）——接"下载要小"。是量化，质量需盲听。
- **重导出缩短/动态段长**：叠在 790MB 上再往下压（破 1GB 后非必需，对更弱机有意义）。质量风险，需盲听。
- **beat_this 切 CPU 开关**：给"打游戏要零显卡占用"的用户。
- **线程数 / idle 释放 / 图优化级别调参**：小项，收益待量。

> 纪律：每项各自过 §6 红线 ＋ diag 复测；**一次只加一项、单独量增益**，避免说不清谁起作用。

## 10. 诊断工装去留

`diag.cjs` / `diag.ts` 及 `// TEMPORARY` 埋点（提交 `13494098`）是临时工装，验收后删除或降级为可开关，不留在正式构建。
