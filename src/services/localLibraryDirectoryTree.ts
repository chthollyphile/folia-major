import type { LocalLibrarySnapshot, LocalLibrarySnapshotNode, LocalSong } from '../types';
import type { LibraryDirectoryNode } from '../library/core/directory/directory.contract';
import { getDirHandles, getLocalLibrarySnapshot, getLocalSongs } from './db';

// src/services/localLibraryDirectoryTree.ts

const normalizeLocalPath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

const getSongFolderPath = (song: LocalSong) => normalizeLocalPath(song.folderName || '');

// Converts persisted scan snapshots into a directory-only tree without touching the disk.
export const buildLocalLibraryDirectoryTrees = (
    snapshots: LocalLibrarySnapshot[],
    songs: LocalSong[],
): LibraryDirectoryNode[] => {
    const directCounts = new Map<string, number>();
    for (const song of songs) {
        const folderPath = getSongFolderPath(song);
        if (!folderPath) continue;
        directCounts.set(folderPath, (directCounts.get(folderPath) || 0) + 1);
    }

    const convertNode = (
        node: LocalLibrarySnapshotNode,
        rootPath: string,
        depth: number,
    ): LibraryDirectoryNode => {
        const path = normalizeLocalPath(node.relativePath || rootPath);
        const children = (node.ignored ? [] : node.children)
            .map(child => convertNode(child, rootPath, depth + 1))
            .sort((a, b) => a.name.localeCompare(b.name));
        const directTrackCount = node.ignored ? 0 : directCounts.get(path) || 0;
        const totalTrackCount = directTrackCount + children.reduce((sum, child) => sum + child.totalTrackCount, 0);

        return {
            id: `${rootPath}:${path}`,
            name: node.name || rootPath,
            path,
            rootPath,
            depth,
            ignored: node.ignored,
            directTrackCount,
            totalTrackCount,
            children,
        };
    };

    return snapshots
        .map(snapshot => convertNode(snapshot.tree, snapshot.rootFolderName, 0))
        .sort((a, b) => a.name.localeCompare(b.name));
};

export const loadLocalLibraryDirectoryTrees = async (songs?: LocalSong[]): Promise<LibraryDirectoryNode[]> => {
    const handles = await getDirHandles();
    const snapshots = (await Promise.all(
        Object.keys(handles).map(rootPath => getLocalLibrarySnapshot(rootPath)),
    )).filter((snapshot): snapshot is LocalLibrarySnapshot => Boolean(snapshot));

    return buildLocalLibraryDirectoryTrees(snapshots, songs ?? await getLocalSongs());
};
