import React, { useEffect, useMemo, useState, useRef } from 'react';
import { ChevronLeft, Heart, Lock, LockOpen, Pause, Pin, PinOff, Play, SkipBack, SkipForward, Video, MirrorRectangular, X, Check, Sliders, Palette } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlayerState } from '../../types';
import RemoteVideoExportPanel from './RemoteVideoExportPanel';
import RemoteLyricOverlay from './RemoteLyricOverlay';
import type { RemoteControlCommand, RemoteControlSnapshot } from '../../types/remoteControl';
import {
    createVideoExportPresets,
    DEFAULT_VIDEO_EXPORT_PRESET_ID,
    DEFAULT_VIDEO_EXPORT_PRESET_VALUES,
    idleVideoExportState,
    sanitizeVideoExportPresetValues,
    VIDEO_EXPORT_PRESET_MAX,
    VIDEO_EXPORT_PRESET_MIN,
} from '../../types/videoExport';
import type { VideoExportPresetValues, VideoExportStartMode } from '../../types/videoExport';
import { extractColors } from '../../utils/colorExtractor';

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
const REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY = 'remote_video_export_preset_values';
const REMOTE_BACKGROUND_MODE_STORAGE_KEY = 'remote_background_mode';
const REMOTE_TITLEBAR_REVEAL_THRESHOLD = 44;

type BackgroundMode = 'default' | 'cover' | 'transparent';

const sendCommand = (command: RemoteControlCommand) => {
    void window.electron?.sendRemoteControlCommand(command);
};

const readStoredVideoExportPresetValues = (): VideoExportPresetValues => {
    if (typeof window === 'undefined') {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }

    const raw = window.localStorage.getItem(REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY);
    if (!raw) {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed)
            ? sanitizeVideoExportPresetValues(parsed)
            : DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    } catch {
        return DEFAULT_VIDEO_EXPORT_PRESET_VALUES;
    }
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
    isLiked: false,
    updatedAt: 0,
};

type RemotePanelMode = 'playback' | 'export' | 'transparent-controls';

