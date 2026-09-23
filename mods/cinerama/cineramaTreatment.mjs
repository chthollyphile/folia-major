import { chooseCineramaWithoutRepeat, cineramaHash01, hashCineramaSeed } from './cineramaRandom.mjs';
import {
    CINERAMA_MARQUEE_EDGE_COLOR_VALUES,
    CINERAMA_MARQUEE_EDGE_DEFAULT,
    CINERAMA_MARQUEE_EDGE_SIDES_VALUES,
    CINERAMA_MARQUEE_EDGE_VALUES,
    CINERAMA_MARQUEE_FILL_COLOR_VALUES,
    CINERAMA_MARQUEE_FILL_DEFAULT,
    CINERAMA_MARQUEE_FILL_VALUES,
    CINERAMA_MARQUEE_GLOW_DEFAULT,
    CINERAMA_MARQUEE_TEXT_GLOW_DEFAULT,
    CINERAMA_STYLE_KINDS,
    cineramaStyleWeights,
    resolveCineramaBandFontCq,
    resolveCineramaBandPct,
    resolveCineramaOptions,
} from './cineramaOptions.mjs';
import { isCineramaTransitionAdjacent, resolveCineramaRelayDuration } from './cineramaTransition.mjs';
import {
    resolveCineramaRevealWindow,
    resolveCineramaSegmentSpans,
    segmentCineramaWords,
} from './cineramaSplit.mjs';
import { resolveCineramaLayout } from './cineramaLayout.mjs';

// mods/cinerama/cineramaTreatment.mjs
// 视觉处理层：一行歌词以哪种「大屏语汇」上屏，以及上面叠什么。纯数据——只解算参数，不碰 DOM。
//
// 两条轴，彼此正交：
//   1. 样式（style）——排版本体，三种样式各有一个**概率权重**旋钮，每句按权重比例抽一个；
//   2. 跑马灯带（marquee）——**叠加元素**，不是样式：可以叠在大字报/小字报上
//      （关 / 自动 / 双带 / 四边），斜切丝带不跟它组合。
// 印前故障（套版错位）**已移除**：它把样式层再建两遍当 screen 混合的错位副本，
// 上屏读出来是「字糊了一层」而不是印刷，还要多付两倍节点（见 README 的「已移除」一节）。
// 未来新增的叠加元素照这个形状加第三条轴，样式表不用动。
//
// CINERAMA_TUNING 是**代码级常量**（缺省/几何上限），用户旋钮来自 options。

// 可抽取的样式（样式没有 `auto` 这一档了：每句按权重抽，见 pickCineramaStyleKind）。
// 清单与顺序来自解算层的权重表（cineramaOptions.CINERAMA_STYLE_WEIGHT_FIELDS），
// 这里只是转出一份，避免「加了一种样式却漏改这里」。
export { CINERAMA_STYLE_KINDS };

/*
 * 丝带角度档位：正负各半、档间至少 9°，实录里胶带角度彼此明显不同。
 * 档位数要够 `ribbonCount` 的上限（9）用：档位少于条数就会 `index % length` 回绕，
 * 于是出现两条同角的平行丝带——「角度不重复」这条性质当场失效。
 */
const RIBBON_ANGLE_POOL = [-54, -42, -32, -23, -13, 12, 21, 31, 41, 53];
/*
 * 大字报的**块级微差**：相邻两块的字号在池子里各抽一个、且不重复——连着两次闪现因此
 * 大小略有出入，而不是同一个尺寸复制五遍。幅度是「微调」（±5%），真正的上限不是这个池子
 * 而是**每块自己的安全字号**（见 heroFontVhForChunk：竖向 `maxFontVh` 与横向 `usableWidthVw`
 * 都算在内），所以放大的那几块也不会出屏、不会折行。
 */
const HERO_CHUNK_SCALE_POOL = [0.95, 1, 1.05];
/*
 * 大字报块级动效的几个尺度常数，都转进 `TUNING.hero` 由渲染层同源读取：
 *   - `HERO_BASE_TRACK_EM`：**所有块都带**的字距（`letter-spacing`）；
 *   - `HERO_SPREAD_*`：下面「一边放大一边加大字间距」那一档的两个终点。
 * 字距之所以要有常量，是因为当量宽度按 `Σ(字宽 + 字距)` 估——解算层的「会不会出屏」
 * 与渲染层写出去的 CSS 必须是同一个数，两处各写一个字面值迟早失配。
 */
const HERO_BASE_TRACK_EM = 0.01;

/*
 * 「摊开」（一边放大一边加大字间距）那一档的终点。
 *
 * 峰值缩放 **1.3** 来自需求；**字距 0.15em/字** 是按「不比现有最坏情形更糟」反推出来的：
 * `letter-spacing` 加在**每个字之后**（包括末字），所以一块字的宽度增量是 `字数 × 字距`；
 * 而 CJK 满角字的当量宽度本来就是 1.0em/字，相对增量 ≈ 字距本身。
 * 于是这一档的横向最坏情形是 `1.3 × (1 + 0.15) ≈ 1.495`——刚好落在「推近」那档 1.5
 * 的预算之内。再往上就不只是「和既有极值一样多」，而是比极值更容易把两边的字推出屏。
 */
const HERO_SPREAD_SCALE_TO = 1.3;
const HERO_SPREAD_TRACK_EM = 0.15;

/*
 * 大字报的**块级持续运动**：挂住的那一秒多里，字慢慢放大/缩小/移动，
 * 而不是落位后就死死定住（「文字动效单薄」主要就是这一段）。
 *
 * 每块按**权重**抽一个动作（不按"相邻不重复"——静止本来就是高频项，连着两块不动很正常）：
 *   - still：**完全不运动、不缩放**（权重最大）。大屏上挂着一块死字并不可怕，
 *     全都在动才吵；有它当底，其余几块的动作才显得是「有意为之」。
 *   - push / pull：持续**放大**（0.93 → **1.5**）或持续**缩小**（1.5 → 0.93），
 *     同时**横向**收到正中（纵向不动，见下）。
 *   - slideX：大小不变，只横向走进正中。
 *   - slideY：大小不变，只纵向走进正中（竖直运动只有这一档）。
 *   - spread：**一边放大（1 → 1.3）一边加大字间距**（0 → 0.15em），停在正中不动。
 *     字距和缩放同步线性增长，所以整块是"胀开"而不是"推近"——同一件事用两个维度说，
 *     比单把字放大到 1.3 更像版面自己舒展开（数值的来历见 HERO_SPREAD_*）。
 *     它不带位移：字距已经在把字往外推，再加平移就没有静止的锚点了。
 * 位移是 `xFrom/yFrom → 0`（**收到正中**），所以最后一块长时间挂在屏上时是正的、
 * 不会歪着停住。幅度单位是**屏的百分比**（块是 inset:0，transform 的百分比按自身尺寸解析）。
 *
 * **只有"没填色"的块才抽这里**（要不要填色由 `TUNING.hero.fillChance` 按这一块的**字数**定，
 * 见 `heroFillChance`）：填色的块一律取 `HERO_STILL_MOTION`（不动不缩放、字距恒定），
 * 两套动作不重叠——叠在同一块上会互相打架，字一边被放大一边被一道边界扫过，
 * 读起来既不像"填"也不像"推近"。所以这里抽到的 still 是「实色落定、不动也不填」那一档。
 *
 * 权重 **2 : 2 : 2 : 1 : 2 : 4（和 13）** 是与填色上限**配平**出来的（推导见 `fillChance`）：
 * 把「不填色的块里抽到什么」乘上「不填色的概率」之后，整块的七项概率正好是
 * 填色 = 放大 = 缩小 = 横移 = 摊开 = 2/15、纵移 = 1/15（它的**一半**）、
 * 静置 = 4/15（它的**二倍**）。改一边就要连着改另一边（同一个式子：`cap = (1 − cap) × 2/13`）。
 *
 * **竖直运动只留 slideY 一档**：放大/缩小那两档原本带 1.2% 的纵向位移，去掉了。
 * 大屏上横向漂移读起来是"镜头平移"，竖向漂移却很容易读成「字在上下抖」——尤其配着
 * 上方跑马灯带一起看。要让纵向彻底消失，把 slideY 那条删掉即可（池子会自动重新归一）。
 *
 * ⚠ 1.5 会**压到跑马灯带上**：满档的字（`maxFontVh`，现在 51.2vh）× 1.5 = 76.8vh 的字框，
 * 而带子（画在正片之上）占着上下各 15%、两侧合计只剩 70vh，所以放大过程中字的上下两沿
 * 仍会钻到带子底下被盖住——整档按 0.8 重标定之后余量只剩这么多。要「到 1.5 又不压带」
 * 只有两条路：把基准字号按最大倍率预留（静止的块也一起变小），或者改成"胀一下再回来"
 * （峰值 1.5、落定回 1）。这里是按「scaleTo 加大到 1.5」的字面实现的。
 * 「摊开」的 1.495 是**横向**的同口径预算（见 HERO_SPREAD_TRACK_EM），纵向它只到 1.3。
 */
// 恒等运动：填色的块一律用它，也是池子里 still 那一档（位移 0、缩放 1、字距恒定）。
const HERO_STILL_MOTION = { scaleFrom: 1, scaleTo: 1, xFrom: 0, yFrom: 0, trackFrom: 0, trackTo: 0 };

const HERO_MOTION_POOL = [
    { weight: 4, ...HERO_STILL_MOTION },
    { weight: 2, scaleFrom: 0.93, scaleTo: 1.5, xFrom: -1.5, yFrom: 0 },
    { weight: 2, scaleFrom: 1.5, scaleTo: 0.93, xFrom: 1.5, yFrom: 0 },
    { weight: 2, scaleFrom: 1, scaleTo: 1, xFrom: -2.2, yFrom: 0 },
    { weight: 1, scaleFrom: 1, scaleTo: 1, xFrom: 0, yFrom: -2.6 },
    {
        weight: 2,
        scaleFrom: 1,
        scaleTo: HERO_SPREAD_SCALE_TO,
        xFrom: 0,
        yFrom: 0,
        trackFrom: 0,
        trackTo: HERO_SPREAD_TRACK_EM,
    },
];

// 填色的方向池：水平（左 → 右）/ 竖直（上 → 下），相邻不重复。
const HERO_FILL_AXIS_POOL = ['x', 'y'];

// 池子里的条目只把几何量交给渲染层（权重是抽样用的，不该混进 plan）。
const heroMotionOf = (entry) => ({
    scaleFrom: entry.scaleFrom,
    scaleTo: entry.scaleTo,
    xFrom: entry.xFrom,
    yFrom: entry.yFrom,
    // 字距（em，折算前）。大多数组恒为 0，只有「摊开」那一档真在长。
    trackFrom: entry.trackFrom ?? 0,
    trackTo: entry.trackTo ?? 0,
});

// 按权重抽（掷点按 seed + 块序号，seek / 重建一致）。
const pickHeroMotion = (seed, index) => {
    const total = HERO_MOTION_POOL.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = cineramaHash01(seed, index, 149) * total;
    for (const entry of HERO_MOTION_POOL) {
        roll -= entry.weight;
        if (roll < 0) return heroMotionOf(entry);
    }
    return heroMotionOf(HERO_MOTION_POOL[0]);
};
/*
 * 把一组块级运动的几何量按倍率（面板的 `heroMotion`）缩放：缩放、位移、字距一起缩，
 * 1 = 设计默认、0 = 整首不做持续运动（落定后是死字）。倍率坏值（NaN）当 1 处理——
 * 它是「什么都不改」而不是「全关」，别让一次脏数据把整首的动效静默关掉。
 */
const scaleHeroMotion = (motion, gain) => {
    const gainValue = Number(gain);
    const amount = Number.isFinite(gainValue) ? clamp(gainValue, 0, 1.5) : 1;
    if (amount === 1) return motion;
    const scale = (value) => 1 + (value - 1) * amount;
    return {
        scaleFrom: scale(motion.scaleFrom),
        scaleTo: scale(motion.scaleTo),
        xFrom: motion.xFrom * amount,
        yFrom: motion.yFrom * amount,
        trackFrom: (motion.trackFrom ?? 0) * amount,
        trackTo: (motion.trackTo ?? 0) * amount,
    };
};

// 幅度倍率作用后的硬上限，超过就转成竖排/倒排，不再是斜切胶带。
const RIBBON_ANGLE_LIMIT = 60;
/*
 * 小角（近水平）的界限与名额：|角度| 小于它的那几条读起来是横条而不是斜切，
 * 一叠里小角挤在一起就成了几根平行线——「构图要避免小角聚集」说的是这个。
 * 所以小角最多占 1/3，其余从斜角里出（见 pickRibbonAngles）。
 */
const RIBBON_SHALLOW_ANGLE = 26;
const RIBBON_SHALLOW_RATIO = 1 / 3;
// 贴边溢出时至少留在屏内的厚度（vh）：整条跑到屏外的话量宽与铺份数都白算。
const RIBBON_MIN_VISIBLE_VH = 3;
/*
 * 丝带的厚度区间（vh）。
 *
 * 屏体以前是舞台的 92%×56%，现在铺满整个舞台（见 cineramaStage），所以「屏内的 vh 量」
 * 要按屏高比值 ≈ 1.8 整体放大，否则丝带在更高的屏上会细成一条线。
 *
 * 区间收窄过一次：原先 2.6~5.4，最粗那条是最细那条的两倍多，一叠里粗细差这么大
 * 读出来是「几条不同的东西」而不是同一卷胶带——所以压到 3.4~4.6（最粗/最细 ≈ 1.35）。
 */
const RIBBON_VH_SCALE = 1.8;
const RIBBON_THICKNESS_VH = { min: 3.4 * RIBBON_VH_SCALE, max: 4.6 * RIBBON_VH_SCALE };
/*
 * 字号 = 厚度 × 这个比例（**不再独立抽**）。
 * 两个量各抽各的时候，最坏情况字号比厚度还大——字直接顶到胶带的两条边（甚至被渲染层
 * 的 clamp 裁掉），「文字到丝带边缘的距离」也随厚度忽大忽小。现在是固定比例，
 * 字到上下边各留 (1 − ratio)/2 ≈ 17% 的厚度，每条都一样。
 */
const RIBBON_FONT_RATIO = 0.66;

/*
 * 丝带接力（ribbon relay）的编排参数：相邻两行都是斜切丝带时，交接不走整层溶解，
 * 而是逐条丝带做三件事（窗口时长见 cineramaTransition.resolveCineramaRelayDuration）：
 *   - 一部分丝带**撕走**：沿自身轴向加速滑出屏幕（加速才有「撕」的手感）；
 *   - 一部分**原地留下**：几何与运动完全不动，只把文字换成下一行的（继承丝带）；
 *   - 下一行多出来的**新丝带**从屏外沿自身轴向减速滑入（贴上去的手感）。
 * 「留下」要求下一行的丝带**继承**留下那几条的几何（见 resolveRibbonRelayStrips），
 * 否则交接瞬间位置对不上，读出来是换了一叠而不是换了字。
 */
