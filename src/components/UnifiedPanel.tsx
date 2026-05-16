import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings2, X, Disc, SlidersHorizontal, ListMusic, User as UserIcon, Home as HomeIcon, FileAudio, Radio, Cloud, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme, PlayerState, ReplayGainMode, LocalPlaylist, NeteasePlaylist, ThemeMode, VisualizerMode } from '../types';
import CoverTab from './panelTab/CoverTab';
import ControlsTab from './panelTab/ControlsTab';
import QueueTab from './panelTab/QueueTab';
import AccountTab from './panelTab/AccountTab';
import LocalTab from './panelTab/LocalTab';
import FmTab from './panelTab/FmTab';
import NaviTab from './panelTab/NaviTab';
import PlaylistSelectionDialog from './shared/PlaylistSelectionDialog';
import TextInputDialog from './shared/TextInputDialog';

export type PanelTab = 'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi';

interface UnifiedPanelProps {
    isOpen: boolean;
    currentTab: PanelTab;
    onTabChange: (tab: PanelTab) => void;
    onToggle: () => void;
    onNavigateHome: () => void;
    onNavigateHomeDirect: () => void;
    coverUrl: string | null;
    // Cover Tab Props
    currentSong: SongResult | null;
    onAlbumSelect: (albumId: number) => void;
    onSelectArtist: (artistId: number) => void;
    // Controls Tab Props
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
    // Queue Tab Props
    playQueue: SongResult[];
    onPlaySong: (song: SongResult, queue: SongResult[]) => void;
    queueScrollRef: React.RefObject<HTMLDivElement>;
    onShuffle: () => void;
    // Account Tab Props
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
    // Local Tab Props
    onMatchOnline: () => void;
    onUpdateLocalLyrics: (content: string, isTranslation: boolean) => void;
    onChangeLyricsSource: (source: 'local' | 'embedded' | 'online') => void;
    replayGainMode: ReplayGainMode;
    onChangeReplayGainMode: (mode: ReplayGainMode) => void;
    // FM Mode Props
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
    showOpenPanelCloseButton: boolean;
    hideToggleButton?: boolean;
    isStageContext?: boolean;
    playbackControlsDisabled?: boolean;
}

