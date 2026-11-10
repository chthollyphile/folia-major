import { useEffect, useMemo, useRef, useState } from 'react';
import { collectOnlineLyrics } from '../../../services/lyricExport/collectOnlineLyrics';
import { lyricLineRuleHits, type CompiledLyricLineRule, type LyricLineRule } from '../../../utils/lyrics/lyricLineRules';
import { isInterludeLine } from '../../../utils/lyrics/parserCore';
import { startLibraryScan, type LibraryRuleStats, type LibraryScan, type LibraryScanRequest, type LibrarySong } from './lyricLibraryScan';

export type { LibraryHit, LibraryRuleStats, LibraryScan, LibrarySong, LibrarySongHits } from './lyricLibraryScan';

// src/components/modal/lyric-filter/useLyricLibraryScan.ts
// What the draft rules would remove in the songs the listener has heard: the songs whose lyrics are
// in the lyric_ cache, read once when the window opens (through collectOnlineLyrics, so each song
// counts with the lyrics playback would choose for it). The check runs again 150 ms after the rules
// stop changing, in a worker, which is stopped after a few seconds with what it has: a badly written
// expression must not freeze the window. The current song's lines are still tested on the window's
// own thread as it draws (the cards, the sample lyric), as the old window's preview was: one song;
// a written rule only once useWrittenRuleCheck ran it on them in time.

const DEBOUNCE_MS = 150;
const LIMIT_MS = 4000;

/** How many of a song's lines one rule removes on its own. */
export const countSongHits = (lines: readonly string[], compiled: CompiledLyricLineRule): number => (
    lines.reduce((count, text, index) => count + (lyricLineRuleHits(compiled, text, index, lines.length) ? 1 : 0), 0)
);

/** The songs of the lyric_ cache, once per opening of the window; null while they are read. */
export const useLibrarySongs = (isOpen: boolean): LibrarySong[] | null => {
    const [songs, setSongs] = useState<LibrarySong[] | null>(null);

    useEffect(() => {
        setSongs(null);
        if (!isOpen) {
            return undefined;
        }
        let active = true;
        collectOnlineLyrics()
            .then((result) => {
                const next = result.entries.map(entry => ({
                    key: entry.songKey,
                    title: entry.song.title || null,
                    lines: entry.lyrics.lines.filter(line => !isInterludeLine(line)).map(line => line.fullText),
                }));
                console.info(`[LyricFilter] heard songs with cached lyrics: ${next.length}`);
                if (active) setSongs(next);
            })
            .catch((error) => {
                console.warn('[LyricFilter] could not read the cached lyrics of heard songs', error);
                if (active) setSongs([]);
            });
        return () => {
            active = false;
        };
    }, [isOpen]);

    return songs;
};

export interface LibraryScanState {
    /** The check of the rules that are on, together; null until it is made for them as they are now. */
    scan: LibraryScan | null;
    /** Per rule or suggestion id, what it removes on its own; one changed since the last check is missing until checked again. */
    perRule: ReadonlyMap<string, LibraryRuleStats>;
}

/** What a rule removes depends on these, not on its id or its switch. */
const ruleKey = (rule: LyricLineRule): string => JSON.stringify([rule.shape, rule.text, Boolean(rule.colon), Boolean(rule.edgesOnly)]);
const onRulesKey = (onRules: readonly CompiledLyricLineRule[]): string => JSON.stringify(onRules.map(item => [item.rule.id, ruleKey(item.rule)]));

interface MadeScan {
    scan: LibraryScan;
    /** Per item id, the rule as it was checked. */
    items: Map<string, string>;
    onRules: string;
}

/**
 * Checks `songs` with every item of `items` on its own (cards and suggestions), and with `onRules`
 * together (the 听过的歌 tab and the footer). `onRules` are items too, by the same rule ids.
 */
export const useLyricLibraryScan = (
    songs: LibrarySong[] | null,
    items: readonly CompiledLyricLineRule[],
    onRules: readonly CompiledLyricLineRule[],
): LibraryScanState => {
    const [made, setMade] = useState<MadeScan | null>(null);
    // The worker holds the songs, sent once; it is replaced when it is stopped or still busy.
    const scanner = useRef<{ worker: Worker; busy: boolean } | null>(null);

    useEffect(() => () => {
        scanner.current?.worker.terminate();
        scanner.current = null;
    }, [songs]);

    useEffect(() => {
        if (!songs) {
            setMade(null);
            return undefined;
        }
        let cancelled = false;
        let limit: number | undefined;
        const madeFor = new Map(items.map(item => [item.rule.id, ruleKey(item.rule)]));
        const onKey = onRulesKey(onRules);
        const timer = window.setTimeout(() => {
            if (scanner.current?.busy) {
                scanner.current.worker.terminate();
                scanner.current = null;
            }
            const fresh = !scanner.current;
            const held = scanner.current ?? {
                worker: new Worker(new URL('./lyricLibraryScan.worker.ts', import.meta.url), { type: 'module' }),
                busy: false,
            };
            scanner.current = held;
            held.busy = true;
            let latest = startLibraryScan([...madeFor.keys()], songs.length);
            const publish = () => {
                if (!cancelled) setMade({ scan: latest, items: madeFor, onRules: onKey });
            };
            const stop = () => {
                window.clearTimeout(limit);
                held.worker.terminate();
                if (scanner.current === held) scanner.current = null;
                publish();
            };
            held.worker.onmessage = (event: MessageEvent<LibraryScan>) => {
                latest = event.data;
                if (!latest.complete) return;
                held.busy = false;
                window.clearTimeout(limit);
                publish();
            };
            held.worker.onerror = (event) => {
                console.warn('[LyricFilter] checking heard songs failed', event);
                stop();
            };
            const request: LibraryScanRequest = { items: [...items], onRuleIds: onRules.map(item => item.rule.id), ...(fresh ? { songs } : {}) };
            held.worker.postMessage(request);
            limit = window.setTimeout(() => {
                console.warn(`[LyricFilter] stopped checking heard songs after ${LIMIT_MS} ms: ${latest.checked} of ${songs.length}`);
                stop();
            }, LIMIT_MS);
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
            window.clearTimeout(limit);
        };
    }, [items, onRules, songs]);

    return useMemo(() => {
        const perRule = new Map<string, LibraryRuleStats>();
        if (!made) {
            return { scan: null, perRule };
        }
        for (const item of items) {
            const stats = made.scan.perRule.get(item.rule.id);
            if (stats && made.items.get(item.rule.id) === ruleKey(item.rule)) {
                perRule.set(item.rule.id, made.scan.complete ? stats : { ...stats, unfinished: true });
            }
        }
        return { scan: made.onRules === onRulesKey(onRules) ? made.scan : null, perRule };
    }, [made, items, onRules]);
};
