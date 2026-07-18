import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { type Theme } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { DioramaSettingsToggle } from './DioramaSettingsToggle';

// src/components/visualizer/diorama/DioramaEffectSettings.tsx
// Collapsible controls for one independent Diorama follow-sing effect. An effect may carry ONE nested
// sub-switch (a plain toggle, no strength of its own) rendered inside the expanded panel - used by 灵魂出窍
// for the 当前字漂移 child, which gates the SAME underlying effect on the word currently being sung, so it
// belongs under its parent rather than as a standalone effect in the list.
const STRENGTH_PRESETS = [
    { key: 'low', value: 0.5 },
    { key: 'mid', value: 1 },
    { key: 'high', value: 1.5 },
] as const;

type StrengthChoice = typeof STRENGTH_PRESETS[number]['key'] | 'custom';

interface StrengthControlProps {
    label: string;
    intensity: number;
    enabled: boolean;
    onIntensityChange: (next: number) => void;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    rangeInputClass: string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const StrengthControl: React.FC<StrengthControlProps> = ({
    label,
    intensity,
    enabled,
    onIntensityChange,
    t,
    isDaylight,
    theme,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const matchedPreset = STRENGTH_PRESETS.find(preset => Math.abs(preset.value - intensity) < 0.001)?.key;
    const [customMode, setCustomMode] = useState(matchedPreset == null);
    const activeChoice: StrengthChoice = customMode ? 'custom' : (matchedPreset ?? 'custom');
    const choices: Array<{ key: StrengthChoice; label: string }> = [
        { key: 'low', label: t('options.dioramaStrengthLow') },
        { key: 'mid', label: t('options.dioramaStrengthMid') },
        { key: 'high', label: t('options.dioramaStrengthHigh') },
        { key: 'custom', label: t('options.dioramaStrengthCustom') },
    ];

    return (
        <>
            <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
                {t('options.dioramaEffectStrength')}
            </div>
            <div className="flex flex-wrap gap-2">
                {choices.map(choice => {
                    const active = choice.key === activeChoice;
                    return (
                        <button
                            key={choice.key}
                            type="button"
                            disabled={!enabled}
                            onClick={() => {
                                if (choice.key === 'custom') {
                                    setCustomMode(true);
                                    return;
                                }
                                setCustomMode(false);
                                const preset = STRENGTH_PRESETS.find(item => item.key === choice.key);
                                if (preset) onIntensityChange(preset.value);
                            }}
                            className="rounded-full border px-3 py-2 text-sm transition-all disabled:opacity-35"
                            style={{
                                color: theme.primaryColor,
                                borderColor: active
                                    ? theme.accentColor
                                    : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                backgroundColor: active
                                    ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16)
                                    : colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                                boxShadow: active ? `inset 0 0 0 1px ${theme.accentColor}` : 'none',
                            }}
                        >
                            {choice.label}
                        </button>
                    );
                })}
            </div>
            {enabled && activeChoice === 'custom' && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                        <span style={{ color: 'var(--text-primary)' }}>
                            {t('options.dioramaCustomStrength')}
                        </span>
                        <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                            {Math.round(intensity * 100)}%
                        </span>
                    </div>
                    <input
                        type="range"
                        min="0.1"
                        max="1.5"
                        step="0.05"
                        value={intensity}
                        aria-label={`${label} ${t('options.dioramaCustomStrength')}`}
                        onChange={(event) => onIntensityChange(parseFloat(event.target.value))}
                        onPointerDown={onSliderPointerDown}
                        onPointerUp={onSliderCommit}
                        className={rangeInputClass}
                    />
                </div>
            )}
        </>
    );
};

/** A nested sub-switch (toggle only, no strength of its own) shown inside a parent effect's expanded
 *  panel - e.g. 灵魂出窍's 当前字漂移, which just gates whether the current glyph joins the effect. */
export interface DioramaSubEffect {
    label: string;
    enabled: boolean;
    onEnabledChange: (next: boolean) => void;
}

interface DioramaEffectSettingsProps {
    label: string;
    enabled: boolean;
    intensity: number;
    onEnabledChange: (next: boolean) => void;
    onIntensityChange: (next: number) => void;
    /** Optional child sub-switch gating the SAME effect (e.g. 灵魂出窍's 当前字漂移); rendered inside this
     *  effect's expanded panel, below the parent's strength control. */
    subEffect?: DioramaSubEffect;
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    rangeInputClass: string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

export const DioramaEffectSettings: React.FC<DioramaEffectSettingsProps> = ({
    label,
    enabled,
    intensity,
    onEnabledChange,
    onIntensityChange,
    subEffect,
    t,
    isDaylight,
    theme,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const controlsId = useId();

    return (
        <fieldset className="space-y-2.5">
            <legend className="sr-only">{label}</legend>
            <div
                className="flex items-center justify-between gap-3 rounded-2xl border px-3.5 py-3"
                style={{
                    borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.17 : 0.14),
                    backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                }}
            >
                <button
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={controlsId}
                    onClick={() => setIsExpanded(expanded => !expanded)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                    <ChevronDown
                        size={16}
                        aria-hidden="true"
                        className={`shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        style={{ color: 'var(--text-secondary)' }}
                    />
                    <span className="min-w-0">
                        <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {label}
                        </span>
                    </span>
                </button>
                <DioramaSettingsToggle
                    checked={enabled}
                    label={label}
                    onChange={onEnabledChange}
                    theme={theme}
                    isDaylight={isDaylight}
                />
            </div>

            {isExpanded && (
                <div
                    id={controlsId}
                    className="ml-3 space-y-3 border-l pl-3"
                    style={{ borderColor: colorWithAlpha(theme.accentColor, enabled ? 0.3 : 0.12) }}
                >
                    <StrengthControl
                        label={label}
                        intensity={intensity}
                        enabled={enabled}
                        onIntensityChange={onIntensityChange}
                        t={t}
                        isDaylight={isDaylight}
                        theme={theme}
                        rangeInputClass={rangeInputClass}
                        onSliderPointerDown={onSliderPointerDown}
                        onSliderCommit={onSliderCommit}
                    />
                    {subEffect && (
                        <div
                            className="flex items-center justify-between gap-3 border-t pt-3"
                            style={{ borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14) }}
                        >
                            <span className="min-w-0 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {subEffect.label}
                            </span>
                            <DioramaSettingsToggle
                                checked={subEffect.enabled}
                                label={subEffect.label}
                                onChange={subEffect.onEnabledChange}
                                theme={theme}
                                isDaylight={isDaylight}
                            />
                        </div>
                    )}
                </div>
            )}
        </fieldset>
    );
};
