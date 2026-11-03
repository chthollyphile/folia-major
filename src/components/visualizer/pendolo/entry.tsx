import React from 'react';
import { Disc3 } from 'lucide-react';
import type { PendoloTuning } from '../../../types';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import PendoloSettingsPanel from './PendoloSettingsPanel';

const VisualizerPendolo = React.lazy(() => import('./VisualizerPendolo'));

// src/components/visualizer/pendolo/entry.tsx

const GEAR_DECOR_MODES: PendoloTuning['showGearDecor'][] = ['none', 'subtle', 'full'];
const GEAR_DECOR_LABEL_KEYS: Record<PendoloTuning['showGearDecor'], string> = {
    none: 'options.decorNone',
    subtle: 'options.decorSubtle',
    full: 'options.decorFull',
};

export default defineVisualizer({
    mode: 'pendolo',
    order: 100,
    labelKey: 'ui.visualizerPendolo',
    labelFallback: 'Pendolo',
    previewSeed: 'pendolo',
    previewStartOffset: 0,
    // 时计：左侧齿轮，右侧歌词
    glyph: (
        <>
            <circle cx="8" cy="12" r="5" />
            <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
            <path d="M16 10h5" opacity="0.55" />
            <path d="M16 14h4" opacity="0.55" />
        </>
    ),
    command: {
        title: 'Visualizer: Pendolo',
        description: 'Switch to Pendolo visualizer',
        keywords: ['pendolo', '擒纵', '摆轮', 'pd', '切换到可视化：擒纵', '切换到可视化擒纵'],
    },
    seeksOnLineClick: true,
    // 智能动感模式: the dial plays the track's drum hits once its drum stem is read (htdemucs_gpu,
    // usePendoloBeatFx.ts). The clockwork stepping on beat_this' beats (PendoloClockworkCanvas.tsx)
    // is retired, its code kept: the user set it aside on 2026-10-17.
    beatEffects: [
        {
            id: BEAT_EFFECT_IDS.pendoloDrumhead,
            nameKey: 'options.beatEffect_pendoloDrumhead',
            descKey: 'options.beatEffect_pendoloDrumheadDesc',
            source: 'drums',
        },
        {
            id: BEAT_EFFECT_IDS.pendoloGearBeats,
            nameKey: 'options.beatEffect_pendoloGearBeats',
            descKey: 'options.beatEffect_pendoloGearBeatsDesc',
            source: 'beats',
            retired: true,
        },
    ],
    // The song-scoped seed resets Pendolo's lyric rail state before the next track starts.
    render: props => <VisualizerPendolo key={props.seed} {...props} />,
    renderSettingsPanel: props => <PendoloSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<PendoloTuning>) => {
        const showCover = tuning.showCoverOnWatchFace ?? false;
        const gearLabel = t(GEAR_DECOR_LABEL_KEYS[tuning.showGearDecor]);
        return (
            <>
                <QuickControlToggle
                    active={showCover}
                    label={t('options.pendoloShowCoverOnWatchFace')}
                    onToggle={() => onTuningChange({ showCoverOnWatchFace: !showCover })}
                >
                    <Disc3 size={14} />
                </QuickControlToggle>
                <QuickControlChip
                    label={gearLabel}
                    title={`${t('options.pendoloShowGearDecor')}: ${gearLabel}`}
                    onClick={() => onTuningChange({ showGearDecor: cycleValue(GEAR_DECOR_MODES, tuning.showGearDecor) })}
                />
            </>
        );
    },
});
