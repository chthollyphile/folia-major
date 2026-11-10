// Copyright (c) 2026 chthollyphile
import type { Line } from '../../../types';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';

// src/components/visualizer/hanabi/hanabiScreenBloom.ts
// 全屏辉光（纯数据）：运行时在整个场景层（所有段落场景，不含夜空底与片尾卡）上挂一个 bloom，强度 =
//   整体辉光（tuning.bloom，全曲常驻）+ 副歌辉光（tuning.chorusBloom）× 副歌权重。
// 副歌权重来自歌词行的副歌标记（Line.isChorus：歌词自带、平台的副歌区间或按重复歌词识别，见 utils/lyrics/chorusResolver.ts）：
// 相邻的副歌行并成一段，段前段后平滑亮起、收回，所以副歌里一直亮着、行与行之间不闪。

export interface HanabiChorusSpan {
    startTime: number;
    endTime: number;
}

/** 两段副歌之间空隙短于这么多秒就并成一段。 */
const CHORUS_MERGE_GAP = 1.5;
/** 副歌开始前多久开始亮、开始后多久亮满；结束前多久开始收、结束后多久收完（秒）。 */
const RAMP_IN_BEFORE = 0.5;
const RAMP_IN_AFTER = 0.3;
const RAMP_OUT_BEFORE = 0.2;
const RAMP_OUT_AFTER = 0.9;

/** 副歌行 → 副歌时段：一行从开始唱到下一行开始（最后一行到它的视觉结束），相邻的并起来。 */
export const resolveHanabiChorusSpans = (lines: readonly Line[]): HanabiChorusSpan[] => {
    const spans: HanabiChorusSpan[] = [];
    lines.forEach((line, index) => {
        if (!line.isChorus) return;
        const next = lines[index + 1];
        const endTime = next ? Math.max(line.startTime, next.startTime) : getLineRenderEndTime(line);
        const last = spans.at(-1);
        if (last && line.startTime - last.endTime < CHORUS_MERGE_GAP) last.endTime = Math.max(last.endTime, endTime);
        else spans.push({ startTime: line.startTime, endTime });
    });
    return spans;
};

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/** time 时刻的副歌权重 0..1（时段按时间排好）。 */
export const resolveHanabiChorusWeight = (spans: readonly HanabiChorusSpan[], time: number) => {
    let weight = 0;
    for (const span of spans) {
        if (time < span.startTime - RAMP_IN_BEFORE) break;
        if (time > span.endTime + RAMP_OUT_AFTER) continue;
        const rampIn = smooth((time - (span.startTime - RAMP_IN_BEFORE)) / (RAMP_IN_BEFORE + RAMP_IN_AFTER));
        const rampOut = 1 - smooth((time - (span.endTime - RAMP_OUT_BEFORE)) / (RAMP_OUT_BEFORE + RAMP_OUT_AFTER));
        weight = Math.max(weight, Math.min(rampIn, rampOut));
    }
    return weight;
};

/** 整体辉光 1 与副歌辉光 1 时 bloom 的强度（叠加）。 */
export const HANABI_SCREEN_BLOOM = {
    base: 0.45,
    chorus: 0.9,
} as const;

/** 这一帧全屏 bloom 的强度；为 0 时运行时把 filter 摘掉（一个挂着不用的 filter 也要多一次整屏离屏渲染）。 */
export const resolveHanabiScreenBloomStrength = (bloom: number, chorusBloom: number, chorusWeight: number) => (
    Math.max(0, bloom) * HANABI_SCREEN_BLOOM.base + Math.max(0, chorusBloom) * HANABI_SCREEN_BLOOM.chorus * chorusWeight
);
