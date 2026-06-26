import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Settings2, X, Disc, SlidersHorizontal, ListMusic, User as UserIcon, Home as HomeIcon, FileAudio, FileText, Radio, Cloud, Star, Command, ChevronLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme, PlayerState, ReplayGainMode, LocalPlaylist, NeteasePlaylist, ThemeMode, VisualizerMode } from '../types';
import CoverTab from './panelTab/CoverTab';
import ControlsTab from './panelTab/ControlsTab';
import QueueTab from './panelTab/QueueTab';
import AccountTab from './panelTab/AccountTab';
import LocalTab from './panelTab/LocalTab';
import FmTab from './panelTab/FmTab';
import NaviTab from './panelTab/NaviTab';
import OnlineLyricsTab from './panelTab/OnlineLyricsTab';
import PlaylistSelectionDialog from './shared/PlaylistSelectionDialog';
import TextInputDialog from './shared/TextInputDialog';
import type { OnlineLyricsState } from '../types';

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
    onAlbumSelect: (albumId: number) => void;
    onSelectArtist: (artistId: number) => void;
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
    onResetTheme: () => void;
    defaultTheme: Theme;
    daylightTheme: Theme;
    visualizerMode: VisualizerMode;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean) => void;
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
    hideToggleButton?: boolean;
    isStageContext?: boolean;
    playbackControlsDisabled?: boolean;
    onOpenSettings?: () => void;
    onOpenCommandPalette?: () => void;
    isCommandPaletteOpen?: boolean;
};

type UnifiedPanelQueueProps = {
    playQueue: SongResult[];
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement>;
    onShuffle: () => void;
};

