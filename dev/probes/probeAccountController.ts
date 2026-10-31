import type { LibraryAccountController, LibraryAccountSnapshot } from '../../src/library/core/account/account.contract';
import type { OnlineProviderId, ProviderAccountSummary } from '../../src/types/onlineMusic';

// dev/probes/probeAccountController.ts
// An account controller that only shows what it is given: the probe's sample platforms and the active
// one, nobody signing in, nothing pending. Its actions do nothing and say so; `said` hears what was
// asked of it. For the probes of the parts that take `account` (the home's sign-in button, the pill,
// the sign-in window); nothing is requested.

export const probeAccountController = (
    providers: ProviderAccountSummary[],
    activeProviderId: OnlineProviderId,
    said: (what: string) => void = () => { },
): LibraryAccountController => {
    const snapshot: LibraryAccountSnapshot = {
        providers,
        activeProviderId,
        login: null,
        pendingSwitch: null,
        logout: { providerId: null, status: 'idle' },
        lastLoginCompletion: null,
    };
    return {
        getSnapshot: () => snapshot,
        subscribe: () => () => { },
        selectProvider: async providerId => { said(`select ${providerId}`); return { action: 'login', providerId }; },
        requestSwitch: async providerId => { said(`switch ${providerId}`); return { status: 'switched', providerId, changed: false }; },
        confirmSwitch: async requestId => ({ status: 'stale', requestId }),
        cancelSwitch: requestId => ({ status: 'stale', requestId }),
        startLogin: async providerId => { said(`sign in ${providerId}`); return { status: 'superseded', providerId }; },
        selectLoginMethod: async () => ({ status: 'no-session' }),
        retryLogin: async () => ({ status: 'no-session' }),
        openLoginPage: async () => ({ status: 'no-session' }),
        closeLogin: () => ({ status: 'no-session' }),
        restartLocalService: async () => ({ status: 'no-session' }),
        buildLoginDiagnosticReport: async () => ({ status: 'no-session' }),
        completeFormLogin: async providerId => { said(`complete form ${providerId}`); return { sessionId: 0, providerId, outcome: 'completed' }; },
        logout: async providerId => { said(`sign out ${providerId}`); return { status: 'cancelled', providerId }; },
        dispose: () => { },
    };
};
