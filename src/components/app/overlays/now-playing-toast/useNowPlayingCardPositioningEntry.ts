import { useEffect, useRef } from 'react';
import { useAppViewStore } from '../../../../stores/useAppViewStore';
import { closeSettings } from '../../../../stores/useSettingsModalStore';
import { usePlayerBottomBarLayoutStore } from '../../../../stores/usePlayerBottomBarLayoutStore';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { canPositionNowPlayingCard, hasNowPlayingCardSong, useNowPlayingCardLayoutStore } from './nowPlayingCardLayoutStore';

// Navigation stays in the app's existing navigation action, as with bottom-bar positioning.
export const useNowPlayingCardPositioningEntry = (navigateToPlayer: () => void) => {
    const seq = useNowPlayingCardLayoutStore(state => state.requestSeq);
    const positioning = useNowPlayingCardLayoutStore(state => state.isPositioning);
    const view = useAppViewStore(state => state.view);
    const hasSong = usePlaybackStore(hasNowPlayingCardSong);
    const bottomBarPositioning = usePlayerBottomBarLayoutStore(state => state.isPositioning);
    const handled = useRef(0);
    useEffect(() => {
        if (seq === handled.current) return;
        handled.current = seq;
        if (!canPositionNowPlayingCard()) return;
        const bottomBar = usePlayerBottomBarLayoutStore.getState();
        if (bottomBar.isPositioning) bottomBar.cancelPositioning();
        closeSettings();
        navigateToPlayer();
        useNowPlayingCardLayoutStore.getState().startPositioning();
    }, [navigateToPlayer, seq]);
    useEffect(() => {
        if (positioning && (!hasSong || useAppViewStore.getState().view !== 'player' || bottomBarPositioning)) {
            useNowPlayingCardLayoutStore.getState().finishPositioning();
        }
    }, [positioning, view, bottomBarPositioning, hasSong]);
};
