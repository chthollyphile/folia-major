import React from 'react';
import type { SoraBackgroundTuning, Theme } from '../../../../types';
import { colorWithAlpha } from '../../colorMix';
import BackgroundToggleRow from '../BackgroundToggleRow';

// src/components/visualizer/backgrounds/sora/SoraBackgroundSettingsCard.tsx
// Edits the Sora starfield tuning: currently only the blank (static solid color) switch.

interface SoraBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    tuning: SoraBackgroundTuning;
    onTuningChange?: (patch: Partial<SoraBackgroundTuning>) => void;
}

const SoraBackgroundSettingsCard: React.FC<SoraBackgroundSettingsCardProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    tuning,
    onTuningChange,
}) => {
    const borderColor = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);

    return (
        <div className="rounded-[24px] border p-4 space-y-5" style={{ backgroundColor: controlCardBg, borderColor }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                    {t('options.soraBackgroundSettings')}
                </div>
            </div>
            <BackgroundToggleRow
                label={t('options.soraBlank')}
                description={t('options.soraBlankDesc')}
                checked={tuning.blank}
                onChange={blank => onTuningChange?.({ blank })}
                theme={theme}
            />
        </div>
    );
};

export default SoraBackgroundSettingsCard;
