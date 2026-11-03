import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Segmented } from '../settings/kit';
import type { ThemeEditTarget } from './themeParkDraft';

// src/components/modal/theme-park/ThemeParkHeader.tsx
// What Theme Park puts into its window's title bar, beside the back button and the title the
// window shell draws: which theme the session is editing (AI or custom) with a line that says so,
// and at the bar's end the session reset and the save action, whose label follows the chosen target.

const TARGETS: Array<{ id: ThemeEditTarget; labelKey: string; }> = [
    { id: 'ai', labelKey: 'theme.targetAiTheme' },
    { id: 'custom', labelKey: 'theme.targetCustomTheme' },
];

type ThemeParkHeaderSlotProps = {
    target: ThemeEditTarget;
    targetHint: string;
    onTargetChange: (target: ThemeEditTarget) => void;
};

/** After the title: the target switch and its hint. The hint takes the room that is left and is cut where it ends. */
export const ThemeParkHeaderSlot: React.FC<ThemeParkHeaderSlotProps> = ({ target, targetHint, onTargetChange }) => {
    const { t } = useTranslation();

    return (
        <>
            <Segmented
                value={target}
                options={TARGETS.map(({ id, labelKey }) => ({ value: id, label: t(labelKey) }))}
                onChange={onTargetChange}
            />
            <span className="ml-1 min-w-0 flex-1 truncate text-xs text-[color:var(--st-t3)]">{targetHint}</span>
        </>
    );
};

type ThemeParkHeaderActionsProps = {
    target: ThemeEditTarget;
    canSave: boolean;
    onReset: () => void;
    onSave: () => void;
};

/** At the bar's end: reset and save. */
export const ThemeParkHeaderActions: React.FC<ThemeParkHeaderActionsProps> = ({ target, canSave, onReset, onSave }) => {
    const { t } = useTranslation();

    return (
        <>
            <Button onClick={onReset}>{t('ui.resetToDefaultTheme')}</Button>
            <Button variant="primary" onClick={onSave} disabled={!canSave}>
                {t(target === 'custom' ? 'options.saveAndApplyCustomTheme' : 'options.aiThemeQuickEditSave')}
            </Button>
        </>
    );
};
