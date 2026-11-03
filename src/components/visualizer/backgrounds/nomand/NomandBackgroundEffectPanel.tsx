import type { NomandBackgroundTuning } from '../../../../types';

// src/components/visualizer/backgrounds/nomand/NomandBackgroundEffectPanel.tsx
// The contract shared by each Nomand effect variant: it returns rows of the settings kit, which
// the effect group puts under the choice of effect.

export interface NomandBackgroundEffectPanelProps {
    t: (key: string) => string;
    tuning: NomandBackgroundTuning;
    onTuningChange?: (patch: Partial<NomandBackgroundTuning>) => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

export const twoDecimals = (value: number) => value.toFixed(2);
