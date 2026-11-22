import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    FOLIA_PLAYLIST_FILE_FORMAT,
    FOLIA_PLAYLIST_FILE_MAX_BYTES,
    FOLIA_PLAYLIST_FILE_MAX_ENTRIES,
    FOLIA_PLAYLIST_FILE_VERSION,
    buildFoliaLocalMatchIndex,
    detectPlaylistFileFormat,
    isCredentialKeyName,
    matchFoliaLocalSong,
    parseFoliaPlaylistFile,
    previewFoliaPlaylistFile,
    serializeFoliaPlaylistFile,
    type FoliaFileNavidromeUrls,
} from '@/services/foliaPlaylist/foliaPlaylistFile';
import { importPlaylistFileReading, readPlaylistFileText } from '@/services/foliaPlaylist/foliaPlaylistFileIo';
import {
    FoliaOriginUnconfirmedError,
    addSongsToFoliaPlaylist,
    confirmFoliaPlaylistOrigin,
    createFoliaPlaylist,
    getFoliaPlaylist,
    getFoliaPlaylistSummary,
    getFoliaPlaylists,
    refreshFoliaPlaylistFromOrigin,
    resetFoliaPlaylistStorage,
    saveCollectionAsFoliaPlaylist,
} from '@/services/foliaPlaylist/foliaPlaylistService';
import { foliaOriginNeedsConfirmation } from '@/utils/foliaPlaylistTransfer';
import { buildLocalEntry } from '@/services/foliaPlaylist/foliaPlaylistRows';
import { serializeFoliaPlaylistToM3u8 } from '@/services/foliaPlaylist/foliaPlaylistM3u';
import { appDatabase } from '@/services/appDatabase';
import type { FoliaEntryAvailabilityDeps } from '@/library/core/foliaPlaylist/foliaPlaylist.contract';
import type { LocalSong, SongResult, UnifiedSong } from '@/types';
import type { FoliaPlaylist, FoliaPlaylistEntry } from '@/types/foliaPlaylist';

// test/unit/services/foliaPlaylist/foliaPlaylistFile.test.ts
// Folia 歌单的 JSON 文件：写出去的东西里没有不该出去的、读回来和写出去的对得上、不可信的文件怎么被校验、
// 本地歌怎么重新认、读入前的预览、两种格式按内容认。

const SECRET = 'tok-SECRET-123';
const localSong = (id: string, filePath: string, patch: Partial<LocalSong> = {}): LocalSong => {
    const fileName = filePath.split('/').pop() ?? filePath;
    const title = fileName.replace(/\.[^.]+$/, '');
    return {
        id,
        fileName,
        filePath,
        title,
        titleOrigin: 'import',
        importedMetadata: { title, titleSource: 'filename', artistNames: ['Artist'], albumName: 'Album' },
        duration: 180_000,
        fileSize: 5_000_000,
        mimeType: 'audio/mpeg',
        addedAt: 1,
        folderName: filePath.split('/')[0],
        ...patch,
    } as LocalSong;
};
const online = (providerId: string, mediaId: string, patch: Record<string, unknown> = {}): SongResult => ({
    id: mediaId,
    name: `song ${mediaId}`,
    artists: [{ id: 'ar1', name: 'Singer', catalogRef: { providerId, kind: 'artist', id: 'ar1' } }],
    album: { id: 'al1', name: 'Album', coverUrl: 'https://img.example/c.jpg?param=300y300', catalogRef: { providerId, kind: 'album', id: 'al1' } },
    durationMs: 200_000,
    sourceRef: { kind: 'online', providerId, mediaId, providerData: { platform: 'wy', page: `https://x.example/a?token=${SECRET}`, nested: { blob: 'blob:app/1', keep: 3 } } },
    ...patch,
} as unknown as SongResult);
const navidrome = (id: string): SongResult => ({
    id: -5,
    name: `navi ${id}`,
    artists: [{ id: 0, name: 'N Artist' }],
    album: { id: 0, name: 'N Album', coverUrl: `https://navi.example/rest/getCoverArt?id=al-${id}&u=me&t=${SECRET}&s=salt` },
    durationMs: 100_000,
    isNavidrome: true,
    sourceRef: { kind: 'navidrome', mediaId: id },
    navidromeData: {
        id,
        streamUrl: `https://navi.example/rest/stream?id=${id}&u=me&t=${SECRET}&s=salt`,
        coverArtUrl: `https://navi.example/rest/getCoverArt?id=al-${id}&u=me&t=${SECRET}&s=salt`,
        albumId: 'alb',
        artistId: 'art',
        path: 'Artist/Album/01.flac',
        suffix: 'flac',
        bitRate: 900,
    },
} as unknown as SongResult);
const entryOf = (song: SongResult, key: string, patch: Partial<FoliaPlaylistEntry> = {}): FoliaPlaylistEntry => ({ key, song, addedAt: 10, ...patch });
const LIBRARY = [localSong('l1', 'Music/A/one.mp3'), localSong('l2', 'Music/B/two.flac', { fileSize: 9, duration: 60_000 })];
const playlistOf = (entries: FoliaPlaylistEntry[], patch: Partial<FoliaPlaylist> = {}): FoliaPlaylist => ({
    id: 'p1', name: 'Mixed', createdAt: 5, updatedAt: 6, entries, ...patch,
});
const MIXED = playlistOf([
    entryOf(online('netease', '1'), 'online:netease:1'),
    entryOf(online('lxmusic', 'wy:2'), 'online:lxmusic:wy:2', { originalKey: 'online:netease:2', fromOrigin: true }),
    entryOf(navidrome('n1'), 'navidrome:n1'),
    buildLocalEntry(LIBRARY[0], 11),
    buildLocalEntry(localSong('gone', 'Music/x.mp3'), 12),
], { origin: { sourceId: 'netease', collectionId: 'c1', name: 'Origin', savedAt: 3, playVia: 'lxmusic', refreshedAt: 4 } });
const allOn: FoliaEntryAvailabilityDeps = {
    hasLocalSong: () => true, isSourceRegistered: () => true, isSourceSwitchedOn: () => true, isNavidromeConfigured: () => true,
};
const urls: FoliaFileNavidromeUrls = { stream: id => `https://here/stream?id=${id}`, coverArt: id => `https://here/cover?id=${id}` };
const fileOf = (entries: unknown[], playlist: Record<string, unknown> = {}, top: Record<string, unknown> = {}) => JSON.stringify({
    format: FOLIA_PLAYLIST_FILE_FORMAT, version: FOLIA_PLAYLIST_FILE_VERSION, playlist: { name: 'P', entries, ...playlist }, ...top,
});
const parsed = (text: string) => {
    const result = parseFoliaPlaylistFile(text);
    if (!result.ok) throw new Error(result.error);
    return result.file;
};

