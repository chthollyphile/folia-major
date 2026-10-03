import React from 'react';
import type { Theme } from '../../../../types';
import { colorWithAlpha } from '../../colorMix';

// src/components/visualizer/backgrounds/tide/tideSettingsRows.tsx
// The small presentational pieces the tide settings panel is built from: a section caption, a slider
// row that can show its own value label, a pill group for enum choices and a colour swatch row. They
// are shared only by the tide card, so the mode stays self-contained.

export const TideSectionLabel: React.FC<{ children: React.ReactNode; theme: Theme; }> = ({ children, theme }) => (
    <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
        {children}
    </div>
);

export interface TideSliderRowProps {
    label: string;
    value: number;
    valueLabel?: string;
    min: number;
    max: number;
    step: number;
    digits?: number;
    rangeInputClass: string;
    theme: Theme;
    onChange: (value: number) => void;
    onPointerDown?: () => void;
    onPointerUp?: () => void;
}

export const TideSliderRow: React.FC<TideSliderRowProps> = ({
    label,
    value,
    valueLabel,
    min,
    max,
    step,
    digits = 2,
    rangeInputClass,
    theme,
    onChange,
    onPointerDown,
    onPointerUp,
}) => (
    <label className="block space-y-2">
        <span className="flex justify-between gap-3 text-sm" style={{ color: theme.primaryColor }}>
            <span>{label}</span>
            <span className="font-mono opacity-70">{valueLabel ?? value.toFixed(digits)}</span>
        </span>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={event => onChange(Number(event.target.value))}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={rangeInputClass}
        />
    </label>
);

export interface TidePillOption<T extends string> {
    value: T;
    label: string;
}

export const TidePillGroup = <T extends string>({
    label,
    value,
    options,
    onChange,
    isDaylight,
    theme,
}: {
    label: string;
    value: T;
    options: TidePillOption<T>[];
    onChange: (value: T) => void;
    isDaylight: boolean;
    theme: Theme;
}) => (
    <div className="space-y-2.5">
        <TideSectionLabel theme={theme}>{label}</TideSectionLabel>
        <div className="flex flex-wrap gap-2">
            {options.map(option => {
                const isActive = option.value === value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className="rounded-full border px-3 py-2 text-sm transition-all"
                        style={{
                            color: theme.primaryColor,
                            borderColor: isActive ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                            backgroundColor: isActive
                                ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16)
                                : colorWithAlpha(theme.secondaryColor, 0.08),
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

/** 一行一个颜色目标：点一下切换到它，下面的取色器就编辑它。 */
export const TideColorRow: React.FC<{
    label: string;
    color: string;
    active: boolean;
    onSelect: () => void;
    isDaylight: boolean;
    theme: Theme;
}> = ({ label, color, active, onSelect, isDaylight, theme }) => (
    <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center justify-between gap-3 rounded-[16px] border px-3 py-2 text-sm transition-all"
        style={{
            color: theme.primaryColor,
            borderColor: active ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.16 : 0.12),
            backgroundColor: active ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16) : 'transparent',
        }}
    >
        <span>{label}</span>
        <span className="flex items-center gap-2">
            <span className="font-mono text-xs opacity-70">{color.toUpperCase()}</span>
            <span
                className="h-5 w-5 rounded-full border"
                style={{
                    backgroundColor: color,
                    borderColor: colorWithAlpha(theme.secondaryColor, 0.35),
                }}
            />
        </span>
    </button>
);
