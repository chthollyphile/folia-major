import { gpuStemsOnScreenUsable, gpuStemsUsable } from '../analysis/beatThisGpu';
import { modelCanRun } from '../analysis/modelAvailability';
import type { StemMixerBlock } from '../../stores/useStemMixerStore';

// src/services/stemMixer/stemMixerAvailability.ts
// 分轨调音台能不能在这台机器上用：只走 GPU（htdemucs_gpu + WebGPU），不退到 CPU——CPU 版能跑但会持续占满
// 几个核，第一版不做。音效窗口置灰、命令面板的可用性与播放端是同一个判断。

/** 这台机器的 GPU 分不了，或本次会话里屏上分离太慢（beatThisGpu.ts）；能用时为 null。 */
export const stemMixerDeviceBlock = (): StemMixerBlock | null => {
    const canRun = typeof window !== 'undefined'
        && typeof window.electron?.getHtdemucsGpuWeights === 'function'
        && typeof navigator !== 'undefined' && 'gpu' in navigator
        && modelCanRun('htdemucs_gpu')
        && gpuStemsUsable();
    if (!canRun) return 'noGpu';
    return gpuStemsOnScreenUsable() ? null : 'tooSlow';
};

/** 此刻为什么不能用（先看机器，再看 automix 与播放路线）；能用时为 null。 */
export const stemMixerBlock = ({ automix, hifi, external }: { automix: boolean; hifi: boolean; external: boolean }): StemMixerBlock | null => (
    stemMixerDeviceBlock() ?? (automix ? 'automix' : hifi ? 'hifi' : external ? 'external' : null)
);
