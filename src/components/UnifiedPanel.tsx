import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings2, X, Disc, SlidersHorizontal, ListMusic, User as UserIcon, Home as HomeIcon, FileAudio, Radio, Cloud, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme, PlayerState, ReplayGainMode, LocalPlaylist, NeteasePlaylist } from '../types';
import CoverTab from './panelTab/CoverTab';
import ControlsTab from './panelTab/ControlsTab';
import QueueTab from './panelTab/QueueTab';
import AccountTab from './panelTab/AccountTab';
import LocalTab from './panelTab/LocalTab';
import FmTab from './panelTab/FmTab';
import NaviTab from './panelTab/NaviTab';

export type PanelTab = 'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi';

interface UnifiedPanelProps {
    isOpen: boolean;
    currentTab: PanelTab;
    onTabChange: (tab: PanelTab) => void;
    onToggle: () => void;
    onNavigateHome: () => void;
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
    bgMode: 'default' | 'ai';
    onBgModeChange: (mode: 'default' | 'ai') => void;
    onResetTheme: () => void;
    defaultTheme: Theme;
    daylightTheme: Theme;
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
    onAddCurrentSongToNeteasePlaylist: (playlistId: number) => Promise<void>;
    onOpenCurrentLocalAlbum: () => void;
    onOpenCurrentLocalArtist: () => void;
    onOpenCurrentNavidromeAlbum: () => void;
    onOpenCurrentNavidromeArtist: () => void;
}

const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
    isOpen,
    currentTab,
    onTabChange,
    onToggle,
    onNavigateHome,
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
    onResetTheme,
    defaultTheme,
    daylightTheme,
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
    onAddCurrentSongToNeteasePlaylist,
    onOpenCurrentLocalAlbum,
    onOpenCurrentLocalArtist,
    onOpenCurrentNavidromeAlbum,
    onOpenCurrentNavidromeArtist,
}) => {
    const { t } = useTranslation();
    const coverAreaRef = React.useRef<HTMLDivElement>(null);
    const hideActionLayerTimeoutRef = React.useRef<number | null>(null);
    const [isCoverActionsVisible, setIsCoverActionsVisible] = React.useState(false);
    const [openPlaylistPickerSignal, setOpenPlaylistPickerSignal] = React.useState(0);

    const isNavidrome = currentSong && (currentSong as any).isNavidrome === true;
    const isLocal = currentSong && !isNavidrome && (((currentSong as any).isLocal === true) || Boolean((currentSong as any).localData));
    const isNetease = Boolean(currentSong && !isLocal && !isNavidrome);
    const canAddCurrentSongToPlaylist = (isLocal && localPlaylists.length > 0) || (isNetease && neteasePlaylists.length > 0);
    const supportsHover = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

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
    const handleNavigateHome = () => {
        setIsCoverActionsVisible(false);
        onToggle();
        onNavigateHome();
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
        }
    }, [isOpen]);

    React.useEffect(() => {
        setIsCoverActionsVisible(false);
    }, [currentTab, currentSong?.id]);

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
            <div className="pointer-events-auto pr-4 md:pr-8 pb-16 md:pb-0">
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, originY: 1, originX: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            className={`w-80 ${glassBg} backdrop-blur-3xl rounded-3xl shadow-2xl flex flex-col mb-2 overflow-hidden`}
                            style={{ color: theme.primaryColor }}
                        >
                            <div className="p-5 flex flex-col h-full">
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
                                            <motion.div
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                className="absolute inset-0 pointer-events-none"
                                            >
                                                <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
                                                <motion.div
                                                    initial={{ opacity: 0, y: 18 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: 12 }}
                                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                                    className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 pointer-events-auto"
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

                                                    {canAddCurrentSongToPlaylist && (
                                                        <button
                                                            type="button"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                setIsCoverActionsVisible(false);
                                                                setOpenPlaylistPickerSignal(prev => prev + 1);
                                                            }}
                                                            className="w-11 h-11 rounded-full border border-white/15 bg-black/25 text-white/90 backdrop-blur-md flex items-center justify-center transition-all hover:bg-black/40 hover:text-white"
                                                            title={t('localMusic.addToPlaylist') || '添加到歌单'}
                                                        >
                                                            <Star size={18} />
                                                        </button>
                                                    )}
                                                </motion.div>
                                            </motion.div>
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
                                    className={`flex-1 overflow-hidden ${currentTab === 'cover' ? '' : 'min-h-[120px]'}`}
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
                                            localPlaylists={localPlaylists}
                                            neteasePlaylists={neteasePlaylists}
                                            onAddCurrentSongToLocalPlaylist={onAddCurrentSongToLocalPlaylist}
                                            onAddCurrentSongToNeteasePlaylist={onAddCurrentSongToNeteasePlaylist}
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
                                            isDaylight={isDaylight}
                                            openPlaylistPickerSignal={openPlaylistPickerSignal}
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
                                            onResetTheme={onResetTheme}
                                            defaultTheme={defaultTheme}
                                            daylightTheme={daylightTheme}
                                            useCoverColorBg={useCoverColorBg}
                                            onToggleCoverColorBg={onToggleCoverColorBg}
                                            isDaylight={isDaylight}
                                            onToggleDaylight={onToggleDaylight}
                                            volume={volume}
                                            isMuted={isMuted}
                                            onVolumePreview={onVolumePreview}
                                            onVolumeChange={onVolumeChange}
                                            onToggleMute={onToggleMute}
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

            {/* Toggle Button */}
            <div className="pointer-events-auto fixed bottom-8 right-0 z-[60] pr-4 md:pr-8 group">
                <button
                    onClick={onToggle}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg backdrop-blur-md transform
                        translate-x-1/2 opacity-60 hover:translate-x-0 hover:opacity-100 md:translate-x-0 md:opacity-100 md:hover:scale-105 border-none
                        ${isOpen ? 'bg-white text-black translate-x-0 opacity-100' : 'bg-black/40 text-white'}`}
                >
                    {isOpen ? <X size={20} /> : <Settings2 size={20} />}
                </button>
            </div>
        </div>
    );
};

export default UnifiedPanel;
