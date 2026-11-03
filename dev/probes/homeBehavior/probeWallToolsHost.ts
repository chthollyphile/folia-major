import type { WallToolsHost, WallToolsHostSnapshot } from '../../../src/components/wall/wallToolsHost';
import { getPlaybackSongKey } from '../../../src/utils/appPlaybackGuards';
import { recordProbeCall } from '../libraryBehavior/probeLog';

// dev/probes/homeBehavior/probeWallToolsHost.ts
// 首页探针给墙面工具面板的「假宿主」（真 App 是 components/app/wall-tools/useAppWallToolsHost，走命令面板的命令与队列操作）：
// 生成主题、队列洗牌、音量预览、前往播放页、打开设置与队列编辑都只记账；可用性由用例经 __homeProbe.setWallToolsHost 摆
// （缺省：没有歌——主题不可生成、不能洗牌）。homeBehavior.probe 用 WallToolsHostContext 把它包在 Home 外面。

const DEFAULT_SNAPSHOT: WallToolsHostSnapshot = { themeGeneration: 'unavailable', canShuffleQueue: false };

let snapshot = DEFAULT_SNAPSHOT;
const listeners = new Set<() => void>();

/** 模块级常量（身份稳定，与真 App 的 host 一样不随可用性重建）。 */
export const PROBE_WALL_TOOLS_HOST: WallToolsHost = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
    },
    generateTheme: () => recordProbeCall({ kind: 'generateTheme', ids: [] }),
    shuffleQueue: () => recordProbeCall({ kind: 'shuffleQueue', ids: [] }),
    previewVolume: volume => recordProbeCall({ kind: 'previewVolume', ids: [], detail: volume }),
    openPlayer: () => recordProbeCall({ kind: 'openPlayer', ids: [] }),
    openSettings: () => recordProbeCall({ kind: 'openSettings', ids: [] }),
    playQueueSong: song => recordProbeCall({ kind: 'playQueueSong', ids: [getPlaybackSongKey(song)] }),
    playQueueSongNext: index => recordProbeCall({ kind: 'playQueueSongNext', ids: [], detail: index }),
    moveQueueSongToEnd: index => recordProbeCall({ kind: 'moveQueueSongToEnd', ids: [], detail: index }),
    removeQueueSong: index => recordProbeCall({ kind: 'removeQueueSong', ids: [], detail: index }),
    moveQueueSong: (from, to) => recordProbeCall({ kind: 'moveQueueSong', ids: [], detail: { from, to } }),
    clearQueue: () => recordProbeCall({ kind: 'clearQueue', ids: [] }),
    saveQueueAsPlaylist: async name => {
        recordProbeCall({ kind: 'saveQueueAsPlaylist', ids: [], text: name });
    },
};

/** 摆可用性（合并进当前快照）；null 复位成缺省。 */
export const setProbeWallToolsHost = (next: Partial<WallToolsHostSnapshot> | null): void => {
    snapshot = next ? { ...snapshot, ...next } : DEFAULT_SNAPSHOT;
    for (const listener of listeners) listener();
};
