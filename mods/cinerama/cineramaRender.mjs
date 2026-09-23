import { cineramaHash01 } from './cineramaRandom.mjs';
import {
    CINERAMA_TUNING,
    markRibbonRelayExitStrips,
    resolveCineramaBandPeriodSec,
    resolveCineramaMarquee,
    resolveCineramaStyle,
    resolveCineramaStyleKind,
    ribbonRelaySeed,
} from './cineramaTreatment.mjs';
import { resolveCineramaUnitProgress } from './cineramaAnimation.mjs';
import { resolveCineramaLayout } from './cineramaLayout.mjs';
import {
    ribbonBoxLength,
    ribbonExitDistance,
    ribbonOverflowPct,
    resolveRibbonDriftClampPx,
} from './cineramaTreatment.mjs';
import { resolveCineramaOptions } from './cineramaOptions.mjs';

// mods/cinerama/cineramaRender.mjs
// 唯一碰 DOM 的模块：构建一层内容并每帧驱动它自己的内部运动。
// 行级 enter/hold/exit 包络由 visualizer.mjs 打在 stage.textHost 上，这里不重复处理，
// 所以每个 builder 只管「这一组语汇自己怎么动」。
//
// 两层结构，与解算层两条轴一一对应：
//   1. 样式层（大字报 / 小字报 / 斜切丝带）——排版本体，每种样式一层；
//   2. 跑马灯带层（双带 / 四边）——叠加元素，叠在样式层上面，本身不含正文。
//
// 印前故障（套版错位）已移除：它把样式层再建两遍当 screen 混合的错位副本，
// 观感是「字糊了一层」且要多付两倍节点。移掉之后 `skinOf` 不再有「副本色」这个参数。
//
// 旋钮分两类：结构性的（条数、角度、字号、块长）建层时读一次，改完下一行生效；
// 连续性的（带速、漂移）在 update 里每帧读，拖动即时可见。

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// 量不到任何东西时的空快照：兜底周期接管（它与解算层的缺省值接得上）。
const EMPTY_METRICS = Object.freeze({ rootFontPx: 0, viewportWidthPx: 0, viewportHeightPx: 0, boxWidthPx: 0 });

/*
 * 根字号（px）。宽高是**屏体的百分比**（带高 / 带内字号都是 cqh / cqw），
 * 而 HTML 的根字号惯例就是 `1vh`（宿主没有改过 `html` 的 font-size），
 * 所以它是「1% 屏高是多少像素」与「屏宽对应多少像素」共用的换算手柄
 * （屏宽 = 字高 × 宽高比，见 stageWidthPxOf）。量不到返回 0。
 */
const readBandFontPx = () => {
    const root = document.documentElement;
    // 旧宿主 / 单测桩里没有 window：`getComputedStyle` 是 window 上的方法，缺席时按量不到处理。
    if (typeof getComputedStyle !== 'function') return 0;
    const size = Number.parseFloat(root ? getComputedStyle(root).fontSize : '');
    return Number.isFinite(size) && size > 0 ? size : 0;
};

/*
 * 周期要的**环境量**，一次量齐（根字号 + 视口宽高 + 带盒宽）。
 *
 * 合并成一个读口的理由：这三个量都由同一件事触发变化（窗口缩放 / 字体到位），
 * 而一帧内每条带、四边环都要各算一次周期。分开量的话一条带就得三次读布局，
 * 而且这些读夹在样式写入之间——浏览器每遇到一次都得先把 pending 的布局算出来。
 *
 * 由 visualizer 每帧量一次，随按帧快照一起下发（见 `readBandStageMetrics` 的调用方）；
 * 这里只负责量，谁用它都不再自己碰布局。
 */
export const readBandStageMetrics = (box) => {
    const viewport = typeof window === 'undefined' ? null : window;
    const root = document.documentElement;
    const width = viewport?.innerWidth || root?.clientWidth || 0;
    const height = viewport?.innerHeight || root?.clientHeight || 0;
    return {
        rootFontPx: readBandFontPx(),
        viewportWidthPx: width,
        viewportHeightPx: height,
        boxWidthPx: box?.clientWidth || 0,
    };
};

/*
 * 屏宽（px），由上面那份快照算出来，不自己读布局。
 *
 * 带高与带内字号都是**屏体的百分比**（cqh / cqw），所以换算成像素要用屏高；
 * 而屏高就是 100 个「1vh」——`1cqh` 与 `1vh` 只在「屏体 = 整个舞台」时才相等，
 * 这正是宿主唯一会画出来的那种布局（导出窗口也是）。
 *
 * 量得到带盒就优先用它的宽度：上带 / 下带都是整屏宽，而它自己就是屏体的一个百分比
 * 尺寸，不会因为舞台换布局而错。四边环**没有盒子宽**这一说（环绕一圈，`boxPx` 给的
 * 是周长），所以只有它能走到「字高 × 宽高比」这条折算法。
 */
const stageWidthPxOf = (metrics, horizontal) => {
    if (horizontal && metrics.boxWidthPx > 0) return metrics.boxWidthPx;
    /*
     * 屏宽按「根字号 × 宽高比」折算：根字号按惯例等于 `1vh`，
     * 于是 `根字号 × 100` 是屏高、再乘宽高比就是屏宽。
     */
    const font = metrics.rootFontPx;
    if (!(font > 0)) return 0;
    const width = metrics.viewportWidthPx;
    const height = metrics.viewportHeightPx;
    if (!(width > 0) || !(height > 0)) return 0;
    return (font * 100 * width) / height;
};

/*
 * 把「旋钮 = 1」时的周期换算到当前带速：周期与速度成**反比**，所以除。
 * 带速为 0（或坏值）时原样返回——那种输入本来就不该出现（`marqueeSpeed` 的下限是 0.2），
 * 真出现了也是「退回缺省速度」比「除出 Infinity」安全。
 */
const divideBySpeed = (period, marqueeSpeed) => {
    const gain = Number(marqueeSpeed);
    return Number.isFinite(gain) && gain > 0 ? period / gain : period;
};

/*
 * 周期（秒/一份）的唯一入口。**实测**是这里唯一的输入——knobs 里的同类旋钮都是 CSS
 * 声明，没有 px 可算，所以「一份有多长」与「屏有多宽」只能量出来。
 *
 * 量的那段由调用方一次做齐（`readBandStageMetrics`，随按帧快照下来）：这些值只在窗口
 * 缩放与字体到位时才变，而 update 每帧都要算一次周期。各自去读的话那条读还夹在样式
 * 写入之间——浏览器每次都得先把 pending 的布局算出来，白付一遍同步布局。
 *
 * `marqueeSpeed` 那条面板旋钮是**每秒走几屏**的倍率，乘在 `screensPerSec` 上——
 * 也就是「拖带速」缩放的是屏上速度，与文本长度无关。
 */
const resolvePeriod = (marquee, { marqueeSpeed, unitPx, horizontal = true, metrics = null }) => resolveCineramaBandPeriodSec({
    screensPerSec: marquee.screensPerSec * marqueeSpeed,
    unitPx,
    horizontal,
    viewportWidthPx: stageWidthPxOf(metrics ?? EMPTY_METRICS, horizontal),
    /*
     * 兜底周期同样按旋钮缩放：解算层给的那条是「旋钮 = 1」时的值，
     * 不缩放的话量不到尺寸的那一帧会忽然回到 1 倍速。
     */
    fallbackPeriodSec: divideBySpeed(marquee.period, marqueeSpeed),
});

/*
 * 丝带接力（ribbon relay）：相邻两行都是斜切丝带时，交接不走整层溶解——
 * 实底胶带的拼贴整屏淡出，读出来是「一墙胶带一起变成幽灵」，与胶带的实物语汇矛盾。
 * 交接窗口内逐条丝带自己动（划分/继承/贴新的解算见 cineramaTreatment，窗口见
 * cineramaTransition.resolveCineramaRelayDuration；`relay` 由 visualizer 组装传入）：
 *   - 退场方一部分丝带**撕走**：沿自身轴向**加速**滑出屏幕（二次缓入 = 撕的手感），
 *     并朝行进方向轻轻甩一点角度；
 *   - 退场方另一部分**原地留下**，交接那一刻隐藏，把位置让给进入方的继承丝带
 *     （几何与漂移完全一致，只有文字换成下一行的）；
 *   - 进入方的**新丝带**从屏外沿自身轴向**减速**滑入（二次缓出 = 贴上去的手感），
 *     只在「亲眼看到交接」的层里播（`staged`）；seek 直接落进这一行时全部就位。
 * 所有偏移都是时间的纯函数，seek 稳定。
 */
const RIBBON_RELAY_RIP_SWING_DEG = 5;

/*
 * 一条丝带在接力窗口里的进度：`delayFrac` 起、再走 `spanFrac` 走完（两个半场各有自己的
 * **子窗口**，见 cineramaTreatment 的 RIBBON_RELAY_RIP_SPAN / FLY_SPAN）。
 * 0 = 还没轮到它，1 = 已经走完。老数据没有 span 字段时退回「走到窗口末尾」。
 */
const relayProgress = (time, window, delayFrac, spanFrac) => {
    const frac = (time - window.boundary) / Math.max(0.001, window.duration);
    const span = spanFrac ?? Math.max(0.001, 1 - delayFrac);
    return clamp((frac - delayFrac) / Math.max(0.001, span), 0, 1);
};

/*
 * 位移曲线：三次 smoothstep。两个半场共用它，所以撕走与贴新各自都有完整的「起—快—落」，
 * 不用退场方 p²、进入方 (1−p)² 那种错峰配法。
 * 不用更有性格的曲线（easeInOutCubic 的峰值是平均速度的 3 倍，smoothstep 只有 1.5 倍）：
 * 丝带本来就带着近一个半屏宽的行程、窗口只有零点几秒，任何把速度往中间挤的曲线
 * 都会让其中一段快到读不出来。
 */
const relayEase = (t) => t * t * (3 - 2 * t);

/*
 * 退场半场在不在自己的窗口里。
 *
 * 两个半场必须**先按窗口互斥、再按丝带身份分派**，不能只判身份：链中间的一行身上
 * 同时挂着两个半场——`relay.enter` 接上一行、`relay.exit` 退给下一行（`boundary`
 * 在**将来**）；而「留下」的那几条正是继承来的（见 cineramaTreatment 的
 * resolveRibbonRelayStrips），于是本行 fresh 丝带的 `relayOut` 恰好全是 `'leave'`。
 * 不判时间的话，退场半场会在本行**入场**那一段以 progress 0 提前接管并返回 0——
 * 贴新整段不播，fresh 丝带被按在终点位置，新的一屏在边界那一帧整块出现
 * （读起来就是「整屏刷新了一下」，屏上只剩旧丝带往外滑）。
 */
const relayExiting = (relay, time) => Boolean(relay?.exit) && time >= relay.exit.boundary;

/*
 * 撕走 / 贴新的轴向偏移（沿丝带自身轴，写在 rotate 之后；无接力时恒 0）。
 * `dist` 是这一帧该走完的行程：两个半场各按自己的方向精确算（见 ribbonExitDistance），
 * 所以撕走与贴新走的距离可以不同——多给一像素都是屏外空跑。
 */
const relayAxialOffset = (strip, relay, time, dist) => {
    if (!relay) return 0;
    const exiting = relayExiting(relay, time);
    if (exiting && strip.relayOut === 'leave') {
        const progress = relayProgress(time, relay.exit, strip.ripDelay ?? 0, strip.ripSpan);
        return (strip.ripDir ?? 1) * relayEase(progress) * dist.exitPx;
    }
    if (!exiting && relay.enter && strip.relay === 'new' && relay.enter.staged) {
        const progress = relayProgress(time, relay.enter, strip.flyDelay ?? 0, strip.flySpan);
        return -(strip.flyDir ?? 1) * (1 - relayEase(progress)) * dist.enterPx;
    }
    return 0;
};

// 撕走时朝行进方向甩的小角度（贴新不带甩：贴上去的带是落定，不是甩上去的）。
const relaySwingDeg = (strip, relay, time) => {
    if (!relayExiting(relay, time) || strip.relayOut !== 'leave') return 0;
    const progress = relayProgress(time, relay.exit, strip.ripDelay ?? 0, strip.ripSpan);
    return (strip.ripDir ?? 1) * relayEase(progress) * RIBBON_RELAY_RIP_SWING_DEG;
};

// 留下的丝带从交接那一刻起隐藏——屏上同一位置由进入方的继承丝带接手（只换字）。
const relayStripOpacity = (strip, relay, time) => {
    if (relay?.exit && strip.relayOut === 'stay' && time >= relay.exit.boundary) return 0;
    return 1;
};

/*
 * 一条丝带这一帧的接力编排（渲染层逐帧只走这一个入口，单测也打这里）。
 * `dist` 是两个半场各自的行程（px），由 layout 按分离轴算出（见 ribbonExitDistance）；
 * 量不到时给兜底值，保证建层那一帧丝带仍然在屏外。
 */
export const resolveCineramaRelayStripFrame = (
    strip,
    relay,
    time,
    { exitPx = 1600, enterPx = 1600 } = {},
) => ({
    opacity: relayStripOpacity(strip, relay, time),
    axialPx: relayAxialOffset(strip, relay, time, { exitPx, enterPx }),
    swingDeg: relaySwingDeg(strip, relay, time),
});

/*
 * 一条丝带这一帧的**漂移**与它自己的钳位（渲染层逐帧只走这一个入口，单测也打这里）。
 *
 * 只做一件看起来不像事的事：把「非匀速」这件事限制在**贴到屏沿之后**。
 * 钳位到得了的话，漂移在它之后就不再匀速了——那一段落在屏沿上（切口已经顶到边），
 * 所以读出来是「它到边停住了」，而不是「两条带的间距忽然变了」（后者才会被读成反向）。
 * 钳位本身由整叠决定（见 cineramaTreatment.resolveRibbonDriftClampPx）。
 */
export const resolveCineramaRibbonDriftFrame = (
    strip,
    time,
    { driftOrigin = 0, vel = 0, clampPx = 0 } = {},
) => {
    const limit = Math.max(0, clampPx);
    const raw = (strip?.driftDir ?? 1) * vel * Math.max(0, time - driftOrigin);
    return { clampPx: limit, drift: clamp(raw, -limit, limit) };
};

const createDiv = (cssText) => {
    const element = document.createElement('div');
    element.style.cssText = cssText;
    return element;
};

/*
 * 跑马灯/丝带的循环相位：`time * rate` 的一圈取小数部分。
 * 直接按绝对时间算的话，拖速度滑块每动一下整条字带就跳一格（读起来是卡顿而不是变速），
 * 所以相位要「接着上次的走」而不是每次重算。
 */
const createPhaseAccumulator = () => {
    /*
     * 相位 = 锚相位 + (当前时间 − 锚时间) × 速率，**锚点只在速率变化时更新**。
     *
     * 于是两件事同时成立：
     *   - 拖速度滑块不跳：换速那一刻把当前相位定成新锚点，前后连续（直接算
     *     `time × rate` 的话每动一下滑块整条字带就跳一格，读起来是卡顿而不是变速）；
     *   - seek 稳定：相位只由「时间 + 当前速率 + 锚点」决定，不再依赖这一帧与上一帧的
     *     时间差。以前是按帧间增量积分的（delta 累积），于是 ① 1 秒内的 seek 不重播种，
     *     相位取决于历史播放路径，和屏上其它「位移是时间的纯函数」的元素对不上；
     *     ② 后台标签页恢复那一下（delta > 1）又会整条瞬移一格。
     */
    let anchorTime = null;
    let anchorPhase = 0;
    let anchorRate = 0;
    return (time, rate) => {
        if (anchorTime === null) {
            anchorTime = time;
            anchorRate = rate;
            anchorPhase = ((time * rate) % 1 + 1) % 1;
        } else if (rate !== anchorRate) {
            // 换速：先把「此刻的相位」算出来，再把它定成新锚点（换速前后连续）。
            anchorPhase = ((anchorPhase + (time - anchorTime) * anchorRate) % 1 + 1) % 1;
            anchorTime = time;
            anchorRate = rate;
        }
        return ((anchorPhase + (time - anchorTime) * rate) % 1 + 1) % 1;
    };
};

/*
 * 「量不到宽度就下一帧再试」的节流（丝带 / 四边环 / 双带共用）。
 *
 * 退避是必需的：节点还没进 DOM（建层那一刻）、一直不可见、或字体始终不就绪时，
 * 「下一帧再试」会变成**永久**的每帧强制布局——每帧 clientWidth / offsetHeight +
 * 三次 scrollWidth，外加重建一份长文本写进 textContent，白烧一整屏的 CPU。
 *
 *   - 已脱离文档：一次都不试，量到的必然是 0（注意用 `=== false` 判，
 *     单测的节点桩没有这个属性，undefined 不能当成「不在文档里」）；
 *   - 前若干帧每帧试：首帧布局未稳与字体晚到通常在这段里解决；
 *   - 之后降频，每隔若干帧再试一次：窗口从隐藏变可见这类迟到的机会仍接得住。
 */
