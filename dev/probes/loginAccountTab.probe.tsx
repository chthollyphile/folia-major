import React, { useEffect, useLayoutEffect, useState } from 'react';
import AccountTab from '../../src/components/panelTab/AccountTab';
import { panelTokens } from '../../src/components/panelTab/shell/panelTheme';
import { useLoginWindowStore } from '../../src/components/login/loginWindowStore';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../src/services/baseThemes';
import { useOnlineProviderAccountStore } from '../../src/stores/useOnlineProviderAccountStore';
import { createProviderAccountController } from '../../src/library/core/account/providerAccountController.service';
import { createProviderAccountDeps } from '../../src/library/core/account/providerAccountDeps.service';
import type { ProbeDefinition } from './definition';
// dev/probes/loginAccountTab.probe.tsx

/**
 * The account tab of the playing page's panel, for its three sign-in states: somebody is signed
 * in (the platform's mark sits on the picture), nobody is (the guest row), and the sign-in ran
 * out. The account is a sample put into the account store, read through the account controller;
 * nothing is requested: the sign-out asks the probe, which says no.
 *
 * Opened by hand: ?probe=loginAccountTab&state=signed-in|guest|ran-out&theme=dark|light.
 * The button of the guest and ran-out rows goes home and opens the sign-in window: the two
 * outputs under the tab say what was asked for.
 */
type ProbeProps = { state?: string; theme?: 'dark' | 'light' };

function LoginAccountTabProbe(props: ProbeProps) {
    const query = new URLSearchParams(window.location.search);
    const state = props.state ?? query.get('state') ?? 'signed-in';
    const isDaylight = (props.theme ?? query.get('theme')) === 'light';
    const [said, setSaid] = useState('');
    const [account] = useState(() => createProviderAccountController(createProviderAccountDeps({
        logout: async () => { },
        confirmLogout: async () => {
            setSaid('sign out');
            return false;
        },
        switchCleanup: { leaveProvider: () => { }, holdsSongsOf: () => false, dropSongsOf: () => { } },
    })));
    useEffect(() => () => account.dispose(), [account]);
    const asked = useLoginWindowStore(store => (store.isOpen ? `window open on ${store.providerId ?? 'no platform'}` : ''));

    useLayoutEffect(() => {
        useLoginWindowStore.setState({ isOpen: false });
        const store = useOnlineProviderAccountStore.getState();
        store.setActiveProviderId('netease');
        if (state === 'signed-in') {
            store.updateAccount('netease', { status: 'authenticated', user: { id: '329184756', nickname: '青柠汽水', vipType: 11 }, error: undefined });
        } else {
            store.clearAccount('netease', state === 'ran-out' ? 'auth-required' : undefined);
        }
    }, [state]);

    return (
        <div className={`flex min-h-screen flex-col items-center gap-3 p-10 ${isDaylight ? 'bg-zinc-300' : 'bg-zinc-800'}`}>
            <div
                className="st-window w-[360px] rounded-[20px] bg-[var(--pn-glass)] p-3 text-[color:var(--st-t1)] shadow-[var(--pn-shadow)]"
                style={panelTokens(isDaylight, isDaylight ? DAYLIGHT_THEME : DEFAULT_THEME, false)}
            >
                <AccountTab
                    accountController={account}
                    audioQuality="high"
                    onAudioQualityChange={() => { }}
                    onSyncData={() => { }}
                    isSyncing={false}
                    onNavigateHome={() => setSaid('go home')}
                />
            </div>
            <output data-testid="said" className="text-xs text-zinc-400">{said}</output>
            <output data-testid="asked" className="text-xs text-zinc-400">{asked}</output>
        </div>
    );
}

export default {
    id: 'loginAccountTab', title: '控制面板的账号页（登录相关的三种样子）',
    description: '已登录（头像角上有平台的记号）、游客、登录失效；账号是样本。',
    Component: LoginAccountTabProbe,
} satisfies ProbeDefinition;
