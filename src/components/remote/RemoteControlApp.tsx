import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Pause, Pin, PinOff, Play, SkipBack, SkipForward, Video, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerState } from '../../types';
import RemoteVideoExportPanel from './RemoteVideoExportPanel';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../../types/remoteControl';
import { DEFAULT_VIDEO_EXPORT_PRESET_ID, idleVideoExportState, VIDEO_EXPORT_PRESETS } from '../../types/videoExport';
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
    const [presetSelectorOpen, setPresetSelectorOpen] = useState(false);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);
    const [windowControlsRevealed, setWindowControlsRevealed] = useState(false);

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
    }, []);

    useEffect(() => {
        let mounted = true;

        void window.electron?.getRemoteControlSnapshot?.().then(current => {
            if (mounted && current) {
                setSnapshot(current as RemoteControlSnapshot);
            }
        });

        void window.electron?.getRemoteControlAlwaysOnTop?.().then(nextAlwaysOnTop => {
            if (mounted) {
                setAlwaysOnTop(Boolean(nextAlwaysOnTop));
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

    const lastStatusRef = React.useRef(exportState.status);
    useEffect(() => {
        if (exportState.status !== 'idle' && lastStatusRef.current === 'idle') {
            setExportPanelOpen(true);
        }
        lastStatusRef.current = exportState.status;
    }, [exportState.status]);
    
    const coverStyle = useMemo<React.CSSProperties>(() => ({
        backgroundImage: snapshot.coverUrl ? `url(${snapshot.coverUrl})` : undefined,
    }), [snapshot.coverUrl]);
    
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
    
    const progressPercent = duration > 0 ? (progressValue / duration) * 100 : 0;

    const handleToggleAlwaysOnTop = () => {
        const nextAlwaysOnTop = !alwaysOnTop;
        setAlwaysOnTop(nextAlwaysOnTop);
        void window.electron?.setRemoteControlAlwaysOnTop?.(nextAlwaysOnTop).then(actualAlwaysOnTop => {
            setAlwaysOnTop(Boolean(actualAlwaysOnTop));
        }).catch(() => {
            setAlwaysOnTop(!nextAlwaysOnTop);
        });
    };

    return (
        <main
            className="h-screen w-screen overflow-hidden bg-transparent text-white p-1 select-none"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            onMouseEnter={() => setWindowControlsRevealed(true)}
            onMouseLeave={() => setWindowControlsRevealed(false)}
        >
            <div className="relative flex h-full w-full rounded-[20px] border border-white/10 p-4 shadow-2xl items-center justify-center overflow-hidden">
                {/* Blurry gradient background */}
                <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                    {/* Deep dark blue-black base */}
                    <div className="absolute inset-0 bg-[#060814]" />
                    {/* Deep blue blurry blob top-left */}
                    <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-blue-600/20 blur-[40px]" />
                    {/* Dark indigo/purple blurry blob bottom-right */}
                    <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-indigo-500/15 blur-[50px]" />
                    {/* Soft cyan/sky center highlight */}
                    <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full bg-sky-500/10 blur-[30px]" />
                </div>

                <div
                    className={`absolute right-2.5 top-2.5 z-20 flex items-center gap-1 transition duration-200 ${
                        windowControlsRevealed ? 'opacity-100' : 'opacity-0'
                    }`}
                    style={noDragStyle}
                    onFocus={() => setWindowControlsRevealed(true)}
                    onMouseEnter={() => setWindowControlsRevealed(true)}
                >
                    <button
                        type="button"
                        title={alwaysOnTop ? '取消置顶' : '固定到最前'}
                        aria-pressed={alwaysOnTop}
                        tabIndex={windowControlsRevealed ? 0 : -1}
                        onClick={handleToggleAlwaysOnTop}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-white/30 transition hover:bg-white/10 hover:text-white/80"
                    >
                        {alwaysOnTop ? <Pin size={13} /> : <PinOff size={13} />}
                    </button>
                    <button
                        type="button"
                        title="Close"
                        tabIndex={windowControlsRevealed ? 0 : -1}
                        onClick={() => void window.electron?.closeRemoteControl?.()}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-white/30 transition hover:bg-white/10 hover:text-white/80"
                    >
                        <X size={13} />
                    </button>
                </div>

                <div className="w-full flex items-center" style={noDragStyle}>
                    <div className="grid grid-cols-[112px_1fr] gap-4 w-full items-center">
                        {/* Left Column: Cover Art with Hover Back Overlay */}
                        <div className="relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-zinc-800 bg-cover bg-center shadow-md border border-white/5 group">
                            {!snapshot.coverUrl && (
                                <div className="flex h-full w-full items-center justify-center text-3xl font-bold text-white/35">
                                    F
                                </div>
                            )}
                            {snapshot.coverUrl && (
                                <div
                                    className="h-full w-full bg-cover bg-center"
                                    style={coverStyle}
                                />
                            )}
                            {exportPanelOpen && (
                                <button
                                    type="button"
                                    title="Back"
                                    onClick={() => setExportPanelOpen(false)}
                                    className="absolute inset-0 flex items-center justify-center bg-zinc-950/65 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl backdrop-blur-sm"
                                >
                                    <ChevronLeft size={24} strokeWidth={2.5} />
                                </button>
                            )}
                            <AnimatePresence mode="popLayout">
                                {exportState.status === 'countdown' && (
                                    <motion.div
                                        key={`countdown-${exportState.countdown}`}
                                        initial={{ opacity: 0, scale: 0.3 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        exit={{ opacity: 0, scale: 1.8 }}
                                        transition={{ duration: 0.35, ease: 'easeOut' }}
                                        className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 rounded-xl backdrop-blur-[2px] z-30"
                                    >
                                        <span className="text-4xl font-black text-white tracking-tighter tabular-nums drop-shadow-[0_0_12px_rgba(255,255,255,0.45)]">
                                            {exportState.countdown}
                                        </span>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Right Column: Track details & controls (Playback or Export) */}
                        <div className="flex flex-col justify-between min-h-[112px] min-w-0">
                            {/* Static Title & Artist */}
                            <div className="min-w-0 pr-6">
                                <div className="truncate text-[15px] font-bold leading-5 tracking-[-0.01em]">{title}</div>
                                <div className="truncate text-xs font-medium text-white/40 mt-0.5">{artist}</div>
                            </div>

                            {/* Dynamic Panel with Framer Motion transitions */}
                            <div className="relative min-h-[70px] w-full">
                                <AnimatePresence mode="wait">
                                    {!exportPanelOpen ? (
                                        <motion.div
                                            key="playback-panel"
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            transition={{ duration: 0.15 }}
                                            className="w-full flex flex-col justify-between h-[70px]"
                                        >
                                            {/* Progress Slider */}
                                            <div className="w-full">
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
                                                    className="h-[3px] w-full appearance-none rounded-full cursor-pointer focus:outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-0 [&::-webkit-slider-thumb]:h-0 [&::-moz-range-thumb]:w-0 [&::-moz-range-thumb]:h-0 [&::-webkit-slider-runnable-track]:bg-transparent disabled:opacity-50 disabled:cursor-not-allowed"
                                                    style={{
                                                        background: `linear-gradient(to right, #ffffff 0%, #ffffff ${progressPercent}%, rgba(255, 255, 255, 0.15) ${progressPercent}%, rgba(255, 255, 255, 0.15) 100%)`
                                                    }}
                                                />
                                                <div className="mt-1 flex justify-between text-[10px] tabular-nums text-white/30">
                                                    <span>{formatTime(progressValue)}</span>
                                                    <span>{formatTime(duration)}</span>
                                                </div>
                                            </div>

                                            {/* Playback Actions */}
                                            <div className="flex w-full items-center justify-between">
                                                <div className="flex items-center gap-1.5">
                                                    <button
                                                        type="button"
                                                        title="Previous"
                                                        disabled={primaryDisabled || !snapshot.canGoPrevious}
                                                        onClick={() => sendCommand({ type: 'previous' })}
                                                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                                                    >
                                                        <SkipBack size={16} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={isPlaying ? 'Pause' : 'Play'}
                                                        disabled={primaryDisabled}
                                                        onClick={() => sendCommand({ type: 'play-pause' })}
                                                        className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-zinc-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-35"
                                                    >
                                                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} className="translate-x-0.5" fill="currentColor" />}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title="Next"
                                                        disabled={primaryDisabled || !snapshot.canGoNext}
                                                        onClick={() => sendCommand({ type: 'next' })}
                                                        className="flex h-8 w-8 items-center justify-center rounded-full bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                                                    >
                                                        <SkipForward size={16} strokeWidth={2} />
                                                    </button>
                                                </div>
                                                <button
                                                    type="button"
                                                    title="Video export"
                                                    disabled={!snapshot.hasTrack}
                                                    onClick={() => setExportPanelOpen(true)}
                                                    className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                                        exportState.status === 'recording'
                                                            ? 'bg-red-500/25 text-red-400 animate-pulse border border-red-500/30'
                                                            : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                                    }`}
                                                >
                                                    <Video size={16} strokeWidth={2} />
                                                </button>
                                            </div>
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="export-panel"
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            transition={{ duration: 0.15 }}
                                            className="w-full flex flex-col"
                                        >
                                            <RemoteVideoExportPanel
                                                exportState={exportState}
                                                selectedPresetId={selectedPresetId}
                                                startMode={startMode}
                                                primaryDisabled={primaryDisabled}
                                                onOpenPresetSelector={() => setPresetSelectorOpen(true)}
                                                onStartModeChange={setStartMode}
                                                sendCommand={sendCommand}
                                            />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Root-Level Preset Selector Overlay Modal */}
                <AnimatePresence>
                    {presetSelectorOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.15 }}
                            className="absolute inset-0 z-50 flex flex-col p-4 rounded-[20px] shadow-2xl border border-white/10 overflow-hidden"
                            style={noDragStyle}
                        >
                            {/* Blurry gradient background for modal */}
                            <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                                {/* Deep dark blue-black base */}
                                <div className="absolute inset-0 bg-[#060814]/95 backdrop-blur-md" />
                                {/* Deep blue blurry blob top-left */}
                                <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-blue-600/20 blur-[40px]" />
                                {/* Dark indigo/purple blurry blob bottom-right */}
                                <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-indigo-500/15 blur-[50px]" />
                            </div>
                            <div className="flex items-center justify-between mb-2.5">
                                <span className="text-[13px] font-bold text-white/90">选择导出预设</span>
                                <button
                                    type="button"
                                    onClick={() => setPresetSelectorOpen(false)}
                                    className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-white/50 hover:bg-white/10 hover:text-white transition"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-0.5 py-1 flex-1">
                                {VIDEO_EXPORT_PRESETS.map(preset => {
                                    const isSelected = preset.id === selectedPresetId;
                                    return (
                                        <button
                                            key={preset.id}
                                            type="button"
                                            role="option"
                                            aria-selected={isSelected}
                                            onClick={() => {
                                                setSelectedPresetId(preset.id);
                                                setPresetSelectorOpen(false);
                                            }}
                                            className={`flex flex-col items-start justify-center rounded-xl p-2.5 px-3.5 border transition text-left cursor-pointer ${
                                                isSelected
                                                    ? 'bg-white border-white text-zinc-950 shadow-md font-bold'
                                                    : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/10 font-medium'
                                            }`}
                                        >
                                            <span className="text-[9px] opacity-60 font-semibold mb-0.5 tracking-wide uppercase">
                                                {preset.orientation === 'portrait' ? '竖屏 9:16' : '横屏 16:9'}
                                            </span>
                                            <span className="text-xs font-semibold">{preset.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </main>
    );
};

export default RemoteControlApp;
