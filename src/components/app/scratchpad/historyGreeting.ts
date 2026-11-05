// src/components/app/scratchpad/historyGreeting.ts
// 速记簿抽屉顶上（页签上面）那一句问候：按系统时钟落在一天里的哪一段，一段有几句，每次随机挑一句。
// 两种长度：短版几个字（scratchpad.greetingShort.<段>.v1 … v<GREETING_SHORT_VARIANTS>），窄的抽屉里用；
// 长版是一整句（scratchpad.greeting.<段>.v1 … v<GREETING_VARIANTS>），展开成画布时用。几种语言句数相同。

export type HistoryGreetingSlot = 'lateNight' | 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** 每一段从几点开始（本地时间，含这一点）；按时间先后排，零点到第一段之前算深夜。 */
const SLOT_STARTS: readonly [number, HistoryGreetingSlot][] = [
    [0, 'lateNight'],
    [5, 'dawn'],
    [8, 'morning'],
    [11, 'noon'],
    [14, 'afternoon'],
    [18, 'evening'],
    [22, 'night'],
];

/** 这一刻（本地时间）落在哪一段。 */
export const historyGreetingSlot = (at: Date): HistoryGreetingSlot => {
    const hour = at.getHours();
    let slot: HistoryGreetingSlot = 'lateNight';
    for (const [start, name] of SLOT_STARTS) {
        if (hour >= start) slot = name;
    }
    return slot;
};

/** 到下一段开始还有多少毫秒（页开着跨过一段时换一句）。 */
export const msUntilNextGreetingSlot = (at: Date): number => {
    const hour = at.getHours();
    const nextStart = SLOT_STARTS.find(([start]) => start > hour)?.[0] ?? 24;
    const next = new Date(at);
    next.setHours(nextStart, 0, 0, 0);
    return Math.max(1000, next.getTime() - at.getTime());
};

/** 长版每一段有几句（文案键 v1 … v6）。 */
export const GREETING_VARIANTS = 6;
/** 短版每一段有几句（文案键 v1 … v4）。 */
export const GREETING_SHORT_VARIANTS = 4;

/** 随机挑一句：返回文案键的后缀（v1 … v<count>）。random 给测试换成固定的数。 */
export const pickGreetingVariant = (random: () => number = Math.random, count = GREETING_VARIANTS): string => (
    `v${Math.min(count, Math.floor(random() * count) + 1)}`
);
