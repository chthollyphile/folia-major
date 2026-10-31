// src/components/floating-player/playerBarWave.ts
// 浮动播放条底边「水面波形」的纯计算：频谱 → 每列能量 → 水面高度。
//
// 这里全是纯函数，不碰 DOM：canvas 的绘制在 PlayerBarGlow.tsx 里，方便单测钉住形状。

/** 分析器每个 bin 的频率间隔（Hz）：44100 / 2048，和播放桥里算频段能量时同一个口径。 */
const HZ_PER_BIN = 21.5;

/** 取样的频率范围：40Hz（底鼓）到 12kHz（齿音）。 */
const MIN_HZ = 40;
const MAX_HZ = 12000;

/** 横向取样的列数。固定值：胶囊宽度变了也不重新定义形状，只是把同样的形状铺开或压扁。 */
export const WAVE_COLUMN_COUNT = 128;

/**
 * 把频谱按对数频率切成 count 列，每列取该频段的均值（0..1）。
 *
 * 对数切分：低频在听感上占的分量比它在频谱上占的宽度大得多，等宽切分会让左边一坨、右边全平。
 */
export function sampleSpectrumColumns(
    spectrum: Uint8Array | null | undefined,
    count: number = WAVE_COLUMN_COUNT,
    out: Float32Array = new Float32Array(count),
): Float32Array {
    out.fill(0);
    if (!spectrum || spectrum.length === 0 || count <= 0) return out;

    const binCount = spectrum.length;
    const ratio = MAX_HZ / MIN_HZ;
    // 每一列的频率上界（列 i 的上界就是列 i+1 的下界），逐列推进。
    let startBin = MIN_HZ / HZ_PER_BIN;

    for (let index = 0; index < count; index += 1) {
        const upperRatio = count === 1 ? 1 : (index + 1) / (count - 1);
        const endHz = MIN_HZ * Math.pow(ratio, upperRatio);
        let endBin = endHz / HZ_PER_BIN;
        if (index === count - 1) endBin = binCount;

        const from = Math.min(binCount - 1, Math.max(0, Math.floor(startBin)));
        const to = Math.min(binCount - 1, Math.max(from, Math.ceil(endBin) - 1));

        let sum = 0;
        for (let bin = from; bin <= to; bin += 1) {
            sum += spectrum[bin];
        }
        const countInBand = to - from + 1;
        // 开方：把频谱偏低的那一截提起来一点，水面才不会一直趴在底部。
        out[index] = Math.pow(sum / countInBand / 255, 0.8);

        startBin = endBin;
    }

    return out;
}

/**
 * 逐列的时间平滑：上升快、回落慢，跟得上鼓点又不会一闪一闪。
 * 速率按 60fps 归一，所以掉帧时水面也不会变快。
 */
export function smoothColumns(
    smoothed: Float32Array,
    raw: Float32Array,
    dt: number,
    attack: number,
    release: number,
): Float32Array {
    const step = Math.min(1, dt * 60);
    for (let index = 0; index < smoothed.length; index += 1) {
        const target = raw[index];
        const current = smoothed[index];
        const rate = target > current ? attack : release;
        smoothed[index] = current + (target - current) * Math.min(1, rate * step);
    }
    return smoothed;
}

export type WaveShapeOptions = {
    /** 流动的时间（秒）：水面波纹按它往前跑。 */
    time: number;
    /** 水面最高能到多高（px）。 */
    maxHeight: number;
    /** 波纹的整体幅度倍率。 */
    rippleScale?: number;
};

/**
 * 由每列能量算出水面高度（px，从底边往上算）。
 *
 * 高度 = 频谱能量撑起的主体 + 一层往右流动的正弦波纹。波纹幅度跟着当地能量走：
 * 安静的地方水面几乎是平的，响的地方才翻涌，这样读起来是「水在动」而不是「噪声在抖」。
 */