describe('serializeFoliaPlaylistFile', () => {
    const exported = serializeFoliaPlaylistFile(MIXED, LIBRARY, { now: 99 });
    const data = JSON.parse(exported.content) as { format: string; version: number; exportedAt: number; playlist: { name: string; origin: unknown; entries: Array<Record<string, unknown>> } };

    it('writes the format mark, the version, the name, the origin and every entry it can', () => {
        expect(data).toMatchObject({ format: 'folia-playlist', version: 1, exportedAt: 99, playlist: { name: 'Mixed' } });
        expect(data.playlist.origin).toEqual({ sourceId: 'netease', collectionId: 'c1', name: 'Origin', savedAt: 3, playVia: 'lxmusic', refreshedAt: 4 });
        expect(data.playlist.entries.map(entry => entry.source)).toEqual(['online', 'online', 'navidrome', 'local']);
        // 曲库里找不到的本地歌没有能让别处认回它的东西：不写，并说出来。
        expect(exported).toMatchObject({ exportedCount: 4, skippedCount: 1 });
        expect(data.playlist.entries[1]).toMatchObject({ originalKey: 'online:netease:2', fromOrigin: true, addedAt: 10 });
    });

    it('keeps credentials and addresses that carry them out of the file', () => {
        expect(exported.content).not.toContain(SECRET);
        expect(exported.content).not.toContain('blob:');
        expect(exported.content).not.toContain('streamUrl');
        expect(exported.content).not.toContain('navi.example');
        // 音源自己的数据里别的东西留着；封面地址可以带。
        const first = data.playlist.entries[0].song as UnifiedSong;
        expect(first.sourceRef).toEqual({ kind: 'online', providerId: 'netease', mediaId: '1', providerData: { platform: 'wy', nested: { keep: 3 } } });
        expect(first.album.coverUrl).toBe('https://img.example/c.jpg?param=300y300');
        expect(data.playlist.entries[2].navidrome).toEqual({ id: 'n1', albumId: 'alb', artistId: 'art', path: 'Artist/Album/01.flac', suffix: 'flac', bitRate: 900, coverArtId: 'al-n1' });
    });

    it('gives a local song what it takes to find the same file elsewhere', () => {
        expect(data.playlist.entries[3]).toMatchObject({
            source: 'local',
            song: { name: 'one', artists: [{ name: 'Artist' }], album: { name: 'Album' }, durationMs: 180_000 },
            local: { path: 'Music/A/one.mp3', fileName: 'one.mp3', fileSize: 5_000_000, durationMs: 180_000 },
        });
        expect(JSON.stringify(data.playlist.entries[3])).not.toContain('l1');
    });

    it('uses the name it is given, and marks the fixed favorite playlist', () => {
        const favorite = JSON.parse(serializeFoliaPlaylistFile(playlistOf([], { isFavorite: true, name: 'Liked Songs' }), [], { name: '我喜欢的音乐' }).content);
        expect(favorite.playlist).toMatchObject({ name: '我喜欢的音乐', favorite: true });
    });
});

describe('a file written here reads back the same', () => {
    it('round-trips a mixed playlist', () => {
        const exported = serializeFoliaPlaylistFile(MIXED, LIBRARY);
        const preview = previewFoliaPlaylistFile(parsed(exported.content), LIBRARY, allOn, urls, 50);
        expect(preview.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'navidrome:n1', 'local:l1']);
        expect(preview.entries[1]).toMatchObject({ originalKey: 'online:netease:2', fromOrigin: true, addedAt: 10 });
        // 出处读回来带着「文件说的」记号。
        expect(preview.origin).toEqual({ ...MIXED.origin, fromFile: true });
        expect(preview).toMatchObject({ name: 'Mixed', favorite: false, total: 4, unavailableCount: 0, invalidCount: 0, duplicateCount: 0 });
        expect(preview.local).toMatchObject({ matched: 1, unmatched: 0 });
        expect(preview.sources).toEqual([
            { key: 'online:netease', sourceId: 'netease', count: 1 },
            { key: 'online:lxmusic', sourceId: 'lxmusic', count: 1 },
            { key: 'navidrome', count: 1 },
            { key: 'local', count: 1 },
        ]);
        // Navidrome 的地址用这台机器的账号现拼。
        const navi = preview.entries[2].song as unknown as { navidromeData: Record<string, unknown>; album: { coverUrl?: string }; isNavidrome: boolean };
        expect(navi.navidromeData).toMatchObject({ id: 'n1', streamUrl: 'https://here/stream?id=n1', coverArtUrl: 'https://here/cover?id=al-n1', suffix: 'flac' });
        expect(navi.album.coverUrl).toBe('https://here/cover?id=al-n1');
        expect(navi.isNavidrome).toBe(true);
        // 本地歌读回来是这台机器曲库里的那条记录。
        expect((preview.entries[3].song as UnifiedSong).localRef).toEqual({ songId: 'l1' });
    });
});

