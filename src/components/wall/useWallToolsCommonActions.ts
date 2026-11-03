import { useSyncExternalStore } from 'react';
import { Disc3, ListMusic, Settings, Shuffle, Sparkles, Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { useLatticeSettingsStore } from '../../stores/useLatticeSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import type { WallToolsEntry, WallToolsQuickAction } from './WallToolsRows';
import { useWallToolsHost, type WallToolsHostSnapshot } from './wallToolsHost';

// src/components/wall/useWallToolsCommonActions.ts
// 墙面工具面板里与墙无关的公共部分（两面墙一样）：快捷排的洗牌、主题、队列、播放器、设置五格，以及音量滑条。
// 动作来自宿主（wallToolsHost，App 经 WallToolsDockHost 提供）；没有宿主时（组件探针、Ponder 合成界面）洗牌、主题、
// 播放器、设置四格跳过，队列格照画但禁用，音量照常读写音量 store、只是拖动时不预览。
// 队列格开合面板上方的队列浮岛（WallToolsQueueIsland）：开合记在 useLatticeSettingsStore.wallToolsQueueIslandOpen，
// 私人 FM 下禁用、浮岛不显示（偏好保留，FM 结束后照旧展开）。
// 每面墙只给和场景有关的 locate / destination 两格与自己的 entries，由 WallToolsSurface 按固定顺序拼起来。

const NO_HOST_SNAPSHOT: WallToolsHostSnapshot = { themeGeneration: 'unavailable', canShuffleQueue: false };
const noopSubscribe = () => () => {};
const readNoHostSnapshot = () => NO_HOST_SNAPSHOT;

/** 音量图标随显示的值变（与播放页面板的音量行同一套：0 / 静音、小于一半、其余）。 */
const volumeIcon = (value: number) => (value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2);

/** 拖动或按键改音量时先解除静音（拖到一个音量就是想听见它）。 */
const unmuteForVolumeChange = () => {
    const audio = useAudioSettingsStore.getState();
    if (audio.isMuted) audio.handleToggleMute();
};

export type WallToolsCommonActions = {
    shuffle: WallToolsQuickAction | null;
    theme: WallToolsQuickAction | null;
    queue: WallToolsQuickAction;
    openPlayer: WallToolsQuickAction | null;
    settings: WallToolsQuickAction | null;
    volume: WallToolsEntry;
    /** 队列浮岛此刻该不该显示（面板打开时）：有宿主、不在私人 FM、偏好是展开。 */
    queueIslandShown: boolean;
};

/** 组装公共的五格与音量（每次渲染重算；只在面板打开时用到）。queueIslandId 是浮岛的 id（队列格的 aria-controls）。 */
export const useWallToolsCommonActions = ({ queueIslandId }: { queueIslandId: string }): WallToolsCommonActions => {
    const { t } = useTranslation();
    const host = useWallToolsHost();
    const snapshot = useSyncExternalStore(host?.subscribe ?? noopSubscribe, host?.getSnapshot ?? readNoHostSnapshot);
    const isFmMode = usePlaybackStore(state => state.isFmMode);
    // 外部 Stage 播放时洗牌不可用（selectQueueShufflable 与 shuffleQueue 本身都拒绝），原因要说清楚，而不是「至少两首」。
    const isStagePlayback = usePlaybackStore(state => state.activePlaybackContext === 'stage');
    const hasCurrentSong = usePlaybackStore(state => state.currentSong !== null);
    const volume = useAudioSettingsStore(state => state.volume);
    const isMuted = useAudioSettingsStore(state => state.isMuted);
    const queueIslandOpen = useLatticeSettingsStore(state => state.wallToolsQueueIslandOpen);

    const themeBusy = snapshot.themeGeneration === 'busy';
    const shuffle: WallToolsQuickAction | null = host ? {
        id: 'shuffle-queue',
        icon: Shuffle,
        label: t('wallTools.shuffle'),
        kbd: ': + R',
        disabled: !snapshot.canShuffleQueue,
        status: snapshot.canShuffleQueue
            ? undefined
            : t(isStagePlayback ? 'wallTools.shuffleUnavailableInStage' : 'wallTools.shuffleUnavailable'),
        // 不收起：洗完还能再洗一次，提示条报「播放队列已打乱」。
        keepOpen: true,
        onSelect: host.shuffleQueue,
    } : null;
    const theme: WallToolsQuickAction | null = host ? {
        id: 'generate-theme',
        icon: Sparkles,
        label: t('wallTools.theme'),
        disabled: snapshot.themeGeneration !== 'ready',
        busy: themeBusy,
        status: themeBusy
            ? t('wallTools.themeBusy')
            : snapshot.themeGeneration === 'unavailable' ? t('wallTools.themeUnavailable') : undefined,
        // 不收起：让人看到「生成中」，生成完按钮恢复。
        keepOpen: true,
        onSelect: host.generateTheme,
    } : null;
    // 私人 FM 没有可编辑的队列：禁用并写原因。其余时候这一格开合队列浮岛（aria-expanded / aria-controls），状态写下一步会怎样。
    const queueAvailable = host !== null && !isFmMode;
    const queueIslandShown = queueAvailable && queueIslandOpen;
    const queue: WallToolsQuickAction = {
        id: 'queue',
        icon: ListMusic,
        label: t('wallTools.queue'),
        disabled: !queueAvailable,
        status: host && isFmMode
            ? t('wallTools.queueUnavailableInFm')
            : queueAvailable ? t(queueIslandShown ? 'wallTools.queueHide' : 'wallTools.queueShow') : undefined,
        // 不收起：队列浮岛叠在面板上面，和面板一起开着。
        keepOpen: true,
        expanded: queueAvailable ? queueIslandShown : undefined,
        controls: queueIslandShown ? queueIslandId : undefined,
        onSelect: () => useLatticeSettingsStore.getState().setWallToolsQueueIslandOpen(!queueIslandOpen),
    };
    const openPlayer: WallToolsQuickAction | null = host ? {
        id: 'open-player',
        icon: Disc3,
        label: t('wallTools.openPlayer'),
        disabled: !hasCurrentSong,
        status: hasCurrentSong ? undefined : t('wallTools.openPlayerUnavailable'),
        onSelect: host.openPlayer,
    } : null;
    // 快捷排最右一格：打开设置（选项页）。设置弹窗盖在墙上，面板随之收起。
    const settings: WallToolsQuickAction | null = host ? {
        id: 'open-settings',
        icon: Settings,
        label: t('wallTools.openSettings'),
        onSelect: host.openSettings,
    } : null;

    const volumeEntry: WallToolsEntry = {
        kind: 'slider',
        id: 'volume',
        label: t('ui.volume'),
        value: isMuted ? 0 : volume,
        icon: Volume2,
        iconFor: volumeIcon,
        iconAction: {
            label: isMuted ? t('wallTools.unmute') : t('wallTools.mute'),
            pressed: isMuted,
            onPress: () => useAudioSettingsStore.getState().handleToggleMute(),
        },
        formatValue: value => (isMuted ? t('wallTools.muted') : `${Math.round(value * 100)}%`),
        onPreview: value => {
            unmuteForVolumeChange();
            host?.previewVolume(value);
        },
        onCommit: value => {
            unmuteForVolumeChange();
            useAudioSettingsStore.getState().handleSetVolume(value);
        },
    };

    return { shuffle, theme, queue, openPlayer, settings, volume: volumeEntry, queueIslandShown };
};
