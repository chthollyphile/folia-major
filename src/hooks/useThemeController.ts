import { useState, type Dispatch, type SetStateAction } from 'react';
import { generateThemeFromLyrics } from '../services/gemini';
import { saveToCache } from '../services/db';
import { DualTheme, LyricData, SongResult, Theme } from '../types';
import { getCachedThemeState, getLastDualTheme } from '../services/themeCache';

type StatusSetter = Dispatch<SetStateAction<{ type: 'error' | 'success' | 'info', text: string; } | null>>;

export function useThemeController({
    defaultTheme,
    daylightTheme,
    isDaylight,
    setDaylightPreference,
    setStatusMsg,
    t,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
    setDaylightPreference: (enabled: boolean) => void;
    setStatusMsg: StatusSetter;
    t: (key: string, options?: Record<string, unknown>) => string;
}) {
    const [theme, setTheme] = useState<Theme>(defaultTheme);
    const [aiTheme, setAiTheme] = useState<DualTheme | null>(null);
    const [bgMode, setBgMode] = useState<'default' | 'ai'>('ai');
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);

    const handleToggleDaylight = (isLight: boolean) => {
        setDaylightPreference(isLight);

        if (aiTheme) {
            const selectedTheme = isLight ? aiTheme.light : aiTheme.dark;
            setTheme(prev => {
                if (bgMode === 'default') {
                    const baseTheme = isLight ? daylightTheme : defaultTheme;
                    return {
                        ...selectedTheme,
                        backgroundColor: baseTheme.backgroundColor,
                        wordColors: prev.wordColors,
                        lyricsIcons: prev.lyricsIcons
                    };
                }

                return {
                    ...selectedTheme,
                    wordColors: prev.wordColors,
                    lyricsIcons: prev.lyricsIcons
                };
            });
            return;
        }

        setTheme(isLight ? daylightTheme : defaultTheme);
    };

    const handleBgModeChange = (mode: 'default' | 'ai') => {
        setBgMode(mode);

        if (mode === 'default') {
            const baseTheme = isDaylight ? daylightTheme : defaultTheme;
            if (aiTheme) {
                const selectedAiTheme = isDaylight ? aiTheme.light : aiTheme.dark;
                setTheme(prev => ({
                    ...selectedAiTheme,
                    backgroundColor: baseTheme.backgroundColor,
                    wordColors: prev.wordColors,
                    lyricsIcons: prev.lyricsIcons
                }));
            } else {
                setTheme(baseTheme);
            }
            return;
        }

        if (aiTheme) {
            const selectedAiTheme = isDaylight ? aiTheme.light : aiTheme.dark;
            setTheme(prev => ({
                ...selectedAiTheme,
                wordColors: prev.wordColors,
                lyricsIcons: prev.lyricsIcons
            }));
        }
    };

    const handleResetTheme = () => {
        setTheme(isDaylight ? daylightTheme : defaultTheme);
        setAiTheme(null);
        setBgMode('default');
    };

    const handleSetThemePreset = (preset: 'midnight' | 'daylight') => {
        const isLight = preset === 'daylight';
        handleToggleDaylight(isLight);
        setStatusMsg({ type: 'success', text: `默认主题: ${isLight ? 'Daylight' : 'Midnight'} Default` });
    };

    const applyDualTheme = (dualTheme: DualTheme) => {
        const selectedTheme = isDaylight ? dualTheme.light : dualTheme.dark;
        setTheme(selectedTheme);
        setAiTheme(dualTheme);
        setBgMode('ai');
    };

    const applyLegacyTheme = (legacyTheme: Theme) => {
        setTheme(legacyTheme);
        setBgMode('ai');
    };

    const applyThemeFallback = () => {
        setTheme(prev => ({
            ...prev,
            wordColors: [],
            lyricsIcons: []
        }));
        setBgMode('default');
    };

    const restoreCachedThemeForSong = async (songId: number, options?: { allowLastUsedFallback?: boolean }) => {
        const cachedTheme = await getCachedThemeState(songId);

        if (cachedTheme.kind === 'dual') {
            applyDualTheme(cachedTheme.theme);
            return 'dual' as const;
        }

        if (cachedTheme.kind === 'legacy') {
            applyLegacyTheme(cachedTheme.theme);
            return 'legacy' as const;
        }

        if (options?.allowLastUsedFallback) {
            const lastDualTheme = await getLastDualTheme();
            if (lastDualTheme) {
                applyDualTheme(lastDualTheme);
                setTheme(prev => ({
                    ...prev,
                    wordColors: [],
                    lyricsIcons: []
                }));
                return 'fallback-dual' as const;
            }
        }

        applyThemeFallback();
        return 'none' as const;
    };

    const generateAITheme = async (lyrics: LyricData | null, currentSong: SongResult | null) => {
        if (!lyrics || isGeneratingTheme) return;

        setIsGeneratingTheme(true);
        setStatusMsg({ type: 'info', text: t('status.generatingTheme') });
        try {
            const allText = lyrics.lines.map(line => line.fullText).join('\n');
            const dualTheme = await generateThemeFromLyrics(allText);
            const selectedTheme = isDaylight ? dualTheme.light : dualTheme.dark;

            setTheme(selectedTheme);
            setAiTheme(dualTheme);
            setBgMode('ai');
            setStatusMsg({ type: 'success', text: t('status.themeApplied', { themeName: selectedTheme.name }) });

            if (currentSong) {
                saveToCache(`dual_theme_${currentSong.id}`, dualTheme);
            }
            saveToCache('last_dual_theme', dualTheme);
        } catch (error: any) {
            console.error(error);
            const errMsg = error.message || '';
            if (errMsg.includes('not configured')) {
                setStatusMsg({ type: 'error', text: t('status.missingApiKey') || 'Please configure AI API Key in Settings' });
            } else {
                setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
            }
        } finally {
            setIsGeneratingTheme(false);
        }
    };

    return {
        theme,
        setTheme,
        aiTheme,
        setAiTheme,
        bgMode,
        setBgMode,
        isGeneratingTheme,
        handleToggleDaylight,
        handleBgModeChange,
        handleResetTheme,
        handleSetThemePreset,
        applyDualTheme,
        applyLegacyTheme,
        applyThemeFallback,
        restoreCachedThemeForSong,
        generateAITheme,
    };
}