const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
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
    playQueue,
    onPlaySong,
    queueScrollRef,
    onShuffle,
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
    onMatchOnline,
    onUpdateLocalLyrics,
    onChangeLyricsSource,
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
    showOpenPanelCloseButton,
    hideToggleButton = false,
    isStageContext = false,
    playbackControlsDisabled = false,
}) => {
    const { t } = useTranslation();
    const coverAreaRef = React.useRef<HTMLDivElement>(null);
    const hideActionLayerTimeoutRef = React.useRef<number | null>(null);
    const [isCoverActionsVisible, setIsCoverActionsVisible] = React.useState(false);
    const [isPlaylistPickerOpen, setIsPlaylistPickerOpen] = React.useState(false);
    const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = React.useState(false);
    const [navidromePlaylists, setNavidromePlaylists] = React.useState<Array<{ id: string; name: string; description?: string; }>>([]);

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
    }

    // Theme Helper
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated
    const isAI = bgMode === 'ai'; // AI themes usually dark
    const glassBg = isDaylight ? 'bg-white/60' : 'bg-black/40';
    const placeholderBg = isDaylight ? 'bg-stone-200' : 'bg-zinc-900';
    const activeTabBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const tabSwitcherBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const toggleButtonMotionClass = isOpen
        ? 'translate-x-0 opacity-100'
        : supportsHover
            ? 'translate-x-1/2 opacity-60 group-hover:translate-x-0 group-hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105'
            : 'translate-x-1/2 opacity-60';
    const handleNavigateHome = () => {
        setIsCoverActionsVisible(false);
        onToggle();
        onNavigateHomeDirect();
    };

    const clearHideActionLayerTimeout = () => {
        if (hideActionLayerTimeoutRef.current !== null) {
            window.clearTimeout(hideActionLayerTimeoutRef.current);
            hideActionLayerTimeoutRef.current = null;
        }
    };

    const showCoverActions = () => {
        clearHideActionLayerTimeout();
        setIsCoverActionsVisible(true);
    };

    const hideCoverActions = (delay = 0) => {
        clearHideActionLayerTimeout();
        if (delay > 0) {
            hideActionLayerTimeoutRef.current = window.setTimeout(() => {
                setIsCoverActionsVisible(false);
                hideActionLayerTimeoutRef.current = null;
            }, delay);
            return;
        }
        setIsCoverActionsVisible(false);
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
        if (!isCoverActionsVisible) {
            return undefined;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }

            if (!coverAreaRef.current?.contains(target)) {
                hideCoverActions();
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        return () => document.removeEventListener('pointerdown', handlePointerDown);
    }, [isCoverActionsVisible]);

    React.useEffect(() => () => {
        clearHideActionLayerTimeout();
    }, []);

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
                                    onMouseEnter={() => {
                                        if (supportsHover) {
                                            showCoverActions();
                                        }
                                    }}
                                    onMouseLeave={() => {
                                        if (supportsHover) {
                                            hideCoverActions(120);
                                        }
                                    }}
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
                                    <AnimatePresence>
                                        {isCoverActionsVisible && (
                                            <>
                                                <motion.div
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                    exit={{ opacity: 0 }}
                                                    className="absolute inset-0 pointer-events-none"
                                                >
                                                    <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
                                                </motion.div>

                                                <motion.div
                                                    initial={{ opacity: 0, x: -12, y: 12 }}
                                                    animate={{ opacity: 1, x: 0, y: 0 }}
                                                    exit={{ opacity: 0, x: -10, y: 10 }}
                                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                                    className="absolute left-3 bottom-3 pointer-events-auto"
                                                    onMouseEnter={() => clearHideActionLayerTimeout()}
                                                    onMouseLeave={() => {
                                                        if (supportsHover) {
                                                            hideCoverActions(120);
                                                        }
                                                    }}
                                                >
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
                                                </motion.div>

                                                {canAddCurrentSongToPlaylist && (
                                                    <motion.div
                                                        initial={{ opacity: 0, x: 12, y: 12 }}
                                                        animate={{ opacity: 1, x: 0, y: 0 }}
                                                        exit={{ opacity: 0, x: 10, y: 10 }}
                                                        transition={{ duration: 0.18, ease: 'easeOut' }}
                                                        className="absolute right-3 bottom-3 pointer-events-auto"
                                                        onMouseEnter={() => clearHideActionLayerTimeout()}
                                                        onMouseLeave={() => {
                                                            if (supportsHover) {
                                                                hideCoverActions(120);
                                                            }
                                                        }}
                                                    >
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
                                                    </motion.div>
                                                )}
                                            </>
                                        )}
                                    </AnimatePresence>
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
                                    className={`flex-1 pr-1 ${currentTab === 'cover' ? '' : 'min-h-[120px]'}`}
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
                                            isDaylight={isDaylight}
                                        />
                                    )}
                                    {currentTab === 'navi' && isNavidrome && (
                                        <NaviTab
                                            currentSong={currentSong as any}
                                            hasLyrics={hasLyrics}
                                            onMatchOnline={onMatchOnline}
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
                {!hideToggleButton && (!isOpen || showOpenPanelCloseButton) && (
                    <motion.div
                        initial={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
                        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                        exit={{ opacity: 0, x: 20, y: 12, scale: 0.92 }}
                        transition={{ duration: 0.24, ease: 'easeOut' }}
                        className="pointer-events-auto fixed bottom-8 right-0 z-[60] pr-4 md:pr-8 group w-20 flex justify-end"
                    >
                        <button
                            onClick={onToggle}
                            className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg backdrop-blur-md transform
                                border-none ${toggleButtonMotionClass} ${isOpen ? 'bg-white text-black' : 'bg-black/40 text-white'}`}
                        >
                            {isOpen ? <X size={20} /> : <Settings2 size={20} />}
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default UnifiedPanel;
