import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_CADENZA_TUNING, DEFAULT_PARTITA_TUNING, type CadenzaTuning, type PartitaTuning, type Theme, type VisualizerMode } from '../types';

type StatusSetter = Dispatch<SetStateAction<{ type: 'error' | 'success' | 'info', text: string; } | null>>;
type AudioQuality = 'exhigh' | 'lossless' | 'hires';
type StoredCustomLyricsFont = { family: string; label?: string | null; };

const getStoredBoolean = (key: string, fallback: boolean) => {
    const saved = localStorage.getItem(key);
    return saved !== null ? saved === 'true' : fallback;
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

export function useAppPreferences(setStatusMsg: StatusSetter) {
    const [audioQuality, setAudioQuality] = useState<AudioQuality>(() => {
        const saved = localStorage.getItem('default_audio_quality');
        return (saved === 'lossless' || saved === 'hires') ? saved : 'exhigh';
    });
    const [useCoverColorBg, setUseCoverColorBg] = useState(() => getStoredBoolean('use_cover_color_bg', false));
    const [staticMode, setStaticMode] = useState(() => getStoredBoolean('static_mode', false));
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
    const [lyricsFontStyle, setLyricsFontStyle] = useState<Theme['fontStyle']>(readStoredLyricsFontStyle);
    const [lyricsFontScale, setLyricsFontScale] = useState<number>(readStoredLyricsFontScale);
    const [lyricsCustomFont, setLyricsCustomFont] = useState<StoredCustomLyricsFont | null>(readStoredCustomLyricsFont);
    const [showOpenPanelCloseButton, setShowOpenPanelCloseButton] = useState(() => getStoredBoolean('show_open_panel_close_button', true));
    const [volume, setVolume] = useState(() => {
        const saved = localStorage.getItem('player_volume');
        return saved !== null ? parseFloat(saved) : 1.0;
    });
    const [isMuted, setIsMuted] = useState(() => getStoredBoolean('player_is_muted', false));

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
                        ? '已切换到雾刊歌词'
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

    const handleToggleOpenPanelCloseButton = useCallback((enable: boolean) => {
        setShowOpenPanelCloseButton(enable);
        localStorage.setItem('show_open_panel_close_button', String(enable));
        setStatusMsg({
            type: 'info',
            text: enable ? '已显示面板关闭按钮' : '已隐藏面板关闭按钮'
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

    return {
        audioQuality,
        setAudioQuality,
        useCoverColorBg,
        staticMode,
        enableMediaCache,
        backgroundOpacity,
        isDaylight,
        visualizerMode,
        cadenzaTuning,
        partitaTuning,
        lyricsFontStyle,
        lyricsFontScale,
        lyricsCustomFontFamily: lyricsCustomFont?.family ?? null,
        lyricsCustomFontLabel: lyricsCustomFont?.label ?? null,
        showOpenPanelCloseButton,
        handleToggleCoverColorBg,
        handleToggleStaticMode,
        handleToggleMediaCache,
        handleSetBackgroundOpacity,
        setDaylightPreference,
        handleSetVisualizerMode,
        handleSetCadenzaTuning,
        handleResetCadenzaTuning,
        handleSetPartitaTuning,
        handleResetPartitaTuning,
        handleSetLyricsFontStyle,
        handleSetLyricsFontScale,
        handleSetLyricsCustomFont,
        handleToggleOpenPanelCloseButton,
        volume,
        isMuted,
        handleSetVolume,
        handleToggleMute,
    };
}
