import React, { useEffect, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsKitThemeContext } from '../../src/components/modal/settings/kit/kitTheme';
import LoginScreen, { type LoginScreenProps } from '../../src/components/login/window/LoginScreen';
import { loginDoneLanding } from '../../src/components/login/done/loginDoneFrame';
import { setLoginLanding } from '../../src/components/login/loginWindowStore';
import { orderRows } from '../../src/components/login/platformRows';
import SwitcherPill from '../../src/components/login/SwitcherPill';
import { useMotionSettingsStore } from '../../src/stores/useMotionSettingsStore';
import type { RowLead } from '../../src/components/login/window/loginView';
import { loginCaseOf, loginFailureFacts } from '../../src/services/onlineMusic/login/loginFailureCase';
import type { LoginFailure } from '../../src/types/loginFailure';
import type { LibraryLoginSessionSnapshot } from '../../src/library/core/account/account.contract';
import type { LoginCaseId, LoginFailureDetail, LoginMethod, LoginStep, ProviderAccountSummary } from '../../src/types/onlineMusic';
import type { ProbeDefinition } from './definition';
import { probeAccountController } from './probeAccountController';
// dev/probes/loginWindow.probe.tsx

/**
 * The sign-in window in any state and in each of the 18 failure cases, without a sign-in: the
 * state of the sign-in is made up here and handed to the window's screen. Nothing is requested;
 * the code is a pattern drawn in this file, the accounts are samples.
 *
 * Opened by hand: ?probe=loginWindow&state=<state>&theme=dark|light&count=6…12&lang=zh|en
 * state: none, preparing, code, scanned, reading, expired, methods, methods-code, browser-ready,
 * browser-opening, browser, account, account-other, account-nameless (signed in, no profile),
 * account-gone (the sign-in ran out while the account was shown), accountless, off, or fail-<case id>.
 * count=7–12 fills the column up to that many platforms with stand-ins (the search field shows from 12 up).
 * A test passes the same as props.
 *
 * state=play walks through a sign-in by itself, at the mock-up's pace: the code, scanned after
 * 0.3 s, confirmed 1.3 s after the scan, the account read 2.1 s after it; then the animation, the
 * window leaving and the picture landing in the switcher pill at the bottom right. state=play-web
 * is the same for a sign-in in the browser (no "scanned" step). motion=off turns the app's
 * reduce-motion setting on: no animation, the window closes when the account is read.
 */
type ProbeProps = { state?: string; theme?: 'dark' | 'light'; count?: number; lang?: 'zh' | 'en'; motion?: 'on' | 'off' };

/** When the played sign-in is scanned, confirmed and read: ms after the probe mounts. */
const PLAY = { scanned: 300, confirmed: 300 + 1300, read: 300 + 2100 };
const SAMPLE_USER = { id: '1840027715', nickname: '青柠汽水' };

// A pattern that looks like a QR code. It encodes nothing.
const fakeCode = (): string => {
    const size = 25;
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const on: boolean[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => random() > 0.5));
    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
        for (let r = -1; r < 8; r += 1) for (let c = -1; c < 8; c += 1) {
            const row = top + r;
            const col = left + c;
            if (row < 0 || col < 0 || row >= size || col >= size) continue;
            const inside = r >= 0 && r < 7 && c >= 0 && c < 7;
            on[row][col] = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        }
    }
    const path = on.flatMap((line, r) => line.map((cell, c) => (cell ? `M${c} ${r}h1v1h-1z` : ''))).join('');
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><path d="${path}"/></svg>`)}`;
};
const CODE = fakeCode();

const row = (providerId: string, shortName: string, extra: Partial<ProviderAccountSummary> = {}): ProviderAccountSummary => ({
    providerId, shortName, displayName: shortName, availability: { configured: true }, status: 'anonymous', user: null, collections: [], ...extra,
});
const PLATFORMS: ProviderAccountSummary[] = [
    row('netease', '网易云'),
    row('qq', 'QQ音乐', { status: 'authenticated', user: { id: '1840027715', nickname: '晚风' } }),
    row('kugou', '酷狗', { error: 'auth-required' }),
    row('bodian', '波点', { availability: { configured: false, reason: 'not-configured' } }),
    row('spotify', 'Spotify'),
    row('ytm', 'YouTube Music'),
];
// Stand-ins, registered nowhere: each gets a mark from its own name.
const STAND_INS = ['咪咕音乐', '汽水音乐', 'Apple Music', 'TIDAL', 'Deezer', 'A source with a very long name indeed'].map((name, index) => (
    row(`stand-in-${index}`, name, index === 5 ? { requiresAccount: false } : {})
));

