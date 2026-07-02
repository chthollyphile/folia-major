import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { generateThemeFromLyrics, isMissingAiApiKeyError } from '../services/gemini';
import { saveToCache } from '../services/db';
import { DualTheme, LyricData, SongResult, StatusMessage, Theme, ThemeMode } from '../types';
import { getCachedThemeState, getLastDualTheme, getLastLegacyTheme, type ThemeCacheSongKey } from '../services/themeCache';
import {
    applyStoredAnimationIntensityToDualTheme,
    applyStoredAnimationIntensityToTheme,
    isThemeAnimationIntensity,
    readStoredLastAppliedThemePointer,
    readStoredThemeAutoGenerateEnabled,
    readStoredThemeAutoSwitchEnabled,
    resolveCustomThemePreferenceChange,
    resolveSongThemeAutoGenerateChange,
    resolveSongThemeAutoSwitchChange,
    saveStoredAnimationIntensity,
    saveStoredLastAppliedThemePointer,
    saveStoredThemeAutoGenerateEnabled,
    saveStoredThemeAutoSwitchEnabled,
    type ThemePreferenceSwitchState,
} from '../services/themePreferences';
import { FALLBACK_AI_DUAL_THEME, sanitizeDualTheme, sanitizeTheme } from '../services/themeSanitizer';
import { extractColors } from '../utils/colorExtractor';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import {
    buildBuiltinDualTheme,
    getBaseThemeForMode,
    resolveBgModeTheme,
} from './themeControllerState';

type StatusSetter = Dispatch<SetStateAction<StatusMessage | null>>;
export type GenerateAIThemeOptions = {
    source?: 'manual' | 'auto';
    shouldApply?: () => boolean;
};

export type GenerateAIThemeResult =
    | { status: 'generated'; applied: boolean }
    | { status: 'skipped'; reason: 'in-flight' | 'empty-prompt' }
    | { status: 'failed' };

const CUSTOM_DUAL_THEME_KEY = 'custom_dual_theme';
const CUSTOM_THEME_PREFERRED_KEY = 'custom_theme_preferred';

const sanitizeCustomTheme = (
    theme: Theme,
    fallbackName: string,
    fallbackTheme: Theme,
): Theme => {
    const sanitized = sanitizeTheme(theme, {
        ...fallbackTheme,
        name: fallbackName,
        description: '',
        wordColors: [],
        lyricsIcons: [],
        provider: 'Custom',
    });

    return {
        ...sanitized,
        name: sanitized.name?.trim() || fallbackName,
        description: sanitized.description || '',
        provider: sanitized.provider || 'Custom',
    };
};

const sanitizeCustomDualTheme = (dualTheme: DualTheme): DualTheme => ({
    light: sanitizeCustomTheme(dualTheme.light, 'Theme Park Light', FALLBACK_AI_DUAL_THEME.light),
    dark: sanitizeCustomTheme(dualTheme.dark, 'Theme Park Dark', FALLBACK_AI_DUAL_THEME.dark),
});

const isValidTheme = (value: unknown): value is Theme => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const candidate = value as Partial<Theme>;
    return typeof candidate.name === 'string'
        && typeof candidate.backgroundColor === 'string'
        && typeof candidate.primaryColor === 'string'
        && typeof candidate.accentColor === 'string'
        && typeof candidate.secondaryColor === 'string'
        && (candidate.fontStyle === 'sans' || candidate.fontStyle === 'serif' || candidate.fontStyle === 'mono')
        && (candidate.animationIntensity === 'calm' || candidate.animationIntensity === 'normal' || candidate.animationIntensity === 'chaotic');
};

const readStoredCustomTheme = (): DualTheme | null => {
    const saved = localStorage.getItem(CUSTOM_DUAL_THEME_KEY);
    if (!saved) {
        return null;
    }

    try {
        const parsed = JSON.parse(saved) as Partial<DualTheme>;
        if (!isValidTheme(parsed.light) || !isValidTheme(parsed.dark)) {
            return null;
        }

        return applyStoredAnimationIntensityToDualTheme(sanitizeCustomDualTheme({
            light: parsed.light,
            dark: parsed.dark,
        }));
    } catch {
        return null;
    }
};

const readStoredCustomPreferred = () => localStorage.getItem(CUSTOM_THEME_PREFERRED_KEY) === 'true';

const getSelectedDualTheme = (dualTheme: DualTheme, isDaylight: boolean) => (
    isDaylight ? dualTheme.light : dualTheme.dark
);

