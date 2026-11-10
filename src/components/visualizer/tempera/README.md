# Tempera 凝彩

网点图形（screentone MG）风格的逐字歌词 PV 模式。与 sonnet 同族——都是 Pixi runtime + 绝对时间驱动——但视觉路线完全不同。

这份说明从 `src/components/visualizer/README.md` 拆出来，那边只留一个入口索引。

## 代码入口

- React shell / subtitle：`VisualizerTempera.tsx`；tuning 与 registry entry：`tuning.ts`、`entry.tsx`
- Pixi runtime（scene cache ±1、绝对时间驱动、无外部纹理）：`createTemperaPixiRuntime.ts`
  - runtime 只管生命周期、段落场景缓存、换歌交接和每帧调度；shot 逐帧姿态 `temperaShotFrame.ts`，段落转场选择 / 当前 shot / 是否重建场景 `temperaSceneFrame.ts`，片尾海报 `temperaCreditsLayer.ts`，角标与擦除块 `temperaOverlay.ts`，用户图片纹理池 `temperaImageTextures.ts`
- 段落 / shot / slice 编译：`temperaProgram.ts`，类型与 `TEMPERA_SHOT_KINDS` 在 `types.ts`
- 排版区域 / 入场向量 / 镜头位移 / mood（纯数据，无 pixi）：`temperaShotProfiles.ts`
- 构图绘制：`compositions/*` 按族分文件，`temperaCompositions.ts` 注册聚合
- 拼贴排版与测量：`temperaLayout.ts`、`temperaMeasure.ts`
- 运动求解：`temperaMotion.ts`、`temperaMotionEasing.ts`、`temperaEnterStyles.ts`
- 图形语汇：`temperaHatch.ts`（纯生成器）、`temperaShapes.ts`（Pixi Graphics 工厂）、`temperaBlocks.ts`（运动状态）
- 文字反色：`temperaDifferenceFilter.ts`；scene 级 filter 挂载：`temperaSceneFilters.ts`；调色板：`temperaPalette.ts`；镜头：`temperaCamera.ts`
- 画布图片池：`temperaImageLayer.ts`、`TemperaImageLayerControls.tsx`、`TemperaImageLayerDialog.tsx`、`useTemperaLayerImageThumbnails.ts`、`src/services/temperaLayerImages.ts`；整组 zip 导入导出 `src/services/temperaImageArchive.ts`
- 智能动感模式「墨染奥行」：墨 `temperaInkFlash.ts`，景深与运镜 `temperaDepth.ts`（见下面「墨染奥行」）

## 编译期：段落、shot、slice

`tempera/VisualizerTempera.tsx` 负责 React shell/subtitle，`createTemperaPixiRuntime.ts` 创建 Pixi runtime（scene cache ±1、绝对时间驱动、无外部纹理）。与 sonnet 同族但视觉路线不同：`temperaProgram.ts` 编译段落/shot；镜头共 121 种，分十三族：分割/色带/框窗/海报/稀疏，加上 **cinema-shot**（各种画幅比例的遮幅窗口，中间镂空、按真实像素比例 aspect-fit，所以「正方形」在任何显示比例下都是方的）、**charm**（圆滑族，见下面「圆滑构图族」）、**aperture / signal / corridor**（镂空与几何构架三族，见下面「镂空族」）、**monolith / terrain**（粗野主义巨构两族，见下面「巨构族」）和 **monogatari-blank**（物语系过场卡：整屏单色平涂 + 大字，profile 上标 `sharedDecor: false` 跳过贯穿线与 motif 叠加，否则那层装饰会毁掉「留白卡」本身），定义在 `types.ts` 的 `TEMPERA_SHOT_KINDS`，排版区域/入场向量/镜头位移/mood 在 `temperaShotProfiles.ts`（纯数据、无 pixi），绘制在 `compositions/*` 按族分文件、由 `temperaCompositions.ts` 注册聚合；mood（quiet/neutral/loud）决定换气段只取安静构图、副歌不取安静构图。默认每行按词边界切成 2~4 词或 ~2.2s 的 `TemperaShotSlice`，所以一句歌词会横跨多个 shot；但两个紧挨着的单字中文词之间不切（否则「我/想/你」三个单字词会被 2~4 词的目标拆到两个 shot 里），这种粘连最多把 shot 撑到 3.2s；开启 `wholeLineLyrics` 后则以完整 `Line.fullText` 为单位构建 shot，代价是极长歌词会由现有 fit loop 自动缩小字号；此时单行段落整行都在镜头里，边角碎字与水印改从全曲其他行取，绝不重复画面上已有的字，全曲只有这一行时就不画装饰。shot 之间由 runtime 直接交接（上一个 shot 沿 flowAngle 继续推出画面、下一个从上游推进来，两者在 handoff 窗口内同屏重叠）；handoff 时长为 shot 时长的 0.3（钳在 0.4~1.1s），不再有 shot 级的场景转场；flowAngle 以垂直为主轴，交接因此读作纵向长镜头而非切换。段落转场为 `block-wipe`/`camera-pan`/`shape-carry`。间隙（≥1.2s）会被编译成 **bridge shot**：无歌词、只有构图的 shot，按 ≤5s 切成 1~3 个，走和普通 shot 完全相同的交接/镜头/装饰机制，所以器乐段落一直在动，段落转场的出画侧也始终有内容。此外平移类转场需要「另一头」有东西接：段落边界经常落在没有歌词的间隙里，所以转场窗口内会**预卷**下一个段落的 scene（`block-wipe` 除外——它的 enter 阶段是揭开遮罩，必须在边界之后），同时 `compileTemperaProgram` 把每段首个 shot 的 startTime 提前到上一段的转场起点（不越过上一段的 endTime），让新构图在间隙里就开始搭建；逐字时序完全不受影响。scene 容器开 `sortableChildren` 并按段落序号排 zIndex。转场边缘仍可能短暂露出 shell 背景，这是已知且**接受**的取舍，运动感优先于边缘覆盖，不要为了补边去掉平移。

