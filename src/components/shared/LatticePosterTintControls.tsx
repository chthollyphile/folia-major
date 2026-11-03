import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import FastColorPicker from './FastColorPicker';
import { useColorPreviewThrottle } from './useColorPreviewThrottle';

// Shared controls for the settings card and the command-palette surface.

type LatticePosterTintControlsProps = {
    enabled: boolean;
    useCustomColor: boolean;
    color: string;
    intensity: number;
    isDaylight: boolean;
    theme?: Theme;
    onEnabledChange: (enabled: boolean) => void;
    onUseCustomColorChange: (enabled: boolean) => void;
    onColorChange: (color: string) => void;
    onIntensityChange: (intensity: number) => void;
};

const LatticePosterTintControls: React.FC<LatticePosterTintControlsProps> = ({
    enabled,
    useCustomColor,
    color,
    intensity,
    isDaylight,
    theme,
    onEnabledChange,
    onUseCustomColorChange,
    onColorChange,
    onIntensityChange,
}) => {
    const { t } = useTranslation();
    const offBackground = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const { previewColor, flushColor } = useColorPreviewThrottle(onColorChange);
    const renderToggle = (active: boolean, label: string, onChange: (enabled: boolean) => void) => (
        <button
            type="button"
            onClick={() => onChange(!active)}
            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${active ? '' : offBackground}`}
            style={{ backgroundColor: active ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
            aria-pressed={active}
            aria-label={label}
        >
            <span className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${active ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {t('options.latticePosterTint')}
                    </div>
                    <div className="text-xs opacity-50 max-w-[420px]" style={{ color: 'var(--text-secondary)' }}>
                        {t('options.latticePosterTintDesc')}
                    </div>
                </div>
                {renderToggle(enabled, t('options.latticePosterTint'), onEnabledChange)}
            </div>

            {enabled && <div className={`space-y-4 border-t pt-4 ${isDaylight ? 'border-black/5' : 'border-white/5'}`}>
                <div className="flex items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.latticePosterTintCustomColor')}
                        </div>
                        <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.latticePosterTintCustomColorDesc')}
                        </div>
                    </div>
                    {renderToggle(useCustomColor, t('options.latticePosterTintCustomColor'), onUseCustomColorChange)}
                </div>

                {useCustomColor && (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs">
                            <span className="opacity-60">{t('options.latticePosterTintColor')}</span>
                            <span className="font-mono uppercase">{color}</span>
                        </div>
                        <div onPointerUpCapture={flushColor} onPointerCancelCapture={flushColor}>
                            <FastColorPicker color={color} height={128} onChange={previewColor} />
                        </div>
                    </div>
                )}

                <div className="space-y-2">
                    <div className="flex items-center justify-between gap-4 text-xs">
                        <span style={{ color: 'var(--text-secondary)' }}>{t('options.latticePosterTintIntensity')}</span>
                        <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                            {Math.round(intensity * 100)}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={intensity}
                        onChange={event => onIntensityChange(Number(event.currentTarget.value))}
                        className="w-full accent-current"
                        style={{ accentColor: theme?.accentColor }}
                        aria-label={t('options.latticePosterTintIntensity')}
                    />
                </div>
            </div>}
        </div>
    );
};

export default LatticePosterTintControls;
