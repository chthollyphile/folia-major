// dev/probes/wallToolsIsland/islandProbeApi.ts
// window.__wallToolsIslandProbe 的类型：探针（wallToolsIsland.probe）实现它，组件用例 test/component/wallToolsIsland.spec 调它。
// 单独放一个只有类型的文件，用例 import 它不会把 React 与 store 拉进 Node 侧。

/** 假宿主收到的一次调用（下标都是调用那一刻 playQueue 里的下标）。 */
export type IslandProbeCall = {
    kind:
        | 'playQueueSong'
        | 'playQueueSongNext'
        | 'moveQueueSongToEnd'
        | 'removeQueueSong'
        | 'moveQueueSong'
        | 'clearQueue'
        | 'saveQueueAsPlaylist'
        | 'shuffleQueue'
        | 'generateTheme'
        | 'previewVolume'
        | 'openPlayer'
        | 'openSettings';
    /** 点歌播放：歌的 id。 */
    id?: string;
    index?: number;
    from?: number;
    to?: number;
    /** 存为歌单：歌单名。 */
    name?: string;
};

export type IslandProbeApi = {
    calls: () => IslandProbeCall[];
    clearCalls: () => void;
    /** 播放 store 里此刻的队列（歌的 id）。 */
    queueIds: () => string[];
    currentId: () => string | null;
    /** 换一条 count 首的队列（local：全是本地歌，可以存为歌单），currentIndex 那首在播。 */
    seed: (options?: { count?: number; currentIndex?: number; local?: boolean }) => void;
    /** 切歌（不经宿主，模拟自然播完）。 */
    setCurrent: (index: number) => void;
    setFmMode: (on: boolean) => void;
    /** 外部舞台播放（activePlaybackContext = 'stage'）。 */
    setStage: (on: boolean) => void;
    setDaylight: (on: boolean) => void;
    /** 强调色换成正文色（缺省暗色主题的样子）：画在强调色上的前景要靠 --text-on-accent 才看得见。 */
    setAccentMatchesText: (on: boolean) => void;
    /** 帮助列表的行数（缺省 1）：量帮助展开 + 浮岛打开时的高度预算。 */
    setHelpLines: (count: number) => void;
    /** 让下一次存为歌单失败。 */
    failNextSave: () => void;
    /** 浮岛的开合偏好（useLatticeSettingsStore）。 */
    islandPreference: () => boolean;
};

declare global {
    interface Window {
        __wallToolsIslandProbe?: IslandProbeApi;
    }
}
