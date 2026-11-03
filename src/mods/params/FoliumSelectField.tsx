import React, { useMemo } from 'react';
import type { Theme } from '@/types';
import { CustomSelect } from '@/components/shared/CustomSelect';
import type { FoliumSetting } from '../folium/contract';
import { resolveFoliumLabel, resolveFoliumSelectDisplayValue } from './params';

// src/mods/params/FoliumSelectField.tsx
// The control of a `select` param: the host CustomSelect instead of a native
// <select> (#485). The native popup ignores the app theme (a light grey list
// over dark chrome) and its keyboard differs from every other dropdown here.
// The trigger is compact and wears the form token's input class/style, so it
// stands level with, and looks like, the text fields of the same form.
//
// Two native-select habits it keeps on purpose:
// - The trigger is named by the field's visible label followed by the value it
//   shows ("Codec HEVC"), the way a native select exposes name + value; a plain
//   aria-label would replace the button text and hide the value.
// - Picking the option already stored is not a change. A native select fires no
//   change event then. CustomSelect already drops Enter on the option it shows as
//   current (the menu opens with the highlight there), but it still reports a
//   click on that option. Passing such a click through would write an unchanged
//   value: subscribers get a change that is none, and a key that was following
//   the mod's defaultValue gets pinned to today's default. The comparison is
//   with the stored value, not the displayed one, so clicking the fallback shown
//   for a stale stored value still writes and corrects it (Enter on that shown
//   fallback only closes the menu, as the native select it replaced did).

interface FoliumSelectFieldProps {
    param: FoliumSetting;
    value: unknown;
    /** Resolved field label; it names the listbox. */
    label: string;
    /** Id of the visible label element; with the shown value it names the trigger. */
    labelId: string;
    language: string;
    disabled: boolean;
    inputClassName: string;
    inputStyle?: React.CSSProperties;
    theme?: Theme;
    isDaylight?: boolean;
    onChange: (param: FoliumSetting, value: unknown) => void;
}

export const FoliumSelectField: React.FC<FoliumSelectFieldProps> = ({
    param,
    value,
    label,
    labelId,
    language,
    disabled,
    inputClassName,
    inputStyle,
    theme,
    isDaylight,
    onChange,
}) => {
    const options = useMemo(
        () => (param.options ?? []).map((option) => ({
            value: option.value,
            label: resolveFoliumLabel(option.label, language, option.value),
        })),
        [param.options, language],
    );
    return (
        <CustomSelect
            value={resolveFoliumSelectDisplayValue(param, value)}
            options={options}
            ariaLabel={label}
            ariaLabelledBy={labelId}
            disabled={disabled}
            size="compact"
            triggerClassName={inputClassName}
            triggerStyle={inputStyle}
            theme={theme}
            isDaylight={isDaylight}
            onChange={(next) => {
                if (next !== value) onChange(param, next);
            }}
        />
    );
};