// 退场方原地留下的比例（其余撕走，下一行补足等量的新带）。
const RIBBON_RELAY_STAY_RATIO = 0.4;
// 撕走的错峰上限（占接力窗口的比例）：整叠不是同时动，才读得出「一条一条撕」。
const RIBBON_RELAY_RIP_DELAY_SPAN = 0.12;
/*
 * 两个半场各自的**子窗口**（占接力窗口的比例），外加贴新的错峰区间。
 *
 * 以前两个半场都从各自的 delay 归一化到**窗口末尾**，于是：退场方要慢慢磨满整段
 * （位移曲线是 p²，速度峰值落在窗口最后一帧——实测 346px/帧，前 1/3 窗口几乎不动），
 * 进入方起手就是峰值（(1-p)² 在 p=0 处速度最大——实测 20500px/s，一帧闪进屏再慢慢磨）。
 * 两段的速度峰值还正好错开：进入方在最前、退场方在最后，中间那一大段是「最挤且最慢」。
 *
 * 现在两个半场各自有完整的起—快—落（见 cineramaRender 的 relayEase），撕走略早于贴新，
 * 于是「先把旧丝带扯干净，再把新丝带贴上去」仍然读得出来。
 *
 * 子窗口长度是**速度预算**：行程 2400~3100px、窗口 0.42s，峰值速度 ≈ 1.5 × 行程 ÷ 子窗口
 * （1.5 是 relayEase 的峰值倍数）。所以子窗口越长越流畅——实测这两档下峰值约 230/256px/帧，
 * 而「两个半场都挤进半段窗口」会到 700px/帧以上（全屏 36%/帧，糊成一道）。
 * 代价是两段重叠更多（屏上条数会短暂从 6 涨到 9），这是刻意的取舍：先保动作读得出来。
 * 两个错峰区间各留 50ms 左右的跨度——那是「一条一条撕 / 一条一条贴」读得出来的下限。
 */
const RIBBON_RELAY_RIP_SPAN = 0.8;
const RIBBON_RELAY_FLY_DELAY_MIN = 0.18;
const RIBBON_RELAY_FLY_DELAY_SPAN = 0.1;
const RIBBON_RELAY_FLY_SPAN = 0.72;

// 确定性 Fisher-Yates：同一 seed 的乱序永远一致（seek/重建不洗牌）。
const shuffleWith = (list, seed, salt) => {
    const out = [...list];
    for (let index = out.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(cineramaHash01(seed, index, salt) * (index + 1));
        [out[index], out[swap]] = [out[swap], out[index]];
    }
    return out;
};

/*
 * 丝带角度的抽取：**正负交替 + 小角限量**，比「洗完牌取前 count 个」多两条约束。
 *
 *   - 正负交替：同号连着取就是一叠同向的平行线，交替才是交叉的拼贴；
 *   - 小角限量：|角度| < RIBBON_SHALLOW_ANGLE 的那几条是构图里最不斜的一档，
 *     一多就聚成几根横条。所以给它一个名额，用完了就跳过该档、继续从同侧找更斜的。
 *
 * 起手侧（先负还是先正）按种子定，seek / 重建拿到的是同一套角度。
 *
 * 接力贴新（resolveRibbonRelayStrips）会传 `excludeAngles`（幅度倍率作用后的值）：
 * 新丝带的角度不能撞上继承丝带的角度——同一拼贴里不出现两条同角的平行带。
 * 比较必须在**倍率作用后**做（倍率可能把两个不同档位挤到同一个钳位 ±60° 上）；
 * 被排除的档不消耗小角名额。`shallowBudget` 允许调用方按「整叠名额 − 继承已占」给。
 */
const pickRibbonAngles = (count, seed, { angleScale = 1, excludeAngles = [], shallowBudget = null } = {}) => {
    const pool = shuffleWith(RIBBON_ANGLE_POOL, seed, 211);
    const isExcluded = (raw) => {
        const scaled = clamp(raw * angleScale, -RIBBON_ANGLE_LIMIT, RIBBON_ANGLE_LIMIT);
        return excludeAngles.some((angle) => Math.abs(angle - scaled) < 0.51);
    };
    const sides = [-1, 1].map((sign) => pool.filter((angle) => Math.sign(angle) === sign));
    const shallowCap = shallowBudget ?? Math.max(1, Math.floor(count * RIBBON_SHALLOW_RATIO));
    const picked = [];
    let shallowUsed = 0;
    let side = cineramaHash01(seed, 0, 281) < 0.5 ? 0 : 1;
    while (picked.length < count) {
        const list = sides[side];
        // 同侧也可能只剩「名额用完的小角」：一路跳过，直到取到一条或该侧取空。
        while (list.length > 0) {
            const angle = list.shift();
            if (isExcluded(angle)) continue;
            const shallow = Math.abs(angle) < RIBBON_SHALLOW_ANGLE;
            if (shallow && shallowUsed >= shallowCap) continue;
            if (shallow) shallowUsed += 1;
            picked.push(angle);
            break;
        }
        side = 1 - side;
        // 两侧都取空（条数 > 档位数）：剩下的由调用方按档位回绕补，这里不再空转。
        if (sides[0].length === 0 && sides[1].length === 0) break;
    }
    return picked;
};

