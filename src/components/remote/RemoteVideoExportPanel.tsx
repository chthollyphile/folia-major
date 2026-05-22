import React from 'react';
import { Download, Square } from 'lucide-react';
import type { RemoteControlCommand } from '../../types/remoteControl';
import { VIDEO_EXPORT_PRESETS } from '../../types/videoExport';
import type { VideoExportPreset, VideoExportStartMode, VideoExportState } from '../../types/videoExport';

// src/components/remote/RemoteVideoExportPanel.tsx
// Export controls live only in the uncaptured remote window.
type RemoteVideoExportPanelProps = {
    exportState: VideoExportState;
    selectedPresetId: string;
    startMode: VideoExportStartMode;
    primaryDisabled: boolean;
    onSelectPreset: (presetId: string) => void;
    onStartModeChange: (mode: VideoExportStartMode) => void;
    sendCommand: (command: RemoteControlCommand) => void;
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
    selectedPresetId,
    startMode,
    primaryDisabled,
    onSelectPreset,
    onStartModeChange,
    sendCommand,
}) => {
    const selectedPreset = VIDEO_EXPORT_PRESETS.find(preset => preset.id === selectedPresetId) ?? VIDEO_EXPORT_PRESETS[1];
    const exportBusy = isExportBusy(exportState.status);

    return (
        <section className="border-t border-white/10 px-4 py-3">
            <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/45">
                    Video Export
                </div>
                <div className="text-[11px] tabular-nums text-white/55">{getExportStatusLabel(exportState)}</div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5">
                {VIDEO_EXPORT_PRESETS.map(preset => (
                    <button
                        key={preset.id}
                        type="button"
                        disabled={exportBusy}
                        onClick={() => onSelectPreset(preset.id)}
                        className={`rounded-md px-2 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${preset.id === selectedPresetId ? 'bg-white text-zinc-950' : 'bg-white/8 text-white/70 hover:bg-white/14'}`}
                    >
                        {preset.label}
                    </button>
                ))}
            </div>

            <div className="mt-2 flex rounded-lg bg-white/8 p-1">
                <button
                    type="button"
                    disabled={exportBusy}
                    onClick={() => onStartModeChange('from-start')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${startMode === 'from-start' ? 'bg-white text-zinc-950' : 'text-white/65 hover:bg-white/10'}`}
                >
                    Full song
                </button>
                <button
                    type="button"
                    disabled={exportBusy}
                    onClick={() => onStartModeChange('current')}
                    className={`flex-1 rounded-md px-2 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${startMode === 'current' ? 'bg-white text-zinc-950' : 'text-white/65 hover:bg-white/10'}`}
                >
                    From here
                </button>
            </div>

            {exportState.status === 'error' && exportState.error && (
                <div className="mt-2 max-h-8 overflow-hidden text-[11px] text-red-300">{exportState.error}</div>
            )}

            <div className="mt-3 flex gap-2">
                {exportBusy ? (
                    <>
                        <button
                            type="button"
                            disabled={exportState.status !== 'recording'}
                            onClick={() => sendCommand({ type: 'stop-export' })}
                            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Square size={13} />
                            Stop & Save
                        </button>
                        <button
                            type="button"
                            onClick={() => sendCommand({ type: 'cancel-export' })}
                            className="rounded-lg bg-white/8 px-3 py-2 text-xs font-semibold text-white/70 transition hover:bg-white/14"
                        >
                            Cancel
                        </button>
                    </>
                ) : (
                    <button
                        type="button"
                        disabled={primaryDisabled}
                        onClick={() => sendCommand({ type: 'start-export', preset: selectedPreset as VideoExportPreset, startMode })}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        <Download size={14} />
                        Countdown & Record
                    </button>
                )}
            </div>
        </section>
    );
};

export default RemoteVideoExportPanel;

