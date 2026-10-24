import { scanLibrarySong, startLibraryScan, type LibraryScanRequest, type LibrarySong } from './lyricLibraryScan';

// src/components/modal/lyric-filter/lyricLibraryScan.worker.ts
// Checks the songs heard against the draft rules off the window's thread. A badly written
// expression can hold one regex test for minutes; time slices on the window's thread cannot stop
// that, but the window can stop this worker (useLyricLibraryScan does, after a few seconds). What it
// has so far is posted every second, so a stopped check still shows what it found.

const PARTIAL_MS = 1000;

let songs: LibrarySong[] = [];

self.onmessage = (event: MessageEvent<LibraryScanRequest>) => {
    const { items, onRuleIds } = event.data;
    if (event.data.songs) {
        songs = event.data.songs;
    }
    const onRules = onRuleIds.flatMap(id => items.filter(item => item.rule.id === id));
    const scan = startLibraryScan(items.map(item => item.rule.id), songs.length);
    let posted = performance.now();
    for (const song of songs) {
        scanLibrarySong(scan, song, items, onRules);
        if (performance.now() - posted >= PARTIAL_MS) {
            self.postMessage(scan);
            posted = performance.now();
        }
    }
    self.postMessage({ ...scan, complete: true });
};
