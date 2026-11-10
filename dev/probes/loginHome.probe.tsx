import React from 'react';
import { useTranslation } from 'react-i18next';
import AppDialogs from '../../src/components/app/dialogs/AppDialogs';
import HomeLoginPanel from '../../src/components/login/HomeLoginPanel';
import SwitcherPill from '../../src/components/login/SwitcherPill';
import { SettingsKitThemeContext } from '../../src/components/modal/settings/kit/kitTheme';
import type { StatusMessage } from '../../src/types';
import type { ProviderAccountSummary } from '../../src/types/onlineMusic';
import type { ProbeDefinition } from './definition';
import { probeAccountController } from './probeAccountController';
// dev/probes/loginHome.probe.tsx

/**
 * The two sign-in parts of the home page: the panel shown while nobody is signed in (one button)
 * and the switcher pill at the bottom right. The accounts are samples; nothing is requested.
 *
 * Opened by hand: ?probe=loginHome&state=signed-out|ran-out|signed-in&theme=dark|light.
 * Both parts open the sign-in window through its one entry; no window is mounted here.
 *
 * message=signed-out|ran-out|plain also shows the app's own message as it stands after a sign-out
 * and when a sign-in ran out (both lead with the platform's mark), and a message about no
 * platform (`plain`: the type's icon, as every other message of the app).
 */
type ProbeProps = { state?: string; theme?: 'dark' | 'light'; message?: string };

const row = (providerId: string, shortName: string, extra: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId, shortName, displayName: shortName, availability: { configured: true }, status: 'anonymous', user: null, collections: [], ...extra,
});

function LoginHomeProbe(props: ProbeProps) {
    const query = new URLSearchParams(window.location.search);
    const state = props.state ?? query.get('state') ?? 'signed-out';
    const isDaylight = (props.theme ?? query.get('theme')) === 'light';
    const providers = [
        row('netease', '网易云', state === 'signed-in'
            ? { status: 'authenticated', user: { id: '329184756', nickname: '青柠汽水' } }
            : state === 'ran-out' ? { error: 'auth-required' } : {}),
        row('qq', 'QQ音乐'), row('kugou', '酷狗'), row('bodian', '波点'), row('ytm', 'YouTube Music'), row('spotify', 'Spotify'),
    ];
    const account = probeAccountController(providers, 'netease');
    const { t } = useTranslation();
    const message = props.message ?? query.get('message');
    const said: StatusMessage | null = message === 'signed-out' ? { type: 'info', text: t('status.loggedOut'), providerId: 'netease' }
        : message === 'ran-out' ? { type: 'error', text: t('login.signInRanOut'), providerId: 'netease' }
            : message === 'plain' ? { type: 'error', text: t('status.syncFailed') } : null;

    return (
        <SettingsKitThemeContext.Provider value={{ isDaylight }}>
            <div
                className={`relative flex min-h-screen flex-col ${isDaylight ? 'bg-zinc-100' : 'bg-zinc-950'}`}
                style={{ '--text-primary': isDaylight ? '#18181b' : '#f4f4f5' } as React.CSSProperties}
            >
                {state !== 'signed-in' && <HomeLoginPanel account={account} />}
                <SwitcherPill account={account} onBackToPlayer={() => { }} />
                {said && <AppDialogs model={{ statusToast: { ...said, isDaylight, toastKey: message ?? '' } }} />}
            </div>
        </SettingsKitThemeContext.Provider>
    );
}

export default {
    id: 'loginHome', title: '主页的登录入口',
    description: '没有人登录时的标题、提示和登录按钮，右下角的切换器；账号是样本。',
    Component: LoginHomeProbe,
} satisfies ProbeDefinition;