const createRelayoutGate = (host) => {
    let tick = 0;
    let allowed = true;
    return {
        // 每帧调一次（不是每条丝带一次），否则条数越多退避越快。
        nextFrame() {
            tick += 1;
            allowed = host?.isConnected === false
                ? false
                : (tick <= CINERAMA_TUNING.relayout.firstFrames
                    || tick % CINERAMA_TUNING.relayout.idleEvery === 0);
        },
        allowed: () => allowed,
    };
};

/*
 * Last-value cache per element+property. The painter runs on every motion tick
 * and most values only change inside an element's own enter window, so an
 * unchanged string must not cost a style invalidation.
 */
const createStyleWriter = () => {
    const last = new Map();
    return (element, property, value) => {
        let props = last.get(element);
        if (!props) {
            props = new Map();
            last.set(element, props);
        }
        if (props.get(property) === value) return;
        props.set(property, value);
        element.style[property] = value;
    };
};

/*
 * 屏面上的皮肤。正文色默认取 `palette.accent`（**主题强调色**）：三档排版本体里
 * 走这条的正好是「小字报 / 大字报 / 跑马灯带上的字」，屏上因此始终是主题里那个用来点睛的
 * 颜色，而不是主题的正文文字色——后者是一支近白的中性墨，和丝带的反白字、
 * 和主题其它界面文字都分不开，「同一块屏上的字」这个身份就丢了。
 *
 * 斜切丝带不走这里：它是实底胶带，字取主题背景色**反白**（见 ribbonSkin），保持原样。
 * 跑马灯带的**区域底**也已经不走 `palette.screenText`：底色改成强调色的极淡底，
 * 边线取强调色（辉光档）或辅助色（实线档），见 bandTintDeclarations / bandEdgeDeclarations。
 */
/*
 * 同色**辉光**（外加一层柔和的暗投影）：这是屏上字色语汇的核心，
 * **只有正文（小字报 / 大字报）挂着它**。
 *
 * 单独成一个函数，是因为大字报里**做填色的那一块要把"影子"和"字身"拆开**：影子挂在
 * 一层透明字身、**永不裁剪**的层上，字身自己不带影子（见 buildHero）——不然蒙版扫过时
 * 会连影子一起裁断：填过的地方有光、没填的地方没光，交界处一道硬边。
 */
const textShadowOf = (palette) => `0 2px 14px rgba(0,0,0,0.55), 0 0 30px ${palette.accent}`;

const skinOf = (palette) => [
    `color:${palette.accent}`,
    `font-family:${palette.fontFamily}`,
    `font-weight:${palette.fontWeight}`,
    `text-shadow:${textShadowOf(palette)}`,
];

/*
 * 带上的字：**同一份字色，但影要弱得多**（见 CINERAMA_TUNING.marquee.text）。
 *
 * 正文那条影子是给「整屏就一句话」配的：30px 的同色辉光 + 14px 的暗投影，一个字就能撑满
 * 一大块屏，光再厚也是「字在发光」。带上的字是循环的一圈小字、字距本来就密，
 * 同一份影子挂上去就变成「字被自己的光糊住」——实录里带子的亮来自**边上那道灯**，
 * 字本身是干净的。所以这里只留一层很淡的同色光，半径按带内字号取比例。
 *
 * 字色 / 字体 / 字重仍与正文共用一条 `color` 声明（四边环的 SVG 靠 `currentColor` 取它），
 * 只有 `text-shadow` 换掉。
 *
 * **带盒是 `overflow:hidden`，字影又是四周一圈，所以「往下漏出去」这件事根本不许发生。**
 *
 * 上带的内沿就是盒子的下缘：字影往下那一半（偏移 + 竖向半径）一旦越过它，就会被切在
 * 一条**跟着字起伏的硬边**上——汉字下缘是横竖撇捺，于是内沿浮出一道台阶状折线。
 * 所以两条约束都落在字影自己身上：
 *
 *   - **往下那半行的铺开量 ≤ `baselineDropRatio` × 字号**：暗投影竖向半径给 0
 *     （它的竖向影响范围就等于下落量本身），下落量取字号的 0.03；
 *   - **同色光不下落**（偏移 0，四周均摊）：它只负责把字与带内的屏面接上，不下落就
 *     不会在**任何**一条边上留下边界；它同时是边线那道灯之外最淡的一层，
 *     这也正是「实录里带子的亮来自边线那道灯，字本身是干净的」这条设计意图。
 *
 * 剩下的那点竖向铺开量由**行盒自己**兜：渲染层量出带内字自己有多高（`scrollHeight`，
 * 行盒的 overflow 不含 descender，但浏览器**画**得出它），把行盒按它居中——
 * 字形因此永远落在行盒里面，盒子连一条边都不用裁（见 buildMarqueeBands 的 alignInner）。
 *
 * ## `text-shadow` 没有 spread：写四个长度会把**整条声明**丢掉
 *
 * 「暗投影只给横向半径」若写成 `0 <下落> 0 <横向半径>px`，那是 `box-shadow` 的语法
 * （`offset-x offset-y blur spread`）。**`text-shadow` 只收三个长度**
 * （`offset-x offset-y blur`），第四个长度是无效值，而无效值会让**整条 `text-shadow`
 * 声明被丢弃**——被丢掉的除了那层暗投影，还有**紧随其后的同色辉光**。
 * 于是带层宿主的 `text-shadow` 在真实浏览器里一直是 `none`，一圈光都画不出来。
 * 所以这里写的一定是三个长度（`dropBlur` 落在 blur 位上），竖向影响范围
 * 「约等于下落量 + 一小段模糊」，而下落量本来就是按字号取的很小一个值。
 */
const bandTextShadowOf = (palette, fontCq, glowGain = 1) => {
    const tune = CINERAMA_TUNING.marquee.text;
    /*
     * 辉光强度（面板的 `marqueeTextGlow`）：**半径按字号的**那份基准乘以它。
     * 半径走字号的同一个尺度，所以拖带高 / 带内字高时那圈光不会忽大忽小。
     * 拖到 0 就是不画（`0` 的半径让这一层在 CSS 里直接消失）。
     */
    const gain = clamp(Number(glowGain) || 0, 0, 2);
    // 半径按带内字号（cqh 是屏高的百分比，与带内字号同一把尺子）取比例。
    const radius = (Math.max(0, fontCq) * tune.shadowBlur * gain).toFixed(2);
    /*
     * 浓度走**与半径同一根轴**（线性乘强度，不另设曲线）：这一层本来就是「很淡的一圈」，
     * 缺省 0.2 大约落在设计基准的六成；再叠一条 `floor + …` 的曲线只会让「拖到 0」
     * 还留着一圈看得见的光——那与「0 = 不画」对不上（边线那道辉光走曲线是另一回事，
     * 它的亮芯是**色轴的载体**，淡到读不出颜色就等于这一轴失效）。
     */
    const alpha = Math.round(clamp(tune.shadowAlpha * gain, 0, 100));
    const ink = `color-mix(in srgb, ${palette.accent ?? '#ffffff'} ${alpha}%, transparent)`;
    /*
     * 暗投影按**带内字号**取下落量（`baselineDropRatio`），竖向影响范围因此跟着
     * 字号走——压在行盒能兜住的那点余量以内（见 TUNING.marquee.text 的那一条）。
     *
     * `0 <下落>cqh <模糊>px`：**三个长度**，因为 `text-shadow` 没有 spread
     * （写四个长度会把整条声明丢掉，连辉光一起——见上面那一节）。`dropBlur` 就是
     * 模糊半径，它同时决定横向铺开量：浅色画面上字的左右两侧要靠它才有边界。
     */
    const drop = `0 ${(Math.max(0, fontCq) * tune.baselineDropRatio).toFixed(2)}cqh ${tune.dropBlur}px rgba(0,0,0,${tune.dropAlpha})`;
    return `${drop}, 0 0 ${radius}cqh ${ink}`;
};

const bandSkinOf = (palette, fontCq, glowGain = 1) => [
    `color:${palette.accent}`,
    `font-family:${palette.fontFamily}`,
    `font-weight:${palette.fontWeight}`,
    `text-shadow:${bandTextShadowOf(palette, fontCq, glowGain)}`,
];

const repeatText = (text, count) => Array.from({ length: Math.max(1, count) }, () => text).join('　');

/*
 * 文字样式三档倍率（面板「文字样式」组）：字号 / 字距 / 行距。
 * 三档都是**倍率**（1 = 设计默认），相乘在渲染层写出去的那几条 CSS 上——解算层算出来的
 * 字号是安全区的结论，不该在这里重算一遍。坏值（NaN / 缺项）当 1 处理。
 */
const resolveCineramaTextStyle = (options) => ({
    fontScale: finiteGain(options?.fontScale),
    letterSpacing: finiteGain(options?.letterSpacing),
    lineHeight: finiteGain(options?.lineHeight),
});

const finiteGain = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};

// `letter-spacing` 的倍率：值可能是 `0.02em` 这种带单位的字符串（来自排版轴的表）。
const scaleEm = (value, gain) => {
    const parsed = Number.parseFloat(String(value ?? '0'));
    const base = Number.isFinite(parsed) ? parsed : 0;
    return `${(base * gain).toFixed(4)}em`;
};

/*
 * 小字报：**居中、保持行距**。
 * 它同时是兜底样式——任何行都能排成小字报。
 *
 * 以前外层是一个 `flex-wrap:wrap` 容器，units 直接当 flex item：多行时
 * `align-content` 默认是 `stretch`，而容器是 `inset:0`（整屏高）——于是几行文字
 * 被**均分到整个屏高**上，行距被拉开成一大片，读起来就是「分散对齐」。
 * 现在换成「一个居中的文本块 + 文本自己的折行」：折行发生在文本层，
 * 行距完全由 `line-height` 决定，整块再按排版轴垂直落位（上 / 中 / 下）。
 */
const buildSmallType = ({ plan, style, palette, set, readOptions }) => {
    const layout = resolveCineramaLayout(plan.layout);
    const smallType = CINERAMA_TUNING.smallType;
    /*
     * 文字样式那三档倍率（字号 / 字距 / 行距）。它们**不改变解算出来的字号本身**——
     * 那是安全区与「装不装得下」的结论；这里只把它再乘一次，所以字号倍率调大时
     * 兜底样式会溢到屏沿被裁（`overflow:hidden`），这是有意的（见面板备注）。
     */
    const textStyle = resolveCineramaTextStyle(readOptions());
    /*
     * 字号由解算层给（`style.fontVh` = 排版轴 fontScale × 本体 baseVh）：
     * 渲染层只把它写进 CSS，**自己不乘倍率**——两处各算一遍就会出现「面板显示的倍率」
     * 和「画面实际用的字号」对不上。缺 `style.fontVh` 时（旧调用路径）按本体算一次。
     *
     * 下面只兜**像素下限**（极小窗口别把字压到看不清），**不兜上限**：解算层已经把
     * fontVh 钳过一次 `maxFontVh`（26vh），而 vh 是屏高的百分比、本身就跟着窗口缩放，
     * 所以不存在「超高屏把字吹到荒谬」这回事，第二道上限只是多一次吃行程的机会
     * （详情见 TUNING.smallType 的注释）。
     */
    const fontVh = style?.fontVh ?? layout.fontScale * smallType.baseVh;
    /*
     * 内边距也由解算层给：排版轴的留白与「跑马灯带占的那几条边」取大者
     * （见 resolveCineramaStyle 的 inset）——小字报整块按它落位，**不许压到带上**。
     * 缺 `style.inset` 时（旧调用路径）退回排版轴那一份。
     */
    const inset = style?.inset ?? {
        top: layout.padY, bottom: layout.padY, left: layout.padX, right: layout.padX,
    };
    // 三值 padding：上 / 左右 / 下（两种带型的左右都是对称的，取较大的一侧）。
    const padTop = (inset.top * 100).toFixed(2);
    const padBottom = (inset.bottom * 100).toFixed(2);
    const padSide = (Math.max(inset.left, inset.right) * 100).toFixed(2);
    const host = createDiv([
        'position:absolute', 'inset:0', 'display:flex', 'box-sizing:border-box',
        'overflow:hidden',
        // 垂直落位仍然按排版轴（上 / 中 / 下三分之一）；横向一律居中——
        // 用户要的是「居中保持行距」，不是左/右对齐的散块。
        `align-items:${layout.alignItems}`,
        'justify-content:center',
        /*
         * 两个方向各用**自家那把尺子**：竖向按屏高（`cqh`）、横向按屏宽（`cqw`）。
         * 写成 `%` 会踩 CSS 的坑——**百分比 padding 四个方向都按包含块的宽度解析**，
         * 于是屏幕越宽、「按高度看」的竖向留白越大，越窄越小；窄画面上它会小于带子的厚度，
         * 正文直接坐进带子里（「带子里的字压在正文上」就是这么来的）。
         * 屏体是 size container（见 cineramaStage），cqh / cqw 量的就是屏高与屏宽，
         * 与带子那条 `height:带厚%` 是同一把尺子。前面一行 vh/vw 是**不支持容器查询的
         * 老宿主**兜底（那种宿主下舞台基本就是整个视口，误差可接受）。
         */
        `padding:${padTop}vh ${padSide}vw ${padBottom}vh`,
        `padding:${padTop}cqh ${padSide}cqw ${padBottom}cqh`,
    ].join(';'));

    /*
     * 文本块：宽度给上限（`maxWidthRatio`）让长句提前折行，块因此是一个居中的
     * 方块而不是一条贴到屏沿的长带。行距就由 `line-height` 定，不受容器高度影响。
     */
    const box = createDiv([
        'width:100%', 'box-sizing:border-box',
        `max-width:${(layout.maxWidthRatio * 100).toFixed(1)}%`,
        'text-align:center',
        `letter-spacing:${scaleEm(layout.tracking, textStyle.letterSpacing)}`,
        /*
         * 行距：**保持**排版轴给的 line-height。它压在 1.08~1.3 之间——
         * 屏体铺满之后，长句折出来的两三行会把整块顶到屏沿，紧一点才是密块。
         */
        `line-height:${(layout.lineHeight * textStyle.lineHeight).toFixed(3)}`,
        // 字号见上面的 fontVh：本体是 TUNING.smallType.baseVh，倍率来自面板的「文字样式 · 字号」。
        // 只兜像素下限，不写上界——解算层的 maxFontVh 已经是上界，再写一条 px 上限会在
        // 高屏上抢先接管，把倍率的顶端几档（乃至整条滑块）吃掉。
        `font-size:max(${smallType.minFontPx}px, ${(fontVh * textStyle.fontScale).toFixed(2)}vh)`,
        ...skinOf(palette),
    ].join(';'));

    const spans = plan.units.map((unit) => {
        /*
         * inline-block 而不是 inline：逐段落位要写 transform，而 inline 元素
         * 上的 transform 无效。`pre-wrap` 保证长句能在词边界折行（`pre` 不折行，
         * 长句会整条冲出屏外），同时保留歌词里的空格。
         */
        const span = createDiv('display:inline-block;white-space:pre-wrap;');
        span.textContent = unit.text;
        box.append(span);
        return span;
    });

    host.append(box);

    return {
        root: host,
        update: (time) => {
            const { unitStagger } = readOptions();
            spans.forEach((span, index) => {
                const progress = resolveCineramaUnitProgress(plan.units[index], time, { enter: 0.3 * unitStagger });
                const jitter = cineramaHash01(plan.seed, index, 7);
                set(span, 'opacity', progress.toFixed(3));
                set(span, 'transform', `translate3d(0, ${((1 - progress) * (8 + jitter * 10)).toFixed(2)}%, 0) scale(${(0.94 + 0.06 * progress).toFixed(3)})`);
            });
        },
    };
};

/*
 * 大字报——整行按词切成若干块逐块闪现；块间不跳字号（字号按最宽的那块定）。
 * 屏角原本还挂译文/歌名的小号元数据标签（实录里左上那种小字标注），已去掉：
 * 跑马灯带现在四条边都占着，标签只能挤在带子上，读起来像一句错位的歌词。
 *
 * **做填色的块是三层同字**，从下到上：辉光层（透明字身 + 同色 `text-shadow`，**永不裁剪**）
 * → 描边层（只有描边、不发光）→ 实色层（实色、**不带影子**）。后两层用一对**互补**的
 * 硬边蒙版按这一块的歌词时间扫过（见 update 的填色那一段）：没扫到的部分只剩描边，
 * 扫过的部分只剩实色。**影子单独一层**，是因为蒙版会把影子一起裁断——填过的地方有光、
 * 没填的地方没光，交界处就出现一道硬边（「辉光被裁了」）。
 *
 * **不做填色的块只有一层**（实色 + 辉光，和从前一样）：它没有蒙版，影子不会被裁，
 * 不必拆层，一个节点都不多。
 *
 * 所有层的盒子都收紧到字身（`left/top:50%` + 静态 `translate(-50%,-50%)`），
 * 蒙版量的是**字**而不是整屏——否则字只占屏宽中间一段，两头会有大半程空扫。
 */
