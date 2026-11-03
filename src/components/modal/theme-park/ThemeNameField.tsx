import React from 'react';
import { useTranslation } from 'react-i18next';
import { FIELD_CLASS } from '../settings/kit';
import { isThemeNameValid, THEME_NAME_MAX_LENGTH } from './themeParkDraft';

// src/components/modal/theme-park/ThemeNameField.tsx
// The name of one side of a theme: a field of one line that holds no more than a name may have and
// wears the error border while the name is not one a theme can be saved with.

type ThemeNameFieldProps = {
    value: string;
    onChange: (name: string) => void;
    /** The field's width. */
    className?: string;
};

export const ThemeNameField: React.FC<ThemeNameFieldProps> = ({ value, onChange, className = 'w-full' }) => {
    const { t } = useTranslation();
    const invalid = !isThemeNameValid(value);

    return (
        <input
            type="text"
            value={value}
            maxLength={THEME_NAME_MAX_LENGTH}
            aria-label={t('options.themeName')}
            aria-invalid={invalid || undefined}
            placeholder={t('ui.enterThemeName')}
            spellCheck={false}
            onChange={(event) => onChange(event.target.value)}
            className={`${FIELD_CLASS} px-2.5 ${className}${invalid ? ' !border-[var(--st-err)]' : ''}`}
        />
    );
};

export default ThemeNameField;