export function useThemeController({
    defaultTheme,
    daylightTheme,
    isDaylight,
    setDaylightPreference,
    setStatusMsg,
    coverUrl,
    t,
}: {
    defaultTheme: Theme;
    daylightTheme: Theme;
    isDaylight: boolean;
    setDaylightPreference: (enabled: boolean) => void;
    setStatusMsg: StatusSetter;
    coverUrl?: string | null;
    t: (key: string, options?: Record<string, unknown>) => string;
}) {
    const getBaseTheme = () => getBaseThemeForMode({ defaultTheme, daylightTheme, isDaylight });
    const initialCustomTheme = useMemo(readStoredCustomTheme, []);
    const initialThemePreferenceState = useMemo<ThemePreferenceSwitchState>(() => {
        const customPreferred = Boolean(initialCustomTheme && readStoredCustomPreferred());
        if (customPreferred) {
            return {
                isCustomThemePreferred: true,
                songThemeAutoSwitchEnabled: false,
                songThemeAutoGenerateEnabled: false,
            };
        }

        const autoSwitchEnabled = readStoredThemeAutoSwitchEnabled();
        return {
            isCustomThemePreferred: false,
            songThemeAutoSwitchEnabled: autoSwitchEnabled,
            songThemeAutoGenerateEnabled: autoSwitchEnabled && readStoredThemeAutoGenerateEnabled(),
        };
    }, [initialCustomTheme]);

    const [theme, setTheme] = useState<Theme>(() => applyStoredAnimationIntensityToTheme(getBaseTheme()));
    const [aiTheme, setAiTheme] = useState<DualTheme | null>(null);
    const [legacyTheme, setLegacyTheme] = useState<Theme | null>(null);
    const [customTheme, setCustomTheme] = useState<DualTheme | null>(initialCustomTheme);
    const [isCustomThemePreferred, setIsCustomThemePreferred] = useState(initialThemePreferenceState.isCustomThemePreferred);
    const [songThemeAutoSwitchEnabled, setSongThemeAutoSwitchEnabled] = useState(initialThemePreferenceState.songThemeAutoSwitchEnabled);
    const [songThemeAutoGenerateEnabled, setSongThemeAutoGenerateEnabled] = useState(initialThemePreferenceState.songThemeAutoGenerateEnabled);
    const [bgMode, setBgMode] = useState<ThemeMode>(() => (
        initialCustomTheme && initialThemePreferenceState.isCustomThemePreferred ? 'custom' : 'default'
    ));
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
    const activeThemeGenerationCountRef = useRef(0);
    const themeGenerationSongKeysRef = useRef(new Set<string>());

    const getPreferenceSwitchState = (): ThemePreferenceSwitchState => ({
        isCustomThemePreferred,
        songThemeAutoSwitchEnabled,
        songThemeAutoGenerateEnabled,
    });

    const applyPreferenceSwitchState = (state: ThemePreferenceSwitchState) => {
        setIsCustomThemePreferred(state.isCustomThemePreferred);
        setSongThemeAutoSwitchEnabled(state.songThemeAutoSwitchEnabled);
        setSongThemeAutoGenerateEnabled(state.songThemeAutoGenerateEnabled);
    };

    const beginThemeGeneration = () => {
        activeThemeGenerationCountRef.current += 1;
        setIsGeneratingTheme(true);
    };

    const endThemeGeneration = () => {
        activeThemeGenerationCountRef.current = Math.max(0, activeThemeGenerationCountRef.current - 1);
        setIsGeneratingTheme(activeThemeGenerationCountRef.current > 0);
    };

    useEffect(() => {
        if (customTheme) {
            localStorage.setItem(CUSTOM_DUAL_THEME_KEY, JSON.stringify(customTheme));
        } else {
            localStorage.removeItem(CUSTOM_DUAL_THEME_KEY);
        }
    }, [customTheme]);

    useEffect(() => {
        localStorage.setItem(CUSTOM_THEME_PREFERRED_KEY, String(isCustomThemePreferred && !!customTheme));
    }, [customTheme, isCustomThemePreferred]);

    useEffect(() => {
        saveStoredAnimationIntensity(theme.animationIntensity);
    }, [theme.animationIntensity]);

    useEffect(() => {
        saveStoredThemeAutoSwitchEnabled(songThemeAutoSwitchEnabled);
    }, [songThemeAutoSwitchEnabled]);

    useEffect(() => {
        saveStoredThemeAutoGenerateEnabled(songThemeAutoGenerateEnabled);
    }, [songThemeAutoGenerateEnabled]);

    useEffect(() => {
        const pointer = bgMode === 'custom' && customTheme
            ? 'custom'
            : bgMode === 'ai' && (aiTheme || legacyTheme)
                ? 'ai'
                : 'default';
        saveStoredLastAppliedThemePointer(pointer);
    }, [aiTheme, bgMode, customTheme, legacyTheme]);

    useEffect(() => {
        setTheme(previousTheme => {
            const normalizeTheme = (nextTheme: Theme) => applyStoredAnimationIntensityToTheme(nextTheme);

            if (bgMode === 'custom' && customTheme) {
                return normalizeTheme(getSelectedDualTheme(customTheme, isDaylight));
            }

            if (bgMode === 'ai') {
                if (aiTheme) {
                    return normalizeTheme(getSelectedDualTheme(aiTheme, isDaylight));
                }

                if (legacyTheme) {
                    return normalizeTheme(legacyTheme);
                }
            }

            const baseTheme = getBaseTheme();
            if (legacyTheme) {
                return normalizeTheme({
                    ...legacyTheme,
                    backgroundColor: baseTheme.backgroundColor,
                });
            }

            return normalizeTheme(resolveBgModeTheme({
                mode: bgMode === 'custom' ? 'default' : bgMode,
                aiTheme,
                isDaylight,
                defaultTheme,
                daylightTheme,
                previousTheme,
            }));
        });
    }, [aiTheme, bgMode, customTheme, daylightTheme, defaultTheme, isDaylight, legacyTheme]);

    const handleToggleDaylight = (isLight: boolean) => {
        setDaylightPreference(isLight);
    };

    const handleBgModeChange = (mode: ThemeMode) => {
        if (mode === 'custom' && !customTheme) {
            return;
        }

        setBgMode(mode);
    };

    const handleResetTheme = () => {
        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
    };

    const applyDefaultTheme = () => {
        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
        setStatusMsg({
            type: 'success',
            text: `已应用默认主题: ${isDaylight ? 'Daylight Default' : 'Midnight Default'}`,
        });
    };

    const applyDualTheme = (
        dualTheme: DualTheme,
        options?: { respectCustomPreference?: boolean }
    ) => {
        const normalizedDualTheme = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme));
        setLegacyTheme(null);
        setAiTheme(normalizedDualTheme);
        void saveToCache('last_dual_theme', normalizedDualTheme);
        const respectCustomPreference = options?.respectCustomPreference ?? true;
        if (!respectCustomPreference || !isCustomThemePreferred) {
            setBgMode('ai');
        }
    };

    const applyLegacyTheme = (
        nextLegacyTheme: Theme,
        options?: { respectCustomPreference?: boolean }
    ) => {
        const normalizedLegacyTheme = applyStoredAnimationIntensityToTheme(
            sanitizeTheme(nextLegacyTheme, FALLBACK_AI_DUAL_THEME.dark),
        );
        setAiTheme(null);
        setLegacyTheme(normalizedLegacyTheme);
        void saveToCache('last_theme', normalizedLegacyTheme);
        const respectCustomPreference = options?.respectCustomPreference ?? true;
        if (!respectCustomPreference || !isCustomThemePreferred) {
            setBgMode('ai');
        }
    };

    const applyThemeFallback = () => {
        setAiTheme(null);
        setLegacyTheme(null);
        if (bgMode !== 'custom') {
            setBgMode('default');
        }
    };

    const getThemeParkSeedTheme = (): DualTheme => {
        if (bgMode === 'custom' && customTheme) {
            return customTheme;
        }

        if (aiTheme) {
            return aiTheme;
        }

        const baseDualTheme = applyStoredAnimationIntensityToDualTheme({
            light: {
                ...daylightTheme,
                wordColors: [],
                lyricsIcons: [],
            },
            dark: {
                ...defaultTheme,
                wordColors: [],
                lyricsIcons: [],
            },
        });

        if (legacyTheme) {
            if (isDaylight) {
                baseDualTheme.light = sanitizeCustomTheme({ ...legacyTheme }, legacyTheme.name || 'Theme Park Light', FALLBACK_AI_DUAL_THEME.light);
            } else {
                baseDualTheme.dark = sanitizeCustomTheme({ ...legacyTheme }, legacyTheme.name || 'Theme Park Dark', FALLBACK_AI_DUAL_THEME.dark);
            }
            return baseDualTheme;
        }

        if (isDaylight) {
            baseDualTheme.light = sanitizeCustomTheme({ ...theme }, theme.name || 'Theme Park Light', FALLBACK_AI_DUAL_THEME.light);
        } else {
            baseDualTheme.dark = sanitizeCustomTheme({ ...theme }, theme.name || 'Theme Park Dark', FALLBACK_AI_DUAL_THEME.dark);
        }

        return baseDualTheme;
    };

    const saveCustomDualTheme = (dualTheme: DualTheme) => {
        const sanitized = applyStoredAnimationIntensityToDualTheme(sanitizeCustomDualTheme(dualTheme));
        setCustomTheme(sanitized);
        setBgMode('custom');
        setStatusMsg({
            type: 'success',
            text: `已保存并应用自定义主题: ${getSelectedDualTheme(sanitized, isDaylight).name}`,
        });
        return sanitized;
    };

    const applyCustomTheme = () => {
        if (!customTheme) {
            return;
        }

        setBgMode('custom');
        setStatusMsg({
            type: 'success',
            text: `已应用自定义主题: ${getSelectedDualTheme(customTheme, isDaylight).name}`,
        });
    };

    const handleCustomThemePreferenceChange = (enabled: boolean) => {
        if (!customTheme && enabled) {
            return;
        }

        applyPreferenceSwitchState(resolveCustomThemePreferenceChange(getPreferenceSwitchState(), enabled));
        if (enabled && customTheme) {
            setBgMode('custom');
        }

        setStatusMsg({
            type: 'info',
            text: enabled ? '已开启优先使用自定义主题' : '已关闭优先使用自定义主题',
        });
    };

    const handleSongThemeAutoSwitchChange = (enabled: boolean) => {
        applyPreferenceSwitchState(resolveSongThemeAutoSwitchChange(getPreferenceSwitchState(), enabled));
        setStatusMsg({
            type: 'info',
            text: enabled ? '已开启主题自动切换' : '已关闭主题自动切换',
        });
    };

    const handleSongThemeAutoGenerateChange = (enabled: boolean) => {
        applyPreferenceSwitchState(resolveSongThemeAutoGenerateChange(getPreferenceSwitchState(), enabled));
        setStatusMsg({
            type: 'info',
            text: enabled ? '已开启播放歌曲主题自动生成' : '已关闭播放歌曲主题自动生成',
        });
    };

    const restoreThemeFromLastAppliedPointer = async () => {
        const pointer = readStoredLastAppliedThemePointer();

        if (pointer === 'custom' && customTheme) {
            setBgMode('custom');
            return 'restored' as const;
        }

        if (pointer === 'ai') {
            const lastDualTheme = await getLastDualTheme();
            if (lastDualTheme) {
                applyDualTheme(lastDualTheme, { respectCustomPreference: false });
                return 'fallback-dual' as const;
            }

            const lastLegacyTheme = await getLastLegacyTheme();
            if (lastLegacyTheme) {
                applyLegacyTheme(lastLegacyTheme, { respectCustomPreference: false });
                return 'legacy' as const;
            }
        }

        setAiTheme(null);
        setLegacyTheme(null);
        setBgMode('default');
        return 'restored' as const;
    };

    const restoreCachedThemeForSong = async (
        songId: ThemeCacheSongKey,
        options?: { allowLastUsedFallback?: boolean; preserveCurrentOnMiss?: boolean }
    ) => {
        if (!songThemeAutoSwitchEnabled) {
            if (options?.allowLastUsedFallback) {
                return restoreThemeFromLastAppliedPointer();
            }
            return 'restored' as const;
        }

        const cachedTheme = await getCachedThemeState(songId);

        if (cachedTheme.kind === 'dual') {
            applyDualTheme(cachedTheme.theme, { respectCustomPreference: false });
            return 'dual' as const;
        }

        if (cachedTheme.kind === 'legacy') {
            applyLegacyTheme(cachedTheme.theme, { respectCustomPreference: false });
            return 'legacy' as const;
        }

        if (options?.allowLastUsedFallback) {
            const lastDualTheme = await getLastDualTheme();
            if (lastDualTheme) {
                applyDualTheme(lastDualTheme, { respectCustomPreference: false });
                return 'fallback-dual' as const;
            }

            const lastLegacyTheme = await getLastLegacyTheme();
            if (lastLegacyTheme) {
                applyLegacyTheme(lastLegacyTheme, { respectCustomPreference: false });
                return 'legacy' as const;
            }
        }

        if (options?.preserveCurrentOnMiss ?? true) {
            return 'none' as const;
        }

        applyThemeFallback();
        return 'none' as const;
    };

    const generateAITheme = async (
        lyrics: LyricData | null,
        currentSong: SongResult | null,
        options: GenerateAIThemeOptions = {},
    ): Promise<GenerateAIThemeResult> => {
        const source = options.source ?? 'manual';
        const songKey = currentSong?.id != null ? String(currentSong.id) : '__no_song__';
        if (themeGenerationSongKeysRef.current.has(songKey)) {
            return { status: 'skipped', reason: 'in-flight' };
        }

        themeGenerationSongKeysRef.current.add(songKey);
        beginThemeGeneration();
        setStatusMsg({ type: 'info', text: t('status.generatingTheme') });
        try {
            const allText = lyrics?.lines.map(line => line.fullText).join('\n').trim() || '';
            const songTitle = currentSong?.name?.trim() || lyrics?.title?.trim() || '';
            const isPureMusic = Boolean(currentSong?.isPureMusic) || isPureMusicLyricText(allText);
            const promptText = (isPureMusic ? songTitle : allText) || allText;

            if (!promptText) {
                if (source === 'manual') {
                    setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
                }
                return { status: 'skipped', reason: 'empty-prompt' };
            }

            const dualTheme = await generateThemeFromLyrics(promptText, {
                isPureMusic,
                songTitle: songTitle || undefined,
            });
            const normalizedDualTheme = applyStoredAnimationIntensityToDualTheme(sanitizeDualTheme(dualTheme));
            if (currentSong) {
                await saveToCache(`dual_theme_${currentSong.id}`, normalizedDualTheme);
            }

            const shouldApply = options.shouldApply?.() ?? true;
            if (!shouldApply) {
                return { status: 'generated', applied: false };
            }

            applyDualTheme(normalizedDualTheme);

            const selectedTheme = getSelectedDualTheme(normalizedDualTheme, isDaylight);
            setStatusMsg({
                type: 'success',
                text: bgMode === 'custom' && customTheme
                    ? 'AI 主题已更新，自定义主题仍为首选'
                    : t('status.themeApplied', { themeName: selectedTheme.name }),
            });

            return { status: 'generated', applied: true };
        } catch (error: unknown) {
            console.error(error);
            const shouldApply = options.shouldApply?.() ?? true;
            if (isMissingAiApiKeyError(error)) {
                const coverColors = coverUrl ? await extractColors(coverUrl, 5) : [];
                const fallbackTheme = applyStoredAnimationIntensityToDualTheme(buildBuiltinDualTheme({ coverColors }));

                if (currentSong) {
                    await saveToCache(`dual_theme_${currentSong.id}`, fallbackTheme);
                }

                if (!shouldApply) {
                    return { status: 'generated', applied: false };
                }

                applyDualTheme(fallbackTheme);
                setStatusMsg({
                    type: 'info',
                    text: bgMode === 'custom' && customTheme
                        ? 'AI 主题已生成，但当前仍优先使用自定义主题'
                        : t('status.aiFallbackThemeUsed'),
                });
                return { status: 'generated', applied: true };
            } else {
                if (shouldApply) {
                    setStatusMsg({ type: 'error', text: t('status.themeGenerationFailed') });
                }
                return { status: 'failed' };
            }
        } finally {
            themeGenerationSongKeysRef.current.delete(songKey);
            endThemeGeneration();
        }
    };

    return {
        theme,
        setTheme: (nextTheme: Theme) => {
            if (isThemeAnimationIntensity(nextTheme.animationIntensity)) {
                saveStoredAnimationIntensity(nextTheme.animationIntensity);
            }
            setTheme(applyStoredAnimationIntensityToTheme(nextTheme));
        },
        aiTheme,
        setAiTheme,
        customTheme,
        hasCustomTheme: Boolean(customTheme),
        isCustomThemePreferred,
        songThemeAutoSwitchEnabled,
        songThemeAutoGenerateEnabled,
        bgMode,
        setBgMode,
        isGeneratingTheme,
        handleToggleDaylight,
        handleBgModeChange,
        handleResetTheme,
        applyDefaultTheme,
        applyDualTheme,
        applyLegacyTheme,
        applyThemeFallback,
        restoreCachedThemeForSong,
        generateAITheme,
        getThemeParkSeedTheme,
        saveCustomDualTheme,
        applyCustomTheme,
        handleCustomThemePreferenceChange,
        handleSongThemeAutoSwitchChange,
        handleSongThemeAutoGenerateChange,
    };
}