## 排版

`temperaLayout.ts` + `temperaMeasure.ts` 做拼贴式排版：分词（走 `utils/lyrics/wordSegmentation.ts`，用户为这首歌存过精细分词就用那份，否则 icu-folia 的默认分词——Intl.Segmenter 打底、中文换成 jieba、日文换成 BudouX，切出的是「实词＋后面粘着的虚词」这一级，见 `utils/lyrics/icuFolia`）**只用来定字号层级**，不影响字间距——词间只有在原文确实有空白（比对 `startOffset`/`endOffset`）时才给一个空格宽，CJK 的分词边界只留 0.035em 视觉微距；每行一个 hero 词放大到 1.34~1.6×、其余压到 0.7~0.86×，形成视觉重心，行高 1.02~1.12 保持紧凑，每字有独立入场向量，并按词从 `temperaEnterStyles.ts` 的 7 种入场方式里选一种——以**方向变体**为主（slide 用镜头自身向量，from-left/right/above/below 换来向，swing 额外带旋转，stamp 是唯一的原地样式）；所有变体共用排版算好的同一段位移距离、且等比缩放，长距离飞入和单轴拉伸都刻意去掉了——整词同一种，相邻词不同，所以一句话是被「拼」上去而不是统一滑入；有位移的样式还会拖出 2 层运动浮影（`echoLayer`，不参与反色）；`decor.watermark` 是编译期选出的超大装饰词，取自本 shot 没在排的词，放在**反色层之下**，于是歌词压过它的笔画时会翻色；关键字着色走共享的 `wordColoring.ts`（`theme.wordColors`，无独立开关），命中的字带 `color` 并渲染到 textLayer 之上的 **keywordLayer**——那层不挂 difference filter，否则主题色会被反色抹掉。

## 大面积色块与镜头

`temperaBlocks.ts` 绘制大面积色块 MG 并兼作转场引导，`temperaCamera.ts` 只做 shot 级镜头（不追踪逐字），`temperaPalette.ts` 从主题派生 duo/mono/gradient 调色板；gradient 模式用 `extractRepresentativeColors` 对封面精确取色，再把每个取到的色向主题色（accent/secondary/primary/ink）混合 32%——封面仍占主导，但主题不会在最显眼的时候被完全丢掉；无封面时直接用主题色。把取到的色按亮度排序后逐个拉到 paper→ink 阶梯的对应档位（`matchLuminance`），得到四色渐变 ramp，再由 `drawPolygonFill` 用 pixi `FillGradient` 做线性填充——每个形状的渐变会向它自己那一档 tone 混合 50%，所以构图的明暗结构不会被渐变冲掉。文字另有一套 `textGradient`：**不**压到 ink 阶梯上（那会把彩度洗掉），只强制与 paper 的亮度差 ≥88，这套 ramp **不是替换文字颜色，而是作为 tint 传给 difference filter**：着色器仍然逐像素决定 ink/paper，再把这个结果的**色相**换成 ramp 上对应位置的色、**亮度保持不变**（`toneLuminance / tintLuminance`）。gradient 模式因此既有封面色又保留反色的可读性保障——绕开 filter 直接给字上色会把这个保障扔掉，而补描边解决可读性又不符合这个模式的风格。ramp 按 filter 自身 bounds 的横向位置采样，所以颜色沿整行扫过。后处理复用 sonnet 的纯 GLSL filter（`sonnetLensFilter`/`sonnetGlitchFilter`/`sonnetPrintFilters`），其余不交叉引用。**这些 filter 一个都没设 `resolution`，而 pixi 的默认值是硬编码的 `1`**——直接挂上去等于把整个 scene 按 1x 光栅化再拉伸到 `textureResolution`（默认 1.5）的画布上，网点、细线和文字全部变软，也就是「开了后处理反而更糊」。现在 scene 上每个 pass 的 resolution 统一由 `temperaSceneFilters.ts` 的 `resolveTemperaPassResolution` 决定：默认 `'inherit'`（跟随画布），新设置 `postProcessTextureCompression`（**默认关**）则压回 `min(1, textureResolution)` 再拉伸，也就是旧行为，留给填充率吃紧的机器。pixi 对同一个数组里的 filter 取 **resolution 最小值**，所以整条链必须统一设置——不能只给其中几个设。转场模糊同理由 `resolveTemperaTransitionBlurResolution` 取「所在 pass 的一半」（默认 0.75、压缩时 0.5），而不是写死 0.5：写死的话 1.5x 的画面会在模糊刚挂上（strength 还看不出来）的那一帧直接掉到四分之一。

