// src/components/visualizer/nebbia/nebbiaConstants.ts
// 原型（feat/fog-write-prototype 分支 dev/prototypes/fog-write/index.html）里能调、接入后写死的参数（P），和几个共用的小工具。
// 值都是原型里调好的默认值；要开放成设置时挪进 types.ts 的 NebbiaTuning。

export const NEBBIA_FIXED = {
    /** 擦痕边缘毛糙。 */
    edge: 0.6,
    /** 擦痕边上凝出的小水珠。 */
    beads: 0.35,
    /** 偶尔往下淌的水珠。 */
    drip: 0.25,
    /** 水珠折射、高光。 */
    refract: 1,
    glint: 1,
    /** 雾上的凝结水珠密度。 */
    fieldDrops: 0.5,
    /** 风把下淌的水珠往后推（0 = 竖直往下）。 */
    wind: 0,
    /** 收笔处堆起的大水珠；字号小于 endBeadMin 像素的不留。 */
    endBead: 1,
    endBeadMin: 48,
    /** 字被雾吞掉后水珠多挂几秒。 */
    beadHold: 4,
    /** 让位时哈气盖掉旧句子：白气从中线鼓开到整片的秒数、新句子唱完后再留几秒、散掉的秒数、浓度（nebbiaBreath.ts）。 */
    breathSpread: 0.3,
    breathHold: 1,
    breathFade: 8,
    breathThick: 0.7,
    /** 颠簸频率、颠簸把大水珠震落的概率。 */
    bumpRate: 1,
    bumpFall: 0.5,
} as const;

/** 擦痕遮罩相对 CSS 像素的分辨率。 */
export const MASK_SCALE = 0.5;
/** 雾的预渲染相对画布的缩小倍数。 */
export const FOG_DIV = 4;

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const smooth = (t: number) => t * t * (3 - 2 * t);