const RemoteControlApp: React.FC = () => {
    const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => {
        if (typeof window !== 'undefined') {
            const stored = window.localStorage.getItem(REMOTE_BACKGROUND_MODE_STORAGE_KEY);
            if (stored === 'cover' || stored === 'transparent' || stored === 'default') {
                return stored as BackgroundMode;
            }
        }
        return 'default';
    });
    const [coverColors, setCoverColors] = useState<string[]>([]);
    const [snapshot, setSnapshot] = useState<RemoteControlSnapshot>(emptySnapshot);
    const [pendingSeek, setPendingSeek] = useState<number | null>(null);
    const [activePanel, setActivePanel] = useState<RemotePanelMode>('playback');
    const [selectedPresetId, setSelectedPresetId] = useState(DEFAULT_VIDEO_EXPORT_PRESET_ID);
    const [presetValues, setPresetValues] = useState<VideoExportPresetValues>(() => readStoredVideoExportPresetValues());
    const [draftWidth, setDraftWidth] = useState('');
    const [draftHeight, setDraftHeight] = useState('');
    const [startMode, setStartMode] = useState<VideoExportStartMode>('from-start');
    const [presetSelectorOpen, setPresetSelectorOpen] = useState(false);
    const [alwaysOnTop, setAlwaysOnTop] = useState(false);
    const [windowControlsRevealed, setWindowControlsRevealed] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [showLyricsOverlay, setShowLyricsOverlay] = useState(false);
    const isDraggingRef = useRef(false);
    const lastSeekTimeRef = useRef(0);
    const exportPresets = useMemo(() => createVideoExportPresets(presetValues), [presetValues]);
    const selectedPreset = exportPresets.find(preset => preset.id === selectedPresetId) ?? exportPresets[1];

    const widthFocusedRef = useRef(false);
    const heightFocusedRef = useRef(false);
    const isSavingRef = useRef(false);

    useEffect(() => {
        const activePreset = exportPresets.find(preset => preset.id === selectedPresetId);
        if (activePreset) {
            setDraftWidth(String(activePreset.width));
            setDraftHeight(String(activePreset.height));
        }
    }, [selectedPresetId, presetValues, exportPresets]);

    useEffect(() => {
        if (!widthFocusedRef.current) {
            setDraftWidth(String(snapshot.mainWindowWidth ?? 1920));
        }
    }, [snapshot.mainWindowWidth]);

    useEffect(() => {
        if (!heightFocusedRef.current) {
            setDraftHeight(String(snapshot.mainWindowHeight ?? 1080));
        }
    }, [snapshot.mainWindowHeight]);

    useEffect(() => {
        if (isHovered) {
            setShowLyricsOverlay(false);
            return;
        }

        const timer = setTimeout(() => {
            setShowLyricsOverlay(true);
        }, 800);

        return () => clearTimeout(timer);
    }, [isHovered]);

    useEffect(() => {
        document.body.style.backgroundColor = 'transparent';
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.overflow = 'visible';
        document.title = REMOTE_CONTROL_DOCUMENT_TITLE;
    }, []);

    useEffect(() => {
        const handleMouseMove = (event: MouseEvent) => {
            const nextRevealed = event.clientY <= REMOTE_TITLEBAR_REVEAL_THRESHOLD;
            setWindowControlsRevealed(prev => (prev === nextRevealed ? prev : nextRevealed));
        };
        const handleMouseLeave = () => setWindowControlsRevealed(false);

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseleave', handleMouseLeave);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseleave', handleMouseLeave);
        };
    }, []);

    useEffect(() => {
        window.localStorage.setItem(REMOTE_BACKGROUND_MODE_STORAGE_KEY, backgroundMode);
    }, [backgroundMode]);

    useEffect(() => {
        let mounted = true;
        if (backgroundMode === 'cover' && snapshot.coverUrl) {
            extractColors(snapshot.coverUrl, 3).then(colors => {
                if (mounted) setCoverColors(colors);
            }).catch(() => {
                if (mounted) setCoverColors([]);
            });
        }
        return () => { mounted = false; };
    }, [snapshot.coverUrl, backgroundMode]);

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
            const nextSnapshot = next as RemoteControlSnapshot;
            setSnapshot(previous => ({
                ...previous,
                ...nextSnapshot,
                lyrics: Object.prototype.hasOwnProperty.call(nextSnapshot, 'lyrics')
                    ? nextSnapshot.lyrics ?? null
                    : previous.lyrics ?? null,
            }));
            if (!isDraggingRef.current && Date.now() - lastSeekTimeRef.current > 800) {
                setPendingSeek(null);
            }
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
    const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;

    const progressPercent = duration > 0 ? (progressValue / duration) * 100 : 0;

    useEffect(() => {
        window.localStorage.setItem(REMOTE_VIDEO_EXPORT_PRESET_VALUES_STORAGE_KEY, JSON.stringify(presetValues));
    }, [presetValues]);

    const handleSelectExportPreset = (presetId: string) => {
        const nextPreset = exportPresets.find(item => item.id === presetId);
        if (!nextPreset) {
            return;
        }

        setSelectedPresetId(nextPreset.id);
        sendCommand({ type: 'resize-main-window', width: nextPreset.width, height: nextPreset.height });
    };

    const handleApplyCustomPresetValues = () => {
        const w = Number(draftWidth);
        const h = Number(draftHeight);
        if (!Number.isFinite(w) || !Number.isFinite(h)) {
            return;
        }

        isSavingRef.current = true;
        setTimeout(() => {
            isSavingRef.current = false;
        }, 1000);

        const clampVal = (val: number, fallback: number) => {
            const integerVal = Math.round(val);
            const safeVal = Number.isFinite(integerVal) ? integerVal : fallback;
            const clampedVal = Math.min(VIDEO_EXPORT_PRESET_MAX, Math.max(VIDEO_EXPORT_PRESET_MIN, safeVal));
            return clampedVal % 2 === 0 ? clampedVal : clampedVal + 1;
        };

        const clampedW = clampVal(w, 1920);
        const clampedH = clampVal(h, 1080);

        const activeIndex = exportPresets.findIndex(preset => preset.id === selectedPresetId);
        if (activeIndex === -1) {
            return;
        }

        const nextPresetValues = [...presetValues] as VideoExportPresetValues;
        nextPresetValues[activeIndex] = { width: clampedW, height: clampedH };
        setPresetValues(nextPresetValues);

        sendCommand({ type: 'resize-main-window', width: clampedW, height: clampedH });
    };

    const getCalculatedAspectRatio = (wStr: string, hStr: string) => {
        const w = Number(wStr);
        const h = Number(hStr);
        if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
            return '';
        }

        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        const divisor = gcd(w, h);
        const aspectW = w / divisor;
        const aspectH = h / divisor;
        const orientationStr = w >= h ? '横屏' : '竖屏';

        if (aspectW === 16 && aspectH === 9) {
            return `16:9 (${orientationStr})`;
        }
        if (aspectW === 9 && aspectH === 16) {
            return `9:16 (${orientationStr})`;
        }
        if (aspectW === 4 && aspectH === 3) {
            return `4:3 (${orientationStr})`;
        }
        if (aspectW === 3 && aspectH === 4) {
            return `3:4 (${orientationStr})`;
        }
        if (aspectW === 1 && aspectH === 1) {
            return `1:1 (方屏)`;
        }
        if (aspectW === 21 && aspectH === 9) {
            return `21:9 (超宽屏)`;
        }

        return `${aspectW}:${aspectH} (${orientationStr})`;
    };

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
            className={`h-screen w-screen bg-transparent p-1 select-none transition-colors duration-300 ${isDaylight ? 'text-zinc-900' : 'text-white'
                }`}
        >
            <div className={`relative flex h-full w-full rounded-[20px] border p-4 items-center justify-center overflow-hidden transition-colors duration-300 ${backgroundMode === 'transparent' ? 'border-transparent' : (isDaylight ? 'border-black/10' : 'border-white/10')
                }`}>
                {/* Transparent mode titlebar backdrop */}
                {backgroundMode === 'transparent' && (
                    <div
                        className={`absolute top-0 left-0 right-0 h-11 pointer-events-none transition-opacity duration-200 z-10 backdrop-blur-md ${windowControlsRevealed ? 'opacity-100' : 'opacity-0'
                            } ${isDaylight
                                ? 'bg-white/40 border-b border-black/10 shadow-sm'
                                : 'bg-black/40 border-b border-white/10 shadow-md'
                            }`}
                    />
                )}

                {/* Blurry gradient background */}
                {backgroundMode !== 'transparent' && (
                    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none transition-opacity duration-300">
                        {/* Base layer */}
                        <div className={`absolute inset-0 transition-colors duration-300 ${backgroundMode === 'cover' && coverColors.length > 0
                            ? (isDaylight ? 'bg-zinc-100' : 'bg-zinc-950')
                            : (isDaylight ? 'bg-[#f5f5f4]' : 'bg-[#060814]')
                            }`} />

                        {/* Blurry blobs */}
                        {backgroundMode === 'cover' && coverColors.length >= 2 ? (
                            <>
                                <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full blur-[40px] transition-all duration-700 ease-in-out" style={{ backgroundColor: coverColors[0], opacity: isDaylight ? 0.35 : 0.25 }} />
                                <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full blur-[50px] transition-all duration-700 ease-in-out" style={{ backgroundColor: coverColors[1], opacity: isDaylight ? 0.35 : 0.25 }} />
                                <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full blur-[30px] transition-all duration-700 ease-in-out" style={{ backgroundColor: coverColors[2] || coverColors[0], opacity: isDaylight ? 0.25 : 0.15 }} />
                            </>
                        ) : isDaylight ? (
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
                )}

                <div
                    className="absolute inset-x-0 top-0 z-20 h-11"
                    style={dragStyle}
                >
                    <div
                        className={`absolute right-2.5 top-2.5 flex items-center gap-1 transition duration-200 ${windowControlsRevealed ? 'opacity-100' : 'opacity-0'
                            }`}
                        style={{
                            ...noDragStyle,
                            pointerEvents: windowControlsRevealed ? 'auto' : 'none',
                        }}
                        onFocus={() => {
                            setWindowControlsRevealed(true);
                        }}
                        onMouseEnter={() => {
                            setWindowControlsRevealed(true);
                        }}
                    >
                        <button
                            type="button"
                            title={
                                backgroundMode === 'default' ? '默认背景' :
                                    backgroundMode === 'cover' ? '封面色彩' :
                                        '透明背景'
                            }
                            tabIndex={windowControlsRevealed ? 0 : -1}
                            onClick={() => {
                                setBackgroundMode(prev => prev === 'default' ? 'cover' : prev === 'cover' ? 'transparent' : 'default');
                            }}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${isDaylight
                                ? 'text-black/30 hover:bg-black/10 hover:text-black/80'
                                : 'text-white/30 hover:bg-white/10 hover:text-white/80'
                                }`}
                        >
                            <Palette size={13} />
                        </button>
                        <button
                            type="button"
                            title={alwaysOnTop ? '取消置顶' : '固定到最前'}
                            aria-pressed={alwaysOnTop}
                            tabIndex={windowControlsRevealed ? 0 : -1}
                            onClick={handleToggleAlwaysOnTop}
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${isDaylight
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
                            className={`flex h-6 w-6 items-center justify-center rounded-full transition ${isDaylight
                                ? 'text-black/30 hover:bg-black/10 hover:text-black/80'
                                : 'text-white/30 hover:bg-white/10 hover:text-white/80'
                                }`}
                        >
                            <X size={13} />
                        </button>
                    </div>
                </div>

                <div className="w-full flex items-center" style={noDragStyle}>
                    <div className="grid grid-cols-[112px_1fr] gap-4 w-full items-center">
                        {/* Left Column: Cover Art with Hover Back Overlay */}
                        <div className={`relative h-[112px] w-[112px] shrink-0 overflow-hidden rounded-xl bg-cover bg-center shadow-md group transition-all duration-300 ${isDaylight ? 'bg-zinc-200 border border-black/5' : 'bg-zinc-800 border border-white/5'
                            }`}>
                            {!snapshot.coverUrl && (
                                <div className={`flex h-full w-full items-center justify-center text-3xl font-bold transition-colors duration-300 ${isDaylight ? 'text-black/35' : 'text-white/35'
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
                                    className={`absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 rounded-xl backdrop-blur-sm ${isDaylight ? 'bg-stone-900/65 text-white' : 'bg-zinc-950/65 text-white'
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
                                        className={`absolute inset-0 flex items-center justify-center rounded-xl backdrop-blur-[2px] z-30 ${isDaylight ? 'bg-stone-950/70' : 'bg-zinc-950/80'
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
                                <div className={`truncate text-xs font-medium mt-0.5 transition-colors ${isDaylight ? 'text-black/50' : 'text-white/40'
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
                                            {/* Progress Slider (Always Visible) */}
                                            <div className="w-full">
                                                <div className="relative w-full h-5 flex items-center" style={noDragStyle}>
                                                    {/* Visible Track Background */}
                                                    <div className={`w-full h-[3px] rounded-full transition-colors overflow-hidden ${isDaylight ? 'bg-black/10' : 'bg-white/15'
                                                        }`}>
                                                        {/* Visible Progress Fill */}
                                                        <div
                                                            className={`h-full rounded-full transition-all duration-75 ${isDaylight ? 'bg-[#1c1917]' : 'bg-white'
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
                                                        onPointerDown={() => {
                                                            isDraggingRef.current = true;
                                                        }}
                                                        onPointerCancel={() => {
                                                            isDraggingRef.current = false;
                                                        }}
                                                        onPointerUp={() => {
                                                            isDraggingRef.current = false;
                                                            lastSeekTimeRef.current = Date.now();
                                                            if (pendingSeek !== null) {
                                                                sendCommand({ type: 'seek', time: pendingSeek });
                                                            }
                                                        }}
                                                        onKeyUp={(event) => {
                                                            if (event.key === 'Enter' && pendingSeek !== null) {
                                                                isDraggingRef.current = false;
                                                                lastSeekTimeRef.current = Date.now();
                                                                sendCommand({ type: 'seek', time: pendingSeek });
                                                            }
                                                        }}
                                                        className="absolute inset-x-0 h-5 w-full appearance-none cursor-pointer bg-transparent opacity-0 z-10 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-transparent"
                                                    />
                                                </div>
                                            </div>

                                            {/* Toggle area for controls+timestamps or lyrics */}
                                            <div
                                                className="flex-1 min-h-0 w-full relative"
                                                onMouseEnter={() => setIsHovered(true)}
                                                onMouseLeave={() => setIsHovered(false)}
                                            >
                                                <AnimatePresence mode="wait">
                                                    {!showLyricsOverlay ? (
                                                        <motion.div
                                                            key="controls-view"
                                                            initial={{ opacity: 0, y: 5 }}
                                                            animate={{ opacity: 1, y: 0 }}
                                                            exit={{ opacity: 0, y: -5 }}
                                                            transition={{ duration: 0.15 }}
                                                            className="absolute inset-0 flex flex-col justify-between"
                                                        >
                                                            {/* Timestamps */}
                                                            <div className={`flex justify-between text-[10px] tabular-nums transition-colors ${isDaylight ? 'text-black/35' : 'text-white/30'
                                                                }`}>
                                                                <span>{formatTime(progressValue)}</span>
                                                                <span>{formatTime(duration)}</span>
                                                            </div>

                                                            {/* Playback Actions */}
                                                            <div className="flex w-full items-center justify-between">
                                                                <div className="flex items-center gap-1.5">
                                                                    <button
                                                                        type="button"
                                                                        title="Previous"
                                                                        disabled={primaryDisabled || !snapshot.canGoPrevious}
                                                                        onClick={() => sendCommand({ type: 'previous' })}
                                                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${isDaylight
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
                                                                        className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${isDaylight
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
                                                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${isDaylight
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
                                                                        title={snapshot.isLiked ? '取消收藏' : '收藏'}
                                                                        disabled={primaryDisabled}
                                                                        onClick={() => sendCommand({ type: 'toggle-like' })}
                                                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${snapshot.isLiked
                                                                            ? (isDaylight ? 'bg-red-500/20 text-red-600 hover:bg-red-500/30' : 'bg-red-500/25 text-red-400 hover:bg-red-500/35')
                                                                            : (isDaylight ? 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                                            }`}
                                                                    >
                                                                        <Heart size={16} fill={snapshot.isLiked ? 'currentColor' : 'none'} strokeWidth={2} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        title="Transparent controls"
                                                                        onClick={() => {
                                                                            setPresetSelectorOpen(false);
                                                                            setActivePanel('transparent-controls');
                                                                        }}
                                                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition ${isDaylight ? 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white'
                                                                            }`}
                                                                    >
                                                                        <MirrorRectangular size={16} strokeWidth={2} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        title="Video export"
                                                                        disabled={!snapshot.hasTrack}
                                                                        onClick={() => setActivePanel('export')}
                                                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-35 ${exportState.status === 'recording'
                                                                            ? (isDaylight ? 'bg-red-500/20 text-red-600 animate-pulse border border-red-500/25' : 'bg-red-500/25 text-red-400 animate-pulse border border-red-500/30')
                                                                            : (isDaylight ? 'bg-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                                            }`}
                                                                    >
                                                                        <Video size={16} strokeWidth={2} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        </motion.div>
                                                    ) : (
                                                        <RemoteLyricOverlay
                                                            lyrics={snapshot.lyrics}
                                                            currentTime={snapshot.currentTime - (snapshot.lyricOffsetMs || 0) / 1000}
                                                            duration={snapshot.duration}
                                                            playerState={snapshot.playerState}
                                                            hasTrack={snapshot.hasTrack}
                                                            visible={showLyricsOverlay && activePanel === 'playback'}
                                                            baseColor={baseColor}
                                                            activeColor={activeColor}
                                                        />
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
                                                selectedPreset={selectedPreset}
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
                                                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${!snapshot.transparentModeEnabled
                                                            ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                                            : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                                                            }`}
                                                    >
                                                        常规
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendCommand({ type: 'set-transparent-mode-enabled', enabled: true })}
                                                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${snapshot.transparentModeEnabled
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
                                                    className={`flex h-8 items-center justify-center rounded-xl text-[11px] font-bold transition border ${snapshot.playerChromeHidden
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
                                                    className={`flex h-8 items-center justify-center rounded-xl text-[11px] font-bold transition border ${snapshot.mainWindowBorderVisible
                                                        ? (isDaylight ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm' : 'bg-white border-white text-zinc-950 shadow-sm')
                                                        : (isDaylight ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                        }`}
                                                >
                                                    {snapshot.mainWindowBorderVisible ? '隐藏边框' : '显示边框'}
                                                </button>

                                                <div className={`grid h-8 grid-cols-2 overflow-hidden rounded-xl border transition-colors ${isDaylight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
                                                    }`}>
                                                    <button
                                                        type="button"
                                                        disabled={!snapshot.transparentModeEnabled}
                                                        title={snapshot.mainWindowClickThroughEnabled ? '关闭点击穿透' : '点击穿透'}
                                                        aria-pressed={snapshot.mainWindowClickThroughEnabled}
                                                        onClick={() => sendCommand({ type: 'set-main-window-click-through', enabled: !snapshot.mainWindowClickThroughEnabled })}
                                                        className={`flex h-full items-center justify-center gap-1 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${snapshot.mainWindowClickThroughEnabled
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
                                                        className={`flex h-full items-center justify-center gap-1 border-l text-[10px] font-bold transition ${snapshot.mainWindowAlwaysOnTop
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
                            className={`absolute inset-0 z-50 flex flex-col p-3 rounded-[20px] shadow-2xl border overflow-hidden transition-colors duration-300 ${isDaylight ? 'border-black/10' : 'border-white/10'
                                }`}
                            style={noDragStyle}
                        >
                            {/* Blurry gradient background for modal */}
                            <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
                                {/* Base */}
                                <div className={`absolute inset-0 backdrop-blur-md transition-colors duration-300 ${isDaylight ? 'bg-[#f5f5f4]/95' : 'bg-[#060814]/95'
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
                            <div className="flex items-center justify-between mb-1.5">
                                <span className={`text-[13px] font-bold transition-colors ${isDaylight ? 'text-black/90' : 'text-white/90'
                                    }`}>选择导出预设</span>
                                <button
                                    type="button"
                                    onClick={() => setPresetSelectorOpen(false)}
                                    className={`flex h-6 w-6 items-center justify-center rounded-full transition ${isDaylight
                                        ? 'bg-black/5 text-black/50 hover:bg-black/10 hover:text-black'
                                        : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
                                        }`}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                            <div className="flex gap-3 flex-1 overflow-hidden py-0.5">
                                {/* Left Column: Vertical Presets List */}
                                <div className="flex flex-col gap-2 w-[42%] shrink-0">
                                    {exportPresets.map((preset, index) => {
                                        const isSelected = preset.id === selectedPresetId;
                                        return (
                                            <button
                                                key={preset.id}
                                                type="button"
                                                role="option"
                                                aria-selected={isSelected}
                                                onClick={() => handleSelectExportPreset(preset.id)}
                                                className={`flex items-center justify-between rounded-xl p-2 px-3 border transition text-left cursor-pointer flex-1 min-h-[42px] ${isSelected
                                                    ? (isDaylight
                                                        ? 'bg-zinc-900 border-zinc-900 text-white shadow-md font-bold'
                                                        : 'bg-white border-white text-zinc-950 shadow-md font-bold')
                                                    : (isDaylight
                                                        ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black hover:border-black/10 font-medium'
                                                        : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white hover:border-white/10 font-medium')
                                                    }`}
                                            >
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[9px] opacity-60 font-semibold mb-0.5 tracking-wide uppercase truncate">
                                                        预设 {index + 1} ({preset.orientation === 'portrait' ? '竖屏' : '横屏'})
                                                    </span>
                                                    <span className="text-xs font-bold truncate">{preset.label}</span>
                                                </div>
                                                {isSelected && (
                                                    <div className={`flex items-center justify-center rounded-full p-0.5 shrink-0 ml-1.5 ${isDaylight ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white'
                                                        }`}>
                                                        <Check size={10} className="stroke-[3]" />
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Right Column: Customize Form */}
                                <div
                                    className={`flex flex-col flex-1 min-w-0 rounded-xl border p-2 px-2.5 justify-between transition ${isDaylight
                                        ? 'bg-black/5 border-black/5 text-black/80'
                                        : 'bg-white/5 border-white/5 text-white/80'
                                        }`}
                                >
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-1.5 mb-1.5">
                                            <Sliders size={11} className="opacity-75" />
                                            <span className="text-[9px] opacity-60 font-semibold tracking-wide uppercase">
                                                自定义预设 {exportPresets.findIndex(p => p.id === selectedPresetId) + 1}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <label
                                                className={`flex flex-col rounded-xl px-2 py-1 transition-colors border ${isDaylight
                                                    ? 'bg-white/80 border-black/5 focus-within:border-black/25'
                                                    : 'bg-zinc-950/35 border-white/5 focus-within:border-white/20'
                                                    }`}
                                            >
                                                <span className="text-[9px] opacity-50 font-semibold">宽度 (px)</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={draftWidth}
                                                    onFocus={() => { widthFocusedRef.current = true; }}
                                                    onBlur={() => {
                                                        widthFocusedRef.current = false;
                                                        const currentWidth = snapshot.mainWindowWidth ?? 1920;
                                                        setTimeout(() => {
                                                            if (!widthFocusedRef.current && !isSavingRef.current) {
                                                                setDraftWidth(String(currentWidth));
                                                            }
                                                        }, 150);
                                                    }}
                                                    onChange={(event) => setDraftWidth(event.currentTarget.value.replace(/[^\d]/g, ''))}
                                                    className="bg-transparent text-[11px] font-semibold outline-none w-full"
                                                />
                                            </label>

                                            <label
                                                className={`flex flex-col rounded-xl px-2 py-1 transition-colors border ${isDaylight
                                                    ? 'bg-white/80 border-black/5 focus-within:border-black/25'
                                                    : 'bg-zinc-950/35 border-white/5 focus-within:border-white/20'
                                                    }`}
                                            >
                                                <span className="text-[9px] opacity-50 font-semibold">高度 (px)</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={draftHeight}
                                                    onFocus={() => { heightFocusedRef.current = true; }}
                                                    onBlur={() => {
                                                        heightFocusedRef.current = false;
                                                        const currentHeight = snapshot.mainWindowHeight ?? 1080;
                                                        setTimeout(() => {
                                                            if (!heightFocusedRef.current && !isSavingRef.current) {
                                                                setDraftHeight(String(currentHeight));
                                                            }
                                                        }, 150);
                                                    }}
                                                    onChange={(event) => setDraftHeight(event.currentTarget.value.replace(/[^\d]/g, ''))}
                                                    className="bg-transparent text-[11px] font-semibold outline-none w-full"
                                                />
                                            </label>
                                        </div>

                                        {getCalculatedAspectRatio(draftWidth, draftHeight) && (
                                            <div className="mt-1.5 flex items-center px-0.5">
                                                <span className={`text-[9px] font-semibold transition-colors px-1.5 py-0.5 rounded ${isDaylight ? 'bg-black/5 text-black/60' : 'bg-white/5 text-white/60'
                                                    }`}>
                                                    比例: {getCalculatedAspectRatio(draftWidth, draftHeight)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-1 mt-1">
                                        <div className={`text-[9px] leading-tight opacity-50 ${isDaylight ? 'text-black' : 'text-white'}`}>
                                            限制范围 {VIDEO_EXPORT_PRESET_MIN}-{VIDEO_EXPORT_PRESET_MAX} px，偶数有更好的编码兼容性
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleApplyCustomPresetValues}
                                            className={`flex h-8 items-center justify-center rounded-lg text-[11px] font-bold shadow-sm transition active:scale-[0.98] ${isDaylight
                                                ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                                : 'bg-white text-zinc-950 hover:bg-white/90'
                                                }`}
                                        >
                                            保存至预设 {exportPresets.findIndex(p => p.id === selectedPresetId) + 1}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </main>
    );
};

export default RemoteControlApp;
