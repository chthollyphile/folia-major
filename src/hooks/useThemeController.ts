import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { generateThemeFromLyrics } from '../services/gemini';
import { saveToCache } from '../services/db';
import { DualTheme, LyricData, SongResult, Theme } from '../types';
import { getCachedThemeState, getLastDualTheme } from '../services/themeCache';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import {
    buildThemeFallback,
    getBaseThemeForMode,
    resolveBgModeTheme,
    resolveDaylightToggleTheme
} from './themeControllerState';

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
    const getBaseTheme = () => getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });

    const [theme, setTheme] = useState<Theme>(() => getBaseTheme());
    const [aiTheme, setAiTheme] = useState<DualTheme | null>(null);
    const [bgMode, setBgMode] = useState<'default' | 'ai'>('default');
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);

    useEffect(() => {
        if (!aiTheme && bgMode === 'default') {
            setTheme(getBaseTheme());
        }
    }, [aiTheme, bgMode, isDaylight, daylightTheme, defaultTheme]);

    const handleToggleDaylight = (isLight: boolean) => {
        setDaylightPreference(isLight);
        setTheme(prev => resolveDaylightToggleTheme({
            aiTheme,
            bgMode,
            isLight,
            defaultTheme,
            daylightTheme,
            previousTheme: prev
        }));
    };

    const handleBgModeChange = (mode: 'default' | 'ai') => {
        setBgMode(mode);
        setTheme(prev => resolveBgModeTheme({
            mode,
            aiTheme,
            isDaylight,
            defaultTheme,
            daylightTheme,
            previousTheme: prev
        }));
    };

    const handleResetTheme = () => {
        setTheme(getBaseTheme());
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
        setAiTheme(null);
        setTheme(legacyTheme);
        setBgMode('ai');
    };

    const applyThemeFallback = () => {
        setAiTheme(null);
        setTheme(buildThemeFallback(getBaseTheme()));
        setBgMode('default');
    };

    const restoreCachedThemeForSong = async (
        songId: number,
        options?: { allowLastUsedFallback?: boolean; preserveCurrentOnMiss?: boolean }
    ) => {
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

        if (options?.preserveCurrentOnMiss ?? true) {
            return 'none' as const;
        }

        applyThemeFallback();
        return 'none' as const;
    };

    const generateAITheme = async (lyrics: LyricData | null, currentSong: SongResult | null) => {
        if (isGeneratingTheme) return;

        setIsGeneratingTheme(true);
        setStatusMsg({ type: 'info', text: t('status.generatingTheme') });
        try {
            const allText = lyrics?.lines.map(line => line.fullText).join('\n').trim() || '';
            const songTitle = currentSong?.name?.trim() || lyrics?.title?.trim() || '';
            const isPureMusic = Boolean(currentSong?.isPureMusic) || isPureMusicLyricText(allText);
            const promptText = (isPureMusic ? songTitle : allText) || allText;

            if (!promptText) {
                setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
                return;
            }

            const dualTheme = await generateThemeFromLyrics(promptText, {
                isPureMusic,
                songTitle: songTitle || undefined,
            });
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
