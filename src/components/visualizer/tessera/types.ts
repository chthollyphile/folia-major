// src/components/visualizer/tessera/types.ts
// 方块字的 tuning：现在只有背景怎么铺。

/** 背景：整个画面铺主题背景色、只有中间的棋盘里铺、哪儿都不铺（透出共用背景）。 */
export const TESSERA_BACKGROUNDS = ['solid', 'frame', 'clear'] as const;
export type TesseraBackground = (typeof TESSERA_BACKGROUNDS)[number];

export interface TesseraTuning {
    background: TesseraBackground;
}

export const DEFAULT_TESSERA_TUNING: TesseraTuning = {
    background: 'frame',
};

/** 存着的或改动的值 → 完整、合法的 tuning：不认识的背景退回 base 的。 */
export const normalizeTesseraTuning = (value: unknown, base: TesseraTuning = DEFAULT_TESSERA_TUNING): TesseraTuning => {
    const stored = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof TesseraTuning, unknown>>;
    const background = TESSERA_BACKGROUNDS.find(option => option === stored.background) ?? base.background;
    return { background };
};
