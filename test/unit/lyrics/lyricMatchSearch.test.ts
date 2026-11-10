// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/lyrics/lyricMatchSearch.test.ts
// The search rules of the lyric match window (useLyricMatchSearch): what is searched and where,
// which answer counts, what a change of tab or of song does to the list and to the chosen result.
// The window only shows what the hook holds, so a broken rule looks like a list that is merely
// wrong: results of another source, another song's answer, a result chosen that is not in the list.
// The hook runs in a real React root; every search is answered by hand, so the order is fixed.

type Asked = { source: string; text: string; answer: (found: SongResult[]) => void; fail: (error: Error) => void };

const env = vi.hoisted(() => ({
    asked: [] as Asked[],
    sources: ['netease', 'amll', 'qq'] as string[],
}));

vi.mock('@/hooks/useLyricMatchSources', () => ({ useLyricMatchSources: () => env.sources }));
vi.mock('@/utils/lyrics/lyricMatchSources', () => ({
    // As the real one: AMLL DB is not searched by typed words.
    sourceSupportsManualSearch: (source: string) => source !== 'amll',
    searchLyricsByMatchSource: (source: string, text: string) => new Promise<SongResult[]>((answer, fail) => {
        env.asked.push({ source, text, answer, fail });
    }),
}));

const { useLyricMatchSearch } = await import('@/components/modal/lyric-match/useLyricMatchSearch');
const { buildLyricSearchQuery } = await import('@/utils/lyrics/searchQuery');
type Search = ReturnType<typeof useLyricMatchSearch>;
type Options = Parameters<typeof useLyricMatchSearch>[2];

const result = (id: string): SongResult => ({ id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 1 } as unknown as SongResult);
const info = (title: string, artist = '', album = '') => ({ title, artist, album, durationMs: 1000 });
const named = { song: { id: 's1' }, info: info('Title', 'Artist') };
/** The search text made of that song's name and artist. */
const OWN_TEXT = buildLyricSearchQuery('Title', 'Artist', '');
/** A song with no name, artist or album: its own search text is empty. */
const nameless = { song: { id: 's0' }, info: info('') };

