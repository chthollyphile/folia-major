// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/localFolderAccess/localFolderAccessCheck.test.ts
// The one-time check at the end of the start sequence: owed only when an imported folder cannot be reached,
// and never run again once it found nothing or its page was closed.

const mocks = vi.hoisted(() => ({
    probeLocalRootAccess: vi.fn(),
    reauthorizeLocalRoot: vi.fn(),
}));

vi.mock('@/services/localMusicService', () => mocks);
vi.mock('@/services/localLibraryAvailability', () => ({ getLocalLibraryAvailability: () => ({ supported: true, reason: null }) }));

const CHECKED_KEY = 'folia_local_folder_access_checked';

// A fresh module per test: the check runs once per run.
const loadModule = async () => {
    vi.resetModules();
    return await import('@/components/local-folder-access/localFolderAccessCheck');
};

describe('local folder access check', () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.probeLocalRootAccess.mockReset();
        mocks.reauthorizeLocalRoot.mockReset();
        vi.spyOn(console, 'info').mockImplementation(() => { });
    });

    it('owes the page only for the roots that cannot be reached', async () => {
        mocks.probeLocalRootAccess.mockResolvedValue([
            { rootFolderName: 'Music', songCount: 3, access: 'ok' },
            { rootFolderName: 'Radio', songCount: 2, access: 'dead' },
            { rootFolderName: 'New', songCount: 19, access: 'missing' },
        ]);
        const check = await loadModule();
        await check.loadLocalFolderAccessCheck();

        const state = check.useLocalFolderAccessStore.getState();
        expect(state.status).toBe('owed');
        expect(state.rows.map(row => row.rootFolderName)).toEqual(['Radio', 'New']);
        expect(localStorage.getItem(CHECKED_KEY)).toBeNull();
    });

    it('marks the install checked when every folder is reachable', async () => {
        mocks.probeLocalRootAccess.mockResolvedValue([{ rootFolderName: 'Music', songCount: 3, access: 'ok' }]);
        const check = await loadModule();
        await check.loadLocalFolderAccessCheck();

        expect(check.useLocalFolderAccessStore.getState().status).toBe('none');
        expect(localStorage.getItem(CHECKED_KEY)).toBe('true');
    });

    it('does not look again once checked, and closing the page marks it checked', async () => {
        mocks.probeLocalRootAccess.mockResolvedValue([{ rootFolderName: 'Radio', songCount: 2, access: 'dead' }]);
        let check = await loadModule();
        await check.loadLocalFolderAccessCheck();
        check.openLocalFolderAccessPrompt();
        check.closeLocalFolderAccessPrompt();
        expect(check.useLocalFolderAccessStore.getState()).toMatchObject({ status: 'none', isOpen: false });

        check = await loadModule();
        await check.loadLocalFolderAccessCheck();
        expect(mocks.probeLocalRootAccess).toHaveBeenCalledTimes(1);
        expect(check.useLocalFolderAccessStore.getState().status).toBe('none');
    });

    it('records what picking a folder again came to', async () => {
        mocks.probeLocalRootAccess.mockResolvedValue([
            { rootFolderName: 'Radio', songCount: 2, access: 'dead' },
            { rootFolderName: 'New', songCount: 19, access: 'missing' },
        ]);
        mocks.reauthorizeLocalRoot.mockImplementation(async (root: string) => (root === 'Radio' ? 'restored' : 'mismatch'));
        const check = await loadModule();
        await check.loadLocalFolderAccessCheck();
        await check.reauthorizeFolder('Radio');
        await check.reauthorizeFolder('New');

        expect(check.useLocalFolderAccessStore.getState().rows.map(row => row.result)).toEqual(['restored', 'mismatch']);
    });
});
