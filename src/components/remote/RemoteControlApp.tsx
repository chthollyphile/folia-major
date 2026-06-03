import React, { useEffect, useMemo, useState, useRef } from 'react';
import { ChevronLeft, Lock, LockOpen, Pause, Pin, PinOff, Play, SkipBack, SkipForward, Video, MirrorRectangular, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerState } from '../../types';
import RemoteVideoExportPanel from './RemoteVideoExportPanel';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../../types/remoteControl';
import { DEFAULT_VIDEO_EXPORT_PRESET_ID, idleVideoExportState, VIDEO_EXPORT_PRESETS } from '../../types/videoExport';
import type { VideoExportStartMode } from '../../types/videoExport';
import { findLatestActiveLineIndex } from '../../utils/appPlaybackHelpers';

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

const REMOTE_CONTROL_DOCUMENT_TITLE = 'Folia Remote';

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
    transparentModeEnabled: false,
    mainWindowClickThroughEnabled: false,
    mainWindowAlwaysOnTop: false,
    mainWindowBorderVisible: false,
    playerChromeHidden: false,
    exportState: idleVideoExportState(),
    isDaylight: false,
    lyrics: null,
    updatedAt: 0,
};

type RemotePanelMode = 'playback' | 'export' | 'transparent-controls';

const RemoteControlApp: React.FC = () => {
    const [snapshot, setSnapshot] = useState<RemoteControlSnapshot>(emptySnapshot);
    const [pendingSeek, setPendingSeek] = useState<number | null>(null);
    const [activePanel, setActivePanel] = useState<RemotePanelMode>('playback');
    const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_VIDEO_EXPORT_PRESET_ID);
    const [startMode, setStartMode] = useState<VideoExportStartMode>('from-start');
    const [presetSelectorOpen, setPresetSelectorOpen] = useState(false);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);
    const [windowControlsRevealed, setWindowControlsRevealed] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [showLyricsOverlay, setShowLyricsOverlay] = useState(false);
    const [interpolatedTime, setInterpolatedTime] = useState(0);
    const lastSyncRef = useRef({ snapshotTime: 0, localTime: 0 });

    useEffect(() => {
        lastSyncRef.current = {
            snapshotTime: snapshot.currentTime,
            localTime: performance.now(),
        };
        setInterpolatedTime(snapshot.currentTime);
    }, [snapshot.currentTime, snapshot.playerState]);

    useEffect(() => {
        if (snapshot.playerState !== PlayerState.PLAYING) {
            return;
        }

        let frameId: number;
        const tick = () => {
            const elapsed = (performance.now() - lastSyncRef.current.localTime) / 1000;
            const nextTime = Math.min(snapshot.duration, lastSyncRef.current.snapshotTime + elapsed);
            setInterpolatedTime(nextTime);
            frameId = requestAnimationFrame(tick);
        };

        frameId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frameId);
    }, [snapshot.playerState, snapshot.duration]);

    useEffect(() => {
        if (isHovered) {
            setShowLyricsOverlay(false);
            return;
        }

        const timer = setTimeout(() => {
            setShowLyricsOverlay(true);
        }, 1200);

        return () => clearTimeout(timer);
    }, [isHovered]);

    const currentLyricInfo = useMemo(() => {
        let currentLine = null;
        let nextLine = null;
        if (snapshot.lyrics && snapshot.lyrics.lines.length > 0) {
            const index = findLatestActiveLineIndex(snapshot.lyrics.lines, interpolatedTime);
            if (index !== -1) {
                currentLine = snapshot.lyrics.lines[index];
                nextLine = snapshot.lyrics.lines[index + 1] || null;
            } else {
                const upcomingIndex = snapshot.lyrics.lines.findIndex(line => line.startTime > interpolatedTime);
                if (upcomingIndex !== -1) {
                    nextLine = snapshot.lyrics.lines[upcomingIndex];
                }
            }
        }
        return { currentLine, nextLine };
    }, [snapshot.lyrics, interpolatedTime]);

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'visible';
        document.title = REMOTE_CONTROL_DOCUMENT_TITLE;
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
    const isDaylight = Boolean(snapshot.isDaylight);

    const baseColor = isDaylight ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.35)';
    const activeColor = isDaylight ? '#1c1917' : '#ffffff';

    const lastStatusRef = React.useRef(exportState.status);
    useEffect(() => {
        if (exportState.status !== 'idle' && lastStatusRef.current === 'idle') {
            setActivePanel('export');
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
            className={`h-screen w-screen bg-transparent p-1 select-none transition-colors duration-300 ${
                isDaylight ? 'text-zinc-900' : 'text-white'
            }`}
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            onMouseEnter={() => {
                setWindowControlsRevealed(true);
                setIsHovered(true);
            }}
            onMouseLeave={() => {
                setWindowControlsRevealed(false);
                setIsHovered(false);
            }}
        >
            <div className={`relative flex h-full w-full rounded-[20px] border p-4 items-center justify-center overflow-hidden transition-colors duration-300 ${
                isDaylight ? 'border-black/10' : 'border-white/10'
            }`}>
                {/* Blurry gradient background */}
                <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                    {/* Base layer */}
                    <div className={`absolute inset-0 transition-colors duration-300 ${isDaylight ? 'bg-[#f5f5f4]' : 'bg-[#060814]'}`} />
                    
                    {/* Blurry blobs */}
                    {isDaylight ? (
                        <>
                            {/* Soft orange blurry blob top-left */}
                            <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-orange-400/20 blur-[40px] transition-all duration-300" />
                            {/* Soft rose/pink blurry blob bottom-right */}
                            <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-rose-300/20 blur-[50px] transition-all duration-300" />
                            {/* Soft sky center highlight */}
                            <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full bg-sky-300/20 blur-[30px] transition-all duration-300" />
                        </>
                    ) : (
                        <>
                            {/* Deep blue blurry blob top-left */}
                            <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-blue-600/20 blur-[40px] transition-all duration-300" />
                            {/* Dark indigo/purple blurry blob bottom-right */}
                            <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-indigo-500/15 blur-[50px] transition-all duration-300" />
                            {/* Soft cyan/sky center highlight */}
                            <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full bg-sky-500/10 blur-[30px] transition-all duration-300" />
                        </>
                    )}
                </div>

                <div
                    className={`absolute right-2.5 top-2.5 z-20 flex items-center gap-1 transition duration-200 ${
                        windowControlsRevealed ? 'opacity-100' : 'opacity-0'
                    }`}
                    style={noDragStyle}
                    onFocus={() => {
                        setWindowControlsRevealed(true);
                        setIsHovered(true);
                    }}
                    onMouseEnter={() => {
                        setWindowControlsRevealed(true);
                        setIsHovered(true);
                    }}
                >
                    <button
                        type="button"
                        title={alwaysOnTop ? '取消置顶' : '固定到最前'}
                        aria-pressed={alwaysOnTop}
                        tabIndex={windowControlsRevealed ? 0 : -1}
                        onClick={handleToggleAlwaysOnTop}
                        className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                            isDaylight
                                ? 'text-black/30 hover:bg-black/10 hover:text-black/80'
                                : 'text-white/30 hover:bg-white/10 hover:text-white/80'
                        }`}
                    >
                        {alwaysOnTop ? <Pin size={13} /> : <PinOff size={13} />}
                    </button>
                    <button
                        type="button"
                        title="Close"
                        tabIndex={windowControlsRevealed ? 0 : -1}
                        onClick={() => void window.electron?.closeRemoteControl?.()}
                        className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                            isDaylight
                                ? 'text-black/30 hover:bg-black/10 hover:text-black/80'
                                : 'text-white/30 hover:bg-white/10 hover:text-white/80'
                        }`}
                    >
                        <X size={13} />
                    </button>
                </div>

                <div className="w-full flex items-center" style={noDragStyle}>
                    <div className="grid grid-cols-[112px_1fr] gap-4 w-full items-center">
                        {/* Left Column: Cover Art with Hover Back Overlay */}
                        <div className={`relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-cover bg-center shadow-md group transition-all duration-300 ${
                            isDaylight ? 'bg-zinc-200 border border-black/5' : 'bg-zinc-800 border border-white/5'
                        }`}>
                            {!snapshot.coverUrl && (
                                <div className={`flex h-full w-full items-center justify-center text-3xl font-bold transition-colors duration-300 ${
                                    isDaylight ? 'text-black/35' : 'text-white/35'
                                }`}>
                                    F
                                </div>
                            )}
                            {snapshot.coverUrl && (
                                <div
                                    className="h-full w-full bg-cover bg-center"
                                    style={coverStyle}
                                />
                            )}
                            {activePanel !== 'playback' && (
                                <button
                                    type="button"
                                    title="Back"
                                    onClick={() => {
                                        setActivePanel('playback');
                                        setPresetSelectorOpen(false);
                                    }}
                                    className={`absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl backdrop-blur-sm ${
                                        isDaylight ? 'bg-stone-900/65 text-white' : 'bg-zinc-950/65 text-white'
                                    }`}
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
                                        className={`absolute inset-0 flex items-center justify-center rounded-xl backdrop-blur-[2px] z-30 ${
                                            isDaylight ? 'bg-stone-950/70' : 'bg-zinc-950/80'
                                        }`}
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
                                <div className={`truncate text-xs font-medium mt-0.5 transition-colors ${
                                    isDaylight ? 'text-black/50' : 'text-white/40'
                                }`}>{artist}</div>
                            </div>

                            {/* Dynamic Panel with Framer Motion transitions */}
                            <div className="relative min-h-[70px] w-full">
                                <AnimatePresence mode="wait">
                                    {activePanel === 'playback' ? (
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
                                                <div className="relative w-full h-5 flex items-center" style={noDragStyle}>
                                                    {/* Visible Track Background */}
                                                    <div className={`w-full h-[3px] rounded-full transition-colors overflow-hidden ${
                                                        isDaylight ? 'bg-black/10' : 'bg-white/15'
                                                    }`}>
                                                        {/* Visible Progress Fill */}
                                                        <div 
                                                            className={`h-full rounded-full transition-all duration-75 ${
                                                                isDaylight ? 'bg-[#1c1917]' : 'bg-white'
                                                            }`}
                                                            style={{ width: `${progressPercent}%` }}
                                                        />
                                                    </div>

                                                    {/* Transparent Large Hitbox Input Range */}
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
                                                        className="absolute inset-x-0 h-5 w-full appearance-none cursor-pointer bg-transparent opacity-0 z-10 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-transparent"
                                                    />
                                                </div>
                                                <div className={`mt-1 flex justify-between text-[10px] tabular-nums transition-colors ${
                                                    isDaylight ? 'text-black/35' : 'text-white/30'
                                                }`}>
                                                    <span>{formatTime(progressValue)}</span>
                                                    <span>{formatTime(duration)}</span>
                                                </div>
                                            </div>

                                            {/* Playback Actions or Lyrics Overlay */}
                                            <div className="h-9 w-full relative" style={noDragStyle}>
                                                <AnimatePresence mode="wait">
                                                    {!showLyricsOverlay ? (
                                                        <motion.div
                                                            key="controls"
                                                            initial={{ opacity: 0, y: 8 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -8 }}
                                                            transition={{ duration: 0.15 }}
                                                            className="absolute inset-x-0 bottom-0 top-0 flex w-full items-center justify-between"
                                                        >
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    title="Previous"
                                                                    disabled={primaryDisabled || !snapshot.canGoPrevious}
                                                                    onClick={() => sendCommand({ type: 'previous' })}
                                                                    className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                                                        isDaylight
                                                                            ? 'bg-black/5 text-black/60 hover:bg-black/10 hover:text-black'
                                                                            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                                                                    }`}
                                                                >
                                                                    <SkipBack size={16} strokeWidth={2} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    title={isPlaying ? 'Pause' : 'Play'}
                                                                    disabled={primaryDisabled}
                                                                    onClick={() => sendCommand({ type: 'play-pause' })}
                                                                    className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                                                        isDaylight
                                                                            ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                                                            : 'bg-white text-zinc-950 hover:bg-white/90'
                                                                    }`}
                                                                >
                                                                    {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} className="translate-x-0.5" fill="currentColor" />}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    title="Next"
                                                                    disabled={primaryDisabled || !snapshot.canGoNext}
                                                                    onClick={() => sendCommand({ type: 'next' })}
                                                                    className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                                                        isDaylight
                                                                            ? 'bg-black/5 text-black/60 hover:bg-black/10 hover:text-black'
                                                                            : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
                                                                    }`}
                                                                >
                                                                    <SkipForward size={16} strokeWidth={2} />
                                                                </button>
                                                            </div>
                                                            <div className="flex items-center gap-1.5">
                                                                <button
                                                                    type="button"
                                                                    title="Transparent controls"
                                                                    onClick={() => {
                                                                        setPresetSelectorOpen(false);
                                                                        setActivePanel('transparent-controls');
                                                                    }}
                                                                    className={`flex h-8 w-8 items-center justify-center rounded-full transition ${
                                                                        isDaylight ? 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                                                    }`}
                                                                >
                                                                    <MirrorRectangular size={16} strokeWidth={2} />
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    title="Video export"
                                                                    disabled={!snapshot.hasTrack}
                                                                    onClick={() => setActivePanel('export')}
                                                                    className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                                                        exportState.status === 'recording'
                                                                            ? (isDaylight ? 'bg-red-500/20 text-red-600 animate-pulse border border-red-500/25' : 'bg-red-500/25 text-red-400 animate-pulse border border-red-500/30')
                                                                            : (isDaylight ? 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                                    }`}
                                                                >
                                                                    <Video size={16} strokeWidth={2} />
                                                                </button>
                                                            </div>
                                                        </motion.div>
                                                    ) : (
                                                        <motion.div
                                                            key="lyrics"
                                                            initial={{ opacity: 0, y: 8 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -8 }}
                                                            transition={{ duration: 0.15 }}
                                                            className="absolute inset-x-0 bottom-0 top-0 flex flex-col justify-center min-w-0"
                                                        >
                                                            <div className="truncate text-xs font-bold leading-tight select-none">
                                                                {currentLyricInfo.currentLine ? (
                                                                    currentLyricInfo.currentLine.words && currentLyricInfo.currentLine.words.length > 0 ? (
                                                                        currentLyricInfo.currentLine.words.map((word, idx) => {
                                                                            const progress = word.endTime > word.startTime
                                                                                ? Math.max(0, Math.min(100, ((interpolatedTime - word.startTime) / (word.endTime - word.startTime)) * 100))
                                                                                : (interpolatedTime >= word.startTime ? 100 : 0);
                                                                            return (
                                                                                <span
                                                                                    key={idx}
                                                                                    style={{
                                                                                        backgroundImage: `linear-gradient(to right, ${activeColor} ${progress}%, ${baseColor} ${progress}%)`,
                                                                                        WebkitBackgroundClip: 'text',
                                                                                        WebkitTextFillColor: 'transparent',
                                                                                        display: 'inline-block',
                                                                                        marginRight: '0.25em',
                                                                                    }}
                                                                                >
                                                                                    {word.text}
                                                                                </span>
                                                                            );
                                                                        })
                                                                    ) : (
                                                                        <span
                                                                            style={{
                                                                                backgroundImage: `linear-gradient(to right, ${activeColor} ${
                                                                                    currentLyricInfo.currentLine.endTime > currentLyricInfo.currentLine.startTime
                                                                                        ? Math.max(0, Math.min(100, ((interpolatedTime - currentLyricInfo.currentLine.startTime) / (currentLyricInfo.currentLine.endTime - currentLyricInfo.currentLine.startTime)) * 100))
                                                                                        : (interpolatedTime >= currentLyricInfo.currentLine.startTime ? 100 : 0)
                                                                                }%, ${baseColor} ${
                                                                                    currentLyricInfo.currentLine.endTime > currentLyricInfo.currentLine.startTime
                                                                                        ? Math.max(0, Math.min(100, ((interpolatedTime - currentLyricInfo.currentLine.startTime) / (currentLyricInfo.currentLine.endTime - currentLyricInfo.currentLine.startTime)) * 100))
                                                                                        : (interpolatedTime >= currentLyricInfo.currentLine.startTime ? 100 : 0)
                                                                                }%)`,
                                                                                WebkitBackgroundClip: 'text',
                                                                                WebkitTextFillColor: 'transparent',
                                                                                display: 'inline-block',
                                                                            }}
                                                                        >
                                                                            {currentLyricInfo.currentLine.fullText}
                                                                        </span>
                                                                    )
                                                                ) : (
                                                                    <span style={{ color: baseColor }}>
                                                                        {snapshot.hasTrack ? '无歌词' : ''}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div 
                                                                className="truncate text-[10px] font-medium leading-none mt-1"
                                                                style={{ color: baseColor }}
                                                            >
                                                                {currentLyricInfo.nextLine ? currentLyricInfo.nextLine.fullText : ''}
                                                            </div>
                                                        </motion.div>
                                                    )}
                                                </AnimatePresence>
                                            </div>
                                        </motion.div>
                                    ) : activePanel === 'export' ? (
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
                                                isDaylight={isDaylight}
                                                onOpenPresetSelector={() => setPresetSelectorOpen(true)}
                                                onStartModeChange={setStartMode}
                                                sendCommand={sendCommand}
                                            />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="transparent-controls-panel"
                                            initial={{ opacity: 0, y: 5 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -5 }}
                                            transition={{ duration: 0.15 }}
                                            className="w-full flex flex-col gap-2.5"
                                        >
                                            {/* Row 1: Regular/Transparent mode segment control and Player Chrome visibility */}
                                            <div className="grid grid-cols-2 gap-2.5">
                                                <div className={`flex h-8 rounded-xl p-0.5 transition-colors ${isDaylight ? 'bg-black/5' : 'bg-white/5'}`}>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendCommand({ type: 'set-transparent-mode-enabled', enabled: false })}
                                                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${
                                                            !snapshot.transparentModeEnabled
                                                                ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                                                : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                                                        }`}
                                                    >
                                                        常规
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendCommand({ type: 'set-transparent-mode-enabled', enabled: true })}
                                                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${
                                                            snapshot.transparentModeEnabled
                                                                ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                                                : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                                                        }`}
                                                    >
                                                        透明
                                                    </button>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => sendCommand({ type: 'set-player-chrome-hidden', hidden: !snapshot.playerChromeHidden })}
                                                    className={`flex h-8 items-center justify-center rounded-xl text-[11px] font-bold transition border ${
                                                        snapshot.playerChromeHidden
                                                            ? (isDaylight ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm' : 'bg-white border-white text-zinc-950 shadow-sm')
                                                            : (isDaylight ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                    }`}
                                                >
                                                    {snapshot.playerChromeHidden ? '显示 UI' : '隐藏 UI'}
                                                </button>
                                            </div>

                                            {/* Row 2: Main window border and Click-through controls */}
                                            <div className="grid grid-cols-2 gap-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => sendCommand({ type: 'set-main-window-border-visible', visible: !snapshot.mainWindowBorderVisible })}
                                                    className={`flex h-8 items-center justify-center rounded-xl text-[11px] font-bold transition border ${
                                                        snapshot.mainWindowBorderVisible
                                                            ? (isDaylight ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm' : 'bg-white border-white text-zinc-950 shadow-sm')
                                                            : (isDaylight ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                    }`}
                                                >
                                                    {snapshot.mainWindowBorderVisible ? '隐藏边框' : '显示边框'}
                                                </button>

                                                <div className={`grid h-8 grid-cols-2 overflow-hidden rounded-xl border transition-colors ${
                                                    isDaylight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
                                                }`}>
                                                    <button
                                                        type="button"
                                                        disabled={!snapshot.transparentModeEnabled}
                                                        title={snapshot.mainWindowClickThroughEnabled ? '关闭点击穿透' : '点击穿透'}
                                                        aria-pressed={snapshot.mainWindowClickThroughEnabled}
                                                        onClick={() => sendCommand({ type: 'set-main-window-click-through', enabled: !snapshot.mainWindowClickThroughEnabled })}
                                                        className={`flex h-full items-center justify-center gap-1 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${
                                                            snapshot.mainWindowClickThroughEnabled
                                                                ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                                                : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                                                        }`}
                                                    >
                                                        {snapshot.mainWindowClickThroughEnabled ? <Lock size={12} /> : <LockOpen size={12} />}
                                                        <span>穿透</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={snapshot.mainWindowAlwaysOnTop ? '取消主窗口置顶' : '置顶主窗口'}
                                                        aria-pressed={snapshot.mainWindowAlwaysOnTop}
                                                        onClick={() => sendCommand({ type: 'set-main-window-always-on-top', enabled: !snapshot.mainWindowAlwaysOnTop })}
                                                        className={`flex h-full items-center justify-center gap-1 border-l text-[10px] font-bold transition ${
                                                            snapshot.mainWindowAlwaysOnTop
                                                                ? (isDaylight ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm' : 'border-white bg-white text-zinc-950 shadow-sm')
                                                                : (isDaylight ? 'border-black/5 text-black/70 hover:bg-black/5 hover:text-black' : 'border-white/5 text-white/70 hover:bg-white/5 hover:text-white')
                                                        }`}
                                                    >
                                                        {snapshot.mainWindowAlwaysOnTop ? <Pin size={12} /> : <PinOff size={12} />}
                                                        <span>置顶</span>
                                                    </button>
                                                </div>
                                            </div>
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
                            className={`absolute inset-0 z-50 flex flex-col p-4 rounded-[20px] shadow-2xl border overflow-hidden transition-colors duration-300 ${
                                isDaylight ? 'border-black/10' : 'border-white/10'
                            }`}
                            style={noDragStyle}
                        >
                            {/* Blurry gradient background for modal */}
                            <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                                {/* Base */}
                                <div className={`absolute inset-0 backdrop-blur-md transition-colors duration-300 ${
                                    isDaylight ? 'bg-[#f5f5f4]/95' : 'bg-[#060814]/95'
                                }`} />
                                {/* Blurry blobs for modal */}
                                {isDaylight ? (
                                    <>
                                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-orange-400/20 blur-[40px]" />
                                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-rose-300/20 blur-[50px]" />
                                    </>
                                ) : (
                                    <>
                                        <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full bg-blue-600/20 blur-[40px]" />
                                        <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full bg-indigo-500/15 blur-[50px]" />
                                    </>
                                )}
                            </div>
                            <div className="flex items-center justify-between mb-2.5">
                                <span className={`text-[13px] font-bold transition-colors ${
                                    isDaylight ? 'text-black/90' : 'text-white/90'
                                }`}>选择导出预设</span>
                                <button
                                    type="button"
                                    onClick={() => setPresetSelectorOpen(false)}
                                    className={`flex h-6 w-6 items-center justify-center rounded-full transition ${
                                        isDaylight
                                            ? 'bg-black/5 text-black/50 hover:bg-black/10 hover:text-black'
                                            : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                                    }`}
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
                                                    ? (isDaylight
                                                        ? 'bg-zinc-900 border-zinc-900 text-white shadow-md font-bold'
                                                        : 'bg-white border-white text-zinc-950 shadow-md font-bold')
                                                    : (isDaylight
                                                        ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black hover:border-black/10 font-medium'
                                                        : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/10 font-medium')
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
