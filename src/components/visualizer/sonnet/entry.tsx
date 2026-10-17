import React from 'react';
import { defineVisualizer } from '../definition';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
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
    // 商籁：海报式边框与角标
    glyph: (
        <>
            <path d="M4 7V4.5h2.5M17.5 4.5H20V7M20 17v2.5h-2.5M6.5 19.5H4V17" />
            <path d="M8.5 12h7" opacity="0.6" />
        </>
    ),
    command: {
        title: 'Visualizer: Sonnet',
        description: 'Switch to Sonnet visualizer',
        keywords: ['sonnet', '商籁', '文字 pv', 'mg pv', 'vocaloid'],
    },
    usesWordSegmentation: true,
    // 智能动感模式: beat_this' beats drive the camera, tear and glow (sonnetBeatFx.ts).
    beatEffects: [{
        id: BEAT_EFFECT_IDS.sonnetLensTear,
        nameKey: 'options.beatEffect_sonnetLensTear',
        descKey: 'options.beatEffect_sonnetLensTearDesc',
        source: 'beats',
    }],
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
    ownFontSizeNoticeKey: 'options.sonnetFontSizeAutoNotice',
});
