import React, { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { LibraryAccountController, LibraryAccountSnapshot, LibraryLoginSessionSnapshot } from '../../library/core/account/account.contract';
import {
    useLibraryAccountLogin,
    useLibraryAccountProviders,
    useLibraryAccountSelector,
} from '../../library/core/account/useLibraryAccount';
import { useKitReducedMotion } from '../modal/settings/kit/motion';
import { loginDoneLanding, loginDonePlays } from './done/loginDoneFrame';
import { createLoginHostState } from './loginHostState';
import { closeLoginWindow, loginHostMounted, setLoginLanding, useLoginWindowStore } from './loginWindowStore';
import { orderRows } from './platformRows';
import LoginScreen from './window/LoginScreen';

// src/components/login/LoginHost.tsx
// 登录窗口：App 最外层挂一个（换 suite、离开首页都不卸载），由 loginWindowStore 的 openLoginWindow 打开。它把三样东西接在一起：
// 账户 controller（平台那一列、登录会话、切换、退出、本地服务重启都经它），窗口背后的决定（loginHostState.ts：
// 选中哪一行、它通向什么、晚到的回答作不作数），和窗口的开关。画什么由 window/LoginScreen 决定。
// 这里不调 omni，不读账户 store：数据和动作都来自 controller。

type LoginHostProps = {
    account: LibraryAccountController;
};

const selectCompletion = (snapshot: LibraryAccountSnapshot) => snapshot.lastLoginCompletion;

const LoginHost: React.FC<LoginHostProps> = ({ account }) => {
    const requestId = useLoginWindowStore(state => state.requestId);
    const isOpen = useLoginWindowStore(state => state.isOpen);
    const origin = useLoginWindowStore(state => state.origin);
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const rows = useMemo(() => orderRows(providers, activeProviderId), [providers, activeProviderId]);
    const login = useLibraryAccountLogin(account);
    const completion = useLibraryAccountSelector(account, selectCompletion);
    const reducedMotion = useKitReducedMotion();

    // host 每次去问都拿到这一次渲染的东西。
    const live = useRef({ account, providers, reducedMotion });
    live.current = { account, providers, reducedMotion };
    const host = useMemo(() => createLoginHostState({
        rows: () => live.current.providers,
        login: () => live.current.account.getSnapshot().login,
        startLogin: providerId => { void live.current.account.startLogin(providerId); },
        closeLogin: () => { live.current.account.closeLogin(); },
        closeWindow: closeLoginWindow,
        playsDone: () => loginDonePlays(live.current.reducedMotion),
        switchTo: providerId => live.current.account.requestSwitch(providerId).then(result => result.status === 'switched'),
        // 在确认框里点了取消、或者没退成，窗口留着。
        signOut: providerId => live.current.account.logout(providerId).then(result => result.status === 'logged-out'),
    }), []);
    const { chosen, done } = useSyncExternalStore(host.subscribe, host.getState);
    const providerId = chosen?.providerId ?? null;

    // 跟着窗口的开关走：每打开一次从头来；关了（不管是谁关的）就停下正在进行的登录。
    useEffect(() => {
        if (isOpen) host.opened(useLoginWindowStore.getState().providerId);
        else host.closed();
    }, [requestId, isOpen, host]);

    // host 卸下时这一轮结束，窗口的开关也关（什么时候算真的卸下见 loginHostMounted）。
    useEffect(() => {
        const unmounted = loginHostMounted();
        return () => {
            host.closed();
            unmounted();
        };
    }, [host]);

    useEffect(() => host.loginChanged(), [login, host]);
    useEffect(() => host.rowsChanged(), [providers, host]);
    // 只认挂上之后才报的结局：挂上之前的那一声是别的窗口的。
    const seenCompletion = useRef(completion);
    useEffect(() => {
        if (completion === seenCompletion.current) return;
        seenCompletion.current = completion;
        if (completion) host.completed(completion);
    }, [completion, host]);

    // 动画放着的时候动效被关掉：由 host 结束它（live 里已经是这一次渲染的开关）。
    useEffect(() => host.motionChanged(), [reducedMotion, host]);

    // 画的是选中的这一行的登录。登录确认、账号读到之后 controller 收起了登录，窗口淡出和放动画的时候还画最后那一幅；
    // 换了一行就不再画它。
    const held = useRef<LibraryLoginSessionSnapshot | null>(null);
    if (login && login.providerId === providerId) held.current = login;
    else if (held.current && held.current.providerId !== providerId) held.current = null;
    const shownLogin = chosen?.lead === 'sign-in' ? held.current : null;

    // 头像要从窗口飞向切换器：告诉切换器是哪个平台的（规则在 loginDoneLanding）。切换器画的是这个平台时
    // 先不画自己的那一个，名字也等头像落下再展开；画的是别的平台就什么都不变。
    const landing = loginDoneLanding({ open: isOpen, still: reducedMotion, confirmed: shownLogin?.phase === 'confirmed', done, providerId });
    useEffect(() => {
        setLoginLanding(landing);
        return () => setLoginLanding(null);
    }, [landing]);

    return (
        <LoginScreen
            isOpen={isOpen}
            // 读到账号之后关窗是跳过动画：直接到结束，已经登录了。
            onClose={() => {
                host.doneEnded();
                closeLoginWindow();
            }}
            origin={origin}
            done={done}
            onDoneLeave={closeLoginWindow}
            onDoneEnd={host.doneEnded}
            rows={rows}
            activeProviderId={activeProviderId}
            chosen={chosen}
            login={shownLogin}
            onChoose={host.choose}
            onStart={() => void account.retryLogin()}
            onSelectMethod={methodId => void account.selectLoginMethod(methodId)}
            onReopenBrowser={() => void account.openLoginPage()}
            onRestartService={() => void account.restartLocalService()}
            onSwitch={host.switchToChosen}
            onSignOut={host.signOutChosen}
            buildReport={async () => {
                const result = await account.buildLoginDiagnosticReport();
                return result.status === 'ok' ? result.report : '';
            }}
        />
    );
};

export default LoginHost;
