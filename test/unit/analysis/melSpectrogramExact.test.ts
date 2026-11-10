import { describe, expect, it } from 'vitest';
import { melSpectrogram } from '@/services/analysis/beatThis';

// test/unit/analysis/melSpectrogramExact.test.ts
// The mel spectrogram skips the zero weights of each band and permutes the FFT from a table. Both
// are only allowed because the answer is bit for bit what the plain version gave - the checkpoint
// was verified against that, and a spectrogram that is merely close is how a beat grid drifts with
// nothing in the log. This is that plain version, kept here as the reference.

const N_FFT = 1024;
const HOP = 441;
const N_MELS = 128;
const SR = 22050;

const referenceFft = (real: Float64Array, imag: Float64Array) => {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const angle = (-2 * Math.PI) / len;
        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let curReal = 1;
            let curImag = 0;
            for (let k = 0; k < len / 2; k += 1) {
                const aReal = real[i + k];
                const aImag = imag[i + k];
                const bReal = real[i + k + len / 2] * curReal - imag[i + k + len / 2] * curImag;
                const bImag = real[i + k + len / 2] * curImag + imag[i + k + len / 2] * curReal;
                real[i + k] = aReal + bReal;
                imag[i + k] = aImag + bImag;
                real[i + k + len / 2] = aReal - bReal;
                imag[i + k + len / 2] = aImag - bImag;
                const nextReal = curReal * wReal - curImag * wImag;
                curImag = curReal * wImag + curImag * wReal;
                curReal = nextReal;
            }
        }
    }
};

const hzToMel = (hz: number) => (hz < 1000 ? hz / (200 / 3) : 1000 / (200 / 3) + Math.log(hz / 1000) / (Math.log(6.4) / 27));
const melToHz = (mel: number) => (mel < 1000 / (200 / 3) ? (200 / 3) * mel : 1000 * Math.exp((Math.log(6.4) / 27) * (mel - 1000 / (200 / 3))));

/** The dense version: every band summed over every bin. */
const referenceMel = (mono: Float32Array): Float32Array => {
    const bins = N_FFT / 2 + 1;
    const melMin = hzToMel(30);
    const melMax = hzToMel(11000);
    const corners = Array.from({ length: N_MELS + 2 }, (_, i) => melToHz(melMin + ((melMax - melMin) * i) / (N_MELS + 1)));
    const bank = Array.from({ length: N_MELS }, (_, band) => {
        const row = new Float64Array(bins);
        const [l, c, r] = [corners[band], corners[band + 1], corners[band + 2]];
        for (let b = 0; b < bins; b += 1) {
            const hz = (b * SR) / N_FFT;
            row[b] = Math.max(0, Math.min(c === l ? 0 : (hz - l) / (c - l), r === c ? 0 : (r - hz) / (r - c)));
        }
        return row;
    });
    const hann = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT)));
    const pad = N_FFT / 2;
    const padded = new Float64Array(mono.length + 2 * pad);
    for (let i = 0; i < pad; i += 1) {
        padded[i] = mono[Math.min(pad - i, mono.length - 1)];
        padded[padded.length - 1 - i] = mono[Math.max(0, mono.length - 1 - (pad - i))];
    }
    padded.set(mono, pad);
    const frames = Math.floor((padded.length - N_FFT) / HOP) + 1;
    const out = new Float32Array(frames * N_MELS);
    const re = new Float64Array(N_FFT);
    const im = new Float64Array(N_FFT);
    const mag = new Float64Array(bins);
    for (let f = 0; f < frames; f += 1) {
        for (let i = 0; i < N_FFT; i += 1) {
            re[i] = padded[f * HOP + i] * hann[i];
            im[i] = 0;
        }
        referenceFft(re, im);
        for (let b = 0; b < bins; b += 1) mag[b] = Math.sqrt(re[b] * re[b] + im[b] * im[b]) / Math.sqrt(N_FFT);
        for (let band = 0; band < N_MELS; band += 1) {
            let energy = 0;
            for (let b = 0; b < bins; b += 1) energy += mag[b] * bank[band][b];
            out[f * N_MELS + band] = Math.log1p(1000 * Math.max(energy, 1e-10));
        }
    }
    return out;
};

describe('melSpectrogram, exactly', () => {
    it('is bit for bit the plain dense version on noise, tones and silence', async () => {
        let seed = 12345;
        const noise = () => {
            seed = (seed * 1103515245 + 12345) >>> 0;
            return seed / 2 ** 32 - 0.5;
        };
        const mono = new Float32Array(3 * SR);
        for (let i = 0; i < mono.length; i += 1) {
            const t = i / SR;
            mono[i] = i < SR ? noise() : i < 2 * SR ? 0.4 * Math.sin(2 * Math.PI * 440 * t) + 0.2 * Math.sin(2 * Math.PI * 61 * t) : 0;
        }
        const got = await melSpectrogram(mono);
        const want = referenceMel(mono);
        expect(got.data.length).toBe(want.length);
        let different = 0;
        for (let i = 0; i < want.length; i += 1) if (got.data[i] !== want[i]) different += 1;
        expect(different).toBe(0);
    });
});
