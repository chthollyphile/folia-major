import type {
    CadenzaTuning, CappellaTuning, CladdaghTuning, ClassicTuning, DioramaTuning, FumeTuning,
    LatentBackgroundTuning, LumiereTuning, MonetBackgroundTuning, MonetTuning, NomandBackgroundTuning,
    PartitaTuning, PendoloTuning, SonnetTuning, SoraBackgroundTuning, TemperaTuning, TiltTuning, VisualizerMode,
} from '../types';

// src/types/randomVisualStyle.ts
// Inputs and tuning values for the persisted manual random-style action.

export type RandomVisualStyleScope = 'lyrics' | 'all';

export interface RandomVisualStyleOptions {
    scope?: RandomVisualStyleScope;
    random?: () => number;
    preferredMode?: VisualizerMode;
}

export interface RandomVisualStyleTunings {
    classicTuning: ClassicTuning;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    claddaghTuning: CladdaghTuning;
    cappellaTuning: CappellaTuning;
    tiltTuning: TiltTuning;
    dioramaTuning: DioramaTuning;
    monetTuning: MonetTuning;
    pendoloTuning: PendoloTuning;
    sonnetTuning: SonnetTuning;
    temperaTuning: TemperaTuning;
    lumiereTuning: LumiereTuning;
    monetBackgroundTuning: MonetBackgroundTuning;
    nomandBackgroundTuning: NomandBackgroundTuning;
    latentBackgroundTuning: LatentBackgroundTuning;
    soraBackgroundTuning: SoraBackgroundTuning;
}
