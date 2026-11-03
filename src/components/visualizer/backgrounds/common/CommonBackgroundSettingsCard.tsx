import React from 'react';
import { Group, Reveal, type SettingsGroupDef } from '../../../modal/settings/kit';
import { percent, SliderRow, ToggleRow } from '../../panelRows';
import type { VisualizerBackgroundSettingsProps } from '../definition';

// src/components/visualizer/backgrounds/common/CommonBackgroundSettingsCard.tsx
// Configures the built-in cover-color and geometric background layers: two groups of the settings kit.
const SHELL_GROUP: SettingsGroupDef = { id: 'bg-common', titleKey: 'options.visualizerBackgroundModeCommon' };
const COVER_GROUP: SettingsGroupDef = { id: 'bg-common-cover', titleKey: 'options.previewCoverBackgroundSettings' };

const CommonBackgroundSettingsCard: React.FC<VisualizerBackgroundSettingsProps> = ({
    config,
    actions,
    t,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const common = config?.common;
    const commonActions = actions?.common;
    const useCoverColorBg = common?.useCoverColorBg ?? false;

    return (
        <>
            <Group def={SHELL_GROUP} bare>
                <ToggleRow
                    label={t('options.disableVisualizerVignette')}
                    note={t('options.disableVisualizerVignetteDesc')}
                    checked={common?.disableVignette ?? false}
                    onChange={checked => commonActions?.onDisableVignetteChange?.(checked)}
                />
                <ToggleRow
                    label={t('options.disableVisualizerGeometricBackground')}
                    note={t('options.disableVisualizerGeometricBackgroundDesc')}
                    checked={common?.disableGeometricBackground ?? false}
                    onChange={checked => commonActions?.onDisableGeometricChange?.(checked)}
                />
            </Group>

            <Group def={COVER_GROUP}>
                <ToggleRow
                    label={t('theme.addCoverColor')}
                    note={t('options.coverColorBackgroundDesc')}
                    checked={useCoverColorBg}
                    onChange={checked => commonActions?.onCoverColorChange?.(checked)}
                />
                {/* The layer over the cover colours is only drawn thinner while they are on. */}
                <Reveal when={useCoverColorBg}>
                    <SliderRow
                        sub
                        label={t('options.previewCoverBackgroundOpacity')}
                        value={common?.opacity ?? 0.75}
                        min={0}
                        max={1}
                        step={0.05}
                        format={percent}
                        onChange={opacity => commonActions?.onOpacityChange?.(opacity)}
                        onDragStart={onSliderPointerDown}
                        onDragEnd={onSliderCommit}
                    />
                </Reveal>
            </Group>
        </>
    );
};

export default CommonBackgroundSettingsCard;