export const CINERAMA_TUNING = {
    // 调试用：非 null 时所有行强制走这一样式，方便逐组校准。
    debugStyle: null,
    /*
     * 屏体铺满整个舞台（见 cineramaStage），所以这里的 vh 就是**屏高的百分比**，
     * 与渲染层 CSS 用的是同一把尺子，两处必须一致（解算层给一个大值、CSS 再截一刀的话，
     * 多出来的部分就是「拖了滑块但画面不动」的假旋钮）。
     *
     * 竖向：单行字号 F vh 占 F*line-height 高度（行高 1.02）。
     * 横向：屏面 100vw 减去两侧留白；满角拉丁字母宽约 0.55em、CJK 与全角标点宽 1.0em，
     * 按字种加权后的「当量宽度」与可用宽度比对即可判断这一块会不会横向出屏。
     * 这是不能在浏览器外测得的量，所以宽字种只能给一个保守的近似宽度
     * （见 estimateChunkWidthEm）。
     *
     * **下面这组数是整档同比标定过的**（大字报嫌大，整体 ×0.8：旧值 64 / 14 / 32 / 92，
     * 也就是「面板原来拖到 0.8 那个尺寸」成了新的默认 1.0）。缩小的必须是**整档**：
     * 渲染层再加一个因子会让「安全字号 × 倍率」这条语义失效（1.0 不再等于装满），
     * 面板备注里那句「>1 就可能出屏」也会跟着写错。
     *
     * 四样**必须同比**：`maxFontVh`（竖向上限）· `usableWidthVw`（横向可用）·
     * `minFontVh`（钳制下界）· `fitFontVh`（「配叫大字报」的切分阈值）。它们是同一组式子
     * 里的四个常数，`min` 与 `clamp` 在这种缩放下半齐次——同比之后每块的安全字号严格
     * 变成 0.8 倍，而「这一块装不装得下」的不等式两边同时缩小，**解集不变**：切成几块、
     * 哪几个词并一块、闪现几次全部照旧，只有字整体小两成。漏掉任何一个，切分都会跟着漂
     * （阈值没缩 = 切得更碎；可用宽度没缩 = 长句不再按宽度收字号）。
     */
    hero: {
        minFontVh: 11.2,
        maxFontVh: 51.2,
        /*
         * 行高：渲染层把它写进 CSS（大字报的块），这里的「让开跑马灯带」也算它——
         * 一行的实际高度是 `字号 × lineHeight`，两边必须同源，否则安全区会算错
         * （见 heroTuningWithinBand）。它是**跟着字号走的比例**，不参与上面的同比缩放。
         */
        lineHeight: 1.02,
        /*
         * 斜体可以有（种子决定），**偏转角度一律不要**：大字报是方正的大字，
         * 整块倾斜一下读起来是排版歪了，不是设计（用户明确要的就是「有斜体、无角」）。
         */
        italicChance: 0.35,
        usableWidthVw: 73.6,
        /*
         * px 下限是**绝对值**（极小窗口别把字压到看不清），跟着审美标定一起缩水没有道理，
         * 所以它是这一组里唯一保留旧值的数（它与新的 minFontVh 在 250px 高的窗口上相遇，
         * 仍是同一个「极小窗口」量级）。
         */
        minFontPx: 28,
        // 「配叫大字报」的字号下限（≈ maxFontVh 的一半）：低于它就多切一块，而不是把字缩到能塞进去。
        fitFontVh: 25.6,
        // 一句最多切几块：再多就失去大字报的份量、每块窗口也太短。
        // 切分后若块数超过它，下面的合并循环会把最窄的相邻块并回来（优先并「仍装得下」的那对），
        // 所以长行不会被拆得零碎——先按词尽量切小保证每块是大字，再并回到这个数以内。
        maxChunks: 5,
        // 一块最多并几个词：常态由 heroChunkChance 决定，这里只管上限，
        // 防止「装得下就一直并」把一段散文并成两块。
        maxWordsPerChunk: 6,
        /*
         * 块级**持续运动**的幅度参考窗口（秒）：一块挂住 `motionRefSec` 这么久时拿满幅度，
         * 更短就按比例收（短闪没有时间"持续"，不该比长句走得还猛）。
         * 运动本身是纯时间的线性行程，不加速度曲线——「持续」要的就是匀速。
         */
        motionRefSec: 1.2,
        /*
         * **蒙版填色**的描边宽度（em，跟着那块字的字号走）。太大就成了"描边字"而不是
         * "还没填色的字"：跟着字号走的 em 比例（例如 0.014em 在满档的大字上报几像素），
         * 够看出轮廓、不抢实色的重量。
         */
        outlineWidthEm: 0.014,
        /*
         * **蒙版填色的触发概率**：按这一块**几个字**拟合，不是一个定值（见 heroFillChance）。
         *
         *   - `from = 1`：**1 个字不用**（0%）。一个字的"扫描"没有过程可言，只会闪一下，
         *     读起来更像故障而不是"填色"。
         *   - 2 个字 **小概率**（smoothstep 在 t=0.25 处给 15.6%，× cap ≈ **2.1%**）：
         *     短块偶尔来一次是点缀，多了就腻。
         *   - `to = 5`：**5 个字及以上到上限** `cap`，再长也不会更高。
         * 中间 3 字 ≈ 6.7%、4 字 ≈ 11.3%；两端正好压在 0 与 cap 上，不会在 1 字 / 5 字处跳变。
         *
         * `cap = 2/15` 是**和运动池配平**出来的数，不是随手取的——口径是
         * 「填色上限 / 放大 / 缩小 / 横移 / 摊开 **五者相等**，纵移是它的**一半**，
         * 静置约是它的**二倍**」。七项加起来正好是 1，于是每份 = 1 / 7.5 = **2/15 ≈ 13.3%**：
         *
         *     填色 2/15 ｜ 放大 2/15 ｜ 缩小 2/15 ｜ 横移 2/15 ｜ 摊开 2/15
         *     ｜ 纵移 1/15 ≈ 6.7% ｜ 静置 4/15 ≈ 26.7%
         *
         * 运动那几项挂在「不填色的块」上按权重抽
         * （`HERO_MOTION_POOL` 2 : 2 : 2 : 1 : 2 : 4，和 13）：
         * 不填色的块里 P(放大) = 2/13，乘上 (1 − cap) = 13/15 正好落回 2/15。
         * 所以它和池子权重是**同一个式子的两个未知数**（`cap = (1 − cap) × 2/13`），
         * 改一个另一个必须跟着改，否则那四条「相等/一半/二倍」立刻不成立。
         */
        fillChance: { from: 1, to: 5, cap: 2 / 15 },
        /*
         * 字距（`letter-spacing`，em）。
         *   - `baseTrackEm` 是**每块都带**的字距，渲染层写进 CSS、解算层拿它估当量宽度；
         *   - `spreadTrackEm` 是「摊开」那一档长到的终点（0 → 它），
         *     `spreadScaleTo` 是同一档的缩放终点。三个数的来历见 `HERO_SPREAD_*`。
         */
        baseTrackEm: HERO_BASE_TRACK_EM,
        spreadScaleTo: HERO_SPREAD_SCALE_TO,
        spreadTrackEm: HERO_SPREAD_TRACK_EM,
    },
    /*
     * 小字报的字号 = `排版轴 fontScale × baseVh`；用户那一侧只剩「文字样式 · 字号」
     * 这一条统一倍率，乘法在渲染层写 CSS 的那一处发生（见 cineramaRender）。
     *
     * 下面是历史的 `smallScale`（v0.8.30 起退回 1，已从面板撤下）：解析层保留该键只为兼容
     * 旧安装的存量数据，乘 1 等于恒等。
     *
     * baseVh 是「屏高的百分比」，所以它就是这个样式的字号本体；
     * **默认从 11 提到 14（+27%）**：11 是屏体还只占舞台 56% 高那个时代的数，
     * 当时按比例放大过一次，但屏面铺满之后小字报在 2.4:1 的墙上整体仍偏小——
     * 它是兜底样式，出镜率不低，读起来却像「没排过版的字幕」。
     * 上限 26vh 只是防 NaN / 极端倍率把整块顶出屏沿；真正的边界在排版轴的
     * `padY` 与容器的 `overflow:hidden`：调过头会被裁，而不是自动缩回去。
     */
    smallType: {
        baseVh: 14,
        minFontVh: 5,
        maxFontVh: 26,
        /*
         * 只兜像素**下限**，不兜上限：极小窗口别把字压到看不清。上限交给解算层的
         * `maxFontVh`（26vh）——vh 是屏高的百分比，跟着窗口缩放，屏体越高它本来就是
         * 等比例的大字，不需要再有一条绝对像素的上界。
         *
         * 以前这里还有一条 `maxFontPx: 236`（= 26vh 在 907px 高屏上的像素值），渲染层写的是
         * `clamp(20px, …vh, 236px)`：vh 与 px 是两把尺子，屏体一高过 907px，px 那条就抢在
         * vh 之前接管，把倍率的顶部吃掉——1440 高的屏上顶端约四分之一行程没反应，
         * 2160 高（4K 全屏）时连默认值都贴在上界，整条滑块完全失效。
         * 「渲染层兜住像素上下限」这条说法对小字报不成立：真正需要 px 的只有下限。
         */
        minFontPx: 20,
    },
    marquee: {
        /*
         * 双带：兜底份数与上限。真实份数由渲染层按**实测带长**补足
         * （见 cineramaRender 的 fillBandText）。
         *
         * 上限只是防跑飞的闸，不是「份数就这么多」：份数要满足
         * `N × 一份 ≥ 盒宽 + 一份`（位移一次就是一份宽，盒右沿之外必须还压着一份），
         * 而一个字一行的极短句在宽屏上一份可能只有屏宽的百分之几——上限卡住的那一刻，
         * 屏上就是「一侧先露白、然后忽然补上字」。原来封在 6，短句在宽屏上远远不够。
         */
        repeatMax: 40,
        repeatMin: 3,
        // 铺满的安全系数：带子两端是循环接缝，宁可多铺一份也不要露边。
        widthSafety: 1.2,
        // 四边环：收紧字距的上限（占字宽的比例）。字身不能叠到一起——
        // CJK 满角字的字身约占字宽的 0.9，收到 0.85 就近乎贴死了。
        tightenRatio: 0.15,
        /*
         * 让开带子时的**余量**（占带厚的比例）：排版本体从「带外沿 + 带厚 × (1 + 这个值)」
         * 才开始排（见 resolveCineramaBandInset）。
         *
         * 为什么不能只让开一个带厚：带上的字自己带一圈**同色辉光**
         * （带宽档的 `bandSkinOf` 那条），带内字身又只占带厚的五成多，
         * 于是「正好贴着带子内沿」的正文会被那圈辉光糊住——字与字看起来踩在一起
         * （「带子里的字压在正文上」）。另外带子自己的边线辉光也会往屏面渗
         * （`wideRatio` 那一层）。0.25 把这两样一起留出去，同时不显空旷。
         *
         * 带上的字影（`TUNING.marquee.text`）比正文弱，所以这条余量实际更该让开的是
         * **边线往屏面渗的那半圈光**。
         */
        safeClearanceRatio: 0.25,
        /*
         * 边线的**辉光**（`marqueeEdge: 'glow'` 那档）：**同心三层**，都压在带沿上。
         *
         *   1. **亮芯**（coreRatio，收得最紧、浓度最高）——这一层是**色轴的载体**。
         *      它不是 1px 硬线（那是 `solid` 档独占的），而是「软边的亮带」：扩散半径只有
         *      带厚的一小截，压在那条边上，读出来是一道**发亮的边**而不是一圈雾。
         *      没有它，光晕只有两成上下的浓度、扩散又宽，而带上的字自己又带一圈同色
         *      text-shadow，「边线色彩」就拖了看不出变化；
         *   2. **中间层**（`midRatio` / `outerRatio`，0.5）——把亮芯与带内的字接上，
         *      不至于中间空一道；
         *   3. **外层**（`wideRatio`，同样 0.5）——更淡、更宽的那一圈，它**越过带沿的那半个
         *      高斯尾巴**就是「光溢到屏面上」那一半。
         *
         * **三层都是 `inset 0 0 <半径>`（偏移恒为 0）**，也就是四边档那条通路：同心阴影以
         * 盒子四条边为对称轴，光天然两侧都渗，于是「往带里」「往屏面」各得一半，
         * 不需要定向的 `outset`、也不可能落错边（定向阴影那三处坑见渲染层
         * bandEdgeDeclarations 的注释）。
         *
         * 比例都是**相对带厚**的：带高本身是旋钮（6~20% 屏高），写死 px 会让细带糊满整条、
         * 粗带只剩一条硬线。而且三层里最大的那个比例也**必须小于 1**：超过一个带厚就不再是
         * 「一道边」，而是漫过整条带子的雾。
         *
         * 半径乘辉光强度（`glow`，缺省 0.3），浓度走 `alphaFloor` 那条曲线
         * （见 `alphaFloor` 的注释）：缺省 0.3 落在 0.68，亮芯所以是一道**看得见颜色**的软亮边；
         * 1 是设计上限（各层满浓度、满扩散），不是常态。
         */
        edge: {
            // 实线档：一道实线的浓度。
            solidAlpha: 38,
            /*
             * 实线档那道 1px 的**最小偏移**（px）。1px 的线不需要偏移来「定边」——
             * `inset 0 0 0 1px` 本来就贴着 padding box 的四条边。给 1px 是为了避开
             * 「偏移恰好为 0 时 inset 阴影画满四周」那条退化：0 会让上下两条长边
             * 同时亮起来（双带最左 / 最右那两条短边也会沾上）。
             */
            solidOffsetPx: 1,
            /*
             * 灯带漂移（`marqueeEdgeDrift`）时，边线那道灯沿带子走的**振幅**（占带厚的百分比）。
             *
             * **只允许压到只能看见「呼吸」的量级，0 是推荐值。**
             *
             * 带宽档的带子纵向只给边线留了带高的 8% 净空，而带内字形盒比这还高——边线本来
             * 就与带内的字**在同一个纵向区间里**。再让它沿带子走，就等于让「边线那道光」
             * 穿过字身，屏上读出来是**两处错开的亮区**：稳定的那条是边线的静态落位，
             * 会跑的那条落在字身上。四边档没有这条通路（环上的字在 SVG 路径上、容器不裁剪、
             * 边线也不跟着走），所以只有双带会出。
             *
             * 压到 0 也**不是**把这一档关掉：`marqueeEdgeDrift` 仍然缩放它，面板上那一轴
             * 照旧有响应，只是缺省不再让边线离开带沿。
             */
            edgeClearanceRatio: 0.08,
            /*
             * 带内**净空**：边线那道灯压在带沿上，字形必须离它上下各留这么多（占带高的比例）。
             *
             * 字形的墨会画到行盒外面（descender、部分字体超出 em 的笔画），所以缺省档就已经
             * 探到净空之外，字号一拖大探得更多——边线那道灯于是与字形落进同一个纵向区间。
             * 渲染层量到超出就按这个净空把带子撑厚（见 cineramaRender 的 bandMinHeightOf）：
             * 0.08 是「贴着带沿不打架」的最小量，再大就开始显出「带子白留一圈」。
             */
            edgeDriftSpan: 0,
            /*
             * 内沿 halo 节点在**横向**上向屏幕外伸出去的比例（占视口宽）。
             *
             * 内沿整套是 `inset 0 0` / `outset 0 0` 的**同心**阴影：它以盒子的**四条边**
             * 为对称轴，所以除了那条落在内沿上的长边，盒子另外三条边（含最左 / 最右两条
             * **短边**）也各会渗出一圈光。节点若写 `left:0; right:0`，那两条短边就正好压在
             * **屏幕左右两侧**——屏上读出来是「左右沿各多出一道光」，而带上的字是循环的、
             * 这一段根本没有端点（见 TUNING 里「两条短边一律不画」）。
             *
             * 修法是把节点在 x 方向上**加长**，让两条短边连同它们的光一起落到屏幕之外
             * （盒子的长边仍在屏内、位置不变，所以内沿那条灯不受影响）。0.5 是「半个视口宽」：
             * 同心阴影的横向扩散最多一个带厚（≤ 20cqh），半个视口宽远远盖得住。
             */
            edgeHaloOverscan: 0.5,
            /*
             * 灯走到两端时的**不透明度下限**。原先是 0.35——走到端点时只剩三成，
             * 与「边线上那道灯」的浓度拉开了距离，看起来像**另一条更暗的线**从边上浮出来。
             * 它只对「振幅不为 0」那几档有意义（振幅为 0 时相位不再参与，见渲染层）。
             */
            edgeDriftFloor: 0.8,
            /*
             * 辉光档的**亮芯**：浓度给到 100%——它是色轴的载体，淡了就等于「换色没反应」。
             * 扩散只取带厚的 0.22：再宽就从「亮边」变成「雾」，而雾读不出颜色。
             * 它要读成一条软边的亮带，半径得跟带内字号一个量级（字高 ≈ 带厚 × 0.55），
             * 0.12 那档在缺省强度下只剩一根读不出颜色的细线。
             */
            coreAlpha: 100,
            coreRatio: 0.22,
            /*
             * 中间层的**浓度**（半径走 `midRatio`）：比亮芯宽、比它淡，
             * 负责把亮芯与带内的字接上。
             */
            innerAlpha: 42,
            /*
             * 往屏面上那一半：**故意越过带沿**——那一层就是「光溢到屏面上」。
             * 再大就变成给正文蒙一层雾：三层在带沿两侧叠起来约 1.4 个带厚，
             * 是能读出「光」又不糊字的上限。
             * 外圈同时用在「双侧」时贴着屏幕边缘那条上。
             *
             * **必须在一个带子以内**（比例 < 1）：同心阴影的外层同时负责「把亮芯与带内的字
             * 接上」和「越过带沿往屏面渗一点」两件事，但它仍然必须读作**一条边**。
             * 半径超过一个带厚就不再是边，而是一层从内沿漫到带子中间的雾。同心之后
             * 「往屏面渗」由外层自己越过带沿的那半个高斯尾巴完成，不需要、也**不允许**
             * 再给一个超过带子的半径。
             */
            wideAlpha: 22,
            wideRatio: 0.5,
            /*
             * 内沿的**中间层**半径（同心的第二层）。
             *
             * 取值与 `outerRatio` 同源（0.5）：两档带型的渐层要靠它才连得上——缺了它，
             * 亮芯（0.22）与外层之间空一截，读出来是「一根窄亮芯 + 一大片极淡」。
             */
            midRatio: 0.5,
            /*
             * 贴着**屏幕边缘**那条边（「边线范围 = 双侧」时才画）的中间层。
             *
             * 它与内沿的 `midRatio` 是同一个位置上的量，只是浓度略浓（42 → 46）：
             * 屏沿那圈有一半落在屏幕之外被裁掉，视觉分量本来就少，同值会觉得偏薄。
             */
            outerRatio: 0.5,
            outerAlpha: 46,
            spillRatio: 0.6,
            /*
             * 辉光强度（`glow`）到「浓度倍率 / 半径倍率」的换算。
             *
             * 半径乘 `strength` 是字面意思（拖大就散得开）；**浓度不能也线性乘它**——
             * 缺省 0.3 时亮芯只剩 30%、光晕只剩 5%~10%，屏上就是一根读不出颜色的灰线。
             * 所以浓度走 `floor + (1 − floor) × strength`：缺省 0.3 落在 0.68，
             * 色轴的载体在缺省档就够浓；拖到 1 仍是各层的满浓度。
             */
            alphaFloor: 0.55,
            /*
             * 亮色主题下辉光读不出来（浅底上彩色发光等于没画），改成**压进屏面的一道暗槽**
             * ——与丝带那条规则同源（见 cineramaRender 的 ribbonSkin：亮主题用投影、
             * 暗主题用外发光）。槽色由「边线色轴压暗到 `darkMix`」合成，**不是中性灰**：
             * 写死 `rgba(0,0,0,α)` 等于把色轴整条丢掉，浅底上换色就毫无反应。
             *
             * 这道槽同时接管「亮芯」的位置（亮底上主看那道深芯），所以 grooveRatio 就是
             * 亮芯的半径。
             */
            grooveAlpha: 52,
            /*
             * 亮色主题下往**屏面**那一半的暗影（辉光是双向的，浅底上也一样）：
             * 比嵌进带里那道宽、比它淡——它落在屏面上，重了会让屏面看起来脏。
             */
            grooveSpillAlpha: 22,
            grooveRatio: 0.4,
            /*
             * 亮色主题下把色轴压暗的比例（与 `#000` 混合）：浅底上要读成「一道有色的深边」，
             * 纯色轴太亮、纯黑又丢了色相。0.45 = 色轴占 45%。
             */
            darkMix: 58,
            /*
             * 填色（淡色底）的浓度：带色相，但压得极低——带子是底纹不是色板。
             * 暗底上淡色更容易被吃掉，所以比亮底给得多一点。
             */
            tintAlphaDark: 12,
            tintAlphaLight: 9,
        },
        /*
         * 带上的字：**比正文更弱的影**。
         *
         * 正文（小字报 / 大字报）靠 `skinOf` 那条 `0 2px 14px rgba(0,0,0,.55), 0 0 30px accent`
         * 保证任何背景上都读得出来，那是**整屏只有一句话**时才成立的做法。
         * 带上的字是循环的一圈小字，字距本来就密，再挂一圈 30px 的同色辉光 + 14px 暗影，
         * 屏上就是「字被自己的光糊成一团」——实录里那条带子的字是**干净的**，
         * 亮来自**带子自己的边线**，不是每个字各带一圈光。所以这一份单独给：
         * 一圈很淡的同色光（`shadowBlur` 相对带内字号的半径）+ 一层很薄的暗投影（`drop*`，
         * 只为了浅色画面上字还有边界）。
         */
        text: {
            /*
             * 同色光的半径按带内**字号**取比例（不是带厚）：字越大，那圈光才跟着放大。
             *
             * **这一层不下落**（渲染层写的是 `0 0 <半径>`）：它四周均摊，一半落在带子里的
             * 屏面上、一半压在内沿上，把字与边线那道灯接起来。一旦给它下落量，往下那一半
             * 就会越过内沿被 `overflow:hidden` 的带盒切在一条**跟着字起伏的折线**上
             * （见渲染层 bandTextShadowOf 的注释）。
             */
            shadowBlur: 0.22,
            shadowAlpha: 55,
            /*
             * 只留一层很薄的暗投影（正文那份 `0 2px 14px rgba(0,0,0,.55)` 是给整屏一句话配的）。
             * 带子会压在「背景类型」定义的真实背景上（播放页 / OBS 源），浅色画面里
             * 彩色字没有这层就没了边界；0.3 的浓度在暗底上又不会把字身压灰。
             *
             * **竖向半径必须为 0**（渲染层写的是 `0 <下落> <模糊>`）：带盒是 `overflow:hidden`，
             * 字影往下那一半越过上带的内沿就会被切在一条**跟着字起伏的硬边**上
             * （汉字下缘是横竖撇捺）。半径给 0 之后它的竖向影响范围就等于下落量本身，
             * 而**下落量是按字号取比例的**（见下面 `baselineDropRatio`），所以带厚 / 字号旋钮
             * 怎么拖，这条余量都跟着同一把尺子走，不会在某一档忽然越过去。
             */
            dropBlur: 6,
            dropAlpha: 0.3,
            /*
             * 暗投影**往下掉多少**（带内字号的倍数，不是 px）。
             *
             * 它是这套观感里唯一「故意越过行盒下缘」的量，所以必须按字号取比例，
             * 不能写死 px：带内字号本身是「带高 × 字高比例」，写死 px 就意味着一组旋钮下
             * 极小或极大的字会配上同一个下落量。
             *
             * 0.03 是「看得出有一点落影、又绝不可能越出带子」的那个数：缺省带厚 12cqh、
             * 字高比例 0.55 → 字号 6.6cqh，下落量 0.2cqh ≈ 1.4px（1280×720 的屏体上）。
             * 带盒内两侧各留了带高的三成七（`(1 − 0.55)/2`），所以这条余量即使再放大
             * 几倍也还在带子里面；不放大是因为行盒要按墨居中，下落量越大约束越紧
             * （见渲染层 bandTextShadowOf 与 alignInner）。
             */
            baselineDropRatio: 0.03,
        },
        /*
         * 带速的**随机档位**：同一首歌里每一屏的带速在这个区间里抽。
         * 抽的是**每秒走几屏**（不是「每秒走几份」，也不是 px/s）——
         * px/s 要乘屏宽才能得到，而屏宽是环境量、不该进随机种子；
         * 「几屏/秒」才是那个跨屏幕尺寸仍然读作「同一种速度」的量。
         */
        speedMin: 0.12,
        speedSpan: 0.12,
        /*
         * 带速旋钮（`marqueeSpeed` = 1）对应的**基准周期**（秒/一份）。
         *
         * 只作两用：
         *   1. 解算层把它当 `marquee.period` 交给渲染层，量不到实测值（节点还没进 DOM、
         *      导出窗口量不出尺寸）时用它——**与这一份有多长无关**，接得上，不跳；
         *   2. 它是「几屏/秒」这条口径的**兜底**：屏宽量不到时至少还有一个恒定周期，
         *      不会因为量不出来就停住或乱冲。
         *
         * 为什么速度不用固定的「份/秒」：位移写的是「一份」的百分比，而一份的长度随文本走
         * （同一块屏上 4 字的短句 266px、48 字符的英文 1452px），于是「一份/秒」在屏上换算
         * 出来的 px/s 差到 6.7 倍。归一之后屏上速度 = 屏宽 × 「几屏/秒」，与文本长度
         * **完全无关**。
         */
        speedSpanSec: 10,
    },
    /*
     * 丝带的厚度与字号是**两个独立的量**：厚度不再由字号撑出来（见 resolveRibbonStrips）。
     * 铺满：兜底重复次数 + 渲染层按实测宽度追加（见 cineramaRender 的 fillRibbon）。
     */
    ribbon: {
        /*
         * 丝带的运动分成**两条互不牵动的线**：
         *   1. 丝带自身只**上下匀速漂移**——一个 plan 内沿固定方向、固定速度滑动，
         *      不再做正弦往复（正弦会让方向来回翻、速度从 0 到峰值变化）；
         *   2. 文字在丝带上**匀速滚动**，位移按像素而不是「内容的百分比」，
         *      所以份数、内容长度都不会影响它。
         * 恒定速度 = driftVelPxPerSec（绝对 px/秒，与歌词时长、逐字歌词都无关），
         * 只被 ribbonDrift 旋钮整体缩放；方向按种子定（上 / 下）。
         */
        driftVelPxPerSec: 4,
        /*
         * 漂移的**兜底**钳位：没有任何一条丝带参与时（空行那一环）用它。
         * 盘面上真正用的钳位由「这块盘面在交接那一刻的几何」算出来
         * （见 resolveRibbonDriftClampPx），它同样是 box 长度下料的「最坏竖向位移」。
         */
        driftClampPx: 70,

        /*
         * 盒长在「刚好盖住屏幕」之上再多留的余量（占覆盖长度的比例）：
         * 恰好等于覆盖长度时，末端那条斜切口正压在屏角上，任何舍入都会露出一点端头。
         */
        coverageMarginRatio: 0.06,
        /*
         * 文字沿丝带轴向的滚动速度（**像素/秒**，相对屏宽的比值），按条做 ±20% 抖动。
         *
         * 滚动是**线性**的，不回绕：位移 = 速度 × (当前时间 − 本行起始)。
         * 以前是「铺 N 份 + 每滚过一份就回绕一次」，回绕要无缝就必须让位移**精确等于
         * 一份的周期**，而周期是量出来的（量宽那一刻字体/布局还在变：字体晚到、
         * 首帧布局未稳、缩放重铺都会让它变）——差半像素就是每隔几秒跳一下。
         * 线性没有接缝：周期只用来算「要铺几份」（内容 ≥ 盒长 + 整行要走的距离），
         * 量差一点无所谓，于是永远不会跳。
         */
        textPxPerSec: 0.16,
        /*
         * 整行要走的距离之外再留的富余（秒）：内容按「盒长 + 整行位移」铺，
         * 行尾（退出淡出那一段）与 seek 到行末时不至于把内容走光、末端走进屏幕。
         */
        travelSlackSec: 2,
        /*
         * **退出尾巴**（秒）：文字的位移预算 = 行窗口 + 这一截。
         *
         * 行窗口结束后丝带并没有立刻下屏：空档里它是 `hold`（全亮挂着，最多
         * TRANSITION_GAP_SEC = 0.6s），紧邻时还要交叉淡出 0.14~0.28s。位移预算只算到
         * 窗口末尾的话，这整段屏上就是**一条停住的丝带**——读起来正是「丝带卡了几帧，
         * 然后下一个场景刷出来」。
         *
         * 它不会把内容走光：铺满本来就留了 travelSlackSec（2s）的富余，
         * 位移另有「内容余量」（usable − boxLength）封顶，末端永远不走进盒子。
         */
        travelTailSec: 1,
        /*
         * 份数上限。长句按 ceil 算出来也就几份，只有「极短的句子 + 极大的画面」
         * 才会顶到这里——宁可多铺几份也不要露出末端（一个文本节点很便宜）。
         */
        repeatMax: 64,
        // 回绕最少要几份：见 cineramaRender.fillRibbonText（1~2 份必然读成跳变或露边）。
        repeatMin: 3,
        /*
         * 漂移上沿的安全余量（占屏高）：丝带竖向漂移会把**自己的斜切口**顶到屏沿附近，
         * 所以它离屏沿还剩这么多的时候就得停。见 resolveRibbonDriftClampPx——
         * 这一条是「丝带的运动不产生任何非匀速段落」的前提。
         */
        driftEdgeMarginVh: 3,
        /*
         * 钳位的上限（占屏高）：它同时是盒长下料的「最坏竖向位移」，
         * 抬得太高只会让盒子白长一截、文字白铺几份，漂移本身也看不出差别。
         */
        driftClampMaxVh: 15,
        /*
         * 文字铺满的**下限倍数**：内容至少要盖住「盒子长度 × 这个数」。
         * 盒长按角度与竖向位移算（见 ribbonBoxLength），这里只给倍数。
         */
        widthSafety: 1.35,
        // 两端的最小溢出（占屏宽 %）：正好贴着屏沿时斜切的两个端头会被看见。
        minOverflowPct: 8,
    },
    /*
     * 「量不到宽度就下一帧再试」的节流参数（渲染层的 `createRelayoutGate` 用）：
     * 前 `firstFrames` 帧每帧试，之后每 `idleEvery` 帧试一次。放进 TUNING 而不是
     * 渲染层的局部常量，与其余几何/时序常量同一处可调。
     */
    relayout: { firstFrames: 30, idleEvery: 30 },
};

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const graphemeCount = (text) => Array.from(text ?? '').length;

