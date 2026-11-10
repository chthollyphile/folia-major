import React from 'react';
import { REMOTE_NO_DRAG_STYLE } from './remoteWindowBridge';

// src/components/remote/RemoteSheetControls.tsx
// The two controls the remote window's sheet is made of: a segmented choice and a switch.

type RemoteSegProps<T extends string> = {
    /** What the choice is about, for screen readers; the visible label sits beside it in the row. */
    label: string;
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    disabled?: boolean;
    onChange: (value: T) => void;
};

export function RemoteSeg<T extends string>({ label, value, options, disabled, onChange }: RemoteSegProps<T>) {
    return (
        <div className="remote-seg" role="radiogroup" aria-label={label} style={REMOTE_NO_DRAG_STYLE}>
            {options.map(option => (
                <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={option.value === value}
                    data-on={option.value === value}
                    disabled={disabled}
                    className="remote-seg__cell"
                    onClick={() => onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

type RemoteSwitchProps = {
    label: string;
    on: boolean;
    disabled?: boolean;
    /** Hover text, for a switch that needs a word on why it is greyed out. */
    hint?: string;
    onChange: (on: boolean) => void;
};

export const RemoteSwitch: React.FC<RemoteSwitchProps> = ({ label, on, disabled, hint, onChange }) => (
    <button
        type="button"
        role="switch"
        aria-checked={on}
        data-on={on}
        disabled={disabled}
        title={hint}
        className="remote-switch"
        style={REMOTE_NO_DRAG_STYLE}
        onClick={() => onChange(!on)}
    >
        {label}
        <span className="remote-switch__track" />
    </button>
);
