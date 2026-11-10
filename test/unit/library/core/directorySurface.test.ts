import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDirectorySurfaceActions } from '@/library/core/directory/directorySurface';
import { resolveDirectoryBatchCapabilities, resolveDirectoryBatchContext } from '@/library/core/directory/directoryBatch';
import { useLibraryDirectorySurfaceStore } from '@/library/core/directory/useLibraryDirectorySurfaceStore';
import type { LibraryDirectoryItem, LibraryDirectorySurfaceHandle, LibraryDirectorySurfaceState } from '@/library/core/directory/directory.contract';

// test/unit/library/core/directorySurface.test.ts
// 目录的命令面板 surface：动作是否可用与批量面板按钮同源（core 的批量能力）；注册的交接与 grid surface
// 同一套规则（旧实例晚卸载不注销新实例）。

const items: LibraryDirectoryItem[] = [
    { id: 'a', name: 'A', type: 'folder', trackIds: ['1'] },
    { id: 'b', name: 'B', type: 'folder', trackIds: ['2'] },
];

describe('directory surface actions', () => {
    const folders = { selectionType: 'folders' as const };

    it('offers only select-all on a batch directory with nothing selected', () => {
        const context = resolveDirectoryBatchContext(items, new Set());
        expect(resolveDirectorySurfaceActions({
            capabilities: resolveDirectoryBatchCapabilities(folders, context, null),
            context,
            displayItemCount: 2,
            selectedItemCount: 0,
            hasHideableItems: false,
        })).toEqual(['select-all']);
    });

    it('offers the scope actions with a selection, like the panel buttons, and withdraws them while an action runs', () => {
        const context = resolveDirectoryBatchContext(items, new Set(['a']));
        expect(resolveDirectorySurfaceActions({
            capabilities: resolveDirectoryBatchCapabilities(folders, context, null),
            context,
            displayItemCount: 2,
            selectedItemCount: 1,
            hasHideableItems: false,
        })).toEqual(['play-selection', 'enqueue-selection', 'create-playlist', 'remove-selection', 'select-all', 'clear-selection']);
        expect(resolveDirectorySurfaceActions({
            capabilities: resolveDirectoryBatchCapabilities(folders, context, { action: 'rescan-root', rootPath: 'Music' }),
            context,
            displayItemCount: 2,
            selectedItemCount: 1,
            hasHideableItems: false,
        })).toEqual(['select-all', 'clear-selection']);
    });

    it('drops remove for albums and select-all once every filtered card is selected', () => {
        const context = resolveDirectoryBatchContext(items, new Set(['a', 'b']));
        expect(resolveDirectorySurfaceActions({
            capabilities: resolveDirectoryBatchCapabilities({ selectionType: 'albums' }, context, null),
            context,
            displayItemCount: 2,
            selectedItemCount: 2,
            hasHideableItems: false,
        })).toEqual(['play-selection', 'enqueue-selection', 'create-playlist', 'clear-selection']);
    });

    it('offers manage-hidden only on a directory without batch that has something hideable', () => {
        const context = resolveDirectoryBatchContext([], new Set());
        const base = { capabilities: null, context, displayItemCount: 3, selectedItemCount: 0 };
        expect(resolveDirectorySurfaceActions({ ...base, hasHideableItems: true })).toEqual(['manage-hidden']);
        expect(resolveDirectorySurfaceActions({ ...base, hasHideableItems: false })).toEqual([]);
    });
});

const surfaceState = (availableActions: LibraryDirectorySurfaceState['availableActions']): LibraryDirectorySurfaceState => ({
    directoryKey: 'home:local:folders',
    availableActions,
    displayItemCount: 2,
    selectedItemCount: 1,
    selectedTrackCount: 1,
    visibilityMode: 'browse',
});
const handle = (availableActions: LibraryDirectorySurfaceState['availableActions'] = []): LibraryDirectorySurfaceHandle => ({
    getState: () => surfaceState(availableActions),
    run: vi.fn(() => true),
});

describe('directory surface registration', () => {
    beforeEach(() => {
        useLibraryDirectorySurfaceStore.setState({ directorySurface: null });
    });

    it('hands ownership to the latest registrant and ignores a stale teardown', () => {
        const outgoing = handle();
        const incoming = handle();
        const releaseOutgoing = useLibraryDirectorySurfaceStore.getState().registerDirectorySurface(outgoing);
        const releaseIncoming = useLibraryDirectorySurfaceStore.getState().registerDirectorySurface(incoming);
        releaseOutgoing();
        expect(useLibraryDirectorySurfaceStore.getState().directorySurface).toBe(incoming);
        releaseIncoming();
        expect(useLibraryDirectorySurfaceStore.getState().directorySurface).toBeNull();
    });
});