describe('parseFoliaPlaylistFile', () => {
    it('says what is wrong with a file it cannot take', () => {
        expect(parseFoliaPlaylistFile('{ nope')).toEqual({ ok: false, error: 'not-json' });
        expect(parseFoliaPlaylistFile('{"a":1}')).toEqual({ ok: false, error: 'not-folia-playlist' });
        expect(parseFoliaPlaylistFile('[]')).toEqual({ ok: false, error: 'not-folia-playlist' });
        expect(parseFoliaPlaylistFile(fileOf([], {}, { version: 2 }))).toEqual({ ok: false, error: 'newer-version' });
        expect(parseFoliaPlaylistFile(fileOf([], {}, { version: 'x' }))).toEqual({ ok: false, error: 'damaged' });
        expect(parseFoliaPlaylistFile(fileOf([], {}, { version: 0 }))).toEqual({ ok: false, error: 'damaged' });
        expect(parseFoliaPlaylistFile(JSON.stringify({ format: FOLIA_PLAYLIST_FILE_FORMAT, version: 1, playlist: { entries: 'x' } }))).toEqual({ ok: false, error: 'damaged' });
        expect(parseFoliaPlaylistFile(JSON.stringify({ format: FOLIA_PLAYLIST_FILE_FORMAT, version: 1 }))).toEqual({ ok: false, error: 'damaged' });
    });

    it('refuses a file over the limits', () => {
        const many = Array.from({ length: FOLIA_PLAYLIST_FILE_MAX_ENTRIES + 1 }, () => 0);
        expect(parseFoliaPlaylistFile(fileOf(many))).toEqual({ ok: false, error: 'too-large' });
        expect(parseFoliaPlaylistFile(' '.repeat(FOLIA_PLAYLIST_FILE_MAX_BYTES + 1))).toEqual({ ok: false, error: 'too-large' });
    });

    it('drops entries that are not what they should be, and counts them', () => {
        const good = { source: 'online', addedAt: 1, song: { id: '1', name: 'ok', artists: [], album: { name: '' }, durationMs: 1, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } } };
        const file = parsed(fileOf([
            good,
            null,
            'text',
            { source: 'online', song: { name: 'no ref' } },
            { source: 'online', song: { ...good.song, sourceRef: { kind: 'online', providerId: 'bad id!', mediaId: '1' } } },
            { source: 'online', song: { ...good.song, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '' } } },
            { source: 'online', song: { ...good.song, sourceRef: { kind: 'stage', mediaId: 's' } } },
            { source: 'online', song: { ...good.song, name: '' } },
            { source: 'stage', song: good.song },
            { source: 'navidrome', song: { name: 'n' }, navidrome: { id: 5 } },
            { source: 'local', song: { name: 'l' }, local: {} },
            { source: 'local', song: { name: 'l' } },
        ]));
        expect(file.entries).toHaveLength(1);
        expect(file.invalidCount).toBe(11);
    });

    it('keeps only the fields it knows, whatever the file holds', () => {
        const file = parsed(fileOf([{
            source: 'online',
            key: 'online:qq:spoofed',
            addedAt: 'soon',
            originalKey: 'javascript:alert(1)',
            fromOrigin: 'yes',
            onClick: 'x',
            song: {
                id: { toString: 'x' },
                name: 'n'.repeat(900),
                url: 'https://evil.example/',
                pageUrl: 'https://evil.example/',
                cookie: SECRET,
                navidromeData: { streamUrl: 'https://evil.example/s' },
                localRef: { songId: 'l1' },
                isLocal: true,
                privilege: { fee: 1 },
                foliaOriginalKey: 'online:x:y',
                artists: [
                    { id: 1, name: 'A', catalogRef: { providerId: 'qq', kind: 'artist', id: '9' }, link: 'https://evil.example/' },
                    { name: '' },
                    'x',
                    { id: 2, name: 'B', catalogRef: { providerId: 'netease', kind: 'artist', id: '7' } },
                    { id: 3, name: 'C', catalogRef: { providerId: 'netease', kind: 'page', id: '7' } },
                ],
                album: { id: 4, name: 'Al', coverUrl: 'javascript:alert(1)', catalogRef: { providerId: 'netease', kind: 'album', id: 4 }, href: 'x' },
                durationMs: -5,
                itemKind: 'video<script>',
                sourceRef: {
                    kind: 'online', providerId: 'netease', mediaId: '1', variant: 'cloud', token: SECRET,
                    providerData: { a: 1, __proto__: { polluted: true }, constructor: 'x', deep: { url: 'data:text/html,x' } },
                },
            },
        }]));
        const [entry] = file.entries;
        expect(entry).toEqual({
            source: 'online',
            addedAt: 0,
            song: {
                id: '1',
                name: 'n'.repeat(500),
                artists: [{ id: 1, name: 'A' }, { id: 2, name: 'B', catalogRef: { providerId: 'netease', kind: 'artist', id: '7' } }, { id: 3, name: 'C' }],
                album: { id: 4, name: 'Al', catalogRef: { providerId: 'netease', kind: 'album', id: 4 } },
                durationMs: 0,
                sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1', variant: 'cloud', providerData: { a: 1, deep: {} } },
            },
        });
        expect(JSON.stringify(file)).not.toContain('evil.example');
        expect(JSON.stringify(file)).not.toContain(SECRET);
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
        // 条目的 key 从歌重新算，不信文件写的。
        const preview = previewFoliaPlaylistFile(file, [], allOn, null, 7);
        expect(preview.entries[0]).toEqual({ key: 'online:netease:1', song: entry.source === 'online' ? entry.song : null, addedAt: 7 });
    });

    it('drops a source data that is too large, and a cover that is not http(s)', () => {
        const song = (providerData: unknown, coverUrl: string) => ({
            source: 'online',
            song: { name: 'n', album: { name: 'a', coverUrl }, sourceRef: { kind: 'online', providerId: 'x', mediaId: '1', providerData } },
        });
        const file = parsed(fileOf([song({ big: 'x'.repeat(20_000) }, 'http://ok.example/a.png'), song({ small: 'x' }, 'file:///etc/passwd')]));
        const [first, second] = file.entries.map(entry => (entry.source === 'online' ? entry.song : null));
        expect(first?.sourceRef).toEqual({ kind: 'online', providerId: 'x', mediaId: '1' });
        expect(first?.album.coverUrl).toBe('http://ok.example/a.png');
        expect(second?.sourceRef).toMatchObject({ providerData: { small: 'x' } });
        expect(second?.album).not.toHaveProperty('coverUrl');
    });

    it('reads the origin strictly', () => {
        expect(parsed(fileOf([], { origin: { sourceId: 'netease', collectionId: 'c', name: 5, savedAt: 'x', playVia: 'bad id', extra: 1 } })).origin)
            .toEqual({ sourceId: 'netease', collectionId: 'c', name: '', savedAt: 0, fromFile: true });
        expect(parsed(fileOf([], { origin: { sourceId: 'netease' } })).origin).toBeUndefined();
        expect(parsed(fileOf([], { origin: { sourceId: 'a b', collectionId: 'c' } })).origin).toBeUndefined();
        expect(parsed(fileOf([], { name: `  ${'长'.repeat(300)}  ` })).name).toHaveLength(200);
    });
});

