import React, { useId } from 'react';
import { CustomSelect } from '../../../shared/CustomSelect';
import { useSettingsKitTheme } from './kitTheme';
import { useRowNaming } from './Row';

// src/components/modal/settings/kit/Select.tsx
// A pick list for a choice too long to lay out. The app's CustomSelect with its compact trigger;
// its menu opens outside the settings window, so the theme is handed to it. It is named by the
// row's label, then by its own name where it has one, then by the value it shows.

type SelectProps<T extends string> = {
    value: T;
    options: ReadonlyArray<{ value: T; label: string }>;
    onChange: (value: T) => void;
    /** What this list chooses, when a row holds more than one: read after the row's label. */
    name?: string;
    /** Runs right before the list opens, for options that are only fetched once they are asked for. */
    onOpen?: () => void;
    disabled?: boolean;
    /** Opens the list above the trigger where it fits there. */
    preferAbove?: boolean;
};

export const Select = <T extends string>({ value, options, onChange, name, onOpen, disabled, preferAbove }: SelectProps<T>): React.ReactElement => {
    const { isDaylight, theme } = useSettingsKitTheme();
    const { labelId } = useRowNaming();
    const nameId = useId();
    const labelledBy = [labelId, name ? nameId : undefined].filter(Boolean).join(' ') || undefined;

    return (
        <>
            {name && <span id={nameId} hidden>{name}</span>}
            <CustomSelect
                compact
                value={value}
                onChange={next => onChange(next as T)}
                options={[...options]}
                onOpen={onOpen}
                disabled={disabled}
                preferAbove={preferAbove}
                ariaLabel={name}
                ariaLabelledBy={labelledBy}
                isDaylight={isDaylight}
                theme={theme}
            />
        </>
    );
};

export default Select;
