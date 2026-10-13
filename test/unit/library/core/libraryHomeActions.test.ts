import { describe, expect, it, vi } from 'vitest';
import type { LocalLibraryGroup, SongResult } from '@/types';
import type { LibraryHomeNotice, LibraryHomePort, LibraryHomeScanProgress } from '@/library/core/contracts/homeModel';
import type { LibraryCollectionDescriptor } from '@/library/core/contracts/collection';
import { createLibraryHomeActions } from '@/library/core/services/libraryHomeActions';

// test/unit/library/core/libraryHomeActions.test.ts
// 首页动作层（原 Grid3D 的导入、私人 FM、打开卡片）：三个导入共用的「忙」、本地不可用时的提示、有新歌才刷新、
// 失败的提示、歌单文件导入的三种结果、扫描进度的订阅生命周期、私人 FM 直接播放、其余卡片交给宿主打开。

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

const createPort = (patch: Partial<LibraryHomePort> = {}) => {
    const notices: LibraryHomeNotice[] = [];
    let scanListener: ((progress: LibraryHomeScanProgress | null) => void) | null = null;
    const port: LibraryHomePort = {
        localAvailability: () => ({ supported: true, reason: null }),
        importFolder: vi.fn(async () => 2),
        resyncAllFolders: vi.fn(async () => 1),
        importPlaylistFile: vi.fn(async () => ({ playlistName: 'List', matchedCount: 3, skippedCount: 0 })),
        refreshLocalSongs: vi.fn(),
        subscribeScanProgress: vi.fn((listener) => {
            scanListener = listener;
            return vi.fn(() => {
                scanListener = null;
            });
        }),
        getPersonalFm: vi.fn(async () => [{ id: 'fm-1' }, { id: 'fm-2' }] as unknown as SongResult[]),
        playPersonalFm: vi.fn(),
        playSongs: vi.fn(),
        describeOnlineCollection: vi.fn((collection, providerId) => ({ ...collection, source: 'online', providerId }) as unknown as LibraryCollectionDescriptor),
        describeLocalGroup: vi.fn(group => ({ source: 'local', id: group.id }) as unknown as LibraryCollectionDescriptor),
        describeNavidromeCard: vi.fn((card, type) => ({ source: 'navidrome', id: String(card.id), type }) as unknown as LibraryCollectionDescriptor),
        notify: vi.fn(notice => {
            notices.push(notice);
        }),
        ...patch,
    };
    return { port, notices, emitScan: (progress: LibraryHomeScanProgress | null) => scanListener?.(progress), hasScanListener: () => scanListener !== null };
};

const file = new File(['#EXTM3U'], 'list.m3u');

