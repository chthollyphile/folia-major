import type { LatticeLyricRuntime } from './types';

// src/components/app/lattice/lyrics/latticeLyricSession.ts
/** Owns cancellation across async Pixi initialization and React StrictMode remounts. */
export function startLatticeLyricSession(create: (signal: AbortSignal) => Promise<LatticeLyricRuntime | null>,
    ready: (runtime: LatticeLyricRuntime) => void, failed: (error: unknown) => void) {
    const abort = new AbortController();
    let runtime: LatticeLyricRuntime | null = null;
    const completion = create(abort.signal).then(result => {
        if (abort.signal.aborted) { result?.destroy(); return; }
        runtime = result;
        if (result) ready(result);
    }).catch(error => { if (!abort.signal.aborted) failed(error); });
    return { completion, destroy() {
        abort.abort(); runtime?.destroy(); runtime = null;
    } };
}
