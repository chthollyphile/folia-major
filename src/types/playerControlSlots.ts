// src/types/playerControlSlots.ts
// 进度条胶囊上用户能摆的控件：右侧两个槽位，和指针停在胶囊上时浮出的那一排（浮岛）。
// 两处共用一个控件池，一个控件只能在一处（槽位或浮岛），不在两处同时出现。
//
// 只放 id、默认值、校验和摆放规则：store 需要它们来持久化，但不该为此依赖组件层的图标模块。
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
    | 'sleep-timer'
    | 'locate'
    | 'mark-moment'
    | 'add-to-playlist'
    | 'subtitles'
    | 'lyric-style';

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
    'locate',
    'mark-moment',
    'add-to-playlist',
    'subtitles',
    'lyric-style',
];

/** 默认保持改动前的样子：循环模式 + 歌词时间轴。 */
export const DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY: PlayerControlSlotActionId = 'loop';
export const DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY: PlayerControlSlotActionId = 'lyrics-timeline';

/** 浮岛最多放几个（不算最右那个固定的命令面板按钮）。 */
export const CAPSULE_ISLAND_MAX = 8;

/** 浮岛默认放的：改成用户自己摆之前，命令注册表里声明上浮岛的那七条，按原来的顺序。 */
export const DEFAULT_CAPSULE_ISLAND: readonly PlayerControlSlotActionId[] = [
    'volume',
    'like',
    'add-to-playlist',
    'shuffle',
    'subtitles',
    'mark-moment',
    'lyric-style',
];

export const isPlayerControlSlotActionId = (value: unknown): value is PlayerControlSlotActionId => (
    typeof value === 'string' && (PLAYER_CONTROL_SLOT_ACTION_IDS as readonly string[]).includes(value)
);

/** 胶囊上的控件摆成什么样：两个槽位各一个，浮岛一排（有顺序）。 */
export type PlayerControlLayout = {
    primary: PlayerControlSlotActionId;
    secondary: PlayerControlSlotActionId;
    island: readonly PlayerControlSlotActionId[];
};

export type PlayerControlSlotSide = 'primary' | 'secondary';

/**
 * 把一个控件放到哪儿：
 * - slot：放进这个槽位；
 * - island：插进浮岛第 index 个位置（index 按拿走它之后的那一排数）；
 * - island-swap：和浮岛第 index 个互换（槽位里的控件拖到浮岛上：槽位不能空着，只能换）；
 * - pool：放回没摆出来的那些（只有浮岛里的能放回去）。
 */
export type PlayerControlPlacement =
    | { kind: 'slot'; slot: PlayerControlSlotSide }
    | { kind: 'island'; index: number }
    | { kind: 'island-swap'; index: number }
    | { kind: 'pool' };

/** 存下来的浮岛清单读回来：认不得的、重复的、已经在槽位里的去掉，多的截掉。不是数组时用默认。 */
export const normalizeCapsuleIsland = (
    value: unknown,
    slots: readonly PlayerControlSlotActionId[],
): PlayerControlSlotActionId[] => {
    const source = Array.isArray(value) ? value : DEFAULT_CAPSULE_ISLAND;
    const seen = new Set<string>(slots);
    const island: PlayerControlSlotActionId[] = [];
    for (const entry of source) {
        if (!isPlayerControlSlotActionId(entry) || seen.has(entry)) continue;
        seen.add(entry);
        island.push(entry);
        if (island.length >= CAPSULE_ISLAND_MAX) break;
    }
    return island;
};

/** 这个控件现在在哪儿。 */
export const locatePlayerControl = (
    layout: PlayerControlLayout,
    id: PlayerControlSlotActionId,
): PlayerControlSlotSide | number | 'pool' => {
    if (layout.primary === id) return 'primary';
    if (layout.secondary === id) return 'secondary';
    const index = layout.island.indexOf(id);
    return index >= 0 ? index : 'pool';
};

/**
 * 把 id 放到 placement 之后的样子；这一步不成立（放回原处、槽位会空、浮岛满了）时得 null。
 * 规则只有一条：一个控件只在一处。放进槽位时，原来那个控件和它互换位置（从另一个槽位、从浮岛来的），
 * 从池子里来的则把原来那个换回池子。
 */
export const placePlayerControl = (
    layout: PlayerControlLayout,
    id: PlayerControlSlotActionId,
    placement: PlayerControlPlacement,
): PlayerControlLayout | null => {
    const from = locatePlayerControl(layout, id);
    switch (placement.kind) {
        case 'slot': {
            const side = placement.slot;
            const other: PlayerControlSlotSide = side === 'primary' ? 'secondary' : 'primary';
            const displaced = layout[side];
            if (from === side) return null;
            if (from === other) return { ...layout, [side]: id, [other]: displaced };
            if (typeof from === 'number') {
                const island = [...layout.island];
                island[from] = displaced;
                return { ...layout, [side]: id, island };
            }
            return { ...layout, [side]: id };
        }
        case 'island': {
            if (from === 'primary' || from === 'secondary') return null;
            const rest = layout.island.filter(entry => entry !== id);
            if (from === 'pool' && rest.length >= CAPSULE_ISLAND_MAX) return null;
            const index = Math.max(0, Math.min(rest.length, Math.round(placement.index)));
            if (from === index) return null;
            return { ...layout, island: [...rest.slice(0, index), id, ...rest.slice(index)] };
        }
        case 'island-swap': {
            if (from !== 'primary' && from !== 'secondary') return null;
            if (placement.index < 0 || placement.index >= layout.island.length) return null;
            const target = layout.island[placement.index];
            const island = [...layout.island];
            island[placement.index] = id;
            return { ...layout, [from]: target, island };
        }
        case 'pool':
        default: {
            if (typeof from !== 'number') return null;
            return { ...layout, island: layout.island.filter(entry => entry !== id) };
        }
    }
};
