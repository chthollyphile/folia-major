import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDirHandles } from '@/services/db';
import { resyncFolder } from '@/services/localMusicService';
import {
    getLocalLibraryAutoScanState,
    refreshLocalLibraryAutoScanRoots,
    startLocalLibraryAutoScan,
    stopLocalLibraryAutoScan,
} from '@/services/localLibraryAutoScan';
import { useLocalLibrarySettingsStore } from '@/stores/useLocalLibrarySettingsStore';
import type { LocalLibraryChangeRecordLike } from '@/types/localLibraryWatch';

// test/unit/services/localLibraryAutoScan.test.ts
// 自动增量扫描遇到读不到的文件夹：不弹提示，只把原因记进 lastError，后面的文件夹照常扫。

vi.mock('@/services/db', () => ({
    getDirHandles: vi.fn(),
}));
vi.mock('@/services/localMusicService', () => {
    class LocalFolderUnavailableError extends Error {
        constructor(public readonly rootFolderName: string, public readonly reason: 'unreadable' | 'empty') {
            super(`Local folder "${rootFolderName}" is ${reason}`);
            this.name = 'LocalFolderUnavailableError';
        }
    }
    return {
        LOCAL_MUSIC_UPDATED_EVENT: 'local-music-updated',
        LocalFolderUnavailableError,
        resyncFolder: vi.fn(),
    };
});

type ObserverCallback = (records: LocalLibraryChangeRecordLike[]) => void;
const observers: Array<{ callback: ObserverCallback; handle: unknown }> = [];

class FakeFileSystemObserver {
    constructor(private readonly callback: ObserverCallback) {}

    observe(handle: unknown) {
        observers.push({ callback: this.callback, handle });
        return Promise.resolve();
    }

    disconnect() {}
}

const rootHandle = (name: string) => ({ name, queryPermission: () => Promise.resolve('granted' as PermissionState) });
const changeUnder = (name: string) => {
    const observer = observers.find(item => (item.handle as { name: string }).name === name);
    observer?.callback([{ type: 'appeared', relativePathComponents: ['New Song.mp3'] } as LocalLibraryChangeRecordLike]);
};

describe('local library auto scan', () => {
    beforeEach(async () => {
        vi.useFakeTimers();
        observers.length = 0;
        vi.mocked(resyncFolder).mockReset();
        vi.mocked(getDirHandles).mockReset();
        vi.stubGlobal('window', { FileSystemObserver: FakeFileSystemObserver, addEventListener: vi.fn(), removeEventListener: vi.fn() });
        useLocalLibrarySettingsStore.setState({ autoScanEnabled: true });
        vi.mocked(getDirHandles).mockResolvedValue({
            Music: rootHandle('Music') as unknown as FileSystemDirectoryHandle,
            Other: rootHandle('Other') as unknown as FileSystemDirectoryHandle,
        });
        startLocalLibraryAutoScan();
        await refreshLocalLibraryAutoScanRoots();
    });

    afterEach(() => {
        stopLocalLibraryAutoScan();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('records an unreadable folder in lastError without announcing it, and goes on with the next folder', async () => {
        const { LocalFolderUnavailableError } = await import('@/services/localMusicService');
        vi.mocked(resyncFolder).mockImplementation(rootFolderName => (
            rootFolderName === 'Music'
                ? Promise.reject(new LocalFolderUnavailableError('Music', 'unreadable'))
                : Promise.resolve([])
        ));
        expect(observers).toHaveLength(2);

        changeUnder('Music');
        await vi.advanceTimersByTimeAsync(2000);

        expect(resyncFolder).toHaveBeenCalledWith('Music', { announceUnavailable: false });
        expect(getLocalLibraryAutoScanState()).toMatchObject({ lastError: 'Local folder "Music" is unreadable', lastScanRootFolderName: 'Music', scanning: false });

        changeUnder('Other');
        await vi.advanceTimersByTimeAsync(2000);

        expect(resyncFolder).toHaveBeenCalledWith('Other', { announceUnavailable: false });
        expect(getLocalLibraryAutoScanState()).toMatchObject({ lastError: null, lastScanRootFolderName: 'Other' });
    });
});
