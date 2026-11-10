import { useEffect, useRef, useState } from 'react';
import type { LyricProviderSource, SongResult } from '../../../types';
import { useLyricMatchSources } from '../../../hooks/useLyricMatchSources';
import { searchLyricsByMatchSource, type LyricMatchSearchTarget } from '../../../utils/lyrics/lyricMatchSources';
import { LYRIC_SOURCES } from '../../../utils/lyrics/lyricSources';
import type { LyricMatchSource } from '../../../utils/lyrics/matchResult';
import { buildLyricSearchQuery } from '../../../utils/lyrics/searchQuery';

// src/components/modal/lyric-match/useLyricMatchSearch.ts
// The search of the lyric match window: the source it is on, the text in the search box, the
// results and the chosen one. A kind of song says what the song is called and, if it wants,
// which result is chosen when a search answers.

/** What the song being matched is called: the first search text is made of it, and results are scored against it. */
export type LyricMatchSongInfo = Required<LyricMatchSearchTarget>;

export interface LyricMatchSearchOptions {
    /** The result chosen when a search answers. Without it none is: the person chooses. */
    pickResult?: (results: SongResult[]) => SongResult | null;
    /**
     * True: on another source the search box goes back to the song's own text. Otherwise the text
     * the person typed is searched on the new source too.
     */
    resetsQueryOnSourceChange?: boolean;
}

// The source the window is on, with the sources it offers: it opens on the first one. An account
// can be signed out under the open window: its tab goes, and the window is then on the first
// source that is left.
const useLyricMatchSourceChoice = (): [LyricProviderSource, (source: LyricProviderSource) => void, LyricProviderSource[]] => {
    const offered = useLyricMatchSources();
    const [chosen, setChosen] = useState<LyricProviderSource>(LYRIC_SOURCES[0].id);
    return [offered.includes(chosen) ? chosen : offered[0], setChosen, offered];
};

export const useLyricMatchSearch = (
    song: unknown,
    songInfo: LyricMatchSongInfo,
    { pickResult, resetsQueryOnSourceChange }: LyricMatchSearchOptions = {},
) => {
    const [source, setSource, sources] = useLyricMatchSourceChoice();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SongResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const requestIdRef = useRef(0);
    const searchedSourceRef = useRef(source);

    const songQuery = buildLyricSearchQuery(songInfo.title, songInfo.artist, songInfo.album);

    // Every source is searched by the text in the box. An answer that a later search has overtaken
    // is dropped. `anew`: the song or the tab changed, so what
    // the search before found is not this one's and goes even when there is nothing to search.
    const runSearch = async (typed: string, activeSource: LyricMatchSource, anew = false) => {
        const text = typed.trim();
        if (!text) {
            if (anew) {
                requestIdRef.current += 1;
                setIsSearching(false);
                setResults([]);
                setSelectedResult(null);
            }
            return;
        }

        const requestId = ++requestIdRef.current;
        setIsSearching(true);
        setResults([]);
        setSelectedResult(null);

        try {
            const found = await searchLyricsByMatchSource(activeSource, text, songInfo);
            if (requestId !== requestIdRef.current) return;

            setResults(found);
            setSelectedResult(pickResult?.(found) ?? null);
        } catch (error) {
            console.error('[LyricMatch] Search failed:', error);
        } finally {
            if (requestId === requestIdRef.current) {
                setIsSearching(false);
            }
        }
    };

    // A song starts from its own search text.
    useEffect(() => {
        setQuery(songQuery);
        void runSearch(songQuery, source, true);
    }, [song]);

    useEffect(() => {
        if (searchedSourceRef.current === source) return;
        searchedSourceRef.current = source;
        if (resetsQueryOnSourceChange) {
            setQuery(songQuery);
            void runSearch(songQuery, source, true);
        } else {
            void runSearch(query, source, true);
        }
    }, [source]);

    return {
        songInfo,
        source,
        setSource,
        sources,
        query,
        setQuery,
        results,
        isSearching,
        selectedResult,
        setSelectedResult,
        /** Searches the text in the box on the source the window is on. */
        submit: () => runSearch(query, source),
    };
};

export type LyricMatchSearch = ReturnType<typeof useLyricMatchSearch>;
