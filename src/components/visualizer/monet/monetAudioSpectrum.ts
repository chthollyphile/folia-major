// Samples Monet's audio response without changing the shared analyser data.
export const MONET_AUDIO_BAR_COUNT = 72;
const MIN_RAW_SPECTRUM_BIN = 6;

export interface MonetAudioFrame {
    spectrum: Float32Array;
    energy: number;
    time: number;
}

const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export const resolveMonetAudioGain = (gain: number) => Number.isFinite(gain)
    ? Math.max(0.5, Math.min(2, gain))
    : 1;

const buildSpectrumAnchors = (bands: readonly number[]) => {
    const [bass = 0, lowMid = 0, mid = 0, vocal = 0, treble = 0] = bands;
    return [
        bass * 1.08,
        bass * 0.96,
        bass * 0.74 + lowMid * 0.26,
        lowMid,
        lowMid * 0.58 + mid * 0.42,
        mid,
        mid * 0.42 + vocal * 0.58,
        vocal,
        vocal * 0.48 + treble * 0.52,
        treble,
        treble * 0.82,
    ].map(clampUnit);
};

const sampleSpectrumProfile = (anchors: number[], normalizedIndex: number) => {
    const clampedIndex = clampUnit(normalizedIndex);
    const logIndex = Math.log10(1 + clampedIndex * 9);
    const scaledIndex = logIndex * (anchors.length - 1);
    const lowerIndex = Math.floor(scaledIndex);
    const upperIndex = Math.min(lowerIndex + 1, anchors.length - 1);
    const interpolation = scaledIndex - lowerIndex;
    const lowerValue = anchors[lowerIndex] ?? 0;
    const upperValue = anchors[upperIndex] ?? lowerValue;
    const interpolated = lowerValue + (upperValue - lowerValue) * interpolation;

    // Add a fuller contour so the profile reads like a continuous response curve.
    const contour =
        0.92 +
        Math.sin(clampedIndex * Math.PI * 3.4 - Math.PI * 0.3) * 0.08 +
        Math.sin(clampedIndex * Math.PI * 9.2 + Math.PI * 0.2) * 0.035;
    return clampUnit(interpolated * contour);
};

const sampleRawSpectrumProfile = (rawSpectrum: Uint8Array, normalizedIndex: number) => {
    const clampedIndex = clampUnit(normalizedIndex);
    const usableBinCount = Math.max(1, rawSpectrum.length - MIN_RAW_SPECTRUM_BIN);
    const mappedIndex = Math.expm1(clampedIndex * Math.log(usableBinCount + 1));
    const centerIndex = MIN_RAW_SPECTRUM_BIN + mappedIndex;
    const edgeSoftness = 1 - Math.abs(clampedIndex - 0.5) * 2;
    const windowRadius = Math.max(1, Math.round(5 - edgeSoftness * 3));
    const start = Math.max(MIN_RAW_SPECTRUM_BIN, Math.floor(centerIndex - windowRadius));
    const end = Math.min(rawSpectrum.length - 1, Math.ceil(centerIndex + windowRadius));

    let weightedSum = 0;
    let weightTotal = 0;
    for (let index = start; index <= end; index += 1) {
        const distance = Math.abs(index - centerIndex);
        const weight = Math.max(0.1, 1 - distance / (windowRadius + 1));
        weightedSum += rawSpectrum[index] * weight;
        weightTotal += weight;
    }

    const averaged = weightTotal > 0 ? weightedSum / weightTotal : 0;

    // Dynamic noise floor based on frequency (higher noise subtraction for lower frequencies)
    const noiseFloor = 16 + (1 - clampedIndex) * 12;
    const normalized = clampUnit((averaged - noiseFloor) / (255 - noiseFloor));

    // Power compression to suppress quiet/humming baseline and increase visual peaks (contrast)
    const power = 1.8 + (1 - clampedIndex) * 0.4;
    const processed = Math.pow(normalized, power);

    const lowFrequencyCompensation = 0.52 + clampedIndex * 0.62;
    const presenceLift = 0.92 + Math.sqrt(clampedIndex) * 0.14;
    return clampUnit(processed * lowFrequencyCompensation * presenceLift);
};

// Reuse the destination buffer so the live canvas can retain its last frame when paused.
export const sampleMonetSpectrum = (
    bands: readonly number[],
    rawSpectrum?: Uint8Array,
    target: Float32Array = new Float32Array(MONET_AUDIO_BAR_COUNT),
) => {
    const hasRawSpectrum = rawSpectrum && rawSpectrum.length > MIN_RAW_SPECTRUM_BIN;
    const anchors = hasRawSpectrum ? [] : buildSpectrumAnchors(bands);
    for (let index = 0; index < target.length; index += 1) {
        const normalizedIndex = index / Math.max(1, target.length - 1);
        target[index] = hasRawSpectrum
            ? sampleRawSpectrumProfile(rawSpectrum, normalizedIndex)
            : sampleSpectrumProfile(anchors, normalizedIndex);
    }
    return target;
};
