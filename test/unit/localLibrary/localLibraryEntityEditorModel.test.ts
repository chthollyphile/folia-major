import { describe, expect, it } from 'vitest';
import type { LocalSong } from '../../../src/types';
import type { LocalLibraryEntity } from '../../../src/types/localLibrary';
import {
    buildEntityNameSuggestions,
    filterEntityMemberSongs,
    filterMergeEntitySuggestions,
    findExactEntitySuggestion,
} from '../../../src/components/local-library-entity/entityEditorModel';

// test/unit/localLibrary/localLibraryEntityEditorModel.test.ts
// Verifies the input suggestions and search behavior used by the entity editor.

type SongOverrides = Partial<LocalSong> & { artist?: string; album?: string; embeddedArtist?: string };
const createSong = (id: string, overrides: SongOverrides = {}): LocalSong => {
    const { artist, album, embeddedArtist, importedMetadata, ...rest } = overrides;
    return {
        id,
        fileName: `${id}.mp3`,
        filePath: `/music/${id}.mp3`,
        title: id,
        titleOrigin: 'import',
        importedMetadata: importedMetadata || {
            title: id,
            titleSource: 'filename',
            artistNames: embeddedArtist || artist ? [embeddedArtist || artist!] : [],
            albumName: album,
        },
        duration: 180_000,
        fileSize: 1_024,
        mimeType: 'audio/mpeg',
        addedAt: 1,
        ...rest,
    };
};

const createEntity = (
    id: string,
    displayName: string,
    overrides: Partial<LocalLibraryEntity> = {},
): LocalLibraryEntity => ({
    id,
    kind: 'artist',
    displayName,
    aliases: [],
    normalizedAliases: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
});

describe('local-library entity editor model', () => {
    it('builds ranked artist name suggestions without double-counting one song', () => {
        const suggestions = buildEntityNameSuggestions('artist', [
            createSong('one', {
                importedMetadata: { title: 'one', titleSource: 'filename', artistNames: ['小山百代', '三森すずこ'] },
                onlineMetadata: { source: 'netease', artists: [{ name: '三森すずこ' }], matchMode: 'manual', matchedAt: 1 },
            }),
            createSong('two', { embeddedArtist: '三森すずこ' }),
        ]);

        expect(suggestions).toEqual([
            { name: '三森すずこ', count: 2 },
            { name: '小山百代', count: 1 },
        ]);
    });

    it('searches merge candidates by display name and alias while excluding invalid targets', () => {
        const entities = [
            createEntity('current', '三森すずこ'),
            createEntity('duplicate', 'Mimori Suzuko', { aliases: ['みもりん'] }),
            createEntity('other', '小山百代'),
            createEntity('merged', '旧实体', { mergedInto: 'current' }),
            createEntity('prefix', 'みもりん候补'),
        ];

        expect(filterMergeEntitySuggestions(entities, 'current', 'みもりん'))
            .toEqual([entities[1], entities[4]]);
        const availableIds = filterMergeEntitySuggestions(entities, 'current', '').map(entity => entity.id);
        expect(availableIds).toHaveLength(3);
        expect(availableIds).toEqual(expect.arrayContaining(['duplicate', 'other', 'prefix']));
    });

    it('filters entity members using both visible metadata and file names', () => {
        const songs = [
            createSong('one', { title: 'RE:CREATE', artist: '三森すずこ' }),
            createSong('two', { fileName: 'fly-me-to-the-star.flac', album: '少女☆歌劇' }),
        ];

        expect(filterEntityMemberSongs(songs, 'create').map(song => song.id)).toEqual(['one']);
        expect(filterEntityMemberSongs(songs, 'fly-me').map(song => song.id)).toEqual(['two']);
    });

    it('recognizes an existing split destination by display name or alias', () => {
        const entities = [
            createEntity('album-one', '少女☆歌劇', { kind: 'album', aliases: ['Revue Starlight'] }),
            createEntity('album-two', '別のアルバム', { kind: 'album' }),
        ];

        expect(findExactEntitySuggestion(entities, '少女☆歌劇')?.id).toBe('album-one');
        expect(findExactEntitySuggestion(entities, 'revue starlight')?.id).toBe('album-one');
        expect(findExactEntitySuggestion(entities, 'new album')).toBeUndefined();
    });
});
