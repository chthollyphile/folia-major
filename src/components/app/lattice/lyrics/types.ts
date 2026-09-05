import type { VisualizerSharedProps } from '../../../visualizer/definition';

// src/components/app/lattice/lyrics/types.ts
export type LatticeLyricSource = Pick<VisualizerSharedProps,
    'currentTime' | 'currentLineIndex' | 'lines' | 'theme' | 'subtitleTheme' |
    'showSubtitleTranslation' | 'hideTranslationSubtitle' | 'subtitleContentMode' |
    'paused' | 'staticMode'>;

export type LatticeLyricInput = LatticeLyricSource & {
    songKey: string;
    keywordColoringEnabled: boolean;
    reducedMotion: boolean;
    fontsEpoch: number;
};

export interface LatticeLyricRuntime {
    update(input: LatticeLyricInput): void;
    resize(width: number, height: number): void;
    setVisible(visible: boolean): void;
    destroy(): void;
}
