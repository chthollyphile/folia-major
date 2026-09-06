import React from 'react';
import { motion, AnimatePresence, useTransform } from 'framer-motion';
import { Settings, Settings2, X, Disc, SlidersHorizontal, ListMusic, User as UserIcon, Home as HomeIcon, FileAudio, FileText, Radio, Cloud, Star, Command, ChevronLeft, MirrorRectangular } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Album, Artist, SongResult, Theme, PlayerState, ReplayGainMode, ThemeMode, VisualizerMode } from '../types';
import type { ProviderUser } from '../types/onlineMusic';
import CoverTab from './panelTab/CoverTab';
import ControlsTab from './panelTab/ControlsTab';
import QueueTab from './panelTab/QueueTab';
import AccountTab from './panelTab/AccountTab';
import LocalTab from './panelTab/LocalTab';
import FmTab from './panelTab/FmTab';
import NaviTab from './panelTab/NaviTab';
import OnlineLyricsTab from './panelTab/OnlineLyricsTab';
import type { OnlineLyricsState } from '../types';
import type { AudioQualityPreference } from '../types/onlineMusic';
import type { ThemeSourceModel } from '../hooks/themeControllerState';
import { getPlaybackSourceRef, getPlaybackSongSource, hasMixedPlaybackSources } from '../utils/appPlaybackGuards';
import { resolveLikeAvailability } from '../utils/playerLikeAvailability';
import { usePlayerBottomBarBottomPx } from '../hooks/usePlayerBottomBarBottomPx';
import { useLiquidGlassFilter } from './shared/LiquidGlassFilter';
import { buildGlassTintStyle, resolveLiquidGlassTintMultiplier, resolveSurfaceDispersion, useLiquidGlassTuningStore } from '../stores/useLiquidGlassTuningStore';
import { getSizedCoverUrl } from '../utils/coverUrl';
import { openAddToPlaylist, useAddToPlaylistStore } from '../stores/useAddToPlaylistStore';
import { usePlayerPanelTabShortcut } from '../hooks/usePlayerPanelTabShortcut';
import { countRender } from '../dev/renderCount';

const TOUCH_GUIDE_DISPLAY_MS = 1400;

export type PanelTab = 'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi' | 'onlineLyrics';

type UnifiedPanelPlaybackProps = {
    isOpen: boolean;
    currentTab: PanelTab;
    onTabChange: (tab: PanelTab) => void;
    onToggle: () => void;
    onNavigateHome: () => void;
    onNavigateHomeDirect: () => void;
    coverUrl: string | null;
    currentSong: SongResult | null;
    onAlbumSelect: (song: SongResult, album: Album) => void;
    onSelectArtist: (song: SongResult, artist: Artist) => void;
    loopMode: 'off' | 'all' | 'one';
    onToggleLoop: () => void;
    onLike: () => void;
    isLiked: boolean;
    onGenerateAITheme: () => void;
    isGeneratingTheme: boolean;
    hasLyrics: boolean;
    canGenerateAITheme: boolean;
    theme: Theme;
    onThemeChange: (theme: Theme) => void;
    bgMode: ThemeMode;
    onBgModeChange: (mode: ThemeMode) => void;
    hasCustomTheme: boolean;
    themeSourceModel: ThemeSourceModel;
    onResetTheme: () => void;
    defaultTheme: Theme;
    daylightTheme: Theme;
    visualizerMode: VisualizerMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean, fileName?: string) => void;
    onChangeLyricsSource: (source: 'local' | 'embedded' | 'online') => void;
    onlineLyricsState: OnlineLyricsState | null;
    onImportOnlineLyrics: (content: string, fileName: string) => void;
    onChangeOnlineLyricsSource: (source: 'online' | 'imported') => void;
    onMatchOnlineLyrics: () => void;
    onClearOnlineLyricsState: () => void;
    lyricTimelineOffsetMs: number;
    onLyricTimelineOffsetChange: (offsetMs: number) => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    isFmMode: boolean;
    fmModeLabel: string;
    onOpenFmModePicker?: () => void;
    onFmTrash: () => void;
    onNextTrack: () => void;
    onPrevTrack: () => void;
    playerState: PlayerState;
    onTogglePlay: () => void;
    volume: number;
    isMuted: boolean;
    onVolumePreview: (val: number) => void;
    onVolumeChange: (val: number) => void;
    onToggleMute: () => void;
    showOpenPanelCloseButton: boolean;
    isPanelGuideHotspotActive?: boolean;
    hideToggleButton?: boolean;
    isStageContext?: boolean;
    playbackControlsDisabled?: boolean;
    onOpenSettings?: () => void;
    onOpenCommandPalette?: () => void;
    isCommandPaletteOpen?: boolean;
    transparentPlayerBackground: boolean;
    onToggleTransparentPlayerBackground: (enable: boolean) => void;
};

type UnifiedPanelQueueProps = {
    playQueue: SongResult[];
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement | null>;
    onShuffle: () => void;
    onRemoveSong: (index: number) => void;
    onMoveSongToEnd: (index: number) => void;
    onMoveSongToNext: (index: number) => void;
    onOpenLattice?: () => void;
};

type UnifiedPanelAccountProps = {
    user: ProviderUser | null;
    onLogout: () => void;
    audioQuality: AudioQualityPreference;
    onAudioQualityChange: (quality: AudioQualityPreference) => void;
    cacheSize: string;
    onClearCache: () => void;
    onSyncData: () => void;
    isSyncing: boolean;
    useCoverColorBg: boolean;
    onToggleCoverColorBg: (enable: boolean) => void;
    isDaylight: boolean;
    onToggleDaylight: () => void;
};