### 色块进场节奏

色块的 delay/span 是 shot 时长的比例（`resolveShotPacedDuration` 钳在 0~1.4s / 0.7~2.6s），因此动画节奏跟着歌词行推进；这里的「shot 时长」必须取 `shot.lyricEndTime` 而不是 `endTime`，理由见下面的「原始时间数据」。

## 逐字时序

改这一段之前先读「原始时间数据是怎么来的」：屏幕上每个字的 start/end 大部分不是源数据，而是词/音节时长的等分结果，未被 parser word 覆盖的字素还带着零时长，很多看起来像动画 bug 的现象根子在这里。

### 原始时间数据是怎么来的

逐字时间**几乎全是合成的**：`buildLineGraphemeTimeline` 只保证词/音节边界，词内是等分摊开，而两个 parser word 之间没被覆盖的字素（空格、标点）会被塞成**零时长并钉在后一个词的 startTime**。空格在排版阶段被跳过，标点不会——所以 `buildTemperaSegments` 粘标点时**必须给它重新计时**（只重定零时长的那些，有真实时间的保持原样），否则逗号会和它后面那个词一起入场、还把所在 segment 的 endTime 拖到那里去，进而污染整个 shot 的落位时刻。同理，「当前字」的凸起要跟着 `[startTime, endTime]` 这个真实区间走（起振→保持→衰减），不能从 startTime 起算倒计时：那样零时长的标点也会各弹一下。`shot.endTime` 是**平铺**出来的下一个 shot 起点（收尾 shot 还会顶到段落 render tail），并不是歌词结束；凡是按歌词节奏走的东西——色块和图片的进场 stagger——都要用 `shot.lyricEndTime`，否则间奏前那个 shot 会拖成好几秒、色块慢吞吞地进而文字早就落位了；而沿 flow 的持续 creep 仍然用 `endTime`，不然长 shot 会在后半段整个冻住。

### 入场窗口与 `glyphSettleStretch`

运动统一走 `temperaMotion.ts`（cubic-bezier 缓动 + 逐字 solver）。逐字入场窗口 = `0.34s + (本 shot 歌词结束 − 该字 startTime − 0.34) × SETTLE_STRETCH`。`SETTLE_STRETCH` 是唯一的旋钮，已经开放成 tuning `glyphSettleStretch`（默认 0.5），两端都实测过：**0** 等于每个字都拿同样的短窗口（快歌里每字 0.09s 内走完 80% 行程然后停住，很有打击感；但慢歌整句在第一秒内全部落位，之后彻底静止）；**1** 等于整个 shot 精确落在歌词结束那一刻（慢歌全程都在动；但快歌的平均「落位后静止时长」归零，全部字一直在飞，读起来是糊的）。默认 0.5：快歌里过半的字在切镜前已经静止，慢歌的入场仍然铺到句子深处；歌单节奏差异大的时候用户可以自己拨。注意它和 `glyphMotion` 不同——后者求解器每帧现读，这个是在排版阶段烘进 `settleTime` 的，所以必须进 `requiresSceneRebuild`。窗口对 startTime 单调递减，落位时刻也保持递增，所以是一道扫过去并收住的波，不会来回。目标是 **shot 内的歌词结束时间**：默认切分模式下不能照源行末尾去拉，否则 shot 都交接完了字还在往里飘；整句模式下 shot 的歌词结束时间自然就是该行末尾。传进 `resolveTemperaLayout` 的 `lines` 始终是这个 shot 自己的 slice 集合，同 shot 内的多个 slice 按同一个末端排期。入场曲线极度前重，所以长句是「一记果断的开场 + 长时间的慢爬」而不是慢吞吞地飘进来。**但透明度和残影不能跟着拉长**（`MAX_REVEAL_WINDOW`，1.35s）：字在移动过程中必须是可读的，残影拖过整句会变成糊而不是动感；短到够不着这个上限的入场行为完全不变。