/*
 * 「几个字」＝**可见的字**：空白、标点、符号都不算（emoji 之类也排除）。
 * 填色的概率按它拟合，所以「啊，」要按 1 个字算，而不是把那个逗号也算成一个字。
 */
const visibleGraphemeCount = (text) => Array.from(text ?? '')
    .filter((char) => /[\p{L}\p{N}]/u.test(char)).length;

/*
 * 蒙版填色的触发概率——按这一块**几个字**拟合（`TUNING.hero.fillChance` 是它的锚点）：
 *
 *     p(字数) = cap × smoothstep(t),  t = (字数 − from) / (to − from)
 *
 * 用 smoothstep（`t²(3 − 2t)`）而不是线性：线性在 from 处就有斜率，1 个字 0%、2 个字
 * 直接跳到 cap/4，短句那一段抖得厉害；smoothstep 两端的一阶导为 0，所以 1 字稳稳是 0、
 * 到 5 字稳稳收在 cap 上，中间才是渐进的。
 * 曲线取的是「字数」，与块的**字号/宽度无关**：同一句话并成几块都不改这个拟合。
 */
const smoothstep01 = (value) => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
};

export const heroFillChance = (count, tuning = CINERAMA_TUNING.hero, gain = 1) => {
    const { from, to, cap } = tuning.fillChance;
    const scaled = cap * clamp(Number(gain) || 0, 0, 1);
    if (!(to > from)) return count >= to ? scaled : 0;
    return scaled * smoothstep01((count - from) / (to - from));
};

/*
 * 样式对这一行的适用条件。小字报没有条件——它是兜底：任何行都能排版成小字报。
 */
const CINERAMA_STYLE_SUPPORT = {
    // 按词切块逐块闪现：长句只会被切成更多短块，chunking 保证每块都在屏内、不回退别的样式。
    // 所以不设字素上限——再长的行也走大字报，唯一不进池的情况是空行。
    'hero-type': (plan) => {
        const count = graphemeCount(plan.line?.fullText);
        return count >= 1;
    },
    'small-type': () => true,
    /*
     * 只要这一行**有内容**就上丝带：单段也只是一条丝带（仍属斜切丝带），不再回退到
     * 小字报——用户只留斜切丝带这一项权重就该整首都是丝带。
     * 空行（既无原文也无译文）也算「支持」，这样它不会被小字报顶掉；但一条带都排不出来
     * （`ribbonTextsOf` 返回空数组 → strips 为空），渲染层见到空 strips 就整层不画，
     * 屏上是干净的屏体而不是几条空胶带（见 cineramaRender.buildStyleLayer）。
     */
    'ribbon-collage': (plan) => (
        (plan.units?.length ?? 0) >= 1 || !String(plan.line?.fullText ?? '').trim()
    ),
};

export const supportsCineramaStyle = (kind, plan) => Boolean(CINERAMA_STYLE_SUPPORT[kind]?.(plan));

/*
 * 按**权重**抽一个：把权重铺成一条 [0, 总权重) 的线段，掷点落在哪一段就取哪个
 * （命中概率 = 该档权重 ÷ 总权重）。掷点按 seed，所以同一句每次重建结论一致（seek 不洗牌）。
 * 权重是**比例**不是概率：0.4 / 0.2 / 0.4 与 2 / 1 / 2 抽出来是同一套分布。
 */
const drawWeightedKind = (entries, seed, salt) => {
    const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (!(total > 0)) return null;
    let roll = cineramaHash01(seed, 0, salt) * total;
    for (const entry of entries) {
        roll -= entry.weight;
        if (roll < 0) return entry.kind;
    }
    return entries[entries.length - 1].kind;
};

/*
 * 这一句排成哪种样式。
 *
 * 权重来自面板的三个旋钮（大字报 / 小字报 / 斜切丝带，见 cineramaStyleWeights），
 * 只在本行**支持**的样式里归一：不支持的样式不进池，权重再高也不出现
 * （见 CINERAMA_STYLE_SUPPORT——限制本身就是效果的一部分）。
 *
 * 相邻不重复仍然成立：撞上上一行就在**剩下的**那几档里按权重再抽一次，
 * 剩下的几档之间比例不变。
 *
 * 三项权重全为 0（或这一行只支持被关掉的样式）时回落小字报——它是唯一无条件支持的样式，
 * 屏上不会因此出现「这一句没得排」。
 */
export const pickCineramaStyleKind = (plan, previous, weights = null) => {
    const forced = CINERAMA_TUNING.debugStyle;
    if (forced) return forced;
    // 调用方不传（导出窗口、旧宿主、单测）就按缺省权重抽：三条各有一份，画面不会只剩兜底。
    const table = weights ?? cineramaStyleWeights();
    const pool = CINERAMA_STYLE_KINDS
        .filter((kind) => supportsCineramaStyle(kind, plan))
        .map((kind) => ({ kind, weight: clamp(Number(table?.[kind]), 0, 1) || 0 }))
        .filter((entry) => entry.weight > 0);
    if (pool.length === 0) return 'small-type';
    const seed = plan?.seed ?? 0;
    const picked = drawWeightedKind(pool, seed, 349);
    if (picked === null || picked !== previous || pool.length === 1) return picked ?? 'small-type';
    return drawWeightedKind(pool.filter((entry) => entry.kind !== previous), seed, 353) ?? picked;
};

/*
 * 带上的文本来源：当前行原文、译文、原文+译文连排、或歌曲标题。译文只有真的存在时才可能被选中，
 * 否则会抽出一条空带。
 */
const resolveBandText = (plan, source) => {
    const line = plan.line?.fullText?.trim() ?? '';
    const translation = plan.line?.translation?.trim() ?? '';
    if (source === 'title') return plan.title ? String(plan.title).trim() : line;
    if (source === 'translation') return translation || line;
    if (source === 'line+translation') return [line, translation].filter(Boolean).join('　');
    return line;
};

/*
 * 带上的文本来源三选一：当前行原文 / 译文（含「原文+译文」连排）/ 歌曲标题。
 *
 * **歌名是低频项**，由 `marqueeTitleChance` 这个概率系数控制：先按 seed 掷一次
 * （同一句每次结论一致，seek 不洗牌），命中才走歌名，默认 0.25——按 seed 抽但不加权的话
 * 歌名会占掉 1/2~1/4 的句数，整首看下来「歌名一直在跑」，而它是装饰不是歌词。
 * 没命中的在剩下的池子里按 seed 抽（译文不存在时不出池）。
 */
const pickMarqueeSource = (plan, salt, titleChance) => {
    const hasTranslation = Boolean(plan.line?.translation?.trim());
    const roll = cineramaHash01(plan.seed, salt, 71);
    if (roll < clamp(titleChance, 0, 1)) return 'title';
    const pool = ['line'];
    if (hasTranslation) pool.push('translation', 'line+translation');
    return pool[Math.floor(cineramaHash01(plan.seed, salt, 73) * pool.length) % pool.length];
};

/*
 * 跑马灯带的**速度归一**：把「每秒走几份」换算成「秒/一份」。
 *
 * ## 为什么必须归一
 *
 * 位移写的是「一份」的百分比（双带 `translateX(-100/份数 %)`、四边 `startOffset`），
 * 所以带速按「每秒走几份」算就等于把速度钉在内容上——而一份的长度**完全随文本走**：
 * 同一块 1280×720 的屏上，4 个字的短句一份 266px、48 个字符的英文一份 1452px，
 * 按「一份/秒」换算出来的屏上速度差到 **6.7 倍**（实测 45 px/s ↔ 301 px/s），
 * 而且短的那一头恰好更慢。短句慢得像爬、长句快到读不清。
 *
 * ## 归一的口径
 *
 * 速度写成**「每秒走几屏」**（`screensPerSec`）：屏上速度 = 屏宽 × 这个数，
 * 与「这一份有多长」完全无关。周期于是是「走完一份要走多久」=
 * `一份长度 ÷ (屏宽 × 每秒几屏)`——**文本长度只出现在这一处，而它在分子上**，
 * 正好把 `一份/秒` 那一头的内容依赖抵掉。
 *
 * 「每秒几屏」由 seed 抽（见 CINERAMA_TUNING.marquee.speedMin / speedSpan）：
 * 它是**屏级**的艺术决定，不该跟这一行抽到哪句话走。
 *
 * ## 这个量随屏宽走，所以要按屏宽算
 *
 * 屏宽进了分母，所以一条窄屏上的同一句话会比宽屏上滚得慢一点——这是有意的：
 * 「几屏/秒」描述的是**屏上看到的运动**，它必须按屏来算，而不是按像素。
 * 取不到屏宽时回落到解算层给的常量周期（`fallbackPeriodSec`），
 * 而常量周期是**一个周期走完一份**、与内容无关的那条基准，接得上，不跳。
 *
 * @param horizontal 横向整宽带（双带）为真：屏宽直接取 `boxPx`；
 *   四边环为假：`boxPx` 是**绕一圈的周长**，屏宽得由 `viewportWidthPx` 给。
 * @param fallbackPeriodSec 调用方给的兜底周期（解算层按缺省算出来的那一份），
 *   量不到屏宽或一份长度时用它。
 */
export const resolveCineramaBandPeriodSec = ({
    screensPerSec = 0,
    unitPx = 0,
    boxPx = 0,
    horizontal = true,
    viewportWidthPx = 0,
    fallbackPeriodSec = 0,
} = {}) => {
    /*
     * 屏宽：横向带子直接拿盒宽（它就是整屏宽）；四边环不能量成「盒子有多宽」——
     * 环绕一圈，分到每边的长度只是周长的一部分，所以屏宽必须由调用方按字高折算
     * （见 cineramaRender 的 readBandStageWidthPx）。
     */
    const screenWidthPx = horizontal
        ? (boxPx > 0 ? boxPx : viewportWidthPx)
        : viewportWidthPx;
    // 量不到实测值时回落常量周期：那一条与内容无关，正是我们要的基准。
    if (!(screensPerSec > 0) || !(unitPx > 0) || !(screenWidthPx > 0)) return fallbackPeriodSec;
    return unitPx / (screensPerSec * screenWidthPx);
};

/*
 * 跑马灯带是**叠加**：只解算带本身，中间那块字由样式层负责（大字报就闪现、小字报就整行）。
 * 双带 = 上下各一条；四边 = 绕屏一周的**整条环**（不是四条拼起来）。
 * 斜切丝带不与带组合——丝带本来就占满屏。
 *
 * 几何（圆角矩形环 / 上下两条直环、逐字的沿程位置与切线角）全在 cineramaRing.mjs，
 * 这里只给「环上跑什么文本」和绕行方向。
 */
