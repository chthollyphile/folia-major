# Automix — 两个模型的改动

本目录用到两个神经网络：拍点检测 `beat_this-wgsl.bin` 与人声分离 `htdemucs-v3.mnn`。
两者都不进安装包，由设置页按需下载（清单见 `shared/modelManifest.json`，下载与校验在
`electron/analysis/`）。运行它们的 MNN 编进 app（`native/folia-mnn`，`build/buildMnnRuntime.mjs`），
不再有运行时下载。

**结论：`beat_this-wgsl.bin` 是作者原版 final0 检查点的导出（权重值未改，只做 BN 折叠和 fp16 存储，
见 §1）；`htdemucs-v3.mnn` 在 Meta 原版上叠了 §2 的各层改动，再改写成 MNN 图（§2.5）。**
§2 里 ⑤ 之前的数字和 §4 的 Python 部分是上一版（onnxruntime + Python）的记录，留作来历。

| | beat_this | htdemucs |
| --- | --- | --- |
| 上游 | [mosynthkey/beat_this_cpp](https://github.com/mosynthkey/beat_this_cpp) | [itamiArika/htdemucs-int8-memory](https://huggingface.co/itamiArika/htdemucs-int8-memory) |
| 原始作者 | CPJKU，ISMIR 2024 | Meta Research |
| 授权 | MIT | MIT |
| 下载体积 | 41.1 MB | 189.7 MB |
| 本仓库改过吗 | 导出格式（`build/beat_this_wgsl/export_weights.py`） | **改过，见 §2** |
| 跑在哪 | 渲染进程 WebGPU（自写 WGSL）；automix 可退到分析 worker 的 MNN CPU | 分析 worker 进程内 MNN，CPU，fp32 |

---

## 1. beat_this：未改动

下载到的是作者 `final0` 检查点的社区 ONNX 导出，未做任何修改。

**前处理全在本侧**（`beatThis.ts`）：梅尔频谱、1500 帧分块、峰值挑选、网格拟合。
导出的图拒收长张量（整首歌喂入会在注意力层抛 `invalid expand shape`），故分块是必需而非优化。
以下常量是契约而非参数——周期 Hann（长度取 `size` 而非 `size-1`）、`center=True` 反射填充、
`/sqrt(win_length)`、Slaney 梅尔 30–11000、`log1p(1000x)`——错一个不会崩溃，只会给出一个
自信的错误网格。

与官方 Python（`Audio2Beats(final0, dbn=False)`）在 30 首歌上逐首比对：**拍点与重拍 F 值均为
1.0000，平均偏移 0.00 ms**。改动此链路前须重跑对拍脚本。

---

## 2. htdemucs：四层改动叠在原版上

Meta 原版 htdemucs 是 PyTorch 检查点 + `demucs` 包，非单文件模型。当前 107.9 MB 的 `.onnx`
是四层改动叠加的结果，**后两层（段长砍半、FFT 移出图）由本仓库完成**：

| 层 | 谁做的 | 体积 | 图优化峰值 | 单窗口运行峰值 | 30s 窗口耗时 |
| --- | --- | --- | --- | --- | --- |
| ① 单文件四轨 ONNX 导出 | 第三方 | — | — | — | — |
| ② fp16 权重 | 第三方 | 165.6 → 130.0 MB | — | 不变 | 不变 |
| ③ transparent 重导出 | 第三方 | 130.0 MB | 4594 MB → **353 MB** | 909 → 783 MB | 慢 ~15% |
| ④ **段长砍半** | **本仓库** | 130.0 → **108.6 MB** | — | 789 → **483 MB** | **快 19%** |
| ⑤ **FFT 移出图** | **本仓库** | 108.6 → **107.9 MB** | — | 不变 | **快 14%**（4.9 → 4.2 s） |

### 2.1 ② fp16 权重

权重以半精度存储，加载时反量化。**下载体积减半，运行时内存与延迟不变**（运行时仍为 fp32），
相对 fp32 版最大绝对误差约 `6e-5`。此层仅为缩小下载体积。

### 2.2 ③ transparent 重导出

原导出将 STFT 展开为循环——数万个小算子拼出一次傅里叶变换。transparent 变体改用真正的
DFT 算子，节点数从 **24917 降到 1556**。

节省的不是推理，而是 **ORT 图优化阶段**：模型加载峰值从 4594 MB / 3.9 s 降到 353 MB / 0.65 s。
代价是每窗口慢约 15%（htdemucs 无截止期，不可感知）。渲染出的四条过渡盲听无差别，交接计划一致。

### 2.3 ④ 段长砍半 —— 本仓库所做

脚本 `build/htdemucs_halve_segment.py`（143 行，**全程不涉及 PyTorch，无需重新导出**）。

**为何选段长。** htdemucs 不是整首一次推理，而是切成固定长度的段逐段处理，段间 25% 重叠、
三角窗 overlap-add 拼回。因此**内存峰值 = 单段激活值**，与窗口长度无关（实测 8/15/25/40 s
窗口峰值 933/944/962/986 MB，近乎持平）。段长是唯一杠杆。

**固化不等于不可改。** 导出时段长 `343980`（7.8 s @44.1k）被固化进图，运行时输入其他长度会直接
报 `Got invalid dimensions for input: mix`。但它只是散落图中的一组常量，可枚举、可替换：

- **230 个整数形状常量**——时域链 `343980→85995→21499→5375→1344`、tdecoder 的配套 Slice 边界、
  STFT 的 `L+1536` / `L+1536+1620` 及反射填充、帧数 `336`、token 数 `2688 = 8 频点 × 336 帧`。
  **不动的**：`384/512/768/1024/1536/2048/2049/4096`——通道数、FFN 宽度、qkv 宽度、hop、nfft、
  频点数，均不随段长变化。
- **3 张位置编码表**——切片即可，第 k 位的编码与序列长度无关。
- **4 个 Pad**——STFT 右填充 `1620→1536`；`tencoder.{1,2,3}` 的「凑整除 +1」归零。
- **1 张 iSTFT 窗和归一化表**——不能切，需拼接首尾（见下）。

**为何半长是 172032（3.902 s）而非 171990。** 时域链必须逐级整除：
`172032/4=43008/4=10752/4=2688/4=672`，而 `171990/4` 非整数。半长版比原版更干净——
原 `343980/256 = 1343.67` 靠三个 `Pad(+1)` 补零凑出，半长版这三个 Pad 直接归零。

**为何缩段反而更快。** 卷积总量不变（重叠固定 25%，与段长无关），但**注意力是 token 数的平方**：
2688 → 1344 使注意力矩阵从 `2688² × 8头 × 4B = 231MB` 降到 57.8MB。算力与内存两边一起超线性
获益，故省下的多于线性预期（−230MB）。生产 runner 实测，30s 窗口、同机两轮：

```
7.8s   6 段   12.24 / 12.25 / 12.58 s   峰值工作集 788.8 MB   模型 130.0 MB
3.9s  11 段    9.87 /  9.91 / 10.16 s   峰值工作集 482.8 MB   模型 108.6 MB
                              快 19%              −305 MB / −39%
```

**两个会静默出错的坑（改坏不会崩溃，只会输出错误音频）：**

1. **位置表的 token 排布必须实测，不能猜。** `/crosstransformer/Reshape_4_output_0` 是
   `[1, 2688, 512]`，2688 = 8 频点 × 336 帧。若为频率优先，取前 1344 个 token 等于**只保留前 4 个
   频段的整个窗口**。实测法：`‖token[i+1] − token[i]‖` 的 12 个最大跳变全部落在 `i ≡ 7 (mod 8)`，
   边界周期为 8 ⇒ 帧优先，直接切前 1344 个正确。
2. **窗和归一化表不能切，要拼首尾。** 两端为斜坡、中间恒定（实测 ptp = 0.0）。切前半段会保住
   起始斜坡、丢掉收尾斜坡。正确做法：`concat(orig[:86*1024], orig[-(new − 86*1024):])`，
   接点落在恒定段内、两段都在整数个 hop 上，零缝。

**代码侧零改动。** `htdemucs_runner.py` 的 `segment_of()` 直接向模型查询段长
（`sess.get_inputs()[0].shape[2]`），而非旁置常量——换模型文件即生效，重叠、三角窗、分段数
自动跟随。旁置一份常量会导致两处不一致，且属静默出错而非崩溃。

### 2.4 ⑤ FFT 移出图 —— 本仓库所做

`build/htdemucs_cut_fft.py` 删掉图里仅有的两个 DFT 及其专属前后处理（前 12 个节点、后 26 个），
由 `htdemucs_runner.py` 的 `stft_head` / `istft_tail` 用 numpy 完成。模型输入变为
`mix` + `mix_spec`（mix 的单边频谱），输出变为 `stems_spec`（频谱分支，逆变换之前）+
`stems_time`（时域分支）。runner 按输入输出个数识别，未切的模型照常可跑。

**文件改名为 `htdemucs-v2.onnx`**：此前的 app 跑不了切过的模型，若在镜像上覆盖 `htdemucs.onnx`，
它们的下载会全部卡在哈希校验上。旧名 `htdemucs.onnx` 仍算已安装（`modelPaths.cjs` 的 `MODEL_FILES`），
已下载过的用户照常分离，只是拿不到提速。

**为什么：Intel Mac。** iSTFT 的 DFT 同时设了 `inverse` 与 `onesided`，onnxruntime 1.25 之前在
形状推断阶段拒收（1.22、1.23 实测加载失败）；而 1.25 起不再提供 macOS x86_64 wheel。移出图后，
Intel Mac 用 1.23.2（最后一个有 x86_64 wheel 的版本，需 macOS 13+），其余平台仍用 1.29。

**顺带更快：** numpy 的实数 FFT 比 ORT 的 DFT 算子快。30 s 窗口、M4、4 线程、ORT 1.29：
4.9 s → 4.2 s（其中逆变换贡献约 0.55 s，正变换约 0.13 s）。

**验证：** 被删常量（分析窗、合成窗、窗平方归一化）均由 n 与帧数算出，与图内常量相对误差 ≤ 4e-8。
同一首 30 s 真实音乐，对未切模型 + ORT 1.29 的四轨输出：ORT 1.29 为 123.0 dB SNR / 最大误差 6.1e-7，
ORT 1.23.2 为 122.0 dB，Intel 运行时包经 Rosetta（x86_64）为 121.8 dB——浮点舍入量级，
**不再逐比特一致**。纯数值等价改写，不涉及上下文或段长，故未做盲听。

---

### 2.5 改写成 MNN 图 —— 本仓库所做

`build/htdemucs_mnn/make_model.py`，从旧版 `htdemucs.onnx`（sha256 099b5be7…，也就是 ④ 之后、⑤ 之前那份）出发：
STFT/iSTFT 的 DFT 改成两级 64×64 矩阵乘（MNN 没有 DFT，⑤ 的 numpy 也随 Python 一起去掉）；四个百万级全局均值改成三级均值；
GroupNorm 链融合；ConvTranspose 改成多相卷积；每个 DConv 层合成一个自写算子 `Folia::FoliaDConv`
（`native/folia-mnn/folia_dconv.cpp`，NEON / SSE2 / AVX2+FMA 三套，运行时按 CPU 选）。权重外置并和图打成一个文件。

红线：6 首 × 30 s，对上一版 Python + ORT，经真实 `worker.cjs` 每轨电平最差差值 0.003 / 0.002 / 0.0 dB
（drums / bass / vocals），x86-64 两条路径 0.003 / 0.001 / 0.0 dB。M4 上每窗 3.2–3.8 s（上一版 3.7–4.1 s），
物理内存峰值 511–535 MB（含 Node 基线约 60 MB；上一版 Python 进程 371–544 MB）。

## 3. 手术验证

坏掉的图不会崩溃，故 strict shape inference + ONNX checker 只是第一道门。真正的判据有三层：

**① 对参考实现逐轨比对**（真实音乐，非合成信号）：

| stem | 相关系数 | 误差 dB |
| --- | --- | --- |
| drums | 0.9905 | −17.2 |
| bass | 0.9827 | −14.6 |
| other | 0.9767 | −13.3 |
| vocals | 0.9662 | −11.7 |

**② 外部判据：四轨相加还原 mix。** 7.8 s 版 26.5 dB，3.9 s 版 **26.9 dB**（半长略优）。
此项关键在于它**不是手术自身定义的量**——手术做坏则无法还原出 mix。差异散布于整个 30 秒而非
集中在段落接缝，说明并非手术留缝，而是上下文变短的正常代价。

**③ 盲听。** 四对渲染过渡，每对含一条纯 crossfade 对照，盲听反馈「完全听不出区别」。
段长类改动**必须过盲听**：相关系数 0.97 既可能好听也可能难听，该数字本身无法区分。

---

## 4. 模型之外：运行时侧的省法

当前做法：

| 做法 | 在哪 | 省了什么 |
| --- | --- | --- |
| 外置权重（`--saveExternalData`） | `make_model.py` | MNN 不再在内存里多留一份权重：加载后 415 → 214 MB |
| `Memory_Low` + 释放时把空闲内存还给系统 | `native/folia-mnn/folia_mnn.cpp` | 中间缓冲用完即还；`release()` 后物理占用回到几十 MB |
| automix 开着时常驻、关掉时在进程内释放 | `host.cjs` / `worker.cjs` | 换歌之间不重载 190 MB；关掉功能即还内存，不杀进程 |
| htdemucs 4 线程 | `worker.cjs` `HTDEMUCS_THREADS` | 与上一版 Python 运行器相同，留出核给播放和渲染 |
| `folia_mnn_prefer_fast_cores()` | `folia_mnn.cpp`，worker 启动时调用 | 上一版 `prefer_fast_cores()` 的移植：Windows 最小化后不被挪到能效核（12.7s → 28.1s 那条） |
| beat_this 走 GPU，CPU 只给 automix | `beatThis.ts` `cpuFallback` | CPU 每块 0.4–0.7 s，GPU 约 0.06 s；只有提前几分钟分析的 automix 等得起 |

以下是上一版（onnxruntime + Python）的做法，留作来历。完整诊断见
[`docs/automix-memory-optimization.md`](../../../docs/automix-memory-optimization.md)。

| 做法 | 在哪 | 省了什么 |
| --- | --- | --- |
| `enable_mem_reuse = False` | `htdemucs_runner.py` | **2543 MB → 790 MB**，输出逐比特一致。这一个开关是整个 Python 旁挂进程存在的唯一理由 |
| `enable_cpu_mem_arena = False` | 同上 | 分配器竞技场单独就值 ~5GB 峰值 |
| `intra_op_num_threads = 4` | 同上 | 典型机器的四分之一，留出核给播放和渲染 |
| 单会话跑完整窗 | 同上 | 每段开新会话实测**更差**（1288MB / 49s，重载权重 7 次 + 新旧会话瞬时叠加）。持久会话既最省又最快 |
| 进程退出即还内存 | `sidecar.cjs` | 无需 idle 计时器 `release()`——分离完进程即退出，每个字节都归还 |
| `prefer_fast_cores()` | `htdemucs_runner.py` | Windows 把最小化后的后台进程调度到能效核，同一窗口 12.7s → 28.1s。软偏好不硬绑定，非混合架构自动 no-op |
| beat_this 走 WebGPU / htdemucs 走 CPU | `worker.cjs` 的 `PROVIDERS` | **按用途分而非按速度分**：GPU 两个都更快，但分离撞可视化器换歌场景、也撞「一边听歌一边打游戏」，而它有分钟级提前量；beat_this 有截止期，迟到的网格等于没有网格 |

**为何必须用 Python。** `enable_mem_reuse` 是 ORT 内部 C++ 结构体的一个 bool，只有 Python
pybind 直接绑定它——onnxruntime-node 无此字段、`extra` 配置口子仅对 WASM 开放、C API 也无
setter；自编 C++ 二进制会撞同一堵墙。因此 app 额外下载一个裁剪版 CPython
（35–61 MB，随平台，见清单 `runtime` 条目），仅为拨动这一个开关。

---

## 5. 缓存侧的压缩

分离结果本身也经过压缩（`stems.ts`）：

- **只分离窗口，不分离整首。** 四分钟整首分离约需一分钟 CPU + 三分之一 GB；尾部 30 秒约十秒 +
  21MB。窗口长度 `STEM_WINDOW_SEC = 30` 由规划器可要求的最大重叠（25s）锁定，
  **不可为省内存缩短**——盖不住重叠的窗口会使整个手法退回主交叉淡入。
- **Int16 存储 + 峰值除数。** 四轨立体声按 Int16 存储，另存峰值除数（`peakOf`/`toPcm`），
  单窗口从 42MB 降到 21MB。峰值除数保证过冲轨（`other` 由四路相减得出，会过冲）不被削平——
  削平最响采样即一声咔哒。
- **最多 4 个窗口**（`MAX_WINDOWS`）。足够容纳「即将使用的一对 + 刚用完的一对」，故上一首 /
  回听免分离；再往前则淘汰，顺序由 `wanted` 集合 + `pickStemVictim` 决定。
- **`other` 由相减得出**，故四轨相加**精确**等于原曲（−400 dB）。这不是图省事，而是使
  「整轨 → 四轨」切换在单位增益下成为真正的 no-op。

---

## 6. 改模型文件时要动什么

1. 重新生成（需一个装有 `onnx`、`numpy` 的 Python，以及从固定 MNN 源码编出的 `MNNConvert`）。输出逐次运行字节一致。
   ```
   python build/htdemucs_mnn/make_model.py htdemucs.onnx models/htdemucs-v3.mnn --mnnconvert <MNNConvert>
   python build/beat_this_wgsl/export_weights.py beat_this-final0.ckpt models/beat_this-wgsl.bin --f16
   ```
   改了 `make_model.py` 或 `native/folia-mnn` 的算子，就要重跑 §2.5 的红线。
2. 更新 `shared/modelManifest.json` 中该条目的 `bytes` 与 `sha256`。**哈希是此清单的重点。**
   被截断或被镜像替换的 ONNX 不会显式失败——它会加载成功，然后自信地给出错误答案。
3. 重新上传到三条镜像（hf-mirror → hf → github，外加两个网盘兜底）。
4. 代码侧通常无需改动：段长经 `segment_of()` 自动跟随。若改动采样率或轨序，则属契约变更，
   须同步 `electron/analysis/htdemucs.cjs` 的 `SOURCES`/`RETURNED`。

---

## 7. 还没做的（挂账）

- **beat_this 切 CPU 开关**——面向「打游戏要求零显卡占用」的用户。当前占 ~580MB 显存 / 22%
  利用率 / 亚秒延迟，对游戏近乎无感，故非必需。
- **再缩一档段长**——3.9s 已低于 500MB，再缩收益递减且上下文继续变短，需新一轮盲听方可确定。
- **迁移到 MNN、拿掉 Python 运行时**——**已完成（§2.5）**，以下是当时的理由，留作来历。
  Python 进程只为 onnxruntime 一个开关存在（`enable_mem_reuse`，见 `htdemucs_runner.py` 顶部），
  代价是一份按平台分发的 35–60 MB 运行时、「模型在但运行时缺」这一类状态，以及被 onnxruntime 的
  wheel 支持面牵着走（Intel Mac 就是这么丢的，靠 ⑤ 才补回来）。在 onnxruntime 里提速要写自定义算子：
  按它的 C API 写、按「平台 × ORT 版本」各编一个动态库再注册进去，做算子融合则要从源码编 ORT 本身——
  运行时构建从「只下现成 wheel」变成要编原生代码。MNN 的自定义算子同样要按平台编，区别在于 MNN 本就以
  原生库编进 app，算子随之一起编，不额外多一条构建。MNN 原型（在仓库外验证，M4，30 s）：fp16 2.3 s
  （本仓库现为 4.2 s，fp32）；同为 2 线程时 CPU 时间约为 ORT 的 40%（4.7 vs 11.4 核·秒）——精度
  不同（fp16 对 fp32），且只在有 SME 的 M4 上测过，其他 CPU 待测。无需单独下载运行时；
  自写算子有 NEON / SSE2 / AVX2 三套实现，x86 可用。待补：Windows / Linux 真机、Intel Mac 真机、
  模型改为 fp16 存储（当前 fp32 190 MB）、接入 app 与 CI。
- **int8 权重**——已排除。仅省权重体积、不减激活；上游自述 fp16 权重运行时内存不变，可作佐证。

> 纪律：每项单独复测内存 + 盲听，**一次只加一项、单独衡量增益**，否则无法归因。
