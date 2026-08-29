import React, { useEffect, useMemo, useState, useRef } from 'react';
import { ChevronLeft, Heart, Lock, LockOpen, Pause, Pin, PinOff, Play, Repeat, Repeat1, RepeatOff, SkipBack, SkipForward, Video, MirrorRectangular, X, Check, Sliders, Palette } from 'lucide-react';
import { animate, motion, AnimatePresence, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
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
import {
    mapTrackHandoffProgress,
    resolveStoppedTrackHandoffProgress,
    resolveTransitionClock,
    type RemoteTrackHandoffPair,
} from './remoteTrackTransition';
import { useTranslation } from 'react-i18next';

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
/** 邻居取色缓存上限，够覆盖来回切几首，不至于把 blob URL 一直攥在手里 */
const COVER_COLOR_CACHE_LIMIT = 8;
/** 手动切歌意图的有效期：超过这个时间还没换歌，就当成是自然播完 */
const NAV_INTENT_TTL_MS = 5000;

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
    trackKey: null,
    title: null,
    artist: null,
    coverUrl: null,
    currentTime: 0,
    duration: 0,
    playerState: PlayerState.IDLE,
    loopMode: 'off',
    canGoPrevious: false,
    canGoNext: false,
    prevTrackKey: null,
    prevTrackTitle: null,
    prevTrackArtist: null,
    prevTrackCoverUrl: null,
    nextTrackKey: null,
    nextTrackTitle: null,
    nextTrackArtist: null,
    nextTrackCoverUrl: null,
    trackTransition: null,
    controlsDisabled: true,
    isStageActive: false,
    transparentModeEnabled: false,
    mainWindowClickThroughEnabled: false,
    mainWindowAlwaysOnTop: false,
    mainWindowBorderVisible: false,
    playerChromeHidden: false,
    playerChromeVisibilityMode: 'auto-hide',
    exportState: idleVideoExportState(),
    isDaylight: false,
    lyrics: null,
    isLiked: false,
    canLike: false,
    updatedAt: 0,
};

type RemotePanelMode = 'playback' | 'export' | 'transparent-controls';

/**
 * 遥控窗口同时最多渲染两张"面"：当前曲目，以及自然播完前预读进来的下一首。
 * 交接期两张面按 opacity 交叉淡入淡出，切歌真正发生时下一首那张的 key 正好
 * 变成当前曲目的 key，React 复用同一节点，所以不会再抖一下。
 */
type RemoteTrackFace = {
    key: string;
    title: string;
    artist: string;
    coverUrl: string | null;
    /** incoming 是交接淡入的那张；current 在无 cue 时仍走手动切歌的方向性短过渡 */
    mode: 'current' | 'incoming';
};

