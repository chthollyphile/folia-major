import React from 'react';
import type { Theme } from '../../../../types';
import { colorWithAlpha } from '../../colorMix';

// src/components/visualizer/backgrounds/transparent/TransparentBackgroundSettingsCard.tsx
// Informational card for the transparent shell background; this mode exposes no tuning knobs.

interface TransparentBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
}

const TransparentBackgroundSettingsCard: React.FC<TransparentBackgroundSettingsCardProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
}) => {
    const borderColor = colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.16);

    return (
        <div className="rounded-[24px] border p-4 space-y-1" style={{ backgroundColor: controlCardBg, borderColor }}>
            <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                {t('options.visualizerBackgroundModeTransparent')}
            </div>
            <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                {t('options.visualizerBackgroundModeTransparentDesc')}
            </div>
        </div>
    );
};

export default TransparentBackgroundSettingsCard;
