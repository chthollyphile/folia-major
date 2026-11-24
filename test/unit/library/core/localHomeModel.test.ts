import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { LocalLibraryGroup, LocalSong } from '@/types';
import type { FoliaPlaylist } from '@/types/foliaPlaylist';
import { summaryOfFoliaPlaylist } from '../../helpers/foliaPlaylistSummary';

const localEntries = (songIds: string[]) => songIds.map(id => ({ key: `local:${id}`, song: { id }, addedAt: 1 }));
import {
    buildLocalHomeCards,
    buildLocalHomeGroups,
    localBatchSelectionType,
    localHomeSectionOfRow,
    LOCAL_HOME_SECTIONS,
    resolveLocalHomeActions,
} from '@/library/core/home/localHomeModel';
import { buildFoliaHomeGroups, resolveFoliaHomeActions } from '@/library/core/home/foliaHomeModel';

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
        const groups = buildLocalHomeGroups(songs, t, undefined, noCover);
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
        const groups = buildLocalHomeGroups(songs, t, undefined, resolver);
        expect(groups.folders.find(group => group.id === 'folder-A')?.coverUrl).toBe('cover:new@512');
    });
});

describe('buildFoliaHomeGroups', () => {
    it('lists the favourite first, counts every entry and keeps only local songs on the group', () => {
        const songs = [song('s1', 'A'), song('s2', 'A')];
        const playlists = [
            // 别的来源的条目算进首数，但分组上的 songs 只有本地歌；曲库里找不到的本地歌不算。
            { id: 'p1', name: 'Mine', entries: [...localEntries(['s1', 'missing']), { key: 'online:netease:9', song: { id: 9, album: { coverUrl: 'https://img/9.jpg' } }, addedAt: 1 }, ...localEntries(['s2'])] },
            { id: 'fav', name: 'Liked Songs', entries: localEntries(['s2']), isFavorite: true },
            { id: 'p2', name: 'Online only', entries: [{ key: 'online:netease:9', song: { id: 9, album: { coverUrl: 'https://img/9.jpg' } }, addedAt: 1 }] },
        ] as unknown as FoliaPlaylist[];
        const groups = buildFoliaHomeGroups(playlists.map(summaryOfFoliaPlaylist), songs, t, noCover);
        expect(groups.map(group => [group.id, group.name, group.isVirtual ?? false, group.songs.map(item => item.id), group.trackCount])).toEqual([
            ['playlist-fav', 'localMusic.favoritePlaylist', true, ['s2'], 1],
            ['playlist-p1', 'Mine', false, ['s1', 's2'], 3],
            ['playlist-p2', 'Online only', false, [], 1],
        ]);
        expect(groups.map(group => group.playlistId)).toEqual(['fav', 'p1', 'p2']);
    });

    it('offers new, reorder (needs two ordinary playlists), import and the scratchpad', () => {
        expect(resolveFoliaHomeActions({ reorderableCount: 1, importingPlaylist: false }).map(action => [action.id, action.disabled])).toEqual([
            ['folia-new-playlist', false],
            ['folia-reorder-playlists', true],
            ['folia-import-playlist', false],
            ['folia-open-scratchpad', false],
        ]);
        const busy = resolveFoliaHomeActions({ reorderableCount: 2, importingPlaylist: true });
        expect(busy[1].disabled).toBe(false);
        expect(busy[2]).toMatchObject({ labelKey: 'localMusic.importingPlaylist', pending: true, disabled: true });
    });
});

describe('local home sections and cards', () => {
    it('defines three sections in row order and maps any other row (the old playlists row too) to folders', () => {
        expect(LOCAL_HOME_SECTIONS.map(section => [section.key, section.row])).toEqual([
            ['folders', 0], ['albums', 1], ['artists', 2],
        ]);
        expect(localHomeSectionOfRow(2).key).toBe('artists');
        expect(localHomeSectionOfRow(3).key).toBe('folders');
        expect(localHomeSectionOfRow(9).key).toBe('folders');
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

    it('folders, albums and artists all support batch', () => {
        expect((['folders', 'albums', 'artists'] as const).map(key => localBatchSelectionType(key))).toEqual(['folders', 'albums', 'artists']);
    });
});

describe('resolveLocalHomeActions', () => {
    const idle = { importingFolder: false, refreshingFolders: false, importingPlaylist: false, scan: null };

    it('offers import folder and refresh, both enabled when idle', () => {
        expect(resolveLocalHomeActions(idle)).toEqual([
            { id: 'import-folder', labelKey: 'localMusic.importFolder', titleKey: 'localMusic.importFolder', pending: false, disabled: false },
            { id: 'refresh-folders', labelKey: 'options.refresh', titleKey: 'options.refresh', pending: false, disabled: false },
        ]);
    });

    it('a running import disables both and relabels its own button', () => {
        const actions = resolveLocalHomeActions({ ...idle, importingFolder: true });
        expect(actions.map(action => [action.id, action.labelKey, action.pending, action.disabled])).toEqual([
            ['import-folder', 'localMusic.importing', true, true],
            ['refresh-folders', 'options.refresh', false, true],
        ]);
    });

    it('a scan shows refresh as scanning', () => {
        const actions = resolveLocalHomeActions({ ...idle, scan: { active: true, folderName: 'A', totalSongs: 2, completedSongs: 1 } });
        expect(actions[1]).toMatchObject({ labelKey: 'options.scanning', pending: true, disabled: true });
    });
});
