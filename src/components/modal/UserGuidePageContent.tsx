import React from 'react';
import { Command, Keyboard, Lock, Palette, Search, Sparkles, WandSparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CommandPaletteCommand } from '../command-palette/types';
import { UserGuideFeatureCard } from './UserGuideFeatureCard';
import { UserGuideTipCard } from './UserGuideTipCard';
import { PLAYER_PAGE_SHORTCUTS, type GuidePage, type UserGuideShortcut } from './userGuideContent';
import { NewFeaturesIntro } from './NewFeaturesIntro';
import foliaIcon from '../../../build/icon.png';

// src/components/modal/UserGuidePageContent.tsx

type UserGuideClassNames = {
    textPrimary: string;
    textSecondary: string;
    cardBg: string;
    keyBg: string;
    tipCardBg: string;
    iconTileBg: string;
};

type UserGuidePageContentProps = {
    page: GuidePage;
    pageCount: number;
    isDaylight: boolean;
    classes: UserGuideClassNames;
    guideCommands: CommandPaletteCommand[];
};

export const UserGuidePageContent: React.FC<UserGuidePageContentProps> = ({
    page,
    pageCount,
    isDaylight,
    classes,
    guideCommands,
}) => {
    const { t } = useTranslation();
    const {
        textPrimary,
        textSecondary,
        cardBg,
        keyBg,
        tipCardBg,
        iconTileBg,
    } = classes;
    const tipCardClasses = { iconTileBg, tipCardBg, textPrimary, textSecondary };
    const featureCardClasses = { iconTileBg, cardBg, textPrimary, textSecondary };

    const renderShortcutKeys = (shortcut: UserGuideShortcut) => (
        <div className="flex items-center gap-1.5 shrink-0">
            {shortcut.keys.map((key, index) => (
                <React.Fragment key={`${shortcut.id}-${key}`}>
                    {index > 0 && <span className={`text-xs ${textSecondary}`}>{shortcut.separator ?? '/'}</span>}
                    <kbd className={`px-2.5 py-1 rounded-md text-xs font-mono shadow-sm ${keyBg}`}>{key}</kbd>
                </React.Fragment>
            ))}
        </div>
    );
    if (page === 1) {
        return (
            <>
                <NewFeaturesIntro 
                    isDaylight={isDaylight} 
                    classes={{ textPrimary, textSecondary, tipCardBg, iconTileBg, cardBg }} 
                />
            </>
        );
    }

    if (page === 2) {
        return (
            <>
                <UserGuideTipCard
                    {...tipCardClasses}
                    icon={Lock}
                    iconClassName={isDaylight ? 'text-amber-500' : 'text-amber-300'}
                    title={t('userGuide.clickThrough.title', 'Click-through recovery')}
                    description={t('userGuide.clickThrough.desc', 'When click-through is enabled, you can switch it off from the system tray icon if the window controls are hidden or hard to reach.')}
                />
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <UserGuideFeatureCard
                        {...featureCardClasses}
                        icon={Lock}
                        iconClassName={isDaylight ? 'text-amber-500' : 'text-amber-300'}
                        title={t('userGuide.clickThrough.trayTitle', 'Use the tray icon')}
                        description={t('userGuide.clickThrough.trayDesc', 'Right-click the Folia tray icon and choose the click-through option to enable or disable it.')}
                    />
                    <UserGuideFeatureCard
                        {...featureCardClasses}
                        icon={Command}
                        iconClassName={isDaylight ? 'text-blue-500' : 'text-blue-400'}
                        title={t('userGuide.clickThrough.lockTitle', 'Use the lock button')}
                        description={t('userGuide.clickThrough.lockDesc', 'Move to the top titlebar hotspot to reveal the lock button, then click it to turn click-through off.')}
                    />
                </div>
            </>
        );
    }

    if (page === 3) {
        return (
            <>
                <UserGuideTipCard
                    {...tipCardClasses}
                    icon={Search}
                    iconClassName={isDaylight ? 'text-purple-500' : 'text-purple-400'}
                    title={t('userGuide.typeToSearch.title', 'Instant Search')}
                    description={t('userGuide.typeToSearch.desc', 'Press any key in a song list to instantly start searching.')}
                />
                <div className="mt-5 space-y-3">
                    <div className={`p-4 rounded-xl transition-colors ${cardBg}`}>
                        <div className={`font-bold text-sm mb-1 ${textPrimary}`}>
                            {t('userGuide.posterSearch.entryTitle', 'Start from a poster wall')}
                        </div>
                        <div className={`text-xs ${textSecondary} leading-relaxed`}>
                            {t('userGuide.posterSearch.entryDesc', 'When a song poster wall is focused, type letters, numbers, or Chinese characters to search the current list.')}
                        </div>
                    </div>
                    <div className={`p-4 rounded-xl transition-colors ${cardBg}`}>
                        <div className={`font-bold text-sm mb-1 ${textPrimary}`}>
                            {t('userGuide.posterSearch.escapeTitle', 'Close search')}
                        </div>
                        <div className="flex items-center justify-between gap-4">
                            <div className={`text-xs ${textSecondary} leading-relaxed`}>
                                {t('userGuide.posterSearch.escapeDesc', 'Press Esc to close the poster-wall search panel.')}
                            </div>
                            <kbd className={`px-2.5 py-1 rounded-md text-xs font-mono shadow-sm ${keyBg}`}>Esc</kbd>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    if (page === 4) {
        return (
            <>
                <UserGuideTipCard
                    {...tipCardClasses}
                    icon={Keyboard}
                    iconClassName={isDaylight ? 'text-blue-500' : 'text-blue-400'}
                    title={t('userGuide.shortcutsPageTitle', 'Player shortcuts')}
                    description={t('userGuide.shortcutsPageSubtitle', 'Keyboard controls available on the player page.')}
                />
                <div className="mt-5">
                    <ul className="space-y-2 text-sm">
                        {PLAYER_PAGE_SHORTCUTS.map(shortcut => (
                            <li key={shortcut.id} className={`flex items-center justify-between gap-4 p-3.5 rounded-xl transition-colors ${cardBg}`}>
                                <span className={`font-medium min-w-0 ${textPrimary}`}>{t(shortcut.titleKey, shortcut.fallback)}</span>
                                {renderShortcutKeys(shortcut)}
                            </li>
                        ))}
                    </ul>
                </div>
            </>
        );
    }

    if (page === 5) {
        return (
            <>
                <UserGuideTipCard
                    {...tipCardClasses}
                    icon={Command}
                    iconClassName={isDaylight ? 'text-blue-500' : 'text-blue-400'}
                    title={t('userGuide.commandPalette.title', 'Command Palette')}
                    description={t('userGuide.commandPalette.desc', 'Press the "s" key on the playback page to open the Command Palette and access commands quickly.')}
                />
                <div className="mt-5">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {guideCommands.map(cmd => (
                            <div key={cmd.id} className={`p-3.5 rounded-xl transition-colors ${cardBg}`}>
                                <div className={`font-bold text-sm mb-1 ${textPrimary}`}>{t(`commandPalette.commands.${cmd.id}.title`, cmd.title)}</div>
                                <div className={`text-xs ${textSecondary} leading-relaxed`}>{t(`commandPalette.commands.${cmd.id}.description`, cmd.description)}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </>
        );
    }

    if (page === 6) {
        return (
            <>
                <UserGuideTipCard
                    {...tipCardClasses}
                    icon={Palette}
                    iconClassName={isDaylight ? 'text-rose-500' : 'text-rose-300'}
                    title={t('userGuide.theme.title', 'Color themes')}
                    description={t('userGuide.theme.desc', 'Customize Folia with your own light and dark color themes, or generate an AI theme from the current song.')}
                />
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <UserGuideFeatureCard
                        {...featureCardClasses}
                        icon={Palette}
                        iconClassName={isDaylight ? 'text-rose-500' : 'text-rose-300'}
                        title={t('options.openThemePark', 'Open Theme Park')}
                        description={t('userGuide.theme.customDesc', 'Open Theme Park from visual settings or the command palette to edit and save custom light and dark colors.')}
                    />
                    <UserGuideFeatureCard
                        {...featureCardClasses}
                        icon={WandSparkles}
                        iconClassName={isDaylight ? 'text-purple-500' : 'text-purple-300'}
                        title={t('ui.generateAITheme', 'Generate AI Theme')}
                        description={t('userGuide.theme.aiDesc', 'When AI theme settings are configured, Folia can create song-aware colors and optionally auto-apply cached song themes.')}
                    />
                </div>
            </>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-[320px] text-center">
            <div className={`w-24 h-24 rounded-3xl ${isDaylight ? 'bg-black/[0.03]' : 'bg-white/5'} border ${isDaylight ? 'border-black/10' : 'border-white/10'} flex items-center justify-center mb-6 shadow-lg`}>
                <img src={foliaIcon} alt="Folia" className="w-16 h-16" />
            </div>
            <h2 className={`text-3xl font-bold mb-3 ${textPrimary}`}>
                {t('userGuide.ready.title', 'Selamat Menggunakan')}
            </h2>
            <p className={`text-sm ${textSecondary} max-w-xs leading-relaxed`}>
                {t('userGuide.ready.subtitle', 'Nikmati perjalanan musik Anda dengan Folia.')}
            </p>
        </div>
    );
};
