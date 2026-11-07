import { describe, expect, it, vi } from 'vitest';
import type { LocalSong, SongResult } from '@/types';
import { createLibraryPlaybackPort } from '@/library/app/createLibraryPlaybackPort';
import { buildLocalQueue, buildNavidromeQueue } from '@/services/playbackAdapters';
import type { NavidromeSong } from '@/types/navidrome';

// test/unit/library/app/libraryPlaybackPort.test.ts
// 播放端口把单曲入队按来源分流（与原先宿主里的逻辑逐字一致）：本地歌交给本地队列，
// Navidrome 歌交出播放载体，找不到本地原歌或载体的退回在线入队。整批入队把选项与收下的条数原样转交。

const localSong = { id: 'local-1', fileName: '1.mp3', filePath: '1.mp3', duration: 1, fileSize: 1, mimeType: 'audio/mpeg', addedAt: 1, title: 'L', titleOrigin: 'import', importedMetadata: { title: 'L', titleSource: 'embedded', artistNames: [] } } as LocalSong;
const onlineSong = { id: 9, name: 'O', artists: [], album: { id: 0, name: '' }, durationMs: 1, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '9' } } as SongResult;
const naviCarrier = {
    id: 'n-1', name: 'N', artists: [], album: { id: 0, name: '' }, durationMs: 1, isNavidrome: true,
    navidromeData: { id: 'n-1', streamUrl: 'x', albumId: 'a', artistId: 'b', path: 'p' },
} as unknown as NavidromeSong;

const surface = (localSongs: LocalSong[] = [localSong]) => ({
    onPlaySong: vi.fn(),
    onPlayAll: vi.fn(),
    onAddAllToQueue: vi.fn(),
    onAddSongToQueue: vi.fn(),
    onAddLocalSongToQueue: vi.fn(),
    onAddNavidromeSongsToQueue: vi.fn(),
    localSongs,
});

describe('library playback port', () => {
    it('routes a local song to the local queue with its library entry', () => {
        const props = surface();
        createLibraryPlaybackPort(props).enqueueTrack(buildLocalQueue([localSong])[0]);
        expect(props.onAddLocalSongToQueue).toHaveBeenCalledWith(localSong);
        expect(props.onAddSongToQueue).not.toHaveBeenCalled();
    });

    it('falls back to the online path when the local entry is gone', () => {
        const props = surface([]);
        const track = buildLocalQueue([localSong])[0];
        createLibraryPlaybackPort(props).enqueueTrack(track);
        expect(props.onAddSongToQueue).toHaveBeenCalledWith(track);
    });

    it('hands a Navidrome song over as its playback carrier', () => {
        const props = surface();
        createLibraryPlaybackPort(props).enqueueTrack(buildNavidromeQueue([naviCarrier])[0]);
        expect(props.onAddNavidromeSongsToQueue).toHaveBeenCalledTimes(1);
        expect(props.onAddNavidromeSongsToQueue.mock.calls[0][0][0].navidromeData.id).toBe('n-1');
    });

    it('passes play, play-all and enqueue-all straight through', () => {
        const props = surface();
        const port = createLibraryPlaybackPort(props);
        port.playTrack(onlineSong, [onlineSong]);
        port.playAll([onlineSong]);
        port.enqueueAll([onlineSong]);
        port.enqueueTrack(onlineSong);
        expect(props.onPlaySong).toHaveBeenCalledWith(onlineSong, [onlineSong]);
        expect(props.onPlayAll).toHaveBeenCalledWith([onlineSong]);
        expect(props.onAddAllToQueue).toHaveBeenCalledWith([onlineSong], undefined);
        expect(props.onAddSongToQueue).toHaveBeenCalledWith(onlineSong);
    });

    // b0bea643 起端口吞掉了这两样，歌手页的「加入热门歌曲」因此先弹队列自己的提示、再报交出去的条数而不是收下的条数。
    it('passes the enqueue-all options through and returns how many songs the queue took', () => {
        const props = surface();
        props.onAddAllToQueue.mockReturnValue(1);
        const port = createLibraryPlaybackPort(props);
        expect(port.enqueueAll([onlineSong, onlineSong], { suppressToast: true })).toBe(1);
        expect(props.onAddAllToQueue).toHaveBeenCalledWith([onlineSong, onlineSong], { suppressToast: true });
    });

    it('returns nothing when the host does not count', () => {
        const props = { ...surface(), onAddAllToQueue: undefined };
        expect(createLibraryPlaybackPort(props).enqueueAll([onlineSong])).toBeUndefined();
    });
});