export const resolveCineramaMarquee = (mode, plan, style, options = resolveCineramaOptions()) => {
    if (!mode || mode === 'off') return null;
    if (style === 'ribbon-collage') return null;

    const seed = plan.seed ?? 0;
    const kind = mode === 'auto'
        ? (cineramaHash01(seed, 21, 151) < 0.55 ? 'bands' : 'frame')
        : (mode === 'frame' ? 'marquee-frame' : 'marquee-bands');
    const marqueeKind = kind === 'marquee-frame' || kind === 'frame' ? 'marquee-frame' : 'marquee-bands';

    const source = pickMarqueeSource(
        plan,
        marqueeKind === 'marquee-frame' ? 8 : 7,
        options.marqueeTitleChance,
    );
    /*
     * 文本要等 `resolveBandText` 之后才知道（来源由 seed 抽），而 `period` 是
     * 「这份文本的一份有多长」的函数——所以两个周期都在下面文本定下来之后再解算。
     * 一条带几秒钟的事，先把文本解出来不亏：它同时也是上下两条带「翻不翻字」的判据。
     */
    /*
     * 绕屏一周的方向（seed 决定顺 / 逆）。它只作用在**沿程位移**上（四边是
     * startOffset、双带是 translateX 取号），字的朝向不跟着翻——
     * 翻了就是「逆时针时字全反了」。
     */
    const orbit = cineramaHash01(seed, 9, 83) < 0.5 ? 1 : -1;
    /*
     * 带速：**每秒走几屏**（不是「几份每秒」）。
     *
     * 这个量是**屏级**的艺术决定——同一首歌里每一屏的带速抽一次，与这一行抽到哪句话、
     * 那句话有多长都无关。屏上速度 = 屏宽 × 它，所以归一之后文本长度彻底不进速度
     * （见 resolveCineramaBandPeriodSec）。「慢的那一头恰好是短句」这个偏差一起消失。
     */
    const screensPerSec = CINERAMA_TUNING.marquee.speedMin + cineramaHash01(seed, 10, 89) * CINERAMA_TUNING.marquee.speedSpan;
    /*
     * 带高与带内字号走**唯一入口**（见 cineramaOptions 的 resolveCineramaBandPct）：
     * 两个量都是**整屏属性**，既不跟这一行的字数走（字号以前按「52/字数」算，长句短句
     * 一交替字的尺寸和整条带的宽窄就跳一下），也不跟这一行抽到哪档带型走。
     * 样式层（让开带子的安全区）取的就是同一份数，所以两处不会各钳一次、给出两种读法。
     *
     * 不变式：`marquee.bandPct` 与 `resolveCineramaBandInset(marquee, options)` 里那个厚度
     * **同源**——安全区与屏上真正画出来的带子永远对得上。
     */
    const bandPct = resolveCineramaBandPct(options);
    const bandFontCq = resolveCineramaBandFontCq(options);
    // 双带的兜底份数（四边环的份数由渲染层按实测字宽算，见 buildMarqueeRing）。
    const repeat = clamp(Math.round(26 / Math.max(1, graphemeCount(plan.line?.fullText))), 2, CINERAMA_TUNING.marquee.repeatMax);

    /*
     * 带的**外观**两档，各自独立（面板的 `marqueeFill` / `marqueeEdge`），都不按句抽——
     * 它们是「这一屏的带长什么样」的美术决定，逐句变化会让同一首歌的带忽有忽无：
     *   - `fill`：带身那块区域着不着色（无 / 淡色底）；
     *   - `edge`：区域的内沿怎么画（无 / 实线 / 辉光）；
     *   - `glow`：辉光强度（0~1.5，缩放辉光的浓度与扩散）。
     * 这里再过一遍枚举：调用方可能直接塞 options（旧宿主、命令通道），
     * 未知值一律退回档位的缺省，绝不把未识别的字符串写进 CSS。
     */
    /*
     * 兜底值取自 cineramaOptions 那两份**唯一清单**（枚举 + 缺省），不再各写一遍字面量：
     * 缺省从 'tint' 改成 'none' 那次就是靠这个不会漏——写死在这里的话，
     * 持旧 options 的调用方（结果里没有 `marqueeFill` 键）会停在旧观感上，
     * 与面板上的「默认」按钮复位出来的东西对不上。
     */
    const fill = CINERAMA_MARQUEE_FILL_VALUES.includes(options.marqueeFill)
        ? options.marqueeFill
        : CINERAMA_MARQUEE_FILL_DEFAULT;
    const edge = CINERAMA_MARQUEE_EDGE_VALUES.includes(options.marqueeEdge)
        ? options.marqueeEdge
        : CINERAMA_MARQUEE_EDGE_DEFAULT;
    const glow = Number.isFinite(Number(options.marqueeGlow))
        ? clamp(Number(options.marqueeGlow), 0, 1.5)
        : CINERAMA_MARQUEE_GLOW_DEFAULT;
    /*
     * 带上的**文字辉光**：缩放同色光的半径与浓度（1 = `CINERAMA_TUNING.marquee.text`
     * 那一份弱影的设计基准），**不动**暗投影——暗投影管的是浅色画面上的可读性，不是辉光。
     * 与 `glow` 同一套兜底（非有限值回落缺省、越界钳住）。
     */
    const textGlow = Number.isFinite(Number(options.marqueeTextGlow))
        ? clamp(Number(options.marqueeTextGlow), 0, 2)
        : CINERAMA_MARQUEE_TEXT_GLOW_DEFAULT;
    /*
     * 填色 / 边线各自的**色轴**，以及边线画在**哪几条边**上。
     *   - fillColor：淡色底取强调色还是辅助色；
     *   - edgeColor：边线取强制色轴，还是 auto（按档位配：实线辅助色、辉光强调色）；
     *   - edgeSides：只画朝屏心的那条长边，还是连贴着屏幕边缘的那条一起画。
     * 三个都是**建层时写进 CSS 的字符串**，与 fill / edge 同一套枚举兜底。
     */
    const fillColor = CINERAMA_MARQUEE_FILL_COLOR_VALUES.includes(options.marqueeFillColor)
        ? options.marqueeFillColor
        : 'accent';
    const edgeColor = CINERAMA_MARQUEE_EDGE_COLOR_VALUES.includes(options.marqueeEdgeColor)
        ? options.marqueeEdgeColor
        : 'auto';
    const edgeSides = CINERAMA_MARQUEE_EDGE_SIDES_VALUES.includes(options.marqueeEdgeSides)
        ? options.marqueeEdgeSides
        : 'inner';

    if (marqueeKind === 'marquee-frame') {
        // 四边：一条绕屏一周的闭合环，环上跑一份文本（渲染层按实测步进铺满它）。
        const text = resolveBandText(plan, source);
        return {
            kind: marqueeKind,
            screensPerSec,
            /*
             * 环上跑的是**同一份**文本（绕一圈就是一份），所以只解算一个周期。
             * 解算层这里只能给**兜底值**：一份多长要排完版才知道（渲染层每帧用实测的
             * 一份长度重算）。兜底取 `screensPerSec` 对应的**常量周期**——
             * 与内容无关，量不到实测值时接得上，不会在排版落定的那一帧跳一下。
             */
            period: screensPerSec * CINERAMA_TUNING.marquee.speedSpanSec,
            orbit,
            bandPct,
            bandFontCq,
            fill,
            fillColor,
            edge,
            edgeColor,
            edgeSides,
            glow,
            textGlow,
            text,
        };
    }

    const topText = resolveBandText(plan, source === 'line+translation' ? 'line' : source);
    const bottomText = (source === 'line+translation'
        ? resolveBandText(plan, 'translation')
        : resolveBandText(plan, source === 'title' ? 'title' : 'translation'))
        || topText;
    /*
     * 下带什么时候转 180°：**只在上下两条带跑同一份文本的时候**。
     *
     * 翻转本来是为了「同一条带绕屏一周」的错觉——同一个行程在屏上反向、字读向也反过来，
     * 上下两条接成一个环。文本一旦不同就说不通了：上带原文、下带译文（`pickMarqueeSource`
     * 的 `line` 与 `line+translation` 两个来源）时，译文整条是倒的，读不了。
     * 所以文本不同 ⇒ `rotate: 0`，但**对开那一下要留着**：交给渲染层的 `reverse`
     * 把行程取反（见 `buildMarqueeBands` 的 slot），而不是让两条带同向走。
     */
    const mirror = bottomText === topText;
    return {
        kind: marqueeKind,
        repeat,
        screensPerSec,
        /*
         * 周期（秒/一份）的**兜底值**：一份多长要排完版才知道（渲染层每帧用实测的一份
         * 长度重算，见 resolveCineramaBandPeriodSec）。兜底取 `screensPerSec` 对应的
         * 常量周期——与内容无关，量不到实测值时接得上，不会在排版落定的那一帧跳一下。
         *
         * 上下两条带的文本可以不一样（上原文下译文），但周期只能有一个：
         * 它们在屏上就是**同一条**纹理上的两段，速度不同是一眼看得出来的。
         * 归一之后两条带的屏上速度天然相同（都 = 屏宽 × screensPerSec），不需要再取齐——
         * 这正是「按屏算」相对「按份算」白拿的一条。
         */
        period: screensPerSec * CINERAMA_TUNING.marquee.speedSpanSec,
        periodPct: 100 / clamp(repeat, 1, CINERAMA_TUNING.marquee.repeatMax),
        orbit,
        bandPct,
        bandFontCq,
        fill,
        fillColor,
        edge,
        edgeColor,
        edgeSides,
        glow,
        textGlow,
        // 双带：上下两条整宽字带。同一份文本时下带转 180°（读向相反，凑成绕屏一周）；
        // 文本不同时不翻字，只让行程反向（`reverse`），对开观感照旧。
        bands: [
            { slot: 'top', text: topText, rotate: 0, reverse: false },
            { slot: 'bottom', text: bottomText, rotate: mirror ? 180 : 0, reverse: !mirror },
        ],
    };
};

/*
 * 丝带的几何：旋转之后要盖住多长，以及盒子左右各要溢出多少。
 *
 * **要盖住多长（coverage）**：屏幕矩形在丝带轴向上的投影。按**屏宽**算会在大角度时
 * 漏出末端，这就是「初始化时末端没超出屏幕」的一半原因。
 * 竖向那一段不是屏高，而是「盒心到更远的那个屏沿」的两倍：丝带绕**自己的中心**转，
 * 盒心离屏心越远（贴上下边沿的那几条）差得越多，
 * 投影到轴向上是 2 × max(盒心 y, 屏高 − 盒心 y) × |sin θ|。
 *
 * `centerFrac` 是**盒心**在屏高上的比例（0~1，不是盒子上沿）：top 给的是上沿，
 * 旋转中心还要往下挪半个厚度，漏掉这半个厚度会让贴边那几条短一截。
 *
 * **溢出多少**：`left:-x%; right:-x%` 让盒子宽度 = 屏宽 × (1 + 2x)，取它 ≥ 需要的长度；
 * 另有一个最小溢出——正好等于 coverage 时两端恰好压在屏沿上，斜切的两个端头会被看见。
 *
 * 放在解算层而不是渲染层：它是纯几何，可以单测；渲染层只负责把结果写进 CSS。
 */
export const ribbonCoverageWidth = (width, height, angleDeg, centerFrac = 0.5) => {
    const rad = (Math.abs(angleDeg) * Math.PI) / 180;
    const cos = Math.abs(Math.cos(rad));
    const sin = Math.abs(Math.sin(rad));
    const center = clamp(centerFrac, 0, 1);
    const halfSpan = Math.max(center, 1 - center) * height;
    return width * cos + 2 * halfSpan * sin;
};

/*
 * 盒子实际要的长度 = 覆盖长度 + 余量 + **竖向位移在轴向上的分量**。
 *
 * 漂移是**屏幕竖向**平移（`translate3d(0, d, 0)` 写在 rotate 之前），
 * 而盒子是绕自己的中心转的：盒子竖着挪 d，旋转中心跟着走，屏幕在轴向上的区间
 * 相对盒心就整体偏了 d × |sin θ|。只按「静止时刚好盖住」下料的话，位移到极值时
 * 那一端就缩进屏幕里。所以两端各补一份：2 × |d| × |sin θ|。
 */
export const ribbonBoxLength = (width, height, angleDeg, centerFrac, verticalShiftPx = 0) => {
    const rad = (Math.abs(angleDeg) * Math.PI) / 180;
    const coverage = ribbonCoverageWidth(width, height, angleDeg, centerFrac);
    return coverage * (1 + CINERAMA_TUNING.ribbon.coverageMarginRatio)
        + 2 * Math.abs(verticalShiftPx) * Math.abs(Math.sin(rad));
};

export const ribbonOverflowPct = (coverage, width) => {
    if (!(width > 0)) return CINERAMA_TUNING.ribbon.minOverflowPct;
    return Math.max(CINERAMA_TUNING.ribbon.minOverflowPct, ((coverage / width - 1) / 2) * 100);
};

/*
 * 沿丝带**自身轴向**完全滑出屏幕所需的距离（px），`dir` 是滑走的方向（本地 ±x）。
 *
 * 用分离轴判定：丝带盒子与屏体都是凸的，只要两者在**丝带自身轴**上的投影不重叠，
 * 这条轴就是分离轴，两个图形一定不相交。所以按这条轴解出「投影刚好错开」需要的位移
 * 即可——它是**充分**条件，不是近似。
 *
 * 为什么必须精确：接力里丝带要滑 2500~3500px（≈1.5~2 个屏宽），而窗口只有 0.42s，
 * 行程每多一分，速度就多一分、越读不出来。以前这里是 `盒长 + 0.35 × 屏宽`
 * ——与方向无关、也不看丝带在屏上的位置与角度，实测比真正需要的多 30~50%：
 * 多出来的那一段全落在屏外，肉眼看就是「丝带在屏外空跑一段才进场 / 出画面前还在
 * 屏里磨」，接力于是显得又慢又糊。方向分开算之后，同一条丝带撕走与贴新的行程也可以不同。
 */
export const ribbonExitDistance = (width, height, angleDeg, centerFrac, boxLength, dir = 1) => {
    if (!(width > 0) || !(height > 0) || !(boxLength > 0)) return 0;
    const rad = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // 盒心在屏上的位置：横向居中（盒子的 left/right 溢出对称），纵向按 centerFrac。
    const axisCenter = (width / 2) * cos + clamp(centerFrac, 0, 1) * height * sin;
    // 屏体四角在丝带轴上的投影区间。
    const corners = [0, width * cos, height * sin, width * cos + height * sin];
    const low = Math.min(...corners);
    const high = Math.max(...corners);
    return dir >= 0
        ? high + boxLength / 2 - axisCenter
        : axisCenter - low + boxLength / 2;
};

/*
 * 一个字的**当量宽度**（单位 em）。真实的字宽要量了字体才知道，而解算层跑在
 * 浏览器之外，所以只能按字种给保守近似：CJK 与全角标点按满角 1.0、拉丁小写按 0.55、
 * 大写与数字按 0.62、窄符号按 0.4。估宽了就会出屏、估窄了只是字略小——宁可估宽。
 */
const estimateCharWidthEm = (char) => {
    if (/[\u3000-\u9fff\uff00-\uffef\u3040-\u30ff]/.test(char)) return 1;
    if (/[A-Z0-9]/.test(char)) return 0.62;
    if (/[a-z]/.test(char)) return 0.55;
    if (/\s/.test(char)) return 0.28;
    return 0.4;
};

// 一块字的当量宽度（em），含每块都带的那份字距（`HERO_BASE_TRACK_EM`/字）。
const estimateChunkWidthEm = (text) => Array.from(text ?? '').reduce(
    (sum, char) => sum + estimateCharWidthEm(char) + HERO_BASE_TRACK_EM,
    0,
);

/*
 * 跑马灯带占着屏沿，排版本体不许压上去（「文字和带子重叠」）。
 *
 * 带的厚度到处都用**屏高的百分比**表示（`bandPct`，CSS 里也是 cqh / height%），所以：
 *   - 双带：上下各一条 `bandPct%` 厚，左右不占；
 *   - 四边：一条绕屏一周的环，**四条边都是 `bandPct%` 厚**——左右那两道折成**屏宽**的
 *     百分比是 `bandPct / aspect`（`1vw = aspect × 1vh`，见 heroRawFontVhForChunk）。
 *
 * **让开量取的是旋钮本身，不跟这一行抽到的带型走**（`resolveCineramaBandPct(options)`，不是
 * `marquee.bandPct`）。这不是等价改写：带型在 auto 档**按句抽**（双带 / 四边交替），
 * 让开量若跟着抽中的带型走，同一组旋钮就会在两句之间给出两个不同的安全区——小字报整块按
 * 内边距落位、大字报按可用框收字号，上屏就是「换句时带子的形状与位置变了一下」。
 * 让开量是**屏级的环境量**：带子只要存在，屏沿那一条就一直被占着；带型只决定
 * 「这一屏是两条带还是绕屏一周」，而两条带与环的厚度本来就是同一个 `bandPct`。
 *
 * 返回的四个值都是「屏高 / 屏宽的比例」，可以直接当 padding 用（渲染层就是这么用的）。
 * 没有带（斜切丝带不与带组合，或面板把带关掉）时全是 0，一切照旧。
 */
