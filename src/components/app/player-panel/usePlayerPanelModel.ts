import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '../../../services/baseThemes';
import { resolveSongLiked } from '../../../utils/resolveSongLiked';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { useAppChromeStore } from '../../../stores/useAppChromeStore';
import { useLibraryStore } from '../../../stores/useLibraryStore';
import { useThemeSettingsStore } from '../../../stores/useThemeSettingsStore';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import { usePlayerChromeSettingsStore } from '../../../stores/usePlayerChromeSettingsStore';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { selectDisplayCoverUrl, selectDisplayLyrics, usePlaybackStore } from '../../../stores/usePlaybackStore';
import type { LocalSong, SongResult } from '../../../types';
import type { LocalLibraryCatalogSnapshot } from '../../../hooks/useLocalLibraryCatalog';
import type { CollectionNavigationOrigin } from '../../../stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '../home/gridViewCollectionAdapters';
import { createCopySongInfoSuccessHandler } from '../dialogs/createCopySongInfoSuccessHandler';
import { createPlayerPanelCollectionEntries } from './createPlayerPanelCollectionEntries';
import { buildPlayerPanelModel, type PlayerPanelDeps, type PlayerPanelViewModel } from './buildPlayerPanelModel';

// src/components/app/player-panel/usePlayerPanelModel.ts

/** What the ambient half still needs from App.tsx to be derived here rather than there. */
type PlayerPanelModelInputs = PlayerPanelDeps & {
    /** Liked-state sources: local files answer from disk, the rest from the provider's set. */
    isLocalSongLiked: (song: SongResult) => boolean;
    likedSongIds: Set<string | number>;
    /** Chrome flag computed by buildPlayerViewFlags; combined with the runtime hidden state here. */
    shouldHidePlayerRightPanelButton: boolean;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    navigateToCollection: (
        collection: GridViewCollectionDescriptor,
        origin: CollectionNavigationOrigin,
    ) => void;
};

/**
 * The player panel model with its 28 ambient values filled in here instead of in App.tsx.
 *
 * This is the block that made the "add one field, edit five places" problem concrete: it was 277
 * lines of App.tsx, ~140 of which were the four collection-entry closures now living in
 * createPlayerPanelCollectionEntries.ts.
 */
export const usePlayerPanelModel = ({
    isLocalSongLiked,
    likedSongIds,
    shouldHidePlayerRightPanelButton,
    localSongs,
    localLibraryCatalog,
    navigateToCollection,
    ...deps
}: PlayerPanelModelInputs): PlayerPanelViewModel => {
    const { t } = useTranslation();
    const isPanelOpen = useAppViewStore(state => state.isPanelOpen);
    const panelTab = useAppViewStore(state => state.panelTab);
    const isPlayerChromeHidden = useAppChromeStore(state => state.isPlayerChromeHidden);
    const isPanelGuideHotspotActive = useAppChromeStore(state => state.isPlayerPanelGuideHotspotActive);
    const starredNavidromeSongIds = useLibraryStore(state => state.starredNavidromeSongIds);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const useCoverColorBg = useThemeSettingsStore(state => state.useCoverColorBg);
    const volume = useAudioSettingsStore(state => state.volume);
    const isMuted = useAudioSettingsStore(state => state.isMuted);
    const audioQuality = useAudioSettingsStore(state => state.audioQuality);
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const transparentPlayerBackground = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground);
    const showOpenPanelCloseButton = usePlayerChromeSettingsStore(state => state.showOpenPanelCloseButton);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const playerState = usePlaybackStore(state => state.playerState);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    const replayGainMode = usePlaybackStore(state => state.replayGainMode);
    const lyricTimelineOffsetMs = usePlaybackStore(state => state.lyricTimelineOffsetMs);
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const displayCoverUrl = usePlaybackStore(selectDisplayCoverUrl);
    const displayLyrics = usePlaybackStore(selectDisplayLyrics);

    // `omni.isSongLiked` reads the provider account store, but this memo only re-runs when its
    // dependencies change. Subscribe to the playing provider's liked set so a successful
    // favorite/unfavorite immediately recomputes the heart icon for every online provider.
    const currentSongProviderId = currentSong?.sourceRef?.kind === 'online'
        ? currentSong.sourceRef.providerId
        : undefined;
    const providerLikedSongIds = useOnlineProviderAccountStore(state => (
        currentSongProviderId ? state.accounts[currentSongProviderId]?.likedSongIds : undefined
    ));

    const isLiked = useMemo(
        () => resolveSongLiked(currentSong, { isLocalSongLiked, starredNavidromeSongIds, likedSongIds }),
        [currentSong, isLocalSongLiked, likedSongIds, starredNavidromeSongIds, providerLikedSongIds],
    );

    const collectionEntries = useMemo(() => createPlayerPanelCollectionEntries({
        currentSong,
        displaySong: deps.currentSong,
        localSongs,
        localLibraryCatalog,
        navigateToCollection,
        t,
    }), [currentSong, deps.currentSong, localSongs, localLibraryCatalog, navigateToCollection, t]);

    const handleCopySongInfoSuccess = useMemo(() => createCopySongInfoSuccessHandler({ t }), [t]);

    return useMemo(() => buildPlayerPanelModel({
        ...deps,
        ...collectionEntries,
        isPanelOpen,
        panelTab,
        coverUrl: displayCoverUrl,
        isLiked,
        hasLyrics: Boolean(displayLyrics),
        defaultTheme: DEFAULT_THEME,
        daylightTheme: DAYLIGHT_THEME,
        visualizerMode,
        transparentPlayerBackground,
        onlineLyricsState: currentSong?.onlineLyricsState ?? null,
        lyricTimelineOffsetMs,
        replayGainMode,
        isFmMode,
        playerState,
        volume,
        isMuted,
        showOpenPanelCloseButton,
        isPanelGuideHotspotActive,
        hideToggleButton: isPlayerChromeHidden || shouldHidePlayerRightPanelButton,
        activePlaybackContext,
        audioQuality,
        useCoverColorBg,
        isDaylight,
        handleCopySongInfoSuccess,
        // Spread rather than `deps`: the caller passes an object literal, so depending on the object
        // would rebuild this every render. The key set is fixed by the call site.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [
        ...Object.values(deps),
        collectionEntries,
        isPanelOpen,
        panelTab,
        displayCoverUrl,
        isLiked,
        displayLyrics,
        visualizerMode,
        transparentPlayerBackground,
        currentSong,
        lyricTimelineOffsetMs,
        replayGainMode,
        isFmMode,
        playerState,
        volume,
        isMuted,
        showOpenPanelCloseButton,
        isPanelGuideHotspotActive,
        isPlayerChromeHidden,
        shouldHidePlayerRightPanelButton,
        activePlaybackContext,
        audioQuality,
        useCoverColorBg,
        isDaylight,
        handleCopySongInfoSuccess,
    ]);
};
