import type { LocalLibrarySnapshot, LocalLibrarySnapshotNode, LocalSong } from '../../../src/types';
import type { FoliaPlaylistSummary } from '../../../src/types/foliaPlaylist';
import {
    getLocalSongs,
    saveDirHandles,
    saveLocalLibrarySnapshot,
    saveLocalSongs,
} from '../../../src/services/db';
import { createFoliaPlaylistFromLocalSongs, getFoliaPlaylistSummaries } from '../../../src/services/foliaPlaylist/foliaPlaylistService';
import { makeLocalSong } from '../libraryBehavior/localFixtures';
import {
    HOME_IMPORTED_SONG,
    HOME_LOCAL_IGNORED_FOLDER,
    HOME_LOCAL_PLAYLIST,
    HOME_LOCAL_ROOTS,
    HOME_LOCAL_SONGS,
    homeLocalSongId,
    type HomeLocalSongRule,
} from './homeFixtureRules';

// dev/probes/homeBehavior/homeLocalFixtures.ts
// 首页探针的本地曲库种子（只在沙盒模式写 IndexedDB）：歌曲、自建歌单，以及目录树需要的导入根句柄与扫描快照。
// 句柄只是 `{ name, kind }` 的普通对象：目录树只读句柄表的键；需要真句柄的重扫 / 导入在探针里由替身接管
// （见 serviceStubs.ts），所以这里不必伪造 File System Access API。

/** 一首首页本地歌：在集合详情探针的歌上改文件夹、专辑与歌手。 */
export const makeHomeLocalSong = (rule: HomeLocalSongRule): LocalSong => {
    const base = makeLocalSong(rule.index);
    return {
        ...base,
        id: homeLocalSongId(rule.index),
        filePath: `${rule.folder}/${base.fileName}`,
        folderName: rule.folder,
        importedMetadata: {
            ...base.importedMetadata,
            artistNames: [rule.artist],
            albumName: rule.album,
        },
    };
};

export const HOME_LOCAL_FIXTURE_SONGS: LocalSong[] = HOME_LOCAL_SONGS.map(makeHomeLocalSong);

const node = (relativePath: string, children: LocalLibrarySnapshotNode[] = [], ignored = false): LocalLibrarySnapshotNode => ({
    name: relativePath.split('/').pop() || relativePath,
    relativePath,
    hash: `probe:${relativePath}`,
    files: [],
    children,
    ...(ignored ? { ignored: true } : {}),
});

/** 两个导入根的扫描快照：Music（Alpha/Live、Beta、被忽略的 Hidden）与 Extra。 */
const HOME_SNAPSHOTS: LocalLibrarySnapshot[] = [
    {
        rootFolderName: 'Music',
        ignoredFolderPaths: [HOME_LOCAL_IGNORED_FOLDER],
        scannedAt: 1700000000000,
        tree: {
            ...node('Music', [
                node('Music/Alpha', [node('Music/Alpha/Live')]),
                node('Music/Beta'),
                node(HOME_LOCAL_IGNORED_FOLDER, [], true),
            ]),
            relativePath: '',
        },
    },
    {
        rootFolderName: 'Extra',
        scannedAt: 1700000000000,
        tree: { ...node('Extra'), relativePath: '' },
    },
];

let seeding: Promise<void> | null = null;

// StrictMode 下挂载 effect 会跑两遍：种子写入只做一次（同一页面内共享这个 promise），否则会建出两张同名歌单。
const seedOnce = (): Promise<void> => {
    seeding ??= (async () => {
        const stored = await getLocalSongs();
        const storedIds = new Set(stored.map(song => song.id));
        const missing = HOME_LOCAL_FIXTURE_SONGS.filter(song => !storedIds.has(song.id));
        if (missing.length > 0) await saveLocalSongs(missing);
        const playlists = await getFoliaPlaylistSummaries();
        if (!playlists.some(playlist => playlist.name === HOME_LOCAL_PLAYLIST.name)) {
            await createFoliaPlaylistFromLocalSongs(
                HOME_LOCAL_PLAYLIST.name,
                HOME_LOCAL_PLAYLIST.songs.map(index => HOME_LOCAL_FIXTURE_SONGS.find(song => song.id === homeLocalSongId(index))!),
            );
        }
        await saveDirHandles(Object.fromEntries(HOME_LOCAL_ROOTS.map(root => [
            root,
            { name: root, kind: 'directory' } as unknown as FileSystemDirectoryHandle,
        ])));
        await Promise.all(HOME_SNAPSHOTS.map(saveLocalLibrarySnapshot));
    })();
    return seeding;
};

/** 写入种子（可重复调用），返回存储里的曲目与歌单。 */
export const seedHomeLibrary = async (): Promise<{ songs: LocalSong[]; playlists: FoliaPlaylistSummary[] }> => {
    await seedOnce();
    return readHomeLibrary();
};

/** 读回沙盒里的全部本地曲目与歌单（沙盒页面里只有探针自己的数据）。 */
export const readHomeLibrary = async (): Promise<{ songs: LocalSong[]; playlists: FoliaPlaylistSummary[] }> => {
    const [songs, playlists] = await Promise.all([getLocalSongs(), getFoliaPlaylistSummaries()]);
    return { songs, playlists };
};

/** 文件夹导入替身写进曲库的那首歌。 */
export const HOME_IMPORTED_LOCAL_SONG = makeHomeLocalSong(HOME_IMPORTED_SONG);
