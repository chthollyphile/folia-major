import { compileCineramaProgram, findCineramaPlanAtTime } from './cineramaProgram.mjs';
import {
    CINERAMA_IDLE_ANIMATION_FRAME,
    resolveCineramaLinePhase,
} from './cineramaAnimation.mjs';
import {
    isCineramaTransitionAdjacent,
    resolveCineramaBandEnterPresence,
    resolveCineramaBandExitPresence,
    resolveCineramaRelayDuration,
    resolveCineramaTransitionDuration,
    resolveCineramaTransitionEnterFrame,
    resolveCineramaTransitionExitFrame,
} from './cineramaTransition.mjs';
import { createCineramaStage, resolveCineramaPalette } from './cineramaStage.mjs';
import { buildCineramaLayer, cineramaOutgoingKeepsMoving, readBandStageMetrics } from './cineramaRender.mjs';
import { isCineramaRibbonRelayPair } from './cineramaTreatment.mjs';
import {
    cineramaLayoutWeights,
    cineramaStructureSignature,
    cineramaStyleWeightSignature,
    cineramaStyleWeights,
} from './cineramaOptions.mjs';
import { hasCineramaHostBackground, readCineramaViewportAspect, resolveCineramaKnobs } from './hostPanel.mjs';
import { createCineramaSettingsPanel } from './settingsPanel.mjs';

// mods/cinerama/visualizer.mjs
// Renderer-side contribution (apiVersion 1, imperative contract): builds the
// stage screen once, then swaps one content layer per line and drives it from
// currentTime. 行级 enter/hold/exit 包络打在 stage.textHost（内容层挂载点，跨行
// 常驻）上；层内运动——unit 落位、跑马灯滚动、丝带推进——由
// cineramaRender.mjs 自己负责，两边不重叠写同一批属性。
//
// 旋钮两个来源：巨幕自带面板的持久化值，盖一层宿主暴露的实时调制
// （props.getModulation，k3panel 同款通道）。结构旋钮变化时立即重建当前层，
// 不用等下一行。面板的挂载/补挂也在 mount 里起（见 hostPanel.mjs）。
//
// Sub-modules are plain relative ESM imports over folia-mod://. Note the loader
// only versions the *entry* URL (?v=<digest>), so an edited sub-file stays in
// the browser's ES module map until the browsing context is recreated — reload
// the window after touching anything other than this file.

