import React, { useEffect, useMemo, useState } from 'react';
import { Download, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { PlayerState } from '../../types';
import RemoteVideoExportPanel from './RemoteVideoExportPanel';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../../types/remoteControl';
import { DEFAULT_VIDEO_EXPORT_PRESET_ID, idleVideoExportState } from '../../types/videoExport';
import type { VideoExportStartMode } from '../../types/videoExport';

// src/components/remote/RemoteControlApp.tsx
// Electron-only companion window for controlling the single real player instance.
const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0:00';
    }

    const totalSeconds = Math.floor(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const rest = totalSeconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
};

const sendCommand = (command: RemoteControlCommand) => {
    void window.electron?.sendRemoteControlCommand(command);
};

const emptySnapshot: RemoteControlSnapshot = {
    hasTrack: false,
    title: null,
    artist: null,
    coverUrl: null,
    currentTime: 0,
    duration: 0,
    playerState: PlayerState.IDLE,
    canGoPrevious: false,
    canGoNext: false,
    controlsDisabled: true,
    isStageActive: false,
    exportState: idleVideoExportState(),
    updatedAt: 0,
};

const RemoteControlApp: React.FC = () => {
    const [snapshot, setSnapshot] = useState<RemoteControlSnapshot>(emptySnapshot);
    const [pendingSeek, setPendingSeek] = useState<number | null>(null);
    const [exportPanelOpen, setExportPanelOpen] = useState(false);
    const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_VIDEO_EXPORT_PRESET_ID);
    const [startMode, setStartMode] = useState<VideoExportStartMode>('from-start');

    useEffect(() => {
        let mounted = true;

        void window.electron?.getRemoteControlSnapshot?.().then(current => {
            if (mounted && current) {
                setSnapshot(current as RemoteControlSnapshot);
            }
        });

        const unsubscribe = window.electron?.onRemoteControlSnapshot?.(next => {
            setSnapshot(next as RemoteControlSnapshot);
            setPendingSeek(null);
        });

        return () => {
            mounted = false;
            unsubscribe?.();
        };
    }, []);

    const currentTime = pendingSeek ?? snapshot.currentTime;
    const duration = Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : 0;
    const progressValue = duration > 0 ? Math.max(0, Math.min(currentTime, duration)) : 0;
    const isPlaying = snapshot.playerState === PlayerState.PLAYING;
    const primaryDisabled = snapshot.controlsDisabled || !snapshot.hasTrack;
    const title = snapshot.title || 'Folia';
    const artist = snapshot.artist || (snapshot.hasTrack ? 'Unknown artist' : 'No active track');
    const exportState = snapshot.exportState ?? idleVideoExportState();
    const coverStyle = useMemo<React.CSSProperties>(() => ({
        backgroundImage: snapshot.coverUrl ? `url(${snapshot.coverUrl})` : undefined,
    }), [snapshot.coverUrl]);

    return (
        <main className="flex h-screen w-screen flex-col overflow-hidden bg-zinc-950 text-white">
            <header
                className="flex h-8 shrink-0 items-center justify-between border-b border-white/10 px-3"
                style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            >
                <div className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                    Folia Remote
                </div>
                <button
                    type="button"
                    title="Close"
                    onClick={() => void window.electron?.closeRemoteControl?.()}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-white/55 transition hover:bg-white/10 hover:text-white"
                    style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                >
                    <X size={14} />
                </button>
            </header>

            <section className="flex min-h-0 flex-1 gap-3 p-4">
                <div
                    className="h-20 w-20 shrink-0 rounded-lg bg-zinc-800 bg-cover bg-center shadow-lg"
                    style={coverStyle}
                >
                    {!snapshot.coverUrl && (
                        <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-white/45">
                            F
                        </div>
                    )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col justify-between">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold leading-5">{title}</div>
                        <div className="mt-1 truncate text-xs text-white/55">{artist}</div>
                    </div>

                    <div>
                        <input
                            aria-label="Seek"
                            type="range"
                            min={0}
                            max={duration || 1}
                            step={0.1}
                            value={progressValue}
                            disabled={primaryDisabled || duration <= 0}
                            onChange={(event) => setPendingSeek(Number(event.currentTarget.value))}
                            onPointerUp={() => {
                                if (pendingSeek !== null) {
                                    sendCommand({ type: 'seek', time: pendingSeek });
                                }
                            }}
                            onKeyUp={(event) => {
                                if (event.key === 'Enter' && pendingSeek !== null) {
                                    sendCommand({ type: 'seek', time: pendingSeek });
                                }
                            }}
                            className="h-1.5 w-full accent-white disabled:opacity-35"
                        />
                        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-white/45">
                            <span>{formatTime(progressValue)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>
                    </div>
                </div>
            </section>

            {exportPanelOpen && (
                <RemoteVideoExportPanel
                    exportState={exportState}
                    selectedPresetId={selectedPresetId}
                    startMode={startMode}
                    primaryDisabled={primaryDisabled}
                    onSelectPreset={setSelectedPresetId}
                    onStartModeChange={setStartMode}
                    sendCommand={sendCommand}
                />
            )}

            <section className="flex h-16 items-center justify-between border-t border-white/10 px-4">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        title="Previous"
                        disabled={primaryDisabled || !snapshot.canGoPrevious}
                        onClick={() => sendCommand({ type: 'previous' })}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/8 text-white/75 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <SkipBack size={17} />
                    </button>
                    <button
                        type="button"
                        title={isPlaying ? 'Pause' : 'Play'}
                        disabled={primaryDisabled}
                        onClick={() => sendCommand({ type: 'play-pause' })}
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-zinc-950 transition hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </button>
                    <button
                        type="button"
                        title="Next"
                        disabled={primaryDisabled || !snapshot.canGoNext}
                        onClick={() => sendCommand({ type: 'next' })}
                        className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/8 text-white/75 transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-35"
                    >
                        <SkipForward size={17} />
                    </button>
                </div>

                <button
                    type="button"
                    title="Video export"
                    disabled={!snapshot.hasTrack}
                    onClick={() => setExportPanelOpen(prev => !prev)}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-white/14 disabled:cursor-not-allowed disabled:opacity-35 ${exportPanelOpen ? 'bg-white text-zinc-950' : 'bg-white/8 text-white/75'}`}
                >
                    <Download size={16} />
                </button>
            </section>
        </main>
    );
};

export default RemoteControlApp;
