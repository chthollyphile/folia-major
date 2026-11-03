import { describe, expect, it, vi } from 'vitest';
import type { LibraryArtistSurfaceHandle, LibraryArtistSurfaceState } from '../../../src/library/core/artist/artist.contract';
import { COMMAND_PALETTE_COMMANDS, isCommandPaletteCommandEnabled } from '../../../src/components/command-palette/commandRegistry';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';

// test/unit/command-palette/artistCommands.test.ts
// 歌手页的命令（P4.2）：只有歌手页注册了 artist surface 才出现，且只出现它此刻提供的动作（core 能力 ∩ suite 声明）；
// 执行时把动作原样交给歌手页。

const surfaceState = (availableActions: LibraryArtistSurfaceState['availableActions']): LibraryArtistSurfaceState => ({
    artistKey: 'online:probe-a:artist:1',
    availableActions,
    playableTopSongCount: 9,
    queueableTopSongCount: 9,
    albumCount: 3,
    shownAlbumCount: 3,
    isFilterActive: false,
});
const handle = (availableActions: LibraryArtistSurfaceState['availableActions'] = []): LibraryArtistSurfaceHandle => ({
    getState: () => surfaceState(availableActions),
    run: vi.fn(() => true),
});

describe('artist commands', () => {
    const contextWith = (artist: LibraryArtistSurfaceHandle | null) => ({
        scope: { view: 'home', filter: null, grid: null, directory: null, artist },
        shared: { t: (_key: string, fallback?: string) => fallback ?? '' },
    }) as unknown as CommandPaletteContext;
    const artistCommandIds = COMMAND_PALETTE_COMMANDS
        .filter(command => command.scope === 'artist-surface')
        .map(command => command.id);
    const available = (context: CommandPaletteContext) => COMMAND_PALETTE_COMMANDS
        .filter(command => artistCommandIds.includes(command.id) && isCommandPaletteCommandEnabled(command, context))
        .map(command => command.id);

    it('are registered as one artist-surface group', () => {
        expect(artistCommandIds).toEqual([
            'artist-play-top-songs',
            'artist-enqueue-top-songs',
            'artist-reload',
            'artist-retry-albums',
            'artist-edit-entity',
        ]);
    });

    it('appear only while an artist page is registered, and only the actions it offers', () => {
        expect(available(contextWith(null))).toEqual([]);
        expect(available(contextWith(handle(['play-top-songs', 'reload'])))).toEqual(['artist-play-top-songs', 'artist-reload']);
        expect(available(contextWith(handle(['retry-albums', 'edit-entity'])))).toEqual(['artist-retry-albums', 'artist-edit-entity']);
    });

    it('hand the action to the artist page and carry no global shortcut', async () => {
        const artist = handle(['enqueue-top-songs']);
        const enqueue = COMMAND_PALETTE_COMMANDS.find(command => command.id === 'artist-enqueue-top-songs')!;
        expect(await enqueue.execute('', contextWith(artist))).toBe(true);
        expect(artist.run).toHaveBeenCalledWith('enqueue-top-songs');
        expect(artistCommandIds.every(id => !COMMAND_PALETTE_COMMANDS.find(command => command.id === id)!.executeShortcut)).toBe(true);
    });
});
