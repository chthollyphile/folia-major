import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_CADENZA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_PARTITA_TUNING, type CadenzaTuning, type FumeTuning, type PartitaTuning, type StatusMessage, type Theme, type VisualizerMode } from '../types';
import { getLyricFilterError } from '../utils/lyrics/filtering';

type StatusSetter = Dispatch<SetStateAction<StatusMessage | null>>;
type AudioQuality = 'exhigh' | 'lossless' | 'hires';
type StoredCustomLyricsFont = { family: string; label?: string | null; };

const getStoredBoolean = (key: string, fallback: boolean) => {
    const saved = localStorage.getItem(key);
    return saved !== null ? saved === 'true' : fallback;
};

const readStoredDisableHomeDynamicBackground = (): boolean => {
    const saved = localStorage.getItem('disable_home_dynamic_background');
    if (saved !== null) {
        return saved === 'true';
    }

    const legacySaved = localStorage.getItem('enable_home_dynamic_background');
    if (legacySaved !== null) {
        return legacySaved !== 'true';
    }

    return false;
};

const readStoredCadenzaTuning = (): CadenzaTuning => {
    const saved = localStorage.getItem('cadenza_tuning') ?? localStorage.getItem('cadenze_tuning');
    if (!saved) return DEFAULT_CADENZA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<CadenzaTuning>;
        return {
            ...DEFAULT_CADENZA_TUNING,
            ...parsed,
            beamIntensity: 0,
        };
    } catch {
        return DEFAULT_CADENZA_TUNING;
    }
};

const clampPartitaStagger = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(180, Math.max(0, value));
};

const readStoredPartitaTuning = (): PartitaTuning => {
    const saved = localStorage.getItem('partita_tuning');
    if (!saved) return DEFAULT_PARTITA_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<PartitaTuning>;
        const rawMin = clampPartitaStagger(parsed.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin, DEFAULT_PARTITA_TUNING.staggerMin);
        const rawMax = clampPartitaStagger(parsed.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax, DEFAULT_PARTITA_TUNING.staggerMax);

        return {
            showGuideLines: parsed.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
    } catch {
        return DEFAULT_PARTITA_TUNING;
    }
};

const clampFumeCameraSpeed = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.85, Math.max(0.55, value));
};

const clampFumeGlowIntensity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.8, Math.max(0, value));
};

const clampFumeBackgroundObjectOpacity = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

const clampFumeHeroScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.32, Math.max(0.82, value));
};

const clampFumeTextHoldRatio = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, value));
};

const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined) => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

const readStoredFumeTuning = (): FumeTuning => {
    const saved = localStorage.getItem('fume_tuning');
    if (!saved) return DEFAULT_FUME_TUNING;

    try {
        const parsed = JSON.parse(saved) as Partial<FumeTuning> & { textHoldStyle?: 'standard' | 'dimmed'; };
        const migratedTextHoldRatio = parsed.textHoldStyle === 'dimmed'
            ? 0.5
            : DEFAULT_FUME_TUNING.textHoldRatio;
        return {
            hidePrintSymbols: parsed.hidePrintSymbols ?? DEFAULT_FUME_TUNING.hidePrintSymbols,
            disableGeometricBackground: parsed.disableGeometricBackground ?? DEFAULT_FUME_TUNING.disableGeometricBackground,
            backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
                parsed.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
                DEFAULT_FUME_TUNING.backgroundObjectOpacity,
            ),
            textHoldRatio: clampFumeTextHoldRatio(parsed.textHoldRatio ?? migratedTextHoldRatio, DEFAULT_FUME_TUNING.textHoldRatio),
            cameraTrackingMode: resolveFumeCameraTrackingMode(parsed.cameraTrackingMode),
            cameraSpeed: clampFumeCameraSpeed(parsed.cameraSpeed ?? DEFAULT_FUME_TUNING.cameraSpeed, DEFAULT_FUME_TUNING.cameraSpeed),
            glowIntensity: clampFumeGlowIntensity(parsed.glowIntensity ?? DEFAULT_FUME_TUNING.glowIntensity, DEFAULT_FUME_TUNING.glowIntensity),
            heroScale: clampFumeHeroScale(parsed.heroScale ?? DEFAULT_FUME_TUNING.heroScale, DEFAULT_FUME_TUNING.heroScale),
        };
    } catch {
        return DEFAULT_FUME_TUNING;
    }
};

