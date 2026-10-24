import { isMidSongLine, lyricLineRuleHits, type CompiledLyricLineRule } from '../../../utils/lyrics/lyricLineRules';

// src/components/modal/lyric-filter/lyricLibraryScan.ts
// The check of the songs heard against the draft rules, song by song, with nothing of the window in
// it: it runs in lyricLibraryScan.worker.ts, and useLyricLibraryScan starts and stops that worker.

export interface LibrarySong {
    key: string;
    title: string | null;
    /** The song's lines without interludes, as the rules see them. */
    lines: string[];
}

export interface LibraryHit {
    text: string;
    title: string | null;
    mid: boolean;
}

/** What one rule removes across the songs checked, judged on its own. */
export interface LibraryRuleStats {
    songs: number;
    lines: number;
    midLines: number;
    /** Songs it would leave with less than half of their lines. */
    overHalfSongs: number;
    /** A few of the lines it removes, at most four. */
    examples: LibraryHit[];
    /** A few of the lines it removes in the middle of a song, at most three. */
    midExamples: LibraryHit[];
    /** Set by the window when the check was stopped before every song: the numbers so far. */
    unfinished?: boolean;
}

/** One song in the 听过的歌 tab: the lines the rules that are on remove from it, in its order. */
export interface LibrarySongHits {
    key: string;
    title: string | null;
    /** A line is removed in the middle of the song: shown before the songs without one. */
    mid: boolean;
    lines: { text: string; ruleId: string; mid: boolean }[];
}

export interface LibraryScan {
    checked: number;
    total: number;
    complete: boolean;
    /** Per rule id: the rules and suggestions scanned, each on its own. */
    perRule: Map<string, LibraryRuleStats>;
    /** The rules that are on, together (the first that matches a line removes it). */
    removedLines: number;
    removedSongs: number;
    midLines: number;
    /**
     * The songs with a line removed as the 听过的歌 tab shows them, those with a line removed in the
     * middle first, cut after LIBRARY_ROWS lines: removedLines counts the rest.
     */
    songs: LibrarySongHits[];
}

// The tab draws at most this many removed lines; a broad rule removes tens of thousands, and only
// these are kept and sent to the window.
export const LIBRARY_ROWS = 200;

/** What the worker is asked: `songs` once per worker; the items to count each on its own; the ids of those that are on, in order. */
export interface LibraryScanRequest {
    songs?: LibrarySong[];
    items: CompiledLyricLineRule[];
    onRuleIds: string[];
}

const emptyStats = (): LibraryRuleStats => ({ songs: 0, lines: 0, midLines: 0, overHalfSongs: 0, examples: [], midExamples: [] });

/** A scan with no song checked yet: every item at zero. */
export const startLibraryScan = (itemIds: readonly string[], total: number): LibraryScan => ({
    checked: 0,
    total,
    complete: false,
    perRule: new Map(itemIds.map(id => [id, emptyStats()])),
    removedLines: 0,
    removedSongs: 0,
    midLines: 0,
    songs: [],
});

/** Adds one song to `scan`: what each item removes from it on its own, and what `onRules` remove together. */
export const scanLibrarySong = (
    scan: LibraryScan,
    song: LibrarySong,
    items: readonly CompiledLyricLineRule[],
    onRules: readonly CompiledLyricLineRule[],
) => {
    const total = song.lines.length;
    const counts = new Map<string, number>();
    const songHits: LibrarySongHits = { key: song.key, title: song.title, mid: false, lines: [] };
    song.lines.forEach((text, lineIndex) => {
        const mid = isMidSongLine(lineIndex, total);
        const hitIds = new Set<string>();
        for (const item of items) {
            if (!lyricLineRuleHits(item, text, lineIndex, total)) continue;
            hitIds.add(item.rule.id);
            counts.set(item.rule.id, (counts.get(item.rule.id) ?? 0) + 1);
            const stats = scan.perRule.get(item.rule.id)!;
            stats.lines += 1;
            if (stats.examples.length < 4) stats.examples.push({ text, title: song.title, mid });
            if (mid) {
                stats.midLines += 1;
                if (stats.midExamples.length < 3) stats.midExamples.push({ text, title: song.title, mid });
            }
        }
        const first = onRules.find(rule => hitIds.has(rule.rule.id));
        if (first) {
            songHits.lines.push({ text, ruleId: first.rule.id, mid });
            songHits.mid ||= mid;
            scan.removedLines += 1;
            if (mid) scan.midLines += 1;
        }
    });
    counts.forEach((count, id) => {
        const stats = scan.perRule.get(id)!;
        stats.songs += 1;
        if (count * 2 > total) stats.overHalfSongs += 1;
    });
    if (songHits.lines.length > 0) {
        keepShown(scan, songHits);
        scan.removedSongs += 1;
    }
    scan.checked += 1;
};

/** Puts `song` where the tab shows it (after the other songs of its kind) and cuts the list after LIBRARY_ROWS lines. */
const keepShown = (scan: LibraryScan, song: LibrarySongHits) => {
    const before = song.mid ? scan.songs.findIndex(shown => !shown.mid) : -1;
    scan.songs.splice(before === -1 ? scan.songs.length : before, 0, song);
    let room = LIBRARY_ROWS;
    scan.songs = scan.songs.flatMap((shown) => {
        if (room <= 0) return [];
        const kept = shown.lines.length > room ? { ...shown, lines: shown.lines.slice(0, room) } : shown;
        room -= kept.lines.length;
        return [kept];
    });
};
