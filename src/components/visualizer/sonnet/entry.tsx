import React from 'react';
import { DEFAULT_SONNET_TUNING } from '../../../types';
import { defineVisualizer } from '../definition';
import SonnetSettingsPanel from './SonnetSettingsPanel';

const VisualizerSonnet = React.lazy(() => import('./VisualizerSonnet'));

// Every sonnet tunable is a multiplier: 1 leaves the builtin look unchanged.
const SONNET_TUNABLE = { min: 0, max: 3, identity: 1 } as const;

// src/components/visualizer/sonnet/entry.tsx
// Registers 商籁, the deterministic Japanese MG lyric-PV director.
export default defineVisualizer({
    mode: 'sonnet',
    order: 10,
    labelKey: 'ui.visualizerSonnet',
    labelFallback: '商籁',
    previewSeed: 'sonnet',
    previewStartOffset: 0,
    tuningKind: 'sonnet',
    usesWordSegmentation: true,
    // Folium tunables read by createSonnetPixiRuntime's mod(key). Names are public API.
    foliumTunables: {
        cameraScale: SONNET_TUNABLE,
        motionScale: SONNET_TUNABLE,
        breathScale: SONNET_TUNABLE,
        parallaxScale: SONNET_TUNABLE,
        mgSwimScale: SONNET_TUNABLE,
        driftScale: SONNET_TUNABLE,
        caScale: SONNET_TUNABLE,
        ghostScale: SONNET_TUNABLE,
        transitionMotionScale: SONNET_TUNABLE,
        transitionBlurScale: SONNET_TUNABLE,
        transitionGlitchScale: SONNET_TUNABLE,
    },
    // Deliberately unkeyed on the seed: the runtime hands a track change over in place
    // (see songHandover.ts / pixiRuntimeHost.ts). Remounting here would throw the WebGL
    // context away mid-transition and leave the frame empty for the whole rebuild.
    render: props => <VisualizerSonnet {...props} />,
    renderSettingsPanel: props => <SonnetSettingsPanel {...props} />,
    resetSettings: ({ resetSonnetTuning, setDraftSonnetTuning }) => {
        setDraftSonnetTuning?.(DEFAULT_SONNET_TUNING);
        resetSonnetTuning?.();
    },
});
