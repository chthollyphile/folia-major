import { History, Search } from 'lucide-react';
import type { SearchSource } from '../../../stores/useSearchNavigationStore';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteMatch, CommandPaletteSearchSource } from '../types';
import type { CommandPaletteSurface } from '../surfaces/types';
import { normalizeSearchHistoryQuery } from '../../../utils/searchHistory';

// src/components/command-palette/commands/searchCommands.ts
// Commands in the `search` group: run a query against one music source and navigate to results.
// While a search command is open, the words searched before are listed under its own row (newest
// first, narrowed by what is typed); picking one searches it again in the same source.

const getSearchSourceLabel = (sourceTab: SearchSource, context: CommandPaletteContext) => {
    if (sourceTab === 'local') {
        return context.shared.t('commandPalette.sourceLocal', 'local library');
    }
    if (sourceTab === 'navidrome') {
        return context.shared.t('commandPalette.sourceNavidrome', 'Navidrome');
    }
    return context.shared.t('commandPalette.sourceNetease', 'NetEase Cloud Music');
};

const buildSearchPreview = (
    input: string,
    sourceTab: SearchSource,
    context: CommandPaletteContext,
    isCurrentSource: boolean
) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
        return null;
    }

    const sourceLabel = isCurrentSource
        ? context.shared.t('commandPalette.sourceCurrent', 'current source')
        : getSearchSourceLabel(sourceTab, context);

    return context.shared.t('commandPalette.previewSearch', 'Search {{source}} songs: {{query}}')
        .replace('{{source}}', sourceLabel)
        .replace('{{query}}', trimmedInput);
};

const runSearch = async (
    query: string,
    sourceTab: CommandPaletteSearchSource,
    context: CommandPaletteContext
) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
        return false;
    }

    const didSearch = await context.search.submitSearch({
        query: trimmedQuery,
        sourceTab,
        // 命令窗口的搜索说的是「搜索歌曲」，不跟搜索页上次停在的种类走。
        kind: 'song',
        deps: {
            localSongs: context.search.localSongs,
            localLibraryCatalog: context.search.localLibraryCatalog,
            t: context.shared.t,
        },
        returnView: 'player',
    });

    if (didSearch) {
        context.search.navigateToSearch({
            query: trimmedQuery,
            sourceTab,
            replace: typeof window !== 'undefined' && Boolean(window.history.state?.search),
            returnView: 'player',
        });
    }

    return didSearch;
};

const HISTORY_ID_PREFIX = 'search-history-';

/** One past search as a row of its own: its title is the word, Enter searches it again in `sourceTab`. */
const toHistoryCommand = (
    query: string,
    index: number,
    sourceTab: SearchSource,
    context: CommandPaletteContext,
    isCurrentSource: boolean,
): CommandPaletteCommand => ({
    id: `${HISTORY_ID_PREFIX}${index}`,
    group: 'search',
    title: query,
    // 标题是搜过的词本身，不是 commandPalette.commands.<id>。
    textSource: 'runtime',
    description: context.shared.t('commandPalette.searchHistoryRow', 'Recent search · {{source}}')
        .replace('{{source}}', isCurrentSource
            ? context.shared.t('commandPalette.sourceCurrent', 'current source')
            : getSearchSourceLabel(sourceTab, context)),
    keywords: ['search'],
    icon: History,
    execute: (_input, runContext) => runSearch(query, sourceTab, runContext),
});

/**
 * The search command's own row (Enter searches what is typed), then the past searches that contain
 * what is typed - the same word as typed is left out, the own row already searches it.
 */
const buildSearchMatches = (
    command: CommandPaletteCommand,
    context: CommandPaletteContext,
    query: string,
    sourceTab: SearchSource,
    isCurrentSource: boolean,
): CommandPaletteMatch[] => {
    // 历史里的词存进去时已经整理过（utils/searchHistory），这里只整理打的字。
    const typed = normalizeSearchHistoryQuery(query).toLowerCase();
    const history = context.search.searchHistory()
        .filter(item => !typed || (item.toLowerCase().includes(typed) && item.toLowerCase() !== typed))
        .map((item, index): CommandPaletteMatch => ({
            command: toHistoryCommand(item, index, sourceTab, context, isCurrentSource),
            score: 90 - index,
            input: '',
        }));
    return [{ command, score: 100, input: query }, ...history];
};

const createSearchCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    resolveSource: (context: CommandPaletteContext) => SearchSource,
    options: Pick<CommandPaletteCommand, 'executeShortcut'> = {},
): CommandPaletteCommand => {
    const command: CommandPaletteCommand = {
        id,
        group: 'search',
        title,
        description,
        keywords,
        ...options,
        // Only the current-source variant is offered in-app; the rest stay reachable for tests
        // and for callers that match without a context.
        isAvailable: context => !context || id === 'search-current',
        icon: Search,
        placeholder: () => `${keywords[0]} ${description}`,
        requiresInput: true,
        getPreview: (input, context) => buildSearchPreview(
            input,
            resolveSource(context),
            context,
            id === 'search-current'
        ),
        execute: (input, context) => runSearch(input, resolveSource(context), context),
    };
    // No view of its own: the rows go through the palette's default list, which already draws a
    // runtime title, a description and the Enter hint.
    const surface: CommandPaletteSurface = {
        useLiveQuery: true,
        buildMatches: ({ context, query }) => buildSearchMatches(command, context, query, resolveSource(context), id === 'search-current'),
    };
    command.surface = surface;
    return command;
};

export const searchCommands: CommandPaletteCommand[] = [
    createSearchCommand('search-current', 'Search songs', 'Search songs in the current source', ['search', 'find', 'song', '搜索', '搜歌'], context => context.search.currentSearchSourceTab, { executeShortcut: 'f' }),
    createSearchCommand('search-local', 'Search local songs', 'Search local library', ['local', 'local search', 'search local', '本地', '本地音乐'], () => 'local'),
    createSearchCommand('search-navidrome', 'Search Navidrome songs', 'Search Navidrome library', ['navi', 'navidrome', 'search navidrome', '导航', '服务器'], () => 'navidrome'),
    createSearchCommand('search-netease', 'Search NetEase songs', 'Search NetEase Cloud Music', ['netease', 'cloud', 'search netease', '网易云', '网抑云'], () => 'netease'),
];
