import { ChartBar, Heart, ListMusic, PanelsTopLeft, Repeat, Repeat1, RepeatOff, Shuffle, SkipBack, SkipForward, Timer, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlayerControlSlotActionId } from '../../types/playerControlSlots';

// src/components/floating-player/playerControlSlotActions.ts
// 进度条胶囊右侧两个可自定义槽位的动作清单。
//
// 仓库里没有中心化的播放动作注册表，最接近的是 command palette 的 playbackCommands；
// 这里只登记「已有图标 + 已有 handler」的播放相关动作，图标沿用那些命令自己声明的那一个。
// 会打开界面的动作不去碰侧边面板 tab，而是复用命令面板的 surface（音量滑块、队列列表等）。
// id 和默认值本身是跨层合同，放在 src/types/playerControlSlots.ts。

export type { PlayerControlSlotActionId };

/** 槽位渲染所需的全部输入；由 buildAppOverlaysModel 组装，全部来自已有 handler。 */
export type PlayerControlSlotContext = {
    loopMode: 'off' | 'all' | 'one';
    onToggleLoop: () => void;
    onPrev: () => void;
    onNext: () => void;
    canPrev: boolean;
    canNext: boolean;
    onShuffle: () => void;
    canShuffle: boolean;
    onLike: () => void;
    isLiked: boolean;
    likeDisabled: boolean;
    onToggleTimeline: () => void;
    hasLyrics: boolean;
    /**
     * 命令面板的 invokeCommandById：带 surface 的打开面板，不带的直接执行。
     * 打开界面的槽位全部走它，而不是自己去开侧边面板 tab。
     */
    invokeCommandById: (commandId: string) => void;
    /**
     * 该命令此刻能不能用。必须和命令面板同一套判断 —— 否则 Personal FM 里
     * 面板已经把队列命令藏起来了，槽位却还能点开它。
     */
    canInvokeCommandById: (commandId: string) => boolean;
};

/** 单个槽位算出来的渲染结果。 */
export type ResolvedPlayerControlSlot = {
    icon: LucideIcon;
    /** 图标是否填充（目前只有「喜爱」用得上）。 */
    filled: boolean;
    /** 是否处于「已开启」的高亮态（循环非 off、已喜爱）。 */
    active: boolean;
    disabled: boolean;
    onActivate: () => void;
    labelKey: string;
};

/** 设置下拉里的静态展示项：图标固定取一个代表态，不需要运行时状态。 */
export const PLAYER_CONTROL_SLOT_OPTIONS: readonly { id: PlayerControlSlotActionId; icon: LucideIcon; labelKey: string; }[] = [
    { id: 'loop', icon: Repeat, labelKey: 'options.playerControlSlotAction_loop' },
    { id: 'prev', icon: SkipBack, labelKey: 'options.playerControlSlotAction_prev' },
    { id: 'next', icon: SkipForward, labelKey: 'options.playerControlSlotAction_next' },
    { id: 'shuffle', icon: Shuffle, labelKey: 'options.playerControlSlotAction_shuffle' },
    { id: 'like', icon: Heart, labelKey: 'options.playerControlSlotAction_like' },
    { id: 'lyrics-timeline', icon: ChartBar, labelKey: 'options.playerControlSlotAction_lyricsTimeline' },
    { id: 'volume', icon: Volume2, labelKey: 'options.playerControlSlotAction_volume' },
    { id: 'queue', icon: ListMusic, labelKey: 'options.playerControlSlotAction_queue' },
    { id: 'song-wall', icon: PanelsTopLeft, labelKey: 'options.playerControlSlotAction_songWall' },
    { id: 'sleep-timer', icon: Timer, labelKey: 'options.playerControlSlotAction_sleepTimer' },
];

/** 循环按钮的图标反映当前模式，是这批动作里唯一的三态图标。 */
const resolveLoopIcon = (loopMode: PlayerControlSlotContext['loopMode']): LucideIcon => {
    if (loopMode === 'off') return RepeatOff;
    if (loopMode === 'one') return Repeat1;
    return Repeat;
};

/**
 * 把一个槽位 id 和当前播放上下文解析成可直接渲染的按钮描述。
 * 打开界面的四个动作统一转成 openCommandById，复用命令面板已经做好的 surface。
 */
export const resolvePlayerControlSlot = (
    id: PlayerControlSlotActionId,
    context: PlayerControlSlotContext,
): ResolvedPlayerControlSlot => {
    switch (id) {
        case 'loop':
            return {
                icon: resolveLoopIcon(context.loopMode),
                filled: false,
                active: context.loopMode !== 'off',
                disabled: false,
                onActivate: context.onToggleLoop,
                labelKey: 'options.playerControlSlotAction_loop',
            };
        case 'prev':
            return {
                icon: SkipBack,
                filled: false,
                active: false,
                disabled: !context.canPrev,
                onActivate: context.onPrev,
                labelKey: 'options.playerControlSlotAction_prev',
            };
        case 'next':
            return {
                icon: SkipForward,
                filled: false,
                active: false,
                disabled: !context.canNext,
                onActivate: context.onNext,
                labelKey: 'options.playerControlSlotAction_next',
            };
        case 'shuffle':
            return {
                icon: Shuffle,
                filled: false,
                active: false,
                disabled: !context.canShuffle,
                onActivate: context.onShuffle,
                labelKey: 'options.playerControlSlotAction_shuffle',
            };
        case 'like':
            return {
                icon: Heart,
                filled: context.isLiked,
                active: context.isLiked,
                disabled: context.likeDisabled,
                onActivate: context.onLike,
                labelKey: 'options.playerControlSlotAction_like',
            };
        case 'volume':
            return {
                icon: Volume2,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById('playback-volume'),
                onActivate: () => context.invokeCommandById('playback-volume'),
                labelKey: 'options.playerControlSlotAction_volume',
            };
        case 'queue':
            return {
                icon: ListMusic,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById('queue'),
                onActivate: () => context.invokeCommandById('queue'),
                labelKey: 'options.playerControlSlotAction_queue',
            };
        case 'song-wall':
            return {
                icon: PanelsTopLeft,
                filled: false,
                active: false,
                // The command hides itself on the wall, so the slot greys out there instead of
                // offering a trip to the surface the user is already looking at.
                disabled: !context.canInvokeCommandById('navigate-lattice'),
                onActivate: () => context.invokeCommandById('navigate-lattice'),
                labelKey: 'options.playerControlSlotAction_songWall',
            };
        case 'sleep-timer':
            return {
                icon: Timer,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById('sleep-timer'),
                onActivate: () => context.invokeCommandById('sleep-timer'),
                labelKey: 'options.playerControlSlotAction_sleepTimer',
            };
        case 'lyrics-timeline':
        default:
            return {
                icon: ChartBar,
                filled: false,
                active: false,
                disabled: !context.hasLyrics,
                onActivate: context.onToggleTimeline,
                labelKey: 'options.playerControlSlotAction_lyricsTimeline',
            };
    }
};
