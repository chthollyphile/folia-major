import { chooseCineramaWithoutRepeat, cineramaHash01 } from './cineramaRandom.mjs';

// mods/cinerama/cineramaTransition.mjs
// 转场层：行的**入场与退场形态**都在这一层，是唯一一套帧。
//   - 紧邻时它管「行与行之间那一段」怎么交接：退出方与进入方在一段短窗口里交叠；
//   - 不紧邻时（首行 / 空档后起行 / 行末有空档）没有交叉对象，同一对 enter / exit 帧
//     由渲染层按行窗口的相位（`cineramaAnimation.resolveCineramaLinePhase`）直接取用。
// 原先另有一条「怎么进」的动画轴，已移除（理由见 cineramaAnimation）。
//
// 参照 sonnet 的 shot 转场（sonnetTransitions.ts）归纳的三条，它们也是这里的设计前提：
//   1. 转场不是「行自己的包络再跑一遍」，而是**边界上一段独立的短窗口**；
//      sonnet 的窗口按相邻 shot 间距给、钳在 0.14~0.24s，短句因此不会整句都在转场。
//   2. 退出方与进入方在这段窗口里**同时存在**（monet 的叠层交叉、claddagh 的
//      exit/enter 交叠都是同一类做法），而不是先后各淡一次——先后各淡一次中间会出现
//      一帧全空，大屏上读出来是「每次换行都眨一下」。
//   3. 转场的形态**按种子抽、且不与上一次重复**（`chooseCineramaWithoutRepeat`），
//      与切分/排版/动画/样式同一套口径，seek 与重建都不洗牌。
//
// 纯数据：只解算参数，不碰 DOM。

/*
 * **已实现**的转场形态（帧函数认这五个，见 resolveCineramaTransitionFrame）。
 */
export const CINERAMA_TRANSITION_KINDS = [
    'dissolve',
    'fast-blur',
    'press-glitch',
    'pull-back',
    'wipe-out',
];

/*
 * **当前启用**的档位：只跑交叉溶解。
 *
 * 抽形态只认这个池子（见 pickCineramaTransitionKind），所以「停用某一档」不需要删它的
 * 实现——形态还在，只是不进抽取，随时加回数组即可恢复。这是刻意的：/`-blur` 那几档
 * 的观感要在真机上逐档校准，先把最通用、也最像「LED 屏内容换代」的溶解跑稳，
 * 其余留着待启用，而不是一边调文案一边混着四五种退法。
 */
export const CINERAMA_TRANSITION_POOL = ['dissolve'];

/*
 * 转场窗口的上下限（秒）。sonnet 用 0.14~0.24；巨幕的字更大、屏更满，
 * 短了读不出「换代」，所以上限放到 0.28。
 */
const TRANSITION_MIN_SEC = 0.14;
const TRANSITION_MAX_SEC = 0.28;
// 窗口占「这一行起始 → 下一行起始」的比例：行密则转场短，行疏则转场长。
const TRANSITION_RATIO = 0.22;
/*
 * 相邻判定：下一行的起始离这一行的窗口结束超过这个间隔，就算**有空档**。
 * 有空档就没有交叉对象——把上一句一直挂在屏上等下一句很怪，所以那一档退回
 * 行自己的 exit 包络（自己淡出），不做交叉。
 * 取 0.6 而不是「转场窗口那么长」：行窗口的 endTime 已被钳到下一行 start，
 * 密集段落的 gap 本来就是 0，真正会落在 0~0.6 之间的是稍松一点的句间呼吸，
 * 那种还该算紧邻；再长就是间奏了。
 */
const TRANSITION_GAP_SEC = 0.6;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smoothstep = (value) => {
    const t = clamp01(value);
    return t * t * (3 - 2 * t);
};

/*
 * 下一行是否紧邻这一行。不紧邻就没有交叉对象。
 * 注意用的是 window.endTime（已被钳到下一行 start，见 cineramaProgram），
 * 所以「歌词尾巴比下一行长」这种重叠在这里算 gap = 0，是紧邻的。
 */
export const isCineramaTransitionAdjacent = (plan, next) => {
    if (!plan || !next) return false;
    return next.startTime - plan.window.endTime <= TRANSITION_GAP_SEC;
};

export const resolveCineramaTransitionDuration = (plan, next) => {
    const span = Math.max(0.001, (next?.startTime ?? plan.window.endTime) - plan.window.startTime);
    return Math.min(TRANSITION_MAX_SEC, Math.max(TRANSITION_MIN_SEC, span * TRANSITION_RATIO));
};

/*
 * 丝带接力（ribbon relay）的窗口长度。相邻两行都是斜切丝带时，交接不走整层溶解——
 * 实底胶带的拼贴整屏淡出，读出来是「一墙胶带一起变成幽灵」，与胶带的实物语汇矛盾。
 * 那一段改成逐条丝带的编排（撕走 / 换字 / 贴新，解算见 cineramaTreatment、
 * 渲染见 cineramaRender.buildRibbon），动作要读得出「加速」，所以窗口比溶解长一档。
 */
const RELAY_MIN_SEC = 0.22;
const RELAY_MAX_SEC = 0.42;
const RELAY_RATIO = 0.3;

export const resolveCineramaRelayDuration = (plan, next) => {
    const span = Math.max(0.001, (next?.startTime ?? plan.window.endTime) - plan.window.startTime);
    return Math.min(RELAY_MAX_SEC, Math.max(RELAY_MIN_SEC, span * RELAY_RATIO));
};

/*
 * 转场帧，形状固定为 `{opacity, x, y, scale, blur, clip}`
 * （恒等帧 `CINERAMA_IDLE_ANIMATION_FRAME` 同形状），所以渲染层不需要分叉。
 *
 * `amount` 是**存在度**：1 = 完全在屏上，0 = 已经退干净。退出方与进入方都用它，
 * 于是同一套帧可以同时驱动两侧（exit/enter 对称，同 sonnet）。
 */
