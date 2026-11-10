import React from 'react';
import type {
    LatentBackgroundColorSource,
    LatentBackgroundDisplayMode,
    LatentBackgroundTuning,
} from '../../../../types';
import { Group, Reveal, Row, Segmented, type SettingsGroupDef } from '../../../modal/settings/kit';
import { percent, SliderRow, ToggleRow } from '../../panelRows';

// src/components/visualizer/backgrounds/latent/LatentBackgroundSettingsCard.tsx
// Edits Latent layer visibility, shader presets, and the wider audio-driven speed ranges: three
// groups of the settings kit.
const LATENT_GROUP: SettingsGroupDef = { id: 'bg-latent', titleKey: 'options.latentBackgroundSettings' };
const DITHERING_GROUP: SettingsGroupDef = { id: 'bg-latent-dithering', titleKey: 'options.latentDitheringGroup' };
const MESH_GROUP: SettingsGroupDef = { id: 'bg-latent-mesh', titleKey: 'options.latentMeshGroup' };

interface LatentBackgroundSettingsCardProps {
    t: (key: string) => string;
    tuning: LatentBackgroundTuning;
    onTuningChange?: (patch: Partial<LatentBackgroundTuning>) => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const oneDecimal = (value: number) => value.toFixed(1);
const twoDecimals = (value: number) => value.toFixed(2);

const LatentBackgroundSettingsCard: React.FC<LatentBackgroundSettingsCardProps> = ({
    t,
    tuning,
    onTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const drag = { onDragStart: onSliderPointerDown, onDragEnd: onSliderCommit };

    return (
        <>
            <Group def={LATENT_GROUP}>
                <Row label={t('options.latentDisplayMode')}>
                    <Segmented<LatentBackgroundDisplayMode>
                        value={tuning.displayMode}
                        options={[
                            { value: 'dithering', label: t('options.latentDisplayDithering') },
                            { value: 'mesh', label: t('options.latentDisplayMesh') },
                            { value: 'both', label: t('options.latentDisplayBoth') },
                        ]}
                        onChange={displayMode => onTuningChange?.({ displayMode })}
                    />
                </Row>
                <Row label={t('options.latentColorSource')}>
                    <Segmented<LatentBackgroundColorSource>
                        value={tuning.colorSource}
                        options={[
                            { value: 'cover-theme', label: t('options.latentColorSourceCoverTheme') },
                            { value: 'cover-only', label: t('options.latentColorSourceCoverOnly') },
                        ]}
                        onChange={colorSource => onTuningChange?.({ colorSource })}
                    />
                </Row>
                <ToggleRow
                    label={t('options.latentDynamicOnlyInPlayer')}
                    note={t('options.latentDynamicOnlyInPlayerDesc')}
                    checked={tuning.dynamicOnlyInPlayer}
                    onChange={dynamicOnlyInPlayer => onTuningChange?.({ dynamicOnlyInPlayer })}
                />
                <ToggleRow
                    label={t('options.latentEnhancedBeatResponse')}
                    note={t('options.latentEnhancedBeatResponseDesc')}
                    checked={tuning.enhancedBeatResponse}
                    onChange={enhancedBeatResponse => onTuningChange?.({ enhancedBeatResponse })}
                />
                <ToggleRow
                    label={t('options.nomandBackgroundOverlay')}
                    note={t('options.nomandBackgroundOverlayDesc')}
                    checked={tuning.overlayEnabled}
                    onChange={overlayEnabled => onTuningChange?.({ overlayEnabled })}
                />
                <Reveal when={tuning.overlayEnabled}>
                    <SliderRow
                        {...drag}
                        sub
                        label={t('options.nomandBackgroundOverlayOpacity')}
                        value={tuning.overlayOpacity}
                        min={0}
                        max={1}
                        step={0.05}
                        format={percent}
                        onChange={overlayOpacity => onTuningChange?.({ overlayOpacity })}
                    />
                </Reveal>
            </Group>

            <Group def={DITHERING_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.latentBaseSpeed')}
                    value={tuning.ditheringSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    format={oneDecimal}
                    onChange={ditheringSpeed => onTuningChange?.({ ditheringSpeed })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.latentAudioSpeed')}
                    value={tuning.ditheringAudioSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    format={oneDecimal}
                    onChange={ditheringAudioSpeed => onTuningChange?.({ ditheringAudioSpeed })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.latentDitheringSize')}
                    value={tuning.ditheringSize}
                    min={0.5}
                    max={8}
                    step={0.25}
                    format={twoDecimals}
                    onChange={ditheringSize => onTuningChange?.({ ditheringSize })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.latentDitheringOpacity')}
                    value={tuning.ditheringOpacity}
                    min={0}
                    max={1}
                    step={0.05}
                    format={percent}
                    onChange={ditheringOpacity => onTuningChange?.({ ditheringOpacity })}
                />
            </Group>

            <Group def={MESH_GROUP}>
                <SliderRow
                    {...drag}
                    label={t('options.latentBaseSpeed')}
                    value={tuning.meshSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    format={oneDecimal}
                    onChange={meshSpeed => onTuningChange?.({ meshSpeed })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.latentAudioSpeed')}
                    value={tuning.meshAudioSpeed}
                    min={0}
                    max={2}
                    step={0.1}
                    format={oneDecimal}
                    onChange={meshAudioSpeed => onTuningChange?.({ meshAudioSpeed })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.latentMeshDistortion')}
                    value={tuning.meshDistortion}
                    min={0}
                    max={2}
                    step={0.05}
                    format={twoDecimals}
                    onChange={meshDistortion => onTuningChange?.({ meshDistortion })}
                />
                <SliderRow
                    {...drag}
                    label={t('options.latentMeshSwirl')}
                    value={tuning.meshSwirl}
                    min={0}
                    max={1}
                    step={0.05}
                    format={twoDecimals}
                    onChange={meshSwirl => onTuningChange?.({ meshSwirl })}
                />
            </Group>
        </>
    );
};

export default LatentBackgroundSettingsCard;
