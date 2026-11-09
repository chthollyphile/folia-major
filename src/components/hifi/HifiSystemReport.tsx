import React from 'react';
import { Check, Info, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { HifiSignalPath } from '../../types/hifi';
import { CopyButton } from '../modal/settings/kit';
import { describeSystemCheck, systemRateHints } from './hifiSystemText';

// src/components/hifi/HifiSystemReport.tsx
// 信号链路面板里 PipeWire 那一级（Linux）的内容：逐项检查、没切采样率时的原因和可复制的配置行或命令，以及面板底下那句
// 「以上是 PipeWire 报告的状态。Folia 只读得到 PipeWire 报的内容，确认不了 DAC 实际收到的采样率……」。只在 HifiSignalPathPanel 里用。

/** 一行可复制的配置或命令，右边是复制按钮。 */
const CopyableLine: React.FC<{ text: string; label: string }> = ({ text, label }) => (
    <div className="mt-2 flex items-start gap-2">
        <pre
            aria-label={label}
            className="st-scroll min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-[var(--st-card)] px-2.5 py-2 font-mono text-[11px] leading-4 shadow-[0_0_0_1px_var(--st-line)] select-all"
        >
            <code>{text}</code>
        </pre>
        <CopyButton text={text} />
    </div>
);

/** PipeWire 那一级下面的逐项检查，和采样率没对上时的原因、要放进配置的那一行或要运行的命令。 */
export const HifiSystemReport: React.FC<{ path: HifiSignalPath }> = ({ path }) => {
    const { t, i18n } = useTranslation();
    if (!path.system) return null;
    const hints = systemRateHints(path, t, i18n.language);

    return (
        <>
            <ul aria-label={t('hifi.signal.system.checksLabel')} className="mt-1.5 flex flex-col gap-1">
                {path.system.checks.map((check) => {
                    const Icon = check.ok ? Check : TriangleAlert;
                    return (
                        <li
                            key={check.id}
                            data-system-check={check.id}
                            data-ok={check.ok}
                            className={`flex items-start gap-1.5 text-xs leading-[18px] ${check.ok ? 'text-[color:var(--st-t2)]' : 'text-[color:var(--st-warn)]'}`}
                        >
                            <Icon size={12} strokeWidth={2.4} aria-hidden className={`mt-[3px] shrink-0${check.ok ? ' text-[color:var(--st-ok)]' : ''}`} />
                            <span className="min-w-0 break-words">{describeSystemCheck(check, path, t, i18n.language)}</span>
                        </li>
                    );
                })}
            </ul>
            {hints.map(hint => (
                <div key={hint.id} data-system-hint={hint.id} className="mt-2.5 rounded-lg bg-[var(--st-fill)] px-3 py-2.5">
                    <p className="text-xs leading-[18px]">{hint.text}</p>
                    {hint.snippet && <CopyableLine text={hint.snippet} label={t('hifi.signal.system.snippetLabel')} />}
                    {hint.command && <CopyableLine text={hint.command} label={t('hifi.signal.system.commandLabel')} />}
                </div>
            ))}
        </>
    );
};

/** 有 PipeWire 那一级时总在面板底下写的那句：那只是 PipeWire 报的，Folia 确认不了 DAC 收到什么，要看 DAC 的指示或听。 */
export const HifiSystemFootnote: React.FC = () => {
    const { t } = useTranslation();
    return (
        <p role="note" className="mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-[18px] text-[color:var(--st-t2)] shadow-[0_0_0_1px_var(--st-line)]">
            <Info size={14} aria-hidden className="mt-0.5 shrink-0" />
            <span>{t('hifi.signal.system.footnote')}</span>
        </p>
    );
};
