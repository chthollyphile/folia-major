import { installGlobalVisualizerFrameRateLimiter } from '../../src/utils/frameRateLimiter';

// dev/perf/page.tsx
// Entry of the measuring page. Like the app's src/index.tsx it installs the frame-rate cap first and
// loads the rest afterwards.
//
// Before that it empties this origin's localStorage: the settings stores read it while they load,
// and a scenario must start from the app's defaults whatever an earlier scenario wrote there.
// The cap is then installed the way the app installs it, so with nothing stored it is at its
// default (off: the screen's own rate).

try {
    window.localStorage.clear();
} catch (error) {
    console.warn('[perf] localStorage could not be cleared', error);
}

installGlobalVisualizerFrameRateLimiter();

void import('./stage');