### 唱完之后的 release

唱完的字进入 **release** 阶段而不是就地冻住：从「唱完 / 落位」中较晚的一刻起，整块文字以自身中心为基准**缓慢拉开字距**（每字位移 = 它到块中心的偏移 × 5.5%），斜坡长度等于该字所在**整句的时长**（不超过它）。刻意做成刚性的中心外扩——无浮动、无旋转、无缩放——飘移式的运动会和这个模式的确定性排版相矛盾；位移严格平行于自己的力臂且有上界，版式形状完全不变，只是间距变松。

## 运动与交接

每个 shot 有 `flowAngle`，相邻 shot 只小幅转向，色块进出场、镜头位移和转场（`block-wipe`/`camera-pan`/`shape-carry`）都沿同一方向，所以边界是「接力」而不是硬切；`block-wipe` 的色块按 0..2 连续行程扫过，1 为满覆盖，场景在满覆盖瞬间切换。

## 网点图形层

视觉层为「网点图形」语言：`temperaHatch.ts` 是纯函数生成器（斜线 hatch、抖动涂鸦折线、重复符行列、贯穿斜线、纸面点阵），`temperaShapes.ts` 把它们变成静态 Pixi Graphics，`temperaCompositions.ts` 按 shot kind 组合构图，`temperaBlocks.ts` 只保留 enter/exit 运动状态。每个 shot 的 `decor`（motif、hatch 角度、贯穿线数量、碎字）在 `temperaProgram.ts` 编译期由 seed 定死，渲染层零随机。

## 圆滑构图族（charm）

气泡、云朵窗、心形、kirakira 四芒星、花瓣扇、蕾丝波边、缎带 + 蝴蝶结、圆角贴纸板、柔光放射（`bubble-drift`/`cloud-window`/`heart-burst`/`sparkle-field`/`petal-arc`/`scallop-band`/`ribbon-loop`/`round-plate`/`halo-burst`，绘制在 `compositions/temperaCharmCompositions.ts`）。**其他族都是用直边切开画面，这一族相反：底面保持整块平涂，圆形放在上面**，所以字读作印在贴纸上而不是跨在分割缝上；也因此每个形状都保留 ink 描边——没有描边的柔和形状会化进底色，反色 filter 就没有边可切。曲线几何在 `temperaCurves.ts`（和 `temperaHatch.ts` 同一套纯函数约定：无 pixi、无 `Math.random`，一律输出扁平多边形），**凸性是硬约束**：`buildHatchLines` 靠半平面裁剪，只有 `ellipsePolygon` / `roundedRectPolygon` 能进 `drawHatchFill`，心形、星形、波边、缎带都是凹多边形，只能填充和描边（pixi 用 earcut 三角化，填充是安全的）。圆的集合走 `drawDiscs` / `drawRings`：**一整片气泡是一个 Graphics 节点**（否则十几个节点会各自进 block 动画器），节点 pivot 落在自身包围盒中心，`drift` 才是原地呼吸。同理，凡是要 `drift` 又不在画面中心的形状（散落的小心、星、花蕊），必须用 `ctx.createGroup(0, x, y)` 放到定位组里、几何按局部坐标画——`drift` 是绕节点自身原点缩放和旋转的，直接按绝对坐标画会让它绕画面原点公转。

## 镂空族（aperture / signal / corridor）

三族共用一件事：**色块层上真的挖洞**，洞里露出 shell 的背景层（`VisualizerBackgroundRenderer`，封面/shader，会随音频动）。能这么做是因为 runtime 的 `app.init` 用 `backgroundAlpha: 0`，pixi 画布本身是透明的。共用工具在 `compositions/temperaCutout.ts`，挖洞走 `temperaShapes.ts` 的 `drawPolygonFillWithHoles`（pixi `GraphicsContext.cut()`）。

- `aperture`（10 种，`temperaApertureCompositions.ts`）：一张平涂铁板 + 一个洞，洞的形状就是整个构图——圆孔、横缝、胶片齿孔与片门、十字、百叶、玫瑰窗、阶梯方孔、楔形、筛孔。
- `signal`（10 种，`temperaSignalCompositions.ts`）：几何仪表盘——准星、刻度盘、人字跑带、计数列、焦点网格、贯穿轴、频闪板条、套版错位、放射梳、取景括号。规矩的装饰围着**一个重心块**，重心块是画面里唯一允许喧哗的东西，字与它同框而不是躲开它。部分构图把洞打在重心块上。
- `corridor`（10 种，`temperaCorridorCompositions.ts`）：**沿 flow 方向开的通道**。这一族是为交接做的：相邻 shot 沿 flow 互相滑过，平行于 flow 的通道在滑动中还是同一条通道，接缝就不读作剪辑，背景层也一直从移动的开口里透着，而不是每切一次闪一下。所以这族的开口两端一律伸出画外——有端点的通道就是一个「形状」，形状会暴露剪辑点。

