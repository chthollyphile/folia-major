import React from 'react';
import { Check, Copy, Disc3, Download, ExternalLink, FolderOpen, Loader2, Search, Sparkles, Trash2, X } from 'lucide-react';
import ConfirmDialog from '../../shared/ConfirmDialog';
import ThemedDialog from '../../shared/ThemedDialog';
import { useTranslation } from 'react-i18next';
import { refreshModelAvailability } from '../../../services/automix/modelAvailability';

// src/components/modal/settings/AutomixModelsSection.tsx
// The two analysis models: whether they are here, and the three ways to get them.
//
// They are 83MB and 166MB, the difference between the full engine and the estimators, and most listeners
// never turn this feature on - so they are a download rather than a quarter of every installer. That
// makes "not installed" the state most desktop installs START in, which is why this block exists and why
// it sits directly under the badge that reports the engine.
//
// The three routes are automatic (mirrors, in order), a netdisk the listener downloads from themselves,
// and found-on-this-machine (a scan matching by hash, which is what turns the second into an install).
// All three end in the same verified file; the UI difference is only which one is worth offering first.
// The netdisk stays hidden until the automatic route has actually failed - offering a manual download to
// someone whose automatic one would have worked is noise.

/** A byte count as something a person reads. Sizes here are always tens or hundreds of MB. */
const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/**
 * The features a weight switches on, one chip each.
 *
 * Keyed by feature rather than by model because they are not one-to-one: stems drive automix's
 * vocal exit and the performance build-up both, and the beat grid drives automix alone. The icon
 * belongs to the feature too, so the same mark means the same thing down the column.
 */
const scopesOf = (enables: string) => (enables === 'stems'
    ? [
        { key: 'options.modelScopeAutomix', Icon: Disc3 },
        { key: 'options.modelScopePerformance', Icon: Sparkles },
    ]
    : [{ key: 'options.modelScopeAutomix', Icon: Disc3 }]);

/**
 * Keyed by name for the runtime and by capability for the rest.
 *
 * The runtime enables stems the same as the weights do, so `enables` cannot tell them apart - and
 * they are not the same thing to a listener. One is what separation knows; the other is what runs
 * it. A row calling both 人声分离 would look like the page listing the same download twice.
 */
const rowTitle = (model: ElectronAutomixModelEntry) => {
    if (model.name === 'runtime') return 'options.modelEnablesRuntime';
    return model.enables === 'stems' ? 'options.modelEnablesStems' : 'options.modelEnablesBeatGrid';
};

type Progress = ElectronAutomixModelProgress;