const readStoredLyricsFontStyle = (): Theme['fontStyle'] => {
    const saved = localStorage.getItem('lyrics_font_style');
    return saved === 'serif' || saved === 'mono' ? saved : 'sans';
};

const readStoredLyricsFontScale = (): number => {
    const saved = localStorage.getItem('lyrics_font_scale');
    if (!saved) return 1;

    const parsed = parseFloat(saved);
    if (!Number.isFinite(parsed)) return 1;

    return Math.min(1.4, Math.max(0.85, parsed));
};

const readStoredCustomLyricsFont = (): StoredCustomLyricsFont | null => {
    const saved = localStorage.getItem('lyrics_custom_font');
    if (!saved) return null;

    try {
        const parsed = JSON.parse(saved) as Partial<StoredCustomLyricsFont>;
        const family = parsed.family?.trim();
        if (!family) return null;

        return {
            family,
            label: parsed.label?.trim() || family,
        };
    } catch {
        return null;
    }
};

const readStoredLyricFilterPattern = (): string => localStorage.getItem('lyrics_filter_pattern')?.trim() || '';

const readStoredLoopMode = (): 'off' | 'all' | 'one' => {
    const saved = localStorage.getItem('player_loop_mode');
    return saved === 'all' || saved === 'one' ? saved : 'off';
};