const QQ_METHODS: LoginMethod[] = [
    { id: 'qq', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
    { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
];

// One sample of each case: on which platform, at which step, and what the platform handed over.
const CASES: Record<LoginCaseId, { on: string; step: LoginStep; scanned?: boolean; detail?: LoginFailureDetail }> = {
    'code-expired': { on: 'netease', step: 'wait' },
    'expired-after-scan': { on: 'kugou', step: 'wait', scanned: true },
    'browser-unfinished': { on: 'spotify', step: 'wait' },
    'not-authorized': { on: 'spotify', step: 'check', detail: { case: 'not-authorized', mainCode: 'access-denied' } },
    unreachable: { on: 'kugou', step: 'start', detail: { httpStatus: 502 } },
    'no-answer': { on: 'netease', step: 'check', detail: { case: 'no-answer' } },
    refused: { on: 'netease', step: 'check', detail: { code: '8821', message: '当前登录存在安全风险，请稍后再试' } },
    'retry-later': { on: 'qq', step: 'check', detail: { case: 'retry-later', code: '800', message: 'QR login failed', upstreamCode: '50006', retryAfterMs: 31_000 } },
    'device-limit': { on: 'qq', step: 'check', detail: { case: 'device-limit', code: '20279' } },
    'wrong-scan-app': { on: 'qq', step: 'check', detail: { case: 'wrong-scan-app', code: '800', upstreamCode: '1000', message: 'QR login failed' } },
    'local-service-stopped': { on: 'netease', step: 'start', detail: { case: 'local-service-stopped' } },
    'local-service-unavailable': { on: 'qq', step: 'start', detail: { case: 'local-service-unavailable' } },
    'cannot-listen': { on: 'spotify', step: 'start', detail: { case: 'cannot-listen', mainCode: 'cannot-listen' } },
    'no-browser': { on: 'ytm', step: 'start', detail: { case: 'no-browser', mainCode: 'no-browser' } },
    'browser-still-open': { on: 'ytm', step: 'start', detail: { case: 'browser-still-open', mainCode: 'folder-in-use' } },
    'browser-closed-early': { on: 'ytm', step: 'check', detail: { case: 'browser-closed-early', mainCode: 'exited' } },
    'browser-unread': { on: 'ytm', step: 'check', detail: { case: 'browser-unread', mainCode: 'timeout' } },
    'browser-not-opened': { on: 'spotify', step: 'open' },
    'account-not-read': { on: 'netease', step: 'account', scanned: true },
    unknown: { on: 'kugou', step: 'check' },
};

const failureOf = (id: LoginCaseId): LoginFailure => {
    const sample = CASES[id];
    const inBrowser = sample.on === 'spotify' || sample.on === 'ytm';
    const facts = loginFailureFacts({ step: sample.step, inBrowser, scanned: Boolean(sample.scanned) }, { detail: sample.detail });
    // The countdown starts when the probe is mounted.
    return { case: loginCaseOf(facts), facts, at: Date.now() };
};

type Shown = Pick<LoginScreenProps, 'chosen' | 'login'>;
const chosen = (providerId: string, lead: RowLead) => ({ providerId, lead });
const IN_BROWSER = new Set(['spotify', 'ytm']);
// The local service of the platform that has one, as the desktop app reports it: down for its case.
const SERVICE_UP = { available: true, failed: false, error: null, restarting: false };
const SERVICE_DOWN = { available: true, failed: true, error: 'xeapi public key could not be resolved', restarting: false };

/** A sign-in of `providerId` as the account controller's snapshot has it, at the given point. */
const sessionOf = (providerId: string, patch: Partial<LibraryLoginSessionSnapshot> = {}): LibraryLoginSessionSnapshot => ({
    id: 1,
    providerId,
    phase: 'loading',
    methods: providerId === 'qq' ? QQ_METHODS : [],
    selectedMethodId: null,
    inBrowser: IN_BROWSER.has(providerId),
    codeImage: '',
    canReopenLoginPage: providerId === 'spotify',
    failure: null,
    selfCheck: null,
    localService: providerId === 'netease' ? SERVICE_UP : { available: false, failed: false, error: null, restarting: false },
    texts: null,
    ...patch,
});

const shownFor = (state: string): Shown => {
    if (state.startsWith('fail-')) {
        const id = state.slice(5) as LoginCaseId;
        const sample = CASES[id];
        const failure = failureOf(id);
        const waiting = id === 'browser-not-opened';
        return {
            chosen: chosen(sample.on, 'sign-in'),
            login: sessionOf(sample.on, {
                phase: waiting ? 'waiting' : sample.step === 'wait' ? 'expired' : 'error',
                selectedMethodId: sample.on === 'qq' ? 'qq' : null,
                failure,
                codeImage: sample.step === 'wait' && !failure.facts.inBrowser ? CODE : '',
                localService: id === 'local-service-stopped' ? SERVICE_DOWN : sessionOf(sample.on).localService,
            }),
        };
    }
    switch (state) {
        case 'preparing': return { chosen: chosen('netease', 'sign-in'), login: sessionOf('netease') };
        case 'code': return { chosen: chosen('netease', 'sign-in'), login: sessionOf('netease', { phase: 'waiting', codeImage: CODE }) };
        case 'scanned': return { chosen: chosen('netease', 'sign-in'), login: sessionOf('netease', { phase: 'scanned', codeImage: CODE }) };
        case 'reading': return { chosen: chosen('netease', 'sign-in'), login: sessionOf('netease', { phase: 'confirmed', codeImage: CODE }) };
        case 'expired': return shownFor('fail-code-expired');
        case 'methods': return { chosen: chosen('qq', 'sign-in'), login: sessionOf('qq', { phase: 'choosing-method' }) };
        case 'methods-code': return { chosen: chosen('qq', 'sign-in'), login: sessionOf('qq', { phase: 'waiting', selectedMethodId: 'wechat', codeImage: CODE }) };
        case 'browser-ready': return { chosen: chosen('spotify', 'sign-in'), login: sessionOf('spotify', { phase: 'ready' }) };
        case 'browser-opening': return { chosen: chosen('ytm', 'sign-in'), login: sessionOf('ytm') };
        case 'browser': return { chosen: chosen('spotify', 'sign-in'), login: sessionOf('spotify', { phase: 'waiting' }) };
        case 'account': return { chosen: chosen('qq', 'account'), login: null };
        case 'account-nameless': return { chosen: chosen('spotify', 'account'), login: null };
        case 'account-gone': return { chosen: chosen('kugou', 'account'), login: null };
        case 'accountless': return { chosen: chosen('stand-in-5', 'accountless'), login: null };
        default: return { chosen: null, login: null };
    }
};

function LoginWindowProbe(props: ProbeProps) {
    const query = new URLSearchParams(window.location.search);
    const state = props.state ?? query.get('state') ?? 'none';
    const theme = props.theme ?? (query.get('theme') === 'light' ? 'light' : 'dark');
    const count = props.count ?? Number(query.get('count') ?? 6);
    const lang = props.lang ?? (query.get('lang') === 'en' ? 'en' : 'zh');
    const { i18n } = useTranslation();
    const [isOpen, setIsOpen] = useState(true);
    const [said, setSaid] = useState('');
    const [shown, setShown] = useState(() => shownFor(state));
    useEffect(() => setShown(shownFor(state)), [state]);
    useEffect(() => { void i18n.changeLanguage(lang === 'en' ? 'en' : 'zh-CN'); }, [i18n, lang]);

    // The played sign-in: how far it has got (0 waiting, 1 scanned, 2 confirmed, 3 the account is read),
    // and whether the animation after it is on. What LoginHost does in the app is done here by hand.
    const motionOff = (props.motion ?? query.get('motion')) === 'off';
    const played = state === 'play' || state === 'play-web' ? (state === 'play-web' ? 'spotify' : 'netease') : null;
    const [step, setStep] = useState(0);
    const [done, setDone] = useState(false);
    useLayoutEffect(() => {
        useMotionSettingsStore.setState(current => ({ reducedMotionSurfaces: { ...current.reducedMotionSurfaces, uiMicroMotion: motionOff } }));
    }, [motionOff]);
    // Each run starts the sign-in over. The first run starts by itself; `window.__playLoginProbe()` starts
    // another (a script that takes pictures stops the clock first, then calls it).
    const [run, setRun] = useState(1);
    useEffect(() => {
        (window as unknown as { __playLoginProbe?: () => void }).__playLoginProbe = () => setRun(current => current + 1);
    }, []);
    useEffect(() => {
        if (!played) return undefined;
        setStep(0);
        setDone(false);
        setIsOpen(true);
        const timers = [
            ...(played === 'netease' ? [window.setTimeout(() => setStep(1), PLAY.scanned)] : []),
            window.setTimeout(() => setStep(2), PLAY.confirmed),
            window.setTimeout(() => {
                setStep(3);
                if (motionOff) setIsOpen(false);
                else setDone(true);
            }, PLAY.read),
        ];
        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [played, motionOff, run]);
    const landing = loginDoneLanding({ open: isOpen, still: motionOff, confirmed: step >= 2, done, providerId: played });
    useEffect(() => {
        setLoginLanding(landing);
        return () => setLoginLanding(null);
    }, [landing]);
    const isDaylight = theme === 'light';
    // 'account-other': the account of a platform that is not the one in use, so the switch button shows.
    const activeProviderId = state === 'account' ? 'qq' : 'netease';
    // 'account-nameless': a platform that says somebody is signed in and hands over no profile.
    // A played sign-in: its platform is signed in from the moment the account is read.
    const platforms = state === 'account-nameless'
        ? PLATFORMS.map(entry => (entry.providerId === 'spotify' ? { ...entry, status: 'authenticated' as const } : entry))
        : played && step === 3
            ? PLATFORMS.map(entry => (entry.providerId === played ? { ...entry, status: 'authenticated' as const, user: SAMPLE_USER } : entry))
            : PLATFORMS;
    const rows = orderRows([...platforms, ...STAND_INS.slice(0, Math.max(0, count - platforms.length))], played ?? activeProviderId);
    const view: Shown = played
        ? {
            chosen: chosen(played, 'sign-in'),
            login: sessionOf(played, { phase: step === 0 ? 'waiting' : step === 1 ? 'scanned' : 'confirmed', codeImage: played === 'netease' ? CODE : '' }),
        }
        : state === 'account-other' ? shownFor('account') : shown;
    const pillAccount = probeAccountController(rows, step === 3 ? played ?? 'netease' : query.get('active') ?? played ?? 'netease');

    return (
        <SettingsKitThemeContext.Provider value={{ isDaylight }}>
            <div
                className={`relative flex min-h-screen flex-col gap-2 p-4 text-sm ${isDaylight ? 'bg-zinc-200' : 'bg-zinc-950'}`}
                style={{ '--text-primary': isDaylight ? '#18181b' : '#f4f4f5', color: 'var(--text-primary)' } as React.CSSProperties}
            >
                <button type="button" className="self-start underline" onClick={() => setIsOpen(true)}>Open the window</button>
                <output data-testid="said">{said}</output>
                <LoginScreen
                    isOpen={isOpen}
                    // As LoginHost does: closing once the account is read is a skip, the animation ends with it.
                    onClose={() => { setDone(false); setIsOpen(false); setSaid('closed'); }}
                    rows={rows}
                    activeProviderId={activeProviderId}
                    chosen={view.chosen}
                    login={view.login}
                    buildReport={async () => '### Folia QR login diagnostics (a sample made by the probe)'}
                    onChoose={providerId => {
                        setSaid(`chosen ${providerId}`);
                        const picked = rows.find(entry => entry.providerId === providerId);
                        const lead: RowLead = picked?.status === 'authenticated' ? 'account' : picked?.requiresAccount === false ? 'accountless' : 'sign-in';
                        setShown({
                            chosen: { providerId, lead },
                            login: lead !== 'sign-in' ? null : sessionOf(providerId, providerId === 'qq'
                                ? { phase: 'choosing-method' }
                                : IN_BROWSER.has(providerId) ? { phase: 'ready' } : { phase: 'waiting', codeImage: CODE }),
                        });
                    }}
                    onStart={() => {
                        setSaid('start');
                        setShown(current => ({
                            ...current,
                            login: current.login && { ...current.login, phase: 'waiting', failure: null, codeImage: current.login.inBrowser ? '' : CODE },
                        }));
                    }}
                    onSelectMethod={methodId => {
                        setSaid(`start ${methodId}`);
                        setShown(current => ({
                            ...current,
                            login: current.login && { ...current.login, phase: 'waiting', selectedMethodId: methodId, failure: null, codeImage: CODE },
                        }));
                    }}
                    onReopenBrowser={() => setSaid('reopen the browser')}
                    onRestartService={() => setSaid('restart the local service')}
                    onSwitch={() => setSaid('switch')}
                    onSignOut={() => setSaid('sign out')}
                    // origin=pill: as if the window was opened from the switcher pill at the bottom right.
                    origin={query.get('origin') === 'pill' && view.chosen
                        ? { x: window.innerWidth - 44, y: window.innerHeight - 44, size: 40, providerId: view.chosen.providerId }
                        : null}
                    done={done}
                    onDoneLeave={() => { setIsOpen(false); setSaid('the window left'); }}
                    onDoneEnd={() => { setDone(false); setSaid('the animation ended'); }}
                />
                {/* Where the picture lands after a played sign-in. active=<id>: the platform in use is another one until the account is read. */}
                {played && <SwitcherPill account={pillAccount} onBackToPlayer={() => { }} />}
            </div>
        </SettingsKitThemeContext.Provider>
    );
}

export default {
    id: 'loginWindow', title: '登录窗口',
    description: '任何一种样子和 18 种失败；状态是探针造的，不登录、不发请求。',
    Component: LoginWindowProbe,
} satisfies ProbeDefinition;
