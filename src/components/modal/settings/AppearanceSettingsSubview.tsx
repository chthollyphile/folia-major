import React from 'react';
import { Monitor, Palette, Settings2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DualTheme, Theme, ThemeMode } from '../../../types';

// src/components/modal/settings/AppearanceSettingsSubview.tsx
// Visual settings subview for theme presets, lyric renderer entry, and transparent player background.

type AppearanceSettingsSubviewProps = {
    accentOutlineColor: string;
    bgMode: ThemeMode;
    hasCustomTheme: boolean;
    isCustomThemePreferred: boolean;
    isDaylight: boolean;
    onApplyCustomTheme: () => void;
    onApplyDefaultTheme: () => void;
    onOpenThemePark: () => void;
    onOpenVisPlayground: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    onToggleTransparentPlayerBackground: (enabled: boolean) => void;
    settingsCardClass: string;
    songThemeAutoSwitchEnabled: boolean;
    theme?: Theme;
    themeParkInitialTheme: DualTheme;
    toggleOffBackgroundClass: string;
    transparentPlayerBackground: boolean;
    utilityGhostButtonClass: string;
};

const AppearanceSettingsSubview: React.FC<AppearanceSettingsSubviewProps> = ({
    accentOutlineColor,
    bgMode,
    hasCustomTheme,
    isCustomThemePreferred,
    isDaylight,
    onApplyCustomTheme,
    onApplyDefaultTheme,
    onOpenThemePark,
    onOpenVisPlayground,
    onToggleCustomThemePreferred,
    onToggleSongThemeAutoSwitch,
    onToggleTransparentPlayerBackground,
    settingsCardClass,
    songThemeAutoSwitchEnabled,
    theme,
    themeParkInitialTheme,
    toggleOffBackgroundClass,
    transparentPlayerBackground,
    utilityGhostButtonClass,
}) => {
    const { t } = useTranslation();
    const getAccentOptionStyle = (selected: boolean) => (
        selected
            ? {
                borderColor: accentOutlineColor,
                boxShadow: `inset 0 0 0 1px ${accentOutlineColor}`,
                backgroundColor: isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`,
            }
            : {
                borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.05)',
            }
    );

    return (
        <section>
            <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Sparkles size={14} /> {t('options.visualSettings') || 'Visual Settings'}
            </h3>
            <div className="space-y-4">
                <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.themePresets') || 'Theme Presets'}
                        </div>
                        <button
                            type="button"
                            onClick={onOpenThemePark}
                            className={`shrink-0 w-9 h-9 rounded-full border transition-colors flex items-center justify-center ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                            title={t('options.openThemePark') || '打开 Theme Park'}
                            aria-label={t('options.openThemePark') || '打开 Theme Park'}
                        >
                            <Palette size={16} />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={onApplyDefaultTheme}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                            style={{
                                ...getAccentOptionStyle(bgMode === 'default'),
                                backgroundColor: bgMode === 'default'
                                    ? (isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`)
                                    : (isDaylight ? 'rgba(24, 24, 27, 0.035)' : 'rgba(9, 9, 11, 0.5)'),
                            }}
                        >
                            <div className="w-6 h-6 rounded-full shadow-sm" style={{ background: `linear-gradient(135deg, ${themeParkInitialTheme.light.backgroundColor}, ${themeParkInitialTheme.dark.backgroundColor})`, borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.15)' }} />
                            <span className="text-xs opacity-80" style={{ color: isDaylight ? '#27272a' : '#e4e4e7' }}>{t('options.themePresetsDefault') || 'Default'}</span>
                        </button>
                        <button
                            onClick={onApplyCustomTheme}
                            disabled={!hasCustomTheme}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                ...getAccentOptionStyle(bgMode === 'custom'),
                                backgroundColor: bgMode === 'custom'
                                    ? (isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`)
                                    : (isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.08)'),
                            }}
                        >
                            <div className="w-6 h-6 rounded-full" style={{ background: hasCustomTheme ? `linear-gradient(135deg, ${themeParkInitialTheme.light.accentColor}, ${themeParkInitialTheme.dark.accentColor})` : 'rgba(114,119,134,0.4)' }} />
                            <span className="text-xs opacity-80" style={{ color: 'var(--text-primary)' }}>{t('options.customTheme') || 'Custom'}</span>
                        </button>
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${settingsCardClass}`}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.preferCustomTheme') || '优先使用自定义主题'}
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.preferCustomThemeDesc') || '保存后，后续主题切换会优先保留自定义主题。'}
                            </div>
                        </div>
                        <button
                            onClick={() => hasCustomTheme && onToggleCustomThemePreferred(!isCustomThemePreferred)}
                            disabled={!hasCustomTheme}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!isCustomThemePreferred ? toggleOffBackgroundClass : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
                            style={{ backgroundColor: isCustomThemePreferred ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isCustomThemePreferred ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${settingsCardClass}`}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.autoSwitchSongTheme') || '主题自动切换'}
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.autoSwitchSongThemeDesc') || '当切换到的歌曲曾经生成过 AI 主题的时候，自动应用 AI 主题。'}
                            </div>
                        </div>
                        <button
                            onClick={() => onToggleSongThemeAutoSwitch(!songThemeAutoSwitchEnabled)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!songThemeAutoSwitchEnabled ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: songThemeAutoSwitchEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${songThemeAutoSwitchEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>

                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.lyricsRenderer') || '歌词渲染'}
                        </div>
                        <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.lyricsRendererDesc') || '选择播放页使用的歌词渲染模式。'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onOpenVisPlayground}
                        className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors ${utilityGhostButtonClass}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <Settings2 size={16} />
                        <span>{t('options.lyricsAnimationAdjust') || '歌词动画样式'}</span>
                    </button>
                </div>

                <div className={`p-4 rounded-xl border space-y-3 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                <Monitor size={14} />
                                {t('options.transparentPlayerBackground') || '播放页透明背景'}
                            </div>
                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.transparentPlayerBackgroundDesc') || '仅对播放页生效。开启后会切换到透明窗口模式，适合 OBS 浏览器源或抠像叠加场景。'}
                            </div>
                        </div>
                        <button
                            onClick={() => onToggleTransparentPlayerBackground(!transparentPlayerBackground)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!transparentPlayerBackground ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: transparentPlayerBackground ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${transparentPlayerBackground ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default AppearanceSettingsSubview;
