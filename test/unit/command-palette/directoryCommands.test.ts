import { describe, expect, it, vi } from 'vitest';
import type { LibraryDirectorySurfaceHandle, LibraryDirectorySurfaceState } from '../../../src/library/core/directory/directory.contract';
import { COMMAND_PALETTE_COMMANDS, isCommandPaletteCommandEnabled } from '../../../src/components/command-palette/commandRegistry';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

// test/unit/command-palette/directoryCommands.test.ts
// 首页目录的命令：只有 GridMap 注册了 directory surface 才出现，且只出现目录此刻提供的动作；
// 执行时把动作与输入（新建歌单的名字）原样交给目录。

const surfaceState = (availableActions: LibraryDirectorySurfaceState['availableActions']): LibraryDirectorySurfaceState => ({
    directoryKey: 'home:local:folders',
    availableActions,
    displayItemCount: 2,
    selectedItemCount: 1,
    selectedTrackCount: 1,
    visibilityMode: 'browse',
});
const handle = (availableActions: LibraryDirectorySurfaceState['availableActions'] = []): LibraryDirectorySurfaceHandle => ({
    getState: () => surfaceState(availableActions),
    run: vi.fn(() => true),
});

describe('directory commands', () => {
    const contextWith = (directory: LibraryDirectorySurfaceHandle | null) => ({
        scope: { view: 'home', filter: null, grid: null, directory },
        shared: { t: (_key: string, fallback?: string) => fallback ?? '' },
    }) as unknown as CommandPaletteContext;
    const directoryCommandIds = COMMAND_PALETTE_COMMANDS
        .filter(command => command.scope === 'directory-surface')
        .map(command => command.id);
    // 只问目录命令（其余命令的 isAvailable 要完整的 context）；门控与面板列表用的是同一个判断。
    const available = (context: CommandPaletteContext) => COMMAND_PALETTE_COMMANDS
        .filter(command => directoryCommandIds.includes(command.id) && isCommandPaletteCommandEnabled(command, context))
        .map(command => command.id);

    it('are registered as one directory-surface group', () => {
        expect(directoryCommandIds).toEqual([
            'directory-play-selection',
            'directory-enqueue-selection',
            'directory-create-playlist',
            'directory-remove-selection',
            'directory-select-all',
            'directory-clear-selection',
            'directory-manage-hidden',
            'directory-toggle-hidden',
            'directory-rescan-root',
            'directory-remove-root',
            'directory-clear-ignore',
        ]);
    });

    it('appear only while a directory is registered, and only the actions it offers', () => {
        expect(available(contextWith(null))).toEqual([]);
        expect(available(contextWith(handle(['play-selection', 'clear-selection']))))
            .toEqual(['directory-play-selection', 'directory-clear-selection']);
        expect(available(contextWith(handle(['manage-hidden'])))).toEqual(['directory-manage-hidden']);
        expect(available(contextWith(handle(['toggle-hidden', 'rescan-root', 'remove-root', 'clear-ignore'])))).toEqual([
            'directory-toggle-hidden',
            'directory-rescan-root',
            'directory-remove-root',
            'directory-clear-ignore',
        ]);
    });

    it('hand the action and the typed playlist name to the directory', async () => {
        const directory = handle(['play-selection', 'create-playlist']);
        const context = contextWith(directory);
        const play = COMMAND_PALETTE_COMMANDS.find(command => command.id === 'directory-play-selection')!;
        const create = COMMAND_PALETTE_COMMANDS.find(command => command.id === 'directory-create-playlist')!;

        expect(await play.execute('', context)).toBe(true);
        expect(directory.run).toHaveBeenCalledWith('play-selection', '');
        expect(create.requiresInput).toBe(true);
        await create.execute('Road Trip', context);
        expect(directory.run).toHaveBeenLastCalledWith('create-playlist', 'Road Trip');
        expect(create.executeShortcut).toBeUndefined();
    });
});
