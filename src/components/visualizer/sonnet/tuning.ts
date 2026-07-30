import { defineVisualizerTuning } from '../tuningRegistry';

// src/components/visualizer/sonnet/tuning.ts
// Injects Sonnet's strongly typed tuning at the renderer boundary.
export default defineVisualizerTuning({
    mode: 'sonnet',
    settingsKey: 'sonnetTuning',
    settingsSetterKey: 'handleSetSonnetTuning',
    apply: (props, tuning) => ({ ...props, sonnetTuning: tuning }),
});
