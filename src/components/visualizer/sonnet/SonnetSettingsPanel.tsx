import React, { useMemo } from 'react';
import { DEFAULT_SONNET_TUNING, type SonnetTuning } from '../../../types';
import type { VisualizerSettingsPanelProps } from '../definition';
import VisualizerPresetGroup, { type VisualizerPresetOption } from '../VisualizerPresetGroup';

// src/components/visualizer/sonnet/SonnetSettingsPanel.tsx
// Keeps Sonnet's tuning controls adjacent to the mode implementation.
const SonnetSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    rangeInputClass,
    controlCardBg,
    sonnetTuning = DEFAULT_SONNET_TUNING,
    onSonnetTuningChange,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const booleanOptions: VisualizerPresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.sonnetToggleOn') || '开启' },
        { value: false, label: t('options.sonnetToggleOff') || '关闭' },
    ]), [t]);

    const visibilityControls: Array<{
        key: Extract<keyof SonnetTuning, 'showOnlyText' | 'showGuide' | 'showBackgroundMg' | 'showFixedGeo' | 'showGiantDecorativeText' | 'showBackgroundDecor' | 'enableTransitions'>;
        label: string;
    }> = [
        { key: 'showOnlyText', label: t('options.sonnetShowOnlyText') || '仅显示文字' },
        { key: 'showGuide', label: t('options.sonnetShowGuide') || '轨迹线' },
        { key: 'showBackgroundMg', label: t('options.sonnetShowBackgroundMg') || '主场景' },
        { key: 'showFixedGeo', label: t('options.sonnetShowFixedGeo') || '文字浮标' },
        { key: 'showGiantDecorativeText', label: t('options.sonnetShowGiantDecorativeText') || '巨型装饰镂空文字' },
        { key: 'showBackgroundDecor', label: t('options.sonnetShowBackgroundDecor') || '背景装饰' },
        { key: 'enableTransitions', label: t('options.sonnetEnableTransitions') || '场景转场' },
    ];

    const controls: Array<{
        key: Extract<keyof SonnetTuning, 'cameraIntensity' | 'typographyMotion' | 'mgDensity' | 'textureResolution'>;
        label: string;
        min?: number;
        max?: number;
        step?: number;
    }> = [
        { key: 'cameraIntensity', label: t('options.sonnetCameraIntensity') },
        { key: 'typographyMotion', label: t('options.sonnetTypographyMotion') },
        { key: 'mgDensity', label: t('options.sonnetMgDensity') },
        {
            key: 'textureResolution',
            label: t('options.sonnetTextureResolution'),
            min: 0.5,
            max: 4,
            step: 0.25,
        },
    ];

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.sonnetSettings')}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.sonnetSettingsDesc')}
                </div>
            </div>
            {controls.map(control => (
                <div key={control.key} className="space-y-2">
                    <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                        <span>{control.label}</span>
                        <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                            {sonnetTuning[control.key].toFixed(2)}x
                        </span>
                    </div>
                    <input
                        type="range"
                        min={control.min ?? 0}
                        max={control.max ?? 2}
                        step={control.step ?? 0.05}
                        value={sonnetTuning[control.key]}
                        onChange={event => onSonnetTuningChange?.({
                            [control.key]: Number(event.target.value),
                        })}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                        className={rangeInputClass}
                    />
                </div>
            ))}
            {visibilityControls.map(control => (
                <VisualizerPresetGroup
                    key={control.key}
                    label={control.label}
                    value={sonnetTuning[control.key]}
                    options={booleanOptions}
                    onChange={(next) => onSonnetTuningChange?.({ [control.key]: next })}
                    isDaylight={isDaylight}
                    theme={theme}
                />
            ))}
        </div>
    );
};

export default SonnetSettingsPanel;