const buildHero = ({ plan, style, palette, set, readOptions }) => {
    const host = createDiv([
        'position:absolute', 'inset:0', 'overflow:hidden', ...skinOf(palette),
    ].join(';'));
    // 文字样式三档倍率：与解算层的安全字号相乘（安全字号是上限，倍率 > 1 时字会出屏/压带）。
    const textStyle = resolveCineramaTextStyle(readOptions());

    // 两层的公共排版：同一套字、同一个静态居中位移，叠起来才能一个字不差。
    const layerStyle = (extra) => [
        'position:absolute', 'left:50%', 'top:50%', 'transform:translate(-50%, -50%)',
        'text-align:center', 'white-space:pre',
    ].concat(extra).join(';');

    const chunks = style.chunks.map((chunk) => {
        const element = createDiv([
            'position:absolute', 'inset:0', 'opacity:0',
            // 行高与解算层的安全区同源（TUNING.hero.lineHeight）：让开带子那条公式要除它。
            `line-height:${(CINERAMA_TUNING.hero.lineHeight * textStyle.lineHeight).toFixed(3)}`,
            // 字距与解算层的当量宽度同源（`TUNING.hero.baseTrackEm`）；做「摊开」的块逐帧改它。
            `letter-spacing:${(CINERAMA_TUNING.hero.baseTrackEm * textStyle.letterSpacing).toFixed(4)}em`,
            /*
             * 字号已经在解算层按「每一块都装得下」算好（取最苛刻那块的安全字号），
             * 所以这里不再二次钳制——只兜住一个像素下限，防止极小窗口下字看不清。
             * 两处都钳就会造出「拖了滑块但画面不动」的假旋钮。
             *
             * `chunk.fontVh` 是**块级微差**后的字号（相邻块略有出入，见解算层的
             * HERO_CHUNK_SCALE_POOL）；上限仍受该块自己的安全字号约束，不会出屏。
             * 字号写在容器上、两层继承——两层必须一模一样，差一点就叠不齐。
             */
            `font-size:max(${CINERAMA_TUNING.hero.minFontPx}px, ${((chunk.fontVh ?? style.heroFontVh) * textStyle.fontScale).toFixed(2)}vh)`,
            ...(chunk.italic ? ['font-style:italic'] : []),
        ].join(';'));
        /*
         * 辉光层与描边层**只有做填色的块才建**（`chunk.fill`，见解算层的 heroFillChance：
         * 填色按这一块的字数掷点）：不填色的块没有"还没填到的部分"，也就没有蒙版，
         * 不必拆层——它只要下面那一层实色层（自带辉光），一个节点都不多。
         */
        const glow = chunk.fill
            ? createDiv(layerStyle([
                // 透明字身照样出影子：`color:transparent` 只挡字身，`text-shadow` 照画。
                'color:transparent',
                `text-shadow:${textShadowOf(palette)}`,
            ]))
            : null;
        const outline = chunk.fill
            ? createDiv(layerStyle([
                'color:transparent',
                // 透明字身 + 描边。`text-shadow` 是继承属性，不显式关掉会跟着发光。
                `-webkit-text-stroke:${CINERAMA_TUNING.hero.outlineWidthEm}em ${palette.accent}`,
                'text-shadow:none',
            ]))
            : null;
        /*
         * 实色层：做填色的块上它被蒙版扫，所以**自己不带影子**——影子已经由下面那层辉光层
         * 统一负责（两层叠加出来的观感与"实色层自带影子"完全一样，但不随蒙版被裁）。
         * 不填色的块保留自带影子（没有蒙版）。
         */
        const fill = createDiv(layerStyle(chunk.fill
            ? [...skinOf(palette), 'text-shadow:none']
            : skinOf(palette)));
        [glow, outline, fill].filter(Boolean).forEach((layer) => { layer.textContent = chunk.text; });
        element.append(...[glow, outline, fill].filter(Boolean));
        host.append(element);
        return { element, glow, outline, fill, chunk };
    });

    return {
        root: host,
        update: (time) => {
            const { unitStagger } = readOptions();
            const enter = 0.18 * unitStagger;
            const exit = 0.12 * unitStagger;
            chunks.forEach(({ element, outline, fill, chunk }) => {
                if (time < chunk.startTime || time > chunk.endTime) {
                    set(element, 'opacity', '0');
                    return;
                }
                // 窗口给到 enter 的两倍：resolveCineramaUnitProgress 内部会把时长钳到窗口的一半，
                // 传一倍时长等于把闪入压到 enter/2，读起来是硬切而不是闪现。
                const fadeIn = resolveCineramaUnitProgress({ startTime: chunk.startTime, endTime: chunk.startTime + enter * 2 }, time, { enter });
                const fadeOut = resolveCineramaUnitProgress({ startTime: chunk.endTime - exit * 2, endTime: chunk.endTime }, time, { enter: exit });
                const visible = fadeIn * (1 - fadeOut);
                set(element, 'opacity', visible.toFixed(3));
                /*
                 * **块级持续运动**：挂住的那一段里字一直在放大/缩小/移动，落位后不是死字。
                 *
                 * `u` 是本块窗口内的行程（0 → 1），行程是**线性**的——「持续」要的是匀速，
                 * 加缓动就成了"落定"，那是入场那一下的事。位移从 `xFrom/yFrom` 收到 0，
                 * 所以字最后停在正中（最后一块会长时间挂在屏上，歪着停住很扎眼）。
                 *
                 * 幅度按窗口长度归一到 `motionRefSec`：短闪没时间"持续"，走少一点；
                 * 长窗口也不会走过界。**不带旋转**：大字报可以有斜体，不能有偏转角度。
                 */
                const span = Math.max(0.001, chunk.endTime - chunk.startTime);
                const u = Math.min(1, Math.max(0, (time - chunk.startTime) / span));
                const { motion } = chunk;
                const amount = Math.min(1, span / CINERAMA_TUNING.hero.motionRefSec);
                const driftX = motion ? motion.xFrom * (1 - u) * amount : 0;
                const driftY = motion ? motion.yFrom * (1 - u) * amount : 0;
                const glide = motion
                    ? 1 + ((1 - u) * (motion.scaleFrom - 1) + u * (motion.scaleTo - 1)) * amount
                    : 1;
                // 入场那一下（0.92 → 1）与持续运动相乘：一个管"落下"，一个管"挂住时还在动"。
                const entrance = 0.92 + 0.08 * fadeIn;
                set(element, 'transform', `translate3d(${driftX.toFixed(3)}%, ${driftY.toFixed(3)}%, 0) scale(${(entrance * glide).toFixed(3)})`);
                /*
                 * **摊开**（一边放大一边加大字间距）：字距与缩放共用同一个行程 `u`、
                 * 同一份 `amount`，所以「放大」和「字离得越来越开」是**同一件事的两个维度**
                 * （「推近」那档只动缩放，字距恒定，读出来才是两个不同的动作）。
                 *
                 * 只有这一档的 `trackTo ≠ trackFrom`，其余的块一个字都不写——
                 * 不必要的样式写会让上一帧的排版失效，那是 last-value 缓存之外的开销。
                 *
                 * **`margin-right` 补偿**：`letter-spacing` 加在**每个字之后**（含末字），
                 * 居中排的时候字身因此整体左偏「半个字距」——不补的话这一档会一边摊开
                 * 一边往左挪。给一个负的 `margin-right` 把内容框加宽同样的量，
                 * 框心右移半个字距，字就回到正中（这一档不带位移，`xFrom = 0` 就是为此）。
                 */
                /*
                 * 判据写成 `!== 0` 而不是真值：将来若有「字距恒定但非零」的档（整块放宽到某个
                 * 字距不动），真值判断会把它当成 0 跳过，那一档就永远收不到字距。
                 */
                const trackFrom = motion ? (motion.trackFrom ?? 0) : 0;
                const trackTo = motion ? (motion.trackTo ?? 0) : 0;
                if (trackFrom !== 0 || trackTo !== 0) {
                    const track = ((1 - u) * trackFrom + u * trackTo) * amount;
                    const scaledTrack = track * textStyle.letterSpacing;
                    set(
                        element,
                        'letterSpacing',
                        `${(CINERAMA_TUNING.hero.baseTrackEm * textStyle.letterSpacing + scaledTrack).toFixed(4)}em`,
                    );
                    // 补偿量必须与上面那条 `letter-spacing` 里的增量**同源**（都乘过倍率），
                    // 否则字距倍率一拖，这一档就会一边摊开一边往左挪。
                    set(element, 'marginRight', `-${scaledTrack.toFixed(4)}em`);
                }
                /*
                 * **蒙版填色**：实色层"进"、描边层"退"，两块**互补**的几何用同一个行程 `u`
                 * （＝这一块窗口的进度，也就是这一块的歌词时间），所以字是**跟着唱**填满的。
                 * `u = 1` 时描边层整块裁掉，屏上只剩实色 + 辉光，也就是原来的观感。
                 *
                 * 方向按块抽（`chunk.fillAxis`：x = 左→右，y = 上→下，相邻不重复）。
                 * 裁的是**层自己的盒子**（= 字身，见 buildHero 的 layerStyle），不是整屏。
                 *
                 * **只有做填色的块走这一段**（`chunk.fill`）：会移动/缩放的块没有描边层
                 * （建层时就没建），实色层也不裁——一整块实色从头挂到尾，只做位移/缩放。
                 * 两件事不重叠，所以这里不写 `else` 去清场：没填色的块压根没写过 clipPath。
                 */
                if (chunk.fill && outline) {
                    const filled = u * 100;
                    const remain = (100 - filled).toFixed(2);
                    const done = filled.toFixed(2);
                    if (chunk.fillAxis === 'y') {
                        set(fill, 'clipPath', `inset(0 0 ${remain}% 0)`);
                        set(outline, 'clipPath', `inset(${done}% 0 0 0)`);
                    } else {
                        set(fill, 'clipPath', `inset(0 ${remain}% 0 0)`);
                        set(outline, 'clipPath', `inset(0 0 0 ${done}%)`);
                    }
                }
            });
        },
    };
};

/*
 * 跑马灯带——**叠加元素**，不是排版样式：只画带，中间那块字由样式层负责。
 * 所以它可以叠在大字报（逐块闪现）或小字报（整行）上，只有斜切丝带不跟它组合
 * （丝带本来就占满屏，解算层已经把这种情况判成不带）。
 *
 * 两种形态：
 *   - 四边（frame）：**一条闭合的环形字带**，SVG `textPath` 实现——一份文本沿
 *     圆角矩形路径排布，字按路径切线转过去，四角是转过去的不是断开的；
 *   - 双带（bands）：保持最初的样式，上下各一条整宽的循环字带（整条平移）。
 */

// 圆角半径相对带厚：太小则字在角上硬翻，太大则角上的字被顶到屏沿外。
const RING_CORNER_RATIO = 0.4;

const SVG_NS = 'http://www.w3.org/2000/svg';
let ringUid = 0;

// 圆角矩形闭合路径（顺时针，顶边左端起）。inset 是路径离屏边的距离（带厚的一半）：
// 字心落在环线上，字身正好铺满带宽。
const roundedRectPath = (width, height, inset, radius) => {
    const m = inset;
    const r = Math.min(radius, Math.max(0, Math.min(width, height) / 2 - m - 1));
    const x0 = m + r;
    const x1 = width - m - r;
    const y0 = m + r;
    const y1 = height - m - r;
    return [
        `M ${x0} ${m}`, `L ${x1} ${m}`, `A ${r} ${r} 0 0 1 ${x1 + r} ${y0}`,
        `L ${x1 + r} ${y1}`, `A ${r} ${r} 0 0 1 ${x1} ${y1 + r}`,
        `L ${x0} ${y1 + r}`, `A ${r} ${r} 0 0 1 ${m} ${y1}`,
        `L ${m} ${y0}`, `A ${r} ${r} 0 0 1 ${x0} ${m}`, 'Z',
    ].join(' ');
};

/*
 * 四边环形字带。为什么用 SVG textPath 而不是逐字摆位：逐字方案要自己量每个字的
 * 步进（canvas measureText），量字与渲染字是**两条排版管线**，字体回退/合成字形
 * 一旦对不上，量出来的步进就比实际窄，字会在环上叠成一团。textPath 让浏览器用
 * **同一套排版**摆字，量长（getComputedTextLength）与渲染同源，不可能错位；
 * 每帧也只写一个 startOffset（SVG 自己重排），比逐字 transform 便宜一个量级。
 *
 * 环是严格闭合的：份数取最接近的整数，把「环长 − 份数 × 一份长度」折成
 * letter-spacing（可负＝收紧，有下限防叠字）——每份铺开的长度于是恰好等于
 * 环长/份数，字绕一圈回到原位，任何地方都没有接缝。内容比环**多铺一份**：
 * startOffset 在 [-一份, 0) 之间回绕时，可见窗口两端始终有字。
 */
