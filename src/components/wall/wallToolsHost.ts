import { createContext, useContext } from 'react';
import type { SongResult } from '../../types';

// src/components/wall/wallToolsHost.ts
// 墙面工具（WallToolsButton，Lattice 与 bravais 共用）的宿主上下文：App 在 WallToolsDockHost 上提供一份 host，
// 两面墙的工具面板从这里拿洗牌、主题、音量预览、前往播放器、打开设置与队列编辑这些「要动应用」的动作，自己不认识 App。
// 这里只 import src/types（wall 不依赖 components/app 与 library，见 test/unit/wall/wallBoundaries.test.ts）。
// 队列数据本身不经过 host：面板与队列浮岛直接读 usePlaybackStore（playQueue、currentSong、isFmMode、activePlaybackContext）。
// 没有 host 的地方（组件探针、Ponder 的合成界面）面板照常画，只是要宿主的那几格跳过或禁用。

/** host 此刻的可用性（身份稳定的 host 经 getSnapshot / subscribe 读，只在值变化时通知）。 */
export type WallToolsHostSnapshot = {
    /** 主题生成：ready 可以生成；busy 正在生成；unavailable 没有能生成主题的歌（没有歌，或没有歌词也不是纯音乐）。 */
    themeGeneration: 'ready' | 'busy' | 'unavailable';
    /** 队列洗牌此刻能不能做：私人 FM、队列不足两首、外部 Stage 播放时不能。 */
    canShuffleQueue: boolean;
};

export type WallToolsHost = {
    getSnapshot: () => WallToolsHostSnapshot;
    subscribe: (listener: () => void) => () => void;

    // ---- 墙面动作 ----
    /** 把当前播放队列打乱一次（命令 playback-shuffle；正在播放的那首留在队首）。 */
    shuffleQueue: () => void;
    /** 为当前歌曲生成主题（命令 theme-generate-current；不可用时什么都不做）。 */
    generateTheme: () => void;
    /** 拖动音量时的输出预览（不写偏好、不重渲染应用）；松手时调用方再写音量 store。 */
    previewVolume: (volume: number) => void;
    /** 前往播放页。 */
    openPlayer: () => void;
    /** 打开设置（选项页，与播放页面板的齿轮同一个去处）。 */
    openSettings: () => void;

    // ---- 队列动作（下标都是 playQueue 里的下标）----
    /** 播放队列里的这首（不跳页，留在墙上）。 */
    playQueueSong: (song: SongResult) => void;
    /** 把这首挪到正在播放的下一首。 */
    playQueueSongNext: (index: number) => void;
    moveQueueSongToEnd: (index: number) => void;
    removeQueueSong: (index: number) => void;
    /** 把 from 的那首移到 to（拖拽排序；to 是移动完成后的下标）。 */
    moveQueueSong: (from: number, to: number) => void;
    clearQueue: () => void;
    /** 把当前队列存成本地歌单（只有全是本地歌时可用，见 utils/queueReorder 的 canSaveQueueAsLocalPlaylist）；失败时 reject。 */
    saveQueueAsPlaylist: (name: string) => Promise<void>;
};

export const WallToolsHostContext = createContext<WallToolsHost | null>(null);

/** 墙面工具的宿主（没有时为 null）。 */
export const useWallToolsHost = (): WallToolsHost | null => useContext(WallToolsHostContext);
