import React from 'react';
import { type DioramaGeometryVisibility } from '../../../types';
import { Reveal, Row, Segmented, Toggle } from '../../modal/settings/kit';
import { DioramaFoldRow } from './DioramaFoldRow';
import { DioramaParticleAppearanceSettings } from './DioramaParticleAppearanceSettings';

// src/components/visualizer/diorama/DioramaGeometrySettings.tsx
// Hierarchical visibility and density rows for Diorama's procedural particle-cloud families: the
// layer's switch, and folded under it its shape, the families and how the particles look.
interface DioramaGeometrySettingsProps {
    t: (key: string) => string;
    value: DioramaGeometryVisibility;
    onChange: (next: DioramaGeometryVisibility) => void;
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

type GeometryChildKey = Exclude<keyof DioramaGeometryVisibility, 'enabled' | 'mode'>;

const CHILDREN: Array<{ key: GeometryChildKey; labelKey: string }> = [
    { key: 'strands', labelKey: 'options.dioramaGeometryStrands' },
    { key: 'blobs', labelKey: 'options.dioramaGeometryBlobs' },
    { key: 'ribbons', labelKey: 'options.dioramaGeometryRibbons' },
    { key: 'rings', labelKey: 'options.dioramaGeometryRings' },
];

const MODES: Array<{ key: DioramaGeometryVisibility['mode']; labelKey: string }> = [
    { key: 'clouds', labelKey: 'options.dioramaGeometryModeClouds' },
    { key: 'corridor', labelKey: 'options.dioramaGeometryModeCorridor' },
];

export const DioramaGeometrySettings: React.FC<DioramaGeometrySettingsProps> = ({
    t,
    value,
    onChange,
    density,
    onDensityChange,
    particleScale,
    onParticleScaleChange,
    glowEnabled,
    onGlowEnabledChange,
    glowIntensity,
    onGlowIntensityChange,
    onSliderPointerDown,
    onSliderCommit,
}) => (
    <DioramaFoldRow
        label={t('options.dioramaGeometry')}
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
    >
        {/* Mutually-exclusive shape of the whole layer: per-line clouds OR one path tunnel. */}
        <Row sub disabled={!value.enabled} label={t('options.dioramaGeometryMode')}>
            <Segmented
                value={value.mode}
                options={MODES.map(item => ({ value: item.key, label: t(item.labelKey) }))}
                onChange={(mode) => onChange({ ...value, mode })}
            />
        </Row>
        <Reveal when={value.mode === 'clouds'}>
            {CHILDREN.map((item) => (
                <Row key={item.key} sub disabled={!value.enabled} label={t(item.labelKey)}>
                    <Toggle checked={value[item.key]} onChange={(checked) => onChange({ ...value, [item.key]: checked })} />
                </Row>
            ))}
        </Reveal>
        <DioramaParticleAppearanceSettings
            t={t}
            enabled={value.enabled}
            density={density}
            onDensityChange={onDensityChange}
            particleScale={particleScale}
            onParticleScaleChange={onParticleScaleChange}
            glowEnabled={glowEnabled}
            onGlowEnabledChange={onGlowEnabledChange}
            glowIntensity={glowIntensity}
            onGlowIntensityChange={onGlowIntensityChange}
            onSliderPointerDown={onSliderPointerDown}
            onSliderCommit={onSliderCommit}
        />
    </DioramaFoldRow>
);