type UnifiedPanelAccountProps = {
    user: any; // NeteaseUser | null
    onLogout: () => void;
    audioQuality: 'exhigh' | 'lossless' | 'hires';
    onAudioQualityChange: (quality: 'exhigh' | 'lossless' | 'hires') => void;
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
    localPlaylists: LocalPlaylist[];
    neteasePlaylists: NeteasePlaylist[];
    onSaveCurrentQueueAsPlaylist: (name: string) => Promise<void>;
    onAddCurrentSongToLocalPlaylist: (playlistId: string) => Promise<void>;
    onCreateCurrentLocalPlaylist: (name: string) => Promise<void>;
    onAddCurrentSongToNeteasePlaylist: (playlistId: number) => Promise<void>;
    onAddCurrentSongToNavidromePlaylist: (playlistId: string) => Promise<void>;
    onCreateCurrentNavidromePlaylist: (name: string) => Promise<void>;
    onOpenCurrentLocalAlbum: () => void;
    onOpenCurrentLocalArtist: () => void;
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

const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
    playback,
    queue,
    library,
    account,
}) => {
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
        onResetTheme,
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
        hideToggleButton = false,
        isStageContext = false,
        playbackControlsDisabled = false,
        onOpenSettings,
        onOpenCommandPalette,
        isCommandPaletteOpen = false,
    } = playback;
    const { playQueue, onPlaySong, queueScrollRef, onShuffle } = queue;
    const {
        localPlaylists,
        neteasePlaylists,
        onSaveCurrentQueueAsPlaylist,
        onAddCurrentSongToLocalPlaylist,
        onCreateCurrentLocalPlaylist,
        onAddCurrentSongToNeteasePlaylist,
        onAddCurrentSongToNavidromePlaylist,
        onCreateCurrentNavidromePlaylist,
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
    const [isPlaylistPickerOpen, setIsPlaylistPickerOpen] = React.useState(false);
    const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = React.useState(false);
    const [navidromePlaylists, setNavidromePlaylists] = React.useState<Array<{ id: string; name: string; description?: string; }>>([]);
    const [showGuideLine, setShowGuideLine] = React.useState(false);
    const [isDragging, setIsDragging] = React.useState(false);

    const isStage = isStageContext || Boolean(currentSong && (currentSong as any).isStage === true);
    const isNavidrome = currentSong && (currentSong as any).isNavidrome === true;
    const isLocal = currentSong && !isNavidrome && (((currentSong as any).isLocal === true) || Boolean((currentSong as any).localData));
    const isNetease = Boolean(currentSong && !isLocal && !isNavidrome && !isStage);
    const canCreateLocalPlaylist = isLocal;
    const canCreateNavidromePlaylist = isNavidrome;
    const canAddCurrentSongToPlaylist =
        (isLocal && (localPlaylists.length > 0 || canCreateLocalPlaylist))
        || (isNetease && neteasePlaylists.length > 0)
        || (isNavidrome && (navidromePlaylists.length > 0 || canCreateNavidromePlaylist));
    const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const refreshNavidromePlaylists = React.useCallback(async () => {
        const { getNavidromeConfig, navidromeApi } = await import('../services/navidromeService');
        const config = getNavidromeConfig();
        if (!config) {
            setNavidromePlaylists([]);
            return;
        }

        const playlists = await navidromeApi.getPlaylists(config);
        setNavidromePlaylists(playlists.map((playlist) => ({
            id: playlist.id,
            name: playlist.name,
            description: `${playlist.songCount} ${t('playlist.tracks')}`,
        })));
    }, [t]);

    const availablePlaylists = React.useMemo(() => {
        if (isLocal) {
            return localPlaylists.map((playlist) => ({
                id: playlist.id,
                name: playlist.name,
                description: `${playlist.songIds.length} ${t('playlist.tracks')}`,
            }));
        }

        if (isNetease) {
            return neteasePlaylists.map((playlist) => ({
                id: playlist.id,
                name: playlist.name,
                description: `${playlist.trackCount || 0} ${t('playlist.tracks')}`,
            }));
        }

        if (isNavidrome) {
            return navidromePlaylists;
        }

        return [];
    }, [isLocal, isNetease, isNavidrome, localPlaylists, navidromePlaylists, neteasePlaylists, t]);

    React.useEffect(() => {
        let cancelled = false;

        const loadNavidromePlaylists = async () => {
            if (!isNavidrome) {
                setNavidromePlaylists([]);
                return;
            }

            if (!cancelled) {
                await refreshNavidromePlaylists();
            }
        };

        void loadNavidromePlaylists();

        return () => {
            cancelled = true;
        };
    }, [currentSong?.id, isNavidrome, refreshNavidromePlaylists]);

    const tabs = [
        { id: 'cover' as PanelTab, label: t('panel.cover'), icon: Disc },
        { id: 'controls' as PanelTab, label: t('panel.controls'), icon: SlidersHorizontal },
        isFmMode 
            ? { id: 'queue' as PanelTab, label: t('home.radio') || '私人FM', icon: Radio }
            : { id: 'queue' as PanelTab, label: t('panel.playlist'), icon: ListMusic },
        { id: 'account' as PanelTab, label: t('panel.account'), icon: UserIcon },
    ];

    if (isLocal) {
        tabs.splice(1, 0, { id: 'local' as PanelTab, label: t('localMusic.folder'), icon: FileAudio });
    } else if (isNavidrome) {
        tabs.splice(1, 0, { id: 'navi' as PanelTab, label: 'Navidrome', icon: Cloud });
    } else if (isNetease) {
        tabs.splice(1, 0, { id: 'onlineLyrics' as PanelTab, label: t('localMusic.lyrics'), icon: FileText });
    }

    // Theme Helper
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated
    const isAI = bgMode === 'ai'; // AI themes usually dark
    const commandSlideRef = React.useRef<{ startX: number; startY: number; triggered: boolean; } | null>(null);
    const suppressToggleClickRef = React.useRef(false);
    const toggleButtonRef = React.useRef<HTMLButtonElement | null>(null);
    const trackEndIconRef = React.useRef<HTMLDivElement | null>(null);
    const trackFillRef = React.useRef<HTMLDivElement | null>(null);
    const glassBg = isDaylight ? 'bg-white/60' : 'bg-black/40';
    const placeholderBg = isDaylight ? 'bg-stone-200' : 'bg-zinc-900';
    const activeTabBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const tabSwitcherBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const toggleButtonMotionClass = (isOpen || showGuideLine || isDragging)
        ? 'translate-x-0 opacity-100'
        : supportsHover
            ? 'translate-x-1/2 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105'
            : 'translate-x-1/2 opacity-60';
    const canSlideOpenCommandPalette = !isOpen && Boolean(onOpenCommandPalette);
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
            button.style.backgroundColor = '';
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
            button.style.backgroundColor = '';
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
        button.style.backgroundColor = '';
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
            setIsPlaylistPickerOpen(false);
            setIsCreatePlaylistOpen(false);
        }
    }, [isOpen]);

    React.useEffect(() => {
        setIsCoverActionsVisible(false);
    }, [currentTab, currentSong?.id]);

    React.useEffect(() => {
        if (!canAddCurrentSongToPlaylist) {
            setIsPlaylistPickerOpen(false);
        }
    }, [canAddCurrentSongToPlaylist]);

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

    return (
        <div
            className="absolute bottom-8 right-0 z-[60] flex flex-col items-end gap-4 pointer-events-none"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="pr-4 md:pr-8">
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, originY: 1, originX: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className={`pointer-events-auto w-80 max-h-[calc(100dvh-6rem)] ${glassBg} backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col mb-16 md:mb-2 overflow-y-auto hide-scrollbar`}
                            style={{ color: theme.primaryColor }}
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
                                        <img src={coverUrl} alt="Art" className="w-full h-full object-cover" />
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
                                        <div className={`absolute left-3 top-3 transition-all duration-200 ${
                                            supportsHover
                                                ? 'pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 -translate-x-3 -translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                                : `${isCoverActionsVisible ? 'pointer-events-auto opacity-100 translate-x-0 translate-y-0' : 'pointer-events-none opacity-0 -translate-x-3 -translate-y-3'}`
                                        }`}>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleOpenSettings();
                                                }}
                                                className="w-11 h-11 rounded-full border border-white/15 bg-black/25 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:bg-black/40 hover:text-white"
                                                title={t('ui.options') || '设置'}
                                            >
                                                <Settings size={18} />
                                            </button>
                                        </div>
                                    )}

                                    <div className={`absolute left-3 bottom-3 transition-all duration-200 ${
                                        supportsHover
                                            ? 'pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 -translate-x-3 translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                            : `${isCoverActionsVisible ? 'pointer-events-auto opacity-100 translate-x-0 translate-y-0' : 'pointer-events-none opacity-0 -translate-x-3 translate-y-3'}`
                                    }`}>
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                handleNavigateHome();
                                            }}
                                            className="w-11 h-11 rounded-full border border-white/15 bg-black/25 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:bg-black/40 hover:text-white"
                                            title={t('ui.backToHome') || '返回主页'}
                                        >
                                            <HomeIcon size={18} />
                                        </button>
                                    </div>

                                    {canAddCurrentSongToPlaylist && (
                                        <div className={`absolute right-3 bottom-3 transition-all duration-200 ${
                                            supportsHover
                                                ? 'pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 translate-x-3 translate-y-3 group-hover:translate-x-0 group-hover:translate-y-0'
                                                : `${isCoverActionsVisible ? 'pointer-events-auto opacity-100 translate-x-0 translate-y-0' : 'pointer-events-none opacity-0 translate-x-3 translate-y-3'}`
                                        }`}>
                                            <button
                                                type="button"
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    setIsCoverActionsVisible(false);
                                                    setIsPlaylistPickerOpen(true);
                                                }}
                                                className="w-11 h-11 rounded-full border border-white/15 bg-black/25 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:bg-black/40 hover:text-white"
                                                title={t('localMusic.addToPlaylist') || '添加到歌单'}
                                            >
                                                <Star size={18} />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Tab Switcher */}
                                <div className={`flex ${tabSwitcherBg} p-1 rounded-xl mb-4`}>
                                    {tabs.map((tab) => (
                                        <button
                                            key={tab.id}
                                            onClick={() => onTabChange(tab.id)}
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
                                            onAlbumSelect={(albumId) => {
                                                onAlbumSelect(albumId);
                                                onToggle();
                                            }}
                                            onSelectArtist={(artistId) => {
                                                onSelectArtist(artistId);
                                                onToggle();
                                            }}
                                            onOpenCurrentLocalAlbum={() => {
                                                onOpenCurrentLocalAlbum();
                                                onToggle();
                                            }}
                                            onOpenCurrentLocalArtist={() => {
                                                onOpenCurrentLocalArtist();
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
                                            onGenerateAITheme={onGenerateAITheme}
                                            isGeneratingTheme={isGeneratingTheme}
                                            canGenerateAITheme={canGenerateAITheme}
                                            theme={theme}
                                            onThemeChange={onThemeChange}
                                            bgMode={bgMode}
                                            onBgModeChange={onBgModeChange}
                                            hasCustomTheme={hasCustomTheme}
                                            onResetTheme={onResetTheme}
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
                                        />
                                    )}
                                    {currentTab === 'queue' && (
                                        isFmMode ? (
                                            <FmTab
                                                playerState={playerState}
                                                onTogglePlay={onTogglePlay}
                                                onNextTrack={onNextTrack}
                                                onPrevTrack={onPrevTrack}
                                                onTrash={onFmTrash}
                                                onLike={onLike}
                                                isLiked={isLiked}
                                                isDaylight={isDaylight}
                                                primaryColor={theme.primaryColor}
                                            />
                                        ) : isStage ? (
                                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col h-full max-h-[300px]">
                                                <div className="flex items-center justify-center h-full px-4 text-center text-xs opacity-50">
                                                    {playbackControlsDisabled
                                                        ? 'Now Playing 正由外部播放器控制，Folia 只负责展示歌词和视觉效果。'
                                                        : 'Stage 现在是本地单项输入模式。外部可以推送一份完整歌词对象或一段媒体，播放与展示仍由 Folia 自己控制。'}
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
                                                canSaveLocalPlaylist={Boolean(isLocal && playQueue.some(song => ((song as any).isLocal === true) || (song as any).localData))}
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
                                            currentSong={currentSong as any}
                                            hasLyrics={hasLyrics}
                                            onMatchOnline={onMatchOnline}
                                            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
                                            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
                                            isDaylight={isDaylight}
                                        />
                                    )}
                                    {currentTab === 'onlineLyrics' && isNetease && currentSong && (
                                        <OnlineLyricsTab
                                            onlineLyricsState={onlineLyricsState}
                                            onImportLyrics={onImportOnlineLyrics}
                                            onChangeLyricsSource={onChangeOnlineLyricsSource}
                                            onMatchOnlineLyrics={onMatchOnlineLyrics}
                                            onClearOnlineLyricsState={onClearOnlineLyricsState}
                                            lyricTimelineOffsetMs={lyricTimelineOffsetMs}
                                            onLyricTimelineOffsetChange={onLyricTimelineOffsetChange}
                                            isDaylight={isDaylight}
                                        />
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            <div className="pointer-events-auto">
                <PlaylistSelectionDialog
                    isOpen={isPlaylistPickerOpen}
                    onClose={() => setIsPlaylistPickerOpen(false)}
                    isDaylight={isDaylight}
                    title={t('localMusic.addToPlaylist') || '添加到歌单'}
                    description={t('home.playlists') || 'Playlists'}
                    playlists={availablePlaylists}
                    onSelect={async (playlistId) => {
                        if (isLocal) {
                            await onAddCurrentSongToLocalPlaylist(String(playlistId));
                            return;
                        }

                        if (isNetease) {
                            await onAddCurrentSongToNeteasePlaylist(Number(playlistId));
                            return;
                        }

                        if (isNavidrome) {
                            await onAddCurrentSongToNavidromePlaylist(String(playlistId));
                            await refreshNavidromePlaylists();
                        }
                    }}
                    onCreate={(isLocal || isNavidrome) ? () => {
                        setIsPlaylistPickerOpen(false);
                        setIsCreatePlaylistOpen(true);
                    } : undefined}
                    createLabel={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist') || '新建歌单'}
                />

                <TextInputDialog
                    isOpen={isCreatePlaylistOpen}
                    onClose={() => setIsCreatePlaylistOpen(false)}
                    isDaylight={isDaylight}
                    title={t(isNavidrome ? 'navidrome.createPlaylist' : 'localMusic.createPlaylist') || '新建歌单'}
                    description={t('localMusic.enterPlaylistName') || '输入歌单名称'}
                    placeholder={t('localMusic.enterPlaylistName') || '输入歌单名称'}
                    confirmLabel={t('options.save') || '保存'}
                    onConfirm={async (name) => {
                        if (isLocal) {
                            await onCreateCurrentLocalPlaylist(name);
                            return;
                        }

                        if (isNavidrome) {
                            await onCreateCurrentNavidromePlaylist(name);
                            await refreshNavidromePlaylists();
                        }
                    }}
                />
            </div>

            {/* Toggle Button */}
            <AnimatePresence>
                {!hideToggleButton && (!isOpen || showOpenPanelCloseButton) && !isCommandPaletteOpen && (
                    <motion.div
                        initial={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
                        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                        exit={isCommandPaletteOpen
                            ? { opacity: 0, x: 0, y: 0, scale: 1 }
                            : { opacity: 0, x: 20, y: 12, scale: 0.92 }
                        }
                        transition={{ duration: 0.24, ease: 'easeOut' }}
                        className="pointer-events-auto fixed bottom-8 right-0 z-[60] pr-4 md:pr-8 group w-20 flex justify-end"
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
                                    showGuideLine || isDragging
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
                                    animate={showGuideLine ? {
                                        x: [0, -4, 0],
                                        opacity: [0.45, 0.85, 0.45],
                                    } : {
                                        x: 0,
                                        opacity: 0.45,
                                    }}
                                    transition={showGuideLine ? {
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

                            <button
                                ref={toggleButtonRef}
                                type="button"
                                onPointerDown={handleToggleButtonPointerDown}
                                onPointerMove={handleToggleButtonPointerMove}
                                onPointerUp={clearToggleButtonGesture}
                                onPointerCancel={clearToggleButtonGesture}
                                onMouseEnter={handleToggleButtonMouseEnter}
                                onMouseLeave={handleToggleButtonMouseLeave}
                                onClick={handleToggleButtonClick}
                                style={{ touchAction: canSlideOpenCommandPalette ? 'none' : undefined }}
                                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg backdrop-blur-md transform
                                    border-none absolute right-0 top-0 z-10 ${isOpen ? 'bg-white text-black' : (isDaylight ? 'bg-white/70 text-zinc-900' : 'bg-black/40 text-white')}`}
                            >
                                {isOpen ? <X size={20} /> : <Settings2 size={20} />}
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default UnifiedPanel;
