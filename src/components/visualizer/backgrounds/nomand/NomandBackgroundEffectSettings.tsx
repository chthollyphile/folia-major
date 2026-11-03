import React from 'react';
import type { NomandBackgroundEffect } from '../../../../types';
import { Group, PictureGrid, Row, type SettingsGroupDef } from '../../../modal/settings/kit';
import NomandDitheringSettings from './NomandDitheringSettings';
import NomandFlutedGlassSettings from './NomandFlutedGlassSettings';
import NomandHalftoneDotsSettings from './NomandHalftoneDotsSettings';
import NomandLensDistortionSettings from './NomandLensDistortionSettings';
import NomandPaperTextureSettings from './NomandPaperTextureSettings';
import type { NomandBackgroundEffectPanelProps } from './NomandBackgroundEffectPanel';

// src/components/visualizer/backgrounds/nomand/NomandBackgroundEffectSettings.tsx
// The effect group: the choice of the active Paper shader as small pictures, and under it only
// that effect's own rows.
const EFFECT_GROUP: SettingsGroupDef = { id: 'bg-nomand-effect', titleKey: 'options.nomandBackgroundEffect' };

/** The effects in the order the settings window and the player panel offer them. */
export const EFFECTS: NomandBackgroundEffect[] = [
    'dithering',
    'fluted-glass',
    'paper-texture',
    'halftone-dots',
    'lens-distortion',
];

export const EFFECT_LABEL_KEYS: Record<NomandBackgroundEffect, string> = {
    dithering: 'options.nomandBackgroundEffectDithering',
    'fluted-glass': 'options.nomandBackgroundEffectFlutedGlass',
    'paper-texture': 'options.nomandBackgroundEffectPaperTexture',
    'halftone-dots': 'options.nomandBackgroundEffectHalftoneDots',
    'lens-distortion': 'options.nomandBackgroundEffectLensDistortion',
};

/** What each effect does to a picture, as a pattern: a pixel grid, ribs, fibres, dots, a lens. */
const EFFECT_PATTERNS: Record<NomandBackgroundEffect, React.CSSProperties> = {
    dithering: {
        backgroundImage: 'conic-gradient(var(--st-t2) 25%, transparent 0 50%, var(--st-t2) 0 75%, transparent 0)',
        backgroundSize: '8px 8px',
    },
    'fluted-glass': {
        backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 2px, var(--st-t2) 5px, transparent 8px)',
    },
    'paper-texture': {
        backgroundImage: 'repeating-linear-gradient(37deg, transparent 0 3px, var(--st-t3) 3px 4px), repeating-linear-gradient(-58deg, transparent 0 5px, var(--st-t3) 5px 6px)',
    },
    'halftone-dots': {
        backgroundImage: 'radial-gradient(var(--st-t2) 32%, transparent 36%)',
        backgroundSize: '8px 8px',
    },
    'lens-distortion': {
        backgroundImage: 'radial-gradient(circle at 50% 50%, transparent 0 22%, var(--st-t2) 24% 28%, transparent 30% 46%, var(--st-t3) 48% 52%, transparent 54%)',
    },
};

const effectPicture = (effect: NomandBackgroundEffect) => (
    <span className="absolute inset-0" style={EFFECT_PATTERNS[effect]} />
);

const NomandBackgroundEffectSettings: React.FC<NomandBackgroundEffectPanelProps> = props => {
    const { t, tuning } = props;

    return (
        <Group def={EFFECT_GROUP}>
            <Row
                below={(
                    <PictureGrid
                        className="-mx-4"
                        columns={3}
                        label={t('options.nomandBackgroundEffect')}
                        value={tuning.effect}
                        options={EFFECTS.map(effect => ({ value: effect, label: t(EFFECT_LABEL_KEYS[effect]) }))}
                        picture={effectPicture}
                        onChange={effect => props.onTuningChange?.({ effect })}
                    />
                )}
            />
            {tuning.effect === 'dithering' && <NomandDitheringSettings {...props} />}
            {tuning.effect === 'fluted-glass' && <NomandFlutedGlassSettings {...props} />}
            {tuning.effect === 'paper-texture' && <NomandPaperTextureSettings {...props} />}
            {tuning.effect === 'halftone-dots' && <NomandHalftoneDotsSettings {...props} />}
            {tuning.effect === 'lens-distortion' && <NomandLensDistortionSettings {...props} />}
        </Group>
    );
};

export default NomandBackgroundEffectSettings;
