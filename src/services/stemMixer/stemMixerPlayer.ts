import type { AutomixDeckChain } from '../automix/crossfadeGraph';
import workletUrl from './stemMixer.worklet.ts?worker&url';

// src/services/stemMixer/stemMixerPlayer.ts
// 分轨调音台的播放端（主线程）：把 worklet（stemMixer.worklet.ts）接进正在放的那个 deck，代替元素发声。
//
// 接法：deck 的 MediaElementSource 原本直连 replayGain，这里在两者之间插一个闸（elementGate），worklet
// 也接到 replayGain 上。这样 ReplayGain / 智能平衡、deck 自己的 trim、音色、fade，再往后的均衡器、音效、
// 音量都照常作用在调音台的输出上，和元素发声时是同一个播放器。闸平时是 1（完全透明），调音台接管时是 0，
// 交接 8 ms（与 automix 分轨交接的 SPLICE_SEC 相同）。
//
// 元素仍然在放，只是听不见：它是时钟。歌词、进度条、画面都还跟着它走；worklet 跟着它的事件起停——播放、
// 暂停、跳转、缓冲、换歌——并每半秒对一次位置，差出 60 ms 就重新对齐。播放速度不是 1.0 时交回元素（worklet
// 不做保持音高的变速）。
//
// 只在 worklet 里放着的正是元素这首歌时接管：载入时记下元素的 src，两者对不上（换歌了、换了音源）就交回元素。

/** 起播提前量：消息到 worklet 要一个 quantum 左右，留足。 */
const LEAD_SEC = 0.04;
const SPLICE_SEC = 0.008;
const DRIFT_SEC = 0.06;
const CHECK_MS = 500;
const STEM_RATE = 44100;

const modules = new WeakMap<BaseAudioContext, Promise<void>>();
const gates = new WeakMap<AutomixDeckChain, GainNode>();

/** 在 deck 的元素与 replayGain 之间插一个闸（每个 deck 一次，之后一直在那里，平时是 1）。 */
const gateFor = (context: AudioContext, chain: AutomixDeckChain): GainNode => {
    const existing = gates.get(chain);
    if (existing) return existing;
    const gate = context.createGain();
    gate.gain.value = 1;
    chain.source.disconnect(chain.replayGain);
    chain.source.connect(gate).connect(chain.replayGain);
    gates.set(chain, gate);
    return gate;
};

const rampTo = (context: AudioContext, param: AudioParam, value: number, at: number) => {
    const when = Math.max(at, context.currentTime);
    param.cancelScheduledValues(when);
    param.setValueAtTime(param.value, when);
    param.linearRampToValueAtTime(value, when + SPLICE_SEC);
};

export interface StemMixerLoad {
    key: string;
    /** 元素当时的 src：对不上就不接管。 */
    src: string;
    left: Float32Array;
    right: Float32Array;
}

export interface StemMixerPlayer {
    /** 放进 worklet 的那首（null 为没有）。 */
    loadedKey: () => string | null;
    load: (load: StemMixerLoad) => void;
    addStems: (from: number, to: number, data: Int16Array[]) => void;
    /** 已有分轨的区间（44.1 kHz 采样）。 */
    covered: () => ReadonlyArray<readonly [number, number]>;
    setGains: (gains: readonly number[]) => void;
    /** 接到这个 deck、跟着这个元素（换 deck 时再调一次）；null 交回元素。 */
    follow: (chain: AutomixDeckChain | null, element: HTMLMediaElement | null) => void;
    /** 元素此刻的位置（44.1 kHz 采样），没有元素时为 null。 */
    playhead: () => number | null;
    unload: () => void;
    dispose: () => void;
}

const mixToInt16 = (samples: Float32Array): Int16Array => {
    const out = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
        const v = Math.round(samples[i] * 32767);
        out[i] = v > 32767 ? 32767 : v < -32767 ? -32767 : v;
    }
    return out;
};

