import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, FolderOpen, Loader2, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ProviderSetupAction, ProviderSetupStep, ProviderSetupView } from '../../../types/onlineMusic';
import { Button } from '../../modal/settings/kit/Button';
import { Status } from '../../modal/settings/kit/Status';
import { TextField } from '../../modal/settings/kit/TextField';
import { useKitReducedMotion } from '../../modal/settings/kit/motion';

// src/components/login/window/SetupChecklist.tsx
// 平台的配置清单，画在登录窗口那一块画和话的下面：一步一行，前面是序号（做完的是对勾，警告和出错各有记号），
// 后面是标题、说明、原样的事实、密码框和操作。清单只有平台给的数据（ProviderSetupView），这里不认识任何平台；
// 操作经账户 controller 的 runSetupAction 交给平台。

type SetupChecklistProps = {
    view: ProviderSetupView;
    /** 平台正在做一个操作：按钮都不可按。 */
    busy: boolean;
    /** 做一个操作；回 true 是平台做完了（交出的密码框据此清空、收起）。 */
    onAction: (stepId: string, actionId: string, value?: string) => Promise<boolean>;
};

const MARK_CLASS: Record<ProviderSetupStep['state'], string> = {
    done: 'bg-[var(--login-pc)] text-[color:var(--login-on-pc)]',
    todo: 'text-[color:var(--st-t2)] shadow-[inset_0_0_0_1.5px_var(--st-line2)]',
    warn: 'bg-[color-mix(in_srgb,var(--st-warn)_16%,transparent)] text-[color:var(--st-warn)]',
    error: 'bg-[color-mix(in_srgb,var(--st-err)_14%,transparent)] text-[color:var(--st-err)]',
};

const MARK_ICON: Partial<Record<ProviderSetupStep['state'], LucideIcon>> = { done: Check, warn: TriangleAlert, error: X };

const ACTION_ICON: Partial<Record<ProviderSetupAction['kind'], LucideIcon>> = { link: ExternalLink, 'pick-file': FolderOpen };

/** 清单里的一步。密码框的内容只在这一行里，交出去之后清空。 */
const SetupStepRow: React.FC<{
    step: ProviderSetupStep;
    index: number;
    busy: boolean;
    running: string | null;
    run: (step: ProviderSetupStep, action: ProviderSetupAction, value?: string) => Promise<boolean>;
}> = ({ step, index, busy, running, run }) => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    // 收起的详细说明（step.more）：清单里只留一句短的，按一下才展开，窗口高度不变。
    const [moreOpen, setMoreOpen] = useState(false);
    const [secret, setSecret] = useState('');
    // 已经存过一份：框里只画掩码，按「更换」才能填新的。
    const [changing, setChanging] = useState(false);
    const editing = Boolean(step.secret) && (!step.secret!.saved || changing);
    const MarkIcon = MARK_ICON[step.state];
    const actions = (step.actions ?? []).filter(action => action.kind !== 'submit-secret' || editing);

    const press = async (action: ProviderSetupAction) => {
        const value = action.kind === 'submit-secret' ? secret.trim() : undefined;
        const done = await run(step, action, value);
        if (done && action.kind === 'submit-secret') {
            setSecret('');
            setChanging(false);
        }
    };

    return (
        <li className="flex gap-3 border-t border-[var(--st-line)] py-2 first:border-t-0">
            <span
                aria-hidden
                className={`st-t-fast mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors ${MARK_CLASS[step.state]}`}
            >
                {MarkIcon ? <MarkIcon size={13} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
                <h4 className="text-[13px] font-semibold leading-[22px] text-[color:var(--st-t1)]">
                    {t(step.titleKey, step.params)}
                    {/* 详细说明的入口在标题这一行：清单放不下的长说明展开才看，窗口高度不变。 */}
                    {step.more && (
                        <button
                            type="button"
                            aria-expanded={moreOpen}
                            className="ml-1.5 align-baseline text-xs font-normal text-[color:var(--st-t2)] underline underline-offset-2 hover:no-underline"
                            onClick={() => setMoreOpen(open => !open)}
                        >
                            {t(step.more.labelKey)}
                        </button>
                    )}
                    <span className="sr-only">{` · ${t(`login.setupState.${step.state}`)}`}</span>
                </h4>
                {step.noteKey && (
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-[18px] text-[color:var(--st-t2)]">{t(step.noteKey, step.params)}</p>
                )}
                {moreOpen && step.more && (
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-[18px] text-[color:var(--st-t2)]">{t(step.more.noteKey)}</p>
                )}
                {step.detail && (
                    <p className="mt-1.5 select-text font-mono text-[11px] leading-4 text-[color:var(--st-t3)] [overflow-wrap:anywhere]">{step.detail}</p>
                )}
                {step.secret && (
                    <label className="mt-2.5 block text-xs text-[color:var(--st-t2)]">
                        {t(step.secret.labelKey)}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <TextField
                                type="password"
                                value={editing ? secret : '••••••••'}
                                onChange={setSecret}
                                disabled={!editing || busy}
                            />
                            {step.secret.saved && (
                                <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() => {
                                        setChanging(value => !value);
                                        setSecret('');
                                    }}
                                >
                                    {t(changing ? 'login.setupSecretCancel' : 'login.setupSecretChange')}
                                </Button>
                            )}
                        </div>
                    </label>
                )}
                {actions.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                        {actions.map(action => {
                            const key = `${step.id}:${action.id}`;
                            const Icon = ACTION_ICON[action.kind];
                            const empty = action.kind === 'submit-secret' && !secret.trim();
                            return (
                                <Button
                                    key={action.id}
                                    variant={action.primary ? 'primary' : undefined}
                                    // 链接不改清单，平台在做操作时也能打开。
                                    disabled={(busy && action.kind !== 'link') || empty}
                                    icon={running === key ? undefined : Icon}
                                    onClick={() => void press(action)}
                                >
                                    {running === key && <Loader2 size={14} className={reduced ? undefined : 'animate-spin'} />}
                                    {t(action.labelKey)}
                                </Button>
                            );
                        })}
                    </div>
                )}
            </div>
        </li>
    );
};

export const SetupChecklist: React.FC<SetupChecklistProps> = ({ view, busy, onAction }) => {
    const { t } = useTranslation();
    // 正在做的是哪一步的哪一个操作：那个按钮转圈。
    const [running, setRunning] = useState<string | null>(null);
    // 操作是异步的：做的时候窗口关了、清单收起了，晚到的回答不再动界面。
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    const run = async (step: ProviderSetupStep, action: ProviderSetupAction, value?: string): Promise<boolean> => {
        const key = `${step.id}:${action.id}`;
        setRunning(key);
        try {
            return await onAction(step.id, action.id, value);
        } finally {
            if (mounted.current) setRunning(current => (current === key ? null : current));
        }
    };

    return (
        <div className="mt-2 border-t border-[var(--st-line)] pt-1">
            <ol className="m-0 list-none p-0">
                {view.steps.map((step, index) => (
                    <SetupStepRow key={step.id} step={step} index={index} busy={busy} running={running} run={run} />
                ))}
            </ol>
            {view.message && (
                <div className="pb-1 pt-2">
                    <Status tone={view.message.tone}>{t(view.message.key, view.params)}</Status>
                </div>
            )}
        </div>
    );
};

export default SetupChecklist;
