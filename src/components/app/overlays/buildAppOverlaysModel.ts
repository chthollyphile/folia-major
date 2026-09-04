import type React from 'react';
import type { MotionValue } from 'framer-motion';
import type FloatingPlayerControls from '../../FloatingPlayerControls';
import type SearchWorkspace from '../search/SearchWorkspace';
import type DevDebugOverlay from '../../DevDebugOverlay';
import type MemoryMonitorWindow from '../../debug/MemoryMonitorWindow';
import type NowPlayingToast from './NowPlayingToast';
import { PlayerState } from '../../../types';
import type { SongResult, UnifiedSong, LyricData } from '../../../types';
import { resolvePlaybackNeighbors } from '../../../utils/playbackNeighbors';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { getSongArtistLabel } from '../../../services/onlineMusic/songMetadata';
import { setPlayerState } from '../../../stores/usePlaybackStore';
import { setIsDevDebugOverlayVisible, setIsMemoryMonitorVisible } from '../../../stores/useAppChromeStore';
import type { SlotContextFromApp } from '../../FloatingPlayerControls';
import type { PlayerControlSlotActionId } from '../../../types/playerControlSlots';

// src/components/app/overlays/buildAppOverlaysModel.ts

type SearchOverlayProps = React.ComponentProps<typeof SearchWorkspace>;
type FloatingControlsProps = React.ComponentProps<typeof FloatingPlayerControls>;
type DebugOverlayProps = React.ComponentProps<typeof DevDebugOverlay>;
type MemoryMonitorProps = React.ComponentProps<typeof MemoryMonitorWindow>;
type NowPlayingToastProps = React.ComponentProps<typeof NowPlayingToast>;

export type AppOverlaysModel = {
    searchOverlay?: SearchOverlayProps | null;
    debugOverlay?: DebugOverlayProps | null;
    memoryMonitor?: MemoryMonitorProps | null;
    floatingControls?: FloatingControlsProps | null;
    nowPlayingToast?: NowPlayingToastProps | null;
};

// What the model needs that this file can read for itself: store state, the per-frame motion
// signals, and its own translated labels. Keeping these out of the caller's argument list is the
// whole point of useAppOverlaysModel below - App.tsx had to name all 25 of them.
type AppOverlaysAmbient = {

    currentView: FloatingControlsProps['currentView'];
    isSearchOpen: boolean;
    isDaylight: boolean;
    isDevDebugOverlayVisible: boolean;
    isMemoryMonitorVisible: boolean;
    memoryMonitorShortcutLabel: string;
    currentTime: MotionValue<number>;
    lyricCurrentTime: MotionValue<number>;
    currentSong: SongResult | null;
    playerState: PlayerState;
    duration: number;
    audioSrc: string | null;
    lyrics: LyricData | null;
    activePlaybackContext: 'main' | 'stage';
    isPlayerChromeHidden: boolean;
    noTrackText: string;
    playQueue: SongResult[];
    isFmMode: boolean;
    prevTrackLabel: string;
    nextTrackLabel: string;
    /**
     * now playing 卡片（playing-toast 样式）的封面。
     *
     * 混音期间必须和上面的 `currentSong` 描述同一首歌，所以调用方传的是冻结画面里的那张，不是实时的。
     * 也不要在这儿补 `cachedCoverUrl` 兜底：混音中冻结封面为 null 是「这首歌本来就没有封面」的合法
     * 取值，退回实时缓存等于把下一首的封面贴到上一首的标题下面。
     */
    coverUrl: string | null;
    stageTrackPillMode: 'auto' | 'always' | 'never';
    stageTrackPillTimeoutSec: number;
    /** 卡片上的两种动作各自的无障碍名字 */
    stageTrackPillOpenPlayerLabel: string;
    stageTrackPillOpenSongCardLabel: string;
    playerControlSlotPrimary: PlayerControlSlotActionId;
    playerControlSlotSecondary: PlayerControlSlotActionId;
    playerControlSlotContext: SlotContextFromApp;
    onCommitPlayerBottomBarOffset: (offsetPx: number) => void;
};