### 四条硬约束

1. **字不能压在洞上。** 反色 filter 读的是 pixi 的渲染结果，而 DOM 背景层在 WebGL 之外——洞里 filter 只能读到那层 0.35 的纸雾，判定出 ink，然后这个 ink 得自己在任意封面上活下来。深色封面 = 读不了。所以每个 kind 的 `region` 都是贴着自己那个洞排的，`test/unit/visualizer/temperaCutout.test.ts` 按采样点锁死这条：region 上每一点都必须被某个不透明填充盖住（可以是底板，也可以是盖在洞上的实心块，如 `bridge-span` 的横跨带、`ring-eye` 的轮毂）。
2. **洞要打穿到底才是窗。** 只在上层形状上 `cut` 出来的洞露的是下面的底板，不是背景（`axis-caps` 的轴孔、`offset-plate` 的套准孔因此**底板和每块板打同一个洞**）。反过来，`dial-scale` 的表圈不能用「圆盘挖洞」做——轮毂要托字，必须是实心底板，所以那圈用 `annularSectorPolygon` 画成实心环。
3. **一个挖洞节点只能有一条 fill 指令。** pixi 的 `cut()` 会往回找最近两条指令挂洞，第一个洞挂上以后那条分支**没有 break**，于是第二个洞会顺带挂到再上一条 fill/stroke 上。`drawPolygonFillWithHoles` 因此自己新建 Graphics、只画一次 fill，洞的描边一律另起节点（`addHoleLip`）。
4. **通道角度取 flow 的一半。** 原始 flowAngle 最多偏离垂直 ~14°，一条贯穿画面的通道两端会因此横向走 ±90px，足以把开口挪到字底下；而 region 是写死的数据。`channelAxis()` 把倾角朝自身垂直轴收一半，方向还在、横移减半，一次交接位移下的残差只有几个像素。同理 `acrossFlow()` 会把法向统一到 +x 半边——flow 有时朝上有时朝下，不归一化的话「向右偏移」会随 shot 翻面。

## 巨构族（monolith / terrain）

粗野主义：**一个大到画框装不下的哑光体量**，被画框裁掉一部分，字压在它的轮廓线上。共用语汇在 `compositions/temperaMonolithKit.ts`——体量本体、贯穿全画的细测量线、体量某一面的密排肋线、两个对角的角标、一段游离的线框轮廓。

- `monolith`（10 种）：物件式体量——`apex-mass` 大三角、`ziggurat` 阶梯塔、`slab-wall` 墙板、`cantilever` 悬挑梁、`pylon-pair` 双柱门（柱间镂空）、`bunker-slit` 掩体观察缝（镂空）、`plinth-stack` 基座垒叠、`buttress-run` 扶壁列（间隙镂空）、`void-core` 巨块掏空、`shear-block` 斜切错位。
- `terrain`（10 种）：结构与地形——`ridge-line` 山脊、`chasm` 裂隙（镂空）、`overhang` 压顶、`step-well` 阶梯井（井口镂空）、`pier-row` 桥墩列（水面镂空）、`revetment` 护坡、`tower-crop` 塔身局部、`lintel` 过梁、`rubble-fan` 碎块扇、`gnomon` 方尖与投影。

### 三条约束

1. **每个体量至少有一侧伸出画外。** 四条边都在画内的实体读作「纸上的一个图形」，同一个实体被画框裁掉才读作「大到装不下」——这就是这一族的全部效果。
2. **字压在轮廓上，不是躲开它。** 底面是实心的构图，`region` 一律骑在体量的轮廓线上（`apex-mass` 的三角顶尖正好顶进字框下沿、`ridge-line` 跨山脊、`slab-wall` 跨墙边）——半个字在体量上半个字在外，正是反色 filter 最出效果的地方。只有当构图把底面开给背景时（`pylon-pair`/`buttress-run`/`pier-row`/`step-well` 等），region 才整体挪到体量上，理由见「镂空族」。
3. **装饰必须细。** 测量线 1px/0.45、角标 1.6px、肋线是 hatch——巨构一旦被装饰围起来就不再巨大。肋线只画在体量的**一个面**上（两面就成了材质而不是受光面），而且 `addFaceRuling` 收的必须是**凸**多边形（`buildHatchLines` 靠半平面裁剪），所以阶梯状体量要单独传一块凸的切片进去。

## 文字反色

