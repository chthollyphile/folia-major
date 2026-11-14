import { Search } from 'lucide-react';
import i18n from '../../../i18n/config';
import { omni } from '../../../services/onlineMusic/omni';
import type { SearchSource } from '../../../stores/useSearchNavigationStore';
import type { CommandPaletteCommand, CommandPaletteContext, CommandPaletteSearchSource } from '../types';

// src/components/command-palette/commands/searchCommands.ts
// Commands in the `search` group: run a query against one music source and navigate to results.
// The online sources' own commands (`search-<source id>`) are not in the static list: there is no default
// platform, so they are built from the registered sources (buildProviderSearchCommands) and installed when
// the sources change (providerSearchCommandsInstaller.ts). Folium 2.0 plan §7.

const getSearchSourceLabel = (sourceTab: SearchSource, context: CommandPaletteContext) => {
    if (sourceTab === 'local') {
        return context.shared.t('commandPalette.sourceLocal', 'local library');
    }
    if (sourceTab === 'navidrome') {
        return context.shared.t('commandPalette.sourceNavidrome', 'Navidrome');
    }
    return omni.getProviderLabel(sourceTab);
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
];

/**
 * One search command per registered online source, in registration order: `search-<source id>` (a source that
 * had a command before keeps its id, which pinned commands and shortcuts store). Like the local and Navidrome
 * ones, they are not offered in the app, where `search-current` searches the source in force; they stay
 * reachable for callers that match without a context. Their text is the source's name, read when shown.
 */
export const buildProviderSearchCommands = (providerIds: readonly string[]): CommandPaletteCommand[] => providerIds.map(providerId => {
    const label = () => omni.getProviderLabel(providerId);
    const command = createSearchCommand(
        `search-${providerId}`,
        '',
        '',
        [providerId, `search ${providerId}`, label()],
        () => providerId,
    );
    return Object.defineProperties({ ...command, textSource: 'runtime' as const }, {
        title: { get: () => i18n.t('commandPalette.searchProviderTitle', { provider: label(), defaultValue: 'Search {{provider}} songs' }), enumerable: true },
        description: { get: () => i18n.t('commandPalette.searchProviderDescription', { provider: label(), defaultValue: 'Search songs on {{provider}}' }), enumerable: true },
    });
});
