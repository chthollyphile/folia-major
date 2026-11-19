import type { LyricRenderOverride } from '../../../types';
import { DEFAULT_LYRIC_RENDER_OVERRIDE } from '../../../utils/lyricRenderQuality';

// src/components/visualizer/metaphor/types.ts
// 隐喻（Metaphor）的 tuning：类型、默认值、每个数值项的范围。

export interface MetaphorTuning {
    /** 分辨率（全屏着色器没有 MSAA，只看倍数）。 */
    render: LyricRenderOverride;
    /** 镜头切换的快慢，倍数：越大一句里切得越多。 */
    cutPace: number;
    /** 运镜幅度（推拉、手持晃动、倾斜角度），0 是每个镜头都锁死。 */
    cameraMotion: number;
    /** 流体：墨的边缘被流场推着晃的幅度。 */
    flow: number;
    /** 融球和装饰图形的多少。 */
    blobs: number;
    /** 半调网点的大小，倍数。 */
    halftone: number;
    /** 砂纸颗粒的强度。 */
    grain: number;
    /** 反相镜头：一部分镜头纸和墨对调。 */
    negative: boolean;
    /** 画面反相：纸和墨整个对调，等于把对主题明暗的反应翻过来（深色主题出白纸黑墨，浅色主题出黑纸白墨）。 */
    flip: boolean;
    /** 关键字着色：主题的关键字（wordColors）各用自己的颜色；关着（默认）就和别的字一样是墨色。 */
    keywordColors: boolean;
    /** 句与句之间的转场（漫墨、冲镜）；关掉就全是硬切。 */
    transitions: boolean;
}

export type MetaphorNumberKey = { [K in keyof MetaphorTuning]: MetaphorTuning[K] extends number ? K : never }[keyof MetaphorTuning];
export type MetaphorBooleanKey = { [K in keyof MetaphorTuning]: MetaphorTuning[K] extends boolean ? K : never }[keyof MetaphorTuning];

export const METAPHOR_LIMITS: Record<MetaphorNumberKey, { min: number; max: number }> = {
    cutPace: { min: 0.4, max: 2 },
    cameraMotion: { min: 0, max: 2 },
    flow: { min: 0, max: 2 },
    blobs: { min: 0, max: 2 },
    halftone: { min: 0.5, max: 2.5 },
    grain: { min: 0, max: 2 },
};

export const METAPHOR_BOOLEAN_KEYS: readonly MetaphorBooleanKey[] = ['negative', 'flip', 'keywordColors', 'transitions'];

export const DEFAULT_METAPHOR_TUNING: MetaphorTuning = {
    render: DEFAULT_LYRIC_RENDER_OVERRIDE,
    cutPace: 1,
    cameraMotion: 1,
    flow: 1,
    blobs: 1,
    halftone: 1,
    grain: 1,
    negative: true,
    flip: false,
    keywordColors: false,
    transitions: true,
};