文字反色由 `temperaDifferenceFilter.ts` 完成：它声明 `blendRequired`，读取 `uBackTexture`（filter 区域下层已渲染像素）的亮度，逐像素在 ink / paper 中选对比更强的一色。filter 必须显式设 `resolution: 'inherit'`——pixi 的 `Filter` 默认是硬编码的 `1`，而 back texture 永远跟随渲染目标的 resolution，两张纹理经 `nextPow2` 池化后逻辑尺寸不同，同一个 `vTextureCoord` 会采到偏移位置（偏移随离原点距离线性增大），表现为文字成片反色错误、细 hatch 上尤其明显。反过来说，**只要反色 filter 保持 `'inherit'`，外层 scene pass 的分辨率怎么变都不会错位**：`'inherit'` 解析成「它正在渲染进去的那个 surface 的 resolution」，而 `uBackTexture` 也正是从同一个 surface 拷的，两者永远同一个值、同一个池化尺寸。所以纹理压缩开关（见上一节）对反色是安全的；不安全的做法是给文字层的 filter 写死一个 resolution，或者指望同一个数组里混着不同 resolution 的 filter 各跑各的（pixi 会取最小值）。filter 只挂在 textLayer 上（bounds 越小拷贝越少），叠影副本必须放在**被 filter 的那一层里面**，不能放在它下面——放下面它就成了 filter 要读的底色，每个字会对着自己的重影反色、沿笔画碎成硬斑块；放在层内则重影和字被同一次判定统一上色，读作套版偏移的第二次印刷。换句话说 filter 之下的层里不能出现任何字形状的东西（装饰大字是例外，它就是要让歌词跨过它翻色）；Tempera 没有 halo 泛光层——screen 混合的辉光会把字洗白，而且无论放在字上还是字下都会变成 filter 要读的底色；current-glyph 不画任何衬底块（衬底会变成 filter 读到的底色，结果就是一个纯色方块而不是对画面的反应），改用极小的缩放起伏表示当前字；runtime 的 `app.init` 需要 `useBackBuffer: true`，否则 WebGL 下整个 filter 栈会被 skip（文字退化为静态 ink 色）。**反色层之上不能停放任何「挂着但 disabled」的 filter**：pixi 复制 `uBackTexture` 时是按 filter 栈上*外层*那个 filter 的 bounds 取原点的，而 disabled 的 filter 仍然会被 push 成一条 skip 记录，`_getPreviousFilterData` 又会把这条 skip 记录返回回来（它的 `bounds` 还停在初始的 `Infinity`），于是拷贝原点塌成 (0,0)——每个字都对着画面**左上角**那块像素反色，而不是自己底下的画面。段落 scene 上的转场模糊以前就是这么停着的，只有开了后处理时外层才换成一条有效记录，所以「不开后处理反色就读错纹理」。现在模糊只在真的模糊时才挂到 scene 容器上（`temperaSceneFilters.ts` 的 `setTemperaTransitionBlur`，不模糊时把 `container.filters` 置空数组让 pixi 摘掉整个 effect），不再用 `filter.enabled` 停放。反色有自己的开关 `textInversion`（**默认开**），不挂在 `postProcessEnabled` 下——后处理是一条用户随时会关掉的观感开关（它现在默认开，但早先默认 false，挂上去等于整个效果对绝大多数用户是死的），而反色是这个模式给文字上色的方式，两者不能绑在一起。gradient 色彩模式**不会**自动关掉反色——ramp 是作为 tint 传进同一个 filter 的（着色器照样逐像素判定 ink/paper，只换色相、保住判定出来的亮度）。反过来说，用户手动关掉 `textInversion` 时**也不能把 filter 一起丢掉**：gradient 的文字颜色只存在于这个 filter 的 tint 里，丢掉 filter 等于把整个色彩模式退回纯 ink 文字。所以 `textInversion: false` + gradient 会退化成 **tint-only 形态**（`createTemperaDifferenceFilter` 的 `inversion: false`：不声明 `blendRequired`、不读底色、fragment 里连 `uBackTexture` 都不声明，只把 ramp 铺上去——ramp 的四个色本来就保证与 paper 的亮度差 ≥88，所以离开反色也仍然可读）；duo/mono 没有 ramp，关掉反色就是普通 ink 文字，这时才真的不挂 filter。两处文字都走 `temperaSceneBuilder.ts` 的 `createTemperaTextFilter`（shot 的 textLayer 和片尾卡标题），不要各自判断。`temperaPalette.ts` 的 `ensureInkContrast` 保证 ink 与 paper 的亮度差 ≥96，否则（主题把浅色 primary 配浅色背景时）反色只是在两个几乎相同的浅色之间二选一。

## 片尾卡

