// Copyright (c) 2026 chthollyphile
import React from 'react';
import { Frame, Sparkles } from 'lucide-react';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import { QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import HanabiSettingsPanel from './HanabiSettingsPanel';
import hanabiTuning from './tuning';
import type { HanabiTuning } from './types';

const VisualizerHanabi = React.lazy(() => import('./VisualizerHanabi'));

// src/components/visualizer/hanabi/entry.tsx
// Registers 花火, the Japanese lyric-PV director: lyrics pop in on bright colour blocks, fireworks and MG
// stickers bloom along the words, and the whole world keeps rising shot after shot like a fireworks show.
export default defineVisualizer({
    mode: 'hanabi',
    order: 26,
    labelKey: 'ui.visualizerHanabi',
    labelFallback: '花火',
    previewSeed: 'hanabi',
    previewStartOffset: 0,
    // 花火：一道升空尾迹，顶上开一朵花
    glyph: (
        <>
            <path d="M12 21v-8" opacity="0.5" />
            <path d="M12 9V4M12 9l3.5-3.5M12 9l-3.5-3.5M12 9h5M12 9H7M12 9l3.5 3.5M12 9l-3.5 3.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Hanabi',
        description: 'Switch to Hanabi visualizer',
        keywords: ['hanabi', '花火', '烟花', 'fireworks', 'lyric pv', 'anime pv'],
    },
    // 智能动感模式: beat_this' beat list schedules shells that burst on the beats, and the beat envelopes
    // punch the whole scene (hanabiBeatFx.ts).
    beatEffects: [
        {
            id: BEAT_EFFECT_IDS.hanabiBeatBursts,
            nameKey: 'options.beatEffect_hanabiBeatBursts',
            descKey: 'options.beatEffect_hanabiBeatBurstsDesc',
            source: 'beats',
        },
        {
            id: BEAT_EFFECT_IDS.hanabiBeatPulse,
            nameKey: 'options.beatEffect_hanabiBeatPulse',
            descKey: 'options.beatEffect_hanabiBeatPulseDesc',
            source: 'beats',
        },
    ],
    // Deliberately unkeyed on the seed, like lumiere: the runtime hands a track change over in
    // place (songHandover.ts / pixiRuntimeHost.ts) instead of throwing the WebGL context away.
    render: props => <VisualizerHanabi {...props} hanabiTuning={hanabiTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => <HanabiSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<HanabiTuning>) => (
        <>
            <QuickControlToggle
                active={tuning.overlayFrame}
                label={t('options.hanabiOverlayFrame')}
                onToggle={() => onTuningChange({ overlayFrame: !tuning.overlayFrame })}
            >
                <Frame size={14} />
            </QuickControlToggle>
            <QuickControlToggle
                active={tuning.collage > 0}
                label={t('options.hanabiCollage')}
                onToggle={() => onTuningChange({ collage: tuning.collage > 0 ? 0 : 1 })}
            >
                <Sparkles size={14} />
            </QuickControlToggle>
        </>
    ),
    ownFontSizeNoticeKey: 'options.hanabiFontSizeAutoNotice',
});
