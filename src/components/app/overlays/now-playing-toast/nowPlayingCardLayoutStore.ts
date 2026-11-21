import { create } from 'zustand';
import { selectDisplaySong, usePlaybackStore } from '../../../../stores/usePlaybackStore';

// Only adjustment-session state lives here; saved positions belong to useStageSettingsStore.
export const hasNowPlayingCardSong = (state: ReturnType<typeof usePlaybackStore.getState>) => Boolean(selectDisplaySong(state));
export const canPositionNowPlayingCard = () => hasNowPlayingCardSong(usePlaybackStore.getState());

export const useNowPlayingCardLayoutStore = create<{
    isPositioning: boolean;
    /** 卡片上长按拖动进行中（不经设置页的调整模式）：退出条件只有松手，别的自动收尾不许打断它。 */
    isLongPressDragging: boolean;
    requestSeq: number;
    requestPositioning: () => void;
    startPositioning: () => void;
    finishPositioning: () => void;
}>((set) => ({
    isPositioning: false,
    isLongPressDragging: false,
    requestSeq: 0,
    requestPositioning: () => {
        if (canPositionNowPlayingCard()) set(state => ({ requestSeq: state.requestSeq + 1 }));
    },
    startPositioning: () => set({ isPositioning: true }),
    finishPositioning: () => set({ isPositioning: false }),
}));
