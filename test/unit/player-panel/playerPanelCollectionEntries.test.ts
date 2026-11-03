import { describe, expect, it, vi } from 'vitest';
import type { TFunction } from 'i18next';
import type { LocalSong, SongResult } from '@/types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '@/types/localLibrary';
import type { LocalLibraryCatalogSnapshot } from '@/hooks/useLocalLibraryCatalog';
import { createPlayerPanelCollectionEntries } from '@/components/app/player-panel/createPlayerPanelCollectionEntries';

// test/unit/player-panel/playerPanelCollectionEntries.test.ts
// 播放器面板「打开正在播放的专辑 / 歌手」的本地入口：解析规则与宿主的嵌套打开同一份（core/shared/localCatalogLinks），
// 跟随合并重定向，没有歌时不打开。

const t = ((key: string) => key) as unknown as TFunction;
const entity = (id: string, kind: 'artist' | 'album', displayName: string, mergedInto?: string): LocalLibraryEntity => ({
    id, kind, displayName, aliases: [], normalizedAliases: [], mergedInto, createdAt: 0, updatedAt: 0,
});
const assignment = (songId: string, artistEntityIds: string[], albumEntityId?: string): LocalLibraryAssignment => ({
    songId, artistEntityIds, albumEntityId, artistOrigin: 'import', albumOrigin: 'import', updatedAt: 0,
});
const catalog: LocalLibraryCatalogSnapshot = {
    ready: true,
    failed: false,
    reload: async () => {},
    entities: [entity('ar1', 'artist', 'Artist'), entity('ar-old', 'artist', 'Old', 'ar1'), entity('al1', 'album', 'Album'), entity('al-empty', 'album', 'Empty')],
    assignments: [assignment('s1', ['ar-old'], 'al1'), assignment('s2', ['ar1'], 'al1'), assignment('s3', ['ar1'], 'al-empty')],
};
const localSongs = [{ id: 's1' }, { id: 's2' }] as unknown as LocalSong[];
const playing = (songId: string) => ({
    id: 1, name: songId, artists: [{ id: 0, name: 'Artist' }], album: { id: 0, name: 'Album', coverUrl: 'cover' },
    isLocal: true, localRef: { songId },
}) as unknown as SongResult;

const entriesFor = (songId: string) => {
    const navigateToCollection = vi.fn();
    const entries = createPlayerPanelCollectionEntries({
        currentSong: playing(songId), displaySong: playing(songId), localSongs, localLibraryCatalog: catalog, navigateToCollection, t,
    });
    return { entries, navigateToCollection };
};

describe('player panel local collection entries', () => {
    it('opens the playing song\'s album with its songs', () => {
        const { entries, navigateToCollection } = entriesFor('s1');
        entries.openCurrentLocalAlbum();
        expect(navigateToCollection).toHaveBeenCalledWith(expect.objectContaining({
            source: 'local', type: 'album', id: 'al1', entityId: 'al1', name: 'Album', trackCount: 2, songIds: ['s1', 's2'],
        }), 'player');
    });

    it('opens the first artist through its merge redirect, or the requested one', () => {
        const { entries, navigateToCollection } = entriesFor('s1');
        entries.openCurrentLocalArtist();
        expect(navigateToCollection).toHaveBeenLastCalledWith(expect.objectContaining({
            source: 'local', type: 'artist', id: 'ar1', name: 'Artist', songIds: ['s1', 's2'], description: '2 home.songs',
        }), 'player');
        entries.openCurrentLocalArtist('ar-old');
        expect(navigateToCollection).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'ar1' }), 'player');
    });

    it('opens nothing when the entity has no songs in the library', () => {
        const { entries, navigateToCollection } = entriesFor('s3');
        entries.openCurrentLocalAlbum();
        expect(navigateToCollection).not.toHaveBeenCalled();
    });
});
