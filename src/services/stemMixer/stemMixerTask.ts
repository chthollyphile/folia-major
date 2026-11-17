import { movingStemWindow, startStemReader, stemWholeFrom, type StemReader, type StemSource } from '../analysis/stemPass';
import { stemSegmentStarts } from '../analysis/stemRange';
import type { StemTask, StemTrack } from '../analysis/trackStemRun';

// src/services/stemMixer/stemMixerTask.ts
// 分轨调音台在一首歌的分轨运行（analysis/trackStemRun.ts）上的任务：鼓、贝斯、人声三条分轨各左右两个
// 声道的读取者，从给定的位置一直读到歌尾。每段分完，原曲与三轨共八个声道一起转成 Int16（在主线程分配好），
// 交给 `onChunk`，由播放端转交 worklet（stemMixer.worklet.ts）。「其他」不读：worklet 用原曲减三轨得出。
//
// 只分播放头前面一段：`held` 答 true（已分到的地方离播放头够远）时读取者被跳过，同一趟里别的读取者
// （智能动感模式的鼓点）照走，只剩它时这一趟等着。离播放头不到几秒时读取者是 urgent 的：和鼓点同在一趟、
// 鼓点落在后面时先分这里要的（马上要听到的），不排在鼓点后面；领先够了就和鼓点按段号轮着来，慢 GPU 上
// 也不会让鼓点一直等。读取者 paces：鼓点不跑到它前面去（它 held 时鼓点也停在它下一段之前），两边都要的段
// 只分一次；整首的鼓点因此要等播放快到尾才齐，中途切走的歌下次从断点接着分。
//
// 超过 STEM_MIXER_MAX_SECONDS 的歌不分（答 'tooLong'）：调音台开着时整首的解码要一直留着。sink 出错只算
// 这个任务的事（停在出错的地方），不连累同一趟里别人的分离。
//
// 使用方是 'stemMixer'：智能动感模式关着、或在看别的画面时，它照样让这首歌分下去。

export const STEM_MIXER_TASK = 'stem mixer';
/** 放进 worklet 的三条分轨，顺序同 worklet 的块（原曲之后：鼓、贝斯、人声）。 */
const PLAYED: readonly StemSource[] = ['drums', 'bass', 'vocals'];
const CHANNELS = ['left', 'right'] as const;
/** 与 worklet 的 SCALE 对应：按 ±2 满幅存。 */
const TO_INT16 = 32767 / 2;
/** 调音台分的最长的歌：解码（每分钟约 21 MB）要留到放完。 */
export const STEM_MIXER_MAX_SECONDS = 20 * 60;

export interface StemMixerSink {
    /** 解码好的整首（44.1 kHz）。 */
    onTrack: (track: StemTrack) => void;
    /** [from, to) 的一块，顺序：原曲 L/R、鼓 L/R、贝斯 L/R、人声 L/R。答 false：没收下（不算分到了这里）。 */
    onChunk: (from: number, to: number, data: Int16Array[]) => boolean;
    /** 已分到第 `reached` 个采样：此刻先不分（跳过，过一会儿再问）。 */
    held: (reached: number) => boolean;
    /** 已分到第 `reached` 个采样：此刻要不要排在别人前面。 */
    urgent: (reached: number) => boolean;
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

/** 从第 `fromSample` 个采样读到歌尾的任务。答案是分到了第几个采样（停下时是停在哪），太长的歌答 'tooLong'。 */
export const stemMixerTask = (fromSample: number, sink: StemMixerSink): StemTask<number | 'tooLong'> => ({
    kind: STEM_MIXER_TASK,
    claimant: 'stemMixer',
    open: (track) => {
        const total = track.left.length;
        // 没有读取者：下一轮就从 finish 答出。
        if (total > STEM_MIXER_MAX_SECONDS * 44100) return { readers: [], finish: () => Promise.resolve('tooLong' as const), stop: () => Promise.resolve('tooLong' as const) };
        sink.onTrack(track);
        const from = segmentWholeAt(total, fromSample);
        let reached = startStemReader(total, from).divided;
        const chunks: Int16Array[] = [];
        const readers: StemReader[] = [];
        /** 出过错：都算读完，任务从 finish 答出停在哪。 */
        let broken = false;
        const guard = <T>(fallback: T, call: () => T): T => {
            if (broken) return fallback;
            try {
                return call();
            } catch (error) {
                console.warn('[StemMixer] task sink failed', error);
                broken = true;
                return fallback;
            }
        };
        const held = () => guard(false, () => sink.held(reached));
        const urgent = () => guard(false, () => sink.urgent(reached));
        PLAYED.forEach((source) => CHANNELS.forEach((channel) => {
            const index = readers.length;
            const reader: StemReader = {
                source,
                channel,
                urgent,
                held,
                paces: true,
                ...startStemReader(total, from),
                window: movingStemWindow(total, from, 0),
                read: (final) => {
                    const { samples, base } = reader.window;
                    const begin = Math.max(reached, base);
                    chunks[index] = toInt16(samples, begin - base, final - base);
                    if (index === readers.length - 1) {
                        const data = [toInt16(track.left, begin, final), toInt16(track.right, begin, final), ...chunks.splice(0)];
                        if (guard(false, () => sink.onChunk(begin, final, data))) reached = final;
                        if (broken) for (const each of readers) each.next = Number.MAX_SAFE_INTEGER;
                    }
                    return final;
                },
            };
            readers.push(reader);
        }));
        return {
            readers,
            finish: () => Promise.resolve(reached),
            stop: () => Promise.resolve(reached),
        };
    },
});