export function useAppPreferences(setStatusMsg: StatusSetter) {
    const [audioQuality, setAudioQuality] = useState<AudioQuality>(() => {
        const saved = localStorage.getItem('default_audio_quality');
        return (saved === 'lossless' || saved === 'hires') ? saved : 'exhigh';
    });
    const [useCoverColorBg, setUseCoverColorBg] = useState(() => getStoredBoolean('use_cover_color_bg', false));
    const [staticMode, setStaticMode] = useState(() => getStoredBoolean('static_mode', false));
    const [disableHomeDynamicBackground, setDisableHomeDynamicBackground] = useState(readStoredDisableHomeDynamicBackground);
    const [hidePlayerProgressBar, setHidePlayerProgressBar] = useState(() => getStoredBoolean('hide_player_progress_bar', false));
    const [hidePlayerTranslationSubtitle, setHidePlayerTranslationSubtitle] = useState(() => getStoredBoolean('hide_player_translation_subtitle', false));
    const [hidePlayerRightPanelButton, setHidePlayerRightPanelButton] = useState(() => getStoredBoolean('hide_player_right_panel_button', false));
    const [enableMediaCache, setEnableMediaCache] = useState(() => getStoredBoolean('enable_media_cache', false));
    const [backgroundOpacity, setBackgroundOpacity] = useState(() => {
        const saved = localStorage.getItem('background_opacity');
        return saved ? parseFloat(saved) : 0.75;
    });
    const [isDaylight, setIsDaylight] = useState(() => getStoredBoolean('default_theme_daylight', false));
    const [visualizerMode, setVisualizerMode] = useState<VisualizerMode>(() => {
        const saved = localStorage.getItem('visualizer_mode');
        if (saved === 'cadenza' || saved === 'cadenze') {
            return 'cadenza';
        }
        if (saved === 'partita') {
            return 'partita';
        }
        if (saved === 'fume') {
            return 'fume';
        }
        return 'classic';
    });
    const [cadenzaTuning, setCadenzaTuning] = useState<CadenzaTuning>(readStoredCadenzaTuning);
    const [partitaTuning, setPartitaTuning] = useState<PartitaTuning>(readStoredPartitaTuning);
    const [fumeTuning, setFumeTuning] = useState<FumeTuning>(readStoredFumeTuning);
    const [lyricsFontStyle, setLyricsFontStyle] = useState<Theme['fontStyle']>(readStoredLyricsFontStyle);
    const [lyricsFontScale, setLyricsFontScale] = useState<number>(readStoredLyricsFontScale);
    const [lyricsCustomFont, setLyricsCustomFont] = useState<StoredCustomLyricsFont | null>(readStoredCustomLyricsFont);
    const [lyricFilterPattern, setLyricFilterPattern] = useState<string>(readStoredLyricFilterPattern);
    const [showOpenPanelCloseButton, setShowOpenPanelCloseButton] = useState(() => getStoredBoolean('show_open_panel_close_button', true));
    const [enableNowPlayingStage, setEnableNowPlayingStage] = useState(() => getStoredBoolean('enable_now_playing_stage', false));
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player_volume');
        return saved !== null ? parseFloat(saved) : 1.0;
    });
    const [isMuted, setIsMuted] = useState(() => getStoredBoolean('player_is_muted', false));
    const [loopMode, setLoopMode] = useState<'off' | 'all' | 'one'>(readStoredLoopMode);

    useEffect(() => {
        localStorage.setItem('default_audio_quality', audioQuality);
    }, [audioQuality]);

    useEffect(() => {
        const root = document.documentElement;
        if (isDaylight) {
            root.style.setProperty('--scrollbar-track', '#cccbcc');
            root.style.setProperty('--scrollbar-thumb', '#ecececff');
            root.style.setProperty('--scrollbar-thumb-hover', '#ffffffff');
        } else {
            root.style.setProperty('--scrollbar-track', '#18181b');
            root.style.setProperty('--scrollbar-thumb', '#3f3f46');
            root.style.setProperty('--scrollbar-thumb-hover', '#52525b');
        }
    }, [isDaylight]);

    const handleToggleCoverColorBg = (enable: boolean) => {
        setUseCoverColorBg(enable);
        localStorage.setItem('use_cover_color_bg', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '添加封面色彩' : '使用默认色彩'
        });
    };

    const handleToggleStaticMode = (enable: boolean) => {
        setStaticMode(enable);
        localStorage.setItem('static_mode', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '静态模式已开启' : '静态模式已关闭'
        });
    };

    const handleToggleDisableHomeDynamicBackground = (disable: boolean) => {
        setDisableHomeDynamicBackground(disable);
        localStorage.setItem('disable_home_dynamic_background', String(disable));
        setStatusMsg({
            type: 'info',
            text: disable ? '主页动态背景已关闭' : '主页动态背景已开启',
        });
    };

    const handleToggleHidePlayerProgressBar = (enable: boolean) => {
        setHidePlayerProgressBar(enable);
        localStorage.setItem('hide_player_progress_bar', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '播放页底部控制条已隐藏' : '播放页底部控制条已显示',
        });
    };

    const handleToggleHidePlayerTranslationSubtitle = (enable: boolean) => {
        setHidePlayerTranslationSubtitle(enable);
        localStorage.setItem('hide_player_translation_subtitle', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '播放页翻译字幕已隐藏' : '播放页翻译字幕已显示',
        });
    };

    const handleToggleHidePlayerRightPanelButton = (enable: boolean) => {
        setHidePlayerRightPanelButton(enable);
        localStorage.setItem('hide_player_right_panel_button', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '播放页右侧按钮已隐藏' : '播放页右侧按钮已显示',
        });
    };

    const handleToggleMediaCache = (enable: boolean) => {
        setEnableMediaCache(enable);
        localStorage.setItem('enable_media_cache', String(enable));
    };

    const handleSetBackgroundOpacity = (opacity: number) => {
        setBackgroundOpacity(opacity);
        localStorage.setItem('background_opacity', String(opacity));
    };

    const setDaylightPreference = (enabled: boolean) => {
        setIsDaylight(enabled);
        localStorage.setItem('default_theme_daylight', String(enabled));
    };

    const handleSetVisualizerMode = (mode: VisualizerMode) => {
        setVisualizerMode(mode);
        localStorage.setItem('visualizer_mode', mode);
        setStatusMsg({
            type: 'info',
            text: mode === 'cadenza'
                ? '已切换到心象歌词'
                : mode === 'partita'
                    ? '已切换到云阶歌词'
                    : mode === 'fume'
                        ? '已切换到浮名歌词'
                    : '已切换到流光歌词'
        });
    };

    const handleSetCadenzaTuning = useCallback((patch: Partial<CadenzaTuning>) => {
        setCadenzaTuning(prev => {
            const next = { ...prev, ...patch, beamIntensity: 0 };
            localStorage.setItem('cadenza_tuning', JSON.stringify(next));
            return next;
        });
    }, []);

    const handleResetCadenzaTuning = () => {
        setCadenzaTuning(DEFAULT_CADENZA_TUNING);
        localStorage.setItem('cadenza_tuning', JSON.stringify(DEFAULT_CADENZA_TUNING));
        setStatusMsg({
            type: 'info',
            text: '心象参数已重置'
        });
    };

    const handleSetPartitaTuning = useCallback((patch: Partial<PartitaTuning>) => {
        setPartitaTuning(prev => {
            const rawMin = clampPartitaStagger(patch.staggerMin ?? prev.staggerMin, prev.staggerMin);
            const rawMax = clampPartitaStagger(patch.staggerMax ?? prev.staggerMax, prev.staggerMax);
            const next = {
                showGuideLines: patch.showGuideLines ?? prev.showGuideLines,
                staggerMin: Math.min(rawMin, rawMax),
                staggerMax: Math.max(rawMin, rawMax),
            };

            localStorage.setItem('partita_tuning', JSON.stringify(next));
            return next;
        });
    }, []);

    const handleResetPartitaTuning = () => {
        setPartitaTuning(DEFAULT_PARTITA_TUNING);
        localStorage.setItem('partita_tuning', JSON.stringify(DEFAULT_PARTITA_TUNING));
        setStatusMsg({
            type: 'info',
            text: '云阶参数已重置'
        });
    };

    const handleSetFumeTuning = useCallback((patch: Partial<FumeTuning>) => {
        setFumeTuning(prev => {
            const next = {
                hidePrintSymbols: patch.hidePrintSymbols ?? prev.hidePrintSymbols,
                disableGeometricBackground: patch.disableGeometricBackground ?? prev.disableGeometricBackground,
                backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
                    patch.backgroundObjectOpacity ?? prev.backgroundObjectOpacity,
                    prev.backgroundObjectOpacity,
                ),
                textHoldRatio: clampFumeTextHoldRatio(patch.textHoldRatio ?? prev.textHoldRatio, prev.textHoldRatio),
                cameraTrackingMode: resolveFumeCameraTrackingMode(patch.cameraTrackingMode ?? prev.cameraTrackingMode),
                cameraSpeed: clampFumeCameraSpeed(patch.cameraSpeed ?? prev.cameraSpeed, prev.cameraSpeed),
                glowIntensity: clampFumeGlowIntensity(patch.glowIntensity ?? prev.glowIntensity, prev.glowIntensity),
                heroScale: clampFumeHeroScale(patch.heroScale ?? prev.heroScale, prev.heroScale),
            };

            localStorage.setItem('fume_tuning', JSON.stringify(next));
            return next;
        });
    }, []);

    const handleResetFumeTuning = () => {
        setFumeTuning(DEFAULT_FUME_TUNING);
        localStorage.setItem('fume_tuning', JSON.stringify(DEFAULT_FUME_TUNING));
        setStatusMsg({
            type: 'info',
            text: '浮名参数已重置'
        });
    };

    const handleSetLyricsFontStyle = useCallback((fontStyle: Theme['fontStyle']) => {
        setLyricsFontStyle(fontStyle);
        localStorage.setItem('lyrics_font_style', fontStyle);
    }, []);

    const handleSetLyricsFontScale = useCallback((fontScale: number) => {
        const next = Math.min(1.4, Math.max(0.85, fontScale));
        setLyricsFontScale(next);
        localStorage.setItem('lyrics_font_scale', String(next));
    }, []);

    const handleSetLyricsCustomFont = useCallback((font: StoredCustomLyricsFont | null) => {
        if (!font?.family?.trim()) {
            setLyricsCustomFont(null);
            localStorage.removeItem('lyrics_custom_font');
            return;
        }

        const next = {
            family: font.family.trim(),
            label: font.label?.trim() || font.family.trim(),
        };

        setLyricsCustomFont(next);
        localStorage.setItem('lyrics_custom_font', JSON.stringify(next));
    }, []);

    const handleSetLyricFilterPattern = useCallback((pattern: string) => {
        const next = pattern.trim();
        setLyricFilterPattern(next);

        if (next) {
            localStorage.setItem('lyrics_filter_pattern', next);
        } else {
            localStorage.removeItem('lyrics_filter_pattern');
        }
    }, []);

    const handleToggleOpenPanelCloseButton = useCallback((enable: boolean) => {
        setShowOpenPanelCloseButton(enable);
        localStorage.setItem('show_open_panel_close_button', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '已显示面板关闭按钮' : '已隐藏面板关闭按钮'
        });
    }, [setStatusMsg]);

    const handleToggleNowPlayingStage = useCallback((enable: boolean) => {
        setEnableNowPlayingStage(enable);
        localStorage.setItem('enable_now_playing_stage', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '舞台模式已启用' : '舞台模式已关闭'
        });
    }, [setStatusMsg]);

    const handleSetVolume = useCallback((val: number) => {
        setVolume(val);
        localStorage.setItem('player_volume', String(val));
    }, []);

    const handleToggleMute = () => {
        const next = !isMuted;
        setIsMuted(next);
        localStorage.setItem('player_is_muted', String(next));
    };

    const handleToggleLoopMode = useCallback(() => {
        setLoopMode(prev => {
            const next = prev === 'off'
                ? 'all'
                : prev === 'all'
                    ? 'one'
                    : 'off';
            localStorage.setItem('player_loop_mode', next);
            return next;
        });
    }, []);

    return {
        audioQuality,
        setAudioQuality,
        useCoverColorBg,
        staticMode,
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerTranslationSubtitle,
        hidePlayerRightPanelButton,
        enableMediaCache,
        backgroundOpacity,
        isDaylight,
        visualizerMode,
        cadenzaTuning,
        partitaTuning,
        fumeTuning,
        lyricsFontStyle,
        lyricsFontScale,
        lyricsCustomFontFamily: lyricsCustomFont?.family ?? null,
        lyricsCustomFontLabel: lyricsCustomFont?.label ?? null,
        lyricFilterPattern,
        lyricFilterPatternError: getLyricFilterError(lyricFilterPattern),
        showOpenPanelCloseButton,
        enableNowPlayingStage,
        loopMode,
        handleToggleCoverColorBg,
        handleToggleStaticMode,
        handleToggleDisableHomeDynamicBackground,
        handleToggleHidePlayerProgressBar,
        handleToggleHidePlayerTranslationSubtitle,
        handleToggleHidePlayerRightPanelButton,
        handleToggleMediaCache,
        handleSetBackgroundOpacity,
        setDaylightPreference,
        handleSetVisualizerMode,
        handleSetCadenzaTuning,
        handleResetCadenzaTuning,
        handleSetPartitaTuning,
        handleResetPartitaTuning,
        handleSetFumeTuning,
        handleResetFumeTuning,
        handleSetLyricsFontStyle,
        handleSetLyricsFontScale,
        handleSetLyricsCustomFont,
        handleSetLyricFilterPattern,
        handleToggleOpenPanelCloseButton,
        handleToggleNowPlayingStage,
        volume,
        isMuted,
        handleSetVolume,
        handleToggleMute,
        handleToggleLoopMode,
    };
}
