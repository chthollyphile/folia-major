import React from 'react';
import { Scan, WandSparkles } from 'lucide-react';
import type { TemperaColorMode, TemperaTuning } from '../../../types';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import TemperaSettingsPanel from './TemperaSettingsPanel';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';

const VisualizerTempera = React.lazy(() => import('./VisualizerTempera'));

// src/components/visualizer/tempera/entry.tsx
// Registers 凝彩, the deterministic block-composition lyric-PV director.
const COLOR_MODES: TemperaColorMode[] = ['duo', 'mono', 'gradient'];
const COLOR_MODE_LABEL_KEYS: Record<TemperaColorMode, string> = {
    duo: 'options.temperaColorModeDuo',
    mono: 'options.temperaColorModeMono',
    gradient: 'options.temperaColorModeGradient',
};

export default defineVisualizer({
    mode: 'tempera',
    order: 20,
    labelKey: 'ui.visualizerTempera',
    labelFallback: 'Tempera',
    previewSeed: 'tempera',
    previewStartOffset: 0,
    // 凝彩：上下色块分割与分割线
    glyph: (
        <>
            <rect x="4" y="4" width="16" height="6.5" rx="1" />
            <rect x="4" y="13.5" width="16" height="6.5" rx="1" opacity="0.45" />
            <path d="M4 12h16" opacity="0.7" />
        </>
    ),
    command: {
        title: 'Visualizer: Tempera',
        description: 'Switch to Tempera visualizer',
        keywords: ['tempera', '凝彩', 'dancai', 'dc', '色块 pv', 'block pv'],
    },
    usesWordSegmentation: true,
    // 智能动感模式「墨染奥行」: the paper rests under a faint grey stain and an ink blot in its palette's accent spreads
    // over it on each kick and snare of the track's drum hits (htdemucs_gpu; temperaInkFlash.ts). The same switch
    // brings in the depth: blurred layers with parallax, a per-shot camera pan and size-as-depth glyphs (temperaDepth.ts).
    beatEffects: [{
        id: BEAT_EFFECT_IDS.temperaInkFlash,
        nameKey: 'options.beatEffect_temperaInkFlash',
        descKey: 'options.beatEffect_temperaInkFlashDesc',
        source: 'drums',
    }],
    // Deliberately unkeyed on the seed: the runtime hands a track change over in place
    // (see songHandover.ts / pixiRuntimeHost.ts). Remounting here would throw the WebGL
    // context away mid-transition and leave the frame empty for the whole rebuild.
    render: props => <VisualizerTempera {...props} />,
    renderSettingsPanel: props => <TemperaSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<TemperaTuning>) => {
        const colorLabel = t(COLOR_MODE_LABEL_KEYS[tuning.colorMode]);
        return (
            <>
                <QuickControlChip
                    label={colorLabel}
                    title={`${t('options.temperaColorMode')}: ${colorLabel}`}
                    onClick={() => onTuningChange({ colorMode: cycleValue(COLOR_MODES, tuning.colorMode) })}
                />
                <QuickControlToggle
                    active={tuning.postProcessEnabled}
                    label={t('options.temperaPostProcessEnabled')}
                    onToggle={() => onTuningChange({ postProcessEnabled: !tuning.postProcessEnabled })}
                >
                    <WandSparkles size={14} />
                </QuickControlToggle>
                <QuickControlToggle
                    active={tuning.showCornerMarks}
                    label={t('options.temperaShowCornerMarks')}
                    onToggle={() => onTuningChange({ showCornerMarks: !tuning.showCornerMarks })}
                >
                    <Scan size={14} />
                </QuickControlToggle>
            </>
        );
    },
    ownFontSizeNoticeKey: 'options.temperaFontSizeAutoNotice',
});