const buildMarqueeRing = ({ marquee, palette, readOptions }) => {
    // 周期要的环境量取自**调用方的按帧快照**，这里不再自己读布局。
    const stageMetrics = () => readOptions()?.stageMetrics ?? EMPTY_METRICS;
    const pct = marquee.bandPct;
    const bandFont = marquee.bandFontCq;
    const host = createDiv([
        'position:absolute', 'inset:0', 'pointer-events:none',
        // 带内字号见 bandFontDeclarations：两档带型共用同一条声明，字身不会比带子还高。
        ...bandFontDeclarations(bandFont),
        'line-height:1',
        // 带上的字用**弱影**那一份（见 bandSkinOf），强度由「文字辉光」缩放；
        // 环上的字是一圈密排的小字，光再厚就互相糊在一起。
        ...bandSkinOf(palette, bandFont, marquee.textGlow),
    ].join(';'));

    /*
     * 四边环的边线分成**三个盒子**（见 ringEdgeDeclarations）：
     *   - `ring`：frameFill 自己（`inset:0` + border = 环）——内沿往**屏心**那一半的光；
     *   - `innerHalo`：`inset:<带厚>` 的盒子，它的 border box 正好是内沿那个圆角矩形，
     *     于是 `outset` 阴影落在**环上**——内沿往**带子里**那一半的光；
     *   - `outerHalo`：`inset:0` 的盒子（与 frameFill 同形），沿**屏幕边缘**往屏内渗的光，
     *     只在「边线范围 = 双侧」时建。
     * 三者都是 `pointer-events:none` 的纯装饰层，不占布局、不碰带上的字。
     */
    const ringEdges = ringEdgeDeclarations({
        edge: marquee.edge,
        edgeColor: marquee.edgeColor,
        edgeSides: marquee.edgeSides,
        glow: marquee.glow,
        palette,
        bandCq: pct,
    });

    /*
     * 四边的**区域底**。区域就是屏沿那一圈带子（厚 = 带高），用 border 表达：
     *   - 填色画在 `border-color` 上（border 画的就是带子那块区域），
     *     **`background` 会把屏心一起铺满**——那一块不是带子；
     *   - 内沿往屏心那一半的边线走 `box-shadow: inset`——inset 阴影画在 padding box 里，
     *     不占布局、不会把字推离屏沿。
     * 透明 border 仍然占位，所以「只画边」和「填色 + 画边」的几何完全一致。
     */
    const frameFill = createDiv([
        'position:absolute', 'inset:0', 'pointer-events:none', 'box-sizing:border-box',
        // 带高用 cqh（屏体百分比），与带内字号同一把尺子；vh 是兜底。
        `border:${pct.toFixed(2)}vh solid transparent`,
        `border-width:${pct.toFixed(2)}cqh`,
        ...bandTintDeclarations({
            fill: marquee.fill,
            fillColor: marquee.fillColor,
            palette,
            target: 'ring',
        }),
        ...ringEdges.ring,
    ].join(';'));

    // 内沿「往带子里」那一半：盒子边界正好是内沿，outset 阴影因此落在环上。
    const innerHalo = ringEdges.innerHalo.length > 0
        ? createDiv([
            'position:absolute', 'pointer-events:none',
            `inset:${pct.toFixed(2)}vh`,
            `inset:${pct.toFixed(2)}cqh`,
            ...ringEdges.innerHalo,
        ].join(';'))
        : null;

    // 外沿（贴着屏幕边缘那条）：整屏盒子 + inset 阴影，光沿屏沿往屏内渗。
    const outerHalo = ringEdges.outerHalo.length > 0
        ? createDiv([
            // 外沿就在屏幕边缘上，所以是个方角盒子（圆角是环的内沿才有的）。
            'position:absolute', 'inset:0', 'pointer-events:none',
            ...ringEdges.outerHalo,
        ].join(';'))
        : null;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const pathEl = document.createElementNS(SVG_NS, 'path');
    pathEl.setAttribute('fill', 'none');
    // id 要唯一：一屏可能有多个巨幕实例（预览 + 正片），href 撞了会贴到别人的路径上。
    const uid = `cinerama-ring-${(ringUid += 1)}`;
    pathEl.setAttribute('id', uid);
    const text = document.createElementNS(SVG_NS, 'text');
    // 基线在路径上，不居中的话整条字会偏向带的一侧。
    text.setAttribute('dominant-baseline', 'central');
    /*
     * **字色必须显式写 `fill`**。SVG 的 `fill` 是独立于 `color` 的属性，缺省值是 black
     * ——外层 div 上那条 `color`（见 skinOf）**传不进 SVG**，环上的字于是既不跟主题、
     * 也不随配色调整（暗色主题下就是黑字压在暗屏上，等于看不见；亮色主题下也只是黑，
     * 跟主题没关系）。双带是普通 div、走 `color` 就够了，四边这一档不能照抄。
     * `currentColor` 让字跟着 skinOf 那份颜色走，两档带型才共用同一套配色。
     */
    text.style.fill = 'currentColor';
    // 保留原文空格：SVG 默认折叠连续空白，歌词里的词距会塌掉。
    text.setAttribute('xml:space', 'preserve');
    text.style.whiteSpace = 'pre';
    const textPath = document.createElementNS(SVG_NS, 'textPath');
    textPath.setAttribute('href', `#${uid}`);
    text.append(textPath);
    svg.append(pathEl, text);
    host.append(frameFill);
    if (innerHalo) host.append(innerHalo);
    if (outerHalo) host.append(outerHalo);
    host.append(svg);

    /*
     * `wrapPct` = 一份占**环长**的百分比，`unitPx` = 一份在环上的绝对长度。
     * 两个都要：位移的区间用百分比（`startOffset` 收的就是百分比），
     * 而速度归一要用像素算「一份占屏宽多少」（见 cineramaTreatment 的
     * resolveCineramaBandPeriodSec）。
     */
    const state = { ready: false, wrapPct: 25, unitPx: 0 };
    /*
     * 环长（px），由 `layout()` 每帧刷新。它是四边档算「一份占屏宽多少」的屏长：
     * 环没有「盒子宽」这一说，绕一圈的周长就是它在屏上的长度。
     */
    let lapPx = 0;

    const layout = () => {
        const width = host.clientWidth || 0;
        const height = host.clientHeight || 0;
        if (!(width > 0) || !(height > 0)) return false;
        // 带厚是屏高的 pct%，环按它的一半内缩（字心在带的中线上）。
        const thickness = (height * pct) / 100;
        pathEl.setAttribute('d', roundedRectPath(width, height, thickness / 2, thickness * RING_CORNER_RATIO));
        const lap = pathEl.getTotalLength();
        if (!(lap > 0)) return false;
        lapPx = lap;
        // 分隔符算进一份：环上每份之间留一个空档，读得出「一句」的边界。
        const one = `${marquee.text}　`;
        const glyphs = Array.from(one).length;
        text.style.letterSpacing = '0px';
        textPath.textContent = one;
        const period = text.getComputedTextLength();
        if (!(period > 0) || !(glyphs > 0)) return false;
        let copies = Math.max(1, Math.round(lap / period));
        let spacing = (lap / copies - period) / glyphs;
        const limit = -CINERAMA_TUNING.marquee.tightenRatio * (period / glyphs);
        if (spacing < limit) {
            // 收紧到会叠字：少放一份，改成放宽。
            copies = Math.max(1, copies - 1);
            spacing = (lap / copies - period) / glyphs;
        }
        text.style.letterSpacing = `${spacing.toFixed(3)}px`;
        textPath.textContent = one.repeat(copies + 1);
        const total = text.getComputedTextLength();
        if (!(total > 0)) return false;
        // 回绕周期按浏览器量出来的总长算：闭合才是精确的，不靠我们推的近似值。
        state.wrapPct = (100 * (total / (copies + 1))) / lap;
        state.unitPx = total / (copies + 1);
        state.ready = true;
        return true;
    };

    // 字体晚于首帧到位会让量出来的步进过期：字体就绪后重排一次。
    // 层已销毁就跳过（这个回调无法取消，闭包持有 state 与环上的节点）。
    let dead = false;
    document.fonts?.ready?.then(() => {
        if (dead) return;
        state.ready = false;
    });

    // 尺寸变化只翻标记，真正重排在下一帧的 update 里做（回调里量尺寸会抖）。
    const observer = new ResizeObserver(() => {
        state.ready = false;
    });
    observer.observe(host);

    const phase = createPhaseAccumulator();
    const relayout = createRelayoutGate(host);

    return {
        root: host,
        update: (time) => {
            const { marqueeSpeed } = readOptions();
            relayout.nextFrame();
            if (!state.ready) {
                if (relayout.allowed()) layout();
                if (!state.ready) return;
            }
            /*
             * 相位 = 已过时间 ÷ **周期（秒/一份）**。周期在 `layout()` 里按实测的一份长度
             * 解算（见 `resolvePeriod`）：环一圈就是一份，所以「一份多长」这件事只有排完版
             * 才知道。缺省周期（还没排过版、或量不到尺寸）取「一圈 = 一个周期」——
             * 排完之后 `periodPct` 就是 100，两者接得上，不会在排版落定的那一帧跳一下。
             *
             * 量不到就是 0 周期，这时**不写 startOffset**：停在上一帧的位置，不拿缺省值冲出去。
             */
            const period = state.ready
                ? resolvePeriod(marquee, {
                    marqueeSpeed,
                    unitPx: state.unitPx,
                    /*
                     * 四边环：`unitPx` 是一份在环上的长度，而周期要的是**屏宽**——
                     * 环没有「盒子宽」，绕一圈的周长 `lapPx` 只是它的路径长度。
                     * 所以走 `horizontal: false`，屏宽由 `stageWidthPxOf` 按字高折算。
                     */
                    horizontal: false,
                    metrics: stageMetrics(),
                })
                : 0;
            if (!(period > 0)) return;
            const shift = phase(time, 1 / period);
            /*
             * startOffset 在 [-一份, 0) 内回绕：滚过一份整条环正好错位一份，接缝不可见。
             * orbit 只定绕行方向（顺 / 逆时针，seed 决定），字的朝向由路径切线定，
             * 不跟着翻——翻了就是「逆时针时字全反了」。
             */
            const offsetPct = marquee.orbit * shift * state.wrapPct;
            const wrapped = ((offsetPct % state.wrapPct) + state.wrapPct) % state.wrapPct - state.wrapPct;
            textPath.setAttribute('startOffset', `${wrapped.toFixed(4)}%`);
        },
        dispose: () => {
            dead = true;
            observer.disconnect();
        },
    };
};

/*
 * 带内字号的 CSS：**两档带型共用这一条**，改一处即两处一起改。
 *
 * 用 **cqh / cqw**（屏体的百分比，见 cineramaStage 的 size container）：带高是屏高的百分比、
 * 带内字号是带高的一个比例，两者必须是同一把尺子。`vh` 是**视口**高度，只在「屏体 = 整个舞台」
 * 时才等于屏高——用 vh 写的时候字会整条高过带沿，被带盒的 `overflow:hidden` 裁掉
 * （「跑马灯带被裁剪」就是它）。所以前面那条 vh 是**兜底**：不支持容器查询的宿主会丢掉 cqh 那条。
 *
 * `bandFontCq` 由 `cineramaOptions.resolveCineramaBandFontCq` 解析（不是这里按带型钳）：
 * 它是整屏属性，样式层让开带子用的也是同一份数，见 cineramaTreatment.resolveCineramaBandInset。
 */
const bandFontDeclarations = (bandFontCq) => {
    const value = (Number.isFinite(bandFontCq) ? bandFontCq : 0).toFixed(2);
    return [
        `font-size:max(12px, ${value}vh)`,
        `font-size:max(12px, min(${value}cqh, ${value}cqw))`,
    ];
};

/*
 * 带的**填色**（面板的 `marqueeFill` + `marqueeFillColor`）：带身那块区域着不着色、
 * 取哪个色轴。
 *
 *   - none：不着色，只有字压在屏面上；
 *   - tint：一层带**色相**的极淡底。以前取屏面文字色派生的中性灰，观感是「蒙了一层灰」
 *     ——压不住样式层的字，也没有身份。换成主题色之后底色有色相了，浓度仍然压得极低：
 *     带子是底纹不是色板，浓了会盖住样式层的字。
 *
 * **色轴**由 `fillColor` 决定（accent / secondary）：强调色时底色与带上的字共用一个光源
 * （最省事的一套），辅助色时底与字分成两层——「字 accent、底 secondary」。
 *
 * 四边档画在 **border** 上：border 就是屏沿那一圈带子（厚 = 带高），给它上色才对。
 * 双带档的盒子只有带子那么高，直接画在 `background` 上。
 * （四边档用 background 会把**屏心**一起铺满——那一块不是带子的区域。）
 *
 * 过 `color-mix` 让浏览器做 alpha 化——主题色是任意格式的 CSS 字符串，
 * 模组侧算不出可靠的透明色。
 */
const bandTintDeclarations = ({ fill, fillColor, palette, target }) => {
    if (fill !== 'tint') return [];
    const tune = CINERAMA_TUNING.marquee.edge;
    const color = pickBandColor(palette, fillColor);
    // 暗底上淡色更容易被吃掉，所以比亮底给得多一点。
    const alpha = palette?.dark ? tune.tintAlphaDark : tune.tintAlphaLight;
    const wash = `color-mix(in srgb, ${color} ${alpha}%, transparent)`;
    return [target === 'ring' ? `border-color:${wash}` : `background:${wash}`];
};

/*
 * 带宽相关的色轴取值：`accent` / `secondary`（`auto` 由各档位自己翻，见 resolveBandEdgeColor）。
 * 主题色缺席时回落强调色，再缺席回落白色——CSS 里不能出现 `undefined`。
 */
const pickBandColor = (palette, axis) => {
    const accent = palette?.accent ?? '#ffffff';
    return axis === 'secondary' ? (palette?.secondary ?? accent) : accent;
};

/*
 * 边线的色轴：`auto` 是**按档位配**（实线辅助色 / 辉光强调色，等于从前写死的那套），
 * 给了 `accent` / `secondary` 就强制那一个。
 */
const resolveBandEdgeColor = (palette, edgeColor, tier) => {
    if (edgeColor === 'accent' || edgeColor === 'secondary') return pickBandColor(palette, edgeColor);
    return pickBandColor(palette, tier === 'solid' ? 'secondary' : 'accent');
};

/*
 * 带的**边线**（面板的 `marqueeEdge` + `marqueeEdgeColor` + `marqueeEdgeSides`）：
 * 带子那两条长边怎么画。
 *
 *   - none：不画边；
 *   - solid：一道 1px 实线（缺省辅助色）。带上的字是强调色、带子的范围是辅助色，
 *     两条信息不在同一个色轴上，一眼分得开「字」与「区域」——**勾范围**用这一档；
 *   - glow：**只有光，没有实线**——两圈向内扩散 + 一圈向外溢出（缺省强调色）。
 *     边沿不由一条线定，而由扩散最浓的那一端定：阴影在带沿最浓、往里淡出，
 *     读出来是「光从带沿渗出来」而不是「描了一条边」。
 *     **实线与辉光互斥**：要那条硬边就选 solid。
 *
 * **画在哪几条边上**由 `sides` 决定（inner = 只画朝屏心的那条长边 / both = 连贴着屏幕
 * 边缘的那条一起画）。两条短边（最左 / 最右那两端）一律不画——那两处正落在屏幕的左右沿上，
 * 给它们上边会把「带子在这里结束」写进画面，而带上的字是循环的、根本没有端点。
 *
 * **辉光是双向的**：每个被画的边沿，光晕同时往**两边**渗——
 *   - 往**带子里**渗（`inset` 阴影画在盒子内部，见下）；
 *   - 往**屏面上**渗（`outset` 阴影画在盒子外部，往屏幕中心那一侧）。
 * 两个方向都有，带子读作一根**两面发光的灯管**而不是一条单面贴纸。
 *
 * 阴影一律用 `box-shadow`（不占布局、不会把字推离屏沿，也不会和带上的字抢位置）。
 * `inward` 是「从这条带指向屏幕中心」的**方向符号**（上带 +1 = 向下、下带 −1 = 向上）：
 * 实线档那道 1px 还靠它定边（`solidOffsetPx`），辉光档已经不用——见下一节。
 *
 * ## 双带的边线必须与四边同构：**对称同心**，不用定向偏移
 *
 * 双带这一档走的也是 `inset 0 0` 同心三层（与 `ringEdgeDeclarations` 同构）：
 * 亮芯（`coreRatio`，色轴载体）+ 中间层（`midRatio`）+ 外层（`wideRatio`，收窄到
 * 一个带子以内的值）。「往屏面渗」由外层**自身越过带沿**的那半个高斯尾巴完成
 * （同心阴影天然两边都渗），所以不需要、也不允许再给偏移。
 *
 * 定向阴影（`0 ±<偏移>` 把光压到某一条长边上）有三处死结，同心一条同时消掉：
 *
 *   1. 偏移**小于**半径时高斯核会摊到**两条**长边上，屏沿凭空多出一圈光；
 *   2. 两层 `inset` 各带一个偏移时落点变成两条**平行**的边，视觉重心错开，读成「有厚度的两截」；
 *   3. 外层的半径一旦给到比带子还宽，它的高斯核（标准差 ≈ 半径/2）会从内沿一直摊掉半个带子
 *      ——那不是一道边，是一层从内沿漫到带子中间的雾，而它落在带上的位置还随字走
 *      （字本身也有同色 `text-shadow`），于是内沿那条亮区**逐字起伏**。
 *
 * 同心阴影以盒子的四条边为对称轴、零偏移不可能「落错边」，层与层的重心也完全重合，
 * 读出来是一条**细、稳、不随字起伏**的边。
 *
 * 扩散半径按**带厚**取比例（`bandCq` = 带高，屏高百分比），不写死 px：带高本身是旋钮
 * （6~20% 屏高），写死的话细带上光晕糊满整条、粗带上只剩一条硬线。
 *
 * 两个单位各写一条声明（vh 在前、cqh 在后，后写的生效）：屏体是 size container，
 * cqh 量的是屏高，与带内字号同一把尺子；不支持容器查询的宿主丢掉 cqh 那条退回 vh
 * （那种宿主下舞台基本就是整个视口）。
 *
 * 亮色主题下辉光读不出来（浅底上强调色发光等于没画），改成**压进屏面的一道暗槽**——
 * 与丝带那条规则同源（见 ribbonSkin：亮主题用投影、暗主题用外发光），换的是层次的表达
 * 方式，**不是颜色**：槽色由色轴压暗到 `tune.darkMix` 合成，所以两个主题下色轴都生效。
 */
