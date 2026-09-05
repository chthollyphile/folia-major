import { loadPixi } from '../../../visualizer/loadPixi';

// src/components/app/lattice/lyrics/prewarmLatticeLyrics.ts
let started = false;

/**
 * Pulls the lyric chunk and Pixi in before the card is opened. Both imports are module-cached, so
 * the click path is left with neither a chunk fetch nor the first shader compile.
 */
export const prewarmLatticeLyrics = () => {
    if (started) return;
    started = true;
    void Promise.all([import('./LatticeLyrics'), loadPixi()]).catch(() => { started = false; });
};
