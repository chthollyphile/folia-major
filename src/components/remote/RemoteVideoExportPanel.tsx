import React from 'react';
import { ChevronDown, Square } from 'lucide-react';
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
    onOpenPresetSelector: () => void;
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
    onOpenPresetSelector,
    onStartModeChange,
    sendCommand,
}) => {
    const selectedPreset = VIDEO_EXPORT_PRESETS.find(preset => preset.id === selectedPresetId) ?? VIDEO_EXPORT_PRESETS[1];
    const exportBusy = isExportBusy(exportState.status);
    const statusLabel = getExportStatusLabel(exportState);

    return (
        <div className="flex flex-col gap-2.5 w-full">
            {/* Row 1: Segment and Preset Button */}
            <div className="grid grid-cols-[1fr_1.1fr] gap-2.5">
                <div className="flex h-8 rounded-xl bg-white/5 p-0.5">
                    <button
                        type="button"
                        disabled={exportBusy}
                        onClick={() => onStartModeChange('from-start')}
                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            startMode === 'from-start' ? 'bg-white text-zinc-950 shadow-sm' : 'text-white/70 hover:bg-white/5 hover:text-white'
                        }`}
                    >
                        整首歌
                    </button>
                    <button
                        type="button"
                        disabled={exportBusy}
                        onClick={() => onStartModeChange('current')}
                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            startMode === 'current' ? 'bg-white text-zinc-950 shadow-sm' : 'text-white/70 hover:bg-white/5 hover:text-white'
                        }`}
                    >
                        从此
                    </button>
                </div>

                <button
                    type="button"
                    disabled={exportBusy}
                    onClick={onOpenPresetSelector}
                    className="flex h-8 items-center justify-between rounded-xl bg-white/5 px-3 text-[11px] font-bold text-white/90 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 border border-white/5"
                >
                    <span className="truncate">
                        {selectedPreset.orientation === 'portrait' ? '竖屏 ' : '横屏 '}
                        {selectedPreset.label}
                    </span>
                    <ChevronDown size={12} className="shrink-0 ml-1 opacity-60" />
                </button>
            </div>

            {/* Row 2: Status Error (if any) and Action Buttons */}
            {exportState.status === 'error' && exportState.error && (
                <div className="text-[10px] text-red-400 truncate -mt-1">{exportState.error}</div>
            )}
            {exportState.status === 'countdown' && (
                <div className="text-[10px] text-blue-400 font-semibold flex items-center gap-1.5 animate-pulse -mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                    即将开始录制 ({exportState.countdown}s)...
                </div>
            )}
            {exportState.status === 'preparing' && (
                <div className="text-[10px] text-amber-400 font-semibold flex items-center gap-1.5 animate-pulse -mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    正在准备录制环境...
                </div>
            )}
            {exportState.status === 'recording' && (
                <div className="text-[10px] text-red-500 font-semibold flex items-center gap-1.5 -mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                    视频录制中 ({Math.round(exportState.progress * 100)}%)
                </div>
            )}
            {exportState.status === 'finalizing' && (
                <div className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1.5 animate-pulse -mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    正在保存视频...
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
                            className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-[12px] font-bold text-zinc-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <Square size={10} fill="currentColor" />
                            停止并保存
                        </button>
                        <button
                            key="btn-cancel"
                            type="button"
                            onClick={() => sendCommand({ type: 'cancel-export' })}
                            className="h-8 rounded-xl bg-white/10 px-4 text-[12px] font-bold text-white transition hover:bg-white/15"
                        >
                            取消
                        </button>
                    </>
                ) : (
                    <button
                        key="btn-start"
                        type="button"
                        disabled={primaryDisabled}
                        onClick={() => sendCommand({ type: 'start-export', preset: selectedPreset as VideoExportPreset, startMode })}
                        className="h-8 w-full rounded-xl bg-white text-zinc-950 px-4 text-[12px] font-bold transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        {statusLabel === 'Ready' ? '开始录制' : statusLabel}
                    </button>
                )}
            </div>
        </div>
    );
};

export default RemoteVideoExportPanel;
