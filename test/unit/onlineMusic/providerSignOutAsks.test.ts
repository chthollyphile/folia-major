import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/onlineMusic/providerSignOutAsks.test.ts
// The listener's request to sign out of a platform asks first, the same for every platform: the
// question names the platform and the account, and says the queue goes where the sign-out empties
// the player. Yes signs out of that platform and says so. When the question is asked and the player
// is emptied is the account controller's (test/unit/library/core/providerAccountController.test.ts).

const mocks = vi.hoisted(() => ({
    signOutAccount: vi.fn(async () => {}),
    setStatusMessage: vi.fn(),
    accounts: {} as Record<string, { user?: { nickname?: string } | null }>,
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderLabel: (providerId: string) => `label:${providerId}`,
        signOutAccount: mocks.signOutAccount,
    },
}));
vi.mock('@/stores/useOnlineProviderAccountStore', () => ({
    useOnlineProviderAccountStore: { getState: () => ({ accounts: mocks.accounts }) },
}));
vi.mock('@/stores/useStatusMessageStore', () => ({ setStatusMessage: mocks.setStatusMessage }));
vi.mock('@/stores/useThemeSettingsStore', () => ({ useThemeSettingsStore: () => false }));
vi.mock('@/components/shared/useConfirmDialog', () => ({ useConfirmDialog: () => ({ ask: async () => false, dialog: null }) }));

import { askProviderSignOut, signOutOfProvider } from '@/components/app/dialogs/useProviderSignOut';

const t = (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key);

beforeEach(() => {
    mocks.signOutAccount.mockReset();
    mocks.signOutAccount.mockImplementation(async () => {});
    mocks.setStatusMessage.mockReset();
    mocks.accounts = {};
});

describe('signing out of a platform asks first', () => {
    it.each(['netease', 'qq', 'spotify'])('signs out of %s and says so', async (providerId) => {
        await signOutOfProvider(providerId, t);

        expect(mocks.signOutAccount).toHaveBeenCalledExactlyOnceWith(providerId);
        // The message names the platform it is about: the app's message draws that platform's mark.
        expect(mocks.setStatusMessage).toHaveBeenCalledWith({ type: 'info', text: 'status.loggedOut', providerId });
    });

    it('says nothing where the sign-out fails', async () => {
        mocks.signOutAccount.mockImplementation(async () => { throw new Error('offline'); });
        await expect(signOutOfProvider('netease', t)).rejects.toThrow('offline');
        expect(mocks.setStatusMessage).not.toHaveBeenCalled();
    });

    it('asks with the platform in the title, the danger answer, and the account name only where one is known', async () => {
        const ask = vi.fn(async () => false);
        mocks.accounts = { qq: { user: { nickname: 'someone' } } };

        await expect(askProviderSignOut({ providerId: 'qq', removesSongs: false }, ask, t)).resolves.toBe(false);
        await askProviderSignOut({ providerId: 'spotify', removesSongs: false }, ask, t);

        expect(ask).toHaveBeenNthCalledWith(1, {
            title: 'account.logoutConfirmTitle:{"provider":"label:qq"}',
            description: 'someone',
            confirmText: 'account.logout',
            confirmVariant: 'danger',
        });
        expect(ask).toHaveBeenNthCalledWith(2, expect.objectContaining({ description: undefined }));
        expect(mocks.signOutAccount).not.toHaveBeenCalled();
    });

    it('says in the question that the platform songs leave the queue, after the account name, only where the player holds some', async () => {
        const ask = vi.fn(async (_question: { description?: unknown }) => true);
        mocks.accounts = { netease: { user: { nickname: 'someone' } }, qq: { user: { nickname: 'other' } } };

        await askProviderSignOut({ providerId: 'netease', removesSongs: true }, ask, t);
        await askProviderSignOut({ providerId: 'qq', removesSongs: false }, ask, t);
        await askProviderSignOut({ providerId: 'netease', removesSongs: false }, ask, t);
        mocks.accounts = {};
        await askProviderSignOut({ providerId: 'netease', removesSongs: true }, ask, t);

        expect(ask.mock.calls.map(([question]) => question.description)).toEqual([
            'someone\naccount.logoutRemovesSongs',
            'other',
            'someone',
            'account.logoutRemovesSongs',
        ]);
    });
});