// What only the caller can supply: controller callbacks and values App.tsx computes.
export type AppOverlaysDeps = {
    theme: any;
    closeSearchView: () => void;
    handleSearchOverlaySubmit: SearchOverlayProps['onSubmitSearch'];
    handleSearchLoadMore: () => Promise<void>;
    handleSearchResultPlay: (track: UnifiedSong) => void;
    handleSearchResultAddToQueue: (track: UnifiedSong) => void;
    handleSearchResultArtistOpen: SearchOverlayProps['onOpenArtist'];
    handleSearchResultAlbumOpen: SearchOverlayProps['onOpenAlbum'];
    devDebugSnapshot: any;
    effectiveLoopMode: 'off' | 'all' | 'one';
    canToggleCurrentPlayback: boolean;
    isNowPlayingControlDisabled: boolean;
    stageActiveEntryKind: string | null;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    stageLyricsClockRef: React.MutableRefObject<{ startTimeSec: number }>;
    togglePlay: FloatingControlsProps['onTogglePlay'];
    toggleLoop: FloatingControlsProps['onToggleLoop'];
    navigateToPlayer: () => void;
    shouldHidePlayerProgressBar: boolean;
    onSeekMainAudio: (time: number) => void;
    onStagePlayerSeek: () => Promise<unknown>;
    isNowPlayingStageActive: boolean;
    handlePrevTrack: () => void;
    handleNextTrack: () => void;
    shuffleQueue: () => void;
    handleLike: () => void;
    isDisplaySongLiked: boolean;
    invokeCommandById: (commandId: string) => void;
    canInvokeCommandById: (commandId: string) => boolean;
    /** 自动切歌预览（下一首）；isNextUp 时整卡展示它 */
    stageNextUp: { title: string; artist: string | null; coverUrl: string | null } | null;
    /** 预览态：接下来播放标签 + 挂起 auto 隐藏计时 */
    stageIsNextUp: boolean;
    /** 当前页面 + 显示模式允许卡片在场（歌词页总是，首页看设置）；App 里算好的单一来源 */
    stageTrackPillOnScreen: boolean;
    /** 点卡片时展开右侧面板的歌曲卡片（切到 cover 页并打开） */
    openSongCardPanel: () => void;
};

type BuildAppOverlaysModelParams = AppOverlaysAmbient & AppOverlaysDeps;

