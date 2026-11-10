import { useEffect, useState } from 'react';
import type { ProbeDefinition } from './definition';
import type { SongResult } from '../../src/types';
import { WallToolsSurface } from '../../src/components/wall/WallToolsButton';
import { WallToolsHostContext, type WallToolsHost, type WallToolsHostSnapshot } from '../../src/components/wall/wallToolsHost';
import { usePlaybackStore } from '../../src/stores/usePlaybackStore';
import { useLatticeSettingsStore } from '../../src/stores/useLatticeSettingsStore';
import { getPlaybackSongKey } from '../../src/utils/appPlaybackGuards';
import { moveQueueItem, moveQueueItemToNext } from '../../src/utils/queueReorder';
import { resolveTextOnAccent } from '../../src/components/app/presentation/buildAppStyle';
import type { IslandProbeApi, IslandProbeCall } from './wallToolsIsland/islandProbeApi';

// dev/probes/wallToolsIsland.probe.tsx
// 墙面工具面板的队列浮岛（components/wall/WallToolsQueueIsland）：就地挂一份 WallToolsSurface（没有 dock），外面包一个
// 假宿主——队列动作直接改 usePlaybackStore（与真 App 的 createQueueMutations 一样的语义），每一次调用记进
// window.__wallToolsIslandProbe.calls()。缺省 200 首在线歌、第 0 首在播；seed({ local: true }) 换成全是本地歌的队列
// （能存为本地歌单）。用例经 window.__wallToolsIslandProbe 切私人 FM、外部舞台、日光与让下一次保存失败；
// setAccentMatchesText 把强调色换成正文色（缺省暗色主题就是这样），--text-on-accent 与真 App 一样由 buildAppStyle 的
// resolveTextOnAccent 从底色与正文色里挑。

// 可用性：外部舞台播放时不能洗牌（与真 App 的 selectQueueShufflable 一致），其余时候都能。
let snapshot: WallToolsHostSnapshot = { themeGeneration: 'ready', canShuffleQueue: true };
const snapshotListeners = new Set<() => void>();
const setProbeStage = (on: boolean) => {
    usePlaybackStore.getState().setActivePlaybackContext(on ? 'stage' : 'main');
    snapshot = { ...snapshot, canShuffleQueue: !on };
    for (const listener of snapshotListeners) listener();
};

const buildQueue = (count: number, local: boolean): SongResult[] => Array.from({ length: count }, (_, index) => {
    const id = `${local ? 'local' : 'island'}-${index}`;
    const base = {
        id,
        name: `Island Track ${index}`,
        artists: [{ id: index % 7, name: `Island Artist ${index % 7}` }],
        album: { id: 1, name: 'Island Album' },
        durationMs: 180_000,
    };
    if (local) {
        return { ...base, isLocal: true, localRef: { songId: id }, sourceRef: { kind: 'local', mediaId: id } } as unknown as SongResult;
    }
    return {
        ...base,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: id },
        // 第 3 首在网易云上不可用（privilege.st < 0）：行上带「不可用」标签。
        ...(index === 3 ? { privilege: { st: -200 } } : {}),
    } as SongResult;
});

let calls: IslandProbeCall[] = [];
let failNextSave = false;
const record = (call: IslandProbeCall) => {
    calls = [...calls, call];
};
const editQueue = (edit: (queue: SongResult[]) => SongResult[]) => {
    const { playQueue } = usePlaybackStore.getState();
    const next = edit(playQueue);
    if (next !== playQueue) usePlaybackStore.getState().setPlayQueue(next);
};

/** 假宿主：身份稳定（模块级），队列动作改播放 store，其余只记账。 */
const PROBE_HOST: WallToolsHost = {
    getSnapshot: () => snapshot,
    subscribe: listener => {
        snapshotListeners.add(listener);
        return () => snapshotListeners.delete(listener);
    },
    shuffleQueue: () => record({ kind: 'shuffleQueue' }),
    generateTheme: () => record({ kind: 'generateTheme' }),
    previewVolume: () => record({ kind: 'previewVolume' }),
    openPlayer: () => record({ kind: 'openPlayer' }),
    openSettings: () => record({ kind: 'openSettings' }),
    playQueueSong: song => {
        record({ kind: 'playQueueSong', id: String(song.id) });
        usePlaybackStore.getState().setCurrentSong(song);
    },
    playQueueSongNext: index => {
        record({ kind: 'playQueueSongNext', index });
        editQueue(queue => {
            const { currentSong } = usePlaybackStore.getState();
            const currentKey = currentSong ? getPlaybackSongKey(currentSong) : null;
            const currentIndex = currentKey ? queue.findIndex(song => getPlaybackSongKey(song) === currentKey) : -1;
            // 与真 App 的 createQueueMutations.moveQueueSongToNext 同一个纯函数。
            return moveQueueItemToNext(queue, index, currentIndex);
        });
    },
    moveQueueSongToEnd: index => {
        record({ kind: 'moveQueueSongToEnd', index });
        editQueue(queue => moveQueueItem(queue, index, queue.length - 1));
    },
    removeQueueSong: index => {
        record({ kind: 'removeQueueSong', index });
        editQueue(queue => queue.filter((_, songIndex) => songIndex !== index));
    },
    moveQueueSong: (from, to) => {
        record({ kind: 'moveQueueSong', from, to });
        editQueue(queue => moveQueueItem(queue, from, to));
    },
    clearQueue: () => {
        record({ kind: 'clearQueue' });
        editQueue(() => []);
    },
    saveQueueAsPlaylist: async name => {
        record({ kind: 'saveQueueAsPlaylist', name });
        if (failNextSave) {
            failNextSave = false;
            throw new Error('probe: save refused');
        }
    },
};

