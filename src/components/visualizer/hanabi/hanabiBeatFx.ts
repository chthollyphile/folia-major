// Copyright (c) 2026 chthollyphile
import { resolveBeatFxAccentGain, type BeatFxEvent } from '../../../services/beatFx/clock';
import { burstPreset } from './catalog';
import { createRng } from './hanabiRandom';
import type { BurstKind, BurstSpec } from './types';

// src/components/visualizer/hanabi/hanabiBeatFx.ts
// 花火在智能动感模式里的两个效果（纯数据与包络运算，不碰 Pixi）：
//   随拍开花 hanabi.beatBursts <- beat_this 的节拍表本身：每拍在夜空上半部开一朵小烟花；小节第一拍提前升空、正好在拍上
//                                 开一朵大的。重音强的拍开得更大（resolveBeatFxAccentGain），没有节奏的小节不开。
//                                 用的是整张节拍表而不是「刚触发的拍」：哪一拍在哪开、开多大只由拍的时刻与种子决定，
//                                 画面仍然只由时间决定，拖进度、暂停补帧都对，升空尾迹也能提前起飞、正好在拍上开花。
//   随拍推镜 hanabi.beatPulse  <- beatImpact / downbeatImpact 包络：整个画面每拍推近一下、左右交替轻轻一摆，
//                                 小节第一拍推得更深（resolveHanabiBeatPulse）。
// 节拍表没装好（isBeatFxReady 为 false）、效果关着时什么都不做，画面与关掉智能动感模式时一模一样。

/** 一拍的烟花（画面坐标按比例给，场景再换算进那时所在的镜头）。 */
export interface HanabiBeatShell {
    t: number;
    downbeat: boolean;
    /** 开花的位置（画面宽 / 高的比例）。 */
    sx: number;
    sy: number;
    spec: BurstSpec;
    /** 小节第一拍从画面底边升空，到达时刻 = t。 */
    launch: boolean;
    seed: string;
}

/** 一拍的烟花从开花到熄灭最多多久（秒）；场景按它取时间窗。 */
export const HANABI_BEAT_SHELL_LIFE = 1.8;

const BEAT_KINDS: BurstKind[] = ['botan', 'senrin', 'strobe', 'star', 'heart', 'ring'];
const DOWNBEAT_KINDS: BurstKind[] = ['kiku', 'ring', 'willow-ring', 'crossette', 'palm'];

/**
 * 一拍的烟花；没有节奏的小节（accent gain 为 0）返回 null。strength 是效果强度 0..2（1 是调好的样子）：
 * 粒子数与半径都跟着它，重音强度只改半径。
 */
export const resolveHanabiBeatShell = (
    event: BeatFxEvent,
    seed: string,
    strength: number,
    trackScale: number,
): HanabiBeatShell | null => {
    const gain = resolveBeatFxAccentGain(event, trackScale);
    if (gain <= 0 || strength <= 0) return null;
    const key = `${seed}:beat:${Math.round(event.t * 1000)}`;
    const random = createRng(key);
    const downbeat = event.kind === 'downbeat';
    const kinds = downbeat ? DOWNBEAT_KINDS : BEAT_KINDS;
    const kind = kinds[Math.floor(random() * kinds.length)]!;
    const colors = [0, 1, 2].map(k => (k + Math.floor(random() * 5)) % 5);
    const size = (0.55 + 0.45 * gain) * (0.7 + 0.3 * strength);
    const spec: BurstSpec = downbeat
        ? { ...burstPreset(kind, colors), count: Math.round(80 * (0.5 + 0.5 * strength)), radius: 0.2 * size, duration: 1.7 }
        : { ...burstPreset(kind, colors), count: Math.round(28 * (0.5 + 0.5 * strength)), radius: 0.09 * size, duration: 1.1, trail: 0.25 };
    return {
        t: event.t,
        downbeat,
        // 小烟花散在夜空上半部与两侧，大的开在上方中间一带；都在字底色块后面。
        sx: downbeat ? 0.2 + random() * 0.6 : 0.06 + random() * 0.88,
        sy: downbeat ? 0.12 + random() * 0.2 : 0.07 + random() * 0.36,
        spec,
        launch: downbeat,
        seed: key,
    };
};

/** events（按时刻排好）里第一个 t ≥ time 的下标。 */
export const firstBeatAtOrAfter = (events: readonly BeatFxEvent[], time: number) => {
    let low = 0;
    let high = events.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (events[middle]!.t < time) low = middle + 1;
        else high = middle;
    }
    return low;
};

// ─── 随拍推镜 ───────────────────────────────────────────────────────────

export const HANABI_BEAT_PULSE = {
    /** 每拍推近的比例与重拍额外推近的比例（强度 1 时）。 */
    zoom: 0.035,
    downbeatZoom: 0.045,
    /** 每拍左右交替摆的角度（度，跟 beatFxLive 的 getBeatFxRotationSign 换边）。 */
    kickDeg: 1.6,
} as const;

/**
 * 一帧的推镜：k / d 是这个效果自己强度下的拍 / 重拍包络（0..2）。返回整个场景层的缩放与额外旋转（弧度）。
 */
export const resolveHanabiBeatPulse = (k: number, d: number, rotationSign: number) => ({
    scale: 1 + HANABI_BEAT_PULSE.zoom * Math.max(0, k) + HANABI_BEAT_PULSE.downbeatZoom * Math.max(0, d),
    rotation: (HANABI_BEAT_PULSE.kickDeg * Math.PI / 180) * Math.max(0, k) * rotationSign,
});

/**
 * 时钟的包络已经乘了「这个画面上第一个读节拍表的效果」的强度（beatFxLive 的 setBeatFxIntensities）；
 * 花火有两个读节拍表的效果，推镜按自己的强度换算回来：除掉时钟的强度、乘上自己的。时钟强度为 0 时没有包络可用。
 */
export const rescaleBeatEnvelope = (envelope: number, clockStrength: number, ownStrength: number) => (
    clockStrength > 1e-3 ? (envelope / clockStrength) * ownStrength : 0
);
