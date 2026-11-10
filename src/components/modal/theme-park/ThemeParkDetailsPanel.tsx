import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DualTheme } from '../../../types';
import { FIELD_SURFACE_CLASS, Group, Row, type SettingsGroupDef } from '../settings/kit';
import ThemeNameField from './ThemeNameField';
import {
    isDualThemeNameValid,
    THEME_DESCRIPTION_MAX_LENGTH,
    type EditableMode,
} from './themeParkDraft';

// src/components/modal/theme-park/ThemeParkDetailsPanel.tsx
// Details tab: the per-mode name and atmosphere description that the quick editor could only
// partly reach (name) and that nothing could edit before (description). While a name is missing
// the tab says so under the two groups: that is what keeps the save button off.

type ThemeParkDetailsPanelProps = {
    draft: DualTheme;
    onFieldChange: (mode: EditableMode, patch: { name?: string; description?: string; }) => void;
};

const GROUPS: Array<{ mode: EditableMode; def: SettingsGroupDef; }> = [
    { mode: 'light', def: { id: 'theme-park-light', titleKey: 'options.lightTheme' } },
    { mode: 'dark', def: { id: 'theme-park-dark', titleKey: 'options.darkTheme' } },
];

const ThemeParkDetailsPanel: React.FC<ThemeParkDetailsPanelProps> = ({ draft, onFieldChange }) => {
    const { t } = useTranslation();

    return (
        <>
            {GROUPS.map(({ mode, def }) => {
                const description = draft[mode].description ?? '';

                return (
                    <Group key={mode} def={def}>
                        <Row label={t('options.themeName')}>
                            <ThemeNameField
                                value={draft[mode].name ?? ''}
                                onChange={name => onFieldChange(mode, { name })}
                                className="w-[168px]"
                            />
                        </Row>
                        <Row
                            label={t('theme.themeDescription')}
                            below={(
                                <textarea
                                    value={description}
                                    onChange={(event) => onFieldChange(mode, { description: event.target.value })}
                                    maxLength={THEME_DESCRIPTION_MAX_LENGTH}
                                    rows={3}
                                    aria-label={t('theme.themeDescription')}
                                    placeholder={t('theme.themeDescriptionPlaceholder')}
                                    className={`${FIELD_SURFACE_CLASS} st-scroll block w-full resize-none px-2.5 py-2 text-[13px] leading-5`}
                                />
                            )}
                        >
                            <span className="text-[13px] tabular-nums text-[color:var(--st-t2)]">
                                {description.length} / {THEME_DESCRIPTION_MAX_LENGTH}
                            </span>
                        </Row>
                    </Group>
                );
            })}

            {!isDualThemeNameValid(draft) && (
                <p role="alert" className="mx-1 mt-2 text-xs leading-[18px] text-[color:var(--st-err)]">{t('theme.themeNameRequired')}</p>
            )}
        </>
    );
};

export default ThemeParkDetailsPanel;
