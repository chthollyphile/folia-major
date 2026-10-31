import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LibraryLoginSessionSnapshot } from '../../../library/core/account/account.contract';
import { resolveLoginSessionReportRoute, translateLoginSelfCheck } from '../../../library/core/account/useLibraryAccount';
import { LOGIN_REPORT_ELSEWHERE_COPY, retryOpensAt } from '../../../library/core/account/accountRules';
import type { LoginFailure } from '../../../types/loginFailure';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import { useKitReducedMotion } from '../../modal/settings/kit/motion';
import { Unfold } from '../../modal/settings/kit/Reveal';
import { LoginDoneFlight, LoginDoneFlood, LoginDoneTile, loginDoneColours, useLoginDone } from '../done/LoginDone';
import { loginDonePlaying } from '../done/loginDoneFrame';
import { loginMethodIcon } from '../loginMethodIcons';
import type { LoginOrigin } from '../loginWindowStore';
import { rowStatus } from '../platformRows';
import { LOGIN_CASE_TEXTS } from './loginCaseTexts';
import LoginMessage, { LoginDetails, type MessageAction } from './LoginMessage';
import LoginTile from './LoginTile';
import { accountView, failureNoteKey, failureQuote, loginScene, sceneHeadline, stepMarks, type RowLead } from './loginView';
import FormLogin from './FormLogin';
import LoginWindow from './LoginWindow';
import PlatformColumn from './PlatformColumn';

// src/components/login/window/LoginScreen.tsx
// 登录窗口此刻画什么：从「选中了哪一行、登录走到哪一步、失败是哪一种情况」定出那一块画、标题、
// 那一行话、平台的原话和操作，交给各个部件去画。它不发请求，也不拿状态：状态是账户 controller 的登录会话，
// 和处理一起由 LoginHost 给；哪一句、引谁的话这些规则在 loginView.ts。

export type LoginScreenProps = {
    isOpen: boolean;
    onClose: () => void;
    /** 排好顺序的平台。 */
    rows: ProviderAccountSummary[];
    /** 正在用的平台：选中的不是它，账号那一幅才有「切换至」。 */
    activeProviderId: OnlineProviderId | null;
    /** 选中的那一行，和它通向什么。 */
    chosen: { providerId: OnlineProviderId; lead: RowLead } | null;
    /** 选中的这一行的登录（账户 controller 快照里的登录会话）；不在登录、或者还没开始时为 null。 */
    login: LibraryLoginSessionSnapshot | null;
    onChoose: (providerId: OnlineProviderId) => void;
    /** 开始（浏览器登录的那一下），或者重来，保留选过的登录方式。 */
    onStart: () => void;
    /** 表单式登录提交成功：登录已完成，直接刷新状态并关闭窗口。 */
    onFormLoggedIn: () => void;
    /** 用这种登录方式开始（任何时候都可以换）。 */
    onSelectMethod: (methodId: string) => void;
    onReopenBrowser: () => void;
    /** 重启登录要靠的本地服务，起来之后把登录重新开始。 */
    onRestartService: () => void;
    onSwitch: () => void;
    onSignOut: () => void;
    /** 这一次登录的诊断报告（生成不了是空串）。 */
    buildReport: () => Promise<string>;
    /** 按下去打开窗口的那个东西在哪：窗口从那一边出来。 */
    origin?: LoginOrigin | null;
    /** 账号读到了，登录成功的动画正在放。动效关着的时候它不会是 true。 */
    done?: boolean;
    /** 动画说窗口该走了。 */
    onDoneLeave?: () => void;
    /** 动画放完了。 */
    onDoneEnd?: () => void;
};

const nothing = () => { };

/** 到了 `at` 这个时刻没有（毫秒时间戳）；没到就在那一刻再画一次。 */
const useReached = (at: number): boolean => {
    const [tick, setTick] = useState(0);
    const reached = Date.now() >= at;
    useEffect(() => {
        if (reached) return undefined;
        // 计时器早到了一点也不要紧：tick 变了，再等剩下的那一点。
        const timer = window.setTimeout(() => setTick(count => count + 1), at - Date.now());
        return () => window.clearTimeout(timer);
    }, [at, reached, tick]);
    return reached;
};

