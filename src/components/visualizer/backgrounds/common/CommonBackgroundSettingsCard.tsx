import React from 'react';
import type { Theme } from '../../../../types';
import { colorWithAlpha } from '../../colorMix';
import type { VisualizerBackgroundSettingsProps } from '../definition';

// src/components/visualizer/backgrounds/common/CommonBackgroundSettingsCard.tsx
// Configures the built-in cover-color and geometric background layers.

const ToggleRow: React.FC<{
    label: string;
    description: string;
    checked: boolean;
    onChange?: (checked: boolean) => void;
    theme: Theme;
}> = ({ label, description, checked, onChange, theme }) => (
    <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
            <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>{label}</div>
            <div className="max-w-[320px] text-xs opacity-70" style={{ color: theme.secondaryColor }}>{description}</div>
        </div>
        <button
            type="button"
            aria-pressed={checked}
            disabled={!onChange}
            onClick={() => onChange?.(!checked)}
            className="h-6 w-12 shrink-0 rounded-full p-1 transition-colors disabled:opacity-45"
            style={{ backgroundColor: checked ? theme.secondaryColor : colorWithAlpha(theme.secondaryColor, 0.18) }}
        >
            <div
                className={`h-4 w-4 rounded-full shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`}
                style={{ backgroundColor: theme.backgroundColor }}
            />
        </button>
    </div>
);

const CommonBackgroundSettingsCard: React.FC<VisualizerBackgroundSettingsProps> = ({
    config,
    actions,
    t,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const common = config?.common;
    const commonActions = actions?.common;
    const borderColor = colorWithAlpha(theme.secondaryColor, 0.16);
    const opacity = common?.opacity ?? 0.75;

    return (
        <>
            <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor }}>
                <ToggleRow
                    label={t('options.disableVisualizerVignette')}
                    description={t('options.disableVisualizerVignetteDesc')}
                    checked={common?.disableVignette ?? false}
                    onChange={commonActions?.onDisableVignetteChange}
                    theme={theme}
                />
                <ToggleRow
                    label={t('options.disableVisualizerGeometricBackground')}
                    description={t('options.disableVisualizerGeometricBackgroundDesc')}
                    checked={common?.disableGeometricBackground ?? false}
                    onChange={commonActions?.onDisableGeometricChange}
                    theme={theme}
                />
            </div>

            <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor }}>
                <div className="space-y-2">
                    <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                        {t('options.previewCoverBackgroundSettings')}
                    </div>
                    <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                        {t('options.previewCoverBackgroundSettingsDesc')}
                    </div>
                    <ToggleRow
                        label={t('theme.addCoverColor')}
                        description={t('options.coverColorBackgroundDesc')}
                        checked={common?.useCoverColorBg ?? false}
                        onChange={commonActions?.onCoverColorChange}
                        theme={theme}
                    />
                    <div className="flex items-center justify-between text-sm" style={{ color: theme.primaryColor }}>
                        <span>{t('options.previewCoverBackgroundOpacity')}</span>
                        <span className="font-mono opacity-70" style={{ color: theme.secondaryColor }}>
                            {Math.round(opacity * 100)}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={opacity}
                        onChange={event => commonActions?.onOpacityChange?.(Number(event.target.value))}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                        className={rangeInputClass}
                    />
                </div>
            </div>
        </>
    );
};

export default CommonBackgroundSettingsCard;