export const resolveCineramaBandInset = (marquee, options) => {
    const none = { top: 0, bottom: 0, left: 0, right: 0 };
    if (!marquee) return none;
    /*
     * 让开的是「带厚 × (1 + 余量)」，不是刚好一个带厚：带上的字自己带一圈同色辉光，
     * 贴着内沿排的正文会被它糊住（见 TUNING.marquee.safeClearanceRatio）。
     */
    const pct = (resolveCineramaBandPct(options) / 100) * (1 + CINERAMA_TUNING.marquee.safeClearanceRatio);
    if (marquee.kind !== 'marquee-frame') return { ...none, top: pct, bottom: pct };
    const aspect = Number.isFinite(options?.viewportAspect) && options.viewportAspect > 0.2
        ? options.viewportAspect
        : 16 / 9;
    const side = pct / aspect;
    return { top: pct, bottom: pct, left: side, right: side };
};

/*
 * 大字报是**居中**排的（块自己 `inset:0` + flex 居中），所以「让开带子」不是加 padding，
 * 而是把可用框收窄：
 *   - 竖向：`(100 − 上下带厚) ÷ 行高`——一行的高度是「字号 × 行高」；
 *   - 横向：`usableWidthVw − 左右带厚`（只有四边的环会占左右）。
 * 它同时收窄「能并多大块」的判断和最终字号，所以一次出的词既不出屏、也不压到带上。
 */
const heroTuningWithinBand = (inset) => {
    const tuning = CINERAMA_TUNING.hero;
    const vertical = (100 - (inset.top + inset.bottom) * 100) / tuning.lineHeight;
    const horizontal = tuning.usableWidthVw - (inset.left + inset.right) * 100;
    return {
        ...tuning,
        maxFontVh: Math.max(tuning.minFontVh, Math.min(tuning.maxFontVh, vertical)),
        // 兜底下限只是防「极窄画面 + 极厚环」把可用宽度算成负数。
        usableWidthVw: Math.max(20, horizontal),
    };
};

/*
 * 一块字在**屏体里**能用的最大字号（vh）。
 * 竖向：屏体铺满舞台，行高 1.02，按 maxFontVh 减去上下留给跑马灯带的余量；
 * 横向：`usableWidthVw` 再减去跑马灯带占掉的左右两条（见 heroTuningWithinBand），
 * 把 vw 折算回 vh 需要画面宽高比——渲染层把真实宽高比写进 options（缺省 16:9）。
 * 两个方向取小者，所以一次出的词**永远在屏幕内**：这是大字报唯一的硬约束。
 */
const heroFontVhForChunk = (text, aspect, tuning) => (
    // minFontVh 是「还看得清」的下限：它会把字号**抬回去**，所以只有最终上屏时才能
    // 抬；判断「这块能不能再并」必须用没抬过的那个值（见 heroRawFontVhForChunk）。
    clamp(heroRawFontVhForChunk(text, aspect, tuning), tuning.minFontVh, tuning.maxFontVh)
);

/*
 * 不带 minFontVh 兜底的安全字号。被 minFontVh 抬过的块，字号比「不出屏」的上限还大，
 * 于是真的会出屏——出屏比字小严重得多，所以「能不能并」按这个值判。
 */
const heroRawFontVhForChunk = (text, aspect, tuning) => {
    const vertical = tuning.maxFontVh;
    const widthEm = Math.max(0.4, estimateChunkWidthEm(text));
    /*
     * 1vw = aspect vh（1vw = W/100 px、1vh = H/100 px，比值就是 W/H），
     * 所以「可用宽度」= `usableWidthVw` × aspect vh，再除以这块字的当量宽度即得字号上限。
     */
    const horizontal = (tuning.usableWidthVw * aspect) / widthEm;
    return Math.min(vertical, horizontal);
};

/*
 * 大字报的**分词**：按词而不是按固定字数切。
 *
 * 与凝彩同一口径（src/utils/lyrics/wordSegmentation.ts）：Intl.Segmenter(word)，
 * 用户存过的 line.wordSegments 优先；空白折进前一个词、标点粘在前一个词上，
 * 所以「，」不会自己占一次闪现。固定字数是行不通的——「摊开」被切成「摊」「开」，
 * 既破了词又让一次出的词变了味。
 *
 * 并块则是一个**概率因数**（heroChunkChance），不是「一次几个词」的定值——凝彩的 shot
 * 同样是按种子抽 2~4 词收块的，定长并块会让每块一样长，读下来是打点而不是说话：
 *   1. 从 1 个词起，每收进一个词就按概率再并下一个（掷点按 seed + 块序号，seek 稳定）；
 *   2. 并的前提是**装得下**：并进来的字号会掉到 threshold 以下就不并了；
 *   3. 一个词本身就装不下时（超长词汇）按字硬切，切到装得下为止；
 *   4. 块数超过上限时从最窄处合并，保证一次出的词仍然读得出来。
 * 每块平分本行窗口——一句长歌词于是变成几次大字报式闪现，而不是缩成小字塞进屏体。
 */
const packHeroChunks = (words, maxPerChunk, chance, fit, seed) => {
    const chunks = [];
    let cursor = 0;
    let chunkIndex = 0;
    while (cursor < words.length) {
        let take = 1;
        while (
            take < maxPerChunk
            && cursor + take < words.length
            && fit(words.slice(cursor, cursor + take + 1).join(''))
            // 同一句、同一块的续接掷点固定：seek 与重建拿到的是同一套块。
            && cineramaHash01(seed, chunkIndex, 300 + take) < chance
        ) {
            take += 1;
        }
        // 词尾空白先留着：块数封顶时还要把相邻两块拼起来，这里就 trim 掉的话
        // 「we 」+「read 」会并成 "weread"——空格是词与词之间唯一的分隔，最后统一裁。
        chunks.push(words.slice(cursor, cursor + take).join(''));
        cursor += take;
        chunkIndex += 1;
    }
    return chunks;
};

// 一个词太长时按字硬切：切成若干「装得下」的片段（不破 grapheme）。
const splitLongWord = (word, fit) => {
    const chars = Array.from(word);
    const pieces = [];
    let current = '';
    chars.forEach((char) => {
        const next = current + char;
        if (current && !fit(next)) {
            pieces.push(current);
            current = char;
            return;
        }
        current = next;
    });
    if (current) pieces.push(current);
    return pieces;
};

/*
 * `tuning` 传的是**让开跑马灯带之后**的那一份（见 heroTuningWithinBand）：
 * 能并多大块与最终字号必须用同一个可用框，否则「装得下」的判断会和实际字号对不上。
 */
const buildHeroChunks = (plan, options, tuning = CINERAMA_TUNING.hero) => {
    // 画面宽高比由渲染层写入 options（真实屏体尺寸），缺席时按 16:9 兜底。
    const aspect = Number.isFinite(options.viewportAspect) && options.viewportAspect > 0.2
        ? options.viewportAspect
        : 16 / 9;
    /*
     * 「装不下」的判据：字号会跌到 threshold 以下。
     * 不能用 minFontVh 当阈值——那是「还看得清」的下限（现在 11.2vh），拿它当判据的话
     * 整行都能塞进一屏，大字报就变成了「整行小字」；fitFontVh 是「配叫大字报」
     * 的下限（≈ maxFontVh 的一半），一次出的词才始终是**大字**。
     *
     * 字号旋钮**曾经**乘在阈值上（`heroScale`）：「要求每块至少这么大 → 装不下就多切一块」，
     * 倍率因此成为「字更大 / 闪现次数更多」的取舍，任何倍率下每块都还在屏内。那个旋钮已经
     * 从面板撤下、解析层恒为 1（见 cineramaOptions 的 DEFAULTS），所以 threshold 恒等于
     * `fitFontVh` 本身。**面板那条「文字样式 · 字号」不再走这条路**——它只在渲染层乘最终
     * 字号一次（见 cineramaRender 的 buildHero），> 1 会溢出且这是刻意的。
     * 保留这个乘式只为兼容旧安装的存量数据，它不是第二条乘法链。
     */
    // 阈值上的倍率：历史旋钮 `heroScale`（v0.8.30 起恒为 1，见 cineramaOptions 的 DEFAULTS）。
    const threshold = tuning.fitFontVh * clamp(options.heroScale, 0.6, 1.4);
    const fit = (text) => heroFontVhForChunk(text, aspect, tuning) >= threshold;

    const words = segmentCineramaWords(plan.line).flatMap((word) => (
        fit(word) ? [word] : splitLongWord(word, fit)
    ));
    if (words.length === 0) words.push((plan.line?.fullText ?? '').trim() || '　');

    /*
     * 并块的两条边界：概率决定常态（0 = 每个词闪一次、1 = 装得下就并到底，
     * 中间值则块长自然浮动），maxWordsPerChunk 只管住「一段散文被并成两块」这种极端。
     */
    const chance = clamp(options.heroChunkChance, 0, 1);
    let packed = packHeroChunks(words, tuning.maxWordsPerChunk, chance, fit, plan.seed);

    /*
     * 块数封顶：一句被切成十几次闪现就失去了「大字报」的份量（而且每块窗口太短）。
     * 超了就从**最窄的一对**开始合并——合并最窄的两块，掉的字号最少。
     * 优先合「并完仍然装得下」的那一对；一对都装不下时（长句 + 高阈值）也要并——
     * 块数封顶比「每块都得配叫大字」更重要，字小一档但**不会出屏**
     * （字号最终按所有块里最苛刻的那份算，见 resolveCineramaStyle）。
     * 唯一不能越过的是 minFontVh：并到字号会被它抬回去（= 会出屏）的那对不并。
     */
    const maxChunks = CINERAMA_TUNING.hero.maxChunks;
    while (packed.length > maxChunks) {
        let bestIndex = -1;
        let bestWidth = Number.POSITIVE_INFINITY;
        let narrowIndex = -1;
        let narrowWidth = Number.POSITIVE_INFINITY;
        for (let index = 0; index < packed.length - 1; index += 1) {
            const merged = packed[index] + packed[index + 1];
            const width = estimateChunkWidthEm(merged);
            if (width < narrowWidth && heroRawFontVhForChunk(merged, aspect, tuning) >= tuning.minFontVh) {
                narrowWidth = width;
                narrowIndex = index;
            }
            if (!fit(merged)) continue;
            if (width < bestWidth) {
                bestWidth = width;
                bestIndex = index;
            }
        }
        const mergeIndex = bestIndex >= 0 ? bestIndex : narrowIndex;
        // 只剩一块（合不了）：保持现状退出，避免死循环。
        if (mergeIndex < 0) break;
        packed = [
            ...packed.slice(0, mergeIndex),
            packed[mergeIndex] + packed[mergeIndex + 1],
            ...packed.slice(mergeIndex + 2),
        ];
    }

    // 末尾的空白不显示却占宽度，居中时会把字往一边推——并块结束后统一裁掉。
    packed = packed.map((text) => text.trimEnd());

    /*
     * 逐块闪现的落点**跟着这一块自己的词**走（每块覆盖的那些字素），不是把歌词窗口均分。
     *
     * 均分只在词距均匀时才对。一句里几个词抢在前面唱完、后半句停一拍再接上，均分出来的块
     * 就跟它对不上——早的那几块字已经换成下一句了、晚的那几块还没轮到自己唱，读起来正是
     * 「时间戳正常，大字报出字明显滞后」。units 早就是按词对位的（见 buildCineramaUnits），
     * 大字报这条一直是用「歌词窗口 ÷ 块数」摊的。
     *
     * **唯一的退路是「API 根本没给出可用的词级顺序」**：块的起点没能严格递进——整行的词
     * 共用同一个时刻、或者时刻全被钳到窗口边缘。那种数据下几块会挤在同一瞬间，而渲染层是按
     * `[start, end]` 判可见的：零长窗口＝这一行只会闪出最后一块，其余的字永远不出现。
     * 这时按**宿主自己的口径**摊开（没有词时序时 `buildLineGraphemeTimeline` 也是把整行摊平，
     * 见 `src/utils/lyrics/graphemeTiming.ts`），摊的是歌词窗口。**对位本身不会退回**——
     * 字符对不上只按顺序继续（见 `resolveCineramaSegmentSpans`）。
     */
    const reveal = resolveCineramaRevealWindow(plan.line, plan.window);
    const spans = resolveCineramaSegmentSpans(packed, plan.line, plan.window);
    const ordered = spans !== null && spans.every(
        (span, index) => index === 0 || span.startTime > spans[index - 1].startTime + 1e-4,
    );
    if (ordered) {
        const starts = spans.map((span) => clamp(span.startTime, reveal.startTime, reveal.endTime));
        return packed.map((text, index) => ({
            text,
            startTime: starts[index],
            /*
             * 下一块的起点就是本块的终点：词与词之间的停顿由前一拍**驻留**顶着，
             * 块与块之间不留空屏；最后一块顶到歌词收尾。`+0.001` 只是保证窗口非零。
             */
            endTime: Math.max(
                starts[index] + 0.001,
                index + 1 < packed.length ? starts[index + 1] : reveal.endTime,
            ),
        }));
    }
    const span = Math.max(0.001, reveal.endTime - reveal.startTime) / packed.length;
    return packed.map((text, index) => ({
        text,
        startTime: reveal.startTime + span * index,
        // 每块留一点驻留时间，最后一块顶到歌词收尾，避免块与块之间出现空屏。
        endTime: reveal.startTime + span * (index + 1),
    }));
};

/*
 * 丝带的文本：**不分词**，一条丝带就是一句完整的话（原文或译文）。
 * 以前按 units 取文本，units 是切分层切出来的片段（word / clause / half…），
 * 于是一条丝带上会出现半句话——「斜切丝带不需要分词」就是这个意思。
 *
 * 原文与译文**不在同一条丝带**：两条语言各有自己的丝带（有译文时交替取），
 * 否则一条带上中英混排，读起来是两句话绞在一起。
 */
export const ribbonTextsOf = (plan) => {
    const line = (plan.line?.fullText ?? '').trim();
    const translation = (plan.line?.translation ?? '').trim();
    const pool = [];
    if (line) pool.push(line);
    if (translation) pool.push(translation);
    /*
     * 一句词都没有（空行）就返回**空数组**，不再兜一个全角空格：
     * 渲染层见到空数组就整层不画（见 cineramaRender.buildStyleLayer），
     * 屏上因此不会出现几条空白胶带。以前兜的那个空格正是「空行也能上带」的代价。
     */
    return pool;
};

/*
 * 丝带落点的铺排：先均铺再整体乱序 + 大抖动，去掉「从上到下排成一列」的机械感。
 * 均铺区间从 8~86 放宽到 -6~98：**允许贴边溢出**——贴到上下屏沿的那几条会被屏
 * 裁掉一段，拼贴才铺得满；全都留在屏内的话四角是空的，读出来是几条悬浮的带子。
 * 抖动也从 ±8 放到 ±10。真正的「至少留多少在屏内」在 buildRibbonStrip 按各自的厚度再钳一次。
 */
const spreadRibbonTops = (count, seed) => shuffleWith(
    Array.from({ length: count }, (_, index) => -6 + (104 * index) / Math.max(1, count - 1)),
    seed,
    223,
).map((top, index) => top + (cineramaHash01(seed, index, 227) - 0.5) * 20);

/*
 * 单条丝带的解算：角度与原始落点由调用方给（普通整叠抽取 / 接力继承各不相同），
 * 厚度、漂移、明暗都按 (seed, index) 抽——同一行每次重建一致。
 */
