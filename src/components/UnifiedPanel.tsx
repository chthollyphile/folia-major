import React from 'react';
import { AudioLines, Disc, SlidersHorizontal, ListMusic, FileAudio, FileText, Radio, Cloud, Puzzle } from 'lucide-react';
import { locatePlayingSong } from './app/playing-song-locator/playingSongLocator';
import { useTranslation } from 'react-i18next';
import { Album, Artist, SongResult, Theme, PlayerState, ReplayGainMode, ThemeMode, VisualizerMode } from '../types';
import type { LibraryAccountController } from '../library/core/account/account.contract';
import ControlsTab from './panelTab/ControlsTab';
import QueueTab from './panelTab/QueueTab';
import AccountTab from './panelTab/AccountTab';
import LocalTab from './panelTab/LocalTab';
import FmTab from './panelTab/FmTab';
import NaviTab from './panelTab/NaviTab';
import OnlineLyricsTab from './panelTab/OnlineLyricsTab';
import { EmptyState } from './panelTab/shell/EmptyState';
import PanelHandle from './panelTab/shell/PanelHandle';
import PanelShell from './panelTab/shell/PanelShell';
import SongActions from './panelTab/shell/SongActions';
import SongCredits from './panelTab/shell/SongCredits';
import SongHeader from './panelTab/shell/SongHeader';
import TabDock from './panelTab/shell/TabDock';
import type { SongLike } from './panelTab/shell/LikeButton';
import type { OnlineLyricsState } from '../types';
import type { AudioQualityPreference } from '../types/onlineMusic';
import type { ThemeSourceModel } from '../hooks/themeControllerState';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { canSaveQueueAsLocalPlaylist } from '../utils/queueReorder';
import { canDislikeCurrentSong, resolveLikeAvailability } from '../utils/playerLikeAvailability';
import { usePlayerPanelTabShortcut } from '../hooks/usePlayerPanelTabShortcut';
import { FOLIUM_PANEL_TAB_PREFIX, FoliumPanelTabBody, useFoliumPanelTabs } from '../mods/folium/registries/playerPanelTabs';
import { countRender } from '../dev/renderCount';
import { useAppViewStore } from '../stores/useAppViewStore';

// src/components/UnifiedPanel.tsx
// The playing page's panel: which tabs there are for the playing song, and what each one is given.
// How it looks is in panelTab/shell (the frame, the song at the top, the tab row, the handle) and
// in the tabs themselves.

export type PanelTab = 'cover' | 'controls' | 'queue' | 'account' | 'local' | 'navi' | 'onlineLyrics'
    // Tabs registered by Folium mods (registries.playerPanelTabs).
    | `folium:${string}`;