const bandEdgeDeclarations = ({ edge, edgeColor, edgeSides, glow, palette, bandCq, inward }) => {
    if (!edge || edge === 'none') return { layers: [], drift: null };
    const tune = CINERAMA_TUNING.marquee.edge;
    const color = resolveBandEdgeColor(palette, edgeColor, edge);
    const strength = clamp(Number(glow) || 0, 0, 1.5);
    // 浓度对辉光强度的响应曲线（为什么不是线性乘：见 TUNING.marquee.edge.alphaFloor）。
    const response = tune.alphaFloor + (1 - tune.alphaFloor) * strength;
    const mixed = (base, percent) => `color-mix(in srgb, ${base} ${Math.round(clamp(percent, 0, 100))}%, transparent)`;
    // `inward` 是朝屏心的方向符号；上带 +1（朝下）、下带 −1（朝上），缺省按上带算。
    const towardCenter = inward === undefined ? 1 : Math.sign(inward) || 1;
    const towardScreenEdge = -towardCenter;
    const both = edgeSides === 'both';

    if (edge === 'solid') {
        /*
         * 实线档同样是 `inset`（画在盒子内部的那条边），所以符号与辉光档的 `inset` 一致：
         * 取反而非直接用 `towardCenter`（同一条规则，见下面 `layer()` 的说明）。
         */
        const hairline = (dir) => `inset 0 ${-dir * tune.solidOffsetPx}px 0 0 ${mixed(color, tune.solidAlpha)}`;
        const lines = [hairline(towardCenter)];
        // 「双侧」时再补一条贴着屏幕边缘的：同一道 1px，方向取反（靠符号挪到另一条边上）。
        if (both) lines.push(hairline(towardScreenEdge));
        return { layers: [`box-shadow:${lines.join(', ')}`], drift: null };
    }

    // 辉光档不画 1px 实线（那与 solid 档语义重合），边沿靠亮芯定住。
    /*
     * ## 内沿必须由**一个自己的盒子**画，不能画在带盒上
     *
     * 带盒是 `overflow:hidden` 的，而且它只有**带子那么高**——两条长边分别是屏沿与内沿，
     * 相距才一个带厚。任何画在它身上的 `inset` 阴影都会从**两条边同时**往里渗，
     * 在带子中间叠加；而画在它内部的光又会被内沿那条线**硬切一刀**（切点正好是峰值）。
     * 屏上读出来就是「一条从带子中间一路爬到边上、到边上被剪断的亮带」。
     * 它**只有双带会出**：四边档的内沿本来就是另一个盒子（`ringEdgeDeclarations`
     * 的 `innerHalo`）。
     *
     * 所以这一档照四边的做法：另起一个节点（`edge.halo`，见 buildMarqueeBands），
     * 让盒子的**内部 = 屏面那一侧**、而**一条长边正好落在内沿上**。于是：
     *
     *   - `inset 0 0 <半径>`：画在盒子内部，也就是**往屏面**渗——对应四边 `frameFill`
     *     的 `inset`（那个盒子的 padding box 就是屏心那块，同一角色）；
     *   - `0 0 <半径>`（outset）：以四条边为轴，**上缘那条（= 内沿）越过带沿往带子里渗**
     *     ——对应四边 `innerHalo`（那个盒子的边界正好是内沿，同一角色）。
     *
     * 两半都以**内沿那条线本身**为轴，两侧连续、没有切点——也就是「一条稳定的线」。
     *
     * 带盒自己只留**屏沿**那一套（「双侧」时才画）：屏幕的框不该跟着灯跑，而且它离内沿
     * 有整整一个带厚，不会与内沿那套在带子中间叠加。
     */
    const halo = (unit) => {
        const blurOf = (ratio) => Math.max(0, bandCq * ratio * strength).toFixed(2);
        /*
         * 一层**同心**阴影：偏移恒为 0——**同心阴影不可能落错边**（定向阴影的三处死结
         * 见上面 `bandEdgeDeclarations` 的总述）。与四边档 `ringEdgeDeclarations` 同构。
         */
        const ring = (inset, ratio, ink) => `${inset ? 'inset ' : ''}0 0 ${blurOf(ratio)}${unit} ${ink}`;
        /*
         * 亮色主题：浅底上「发光」读不出来，改成压进屏面的一道**有色的**深边
         * （色轴压暗到 `darkMix`，见 TUNING.marquee.edge 的 groove* / darkMix）。
         */
        const edgeInk = palette?.dark
            ? (alpha) => mixed(color, alpha)
            : (alpha) => mixed(mixed(color, tune.darkMix), alpha);
        if (!palette?.dark) {
            /*
             * 亮底上主看那道深芯（grooveRatio 就是它的半径），外层比它宽、比它淡。
             * 内沿两半都由 `border` 那个节点画：`inset` 把槽压进带里、`outset` 往屏面渗。
             */
            const border = [
                ring(true, tune.grooveRatio, edgeInk(tune.grooveAlpha * response)),
                ring(false, tune.spillRatio, edgeInk(tune.grooveSpillAlpha * response)),
                ring(true, tune.spillRatio, edgeInk(tune.grooveSpillAlpha * response)),
            ];
            // 屏沿那一套（「双侧」）：同一份同心层，位置由带盒的另一条边给出。
            const screenEdge = both
                ? [
                    ring(true, tune.grooveRatio, edgeInk(tune.grooveAlpha * response)),
                    ring(true, tune.spillRatio, edgeInk(tune.grooveSpillAlpha * response)),
                ]
                : [];
            return { border, screenEdge };
        }
        /*
         * 暗色主题：亮芯（吃色轴）+ 中间层 + 外层，读作一根**两面发光的灯管**
         * （三层比例与浓度的来历见 TUNING.marquee.edge）。
         *
         * 内沿这一侧与四边档严格同一份结构：亮芯 + 中间层负责**往带里**（`inset`，
         * 对应四边 `ring` 的 `core` / `toCenterLayer`），外层负责**往屏面**（`outset`，
         * 对应四边 `innerHalo` 的 `wideRatio`）。
         *
         * 浓度的分配照四边来：亮芯 `coreAlpha`（色轴载体，最浓）> 中间层 `innerAlpha`
         * > 往屏面那层 `wideAlpha`（最淡）。往屏面那一侧**不能**再画一份亮芯——
         * 那样屏上读出来是一条过曝的白边（峰值会抬到四边档同一处的 1.7 倍）。
         */
        const border = [
            ring(true, tune.coreRatio, edgeInk(tune.coreAlpha * response)),
            ring(true, tune.midRatio, edgeInk(tune.innerAlpha * response)),
            ring(false, tune.outerRatio, edgeInk(tune.wideAlpha * response)),
        ];
        // 屏沿那一套（「双侧」）：三层同心，与四边 `outerHalo` 同构。
        const screenEdge = both
            ? [
                ring(true, tune.coreRatio, edgeInk(tune.coreAlpha * response)),
                ring(true, tune.outerRatio, edgeInk(tune.outerAlpha * response)),
                ring(true, tune.midRatio, edgeInk(tune.wideAlpha * response)),
            ]
            : [];
        return { border, screenEdge };
    };
    const cqHalo = halo('cqh');
    /*
     * 不支持容器查询的宿主（旧 WebView、部分 OBS 内嵌）会丢掉 `cqh` 那一条，
     * 所以**静态阴影**照旧写两条：`vh` 在前、`cqh` 在后，后写的生效（同 bandFontDeclarations）。
     * 位移节点上只写 `cqh`——那一层永远是现代宿主里才建的（它自己就靠 `will-change` 与
     * 逐帧 transform），没必要再兜一层。
     */
    const vhHalo = halo('vh');
    const shadowOf = (decls) => (decls.length > 0 ? `box-shadow:${decls.join(', ')}` : null);
    /*
     * 边线的两份交付物（**内沿只能有一份**，两处物理上不可能重复）：
     *   - `halo`：**内沿**整套，装在一个「一条长边正好落在内沿上」的独立节点上
     *     （见 buildMarqueeBands 的 haloNode）。它自带 `inset`（往带里）与 `outset`
     *     （往屏面）两半，所以内沿这条灯由它**一个人**定义，带盒一条边都不参与；
     *   - `layers`：**屏沿**那一套（「边线范围 = 双侧」时才非空），写在带盒的
     *     `box-shadow` 上——屏幕的框钉在屏沿上，不跟着灯跑。
     */
    return {
        layers: [
            shadowOf(vhHalo.screenEdge),
            shadowOf(cqHalo.screenEdge),
        ].filter(Boolean),
        halo: [shadowOf(vhHalo.border), shadowOf(cqHalo.border)].filter(Boolean),
    };
};

/*
 * 四边环的**边线**。环的位置与双带完全不同：带子那圈由 `border` 画在 `inset:0` 的盒子上，
 * 所以「朝屏心那条边」（下称内沿）与「贴着屏幕边缘那条边」（外沿）各自需要**一个自己的盒子**
 * 才能画出对应方向的阴影——
 *
 *   - 内沿：`inset` 阴影画在 `frameFill` 的 padding box 里，也就是内沿的**屏心那一侧**
 *     （`inset:0` 盒子的 padding box = 内沿以内那块），光往屏心渗；
 *   - 内沿的另一半（往带到环里渗）：盒子的 border box 正好是内沿那个圆角矩形时，
 *     `outset` 阴影才落在环上——所以另起一个 `inset:<带厚>` 的盒子专门管这一半；
 *   - 外沿：`inset:0` 的盒子加 `inset` 阴影，光沿着屏幕边缘往屏内渗。
 *
 * 返回**声明数组的数组**：每一组对应一个盒子（`ring` = frameFill 自己、`inner` 那一半、
 * `outer` = 外沿），由 buildMarqueeRing 装到各自的节点上。
 */
const ringEdgeDeclarations = ({ edge, edgeColor, edgeSides, glow, palette, bandCq }) => {
    const empty = { ring: [], innerHalo: [], outerHalo: [] };
    if (!edge || edge === 'none') return empty;
    const tune = CINERAMA_TUNING.marquee.edge;
    const color = resolveBandEdgeColor(palette, edgeColor, edge);
    const strength = clamp(Number(glow) || 0, 0, 1.5);
    // 浓度对辉光强度的响应（与双带同一条曲线，见 bandEdgeDeclarations）。
    const response = tune.alphaFloor + (1 - tune.alphaFloor) * strength;
    const mixed = (base, percent) => `color-mix(in srgb, ${base} ${Math.round(clamp(percent, 0, 100))}%, transparent)`;
    /*
     * 槽色（亮色主题）/ 光色（暗色主题）都是**色轴的载体**：亮底上把色轴压暗到 `darkMix`
     * 再 alpha 化，读作「一道有色的深边」而不是写死的中性灰。两个主题下换色都看得见。
     */
    const ink = (percent) => (palette?.dark
        ? mixed(color, percent)
        : mixed(mixed(color, tune.darkMix), percent));
    const both = edgeSides === 'both';

    if (edge === 'solid') {
        // 内沿一道 1px：`inset 0 0 0 1px` 画在 padding box 的边界上，也就是内沿自己。
        const ring = [`box-shadow:inset 0 0 0 1px ${mixed(color, tune.solidAlpha)}`];
        const outerHalo = both ? [`box-shadow:inset 0 0 0 1px ${mixed(color, tune.solidAlpha)}`] : [];
        return { ring, innerHalo: [], outerHalo };
    }

    const ring = [];
    const innerHalo = [];
    const outerHalo = [];
    ['vh', 'cqh'].forEach((unit) => {
        const by = (ratio) => Math.max(0, bandCq * ratio * strength).toFixed(2);
        const toBand = by(tune.wideRatio);
        const toCenter = by(tune.midRatio);
        const toCore = by(tune.coreRatio);
        const near = by(tune.wideRatio);
        if (!palette?.dark) {
            // 亮底上主看那道深芯（grooveRatio 就是「亮芯」的半径），往屏面 / 往环里那两半更宽更淡。
            const groove = ink(tune.grooveAlpha * response);
            const grooveSpill = ink(tune.grooveSpillAlpha * response);
            ring.push(`box-shadow:inset 0 0 ${by(tune.grooveRatio)}${unit} ${groove}`);
            // 往环里那一半：一道更浅的暗影，方向与外发光相反（亮主题里它读作「环自身压下去」）。
            innerHalo.push(`box-shadow:0 0 ${near}${unit} ${grooveSpill}`);
            // 外沿两层：亮芯（与内沿同值）+ 同宽的淡影。
            if (both) outerHalo.push(`box-shadow:inset 0 0 ${by(tune.grooveRatio)}${unit} ${groove}, inset 0 0 ${near}${unit} ${grooveSpill}`);
            return;
        }
        // 内沿三层（与双带同构）：亮芯（贴内沿、吃色轴）+ 往屏心 + 往环里。
        const core = `inset 0 0 ${toCore}${unit} ${ink(tune.coreAlpha * response)}`;
        const toCenterLayer = `inset 0 0 ${toCenter}${unit} ${ink(tune.innerAlpha * response)}`;
        const toEdgeLayer = `inset 0 0 ${near}${unit} ${ink(tune.wideAlpha * response)}`;
        // 外沿三层与内沿同构；中间层（outerRatio）漏了就只剩「一根亮线 + 一大片极淡」。
        const outerToBand = `inset 0 0 ${by(tune.outerRatio)}${unit} ${ink(tune.outerAlpha * response)}`;
        ring.push(`box-shadow:${core}, ${toCenterLayer}`);
        innerHalo.push(`box-shadow:0 0 ${toBand}${unit} ${ink(tune.wideAlpha * response)}`);
        if (both) outerHalo.push(`box-shadow:${core}, ${outerToBand}, ${toEdgeLayer}`);
    });
    return { ring, innerHalo, outerHalo };
};

/*
 * 双带——保持最初的样式：上下各一条整宽的循环字带，整条字带旋转 + 平移。
 * 下带**同一份文本时转 180°**（读向相反，凑成「绕屏一周」），文本不同时不翻字、
 * 只把行程取反（`band.reverse`，见 update）；位移取「一份」的百分比回绕，接缝不可见。
 */
const bandBox = (slot, pct) => (slot === 'top'
    ? ['top:0', 'left:0', 'right:0', `height:${pct}%`]
    : ['bottom:0', 'left:0', 'right:0', `height:${pct}%`]);

/*
 * 一条带的文字：**整数份，且每份都以分隔符收尾**。
 *
 * 收尾那个分隔符是关键：`repeatText` 只在份与份**之间**插分隔符（N 份只有 N−1 个），
 * 元素宽度于是等于 N × 一份 − 一个分隔符——「滚过一份」不再是元素宽度的整数分之一，
 * 每绕一圈都差那么一点，累积起来就是「滚着滚着错开一截」。
 * 补上收尾分隔符之后，元素宽度按定义就是 N × 一份，于是位移可以写成
 * `translateX(-100/N %)`：**百分比按元素自身宽度解析**，浏览器算出来的正好是一份，
 * 不依赖我们量出来的宽度（量只用来决定铺几份）。
 */
const repeatBandText = (text, count) => `${repeatText(text, count)}　`;

/*
 * 把一条带的文字铺到**够回绕**，而不是「够盖住」。
 *
 * 位移区间是一份（`[−一份, 0]`，见 update），起点贴盒左沿，所以盒右沿之外必须
 * **至少还压着一份**，两端才同时有字：份数要满足 `N × 一份 ≥ 盒宽 + 一份`。
 * 以前按「盖住盒宽 × 安全系数」算，两头各只多出 10%，而位移一次就是一份宽——
 * 短句（份数还被封顶在 6）在宽屏上远达不到这个数，推出去的那一侧就先露白，
 * 回绕那一刻字又整块推回来，读起来正是「一侧空一截、然后忽然补上」。
 *
 * 量长会触发同步布局，所以只在「能测到尺寸」的第一帧做一次
 * （见 buildMarqueeBands.update）；尺寸变化与字体就绪另外翻标记重铺。
 */
const fillBandText = (box, inner, band) => {
    const { repeatMin, repeatMax, widthSafety } = CINERAMA_TUNING.marquee;
    const limit = box.clientWidth || 0;
    if (!(limit > 0)) return 0;
    // 量两份解出一份：每份都以分隔符收尾，两整份的宽度正好是一份的两倍。
    inner.textContent = repeatBandText(band.text, 2);
    const period = (inner.scrollWidth || 0) / 2;
    if (!(period > 0)) return 0;
    const copies = clamp(Math.ceil((limit * widthSafety) / period) + 1, repeatMin, repeatMax);
    inner.textContent = repeatBandText(band.text, copies);
    return copies;
};

/*
 * 一条带的「一份」有多长（px）。份数已经把元素宽度切成整数份，所以**份数本身就是
 * 每份占元素宽度的百分比**（`100/份数`）——不必再去量一次文本宽度（量宽会触发同步布局）。
 *
 * 它同时也是速度归一的输入：一份越长、屏上走得越快，安全下限算出来的周期就越长
 * （见 cineramaTreatment 的 resolveCineramaBandPeriodSec）。
 */
const bandUnitPxOf = (entry) => {
    if (!entry || !(entry.cycle > 0)) return 0;
    const width = entry.inner?.scrollWidth || 0;
    return width > 0 ? width / entry.cycle : 0;
};

/*
 * 带内一个字的**字形盒**（含溢出的墨）。
 *
 * 为什么不用 `inner.getBoundingClientRect()`：那量的是**行盒**（元素自身的边界），
 * 而字形会画到行盒外面——descender、以及部分字体里超出 em 的笔画。
 * `Range` 圈住一个字符再量，拿到的才是墨的边界。
 *
 * 只量一个字（不是整条内容）：这一档在尺寸变化时会重新调用，量太多字会拖慢那一帧；
 * 而同一行同一个字号下每个字的字形盒高度是一致的。
 *
 * 量不到就返回 `null`（节点还没进 DOM、或者没有文本节点），调用方按「量不出来」处理。
 */
export const measureBandGlyph = (inner) => {
    const text = inner?.firstChild;
    if (!text || text.nodeType !== 3 || !(text.length > 0)) return null;
    const range = document.createRange();
    try {
        range.setStart(text, 0);
        range.setEnd(text, 1);
        const rect = range.getBoundingClientRect();
        if (!rect || !(rect.height > 0)) return null;
        // `top` 相对**行盒**（调用方要用它把行盒摆到墨的位置上），不是视口。
        const origin = inner.getBoundingClientRect();
        return { top: rect.top - origin.top, height: rect.height };
    } catch {
        // 桩环境 / 分离节点上 `setStart` 会抛，按「量不出来」处理。
        return null;
    }
};

/*
 * 带上的字**探到带沿之外**时把带子撑厚——双带这一档最后一道「第二条线」的来源。
 *
 * ## 为什么必须处理
 *
 * 边线那道灯压在带沿上，而带内字形的墨会画到**行盒外面**（descender、以及部分字体里
 * 超出 em 的笔画）。**连缺省档，字形就已经探到带沿之外**，而 `alignInner` 量的
 * `scrollHeight` 按整格取整、不含溢出的墨，那个数看不见这一截；字号一拖大，带沿整条
 * 被字形骑穿——屏上于是出现两条线：一条是边线那道灯（压在带沿上），另一条是**字形的边**
 * （逐字复刻汉字的下缘轮廓，随字距滑动起伏）。
 *
 * 四边档没有这条通路：环上的字在 SVG `textPath` 上，`dominant-baseline: central`
 * 让字心落在环中线上，容器既不裁它、也不让它与边线争同一个纵向区间。
 *
 * ## 怎么处理
 *
 * 只做**一件**事：需要多少就把这个盒子撑多高。带子一高，边线那道灯（按带沿定位）
 * 自然离字形远了一截，字仍然居中在带心里。
 *
 * 撑的是 `min-height`，所以**带子只会变厚、不会变薄**：用户把带厚拖到比需要的大时，
 * 听他的。撑过屏高就封顶（那时正确做法是把字号拖回去，而不是继续吃屏面）。
 *
 * 不压字号（那是面板上的一轴，改了等于把用户的旋钮掰回去，同屏正文的安全区也要重算），
 * 也不挪边线（那道灯压在带沿上正是这一档的设计）。
 *
 * 返回**要把带子撑到多少 px**（`0` = 不用撑；量不到就返回 0，下一帧能测到尺寸时再来）。
 */
