import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

type StatusSetter = Dispatch<SetStateAction<{ type: 'error' | 'success' | 'info', text: string; } | null>>;
type AudioQuality = 'exhigh' | 'lossless' | 'hires';

const getStoredBoolean = (key: string, fallback: boolean) => {
    const saved = localStorage.getItem(key);
    return saved !== null ? saved === 'true' : fallback;
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
        handleToggleCoverColorBg,
        handleToggleStaticMode,
        handleToggleMediaCache,
        handleSetBackgroundOpacity,
        setDaylightPreference,
        volume,
        isMuted,
        handleSetVolume,
        handleToggleMute,
    };
}
