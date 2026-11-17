import { describe, expect, it, vi } from 'vitest';
import { searchCommands } from '@/components/command-palette/commands/searchCommands';
import type { CommandPaletteContext } from '@/components/command-palette/types';

// test/unit/command-palette/searchHistoryCommand.test.ts
// 命令窗口的搜索命令在自己那一行下面列出搜过的词：最近的在前、按打的字收窄、跟打的字一样的那条不重复列，
// 选一条就在同一个来源再搜一次（走 submitSearch，也就顺带记进历史）。

const searchCurrent = searchCommands.find(command => command.id === 'search-current')!;

const createContext = (history: string[]) => {
    const submitSearch = vi.fn(async () => true);
    const navigateToSearch = vi.fn();
    const context = {
        shared: { t: (_key: string, fallback?: string) => fallback ?? '' },
        search: {
            currentSearchSourceTab: 'netease',
            localSongs: [],
            localLibraryCatalog: { entities: [], assignments: [] },
            navigateToSearch,
            submitSearch,
            searchHistory: () => history,
        },
    } as unknown as CommandPaletteContext;
    return { context, submitSearch };
};

const build = (context: CommandPaletteContext, query: string) => searchCurrent.surface!.buildMatches!({ context, query });

describe('search command history rows', () => {
    it('lists past searches newest first under the command own row', () => {
        const { context } = createContext(['jay', 'eason']);
        const matches = build(context, '');
        expect(matches[0].command).toBe(searchCurrent);
        expect(matches.slice(1).map(match => match.command.title)).toEqual(['jay', 'eason']);
    });

    it('narrows the past searches by what is typed and leaves out the word already typed', () => {
        const { context } = createContext(['jay chou', 'Jay', 'eason']);
        const matches = build(context, ' JAY ');
        expect(matches[0]).toMatchObject({ command: searchCurrent, input: ' JAY ' });
        expect(matches.slice(1).map(match => match.command.title)).toEqual(['jay chou']);
    });

    it('searches a picked row again in the command source', async () => {
        const { context, submitSearch } = createContext(['eason']);
        const row = build(context, '')[1].command;
        await row.execute('', context);
        expect(submitSearch).toHaveBeenCalledWith(expect.objectContaining({ query: 'eason', sourceTab: 'netease', kind: 'song' }));
    });
});
