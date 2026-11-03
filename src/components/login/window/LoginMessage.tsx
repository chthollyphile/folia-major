import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppWindow, ChevronDown, ExternalLink, Loader2, QrCode, Smartphone, User, type LucideIcon } from 'lucide-react';
import type { LoginFailure } from '../../../types/loginFailure';
import { buildLoginIssueUrl } from '../../../services/onlineMusic/login/loginDiagnosticReport';
import type { OnlineProviderId } from '../../../types/onlineMusic';
import { Button, CopyButton, Segmented } from '../../modal/settings/kit';
import { openOutsideLink } from '../../../utils/system/outsideLink';
import { copyText } from '../../../utils/system/clipboard';
import { useKitReducedMotion } from '../../modal/settings/kit/motion';
import type { LibraryLoginSelfCheckView } from '../../../library/core/account/useLibraryAccount';
import { retryWaitEndsAt, secondsLeft } from '../../../library/core/account/accountRules';
import { LOGIN_KIND_TEXTS, loginStepText } from './loginCaseTexts';
import type { StepMark } from './loginView';

// src/components/login/window/LoginMessage.tsx
// 那一块画的右边：一句标题说现在怎么了，一行说要做的那一件事，平台说了话就把它的原话放在一个安静的
// 框里，下面是这一种样子的操作。失败时多一个「详情」，展开是事实、两个按钮和隐私的那一句。
// 右下角是步骤标记。

export type MessageAction = {
    label: string;
    onClick: () => void;
    primary?: boolean;
    busy?: boolean;
};

type LoginMessageProps = {
    /** 换了样子就换一个值：标题和那一行据此重新出现一次。 */
    sceneKey: string;
    headline: string;
    note?: string;
    /** 平台或者本地服务自己的话。 */
    quote?: { who: string; text: string; code?: string };
    /** 登录方式：一个分段的选择，选了之后还留着，可以再换。 */
    methods?: { options: Array<{ value: string; label: string; icon: string }>; value: string | null; onChange: (id: string) => void };
    actions: MessageAction[];
    /** 「稍后再试」：按钮先倒数到这一种失败等完的时刻，再变成第一个操作。 */
    waitFor?: LoginFailure | null;
    /** 有「详情」可以展开：它开没开，和点它时做什么。展开的内容由窗口画在下面。 */
    details?: { open: boolean; onToggle: () => void };
    steps?: { marks: StepMark[]; current: number } | null;
};

const STEP_ICON: Record<StepMark, LucideIcon> = { code: QrCode, browser: AppWindow, phone: Smartphone, account: User };

const StepMarks: React.FC<{ marks: StepMark[]; current: number }> = ({ marks, current }) => (
    <div aria-hidden className="login-fade ml-auto flex shrink-0 items-center self-end">
        {marks.map((mark, index) => {
            const Icon = STEP_ICON[mark];
            const done = index < current;
            return (
                <React.Fragment key={mark}>
                    {index > 0 && (
                        <span className="relative h-[1.5px] w-[26px] bg-[var(--st-line2)]">
                            <span
                                className="st-t-unfold absolute inset-0 origin-left bg-[var(--login-pc)] transition-transform"
                                style={{ transform: index <= current ? 'none' : 'scaleX(0)' }}
                            />
                        </span>
                    )}
                    <span
                        className={`st-t-move relative grid h-[26px] w-[26px] place-items-center rounded-full transition-colors ${index === current ? 'login-step-current text-[color:var(--st-t1)]' : done ? '' : 'text-[color:var(--st-t3)]'}`}
                        style={done
                            ? { background: 'var(--login-pc)', color: 'var(--login-on-pc)' }
                            : { boxShadow: `inset 0 0 0 1.5px ${index === current ? 'var(--login-pc)' : 'var(--st-line2)'}` }}
                    >
                        <Icon size={13} />
                    </span>
                </React.Fragment>
            );
        })}
    </div>
);

