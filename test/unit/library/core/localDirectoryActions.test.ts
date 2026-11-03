import { describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import type { LibraryDirectoryBatchContext, LibraryDirectoryBatchPort, LibraryDirectoryItem } from '@/library/core/directory/directory.contract';
import {
    createLocalDirectoryActions,
    resolveDirectoryBatchSongs,
    resolveFolderRemovalPaths,
} from '@/library/core/directory/localDirectoryActions.service';
import { resolveDirectoryBatchContext } from '@/library/core/directory/directoryBatch';

// test/unit/library/core/localDirectoryActions.test.ts
// 本地目录批量动作（原 LocalGrid3DView 的批量配置）：用假端口记下每次服务调用，锁住文件夹删除的路径规则与
// 调用顺序（与首页探针的四条用例同一套）、播放 / 入队 / 新建歌单的歌曲顺序、根目录动作后刷新曲库、
// 一次只跑一个动作（重复提交返回 busy）、失败返回 failed、收尾在 pending 期间执行。

const song = (id: string, folderName: string): LocalSong => ({ id, folderName, fileName: `${id}.mp3` } as LocalSong);

// 曲库：Music/Alpha（1、2）、Music/Alpha/Live（3）、Music/Beta（4）、Extra（5）。
const SONGS = [
    song('1', 'Music/Alpha'),
    song('2', 'Music/Alpha'),
    song('3', 'Music/Alpha/Live'),
    song('4', 'Music/Beta'),
    song('5', 'Extra'),
];
const folder = (path: string): LibraryDirectoryItem => ({
    id: `folder:${path}`,
    name: path,
    type: 'folder',
    path,
    trackIds: SONGS.filter(item => item.folderName === path).map(item => item.id),
});
const ALL_SONGS: LibraryDirectoryItem = { id: 'all', name: 'All Songs', type: 'folder', isVirtual: true, trackIds: SONGS.map(item => item.id) };
const CARDS = [ALL_SONGS, folder('Extra'), folder('Music/Alpha'), folder('Music/Alpha/Live'), folder('Music/Beta')];
const scopeOf = (...ids: string[]): LibraryDirectoryBatchContext => resolveDirectoryBatchContext(CARDS, new Set(ids));

const createPort = (songs: LocalSong[] = SONGS) => {
    const calls: Array<[string, ...unknown[]]> = [];
    const record = (name: string) => vi.fn(async (...args: unknown[]) => {
        calls.push([name, ...args]);
    });
    const port: LibraryDirectoryBatchPort = {
        getLocalSongs: () => songs,
        playLocalSongs: vi.fn(async (list: LocalSong[]) => { calls.push(['play', list.map(item => item.id)]); }),
        enqueueLocalSongs: vi.fn(async (list: LocalSong[]) => { calls.push(['enqueue', list.map(item => item.id)]); }),
        createLocalPlaylist: vi.fn(async (name: string, list: LocalSong[]) => { calls.push(['createLocalPlaylist', name, list.map(item => item.id)]); }),
        deleteFolderSongs: record('deleteFolderSongs'),
        deleteSongsByIds: record('deleteSongsByIds'),
        clearFolderIgnore: record('clearFolderIgnore'),
        resyncFolder: record('resyncFolder'),
        removeImportedRoot: record('removeImportedRoot'),
        refreshLibrary: record('refreshLibrary'),
    };
    return { port, calls };
};

describe('folder removal path rules', () => {
    it('removes only the songs of a folder whose subfolders are not selected', async () => {
        const { port, calls } = createPort();
        expect(await createLocalDirectoryActions(port).remove(scopeOf('folder:Music/Alpha'))).toEqual({ ok: true });
        expect(calls).toEqual([
            ['deleteSongsByIds', ['1', '2']],
            ['refreshLibrary'],
        ]);
    });

    it('removes the top folder when it is selected together with all its subfolders', async () => {
        const { port, calls } = createPort();
        await createLocalDirectoryActions(port).remove(scopeOf('folder:Music/Alpha/Live', 'folder:Music/Alpha'));
        expect(calls).toEqual([
            ['deleteFolderSongs', 'Music/Alpha'],
            ['deleteSongsByIds', ['1', '2', '3']],
            ['refreshLibrary'],
        ]);
    });

    it('never removes the virtual All Songs as a folder; its songs go by id', async () => {
        const { port, calls } = createPort();
        await createLocalDirectoryActions(port).remove(scopeOf('all'));
        expect(calls).toEqual([
            ['deleteSongsByIds', ['1', '2', '3', '4', '5']],
            ['refreshLibrary'],
        ]);
    });

    it('removes a fully selected top-level folder through its root path', async () => {
        const { port, calls } = createPort();
        await createLocalDirectoryActions(port).remove(scopeOf('folder:Extra'));
        expect(calls).toEqual([
            ['deleteFolderSongs', 'Extra'],
            ['deleteSongsByIds', ['5']],
            ['refreshLibrary'],
        ]);
    });

    it('keeps sibling folders that share a name prefix apart', () => {
        const songs = [song('1', 'Music/Alpha'), song('2', 'Music/AlphaBeta')];
        expect(resolveFolderRemovalPaths(
            { items: [{ id: 'a', name: 'Music/Alpha', path: 'Music/Alpha' }], trackIds: ['1'] },
            songs,
        )).toEqual(['Music/Alpha']);
    });
});

describe('local directory batch actions', () => {
    it('plays, enqueues and creates a playlist with the scope\'s songs in scope order, skipping songs no longer in the library', async () => {
        const { port, calls } = createPort(SONGS.filter(item => item.id !== '4'));
        const actions = createLocalDirectoryActions(port);
        const scope = scopeOf('folder:Music/Beta', 'folder:Extra');
        expect(scope.trackIds).toEqual(['5', '4']);

        await actions.play(scope);
        await actions.enqueue(scope);
        await actions.createPlaylist('Mix', scope);
        expect(calls).toEqual([
            ['play', ['5']],
            ['enqueue', ['5']],
            ['createLocalPlaylist', 'Mix', ['5']],
            ['refreshLibrary'],
        ]);
    });

    it('refuses an empty scope and an empty playlist name without calling anything', async () => {
        const { port, calls } = createPort();
        const actions = createLocalDirectoryActions(port);
        const empty = scopeOf();
        expect(await actions.play(empty)).toEqual({ ok: false, reason: 'unsupported' });
        expect(await actions.remove(empty)).toEqual({ ok: false, reason: 'unsupported' });
        expect(await actions.createPlaylist(' ', scopeOf('folder:Extra'))).toEqual({ ok: false, reason: 'unsupported' });
        expect(calls).toEqual([]);
    });

    it('refreshes the library after rescanning, removing a root and clearing an ignored folder', async () => {
        const { port, calls } = createPort();
        const actions = createLocalDirectoryActions(port);
        await actions.rescanRoot('Music');
        await actions.clearIgnore('Music/Hidden');
        await actions.removeRoot('Music');
        expect(calls).toEqual([
            ['resyncFolder', 'Music'],
            ['refreshLibrary'],
            ['clearFolderIgnore', 'Music/Hidden'],
            ['refreshLibrary'],
            ['removeImportedRoot', 'Music'],
            ['refreshLibrary'],
        ]);
    });

    it('runs one action at a time: a second submit while one is pending is busy and sends nothing', async () => {
        const { port, calls } = createPort();
        let release!: () => void;
        port.resyncFolder = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
        const actions = createLocalDirectoryActions(port);
        const listener = vi.fn();
        actions.subscribe(listener);

        const first = actions.rescanRoot('Music');
        expect(actions.getSnapshot().pending).toEqual({ action: 'rescan-root', rootPath: 'Music' });
        expect(await actions.remove(scopeOf('folder:Extra'))).toEqual({ ok: false, reason: 'busy' });
        expect(await actions.rescanRoot('Music')).toEqual({ ok: false, reason: 'busy' });
        release();
        expect(await first).toEqual({ ok: true });
        expect(actions.getSnapshot().pending).toBeNull();
        expect(port.resyncFolder).toHaveBeenCalledTimes(1);
        expect(calls).toEqual([['refreshLibrary']]);
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('marks clear-ignore busy on the folder\'s import root', async () => {
        const { port } = createPort();
        const actions = createLocalDirectoryActions(port);
        let seen: unknown = null;
        await actions.clearIgnore('Music/Alpha/Live', { after: () => { seen = actions.getSnapshot().pending; } });
        expect(seen).toEqual({ action: 'clear-ignore', rootPath: 'Music' });
    });

    it('runs the view follow-up after the library refresh and inside the pending window', async () => {
        const { port, calls } = createPort();
        const actions = createLocalDirectoryActions(port);
        await actions.remove(scopeOf('folder:Extra'), {
            after: () => {
                calls.push(['after', actions.getSnapshot().pending?.action]);
            },
        });
        expect(calls.map(call => call[0])).toEqual(['deleteFolderSongs', 'deleteSongsByIds', 'refreshLibrary', 'after']);
        expect(calls.at(-1)).toEqual(['after', 'remove']);
    });

    it('reports a failing service as failed and frees the controller', async () => {
        const { port } = createPort();
        port.deleteSongsByIds = vi.fn(async () => { throw new Error('disk'); });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const actions = createLocalDirectoryActions(port);
        expect(await actions.remove(scopeOf('folder:Music/Beta'))).toEqual({ ok: false, reason: 'failed', message: 'disk' });
        expect(actions.getSnapshot().pending).toBeNull();
        expect(port.refreshLibrary).not.toHaveBeenCalled();
        errors.mockRestore();
    });

    it('resolves scope ids against the library in scope order', () => {
        expect(resolveDirectoryBatchSongs(SONGS, ['5', 'x', '1']).map(item => item.id)).toEqual(['5', '1']);
    });
});
