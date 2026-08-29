# Automix — 智能过渡

播放器「混音过渡」功能的全部实现。业务代码集中在本目录，目录外仅四个接线点（见[目录外接线点](#目录外接线点)）。
单元测试位于 `test/unit/automix/`，与本目录文件一一对应。

---

## 1. 概览

Automix 回答一个问题：**上一首快放完了，下一首该怎么接进来。**

它不是交叉淡化器——交叉淡化只是四种接法里的兜底。完整流程包含离线音频分析、神经网络推理
（拍点检测 + 音轨分离）、乐理决策，以及 Web Audio 上的采样级调度。

系统分四层，自下而上：

| 层 | 职责 | 输入 | 输出 |
| --- | --- | --- | --- |
| **证据** | 测量音频的客观事实 | PCM 采样 | `TrackProfile`、`BeatGrid`、`TrackStems` |
| **决策** | 用乐理规则把事实变成方案 | 两首歌的证据 | `TransitionPlan`（纯数据） |
| **执行** | 把方案变成音频节点上的事件 | `TransitionPlan` | 增益曲线、滤波器、缓冲源 |
| **绑定** | React / DOM 外壳 | — | 两个 `<audio>` 元素 |

除 `useAutomixDecks.ts` 外，本目录所有文件均不依赖 React 或 DOM，故单元测试无需音频设备。

---

## 2. 文件职责

### 证据层

| 文件 | 职责 |
| --- | --- |
| `trackProfile.ts` | 离线分析主体：BPM（全曲 + 尾段）、小节线位置、响度（LUFS）、首尾调性、三频段占比、段落边界、前奏终点、结尾形态（收束 / 断开） |
| `signalAnalysis.ts` | 上下层共用的数学：K 计权、自相关测速、`estimateDownbeat`、重拍相位、交叉曲线、分频段曲线、平衡修正、`fft` |
| `profileService.ts` | `trackProfile` 的 I/O 侧：字节来源、何时允许下载、结果存储、运行时缓存 |
| `beatThis.ts` | Beat This! 模型的**前处理契约**：梅尔频谱、分块、峰值挑选、结果折算成 `{offset, period}` 网格。**不含模型权重与推理** |
| `stems.ts` | htdemucs 分离的**窗口管理**：只分离首/尾各 30 秒，缓存四个窗口，回答"本构建能否分离" |
| `stemGesture.ts` | 分离手法的**纯算术**：人声如何退场、鼓 / 贝斯 / 其余各在何时交接。无音频节点 |
| `expansionGesture.ts` | 表现模式的**纯算术 + 采样渲染**：build-up 打多重、落在哪几拍、把抽拉 / 升调 / 甩盘写成样本。无音频节点（见 §6.7） |
| `deckAnalyser.ts` | 正在播放那一路的实时状态：K 计权电平、下一拍时刻 |
| `deckClock.ts` | 该路**当前播放位置**：把 `currentTime` 的阶梯读数拟合成直线，精度进入毫秒级 |

### 决策层

| 文件 | 职责 |
| --- | --- |
| `musicalTime.ts` | 音乐单位：拍 / 小节 / 乐句取整、两曲速度关系（含二倍速等价）、入场点对齐 |
| `transitionChooser.ts` | 选择四种接法之一，并计算音色差、是否抛回声 |
| `transitionPlanner.ts` | Automix 规划器：过渡时长、出场曲落点、进场曲起点 |
| `crossfadePlanner.ts` | Crossfade 规划器：固定形状，只看用户设定的秒数 |
| `transitionStrategy.ts` | 按模式选择上述两个规划器之一 |

### 执行层

| 文件 | 职责 |
| --- | --- |
| `automixSession.ts` | 状态机 `idle → armed → fading`，以及每一步的撤销条件 |
| `crossfadeGraph.ts` | Web Audio 侧：双 deck 节点链、增益曲线、三频段接缝、回声抛掷、软限幅、stem 总线 |
| `tempoBend.ts` | 变速对齐：`playbackRate` + `preservesPitch` |

### 绑定层

| 文件 | 职责 |
| --- | --- |
| `useAutomixDecks.ts` | React 外壳：两个 `<audio>` 元素、当前活动 deck、各自渲染的 src |

---

## 3. 一次换歌的完整流程

```
        [ 预取阶段，播放前数分钟 ]
prefetchService
  └─ ensureTrackProfile(song)          profileService.ts
       ├─ fetch(Range) → decodeAudioData
       ├─ analyseBeatGrid(mono)        beatThis.ts   → utilityProcess → ONNX
       └─ analyseTrack(pcm)            trackProfile.ts
            └─ TrackProfile { bpm, downbeatOffset, lufs, key, sections, leadOut, ... }

        [ 准备阶段，当前曲目开始播放时 ]
useAutomixDecks
  └─ ensureStems({ song, role })       stems.ts      → utilityProcess → htdemucs
       └─ TrackStems { drums, bass, other, vocals }  首尾各 30 秒

        [ 排程阶段，距歌尾 AUTOMIX_ARM_LEAD_SEC 秒 ]
automixSession.checkTransitionPoint()
  └─ planForMode(settings, ...)        transitionStrategy.ts
       ├─ planCrossfade()              crossfadePlanner.ts   ← Crossfade 模式
       └─ planTransition()             transitionPlanner.ts  ← Automix 模式
            ├─ chooseTransitionStyle()  transitionChooser.ts  → beatCut / bassSwap / tailRide / plainBlend
            ├─ tempoMatch()             musicalTime.ts        → locked / near / stretchable / drifting / far
            └─ quantiseToMusic()        musicalTime.ts        → 长度取整到乐句 / 小节 / 拍
       → TransitionPlan
  ├─ phase = 'armed'
  ├─ onAutoplayHoldChange(true)        进场 deck 加载并缓冲，但不出声
  └─ advanceTrack()                    队列提前推进

        [ 执行阶段，到点 ]
automixSession
  ├─ phase = 'fading'
  ├─ applyTempoBend(element, stretch)  tempoBend.ts
  ├─ getStems(key, role) ≠ null ?
  │    ├─ 是 → planVocalExit() + planStemHandover()   stemGesture.ts
  │    │        connectStemBus() → connectStemDeck() ×2 → scheduleStemWindow()
  │    └─ 否 → scheduleCrossfade() + scheduleBandBlend()   crossfadeGraph.ts
  ├─ scheduleEchoThrow()               若 plan.echoThrow
  └─ settle()                          所有结局的必经之路：解除 hold、停止 stem 链、释放参数
```

---

## 4. 核心数据结构

### `TransitionPlan`（`transitionPlanner.ts:41`）

规划层与执行层之间唯一的契约。两个规划器都返回它，执行层不关心是谁写的。

| 字段 | 含义 |
| --- | --- |
| `kind` | `'hardCut' \| 'fade'` |
| `style` | 四种接法之一 |
| `relation` | 调性关系：`compatible / adjacent / neutral / clashing / unknown` |
| `tempo` | 速度关系：`locked / near / stretchable / drifting / far / unknown` |
| `stretch` | 出场曲的 `playbackRate`。1 表示不变速 |
| `tiltDb` | 进场曲的中 / 高频修正，使其以出场曲的音色到达 |
| `echoThrow` | 出场曲是否抛入延迟而非直接停止 |
| `outStart` | 出场曲第几秒开始过渡 |
| `inStart` | 进场曲从第几秒起播 |
| `overlap` | 本次过渡占用出场曲尾部多少秒 |
| `minOverlap` | 该接法可工作的最短时长，进场 deck 起播时复查 |
| `reason` | 长度是怎么定的。会打进控制台，非装饰性 |
| `expansion` | 表现模式的强度（0.25 / 0.5 / 0.75 / 1），模式关闭时为 `null`。**只有强度，没有位置**——落点要等 `planStemHandover` 算出 swap |

### `TransitionStyle`（`transitionChooser.ts:20`）

| 接法 | 触发条件 | 动作 |
| --- | --- | --- |
| `beatCut` | 进场曲一开始就是满电平，或两曲速度超出 `DRIFT_LIMIT` | 出场曲被切断，切口 40 ms（`BEAT_CUT_SEC`） |
| `bassSwap` | 两曲可重叠时的默认选择 | 重叠，但低频同一时刻只属于一方 |
| `tailRide` | 出场曲有衰减尾巴、进场曲有前奏 | 长重叠，进场曲从尾巴底下浮上来 |
| `plainBlend` | 什么都不知道时的兜底 | 等功率交叉淡化 |

### `TransitionCapabilities`（`stems.ts`）

```ts
{ beatGrid: boolean, stems: boolean, full: boolean, desktop: boolean }
```

`full` = 两者皆备 = 桌面构建且权重就绪，UI 据此显示"完全体 / 兼容模式"。
`desktop` 单独回答"是否桌面构建"，与"权重是否就绪"分开——"浏览器做不到"和"权重还没下"曾是
同一句话，现在是两件事，桌面用户不该被告知问题出在浏览器。

---

## 5. 两种模式是两个规划器

`Folia Crossfade` 与 `Folia Automix` 各是一个纯函数，返回同一个 `TransitionPlan`，
`transitionStrategy.ts` 只负责挑一个，执行层一行不变。**新增第三种模式 = 新增一个文件，下游不动。**

两者的区别不是参数，而是**允许看什么**：

- **Crossfade** 只看两个时长和用户设定的秒数（外加两端数字静音——那与 duration 一样是事实而非判断）。
  该文件中不出现速度、调性、段落、人声窗口，一旦出现它就不再是那个可预测的一半。
- **Automix** 看全部离线测量。

**表现模式不是第三个规划器，是 automix 的修饰符。**
它产出的仍是 automix 的形状，只是在其中一个交接点前面加一段手势；`planForMode` 仅在 automix
分支读它，因为 crossfade 模式根本没有可供冲刺的交接点。`TransitionSettings.performance`
因此是布尔而非第三个 `TransitionMode` 值。

**降级判据对着"规划器实际消费什么"写，不对着"有没有档案"写。**
`hasEvidence` 同时看三个来源：任一侧的档案、任何来源的速度、出场曲的歌词时间轴。
一首没有离线档案的歌照样有速度（正在播放那一路自测的），而那个速度正是"接八小节"与"接五秒"的差别。

---

## 6. 关键技术实现

### 6.1 离线分析流水线

`profileService` 用 `fetch(Range)` 取首尾各一段，`decodeAudioData` 解码，交给 `trackProfile.analyseTrack`。

**扫描按毫秒让出主线程，不按帧数。** 预算 8 ms（60 Hz 一帧的一半）。
"帧"不是工作量单位——一帧是一次 2048 点 FFT × 声道数，再加四轮上千 bin 的循环，
五百帧可能是几十毫秒也可能是几百毫秒。按帧数让出会造成界面可见卡顿。

**三处测量精度修正**（症状均不像测量出错，而像"给出一个很有把握的错答案"）：

| 问题 | 原症状 | 修法 |
| --- | --- | --- |
| 拍长只精确到一个 hop | 下游要乘几十倍，误差同步放大 | 谐波和 + 抛物线细化，落到 hop 以下 |
| 段落边界报格子左边缘 | 误差恒在 `[-0.50, 0]`，**永不偏晚** | 三点抛物线取顶点，降到 ±0.2 秒 |
| 前 4 秒是盲区 | 第一个边界消失、第二个冒充第一个（3.0 秒前奏报 17.00 秒） | 核在两端**对称**收缩并除以 taper mass，盲区 5 秒 → 3 秒 |

> 改动测量必须配合**合成信号**验证：把变化点放在已知时刻扫一遍，观察误差的**符号**分布。
> 上述三条有两条是靠符号发现的。只听某一首真歌听不出系统性偏移。

### 6.2 Beat This! 拍点模型

> 模型文件的来历、体积与改动见 [MODELS.md](./MODELS.md)。本节讲本侧用法。

**前处理常数是契约，不是可调参数。** 22050 Hz、n_fft 1024、hop 441、Slaney mel 30–11000 Hz、
`log1p(1000x)`、分块 1500 帧、边界 6 帧——**一个都不能动**。它们是权重训练时用的值，改任何一个
模型不会报错，只会给出一个很有把握的错答案。

**验收方式已存在，勿重新发明**：`beats.json` 是官方 Python `Audio2Beats(final0, dbn=False)`
在 30 首真实曲库歌曲上的输出，`tracks/*.raw` 是同一份输入采样。TS 移植在同样输入上：
**拍点与小节线 F-measure 均为 1.0000，平均偏差 0.00 ms，拍数完全一致**，速度 58× 实时。
任何"网格似乎不对"的怀疑，先跑这个再改代码。

**它替换而非修正。** 有模型时 `bpm / outroBpm / beatOffset / downbeatOffset / headDownbeatOffset /
beatsPerBar` 六个字段全部来自它；`estimateTempo / estimateDownbeat` 原样保留作**回退**
（浏览器构建、权重缺失、推理失败时它们是唯一答案）。**两套估计不得混用**——相位只在它被测出的
那个网格上有意义。

**权重不进 git，也不再随安装包分发。** 83 MB 的不变文件不该让每次 clone 背着它的历史；
它们约占安装包一半体积，而多数听众从不开启本功能，故本构建已把模型从 `extraResources` 中移除、
改为按需获取（`build:electron` 不再链 `models:fetch`，官方 CI 发布流程一向如此）。
许可证是 MIT，允许分发；无法访问 GitHub 的用户在这里是常态。
`build/fetchModels.mjs` 下载并**校验 sha256**——被截断或被镜像替换的 ONNX 不会报错，
它会加载成功然后自信地答错。

### 6.3 htdemucs 音轨分离

> 模型与原版的差异、段长砍半手术、运行时省内存开关见 [MODELS.md](./MODELS.md)。

分离出 `drums / bass / other / vocals` 四轨，窗口为首 30 秒或尾 30 秒（`STEM_WINDOW_SEC`），
采样率 44100，同时缓存至多四个窗口。

**播四条 buffer 并淡出元素，绝不依赖相消。**
理论上只需多一条人声轨即可（`g_vocal = α - β`），少三条流、少一半的图。实测否决：

| 文件格式 | 相位取反后对消深度 |
| --- | --- |
| WAV | **−222 dB**（表底，即逐样本相等），9 秒零漂移 |
| 有损（Opus） | **+3.8 dB**——不但没抵消，反而更响 |

原因不在编解码器（元素实际输出与 `decodeAudioData` 互相关滞后为 **0**），而在 `el.currentTime`：
压缩流上它被量化到编解码器自身的帧，buffer 因此差出一帧。

切换使用 **8 ms** 交叉淡化：对齐时透明，未对齐时也只是几毫秒梳状滤波；而硬切在前一种情况下完美、
在后一种情况下是一声"咔"。

**`other` 由相减得到**（`mix − vocals − drums − bass`），不取模型第四行输出。
htdemucs 自身四行只能重建到 −31 dB；相减让四条**精确**加回原曲，而这正是"窗口开头四条都在 1.0 时，
stem 之和与元素逐样本相同"这个换手前提所要求的。

**双方求和经过一个软限幅器**（`softLimit` / `connectStemBus`）。两路 deck 的和是这里唯一可能
越过满刻度的东西（单条母带不会）。限幅曲线在 0.95 以下是直线（故绝大多数采样原样通过），
之上单调、奇对称、无拐角。它替换了早期"预测峰值并把整段过渡压低"的做法——那种做法为了 1445 个
采样对整个窗口衰减约 4 dB，中段 4 dB 是听得见的 ducking。

### 6.4 推理进程隔离

**`onnxruntime-node` 的 `run()` 看似异步，实则不是。**
其 JS 包装是 `new Promise(r => setImmediate(() => r(session.run(...))))`，内层 `session.run`
是同步 N-API 调用——`setImmediate` 只决定阻塞从哪个 tick 开始。实测：用 10 ms 定时器围绕一段
htdemucs，**应触发 150 次处只触发 1 次**；模型加载期间 361 次触发 0 次。

放在主进程中这不是"慢"，是"死"：主进程拥有窗口消息循环和每一个 `ipcMain` 处理器。
一首歌需要 1 次 Beat This!（~5.7 s）+ 2 个 30 秒分离窗口（~16 s 与 ~10 s），
即**每首歌约 30–45 秒窗口完全无响应**。

模型因此运行在 `utilityProcess` 中。同机实测：

| 指标 | 主进程内 | utilityProcess |
| --- | --- | --- |
| 主进程最长停顿 | ~1450 ms | **25 ms** |
| 主进程 RSS | 530 MB+ | **131 MB** |

子进程闲置两分钟后整体退出（比释放 session 干净：整个进程的内存都归还）。

**`intraOpNumThreads` 必须显式设置，默认值是错的。**
onnxruntime 默认每逻辑核一线程，24 核机器实测每段 3547 ms——比 12 线程的 1438 ms **慢 2.5 倍**。
取核数的四分之一：真正要守的是**留给渲染帧和音频线程的机器比例**，该比例不应随机器大小变化。
分离有数分钟提前量、无截止时间——它不需要快，它需要看不见。

| intraOp | 每段 | 机器 CPU | 30 秒窗口 |
| --- | --- | --- | --- |
| 默认（24） | 3547 ms | 51% | 21.3 s |
| 12 | 1438 ms | 66% | 8.6 s |
| 6 | 1602 ms | 42% | 9.6 s |
| 4 | 1873 ms | 32% | 11.2 s |
| 2 | 2908 ms | 19% | 17.4 s |

### 6.5 增益曲线的形状

**淡入淡出与混音的区别是形状，不是长度。**
过渡长度从 2 秒调到 8.5 秒、从 4 拍调到 16 拍，听感始终是"一次淡入淡出"——因为它确实是。
`buildCrossfadeCurves` 原本对四种接法输出同一条横跨全程的等功率余弦，三频段只是在其**之上**加修饰；
而在一条淡出曲线上加滤波，得到的仍是一条淡出曲线。

淡出的听感签名不是"长"，是**出场曲自始至终连续下滑**；混音的签名是**出场曲一直在，然后走掉**。
因此 `together` 参数在曲线中段加入一段**平台**：两曲各停在 cos(π/4) 不动，占整段一半，
低频在此段换手——两曲等强、只有一个低端，这才是那个 DJ 动作，也是它不糊的原因。

**平台不消耗任何 headroom**：它正落在 cos = sin 那一点，中段合成功率与其它任何时刻相同。
实测两条曲线的 sum power 逐点相同。`plainBlend` 的 `together` 为 0——纯淡入淡出本就该是纯淡入淡出。

### 6.6 时钟与变速

**`deckClock.ts`：`currentTime` 是阶梯，但阶梯底下是一条严格的直线**（斜率即 `playbackRate`）。
拟合一秒的读数即可把相位压到毫秒以下。有了它，对齐不再需要 `AudioBufferSourceNode`、
不需要整曲解码进内存、不需要重写进度条 / 拖动 / MediaSession。
残留的半个量化步（约 10 ms）是常数偏置，两路 deck 同样偏，做差即消。

**变速只弯出场曲，永不弯进场曲。**
DJ 的做法相反（不能动全场正在跳的那张），但这里出场曲只剩几秒、没有未来可错，
而进场曲即将被听三分钟——弯了它就得在它独自响着时把速度扳回来，
那是整段过渡中唯一没有东西可以遮掩的时刻。

**音高由 `<audio>` 元素自己保住，不要再保一遍。**
`preservesPitch` 规范默认即为 `true`，元素**自带**时间伸缩器，且运行在浏览器音频渲染层，
位于 Web Audio 取音**之前**。曾有一个 150 行 WSOLA worklet 基于"`playbackRate` 是重采样器"的前提——
该前提对重采样器成立、对媒体元素不成立，结果是校正做了两遍，0.75 倍速的出场曲被整体升高四度。
`tempoBend.ts` 现仅剩两个属性赋值，且 `preservesPitch` **每次显式写入**，不吃默认值。

**"能弯到一起"与"能叠在一起"是两个阈值。**

| 常量 | 值 | 含义 |
| --- | --- | --- |
| `STRETCH_LIMIT` | 0.12 | 变速上限（伸缩器涂抹感的边界，且需远离谐波比值） |
| `DRIFT_LIMIT` | 0.25 | 重叠上限（最短 blend 为 4 拍，漂满一整拍即从"没对齐"变成"打架"） |

中间地带称为 `drifting`：不变速，但照常重叠，只是较短。日志**总是**打印实际百分比
（`tempos 15% apart, left to drift`），因为"太远了"这句判词在 11% 和 60% 时长得一模一样。

---

### 6.7 表现模式：build-up（`expansionGesture.ts`）

Automix 其余部分都在追求"听众没发现正在混"。**这一条是反过来的**，所以它是一个独立开关：
听众主动要求听见这次过渡。

**它落在既有的交接点前面，不新增落点。**
`planStemHandover` 已算出鼓换手的时刻 `swap`——那是整个手势里最硬的一条边（6 ms 直切两套鼓）。
build-up 占据 `swap` 之前的若干小节，**结束于 `swap`**。所谓的 drop 不是本模块排的新事件，
而是那条边终于被"冲"到了。

| 强度 | 长度 | 抽拉层数 | 顶端速率 | 甩盘 | 参与 stem |
| --- | --- | --- | --- | --- | --- |
| 25% | 2 拍 | 1 | 1.02× | — | drums |
| 50% | 1 小节 | 2 | 1.06× | — | drums |
| 75% | 2 小节 | 3 | 1.12× | 0.5 拍 | drums + other |
| 100% | 3 小节 | 3 | 1.20× | 1 拍 | drums + other |

**层数比速率重要得多。** 层 0 循环半拍、层 1 四分之一拍、层 2 八分之一拍；
"越切越碎"才是听感上的加速，速率上升只是给它一点推力。所以 25% 是**一层**，不是同一个效果的
缩短版；而 100% 比 75% **更长**而非更深——再深就从节奏变成 30 ms 的嗡鸣了。

**最浅的分割是半拍，永远不是一整拍。** 这条是一次听感报告买来的。
初版从整拍起手，实测落在"0.89–1.18 拍 × 2–3 次"——那不是 roll，是跳针：两三次重复太少，
读不出"这是个效果"，于是耳朵把"刚才那一拍又来了"判定成**倒带**。报告原话是「倒放感、倒带感、
重播感，**然后**才是往前冲」——"然后"精确定位了它：那是 build 的**开头**，不是结尾的甩盘。
真正的 DJ roll 不重复整拍，同一个原因。

**各层时长是折半的（4/7、2/7、1/7），不是均分。** 同样出自那次报告（「太快」）。
均分意味着三层四秒里有三分之一泡在最快的分割上，于是没有一个"慢的部分"供快的部分去对比。
现在层 0 占一半以上，最急的那段只有半秒——总长不变，变的是时间花在哪。

**bass 与 vocals 在任何强度下都不参与。** 抽拉贝斯是糊，抽拉人声是故障音。
`other`（pad / 吉他床）到 75% 才加入——它没有可供网格对齐的瞬态，低强度下切它像是坏了而不是在推进。
这也正是本模式与"对整首成品做一遍"的全部差别。

#### 为什么是渲染成 buffer，而不是操作正在跑的节点

直觉做法是"重触发鼓 stem + 斜坡拉 `playbackRate`"。**两半在这里都不可用：**

1. `AudioBufferSourceNode` 是一次性的，`start()` 不能调用两次。N 次重复就要 N 个节点，
   而 `connectStemDeck` 特意把四个 stem 用**同一个绝对时刻**起播——那正是它们彼此样本级对齐的原因。
2. 给正在跑的 source 加速率斜坡，buffer 时间就与墙上时间脱钩，而 `scheduleStemWindow` 里每一条
   增益曲线都假设二者 1:1。结果不是"手势之外多了个 build"，而是**十一轮盲测调出来的交接手势散架**。

写成样本后三个问题同时消失：重复是索引上的一个循环，甩盘是负步进，升调是自实现的重采样——
因此**不依赖 `preservesPitch`**（元素路径在这一点上与本实现相反，见 §6.6），两种构建听起来一样。
真正播放的只是一个速率 1.0 的普通 source。

**每个 repeat 的 wrap 处也要淡化，不能只淡两端。**
切片读得比它自身长（速率 1.2 时在 83% 处），会**回卷**——那是源里的一次向后跳。
不淡化就是每个 repeat 中间一个硬断点，且随速率上升而变大，这是除分割过浅之外**第二个**会被听成
倒带的东西。

#### 与既有手势的隔离

渲染出的 buffer 走 `connectExpansion`，接进 stem 共用的软限幅总线，与四个 stem 平行。
被接管的那些 stem 由 `expansionMask` 在 `[from, to)` 区间乘 0，**乘法点就是 ReplayGain 折进曲线的
同一处**——`stemGesture.ts` 因此仍然只是 handover 的函数，`[from, to)` 之外的每一个样本与之前完全一致。
没有这层 mask，听众会同时听见抽拉**和**它所取材的原鼓。

#### 强度由测量决定，"要不要做"不由测量决定

`chooseExpansionIntensity` 只看一件事：**有没有东西可落**。进场曲的开头电平相对出场曲结尾
（`headDb - tailDb`）、以及它是否 `startsHot`。唯一往下拉的情形是进场曲比出场曲还轻——
那是本手势可能比什么都不做更糟的唯一情况。

**它永远不返回 0。** 见 §9「启发式只决定怎么接」。

覆盖范围：**需要分离**，即桌面构建 + 歌曲已在本机。浏览器构建里该开关直接置灰并写明原因，
而不是打开后悄悄什么都不做。曾评估过"主轨弱化版"并否决：元素路径升不了调，做出来是
**共用同一个名字的另一个效果**，一旦上线就再也无法判断听到的是哪一个。

---

## 7. 能力分级：桌面 vs 浏览器

两个模型均通过 `window.electron` 桥调用，浏览器构建中该对象不存在。

| 能力 | 桌面 | 浏览器 | 浏览器的实际表现 |
| --- | --- | --- | --- |
| htdemucs 分离 | ✅ | ❌ | 每次过渡退回 `scheduleCrossfade` + 三频段接缝 |
| 表现模式 build-up | ✅ | ❌ | 由 htdemucs 派生，设置项直接置灰（见 §6.7） |
| Beat This! 拍点 | ✅ | ❌ | 退回 `estimateTempo` / `estimateDownbeat` |
| 曲目分析（`profileService`） | ✅ | ✅ | `OfflineAudioContext` + `fetch(Range)`，无 Electron 依赖 |
| 变速对齐（`tempoBend`） | ✅ | ✅ | `playbackRate` + `preservesPitch` 皆为平台能力 |
| 软限幅（`softLimit`） | ✅ | ✅ | `WaveShaper` |
| 全套规划与选择 | ✅ | ✅ | 纯算术 |

**代价量级**：第九轮盲测中"分离 + 规则"对"主轨交叉淡化"为 5.85 vs 4.00（4 组，同场，3 胜 0 负 1 平），
即约 1.85 分 / 10。该数字 n 较小且使用的是第九轮旧规则，**仅作量级参考，不可作为结论引用**。
小节线一侧从未单独做过听感对比，仅有客观数据：内置估算器在 30 首中仅回答 12 首、其中约半数正确
（≈ 20% 可用），对比 Beat This! 的 F = 1.0000。

浏览器构建另需注意：不存在本地 netease API 服务（桌面版由 `electron/neteaseApiStartup.cjs` 拉起），
须指向已部署实例；且音频元素带 `crossOrigin="anonymous"`，音频 CDN 必须返回 CORS 头，否则连播放都不可行。

---

## 8. 目录外接线点

| 位置 | 使用了什么 | 原因 |
| --- | --- | --- |
| `src/App.tsx` | `useAutomixDecks`、`clearTrackProfileRuntime` | 渲染两个 `<audio>`、转发事件；切换音源商时清运行时缓存 |
| `src/hooks/usePlaybackAudioBridge.ts` | `rampGain`、`AutomixDeckChain`、`autoplayHeld` | 播放桥拥有节点链上 ReplayGain 那一级（每路 deck 各一个，在汇合点之前，故 `referenceDb` 要把它读进来）；过渡待命期间它压住自动播放。**两路 deck 接进共用的 `mixNode`，均衡器、效果器、音量、分析器依次接在其后**——均衡器与分析器因此永远作用于两曲之和，两种模式一视同仁 |
| `src/services/playbackGraph.ts` | `buildPlaybackGraph` | 汇合点之后的接线顺序都在这一个函数里，可被断言。音量推子在效果器**之后**：黑胶噪声、比特降质、punch 是绝对效果，推子在其上游会改变它们做什么而不是多响（实测数据写在该文件顶部）。均衡器是相对的，故不受此位置影响 |
| `src/services/prefetchService.ts` | `ensureTrackProfile` | 预取下几首时顺带分析 |
| `electron/analysis/worker.cjs` | `onnxruntime-node` + `models/*.onnx` | 两个模型都在此，运行于不拥有窗口的进程（见 §6.4） |
| `electron/analysis/host.cjs` | `utilityProcess` | 主进程侧：拉起 worker、匹配请求与回复、闲置两分钟终止、崩溃自动重试一次 |
| `electron/preload.cjs` / `electron/main.cjs` | `automix-beat-this`、`automix-htdemucs` | 两个 IPC 通道，主进程仅转发 |
| `src/stores/useSettingsUiStore.ts` | `automixEnabled`、`transitionMode`、`crossfadeMaxSec`、`transitionPerformance` | 总开关 + 策略选择 + 交叉淡化长度 + 表现模式。开关同时挂在 `components/panelTab/controls/VolumeRow.tsx`，完整设置区在 `components/modal/settings/TransitionSettingsSection.tsx` |

---

## 9. 不变量

以下每条都对应一次已修复的真实缺陷。修改本目录前请通读。

### 架构

**不设 `index.ts`。** 依赖在目录层面是双向的：`prefetchService` 调 `profileService` 分析曲目，
而 `useAutomixDecks` 回头读 `prefetchService` 的歌词缓存。两条边现落在不同文件上故无循环导入；
一旦收进 barrel 就会合并成一个真实的环。**目录本身就是边界。**

**证据层不认识 React，也不认识播放器。** 新增测量只加在 `trackProfile.ts` / `signalAnalysis.ts`，
它们只接受数组和数字。要用新数据做决策，改 `transitionChooser` 或 `transitionPlanner`，
不要让执行层直接读档案。

**"装好下一首"与"开始淡入淡出"是两件事。** `automixSession` 提前 `AUTOMIX_ARM_LEAD_SEC`（= 1）秒
备好过渡，其间 `onAutoplayHoldChange(true)` 压住播放桥的自动播放：deck 照常取 src 并缓冲，只是不出声。
合成一件则装载耗时会从淡入淡出里扣掉，规划器算多长都没用。
修改此处须确认每条退出路径都会解压——`settle` 是所有结局的必经之路。

### 决策

**启发式只决定"怎么接"，不决定"接不接"。**
曾有第五种接法 `gapless`（同专辑相邻且两端满电平即 6 ms 拼接）。对唱片的判断没错，对开关的判断错了——
在一张从头连到尾的专辑上它吃掉三分之二的换歌，听众打开"混音过渡"却听到什么都没发生。
现存四种接法每一种都是听得见的。

**第二次踩到同一条：`chooseExpansionIntensity` 不允许返回 0。**
表现模式是听众亲手打开的开关，测量只被允许回答"多重"，不允许回答"这次算了"。
一个"强度为零"的 build 与一个坏掉的功能在听感上完全无法区分。同理，只要模式开着，那一行过渡日志
就**必须**说点什么——包括"塞不下"的情形。（stem 手势上线后跑了整整一天零次而无人察觉，
正是因为它只在失败时才打印。）

**长度系数是要相乘的。** 调性冲突 ×0.4、速度太远 ×0.5、进场满电平 ×0.6，单独看都对，
乘起来是 0.12——那不叫"短一点"，那是一次没人写下来的硬切。`chooseTransitionStyle` 的 `lengthScale`
现有 **0.25 地板**（一个乐句的四分之一 = 一小节）。新增任何长度系数时记住它会与其他系数相乘。

**一首歌结束的地方不是文件结束的地方，而且有两个"结束"。**

- `leadOut` / `soundingEnd`：最后一个音之后的数字静音。
- `bodyOut` / `bodyEnd`：静音门槛是"比**峰值**低 40 dB"，现代母带上约等于比**音乐本身**低 30 dB，
  故贴着 `soundingEnd` 排的过渡整段都在衰减里跑。

`planTransition` 的落点是 `min(sounding − overlap, max(body, lastSung))`：
正常贴着响声末尾，衰减更早则从衰减顶点起手，但绝不早于唱完。
超过 `MAX_TRIMMED_TAIL_SEC`（= 10）的空白或衰减不算尾巴——那是隐藏曲目或写好的氛围尾奏。

**过渡长度是算出来的，`AUTOMIX_MAX_OVERLAP_SEC`（= 25）只是天花板。**
长度由"一个乐句（16 拍）× 各项系数 → 按乐句 / 小节 / 拍取整"得出；
天花板只负责拦截，且拦截时往下退整数个小节，不是把上限本身当答案。

**计划按"还剩多少"算，不按"一共有多少"算。**
`checkTransitionPoint` 不按时钟跑，而是在没人挡着时才跑，因此对一首歌的**第一眼**完全可能落在
它自己的交接点之后。`planTransition` 收一个 `at`（出场曲当前秒数），`left = end − at` 进 ceiling，
`at` 也进 `anchor` 下限。

**出场器乐尾巴与进场前奏是两个独立上限，不是 `min(tail, intro)`。**
写成一个数会导致**任何一边没测到，另一边也跟着作废**。
更深一层：这两个窗口是同一条要求的两个代理，而那条要求是**"不许两个人声叠在一起"**，
不是"淡入淡出期间不许有人声"。一旦 `tailRoom` 生效，重叠整段落在出场曲的器乐尾巴里，
那一侧按构造是不唱的；此时进场曲开口正是这个动作本身。进场窗口只在出场侧无法自证
（没测到，或一直唱到结束前一秒）时才需要顶。这是唯一允许过渡越过已测窗口的地方，
故会打印 `the next track sings over the outgoing instrumental`。

**同一个量测两次对不上，答案是"不知道"，不是"取后测的那次"。**
`settledBpm(bpm, outroBpm)`：全曲测一次、末 30 秒再测一次，正常取后者。
但 `92 BPM (123 at the end)` 这类差三分之一到一半的读数是测速在两个窗口锁到了不同谐波——
返回 null，网格退回实时探针，速度不弯。

**平衡修正纠正的是母带不平衡，不是音乐动态。** 两侧必须是**同一种测量**，均走
`referenceDb(profile, chain)`；实时探针只在没有档案时兜底，且**两侧一起兜底**。
一侧用实时短窗、一侧用整曲积分，差值里会带一个方向固定的偏移，表现为日志中的衰减量常年贴在上限——
**一个对任何输入都饱和的修正不是修正，是常数。**

### 执行

**改 AudioParam 上正在跑的曲线要用 `cancelAndHoldAtTime`。**
`cancelScheduledValues` 只删还没开始的事件，一条已在跑的 `setValueCurveAtTime` 会活下来，
接着往它的区间写任何事件都是 `NotSupportedError`——而 `settle` 是所有结局的必经之路，
中途暂停就会踩到。`crossfadeGraph` 的 `releaseParam` 是唯一入口。
曲线本身不要在 `startAt` 那一刻再补 `setValueAtTime`，引擎会判定重叠。

**一条起点已过去的曲线不会从过去开始，它只是变长了。**
给 `setValueCurveAtTime` 一个早于 `currentTime` 的起点，引擎把起点**夹到当下**、**时长照原样保留**，
结束点因此后移同样多，按原起点算出的复位事件会落进运行中曲线**内部**并被整体拒绝。
修法：整段调度锚在**夹过之后**的起点上（`Math.max(startAt, context.currentTime)`），
复位再往后让 `CURVE_TAIL_GUARD_SEC`。

---

## 10. 测试

`test/unit/automix/` 共 17 个文件，与本目录一一对应。

**`fakeAudioGraph.ts` 是执行规则的替身，不是事件记录器。**
上一条 bug 能漏出去，正是因为早期替身只记录事件、从不执行引擎规则——"不许把事件排进运行中的曲线里"
这条从来没有任何测试能看见。它现按 Chrome 的边界抛错（`[起点, 起点+时长)` 左闭右开），
`cancelScheduledValues(t)` 丢弃 `start >= t` 的曲线。**往这个替身加节点时，加的是规则，不是又一个数组。**

**正向断言必须先断言"有答案"。**
`expect(null).toBeCloseTo(0)` 是**通过**的（`null - 0` 在 JS 中为 0），
`expect(found! % (PERIOD * 4))` 同样（`null % 2` 为 0）。小节线那一组的正向断言曾全是这个形状，
对"返回了 null"完全无感，而 null 恰是该组唯一要排除的结果——于是"测试全绿"与"真实曲库 12 首失败
6 首"可以同时成立。现均走 `answered()`。**往该文件加正向断言前先问：返回 null 会不会让它通过？**

**fixture 里不要放无关的输入。**
"衰减太长不算结尾"与"从衰减顶点起手"两条的 fixture 曾各放一句歌词，于是 `max(body, lastSung)`
里真正托住锚点的是人声下限而非各自的主角。两条现均为 `lines: null`。

---

## 11. 已知问题

| 问题 | 影响 | 状态 |
| --- | --- | --- |
| 4 首实机曲目找不到小节线 | 交接贴不了小节线、乐句对不齐、进场只能从 0.00 s 进 | **原因未知**。已排除"尾部数字静音污染投票窗口"（合成信号上 0–14 秒尾静音，四个速度全程零变化） |
| 已在媒体缓存中的曲目拿不到预热 | 首次交接可能偏短 | `playSong` 给缓存曲目现开 blob 地址，每次不同，而 `resolveDeckSrc` 的前提是"预热用的字符串就是最后要播的那个"，故 `warmSrc` 对这类曲目给 null。要补需让 blob 地址在预热与播放间共用 |
| 日志区分两种小节线失败 | 无播放影响 | 已改为曲头有答案即打印。`no bar line found (head 1.98s)` = 证据在音频里但整曲那遍没用上；光秃秃的 `no bar line found` 才是真的没有。查上条时据此分流 |

---

## 12. 修改本目录前

1. 音频路径处于**用户封版**状态（2026-08-20），未经点名不要改动、调参或重构。UI / 接线缺陷仍可修。
2. 改测量 → 跑合成信号，看误差符号分布。
3. 改 Beat This! 前处理 → 先跑 `beats.json` 对拍（F-measure 必须仍为 1.0000）。
4. 改音频图 → 确认 `fakeAudioGraph` 能看见你要防的那条规则；看不见就先给替身加规则。
5. 新增接法 / 长度系数 → 复读 §9「决策」两条：不得决定"接不接"，且系数会相乘。