// Builds the full overlay model, including detail overlays and floating playback controls.
export const buildAppOverlaysModel = ({
    currentView,
    isSearchOpen,
    theme,
    isDaylight,
    closeSearchView,
    handleSearchOverlaySubmit,
    handleSearchLoadMore,
    handleSearchResultPlay,
    handleSearchResultAddToQueue,
    handleSearchResultArtistOpen,
    handleSearchResultAlbumOpen,
    isDevDebugOverlayVisible,
    isMemoryMonitorVisible,
    memoryMonitorShortcutLabel,
    devDebugSnapshot,
    currentTime,
    lyricCurrentTime,
    currentSong,
    playerState,
    duration,
    effectiveLoopMode,
    audioSrc,
    canToggleCurrentPlayback,
    isNowPlayingControlDisabled,
    lyrics,
    activePlaybackContext,
    stageActiveEntryKind,
    syncStageLyricsClock,
    stageLyricsClockRef,
    togglePlay,
    toggleLoop,
    navigateToPlayer,
    isPlayerChromeHidden,
    shouldHidePlayerProgressBar,
    onSeekMainAudio,
    onStagePlayerSeek,
    noTrackText,
    playQueue,
    isFmMode,
    isNowPlayingStageActive,
    handlePrevTrack,
    handleNextTrack,
    prevTrackLabel,
    nextTrackLabel,
    coverUrl,
    stageTrackPillMode,
    stageTrackPillTimeoutSec,
    stageNextUp,
    stageIsNextUp,
    stageTrackPillOnScreen,
    openSongCardPanel,
    stageTrackPillOpenPlayerLabel,
    stageTrackPillOpenSongCardLabel,
    playerControlSlotPrimary,
    playerControlSlotSecondary,
    playerControlSlotContext,
    onCommitPlayerBottomBarOffset,
}: BuildAppOverlaysModelParams): AppOverlaysModel => ({
    // Gated on stageTrackPillOnScreen (computed in App: display mode plus which page allows the
    // card) rather than on the view directly, so the countdown that feeds the "up next" preview
    // and the card that shows it can never disagree about where the card lives.
    nowPlayingToast: stageTrackPillOnScreen && currentSong
        ? {
            song: {
                title: currentSong.name || '',
                artist: getSongArtistLabel(currentSong) || null,
                coverUrl: coverUrl || null,
            },
            trackKey: getPlaybackSongKey(currentSong),
            isDaylight,
            mode: stageTrackPillMode,
            timeoutSec: stageTrackPillTimeoutSec,
            nextUp: stageNextUp,
            isNextUp: stageIsNextUp,
            theme,
            onActivate: currentView === 'home' ? navigateToPlayer : openSongCardPanel,
            activateLabel: currentView === 'home'
                ? stageTrackPillOpenPlayerLabel
                : stageTrackPillOpenSongCardLabel,
        }
        : null,
    searchOverlay: currentView === 'home'
        ? {
            theme,
            isDaylight,
            onClose: closeSearchView,
            onSubmitSearch: handleSearchOverlaySubmit,
            onLoadMore: handleSearchLoadMore,
            onPlayTrack: handleSearchResultPlay,
            onAddTrackToQueue: handleSearchResultAddToQueue,
            onOpenArtist: handleSearchResultArtistOpen,
            onOpenAlbum: handleSearchResultAlbumOpen,
        }
        : null,
    // Not gated on the view, and that was a real hole: the app cold-starts on the home page,
    // so after a restart the chord opened nothing until something had been played - which
    // reads exactly like the switch in Settings having lost its setting. This overlay is the
    // only console the packaged build has, and the pages it could not be opened from are the
    // ones where a problem stops you ever reaching the player.
    debugOverlay: isDevDebugOverlayVisible && devDebugSnapshot
        ? {
            snapshot: devDebugSnapshot,
            currentTime,
            lyricCurrentTime,
            isDaylight,
            onClose: () => setIsDevDebugOverlayVisible(false),
        }
        : null,
    // Independent of the log window on purpose: they answer different questions and are read side
    // by side. Closing either one stops neither the console buffer nor the sampling behind it.
    memoryMonitor: isMemoryMonitorVisible
        ? {
            isDaylight,
            shortcutLabel: memoryMonitorShortcutLabel,
            onClose: () => setIsMemoryMonitorVisible(false),
        }
        : null,
    floatingControls: currentSong && currentView !== 'lattice'
        ? {
            currentSong,
            playerState,
            currentTime,
            lyricCurrentTime,
            duration,
            loopMode: effectiveLoopMode,
            currentView,
            audioSrc,
            canTogglePlay: canToggleCurrentPlayback,
            controlsDisabled: isNowPlayingControlDisabled,
            lyrics,
            onSeek: (time) => {
                if (isNowPlayingControlDisabled) {
                    return;
                }

                if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && !audioSrc) {
                    syncStageLyricsClock(time, duration, playerState, stageLyricsClockRef.current.startTimeSec);
                    currentTime.set(time);
                    if (playerState !== PlayerState.PLAYING) {
                        setPlayerState(PlayerState.PLAYING);
                    }
                    void onStagePlayerSeek();
                } else {
                    onSeekMainAudio(time);
                }
            },
            onTogglePlay: togglePlay,
            onToggleLoop: toggleLoop,
            onNavigateToPlayer: navigateToPlayer,
            noTrackText,
            primaryColor: 'var(--text-primary)',
            secondaryColor: 'var(--text-secondary)',
            theme,
            isDaylight,
            isHidden: currentView === 'player' && isPlayerChromeHidden,
            hideControlBar: shouldHidePlayerProgressBar,
            slotPrimary: playerControlSlotPrimary,
            slotSecondary: playerControlSlotSecondary,
            slotContext: playerControlSlotContext,
            onCommitBottomBarOffset: onCommitPlayerBottomBarOffset,
            trackNavigation: ((): FloatingControlsProps['trackNavigation'] => {
                const neighbors = resolvePlaybackNeighbors({
                    playQueue,
                    currentSong,
                    loopMode: effectiveLoopMode,
                    isFmMode,
                    isStageActive: isNowPlayingStageActive,
                });

                return {
                    currentTrackKey: getPlaybackSongKey(currentSong),
                    onPrev: handlePrevTrack,
                    onNext: handleNextTrack,
                    canPrev: neighbors.prev.canGo && !isNowPlayingControlDisabled,
                    canNext: neighbors.next.canGo && !isNowPlayingControlDisabled,
                    prevTitle: neighbors.prev.title,
                    nextTitle: neighbors.next.title,
                    prevLabel: prevTrackLabel,
                    nextLabel: nextTrackLabel,
                };
            })(),
        }
        : null,
});
