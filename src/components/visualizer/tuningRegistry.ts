import type {
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    CladdaghTuning,
    DioramaTuning,
    FumeTuning,
    MonetTuning,
    PartitaTuning,
    PendoloTuning,
    SonnetTuning,
    TiltTuning,
    VisualizerMode,
} from '../../types';
import type { VisualizerSharedProps } from './definition';

// src/components/visualizer/tuningRegistry.ts
// Pure-data registry for transporting heterogeneous visualizer tuning without importing renderers.
export interface VisualizerTuningMap {
    classic: ClassicTuning;
    cadenza: CadenzaTuning;
    partita: PartitaTuning;
    fume: FumeTuning;
    claddagh: CladdaghTuning;
    cappella: CappellaTuning;
    tilt: TiltTuning;
    diorama: DioramaTuning;
    monet: MonetTuning;
    pendolo: PendoloTuning;
    sonnet: SonnetTuning;
}

export type VisualizerTuningMode = keyof VisualizerTuningMap;
export type VisualizerTuningBundle = Partial<VisualizerTuningMap>;

export interface VisualizerTuningAdapter<M extends VisualizerTuningMode = VisualizerTuningMode> {
    mode: M;
    settingsKey: string;
    settingsSetterKey: string;
    apply: (props: VisualizerSharedProps, tuning: VisualizerTuningMap[M]) => VisualizerSharedProps;
}

interface VisualizerTuningModule {
    default: VisualizerTuningAdapter;
}

export function defineVisualizerTuning<M extends VisualizerTuningMode>(adapter: VisualizerTuningAdapter<M>) {
    return adapter;
}

const tuningModules = import.meta.glob<VisualizerTuningModule>('./*/tuning.ts', { eager: true });
const adapters = Object.values(tuningModules).map(module => module.default);
const adaptersByMode = new Map<VisualizerTuningMode, VisualizerTuningAdapter>();

adapters.forEach(adapter => {
    if (adaptersByMode.has(adapter.mode)) {
        throw new Error(`[VisualizerTuningRegistry] Duplicate adapter for "${adapter.mode}"`);
    }
    adaptersByMode.set(adapter.mode, adapter);
});

export const applyVisualizerTuning = (
    mode: VisualizerMode,
    props: VisualizerSharedProps,
    bundle?: VisualizerTuningBundle,
): VisualizerSharedProps => {
    const adapter = adaptersByMode.get(mode as VisualizerTuningMode);
    const tuning = bundle?.[mode as VisualizerTuningMode];
    return adapter && tuning ? adapter.apply(props, tuning as never) : props;
};

export const getVisualizerTuningModes = (): VisualizerTuningMode[] => [...adaptersByMode.keys()];

export const collectVisualizerTunings = (settings: Record<string, unknown>): VisualizerTuningBundle => {
    const bundle: VisualizerTuningBundle = {};
    adapters.forEach(adapter => {
        const value = settings[adapter.settingsKey];
        if (value !== undefined) {
            (bundle as Record<string, unknown>)[adapter.mode] = value;
        }
    });
    return bundle;
};

export const applyVisualizerTuningsToSettings = (
    settings: Record<string, unknown>,
    bundle: VisualizerTuningBundle,
) => {
    adapters.forEach(adapter => {
        const value = bundle[adapter.mode];
        const setter = settings[adapter.settingsSetterKey];
        if (value !== undefined && typeof setter === 'function') {
            setter(value);
        }
    });
};