describe('what the review of untrusted files asked for', () => {
    const songOf = (patch: Record<string, unknown> = {}, ref: Record<string, unknown> = {}) => ({
        source: 'online',
        song: { name: 'n', album: { name: 'a' }, sourceRef: { kind: 'online', providerId: 'x', mediaId: '1', ...ref }, ...patch },
    });
    const onlineSongs = (text: string) => parsed(text).entries.map(entry => (entry.source === 'online' ? entry.song : null));

    it('keeps credentials that are not shaped like an address out, both ways', () => {
        const providerData = { token: SECRET, sessionCookie: SECRET, apiKey: SECRET, Authorization: SECRET, streamPath: `/audio/1?api_key=${SECRET}`, author: 'kept', hash: 'abc' };
        const exported = serializeFoliaPlaylistFile(playlistOf([entryOf(online('x', '1', {
            sourceRef: { kind: 'online', providerId: 'x', mediaId: '1', providerData },
        }), 'online:x:1')]), []);
        expect(exported.content).not.toContain(SECRET);
        expect(onlineSongs(exported.content)[0]?.sourceRef).toMatchObject({ providerData: { author: 'kept', hash: 'abc' } });
        expect(onlineSongs(fileOf([songOf({}, { providerData })]))[0]?.sourceRef).toEqual({ kind: 'online', providerId: 'x', mediaId: '1', providerData: { author: 'kept', hash: 'abc' } });
    });

    it('drops a cover whose address carries a credential or points at this machine or a private network', () => {
        const coverOf = (coverUrl: string) => onlineSongs(fileOf([songOf({ album: { name: 'a', coverUrl } })]))[0]?.album.coverUrl;
        expect(coverOf('https://img.example/a.jpg?param=300y300')).toBe('https://img.example/a.jpg?param=300y300');
        for (const url of [
            `https://srv.example/Items/1/Images/Primary?api_key=${SECRET}`,
            `https://srv.example/rest/getCoverArt?id=1&u=me&t=${SECRET}&s=salt`,
            `https://user:${SECRET}@srv.example/a.jpg`,
            'http://127.0.0.1:8080/admin?do=reboot',
            'http://localhost/a.jpg',
            'http://192.168.1.2/a.jpg',
            'http://10.0.0.2/a.jpg',
            'http://172.20.0.2/a.jpg',
            'http://nas.local/a.jpg',
            'http://[::1]/a.jpg',
        ]) expect(coverOf(url), url).toBeUndefined();
        const exported = serializeFoliaPlaylistFile(playlistOf([entryOf(online('x', '1', {
            album: { id: 1, name: 'a', coverUrl: `http://192.168.1.2:8096/Items/1/Images/Primary?api_key=${SECRET}` },
        }), 'online:x:1')]), []);
        expect(exported.content).not.toContain(SECRET);
        expect(exported.content).not.toContain('192.168');
    });

    it('bounds times, durations and ids, and strips characters that are not printed', () => {
        const [song] = onlineSongs(fileOf([songOf({
            id: -5.5,
            name: 'a\u202Eb\n\u0000c',
            durationMs: 1e300,
            artists: [{ id: 1.5, name: 'x\ty' }],
            album: { id: -1, name: 'al' },
        })]));
        expect(song).toMatchObject({ id: '1', name: 'abc', durationMs: 0, artists: [{ id: 0, name: 'xy' }], album: { id: 0 } });
        const file = parsed(fileOf([{ ...songOf(), addedAt: 1e300 }], { name: 'li\u2066st\r\n', origin: { sourceId: 'x', collectionId: 'c', savedAt: 1e300 } }));
        expect(file.entries[0].addedAt).toBe(0);
        expect(file.name).toBe('list');
        expect(file.origin?.savedAt).toBe(0);
        expect(parsed(fileOf([songOf({}, { mediaId: 'a\u0000b' })])).invalidCount).toBe(1);
        expect(parsed(fileOf([], { origin: { sourceId: 'local', collectionId: 'c' } })).origin).toBeUndefined();
    });

    it('carries whether the origin is an album through the file, and never the data the source kept with it', () => {
        const origin = { sourceId: 'netease', collectionId: 'al9', name: 'Album', savedAt: 3, collectionType: 'album' as const, collectionData: { mid: 'x9', dirId: 201, owned: true } };
        const exported = serializeFoliaPlaylistFile(playlistOf([], { origin }), []);
        expect(exported.content).not.toContain('collectionData');
        expect(exported.content).not.toContain('dirId');
        const { collectionData: _collectionData, ...written } = origin;
        expect(parsed(exported.content).origin).toEqual({ ...written, fromFile: true });
        // 文件里写了也不读：音源读歌单时会按它选路，读的人确认的只是音源和歌单 id。
        expect(parsed(fileOf([], { origin: { sourceId: 'x', collectionId: 'c', collectionType: 'radio', collectionData: { dirId: 201 } } })).origin)
            .toEqual({ sourceId: 'x', collectionId: 'c', name: '', savedAt: 0, fromFile: true });
    });

    it('leaves the marks of a transfer out when the file names no origin', () => {
        const withMarks = [{ ...songOf(), originalKey: 'online:y:2', fromOrigin: true }];
        expect(previewFoliaPlaylistFile(parsed(fileOf(withMarks)), [], allOn, null, 7).entries[0])
            .toEqual({ key: 'online:x:1', song: expect.anything(), addedAt: 7 });
        expect(previewFoliaPlaylistFile(parsed(fileOf(withMarks, { origin: { sourceId: 'y', collectionId: 'c' } })), [], allOn, null, 7).entries[0])
            .toMatchObject({ originalKey: 'online:y:2', fromOrigin: true });
    });

    it('does not take a file for another one because it sits at the same place', () => {
        const index = buildFoliaLocalMatchIndex([localSong('r', 'Music/01.mp3', { fileSize: 111, duration: 200_000 }), localSong('d', 'Lib/Album/01.mp3', { fileSize: 222, duration: 100_000 })]);
        // 文件就在导入的文件夹底下：去掉文件夹名只剩文件名，要证据。
        expect(matchFoliaLocalSong({ path: 'Other/01.mp3' }, index)).toBeNull();
        expect(matchFoliaLocalSong({ path: '01.mp3' }, index)).toBeNull();
        expect(matchFoliaLocalSong({ path: 'Other/01.mp3', fileSize: 999, durationMs: 5000 }, index)).toBeNull();
        expect(matchFoliaLocalSong({ path: 'Other/01.mp3', fileSize: 111 }, index)?.id).toBe('r');
        expect(matchFoliaLocalSong({ path: 'Music/01.mp3' }, index)?.id).toBe('r');
        // 路径对上了，可大小和时长都说不是它。
        expect(matchFoliaLocalSong({ path: 'X/Album/01.mp3', fileSize: 999, durationMs: 5000 }, index)).toBeNull();
        expect(matchFoliaLocalSong({ path: 'Music/01.mp3', fileSize: 999, durationMs: 5000 }, index)).toBeNull();
        expect(matchFoliaLocalSong({ path: 'X/Album/01.mp3', fileSize: 999, durationMs: 100_500 }, index)?.id).toBe('d');
    });

    it('takes paths that start with a bracket or a brace for an M3U, and bounds its lines', () => {
        expect(detectPlaylistFileFormat('[2020] Album/01.flac\n[2020] Album/02.flac')).toBe('m3u');
        expect(detectPlaylistFileFormat('{Best} of/01.mp3\n{Best} of/02.mp3')).toBe('m3u');
        expect(detectPlaylistFileFormat(serializeFoliaPlaylistFile(MIXED, LIBRARY).content)).toBe('json');
        expect(detectPlaylistFileFormat(JSON.stringify({ a: 'x.mp3' }))).toBe('json');
        const lines = Array.from({ length: FOLIA_PLAYLIST_FILE_MAX_ENTRIES + 1 }, (_, at) => `a/${at}.mp3`).join('\n');
        expect(readPlaylistFileText(lines, [])).toEqual({ format: 'error', error: 'too-large' });
    });
});

