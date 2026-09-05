// src/types/playerControlSlots.ts
// 进度条胶囊右侧两个可自定义槽位的跨层合同。
//
// 只放 id、默认值和校验：store 需要它们来持久化，但不该为此依赖组件层的图标模块。
// 图标和 handler 解析在 src/components/floating-player/playerControlSlotActions.ts。

export type PlayerControlSlotActionId =
    | 'loop'
    | 'prev'
    | 'next'
    | 'shuffle'
    | 'like'
    | 'lyrics-timeline'
    | 'volume'
    | 'queue'
    | 'song-wall'
    | 'sleep-timer';

export const PLAYER_CONTROL_SLOT_ACTION_IDS: readonly PlayerControlSlotActionId[] = [
    'loop',
    'prev',
    'next',
    'shuffle',
    'like',
    'lyrics-timeline',
    'volume',
    'queue',
    'song-wall',
    'sleep-timer',
];

/** 默认保持改动前的样子：循环模式 + 歌词时间轴。 */
export const DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY: PlayerControlSlotActionId = 'loop';
export const DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY: PlayerControlSlotActionId = 'lyrics-timeline';

export const isPlayerControlSlotActionId = (value: unknown): value is PlayerControlSlotActionId => (
    typeof value === 'string' && (PLAYER_CONTROL_SLOT_ACTION_IDS as readonly string[]).includes(value)
);
