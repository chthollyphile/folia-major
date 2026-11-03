import React from 'react';

// src/components/visualizer/tempera/TemperaSettingsControls.tsx
// Provides the compact slider primitive of the Tempera image dialog.
interface TemperaRangeControlProps {
    label: string;
    value: number;
    rangeInputClass: string;
    onChange: (value: number) => void;
    onPointerDown?: () => void;
    onPointerUp?: () => void;
    /** Pointer capture can be lost mid-drag; without this the host never commits the value. */
    onPointerCancel?: () => void;
    min?: number;
    max?: number;
    step?: number;
    /** Readout next to the label; defaults to a multiplier such as `1.00x`. */
    formatValue?: (value: number) => string;
}

const defaultFormatValue = (value: number) => `${value.toFixed(2)}x`;

export const TemperaRangeControl: React.FC<TemperaRangeControlProps> = ({
    label,
    value,
    rangeInputClass,
    onChange,
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    min = 0,
    max = 2,
    step = 0.05,
    formatValue = defaultFormatValue,
}) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--text-primary)' }}>
            <span>{label}</span>
            <span className="shrink-0 font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                {formatValue(value)}
            </span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={event => onChange(Number(event.target.value))}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel ?? onPointerUp}
            className={rangeInputClass}
        />
    </div>
);