const seed: IslandProbeApi['seed'] = ({ count = 200, currentIndex = 0, local = false } = {}) => {
    const queue = buildQueue(count, local);
    usePlaybackStore.setState({ playQueue: queue, currentSong: queue[currentIndex] ?? null, isFmMode: false, activePlaybackContext: 'main' });
    setProbeStage(false);
};

/** 探针的两套主题色（暗 / 日光）；accentMatchesText 时强调色换成正文色。 */
const probeThemeVars = (isDaylight: boolean, accentMatchesText: boolean) => {
    const background = isDaylight ? '#efe9df' : '#121016';
    const text = isDaylight ? '#1c1917' : '#f7f4ee';
    const accent = accentMatchesText ? text : isDaylight ? '#b45309' : '#f59e0b';
    return {
        backgroundColor: background,
        color: text,
        ['--bg-color' as string]: background,
        ['--text-primary' as string]: text,
        ['--text-accent' as string]: accent,
        ['--text-on-accent' as string]: resolveTextOnAccent(accent, background, text),
    };
};

function WallToolsIslandProbe() {
    const [isDaylight, setIsDaylight] = useState(false);
    const [accentMatchesText, setAccentMatchesText] = useState(false);
    const [helpLines, setHelpLines] = useState(1);

    useEffect(() => {
        calls = [];
        failNextSave = false;
        seed();
        window.__wallToolsIslandProbe = {
            calls: () => calls,
            clearCalls: () => {
                calls = [];
            },
            queueIds: () => usePlaybackStore.getState().playQueue.map(song => String(song.id)),
            currentId: () => {
                const song = usePlaybackStore.getState().currentSong;
                return song ? String(song.id) : null;
            },
            seed,
            setCurrent: index => usePlaybackStore.getState().setCurrentSong(usePlaybackStore.getState().playQueue[index] ?? null),
            setFmMode: on => usePlaybackStore.getState().setIsFmMode(on),
            setStage: setProbeStage,
            setDaylight: setIsDaylight,
            setAccentMatchesText,
            setHelpLines,
            failNextSave: () => {
                failNextSave = true;
            },
            islandPreference: () => useLatticeSettingsStore.getState().wallToolsQueueIslandOpen,
        };
        return () => {
            delete window.__wallToolsIslandProbe;
        };
    }, []);

    return (
        <div
            className="relative h-screen w-screen overflow-hidden"
            data-probe-daylight={isDaylight}
            style={probeThemeVars(isDaylight, accentMatchesText)}
        >
            {/* 面板外面的一块空地：点它应当收起面板与浮岛。 */}
            <button type="button" data-probe-outside="" className="absolute left-6 top-6 rounded-lg px-3 py-2 text-xs opacity-60">
                outside
            </button>
            <WallToolsHostContext.Provider value={PROBE_HOST}>
                <WallToolsSurface
                    idPrefix="probe-wall-tools"
                    label="Wall tools"
                    isDaylight={isDaylight}
                    entries={[]}
                    help={Array.from({ length: helpLines }, (_, index) => <li key={index}><span>Probe help line {index + 1}</span><kbd>Ctrl K</kbd></li>)}
                />
            </WallToolsHostContext.Provider>
        </div>
    );
}

const definition: ProbeDefinition = {
    id: 'wallToolsIsland',
    title: '墙面工具 · 队列浮岛',
    description: '就地挂墙面工具面板与队列浮岛，假宿主直接改播放 store（200 首）。验证开合与偏好、点歌、悬停动作、拖拽与键盘排序、清空 / 存为歌单、FM 与舞台只读、Esc 分层、明暗两套样式。',
    Component: WallToolsIslandProbe,
};

export default definition;
