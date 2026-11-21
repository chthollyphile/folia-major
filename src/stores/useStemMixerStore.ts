import { create } from 'zustand';

import { getStoredBoolean, getStoredString, setStoredBoolean, setStoredString } from './storagePrimitives';

// src/stores/useStemMixerStore.ts
// 分轨调音台的设置与状态：总开关、四条分轨（鼓、贝斯、其他、人声）的强度 0.0–2.0×，以及播放端此刻的状态
// （services/stemMixer/useStemMixer.ts 写，音效窗口的「分轨调音台」一节读）。
//
// 开关与强度存着，换歌不复位：伴奏、只听人声这类用法是一整段时间的，不是一首歌的。状态不存。
// 与 automix 互斥由播放端判断（automix 开着时调音台不接管，见 useStemMixer.ts），这里不去改 automix 的开关。

const STEM_MIXER_ENABLED_KEY = 'folia_stem_mixer_enabled';
const STEM_MIXER_GAINS_KEY = 'folia_stem_mixer_gains';

export const STEM_MIXER_GAIN_MIN = 0;
export const STEM_MIXER_GAIN_MAX = 2;
export const STEM_MIXER_GAIN_DEFAULT = 1;
/** 顺序同模型的四个音源。 */
export const STEM_MIXER_STEMS = ['drums', 'bass', 'other', 'vocals'] as const;
export type StemMixerStem = typeof STEM_MIXER_STEMS[number];
export type StemMixerGains = readonly [number, number, number, number];

export const DEFAULT_STEM_MIXER_GAINS: StemMixerGains = [1, 1, 1, 1];

export type StemMixerPreset = 'reset' | 'karaoke' | 'vocals';
export const STEM_MIXER_PRESETS: Record<StemMixerPreset, StemMixerGains> = {
    reset: DEFAULT_STEM_MIXER_GAINS,
    karaoke: [1, 1, 1, 0],
    vocals: [0, 0, 0, 1],
};

/**
 * 为什么调音台此刻不能用：automix 开着、HiFi 或外部播放器在放、这台机器的 GPU 分不了（没有 WebGPU 或模型、
 * 或本次会话里屏上分离太慢）。
 */
export type StemMixerBlock = 'automix' | 'hifi' | 'external' | 'noGpu' | 'tooSlow';

export type StemMixerStatus =
    | { phase: 'off' }
    | { phase: 'blocked'; block: StemMixerBlock }
    /** 开着，还没开始放（还没播放过，或这首没有可读的音频）。 */
    | { phase: 'waiting' }
    /** 正在分，播放头这里还没有分轨（放的是原曲）。 */
    | { phase: 'separating' }
    /** 播放头这里有分轨，调音台在起作用。 */
    | { phase: 'ready' }
    /** 分好了，但元素放的不是分离的那个音源（或不是 1.0× 速度）：放的是原曲。 */
    | { phase: 'notFollowing' }
    /** 超过调音台的时长上限（services/stemMixer/stemMixerTask.ts 的 STEM_MIXER_MAX_SECONDS）：不分。 */
    | { phase: 'tooLong' }
    /** 这首读不到或分不了，重试也没成：放的是原曲（跳转时再试）。 */
    | { phase: 'failed' };

export const clampStemMixerGain = (value: number): number => (
    Number.isFinite(value) ? Math.min(STEM_MIXER_GAIN_MAX, Math.max(STEM_MIXER_GAIN_MIN, Math.round(value * 100) / 100)) : STEM_MIXER_GAIN_DEFAULT
);

const readStoredGains = (): StemMixerGains => {
    try {
        const parsed: unknown = JSON.parse(getStoredString(STEM_MIXER_GAINS_KEY, ''));
        if (Array.isArray(parsed) && parsed.length === 4 && parsed.every(v => typeof v === 'number')) {
            return parsed.map(clampStemMixerGain) as unknown as StemMixerGains;
        }
    } catch { /* 没存过或坏了：默认 */ }
    return DEFAULT_STEM_MIXER_GAINS;
};

export type StemMixerState = {
    stemMixerEnabled: boolean;
    stemMixerGains: StemMixerGains;
    stemMixerStatus: StemMixerStatus;
    handleToggleStemMixer: (enable: boolean) => void;
    /** 拖动中：立刻听到，不存；松手时 `handleCommitStemMixerGains` 存下。 */
    handleSetStemMixerGain: (stem: StemMixerStem, value: number) => void;
    handleCommitStemMixerGains: () => void;
    handleApplyStemMixerPreset: (preset: StemMixerPreset) => void;
    setStemMixerStatus: (status: StemMixerStatus) => void;
};

const writeGains = (gains: StemMixerGains) => setStoredString(STEM_MIXER_GAINS_KEY, JSON.stringify(gains));

export const useStemMixerStore = create<StemMixerState>((set, get) => ({
    stemMixerEnabled: getStoredBoolean(STEM_MIXER_ENABLED_KEY, false),
    stemMixerGains: readStoredGains(),
    stemMixerStatus: { phase: 'off' },
    handleToggleStemMixer: (enable) => {
        setStoredBoolean(STEM_MIXER_ENABLED_KEY, enable);
        set({ stemMixerEnabled: enable });
    },
    handleSetStemMixerGain: (stem, value) => {
        const index = STEM_MIXER_STEMS.indexOf(stem);
        if (index < 0) return;
        const next = [...get().stemMixerGains] as [number, number, number, number];
        next[index] = clampStemMixerGain(value);
        set({ stemMixerGains: next });
    },
    handleCommitStemMixerGains: () => writeGains(get().stemMixerGains),
    handleApplyStemMixerPreset: (preset) => {
        const next = STEM_MIXER_PRESETS[preset];
        writeGains(next);
        set({ stemMixerGains: next });
    },
    setStemMixerStatus: (status) => {
        const before = get().stemMixerStatus;
        if (JSON.stringify(before) === JSON.stringify(status)) return;
        set({ stemMixerStatus: status });
    },
}));
