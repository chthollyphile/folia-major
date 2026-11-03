import React from 'react';
import {
    DIORAMA_PARTICLE_DENSITY_MAX,
    DIORAMA_PARTICLE_DENSITY_MIN,
    DIORAMA_PARTICLE_DENSITY_STEP,
    DIORAMA_PARTICLE_GLOW_INTENSITY_MAX,
    DIORAMA_PARTICLE_GLOW_INTENSITY_MIN,
    DIORAMA_PARTICLE_GLOW_INTENSITY_STEP,
    DIORAMA_PARTICLE_SIZE_MAX,
    DIORAMA_PARTICLE_SIZE_MIN,
    DIORAMA_PARTICLE_SIZE_STEP,
} from '../../../types';
import { Reveal, Row, Toggle } from '../../modal/settings/kit';
import { percent, SliderRow, times } from '../panelRows';

// src/components/visualizer/diorama/DioramaParticleAppearanceSettings.tsx
// Density, whole-cluster scale and one-aura-per-cloud rows inside the geometry group.
interface DioramaParticleAppearanceSettingsProps {
    t: (key: string) => string;
    enabled: boolean;
    density: number;
    onDensityChange: (next: number) => void;
    particleScale: number;
    onParticleScaleChange: (next: number) => void;
    glowEnabled: boolean;
    onGlowEnabledChange: (next: boolean) => void;
    glowIntensity: number;
    onGlowIntensityChange: (next: number) => void;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

export const DioramaParticleAppearanceSettings: React.FC<DioramaParticleAppearanceSettingsProps> = (props) => {
    const shared = { sub: true, disabled: !props.enabled, onDragStart: props.onSliderPointerDown, onDragEnd: props.onSliderCommit };

    return (
        <>
            <SliderRow
                {...shared}
                label={props.t('options.dioramaParticleDensity')}
                value={props.density}
                min={DIORAMA_PARTICLE_DENSITY_MIN}
                max={DIORAMA_PARTICLE_DENSITY_MAX}
                step={DIORAMA_PARTICLE_DENSITY_STEP}
                format={(value) => String(Math.round(value))}
                onChange={props.onDensityChange}
            />
            <SliderRow
                {...shared}
                label={props.t('options.dioramaParticleScale')}
                value={props.particleScale}
                min={DIORAMA_PARTICLE_SIZE_MIN}
                max={DIORAMA_PARTICLE_SIZE_MAX}
                step={DIORAMA_PARTICLE_SIZE_STEP}
                format={times}
                onChange={props.onParticleScaleChange}
            />
            <Row sub disabled={!props.enabled} label={props.t('options.dioramaParticleGlow')}>
                <Toggle checked={props.glowEnabled} onChange={props.onGlowEnabledChange} />
            </Row>
            <Reveal when={props.glowEnabled}>
                <SliderRow
                    {...shared}
                    label={props.t('options.dioramaParticleGlowIntensity')}
                    value={props.glowIntensity}
                    min={DIORAMA_PARTICLE_GLOW_INTENSITY_MIN}
                    max={DIORAMA_PARTICLE_GLOW_INTENSITY_MAX}
                    step={DIORAMA_PARTICLE_GLOW_INTENSITY_STEP}
                    format={percent}
                    onChange={props.onGlowIntensityChange}
                />
            </Reveal>
        </>
    );
};
