import { melSpectrogram } from '../services/automix/beatThis';
import { analyseTrack } from '../services/automix/trackProfile';

// src/workers/automixAnalysis.worker.ts
// Automix's two FFT passes, off the thread that paints.
//
// Both are pure functions over a Float32Array, which is the only reason this file can be three
// imports long: nothing about a spectrogram or a track profile touches the DOM, the audio graph
// or the Electron bridge. The one step between them that DOES - handing the spectrogram to the
// model in the main process - stays in `profileService`, so this worker never learns that a model
// exists and the browser build reaches exactly the same code.
//
// Measured on a four-minute track: the mel pass is 1.6s and the profile pass 3.3s, and before this
// both of them ran on the main thread in eight-millisecond slices. That never dropped a frame -
// see YIELD_BUDGET_MS - but it did hold roughly two thirds of the thread for five seconds every
// time a track was analysed for the first time, which is a lyric animation running at a third of
// its budget while the listener is looking at it.

type Request =
    | { id: number; kind: 'mel'; mono: Float32Array }
    | {
        id: number;
        kind: 'profile';
        mono: Float32Array;
        sampleRate: number;
        options: Parameters<typeof analyseTrack>[2];
    };

self.onmessage = async (event: MessageEvent<Request>) => {
    const request = event.data;
    try {
        if (request.kind === 'mel') {
            const mel = await melSpectrogram(request.mono);
            // Transferred rather than copied: six megabytes for a four-minute track, and this side
            // has no further use for it.
            self.postMessage({ id: request.id, result: mel }, { transfer: [mel.data.buffer] });
            return;
        }
        const profile = await analyseTrack(request.mono, request.sampleRate, request.options);
        self.postMessage({ id: request.id, result: profile });
    } catch (error) {
        // Answered rather than thrown. The client's fallback is the same function on the main
        // thread, so a failure here costs the move off-thread and nothing else.
        self.postMessage({ id: request.id, error: String(error) });
    }
};
