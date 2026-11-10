import { useSyncExternalStore } from 'react';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackRepresentation, onPlaybackRepresentationRegistered } from '../../services/playbackRecovery/representationRegistry';
import { webAudioSignal } from './webAudioSignal';

// 转码登记和播放源切换都能更新面板；只读当前引擎的源，避免把缓存中的转码误报为正在使用。

const subscribe = (notify: () => void) => onPlaybackRepresentationRegistered(notify);

export const useWebAudioSignal = () => {
    const song = usePlaybackStore(state => state.currentSong);
    const source = usePlaybackStore(state => state.audioSrc);
    const representation = useSyncExternalStore(subscribe, () => getPlaybackRepresentation(song), () => null);
    return webAudioSignal(source, representation);
};
