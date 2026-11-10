import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { ColorPicker, ColorWells, Segmented } from '../settings/kit';
import { COLOR_FIELDS, type EditableColorKey, type EditableMode } from './themeParkDraft';

// src/components/modal/theme-park/ThemeColorParts.tsx
// The colour task of a theme, as both theme editors draw it: the switch between the light and the
// dark side, the four colours as wells, and one picker for the chosen well, captioned with that
// colour's name and what it colours. Theme Park and the quick editor lay the three out themselves.

const MODES: EditableMode[] = ['light', 'dark'];

export const ThemeModeSwitch: React.FC<{
    mode: EditableMode;
    onChange: (mode: EditableMode) => void;
}> = ({ mode, onChange }) => {
    const { t } = useTranslation();

    return (
        <Segmented
            fill
            value={mode}
            options={MODES.map(value => ({ value, label: t(value === 'light' ? 'options.lightTheme' : 'options.darkTheme') }))}
            onChange={onChange}
        />
    );
};

type ThemeColorWellsProps = {
    /** The side being edited. */
    theme: Theme;
    activeKey: EditableColorKey;
    onChange: (key: EditableColorKey) => void;
    /** One well under the other, for a narrow column. */
    stacked?: boolean;
};

export const ThemeColorWells: React.FC<ThemeColorWellsProps> = ({ theme, activeKey, onChange, stacked }) => {
    const { t } = useTranslation();

    return (
        <ColorWells
            value={activeKey}
            wells={COLOR_FIELDS.map(field => ({ id: field.key, label: t(field.labelKey), color: theme[field.key] }))}
            onChange={onChange}
            stacked={stacked}
        />
    );
};

type ThemeColorPickerCardProps = {
    /** The side being edited. */
    theme: Theme;
    activeKey: EditableColorKey;
    recommendedColors: ReadonlyArray<string>;
    /** Every colour a drag passes; the editor writes them at its own pace. */
    onDrag: (color: string) => void;
    /** A colour that was chosen; written at once. */
    onChange: (color: string) => void;
    areaHeight?: number;
};

export const ThemeColorPickerCard: React.FC<ThemeColorPickerCardProps> = ({ theme, activeKey, recommendedColors, onDrag, onChange, areaHeight }) => {
    const { t } = useTranslation();
    const field = COLOR_FIELDS.find(entry => entry.key === activeKey) ?? COLOR_FIELDS[0];

    return (
        <div className="min-w-0 rounded-xl bg-[var(--st-card)] p-3 shadow-[0_0_0_1px_var(--st-line)]">
            <div className="mb-3 flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-[13px] font-semibold leading-5 text-[color:var(--st-t1)]">{t(field.labelKey)}</span>
                <span className="min-w-0 truncate text-xs text-[color:var(--st-t2)]">{t(field.descKey)}</span>
            </div>
            <ColorPicker
                value={theme[activeKey]}
                onDrag={onDrag}
                onChange={onChange}
                swatches={recommendedColors}
                swatchesLabel={t('options.aiThemeQuickEditRecommendedColors')}
                label={t(field.labelKey)}
                areaHeight={areaHeight}
            />
        </div>
    );
};
