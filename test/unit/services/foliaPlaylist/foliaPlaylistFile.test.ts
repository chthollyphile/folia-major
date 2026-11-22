import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    FOLIA_PLAYLIST_FILE_FORMAT,
    FOLIA_PLAYLIST_FILE_MAX_BYTES,
    FOLIA_PLAYLIST_FILE_MAX_ENTRIES,
    FOLIA_PLAYLIST_FILE_VERSION,
    buildFoliaLocalMatchIndex,
    detectPlaylistFileFormat,
    matchFoliaLocalSong,
    parseFoliaPlaylistFile,
    previewFoliaPlaylistFile,
    serializeFoliaPlaylistFile,
    type FoliaFileNavidromeUrls,
} from '@/services/foliaPlaylist/foliaPlaylistFile';
import { importPlaylistFileReading, readPlaylistFileText } from '@/services/foliaPlaylist/foliaPlaylistFileIo';
import { addSongsToFoliaPlaylist, createFoliaPlaylist, getFoliaPlaylist, getFoliaPlaylists } from '@/services/foliaPlaylist/foliaPlaylistService';
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
        expect(preview.origin).toEqual(MIXED.origin);
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
            .toEqual({ sourceId: 'netease', collectionId: 'c', name: '', savedAt: 0 });
        expect(parsed(fileOf([], { origin: { sourceId: 'netease' } })).origin).toBeUndefined();
        expect(parsed(fileOf([], { origin: { sourceId: 'a b', collectionId: 'c' } })).origin).toBeUndefined();
        expect(parsed(fileOf([], { name: `  ${'长'.repeat(300)}  ` })).name).toHaveLength(200);
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
        expect(playlist).toMatchObject({ name: 'Back', origin: MIXED.origin });
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
        expect(playlist?.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'navidrome:n1', 'local:l1']);
        expect(playlist?.entries.some(entry => entry.fromOrigin)).toBe(false);
        expect((await getFoliaPlaylists()).filter(item => !item.isFavorite)).toHaveLength(1);
    });

    it('imports an M3U file as before', async () => {
        const reading = readPlaylistFileText('Music/A/one.mp3\nMusic/B/two.flac\n', LIBRARY);
        if (reading.format !== 'm3u') throw new Error('expected m3u');
        const { playlist } = await importPlaylistFileReading(reading, { name: 'Local' });
        expect(playlist?.entries.map(entry => entry.key)).toEqual(['local:l1', 'local:l2']);
        const merged = await importPlaylistFileReading(reading, { name: 'x', mergeInto: playlist!.id });
        expect(merged.result).toMatchObject({ added: 0, duplicates: 2 });
        await addSongsToFoliaPlaylist(playlist!.id, []);
    });
});