beforeAll(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('the search of the lyric match window', () => {
    let host: HTMLElement;
    let root: Root;
    let search: Search;

    beforeEach(() => {
        env.asked.length = 0;
        host = document.createElement('div');
        root = createRoot(host);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        vi.restoreAllMocks();
    });

    const Probe: React.FC<{ of: { song: unknown; info: ReturnType<typeof info> }; options?: Options }> = ({ of, options }) => {
        search = useLyricMatchSearch(of.song, of.info, options);
        return null;
    };
    const draw = (of: typeof named, options?: Options) => act(async () => {
        root.render(React.createElement(Probe, { of, options }));
    });
    // What a step returns is not waited for: a search stays open until the test answers it.
    const does = (work: () => unknown) => act(async () => {
        void work();
    });
    /** Types into the search box and searches. */
    const searchFor = async (text: string) => {
        await does(() => search.setQuery(text));
        await does(() => search.submit());
    };
    const lastAsked = () => env.asked[env.asked.length - 1];
    const shown = () => ({ results: search.results.map(item => item.id), chosen: search.selectedResult?.id ?? null, searching: search.isSearching });

    it('starts from the song\'s own text on the first source, and chooses nothing by itself', async () => {
        await draw(named);
        expect(search.query).toBe(OWN_TEXT);
        expect(env.asked.map(({ source, text }) => ({ source, text }))).toEqual([{ source: 'netease', text: OWN_TEXT }]);
        expect(shown()).toEqual({ results: [], chosen: null, searching: true });

        await does(() => lastAsked().answer([result('a'), result('b')]));
        expect(shown()).toEqual({ results: ['a', 'b'], chosen: null, searching: false });
    });

    it('chooses what the kind of song picks when a search answers', async () => {
        await draw(named, { pickResult: results => results[1] ?? null });
        await does(() => lastAsked().answer([result('a'), result('b')]));
        expect(shown().chosen).toBe('b');
    });

    it('searches the typed text without the spaces around it, and nothing for an empty box', async () => {
        await draw(named);
        await does(() => lastAsked().answer([result('a')]));

        await searchFor('  la la  ');
        expect(lastAsked().text).toBe('la la');
        await does(() => lastAsked().answer([result('b')]));

        await searchFor('   ');
        expect(env.asked).toHaveLength(2);
        // A search of nothing leaves what is there.
        expect(shown()).toEqual({ results: ['b'], chosen: null, searching: false });
    });

    it('drops an answer that a later search has overtaken, whichever arrives first', async () => {
        await draw(named);
        const first = lastAsked();
        await searchFor('second');
        const second = lastAsked();

        await does(() => first.answer([result('old')]));
        expect(shown()).toEqual({ results: [], chosen: null, searching: true });
        await does(() => second.answer([result('new')]));
        expect(shown()).toEqual({ results: ['new'], chosen: null, searching: false });

        await searchFor('third');
        const third = lastAsked();
        await searchFor('fourth');
        await does(() => lastAsked().answer([result('newest')]));
        await does(() => third.answer([result('late')]));
        expect(shown()).toEqual({ results: ['newest'], chosen: null, searching: false });
    });

    it('stops searching when a search fails, and keeps the list empty', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        await draw(named);
        await does(() => lastAsked().fail(new Error('no network')));
        expect(shown()).toEqual({ results: [], chosen: null, searching: false });
    });

    it('on another tab: a local file searches what was typed, an online or Navidrome song goes back to its own text', async () => {
        await draw(named);
        await searchFor('typed');
        await does(() => search.setSource('qq'));
        expect(search.query).toBe('typed');
        expect({ source: lastAsked().source, text: lastAsked().text }).toEqual({ source: 'qq', text: 'typed' });

        await does(() => root.unmount());
        root = createRoot(host);
        env.asked.length = 0;
        await draw(named, { resetsQueryOnSourceChange: true });
        await searchFor('typed');
        await does(() => search.setSource('qq'));
        expect(search.query).toBe(OWN_TEXT);
        expect({ source: lastAsked().source, text: lastAsked().text }).toEqual({ source: 'qq', text: OWN_TEXT });
    });

    // AMLL DB has its own search now (#515): it takes the typed words like the platforms do.
    it('asks AMLL DB for the words typed, as it asks a platform', async () => {
        await draw(named);
        await searchFor('typed');
        await does(() => search.setSource('amll'));
        expect({ source: lastAsked().source, text: lastAsked().text }).toEqual({ source: 'amll', text: 'typed' });
    });

    it('is on the first source that is left when the account of its tab is signed out', async () => {
        await draw(named);
        await does(() => search.setSource('qq'));
        expect(search.source).toBe('qq');
        env.sources = ['netease', 'amll'];
        await draw(named);
        expect(search.source).toBe('netease');
        env.sources = ['netease', 'amll', 'qq'];
    });

    it('empties the list and the chosen result on another tab when there is nothing to search there', async () => {
        // An online song with no name of its own: the box goes back to that empty text.
        await draw(nameless, { pickResult: results => results[0] ?? null, resetsQueryOnSourceChange: true });
        expect(env.asked).toHaveLength(0);
        await searchFor('typed');
        await does(() => lastAsked().answer([result('a')]));
        expect(shown()).toEqual({ results: ['a'], chosen: 'a', searching: false });

        await does(() => search.setSource('qq'));
        expect(env.asked).toHaveLength(1);
        // What the other source found is not this source's: Save would fetch from qq with a's id.
        expect(shown()).toEqual({ results: [], chosen: null, searching: false });

        // A local file: a result chosen, the box emptied, then another tab.
        await does(() => root.unmount());
        root = createRoot(host);
        env.asked.length = 0;
        await draw(named);
        await does(() => lastAsked().answer([result('b')]));
        await does(() => search.setSelectedResult(search.results[0]));
        await does(() => search.setQuery(''));
        await does(() => search.setSource('qq'));
        expect(env.asked).toHaveLength(1);
        expect(shown()).toEqual({ results: [], chosen: null, searching: false });
    });

    it('does not show an earlier song\'s answer for a song that has nothing to search', async () => {
        await draw(named, { pickResult: results => results[0] ?? null });
        const earlier = lastAsked();

        await draw(nameless, { pickResult: results => results[0] ?? null });
        await does(() => earlier.answer([result('of-the-earlier-song')]));

        expect(env.asked).toHaveLength(1);
        expect(shown()).toEqual({ results: [], chosen: null, searching: false });
    });
});
