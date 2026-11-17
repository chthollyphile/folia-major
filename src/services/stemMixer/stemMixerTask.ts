import { movingStemWindow, startStemReader, stemWholeFrom, type StemReader, type StemSource } from '../analysis/stemPass';
import { stemSegmentStarts } from '../analysis/stemRange';
import type { StemTask, StemTrack } from '../analysis/trackStemRun';

// src/services/stemMixer/stemMixerTask.ts
// 分轨调音台在一首歌的分轨运行（analysis/trackStemRun.ts）上的任务：鼓、贝斯、人声三条分轨各左右两个
// 声道的读取者，从给定的位置一直读到歌尾。每段分完，原曲与三轨共八个声道一起转成 Int16（在主线程分配好），
// 交给 `onChunk`，由播放端转交 worklet（stemMixer.worklet.ts）。「其他」不读：worklet 用原曲减三轨得出。
//
// 只分播放头前面一段：`held` 答 true（已分到的地方离播放头够远）时读取者被跳过，同一趟里别的读取者
// （智能动感模式的鼓点）照走，只剩它时这一趟等着。读取者是 urgent 的：和鼓点同在一趟、鼓点落在后面时，
// 先分这里要的（马上要听到的），不排在鼓点后面。
//
// 使用方是 'stemMixer'：智能动感模式关着、或在看别的画面时，它照样让这首歌分下去。和鼓点同在一趟里、两边
// 正好在同一段时一段只分一次；它 held 时鼓点往前走，之后它走到的段多半要再分一次。

export const STEM_MIXER_TASK = 'stem mixer';
/** 放进 worklet 的三条分轨，顺序同 worklet 的块（原曲之后：鼓、贝斯、人声）。 */
const PLAYED: readonly StemSource[] = ['drums', 'bass', 'vocals'];
const CHANNELS = ['left', 'right'] as const;
/** 与 worklet 的 SCALE 对应：按 ±2 满幅存。 */
const TO_INT16 = 32767 / 2;

export interface StemMixerSink {
    /** 解码好的整首（44.1 kHz）。 */
    onTrack: (track: StemTrack) => void;
    /** [from, to) 的一块，顺序：原曲 L/R、鼓 L/R、贝斯 L/R、人声 L/R。 */
    onChunk: (from: number, to: number, data: Int16Array[]) => void;
    /** 已分到第 `reached` 个采样：此刻还要不要接着分（false 时跳过，过一会儿再问）。 */
    held: (reached: number) => boolean;
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

/** 从第 `fromSample` 个采样读到歌尾的任务。答案是分到了第几个采样（停下时是停在哪）。 */
export const stemMixerTask = (fromSample: number, sink: StemMixerSink): StemTask<number> => ({
    kind: STEM_MIXER_TASK,
    claimant: 'stemMixer',
    open: (track) => {
        sink.onTrack(track);
        const total = track.left.length;
        const from = segmentWholeAt(total, fromSample);
        let reached = startStemReader(total, from).divided;
        const chunks: Int16Array[] = [];
        const readers: StemReader[] = [];
        const held = () => sink.held(reached);
        PLAYED.forEach((source) => CHANNELS.forEach((channel) => {
            const index = readers.length;
            const reader: StemReader = {
                source,
                channel,
                urgent: true,
                held,
                ...startStemReader(total, from),
                window: movingStemWindow(total, from, 0),
                read: (final) => {
                    const { samples, base } = reader.window;
                    const begin = Math.max(reached, base);
                    chunks[index] = toInt16(samples, begin - base, final - base);
                    if (index === readers.length - 1) {
                        sink.onChunk(begin, final, [toInt16(track.left, begin, final), toInt16(track.right, begin, final), ...chunks.splice(0)]);
                        reached = final;
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
