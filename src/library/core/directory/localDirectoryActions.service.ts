import type { LocalSong } from '../../../types';
import type {
    LibraryDirectoryBatchActionId,
    LibraryDirectoryBatchContext,
    LibraryDirectoryBatchController,
    LibraryDirectoryBatchPending,
    LibraryDirectoryBatchPort,
    LibraryDirectoryBatchRunOptions,
    LibraryDirectoryBatchSnapshot,
} from './directory.contract';
import type { LibraryMutationFailureReason, LibraryMutationResult } from '../collection/mutations/mutations.contract';

// src/library/core/directory/localDirectoryActions.service.ts
// 本地目录（首页本地曲库的文件夹 / 专辑 / 歌手）的批量动作层。规则原样搬自 LocalGrid3DView 的批量配置：
// - 播放 / 入队 / 新建歌单：把范围的歌曲 id 按宿主此刻的曲库解析成歌（顺序 = 范围的顺序，找不到的跳过）；
// - 删除：只有「整个文件夹都被选中」的真实文件夹才按文件夹删（删最上层的那个路径），其余按歌 id 删；
//   「全部歌曲」这类虚拟条目不对应文件夹，从不按文件夹删；然后刷新曲库；
// - 恢复忽略目录、重扫根、移除根：调对应服务后刷新曲库。
// 副作用都经宿主装配的 LibraryDirectoryBatchPort；同一时间只允许一个动作（进行中再提交返回 busy），
// 进行中的动作在快照里，面板与命令面板据此禁用。

const OK: LibraryMutationResult = { ok: true };
const fail = (reason: LibraryMutationFailureReason, message?: string): LibraryMutationResult => (
    message === undefined ? { ok: false, reason } : { ok: false, reason, message }
);

/** 按范围的歌曲 id（已去重保序）从曲库取歌；曲库里已经没有的跳过。 */
export const resolveDirectoryBatchSongs = (
    songs: readonly LocalSong[],
    trackIds: readonly string[],
): LocalSong[] => {
    const songsById = new Map(songs.map(song => [song.id, song]));
    return trackIds
        .map(id => songsById.get(id))
        .filter((song): song is LocalSong => Boolean(song));
};

/**
 * 删除选中范围时要按文件夹删的路径（最上层的那些）。一个真实文件夹只有在它和它所有子目录里的歌都在范围里时
 * 才算「整个选中」——只选了本层（子目录没选）不能把子目录一并删掉。虚拟条目（「全部歌曲」）不算文件夹。
 */
export const resolveFolderRemovalPaths = (
    context: LibraryDirectoryBatchContext,
    songs: readonly Pick<LocalSong, 'id' | 'folderName'>[],
): string[] => {
    const selectedIds = new Set(context.trackIds);
    // A direct-only selection must not ignore descendants that the user excluded.
    // 虚拟条目（「全部歌曲」）不对应任何文件夹，不按文件夹删；它的歌照常按 id 删。
    const folderPaths = context.items
        .filter(item => !item.isVirtual)
        .map(item => item.path || item.name)
        .filter(path => songs.every(song => (
            !(song.folderName === path || song.folderName?.startsWith(`${path}/`)) || selectedIds.has(song.id)
        )));
    return folderPaths.filter(path => !folderPaths.some(parent => path !== parent && path.startsWith(`${parent}/`)));
};

/** 创建本地目录批量动作控制器。端口在调用时现读（宿主每次渲染都可能换新的曲库）。 */
export const createLocalDirectoryActions = (port: LibraryDirectoryBatchPort): LibraryDirectoryBatchController => {
    let snapshot: LibraryDirectoryBatchSnapshot = { pending: null };
    const listeners = new Set<() => void>();

    const setPending = (pending: LibraryDirectoryBatchPending | null) => {
        snapshot = { pending };
        listeners.forEach(listener => listener());
    };

    // 独占地跑一个动作：进行中再提交返回 busy；抛错记下并返回 failed；收尾（after）也在 pending 期间。
    const run = async (
        pending: LibraryDirectoryBatchPending,
        work: () => Promise<void>,
        options?: LibraryDirectoryBatchRunOptions,
    ): Promise<LibraryMutationResult> => {
        if (snapshot.pending) return fail('busy');
        setPending(pending);
        try {
            await work();
            await options?.after?.();
            return OK;
        } catch (error) {
            console.error(`[LibraryDirectory] Batch action ${pending.action} failed:`, error);
            return fail('failed', error instanceof Error ? error.message : undefined);
        } finally {
            setPending(null);
        }
    };

    const songsOf = (context: LibraryDirectoryBatchContext) => resolveDirectoryBatchSongs(port.getLocalSongs(), context.trackIds);

    // 播放 / 入队：范围里没有可解析的歌时什么都不做（与原先 queue.length > 0 的守卫一致）。
    const playback = (action: LibraryDirectoryBatchActionId, context: LibraryDirectoryBatchContext, deliver: (songs: LocalSong[]) => Promise<void> | void) => {
        if (context.trackIds.length === 0) return Promise.resolve(fail('unsupported'));
        return run({ action }, async () => {
            const songs = songsOf(context);
            if (songs.length > 0) await deliver(songs);
        });
    };

    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        play: context => playback('play', context, songs => port.playLocalSongs(songs)),
        enqueue: context => playback('enqueue', context, songs => port.enqueueLocalSongs(songs)),
        createPlaylist: (name, context) => {
            if (context.trackIds.length === 0 || !name.trim()) return Promise.resolve(fail('unsupported'));
            return run({ action: 'create-playlist' }, async () => {
                await port.createLocalPlaylist(name, songsOf(context));
                await port.refreshLibrary();
            });
        },
        remove: (context, options) => {
            if (context.trackIds.length === 0) return Promise.resolve(fail('unsupported'));
            return run({ action: 'remove' }, async () => {
                for (const path of resolveFolderRemovalPaths(context, port.getLocalSongs())) {
                    await port.deleteFolderSongs(path);
                }
                await port.deleteSongsByIds(context.trackIds);
                await port.refreshLibrary();
            }, options);
        },
        // 忙碌标记落在文件夹所在的导入根上（路径的第一段），与原先目录树那一行的转圈一致。
        clearIgnore: (folderPath, options) => run({ action: 'clear-ignore', rootPath: folderPath.split('/')[0] }, async () => {
            await port.clearFolderIgnore(folderPath);
            await port.refreshLibrary();
        }, options),
        rescanRoot: (rootPath, options) => run({ action: 'rescan-root', rootPath }, async () => {
            await port.resyncFolder(rootPath);
            await port.refreshLibrary();
        }, options),
        removeRoot: (rootPath, options) => run({ action: 'remove-root', rootPath }, async () => {
            await port.removeImportedRoot(rootPath);
            await port.refreshLibrary();
        }, options),
    };
};