type UnifiedPanelPlaybackProps = {
    isOpen: boolean;
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
    accountController: LibraryAccountController;
    audioQuality: AudioQualityPreference;
    onAudioQualityChange: (quality: AudioQualityPreference) => void;
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

const UnifiedPanel: React.FC<UnifiedPanelProps> = ({
    playback,
    queue,
    library,
    account,
}) => {
    countRender('UnifiedPanel');
    const { t } = useTranslation();
    // Read here and not handed down from App.tsx: a change of tab renders the panel, not the app.
    const currentTab = useAppViewStore(state => state.panelTab);
    const {
        isOpen,
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
        accountController,
        audioQuality,
        onAudioQualityChange,
        onSyncData,
        isSyncing,
        useCoverColorBg,
        onToggleCoverColorBg,
        isDaylight,
        onToggleDaylight,
    } = account;

    const isStage = isStageContext || Boolean(currentSong && (currentSong as any).isStage === true);
    const isNavidrome = currentSong && (currentSong as any).isNavidrome === true;
    const isLocal = currentSong && !isNavidrome && (((currentSong as any).isLocal === true) || Boolean((currentSong as any).localRef?.songId));
    const playbackSourceRef = currentSong ? getPlaybackSourceRef(currentSong) : null;
    const isOnline = playbackSourceRef?.kind === 'online';
    const likeAvailability = resolveLikeAvailability(currentSong, playbackControlsDisabled, isStage);
    const likeDisabledReason = likeAvailability.reason
        ? t(likeAvailability.reason.key, likeAvailability.reason.params)
        : undefined;
    const likeDisabled = likeAvailability.disabled;

    const foliumTabs = useFoliumPanelTabs();
    const tabs: { id: PanelTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
        { id: 'cover' as PanelTab, label: t('panel.cover'), icon: Disc },
        { id: 'controls' as PanelTab, label: t('panel.controls'), icon: SlidersHorizontal },
        isFmMode 
            ? { id: 'queue' as PanelTab, label: t('home.radio'), icon: Radio }
            : { id: 'queue' as PanelTab, label: t('panel.playlist'), icon: ListMusic },
        { id: 'account' as PanelTab, label: t('panel.account'), icon: AudioLines },
    ];

    if (isLocal) {
        tabs.splice(1, 0, { id: 'local' as PanelTab, label: t('localMusic.folder'), icon: FileAudio });
    } else if (isNavidrome) {
        tabs.splice(1, 0, { id: 'navi' as PanelTab, label: 'Navidrome', icon: Cloud });
    } else if (isOnline) {
        tabs.splice(1, 0, { id: 'onlineLyrics' as PanelTab, label: t('localMusic.lyrics'), icon: FileText });
    }

    foliumTabs.forEach((tab) => tabs.push({ id: tab.id, label: tab.label, icon: Puzzle }));

    // A mod tab can vanish while open (mod disabled or reloaded): fall back to the cover tab.
    const currentTabExists = tabs.some((tab) => tab.id === currentTab);
    React.useEffect(() => {
        if (!currentTabExists && currentTab.startsWith(FOLIUM_PANEL_TAB_PREFIX)) {
            onTabChange('cover');
        }
    }, [currentTabExists, currentTab, onTabChange]);

    usePlayerPanelTabShortcut({
        isOpen,
        currentTab,
        availableTabs: tabs.map(tab => tab.id),
        onTabChange,
    });

    // Theme Helper
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated
    const isCover = currentTab === 'cover';
    const like: SongLike = { isLiked, onLike, disabled: likeDisabled, disabledReason: likeDisabledReason };
    const handleNavigateHome = () => {
        onToggle();
        onNavigateHomeDirect();
    };
    const handleLocatePlayingSong = () => {
        onToggle();
        locatePlayingSong();
    };

    // 关闭面板并导航回首页，同时打开设置页面
    const handleOpenSettings = () => {
        onToggle();
        onOpenSettings?.();
    };

    return (
        <PanelShell
            isOpen={isOpen}
            hasHandle={showOpenPanelCloseButton && !hideToggleButton}
            isCover={isCover}
            tabKey={currentTab}
            theme={theme}
            isDaylight={isDaylight}
            header={(
                <SongHeader
                    isBig={isCover}
                    currentSong={currentSong}
                    coverUrl={coverUrl}
                    like={like}
                    onShowCover={() => onTabChange('cover')}
                >
                    <SongCredits
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
                    <SongActions
                        like={like}
                        onLocatePlayingSong={handleLocatePlayingSong}
                        onNavigateHome={handleNavigateHome}
                        onOpenSettings={onOpenSettings ? handleOpenSettings : undefined}
                    />
                </SongHeader>
            )}
            dock={<TabDock tabs={tabs} currentTab={currentTab} onTabChange={onTabChange} />}
            handle={(
                <PanelHandle
                    isOpen={isOpen}
                    onToggle={onToggle}
                    theme={theme}
                    isDaylight={isDaylight}
                    showOpenPanelCloseButton={showOpenPanelCloseButton}
                    isPanelGuideHotspotActive={isPanelGuideHotspotActive}
                    hideToggleButton={hideToggleButton}
                    onOpenCommandPalette={onOpenCommandPalette}
                    isCommandPaletteOpen={isCommandPaletteOpen}
                />
            )}
        >
            {currentTab === 'controls' && (
                <ControlsTab
                    loopMode={loopMode}
                    onToggleLoop={onToggleLoop}
                    onGenerateAITheme={onGenerateAITheme}
                    isGeneratingTheme={isGeneratingTheme}
                    canGenerateAITheme={canGenerateAITheme}
                    theme={theme}
                    onThemeChange={onThemeChange}
                    onBgModeChange={onBgModeChange}
                    hasCustomTheme={hasCustomTheme}
                    themeSourceModel={themeSourceModel}
                    defaultTheme={defaultTheme}
                    daylightTheme={daylightTheme}
                    visualizerMode={visualizerMode}
                    onVisualizerModeChange={onVisualizerModeChange}
                    useCoverColorBg={useCoverColorBg}
                    onToggleCoverColorBg={onToggleCoverColorBg}
                    transparentPlayerBackground={transparentPlayerBackground}
                    onToggleTransparentPlayerBackground={onToggleTransparentPlayerBackground}
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
                        trashDisabled={playbackControlsDisabled || !canDislikeCurrentSong(currentSong)}
                        onLike={onLike}
                        isLiked={isLiked}
                        likeDisabled={likeDisabled}
                        likeDisabledReason={likeDisabledReason}
                    />
                ) : isStage ? (
                    <EmptyState icon={<Radio size={28} />}>
                        {playbackControlsDisabled
                            ? t('unifiedPanel.nowPlayingStageDescription')
                            : t('unifiedPanel.stageLocalInputDescription')}
                    </EmptyState>
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
                        canSaveLocalPlaylist={canSaveQueueAsLocalPlaylist(currentSong, playQueue)}
                        onSaveCurrentQueueAsPlaylist={onSaveCurrentQueueAsPlaylist}
                        isDaylight={isDaylight}
                    />
                )
            )}
            {currentTab === 'account' && (
                <AccountTab
                    accountController={accountController}
                    audioQuality={audioQuality}
                    onAudioQualityChange={onAudioQualityChange}
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
            <FoliumPanelTabBody tab={currentTab} theme={theme} isDaylight={isDaylight} />
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
        </PanelShell>
    );
};

export default UnifiedPanel;
