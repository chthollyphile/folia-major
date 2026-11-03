import React from 'react';
import { Smile } from 'lucide-react';
import type { CappellaAvatarSource, CappellaTuning } from '../../../types';
import { useVisualizerAssetStore } from '../../../stores/useVisualizerAssetStore';
import { cycleValue, QuickControlChip, QuickControlToggle } from '../../shared/QuickControlChip';
import { defineVisualizer, type VisualizerQuickControlsProps } from '../definition';
import { CappellaSettingsPanel } from '../settingsPanels';

const VisualizerCappella = React.lazy(() => import('./VisualizerCappella'));

// src/components/visualizer/cappella/entry.tsx
// Registers the Cappella chat visualizer mode.
const AVATAR_SOURCES: CappellaAvatarSource[] = ['cover', 'builtin', 'color', 'custom'];
const AVATAR_SOURCE_LABEL_KEYS: Record<CappellaAvatarSource, string> = {
    cover: 'options.cappellaAvatarSourceCover',
    builtin: 'options.cappellaAvatarSourceBuiltin',
    color: 'options.cappellaAvatarSourceColor',
    custom: 'options.cappellaAvatarSourceCustom',
};

export default defineVisualizer({
    mode: 'cappella',
    order: 110,
    labelKey: 'ui.visualizerCappella',
    labelFallback: 'Cappella',
    previewSeed: 'cappella',
    previewStartOffset: 0,
    // 群唱：左右交替的对话气泡
    glyph: (
        <>
            <rect x="3" y="5" width="12" height="6" rx="3" />
            <rect x="9" y="13.5" width="12" height="6" rx="3" opacity="0.5" />
        </>
    ),
    command: {
        title: 'Visualizer: Cappella',
        description: 'Switch to cappella visualizer',
        keywords: ['cappella', '群唱'],
    },
    render: props => <VisualizerCappella {...props} />,
    renderSettingsPanel: props => <CappellaSettingsPanel {...props} />,
    renderQuickControls: ({ tuning, onTuningChange, t }: VisualizerQuickControlsProps<CappellaTuning>) => {
        const avatarLabel = t(AVATAR_SOURCE_LABEL_KEYS[tuning.avatarSource]);
        const cycleAvatarSource = () => {
            const hasCustom = useVisualizerAssetStore.getState().cappellaCustomAvatarImages.length > 0;
            const sources = hasCustom ? AVATAR_SOURCES : AVATAR_SOURCES.filter(source => source !== 'custom');
            onTuningChange({ avatarSource: cycleValue(sources, tuning.avatarSource) });
        };
        return (
            <>
                <QuickControlChip
                    label={avatarLabel}
                    title={`${t('options.cappellaAvatarSource')}: ${avatarLabel}`}
                    onClick={cycleAvatarSource}
                />
                <QuickControlToggle
                    active={tuning.showEmoMessages}
                    label={t('options.cappellaShowEmoMessages')}
                    onToggle={() => onTuningChange({ showEmoMessages: !tuning.showEmoMessages })}
                >
                    <Smile size={14} />
                </QuickControlToggle>
            </>
        );
    },
});
