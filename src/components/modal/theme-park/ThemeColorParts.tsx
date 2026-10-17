import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { ColorPicker, ColorWells, Segmented, Select } from '../settings/kit';
import { useBuiltinThemeSlotStore } from '../../../stores/useBuiltinThemeSlotStore';
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

// How many of the recommended colours the "take the Nth" list offers. The cover's own palette leads
// the list, so the first entries are the cover's dominant colours; a few are enough to reach them.
const RECOMMENDED_PICK_COUNT = 6;

export const ThemeColorPickerCard: React.FC<ThemeColorPickerCardProps> = ({ theme, activeKey, recommendedColors, onDrag, onChange, areaHeight }) => {
    const { t } = useTranslation();
    const field = COLOR_FIELDS.find(entry => entry.key === activeKey) ?? COLOR_FIELDS[0];
    const slotPrefs = useBuiltinThemeSlotStore(state => state.slotPrefs);
    const setSlotPref = useBuiltinThemeSlotStore(state => state.setSlotPref);
    // The pick list writes the Nth recommended colour straight into the selected slot and remembers
    // the choice, so a theme generated later from the cover reads the same slot from the same place.
    // The cover's dominant colours come first, so "1" and "2" are the two the report calls most accurate.
    const recommendedOptions: ReadonlyArray<{ value: string; label: string }> = React.useMemo(() => {
        const offered = recommendedColors.slice(0, RECOMMENDED_PICK_COUNT);
        return [
            { value: '__auto__', label: t('options.themeRecommendedAuto') },
            ...offered.map((_color, index) => ({ value: String(index + 1), label: t('options.themeRecommendedNth', { n: index + 1 }) })),
        ];
    }, [recommendedColors, t]);
    // Which position the selected slot is pinned to, if any; "automatic" when it is not pinned.
    const currentPosition = slotPrefs[activeKey];
    const currentValue = currentPosition !== undefined && currentPosition >= 1 && currentPosition <= RECOMMENDED_PICK_COUNT
        ? String(currentPosition)
        : '__auto__';

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
            <div className="mt-3 flex items-center gap-2">
                <span className="shrink-0 text-xs leading-[18px] text-[color:var(--st-t3)]">{t('options.themeRecommendedFrom')}</span>
                <div className="min-w-0 flex-1">
                    <Select
                        value={currentValue}
                        options={recommendedOptions}
                        onChange={(value) => {
                            if (value === '__auto__') {
                                setSlotPref(activeKey, null);
                                return;
                            }
                            const position = Number(value);
                            if (Number.isInteger(position) && position >= 1 && position <= RECOMMENDED_PICK_COUNT) {
                                setSlotPref(activeKey, position);
                                const color = recommendedColors[position - 1];
                                if (color) onChange(color);
                            }
                        }}
                        name={t('options.themeRecommendedFrom')}
                    />
                </div>
            </div>
        </div>
    );
};