片尾卡**必须用和 shot 完全相同的绘图语汇**，否则它会读成一张贴在歌尾的独立标题屏：tone1 满出血底 + 沿 tone 阶梯递进的实心块（tone2→tone3→tone4，最亮的压在最上，标题才有真正的边界可跨）+ 与 split 系一致的硬墨缝（`palette.ink` 2.4px / 0.8）+ 一道网点 hatch + 每个 shot 都带的那两层共享装饰（满出血 crossing lines、角落 motif）；渐变模式下它也走同一条四色 ramp。块本身是**圆心全部落在画外的部分圆盘**，各自从自己那侧扫进来、圆弧在画面中央交叉，标题因此同时横跨两三条明暗边界，**同样挂 difference filter**，一个词内部会被切成两色。卡片不是静帧——各元素错峰淡入滑入后沿各自内推方向持续缓慢推移（`1 - e^(-t/7)` 渐近，永远在动且不会跑飞），标题本身固定不动，靠底下形状的移动让反色不断重新切割。它以自身原点为中心绘制，所以 `creditsContainer.pivot` 必须保持 (0,0)——再给一个视口 pivot 会把整张卡挪到画面左上角、切掉一半。

## 画布图片池

用户可以往画布上放自己的图片（立绘/logo/纹理），它们构成一个**图片池**：每个 shot 由 seed 随机取一张（`resolveTemperaShotImage`，相邻 shot 不重复，`layerImageFrequency` 控制出现频率），位置由横纵两个轴的**对齐倾向**加 seed 抖动算出（`resolveTemperaImagePlacement`）。文件走 `visualizerImageAsset` 存进 IndexedDB，tuning 只保留 id、对齐、大小和不透明度；预览缩略图与渲染原图分开加载。编辑集中在 `TemperaImageLayerDialog` 的 draft 中，关窗时一次性提交。整组图片通过 `src/services/temperaImageArchive.ts` 导入导出 zip：`meta.json`、仅含 `layerImages` 的 `pool.json`，以及按 MIME 添加明确扩展名的 `images/<id>.<ext>`。导入会校验并钳制 placement，逐张写入失败或取消时回滚本次已写 blob；替换模式只把旧 id 记入待删除集合，直到新 draft 正式提交才删除旧文件。添加和导入期间禁止内层关闭；若外层设置页按 Esc 卸载，则 AbortSignal 会取消流程并回滚，不能破坏 live tuning。底部只有“添加图片”“导入备份”“导出备份”三个文件操作；“导入备份”在原地菜单中选择“追加到当前图片池”或“替换当前图片池”，拖入 zip 默认追加。压缩与解压使用 fflate 异步入口，结果通过 toast 汇报。

**OBS 源由本地服务器以 `127.0.0.1:PORT` 提供，与主窗口不同源，读不到那个 IndexedDB**——所以图片池和 monet 背景/portrait、cappella 表情包一样，由 `useObsBrowserSourcePublisher` 解析成 data URL 随 SSE config 一起下发（`ObsBrowserSourceConfig.temperaLayerImageAssets`）；收到内联资源时 `VisualizerTempera` 完全不查存储。层次是全局设置：`back` 排在**反色 filter 之下**，立绘于是和色块一样会把歌词切开；`front` 压在歌词之上。纹理在 runtime 创建时一次性建好、由所有段落 scene 共用（scene 会随播放不断重建，逐 scene 加载会抖）；**不能用 `Assets.load`**——它按 URL 后缀选 parser，而 blob URL 没有后缀，会直接拒绝加载。改为把 Blob 交给 runtime 自己 `createImageBitmap`（SVG 回落到 `Image` 元素）再 `Texture.from`，顺带连 object URL 的生命周期都不用管了。

## 渲染分辨率与纹理池

`textureResolution`（默认 1.5）不是直接交给 pixi 的，先过 `../pixi/pixiTextureBudget.ts` 的 `snapResolutionToTexturePool`。原因是 pixi 的 `TexturePool.getOptimalTexture` 把每个 render target 逐轴向上取整到 2 的幂（`nextPow2(ceil(frame * resolution - 1e-6))`）并按这对尺寸做池 key，**一个 pass 是按「档位」计费而不是按画幅计费的**：781x850 的视口在 1.5x 下光栅化成 1172x1275，落进 2048x2048 的档，16MB 的纹理里 71% 从来没画过东西。Tempera 同时挂着若干这样的全屏 pass，加上反色 filter 的 backdrop 拷贝，浪费是成倍的。

代价因此是**阶梯式而不是线性的**，这一点最容易估错：Intel 核显实测，窗口从 640x640 放大到 700x700（面积 +18%）会把常驻 GEM 从 628MB 抬到 822MB（+31%），只因为 1.5x700 越过了 1024，所有池化目标同时在两个轴上翻倍——画面本身没有任何变化配得上这个涨幅。

所以吸附**只让出能换到更小档位的那部分分辨率**，而不是全局调低（全局调低哪儿都变糊，还是会落在原来那一档）。同一个 781x850 视口上它返回 1.2047 而不是 1.5：糊 20%，但池化目标从 2048x2048 降到 1024x1024（四分之一的显存），画幅对纹理的填充率从 29% 升到 92%——**每字节换到的清晰度是升的**。实测 tempera 在该视口下 GEM 978 -> 689MB（-30%），且 640/700 两档之间的跳变消失。

