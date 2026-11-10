import { useLayoutEffect, useRef, useState } from 'react';
import type { SongResult } from '../../../types';
import type { PlaybackNavigationOptions } from '../../../types/appPlayback';
import type { WallToolsHost, WallToolsHostSnapshot } from '../../wall/wallToolsHost';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';
import { openSettings } from '../../../stores/useSettingsModalStore';

// src/components/app/wall-tools/useAppWallToolsHost.ts
// App 给墙面工具（components/wall 的 WallToolsButton，bravais 与 Lattice 共用）的宿主：在这里把应用的动作组装成
// WallToolsHost，经 WallToolsDockHost 的 Provider 交给两面墙。原先 bravais 经 stage 契约的 tools 端口
// （library/app/useLibraryStageToolsPort，已删除）拿这些动作，Lattice 拿不到；现在两面墙读同一份 host，stage 契约里不再有 tools。
// - 生成主题、队列洗牌走命令面板的同一条命令（invokeCommandById），可用性是 canInvokeCommandById 的同一份判定；
// - 音量预览走应用的 handlePreviewVolume；前往播放器是 navigateToPlayer；打开设置直接开设置弹窗的选项页（与播放页面板的齿轮相同）；
// - 队列动作：点歌播放（不跳页）、下一首播放、移到末尾、移除、拖拽移动（createQueueMutations）、清空（clearQueue）、
//   存为本地歌单（播放页队列页的同一个实现 saveCurrentQueueAsLocalPlaylist）。
//   就地编辑之后的重新预取在 createQueueMutations.updateQueueOrder 里（播放页队列页、命令面板、浮岛同一条路），这里不再管。
// host 身份在应用的整个寿命里不变（动作总读最新的依赖）；可用性变了就发一次通知，面板按 getSnapshot 重画。

/** 主题生成与队列洗牌的命令 id（命令面板 settingsCommands / playbackCommands）。 */
export const WALL_TOOLS_THEME_COMMAND = 'theme-generate-current';
export const WALL_TOOLS_SHUFFLE_COMMAND = 'playback-shuffle';

export type WallToolsHostDeps = {
    /** 命令面板的 invokeCommandById / canInvokeCommandById（播放条槽位用的同一对）。 */
    invokeCommandById: (commandId: string) => void;
    canInvokeCommandById: (commandId: string) => boolean;
    /** 主题正在生成（命令此刻不可用的一种，单独给出来面板才能显示「生成中」）。 */
    isGeneratingTheme: boolean;
    /** 应用的音量预览（只动输出增益）。 */
    previewVolume: (volume: number) => void;
    navigateToPlayer: () => void;
    /** 应用的播放队列（点歌播放时连同队列一起交给 playSong）。 */
    playQueue: SongResult[];
    playSong: (song: SongResult, queue: SongResult[], isFmCall: boolean, options: PlaybackNavigationOptions) => unknown;
    moveQueueSongToNext: (index: number) => void;
    moveQueueSongToEnd: (index: number) => void;
    removeQueueSong: (index: number) => void;
    moveQueueSong: (from: number, to: number) => void;
    clearQueue: () => void;
    saveCurrentQueueAsLocalPlaylist: (name: string) => Promise<void>;
};

/** 与洗牌本身（usePlaybackQueueController.shuffleQueue）同一个前提：队列至少两首、不是外部 Stage 播放。FM 由命令的可用性管。 */
export const selectQueueShufflable = (state: ReturnType<typeof usePlaybackStore.getState>) => (
    state.playQueue.length > 1 && state.activePlaybackContext !== 'stage'
);

export type WallToolsHostStore = {
    host: WallToolsHost;
    /** 发布新的可用性；和上一份相同时不通知。 */
    publish: (snapshot: WallToolsHostSnapshot) => void;
};

/** 建一份身份稳定的 host：动作经 latest.current 读最新的依赖，快照去重后才通知订阅者。 */
export const createWallToolsHostStore = (latest: { current: WallToolsHostDeps }): WallToolsHostStore => {
    let snapshot: WallToolsHostSnapshot = { themeGeneration: 'unavailable', canShuffleQueue: false };
    const listeners = new Set<() => void>();
    return {
        host: {
            getSnapshot: () => snapshot,
            subscribe: listener => {
                listeners.add(listener);
                return () => listeners.delete(listener);
            },
            shuffleQueue: () => latest.current.invokeCommandById(WALL_TOOLS_SHUFFLE_COMMAND),
            generateTheme: () => latest.current.invokeCommandById(WALL_TOOLS_THEME_COMMAND),
            previewVolume: volume => latest.current.previewVolume(volume),
            openPlayer: () => latest.current.navigateToPlayer(),
            openSettings: () => openSettings('options'),
            // 留在墙上：点歌只换歌，不跳播放页（与 Lattice 点海报同一个调用）。
            playQueueSong: song => {
                void latest.current.playSong(song, latest.current.playQueue, false, { shouldNavigateToPlayer: false });
            },
            playQueueSongNext: index => latest.current.moveQueueSongToNext(index),
            moveQueueSongToEnd: index => latest.current.moveQueueSongToEnd(index),
            removeQueueSong: index => latest.current.removeQueueSong(index),
            moveQueueSong: (from, to) => latest.current.moveQueueSong(from, to),
            clearQueue: () => latest.current.clearQueue(),
            saveQueueAsPlaylist: name => latest.current.saveCurrentQueueAsLocalPlaylist(name),
        },
        publish: next => {
            if (next.themeGeneration === snapshot.themeGeneration && next.canShuffleQueue === snapshot.canShuffleQueue) return;
            snapshot = next;
            for (const listener of listeners) listener();
        },
    };
};

/** App 里调一次：返回身份稳定的 host，交给 WallToolsDockHost。 */
export const useAppWallToolsHost = (deps: WallToolsHostDeps): WallToolsHost => {
    const latest = useRef(deps);
    latest.current = deps;
    const [store] = useState(() => createWallToolsHostStore(latest));
    const queueShufflable = usePlaybackStore(selectQueueShufflable);
    const themeGeneration: WallToolsHostSnapshot['themeGeneration'] = deps.isGeneratingTheme
        ? 'busy'
        : deps.canInvokeCommandById(WALL_TOOLS_THEME_COMMAND) ? 'ready' : 'unavailable';
    const canShuffleQueue = queueShufflable && deps.canInvokeCommandById(WALL_TOOLS_SHUFFLE_COMMAND);
    useLayoutEffect(() => {
        store.publish({ themeGeneration, canShuffleQueue });
    }, [store, themeGeneration, canShuffleQueue]);
    return store.host;
};
