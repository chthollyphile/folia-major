import React from 'react';
import { type Theme } from '../../../types';
import { colorWithAlpha } from '../../../utils/colorMix';

// src/components/visualizer/diorama/DioramaSettingsToggle.tsx
// Shared accessible switch used by Diorama's collapsible setting groups.
interface DioramaSettingsToggleProps {
    checked: boolean;
    disabled?: boolean;
    label: string;
    onChange: (next: boolean) => void;
    theme: Theme;
    isDaylight: boolean;
}

export const DioramaSettingsToggle: React.FC<DioramaSettingsToggleProps> = ({
    checked,
    disabled,
    label,
    onChange,
    theme,
    isDaylight,
}) => (
    <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="relative h-7 w-12 shrink-0 rounded-full border transition-all disabled:cursor-not-allowed disabled:opacity-35"
        style={{
            borderColor: checked ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.24 : 0.2),
            backgroundColor: checked
                ? colorWithAlpha(theme.accentColor, isDaylight ? 0.2 : 0.28)
                : colorWithAlpha(theme.backgroundColor, isDaylight ? 0.34 : 0.48),
        }}
    >
        <span
            className="absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all"
            style={{
                left: checked ? '24px' : '3px',
                backgroundColor: checked ? theme.accentColor : theme.secondaryColor,
                boxShadow: `0 2px 8px ${colorWithAlpha(theme.backgroundColor, 0.35)}`,
            }}
        />
    </button>
);
