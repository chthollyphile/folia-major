import { useCallback } from 'react';
import type { SongResult } from '../../../../types';
import { PlayerState } from '../../../../types';
import type { LibraryPlaybackPort } from '../../../core/shared/ports.contract';
import { selectDisplayPlayerState, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { usePlaybackEntryViewStore } from '../../../../stores/usePlaybackEntryViewStore';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';

// src/library/suites/grid/shared/useGridStayPlayback.ts
// 实测反馈 fb3：「播放后进入的视图」是「留在原处」时，点卡片播放不跳转（跳转本身由应用的 navigateToPlaybackView 跳过），
// 网格要自己显示「这首正在播放」：正在播放的那首的卡片播放键变成暂停 / 继续（宿主的播放开关），再点就切换播放状态，
// 而不是重新「立即播放」。另外两个值下行为不变（点了就离开网格，回来再点仍是立即播放并跳转）。
// 只订阅三个离散值（设置是不是 stay、正在播放的播放键、播放 / 暂停），播放进度不会让网格重渲染。

export type GridPlaybackMark = 'playing' | 'paused';

export const useGridStayPlayback = (playTrack: (track: SongResult, queue: SongResult[]) => void, port: Pick<LibraryPlaybackPort, 'togglePlayback'>) => {
    const isStay = usePlaybackEntryViewStore(state => state.playbackEntryView === 'stay');
    const currentKey = usePlaybackStore(state => (state.currentSong ? getPlaybackSongKey(state.currentSong) : null));
    const isPlaying = usePlaybackStore(state => selectDisplayPlayerState(state) === PlayerState.PLAYING);
    const toggle = port.togglePlayback;
    /** 卡片要画成暂停 / 继续的那首（只有「留在原处」且宿主给了播放开关时才有）。 */
    const markedKey = isStay && toggle ? currentKey : null;

    const markFor = useCallback((track: SongResult | undefined): GridPlaybackMark | null => (
        markedKey && track && getPlaybackSongKey(track) === markedKey ? (isPlaying ? 'playing' : 'paused') : null
    ), [isPlaying, markedKey]);

    /**
     * 卡片的「播放」：正在播放的那首（留在原处时）切换播放状态，其余照旧交给播放端口。点的那一刻直读 store：
     * PolaroidCard 的 memo 比较不看 onSelect，卡片手里可能是早先渲染的闭包，判断不能依赖渲染时的值。
     */
    const selectTrack = useCallback((track: SongResult, queue: SongResult[]) => {
        const current = usePlaybackStore.getState().currentSong;
        if (
            toggle
            && usePlaybackEntryViewStore.getState().playbackEntryView === 'stay'
            && current
            && getPlaybackSongKey(current) === getPlaybackSongKey(track)
        ) {
            toggle();
            return;
        }
        playTrack(track, queue);
    }, [playTrack, toggle]);

    return { markFor, selectTrack };
};