/** 在这个 AudioContext 上建调音台的播放端；worklet 模块载入失败时答 null（调音台不可用）。 */
export const createStemMixerPlayer = async (context: AudioContext): Promise<StemMixerPlayer | null> => {
    let ready = modules.get(context);
    if (!ready) {
        ready = context.audioWorklet.addModule(workletUrl);
        modules.set(context, ready);
    }
    try {
        await ready;
    } catch (error) {
        console.warn('[StemMixer] worklet could not load', error);
        return null;
    }
    const node = new AudioWorkletNode(context, 'folia-stem-mixer', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    let loaded: { key: string; src: string; total: number } | null = null;
    let ranges: Array<[number, number]> = [];
    let chain: AutomixDeckChain | null = null;
    let element: HTMLMediaElement | null = null;
    /** 闸此刻是否关着（worklet 在发声）。 */
    let engaged = false;
    let sounding = false;
    let lastReport: { position: number; time: number } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    /** 每次起播加一；worklet 的位置报告带着它，旧的不算（跳转后晚到的会被当成走偏）。 */
    let seq = 0;
    node.port.onmessage = (event: MessageEvent<{ type: string; position: number; time: number; seq: number }>) => {
        if (event.data.type === 'position' && event.data.seq === seq) lastReport = { position: event.data.position, time: event.data.time };
    };

    const post = (message: unknown, transfer: Transferable[] = []) => node.port.postMessage(message, transfer);

    /** 元素这首正是放进 worklet 的那首，且能由 worklet 放。 */
    const matches = () => Boolean(
        loaded && element && chain
        && (element.currentSrc || element.getAttribute('src')) === loaded.src
        && element.playbackRate === 1
        && (!Number.isFinite(element.duration) || Math.abs(element.duration - loaded.total / STEM_RATE) < 1),
    );

    const stopSounding = () => {
        if (sounding) post({ type: 'stop' });
        sounding = false;
        lastReport = null;
    };

    /** 从元素此刻的位置起播（提前 LEAD_SEC 算好那时它在哪）。 */
    const startSounding = () => {
        if (!element || !loaded) return;
        const at = context.currentTime + LEAD_SEC;
        const media = element.currentTime + LEAD_SEC * element.playbackRate;
        const speed = STEM_RATE / context.sampleRate;
        const raw = media * STEM_RATE;
        seq += 1;
        post({ type: 'play', position: speed === 1 ? Math.round(raw) : raw, at, speed, seq });
        sounding = true;
        lastReport = null;
        return at;
    };

    /** 按元素现在的状态：该接管就接管、该起播就起播；对不上就交回元素。 */
    const sync = () => {
        if (!chain) return;
        const gate = gateFor(context, chain);
        if (!matches()) {
            stopSounding();
            if (engaged) rampTo(context, gate.gain, 1, context.currentTime);
            engaged = false;
            return;
        }
        const running = element && !element.paused && !element.ended && !element.seeking && element.readyState >= 3;
        if (!running) {
            stopSounding();
            // 暂停时也关着闸：恢复播放时由 worklet 接上，不先漏出一下原曲。
            if (!engaged) rampTo(context, gate.gain, 0, context.currentTime);
            engaged = true;
            return;
        }
        if (sounding) return;
        const at = startSounding();
        if (at === undefined) return;
        if (!engaged) rampTo(context, gate.gain, 0, at);
        engaged = true;
    };

    /** 半秒一次：worklet 报的位置与元素差出 DRIFT_SEC 就重新起播。 */
    const check = () => {
        if (!sounding || !lastReport || !element) {
            sync();
            return;
        }
        const now = context.currentTime;
        const ours = (lastReport.position + (now - lastReport.time) * STEM_RATE) / STEM_RATE;
        if (Math.abs(ours - element.currentTime) > DRIFT_SEC) {
            stopSounding();
            sync();
        }
    };

    const events = ['play', 'playing', 'pause', 'waiting', 'stalled', 'seeking', 'seeked', 'ratechange', 'ended', 'emptied', 'loadstart', 'canplay'];
    const onEvent = (event: Event) => {
        // 跳转、缓冲：先停，等能放了再按新位置起播。
        if (event.type === 'seeking' || event.type === 'waiting' || event.type === 'emptied' || event.type === 'loadstart') stopSounding();
        sync();
    };

    const follow: StemMixerPlayer['follow'] = (nextChain, nextElement) => {
        if (nextChain !== chain || nextElement !== element) {
            // 交回原来那个 deck。
            stopSounding();
            if (chain && engaged) rampTo(context, gateFor(context, chain).gain, 1, context.currentTime);
            engaged = false;
            if (element) for (const type of events) element.removeEventListener(type, onEvent);
            node.disconnect();
            chain = nextChain;
            element = nextElement;
            if (chain && element) {
                node.connect(chain.replayGain);
                for (const type of events) element.addEventListener(type, onEvent);
            }
        }
        if (chain && element && timer === null) timer = setInterval(check, CHECK_MS);
        if ((!chain || !element) && timer !== null) {
            clearInterval(timer);
            timer = null;
        }
        sync();
    };

    // 开发时在控制台看得到接管状态（CDP 验证用）；打包后没有。
    if (import.meta.env.DEV) {
        (window as unknown as Record<string, unknown>).__foliaStemMixer = {
            node,
            state: () => ({
                loaded, engaged, sounding, lastReport, ranges,
                gate: chain ? gateFor(context, chain).gain.value : null,
                element: element ? { time: element.currentTime, paused: element.paused } : null,
            }),
        };
    }

    const unload = () => {
        stopSounding();
        loaded = null;
        ranges = [];
        post({ type: 'unload' });
        sync();
    };

    return {
        loadedKey: () => loaded?.key ?? null,
        load: ({ key, src, left, right }) => {
            stopSounding();
            const mixL = mixToInt16(left);
            const mixR = mixToInt16(right);
            loaded = { key, src, total: left.length };
            ranges = [];
            post({ type: 'load', total: left.length, mixL, mixR }, [mixL.buffer, mixR.buffer]);
            sync();
        },
        addStems: (from, to, data) => {
            if (!loaded) return;
            ranges.push([from, to]);
            ranges.sort((a, b) => a[0] - b[0]);
            const merged: Array<[number, number]> = [];
            for (const range of ranges) {
                const last = merged[merged.length - 1];
                if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
                else merged.push([range[0], range[1]]);
            }
            ranges = merged;
            post({ type: 'stems', from, to, data }, data.map(chunk => chunk.buffer));
        },
        covered: () => ranges,
        setGains: gains => post({ type: 'gains', gains: [...gains] }),
        follow,
        playhead: () => (element ? Math.round(element.currentTime * STEM_RATE) : null),
        unload,
        dispose: () => {
            follow(null, null);
            post({ type: 'unload' });
            loaded = null;
        },
    };
};
