// src/components/app/playback/spectrumBands.ts
// Folding an analyser's byte-frequency answer into the six bands the visualizer draws: one algorithm
// for the app's own deck and for the machine's sound the external route captures, so both look alike.

/** The bands the visualizer's motion values take, in the analyser's own 0..255 range. */
export type SpectrumBandLevels = {
    power: number;
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
};

/** Hz per bin of a 2048-point analyser at 44.1 kHz, the size every analyser here is created with. */
const BIN_HZ = 21.5;
/** The analyser's own range: everything the bands are scaled to. */
const LEVEL = 255;

const energyOf = (data: Uint8Array, minHz: number, maxHz: number): number => {
    const start = Math.floor(minHz / BIN_HZ);
    const end = Math.floor(maxHz / BIN_HZ);
    let sum = 0;
    for (let index = start; index <= end; index += 1) {
        // `| 0` keeps a band past the end of a shorter analyser at silence instead of NaN.
        sum += data[index] | 0;
    }
    const count = end - start + 1;
    return count > 0 ? sum / count : 0;
};

// Quiet bins fall away below the others: the bands are what the eye reads, not the analyser's dB.
const shape = (value: number, boost: number): number => Math.pow(value / LEVEL, boost) * LEVEL;

export const emptySpectrumBandLevels = (): SpectrumBandLevels => ({
    power: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    vocal: 0,
    treble: 0,
});

/**
 * Writes the bands of `data` into `out` and hands it back. The visualizer reads this every frame, so
 * the answer is written in place rather than made (M3).
 */
export const readSpectrumBandLevels = (data: Uint8Array, out: SpectrumBandLevels): SpectrumBandLevels => {
    const bass = energyOf(data, 20, 150);
    const lowMid = energyOf(data, 150, 400);
    const mid = energyOf(data, 400, 1200);
    const vocal = energyOf(data, 1000, 3500);
    const treble = energyOf(data, 3500, 12000);

    out.power = shape((bass + lowMid) / 2, 3);
    out.bass = shape(bass, 1.8);
    out.lowMid = shape(lowMid, 2);
    out.mid = shape(mid, 2);
    out.vocal = shape(vocal, 1.5);
    out.treble = shape(treble, 2);
    return out;
};