describe('createLibraryHomeActions — local imports', () => {
    it('imports a folder and refreshes the library only when songs came in', async () => {
        const { port } = createPort();
        const actions = createLibraryHomeActions(port);
        expect(await actions.importFolder()).toEqual({ ok: true });
        expect(port.refreshLocalSongs).toHaveBeenCalledTimes(1);

        (port.importFolder as ReturnType<typeof vi.fn>).mockResolvedValueOnce(0);
        expect(await actions.importFolder()).toEqual({ ok: true });
        expect(port.refreshLocalSongs).toHaveBeenCalledTimes(1);
    });

    it('alerts and does nothing when the local library is unavailable', async () => {
        const { port, notices } = createPort({ localAvailability: () => ({ supported: false, reason: 'insecure-http' }) });
        const actions = createLibraryHomeActions(port);
        expect(await actions.importFolder()).toEqual({ ok: false, reason: 'unsupported' });
        expect(port.importFolder).not.toHaveBeenCalled();
        expect(notices).toEqual([{ kind: 'alert', message: { key: 'localMusic.insecureHttpDisabled' } }]);
    });

    it('a failed folder import alerts that importing is not supported', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { port, notices } = createPort({ importFolder: vi.fn(async () => { throw new Error('denied'); }) });
        const actions = createLibraryHomeActions(port);
        expect(await actions.importFolder()).toEqual({ ok: false, reason: 'failed' });
        expect(notices).toEqual([{ kind: 'alert', message: { key: 'localMusic.importNotSupported' } }]);
        expect(actions.getSnapshot().importingFolder).toBe(false);
        error.mockRestore();
    });

    it('import and refresh share one busy flag; the flag shows in the snapshot', async () => {
        const pending = deferred<number>();
        const { port } = createPort({ importFolder: vi.fn(() => pending.promise) });
        const actions = createLibraryHomeActions(port);
        const importing = actions.importFolder();
        expect(actions.getSnapshot().importingFolder).toBe(true);
        expect(await actions.refreshFolders()).toEqual({ ok: false, reason: 'busy' });
        expect(await actions.importFolder()).toEqual({ ok: false, reason: 'busy' });
        pending.resolve(0);
        await importing;
        expect(actions.getSnapshot().importingFolder).toBe(false);
        expect(await actions.refreshFolders()).toEqual({ ok: true });
        expect(port.resyncAllFolders).toHaveBeenCalledTimes(1);
    });

    it('a failed refresh is only logged', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { port, notices } = createPort({ resyncAllFolders: vi.fn(async () => { throw new Error('gone'); }) });
        const actions = createLibraryHomeActions(port);
        expect(await actions.refreshFolders()).toEqual({ ok: false, reason: 'failed' });
        expect(notices).toEqual([]);
        expect(port.refreshLocalSongs).not.toHaveBeenCalled();
        error.mockRestore();
    });

    it('an active scan blocks folder import and refresh, but not a playlist file import', async () => {
        const { port, emitScan } = createPort();
        const actions = createLibraryHomeActions(port);
        const unsubscribe = actions.subscribe(() => {});
        emitScan({ active: true, folderName: 'Music', totalSongs: 10, completedSongs: 2 });
        expect(actions.getSnapshot().scan).toMatchObject({ folderName: 'Music' });
        expect(await actions.importFolder()).toEqual({ ok: false, reason: 'busy' });
        expect(await actions.refreshFolders()).toEqual({ ok: false, reason: 'busy' });
        expect(await actions.importPlaylistFile(file)).toEqual({ ok: true });
        emitScan({ active: false, folderName: 'Music', totalSongs: 10, completedSongs: 10 });
        expect(actions.getSnapshot().scan).toBeNull();
        unsubscribe();
    });
});

describe('createLibraryHomeActions — playlist file import', () => {
    it('reports success after refreshing the library', async () => {
        const { port, notices } = createPort();
        const actions = createLibraryHomeActions(port);
        expect(await actions.importPlaylistFile(file)).toEqual({ ok: true });
        expect(port.importPlaylistFile).toHaveBeenCalledWith(file);
        expect(port.refreshLocalSongs).toHaveBeenCalledTimes(1);
        expect(notices).toEqual([{ kind: 'status', type: 'success', message: { key: 'localMusic.playlistImportSuccess', values: { name: 'List', count: 3 } } }]);
    });

    it('reports a partial import with the skipped count', async () => {
        const { port, notices } = createPort({ importPlaylistFile: vi.fn(async () => ({ playlistName: 'List', matchedCount: 2, skippedCount: 4 })) });
        await createLibraryHomeActions(port).importPlaylistFile(file);
        expect(notices).toEqual([{ kind: 'status', type: 'info', message: { key: 'localMusic.playlistImportPartial', values: { name: 'List', count: 2, skipped: 4 } } }]);
    });

    it('no matches: an error and no refresh', async () => {
        const { port, notices } = createPort({ importPlaylistFile: vi.fn(async () => ({ playlistName: null, matchedCount: 0, skippedCount: 3 })) });
        expect(await createLibraryHomeActions(port).importPlaylistFile(file)).toEqual({ ok: false, reason: 'failed' });
        expect(port.refreshLocalSongs).not.toHaveBeenCalled();
        expect(notices).toEqual([{ kind: 'status', type: 'error', message: { key: 'localMusic.playlistImportNoMatches' } }]);
    });

    it('a thrown import reports the failure; a second file while one imports is busy', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const pending = deferred<never>();
        const { port, notices } = createPort({ importPlaylistFile: vi.fn(() => pending.promise) });
        const actions = createLibraryHomeActions(port);
        const first = actions.importPlaylistFile(file);
        expect(actions.getSnapshot().importingPlaylist).toBe(true);
        expect(await actions.importPlaylistFile(file)).toEqual({ ok: false, reason: 'busy' });
        pending.reject(new Error('bad file'));
        expect(await first).toEqual({ ok: false, reason: 'failed' });
        expect(notices).toEqual([{ kind: 'status', type: 'error', message: { key: 'localMusic.playlistImportFailed' } }]);
        expect(actions.getSnapshot().importingPlaylist).toBe(false);
        error.mockRestore();
    });
});