/** 先倒数、数完变成那个操作的按钮；每过一秒它的底色往前长一格。 */
const WaitButton: React.FC<{ failure: LoginFailure; action: MessageAction }> = ({ failure, action }) => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const endsAt = retryWaitEndsAt(failure);
    const [now, setNow] = useState(() => Date.now());
    const left = secondsLeft(endsAt, now);
    useEffect(() => {
        if (left === 0) return undefined;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [left === 0, endsAt]);

    if (left === 0) return <Button variant="primary" onClick={action.onClick}>{action.label}</Button>;
    const total = Math.max(1, Math.ceil((endsAt - failure.at) / 1000));
    return (
        <span className="relative inline-flex h-8 shrink-0 cursor-not-allowed items-center overflow-hidden rounded-lg bg-[var(--st-fill)] px-3 text-[13px] text-[color:var(--st-t2)]" aria-disabled>
            <span
                aria-hidden
                // 动效关着的时候它一秒跳一格，不滑。
                className={`absolute inset-y-0 left-0 bg-[var(--st-fill2)] ${reduced ? '' : 'transition-[width] duration-1000 ease-linear'}`}
                style={{ width: `${Math.min(100, ((total - left + 1) / total) * 100)}%` }}
            />
            <span className="relative tabular-nums">{t('login.retryIn', { seconds: left })}</span>
        </span>
    );
};

export const LoginMessage: React.FC<LoginMessageProps> = ({ sceneKey, headline, note, quote, methods, actions, waitFor, details, steps }) => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const [first, ...rest] = actions;

    return (
        <div className="flex min-h-[200px] min-w-0 flex-1 flex-col">
            {methods && (
                <div className="mb-4 self-start">
                    <Segmented
                        value={methods.value ?? ''}
                        options={methods.options.map(option => ({
                            value: option.value,
                            label: option.label,
                            icon: option.icon ? <img src={option.icon} alt="" draggable={false} className="h-4 w-4" /> : undefined,
                        }))}
                        onChange={methods.onChange}
                    />
                </div>
            )}
            <div key={sceneKey} className="login-in min-w-0 flex-1">
                <h3 className="text-xl font-semibold leading-7 [overflow-wrap:anywhere] [text-wrap:balance]">{headline}</h3>
                {note && <p className="mt-1.5 whitespace-pre-line text-[13px] leading-5 text-[color:var(--st-t2)]">{note}</p>}
                {quote && (
                    <div className="mt-3 flex select-text items-baseline gap-2 rounded-lg bg-[var(--st-fill)] px-2.5 py-2 text-xs leading-[18px] text-[color:var(--st-t2)]">
                        <b className="shrink-0 font-semibold text-[color:var(--st-t1)]">{quote.who}</b>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{quote.text}</span>
                        {quote.code && <code className="shrink-0 font-mono text-[color:var(--st-t3)]">{quote.code}</code>}
                    </div>
                )}
            </div>
            <div className="mt-4 flex min-h-8 flex-wrap items-center gap-2">
                {first && (waitFor
                    ? <WaitButton key={waitFor.at} failure={waitFor} action={first} />
                    : (
                        <Button variant={first.primary ? 'primary' : undefined} onClick={first.onClick} disabled={first.busy}>
                            {first.busy && <Loader2 size={14} className={reduced ? undefined : 'animate-spin'} />}
                            {first.label}
                        </Button>
                    ))}
                {rest.map(action => (
                    <Button key={action.label} variant={action.primary ? 'primary' : undefined} onClick={action.onClick} disabled={action.busy}>{action.label}</Button>
                ))}
                {details && (
                    <button
                        type="button"
                        aria-expanded={details.open}
                        onClick={details.onToggle}
                        className="st-t-fast inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]"
                    >
                        {t('login.details')}
                        <ChevronDown size={14} className={`st-t-move transition-transform ${details.open ? 'rotate-180' : ''}`} />
                    </button>
                )}
                {steps && <StepMarks marks={steps.marks} current={steps.current} />}
            </div>
        </div>
    );
};

type LoginDetailsProps = {
    providerId: OnlineProviderId;
    providerLabel: string;
    failure: LoginFailure;
    /** 失败后自检的结论（已翻译）；没有跑是 null。 */
    selfCheck: LibraryLoginSelfCheckView | null;
    /** 诊断不该反馈到本仓库时（网页版的部署问题、非官方构建）该找谁的那一句；它在时不给去 GitHub 反馈的按钮。 */
    reportElsewhere: string | null;
    buildReport: () => Promise<string>;
};