describe('finding a local song again', () => {
    const library = [
        localSong('a', 'Music/Rock/track.mp3', { fileSize: 100, duration: 60_000 }),
        localSong('b', 'Music/Pop/track.mp3', { fileSize: 200, duration: 90_000 }),
        localSong('c', 'Other/Jazz/solo.flac', { fileSize: 300, duration: 120_000 }),
    ];
    const index = buildFoliaLocalMatchIndex(library);

    it('matches the whole path, whatever its case and slashes', () => {
        expect(matchFoliaLocalSong({ path: 'music/rock/TRACK.mp3' }, index)?.id).toBe('a');
        expect(parsed(fileOf([{ source: 'local', song: { name: 't' }, local: { path: 'Music\\Pop\\track.mp3' } }])).entries[0])
            .toMatchObject({ local: { path: 'Music/Pop/track.mp3' } });
    });

    it('matches when the imported folder has another name', () => {
        expect(matchFoliaLocalSong({ path: 'MyMusic/Rock/track.mp3' }, index)?.id).toBe('a');
        expect(matchFoliaLocalSong({ path: 'Renamed/Jazz/solo.flac' }, index)?.id).toBe('c');
    });

    it('falls back to the file name only with the size or the duration to back it', () => {
        expect(matchFoliaLocalSong({ path: 'Elsewhere/solo.flac' }, index)).toBeNull();
        expect(matchFoliaLocalSong({ path: 'Elsewhere/solo.flac', fileSize: 300 }, index)?.id).toBe('c');
        expect(matchFoliaLocalSong({ fileName: 'solo.flac', durationMs: 120_900 }, index)?.id).toBe('c');
        expect(matchFoliaLocalSong({ fileName: 'solo.flac', durationMs: 150_000 }, index)).toBeNull();
        // 同名的两个文件靠大小或时长分开；分不开就不认。
        expect(matchFoliaLocalSong({ fileName: 'track.mp3', fileSize: 200 }, index)?.id).toBe('b');
        expect(matchFoliaLocalSong({ fileName: 'track.mp3', durationMs: 60_100 }, index)?.id).toBe('a');
        expect(matchFoliaLocalSong({ fileName: 'track.mp3' }, index)).toBeNull();
        expect(matchFoliaLocalSong({ fileName: 'missing.mp3', fileSize: 100 }, index)).toBeNull();
    });

    it('never matches by title and artist', () => {
        const file = parsed(fileOf([{ source: 'local', song: { name: 'track', artists: [{ name: 'Artist' }] }, local: { fileName: 'other-name.mp3' } }]));
        const preview = previewFoliaPlaylistFile(file, library, allOn, null);
        expect(preview.entries).toEqual([]);
        expect(preview.local).toEqual({ matched: 0, unmatched: 1, unmatchedTitles: ['track'] });
    });
});

describe('previewFoliaPlaylistFile', () => {
    const exported = serializeFoliaPlaylistFile(MIXED, LIBRARY).content;

    it('says which sources are not available here, and still takes their songs', () => {
        const deps: FoliaEntryAvailabilityDeps = {
            hasLocalSong: () => true,
            isSourceRegistered: sourceId => sourceId !== 'lxmusic',
            isSourceSwitchedOn: sourceId => sourceId !== 'netease',
            isNavidromeConfigured: () => false,
        };
        const preview = previewFoliaPlaylistFile(parsed(exported), LIBRARY, deps, null);
        expect(preview.sources).toEqual([
            { key: 'online:netease', sourceId: 'netease', count: 1, unavailable: 'source-off' },
            { key: 'online:lxmusic', sourceId: 'lxmusic', count: 1, unavailable: 'source-missing' },
            { key: 'navidrome', count: 1, unavailable: 'navidrome-unconfigured' },
            { key: 'local', count: 1 },
        ]);
        expect(preview.unavailableCount).toBe(3);
        expect(preview.entries).toHaveLength(4);
        // 没配 Navidrome：没有地址，等配好了再说。
        expect((preview.entries[2].song as unknown as { navidromeData: { streamUrl: string } }).navidromeData.streamUrl).toBe('');
    });

    it('leaves out local songs it cannot find and keeps one of each duplicate', () => {
        const file = parsed(exported);
        const twice = { ...file, entries: [...file.entries, ...file.entries] };
        const preview = previewFoliaPlaylistFile(twice, [], allOn, urls);
        expect(preview.total).toBe(8);
        expect(preview.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'navidrome:n1']);
        expect(preview.duplicateCount).toBe(3);
        expect(preview.local).toMatchObject({ matched: 0, unmatched: 2, unmatchedTitles: ['one', 'one'] });
    });
});