const HANDOFF_FACE_TRANSITION = { duration: 0.55, ease: 'linear' } as const;
const SWITCH_FACE_TRANSITION = { duration: 0.42, ease: [0.22, 1, 0.36, 1] } as const;
const SWITCH_TEXT_TRANSITION = { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as const;

const RemoteControlApp: React.FC = () => {
    const { t } = useTranslation();
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
    const [hoverNavSide, setHoverNavSide] = useState<'prev' | 'next' | null>(null);
    const [showLyricsOverlay, setShowLyricsOverlay] = useState(false);
    const isDraggingRef = useRef(false);
    const lastSeekTimeRef = useRef(0);
    const coverColorCacheRef = useRef<Map<string, string[]>>(new Map());
    const navIntentRef = useRef<{ direction: 'prev' | 'next'; fromKey: string | null; at: number }>({
        direction: 'next',
        fromKey: null,
        at: 0,
    });
    const handoffPairRef = useRef<RemoteTrackHandoffPair | null>(null);
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

    // 换歌时先看预读缓存：命中就直接铺色，背景不用等取色算完再跳一次色
    const rememberCoverColors = React.useCallback((url: string, colors: string[]) => {
        const cache = coverColorCacheRef.current;
        cache.delete(url);
        cache.set(url, colors);
        while (cache.size > COVER_COLOR_CACHE_LIMIT) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            cache.delete(oldest);
        }
    }, []);

    useEffect(() => {
        let mounted = true;
        if (backgroundMode === 'cover' && snapshot.coverUrl) {
            const cached = coverColorCacheRef.current.get(snapshot.coverUrl);
            if (cached) {
                setCoverColors(cached);
                return;
            }

            extractColors(snapshot.coverUrl, 3).then(colors => {
                if (!mounted) return;
                setCoverColors(colors);
                if (colors.length > 0 && snapshot.coverUrl) {
                    rememberCoverColors(snapshot.coverUrl, colors);
                }
            }).catch(() => {
                if (mounted) setCoverColors([]);
            });
        }
        return () => { mounted = false; };
    }, [snapshot.coverUrl, backgroundMode, rememberCoverColors]);

    // 预读队列邻居：让浏览器先把封面解码进缓存，顺手把取色也算好。
    // 真正切歌时封面与背景色就能同帧到位，过渡不会先空一拍再补图。
    useEffect(() => {
        const neighborCovers = [snapshot.nextTrackCoverUrl, snapshot.prevTrackCoverUrl]
            .filter((url): url is string => Boolean(url));
        if (neighborCovers.length === 0) {
            return;
        }

        let mounted = true;
        neighborCovers.forEach(url => {
            const warmup = new Image();
            warmup.crossOrigin = 'Anonymous';
            warmup.src = url;
        });

        if (backgroundMode !== 'cover') {
            return;
        }

        neighborCovers.forEach(url => {
            if (coverColorCacheRef.current.has(url)) {
                return;
            }

            extractColors(url, 3).then(colors => {
                if (mounted && colors.length > 0) {
                    rememberCoverColors(url, colors);
                }
            }).catch(() => { /* 预读失败无所谓，切过去时会照常现取 */ });
        });

        return () => { mounted = false; };
    }, [snapshot.nextTrackCoverUrl, snapshot.prevTrackCoverUrl, backgroundMode, rememberCoverColors]);

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

    // 没有 trackKey 的旧快照（或空闲态）退回用封面/标题拼一个，保证过渡不会漏触发
    const trackIdentity = snapshot.trackKey ?? snapshot.coverUrl ?? snapshot.title ?? 'no-track';
    const nextTrackIdentity = snapshot.nextTrackKey ?? snapshot.nextTrackCoverUrl ?? snapshot.nextTrackTitle;
    // 手动点上一首时整块内容往回滑；自然播完或点下一首都往前滑。
    // 依赖 trackIdentity 记忆化，动画进行中重渲染不会中途改方向。
    const trackTransitionDirection = useMemo<'prev' | 'next'>(() => {
        const intent = navIntentRef.current;
        const isFreshIntent = intent.fromKey !== null
            && intent.fromKey !== trackIdentity
            && Date.now() - intent.at < NAV_INTENT_TTL_MS;
        return isFreshIntent ? intent.direction : 'next';
    }, [trackIdentity]);
    const trackEnterOffset = trackTransitionDirection === 'next' ? 10 : -10;

    const navigateTrack = (direction: 'prev' | 'next') => {
        navIntentRef.current = { direction, fromKey: trackIdentity, at: Date.now() };
        sendCommand({ type: direction === 'prev' ? 'previous' : 'next' });
    };

    const currentTime = pendingSeek ?? snapshot.currentTime;
    const duration = Number.isFinite(snapshot.duration) && snapshot.duration > 0 ? snapshot.duration : 0;
    const progressValue = duration > 0 ? Math.max(0, Math.min(currentTime, duration)) : 0;
    const isPlaying = snapshot.playerState === PlayerState.PLAYING;
    const primaryDisabled = snapshot.controlsDisabled || !snapshot.hasTrack;
    const likeDisabled = primaryDisabled || snapshot.canLike === false;
    const likeUnavailableReason = snapshot.likeUnavailableProvider
        ? t('status.providerLikeUnavailable', { provider: snapshot.likeUnavailableProvider })
        : undefined;
    const title = snapshot.title || 'Folia';
    const artist = snapshot.artist || (snapshot.hasTrack ? 'Unknown artist' : 'No active track');
    const previewTitle = hoverNavSide === 'prev' && snapshot.canGoPrevious
        ? snapshot.prevTrackTitle
        : hoverNavSide === 'next' && snapshot.canGoNext
            ? snapshot.nextTrackTitle
            : null;
    const exportState = snapshot.exportState ?? idleVideoExportState();
    const isDaylight = Boolean(snapshot.isDaylight);

    const baseColor = isDaylight ? 'rgba(0, 0, 0, 0.35)' : 'rgba(255, 255, 255, 0.35)';
    const activeColor = isDaylight ? '#1c1917' : '#ffffff';

    // Ghost icon buttons: no resting chip, background only on hover. The filled
    // play button stays the single anchor so the row reads as one primary action
    // plus quiet satellites instead of seven competing pills.
    const transportButtonClass = `flex h-8 w-8 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30 ${isDaylight
        ? 'text-black/70 hover:bg-black/[0.06] hover:text-black'
        : 'text-white/75 hover:bg-white/10 hover:text-white'
        }`;
    const secondaryButtonBase = 'flex h-7 w-7 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30';
    // Every button in the row shares one hover response: the same chip, and text
    // arriving at full contrast. Only the resting level encodes state, so an "on"
    // button rests just below full to keep the hover headroom the idle ones have.
    const secondaryIdleClass = isDaylight
        ? 'text-black/40 hover:bg-black/[0.06] hover:text-black'
        : 'text-white/45 hover:bg-white/10 hover:text-white';
    const secondaryActiveClass = isDaylight
        ? 'text-black/85 hover:bg-black/[0.06] hover:text-black'
        : 'text-white/90 hover:bg-white/10 hover:text-white';
    const secondaryAlertClass = isDaylight
        ? 'text-red-600/85 hover:bg-black/[0.06] hover:text-red-600'
        : 'text-red-400/90 hover:bg-white/10 hover:text-red-400';

    const lastStatusRef = React.useRef(exportState.status);
    useEffect(() => {
        if (exportState.status !== 'idle' && lastStatusRef.current === 'idle') {
            setActivePanel('export');
        }
        lastStatusRef.current = exportState.status;
    }, [exportState.status]);

    const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;
    const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties;

    const progressPercent = duration > 0 ? (progressValue / duration) * 100 : 0;

    const transitionStartedAtMs = snapshot.trackTransition?.startedAtMs ?? null;
    const transitionDurationSec = snapshot.trackTransition?.durationSec ?? null;
    const transitionCrossover = Math.max(0, Math.min(1, snapshot.trackTransition?.crossover ?? 0.5));
    const transitionCrossoverRef = useRef(transitionCrossover);
    transitionCrossoverRef.current = transitionCrossover;
    const handoffTimeProgress = useMotionValue(0);
    const handoffIncomingOpacity = useTransform(
        handoffTimeProgress,
        progress => mapTrackHandoffProgress(progress, transitionCrossoverRef.current),
    );
    const handoffOutgoingOpacity = useTransform(handoffIncomingOpacity, progress => 1 - progress);
    const [isTransitionGlowActive, setIsTransitionGlowActive] = useState(false);
    const [isIncomingDominant, setIsIncomingDominant] = useState(false);
    const transitionGlowColor = isDaylight ? 'rgba(28, 25, 23, 0.45)' : 'rgba(255, 255, 255, 0.8)';

    // 一条 cue 只锁定一组 A→B；队列推进后 next 会变成 C，不能拿它改写本次交接结果。
    useEffect(() => {
        if (
            transitionStartedAtMs === null
            || !nextTrackIdentity
            || nextTrackIdentity === trackIdentity
            || handoffPairRef.current?.startedAtMs === transitionStartedAtMs
        ) {
            return;
        }

        handoffPairRef.current = {
            startedAtMs: transitionStartedAtMs,
            outgoingKey: trackIdentity,
            incomingKey: nextTrackIdentity,
        };
    }, [nextTrackIdentity, trackIdentity, transitionStartedAtMs]);

    // 背景主导权直接跟随本地时间轴穿越 crossover，只在阈值变化时触发一次 React 更新。
    useMotionValueEvent(handoffTimeProgress, 'change', progress => {
        const nextDominant = progress >= transitionCrossoverRef.current;
        setIsIncomingDominant(current => current === nextDominant ? current : nextDominant);
    });

    // A snapshot starts the clock, but does not drive it. The MotionValue advances locally until
    // the cue ends, so repeated 500ms snapshots for the same cue cannot turn opacity into steps.
    useEffect(() => {
        handoffTimeProgress.stop();
        let startTimer: number | null = null;
        let endTimer: number | null = null;
        let playback: ReturnType<typeof animate> | null = null;

        if (
            !isPlaying
            || transitionStartedAtMs === null
            || transitionDurationSec === null
            || !Number.isFinite(transitionStartedAtMs)
            || !Number.isFinite(transitionDurationSec)
            || transitionDurationSec <= 0
        ) {
            // 正常完成时 current 已经是 B，保留终点避免 A 在 exit 阶段闪回；暂停/取消时
            // current 仍是 A，复位起点让仍被 AnimatePresence 保留的 B 立即变透明。
            handoffTimeProgress.set(resolveStoppedTrackHandoffProgress(handoffPairRef.current, trackIdentity));
            setIsTransitionGlowActive(false);
            setIsIncomingDominant(false);
            return;
        }

        const startLocalTimeline = () => {
            const transition = {
                startedAtMs: transitionStartedAtMs,
                durationSec: transitionDurationSec,
                crossover: transitionCrossover,
            };
            const clock = resolveTransitionClock({ transition, isPlaying: true, nowMs: Date.now() });
            if (!clock || clock.timeProgress >= 1) {
                handoffTimeProgress.set(1);
                setIsTransitionGlowActive(false);
                setIsIncomingDominant(true);
                return;
            }

            handoffTimeProgress.set(clock.timeProgress);
            setIsTransitionGlowActive(true);
            setIsIncomingDominant(clock.timeProgress >= transitionCrossover);

            const remainingSec = Math.max(0, transitionDurationSec - Math.max(0, clock.elapsedSec));
            playback = animate(handoffTimeProgress, 1, { duration: remainingSec, ease: 'linear' });
            endTimer = window.setTimeout(() => setIsTransitionGlowActive(false), remainingSec * 1000);
        };

        const startsInMs = transitionStartedAtMs - Date.now();
        if (startsInMs > 0) {
            handoffTimeProgress.set(0);
            setIsTransitionGlowActive(false);
            setIsIncomingDominant(false);
            startTimer = window.setTimeout(startLocalTimeline, startsInMs);
        } else {
            startLocalTimeline();
        }

        return () => {
            playback?.stop();
            if (startTimer !== null) window.clearTimeout(startTimer);
            if (endTimer !== null) window.clearTimeout(endTimer);
        };
    }, [handoffTimeProgress, isPlaying, transitionCrossover, transitionDurationSec, transitionStartedAtMs]);

    // AutoMix/Crossfade 真正开始出声后，把封面、标题、艺术家和背景色一起交接给预读好的下一首。
    // 过渡时长和主导权切换点都来自音频引擎，不再用文件结尾倒推一个固定窗口。
    const nextFace = useMemo<Omit<RemoteTrackFace, 'mode'> | null>(() => {
        const key = nextTrackIdentity;
        if (!key || !snapshot.canGoNext) {
            return null;
        }

        return {
            key,
            title: snapshot.nextTrackTitle || 'Folia',
            artist: snapshot.nextTrackArtist || 'Unknown artist',
            coverUrl: snapshot.nextTrackCoverUrl,
        };
    }, [nextTrackIdentity, snapshot.nextTrackCoverUrl, snapshot.nextTrackTitle, snapshot.nextTrackArtist, snapshot.canGoNext]);

    const isHandoffActive = Boolean(
        isPlaying
        && snapshot.trackTransition
        && nextFace
        && nextFace.key !== trackIdentity,
    );

    const trackFaces = useMemo<RemoteTrackFace[]>(() => {
        const currentFace: RemoteTrackFace = {
            key: trackIdentity,
            title,
            artist,
            coverUrl: snapshot.coverUrl,
            mode: 'current',
        };

        return isHandoffActive && nextFace
            ? [currentFace, { ...nextFace, mode: 'incoming' }]
            : [currentFace];
    }, [trackIdentity, title, artist, snapshot.coverUrl, isHandoffActive, nextFace]);

    // 下一首没有封面（本地曲目常见）时别把当前封面淡成占位符，封面这一层就不参与交接
    const coverFaces = useMemo<RemoteTrackFace[]>(() => {
        return trackFaces.filter(face => face.coverUrl);
    }, [trackFaces]);
    const hasIncomingCoverFace = coverFaces.some(face => face.mode === 'incoming');

    // 交接过半就把背景换成下一首的配色，剩下的交给背景本身 700ms 的颜色过渡。
    // 预读没算完就维持当前配色，切过去后常规取色会补上。
    const handoffCoverColors = isHandoffActive && isIncomingDominant && snapshot.nextTrackCoverUrl
        ? coverColorCacheRef.current.get(snapshot.nextTrackCoverUrl)
        : undefined;
    const activeCoverColors = handoffCoverColors ?? coverColors;

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

    const getCalculatedAspectRatio = (t: (key: string) => string, wStr: string, hStr: string) => {
        const w = Number(wStr);
        const h = Number(hStr);
        if (!w || !h || !Number.isFinite(w) || !Number.isFinite(h)) {
            return '';
        }

        const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
        const divisor = gcd(w, h);
        const aspectW = w / divisor;
        const aspectH = h / divisor;
        const orientationStr = w >= h ? t('remote.landscape') : t('remote.portrait');

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
            return `1:1 (${t('remote.square')})`;
        }
        if (aspectW === 21 && aspectH === 9) {
            return `21:9 (${t('remote.ultrawide')})`;
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
                        <div className={`absolute inset-0 transition-colors duration-300 ${backgroundMode === 'cover' && activeCoverColors.length > 0
                            ? (isDaylight ? 'bg-zinc-100' : 'bg-zinc-950')
                            : (isDaylight ? 'bg-[#f5f5f4]' : 'bg-[#060814]')
                            }`} />

                        {/* Blurry blobs */}
                        {backgroundMode === 'cover' && activeCoverColors.length >= 2 ? (
                            <>
                                <div className="absolute -top-10 -left-10 w-44 h-44 rounded-full blur-[40px] transition-all duration-700 ease-in-out" style={{ backgroundColor: activeCoverColors[0], opacity: isDaylight ? 0.35 : 0.25 }} />
                                <div className="absolute -bottom-16 -right-16 w-52 h-52 rounded-full blur-[50px] transition-all duration-700 ease-in-out" style={{ backgroundColor: activeCoverColors[1], opacity: isDaylight ? 0.35 : 0.25 }} />
                                <div className="absolute top-1/4 right-1/4 w-32 h-32 rounded-full blur-[30px] transition-all duration-700 ease-in-out" style={{ backgroundColor: activeCoverColors[2] || activeCoverColors[0], opacity: isDaylight ? 0.25 : 0.15 }} />
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
                                backgroundMode === 'default' ? t('remote.backgroundDefault') :
                                    backgroundMode === 'cover' ? t('remote.backgroundCover') :
                                        t('remote.backgroundTransparent')
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
                            title={alwaysOnTop ? t('remote.unpin') : t('remote.pinToFront')}
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
                            title={t('remote.close')}
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
                            {/* 手动切歌走方向性淡入；音频过渡则由本地 MotionValue 连续互换两张封面。 */}
                            <AnimatePresence initial={false}>
                                {coverFaces.map(face => {
                                    const localOpacity = face.mode === 'incoming'
                                        ? handoffIncomingOpacity
                                        : isHandoffActive && hasIncomingCoverFace ? handoffOutgoingOpacity : undefined;
                                    return (
                                        <motion.div
                                            key={`cover-${face.key}`}
                                            initial={face.mode === 'incoming'
                                                ? { opacity: 0, scale: 1.02, y: 0 }
                                                : { opacity: 0, scale: 1.06, y: trackEnterOffset }}
                                            animate={{ opacity: localOpacity ? undefined : 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.97, y: -trackEnterOffset }}
                                            transition={face.mode === 'incoming' ? HANDOFF_FACE_TRANSITION : SWITCH_FACE_TRANSITION}
                                            className="absolute inset-0 h-full w-full bg-cover bg-center"
                                            style={{
                                                backgroundImage: `url(${face.coverUrl})`,
                                                ...(localOpacity ? { opacity: localOpacity } : {}),
                                            }}
                                        />
                                    );
                                })}
                            </AnimatePresence>
                            {activePanel !== 'playback' && (
                                <button
                                    type="button"
                                    title={t('remote.back')}
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
                                {/* Preview Sound Name */}
                                <div className="relative h-5 min-w-0">
                                    <AnimatePresence initial={false}>
                                        {trackFaces.map(face => {
                                            const localOpacity = face.mode === 'incoming'
                                                ? handoffIncomingOpacity
                                                : isHandoffActive ? handoffOutgoingOpacity : undefined;
                                            const renderedOpacity = previewTitle ? 0 : localOpacity;
                                            return (
                                                <motion.div
                                                    key={`title-${face.key}`}
                                                    initial={face.mode === 'incoming'
                                                        ? { opacity: 0, x: 0 }
                                                        : { opacity: 0, x: trackEnterOffset }}
                                                    animate={{ opacity: renderedOpacity === undefined ? 1 : undefined, x: 0 }}
                                                    exit={{ opacity: 0, x: -trackEnterOffset }}
                                                    transition={face.mode === 'incoming' ? HANDOFF_FACE_TRANSITION : SWITCH_TEXT_TRANSITION}
                                                    className="absolute inset-0 truncate text-[15px] font-bold leading-5 tracking-[-0.01em]"
                                                    style={renderedOpacity === undefined ? undefined : { opacity: renderedOpacity }}
                                                >
                                                    {face.title}
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                    <div
                                        aria-hidden
                                        className="absolute inset-0 truncate text-[15px] font-bold leading-5 tracking-[-0.01em] transition-opacity duration-200"
                                        style={{ opacity: previewTitle ? 0.55 : 0 }}
                                    >
                                        {previewTitle}
                                    </div>
                                </div>
                                <div className={`relative h-4 mt-0.5 min-w-0 transition-colors ${isDaylight ? 'text-black/50' : 'text-white/40'
                                    }`}>
                                    <AnimatePresence initial={false}>
                                        {trackFaces.map(face => {
                                            const localOpacity = face.mode === 'incoming'
                                                ? handoffIncomingOpacity
                                                : isHandoffActive ? handoffOutgoingOpacity : undefined;
                                            return (
                                                <motion.div
                                                    key={`artist-${face.key}`}
                                                    initial={face.mode === 'incoming'
                                                        ? { opacity: 0, x: 0 }
                                                        : { opacity: 0, x: trackEnterOffset }}
                                                    animate={{ opacity: localOpacity ? undefined : 1, x: 0 }}
                                                    exit={{ opacity: 0, x: -trackEnterOffset }}
                                                    transition={face.mode === 'incoming'
                                                        ? HANDOFF_FACE_TRANSITION
                                                        : { ...SWITCH_TEXT_TRANSITION, delay: 0.04 }}
                                                    className="absolute inset-0 truncate text-xs font-medium leading-4"
                                                    style={localOpacity ? { opacity: localOpacity } : undefined}
                                                >
                                                    {face.artist}
                                                </motion.div>
                                            );
                                        })}
                                    </AnimatePresence>
                                </div>
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

                                                    {/* Glow only while the audio transition cue is active. */}
                                                    {isTransitionGlowActive && (
                                                        <div
                                                            aria-hidden
                                                            className="remote-progress-transition-glow pointer-events-none absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
                                                            style={{
                                                                width: `${progressPercent}%`,
                                                                backgroundColor: activeColor,
                                                                ['--transition-glow-color' as string]: transitionGlowColor,
                                                            } as React.CSSProperties}
                                                        />
                                                    )}

                                                    {/* Transparent Large Hitbox Input Range */}
                                                    <input
                                                        aria-label={t('ui.seek')}
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
                                                                {/* Playback domain: transport with loop mode trailing it */}
                                                                <div className="flex items-center gap-0.5">
                                                                    <button
                                                                        type="button"
                                                                        title={t('remote.previous')}
                                                                        disabled={primaryDisabled || !snapshot.canGoPrevious}
                                                                        onMouseEnter={() => setHoverNavSide('prev')}
                                                                        onMouseLeave={() => setHoverNavSide(null)}
                                                                        onClick={() => navigateTrack('prev')}
                                                                        className={transportButtonClass}
                                                                    >
                                                                        <SkipBack size={17} strokeWidth={2} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        title={isPlaying ? t('remote.pause') : t('remote.play')}
                                                                        disabled={primaryDisabled}
                                                                        onClick={() => sendCommand({ type: 'play-pause' })}
                                                                        className={`flex h-9 w-9 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-30 ${isDaylight
                                                                            ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                                                            : 'bg-white text-zinc-950 hover:bg-white/90'
                                                                            }`}
                                                                    >
                                                                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} className="translate-x-0.5" fill="currentColor" />}
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        title={t('remote.next')}
                                                                        disabled={primaryDisabled || !snapshot.canGoNext}
                                                                        onMouseEnter={() => setHoverNavSide('next')}
                                                                        onMouseLeave={() => setHoverNavSide(null)}
                                                                        onClick={() => navigateTrack('next')}
                                                                        className={transportButtonClass}
                                                                    >
                                                                        <SkipForward size={17} strokeWidth={2} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        title={snapshot.loopMode === 'off' ? t('remote.loopOff') : snapshot.loopMode === 'one' ? t('remote.loopOne') : t('remote.loopAll')}
                                                                        aria-pressed={snapshot.loopMode !== 'off'}
                                                                        disabled={primaryDisabled}
                                                                        onClick={() => sendCommand({ type: 'cycle-loop-mode' })}
                                                                        className={`${secondaryButtonBase} ml-2 ${snapshot.loopMode !== 'off' ? secondaryActiveClass : secondaryIdleClass}`}
                                                                    >
                                                                        {snapshot.loopMode === 'off' ? <RepeatOff size={15} strokeWidth={2} /> : snapshot.loopMode === 'one' ? <Repeat1 size={15} strokeWidth={2} /> : <Repeat size={15} strokeWidth={2} />}
                                                                    </button>
                                                                </div>

                                                                {/* Track reaction, then window tools */}
                                                                <div className="flex items-center gap-0.5">
                                                                    <span className="flex" title={likeUnavailableReason || (snapshot.isLiked ? t('remote.unlike') : t('remote.like'))}>
                                                                        <button
                                                                            type="button"
                                                                            aria-label={likeUnavailableReason || (snapshot.isLiked ? t('remote.unlike') : t('remote.like'))}
                                                                            aria-pressed={snapshot.isLiked}
                                                                            disabled={likeDisabled}
                                                                            onClick={() => sendCommand({ type: 'toggle-like' })}
                                                                            className={`${secondaryButtonBase} ${snapshot.isLiked ? secondaryAlertClass : secondaryIdleClass}`}
                                                                        >
                                                                            <Heart size={15} fill={snapshot.isLiked ? 'currentColor' : 'none'} strokeWidth={2} />
                                                                        </button>
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        title={t('remote.transparentControls')}
                                                                        onClick={() => {
                                                                            setPresetSelectorOpen(false);
                                                                            setActivePanel('transparent-controls');
                                                                        }}
                                                                        className={`${secondaryButtonBase} ml-2 ${secondaryIdleClass}`}
                                                                    >
                                                                        <MirrorRectangular size={15} strokeWidth={2} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        title={t('remote.videoExport')}
                                                                        disabled={!snapshot.hasTrack}
                                                                        onClick={() => setActivePanel('export')}
                                                                        className={`${secondaryButtonBase} ${exportState.status === 'recording' ? `${secondaryAlertClass} animate-pulse` : secondaryIdleClass}`}
                                                                    >
                                                                        <Video size={15} strokeWidth={2} />
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
                                                        {t('remote.standard')}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => sendCommand({ type: 'set-transparent-mode-enabled', enabled: true })}
                                                        className={`flex-1 flex items-center justify-center rounded-lg text-[11px] font-bold transition ${snapshot.transparentModeEnabled
                                                            ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                                            : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                                                            }`}
                                                    >
                                                        {t('remote.transparent')}
                                                    </button>
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => sendCommand({ type: 'cycle-player-chrome-visibility-mode' })}
                                                    className={`flex h-8 items-center justify-center rounded-xl text-[11px] font-bold transition border ${snapshot.playerChromeVisibilityMode === 'always-hidden'
                                                        ? (isDaylight ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm' : 'bg-white border-white text-zinc-950 shadow-sm')
                                                        : (isDaylight ? 'bg-black/5 border-black/5 text-black/70 hover:bg-black/10 hover:text-black' : 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10 hover:text-white')
                                                        }`}
                                                >
                                                    {t(snapshot.playerChromeVisibilityMode === 'always-hidden'
                                                        ? 'remote.uiAlwaysHidden'
                                                        : snapshot.playerChromeVisibilityMode === 'always-visible'
                                                            ? 'remote.uiAlwaysVisible'
                                                            : 'remote.uiAutoHide')}
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
                                                    {snapshot.mainWindowBorderVisible ? t('remote.hideBorder') : t('remote.showBorder')}
                                                </button>

                                                <div className={`grid h-8 grid-cols-2 overflow-hidden rounded-xl border transition-colors ${isDaylight ? 'border-black/5 bg-black/5' : 'border-white/5 bg-white/5'
                                                    }`}>
                                                    <button
                                                        type="button"
                                                        disabled={!snapshot.transparentModeEnabled}
                                                        title={snapshot.mainWindowClickThroughEnabled ? t('remote.disableClickThrough') : t('remote.enableClickThrough')}
                                                        aria-pressed={snapshot.mainWindowClickThroughEnabled}
                                                        onClick={() => sendCommand({ type: 'set-main-window-click-through', enabled: !snapshot.mainWindowClickThroughEnabled })}
                                                        className={`flex h-full items-center justify-center gap-1 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${snapshot.mainWindowClickThroughEnabled
                                                            ? (isDaylight ? 'bg-zinc-900 text-white shadow-sm' : 'bg-white text-zinc-950 shadow-sm')
                                                            : (isDaylight ? 'text-black/70 hover:bg-black/5 hover:text-black' : 'text-white/70 hover:bg-white/5 hover:text-white')
                                                            }`}
                                                    >
                                                        {snapshot.mainWindowClickThroughEnabled ? <Lock size={12} /> : <LockOpen size={12} />}
                                                        <span>{t('remote.through')}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        title={snapshot.mainWindowAlwaysOnTop ? t('remote.unpinMainWindow') : t('remote.pinMainWindow')}
                                                        aria-pressed={snapshot.mainWindowAlwaysOnTop}
                                                        onClick={() => sendCommand({ type: 'set-main-window-always-on-top', enabled: !snapshot.mainWindowAlwaysOnTop })}
                                                        className={`flex h-full items-center justify-center gap-1 border-l text-[10px] font-bold transition ${snapshot.mainWindowAlwaysOnTop
                                                            ? (isDaylight ? 'border-zinc-900 bg-zinc-900 text-white shadow-sm' : 'border-white bg-white text-zinc-950 shadow-sm')
                                                            : (isDaylight ? 'border-black/5 text-black/70 hover:bg-black/5 hover:text-black' : 'border-white/5 text-white/70 hover:bg-white/5 hover:text-white')
                                                            }`}
                                                    >
                                                        {snapshot.mainWindowAlwaysOnTop ? <Pin size={12} /> : <PinOff size={12} />}
                                                        <span>{t('remote.pin')}</span>
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
                                    }`}>{t('remote.presetSelectorTitle')}</span>
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
                                                        {t('remote.preset', { index: index + 1 })} ({preset.orientation === 'portrait' ? t('remote.portrait') : t('remote.landscape')})
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
                                                {t('remote.customPreset', { index: exportPresets.findIndex(p => p.id === selectedPresetId) + 1 })}
                                            </span>
                                        </div>

                                        <div className="grid grid-cols-2 gap-2">
                                            <label
                                                className={`flex flex-col rounded-xl px-2 py-1 transition-colors border ${isDaylight
                                                    ? 'bg-white/80 border-black/5 focus-within:border-black/25'
                                                    : 'bg-zinc-950/35 border-white/5 focus-within:border-white/20'
                                                    }`}
                                            >
                                                <span className="text-[9px] opacity-50 font-semibold">{t('remote.widthPx')}</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={draftWidth}
                                                    onFocus={() => { widthFocusedRef.current = true; }}
                                                    onBlur={() => {
                                                        widthFocusedRef.current = false;
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
                                                <span className="text-[9px] opacity-50 font-semibold">{t('remote.heightPx')}</span>
                                                <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    value={draftHeight}
                                                    onFocus={() => { heightFocusedRef.current = true; }}
                                                    onBlur={() => {
                                                        heightFocusedRef.current = false;
                                                    }}
                                                    onChange={(event) => setDraftHeight(event.currentTarget.value.replace(/[^\d]/g, ''))}
                                                    className="bg-transparent text-[11px] font-semibold outline-none w-full"
                                                />
                                            </label>
                                        </div>

                                        {getCalculatedAspectRatio(t, draftWidth, draftHeight) && (
                                            <div className="mt-1.5 flex items-center px-0.5">
                                                <span className={`text-[9px] font-semibold transition-colors px-1.5 py-0.5 rounded ${isDaylight ? 'bg-black/5 text-black/60' : 'bg-white/5 text-white/60'
                                                    }`}>
                                                    {t('remote.aspectRatio')} {getCalculatedAspectRatio(t, draftWidth, draftHeight)}
                                                </span>
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-1 mt-1">
                                        <div className={`text-[9px] leading-tight opacity-50 ${isDaylight ? 'text-black' : 'text-white'}`}>
                                            {t('remote.rangeHint', { min: VIDEO_EXPORT_PRESET_MIN, max: VIDEO_EXPORT_PRESET_MAX })} {t('remote.encodingHint')}
                                        </div>
                                        <button
                                            type="button"
                                            onClick={handleApplyCustomPresetValues}
                                            className={`flex h-8 items-center justify-center rounded-lg text-[11px] font-bold shadow-sm transition active:scale-[0.98] ${isDaylight
                                                ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                                                : 'bg-white text-zinc-950 hover:bg-white/90'
                                                }`}
                                        >
                                            {t('remote.saveToPreset', { index: exportPresets.findIndex(p => p.id === selectedPresetId) + 1 })}
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
