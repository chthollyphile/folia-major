import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { LocalLibraryGroup, LocalPlaylist, LocalSong } from '@/types';
import {
    buildLocalHomeCards,
    buildLocalHomeGroups,
    localBatchSelectionType,
    localHomeSectionOfRow,
    LOCAL_HOME_SECTIONS,
    resolveLocalHomeActions,
} from '@/library/core/home/localHomeModel';

// test/unit/library/core/localHomeModel.test.ts
// 本地页签的模型（原 localGrid3DModel 与 LocalGrid3DView 里的 section / 卡片 / 动作）：注入的封面解析、
// 虚拟「全部歌曲」、section 定义与 activeRow 映射、卡片带歌曲 id 与 isVirtual、批量 section、三个导入动作的状态。

const t = ((key: string) => key) as unknown as TFunction;
const song = (id: string, folderName: string, patch: Partial<LocalSong> = {}): LocalSong => ({
    id,
    folderName,
    fileName: `${id}.mp3`,
    importedMetadata: { albumName: `Album ${folderName}`, artistNames: ['Artist'] },
    addedAt: Number(id.replace(/\D/g, '')) || 0,
    ...patch,
} as unknown as LocalSong);

const noCover = () => null;

describe('buildLocalHomeGroups', () => {
    it('puts the virtual All Songs folder first and sorts real folders by name', () => {
        const songs = [song('s1', 'B'), song('s2', 'A'), song('s3', 'B')];
        const groups = buildLocalHomeGroups(songs, [], t, undefined, noCover);
        expect(groups.folders.map(group => [group.id, group.isVirtual ?? false, group.trackCount])).toEqual([
            ['folder-__all-songs__', true, 3],
            ['folder-A', false, 1],
            ['folder-B', false, 2],
        ]);
    });

    it('resolves covers through the injected resolver (newest song with a cover wins)', () => {
        const songs = [
            song('s1', 'A', { localCoverAssetId: 'old' }),
            song('s9', 'A', { localCoverAssetId: 'new' }),
        ];
        const resolver = (assetId: string | undefined, size?: number) => (assetId ? `cover:${assetId}${size ? `@${size}` : ''}` : null);
        const groups = buildLocalHomeGroups(songs, [], t, undefined, resolver);
        expect(groups.folders.find(group => group.id === 'folder-A')?.coverUrl).toBe('cover:new@512');
    });

    it('builds playlists in order with the favorite one marked virtual', () => {
        const songs = [song('s1', 'A'), song('s2', 'A')];
        const playlists = [
            { id: 'fav', name: 'Liked', songIds: ['s2'], isFavorite: true },
            { id: 'p1', name: 'Mine', songIds: ['s1', 'missing', 's2'] },
        ] as unknown as LocalPlaylist[];
        const groups = buildLocalHomeGroups(songs, playlists, t, undefined, noCover);
        expect(groups.playlists.map(group => [group.id, group.isVirtual ?? false, group.songs.map(item => item.id)])).toEqual([
            ['playlist-fav', true, ['s2']],
            ['playlist-p1', false, ['s1', 's2']],
        ]);
    });
});

describe('local home sections and cards', () => {
    it('defines four sections in row order and maps any other row to folders', () => {
        expect(LOCAL_HOME_SECTIONS.map(section => [section.key, section.row])).toEqual([
            ['folders', 0], ['albums', 1], ['artists', 2], ['playlists', 3],
        ]);
        expect(localHomeSectionOfRow(2).key).toBe('artists');
        expect(localHomeSectionOfRow(9).key).toBe('folders');
        expect(LOCAL_HOME_SECTIONS[3].fallbackLabelKey).toBe('home.playlists');
    });

    it('cards carry the song ids, the virtual flag and the group itself', () => {
        const group = {
            id: 'folder-__all-songs__',
            type: 'folder',
            name: 'All Songs',
            songs: [song('s1', 'A'), song('s2', 'B')],
            trackCount: 2,
            description: 'localMusic.folder',
            isVirtual: true,
        } as unknown as LocalLibraryGroup;
        expect(buildLocalHomeCards([group])).toEqual([{
            id: 'folder-__all-songs__',
            name: 'All Songs',
            coverUrl: undefined,
            description: 'localMusic.folder',
            trackCount: 2,
            type: 'folder',
            isVirtual: true,
            trackIds: ['s1', 's2'],
            raw: group,
        }]);
    });

    it('only folders, albums and artists support batch', () => {
        expect(['folders', 'albums', 'artists', 'playlists'].map(key => localBatchSelectionType(key as never))).toEqual(['folders', 'albums', 'artists', null]);
    });
});

describe('resolveLocalHomeActions', () => {
    const idle = { importingFolder: false, refreshingFolders: false, importingPlaylist: false, scan: null };

    it('offers import folder, refresh and import playlist, all enabled when idle', () => {
        expect(resolveLocalHomeActions(idle)).toEqual([
            { id: 'import-folder', labelKey: 'localMusic.importFolder', titleKey: 'localMusic.importFolder', pending: false, disabled: false },
            { id: 'refresh-folders', labelKey: 'options.refresh', titleKey: 'options.refresh', pending: false, disabled: false },
            { id: 'import-playlist', labelKey: 'localMusic.importPlaylist', titleKey: 'localMusic.importPlaylist', pending: false, disabled: false },
        ]);
    });

    it('a running import disables all three and relabels its own button', () => {
        const actions = resolveLocalHomeActions({ ...idle, importingFolder: true });
        expect(actions.map(action => [action.id, action.labelKey, action.pending, action.disabled])).toEqual([
            ['import-folder', 'localMusic.importing', true, true],
            ['refresh-folders', 'options.refresh', false, true],
            ['import-playlist', 'localMusic.importPlaylist', false, true],
        ]);
    });

    it('a scan shows refresh as scanning', () => {
        const actions = resolveLocalHomeActions({ ...idle, scan: { active: true, folderName: 'A', totalSongs: 2, completedSongs: 1 } });
        expect(actions[1]).toMatchObject({ labelKey: 'options.scanning', pending: true, disabled: true });
    });

    it('a playlist import relabels the playlist button', () => {
        expect(resolveLocalHomeActions({ ...idle, importingPlaylist: true })[2]).toMatchObject({ labelKey: 'localMusic.importingPlaylist', pending: true, disabled: true });
    });
});