type UnifiedPanelLibraryProps = {
    onSaveCurrentQueueAsPlaylist: (name: string) => Promise<void>;
    onOpenCurrentLocalAlbum: () => void;
    onOpenCurrentLocalArtist: (entityId?: string) => void;
    onOpenCurrentNavidromeAlbum: () => void;
    onOpenCurrentNavidromeArtist: () => void;
    onCopySongInfoSuccess: () => void;
};

type UnifiedPanelProps = {
    playback: UnifiedPanelPlaybackProps;
    queue: UnifiedPanelQueueProps;
    library: UnifiedPanelLibraryProps;
    account: UnifiedPanelAccountProps;
};

// 封面上的浮动操作按钮（设置/播放页透明/返回首页/加入歌单）。玻璃滤镜逐钮挂载；
// 按钮只随面板一起挂载，无需单独的 enabled 控制。底色走预设表 tint：白字压在封面
// 上需要深底保证可读，所以刻意恒取暗色侧（darkTint × panelCoverButton 倍率），
// 不随主题翻成白霜；hover 加深按旧 hover:bg-black/40 换算成 ×1.6 倍率。
// 面板本身是 backdrop root，按钮玻璃采样到的是面板内部画在按钮下方的封面图，
// 折射源成立。显隐淡入淡出必须挂在按钮自身（coverActionRevealClass），不能挂回
// wrapper——opacity<1 的祖先会形成 backdrop root 致盲玻璃，过渡结束玻璃才跳回。
const CoverActionButton: React.FC<{
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
    title: string;
    ariaLabel?: string;
    ariaPressed?: boolean;
    disabled?: boolean;
    className: string;
    /** 激活态白底变体（播放页透明开启时）不吃 inline tint，底色与 hover 反馈都留给 class */
    suppressTint?: boolean;
    children: React.ReactNode;
}> = ({ onClick, title, ariaLabel, ariaPressed, disabled, suppressTint, className, children }) => {
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const [isHovered, setIsHovered] = React.useState(false);
    const liquidGlassTuning = useLiquidGlassTuningStore(state => state.liquidGlassTuning);
    const { defs: glassFilterDefs, backdropFilter: glassBackdropFilter } = useLiquidGlassFilter(buttonRef, {
        blur: liquidGlassTuning.blur,
        saturation: liquidGlassTuning.saturation,
        edgeDisplacement: liquidGlassTuning.edgeDisplacement,
        // 小尺寸按钮不做表面级色散禁用，直接跟随全局
        dispersion: liquidGlassTuning.dispersion,
    });
    const tintStyle = suppressTint ? null : buildGlassTintStyle(
        liquidGlassTuning,
        false,
        resolveLiquidGlassTintMultiplier('panelCoverButton', false, isHovered ? 1.6 : 1),
    );
    return (
        <>
            {glassFilterDefs}
            <button
                ref={buttonRef}
                type="button"
                onClick={onClick}
                disabled={disabled}
                aria-pressed={ariaPressed}
                aria-label={ariaLabel}
                title={title}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                style={{ backdropFilter: glassBackdropFilter ?? undefined, ...tintStyle }}
                className={className}
            >
                {children}
            </button>
        </>
    );
};

