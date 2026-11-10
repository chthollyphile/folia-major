import React from 'react';
import type { SoraBackgroundTuning } from '../../../../types';
import { Group, type SettingsGroupDef } from '../../../modal/settings/kit';
import { ToggleRow } from '../../panelRows';

// src/components/visualizer/backgrounds/sora/SoraBackgroundSettingsCard.tsx
// Edits the Sora starfield tuning: currently only the blank (static solid color) switch.
const SORA_GROUP: SettingsGroupDef = { id: 'bg-sora', titleKey: 'options.soraBackgroundSettings' };

interface SoraBackgroundSettingsCardProps {
    t: (key: string) => string;
    tuning: SoraBackgroundTuning;
    onTuningChange?: (patch: Partial<SoraBackgroundTuning>) => void;
}

const SoraBackgroundSettingsCard: React.FC<SoraBackgroundSettingsCardProps> = ({
    t,
    tuning,
    onTuningChange,
}) => (
    <Group def={SORA_GROUP}>
        <ToggleRow
            label={t('options.soraBlank')}
            note={t('options.soraBlankDesc')}
            checked={tuning.blank}
            onChange={blank => onTuningChange?.({ blank })}
        />
    </Group>
);

export default SoraBackgroundSettingsCard;