export const bandMinHeightOf = (inkHeight) => {
    const ink = Number(inkHeight) || 0;
    if (!(ink > 0)) return 0;
    /*
     * 上下各留一个按带厚取比例的净空（`edgeClearanceRatio`），所以要撑到
     * `墨高 / (1 − 2 × 净空比例)`。净空按比例而不是 px：带厚本身是旋钮（6~20% 屏高），
     * 写死 px 时细带上够用、粗带上白留一大截。
     *
     * 返回**绝对值**，由调用方与当前带高比一次：`clientHeight` 是个往返量
     * （写进 `min-height` 之后下一帧才生效），拿它比会把「已经撑够了」误判成「还要撑」。
     */
    return ink / (1 - 2 * CINERAMA_TUNING.marquee.edge.edgeClearanceRatio);
};

const buildMarqueeBands = ({ marquee, palette, set, readOptions }) => {
    // 周期要的环境量取自**调用方的按帧快照**，这里不再自己读布局。
    const stageMetrics = () => readOptions()?.stageMetrics ?? EMPTY_METRICS;
    const pct = marquee.bandPct;
    const bandFont = marquee.bandFontCq;
    // 边线那档的参数（位移振幅与不透明度的下限，见下面 update 里的漂移）。
    const tune = CINERAMA_TUNING.marquee.edge;
    const host = createDiv([
        'position:absolute', 'inset:0', 'pointer-events:none',
        // 带上的字用**弱影**那一份（见 bandSkinOf），强度由「文字辉光」缩放；
        // 一圈循环密排的小字挂不住正文那套影。
        ...bandSkinOf(palette, bandFont, marquee.textGlow),
    ].join(';'));
    /*
     * 边线这道灯**在不在跑**由 `marqueeEdgeDrift` 定（缺省 0 = 灯静止）。
     * 它在跑的时候，边线那一份静态阴影之外还要多一个位移层：静态阴影（含亮芯）留在 box 上，
     * 另起一个**不裁剪**的盒子在竖直方向上来回慢走——被盒沿切掉的部分正是「灯带跑出这一段」，
     * 于是读出来是一道沿带子滚动的灯，而不是一条固定的边。
     */
    const edgeDriftGain = clamp(Number(readOptions().marqueeEdgeDrift) || 0, 0, 3);
    const bands = marquee.bands.map((band) => {
        const edge = bandEdgeDeclarations({
            edge: marquee.edge,
            edgeColor: marquee.edgeColor,
            edgeSides: marquee.edgeSides,
            glow: marquee.glow,
            palette,
            bandCq: pct,
            inward: band.slot === 'top' ? 1 : -1,
        });
        /*
         * 带盒自己只写**屏沿**那一套（「边线范围 = 双侧」时才非空）：屏幕的框钉在屏沿上，
         * 不该跟着灯跑。内沿整套在下面的 `haloNode` 上——它不能画在这里，因为这个盒子是
         * `overflow:hidden`、而且只有带子那么高（见 `halo()` 的注释）。
         */
        const boxStyle = [
            'position:absolute', 'overflow:hidden',
            ...bandBox(band.slot, pct),
            // 填色画在 background 上：双带的盒子只有带子那么高（见 bandTintDeclarations）。
            ...bandTintDeclarations({
                fill: marquee.fill,
                fillColor: marquee.fillColor,
                palette,
                target: 'band',
            }),
        ];
        /*
         * **内沿**那一整套挂在这个节点上——它必须是内沿的**唯一**一份。
         *
         * 几何：盒子高 = **2 个带厚**，那条**落在内沿上**的边在靠屏心一侧，另一条边被推到
         * 屏外（看不见）：
         *   - 上带（内沿在带盒下缘 y = 带厚）：`top:-<带厚>` → 下缘 = 带厚 ✓、上缘 = −带厚（屏外）；
         *   - 下带（内沿在带盒上缘 y = 屏高 − 带厚）：`bottom:-<带厚>` → 上缘 = 带厚 ✓、
         *     下缘 = −带厚（屏外）。
         * 于是阴影只以**内沿那一条长边**为轴两侧都渗，屏沿那一侧不留痕迹。
         *
         * 它挂在**带盒外面**（与带盒同级、比带盒后挂）：必须落在 `overflow:hidden` 之外，
         * 否则那一刀照样切在它身上，这一层就白加了（见 `halo()` 的注释）。
         *
         * 灯在跑（`marqueeEdgeDrift > 0`）时推的就是**它**：内沿整条一起走，带盒不动。
         * 内沿**只有这一份**，所以「一份钉在边上、一份在旁边滑」在结构上不可能发生。
         */
        /*
         * 内沿 halo 节点在**横向**上向屏幕外伸出半个视口宽（`edgeHaloOverscan`）。
         *
         * 内沿整套用的是 `inset 0 0` / `outset 0 0` 的**同心**阴影——它以盒子**四条边**
         * 为对称轴，所以除了那条落在内沿上的长边，最左 / 最右两条**短边**也会渗出一圈光。
         * 节点从前写 `left:0; right:0`，那两条短边就压在**屏幕左右两侧**，屏上读成
         * 「左右沿各多出一道光」；而带上的字是循环的、这一段根本没有端点
         * （见 bandEdgeDeclarations 开头那条「两条短边一律不画」）。
         *
         * 把节点在 x 方向上撑出去（`left` / `right` 取负百分比），两条短边连同它们的光就一起
         * 落到屏幕之外；两条**长边**仍在屏内、位置不变，所以内沿那条灯与几何完全不受影响。
         * 外伸量由 `TUNING.marquee.edge.edgeHaloOverscan` 定（缺省半个视口宽）。
         */
        const overscan = clamp(Number(tune.edgeHaloOverscan) || 0, 0, 2) * 100;
        const haloNode = edge.halo.length > 0
            ? createDiv([
                'position:absolute', `left:-${overscan}%`, `right:-${overscan}%`,
                /*
                 * 盒子的**内部 = 屏面那一侧**，靠内沿那条边就是它的边界：
                 *   - 上带（内沿在带盒下缘 y = 带厚）：`top:<带厚>` + 撑到屏底，
                 *     于是**上缘**落在内沿上、下缘在屏底之外；
                 *   - 下带（内沿在带盒上缘）：`bottom:<带厚>` + 从屏顶撑起，
                 *     于是**下缘**落在内沿上、上缘在屏顶之外。
                 *
                 * 这与四边档同一套映射（见 `ringEdgeDeclarations`）：那里「内沿往屏心」
                 * 那一半由 `frameFill` 的 `inset`（padding box 就是屏心那块）承担，
                 *「内沿往环里」那一半由一个边界正好是内沿的独立盒子承担。
                 * 这里一个盒子同时给出两半——`inset` 往屏面渗（对应四边的 `ring`）、
                 * `outset` 越过上缘往**带子里**渗（对应四边的 `innerHalo`）。
                 *
                 * 挂在**带盒外面**（与带盒同级、比带盒后挂）：必须落在 `overflow:hidden`
                 * 之外，否则那一刀照样切在它身上，这一层就白加了（见 `halo()` 的注释）。
                 */
                band.slot === 'top' ? `top:${pct}%` : `bottom:${pct}%`,
                band.slot === 'top' ? 'bottom:0' : 'top:0',
                // 纯装饰层：只画阴影，不占布局、不吃事件、不碰带上的字。
                'pointer-events:none',
                ...edge.halo,
            ].join(';'))
            : null;
        /*
         * 「屏沿」那一套（`edgeSides = both` 时才非空）也要落在**自己的节点**上——
         * 理由与 halo 节点同一条：同心阴影以盒子四条边为对称轴，画在带盒上时，
         * 带盒最左 / 最右两条**短边**会各渗出一圈光，而那两条短边正好压在
         * **屏幕左右两侧**（带上的字是循环的、这一段根本没有端点）。
         *
         * 带盒不能自己向屏外撑：它的 `overflow:hidden` 和 `left:0` 是**文字锚点**
         * 与滚动几何的前提（见 inner 的注释），撑出去会把整条循环字带推歪。
         * 所以另起一个纯装饰节点，几何与带盒同区、横向同样外伸半个视口宽。
         */
        const screenEdgeNode = edge.layers.length > 0
            ? createDiv([
                'position:absolute',
                // 与带盒同一条长边落位（上带贴屏顶 / 下带贴屏底）+ 横向向屏外伸出。
                band.slot === 'top' ? 'top:0' : 'bottom:0',
                `left:-${overscan}%`, `right:-${overscan}%`, `height:${pct}%`,
                'pointer-events:none',
                ...edge.layers,
            ].join(';'))
            : null;
        const drifting = Boolean(haloNode) && edgeDriftGain > 0;
        const box = createDiv(boxStyle.join(';'));
        const inner = createDiv([
            /*
             * 绝对定位 + left:0：文字的起点贴盒左沿，位移从那里算起。
             * 用 flex 居中（`justify-content:center`）时内容向**两侧**同时溢出，
             * 而位移只往一侧推：推出去的那端先露白，另一端多出来的部分永远看不见；
             * 溢出量还跟一份的宽度没有关系（是 (盒宽 − 内容宽)/2），够不够全看书多长。
             *
             * 行盒**贴带子的上沿、按量出来的字高自己居中**（见 alignInner）：它不写
             * `height:100%`——行盒的 overflow 不含 descender，在 100% 高的行盒里再缩一圈
             * 下缘等于拿刀切字形。行盒只取量出来的那点高，字形全在里面，带盒一条边都不用裁。
             */
            'position:absolute', 'left:0', 'top:0',
            'display:flex', 'align-items:center', 'white-space:nowrap',
            'will-change:transform',
            'letter-spacing:0.12em',
            // 带内字号见 bandFontDeclarations（两档带型一条声明），行高锁 1。
            ...bandFontDeclarations(bandFont),
            'line-height:1',
        ].join(';'));
        inner.textContent = repeatBandText(band.text, marquee.repeat);
        box.append(inner);
        /*
         * 「屏沿」那一套挂在带盒**之前**：`box-shadow` 画在盒子自己的背景层上、**低于**它的
         * 子内容，所以它从前压在带上的字**下面**。搬到独立节点后要保住这个层次——
         * 挂在带盒之后就会把光盖到字**上面**（那是观感回归）。带盒没有背景色时它是唯一的
         * 底层，所以先挂它、再挂带盒。
         */
        if (screenEdgeNode) host.append(screenEdgeNode);
        host.append(box);
        /*
         * halo 节点挂在**带盒外面、且比带盒后挂**：它必须落在 `overflow:hidden` 之外，
         * 否则那一刀照样切在它身上，这一层就白加了。它只画阴影、不带背景，
         * 内沿那条灯与带上的字**不在同一个纵向区间**（见 bandMinHeightOf），不存在压字问题。
         */
        if (haloNode) host.append(haloNode);
        /*
         * 把行盒**垂直居中**在带子里——带内字的字心落在带子的中线上，与四边环
         * （`dominant-baseline: central` 让字心落在环线上）是同一条不变式。
         *
         * 量的是 `inner.scrollHeight`：行盒的 overflow 判定用的是**行盒**，而字形会画到
         * 行盒**外面**（descender、以及部分字体里超出 em 的笔画），所以 `clientHeight`
         * 兜不住字形的下缘。`scrollHeight` 按规范**含溢出**、且**永远不小于** `clientHeight`，
         * 是「字形到底铺了多高」在 DOM 上能拿到的那一份。
         *
         * **两种情形都要处理**：
         *   - 行盒比带子**矮**（常态：带内字号压在带高的六成以内）——`marginTop` 取
         *     「(带高 − 字高) / 2」的正值，把字推到带子中间。**漏掉这一支字就全挤在内沿
         *     那一侧**：行盒贴着带盒的 `top:0`，外侧空出一大截。
         *   - 行盒比带子**高**（带厚拖到端点、或宿主字体把行高撑开）——同一条式子给出
         *     负值，也就是上下各伸出去溢出量的一半。伸出去的部分落在带子**外面**
         *     （体外的屏面上），带盒有 `overflow:hidden`，伸出去也看不见；
         *     能看见的字影于是始终在行盒以内。
         *
         * 居中量走 `marginTop`（而不是改 `top` 或 `transform`）：这个元素身上已经写着
         * 滚动用的 `translateX`（以及下带的 `rotate`），第 2 个 transform 会把它整条丢掉。
         *
         * 左右那两条负 `margin` 只在行盒真的伸出去时才给：它让行盒比带子宽出同样的量，
         * 免得和位移叠在一起时两端露出空白；行盒比带子窄时给 0，别去动横向。
         */
        const alignInner = () => {
            const boxHeight = box.clientHeight || 0;
            const lineHeight = inner.scrollHeight || inner.clientHeight || 0;
            if (!(boxHeight > 0) || !(lineHeight > 0)) return false;
            /*
             * 居中量的是**墨**，不是行盒：行盒（`scrollHeight`）不含字形溢出的那一截
             * （descender 等），而这一档里**字形盒比行盒还高**。按行盒居中的话，字心落在
             * 带中线上、**墨**却整体偏上——上净空被吃掉，边线那道灯于是与字形撞在同一个
             * 纵向区间里。所以按 `measureBandGlyph` 量到的墨居一次，上下净空才是相等的。
             *
             * 位移走 `marginTop`（而不是改 `top` 或 `transform`）：这个元素身上已经写着
             * 滚动用的 `translateX`（以及下带的 `rotate`），第 2 个 transform 会把它整条丢掉。
             */
            const glyph = measureBandGlyph(inner);
            const inkHeight = glyph && glyph.height > lineHeight ? glyph.height : lineHeight;
            /*
             * 一条公式覆盖两支：(带高 − 墨高) / 2。行盒矮时是正值（往下推 = 居中），
             * 行盒高时是负值（上下各伸出去溢出量的一半）。两支不需要分开写。
             *
             * 按墨居中之后行盒会整体上移一点，所以先算出「行盒该落在哪儿」：
             * 带子的上沿 + (墨在行盒里的偏移)，也就是行盒顶 = 带中 − 墨高/2 − 墨相对行盒顶的偏移。
             */
            const inkOffset = glyph ? glyph.top : 0;
            const centering = (boxHeight - inkHeight) / 2 - inkOffset;
            set(inner, 'marginTop', `${centering.toFixed(2)}px`);
            const overhang = Math.max(0, -centering);
            const width = (box.clientWidth || 0) > 0 ? `${overhang.toFixed(2)}px` : '0px';
            set(inner, 'marginLeft', `-${width}`);
            set(inner, 'marginRight', `-${width}`);
            /*
             * 还有一件：字形会探到**行盒外面**，而边线那道灯就压在带沿上——两者落进
             * 同一个纵向区间时屏上就是两条（见 bandMinHeightOf）。
             *
             * 撑的是 `min-height`，所以只会变厚、不会变薄；而且只在**当前带高不够**时才写，
             * 免得每重排一帧都往上堆一截（`clientHeight` 要下一帧才反映刚写进去的值）。
             */
            const needed = bandMinHeightOf(inkHeight, boxHeight);
            set(box, 'minHeight', needed > boxHeight ? `${needed.toFixed(2)}px` : '');
            /*
             * 撑高的那一帧要按**撑之后**的带高再居一次中：这个 `boxHeight` 是撑之前量的，
             * 拿它算出来的 `marginTop` 在变厚的带子里会偏上。增量正好是
             * `(needed − boxHeight) / 2`，直接补在已经写出去的那条式子后面，
             * 不必再读一次布局（读布局会触发同步重排，这一帧本来就只在重铺时跑一次）。
             */
            if (needed > boxHeight) {
                set(inner, 'marginTop', `${(centering + (needed - boxHeight) / 2).toFixed(2)}px`);
            }
            return true;
        };
        // 份数在建层时量不到（节点还没进 DOM）：第一帧能测长的时候补足。
        return { box, inner, band, cycle: marquee.repeat, unitPx: 0, filled: false, haloNode, drifting, alignInner };
    });

    /*
     * 尺寸变了（窗口缩放、屏体比例变化）与字体晚到都要重铺：份数不够就会在某一侧露白。
     * 重铺不会让字跳一下——位移是「一份」的百分比，量出来的宽度只决定铺几份，
     * 份数变了百分比跟着变，绕过的永远是一份（与丝带那条「周期只用来算份数」同一个理由）。
     */
    const observer = new ResizeObserver(() => {
        bands.forEach((entry) => { entry.filled = false; });
    });
    observer.observe(host);
    // 层已销毁就跳过（回调无法取消，闭包持有整组 band 与它们的节点）。
    let dead = false;
    document.fonts?.ready?.then(() => {
        if (dead) return;
        bands.forEach((entry) => { entry.filled = false; });
    });

    const phase = createPhaseAccumulator();
    const relayout = createRelayoutGate(host);

    return {
        root: host,
        update: (time) => {
            const { marqueeSpeed } = readOptions();
            relayout.nextFrame();
            const canMeasure = relayout.allowed();
            /*
             * 周期（秒/一份）每帧从**按帧快照**里的环境量算（见 `resolvePeriod`）：
             * 一份的长度是实测的、屏宽由每帧那一分量齐。量不到（还没进 DOM、导出窗口里
             * 量不出尺寸）时退回解算层的缺省周期——那是同一个式子在没有实测值时的取值，
             * 接得上，不会在排版落定的那一帧跳一下。
             */
            const period = resolvePeriod(marquee, {
                marqueeSpeed,
                unitPx: bandUnitPxOf(bands[0]),
                // 横向整宽带：盒宽就是屏宽，量得到就直接用（量不到退回字高折算）。
                metrics: stageMetrics(),
            });
            /*
             * 周期量为 0（带节点还没进 DOM、导出窗口里量不到尺寸）时**冻结相位**：
             * 传 0 给累加器等于「停住」，而不是拿一个假的速率往前冲。
             */
            const shift = period > 0 ? phase(time, 1 / period) : 0;
            bands.forEach((entry) => {
                const { box, inner, band } = entry;
                /*
                 * 第一帧 / 重铺那一帧要量两样东西：行盒该有多大（`alignInner`）与内容要铺几份
                 * （`fillBandText`）。两样都必须**只在能测到尺寸的那一帧量**——量尺寸会触发
                 * 同步布局，逐帧量会把整屏拖成掉帧；而这两个数只在尺寸变化、字体到位时才会变，
                 * 那两处都会把 `filled` 翻掉，于是这里跟着重来一遍。
                 */
                if (!entry.filled && canMeasure) {
                    entry.alignInner();
                    const copies = fillBandText(box, inner, band);
                    if (copies > 0) {
                        entry.cycle = copies;
                        entry.unitPx = bandUnitPxOf(entry);
                        entry.filled = true;
                    }
                }
                /*
                 * 先把「这一帧内容在**屏幕上**该走多远」算出来：`m ∈ [−一份, 0]`。
                 * 只取单向，是因为内容起点贴着盒左沿排（见 inner 的 left:0）：
                 * 往 `+一份` 走就把起点甩进盒里，那一侧立刻空出一截。
                 * 正方向从 0 走到 −一份、反方向从 −一份 走到 0，都是走满一份即回绕，
                 * 回绕处正好相差一个完整周期，接缝不可见。
                 */
                const m = marquee.orbit > 0 ? -shift : shift - 1;
                /*
                 * 下带的两种「对开」写法（由 cineramaTreatment 的 mirror 决定用哪个）：
                 *
                 *   - `rotate(180deg)`（上下同一份文本）：映射是 x → W − x − t，两个后果都得算上——
                 *     **左沿会翻到右边去**：`t` 为负时内容起点被甩进盒内，左侧直接空出一份
                 *     （长句的一份 ≈ 整屏，读起来就是「字还没走到屏沿就没了」）。
                 *     所以镜像的那一条要往前挪整整一格：`t = m + 1`（区间 [0, 一份]），
                 *     左沿落回盒左沿之外，覆盖才成立；同一个 `t` 在屏上正好与上带一左一右，
                 *     「上下反向」这条默认观感也就保住了（整体取反靠 orbit）。
                 *   - `rotate(0deg)` 但要反向（上下文本不同，见 `band.reverse`）：翻转没有了，
                 *     改让**行程**反向——`−1 − m`，跑的还是同一份的区间 [−一份, 0]，只是方向相反。
                 *     不这么做，两条带就会同向走，对开观感没了。
                 */
                const slot = Math.abs(band.rotate) === 180 ? m + 1 : (band.reverse ? -1 - m : m);
                const offset = ((slot * 100) / entry.cycle).toFixed(4);
                set(inner, 'transform', `rotate(${band.rotate}deg) translateX(${offset}%)`);
                /*
                 * 边线那道灯沿带子走：位移是一段正弦（±`tune.edgeDriftSpan`% 带高），并配一个
                 * 让「走到两端」看得出来的淡出——否则灯会像一条被瞬移的边。
                 * `marqueeSpeed` 与带速共用同一个相位累加器，所以拖带速时字与灯一起变速，
                 * 两者的相对关系不变（`marqueeEdgeDrift` 单独再缩放一次）。
                 *
                 * 推的是 `haloNode`（内沿整条），而它是内沿的**唯一**一份（见上面 haloNode 的
                 * 说明），所以这里的振幅与不透明度直接就是「那道灯看上去稳不稳」。
                 */
                if (entry.haloNode && entry.drifting) {
                    const walk = Math.sin(shift * Math.PI * 2);
                    /*
                     * 位移按 slot 镜像：下带朝屏心的方向是 −y，用与上带同一个符号
                     * 就成了「上带的灯往屏心走、下带的灯往屏外走（走出画面）」。
                     *
                     * 振幅是 `edgeDriftSpan`（缺省 0，见 TUNING.marquee.edge 那一节：
                     * 带上的字与边线本来就挤在同一个纵向区间里，让这道灯沿带子走
                     * 就会穿过字身、读成第二条线）。振幅为 0 时**连不透明度都不动**——
                     * 否则那条淡出会把「一条稳定的边」读成「一条时亮时暗的边」。
                     *
                     * 位移只写 `translate3d`：下带那个节点的位置由 `bottom` 定（见 haloNode 的
                     * 几何说明），不靠 transform——两者都在 transform 上的话，第 2 条会把
                     * 第 1 条整条丢掉。
                     */
                    const along = walk * tune.edgeDriftSpan * (entry.band.slot === 'top' ? 1 : -1);
                    set(entry.haloNode, 'transform', `translate3d(0, ${along.toFixed(2)}%, 0)`);
                    set(entry.haloNode, 'opacity', along === 0
                        ? '1'
                        : (tune.edgeDriftFloor + (1 - tune.edgeDriftFloor) * Math.cos(walk * Math.PI / 2) ** 2).toFixed(3));
                }
            });
        },
        dispose: () => {
            dead = true;
            observer.disconnect();
        },
    };
};
/*
 * 把丝带里的文字铺到**越过屏幕边缘**。
 *
 * 份数由实测宽度算，不是按字数估：字数估不准（中英混排、字距、字体回退都会让
 * 实际宽度偏离），估窄了就一定铺不满。
 *
 * **份数 − 1 份必须盖住整条盒子**：文字滚动的位移回绕一整份（见 buildRibbon 的
 * update），所以最坏情况下有一整份被推到盒子外——只铺到「刚好盖住」的话，
 * 滚过一段就会露出空档，这正是「末端没超出屏幕 / 忽然移动一大段」的来源。
 *
 * 位移改成**线性**之后（见 buildRibbon），`limit` 还要再加「整行要走的距离」：
 * 不回绕就意味着内容必须一次铺够「盒长 + 这一行从头走到尾要走的距离」，
 * 否则行尾会把末端走进屏幕。
 *
 * 返回一份的实测宽度（px）：它只用来算「铺几份」，不参与位移。
 */