const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
    playback,
    queue,
    library,
    account,
}) => {
    countRender('UnifiedPanel');
    const { t } = useTranslation();
    const {
        isOpen,
        currentTab,
        onTabChange,
        onToggle,
        onNavigateHome,
        onNavigateHomeDirect,
        coverUrl,
        currentSong,
        onAlbumSelect,
        onSelectArtist,
        loopMode,
        onToggleLoop,
        onLike,
        isLiked,
        onGenerateAITheme,
        isGeneratingTheme,
        hasLyrics,
        canGenerateAITheme,
        theme,
        onThemeChange,
        bgMode,
        onBgModeChange,
        hasCustomTheme,
        themeSourceModel,
        defaultTheme,
        daylightTheme,
        visualizerMode,
        onVisualizerModeChange,
        onMatchOnline,
        onUpdateLocalLyrics,
        onChangeLyricsSource,
        onlineLyricsState,
        onImportOnlineLyrics,
        onChangeOnlineLyricsSource,
        onMatchOnlineLyrics,
        onClearOnlineLyricsState,
        lyricTimelineOffsetMs,
        onLyricTimelineOffsetChange,
        replayGainMode,
        onChangeReplayGainMode,
        isFmMode,
        fmModeLabel,
        onOpenFmModePicker,
        onFmTrash,
        onNextTrack,
        onPrevTrack,
        playerState,
        onTogglePlay,
        volume,
        isMuted,
        onVolumePreview,
        onVolumeChange,
        onToggleMute,
        showOpenPanelCloseButton,
        isPanelGuideHotspotActive = false,
        hideToggleButton = false,
        isStageContext = false,
        playbackControlsDisabled = false,
        onOpenSettings,
        onOpenCommandPalette,
        isCommandPaletteOpen = false,
        transparentPlayerBackground,
        onToggleTransparentPlayerBackground,
    } = playback;
    const { playQueue, onPlaySong, queueScrollRef, onShuffle, onRemoveSong, onMoveSongToEnd, onMoveSongToNext } = queue;
    const {
        onSaveCurrentQueueAsPlaylist,
        onOpenCurrentLocalAlbum,
        onOpenCurrentLocalArtist,
        onOpenCurrentNavidromeAlbum,
        onOpenCurrentNavidromeArtist,
        onCopySongInfoSuccess,
    } = library;
    const {
        user,
        onLogout,
        audioQuality,
        onAudioQualityChange,
        cacheSize,
        onClearCache,
        onSyncData,
        isSyncing,
        useCoverColorBg,
        onToggleCoverColorBg,
        isDaylight,
        onToggleDaylight,
    } = account;
    const coverAreaRef = React.useRef<HTMLDivElement>(null);
    const [isCoverActionsVisible, setIsCoverActionsVisible] = React.useState(false);
    const [showGuideLine, setShowGuideLine] = React.useState(false);
    const [isDragging, setIsDragging] = React.useState(false);
    const guideHideTimeoutRef = React.useRef<number | null>(null);

    const isStage = isStageContext || Boolean(currentSong && (currentSong as any).isStage === true);
    const isNavidrome = currentSong && (currentSong as any).isNavidrome === true;
    const isLocal = currentSong && !isNavidrome && (((currentSong as any).isLocal === true) || Boolean((currentSong as any).localRef?.songId));
    const playbackSourceRef = currentSong ? getPlaybackSourceRef(currentSong) : null;
    const isOnline = playbackSourceRef?.kind === 'online';
    const bottomBarBottomPx = usePlayerBottomBarBottomPx();
    const panelMaxHeight = useTransform(
        bottomBarBottomPx,
        bottom => `calc(100dvh - ${bottom + 64}px)`,
    );
    const likeAvailability = resolveLikeAvailability(currentSong, playbackControlsDisabled, isStage);
    const likeDisabledReason = likeAvailability.reason
        ? t(likeAvailability.reason.key, likeAvailability.reason.params)
        : undefined;
    const likeDisabled = likeAvailability.disabled;
    // Answered by AddToPlaylistHost, which owns the picker now: the same question is asked by a
    // command that can fire with this panel closed, so it cannot be derived from panel props.
    const addToPlaylist = useAddToPlaylistStore(state => state.availability);
    const showAddToPlaylistAction = addToPlaylist.isApplicable;
    const canAddCurrentSongToPlaylist = addToPlaylist.canAdd;
    const addToPlaylistDisabledReason = addToPlaylist.disabledReason;
    const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    const tabs = [
        { id: 'cover' as PanelTab, label: t('panel.cover'), icon: Disc },
        { id: 'controls' as PanelTab, label: t('panel.controls'), icon: SlidersHorizontal },
        isFmMode 
            ? { id: 'queue' as PanelTab, label: t('home.radio'), icon: Radio }
            : { id: 'queue' as PanelTab, label: t('panel.playlist'), icon: ListMusic },
        { id: 'account' as PanelTab, label: t('panel.account'), icon: UserIcon },
    ];

    if (isLocal) {
        tabs.splice(1, 0, { id: 'local' as PanelTab, label: t('localMusic.folder'), icon: FileAudio });
    } else if (isNavidrome) {
        tabs.splice(1, 0, { id: 'navi' as PanelTab, label: 'Navidrome', icon: Cloud });
    } else if (isOnline) {
        tabs.splice(1, 0, { id: 'onlineLyrics' as PanelTab, label: t('localMusic.lyrics'), icon: FileText });
    }

    usePlayerPanelTabShortcut({
        isOpen,
        currentTab,
        availableTabs: tabs.map(tab => tab.id),
        onTabChange,
    });

    // Theme Helper
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated
    const isAI = bgMode === 'ai'; // AI themes usually dark
    const commandSlideRef = React.useRef<{ startX: number; startY: number; triggered: boolean; } | null>(null);
    const suppressToggleClickRef = React.useRef(false);
    const toggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const trackEndIconRef = React.useRef<HTMLDivElement | null>(null);
    const trackFillRef = React.useRef<HTMLDivElement | null>(null);
    // 液态玻璃：与播放页胶囊/时间线共享实验室调参；面板条件挂载，用 glassActive 控制 RO 时机。
    // glassActive 滞后挂载条件一个退场动画：enabled 立刻翻 false 会让表面在退场前半段
    // 突变成普通毛玻璃（rim/折射瞬间消失），保持到 onExitComplete 再卸。
    const liquidGlassTuning = useLiquidGlassTuningStore(state => state.liquidGlassTuning);
    const [panelGlassActive, setPanelGlassActive] = React.useState(isOpen);
    React.useEffect(() => {
        if (isOpen) setPanelGlassActive(true);
    }, [isOpen]);
    const glassBgStyle = buildGlassTintStyle(liquidGlassTuning, isDaylight, resolveLiquidGlassTintMultiplier('cornerPanel', isDaylight));
    // 开合按钮也迁移到 tint：底色倍率查预设表（复现旧 black/40、white/70 的观感）。
    // 拖拽反馈会命令式写 backgroundColor，复位时恢复这个 tint 值而不是清空。
    const toggleTintStyle = buildGlassTintStyle(liquidGlassTuning, isDaylight, resolveLiquidGlassTintMultiplier('panelToggleButton', isDaylight));
    const panelSurfaceRef = React.useRef<HTMLDivElement>(null);
    const { defs: glassFilterDefs, backdropFilter: glassBackdropFilter } = useLiquidGlassFilter(panelSurfaceRef, {
        blur: liquidGlassTuning.blur,
        saturation: liquidGlassTuning.saturation,
        edgeDisplacement: liquidGlassTuning.edgeDisplacement,
        dispersion: resolveSurfaceDispersion('cornerPanel', liquidGlassTuning.dispersion),
        shape: 'rounded',
        cornerRadius: 24,
        enabled: panelGlassActive,
    });
    // 右下角开合按钮的挂载条件（与底部 AnimatePresence 一致）。
    const showToggleChrome = !hideToggleButton && (!isOpen || showOpenPanelCloseButton) && !isCommandPaletteOpen;
    const [toggleGlassActive, setToggleGlassActive] = React.useState(showToggleChrome);
    React.useEffect(() => {
        if (showToggleChrome) setToggleGlassActive(true);
    }, [showToggleChrome]);
    // 右下角开合按钮也吃玻璃：底色走预设表 tint（拖拽反馈复位时恢复同值）；
    // 面板打开的 X 退出态同样走 tint（osu! 拖拽手势只在关闭态存在，无反馈冲突）。
    const { defs: toggleGlassDefs, backdropFilter: toggleGlassBackdropFilter } = useLiquidGlassFilter(toggleButtonRef, {
        blur: liquidGlassTuning.blur,
        saturation: liquidGlassTuning.saturation,
        edgeDisplacement: liquidGlassTuning.edgeDisplacement,
        dispersion: resolveSurfaceDispersion('panelToggleButton', liquidGlassTuning.dispersion),
        enabled: toggleGlassActive,
    });
    const placeholderBg = isDaylight ? 'bg-stone-200' : 'bg-zinc-900';
    const activeTabBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const tabSwitcherBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const canSlideOpenCommandPalette = !isOpen && Boolean(onOpenCommandPalette);
    const isGuideLineVisible = canSlideOpenCommandPalette && (showGuideLine || isPanelGuideHotspotActive);
    const toggleButtonMotionClass = (isOpen || isGuideLineVisible || isDragging)
        ? 'translate-x-0 opacity-100'
        : supportsHover
            ? 'translate-x-1/2 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105'
            : 'translate-x-1/2 opacity-60';
    const setCommandDestinationFeedback = (progress: number) => {
        const iconContainer = trackEndIconRef.current;
        if (!iconContainer) {
            return;
        }

        iconContainer.style.opacity = String(0.35 + progress * 0.65);
        iconContainer.style.transform = `scale(${1.0 + progress * 0.15}) rotate(${progress * 45}deg)`;

        if (progress >= 1) {
            iconContainer.style.color = theme.accentColor;
        } else {
            iconContainer.style.color = '';
        }
    };
    const resetCommandDestinationFeedback = () => {
        const iconContainer = trackEndIconRef.current;
        if (!iconContainer) {
            return;
        }

        iconContainer.style.transition = 'opacity 150ms ease-out, transform 150ms ease-out, color 150ms ease-out';
        iconContainer.style.opacity = '0.35';
        iconContainer.style.transform = 'scale(1) rotate(0deg)';
        iconContainer.style.color = '';
    };
    const setToggleButtonDragFeedback = (deltaX: number) => {
        const button = toggleButtonRef.current;
        if (!button) {
            return;
        }

        const dragX = Math.max(-44, Math.min(0, deltaX));
        const progress = Math.min(1, Math.abs(dragX) / 36);
        button.style.transition = 'none';
        button.style.transform = `translateX(${dragX}px)`;
        button.style.filter = `brightness(${1 + progress * 0.18})`;

        const icon = button.querySelector('svg');
        if (icon) {
            icon.style.transform = `rotate(${progress * -180}deg)`;
            icon.style.scale = String(1 - progress * 0.1);
        }

        if (progress >= 1) {
            button.style.backgroundColor = theme.accentColor;
            button.style.color = '#ffffff';
            button.style.boxShadow = `0 0 16px ${theme.accentColor}66, 0 18px 42px rgba(0, 0, 0, ${0.24 + progress * 0.16})`;
        } else {
            // 松手/未触发时恢复 tint 底色（inline），不能清空——清空后 React 不会重写 inline 样式
            button.style.backgroundColor = toggleTintStyle.backgroundColor;
            button.style.color = '';
            button.style.boxShadow = `0 18px 42px rgba(0, 0, 0, ${0.24 + progress * 0.16})`;
        }

        // update osu! Slider Track Fill
        const trackFill = trackFillRef.current;
        if (trackFill) {
            trackFill.style.transition = 'none';
            trackFill.style.width = `${48 + Math.abs(dragX)}px`;
            if (progress >= 1) {
                trackFill.style.backgroundColor = theme.accentColor;
                trackFill.style.opacity = '0.35';
            } else {
                trackFill.style.backgroundColor = '';
                trackFill.style.opacity = '';
            }
        }

        const iconContainer = trackEndIconRef.current;
        if (iconContainer) {
            iconContainer.style.transition = 'none';
        }

        setCommandDestinationFeedback(progress);
    };
    const resetToggleButtonDragFeedback = (mode: 'release' | 'trigger' = 'release', deltaX = 0) => {
        setIsDragging(false);
        const button = toggleButtonRef.current;
        if (!button) {
            resetCommandDestinationFeedback();
            return;
        }

        const dragX = Math.max(-44, Math.min(0, deltaX));

        if (mode === 'trigger') {
            button.animate(
                [
                    { transform: `translateX(${dragX}px) scale(1)`, opacity: '1', filter: 'brightness(1.18)' },
                    { transform: 'translateX(-80px) scale(0.8)', opacity: '0' },
                ],
                { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
            );

            const iconContainer = trackEndIconRef.current;
            if (iconContainer) {
                iconContainer.animate(
                    [
                        { transform: 'scale(1.15) rotate(45deg)', opacity: '1' },
                        { transform: 'translateX(-40px) scale(0.9) rotate(45deg)', opacity: '0' },
                    ],
                    { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
                );
            }

            const trackFill = trackFillRef.current;
            if (trackFill) {
                trackFill.animate(
                    [
                        { width: `${48 + Math.abs(dragX)}px`, opacity: '0.35' },
                        { width: '96px', opacity: '0' },
                    ],
                    { duration: 250, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
                );
            }

            resetCommandDestinationFeedback();

            button.style.transition = '';
            button.style.transform = '';
            button.style.filter = '';
            button.style.boxShadow = '';
            button.style.backgroundColor = toggleTintStyle.backgroundColor;
            button.style.color = '';
            const icon = button.querySelector('svg');
            if (icon) {
                icon.style.transition = '';
                icon.style.transform = '';
                icon.style.scale = '';
            }

            if (trackFill) {
                trackFill.style.transition = '';
                trackFill.style.width = '48px';
                trackFill.style.backgroundColor = '';
                trackFill.style.opacity = '';
            }

            if (iconContainer) {
                iconContainer.style.transition = '';
                iconContainer.style.opacity = '0.35';
                iconContainer.style.transform = '';
                iconContainer.style.color = '';
            }
            return;
        }

        resetCommandDestinationFeedback();
        button.style.transition = 'transform 160ms ease-out, filter 160ms ease-out, box-shadow 160ms ease-out, background-color 160ms ease-out, color 160ms ease-out';
        button.style.transform = '';
        button.style.filter = '';
        button.style.boxShadow = '';
        button.style.backgroundColor = toggleTintStyle.backgroundColor;
        button.style.color = '';

        const icon = button.querySelector('svg');
        if (icon) {
            icon.style.transition = 'transform 160ms ease-out, scale 160ms ease-out';
            icon.style.transform = '';
            icon.style.scale = '';
        }

        const trackFill = trackFillRef.current;
        if (trackFill) {
            trackFill.style.transition = 'width 160ms ease-out, background-color 160ms ease-out, opacity 160ms ease-out';
            trackFill.style.width = '48px';
            trackFill.style.backgroundColor = '';
            trackFill.style.opacity = '';
        }
    };
    const handleToggleButtonPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!canSlideOpenCommandPalette) {
            return;
        }

        commandSlideRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            triggered: false,
        };
        suppressToggleClickRef.current = false;
        setShowGuideLine(false);
        setIsDragging(true);

        setToggleButtonDragFeedback(0);
        event.currentTarget.setPointerCapture?.(event.pointerId);
    };
    const handleToggleButtonPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        const gesture = commandSlideRef.current;
        if (!canSlideOpenCommandPalette || !gesture || gesture.triggered) {
            return;
        }

        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        setToggleButtonDragFeedback(deltaX);
        if (deltaX <= -36 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
            gesture.triggered = true;
            suppressToggleClickRef.current = true;
            event.preventDefault();
            resetToggleButtonDragFeedback('trigger', deltaX);
            onOpenCommandPalette?.();
        }
    };
    const handleToggleButtonMouseEnter = () => {
        if (supportsHover && canSlideOpenCommandPalette) {
            setShowGuideLine(true);
        }
    };
    const handleToggleButtonMouseLeave = () => {
        if (supportsHover) {
            setShowGuideLine(false);
        }
    };
    const handleToggleHotspotPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (event.pointerType !== 'touch' || !canSlideOpenCommandPalette) {
            return;
        }

        if (event.target instanceof Node && toggleButtonRef.current?.contains(event.target)) {
            return;
        }

        if (guideHideTimeoutRef.current !== null) {
            window.clearTimeout(guideHideTimeoutRef.current);
        }

        setShowGuideLine(true);
        guideHideTimeoutRef.current = window.setTimeout(() => {
            guideHideTimeoutRef.current = null;
            setShowGuideLine(false);
        }, TOUCH_GUIDE_DISPLAY_MS);
    };
    const clearToggleButtonGesture = () => {
        commandSlideRef.current = null;
        resetToggleButtonDragFeedback();
    };
    const handleToggleButtonClick = (event: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressToggleClickRef.current) {
            suppressToggleClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        onToggle();
    };
    const handleNavigateHome = () => {
        setIsCoverActionsVisible(false);
        onToggle();
        onNavigateHomeDirect();
    };

    // 关闭面板并导航回首页，同时打开设置页面
    const handleOpenSettings = () => {
        setIsCoverActionsVisible(false);
        onToggle();
        onOpenSettings?.();
    };

    React.useEffect(() => {
        if (!isOpen) {
            setIsCoverActionsVisible(false);
        }
    }, [isOpen]);

    React.useEffect(() => () => {
        if (guideHideTimeoutRef.current !== null) {
            window.clearTimeout(guideHideTimeoutRef.current);
        }
    }, []);

    React.useEffect(() => {
        setIsCoverActionsVisible(false);
    }, [currentTab, currentSong?.id]);

    React.useEffect(() => {
        if (supportsHover || !isCoverActionsVisible) {
            return undefined;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }

            if (!coverAreaRef.current?.contains(target)) {
                setIsCoverActionsVisible(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isCoverActionsVisible, supportsHover]);

    // 显隐的 opacity 必须落在按钮自身：opacity<1 的祖先会形成 backdrop root，
    // 淡入期间按钮玻璃采样不到下方封面图，过渡结束才跳回来（玻璃与动画不连贯的根源）。
    // 位移 slide 留在 wrapper——transform 不形成 backdrop root，采样全程有效。
    // 注意这条链上不能出现 important 版 opacity 或 disabled:opacity-40 之类的
    // 高优先级 opacity：它们会压过 group-hover:opacity-100，hover 再也唤不出按钮。
    // 「加入歌单」禁用态的变灰因此用 text-white/40 而不是 opacity。
    const coverActionRevealClass = supportsHover
        ? 'opacity-0 group-hover:opacity-100 duration-200'
        : `duration-200 ${isCoverActionsVisible ? 'opacity-100' : 'opacity-0'}`;

    return (
        <motion.div
            style={{ bottom: bottomBarBottomPx }}
            className="absolute right-0 z-[60] flex flex-col items-end gap-4 pointer-events-none"
            onClick={(e) => e.stopPropagation()}
        >
            {glassFilterDefs}
            {toggleGlassDefs}
            <div className="pr-4 md:pr-8">
                <AnimatePresence onExitComplete={() => setPanelGlassActive(false)}>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, originY: 1, originX: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            data-testid="unified-panel-surface"
                            ref={panelSurfaceRef}
                            style={{
                                color: theme.primaryColor,
                                maxHeight: panelMaxHeight,
                                backdropFilter: glassBackdropFilter ?? undefined,
                                ...glassBgStyle,
                            }}
                            className={`pointer-events-auto w-80 backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col mb-16 md:mb-2 overflow-y-auto hide-scrollbar`}
                        >
                            <div className="p-5 flex flex-col">
                                {/* Top: Cover Art */}
                                <div
                                    ref={coverAreaRef}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        if (!supportsHover) {
                                            setIsCoverActionsVisible(prev => !prev);
                                        }
                                    }}
                                    className={`w-full aspect-square rounded-2xl overflow-hidden shadow-lg relative mb-4 ${placeholderBg} flex items-center justify-center group cursor-pointer`}
                                >
                                    {coverUrl ? (
                                        <img src={getSizedCoverUrl(coverUrl, 512)} alt="Art" decoding="async" className="w-full h-full object-cover" />
                                    ) : (
                                        <Disc size={40} className="text-white/20" />
                                    )}

                                    <div className={`absolute inset-0 pointer-events-none transition-opacity duration-200 ${
                                        supportsHover
                                            ? 'opacity-0 group-hover:opacity-100'
                                            : (isCoverActionsVisible ? 'opacity-100' : 'opacity-0')
                                    }`}>
                                        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
                                    </div>

                                    {/* 左上角：打开设置 */}
                                    {onOpenSettings && (
                                        <div className={`absolute left-3 top-3 transition-transform duration-200 ${
                                            supportsHover
                                                ? 'pointer-events-none group-hover:pointer-events-auto -translate-x-3 -translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                                : `${isCoverActionsVisible ? 'pointer-events-auto translate-x-0 translate-y-0' : 'pointer-events-none -translate-x-3 -translate-y-3'}`
                                        }`}>
                                            <CoverActionButton
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleOpenSettings();
                                                }}
                                                title={t('ui.options')}
                                                className={`w-11 h-11 rounded-full border border-white/15 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:text-white ${coverActionRevealClass}`}
                                            >
                                                <Settings size={18} />
                                            </CoverActionButton>
                                        </div>
                                    )}

                                    {/* 右上角：播放页透明。不算高频，所以只占封面的空位，不占面板结构 */}
                                    <div className={`absolute right-3 top-3 transition-transform duration-200 ${
                                        supportsHover
                                            ? 'pointer-events-none group-hover:pointer-events-auto translate-x-3 -translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                            : `${isCoverActionsVisible ? 'pointer-events-auto translate-x-0 translate-y-0' : 'pointer-events-none translate-x-3 -translate-y-3'}`
                                    }`}>
                                        <CoverActionButton
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                onToggleTransparentPlayerBackground(!transparentPlayerBackground);
                                            }}
                                            title={t('options.transparentPlayerBackground')}
                                            ariaLabel={t('options.transparentPlayerBackground')}
                                            ariaPressed={transparentPlayerBackground}
                                            suppressTint={transparentPlayerBackground}
                                            className={`w-11 h-11 rounded-full border backdrop-blur-md flex items-center justify-center transition-all ${coverActionRevealClass} ${
                                                transparentPlayerBackground
                                                    ? 'border-white/30 bg-white/85 text-zinc-900 hover:bg-white'
                                                    : 'border-white/15 text-white/90 hover:text-white'
                                            }`}
                                        >
                                            <MirrorRectangular size={18} />
                                        </CoverActionButton>
                                    </div>

                                    <div className={`absolute left-3 bottom-3 transition-transform duration-200 ${
                                        supportsHover
                                            ? 'pointer-events-none group-hover:pointer-events-auto -translate-x-3 translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                            : `${isCoverActionsVisible ? 'pointer-events-auto translate-x-0 translate-y-0' : 'pointer-events-none -translate-x-3 translate-y-3'}`
                                    }`}>
                                        <CoverActionButton
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleNavigateHome();
                                            }}
                                            title={t('ui.backToHome')}
                                            className={`w-11 h-11 rounded-full border border-white/15 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:text-white ${coverActionRevealClass}`}
                                        >
                                            <HomeIcon size={18} />
                                        </CoverActionButton>
                                    </div>

                                    {showAddToPlaylistAction && (
                                        <div
                                            title={addToPlaylistDisabledReason || t('localMusic.addToPlaylist')}
                                            className={`absolute right-3 bottom-3 transition-transform duration-200 ${
                                            supportsHover
                                                ? 'pointer-events-none group-hover:pointer-events-auto translate-x-3 translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                                : `${isCoverActionsVisible ? 'pointer-events-auto translate-x-0 translate-y-0' : 'pointer-events-none translate-x-3 translate-y-3'}`
                                        }`}
                                        >
                                            <CoverActionButton
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    if (!canAddCurrentSongToPlaylist) return;
                                                    setIsCoverActionsVisible(false);
                                                    openAddToPlaylist();
                                                }}
                                                disabled={!canAddCurrentSongToPlaylist}
                                                title={addToPlaylistDisabledReason || t('localMusic.addToPlaylist')}
                                                ariaLabel={addToPlaylistDisabledReason || t('localMusic.addToPlaylist')}
                                                className={`w-11 h-11 rounded-full border border-white/15 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:text-white disabled:cursor-not-allowed disabled:text-white/40 ${coverActionRevealClass}`}
                                            >
                                                <Star size={18} />
                                            </CoverActionButton>
                                        </div>
                                    )}
                                </div>

                                {/* Tab Switcher */}
                                <div className={`flex ${tabSwitcherBg} p-1 rounded-xl mb-4`}>
                                    {tabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => onTabChange(tab.id)}
                                            aria-pressed={currentTab === tab.id}
                                            className={`flex-1 py-2 flex items-center justify-center transition-all rounded-lg
                                                ${currentTab === tab.id ? `${activeTabBg} shadow-sm` : 'opacity-40 hover:opacity-100'}`}
                                            title={tab.label}
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <tab.icon size={16} />
                                        </button>
                                    ))}
                                </div>

                                {/* Tab Content */}
                                <div
                                    className={`flex-1 pr-1 ${currentTab === 'cover' ? '' : 'min-h-[70px]'}`}
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    {currentTab === 'cover' && (
                                        <CoverTab
                                            currentSong={currentSong}
                                            onAlbumSelect={(song, album) => {
                                                onAlbumSelect(song, album);
                                                onToggle();
                                            }}
                                            onSelectArtist={(song, artist) => {
                                                onSelectArtist(song, artist);
                                                onToggle();
                                            }}
                                            onOpenCurrentLocalAlbum={() => {
                                                onOpenCurrentLocalAlbum();
                                                onToggle();
                                            }}
                                            onOpenCurrentLocalArtist={(entityId) => {
                                                onOpenCurrentLocalArtist(entityId);
                                                onToggle();
                                            }}
                                            onOpenCurrentNavidromeAlbum={() => {
                                                onOpenCurrentNavidromeAlbum();
                                                onToggle();
                                            }}
                                            onOpenCurrentNavidromeArtist={() => {
                                                onOpenCurrentNavidromeArtist();
                                                onToggle();
                                            }}
                                            onCopySongInfoSuccess={onCopySongInfoSuccess}
                                        />
                                    )}
                                    {currentTab === 'controls' && (
                                        <ControlsTab
                                            loopMode={loopMode}
                                            onToggleLoop={onToggleLoop}
                                            onLike={onLike}
                                            isLiked={isLiked}
                                            likeDisabled={likeDisabled}
                                            likeDisabledReason={likeDisabledReason}
                                            onGenerateAITheme={onGenerateAITheme}
                                            isGeneratingTheme={isGeneratingTheme}
                                            canGenerateAITheme={canGenerateAITheme}
                                            theme={theme}
                                            onThemeChange={onThemeChange}
                                            bgMode={bgMode}
                                            onBgModeChange={onBgModeChange}
                                            hasCustomTheme={hasCustomTheme}
                                            themeSourceModel={themeSourceModel}
                                            defaultTheme={defaultTheme}
                                            daylightTheme={daylightTheme}
                                            visualizerMode={visualizerMode}
                                            onVisualizerModeChange={onVisualizerModeChange}
                                            useCoverColorBg={useCoverColorBg}
                                            onToggleCoverColorBg={onToggleCoverColorBg}
                                            isDaylight={isDaylight}
                                            onToggleDaylight={onToggleDaylight}
                                            volume={volume}
                                            isMuted={isMuted}
                                            onVolumePreview={onVolumePreview}
                                            onVolumeChange={onVolumeChange}
                                            onToggleMute={onToggleMute}
                                            loopToggleDisabled={playbackControlsDisabled}
                                            onClosePanel={onToggle}
                                        />
                                    )}
                                    {currentTab === 'queue' && (
                                        isFmMode ? (
                                            <FmTab
                                                playerState={playerState}
                                                modeLabel={fmModeLabel}
                                                onOpenModePicker={onOpenFmModePicker}
                                                onTogglePlay={onTogglePlay}
                                                onNextTrack={onNextTrack}
                                                onPrevTrack={onPrevTrack}
                                                onTrash={onFmTrash}
                                                onLike={onLike}
                                                isLiked={isLiked}
                                                likeDisabled={likeDisabled}
                                                likeDisabledReason={likeDisabledReason}
                                                isDaylight={isDaylight}
                                                primaryColor={theme.primaryColor}
                                            />
                                        ) : isStage ? (
                                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[300px]">
                                                <div className="flex items-center justify-center h-full px-4 text-center text-xs opacity-50">
                                                    {playbackControlsDisabled
                                                        ? t('unifiedPanel.nowPlayingStageDescription')
                                                        : t('unifiedPanel.stageLocalInputDescription')}
                                                </div>
                                            </motion.div>
                                        ) : (
                                            <QueueTab
                                                playQueue={playQueue}
                                                currentSong={currentSong}
                                                onPlaySong={onPlaySong}
                                                queueScrollRef={queueScrollRef}
                                                shouldScrollToCurrent={isOpen && currentTab === 'queue'}
                                                onShuffle={onShuffle}
                                                onRemoveSong={onRemoveSong}
                                                onMoveSongToEnd={onMoveSongToEnd}
                                                onMoveSongToNext={onMoveSongToNext}
                                                onOpenLattice={queue.onOpenLattice}
                                                // TODO: Define cross-source playlist export before enabling playlist creation for mixed queues.
                                                canSaveLocalPlaylist={Boolean(
                                                    isLocal
                                                    && !hasMixedPlaybackSources(playQueue)
                                                    && playQueue.length > 0
                                                    && playQueue.every(song => getPlaybackSongSource(song) === 'local')
                                                )}
                                                onSaveCurrentQueueAsPlaylist={onSaveCurrentQueueAsPlaylist}
                                                isDaylight={isDaylight}
                                            />
                                        )
                                    )}
                                    {currentTab === 'account' && (
                                        <AccountTab
                                            user={user}
                                            onLogout={onLogout}
                                            audioQuality={audioQuality}
                                            onAudioQualityChange={onAudioQualityChange}
                                            cacheSize={cacheSize}
                                            onClearCache={onClearCache}
                                            onSyncData={onSyncData}
                                            isSyncing={isSyncing}
                                            onNavigateHome={() => {
                                                onToggle();
                                                onNavigateHome();
                                            }}
                                        />
                                    )}
                                    {currentTab === 'local' && isLocal && (
                                        <LocalTab
                                            // @ts-ignore
                                            currentSong={currentSong}
                                            onMatchOnline={onMatchOnline}
                                            onUpdateLocalLyrics={onUpdateLocalLyrics}
                                            onChangeLyricsSource={onChangeLyricsSource}
                                            replayGainMode={replayGainMode}
                                            onChangeReplayGainMode={onChangeReplayGainMode}
                                            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
                                            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
                                            isDaylight={isDaylight}
                                        />
                                    )}
                                    {currentTab === 'navi' && isNavidrome && (
                                        <NaviTab
                                            currentSong={currentSong}
                                            hasLyrics={hasLyrics}
                                            onMatchOnline={onMatchOnline}
                                            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
                                            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
                                            replayGainMode={replayGainMode}
                                            onChangeReplayGainMode={onChangeReplayGainMode}
                                            isDaylight={isDaylight}
                                        />
                                    )}
                                    {currentTab === 'onlineLyrics' && isOnline && currentSong && (
                                        <OnlineLyricsTab
                                            song={currentSong}
                                            onlineLyricsState={onlineLyricsState}
                                            onImportLyrics={onImportOnlineLyrics}
                                            onChangeLyricsSource={onChangeOnlineLyricsSource}
                                            onMatchOnlineLyrics={onMatchOnlineLyrics}
                                            onClearOnlineLyricsState={onClearOnlineLyricsState}
                                            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
                                            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
                                            replayGainMode={replayGainMode}
                                            onChangeReplayGainMode={onChangeReplayGainMode}
                                            isDaylight={isDaylight}
                                        />
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Toggle Button */}
            <AnimatePresence onExitComplete={() => setToggleGlassActive(false)}>
                {showToggleChrome && (
                    // 退场动画只留 transform：opacity<1 的祖先会形成 backdrop root，
                    // 退场期间按钮玻璃采样不到身后的内容。淡入淡出在按钮自身上。
                    <motion.div
                        initial={{ x: 20, y: 12, scale: 0.92 }}
                        animate={{ x: 0, y: 0, scale: 1 }}
                        exit={isCommandPaletteOpen
                            ? { x: 0, y: 0, scale: 1 }
                            : { x: 20, y: 12, scale: 0.92 }
                        }
                        transition={{ duration: 0.24, ease: 'easeOut' }}
                        data-testid="panel-toggle"
                        style={{ bottom: bottomBarBottomPx }}
                        className="pointer-events-auto fixed right-0 z-[60] pr-4 md:pr-8 group w-20 flex justify-end"
                        onMouseEnter={handleToggleButtonMouseEnter}
                        onMouseLeave={handleToggleButtonMouseLeave}
                        onPointerDown={handleToggleHotspotPointerDown}
                    >
                        {/* Wrapper for both track and button to guarantee perfect alignment across browsers */}
                        <div className={`relative w-12 h-12 transition-all duration-300 transform ${toggleButtonMotionClass}`}>
                            {/* osu! Slider Track */}
                            <div
                                style={{
                                    width: '96px',
                                    transition: 'opacity 200ms ease-out',
                                }}
                                className={`absolute right-0 top-0 h-12 rounded-full border pointer-events-none z-0 ${
                                    isGuideLineVisible || isDragging
                                        ? 'opacity-100'
                                        : 'opacity-0'
                                } ${
                                    isDaylight
                                        ? 'border-black/10 bg-black/5'
                                        : 'border-white/10 bg-white/5'
                                }`}
                            >
                                {/* Semi-transparent command icon at the left end of the track */}
                                <motion.div 
                                    className="absolute left-3.5 top-[17px] w-3.5 h-3.5 pointer-events-none flex items-center justify-center"
                                    animate={isGuideLineVisible ? {
                                        x: [0, -4, 0],
                                        opacity: [0.45, 0.85, 0.45],
                                    } : {
                                        x: 0,
                                        opacity: 0.45,
                                    }}
                                    transition={isGuideLineVisible ? {
                                        duration: 1.5,
                                        repeat: Infinity,
                                        ease: "easeInOut",
                                    } : undefined}
                                >
                                    <div
                                        ref={trackEndIconRef}
                                        style={{ 
                                            color: isDaylight ? '#000000' : '#ffffff',
                                        }}
                                        className="w-full h-full flex items-center justify-center"
                                    >
                                        <Command size={14} />
                                    </div>
                                </motion.div>

                                {/* Track Fill */}
                                <div
                                    ref={trackFillRef}
                                    style={{
                                        width: '48px',
                                    }}
                                    className={`absolute right-0 top-0 bottom-0 rounded-full pointer-events-none ${
                                        isDaylight ? 'bg-black/10' : 'bg-white/10'
                                    }`}
                                />
                            </div>

                            {/* 淡入淡出挂在按钮自身（玻璃元素）：祖先 opacity<1 会致盲玻璃。
                                framer 接管 opacity 后不能用 transition-all（CSS 过渡会拖拽
                                framer 逐帧写入的 opacity），颜色过渡单独保留。 */}
                            <motion.button
                                ref={toggleButtonRef}
                                type="button"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.24, ease: 'easeOut' }}
                                onPointerDown={handleToggleButtonPointerDown}
                                onPointerMove={handleToggleButtonPointerMove}
                                onPointerUp={clearToggleButtonGesture}
                                onPointerCancel={clearToggleButtonGesture}
                                onClick={handleToggleButtonClick}
                                style={{
                                    touchAction: canSlideOpenCommandPalette ? 'none' : undefined,
                                    backdropFilter: toggleGlassBackdropFilter ?? undefined,
                                    ...toggleTintStyle,
                                }}
                                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors duration-300 shadow-lg backdrop-blur-md transform
                                    border-none absolute right-0 top-0 z-10 ${isDaylight ? 'text-zinc-900' : 'text-white'}`}
                            >
                                {isOpen ? <X size={20} /> : <Settings2 size={20} />}
                            </motion.button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default UnifiedPanel;