export default {
    mount(element, props) {
        /*
         * 调色板先解算：屏面的颜色与「亮还是暗」都从主题派生，而「亮暗」要靠一个临时
         * 探针节点让浏览器把主题色解析成 rgb 才量得准——探针挂在模组自己的挂载点里
         * （`element`，读完立刻摘），不碰宿主的其它节点。
         */
        let palette = resolveCineramaPalette(props.theme, element);
        /*
         * 透明表面（播放页透明 / OBS 浏览器源 / 模组导出窗口）不画屏面。
         * 屏面是一整块不透明的墙（`inset:0` + 渐变），在需要透明的场景里画上它，
         * 整段导出就变成一块实心矩形——「需要透明背景时用了不必要的背景色」。
         * 屏面缺席时文字自己的 `text-shadow` 仍然提供可读性，扫描线与暗角也一起去掉。
         *
         * 宿主已经在模组后面画了「背景类型」定义的背景时（`props.background`），
         * 屏面的**填充**让位（扫描线/暗角仍在）：否则那层墙会把用户选的背景整块盖住，
         * 背景类型怎么调都对巨幕不生效。墙让位之后文字的可读性靠内容层自己的
         * text-shadow 与主题配色承担，和透明表面那一档是同一条路。
         */
        let hostBackground = hasCineramaHostBackground(props);
        const stage = createCineramaStage(element, palette, {
            transparentSurface: Boolean(props.transparentSurface),
            hostBackground,
        });
        /*
         * 主题与背景配置是**会变但不能重挂**的量：宿主在 mount 之后不会再换一份 props，
         * 所以只能走 getter（见 src/mods/modVisualizers.tsx 的 getTheme / getBackground）。
         * 旧宿主没有 getter 时退回 mount 那份快照，行为与以前一致。
         */
        const readTheme = () => (typeof props.getTheme === 'function'
            ? (props.getTheme() ?? props.theme)
            : props.theme);
        const readBackground = () => (typeof props.getBackground === 'function'
            ? (props.getBackground() ?? props.background)
            : props.background);

        /*
         * 两个来源都可能缺席（导出窗口、旧宿主）；resolveCineramaKnobs 全部回落缺省。
         * 画面宽高比顺带每帧实测：大字报的横向可用宽度要它（可用框的 vw 折成 vh），
         * 量不到时解析层回落 16:9。
         */
        const readOptions = () => resolveCineramaKnobs(props, {
            /*
             * 量 **root**（整个舞台）而不是 textHost（屏面）：大字报的横向预算写的是
             * 「舞台宽度的一个百分比」，要的是舞台宽高比。屏体现在铺满舞台，两者恰好相等；
             * 但哪天屏体再留边，量 textHost 就会把字号按屏体比例放大一次，字会出屏。
             */
            viewportAspect: readCineramaViewportAspect(stage.root),
            // 周期要的环境量：只在字体到位 / 窗口缩放时才变，一次性跟着这份快照下发。
            stageMetrics: readBandStageMetrics(stage.root),
        });

        /*
         * 样式是**编译期**按权重抽的（要「相邻不重复」就只能逐行串着定），所以 program
         * 必须带着当前权重编一次；权重后来被拖动时由 paint 里的签名比对重编（见下）。
         */
        const compileProgram = () => {
            const knobs = readOptions();
            return compileCineramaProgram(
                props.lines ?? [],
                `${props.songTitle ?? ''}|${props.songArtist ?? ''}`,
                {
                    title: props.songTitle ?? null,
                    // 两条编译期轴各自一组权重：样式（排版本体）与排版（落点）。
                    styleWeights: cineramaStyleWeights(knobs),
                    layoutWeights: cineramaLayoutWeights(knobs),
                },
            );
        };
        let program = compileProgram();

        /*
         * 设置面板只在真正挂到宿主 DOM 的窗口里起：导出窗口/缩略图没有设置界面，
         * staticMode 下也不该插面板。
         *
         * 这一处必须兜住：它是 mount 里唯一一段没包 try 的 DOM 交互，而面板定位依赖
         * 宿主内部结构（锚点、卡片类名）——宿主换版本后失效的代价只能是「面板不出现」，
         * 不能是「这个歌词动画模式整体不可用」。与 paintFrame / buildCineramaLayer 同一口径。
         */
        let disposeSettingsPanel = null;
        if (!props.staticMode) {
            try {
                disposeSettingsPanel = createCineramaSettingsPanel();
            } catch (error) {
                console.warn('[cinerama] settings panel failed, continuing without it', error);
            }
        }

        /*
         * Per-frame writes go through a last-value cache: the painter runs on
         * every motion tick, and re-assigning an identical string still costs a
         * style invalidation on an element this large.
         *
         * 包络现在写在**每一层自己的根节点**上，不再打在 stage.textHost 上：
         * 转场那一段里两层同时在屏上，各自要写各的（见 renderPlan / paint）。
         */
        const createEnvelopeWriter = (node) => {
            const last = new Map();
            return (property, value) => {
                if (last.get(property) === value) return;
                last.set(property, value);
                node.style[property] = value;
            };
        };

        /*
         * 转场包络写在哪一层：`envelope` 是**内容层**（不含跑马灯带），
         * 只有它该吃 opacity / transform（见 cineramaRender.buildCineramaLayer）。
         * 兜底层没有这一层，退回自己的根节点。
         */
        const envelopeRoot = (layer) => layer.envelope ?? layer.root;

        /*
         * 跑马灯带单独一套包络，**只写不透明度**。
         *
         * 带是屏级家具：整段转场里几何必须恒定（它不参与包络的 transform）。
         * 两层同时在屏上时，两份带上的字叠在同一圈上会互相穿插，所以交接
         * 只能按「退场方前半场淡出、进入方后半场淡入」——两个半场互斥，
         * 任何一帧只有一条带在屏上。见 cineramaTransition 的
         * resolveCineramaBandExitPresence / EnterPresence。
         */
        const bandWriter = (layer) => (layer.bands ? createEnvelopeWriter(layer.bands) : null);
        const applyBandOpacity = (writer, presence) => {
            if (!writer) return;
            writer('opacity', presence.toFixed(3));
        };

        // 帧形状只有转场层那一种，恒等帧与它同形状，所以这里不需要按来源分叉。
        const applyFrame = (set, frame) => {
            set('opacity', frame.opacity.toFixed(3));
            set('transform', `translate3d(${(frame.x * 100).toFixed(2)}%, ${(frame.y * 100).toFixed(2)}%, 0) scale(${frame.scale.toFixed(3)})`);
            set('filter', frame.blur > 0.01 ? `blur(${frame.blur.toFixed(2)}px)` : 'none');
            set('clipPath', frame.clip ?? 'none');
        };

        /*
         * 当前层根节点该显示哪一帧。形态只有转场那一套，所以这里只是把「行窗口的相位」
         * 翻成转场的 enter / exit 帧；恒等帧按定义不带任何形态。
         */
        const resolveLayerFrame = ({ plan, relayIn }, phase, progress) => {
            /*
             * 'pre'（时间早于本行起点）当前**不可达**——`findCineramaPlanAtTime` 只在
             * `time >= plan.startTime` 时返回这一行，而 `plan.startTime === window.startTime`。
             * 仍显式按「还没出现」处理：将来若给行加 lead-in（窗口起点早于行起点），
             * 落进恒等帧就是整屏满不透明地提前出现。
             */
            if (phase === 'pre') return { ...CINERAMA_IDLE_ANIMATION_FRAME, opacity: 0 };
            if (phase === 'exit') return resolveCineramaTransitionExitFrame(plan.transition, progress, plan.seed);
            if (phase !== 'enter') return CINERAMA_IDLE_ANIMATION_FRAME;
            // 接力（relayIn）的入场由丝带自己演，根包络必须保持恒等。
            return relayIn
                ? CINERAMA_IDLE_ANIMATION_FRAME
                : resolveCineramaTransitionEnterFrame(plan.transition, progress, plan.seed);
        };

        /*
         * 兜底层：建层失败时用最朴素的一行文字顶上。paint() 里抛异常会被 MotionValue
         * 的订阅链吞掉并断开订阅，表现是整屏冻住而不是「这一句没效果」，所以这里必须兜住。
         */
        const buildFallbackLayer = (plan) => {
            const root = document.createElement('div');
            root.style.cssText = [
                'position:absolute', 'inset:0', 'display:flex', 'align-items:center',
                'justify-content:center', 'text-align:center', 'white-space:pre-wrap',
                // 注意：这一层的 px 上界是**故意留着**的——它是不参与面板倍率的异常兜底
                // （`buildCineramaLayer` 抛错时的替补），只有这一处可以这样写。
                // 正式路径一律「只兜 px 下限」：见 TUNING.smallType 那条注释，
                // vh 旁边挂绝对 px 上界会在高屏上把倍率的顶部吃掉。
                'padding:0 8%', `color:${palette.screenText}`, 'font-size:clamp(20px, 11vh, 236px)',
            ].join(';');
            root.textContent = plan.line?.fullText ?? '';
            return { root, update: () => {} };
        };

        /*
         * 两个槽位：**当前行**与**正在退场的上一行**。
         * 转场的那一段里两层同时在屏上（见 cineramaTransition），所以「整屏一个内容节点」
         * 不再成立——旧层要先留着当退出方，两层各写各的包络。
         */
        let renderedIndex = -1;
        let structureKey = '';
        let weightKey = cineramaStyleWeightSignature(readOptions());
        let current = null;
        // 逐帧失败只告警一次（换一行才重新允许），避免按帧刷屏。
        let paintFailed = false;
        let outgoing = null;
        let updateFailed = false;

        const disposeSlot = (slot) => {
            if (!slot) return;
            slot.layer.dispose?.();
            slot.layer.root.remove();
        };

        // Rebuilt when the active line changes or a structural knob moves.
        const renderPlan = (plan, options) => {
            // 上一层还在退场就又换层（seek / 跳行）：直接丢掉，不留残影。
            disposeSlot(outgoing);
            outgoing = null;
            /*
             * 下一行紧邻时，旧层**留在屏上当转场的退出方**。丝带→丝带（且紧邻）改走
             * **接力**而不是整层溶解：退出方不冻结，逐条丝带自己撕走/让位
             * （见 cineramaRender.buildRibbon），窗口也更长一档。
             * 冻结的理由只对大字报那类层成立（块按行窗口闪现，越界全透明）；
             * 其余层仍按原样冻结 + 溶解，**但丝带层例外**：它整行都在屏上且有运动，
             * 冻结半秒读出来就是「丝带卡住了」（`cineramaOutgoingKeepsMoving`）。
             */
            if (current && isCineramaTransitionAdjacent(current.plan, plan)) {
                const relay = isCineramaRibbonRelayPair(current.plan, plan);
                outgoing = {
                    plan: current.plan,
                    layer: current.layer,
                    set: current.set,
                    setBands: bandWriter(current.layer),
                    boundary: plan.startTime,
                    duration: relay
                        ? resolveCineramaRelayDuration(current.plan, plan)
                        : resolveCineramaTransitionDuration(current.plan, plan),
                    relay,
                    // 非接力的丝带层退出时也要继续走自己的运动（见上面的说明）。
                    keepUpdating: cineramaOutgoingKeepsMoving(current.layer),
                };
            } else {
                disposeSlot(current);
            }
            let layer;
            /*
             * relay 的两半相互独立，链中间的一行会同时拿到：
             *   - enter：这一行入场时的贴新编排。staged = 屏上真有一个正在退的
             *     上一行（正常播放跨过边界）；seek 直接落进这一行时不播，丝带全部就位。
             *     丝带定义本身（继承 + 贴新）与 staged 无关，永远按 plan.prevPlan 解算。
             *   - exit：这一行退给下一行时的撕走/让位划分（下一行也是紧邻的丝带才成立）。
             */
            const nextPlan = program.plans[plan.index + 1] ?? null;
            const relayEnter = plan.prevPlan && isCineramaRibbonRelayPair(plan.prevPlan, plan)
                ? {
                    boundary: plan.startTime,
                    duration: resolveCineramaRelayDuration(plan.prevPlan, plan),
                    staged: Boolean(outgoing) && outgoing.plan === plan.prevPlan,
                }
                : null;
            const relayExit = nextPlan && isCineramaRibbonRelayPair(plan, nextPlan)
                ? {
                    boundary: nextPlan.startTime,
                    duration: resolveCineramaRelayDuration(plan, nextPlan),
                    nextPlan,
                }
                : null;
            const relay = relayEnter || relayExit ? { enter: relayEnter, exit: relayExit } : null;
            try {
                // 层内 update 每帧都要读旋钮：走本帧快照，别再去量一次 clientWidth。
                layer = buildCineramaLayer({ plan, palette, options, getOptions: optionsForFrame, relay });
            } catch (error) {
                console.warn('[cinerama] layer build failed, falling back to plain line', error);
                layer = buildFallbackLayer(plan);
            }
            stage.textHost.append(layer.root);
            /*
             * 入场 / 退场的形态一律由转场层给（`plan.transition`），不再分「有没有旧层」：
             * 有旧层时它与退出方交叉，没有旧层时只是自己淡进来，同一条 enter 帧都成立。
             * 接力（relayIn）是例外：入场编排由丝带自己演，根包络保持恒等，
             * 否则整层溶解会把继承丝带叠成两份文字。
             */
            current = {
                plan,
                layer,
                set: createEnvelopeWriter(envelopeRoot(layer)),
                setBands: bandWriter(layer),
                relayIn: Boolean(relayEnter?.staged),
            };
            renderedIndex = plan.index;
            // 换了一行就重新允许告警：否则第一次 update 失败之后，后面所有行的失败
            // 都静默过去，排障时只剩一条日志。
            updateFailed = false;
            paintFailed = false;
        };

        /*
         * 每帧只解析一次快照：readOptions 要量 clientWidth/clientHeight（强制同步布局），
         * 而层内 update 还会各自再读一次（带丝带的行一帧能读三四次，且夹在样式写入
         * 之间 = layout thrashing）。同一份里还带着周期要的环境量（根字号 / 视口 / 带盒宽），
         * 层内因此不必再读布局。这里按「帧计数」缓存，同一帧内所有人共用一份。
         */
        let frameOptions = null;
        const optionsForFrame = () => {
            if (!frameOptions) frameOptions = readOptions();
            return frameOptions;
        };

        let lastTheme = props.theme;

        const paintFrame = (timeSec) => {
            // 时间不是有限值（NaN 来自未初始化的 MotionValue / 坏数据）时别动画面：
            // 下面的比较全是 false，最终会把两层都拆掉、整屏空白。
            if (!Number.isFinite(timeSec)) return;
            frameOptions = null;
            /*
             * 换主题（亮 ↔ 暗）宿主不会重跑 mount（mount 的依赖只跟歌词走），
             * 而屏面、文字色都从主题派生——所以这里每帧比对一次
             * 主题对象，变了就重新解算、重刷屏面、并重建当前层。
             * 主题走 getter：mount 之后宿主不会再换一份 props，快照是死的。
             */
            const theme = readTheme();
            if (theme !== lastTheme) {
                lastTheme = theme;
                palette = resolveCineramaPalette(theme, element);
                stage.applyPalette(palette);
                // 换主题与改结构旋钮都**不做交叉**：旧层是旧配色/旧档位，
                // 留着退场只会拖出一帧错色的残影。这里直接拆干净再重建。
                disposeSlot(outgoing);
                outgoing = null;
                disposeSlot(current);
                current = null;
                renderedIndex = -1;
            }
            /*
             * 「背景类型」换了（用户在设置里切背景）与换主题同理：宿主重绘的是它自己那一层，
             * mount 不会因此重跑，所以这里也每帧比对。只翻屏面填充的开关，不重建舞台——
             * textHost 上挂着正在放的内容层，重建会把它们一起拆掉。
             */
            const nextHostBackground = hasCineramaHostBackground({ background: readBackground() });
            if (nextHostBackground !== hostBackground) {
                hostBackground = nextHostBackground;
                stage.applyScreenFill(!hostBackground);
            }
            const options = optionsForFrame();
            /*
             * 样式权重变了要**重编 program**：每一行的样式都可能换，重建当前层只是把
             * 这一句重排一次，后面那些行拿到的还是旧权重抽出来的结论。
             * 权重签名之外其余结构旋钮不影响编译，所以只在这里比对权重。
             */
            const nextWeightKey = cineramaStyleWeightSignature(options);
            if (nextWeightKey !== weightKey) {
                weightKey = nextWeightKey;
                program = compileProgram();
            }
            const key = cineramaStructureSignature(options);
            if (key !== structureKey) {
                // 结构旋钮变了：强制当前行重建，样式/带型与条数字数改动即时可见。
                structureKey = key;
                disposeSlot(outgoing);
                outgoing = null;
                disposeSlot(current);
                current = null;
                renderedIndex = -1;
            }
            const plan = findCineramaPlanAtTime(program, timeSec);
            if (!plan) {
                if (renderedIndex !== -1) {
                    disposeSlot(outgoing);
                    outgoing = null;
                    disposeSlot(current);
                    current = null;
                    renderedIndex = -1;
                }
                return;
            }
            if (plan.index !== renderedIndex) renderPlan(plan, options);
            if (!current) return;

            /*
             * 退出方：转场窗口内按这一行的转场形态退走，出了窗口就拆掉。
             * 窗口两侧都判（< boundary 也要拆）：seek 回到边界之前时，
             * 冻结的旧层否则会永远留在屏上。
             * 接力（relay）是例外：退出方**不冻结也不溶解**——根包络保持恒等，
             * 继续 update 让逐条丝带自己演完撕走/让位（见 cineramaRender.buildRibbon）。
             * 非接力的丝带层是另一档例外（`keepUpdating`）：根包络照常走转场溶解，
             * 但**层内运动继续**——丝带整行都在屏上、没有逐块闪现那一套，冻结它
             * 只会读成「丝带卡住了」。
             * update 抛异常就把整层丢掉：逐帧函数抛异常会断开 MotionValue 的订阅链，
             * 表现是整屏冻住，宁可少一层退出方。
             */
            if (outgoing) {
                const elapsed = timeSec - outgoing.boundary;
                if (elapsed < 0 || elapsed >= outgoing.duration) {
                    disposeSlot(outgoing);
                    outgoing = null;
                } else {
                    applyFrame(
                        outgoing.set,
                        outgoing.relay
                            ? CINERAMA_IDLE_ANIMATION_FRAME
                            : resolveCineramaTransitionExitFrame(
                                outgoing.plan.transition,
                                elapsed / outgoing.duration,
                                outgoing.plan.seed,
                            ),
                    );
                    /*
                     * 带的交接走自己那半场（**只写不透明度**）：退场方的带在前半场
                     * 淡到 0，进入方的带在后半场才起来。两个半场互斥，屏上永不同时
                     * 出现两条带——两份带上的字叠在同一圈上会互相穿插。
                     * 几何一律不动，所以「框缩放」不会回来。
                     * 这里的 `elapsed / duration` 与进入方用的是同一个窗口长度，
                     * 所以两侧在窗口正中精确换手（见 cineramaTransition）。
                     */
                    applyBandOpacity(
                        outgoing.setBands,
                        resolveCineramaBandExitPresence(elapsed / outgoing.duration),
                    );
                    if (outgoing.relay || outgoing.keepUpdating) {
                        try {
                            outgoing.layer.update(timeSec);
                        } catch (error) {
                            console.warn('[cinerama] exit update failed, dropping outgoing layer', error);
                            disposeSlot(outgoing);
                            outgoing = null;
                        }
                    }
                }
            }

            /*
             * 当前行的两个半场，形态都取自转场层：
             *   - 退场：下一行紧邻时交给转场（`exit: 0` → 进不到这一相），
             *     不紧邻才自己按转场的 exit 帧淡到 0。
             *   - 入场：转场的 enter 帧。紧邻时它与退出方交叉，不紧邻时
             *     （首行 / 空档后起行）只是屏上没有旧层，同一条帧照样成立。
             *     早先这一半走的是行自己的动画轴（fade / slide-up / wipe / …），
             *     其中 `wipe` 是 opacity 恒 1 + clip 硬边自左向右扫，交叉时那条硬边
             *     会扫过还没退干净的旧层（「横向刷新了一下」）——现在没有这条轴了。
             *     丝带接力（relayIn）是例外：贴新的编排由丝带自己演
             *     （buildRibbon 的 relay.enter），根包络必须保持恒等——
             *     整层溶解会把继承丝带叠成两份文字。
             */
            const next = program.plans[current.plan.index + 1];
            const adjacent = isCineramaTransitionAdjacent(current.plan, next);
            const { phase, progress } = resolveCineramaLinePhase(
                current.plan.window,
                timeSec,
                { exit: adjacent ? 0 : 0.22 },
            );
            applyFrame(current.set, resolveLayerFrame(current, phase, progress));

            /*
             * 当前层这一条带的不透明度，按**它自己所在的那一段窗口**算：
             *   - 入场段：上一行紧邻、且屏上真有一个正在退的上一行时，带在后半场
             *     淡进来（与退出方的前半场互斥）；其余情形带整段都在屏上。
             *   - 退场段（不紧邻 / 末行）：这一行自己淡出，带跟着走前半场，
             *     免得屏沿那圈字比内容晚消失。
             *   - hold / pre 之外照常给 1（`pre` 不可达，仍按「还没出现」给 0）。
             */
            const bandEnterWindow = current.plan.prevPlan
                && Boolean(outgoing) && outgoing.plan === current.plan.prevPlan
                ? resolveCineramaTransitionDuration(current.plan.prevPlan, current.plan)
                : 0;
            let bandPresence = 1;
            if (phase === 'pre') {
                bandPresence = 0;
            } else if (bandEnterWindow > 0 && timeSec < current.plan.startTime + bandEnterWindow) {
                bandPresence = resolveCineramaBandEnterPresence(
                    (timeSec - current.plan.startTime) / bandEnterWindow,
                );
            } else if (phase === 'exit') {
                bandPresence = resolveCineramaBandExitPresence(progress);
            }
            applyBandOpacity(current.setBands, bandPresence);
            try {
                current.layer.update(timeSec);
            } catch (error) {
                // 同上：逐帧函数抛异常会断订阅，所以就地换成兜底层而不是让它继续炸。
                if (!updateFailed) {
                    updateFailed = true;
                    console.warn('[cinerama] layer update failed, falling back to plain line', error);
                }
                disposeSlot(current);
                const layer = buildFallbackLayer(current.plan);
                stage.textHost.append(layer.root);
                // 兜底层不带槽位形态信息：它只顶住可读性，入场照常走转场那条淡入。
                current = {
                    plan: current.plan,
                    layer,
                    set: createEnvelopeWriter(envelopeRoot(layer)),
                    setBands: bandWriter(layer),
                };
            }
        };

        /*
         * 逐帧函数抛异常的代价是**订阅链断开**：MotionValue 的订阅会整条掉线，表现是
         * 整屏冻住而不是「这一句没效果」（文件上面几处注释都在说这件事）。里面那些 try
         * 只管各自那一步的降级，所以这里再包一层兜住整帧——包括 mount 里首次的那次 paint，
         * 它在订阅建立之前跑，抛了连 unsubscribe 都不存在。
         */
        const paint = (timeSec) => {
            try {
                paintFrame(timeSec);
            } catch (error) {
                /*
                 * 只报第一次，换一行再允许报：整帧持续报错时按帧刷日志会把控制台淹掉，
                 * 与上面 `updateFailed` 同一个口径（那里是每次 update 失败只报一次）。
                 */
                if (!paintFailed) {
                    paintFailed = true;
                    console.warn('[cinerama] paint failed, keeping the frame loop alive', error);
                }
            }
        };

        /*
         * 卸载（换歌 / 切模式 / 关窗口）必须走「拆槽位」这条路：层里的 ResizeObserver
         * 只有 `layer.dispose()` 断得开（丝带 / 四边环 / 双带各一个，
         * 见 cineramaRender），而 `stage.dispose()` 只是把根节点摘掉——那些观察器会继续
         * 强引用着已脱离文档的整棵子树。
         */
        const disposeLayers = () => {
            disposeSlot(outgoing);
            outgoing = null;
            disposeSlot(current);
            current = null;
            renderedIndex = -1;
        };

        // Static previews (mode cards, thumbnails) have no transport: draw the
        // active line once, held, instead of subscribing to time.
        if (props.staticMode) {
            const plan = program.plans[props.currentLineIndex] ?? program.plans[0];
            paint(plan ? plan.window.startTime + 0.25 : 0);
            return () => {
                disposeLayers();
                stage.dispose();
            };
        }

        paint(props.currentTime.get());
        const unsubscribe = props.currentTime.on('change', paint);

        return () => {
            unsubscribe();
            disposeLayers();
            if (disposeSettingsPanel) disposeSettingsPanel();
            stage.dispose();
        };
    },
};
