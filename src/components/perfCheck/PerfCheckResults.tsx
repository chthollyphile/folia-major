import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Gauge, X } from 'lucide-react';
import { rateStep, type PerfCheckRating } from './perfCheckPlan';
import { settingLabels, settingsLine } from './perfCheckText';
import type { PerfCheckFrames, PerfCheckReport, PerfCheckSettings, PerfCheckStepResult } from './perfCheckTypes';

// src/components/perfCheck/PerfCheckResults.tsx
// The check's answer, over the still-running picture. On top, in plain words: how this computer
// does with the user's own settings and what to change, with one button for the recommendation.
// Below, one row per step tried: its settings, the frame rate with the lyrics alone and while the
// music is analysed, whether the analysis keeps up, and a one-word rating. Choosing a row previews it
// in this window; "apply" hands it to the main window. Nothing is applied by itself. The raw numbers
// (the 1% low, memory) sit behind "details".

const sameSettings = (a: PerfCheckSettings, b: PerfCheckSettings) => (
    a.frameRate === b.frameRate && a.scale === b.scale && a.antialias === b.antialias
);

const megabytes = (mb: number | null) => (mb === null ? '—' : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

const RATING_STYLE: Record<PerfCheckRating, string> = {
    smooth: 'bg-emerald-400/15 text-emerald-300',
    fair: 'bg-amber-400/15 text-amber-300',
    poor: 'bg-rose-400/15 text-rose-300',
    behind: 'bg-sky-400/15 text-sky-300',
};

interface PerfCheckResultsProps {
    report: PerfCheckReport;
    current: PerfCheckSettings;
    onPreview: (settings: PerfCheckSettings) => void;
    onClose: () => void;
}

const PerfCheckResults: React.FC<PerfCheckResultsProps> = ({ report, current, onPreview, onClose }) => {
    const { t } = useTranslation();
    const [selected, setSelected] = useState(report.recommended);
    const [applied, setApplied] = useState<number | null>(null);
    const [applyFailed, setApplyFailed] = useState(false);
    const [details, setDetails] = useState(false);
    const recommended = report.steps[report.recommended];
    const first = report.steps[0];

    const settingTags = (settings: PerfCheckSettings) => settingLabels(t, settings);
    const settingsText = (settings: PerfCheckSettings) => settingsLine(t, settings);
    const fps = (frames: PerfCheckFrames) => Math.round(frames.fps);

    // The settings' own names, as the settings window shows them.
    const names = { smartBeat: t('options.smartBeat'), cached: t('options.smartBeatModeCached'), page: t('options.settingsPageGraphics') };
    const times = (step: PerfCheckStepResult) => (step.inference.realtime ?? 0).toFixed(1);
    // Why a step is not smooth decides what is said: a choppy picture, or analysis that falls behind playback.
    const verdict: { tone: PerfCheckRating; title: string; body: string } = !report.gpuAnalysis
        ? { tone: 'poor', title: t('perfCheck.verdictNoGpuTitle'), body: t('perfCheck.verdictNoGpu', names) }
        : first.smooth
            ? { tone: 'smooth', title: t('perfCheck.verdictFineTitle'), body: t('perfCheck.verdictFine', { fps: fps(first.withAnalysis) }) }
            : recommended.smooth
                ? rateStep(first) === 'behind'
                    ? {
                        tone: 'behind',
                        title: t('perfCheck.verdictBehindTitle'),
                        body: t('perfCheck.verdictBehind', { times: times(first), settings: settingsText(recommended.settings) }),
                    }
                    : {
                        tone: 'fair',
                        title: t('perfCheck.verdictLowerTitle'),
                        body: t('perfCheck.verdictLower', { from: fps(first.withAnalysis), to: fps(recommended.withAnalysis), settings: settingsText(recommended.settings) }),
                    }
                : rateStep(recommended) === 'behind'
                    ? { tone: 'behind', title: t('perfCheck.verdictAnalysisSlowTitle'), body: t('perfCheck.verdictAnalysisSlow', names) }
                    : { tone: 'poor', title: t('perfCheck.verdictTooSlowTitle'), body: t('perfCheck.verdictTooSlow', names) };
    const offerRecommended = report.recommended !== 0 && !sameSettings(recommended.settings, current);

    const choose = (index: number) => {
        setSelected(index);
        onPreview(report.steps[index].settings);
    };
    const apply = async (index: number) => {
        setApplyFailed(false);
        const done = await window.electron?.applyPerfCheckChoice?.(report.steps[index].settings).catch(() => false);
        if (done) setApplied(index);
        else setApplyFailed(true);
    };
    const separation = (step: PerfCheckStepResult) => {
        const { realtime } = step.inference;
        if (realtime === null) return <span className="text-white/40">—</span>;
        return realtime >= 1
            ? <span>{t('perfCheck.keepsUp')}<span className="ml-1 text-xs text-white/45">{t('perfCheck.speed', { times: realtime >= 10 ? Math.round(realtime) : realtime.toFixed(1) })}</span></span>
            : <span className="text-rose-300">{t('perfCheck.fallsBehind')}</span>;
    };
    const framesCell = (frames: PerfCheckFrames) => (
        <div>
            <span className="text-base font-medium tabular-nums">{fps(frames)}</span>
            <span className="ml-1 text-xs text-white/45">{t('perfCheck.fpsUnit')}</span>
            {details && <div className="text-xs text-white/40 tabular-nums">{t('perfCheck.lowFps', { low: Math.round(frames.lowFps) })}</div>}
        </div>
    );

    return (
        <div className="absolute inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4">
            <div className="w-full max-w-3xl rounded-3xl bg-neutral-950/92 p-6 text-white shadow-2xl backdrop-blur-xl">
                <div className="flex items-center gap-3">
                    <Gauge className="h-5 w-5 shrink-0 opacity-80" />
                    <h1 className="flex-1 text-lg font-semibold">{t('perfCheck.resultTitle')}</h1>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
                        title={t('perfCheck.close')}
                        aria-label={t('perfCheck.close')}
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                <div className={`mt-4 rounded-2xl p-4 ${RATING_STYLE[verdict.tone].split(' ')[0]}`}>
                    <div className={`text-base font-semibold ${RATING_STYLE[verdict.tone].split(' ')[1]}`}>{verdict.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-white/80">{verdict.body}</p>
                    {offerRecommended && report.gpuAnalysis && (
                        applied === report.recommended ? (
                            <div className="mt-3 inline-flex items-center gap-1.5 text-sm text-emerald-300"><Check className="h-4 w-4" />{t('perfCheck.appliedRecommended')}</div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => void apply(report.recommended)}
                                className="mt-3 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black transition hover:bg-white/85"
                            >
                                {t(recommended.smooth ? 'perfCheck.applyRecommended' : 'perfCheck.applySmoothest')}
                            </button>
                        )
                    )}
                </div>

                <h2 className="mt-6 text-sm font-medium text-white/80">{t('perfCheck.compareTitle')}</h2>
                <p className="mt-0.5 text-xs text-white/50">{t('perfCheck.compareHint')}</p>
                <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="text-xs text-white/50">
                            <tr>
                                <th className="pb-2 pr-3 font-normal">{t('perfCheck.columnSettings')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('perfCheck.columnPicture')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('perfCheck.columnWithAnalysis')}</th>
                                <th className="pb-2 pr-3 font-normal">{t('perfCheck.columnSeparation')}</th>
                                <th className="pb-2 font-normal" />
                            </tr>
                        </thead>
                        <tbody>
                            {report.steps.map((step, index) => {
                                const isCurrent = sameSettings(step.settings, current);
                                const rating = rateStep(step);
                                return (
                                    <tr
                                        key={index}
                                        onClick={() => choose(index)}
                                        className={`cursor-pointer border-t border-white/10 align-top transition ${selected === index ? 'bg-white/10' : 'hover:bg-white/5'}`}
                                    >
                                        <td className="py-3 pl-2 pr-3">
                                            <div className="flex flex-wrap gap-1">
                                                {settingTags(step.settings).map((tag, at) => (
                                                    <span
                                                        key={at}
                                                        className={`rounded-md px-1.5 py-0.5 text-xs ${index > 0 && step.changes.includes((['frameRate', 'scale', 'antialias'] as const)[at]) ? 'bg-white/20 text-white' : 'bg-white/5 text-white/65'}`}
                                                    >
                                                        {tag}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="mt-1 text-xs text-white/50">
                                                {isCurrent ? t('perfCheck.yours') : index === report.recommended ? t('perfCheck.recommended') : null}
                                            </div>
                                        </td>
                                        <td className="py-3 pr-3">{framesCell(step.picture)}</td>
                                        <td className="py-3 pr-3">{framesCell(step.withAnalysis)}</td>
                                        <td className="py-3 pr-3">{separation(step)}</td>
                                        <td className="py-3 pr-2 text-right">
                                            <div className="flex flex-col items-end gap-1.5">
                                                <span className={`rounded-full px-2 py-0.5 text-xs ${RATING_STYLE[rating]}`}>{t(`perfCheck.rating_${rating}`)}</span>
                                                {applied === index ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check className="h-3.5 w-3.5" />{t('perfCheck.applied')}</span>
                                                ) : !isCurrent && (
                                                    <button
                                                        type="button"
                                                        onClick={(event) => { event.stopPropagation(); void apply(index); }}
                                                        className="rounded-full bg-white/10 px-3 py-1 text-xs transition hover:bg-white/20"
                                                    >
                                                        {t('perfCheck.apply')}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {applyFailed && <p className="mt-2 text-xs text-amber-300">{t('perfCheck.applyFailed', names)}</p>}

                <button
                    type="button"
                    onClick={() => setDetails(open => !open)}
                    className="mt-4 inline-flex items-center gap-1 text-xs text-white/55 transition hover:text-white/80"
                    aria-expanded={details}
                >
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${details ? 'rotate-180' : ''}`} />
                    {t(details ? 'perfCheck.hideDetails' : 'perfCheck.showDetails')}
                </button>
                {details && (
                    <div className="mt-2 space-y-1 text-xs leading-relaxed text-white/55">
                        <p>{t('perfCheck.memory', {
                            app: megabytes(report.memory.appMb),
                            gpu: megabytes(report.memory.gpuProcessMb),
                            models: megabytes(report.memory.modelsMb),
                        })}</p>
                        <p>{t('perfCheck.detailsHow', { hz: Math.round(report.refreshHz) })}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PerfCheckResults;
