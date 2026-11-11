import React from 'react';
import { cycleValue, QuickControlChip } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { tesseraBackgroundConfig, tesseraShowsBackground } from './tesseraBackdrop';
import TesseraSettingsPanel, { TESSERA_BACKGROUND_LABEL_KEYS } from './TesseraSettingsPanel';
import tesseraTuning from './tuning';
import { TESSERA_BACKGROUNDS, type TesseraTuning } from './types';

const VisualizerTessera = React.lazy(() => import('./VisualizerTessera'));

// src/components/visualizer/tessera/entry.tsx
// Registers 方块字 (Tessera): the lyrics fall as words, segmented into blocks, into a glowing frame in the middle
// of the screen, interlock into four-cell shapes (a word may carry part of the next line or a blank block along), and
// each row fills exactly as its line is sung out, then flashes and clears.
export default defineVisualizer({
    mode: 'tessera',
    order: 28,
    labelKey: 'ui.visualizerTessera',
    labelFallback: '方块字',
    previewSeed: 'tessera',
    previewStartOffset: 0,
    // 方块字：一个框，底下一行方块，上面一块 T 形正在落下
    glyph: (
        <>
            <rect x="4" y="3.5" width="16" height="17" />
            <path d="M7 17h10" />
            <path d="M9.5 8.5h5M12 8.5v3" opacity="0.6" />
        </>
    ),
    command: {
        title: 'Visualizer: Tessera',
        description: 'Switch to the Tessera falling-block lyrics',
        keywords: ['tessera', 'falling blocks', 'blocks', 'line clear', 'puzzle', '方块字', '方块', '下落', '消行', '拼图'],
    },
    // 「全实色」时自己铺满背景色，共用背景不画；其余照常画（tesseraBackdrop.ts）。
    background: tesseraBackgroundConfig,
    showsBackground: tesseraShowsBackground,
    usesWordSegmentation: true,
    render: props => <VisualizerTessera {...props} tesseraTuning={tesseraTuning.read(props.visualizerTunings)} />,
    renderSettingsPanel: props => <TesseraSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<TesseraTuning>) => {
        const label = t(TESSERA_BACKGROUND_LABEL_KEYS[tuning.background]);
        return (
            <QuickControlChip
                label={label}
                title={`${t('options.tesseraBackground')}: ${label}`}
                onClick={() => onTuningChange({ background: cycleValue(TESSERA_BACKGROUNDS, tuning.background) })}
            />
        );
    },
    ownFontSizeNoticeKey: 'options.tesseraFontSizeAutoNotice',
});
