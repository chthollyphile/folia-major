import type { LocalSong } from '../../../types';
import type { LibraryDirectoryNode } from './directory.contract';
import type { LibraryLocalDirectoryTreesResource, LibraryLocalDirectoryTreesSnapshot } from '../home/homeModel.contract';

// src/library/core/directory/localDirectoryTrees.service.ts
// 本地文件夹树（原 LocalGrid3DView 自己用 loadLocalLibraryDirectoryTrees 读的组件状态）：按导入根的快照与曲库建树，
// 本地文件夹的批量面板与以后的 TUI 目录树都读它。每次 load 领一个 generation，晚到的旧读取丢掉（原先按完成顺序覆盖）；
// 读失败记警告、树为空。读取经注入的 loadTrees（默认装配在 localDirectoryTreesDeps）。
// 资源由首页宿主持有：显示本地页签的 surface 用 ensure(曲库)，同一份曲库读过就不再读（换 suite 不重新读），
// 曲库换了新数组就重读；宿主在离开本地页签或首页时 invalidate（与原先随视图卸载、回来重读一致）。

export type LocalDirectoryTreesDeps = {
    loadTrees(songs?: LocalSong[]): Promise<LibraryDirectoryNode[]>;
};

export const createLocalDirectoryTrees = (deps: LocalDirectoryTreesDeps): LibraryLocalDirectoryTreesResource => {
    let snapshot: LibraryLocalDirectoryTreesSnapshot = { trees: [], loaded: false };
    let generation = 0;
    /** 最近一次按哪份曲库发起读取（ensure 据此判断要不要再读）；作废后为 null。 */
    let requestedSongs: readonly LocalSong[] | null = null;
    let inFlight: Promise<void> = Promise.resolve();
    const listeners = new Set<() => void>();

    const commit = (next: LibraryLocalDirectoryTreesSnapshot) => {
        snapshot = next;
        listeners.forEach(listener => listener());
    };

    const resource: LibraryLocalDirectoryTreesResource = {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        load: (songs) => {
            // 不带曲库的读取（服务自己读曲库）不改变「按哪份曲库读过」：曲库没变时之后的 ensure 仍不必再读。
            if (songs) requestedSongs = songs;
            inFlight = load(songs);
            return inFlight;
        },
        ensure: songs => (requestedSongs === songs ? inFlight : resource.load(songs)),
        invalidate: () => {
            requestedSongs = null;
        },
    };

    /** 读一次树：领一个 generation，晚到的旧读取丢掉。 */
    async function load(songs?: readonly LocalSong[]): Promise<void> {
        const ticket = ++generation;
        let trees: LibraryDirectoryNode[];
        try {
            trees = await deps.loadTrees(songs ? [...songs] : undefined);
        } catch (error) {
            console.warn('[LibraryHome] Failed to load directory snapshots:', error);
            trees = [];
        }
        if (ticket !== generation) return;
        commit({ trees, loaded: true });
    }

    return resource;
};