const fillRibbonText = (inner, text, { limit = 0 } = {}) => {
    const { repeatMin, repeatMax, widthSafety } = CINERAMA_TUNING.ribbon;
    const measure = () => (typeof inner.scrollWidth === 'number' ? inner.scrollWidth : 0);
    /*
     * 一份的**周期** = 字宽 + 它后面那个间隔（`repeatText` 用全角空格把各份串起来）。
     * 只量一份会把间隔漏掉：回绕位移于是比实际周期短一个间隔，
     * 每回绕一次就往回错一点——滚动读起来是「每隔一会儿顿一下」。
     * 所以量两份再解出间隔：gap = 两份 − 2 × 一份。
     */
    inner.textContent = text;
    const singlePx = measure();
    if (!(singlePx > 0)) {
        // 量不到宽度（离屏 / 还没布局）：退回兜底份数，下一帧再量（见 buildRibbon.update）。
        inner.textContent = repeatText(text, repeatMin);
        return { copies: repeatMin, unitPx: 0 };
    }
    inner.textContent = repeatText(text, 2);
    const gapPx = Math.max(0, measure() - 2 * singlePx);
    const unitPx = singlePx + gapPx;
    const copies = clamp(Math.ceil((limit * widthSafety) / unitPx) + 1, repeatMin, repeatMax);
    inner.textContent = repeatText(text, copies);
    return { copies, unitPx };
};

/*
 * 丝带的皮肤跟着主题的亮 / 暗走：带身一律取 `accent`、字一律取主题背景色反白
 * （两侧都是主题色，所以换主题不用改这里），换的是**层次与明暗的表达方式**：
 *
 *   - 亮色主题：屏面是浅的，丝带读作压在屏面上的实物——层次靠**投影**
 *     （黑影 + 上沿高光）；明暗里「暗的那一段」给足，才有厚度感。
 *   - 暗色主题：屏面本身就是深的，黑投影在深底上几乎看不见，丝带要靠**发光**
 *     才读得出是贴在暗底上的一条亮胶带（实录里被舞台灯打亮的胶带就是这个读法）。
 *     所以外发光用 accent 自己（`color-mix` 让浏览器做透明化——主题色格式任意，
 *     模组侧算不出可靠的 alpha），同时把「亮的那一段」加强、「暗的那一段」压低：
 *     暗底上再压黑只会把带子抹掉，亮起来才是发光。
 */
const ribbonSkin = (palette) => {
    const accent = palette.accent ?? '#8fc7ff';
    const ink = palette.background ?? '#ffffff';
    if (palette.dark) {
        return {
            fill: accent,
            ink,
            shadow: [
                `0 0 24px color-mix(in srgb, ${accent} 60%, transparent)`,
                '0 6px 16px rgba(0,0,0,0.45)',
                '0 1px 0 rgba(255,255,255,0.3)',
            ].join(', '),
            shadeLight: 1.4,
            shadeDark: 0.5,
        };
    }
    return {
        fill: accent,
        ink,
        shadow: [
            '0 6px 18px rgba(0,0,0,0.55)',
            '0 1px 0 rgba(255,255,255,0.12)',
        ].join(', '),
        shadeLight: 1,
        shadeDark: 0.9,
    };
};

/*
 * 斜切丝带拼贴——实底胶带（不透明）。质感来自两处，都是**丝带自身的属性**：
 *
 *   1. 明暗过渡：每条丝带沿自身轴向有一条稍亮、一条稍暗的段（自身渐变，见 strip.shade*），
 *      不是「靠前的层亮、靠后的层暗」——那是层间关系，会把拼贴读成 z 轴排序；
 *   2. 投影：上层丝带给下层丝带落一圈阴影（box-shadow），叠压处才有实物感。
 *      主题色是任意格式的 CSS 字符串，做不了可靠的 alpha 化，所以走阴影而不是半透明层。
 *
 * 实底胶带不做淡入，也不沿自身轴向滑——轴向滑会把末端拽进屏幕；
 * 入场滑入已移除（为保证方向/速度恒定），角度与位置在解算层已经错开（离散角不重复 + 乱序大抖动）。
 */
