// src/components/app/playback/externalSpectrum.ts
// The external playback route hands the app no audio to analyse: the player that sounds the song is
// another program. The visualizer's bands therefore follow that player's own clock, from the
// position it reports, so they move with the song and stand still where it is paused.

export type ExternalSpectrumBands = {
    power: number;
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
    /** Bins shaped like an analyser's answer, for the visualizer modes that draw the spectrum. */
    spectrum: Uint8Array<ArrayBuffer>;
};

/** The bins a synthetic spectrum has: enough for the bar-like modes, and no analyser to match. */
const SPECTRUM_BINS = 128;
/** A beat at 120 BPM: the bass swells on it and falls back through the beat. */
const BEAT_SEC = 0.5;
/** Everything the bands are scaled to: the analyser's own range. */
const LEVEL = 255;

// The visualizer reads these every frame, so both are made once and written in place: a route that
// allocated a bin array per frame would hand the collector 60 of them a second (M3).
const SPECTRUM = new Uint8Array(SPECTRUM_BINS);
const BANDS: ExternalSpectrumBands = { power: 0, bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0, spectrum: SPECTRUM };

const wave = (positionSec: number, hz: number, phase: number): number => (
    (Math.sin((positionSec * hz + phase) * Math.PI * 2) + 1) / 2
);

const clamp = (value: number): number => Math.min(LEVEL, Math.max(0, value));

/**
 * The bands of the external player's song at `positionSec` into it, written into the one answer
 * this module holds. A pure function of the position, so two frames at the same position draw the
 * same picture: a paused song and a track still loading both keep the frame they had, instead of
 * falling back to a breathing animation (M3).
 */
export const externalSpectrumAt = (positionSec: number): ExternalSpectrumBands => {
    const position = Number.isFinite(positionSec) && positionSec > 0 ? positionSec : 0;
    const beat = 1 - (position % BEAT_SEC) / BEAT_SEC;
    const bass = clamp(70 + 140 * beat + 30 * wave(position, 0.37, 0));
    const lowMid = clamp(60 + 70 * beat + 80 * wave(position, 0.53, 0.2));
    const mid = clamp(55 + 105 * wave(position, 0.71, 0.5));
    const vocal = clamp(50 + 110 * wave(position, 0.29, 0.7));
    const treble = clamp(45 + 120 * wave(position, 1.13, 0.35));
    for (let index = 0; index < SPECTRUM_BINS; index += 1) {
        // Low bins follow the beat, high ones shimmer: the shape an analyser gives a pop song.
        const fall = 1 - index / SPECTRUM_BINS;
        const level = (0.55 * fall + 0.45 * wave(position, 0.4 + index * 0.03, index * 0.11));
        SPECTRUM[index] = Math.round(clamp(level * LEVEL));
    }
    BANDS.power = clamp((bass + lowMid) / 2);
    BANDS.bass = bass;
    BANDS.lowMid = lowMid;
    BANDS.mid = mid;
    BANDS.vocal = vocal;
    BANDS.treble = treble;
    return BANDS;
};