const AutomixModelsSection: React.FC<{ isDaylight: boolean }> = ({ isDaylight }) => {
    const { t } = useTranslation();
    const [status, setStatus] = React.useState<ElectronAutomixModelStatus | null>(null);
    const [progress, setProgress] = React.useState<Record<string, Progress>>({});
    const [failures, setFailures] = React.useState<Record<string, string[]>>({});
    const [scanning, setScanning] = React.useState(false);
    const [scanResult, setScanResult] = React.useState<string | null>(null);
    const [copiedCode, setCopiedCode] = React.useState<string | null>(null);
    const [manualOpen, setManualOpen] = React.useState(false);
    const [removeOpen, setRemoveOpen] = React.useState(false);

    const borderColor = isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)';
    const trackColor = isDaylight ? 'rgba(24, 24, 27, 0.10)' : 'rgba(255, 255, 255, 0.12)';
    const scopeChipColor = isDaylight ? 'rgba(24, 24, 27, 0.06)' : 'rgba(255, 255, 255, 0.07)';

    // Re-read after anything that could have changed a file on disk, and tell the rest of the app too:
    // the engine badge and the 表现模式 switch are computed from the same question, and a page that
    // updated only its own half would be the "settings page lies" bug wearing a new hat.
    const refresh = React.useCallback(async () => {
        const next = await window.electron?.getAutomixModelStatus?.();
        if (next) setStatus(next);
        await refreshModelAvailability();
    }, []);

    React.useEffect(() => {
        void refresh();
        return window.electron?.onAutomixModelProgress?.((event) => {
            setProgress(current => ({ ...current, [event.name]: event }));
            if (event.status !== 'downloading') void refresh();
        });
    }, [refresh]);

    const download = async (name: string) => {
        setFailures(current => ({ ...current, [name]: [] }));
        setScanResult(null);
        const result = await window.electron?.downloadAutomixModel?.(name);
        // Per-mirror reasons are kept and shown, not collapsed into "failed": which mirror was
        // tried and what it said is what tells a listener whether to wait, switch network, or go
        // to the netdisk.
        if (result && !result.ok) setFailures(current => ({ ...current, [name]: result.skipped ?? [] }));
        await refresh();
    };

    const scan = async () => {
        setScanning(true);
        setScanResult(null);
        try {
            const found = await window.electron?.scanForAutomixModels?.();
            let installed = 0;
            for (const hit of found?.found ?? []) {
                const result = await window.electron?.installAutomixModel?.(hit.name, hit.path);
                if (result?.ok) installed += 1;
            }
            setScanResult(installed > 0
                ? t('options.modelScanFound', { count: installed })
                : t('options.modelScanNone'));
            await refresh();
        } finally {
            setScanning(false);
        }
    };

    const chooseDirectory = async () => {
        await window.electron?.chooseModelsDirectory?.();
        await refresh();
    };

    const removeAll = async () => {
        setRemoveOpen(false);
        setFailures({});
        const result = await window.electron?.removeAllAutomixModels?.();
        // A copy in the installer's own read-only directory can't be deleted; the page then
        // correctly goes on saying 已安装 off it, so that failure is reported rather than read
        // as the button having done nothing.
        setScanResult(result && !result.ok
            ? t('options.modelRemoveFailed', { what: result.failed.map(f => f.name).join(', ') })
            : t('options.modelRemoveDone', { size: megabytes(result?.freed ?? 0) }));
        await refresh();
    };

    const resetDirectory = async () => {
        await window.electron?.resetModelsDirectory?.();
        await refresh();
    };

    // The "copied" state clears itself so a second copy can be confirmed too: a button stuck on
    // "copied" leaves a listener who re-copies unable to tell whether the click did anything.
    const copyCode = (code: string) => {
        void navigator.clipboard?.writeText(code).then(() => {
            console.log('[Models] extraction code copied to the clipboard');
            setCopiedCode(code);
            window.setTimeout(() => setCopiedCode(current => (current === code ? null : current)), 1600);
        }).catch((error: unknown) => {
            console.warn('[Models] could not copy the extraction code', error);
        });
    };

    if (!status) return null;

    const anyFailed = Object.values(failures).some(list => list.length > 0);
    const manualLinks = (status.manual?.links ?? []).filter(link => link.url.trim());

    return (
        <div id="automix-models" className="rounded-lg border px-3 py-3 space-y-3" style={{ borderColor }}>
            <div>
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.modelsTitle')}
                </div>
                {/* Added up rather than written down. It was a hardcoded 249MB, which the runtime
                    made wrong on every platform and by a different amount on each - and there is
                    no one number to write, because the runtime is a different size per OS. */}
                <div className="mt-1 text-[11px] leading-relaxed opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.modelsDesc', {
                        size: megabytes(status.models.reduce(
                            (total, model) => total + (model.supported ? model.bytes : 0), 0,
                        )),
                    })}
                </div>
            </div>

            {status.models.map((model) => {
                const live = progress[model.name];
                const busy = model.downloading || live?.status === 'downloading';
                const percent = busy && live?.total ? Math.min(100, (live.received / live.total) * 100) : 0;
                const reasons = failures[model.name] ?? [];

                return (
                    <div key={model.name} className="rounded-lg border px-3 py-2.5 space-y-2" style={{ borderColor }}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                                <div className="text-[13px] font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    {model.path && <Check size={13} className="shrink-0 opacity-70" />}
                                    {t(rowTitle(model))}
                                    {/* No size on a row with nothing to download. "0 MB" beside a
                                        thing this machine cannot have reads like a bug. */}
                                    {model.supported && (
                                        <span className="font-mono text-[11px] opacity-50 tabular-nums">{megabytes(model.bytes)}</span>
                                    )}
                                </div>
                                {/* What this weight is for (chips keyed by feature - see scopesOf),
                                    said on the row because these are separate 83MB / 166MB downloads
                                    and "which of these do I need" is otherwise unanswered. Neither
                                    model touches a crossfade - that planner reads the profile's
                                    silence edges and nothing else. */}
                                <div className="mt-1 flex items-center gap-2">
                                    {scopesOf(model.enables).map(({ key, Icon }) => (
                                        <span
                                            key={key}
                                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] shrink-0"
                                            style={{ backgroundColor: scopeChipColor, color: 'var(--text-secondary)' }}
                                        >
                                            <Icon size={10} />
                                            {t(key)}
                                        </span>
                                    ))}
                                    <span className="text-[11px] opacity-50 truncate" style={{ color: 'var(--text-secondary)' }}>
                                        {model.supported
                                            ? model.path ?? t('options.modelMissing')
                                            : t('options.modelUnsupportedWhy')}
                                    </span>
                                </div>
                            </div>
                            {/* Three states, not two. A machine with no build for it gets told so
                                where the button would be - the one place someone looking for the
                                download is already looking. */}
                            {!model.supported ? (
                                <span className="text-[11px] opacity-60 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.modelUnsupported')}
                                </span>
                            ) : model.path ? (
                                <span className="text-[11px] opacity-60 shrink-0" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.modelInstalled')}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => (busy
                                        ? window.electron?.cancelAutomixModelDownload?.(model.name)
                                        : download(model.name))}
                                    className="shrink-0 rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors"
                                    style={{ borderColor, color: 'var(--text-primary)' }}
                                >
                                    {busy ? <X size={12} /> : <Download size={12} />}
                                    {t(busy ? 'options.modelCancel' : 'options.modelDownload')}
                                </button>
                            )}
                        </div>

                        {busy && (
                            <div className="space-y-1">
                                <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: trackColor }}>
                                    <div
                                        className="h-full rounded-full transition-[width] duration-200"
                                        style={{ width: `${percent}%`, backgroundColor: 'var(--text-primary)', opacity: 0.55 }}
                                    />
                                </div>
                                <div className="flex justify-between text-[10px] font-mono tabular-nums opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    <span>{live?.host ?? ''}</span>
                                    <span>{percent.toFixed(0)}%</span>
                                </div>
                            </div>
                        )}

                        {reasons.length > 0 && (
                            <div className="text-[10px] font-mono leading-relaxed opacity-60 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                                {reasons.map((reason, index) => <div key={index} className="truncate">{reason}</div>)}
                            </div>
                        )}
                    </div>
                );
            })}

            {/* Offered whether or not anything failed: someone who already has the file - copied off
                another machine, or downloaded before a reinstall - should not have to fetch it
                again to find that out. */}
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={scan}
                    disabled={scanning}
                    className="rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 disabled:opacity-45"
                    style={{ borderColor, color: 'var(--text-primary)' }}
                >
                    {scanning ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                    {t(scanning ? 'options.modelScanning' : 'options.modelScan')}
                </button>
                <button
                    type="button"
                    onClick={chooseDirectory}
                    className="rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5"
                    style={{ borderColor, color: 'var(--text-primary)' }}
                >
                    <FolderOpen size={12} />
                    {t('options.modelLocationChange')}
                </button>
                {/* Only when there is something to delete. A destructive button that would do
                    nothing is worse than no button: it invites the click AND teaches nothing. */}
                {status.models.some(model => model.path) && (
                    <button
                        type="button"
                        onClick={() => setRemoveOpen(true)}
                        className="rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors hover:border-red-500/60"
                        style={{ borderColor, color: 'var(--text-secondary)' }}
                    >
                        <Trash2 size={12} />
                        {t('options.modelRemoveAll')}
                    </button>
                )}
                {scanResult && (
                    <span className="text-[11px] opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        {scanResult}
                    </span>
                )}
            </div>

            <div className="text-[11px] opacity-50 break-all" style={{ color: 'var(--text-secondary)' }}>
                {t('options.modelLocation')}: {status.downloadDir}
                <button type="button" onClick={resetDirectory} className="ml-2 underline opacity-70">
                    {t('options.modelLocationReset')}
                </button>
            </div>

            {/* Only once the automatic route has actually failed. A netdisk link shown to someone
                whose download would have worked is noise, and an EMPTY list is worse than none -
                which is why the routes live in the manifest and an empty one hides this entirely. */}
            {anyFailed && manualLinks.length > 0 && (
                <div className="rounded-lg border px-3 py-2.5 space-y-2" style={{ borderColor }}>
                    <div className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.modelManualHint')}
                    </div>
                    <button
                        type="button"
                        onClick={() => setManualOpen(true)}
                        className="rounded-lg border px-2.5 py-1.5 text-[11px] flex items-center gap-1.5"
                        style={{ borderColor, color: 'var(--text-primary)' }}
                    >
                        <ExternalLink size={12} />
                        {t('options.modelManualLink')}
                    </button>
                    {status.manual?.note && (
                        <div className="text-[10px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {status.manual.note}
                        </div>
                    )}
                </div>
            )}

            {/* A dialog, not more rows: each route is a link plus a four-character case-sensitive
                code, and flattened into a row the codes and links read as two separate lists. Side
                by side, each code sits under the disk it belongs to and can't be paired wrongly. */}
            <ThemedDialog
                isOpen={manualOpen}
                onClose={() => setManualOpen(false)}
                isDaylight={isDaylight}
                title={t('options.modelManualTitle')}
                description={t('options.modelManualDialogDesc')}
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {manualLinks.map(link => (
                        <div
                            key={link.url}
                            className="rounded-2xl border px-4 py-4 flex flex-col items-center gap-3"
                            style={{ borderColor }}
                        >
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {link.label}
                            </div>
                            <button
                                type="button"
                                onClick={() => window.electron?.openExternalUrl?.(link.url)}
                                className="w-full rounded-xl border px-3 py-2 text-xs flex items-center justify-center gap-1.5"
                                style={{ borderColor, color: 'var(--text-primary)' }}
                            >
                                <ExternalLink size={12} />
                                {t('options.modelManualOpen')}
                            </button>
                            {/* The code is a button because retyping a case-sensitive four
                                characters by eye is a failure mode, and it is one the app can
                                simply not have. */}
                            {link.code && (
                                <button
                                    type="button"
                                    onClick={() => copyCode(link.code as string)}
                                    className="w-full rounded-xl border px-3 py-2 text-xs font-mono flex items-center justify-center gap-1.5"
                                    style={{ borderColor, color: 'var(--text-secondary)' }}
                                >
                                    {copiedCode === link.code ? <Check size={12} /> : <Copy size={12} />}
                                    {copiedCode === link.code
                                        ? t('options.modelManualCodeCopied')
                                        : t('options.modelManualCode') + ' ' + link.code}
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </ThemedDialog>

            {/* 249MB is a slow thing to get back on the connections this feature's listeners are
                on - the whole netdisk route above exists because of them - so this one asks. */}
            <ConfirmDialog
                isOpen={removeOpen}
                isDaylight={isDaylight}
                title={t('options.modelRemoveAll')}
                description={t('options.modelRemoveConfirm', {
                    size: megabytes(status.models.reduce((sum, m) => sum + (m.path ? m.bytes : 0), 0)),
                })}
                confirmVariant="danger"
                onConfirm={removeAll}
                onClose={() => setRemoveOpen(false)}
            />
        </div>
    );
};

export default AutomixModelsSection;
