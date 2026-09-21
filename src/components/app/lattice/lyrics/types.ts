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
    attach(host: HTMLElement): void;
    setErrorHandler(handler: (error: unknown) => void): void;
    update(input: LatticeLyricInput): void;
    /** CSS-pixel box of the host and the screen density it is shown at; a change of either rebuilds the scene. */
    resize(width: number, height: number, devicePixelRatio: number): void;
    setVisible(visible: boolean): void;
    destroy(): void;
}
