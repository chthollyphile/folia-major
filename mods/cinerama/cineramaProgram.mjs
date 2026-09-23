import { hashCineramaSeed } from './cineramaRandom.mjs';
import {
    buildCineramaUnits,
    pickCineramaSplitKind,
    resolveCineramaLineWindow,
} from './cineramaSplit.mjs';
import { pickCineramaLayoutKind } from './cineramaLayout.mjs';
import { pickCineramaTransitionKind } from './cineramaTransition.mjs';
import { pickCineramaStyleKind } from './cineramaTreatment.mjs';

// mods/cinerama/cineramaProgram.mjs
// Compiles the lyric list into a seek-stable show plan: every line gets a
// split, a layout and a transition drawn deterministically from the song seed.
// Mirrors Sonnet's compile -> plan -> lookup shape, minus the paragraph layer —
// a screen shows one line at a time, so there is nothing to group yet.
//
// 四条编译期轴：切分 / 排版 / 转场 / 样式，都按行种子抽、且相邻行不重复。
// 转场轴管的是**这一行与下一行之间**那一段：怎么退、以及这一行怎么进
// （见 cineramaTransition；不紧邻时没有交叉对象，那一相由渲染层拿它自己淡入 / 淡出）。
// 原先另有一条「怎么进」的动画轴（fade / slide-up / wipe / zoom-settle / flicker），
// 它在紧邻时被转场顶掉、只在首行与空档后偶尔露一次，已移除。
//
// 样式这一轴抽的是**权重**（面板的三个旋钮）：它要「相邻不重复」，是一条逐行串下来的链，
// 只能在编译期定。代价是权重一变就得重编（调用方按 cineramaStyleWeightSignature 判定）。

/*
 * One entry per lyric line. `units` is the split result kept for the coming
 * per-segment work; the renderer ignores it while lines are drawn whole.
 */
/*
 * @param {{ title?: string | null, styleWeights?: Record<string, number> | null,
 *           layoutWeights?: Record<string, number> | null }} [meta]
 *   `title` 只被跑马灯带用；`styleWeights` 是三个样式的概率权重（kind → 0~1）；
 *   `layoutWeights` 是排版两组的权重（early / letterbox → 0~1，缺省组是兜底）。
 *   两者缺席时各自回落到缺省权重。
 */
export const compileCineramaProgram = (lines, seed = 'cinerama', meta = {}) => {
    const { title = null, styleWeights = null, layoutWeights = null } = meta ?? {};
    const resolvedSeed = String(seed);
    let previousSplit = null;
    let previousLayout = null;
    let previousTransition = null;
    let previousStyle = null;

    const plans = (lines ?? []).map((line, index) => {
        const raw = resolveCineramaLineWindow(line);
        /*
         * Never let the visual tail run into the next line's start.
         *
         * 下一行的 `startTime` 可能是 NaN（脏歌词数据），而 `??` 只挡 null/undefined：
         * NaN 会让 `Math.min` 与下面那次 `Math.max` 一起返回 NaN，于是**当前这一行**
         * 的窗口也塌成 NaN，`findCineramaPlanAtTime` 从此跳过它、画面停在上一行。
         * 这里按「取不到有限值就当没有下一行」处理，与 resolveCineramaLineWindow 同一口径。
         */
        const nextStart = Number.isFinite(lines[index + 1]?.startTime) ? lines[index + 1].startTime : Number.POSITIVE_INFINITY;
        const clampedEnd = Math.min(raw.endTime, nextStart);
        const window = {
            startTime: raw.startTime,
            endTime: Math.max(raw.startTime + 0.001, Number.isFinite(clampedEnd) ? clampedEnd : raw.endTime),
        };
        const lineSeed = `${resolvedSeed}:${index}:${line?.fullText ?? ''}`;
        const split = pickCineramaSplitKind(line, `${lineSeed}:split`, previousSplit);
        const layout = pickCineramaLayoutKind(`${lineSeed}:layout`, previousLayout, layoutWeights);
        /*
         * 转场轴：这一行**怎么退给下一行**，以及（紧邻时）下一行怎么进。
         * 紧邻判定与窗口长度都由渲染层按实际间距算（见 cineramaTransition）；
         * 不紧邻时这一轴仍管这一行自己的淡入与淡出，只是没有交叉对象。
         * 与切分 / 排版 / 样式同一套「相邻不重复」口径，所以连着两句不会用同一种退法。
         */
        const transition = pickCineramaTransitionKind(`${lineSeed}:transition`, previousTransition);
        previousSplit = split;
        previousLayout = layout;
        previousTransition = transition;

        // 样式要读 units 与行文本（本行排不排得出丝带），所以排在前三条轴之后解算。
        // 只抽**排版本体**：跑马灯带是叠加项，档位在面板上，
        // 形态/开关由解算层按种子决定（同样是 seek 稳定的）。
        // styleWeights 缺席时解算层回落到缺省权重（见 cineramaStyleWeights）。
        const base = {
            index,
            line,
            window,
            startTime: window.startTime,
            endTime: window.endTime,
            units: buildCineramaUnits(line, split),
            split,
            layout,
            transition,
            title,
            seed: hashCineramaSeed(lineSeed),
        };
        const style = pickCineramaStyleKind(base, previousStyle, styleWeights);
        previousStyle = style;

        return { ...base, style };
    });

    /*
     * 链上前一行：丝带接力按「上一行的丝带长什么样」解算本行的继承丝带
     * （见 cineramaTreatment.resolveRibbonRelayStrips）。它必须是纯解算——
     * 按 prevPlan 重演上一行的丝带定义，而不是引用活着的层，seek 与重建才一致。
     */
    plans.forEach((plan, index) => {
        plan.prevPlan = plans[index - 1] ?? null;
    });

    return { version: 1, seed: resolvedSeed, plans };
};

export const findCineramaPlanAtTime = (program, time) => {
    const plans = program?.plans ?? [];
    for (let index = plans.length - 1; index >= 0; index -= 1) {
        if (time >= plans[index].startTime) return plans[index];
    }
    return null;
};