const buildRibbon = ({ plan, style, palette, set, readOptions, relay }) => {
    const host = createDiv('position:absolute;inset:0;overflow:hidden;');
    const { textPxPerSec, travelSlackSec, travelTailSec } = CINERAMA_TUNING.ribbon;
    const skin = ribbonSkin(palette);

    /*
     * 叠压次序：**位置靠下的在上**。后来居上是 DOM 的默认叠放规则，而丝带是斜的——
     * 不指定次序的话「上面那条」是随机的，投影就会有的朝上有的朝下，读不出层次。
     * 按 topPct 降序 append，于是每条丝带的投影都落在它下面那条上，像一叠贴上去的胶带。
     */
    const ordered = [...style.strips].sort((left, right) => right.topPct - left.topPct);
    const strips = ordered.map((strip) => {
        const outer = createDiv([
            'position:absolute', 'display:flex',
            'align-items:center', 'overflow:hidden',
            // left/right 的溢出量第一帧按实测的「需要盖住多长」重写（见 layout）。
            'left:-40%', 'right:-40%',
            `top:${strip.topPct.toFixed(2)}%`,
            // 厚度是独立的 vh 值，不再由字号撑出来（字号一大整条就跟着变粗）。
            `height:${strip.thicknessVh.toFixed(2)}vh`,
            `font-size:clamp(10px, ${strip.fontVh.toFixed(2)}vh, ${strip.thicknessVh.toFixed(2)}vh)`,
            'line-height:1',
            // 配色一律取自主题（见 ribbonSkin）：实底 accent 带 + 主题背景色反白。
            `background:${skin.fill}`,
            `color:${skin.ink}`,
            'padding:0', 'font-weight:800', 'letter-spacing:0.05em',
            /*
             * 层次的表达按主题换（见 ribbonSkin）：亮色主题是投影、暗色主题是外发光。
             * 写在 box-shadow 上而不是整块的 drop-shadow 滤镜：滤镜会把文字也一起糊掉，
             * 而这里要的是「胶带压在胶带上」。
             */
            `box-shadow:${skin.shadow}`,
            'will-change:transform',
        ].join(';'));

        /*
         * 自身明暗过渡：一条丝带上稍亮的一段 + 稍暗的一段，读作胶带表面的受光。
         * 整条渐变是**一个声明**，所以先拼成一条字符串再随其它声明用 ';' 连——
         * 混着用空格连会把 `position:absolute inset:0` 也连进 background 的值里。
         */
        const shadeStart = strip.shadeStart;
        const shadeSpan = strip.shadeSpan;
        // 明暗强度按主题缩放（见 ribbonSkin）：暗色主题亮的一段更亮、暗的一段更淡。
        const lightAlpha = clamp(strip.shadeStrength * skin.shadeLight, 0, 0.55);
        const darkAlpha = clamp(strip.shadeStrength * skin.shadeDark, 0, 0.55);
        const shading = createDiv([
            'position:absolute', 'inset:0', 'pointer-events:none',
            `background:linear-gradient(${strip.shadeAngle.toFixed(1)}deg, `
                + `rgba(255,255,255,0) ${shadeStart.toFixed(1)}%, `
                + `rgba(255,255,255,${lightAlpha.toFixed(3)}) ${(shadeStart + shadeSpan * 0.5).toFixed(1)}%, `
                + `rgba(255,255,255,0) ${(shadeStart + shadeSpan).toFixed(1)}%, `
                + `rgba(0,0,0,0) ${(shadeStart + shadeSpan + 12).toFixed(1)}%, `
                + `rgba(0,0,0,${darkAlpha.toFixed(3)}) ${Math.min(96, shadeStart + shadeSpan * 1.5 + 12).toFixed(1)}%, `
                + 'rgba(0,0,0,0) 100%)',
        ].join(';'));

        const inner = createDiv([
            /*
             * 绝对定位 + left:0：文字从丝带盒子的左端开始排，位移是**纯像素**的
             * translateX。用 flex 居中的话「内容比盒子宽」会向两侧溢出，
             * 左端跑到盒子外被裁掉，滚动时那一段永远看不见。
             */
            'position:absolute', 'left:0', 'top:0', 'height:100%',
            'display:flex', 'align-items:center', 'white-space:nowrap',
            'will-change:transform',
        ].join(';'));
        inner.textContent = repeatText(strip.text, strip.repeat);
        // 明暗垫在文字**下面**：它是胶带自身的材质，压在字上会把字蒙一层
        // （暗色主题下「亮的那一段」会加强到 1.4 倍，蒙一层就很明显）。
        outer.append(shading, inner);
        host.append(outer);
        return {
            outer,
            inner,
            strip,
            // 一份的实测宽度（px）与滚动速度：建层时量不到尺寸（节点还没进 DOM），第一帧补。
            unitPx: 0,
            pxPerSec: 0,
            filled: false,
            /*
             * 接力转场里「撕走 / 贴新」沿自身轴向要滑的行程（px），两个半场各一份：
             * layout 量出盒长之后按分离轴算（见 ribbonExitDistance）。量不到时的兜底在
             * resolveCineramaRelayStripFrame 里给。
             */
            exitDistPx: 0,
            enterDistPx: 0,
            // 文字的线性滚动：`位移 = pxPerSec × (当前时间 − 本行起始)`（见 TUNING.ribbon.textPxPerSec）。
            // maxTravelPx 是内容允许的走行上限（内容走完就停，末端不进屏幕）。
            maxTravelPx: 0,
        };
    });

    /*
     * 这块盘面上**整叠共用**的漂移钳位（见 resolveRibbonDriftClampPx）。
     * 解算层在不知道屏幕尺寸的情况下按「盘面上最苛刻的那一条」给了一个名义刻度
     * （strip.driftClampPx），这里量到真实宽高之后按屏高缩放回像素。
     */
    const clampPxFor = (strip) => {
        const reference = Number(strip.driftClampPx);
        if (!Number.isFinite(reference) || reference <= 0) return CINERAMA_TUNING.ribbon.driftClampPx;
        const height = host.clientHeight || 0;
        return height > 0 ? (reference * height) / 1000 : reference;
    };

    /*
     * 尺寸变了（窗口缩放、屏体比例变化）要重铺：coverage 与份数都依赖实测宽高。
     * 回调里只翻标记，真正的重排在下一帧 update 里做（回调里量尺寸会抖）。
     */
    const relayout = createRelayoutGate(host);
    const observer = new ResizeObserver(() => {
        strips.forEach((entry) => { entry.filled = false; });
    });
    observer.observe(host);

    /*
     * 字体晚于首帧到位会让量出来的**周期**过期：回绕位移按旧周期走，而屏上排的是
     * 新字体——每一次回绕都差一点，读起来就是「匀速滚动中忽然跳一下」。
     * 所以字体就绪后重铺一次（与四边环同一条理由）。重铺本身不跳：位移只依赖时间，
     * 重铺只改内容的份数与盒长（见 layout）。
     *
     * 层已经销毁就什么也别做：这个回调无法取消，闭包持有整叠 strips（连带它们的节点）。
     */
    let dead = false;
    document.fonts?.ready?.then(() => {
        if (dead) return;
        strips.forEach((entry) => { entry.filled = false; });
    });

    /*
     * 一次性的铺满：算出这条丝带**旋转之后要盖住多长**（coverage + 竖向位移的轴向分量，
     * 见 ribbonBoxLength），据此重写盒子的左右溢出量，并把文字补到越过它。
     */
    const layout = (entry) => {
        const { outer, inner, strip } = entry;
        const width = host.clientWidth || 0;
        const height = host.clientHeight || 0;
        if (!(width > 0) || !(height > 0)) return false;
        /*
         * 旋转中心是**盒心**，`top` 给的是盒子上沿，所以要把半个厚度加进去。
         * 厚度写的是 vh、位置写的是屏高的百分比，两把尺子不同，只能实测。
         */
        const thicknessPx = outer.offsetHeight || 0;
        const centerFrac = clamp(strip.topPct / 100 + thicknessPx / (2 * height), 0, 1);
        /*
         * 盒长按**最坏的竖向位移**下料：只有漂移会做屏幕竖向平移
         * （钳位由这块盘面的几何算出来，见 resolveRibbonDriftClampPx），
         * 入场滑入已移除（为保证方向/速度恒定），所以最坏位移就是钳位本身。
         * 盒子绕自己的中心转，竖着挪 d 会让屏幕的轴向区间相对盒心偏 d × |sin θ|
         * ——只按静止时「刚好盖住」下料，位移到极值时末端就缩进屏幕里。
         */
        const need = ribbonBoxLength(
            width, height, strip.angleDeg, centerFrac, clampPxFor(strip),
        );
        /*
         * 接力转场里「撕走 / 贴新」要沿丝带自身轴向滑出屏幕（见 relayAxialOffset）。
         * 行程在下面量出盒长之后再按分离轴精确算——那里才知道盒子最终有多长。
         */
        /*
         * 速度是一个**恒定**的「屏宽比值 / 秒」：与歌词、逐字歌词、行时长都无关
         * （不引入 seed 抖动），只随屏幕宽度缩放（小窗口字不会显得飞快）。
         * 每条丝带的竖向漂移仍有各自的相位/抖动，所以整叠不会读成一块刚性板。
         */
        entry.pxPerSec = textPxPerSec * width;
        /*
         * 位移是线性的（不回绕），所以内容要一次铺够「盒长 + 这一行从头走到尾
         * 要走的距离」：滚出去的那一段不会回来，走到底就露末端。
         */
        const span = Math.max(0, (plan.window?.endTime ?? 0) - (plan.window?.startTime ?? 0));
        /*
         * 内容按「行窗口 + 退出尾巴」铺：行窗口结束后丝带还留在屏上（空档里 hold、
         * 紧邻时交叉淡出），位移预算只算到窗口末尾的话那一段就是一条停住的丝带
         * （见 TUNING.ribbon.travelTailSec）。铺的长度取两个富余里更大的那个，
         * 免得哪天把尾巴调得比 travelSlackSec 还长就把内容走光了。
         */
        const travelPx = entry.pxPerSec * (span + Math.max(travelSlackSec, travelTailSec));
        const { copies, unitPx } = fillRibbonText(inner, strip.text, { limit: need + travelPx });
        if (!(unitPx > 0)) return false;
        /*
         * 盒子的长度取「内容在最坏相位下仍然盖得住」的那一段：
         * 回绕位移推走一整份，所以可见长度是 (份数 − 1) 份。盒子比它长就会露边。
         * 于是盒子**按内容收**，而不是按几何硬撑——几何只给目标，内容说了算。
         */
        const usable = Math.max(width, (copies - 1) * unitPx);
        const overflowPct = ribbonOverflowPct(Math.min(need, usable), width);
        set(outer, 'left', `-${overflowPct.toFixed(2)}%`);
        set(outer, 'right', `-${overflowPct.toFixed(2)}%`);
        /*
         * 能走多远由**内容**说了算：内容从盒子左端排起，超出盒子右端的那一段
         * 就是可走的距离。走到底就停在原地（行尾淡出那一段才可能走到），
         * 绝不把末端放进盒子。
         */
        const boxLength = width * (1 + (2 * overflowPct) / 100);
        /*
         * 接力两个半场各自要滑多远的**精确值**（按分离轴算，见 ribbonExitDistance）：
         * 撕走往 ripDir 那一头、贴新从 flyDir 那一头来，方向不同、行程就不同。
         * 放 5% 余量：公式本身是精确的（分离轴是充分条件），余量只用来盖住取整与
         * 盒沿投影的一两个像素——丝带影子（24px 外发光）也跟着一起出屏。
         * 这是「撕走 / 贴新」唯一该动的距离；多给的部分全是屏外空跑，
         * 会直接变成读不出来的高速（见 relayEase 的注释）。
         */
        entry.exitDistPx = Math.max(
            1,
            ribbonExitDistance(width, height, strip.angleDeg, centerFrac, boxLength, strip.ripDir ?? 1) * 1.05,
        );
        entry.enterDistPx = Math.max(
            1,
            ribbonExitDistance(width, height, strip.angleDeg, centerFrac, boxLength, strip.flyDir ?? 1) * 1.05,
        );
        /*
         * 文字全程匀速：位移上限取「行窗口 + 退出尾巴能走的距离」，于是
         * `offset = elapsed × pxPerSec` 在这两段里都成立（内容已按 need + travelPx 铺够，
         * 不会中途见底）。**只算行窗口是不够的**：窗口结束后丝带还在屏上挂着
         * （空档 hold / 转场交叉淡出），那一段它必须还在走，否则读出来就是「丝带卡住了」。
         * 真正的兜底仍是内容余量（`usable − boxLength`）：走到底就停在原地，末端不进盒子。
         */
        entry.maxTravelPx = Math.max(
            0,
            Math.min(entry.pxPerSec * (span + travelTailSec), usable - boxLength),
        );
        entry.unitPx = unitPx;
        entry.filled = true;
        return copies > 0;
    };

    return {
        root: host,
        update: (time) => {
            const { ribbonDrift } = readOptions();
            relayout.nextFrame();
            const canMeasure = relayout.allowed();
            strips.forEach((entry) => {
                const { outer, inner, strip } = entry;
                /*
                 * 铺满只做一次（量宽度会触发同步布局，逐帧量会把整屏拖成掉帧），
                 * 但**量不到就下一帧再试**：建层那一刻节点还没进 DOM（clientWidth 为 0），
                 * 认下来会把份数定成兜底值，末端就露在屏幕里。
                 * 试不到的这一帧也要把角度、漂移与接力偏移写全——否则它是一条
                 * 没旋转的横带，或贴新时在终点位置先闪一帧。
                 */
                const laid = entry.filled || (canMeasure && layout(entry));
                /*
                 * 丝带自身只做屏幕竖向的匀速漂移：方向（driftDir，种子定、整 plan 不变）
                 * + 速度（driftVelPxPerSec × driftVelScale × ribbonDrift，都是与时间无关的常量）
                 * 全程恒定，不进场、不变向、不回绕。
                 * 漂移原点：接力继承的丝带带着它最初所属那一行的窗口起点
                 * （strip.driftOrigin，见 cineramaTreatment.resolveRibbonRelayStrips），
                 * 位移公式不变——跨过交接的那一刻位置与速度都连续，不跳。
                 * 漂移先于旋转：translate 写在 rotate 之前才是屏幕 y 方向。
                 * 唯一会让它不再匀速的是钳位（见下），而钳位只在贴到屏沿时才到得了。
                 */
                const driftOrigin = strip.driftOrigin ?? plan.window?.startTime ?? 0;
                const vel = CINERAMA_TUNING.ribbon.driftVelPxPerSec * (strip.driftVelScale ?? 1) * ribbonDrift;
                /*
                 * 钳位是这块盘面的共同刻度（见 resolveRibbonDriftClampPx），不是逐条贴边值：
                 * 只有**整叠同时**停住，停的那一刻才读得出「它们贴到屏沿了」而不是
                 * 「两条带之间的间距忽然不匀速了」（那才会被读成停止/反向）。
                 * 位移与它的钳位一起走一个出口（见 resolveCineramaRibbonDriftFrame），
                 * 单测与真机读的是同一个函数。
                 */
                const { clampPx, drift } = resolveCineramaRibbonDriftFrame(strip, time, {
                    driftOrigin,
                    vel,
                    clampPx: clampPxFor(strip),
                });
                // 接力编排：轴向的撕走/贴新偏移 + 撕走的小甩角 + 让位隐藏（无接力时全为 0/1）。
                const { opacity, axialPx: axial, swingDeg: swing } = resolveCineramaRelayStripFrame(
                    strip,
                    relay,
                    time,
                    { exitPx: entry.exitDistPx, enterPx: entry.enterDistPx },
                );
                set(outer, 'opacity', opacity.toFixed(3));
                /*
                 * 位移写入的精度：**亚像素级运动不能用 toFixed(1)**。
                 * 漂移是 ~4px/s（60fps 下 0.067px/帧），toFixed(1) 把它整成「每 1.5 帧跳 0.1px」，
                 * 三分之一的帧完全不动——匀速漂移于是读成阶梯状的爬行。
                 * 文字滚动同理：256px/s 下每帧 4.267px，toFixed(1) 会在 4.2 / 4.3 之间来回跳，
                 * 步长波动 2.3%，滚动因此带一层细碎的抖动。统一写到 1/1000 px。
                 */
                set(outer, 'transform', `translate3d(0, ${drift.toFixed(3)}px, 0) rotate(${(strip.angleDeg + swing).toFixed(2)}deg) translateX(${axial.toFixed(3)}px)`);
                if (!laid) return;
                /*
                 * 原点统一取本行起始：接力继承的丝带文字换过（内容从头排起），
                 * 交接那一刻本来就要整段换内容，从 0 起滚正好。
                 * 滚动为什么用线性而不是回绕，见 TUNING.ribbon.textPxPerSec 那段。
                 */
                const elapsed = Math.max(0, time - (plan.window?.startTime ?? 0));
                const offset = Math.min(elapsed * entry.pxPerSec, entry.maxTravelPx);
                set(inner, 'transform', `translateX(${(-offset).toFixed(3)}px)`);
            });
        },
        dispose: () => {
            dead = true;
            observer.disconnect();
        },
    };
};

const CINERAMA_STYLE_BUILDERS = {
    'hero-type': buildHero,
    'small-type': buildSmallType,
    'ribbon-collage': buildRibbon,
};

const buildStyleLayer = ({ kind, plan, style, palette, set, readOptions, relay }) => {
    /*
     * 斜切丝带**一条带都没有**就整层不画：空行（既无原文也无译文）排不出内容，
     * 而它又是「只留丝带权重」时唯一能抽到的样式——那种情况下屏上该是干净的屏体，
     * 不是几条空胶带（`ribbonTextsOf` 返回空数组，解算层因此给出空 strips）。
     */
    if (kind === 'ribbon-collage' && !(style?.strips?.length > 0)) {
        return { root: createDiv('position:absolute;inset:0;'), update: () => {}, kind };
    }
    const build = CINERAMA_STYLE_BUILDERS[kind] ?? buildSmallType;
    return build({ plan, style, palette, set, readOptions, relay });
};

/*
 * 退出方要不要继续 update（转场槽用它，见 visualizer.paint）。
 *
 * 退出方**默认冻结**：大字报的块按行窗口逐块闪现，越界之后全是 `opacity:0`，
 * 继续 update 会把退出方演成空白，交叉就成了「先空一下再淡入」。
 * 但丝带不一样——它整行都在屏上（没有逐块闪现那一套），而且**它是有运动的**
 * （文字匀速滚动 + 上下漂移）。冻结那 0.14~0.28s 读出来就是「丝带卡住了」，
 * 所以丝带照旧 update，让运动一直持续到淡出结束。
 *
 * 判定放在渲染层而不是转场层：哪些层的运动跨过行窗口仍然成立，是这一层自己的知识。
 */
export const cineramaOutgoingKeepsMoving = (layer) => layer?.kind === 'ribbon-collage';

/*
 * Builds one line's content layer. `options` is the resolved knob snapshot at
 * build time (structural knobs); `getOptions` re-reads them every frame for the
 * continuous ones (speeds, drift). Both may be absent (export window,
 * older host), in which case every knob stays at its default. The returned
 * update() drives only this layer's internal motion.
 *
 * `relay` 是丝带接力的两个半场（可同时存在——链中间的一行既接上来又退出去）：
 *   - enter：这一行入场时的贴新编排 `{boundary, duration, staged}`（staged =
 *     屏上真有一个正在退的上一行；seek 直接落进来时不播，丝带全部就位）；
 *   - exit：这一行退给下一行时的撕走/让位划分 `{boundary, duration, nextPlan}`，
 *     划分按两行的接力种子标到 style.strips 上（见 markRibbonRelayExitStrips）。
 *
 * 组合顺序：样式（正片）→ 叠加的跑马灯带。
 */
export const buildCineramaLayer = ({ plan, palette, options, getOptions, relay = null }) => {
    const set = createStyleWriter();
    const readOptions = getOptions ?? (() => options ?? resolveCineramaOptions());
    const resolved = options ?? readOptions();

    // 样式是编译期按权重抽好的（plan.style），跑马灯带是面板档位。
    const kind = resolveCineramaStyleKind(plan);
    /*
     * 带要在**样式之前**解算：排版本体必须知道带占了屏沿的哪几条边（不许压上去，
     * 见 resolveCineramaStyle 里的 inset / heroTuningWithinBand）。
     * 它同时决定「这一行有没有带」——斜切丝带不与带组合，所以丝带那一档 inset 恒为 0。
     */
    const marquee = resolveCineramaMarquee(resolved.marquee, plan, kind, resolved);
    let style = resolveCineramaStyle(kind, plan, resolved, marquee);
    // 退场划分只作用在丝带上：进入 relay.exit 的一定是丝带层（配对判定在 visualizer），
    // 这里再兜一道 Array.isArray。
    if (relay?.exit && Array.isArray(style.strips)) {
        style = {
            ...style,
            strips: markRibbonRelayExitStrips(style.strips, ribbonRelaySeed(plan, relay.exit.nextPlan)),
        };
    }
    const root = createDiv('position:absolute;inset:0;');

    /*
     * 内容与**屏级家具**分成两层，转场包络只作用在内容那一层（`envelope`）。
     *
     * 跑马灯带占的是屏沿那一圈，是「这块屏的边框」，不是这一行的内容：它不随这句
     * 进出场。转场帧里带 `scale`（见 cineramaTransition 的 dissolve），若把带子也
     * 放进被缩放的那棵子树里，同一次溶解就会让**框本身**变大变小——两层交叉时
     * 各自缩在不同进度上，内沿于是错开（「过渡时框的大小变了、内边缘不重叠」）；
     * 缩放以盒子中心为原点，带子贴着屏沿的那一侧还会向内让开一截（「双带最左侧与
     * 屏左边缘出现间隙」）。把带子留在 `root` 上、只缩放内容，两件事同时不成立：
     * 框的几何在整段转场里恒定，内沿永远重合，左沿也永远贴着屏左沿。
     */
    const envelope = createDiv('position:absolute;inset:0;');

    const main = buildStyleLayer({ kind, plan, style, palette, set, readOptions, relay });
    envelope.append(main.root);

    // 四边走 SVG textPath 环（自带 ResizeObserver，随层销毁），双带保持整条字带平移。
    const bands = marquee
        ? (marquee.kind === 'marquee-frame'
            ? buildMarqueeRing({ marquee, palette, readOptions })
            : buildMarqueeBands({ marquee, palette, set, readOptions }))
        : null;
    root.append(envelope);
    if (bands) root.append(bands.root);

    const update = (time) => {
        main.update(time);
        if (bands) bands.update(time);
    };
    update(plan.window.startTime);

    return {
        root,
        // 转场包络的写入目标：内容层（不含跑马灯带）。visualizer 拿它写 opacity / transform。
        envelope,
        /*
         * 跑马灯带的挂载点（没有带时缺席）。visualizer 只对它写**不透明度**：
         * 带是屏级家具，几何不许动（见上面的说明），但两层同时在屏上时两份带上的字
         * 会互相穿插，所以交接只能靠「先后各半场」淡换（见 cineramaTransition 的
         * resolveCineramaBandExitPresence / EnterPresence）。
         */
        bands: bands ? bands.root : null,
        update,
        kind,
        /*
         * 层被换掉时断开观察器：斜切丝带与四边环都用 ResizeObserver 触发重铺，
         * 两处都断（缺席的实现没有 dispose，可选调用即可）。
         */
        dispose: () => {
            main.dispose?.();
            bands?.dispose?.();
        },
    };
};
