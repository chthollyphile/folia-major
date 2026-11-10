import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/panel/audioEqualizer.geometry.ts
// audioEqualizer.surface.tsx 画的那张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/** 十根推子里每一根占 bands 的几成宽。十根等宽，中间没有缝。 */
const BAND_WIDTH = 0.1;

/**
 * 音频效果器窗口（十段均衡加效果链），坐标系是那个窗口。
 *
 * 从上到下：标题和右上角的总开关；一排预设（六个内置、两个自定义槽，右端复位）；
 * 「频段增益」一张卡，里面十根推子；「效果链」一张卡，里面三列三排九项。
 *
 * 推子那一排要能指着其中一根讲：拖任何一根都会把当前预设**静默**换成自定义槽
 * 并把值写进去，而这件事只有对着一根推子和预设排同时说才成立。
 */
export const AUDIO_EQUALIZER_GEOMETRY = {
    title: { left: 0.027, top: 0.03, width: 0.3, height: 0.06 },
    /** 右上角：一行写着开没开的字，加一颗开关。它右边是关闭窗口的叉。 */
    enable: { right: 0.068, top: 0.024, width: 0.17, height: 0.042 },
    close: { right: 0.024, top: 0.03, width: 0.022, square: true },
    /** 六个内置预设。 */
    presets: { left: 0.027, top: 0.105, width: 0.422, height: 0.04 },
    /** 同一排里紧跟着的两个自定义槽，和排尾那颗复位。 */
    customSlots: { left: 0.456, top: 0.105, width: 0.175, height: 0.04 },
    reset: { right: 0.03, top: 0.105, width: 0.03, square: true },
    /** 「频段增益」那张卡，和卡里十根推子占的那一块。 */
    bandsCard: { left: 0.026, right: 0.026, top: 0.22, height: 0.43 },
    bands: { left: 0.1045, top: 0.235, width: 0.818, height: 0.39 },
    /** 相对 bands：第四根推子，教程拖的就是它。 */
    bandFader: { left: BAND_WIDTH * 3, top: 0, width: BAND_WIDTH, height: 1 },
    /** 「效果链」那张卡。 */
    effects: { left: 0.026, right: 0.026, top: 0.72, bottom: 0.028 },
    /** 相对 effects：会加噪的那两项（比特降质、黑胶噪声）名字旁边的小徽章。教程指的是第一枚。 */
    noiseBadge: { left: 0.092, top: 0.43, width: 0.04, height: 0.085 },
    noiseBadgeSecond: { left: 0.754, top: 0.43, width: 0.04, height: 0.085 },
} satisfies Record<string, PonderRelativeRect>;