export const resolveCineramaTransitionFrame = (kind, amount, seed = 0) => {
    const presence = clamp01(amount);
    const away = 1 - presence;

    let frame;
    if (kind === 'fast-blur') {
        // 失焦退场：先虚掉再消失（sonnet 的 fast-blur 同一条思路）。
        frame = { opacity: 1 - away * 0.82, x: 0, y: 0, scale: 1, blur: away * 14, clip: null };
    } else if (kind === 'press-glitch') {
        // 套版闪断：阶梯抖动 + 后段硬切，沿用印前故障的语汇——不再是平滑淡出。
        const step = Math.floor(away * 6);
        const jitter = cineramaHash01(seed, step, 31) - 0.5;
        frame = {
            opacity: away > 0.86 ? 0 : 1 - away * 0.5,
            x: jitter * away * 0.06,
            y: 0,
            scale: 1,
            blur: away * 1.2,
            clip: null,
        };
    } else if (kind === 'pull-back') {
        // 推拉退场：整屏往后退一点再淡掉（sonnet 的 camera-pull）。
        frame = { opacity: 1 - away * 0.72, x: 0, y: 0, scale: 1 - away * 0.08, blur: 0, clip: null };
    } else if (kind === 'wipe-out') {
        // 擦除退场：从下沿往上抹掉，像整屏换帧。
        frame = { opacity: 1, x: 0, y: 0, scale: 1, blur: 0, clip: `inset(0 0 ${(away * 100).toFixed(2)}% 0)` };
    } else {
        // dissolve（默认）：交叉溶解——最通用的一档，屏幕内容直接换代。
        frame = { opacity: presence, x: 0, y: 0, scale: 1 - away * 0.03, blur: 0, clip: null };
    }

    /*
     * 收尾：所有形态在窗口最后 15% 一律收到 0。
     * 少了这一刀的话，fast-blur 末段还留着 18% 不透明度、pull-back 留着 28%——
     * 退出方是在窗口末尾被**拆掉**的，那一刻还亮着，读出来是「啪」地一下消失，
     * 而不是退干净。擦除那档靠 clip 隐藏，乘这一刀也一样成立。
     */
    const tail = 1 - clamp01((away - 0.85) / 0.15);
    return { ...frame, opacity: frame.opacity * tail };
};

/*
 * 退出方专用：把「已经过去多少」换算成存在度再取帧。
 */
export const resolveCineramaTransitionExitFrame = (kind, progress, seed = 0) => (
    resolveCineramaTransitionFrame(kind, 1 - smoothstep(progress), seed)
);

/*
 * 进入方专用，与上面对称。
 *
 * 入场走这一帧而不另设一条形态轴，是因为**交叉那一段里不能出现硬边**：
 * 早先动画轴里的 `wipe` 是 `opacity: 1` + `clip-path` 从左边揭开——它**不淡入**，
 * 边界是一条竖直硬边自左向右扫，扫过一个还没退干净的旧层时屏上同时是新旧两份内容、
 * 中间一条边界，读出来就是「屏幕横向刷新了一下／像扫描线在两个画面之间切」。
 * 现在入场与退场共用同一套形态，这条边界不可能再出现。
 *
 * 没有上一行可交叉时（首行、有空档之后再起一行）同一条帧照样成立：
 * 那时屏上没有旧层，只是「自己淡进来」而已。
 */
export const resolveCineramaTransitionEnterFrame = (kind, progress, seed = 0) => (
    resolveCineramaTransitionFrame(kind, smoothstep(progress), seed)
);

/*
 * 跑马灯带的**交接存在度**，与内容的转场帧分开。
 *
 * 带占的是屏沿那一圈，是这块屏的边框：整段转场里**屏上只能有一条带**。
 * 内容的交叉溶解允许两层各自半透明地叠在一起（那块字读的是「换了一屏」），
 * 但带上的字是逐字绕屏一圈的——两层叠在同一圈上就是两份字互相穿插，
 * 读出来是一团花（报障截图正是这个）。所以带子不能跟着内容走溶解，得有自己的一套：
 *
 *   - 退场方的带在**前半场**淡到 0；
 *   - 进入方的带在**后半场**从 0 淡进来。
 *
 * 两个半场严格互斥，任何一帧都只有一条带在屏上——文字不可能重叠。
 * 换字发生在窗口正中：那一刻内容也正交叉到各自 50%，是最不显眼的位置；
 * 而带本身只改不透明度，几何（带厚 / 环内沿 / 双带左沿）整段恒定，
 * 所以「框缩放」不会回来。
 *
 * `amount` 与转场帧同义：1 = 完全在屏上，0 = 已经退干净。
 */
export const resolveCineramaBandExitPresence = (progress) => (
    1 - smoothstep(clamp01(progress) * 2)
);

export const resolveCineramaBandEnterPresence = (progress) => (
    smoothstep(clamp01(progress) * 2 - 1)
);

/*
 * 转场形态按种子从**启用池**里抽，且不与**上一次**重复：池子里有多档时，
 * 连着两句用同一种退法会读成节拍，而不是换屏。
 * 这一轴同时管进与退（动画轴已移除），所以池子里的形态**两侧共用**。
 * 池子只剩一档时（当前就是），chooseCineramaWithoutRepeat 直接返回它——
 * 于是整首歌的每一处交接都是同一种形态，这正是现在要的一致性。
 */
export const pickCineramaTransitionKind = (seed, previous) => (
    chooseCineramaWithoutRepeat(CINERAMA_TRANSITION_POOL, seed, previous) ?? 'dissolve'
);