export const LoginScreen: React.FC<LoginScreenProps> = ({
    isOpen, onClose, rows, activeProviderId, chosen, login, onChoose, onStart, onFormLoggedIn, onSelectMethod, onReopenBrowser, onRestartService, onSwitch, onSignOut,
    buildReport, origin, done = false, onDoneLeave = nothing, onDoneEnd = nothing,
}) => {
    const { t } = useTranslation();
    const still = useKitReducedMotion();
    const providerId = chosen?.providerId ?? null;
    const summary = rows.find(row => row.providerId === providerId) ?? null;
    const label = summary?.shortName || summary?.displayName || providerId || '';
    const inBrowser = login?.inBrowser ?? false;
    const service = login?.localService ?? null;
    const failure: LoginFailure | null = providerId ? login?.failure ?? null : null;
    const scene = loginScene({ lead: chosen?.lead ?? null, phase: login?.phase ?? null, inBrowser, failed: Boolean(failure), providerId });
    const texts = login?.texts ?? null;
    const retry = onStart;
    const retryLabel = t(inBrowser ? 'home.loginBrowserRetry' : 'home.retryQr');
    const switchAction: MessageAction[] = providerId && providerId !== activeProviderId
        ? [{ label: t('home.switchToProvider', { provider: label }), primary: true, onClick: onSwitch }]
        : [];

    let headline: string;
    let note: string | undefined;
    let quote: { who: string; text: string; code?: string } | undefined;
    let actions: MessageAction[] = [];
    let details: React.ReactNode;
    let waitFor: LoginFailure | null = null;
    if (scene === 'failed' && failure && providerId) {
        const noteKey = failureNoteKey(failure, texts?.caseNotes);
        headline = t(LOGIN_CASE_TEXTS[failure.case.id].title, { provider: label });
        note = noteKey ? t(noteKey) : undefined;
        const said = failureQuote(failure, service?.error ?? null);
        if (said) quote = { who: label, ...said };
        if (failure.case.action === 'reopen-browser') {
            actions = [{ label: t('home.loginBrowserOpen'), primary: true, onClick: onReopenBrowser }];
        } else if (failure.case.action === 'restart-service' && service?.available) {
            actions = [{
                label: t(service.restarting ? 'home.restartingBackend' : 'home.restartBackend'),
                primary: true,
                busy: service.restarting,
                onClick: onRestartService,
            }];
        } else {
            actions = [{ label: retryLabel, primary: true, onClick: retry }];
            if (failure.case.action === 'wait-then-retry') waitFor = failure;
        }
        if (failure.case.details && login) {
            const route = resolveLoginSessionReportRoute(login);
            details = (
                <LoginDetails
                    providerId={providerId}
                    providerLabel={label}
                    failure={failure}
                    selfCheck={translateLoginSelfCheck(t, login.selfCheck, label)}
                    reportElsewhere={route === 'github' ? null : t(LOGIN_REPORT_ELSEWHERE_COPY[route].key)}
                    buildReport={buildReport}
                />
            );
        }
    } else if (scene === 'account' && providerId) {
        const view = accountView(summary ? rowStatus(summary) : null, Boolean(summary?.user));
        headline = summary?.user?.nickname ?? label;
        if (view === 'gone') {
            // 这一幅开着的时候登录没有了：说一句，留一个重新登录（再选一次这一行）。
            if (summary && rowStatus(summary) === 'ran-out') note = t('status.loginExpired');
            if (summary) actions = [{ label: t('home.loginBrowserRetry'), primary: true, onClick: () => onChoose(providerId) }];
        } else {
            if (summary?.user) note = `${label} · ID: ${String(summary.user.id)}`;
            actions = [...switchAction, { label: t('account.logout'), onClick: onSignOut }];
        }
    } else if (scene === 'accountless') {
        headline = label;
        note = t('home.providerNoAccount');
        actions = switchAction;
    } else {
        const key = sceneHeadline(scene, inBrowser);
        // 'title'：平台自己的登录标题；没有声明的平台是「登录到 平台名」。
        headline = key.includes('.') ? t(key) : texts ? t(texts.title) : t('home.loginToProvider', { provider: label });
        if (texts && scene !== 'none' && scene !== 'scanned' && scene !== 'reading') note = t(texts.note);
        if (scene === 'form' && texts) {
            // 表单式登录：窗口标题条已经说了「登录到 平台名」，这里用平台的说明当标题，不再重复「登录…」。
            headline = t(texts.note);
            note = undefined;
        }
        if (scene === 'browser-ready') actions = [{ label: t('login.openBrowser'), primary: true, onClick: onStart }];
        if (scene === 'browser' && login?.canReopenLoginPage) actions = [{ label: t('home.loginBrowserOpen'), onClick: onReopenBrowser }];
    }

    // 登录成功的动画：扫码之后那一块画由它画，读到账号之后它铺满窗口，再让窗口走（done/）。动效关着就没有；
    // 窗口关了、或者被跳过了，它当场停（规则在 loginDonePlaying）。
    const playing = providerId !== null && loginDonePlaying({ open: isOpen, still, scene, done });
    const doneParts = useLoginDone({
        playing,
        providerId,
        scanned: login?.phase === 'scanned',
        confirmed: login?.phase === 'confirmed',
        read: done,
        onLeave: onDoneLeave,
        onEnd: onDoneEnd,
    });
    const colours = useMemo(() => (providerId ? loginDoneColours(providerId, label) : null), [providerId, label]);
    const shownDone = done && !still && providerId !== null;

    const expiredCode = failure && (failure.case.id === 'code-expired' || failure.case.id === 'expired-after-scan');
    // 二维码那一块上的刷新，和消息里的按钮一样等到可以重来的时刻才给。
    const retryOpen = useReached(failure ? retryOpensAt(failure) : 0);
    // 换了样子，详情就合上。
    const sceneKey = `${providerId}:${scene}:${failure?.case.id ?? ''}:${failure?.at ?? ''}`;
    const [detailsOpen, setDetailsOpen] = useState(false);
    useEffect(() => setDetailsOpen(false), [sceneKey]);

    return (
        <>
        <LoginWindow
            isOpen={isOpen}
            onClose={onClose}
            title={providerId ? t('home.loginToProvider', { provider: label }) : t('login.title')}
            closeTip={t('home.closeLogin')}
            providerId={providerId}
            providerLabel={label}
            rings={scene === 'code' || scene === 'browser'}
            origin={origin}
            quiet={shownDone}
            leavesThrough={shownDone}
            // 那一面颜色的框一直在（动画要量窗口有多大），读到账号才有内容。
            overlay={still || !providerId || !colours ? undefined : narrow => (
                <LoginDoneFlood
                    parts={doneParts}
                    providerId={providerId}
                    label={label}
                    user={summary?.user ?? null}
                    surface={colours.surface}
                    tickColour={colours.tick}
                    shown={shownDone}
                    title={t('home.loginSuccess')}
                    left={narrow ? 24 : 292}
                />
            )}
            column={lie => <PlatformColumn rows={rows} chosenId={providerId} onChoose={row => onChoose(row.providerId)} lie={lie} />}
            tile={(
                <LoginTile
                    tileRef={element => { doneParts.current.tile = element; }}
                    doneLayer={playing && colours ? (source, onPaper) => (
                        <LoginDoneTile parts={doneParts} surface={colours.surface} source={source} onPaper={onPaper} />
                    ) : undefined}
                    scene={scene}
                    providerId={providerId}
                    label={label}
                    inBrowser={inBrowser}
                    codeImage={login?.codeImage ?? ''}
                    user={summary?.user ?? null}
                    failedKind={failure?.case.kind ?? null}
                    onRefreshCode={expiredCode && retryOpen ? retry : undefined}
                    refreshLabel={retryLabel}
                    pendingText={t('home.loginMethodPending')}
                />
            )}
            message={scene === 'form' && providerId
                ? <FormLogin providerId={providerId} onLoggedIn={onFormLoggedIn} />
                : (
                    <LoginMessage
                        sceneKey={sceneKey}
                        headline={headline}
                        note={note}
                        quote={quote}
                        methods={login && login.methods.length > 0 && chosen?.lead === 'sign-in' ? {
                            options: login.methods.map(method => ({ value: method.id, label: t(method.labelKey), icon: loginMethodIcon(method.iconKey) })),
                            value: login.selectedMethodId,
                            onChange: onSelectMethod,
                        } : undefined}
                        actions={actions}
                        waitFor={waitFor}
                        details={details ? { open: detailsOpen, onToggle: () => setDetailsOpen(open => !open) } : undefined}
                        steps={stepMarks(scene, inBrowser)}
                    />
                )}
            below={details ? <Unfold open={detailsOpen}>{details}</Unfold> : undefined}
        />
        {shownDone && providerId && <LoginDoneFlight parts={doneParts} providerId={providerId} label={label} user={summary?.user ?? null} />}
        </>
    );
};

export default LoginScreen;
