import { describe, expect, it } from 'vitest';
import {
    deriveDisplayTracks,
    derivePlayableTracks,
    resolveContextTracks,
    type LocalTrackSortContext,
} from '@/library/core/collection/collectionView';
import { resolveGridViewContextTracks } from '@/library/suites/grid/collection/gridViewContextActions';
import { buildLocalQueue } from '@/services/playbackAdapters';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';
import type { LocalSong, SongResult, UnifiedSong } from '@/types';

// test/unit/library/core/collectionView.test.ts
// 「展示什么、能播什么、操作作用在哪些歌上」的派生规则。逻辑原样搬自 GridView，
// 这里把那些不显眼的细节钉住：隐藏按两种拼法匹配、本地排序只在给了排序上下文时生效、
// 操作范围在有筛选时只取命中且可播放的歌。

const localSong = (index: number, album: string, trackNumber: number, lastModified: number): LocalSong => ({
    id: `local-${index}`,
    fileName: `${String(index).padStart(2, '0')}.mp3`,
    filePath: `Folder/${index}.mp3`,
    duration: 1000,
    fileSize: 1,
    fileLastModified: lastModified,
    mimeType: 'audio/mpeg',
    addedAt: index,
    title: `Local ${index}`,
    titleOrigin: 'import',
    importedMetadata: { title: `Local ${index}`, titleSource: 'embedded', artistNames: ['A'], albumName: album },
    trackNumber,
});

const LOCAL_SONGS = [
    localSong(1, 'Beta', 2, 300),
    localSong(2, 'Alpha', 1, 100),
    localSong(3, 'Beta', 1, 200),
    localSong(4, 'Alpha', 2, 400),
];
const LOCAL_TRACKS = buildLocalQueue(LOCAL_SONGS) as SongResult[];
const songsById = new Map(LOCAL_SONGS.map(song => [song.id, song]));
const sort = (field: LocalTrackSortContext['field'], direction: LocalTrackSortContext['direction'] = 'asc'): LocalTrackSortContext => (
    { songsById, field, direction }
);
// 本地曲目的播放 id 是派生出来的数字，断言用它指向的本地歌 id。
const ids = (tracks: SongResult[]) => tracks.map(track => (track as UnifiedSong).localRef?.songId ?? String(track.id));

const online = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
} as SongResult);

describe('deriveDisplayTracks', () => {
    it('keeps the loaded order and the same array when nothing is hidden or sorted', () => {
        expect(deriveDisplayTracks(LOCAL_TRACKS, new Set(), null)).toBe(LOCAL_TRACKS);
    });

    it('hides by playback key, and by key plus loaded index for one duplicate occurrence', () => {
        const tracks = [online('a'), online('b'), online('a')];
        const keyA = getPlaybackSongKey(tracks[0]);
        expect(ids(deriveDisplayTracks(tracks, new Set([keyA]), null))).toEqual(['b']);
        expect(ids(deriveDisplayTracks(tracks, new Set([`${keyA}-2`]), null))).toEqual(['a', 'b']);
    });

    it('sorts local songs by file name, modified time and album track in both directions', () => {
        expect(ids(deriveDisplayTracks(LOCAL_TRACKS, new Set(), sort('fileName')))).toEqual(['local-1', 'local-2', 'local-3', 'local-4']);
        expect(ids(deriveDisplayTracks(LOCAL_TRACKS, new Set(), sort('fileLastModified')))).toEqual(['local-2', 'local-3', 'local-1', 'local-4']);
        expect(ids(deriveDisplayTracks(LOCAL_TRACKS, new Set(), sort('fileLastModified', 'desc')))).toEqual(['local-4', 'local-1', 'local-3', 'local-2']);
        // 专辑名领先，再按曲目号：Alpha(2,4) 在 Beta(3,1) 之前。
        expect(ids(deriveDisplayTracks(LOCAL_TRACKS, new Set(), sort('albumTrack')))).toEqual(['local-2', 'local-4', 'local-3', 'local-1']);
        expect(ids(deriveDisplayTracks(LOCAL_TRACKS, new Set(), sort('albumTrack', 'desc')))).toEqual(['local-1', 'local-3', 'local-4', 'local-2']);
    });

    it('does not sort without a local library to look songs up in', () => {
        const emptyLibrary = { ...sort('fileLastModified'), songsById: new Map() };
        expect(deriveDisplayTracks(LOCAL_TRACKS, new Set(), emptyLibrary)).toBe(LOCAL_TRACKS);
    });
});

describe('playable and context tracks', () => {
    const tracks = [online('a'), online('b'), online('c')];
    const unavailable = (track: SongResult) => track.id === 'b';

    it('drops unavailable songs from the playable list, keeping order', () => {
        expect(ids(derivePlayableTracks(tracks, unavailable))).toEqual(['a', 'c']);
    });

    it('acts on every playable song without a filter, and on matched playable songs with one', () => {
        const playable = derivePlayableTracks(tracks, unavailable);
        expect(resolveContextTracks(null, playable, unavailable)).toBe(playable);
        expect(ids(resolveContextTracks([tracks[1], tracks[2]], playable, unavailable))).toEqual(['c']);
        expect(resolveContextTracks([], playable, unavailable)).toEqual([]);
    });

    it('keeps the grid wrapper on the same rule', () => {
        const playable = derivePlayableTracks(tracks, () => false);
        expect(resolveGridViewContextTracks([{ rawTrack: tracks[2] }, {}], playable, true)).toEqual([tracks[2]]);
        expect(resolveGridViewContextTracks([{ rawTrack: tracks[2] }], playable, false)).toBe(playable);
    });
});
