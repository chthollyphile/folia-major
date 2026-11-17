import { movingStemWindow, startStemReader, stemWholeFrom, type StemReader, type StemSource } from '../analysis/stemPass';
import { stemSegmentStarts } from '../analysis/stemRange';
import type { StemTask, StemTrack } from '../analysis/trackStemRun';

// src/services/stemMixer/stemMixerTask.ts
// 分轨调音台在一首歌的分轨运行（analysis/trackStemRun.ts）上的任务：鼓、贝斯、人声三条分轨各左右两个
// 声道的读取者，从播放头所在的段开始，读到下一段已有分轨处（或歌尾）为止。每段分完，六路一起转成 Int16
// 交给 `onStems`，由播放端送进 worklet（stemMixer.worklet.ts）。「其他」不读：worklet 用原曲减三轨得出。
//
// 使用方是 'stemMixer'：智能动感模式关着、或在看别的画面时，它照样让这首歌分下去；和鼓点、雾笺人声同在一趟
// 里时，一段只分一次。

export const STEM_MIXER_TASK = 'stem mixer';
/** 放进 worklet 的三条分轨，顺序同 worklet 的 stems（鼓、贝斯、人声）。 */
const PLAYED: readonly StemSource[] = ['drums', 'bass', 'vocals'];
const CHANNELS = ['left', 'right'] as const;
/** 与 worklet 的 STEM_SCALE 对应：按 ±2 满幅存。 */
const TO_INT16 = 32767 / 2;

export interface StemMixerSink {
    /** 解码好的整首（44.1 kHz）：原曲交给 worklet。每个任务都会调一次，已放进去的同一首可以忽略。 */
    onTrack: (track: StemTrack) => void;
    /** [from, to) 的三轨六声道，顺序：鼓 L/R、贝斯 L/R、人声 L/R。 */
    onStems: (from: number, to: number, data: Int16Array[]) => void;
}

/** 从第 `at` 个采样起分轨完整的最靠后的段：它前一段结束处不晚于 `at`。 */
export const segmentWholeAt = (total: number, at: number, starts = stemSegmentStarts(total)): number => {
    let from = 0;
    for (let i = 1; i < starts.length; i += 1) {
        if (stemWholeFrom(total, i) <= at) from = i;
        else break;
    }
    return from;
};

const toInt16 = (samples: Float32Array, from: number, to: number): Int16Array => {
    const out = new Int16Array(to - from);
    for (let i = 0; i < out.length; i += 1) {
        const v = Math.round(samples[from + i] * TO_INT16);
        out[i] = v > 32767 ? 32767 : v < -32767 ? -32767 : v;
    }
    return out;
};

/**
 * 读 [`fromSample`, `untilSample`) 的分轨的任务。答案是分到了第几个采样（停下时是停在哪）。
 * 读到 `untilSample` 以后就把读取者都标成读完，任务从 finish 答出，这首歌的运行若无人再要就停。
 */
export const stemMixerTask = (fromSample: number, untilSample: number, sink: StemMixerSink): StemTask<number> => ({
    kind: STEM_MIXER_TASK,
    claimant: 'stemMixer',
    open: (track) => {
        sink.onTrack(track);
        const total = track.left.length;
        const starts = stemSegmentStarts(total);
        const from = segmentWholeAt(total, fromSample, starts);
        const start = startStemReader(total, from);
        const until = Math.min(total, untilSample);
        let reached = start.divided;
        const chunks: Int16Array[] = [];
        const readers: StemReader[] = [];
        PLAYED.forEach((source) => CHANNELS.forEach((channel) => {
            const index = readers.length;
            const reader: StemReader = {
                source,
                channel,
                ...startStemReader(total, from),
                window: movingStemWindow(total, from, 0),
                read: (final) => {
                    const { samples, base } = reader.window;
                    const begin = Math.max(reached, base);
                    chunks[index] = toInt16(samples, begin - base, final - base);
                    if (index === readers.length - 1) {
                        sink.onStems(begin, final, chunks.splice(0));
                        reached = final;
                        // 读到下一段已有的地方：都算读完，从 finish 答出。
                        if (final >= until) for (const each of readers) each.next = starts.length;
                    }
                    return final;
                },
            };
            readers.push(reader);
        }));
        return {
            readers,
            finish: async () => reached,
            stop: async () => reached,
        };
    },
});
