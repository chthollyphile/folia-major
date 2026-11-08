import { Search } from 'lucide-react';
import type { SearchSource } from '../../../stores/useSearchNavigationStore';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteSearchSource } from '../types';

// src/components/command-palette/commands/searchCommands.ts
// Commands in the `search` group: run a query against one music source and navigate to results.

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

const createSearchCommand = (
    id: string,
    title: string,
    description: string,
    keywords: string[],
    resolveSource: (context: CommandPaletteContext) => SearchSource,
    options: Pick<CommandPaletteCommand, 'executeShortcut'> = {},
): CommandPaletteCommand => ({
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
});

export const searchCommands: CommandPaletteCommand[] = [
    createSearchCommand('search-current', 'Search songs', 'Search songs in the current source', ['search', 'find', 'song', '搜索', '搜歌'], context => context.search.currentSearchSourceTab, { executeShortcut: 'f' }),
    createSearchCommand('search-local', 'Search local songs', 'Search local library', ['local', 'local search', 'search local', '本地', '本地音乐'], () => 'local'),
    createSearchCommand('search-navidrome', 'Search Navidrome songs', 'Search Navidrome library', ['navi', 'navidrome', 'search navidrome', '导航', '服务器'], () => 'navidrome'),
    createSearchCommand('search-netease', 'Search NetEase songs', 'Search NetEase Cloud Music', ['netease', 'cloud', 'search netease', '网易云', '网抑云'], () => 'netease'),
];
