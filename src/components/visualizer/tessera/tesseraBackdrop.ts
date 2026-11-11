import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import type { VisualizerSharedProps } from '../definition';
import type { VisualizerTuningBundle } from '../tuningRegistry';
import tesseraTuning from './tuning';
import type { TesseraBackground } from './types';

// src/components/visualizer/tessera/tesseraBackdrop.ts
// 方块字的背景三选一怎么落到画面上：「全实色」整个画面铺主题背景色，共用背景不画；「中框实色」共用背景照画，
// 只有中间的棋盘里铺背景色；「全透明」共用背景照画，棋盘里也透出它。entry.tsx 和 VisualizerTessera 用同一份判断。

/** 画布要自己铺多大的背景色。播放页透明（透出桌面）时「全实色」不铺满，退成只铺棋盘：页面透明是用户另外选的。 */
export type TesseraFill = 'all' | 'board' | 'none';

/** 播放页是不是透明的：样式小图（LyricStylePicture）也把背景标成透明来表示「不画背景」，那不算。 */
const pageSeesThrough = (background: VisualizerBackgroundConfig | undefined, isPreview: boolean) => (
    !isPreview && Boolean(background?.transparent)
);

export const tesseraFill = (choice: TesseraBackground, background: VisualizerBackgroundConfig | undefined, isPreview: boolean): TesseraFill => {
    if (choice === 'clear') return 'none';
    if (choice === 'frame' || pageSeesThrough(background, isPreview)) return 'board';
    return 'all';
};

/** entry.tsx 的 background：「全实色」时共用背景标成透明（背景层什么都不画），其余照常。 */
export const tesseraBackgroundConfig = (props: VisualizerSharedProps): VisualizerBackgroundConfig | undefined => (
    tesseraTuning.read(props.visualizerTunings).background === 'solid'
        ? { ...props.background, transparent: true }
        : props.background
);

/** entry.tsx 的 showsBackground：只有「全实色」看不见共用背景。 */
export const tesseraShowsBackground = (tunings: VisualizerTuningBundle) => (
    tesseraTuning.read(tunings).background !== 'solid'
);