describe('detectPlaylistFileFormat', () => {
    it('tells the two formats by what the file holds', () => {
        expect(detectPlaylistFileFormat('\uFEFF  {"format":"folia-playlist"}')).toBe('json');
        expect(detectPlaylistFileFormat('{ broken')).toBe('json');
        expect(detectPlaylistFileFormat('#EXTM3U\n#EXTINF:1,a\nMusic/a.mp3')).toBe('m3u');
        expect(detectPlaylistFileFormat('C:\\Music\\a.mp3\r\n..\\b.flac\r\n')).toBe('m3u');
        expect(detectPlaylistFileFormat(serializeFoliaPlaylistToM3u8(MIXED, LIBRARY).content)).toBe('m3u');
        expect(detectPlaylistFileFormat('')).toBe('unknown');
        expect(detectPlaylistFileFormat('[1,2]')).toBe('unknown');
        expect(detectPlaylistFileFormat('<html></html>')).toBe('unknown');
        expect(detectPlaylistFileFormat('just some notes\nand more')).toBe('unknown');
        expect(detectPlaylistFileFormat('ID3\u0000\u0000binary.mp3')).toBe('unknown');
    });
});

describe('reading and importing a file', () => {
    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await resetFoliaPlaylistStorage();
        await appDatabase.local_music.bulkPut(LIBRARY);
    });

    it('reads either format, and says so when it is neither', () => {
        expect(readPlaylistFileText(serializeFoliaPlaylistFile(MIXED, LIBRARY).content, LIBRARY).format).toBe('json');
        const m3u = readPlaylistFileText('#EXTM3U\n#PLAYLIST:From M3U\nMusic/A/one.mp3\nnowhere/zzz.mp3\n', LIBRARY);
        expect(m3u).toMatchObject({ format: 'm3u', name: 'From M3U', total: 2, skippedCount: 1 });
        expect(m3u.format === 'm3u' && m3u.matchedSongs.map(song => song.id)).toEqual(['l1']);
        expect(readPlaylistFileText('hello', LIBRARY)).toEqual({ format: 'error', error: 'unknown-format' });
        expect(readPlaylistFileText('{"x":1}', LIBRARY)).toEqual({ format: 'error', error: 'not-folia-playlist' });
        expect(readPlaylistFileText(fileOf([], {}, { version: 9 }), LIBRARY)).toEqual({ format: 'error', error: 'newer-version' });
    });

    it('writes nothing until it is told to, then a new playlist with the marks of the file', async () => {
        const reading = readPlaylistFileText(serializeFoliaPlaylistFile(MIXED, LIBRARY).content, LIBRARY);
        if (reading.format !== 'json') throw new Error('expected json');
        expect((await getFoliaPlaylists()).filter(playlist => !playlist.isFavorite)).toEqual([]);
        const { playlist, result } = await importPlaylistFileReading(reading, { name: ' Back ' });
        expect(result).toEqual({ added: 4, duplicates: 0, rejected: 0 });
        expect(playlist).toMatchObject({ name: 'Back', origin: { ...MIXED.origin, fromFile: true } });
        const stored = await getFoliaPlaylist(playlist!.id);
        expect(stored?.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'navidrome:n1', 'local:l1']);
        expect(stored?.entries[1]).toMatchObject({ originalKey: 'online:netease:2', fromOrigin: true, addedAt: 10 });
    });

    it('merges into a playlist that is there, without the marks and without doubles', async () => {
        const target = await createFoliaPlaylist('Mixed', [online('netease', '1')]);
        const reading = readPlaylistFileText(serializeFoliaPlaylistFile(MIXED, LIBRARY).content, LIBRARY);
        if (reading.format === 'error') throw new Error('expected a playlist');
        const { playlist, result } = await importPlaylistFileReading(reading, { name: 'ignored', mergeInto: target.id });
        expect(result).toEqual({ added: 3, duplicates: 1, rejected: 0 });
        expect(playlist?.id).toBe(target.id);
        expect(playlist?.origin).toBeUndefined();
        expect(playlist?.entryCount).toBe(4);
        const stored = await getFoliaPlaylist(target.id);
        expect(stored?.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'navidrome:n1', 'local:l1']);
        expect(stored?.entries.some(entry => entry.fromOrigin)).toBe(false);
        expect((await getFoliaPlaylists()).filter(item => !item.isFavorite)).toHaveLength(1);
    });

    it('imports an M3U file as before', async () => {
        const reading = readPlaylistFileText('Music/A/one.mp3\nMusic/B/two.flac\n', LIBRARY);
        if (reading.format !== 'm3u') throw new Error('expected m3u');
        const { playlist } = await importPlaylistFileReading(reading, { name: 'Local' });
        expect((await getFoliaPlaylist(playlist!.id))?.entries.map(entry => entry.key)).toEqual(['local:l1', 'local:l2']);
        const merged = await importPlaylistFileReading(reading, { name: 'x', mergeInto: playlist!.id });
        expect(merged.result).toMatchObject({ added: 0, duplicates: 2 });
        await addSongsToFoliaPlaylist(playlist!.id, []);
    });
});