export function computeWaveHeights(
    energy: Float32Array,
    options: WaveShapeOptions,
): Float32Array {
    const { time, maxHeight } = options;
    const rippleScale = options.rippleScale ?? 1;
    const count = energy.length;
    const heights = new Float32Array(count);
    if (count === 0 || maxHeight <= 0) return heights;

    for (let index = 0; index < count; index += 1) {
        const x = count === 1 ? 0 : index / (count - 1);
        // 横向再抹一遍：频谱的尖峰直接用会是一根根硬刺，抹成鼓包才像水。
        const previous = energy[Math.max(0, index - 1)];
        const next = energy[Math.min(count - 1, index + 1)];
        const local = (previous + 2 * energy[index] + next) / 4;

        const ripple =
            0.55 * Math.sin(x * 8.6 - time * 1.8) +
            0.30 * Math.sin(x * 15.2 + time * 1.15 + 1.7) +
            0.15 * Math.sin(x * 26.3 - time * 2.4 + 0.6);

        // 安静处波纹收得很小，响的地方才放得开。
        const flow = 0.22 + 0.78 * local;
        const height = maxHeight * (0.88 * local + ripple * flow * 0.28 * rippleScale);

        heights[index] = Math.min(maxHeight * 1.1, Math.max(0, height));
    }

    return heights;
}

/** 主题强调色读不到时的兜底（和 CSS 里的默认值一致）。 */const FALLBACK_ACCENT = { r: 253, g: 92, b: 71 };

/**
 * 把主题强调色解析成 rgb 分量，canvas 只认具体颜色，不认 var() 和 color-mix()。
 * 认不出来的写法退回兜底色，不让水面整片变成透明。
 */
export function parseAccentColor(value: string | null | undefined): { r: number; g: number; b: number } {
    const raw = (value ?? "").trim();
    if (!raw) return FALLBACK_ACCENT;

    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
    if (hex) {
        const digits = hex[1];
        if (digits.length === 3) {
            return {
                r: parseInt(digits[0] + digits[0], 16),
                g: parseInt(digits[1] + digits[1], 16),
                b: parseInt(digits[2] + digits[2], 16),
            };
        }
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
        };
    }

    const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(raw);
    if (rgb) {
        return {
            r: Math.round(Number(rgb[1])),
            g: Math.round(Number(rgb[2])),
            b: Math.round(Number(rgb[3])),
        };
    }

    return FALLBACK_ACCENT;
}

/** 全部列的平均能量，用作整层光的强度。 */
export function averageEnergy(energy: Float32Array): number {
    if (energy.length === 0) return 0;
    let sum = 0;
    for (let index = 0; index < energy.length; index += 1) {
        sum += energy[index];
    }
    return sum / energy.length;
}

/** 一维格点上的伪随机值（0..1），用来做噪声。 */
const latticeNoise = (index: number): number => {
    const hashed = Math.sin(index * 127.1) * 43758.5453;
    return hashed - Math.floor(hashed);
};

const smoothStep = (value: number): number => value * value * (3 - 2 * value);

/** 一维值噪声：格点之间做平滑插值，输出 0..1 的连续曲线。 */
const valueNoise = (time: number, seed: number): number => {
    const cell = Math.floor(time);
    const fraction = smoothStep(time - cell);
    const from = latticeNoise(cell + seed);
    const to = latticeNoise(cell + 1 + seed);
    return from + (to - from) * fraction;
};

/**
 * 圆心的横向漂移（-1..1）：连续的、带随机味道的往复移动。
 *
 * 用一维值噪声而不是正弦：正弦是规规矩矩的摆动，看得出周期；噪声的快慢不均匀，
 * 才像光源自己在慢慢晃。两个八度叠起来，慢的一层管大范围游走，快的一层给它加零碎。
 */
export function driftOffset(time: number): number {
    const slow = valueNoise(time * 0.11, 0);
    const fast = valueNoise(time * 0.37, 57);
    const combined = (slow - 0.5) * 1.6 + (fast - 0.5) * 0.7;
    return Math.min(1, Math.max(-1, combined));
}