const buildRibbonStrip = (plan, seed, index, angleDeg, topRaw, text) => {
    const thicknessVh = RIBBON_THICKNESS_VH.min
        + cineramaHash01(seed, index, 241) * (RIBBON_THICKNESS_VH.max - RIBBON_THICKNESS_VH.min);
    /*
     * 贴边溢出：top 可以是负的（带上沿在屏外），但**至少留 RIBBON_MIN_VISIBLE_VH 在屏内**——
     * 整条跑到屏外的话量宽与铺份数都白算，屏上也平白少一条。
     * 下限按各自的厚度算（−(厚度 − 最小可见量)）：厚的那条可以多溢出一点，
     * 于是各条的「贴边程度」一致，而不是厚带贴得更狠。
     */
    const topPct = clamp(
        topRaw,
        -(thicknessVh - RIBBON_MIN_VISIBLE_VH),
        100 - RIBBON_MIN_VISIBLE_VH,
    );
    return {
        unitIndex: index % Math.max(1, plan.units.length),
        text,
        angleDeg,
        /*
         * 上下慢速往复漂移：正弦而不是「单向跑到被钳住」——单向的话
         * 所有丝带最终都贴在钳位上，静止不动还挤在一起。
         * 相邻两条相位错开半个周期（按 index 奇偶），一叠丝带才不会同步起伏。
         */
        // 恒定方向（上 / 下，种子定）+ 恒定速度（按条 ±20% 抖动，但都是不随时间变的常量）。
        driftDir: cineramaHash01(seed, index, 271) < 0.5 ? 1 : -1,
        driftVelScale: 0.8 + cineramaHash01(seed, index, 277) * 0.4,
        topPct,
        /*
         * 厚度不再由字号撑出来（以前是文字的 padding，字号一大整条就跟着变粗），
         * 字号反过来是厚度的**固定比例**：字到胶带上下边各留
         * (1 − RIBBON_FONT_RATIO)/2 的厚度，每条都一样，粗细变了也不贴边。
         */
        fontVh: thicknessVh * RIBBON_FONT_RATIO,
        thicknessVh,
        /*
         * 沿胶带轴向的明暗过渡：一条丝带自己就有稍亮的一段和稍暗的一段，
         * 这是它自身的质感，不是「靠前的亮、后面的暗」那种层间关系。
         * 位置/跨度按种子抽（同一句每次重建一致），跨度过小读不出过渡。
         */
        shadeAngle: 100 + cineramaHash01(seed, index, 251) * 160,
        shadeStart: cineramaHash01(seed, index, 257) * 20,
        shadeSpan: 46 + cineramaHash01(seed, index, 263) * 26,
        shadeStrength: 0.2 + cineramaHash01(seed, index, 269) * 0.22,
        /*
         * 重复次数只作为**兜底**：真实铺满所需的次数由渲染层量出节点宽度后追加。
         * 一条带现在是一整句（不再按 unit 切），所以按字数估的份数会偏大，
         * 但渲染层以实测宽度为准，这里给一个偏保守的起点即可。
         */
        repeat: clamp(Math.round(30 / Math.max(1, graphemeCount(text))), 1, 3),
    };
};

const resolveRibbonStrips = (plan, seed, options) => {
    const count = clamp(options.ribbonCount, 3, 9);
    // 角度从一组离散档位里**不重复**抽取：实录里每条胶带的角度都明显不同，
    // 等差或小抖动的近角会读成栅格而不是拼贴。
    // 档位再乘 `ribbonAngle` 幅度倍率：倍率不改变「档位互不相同」这个性质（同一乘数单调），
    // 但会同比放大/收紧整体倾角。倍率上限 1.4 × 最大档 52° = 72.8°，
    // 所以这里钳到 ±60°——再大就转成竖排甚至倒排，不再是「斜切胶带」。
    const angleScale = clamp(options.ribbonAngle, 0.4, 1.4);
    // 角度由 pickRibbonAngles 抽（正负交替 + 小角限量），不是「洗完牌取前 count 个」。
    const angles = pickRibbonAngles(count, seed, { angleScale })
        .map((angle) => clamp(angle * angleScale, -RIBBON_ANGLE_LIMIT, RIBBON_ANGLE_LIMIT));
    const tops = spreadRibbonTops(count, seed);
    const texts = ribbonTextsOf(plan);
    // 空行（没有原文也没有译文）一条带都排不出来——直接给空数组，
    // 渲染层见到它就整层不画（见 cineramaRender.buildStyleLayer）。
    if (texts.length === 0) return [];
    const strips = [];
    for (let index = 0; index < count; index += 1) {
        // 有译文时原文/译文交替上带，绝不混在同一条里。
        const text = texts[index % texts.length];
        if (!text) continue;
        strips.push(buildRibbonStrip(plan, seed, index, angles[index % angles.length], tops[index], text));
    }
    return strips;
};

/*
 * ———————— 丝带接力（ribbon relay）————————
 * 相邻两行都是斜切丝带时的专用交接（窗口与设计前提见 cineramaTransition）。
 * 全部是纯解算：退出方与进入方各取一半，靠**同一个**接力种子对得上。
 */

// 接力种子只由两行的行种子决定：两侧的划分、继承、贴新都从它派生，seek 不洗牌。
export const ribbonRelaySeed = (prevPlan, plan) => hashCineramaSeed(
    `${prevPlan?.seed ?? 0}|${plan?.seed ?? 0}|ribbon-relay`,
);

/*
 * 「谁原地留下」的划分：按接力种子洗牌取前 stayCount 个。stayCount 钳在
 * 1 ~ count−1，两侧都非空——只撕不剩或只剩不撕都不成「接力」。
 */
const ribbonRelayStayFlags = (count, relaySeed) => {
    // 一条都没有（空行那一环）就直接返回：下面的 clamp 会把 stayCount 抬到 1，
    // 于是往一个空数组上写 `flags[undefined]`——不崩，但纯属脏副作用。
    if (!(count > 0)) return [];
    const stayCount = clamp(Math.round(count * RIBBON_RELAY_STAY_RATIO), 1, Math.max(1, count - 1));
    const order = shuffleWith(Array.from({ length: count }, (_, index) => index), relaySeed, 307);
    const flags = Array.from({ length: count }, () => false);
    for (let index = 0; index < stayCount; index += 1) flags[order[index]] = true;
    return flags;
};

/*
 * 退场方（上一行）：把「谁撕走、谁原地留下」标到丝带上。
 * 退出方与进入方各自解算上一行的丝带，用同一个种子就得到同一个划分——
 * 进入方继承的正是退出方「留下」的那几条，位置才能严格对上。
 */
export const markRibbonRelayExitStrips = (strips, relaySeed) => {
    const stayFlags = ribbonRelayStayFlags(strips.length, relaySeed);
    return strips.map((strip, index) => ({
        ...strip,
        relayOut: stayFlags[index] ? 'stay' : 'leave',
        // 撕的方向沿丝带自身轴向（本地 ±x），按条抽；错峰让整叠不是同时动。
        ripDir: cineramaHash01(relaySeed, index, 311) < 0.5 ? 1 : -1,
        ripDelay: cineramaHash01(relaySeed, index, 313) * RIBBON_RELAY_RIP_DELAY_SPAN,
        /*
         * 撕走的子窗口长度随丝带一起落到数据上（渲染层只读，不再自己归一化）：
         * 它决定这条丝带多久走完，也决定「旧丝带先腾干净」这条时序。
         */
        ripSpan: RIBBON_RELAY_RIP_SPAN,
    }));
};

/*
 * 整叠丝带的**漂移钳位**：一条盘面上所有丝带共用的那个漂移上限（px）。
 *
 * 以前这是 TUNING 的一个常量（70px），钳位按「到达之后硬停」生效——丝带匀速漂了很久，
 * 会在某一帧突然定死。屏上读到的是两条带之间的**间距**突然不匀速了（带不是刻度尺），
 * 于是读感上就是「停止」甚至「反向」。而它偏偏落在接力窗口里：漂移 4px/s，
 * 70px 要 17.5 秒，正是长句的窗口末尾；贴新的子窗口也正好在那个时刻开始。
 * 两种可能的观感就此重叠，谁都能被误读成反向。
 *
 * 现在的做法是**从结构上取消这种残段**（注意不是「调大钳位」——调到丝带自己的长度之外，
 * 它就会反过来伸进屏里，丝带变成先漂出屏沿再停）：
 *   - 钳位按当前盘面的角度与厚度算：丝带漂到钳位时，它的斜切口离两侧屏沿还留着
 *     driftEdgeMarginVh，且**必须落在这一行还在屏上的时间之外**
 *     （见 ribbonDriftClampWithFloor）；
 *   - 于是「漂移不再匀速」这件事只会发生在切口已经贴到屏沿的时候——那一段它就正在退场，
 *     「停住」与「出场」是同一件事，读不出异常；
 *   - 静态几何（盒长下料）也一并共用这个钳位，因为它本来就按「最坏竖向位移」下料。
 *
 * 逐条算还是整叠只取一个：**整叠取一个**。一条带被钳住时它和相邻那条之间的间距就不再
 * 匀速了，所以钳位必须是这块盘面的共同刻度。取的是全盘最小值（最先被钳住的那条说了算），
 * 再由 ribbonDriftClampWithFloor 整叠抬到同一高度。
 */
export const resolveRibbonDriftClampPx = (strips, { width, height, enterWindowSec = 0 } = {}) => {
    const fallback = CINERAMA_TUNING.ribbon.driftClampPx;
    const list = (strips ?? []).filter((strip) => strip?.driftDir);
    if (!(width > 0) || !(height > 0) || list.length === 0) return fallback;
    // 上沿余量：漂移把斜切口顶到屏沿附近就该停（与渲染层「贴边程度」的口径一致）。
    const margin = height * (CINERAMA_TUNING.ribbon.driftEdgeMarginVh / 100);
    return list.reduce((lowest, strip) => {
        const sinAbs = Math.abs(Math.sin((strip.angleDeg * Math.PI) / 180));
        // 盒心在屏高上的比例：top 给的是盒子上沿，旋转中心还要往下半个厚度。
        const center = clamp(strip.topPct / 100 + (strip.thicknessVh / 100) / 2, 0, 1);
        /*
         * 近的那一侧屏沿到盒心的距离。丝带绕自己的中心转，竖向漂移会把切口往屏沿推
         * `d × |sin θ|`；水平带（|sin θ| → 0）推不出东西，所以它们不参与钳位。
         */
        const edge = Math.min(center, 1 - center) * height;
        if (sinAbs < 1e-6 || edge <= margin) return Math.min(lowest, fallback);
        // 一条盘面上所有丝带共用一个「还剩多少余量」刻度（都用「单条最坏」那条的量，避免同盘不同量）。
        const base = (edge - margin) / sinAbs;
        /*
         * 屏外的丝带（贴新）：按它交接时离屏的远近再抬一档。贴新那一整段是全场动作最
         * 抢眼的时刻，任何速度突变都藏不住；倍率封顶，免得慢速漂移在一条不动的带上
         * 看不出「在动」。整叠最终仍只取一个值（见 ribbonDriftClampWithFloor）。
         */
        const offscreen = strip.relay === 'new'
            ? 2 + Math.min(2, (enterWindowSec * CINERAMA_TUNING.ribbon.driftVelPxPerSec) / Math.max(1, base))
            : 1;
        return Math.min(lowest, base * offscreen);
    }, Number.POSITIVE_INFINITY);
};

/*
 * 钳位的下界：每条带漂到钳位至少要走这么久（秒）。取全盘最小 —— 这就是「整叠谁先停」
 * 的那个时刻。它是**整叠**的量：只把某几条乘上去会让它们晚停、另外几条先停，
 * 间距照样不再匀速。
 */
const ribbonDriftReachSec = (strip, limitPx) => {
    const sinAbs = Math.abs(Math.sin((strip.angleDeg * Math.PI) / 180));
    const vel = CINERAMA_TUNING.ribbon.driftVelPxPerSec * (strip.driftVelScale ?? 1);
    if (!(vel > 0) || sinAbs < 1e-6) return Number.POSITIVE_INFINITY;
    return (limitPx * sinAbs) / vel;
};

/*
 * 把**整叠**钳位抬到「这一盘面要走满 `minReachSec` 秒才停」的高度。
 *
 * 两个用途，都是同一个理由：钳位是一块盘面上所有丝带的共同刻度，任何一条提前停住，
 * 它和相邻那条之间的间距就不再是匀速的（带不是刻度尺），那一段才读成「停住 / 反向」。
 * 所以下限只能是**整叠**的，不能只给某几条加成。
 *
 *   - 接力链上的行：余量至少要盖住「这一行在屏上的整段时间」（行窗口 + 退出尾巴），
 *     贴新的子窗口正好落在窗口末尾，那是全场最不该出现速度突变的地方；
 *   - 静态几何（盒长下料）：它本来就按「最坏竖向位移」下料，余量更大一些无所谓，
 *     多出来的部分是屏外空跑（见 ribbonBoxLength）。
 */
const ribbonDriftClampWithFloor = (strips, minReachSec, bounds) => {
    const list = (strips ?? []).filter((strip) => strip?.driftDir);
    const limit = resolveRibbonDriftClampPx(list, bounds);
    if (!(minReachSec > 0)) return limit;
    const shortest = Math.min(...list.map((strip) => ribbonDriftReachSec(strip, limit)));
    if (!Number.isFinite(shortest) || shortest >= minReachSec) return limit;
    /*
     * 抬到「最短那条正好走满 minReachSec」。上界封在屏高的一个比例上：
     * 钳位同时是盒长下料的「最坏竖向位移」，太大只是让盒子白长一截。
     */
    const scale = minReachSec / shortest;
    const ceiling = bounds.height * (CINERAMA_TUNING.ribbon.driftClampMaxVh / 100);
    return Math.min(limit * scale, Math.min(limit * 12, ceiling));
};

/*
 * 接力进入方（下一行）的整叠丝带 = **继承** + **贴新**。
 *
 * 继承：上一行「留下」的那几条，几何（角度/落点/厚度/明暗/漂移参数）原样照抄，
 * 文字换成本行的——交接那一刻同一位置同一条带只换字。漂移的**原点**也随几何
 * 一起照抄（strip.driftOrigin 指向它最初所属那一行的窗口起点），渲染层按它算
 * 位移，跨过交接位置与速度都连续，不跳。
 *
 * 贴新：条数补足到 ribbonCount；角度在继承档之外抽（同一拼贴里不出现两条同角），
 * 小角名额按「整叠名额 − 继承已占」扣减；从屏外沿自身轴向减速滑入。
 *
 * prevPlan 自己也按同一条规则解算（它可能又继承了上上行）——递归到第一条
 * 不满足接力条件的行为止。歌词行数有限所以递归有限；纯函数，seek 与重建
 * 拿到的是同一叠（seek 直接落进这一行时，解算出的就是交接完成后的拼贴）。
 */