describe('createLibraryHomeActions — scan progress subscription', () => {
    it('listens while someone is subscribed and stops after the last one leaves', () => {
        const { port, hasScanListener } = createPort();
        const actions = createLibraryHomeActions(port);
        expect(hasScanListener()).toBe(false);
        const a = actions.subscribe(() => {});
        const b = actions.subscribe(() => {});
        expect(port.subscribeScanProgress).toHaveBeenCalledTimes(1);
        a();
        expect(hasScanListener()).toBe(true);
        b();
        expect(hasScanListener()).toBe(false);
        actions.subscribe(() => {})();
        expect(port.subscribeScanProgress).toHaveBeenCalledTimes(2);
    });
});

describe('createLibraryHomeActions — opening cards', () => {
    it('Personal FM plays from the first song and opens nothing', async () => {
        const { port } = createPort();
        const open = vi.fn();
        const result = await createLibraryHomeActions(port).openOnlineCard({ id: 'personal_fm', name: 'FM', type: 'radio' }, 'p', open);
        expect(result).toEqual({ ok: true });
        expect(port.playPersonalFm).toHaveBeenCalledWith({ id: 'fm-1' }, [{ id: 'fm-1' }, { id: 'fm-2' }]);
        expect(open).not.toHaveBeenCalled();
    });

    it('an empty FM plays nothing; a failing FM is logged', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const empty = createPort({ getPersonalFm: vi.fn(async () => []) });
        await createLibraryHomeActions(empty.port).playPersonalFm();
        expect(empty.port.playPersonalFm).not.toHaveBeenCalled();

        const failing = createPort({ getPersonalFm: vi.fn(async () => { throw new Error('offline'); }) });
        expect(await createLibraryHomeActions(failing.port).playPersonalFm()).toEqual({ ok: false, reason: 'failed' });
        expect(error).toHaveBeenCalledTimes(1);
        error.mockRestore();
    });

    it('other online cards open their source object with the card type, under the provider', async () => {
        const { port } = createPort();
        const open = vi.fn();
        const raw = { id: 'daily_recommendations', isDailyRecommendations: true };
        await createLibraryHomeActions(port).openOnlineCard({ id: 'daily_recommendations', name: 'Daily', type: 'daily_recommendations', raw }, 'p', open);
        expect(port.describeOnlineCollection).toHaveBeenCalledWith({ ...raw, type: 'daily_recommendations' }, 'p');
        expect(open).toHaveBeenCalledWith(expect.objectContaining({ source: 'online', providerId: 'p', id: 'daily_recommendations' }));
    });

    it('local groups and Navidrome cards open through the port\'s descriptor factories', () => {
        const { port } = createPort();
        const actions = createLibraryHomeActions(port);
        const open = vi.fn();
        actions.openLocalGroup({ id: 'folder-x', type: 'folder', name: 'x', songs: [] } as unknown as LocalLibraryGroup, open);
        actions.openNavidromeCard({ id: '__navi_random__', name: 'Random', isVirtual: true }, 'random', open);
        expect(open.mock.calls.map(call => call[0])).toEqual([
            { source: 'local', id: 'folder-x' },
            { source: 'navidrome', id: '__navi_random__', type: 'random' },
        ]);
    });
});
