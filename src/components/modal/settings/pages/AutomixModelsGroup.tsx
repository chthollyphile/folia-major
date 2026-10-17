import React from 'react';
import { Download, ExternalLink, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../../../shared/ConfirmDialog';
import ThemedDialog from '../../../shared/ThemedDialog';
import { refreshModelAvailability } from '../../../../services/analysis/modelAvailability';
import { Button, CopyButton, FoldedGroup, Progress, Reveal, Row, Status, Value, option, useSettingsKitTheme, type SettingsGroupDef } from '../kit';
import { openOutsideLink } from '../../../../utils/system/outsideLink';

// src/components/modal/settings/pages/AutomixModelsGroup.tsx
// The folded 分析模型 group of the 播放控制 page (desktop app only): one row for each download the
// full transition engine needs, with its size and whether it is here, then where the files are
// kept, a search of this computer for files that are already on it, and removing them all.
//
// A model gets here in three ways, and all three end in the same verified file: the automatic
// download (mirrors, in order), a netdisk the listener downloads from themselves, and a file found
// on this machine by its hash. The netdisk is offered only once an automatic download has failed.

export const MODELS: SettingsGroupDef = { id: 'automixModels', titleKey: 'options.modelsTitle', electronOnly: true };

export const MODEL_OPTIONS = {
    location: option(MODELS, 'automixModelLocation', 'options.modelLocation'),
};

/** A byte count as a person reads it. Sizes here are always tens or hundreds of MB. */
const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

/** Keyed by capability: one model per feature, so `enables` names the row. */
const titleKeyOf = (model: ElectronAutomixModelEntry) => {
    if (model.enables === 'stems') return 'options.modelEnablesStems';
    if (model.enables === 'drums') return 'options.modelEnablesDrums';
    return 'options.modelEnablesBeatGrid';
};

/**
 * The features a download switches on: stems serve both, the beat grid serves Automix alone, and
 * htdemucs' GPU export the drum hits of 智能动感模式, nothing of Automix's.
 */
const scopeKeysOf = (model: ElectronAutomixModelEntry) => {
    if (model.enables === 'stems') return ['options.modelScopeAutomix', 'options.modelScopePerformance'];
    if (model.enables === 'drums') return ['options.modelScopeSmartBeat'];
    return ['options.modelScopeAutomix'];
};

type Outcome = { text: string; tone?: 'ok' | 'error' };

const AutomixModelsGroup: React.FC = () => {
    const { t } = useTranslation();
    const { isDaylight } = useSettingsKitTheme();
    const [status, setStatus] = React.useState<ElectronAutomixModelStatus | null>(null);
    const [progress, setProgress] = React.useState<Record<string, ElectronAutomixModelProgress>>({});
    const [failures, setFailures] = React.useState<Record<string, string[]>>({});
    const [scanning, setScanning] = React.useState(false);
    const [outcome, setOutcome] = React.useState<Outcome | null>(null);
    const [manualOpen, setManualOpen] = React.useState(false);
    const [removeOpen, setRemoveOpen] = React.useState(false);

    // Read again after anything that may have changed a file on disk, and tell the rest of the app:
    // the engine status and the 表现模式 switch on this page answer the same question.
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
        setOutcome(null);
        const result = await window.electron?.downloadAutomixModel?.(name);
        // What each mirror answered is kept and shown: it tells whether to wait, change network or
        // go to the netdisk.
        if (result && !result.ok) setFailures(current => ({ ...current, [name]: result.skipped ?? [] }));
        await refresh();
    };

    const scan = async () => {
        setScanning(true);
        setOutcome(null);
        try {
            const found = await window.electron?.scanForAutomixModels?.();
            let installed = 0;
            for (const hit of found?.found ?? []) {
                const result = await window.electron?.installAutomixModel?.(hit.name, hit.path);
                if (result?.ok) installed += 1;
            }
            setOutcome(installed > 0
                ? { text: t('options.modelScanFound', { count: installed }), tone: 'ok' }
                : { text: t('options.modelScanNone') });
            await refresh();
        } finally {
            setScanning(false);
        }
    };

    const chooseDirectory = async () => {
        await window.electron?.chooseModelsDirectory?.();
        await refresh();
    };

    const resetDirectory = async () => {
        await window.electron?.resetModelsDirectory?.();
        await refresh();
    };

    const removeAll = async () => {
        setRemoveOpen(false);
        setFailures({});
        const result = await window.electron?.removeAllAutomixModels?.();
        // A copy in the installer's own read-only folder cannot be deleted and the row goes on
        // saying 已安装, so that failure is said.
        setOutcome(result && !result.ok
            ? { text: t('options.modelRemoveFailed', { what: result.failed.map(item => item.name).join(', ') }), tone: 'error' }
            : { text: t('options.modelRemoveDone', { size: megabytes(result?.freed ?? 0) }) });
        await refresh();
    };

    // Nothing to show until the desktop app has answered.
    if (!status) return null;

    const wanted = status.models;
    const installed = status.models.filter(model => model.path);
    // Weights only, and what runs them is compiled in: every device can have every model.
    const summary = installed.length >= wanted.length
        ? t('options.modelInstalled')
        : installed.length === 0 ? t('options.modelMissing') : `${installed.length} / ${wanted.length}`;
    const anyFailed = Object.values(failures).some(list => list.length > 0);
    const manualLinks = (status.manual?.links ?? []).filter(link => link.url.trim());

    return (
        <>
            <FoldedGroup def={MODELS} summary={summary}>
                {status.models.map((model) => {
                    const live = progress[model.name];
                    const busy = model.downloading || live?.status === 'downloading';
                    const done = busy && live?.total ? Math.min(1, live.received / live.total) : 0;
                    const reasons = failures[model.name] ?? [];
                    const scopes = scopeKeysOf(model).map(key => t(key)).join(' · ');

                    return (
                        <Row
                            key={model.name}
                            label={t(titleKeyOf(model))}
                            hint={(busy && live?.host) || scopes}
                            note={model.path ?? undefined}
                            below={reasons.length > 0 && (
                                <div className="space-y-0.5 font-mono text-[11px] leading-4 text-[color:var(--st-t3)]">
                                    {reasons.map((reason, index) => <div key={index} className="truncate">{reason}</div>)}
                                </div>
                            )}
                        >
                            <Value>{megabytes(model.bytes)}</Value>
                            {model.path ? (
                                <Status tone="ok">{t('options.modelInstalled')}</Status>
                            ) : (
                                <>
                                    {busy && <Progress value={done}>{`${Math.round(done * 100)}%`}</Progress>}
                                    <Button
                                        icon={busy ? X : Download}
                                        onClick={() => void (busy
                                            ? window.electron?.cancelAutomixModelDownload?.(model.name)
                                            : download(model.name))}
                                    >
                                        {t(busy ? 'options.modelCancel' : 'options.modelDownload')}
                                    </Button>
                                </>
                            )}
                        </Row>
                    );
                })}
                <Row option={MODEL_OPTIONS.location}>
                    <Value tip={status.downloadDir}>{status.downloadDir}</Value>
                    <Button icon={RotateCcw} tip={t('options.modelLocationReset')} onClick={() => void resetDirectory()} />
                    <Button onClick={() => void chooseDirectory()}>{t('options.modelLocationChange')}</Button>
                </Row>
                {/* Offered whether or not a download failed: a file copied from another machine, or
                    kept from before a reinstall, need not be fetched again. */}
                <Row label={outcome && <Status tone={outcome.tone}>{outcome.text}</Status>}>
                    <Button onClick={() => void scan()} disabled={scanning}>
                        {t(scanning ? 'options.modelScanning' : 'options.modelScan')}
                    </Button>
                    {/* An earlier version's ONNX models and Python runtime count: nothing else would ever
                        remove them, and they are a few hundred MB this version cannot use. */}
                    {(installed.length > 0 || status.leftoverBytes > 0) && <Button onClick={() => setRemoveOpen(true)}>{t('options.modelRemoveAll')}</Button>}
                </Row>
                <Reveal when={anyFailed && manualLinks.length > 0}>
                    <Row
                        notice={(
                            <>
                                {t('options.modelManualHint')}
                                {status.manual?.note && <span className="block text-xs text-[color:var(--st-t2)]">{status.manual.note}</span>}
                            </>
                        )}
                    >
                        <Button onClick={() => setManualOpen(true)}>{t('options.modelManualLink')}</Button>
                    </Row>
                </Reveal>
            </FoldedGroup>

            {/* Each netdisk has its own extraction code, so each code sits under its own link. */}
            <ThemedDialog
                isOpen={manualOpen}
                onClose={() => setManualOpen(false)}
                isDaylight={isDaylight}
                title={t('options.modelManualTitle')}
                description={t('options.modelManualDialogDesc')}
            >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {manualLinks.map(link => (
                        <div key={link.url} className="flex flex-col items-center gap-3 rounded-2xl px-4 py-4 shadow-[0_0_0_1px_var(--st-line2)]">
                            <div className="text-sm text-[color:var(--st-t1)]">{link.label}</div>
                            <Button icon={ExternalLink} onClick={() => openOutsideLink(link.url)}>{t('options.modelManualOpen')}</Button>
                            {link.code && <CopyButton text={link.code}>{`${t('options.modelManualCode')} ${link.code}`}</CopyButton>}
                        </div>
                    ))}
                </div>
            </ThemedDialog>

            <ConfirmDialog
                isOpen={removeOpen}
                isDaylight={isDaylight}
                title={t('options.modelRemoveAll')}
                description={t('options.modelRemoveConfirm', {
                    // Everything the button deletes, an earlier version's leftovers included.
                    size: megabytes(installed.reduce((sum, model) => sum + model.bytes, status.leftoverBytes)),
                })}
                confirmVariant="danger"
                onConfirm={() => void removeAll()}
                onClose={() => setRemoveOpen(false)}
            />
        </>
    );
};

export default AutomixModelsGroup;
