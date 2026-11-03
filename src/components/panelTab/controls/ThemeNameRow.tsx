import React from 'react';
import { ArrowUpDown, Check, Moon, RefreshCw, Sparkle, Sparkles, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import type { ThemeSourceModel } from '../../../hooks/themeControllerState';
import { useThemeSyncAction } from '../../../hooks/useThemeSyncAction';
import { Button } from '../../modal/settings/kit';
import { PanelIconButton } from '../shell/PanelIconButton';
import { Segments } from '../shell/Segments';

// src/components/panelTab/controls/ThemeNameRow.tsx
// The line under the theme source: the name of the theme in use, light or dark, the button that has
// an AI theme made for the playing song, and the button that syncs themes now (there for an AI or a
// custom theme; it comes last, so opening it moves nothing but itself).

interface ThemeNameRowProps {
    theme: Theme;
    themeSourceModel: ThemeSourceModel;
    defaultTheme: Theme;
    daylightTheme: Theme;
    onGenerateAITheme: () => void;
    isGeneratingTheme: boolean;
    canGenerateAITheme: boolean;
    isDaylight: boolean;
    onToggleDaylight: () => void;
}

const ThemeNameRow: React.FC<ThemeNameRowProps> = ({
    theme,
    themeSourceModel,
    defaultTheme,
    daylightTheme,
    onGenerateAITheme,
    isGeneratingTheme,
    canGenerateAITheme,
    isDaylight,
    onToggleDaylight,
}) => {
    const { t } = useTranslation();
    const { themeSyncState, runThemeSync } = useThemeSyncAction();
    const hasSync = themeSourceModel.activeSource !== 'default';

    const formatThemeDisplayName = (name: string) => {
        if (themeSourceModel.activeSource !== 'default') {
            return name;
        }

        return name === defaultTheme.name
            ? t('theme.midnightDefault')
            : (name === daylightTheme.name ? t('theme.daylightDefault') : name);
    };

    return (
        <div className="flex min-h-11 flex-wrap items-center gap-x-3 py-1.5">
            <span className="min-w-0 flex-[1_1_72px] truncate text-[13px] text-[color:var(--st-t2)]">
                {formatThemeDisplayName(themeSourceModel.current.label || theme.name)}
            </span>
            <span className="ml-auto flex max-w-full items-center gap-1.5">
                <Segments
                    size="s"
                    value={isDaylight ? 'light' : 'dark'}
                    onChange={() => onToggleDaylight()}
                    options={[
                        { value: 'light', label: t('options.daylightModeLight'), icon: <Sun size={15} />, iconOnly: true },
                        { value: 'dark', label: t('options.daylightModeDark'), icon: <Moon size={15} />, iconOnly: true },
                    ]}
                />
                <Button
                    icon={themeSourceModel.hasLocalAiTheme && !isGeneratingTheme ? Sparkles : Sparkle}
                    onClick={onGenerateAITheme}
                    disabled={isGeneratingTheme || !canGenerateAITheme}
                >
                    {isGeneratingTheme ? t('ui.generatingTheme') : t('ui.generateAITheme')}
                </Button>
                {/* Opens its width at the row's end when there is a theme to sync. */}
                <span
                    inert={!hasSync}
                    className={`st-t-move grid transition-[grid-template-columns,opacity,margin] ${hasSync ? 'grid-cols-[1fr]' : '-ml-1.5 grid-cols-[0fr] opacity-0'}`}
                >
                    <span className="min-w-0 overflow-hidden">
                        <PanelIconButton
                            size="s"
                            filled
                            label={themeSyncState === 'syncing'
                                ? t('options.syncing')
                                : themeSyncState === 'complete'
                                    ? t('ui.synced')
                                    : t('commandPalette.commands.sync-now.title')}
                            disabled={themeSyncState === 'syncing'}
                            onClick={() => void runThemeSync()}
                        >
                            {themeSyncState === 'syncing' ? (
                                <RefreshCw size={15} className="animate-spin" />
                            ) : themeSyncState === 'complete' ? (
                                <Check size={15} className="text-[color:var(--st-ok)]" strokeWidth={3} />
                            ) : (
                                <ArrowUpDown size={15} />
                            )}
                        </PanelIconButton>
                    </span>
                </span>
            </span>
        </div>
    );
};

export default ThemeNameRow;
