import React from 'react';
import { ChevronDown, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RemoteControlCommand } from '../../types/remoteControl';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from '../../types/videoExport';

// src/components/remote/RemoteVideoExportPanel.tsx
// Export controls live only in the uncaptured remote window.
type RemoteVideoExportPanelProps = {
    exportState: VideoExportState;
    selectedPreset: VideoExportPreset;
    startMode: VideoExportStartMode;
    primaryDisabled: boolean;
    onOpenPresetSelector: () => void;
    onStartModeChange: (mode: VideoExportStartMode) => void;
    sendCommand: (command: RemoteControlCommand) => void;
    isDaylight?: boolean;
};

const isExportBusy = (status: VideoExportState['status']) => (
    status === 'preparing' ||
    status === 'countdown' ||
    status === 'recording' ||
    status === 'finalizing'
);

const getExportStatusLabel = (exportState: VideoExportState) => {
    if (exportState.status === 'countdown') {
        return `${exportState.countdown ?? ''}`;
    }

    if (exportState.status === 'recording') {
        return `${Math.round(exportState.progress * 100)}%`;
    }

    if (exportState.status === 'done') {
        return 'Saved';
    }

    if (exportState.status === 'error') {
        return 'Error';
    }

    if (exportState.status === 'finalizing') {
        return 'Saving';
    }

    if (exportState.status === 'preparing') {
        return 'Preparing';
    }

    return 'Ready';
};

const RemoteVideoExportPanel: React.FC<RemoteVideoExportPanelProps> = ({
    exportState,
    selectedPreset,
    startMode,
    primaryDisabled,
    onOpenPresetSelector,
    onStartModeChange,
    sendCommand,
    isDaylight = false,
}) => {
    const { t } = useTranslation();
    const exportBusy = isExportBusy(exportState.status);
    const statusLabel = getExportStatusLabel(exportState);

    return (
        <div className="flex flex-col gap-2.5 w-full">
            {/* Row 1: Segment and Preset Button */}
            <div className="grid grid-cols-[1fr_1.1fr] gap-2.5">
                <div className={`flex h-8 rounded-xl p-0.5 transition-colors ${isDaylight ? 'bg-black/5' : 'bg-white/5'}`}>
                    <button
                        type="button"
                        disabled={exportBusy}
                        onClick={() => onStartModeChange('from-start')}
                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            startMode === 'from-start'
                                ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                        }`}
                    >
                        {t('remote.exportFullSong')}
                    </button>
                    <button
                        type="button"
                        disabled={exportBusy}
                        onClick={() => onStartModeChange('current')}
                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            startMode === 'current'
                                ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                        }`}
                    >
                        {t('remote.exportFromHere')}
                    </button>
                </div>

                <button
                    type="button"
                    disabled={exportBusy}
                    onClick={onOpenPresetSelector}
                    className={`flex h-8 items-center justify-between rounded-xl px-3 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 border ${
                        isDaylight
                            ? 'bg-black/5 border-black/5 text-black/90 hover:bg-black/10'
                            : 'bg-white/5 border-white/5 text-white/90 hover:bg-white/10'
                    }`}
                >
                    <span className="truncate">
                        {selectedPreset.orientation === 'portrait' ? t('remote.portrait') : t('remote.landscape')}
                        {selectedPreset.label}
                    </span>
                    <ChevronDown size={12} className="shrink-0 ml-1 opacity-60" />
                </button>
            </div>

            {/* Row 2: Status Error (if any) and Action Buttons */}
            {exportState.status === 'error' && exportState.error && (
                <div className={`text-[10px] truncate -mt-1 font-semibold ${isDaylight ? 'text-red-600' : 'text-red-400'}`}>
                    {exportState.error}
                </div>
            )}
            {exportState.status === 'countdown' && (
                <div className={`text-[10px] font-semibold flex items-center gap-1.5 animate-pulse -mt-1 ${isDaylight ? 'text-blue-600' : 'text-blue-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isDaylight ? 'bg-blue-600' : 'bg-blue-400'}`} />
                    {t('remote.recordingCountdown', { countdown: exportState.countdown })}
                </div>
            )}
            {exportState.status === 'preparing' && (
                <div className={`text-[10px] font-semibold flex items-center gap-1.5 animate-pulse -mt-1 ${isDaylight ? 'text-amber-600' : 'text-amber-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isDaylight ? 'bg-amber-600' : 'bg-amber-400'}`} />
                    {t('remote.preparingEnvironment')}
                </div>
            )}
            {exportState.status === 'recording' && (
                <div className={`text-[10px] font-semibold flex items-center gap-1.5 -mt-1 ${isDaylight ? 'text-red-600' : 'text-red-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full animate-ping ${isDaylight ? 'bg-red-600' : 'bg-red-500'}`} />
                    {t('remote.recordingProgress', { progress: Math.round(exportState.progress * 100) })}
                </div>
            )}
            {exportState.status === 'finalizing' && (
                <div className={`text-[10px] font-semibold flex items-center gap-1.5 animate-pulse -mt-1 ${isDaylight ? 'text-emerald-600' : 'text-emerald-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isDaylight ? 'bg-emerald-600' : 'bg-emerald-400'}`} />
                    {t('remote.savingVideo')}
                </div>
            )}

            <div className="flex gap-2">
                {exportBusy ? (
                    <>
                        <button
                            key="btn-stop"
                            type="button"
                            disabled={exportState.status !== 'recording'}
                            onClick={() => sendCommand({ type: 'stop-export' })}
                            className={`flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl px-4 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                isDaylight
                                    ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                    : 'bg-white text-zinc-950 hover:bg-white/90'
                            }`}
                        >
                            <Square size={10} fill="currentColor" />
                            {t('remote.stopAndSave')}
                        </button>
                        <button
                            key="btn-cancel"
                            type="button"
                            onClick={() => sendCommand({ type: 'cancel-export' })}
                            className={`h-8 rounded-xl px-4 text-[12px] font-bold transition ${
                                isDaylight
                                    ? 'bg-black/10 text-black hover:bg-black/15'
                                    : 'bg-white/10 text-white hover:bg-white/15'
                            }`}
                        >
                            {t('remote.cancel')}
                        </button>
                    </>
                ) : (
                    <button
                        key="btn-start"
                        type="button"
                        disabled={primaryDisabled}
                        onClick={() => sendCommand({ type: 'start-export', preset: selectedPreset, startMode })}
                        className={`h-8 w-full rounded-xl px-4 text-[12px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${
                            isDaylight
                                ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                : 'bg-white text-zinc-950 hover:bg-white/90'
                        }`}
                    >
                        {statusLabel === 'Ready' ? t('remote.startRecording') : (statusLabel === 'Saved' ? t('remote.saved') : (statusLabel === 'Error' ? t('remote.error') : (statusLabel === 'Saving' ? t('remote.saving') : (statusLabel === 'Preparing' ? t('remote.preparing') : statusLabel))))}
                    </button>
                )}
            </div>
        </div>
    );
};

export default RemoteVideoExportPanel;