三条约束：

- 吸附**每轴只考虑降一档**，且只接受落在 `TEXTURE_POOL_MAX_RESOLUTION_DROP`（25%）以内的候选。边界太远的视口（2000x1200 在 1.5x 下要降到 1.024，砍 32%）保持原样——那种情况下多付一个档位比把整幅画糊掉三分之一划算。
- 吸附值**随视口变化**，不只随设置变化，所以 `resizeToHost` 每次都要重算并跟着 `renderer.resize(w, h, resolution)` 一起下发；`setTuning` 比的也是吸附后的值，两个相邻滑块位置共用一个档位时不该白白重建 surface。
- runtime 里那些**写死数值的 filter pass 一律从吸附后的 `renderResolution` 派生，不能读 `tuning.textureResolution`**（`resolveTemperaPassResolution` / `resolveTemperaTransitionBlurResolution` 的第二个参数就是它）。读设置的话，pass 会去要一个比它实际落地的 surface 更大的档位，正好是吸附想消掉的那部分浪费。

吸附出来的画面与「用户手动把滑块拨到同一个值」**逐像素一致**（实测最大差 1/255），所以它不是一种新的渲染模式；`requiresSceneRebuild` 早就把 `textureResolution` 当作改变 scene 内容的字段，构图随分辨率轻微重排是这个模式一直以来的行为。

## tuning 的下发与重建

tuning 变化通过 `runtime.setTuning()` **就地下发**，不重建 runtime：滑块拖动时每次 pointermove 都会产出新 tuning，而重建意味着重新初始化 WebGL、重新解码所有图片、重新测量所有行。只有真正改变 scene *内容* 的字段（色彩模式、显示开关、后处理、图片增删或层次变化）才清空 scene 缓存；cameraIntensity/glyphMotion 每帧现读，墨染奥行的 depthPan/glyphDepth 也是；depthOfField 一半现读（视差幅度）、一半烘焙在 scene 里（模糊），所以它不进 `requiresSceneRebuild`，而是滑块停住 250ms 后重建一次 scene（`scheduleDepthBlurRebake`），拖动过程中只有视差跟手；图片的位置/大小/旋转/透明度直接重设到已有 sprite 上（开着景深时，只有大小、翻转变了才重新烘焙那张图的模糊，见下面「墨染奥行」）。图片 blob 的加载按 **id 集合**（字符串 key）而不是数组引用触发，否则拖一次滑块就会把 IndexedDB 全读一遍。

## 墨染奥行（智能动感模式）

凝彩的动感效果（`entry.tsx` 的 `beatEffects`，id `tempera.inkFlash`，读 htdemucs 的鼓点）。一个开关管两件事，关着时凝彩和没有这个效果时一样：

- **墨**（`temperaInkFlash.ts`）：纸面平时一层浅灰水渍，底鼓、军鼓打下时漫过一片凝彩强调色的墨渍、水渍同时退掉，约 0.4 秒淡回。一张全屏 mesh、一个 GLSL ES 3.0 pass 画水渍和前后两次墨渍；每帧只由当前时间之前最近的鼓点决定，不累积状态，拖进度条、暂停后画面一致。只在 WebGL2 下开；静态模式、这首歌还没有鼓点时整层隐藏。四张噪声纹理每个进程生成一次，在效果打开后用 `requestIdleCallback` 分批生成，不占帧循环，齐之前墨不显示。
- **景深与运镜**（`temperaDepth.ts`，逐帧部分在 `temperaShotFrame.ts`）：水印和背景图片在后、略虚、走得慢；前景图片在前、更虚、走得快；歌词层不模糊也不跟着视差动（反色滤镜要读它下面的像素）。模糊在建 scene 时按一半渲染分辨率烘焙成图（`createTemperaBlurBaker`），之后只平移这张图；图片的烘焙只在大小、翻转或半径变了时重做（`temperaImageLayer.ts` 的 bake key）。每个 shot 沿上下左右之一移镜头；字号即远近：大字在前、领先镜头，小字在后、落后并变淡，位移有上限，不会被带出画面。
- 三个强度 tuning：`depthOfField`（景深：模糊半径和视差，模糊部分停手 250ms 后重建 scene）、`depthPan`（移镜头）、`glyphDepth`（歌词远近）。开关切换时运行时重建 scene（模糊是烘焙的），镜头和字的远近在 0.6 秒内缓入缓出（`depthMix`）。

## 音频

Tempera 渲染层不消费音频（`audioPower`/`audioBands` 只传给共享背景层）；「墨染奥行」读的是鼓点，见上一节。