/** 自检的那一段：还在检查、自检本身出了错，或者结论和代理的提示。 */
const SelfCheckNote: React.FC<{ view: LibraryLoginSelfCheckView }> = ({ view }) => {
    const reduced = useKitReducedMotion();
    const lines = view.running ? [] : [view.verdict ?? view.error, view.proxyNote].filter((line): line is string => Boolean(line));
    return (
        <div className="mt-3 text-xs leading-[18px] text-[color:var(--st-t2)]">
            <b className="font-semibold text-[color:var(--st-t1)]">{view.title}</b>
            {view.running ? (
                <span className="ml-2 inline-flex items-center gap-1 text-[color:var(--st-t3)]">
                    <Loader2 size={12} className={reduced ? undefined : 'animate-spin'} />
                    {view.runningText}
                </span>
            ) : lines.map(line => <p key={line} className="mt-0.5 [overflow-wrap:anywhere]">{line}</p>)}
        </div>
    );
};

/** 详情：这一次失败的事实、自检的结论，复制诊断信息和去 GitHub 反馈，和隐私的那一句。 */
export const LoginDetails: React.FC<LoginDetailsProps> = ({ providerId, providerLabel, failure, selfCheck, reportElsewhere, buildReport }) => {
    const { t } = useTranslation();
    const { facts } = failure;
    // 原始信息：平台的码、HTTP 状态、上游编号、主进程的代号、共用的错误代码，有哪样写哪样。
    const raw = [
        facts.code && `code ${facts.code}`,
        facts.httpStatus !== undefined && `HTTP ${facts.httpStatus}`,
        facts.upstreamCode && `upstream ${facts.upstreamCode}`,
        facts.mainCode,
        facts.errorCode,
        facts.message,
    ].filter(Boolean).join(' · ');
    const rows: Array<[string, string]> = [
        [t('login.factPlatform'), providerLabel],
        [t('login.factStep'), t(loginStepText(facts.step, facts.inBrowser))],
        [t('login.factKind'), `${t(LOGIN_KIND_TEXTS[failure.case.kind])} · ${failure.case.id}`],
        [t('login.factRaw'), raw || '—'],
        [t('login.factTime'), new Date(failure.at).toLocaleTimeString([], { hour12: false })],
    ];
    // 去反馈之前先把报告放进剪贴板：链接放不下完整报告时，在 issue 页直接粘贴。
    const report = async () => {
        const text = await buildReport().catch(() => '');
        if (text) await copyText(text).catch(() => undefined);
        void openOutsideLink(buildLoginIssueUrl({ providerId, report: text, pasteHint: t('home.qrDiagnosticsPasteHint') }));
    };

    return (
        <div className="mt-4 border-t border-[var(--st-line)] pt-4">
            <dl className="grid select-text grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-0.5 rounded-lg bg-[var(--st-pv)] px-3 py-2.5 font-mono text-xs leading-5">
                {rows.map(([name, value]) => (
                    <React.Fragment key={name}>
                        <dt className="font-sans text-[color:var(--st-t3)]">{name}</dt>
                        <dd className="m-0 text-[color:var(--st-t2)] [overflow-wrap:anywhere]">{value}</dd>
                    </React.Fragment>
                ))}
            </dl>
            {selfCheck && <SelfCheckNote view={selfCheck} />}
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                {reportElsewhere && <span className="min-w-0 flex-[1_1_100%] text-xs leading-[18px] text-[color:var(--st-t2)]">{reportElsewhere}</span>}
                <span className="min-w-0 flex-[1_1_100%] text-xs leading-[18px] text-[color:var(--st-t3)]">{t('home.qrDiagnosticsDisclosure')}</span>
                <div className="ml-auto flex shrink-0 flex-wrap gap-2">
                    <CopyButton text={buildReport}>{t('home.qrDiagnosticsCopy')}</CopyButton>
                    {!reportElsewhere && <Button icon={ExternalLink} onClick={() => void report()}>{t('home.qrDiagnosticsReport')}</Button>}
                </div>
            </div>
        </div>
    );
};

export default LoginMessage;
