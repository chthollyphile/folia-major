import React from 'react';
import { defineVisualizer } from '../definition';
import tuning from './tuning';

// Registry-only bridge: pack rendering and authoring live together in src/stylePacks.
const Visualizer = React.lazy(() => import('../../../stylePacks/StylePackVisualizer'));
const Manager = React.lazy(() => import('../../../stylePacks/StylePackManager'));
export default defineVisualizer({
    mode: 'stylePack', order: 180, labelKey: 'stylePacks.title', labelFallback: 'Style packs',
    previewSeed: 'stylePack', previewStartOffset: 0, background: false,
    command: { title: 'Visualizer: Style pack', description: 'Use the selected style pack', keywords: ['style pack', '风格包', '皮肤'] },
    render: props => <Visualizer {...props} pack={tuning.read(props.visualizerTunings).pack} />,
    renderSettingsPanel: props => <React.Suspense fallback={null}><Manager pack={props.tuning.pack} onApply={pack => props.onTuningChange({ pack })} /></React.Suspense>,
});
