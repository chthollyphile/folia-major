import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { PlayerState } from '../../types';
import type { SongResult } from '../../types';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { setStatusMessage } from '../../stores/useStatusMessageStore';
import { useHifiEngineStore } from '../../services/hifi/hifiEngine';
import { playbackKindOfSong } from '../../services/hifi/hifiEligibility';

// src/components/hifi/useHifiWebRouteNotice.ts
// 开着 HiFi 时在线歌曲不归 mpv：它照旧从 Web 引擎、播放设置里的输出设备出声，独占也管不到它。听的人多半以为也走独占，
// 这里在本次会话第一首开始放的在线歌曲上提示一次，说清楚声音从哪里出来。

let shown = false;

/** 测试用：忘掉本次会话已经提示过。 */
export const resetHifiWebRouteNotice = () => {
    shown = false;
};

/** 开着 HiFi、mpv 可用时开始放一首在线歌曲：提示一次。 */
export const maybeShowHifiWebRouteNotice = (song: SongResult | null, playerState: PlayerState, t: TFunction) => {
    if (shown || !song || playerState !== PlayerState.PLAYING) return;
    if (playbackKindOfSong(song) !== 'online') return;
    const engine = useHifiEngineStore.getState();
    if (!useHifiSettingsStore.getState().enabled || !engine.supported || engine.runtime?.available !== true) return;
    shown = true;
    const exclusive = useHifiSettingsStore.getState().exclusive && typeof window !== 'undefined' && window.electron?.platform !== 'linux';
    setStatusMessage({
        type: 'info',
        text: t('hifi.notice.onlineNotHifi'),
        note: t(exclusive ? 'hifi.notice.onlineNotHifiExclusiveNote' : 'hifi.notice.onlineNotHifiNote'),
    });
};

// 挂在 App 里一次。
export function useHifiWebRouteNotice() {
    const { t } = useTranslation();
    const currentSong = usePlaybackStore(state => state.currentSong);
    const playerState = usePlaybackStore(state => state.playerState);
    useEffect(() => {
        maybeShowHifiWebRouteNotice(currentSong, playerState, t);
    }, [currentSong, playerState, t]);
}
