// Copyright (c) 2026 chthollyphile
// src/components/visualizer/hanabi/hanabiTransitions.ts
// 花火的段落转场（取自 lumisynth 花火包的 transitions）：上升 ascend、闪白 flash、开花 bloom。
// lumisynth 里这一帧由内核套在单元容器上，folia 没有内核，由运行时按同样的规则套（hanabiSceneFrames.ts）：
//   - 出场：transitionOut 窗口里对旧段落的容器套 resolveFrame('exit', 进度)；
//   - 进场：边界之后 enterDuration 秒里对新段落的容器套 resolveFrame('enter', 进度)，同时与还在出场的旧段落交叉渐变
//     （旧段落的出场进度接着走过 1：上升按边界上的速度继续滑走、转走，闪白 / 开花停在终点帧）。
// 上升是这个模式的招牌：摄影机继续往上走，旧画面向下滑走并模糊，新画面从上方落进来，与段内镜头之间的上升连成一片。
// 三种转场都带一点绕画面中心的旋转（旧画面转出去、新画面从反方向转回正），与段内镜头之间的大角度旋转接上。

import { easeSeptic } from './timeline';

export const HANABI_TRANSITION_KINDS =['ascend', 'flash', 'bloom'] as const;
export type HanabiTransitionKind = typeof HANABI_TRANSITION_KINDS[number];

export interface HanabiTransitionFrame {
    alpha: number;
    scale: number;
    /** 模糊强度（逻辑像素，Pixi BlurFilter 的 strength）。 */
    blur: number;
    /** 纵向位移（画面高度的比例，向下为正）。 */
    y: number;
    /** 绕画面中心的旋转（弧度；运行时再乘 tuning.spin）。 */
    rotation: number;
}

export interface HanabiTransitionDef {
    kind: HanabiTransitionKind;
    /** 段落边界处的时长；gap 为两段之间的空隙（下一段开始 − 这一段最后一行唱完）。 */
    duration: (gap: number) => number;
    /** 边界之后进入阶段时长的钳制（进入时长 = 上一段转场窗口的长度钳在这个区间里）。 */
    enterClamp: [number, number];
    /** exit：0 → 1 走向边界；enter：0 → 1 离开边界。 */
    resolveFrame: (phase: 'enter' | 'exit', progress: number) => HanabiTransitionFrame;
}

/** 两端速度、加速度都为 0 的缓动（与镜头之间慢转换速度的是同一条）。 */
const ease = easeSeptic;
/**
 * 从静止起步、越走越快，到 1 时正好变成匀速（速度 2、加速度 0）；超过 1 接着匀速走。
 * 上升转场的旧画面过了边界还按这个速度继续往下滑、继续转着淡掉，不会在边界上一下停住。
 */
const launch = (p: number) => (p <= 0 ? 0 : p >= 1 ? 1 + 2 * (p - 1) : p * p * p * (2 - p));

const frame = (partial: Partial<HanabiTransitionFrame>): HanabiTransitionFrame => ({ alpha: 1, scale: 1, blur: 0, y: 0, rotation: 0, ...partial });

/** exit 的 progress 可以超过 1（边界之后还在淡出的旧段落）：上升接着走，闪白 / 开花停在终点。 */
const resolveFrame = (kind: HanabiTransitionKind, phase: 'enter' | 'exit', progress: number): HanabiTransitionFrame => {
    const p = Math.max(0, phase === 'exit' ? progress : Math.min(1, progress));
    if (kind === 'ascend') {
        if (phase === 'exit') {
            const e = launch(p);
            return frame({ y: 0.32 * e, blur: 10 * Math.min(e, 1), alpha: 1 - 0.7 * ease((p - 0.5) / 0.5), rotation: 0.55 * e });
        }
        // 镜像的 launch：带着速度落进来，减速停稳。
        const k = launch(1 - p);
        return frame({ y: -0.26 * k, blur: 10 * k, alpha: 1 - 0.7 * k, rotation: -0.5 * k });
    }
    if (kind === 'flash') {
        const near = phase === 'exit' ? ease(p) : 1 - ease(p);
        return frame({ scale: 1 + 0.05 * near, blur: 9 * near * near, alpha: 1 - 0.55 * near * near, rotation: (phase === 'exit' ? 0.12 : -0.12) * near });
    }
    if (phase === 'exit') {
        const e = ease(p);
        return frame({ scale: 1 + 0.18 * e, blur: 5 * e, alpha: 1 - e, rotation: 0.3 * e });
    }
    const k = 1 - ease(p);
    return frame({ scale: 1 - 0.08 * k, blur: 4 * k, alpha: 1 - k, rotation: -0.25 * k });
};

export const HANABI_TRANSITIONS: Record<HanabiTransitionKind, HanabiTransitionDef> = Object.fromEntries(
    HANABI_TRANSITION_KINDS.map(kind => [kind, {
        kind,
        duration: (gap: number) => (kind === 'flash'
            ? Math.min(0.5, Math.max(0.28, gap > 0 ? gap * 0.4 : 0.35))
            : Math.min(1.1, Math.max(0.5, gap > 0 ? gap * 0.6 : 0.8))),
        enterClamp: kind === 'flash' ? [0.2, 0.45] : [0.4, 0.9],
        resolveFrame: (phase: 'enter' | 'exit', progress: number) => resolveFrame(kind, phase, progress),
    } satisfies HanabiTransitionDef]),
) as Record<HanabiTransitionKind, HanabiTransitionDef>;

/** 进入阶段的时长：上一段 transitionOut 窗口（startTime..endTime）的长度钳在转场的 enterClamp 里。 */
export const resolveHanabiEnterDuration = (kind: HanabiTransitionKind, startTime: number, endTime: number) => {
    const [min, max] = HANABI_TRANSITIONS[kind].enterClamp;
    return Math.max(min, Math.min(max, endTime - startTime));
};

/**
 * 选转场：上升占一半（连续升空是这个模式的主线），另一半在闪白 / 开花里挑；不与上一次相同，按 (seed, 段落序号) 散列确定。
 */
export const chooseHanabiTransition = (seed: string, paragraphIndex: number, previous: HanabiTransitionKind | null): HanabiTransitionKind => {
    let hash = 0;
    for (const char of `${seed}:${paragraphIndex}:hanabi-transition`) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    const roll = Math.abs(hash);
    if (previous !== 'ascend' && roll % 2 === 0) return 'ascend';
    const choices = HANABI_TRANSITION_KINDS.filter(kind => kind !== previous && kind !== 'ascend');
    return choices[(roll >> 1) % choices.length]!;
};