describe('an online song whose id and source disagree', () => {
    const entry = (id: unknown, mediaId: string, providerData?: Record<string, unknown>) => ({
        source: 'online',
        song: { ...(id === undefined ? {} : { id }), name: `n ${mediaId}`, album: { name: 'a' }, sourceRef: { kind: 'online', providerId: 'x', mediaId, ...(providerData ? { providerData } : {}) } },
    });

    it('is not taken, and is counted apart from entries that cannot be read', () => {
        const file = parsed(fileOf([
            entry('1', '1'),
            entry(2, '2'),
            // 显示的是 3，实际按 mediaId 9 去播。
            entry('3', '9'),
            entry(4, '004abc', { songId: 5 }),
            { source: 'online', song: { name: 'no ref' } },
            entry('6', '6'),
        ]));
        expect(file.entries.map(item => (item.source === 'online' ? item.song.sourceRef?.mediaId : null))).toEqual(['1', '2', '6']);
        expect(file).toMatchObject({ mismatchedIdCount: 2, invalidCount: 1 });
        const preview = previewFoliaPlaylistFile(file, [], allOn, null, 1);
        expect(preview).toMatchObject({ mismatchedIdCount: 2, invalidCount: 1, total: 3 });
        expect(preview.entries.map(item => item.key)).toEqual(['online:x:1', 'online:x:2', 'online:x:6']);
    });

    it('takes the second id a source keeps in its own data, and an id the file left out or mangled', () => {
        const file = parsed(fileOf([
            // 两个 id 的音源：播放用的作 mediaId，另一个是歌的 id，并且也在它自己的数据里。
            entry(1234, '004abc', { songId: 1234, songMid: '004abc' }),
            entry('1234', '004abd', { songId: 1234 }),
            entry(undefined, 'm1'),
            entry({ nested: true }, 'm2'),
            entry(-5, 'm3'),
            // 数据里的别的东西（嵌在里面的、不是 id 的）不算。
            entry(77, 'm4', { nested: { songId: 77 }, flag: true }),
        ]));
        expect(file.entries.map(item => (item.source === 'online' ? [item.song.id, item.song.sourceRef?.mediaId] : null))).toEqual([
            [1234, '004abc'], ['1234', '004abd'], ['m1', 'm1'], ['m2', 'm2'], ['m3', 'm3'],
        ]);
        expect(file.mismatchedIdCount).toBe(1);
    });

    it('reads back what it wrote for a source with two ids', () => {
        const song = online('x', '004abc', { id: 1234, sourceRef: { kind: 'online', providerId: 'x', mediaId: '004abc', providerData: { songId: 1234, songMid: '004abc' } } });
        const file = parsed(serializeFoliaPlaylistFile(playlistOf([entryOf(song, 'online:x:004abc')]), []).content);
        expect(file).toMatchObject({ mismatchedIdCount: 0, invalidCount: 0 });
        expect(file.entries).toHaveLength(1);
    });
});

describe('which key names count as credentials', () => {
    it('drops the names that are credentials, however they are written', () => {
        for (const name of [
            'token', 'accessToken', 'access_token', 'refresh-token', 'musicUserToken', 'X-Auth-Token', 'accesstoken', 'ACCESS_TOKEN',
            'accessTOKEN', 'access.token', 'access token', 'accessToken2', 'token2', 'tokenA1', 'XMLHttpToken', 'IDToken', 'oauth2token',
            'musictokenv2', 'USERTOKENV2', 'accesstokens', 'refreshtokenexpire',
            'cookie', 'sessionCookies', 'usercookies', 'mycookiejar', 'secret', 'clientSecret', 'clientsecrets', 'appsecretkey', 'secretKey',
            'password', 'passwd', 'pwd', 'passWord', 'PassWord', 'passPhrase', 'passcode', 'passwordHash',
            'credential', 'credentials', 'mycredentials',
            'session', 'sessionId', 'sessionid', 'SESSION_KEY', 'JSESSIONID', 'jsessionid', 'usersession', 'PHPSESSID', 'sessions',
            'auth', 'authToken', 'authkey', 'auth_key', 'Authorization', 'authorisation', 'xauthorizationx', 'OAuthToken',
            'apiKey', 'api_key', 'api-key', 'apikey', 'X-Api-Key', 'apiKeys', 'api_keys', 'privateKey', 'accessKey',
            'sign', 'sig', 'fsig', 'signature', 'X-Amz-Signature', 'freeSign', 'md5Sign', 'jwt', 'bearer', 'csrf', '__csrf', 'xsrf',
        ]) {
            expect(isCredentialKeyName(name), name).toBe(true);
        }
    });

    it('keeps names that only look like one', () => {
        for (const name of [
            'author', 'authorName', 'authority', 'designId', 'assignee', 'signal', 'obsession', 'possession', 'bypassWindow', 'passage',
            'key', 'apiVersion', 'keyword', 'hash', 'id', 'mid', 'kind', 'platform',
            'isOAuth', 'OAuthProvider', 'signIn', 'signUpDate', 'signType', 'seasonPass', 'accessLevel', 'privateList',
        ]) {
            expect(isCredentialKeyName(name), name).toBe(false);
        }
    });

    // 十家内置音源的歌 / 歌单附带数据里实际写的键（2026-11-22 对着各家的代码逐个核对），加上宿主自己放的那一个。
    // 歌的那份会进文件：有一个键被删就说明筛的规则动到了播放要用的数据。歌单的那份现在不进文件，
    // 键名留在这里是为了以后要带它的时候，规则已经对过。
    const SONG_DATA_KEYS = [
        '@lyricIds', 'qq', 'kugou',
        'resourceType', 'catalogArtistIds', 'playbackAvailable', 'playbackId', 'playbackKind', 'catalogId', 'isLibrary', 'isrc', 'isLive',
        'availability', 'chorusStartMs', 'chorusEndMs', 'originalName',
        'coverId', 'createdAt', 'updatedAt', 'isFavorite', 'isCue', 'trackNo', 'discNo',
        'hash', 'mixSongId', 'albumAudioId', 'catalogLookupId', 'albumId', 'fileId',
        'platform', 'audioId', 'albumMid', 'mediaMid', 'songId',
        'fee', 'privilege', 'payed', 'st', 'pl', 'dl', 'flag', 'cs', 'noCopyrightRcmd', 'type', 'typeDesc', 'thirdPartySong', 'expInfo',
        'resourceState', 't', 'otherArtistNames',
        'songMid',
    ];
    const COLLECTION_DATA_KEYS = [
        'resourceType', 'canEdit', 'catalogArtistIds', 'isLive',
        'source', 'isPrivate', 'discoverIndex',
        'listId', 'globalCollectionId', 'specialId', 'owned', 'creatorUserId', 'creatorListId', 'creatorGid', 'musicSize', 'albumSize',
        'virtualRecommendation', 'cardId',
        'platform', 'kind',
        'transNames',
        'ownerId',
        'tid', 'dirId', 'dirType', 'dissid', 'dirShow', 'list', 'period', 'albumMid', 'singerMid',
        'playlistId', 'mix', 'videoId',
    ];

    it('keeps every key the built-in sources put in a song (and would in a collection)', () => {
        for (const name of [...SONG_DATA_KEYS, ...COLLECTION_DATA_KEYS]) expect(isCredentialKeyName(name), name).toBe(false);
        const data = Object.fromEntries(SONG_DATA_KEYS.map((name, index) => [name, index]));
        const exported = serializeFoliaPlaylistFile(playlistOf([entryOf(online('x', '1', {
            sourceRef: { kind: 'online', providerId: 'x', mediaId: '1', providerData: data },
        }), 'online:x:1')]), []);
        const file = parsed(exported.content);
        const ref = file.entries[0].source === 'online' ? file.entries[0].song.sourceRef : undefined;
        expect(ref?.kind === 'online' && ref.providerData).toEqual(data);
    });

    it('leaves the one signature a source keeps with its songs out of the file', () => {
        const exported = serializeFoliaPlaylistFile(playlistOf([entryOf(online('x', '1', {
            sourceRef: { kind: 'online', providerId: 'x', mediaId: '1', providerData: { freeSign: SECRET, availability: 1 } },
        }), 'online:x:1')]), []);
        expect(exported.content).not.toContain(SECRET);
        expect(exported.content).toContain('availability');
    });
});

