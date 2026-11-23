import { Captions, ChartBar, Crosshair, Heart, LayoutGrid, ListMusic, PanelsTopLeft, Pin, Repeat, Shuffle, SkipBack, SkipForward, Star, Timer, Volume2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlayerControlSlotActionId } from '../../types/playerControlSlots';
import { noteLoopButtonPress } from '../../services/ponder/loopShuffleHint';
import { loopModeIcon, loopModeLabelName } from '../shared/loopModeDisplay';
import { openSongNotePin } from '../song-notes/songNotePin';

// src/components/floating-player/playerControlSlotActions.ts
// 进度条胶囊上用户能摆的控件清单：右侧两个槽位和胶囊上方浮出的那一排（浮岛）共用这一份。
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
    /** anchor 是点下的那个按钮的位置：「记下这个时刻」把小框弹在它上方，其余动作用不上。 */
    onActivate: (anchor?: DOMRect) => void;
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
    { id: 'locate', icon: Crosshair, labelKey: 'options.playerControlSlotAction_locate' },
    { id: 'mark-moment', icon: Pin, labelKey: 'options.playerControlSlotAction_markMoment' },
    { id: 'add-to-playlist', icon: Star, labelKey: 'options.playerControlSlotAction_addToPlaylist' },
    { id: 'subtitles', icon: Captions, labelKey: 'options.playerControlSlotAction_subtitles' },
    { id: 'lyric-style', icon: LayoutGrid, labelKey: 'options.playerControlSlotAction_lyricStyle' },
];

/**
 * 槽位动作和命令面板里做同一件事的那条命令。歌词时间轴没有对应命令，不在表里。
 * 用来判断「面板里常用的这条命令能不能放进槽位」。
 */
export const PLAYER_CONTROL_SLOT_COMMAND_IDS: Readonly<Record<Exclude<PlayerControlSlotActionId, 'lyrics-timeline'>, string>> = {
    loop: 'playback-loop',
    prev: 'playback-prev',
    next: 'playback-next',
    shuffle: 'playback-shuffle',
    like: 'playback-like',
    volume: 'playback-volume',
    queue: 'queue',
    'song-wall': 'navigate-lattice',
    'sleep-timer': 'sleep-timer',
    locate: 'locate-playing-song',
    'mark-moment': 'song-notes-mark-moment',
    'add-to-playlist': 'playback-add-to-playlist',
    subtitles: 'settings-subtitles',
    'lyric-style': 'visualizer-picker',
};

/** 命令 id 反查槽位动作；不是任何槽位动作的命令返回 null。 */
export const playerControlSlotActionForCommand = (commandId: string): PlayerControlSlotActionId | null => {
    const entry = Object.entries(PLAYER_CONTROL_SLOT_COMMAND_IDS).find(([, id]) => id === commandId);
    return entry ? entry[0] as PlayerControlSlotActionId : null;
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
                // 循环按钮的图标和提示文本反映当前模式，是这批动作里唯一的三态图标。
                icon: loopModeIcon(context.loopMode),
                filled: false,
                active: context.loopMode !== 'off',
                disabled: false,
                onActivate: () => {
                    // 切循环本身会弹一条模式提示，这一条要在它之后才盖得住。
                    context.onToggleLoop();
                    noteLoopButtonPress();
                },
                labelKey: `player.${loopModeLabelName(context.loopMode)}`,
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
                disabled: !context.canInvokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS.volume),
                onActivate: () => context.invokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS.volume),
                labelKey: 'options.playerControlSlotAction_volume',
            };
        case 'queue':
            return {
                icon: ListMusic,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS.queue),
                onActivate: () => context.invokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS.queue),
                labelKey: 'options.playerControlSlotAction_queue',
            };
        case 'song-wall':
            return {
                icon: PanelsTopLeft,
                filled: false,
                active: false,
                // The command hides itself on the wall, so the slot greys out there instead of
                // offering a trip to the surface the user is already looking at.
                disabled: !context.canInvokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS['song-wall']),
                onActivate: () => context.invokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS['song-wall']),
                labelKey: 'options.playerControlSlotAction_songWall',
            };
        case 'sleep-timer':
            return {
                icon: Timer,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS['sleep-timer']),
                onActivate: () => context.invokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS['sleep-timer']),
                labelKey: 'options.playerControlSlotAction_sleepTimer',
            };
        case 'locate':
            return {
                icon: Crosshair,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS.locate),
                onActivate: () => context.invokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS.locate),
                labelKey: 'options.playerControlSlotAction_locate',
            };
        case 'mark-moment':
            return {
                icon: Pin,
                filled: false,
                active: false,
                // 和命令同一套判断：没在播、或是外部播放器的舞台歌，就不能记。
                disabled: !context.canInvokeCommandById(PLAYER_CONTROL_SLOT_COMMAND_IDS['mark-moment']),
                onActivate: anchor => openSongNotePin(anchor),
                labelKey: 'options.playerControlSlotAction_markMoment',
            };
        case 'add-to-playlist':
        case 'subtitles':
        case 'lyric-style': {
            // 打开命令面板里那块界面（加到歌单、字幕调节、歌词样式选择器），和命令同一套可用判断。
            const commandId = PLAYER_CONTROL_SLOT_COMMAND_IDS[id];
            const option = PLAYER_CONTROL_SLOT_OPTIONS.find(entry => entry.id === id);
            return {
                icon: option?.icon ?? LayoutGrid,
                filled: false,
                active: false,
                disabled: !context.canInvokeCommandById(commandId),
                onActivate: () => context.invokeCommandById(commandId),
                labelKey: option?.labelKey ?? 'options.playerControlSlotAction_lyricStyle',
            };
        }
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