export const resolveRibbonRelayStrips = (plan, prevPlan, options) => {
    const prevStrips = resolveRibbonStripsFor(prevPlan, options);
    const relaySeed = ribbonRelaySeed(prevPlan, plan);
    const stayFlags = ribbonRelayStayFlags(prevStrips.length, relaySeed);
    /*
     * 进入方的贴新在交接那一刻还在**屏外**（见 ribbonExitDistance），这决定了它的漂移
     * 能走多远才需要停——所以钳位要按「这些带在屏外」来算，而不是按它们落到屏上的位置。
     * 窗口长度在这里取的是接力窗口（贴新的子窗口是它的一部分）。
     */
    const enterWindowSec = RIBBON_RELAY_RIP_SPAN * resolveCineramaRelayDuration(prevPlan, plan);
    const inherited = prevStrips
        .filter((_, index) => stayFlags[index])
        .map((strip) => ({
            ...strip,
            relay: 'stay',
            /*
             * 漂移原点随几何一起继承：上一行的丝带可能已经带着更早那一行的原点
             * （接力链），缺失（上一行是整叠新抽的）才落到上一行的窗口起点。
             * 渲染层按它算位移，跨过交接位置与速度都连续，不跳。
             */
            driftOrigin: strip.driftOrigin ?? prevPlan.window.startTime,
        }));
    const count = clamp(options.ribbonCount, 3, 9);
    const inheritedAngles = inherited.map((strip) => strip.angleDeg);
    const newCount = Math.max(0, count - inherited.length);
    const angleScale = clamp(options.ribbonAngle, 0.4, 1.4);
    let freshAngles = pickRibbonAngles(newCount, relaySeed, {
        angleScale,
        excludeAngles: inheritedAngles,
        shallowBudget: Math.max(
            0,
            Math.max(1, Math.floor(count * RIBBON_SHALLOW_RATIO))
                - inheritedAngles.filter((angle) => Math.abs(angle) < RIBBON_SHALLOW_ANGLE).length,
        ),
    });
    // 极端配置下（高倍率把档位挤到钳位 + 排除档占满）可能一条都抽不出来：
    // 放弃排除再抽一次，宁可同角也不要空档。
    if (freshAngles.length === 0) freshAngles = pickRibbonAngles(newCount, relaySeed, { angleScale });
    const angles = freshAngles
        .map((angle) => clamp(angle * angleScale, -RIBBON_ANGLE_LIMIT, RIBBON_ANGLE_LIMIT));
    const tops = spreadRibbonTops(Math.max(1, newCount), relaySeed);
    const fresh = [];
    for (let index = 0; index < newCount; index += 1) {
        fresh.push({
            ...buildRibbonStrip(plan, relaySeed, index, angles[index % angles.length], tops[index % tops.length], ''),
            relay: 'new',
            // 贴入方向沿自身轴向（从哪头进来），整体比撕走晚一拍（先腾地方再贴）。
            flyDir: cineramaHash01(relaySeed, index, 331) < 0.5 ? 1 : -1,
            flyDelay: RIBBON_RELAY_FLY_DELAY_MIN
                + cineramaHash01(relaySeed, index, 337) * RIBBON_RELAY_FLY_DELAY_SPAN,
            // 贴新的子窗口：与撕走一样落到数据上（见 RIBBON_RELAY_FLY_SPAN）。
            flySpan: RIBBON_RELAY_FLY_SPAN,
            driftOrigin: plan.window.startTime,
        });
    }
    // 文本按最终列表的序号交替（原文/译文）；继承的丝带也因此换成本行的文本。
    const texts = ribbonTextsOf(plan);
    // 空行：整叠都不画（同上，渲染层见到空数组就跳过这一层）。
    if (texts.length === 0) return [];
    /*
     * 整叠（继承 + 贴新）同调到一个漂移刻度上（见 normalizeRibbonDriftClamp）。
     * `enterWindowSec` 只用来把**贴新**那几条的基准抬高一点（它们在屏外），
     * 真正落到数据上的仍是全盘统一的那个值。
     */
    const strips = normalizeRibbonDriftClamp(
        [...inherited, ...fresh],
        plan,
        options,
        { enterWindowSec, tailSec: CINERAMA_TUNING.ribbon.travelTailSec },
    );
    return strips.map((strip, index) => {
        const text = texts[index % texts.length];
        return {
            ...strip,
            text,
            // repeat 是量宽前的兜底份数，文本换了就按新文本重算一次。
            repeat: clamp(Math.round(30 / Math.max(1, graphemeCount(text))), 1, 3),
        };
    });
};

/*
 * 整叠几何最后要同调的一件事：漂移钳位（见 resolveRibbonDriftClampPx）。
 *
 * 两个理由，都在「漂移只能匀速」这一条上：
 *   - 钳位必须是**整叠一个刻度**。逐条按自己的贴边值算，每条会在不同时刻停住，
 *     它和相邻那条的间距就不再匀速（带不是刻度尺），那一段才读成「停住 / 反向」；
 *   - 钳位不能落在**这一行还在屏上的时间内**。贴新的子窗口正好在行窗口末尾开始，
 *     那是全场最不该出现速度突变的时刻——所以余量至少盖住行窗口 + 退出尾巴。
 *
 * 本行不知道自己那块屏有多大（几何在渲染层才量得到），所以先在名义屏高（1000）上
 * 解算，渲染层量到真实屏高再按比例缩放（strip.driftClampPx 是名义像素）。
 * 名义屏高取 1000 而不是别的：像素与「屏高千分之一」在这个刻度上是一回事。
 */
const normalizeRibbonDriftClamp = (strips, plan, options, { tailSec = 0 } = {}) => {
    const aspect = Number.isFinite(options?.viewportAspect) && options.viewportAspect > 0.2
        ? options.viewportAspect
        : 16 / 9;
    const bounds = { width: 1000 * aspect, height: 1000 };
    const span = Math.max(0, (plan?.window?.endTime ?? 0) - (plan?.window?.startTime ?? 0));
    const reference = ribbonDriftClampWithFloor(strips, span + tailSec, bounds);
    return (strips ?? []).map((strip) => ({ ...strip, driftClampPx: reference }));
};

/*
 * 一行丝带的**唯一定义**：有合格的上一行（紧邻 + 两行都排成斜切丝带）就接力
 * （继承 + 贴新），否则按本行种子整叠新抽。渲染层、接力递归、下一行的继承
 * 全部走这一个入口，屏上的丝带和「交接完成后的定义」才不会是两套。
 * 两条路都要把漂移钳位（见 normalizeRibbonDriftClamp）落到数据上。
 */
const resolveRibbonStripsFor = (plan, options) => {
    const prevPlan = plan?.prevPlan ?? null;
    if (isCineramaRibbonRelayPair(prevPlan, plan, options)) {
        return resolveRibbonRelayStrips(plan, prevPlan, options);
    }
    return normalizeRibbonDriftClamp(
        resolveRibbonStrips(plan, plan?.seed ?? 0, options),
        plan,
        options,
        { tailSec: CINERAMA_TUNING.ribbon.travelTailSec },
    );
};

/*
 * 相邻两行是否做丝带接力：紧邻 + 两行都排成斜切丝带。
 * 样式在**编译期**按权重抽好（plan.style），这里只认那个结论——权重改了会连带重编 program
 * （见 visualizer.mjs），所以不需要在这里再读一次权重。
 */
export const isCineramaRibbonRelayPair = (prevPlan, plan) => {
    if (!prevPlan || !plan) return false;
    if (!isCineramaTransitionAdjacent(prevPlan, plan)) return false;
    return resolveCineramaStyleKind(prevPlan) === 'ribbon-collage'
        && resolveCineramaStyleKind(plan) === 'ribbon-collage';
};

/*
 * 样式层的参数。只管「这一行怎么排」，叠加项由 resolveCineramaMarquee 给。
 */
export const resolveCineramaStyle = (kind, plan, options = resolveCineramaOptions(), marquee = null) => {
    const seed = plan.seed ?? 0;
    /*
     * 排版安全区：有跑马灯带时，带占着的那几条边不许排字（见 resolveCineramaBandInset）。
     * 大字报与丝带都用不上 padding（一个居中、一个与带组合不了），只有小字报会把它
     * 当内边距写出去——所以三种样式共用一个入口解算，用不用各自决定。
     */
    const inset = resolveCineramaBandInset(marquee, options);

    if (kind === 'hero-type') {
        // 居中排版：让开带子靠**收窄可用框**，不是加内边距（见 heroTuningWithinBand）。
        const tuning = heroTuningWithinBand(inset);
        const aspect = Number.isFinite(options.viewportAspect) && options.viewportAspect > 0.2
            ? options.viewportAspect
            : 16 / 9;
        // 切分只由「内容 + 画布」决定（读不到宽高比时按 16:9），所以拖字号倍率不会重新切词。
        // 斜体概率是面板旋钮（文字样式组），乘在本体常量上：0 = 整首不斜、1 = 回到设计默认。
        const italicChance = clamp(tuning.italicChance * clamp(Number(options.italicChance ?? 1) || 0, 0, 1), 0, 1);
        const chunks = buildHeroChunks(plan, options, tuning).map((chunk, index) => ({
            ...chunk,
            /*
             * 斜体按**块**随机：一句拆成几块后，每块各自用同一 seed 抽一次，
             * 于是同一句里可能「普通块 + 斜体块」混排，而不是整句要么全斜、要么全正。
             * 索引用块序号（不是固定 12），保证 seek / 重建拿到的是同一套斜体分布。
             */
            italic: cineramaHash01(seed, index, 113) < italicChance,
        }));
        /*
         * 字号：取所有块里**最苛刻的那一份**（每块各有一个「不横向出屏」的安全字号，取最小）。
         * 块间不跳字号，所以只能按最窄的那块定——一次出的词因此**始终在屏幕内**。
         *
         * 历史旋钮 `heroScale`（v0.8.30 起恒为 1）在这里只乘 `< 1` 的那一半：fitVh 是上限，
         * 往下缩不会出屏、往上放会。它恒等于 1，所以这一处等于原值直接钳一次。
         * 「文字样式 · 字号」那条倍率**不在这里乘**——整条链只有渲染层写 CSS 的那一处
         * （见 cineramaRender 的 buildHero），> 1 会溢出，这是面板备注里写明的有意取舍。
         */
        const fitVh = chunks.reduce(
            (min, chunk) => Math.min(min, heroFontVhForChunk(chunk.text, aspect, tuning)),
            tuning.maxFontVh,
        );
        const scale = clamp(options.heroScale, 0.6, 1.4);
        const lineFontVh = clamp(fitVh * Math.min(1, scale), tuning.minFontVh, tuning.maxFontVh);
        /*
         * 块级微差——两处，都按 `(seed, 块序号)` 抽，所以 seek / 重建拿到的是同一套：
         *
         *   1. **字号**：相邻两块在 `HERO_CHUNK_SCALE_POOL` 里各抽一个、相邻不重复。
         *      上限是**该块自己的安全字号**（横向 `usableWidthVw` 与竖向 `maxFontVh` 的较小者），所以往大走
         *      的那几块也不会出屏、不会折行；最宽的那块拿到 1.0（它的安全字号就是整行字号）。
         *      整行的 `heroFontVh` 仍是所有块的下界，渲染层的兜底与让开带子的算术都用它。
         *   2. **蒙版填色**：按这一块的**字数**掷一次（`heroFillChance` 的拟合曲线）——
         *      1 个字不填、2 个字小概率、5 个字及以上到上限（`TUNING.hero.fillChance`）。
         *   3. **持续运动**：**只有没填色的块**按权重从 `HERO_MOTION_POOL` 抽（填色的块取恒等，
         *      两件事不重叠）。抽到 still 就是「实色落定、不动也不填」那一档；
         *      抽到 spread 就是「一边放大到 1.3、一边把字距加到 0.15em」（见 `HERO_SPREAD_*`）。
         *   4. **填色方向**：水平（左 → 右）或竖直（上 → 下），相邻不重复（只有填色的块用得上）。
         */
        let previousChunkScale = null;
        let previousFillAxis = null;
        const decorated = chunks.map((chunk, index) => {
            const factor = chooseCineramaWithoutRepeat(
                HERO_CHUNK_SCALE_POOL,
                `${seed}:chunk-scale:${index}`,
                previousChunkScale,
            ) ?? 1;
            previousChunkScale = factor;
            /*
             * 填色方向：缺省按块抽、相邻不重复；面板可以把它钉死成整首水平或竖直
             * （见 CINERAMA_HERO_FILL_AXIS_VALUES）。钉死时不动「相邻不重复」那条链的
             * previousFillAxis——它只在自动档有意义。
             */
            const fillAxisMode = options.heroFillAxis;
            const fillAxis = fillAxisMode === 'x' || fillAxisMode === 'y'
                ? fillAxisMode
                : (chooseCineramaWithoutRepeat(
                    HERO_FILL_AXIS_POOL,
                    `${seed}:fill-axis:${index}`,
                    previousFillAxis,
                ) ?? 'x');
            previousFillAxis = fillAxis;
            /*
             * 填色与运动不重叠：填了就一定不动（取恒等），没填才去抽运动。
             * 掷点都用 `(seed, 块序号)`，所以 seek / 重建的结论一致。
             */
            const fill = cineramaHash01(seed, index, 191)
                < heroFillChance(visibleGraphemeCount(chunk.text), tuning, options.fillChance);
            /*
             * 块级持续运动的幅度：整类按 `heroMotion` 缩放（0 = 整首不做持续运动，
             * 块落定后就是死字）。填色的块仍取恒等（见 HERO_STILL_MOTION）。
             */
            const motion = fill ? HERO_STILL_MOTION : scaleHeroMotion(pickHeroMotion(seed, index), options.heroMotion);
            return {
                ...chunk,
                fontVh: clamp(lineFontVh * factor, tuning.minFontVh, heroFontVhForChunk(chunk.text, aspect, tuning)),
                motion,
                fill,
                fillAxis,
            };
        });
        return {
            kind,
            chunks: decorated,
            chunkChance: clamp(options.heroChunkChance, 0, 1),
            // minFontPx 是渲染层的兜底下限，两处同源：解算层再小也会被 CSS 抬回去。
            heroFontVh: lineFontVh,
        };
    }

    if (kind === 'ribbon-collage') {
        // 接力在这里生效：有合格的上一行时，本行 = 继承 + 贴新（见 resolveRibbonStripsFor）。
        return { kind, strips: resolveRibbonStripsFor(plan, options) };
    }

    /*
     * 小字报：整行居中、逐段依次落位（平铺那套排版并入这里）。
     *
     * 字号在这里算完交给渲染层，与大字报的 `heroFontVh` 同一条规矩——
     * **渲染层不自己乘倍率**（那会让「面板显示的倍率」和「画面用的字号」两处各算一遍，
     * 以后改基数只改到一处）。排版轴提供 fontScale，`smallType.baseVh` 是样式自己的本体，
     * `smallScale` 是历史旋钮（v0.8.30 起恒为 1）；三者相乘后钳一次防 NaN。
     */
    const tuning = CINERAMA_TUNING.smallType;
    const layout = resolveCineramaLayout(plan.layout);
    const scale = clamp(options.smallScale ?? 1, 0.6, 1.4);
    return {
        kind: 'small-type',
        fontVh: clamp(layout.fontScale * tuning.baseVh * scale, tuning.minFontVh, tuning.maxFontVh),
        /*
         * 内边距按「排版轴的留白」与「带占的那几条边」取大者：小字报整块是按
         * `padY / padX` 落位的，带子只会把它往里挤，不会让它变大。
         * 这些值全是比例（屏高 / 屏宽），渲染层直接写进 padding。
         */
        inset: {
            top: Math.max(layout.padY, inset.top),
            bottom: Math.max(layout.padY, inset.bottom),
            left: Math.max(layout.padX, inset.left),
            right: Math.max(layout.padX, inset.right),
        },
    };
};

/*
 * 这一行实际用的样式 = 编译期按权重抽好的结论（plan.style）。
 *
 * 权重是**编译期**读的：样式要「相邻不重复」，那是一条逐行串下来的链，只能在 plan 里定；
 * 代价是权重变了要重编 program（渲染层按 cineramaStyleWeightSignature 判定，见 visualizer.mjs），
 * 所以运行时读到的 plan.style 永远是当前权重下的结论。
 *
 * 「只留一种样式」由权重表达（其余两项拖到 0），因此没有显式档位了：只留斜切丝带时，
 * 单段 / 空行也照样上带，不会因为 support 判定而串出小字报（空行是一条带都不画，
 * 见上面的 CINERAMA_STYLE_SUPPORT 与 ribbonTextsOf）。
 */
export const resolveCineramaStyleKind = (plan) => plan?.style ?? 'small-type';