describe('an origin that came from a file', () => {
    const noTarget = { resolveCounterparts: async () => ({ songs: [] }) };
    const fileWithOrigin = (origin: Record<string, unknown>) => fileOf([{
        source: 'online', fromOrigin: true,
        song: { id: '1', name: 'one', album: { name: 'a' }, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' } },
    }], { origin });

    beforeEach(async () => {
        await appDatabase.delete();
        await appDatabase.open();
        await resetFoliaPlaylistStorage();
    });

    it('cannot be written as already confirmed by the file', () => {
        const origin = parsed(fileWithOrigin({ sourceId: 'netease', collectionId: 'c1', name: 'O', fromFile: false, confirmedAt: 123 })).origin;
        expect(origin).toEqual({ sourceId: 'netease', collectionId: 'c1', name: 'O', savedAt: 0, fromFile: true });
        expect(foliaOriginNeedsConfirmation(origin)).toBe(true);
    });

    it('is not read from until the user confirms it, once', async () => {
        const text = fileWithOrigin({ sourceId: 'netease', collectionId: 'c1', name: 'O', confirmedAt: 123 });
        const reading = readPlaylistFileText(text, []);
        if (reading.format !== 'json') throw new Error('expected json');
        // 就算预览里的出处被塞了「确认过」、去掉了「文件说的」，服务层写进歌单的也是文件说的、没确认的。
        if (reading.preview.origin) {
            const { fromFile: _fromFile, ...rest } = reading.preview.origin;
            reading.preview.origin = { ...rest, confirmedAt: 5 };
        }
        const { playlist } = await importPlaylistFileReading(reading, { name: 'From a file' });
        if (!playlist) throw new Error('no playlist');
        expect(playlist.origin).toMatchObject({ fromFile: true });
        expect(playlist.origin?.confirmedAt).toBeUndefined();
        expect(foliaOriginNeedsConfirmation(playlist.origin)).toBe(true);

        let asked = 0;
        const fetch = async () => {
            asked += 1;
            return [online('netease', '1'), online('netease', '2')];
        };
        await expect(refreshFoliaPlaylistFromOrigin(playlist.id, fetch, noTarget)).rejects.toBeInstanceOf(FoliaOriginUnconfirmedError);
        expect(asked).toBe(0);
        expect((await getFoliaPlaylist(playlist.id))?.entries.map(item => item.key)).toEqual(['online:netease:1']);

        // 给用户看的不是歌单上的那个出处：不记。
        expect(await confirmFoliaPlaylistOrigin(playlist.id, { sourceId: 'netease', collectionId: 'other' })).toBe(false);
        expect(await confirmFoliaPlaylistOrigin('missing', { sourceId: 'netease', collectionId: 'c1' })).toBe(false);
        await expect(refreshFoliaPlaylistFromOrigin(playlist.id, fetch, noTarget)).rejects.toBeInstanceOf(FoliaOriginUnconfirmedError);

        expect(await confirmFoliaPlaylistOrigin(playlist.id, { sourceId: 'netease', collectionId: 'c1' })).toBe(true);
        const confirmed = await getFoliaPlaylistSummary(playlist.id);
        expect(confirmed?.origin?.confirmedAt).toBeGreaterThan(0);
        expect(foliaOriginNeedsConfirmation(confirmed?.origin)).toBe(false);
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, fetch, noTarget);
        expect(refreshed?.result).toMatchObject({ added: 1 });
        expect(asked).toBe(1);
        // 更新之后确认还记着，不再问。
        expect(foliaOriginNeedsConfirmation(refreshed?.playlist.origin)).toBe(false);
        expect(refreshed?.playlist.origin).toMatchObject({ fromFile: true, sourceId: 'netease', collectionId: 'c1' });
        await refreshFoliaPlaylistFromOrigin(playlist.id, fetch, noTarget);
        expect(asked).toBe(2);
    });

    it('never starts out confirmed, whoever creates the playlist', async () => {
        const created = await createFoliaPlaylist('Made', [], { origin: { sourceId: 'netease', collectionId: 'c1', name: 'O', savedAt: 1, fromFile: true, confirmedAt: 9 } });
        expect(created.origin?.confirmedAt).toBeUndefined();
        expect(foliaOriginNeedsConfirmation(created.origin)).toBe(true);
    });

    it('is not asked about for a playlist saved here', async () => {
        const { playlist } = await saveCollectionAsFoliaPlaylist({
            name: 'Saved',
            songs: [online('netease', '1')],
            // 调用方多塞的记号不进歌单。
            origin: { sourceId: 'netease', collectionId: 'c1', name: 'O', fromFile: true, confirmedAt: 1 } as never,
        }, noTarget);
        expect(playlist.origin?.fromFile).toBeUndefined();
        expect(foliaOriginNeedsConfirmation(playlist.origin)).toBe(false);
        expect(await confirmFoliaPlaylistOrigin(playlist.id, { sourceId: 'netease', collectionId: 'c1' })).toBe(true);
        expect((await getFoliaPlaylistSummary(playlist.id))?.origin?.confirmedAt).toBeUndefined();
        const refreshed = await refreshFoliaPlaylistFromOrigin(playlist.id, async () => [online('netease', '1'), online('netease', '3')], noTarget);
        expect(refreshed?.result).toMatchObject({ added: 1 });
    });
});
