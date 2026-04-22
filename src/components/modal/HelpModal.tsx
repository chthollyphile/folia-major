import React, { useState, useEffect } from 'react';
import { X, Command, MousePointer2, Keyboard, Settings2, Trash2, Database, Layers, Monitor, PlayCircle, Loader2, Sparkles, Server, Check, AlertCircle, Palette, FolderOpen, Pencil } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCacheUsageByCategory, clearCacheByCategory, clearAllData } from '../../services/db';
import { DualTheme, Theme, ThemeMode, type CadenzaTuning, type PartitaTuning, type VisualizerMode } from '../../types';
import { getNavidromeConfig, saveNavidromeConfig, clearNavidromeConfig, hashPassword, navidromeApi, isNavidromeEnabled, setNavidromeEnabled } from '../../services/navidromeService';
import { NavidromeConfig } from '../../types/navidrome';
import VisPlayground from '../visualizer/VisPlayground';
import ThemePark from './ThemePark';

interface HelpModalProps {
    onClose: () => void;
    staticMode?: boolean;
    onToggleStaticMode?: (enable: boolean) => void;
    enableMediaCache?: boolean;
    onToggleMediaCache?: (enable: boolean) => void;
    theme?: Theme;
    backgroundOpacity?: number;
    setBackgroundOpacity?: (opacity: number) => void;
    bgMode: ThemeMode;
    onApplyDefaultTheme: () => void;
    hasCustomTheme: boolean;
    themeParkInitialTheme: DualTheme;
    isCustomThemePreferred: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onApplyCustomTheme: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    isDaylight: boolean;
    onToggleNavidrome?: (enabled: boolean) => void;
    visualizerMode?: VisualizerMode;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    onVisualizerModeChange?: (mode: VisualizerMode) => void;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    onResetPartitaTuning?: () => void;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsCustomFontFamily: string | null;
    lyricsCustomFontLabel: string | null;
    onLyricsFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onLyricsFontScaleChange: (fontScale: number) => void;
    onLyricsCustomFontChange: (font: { family: string; label?: string | null; } | null) => void;
}

const HelpModal: React.FC<HelpModalProps> = ({
    onClose,
    staticMode = false,
    onToggleStaticMode,
    enableMediaCache = false,
    onToggleMediaCache,
    theme,
    backgroundOpacity = 0.75,
    setBackgroundOpacity,
    bgMode,
    onApplyDefaultTheme,
    hasCustomTheme,
    themeParkInitialTheme,
    isCustomThemePreferred,
    onSaveCustomTheme,
    onApplyCustomTheme,
    onToggleCustomThemePreferred,
    isDaylight,
    onToggleNavidrome,
    visualizerMode = 'classic',
    cadenzaTuning,
    partitaTuning,
    onVisualizerModeChange,
    onPartitaTuningChange,
    onResetPartitaTuning,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsCustomFontFamily,
    lyricsCustomFontLabel,
    onLyricsFontStyleChange,
    onLyricsFontScaleChange,
    onLyricsCustomFontChange,
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'help' | 'options'>('help');
    const [showVisPlayground, setShowVisPlayground] = useState(false);
    const [showThemePark, setShowThemePark] = useState(false);
    const [versionCopied, setVersionCopied] = useState(false);
    const [authorClickCount, setAuthorClickCount] = useState(0);
    const [meowEasterEgg, setMeowEasterEgg] = useState<{ id: number; color: string; } | null>(null);

    // Cache State
    const [cacheSizes, setCacheSizes] = useState({
        playlist: '0 B',
        lyrics: '0 B',
        cover: '0 B',
        media: '0 B'
    });
    const [mediaCount, setMediaCount] = useState(0);
    const [isCleaning, setIsCleaning] = useState<string | null>(null);

    // Electron Settings State
    const [isElectron, setIsElectron] = useState(false);
    const [electronSettings, setElectronSettings] = useState({
        GEMINI_API_KEY: '',
        OPENAI_API_KEY: '',
        OPENAI_API_URL: '',
        AI_PROVIDER: 'gemini',
        USE_SYSTEM_PROXY_FOR_AI: false
    });
    const [electronSaveStatus, setElectronSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [cacheDirectory, setCacheDirectory] = useState<string>('');
    const [cacheDirectoryIsDefault, setCacheDirectoryIsDefault] = useState(true);
    const [cacheDirectoryStatus, setCacheDirectoryStatus] = useState<'idle' | 'choosing'>('idle');
    const configuredAiProvider = isElectron ? electronSettings.AI_PROVIDER : import.meta.env.VITE_AI_PROVIDER;
    const aiServiceLabel = configuredAiProvider === 'openai' ? 'OpenAI Compatible' : 'Google Gemini';

    useEffect(() => {
        if ((window as any).electron) {
            setIsElectron(true);
            (window as any).electron.getSettings().then((settings: any) => {
                if (settings) {
                    setElectronSettings(prev => ({ ...prev, ...settings }));
                }
            });
            (window as any).electron.getCacheDirectory().then((result: ElectronCacheDirectoryResult) => {
                if (result?.path) {
                    setCacheDirectory(result.path);
                    setCacheDirectoryIsDefault(result.isDefault);
                }
            });
        }
    }, []);

    const copyText = async (text: string) => {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();

        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textarea);
        }
    };

    const handleCopyVersionInfo = async () => {
        const versionInfo = `folia-major v${__APP_VERSION__} - ${__GIT_BRANCH__} - ${__COMMIT_HASH__}`;

        try {
            await copyText(versionInfo);
            setVersionCopied(true);
            window.setTimeout(() => setVersionCopied(false), 1800);
        } catch (error) {
            console.error('Failed to copy version info:', error);
            setVersionCopied(false);
        }
    };

    const handleAuthorLabelClick = () => {
        setAuthorClickCount((prev) => {
            const nextCount = prev + 1;

            if (nextCount >= 10) {
                const color = `hsl(${Math.floor(Math.random() * 360)} 90% 70%)`;
                const id = Date.now();
                setMeowEasterEgg({ id, color });
                window.setTimeout(() => {
                    setMeowEasterEgg((current) => (current?.id === id ? null : current));
                }, 1600);
                return 0;
            }

            return nextCount;
        });
    };

    const saveElectronSettings = async () => {
        if ((window as any).electron) {
            setElectronSaveStatus('saving');
            await (window as any).electron.saveSettings('GEMINI_API_KEY', electronSettings.GEMINI_API_KEY);
            await (window as any).electron.saveSettings('OPENAI_API_KEY', electronSettings.OPENAI_API_KEY);
            await (window as any).electron.saveSettings('OPENAI_API_URL', electronSettings.OPENAI_API_URL);
            await (window as any).electron.saveSettings('AI_PROVIDER', electronSettings.AI_PROVIDER);
            await (window as any).electron.saveSettings('USE_SYSTEM_PROXY_FOR_AI', electronSettings.USE_SYSTEM_PROXY_FOR_AI);
            setElectronSaveStatus('saved');
            setTimeout(() => setElectronSaveStatus('idle'), 2000);
        }
    };

    // Navidrome Settings State
    const [navidromeEnabled, setNavidromeEnabledState] = useState(false);
    const [navidromeUrl, setNavidromeUrl] = useState('');
    const [navidromeUsername, setNavidromeUsername] = useState('');
    const [navidromePassword, setNavidromePassword] = useState('');
    const [navidromeTestStatus, setNavidromeTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
    const [navidromeConfigured, setNavidromeConfigured] = useState(false);

    // Load Navidrome config on mount
    useEffect(() => {
        setNavidromeEnabledState(isNavidromeEnabled());
        const config = getNavidromeConfig();
        if (config) {
            setNavidromeUrl(config.serverUrl);
            setNavidromeUsername(config.username);
            setNavidromeConfigured(true);
        }
    }, []);

    // Test Navidrome connection
    const testNavidromeConnection = async () => {
        if (!navidromeUrl || !navidromeUsername || !navidromePassword) {
            setNavidromeTestStatus('failed');
            return;
        }

        setNavidromeTestStatus('testing');
        const config: NavidromeConfig = {
            serverUrl: navidromeUrl.replace(/\/$/, ''), // Remove trailing slash
            username: navidromeUsername,
            passwordHash: hashPassword(navidromePassword)
        };

        const success = await navidromeApi.ping(config);
        if (success) {
            saveNavidromeConfig(config);
            setNavidromeConfigured(true);
            setNavidromeTestStatus('success');
        } else {
            setNavidromeTestStatus('failed');
        }
    };

    // Toggle Navidrome enabled
    const handleToggleNavidromeEnabled = (enabled: boolean) => {
        setNavidromeEnabled(enabled);
        setNavidromeEnabledState(enabled);
        if (onToggleNavidrome) {
            onToggleNavidrome(enabled);
        }
    };

    // Clear Navidrome config
    const handleClearNavidrome = () => {
        clearNavidromeConfig();
        setNavidromeUrl('');
        setNavidromeUsername('');
        setNavidromePassword('');
        setNavidromeConfigured(false);
        setNavidromeTestStatus('idle');
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const fetchCacheUsage = async () => {
        const usage = await getCacheUsageByCategory();
        setCacheSizes({
            playlist: formatBytes(usage.playlist),
            lyrics: formatBytes(usage.lyrics),
            cover: formatBytes(usage.cover),
            media: formatBytes(usage.media)
        });
        setMediaCount(usage.mediaCount);
    };

    useEffect(() => {
        if (activeTab === 'options') {
            fetchCacheUsage();
        }
    }, [activeTab]);

    const handleClear = async (category: 'playlist' | 'lyrics' | 'cover' | 'media') => {
        setIsCleaning(category);
        await clearCacheByCategory(category);
        await fetchCacheUsage();
        setIsCleaning(null);
    };

    const handleChooseCacheDirectory = async () => {
        if (!(window as any).electron) {
            return;
        }

        setCacheDirectoryStatus('choosing');
        try {
            const result = await (window as any).electron.chooseCacheDirectory();
            if (result?.path) {
                setCacheDirectory(result.path);
                setCacheDirectoryIsDefault(result.isDefault);
            }
        } finally {
            setCacheDirectoryStatus('idle');
        }
    };

    // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-900/90'; // Use slightly higher opacity for modal than panel
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const textColor = isDaylight ? 'text-zinc-800' : 'text-zinc-100';
    const successTextColor = isDaylight ? 'text-green-600' : 'text-green-400';
    const successBgColor = isDaylight ? 'bg-green-500/10' : 'bg-green-500/20';
    const errorTextColor = isDaylight ? 'text-red-600' : 'text-red-400';
    const errorBgColor = isDaylight ? 'bg-red-500/10' : 'bg-red-500/10';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4 animate-in fade-in duration-200">
            <div className={`${glassBg} border ${borderColor} p-8 rounded-3xl max-w-lg w-full relative shadow-2xl animate-in zoom-in-95 duration-200 overflow-hidden flex flex-col max-h-[85vh]`}>
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 opacity-30 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors z-20"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <X size={20} />
                </button>

                {/* Header / Tabs */}
                <h2 className="text-2xl font-bold mb-6 flex items-center gap-4 shrink-0" style={{ color: 'var(--text-primary)' }}>
                    <span
                        className={`cursor-pointer transition-opacity ${activeTab === 'help' ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                        onClick={() => setActiveTab('help')}
                    >
                        {t('help.title') || "Help"}
                    </span>
                    <span className="opacity-20">/</span>
                    <span
                        className={`cursor-pointer transition-opacity ${activeTab === 'options' ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                        onClick={() => setActiveTab('options')}
                    >
                        {t('ui.options') || "Options"}
                    </span>
                </h2>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                    {activeTab === 'help' ? (
                        <div className="space-y-6">
                            {/* Navigation - REMOVED requested items */}
                            {/* 
                                Removed:
                                - Switch playlist
                                - Scroll / Slide
                                - Select playlist
                                - Click / Tap center
                            */}
                            {/* Remaining Navigation Items? The user requested to remove SPECIFIC items. 
                                "Switch playlist", "Scroll / Slide", "Select playlist", "Click / Tap center".
                                If there are others, I keep them. 
                                Looking at original:
                                - switchPlaylist
                                - scrollSwipe
                                - selectPlaylist
                                - clickTapCenter
                                All seem to be removed.
                                So I check if there are any left. The original had basically JUST these in Navigation.
                                I'll iterate through original items and verify.
                            */}

                            {/* Shortcuts */}
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Keyboard size={14} /> {t('help.keyboardShortcuts')}
                                </h3>
                                <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.navigatePlaylists')}</span>
                                        <div className="flex gap-1">
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">←</kbd>
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">→</kbd>
                                        </div>
                                    </li>
                                </ul>
                            </div>

                            {/* Player Controls */}
                            <div>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Keyboard size={14} /> {t('help.playerControls')}
                                </h3>
                                <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.playPause')}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Space</kbd>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.previousTrack')}</span>
                                        <div className="flex gap-1">
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Ctrl</kbd>
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">←</kbd>
                                        </div>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.nextTrack')}</span>
                                        <div className="flex gap-1">
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Ctrl</kbd>
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">→</kbd>
                                        </div>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.seekBackward')}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">←</kbd>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.seekForward')}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">→</kbd>
                                    </li>
                                </ul>
                            </div>

                            {/* Author Info (Moved from Footer) */}
                            <div className="mt-8 pt-6 border-t border-white/10 text-center shrink-0">
                                <div className="relative mb-1">
                                    <p className="text-sm opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                        <button
                                            type="button"
                                            onClick={handleAuthorLabelClick}
                                            className="hover:opacity-100 transition-opacity"
                                            style={{ color: 'inherit' }}
                                            aria-label="meow"
                                        >
                                            {t('help.madeBy') || "Made by"}
                                        </button>{' '}
                                        <a href="https://github.com/chthollyphile/folia-major" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors underline decoration-white/30 hover:decoration-white">chthollyphile</a>
                                    </p>
                                    {meowEasterEgg && (
                                        <span
                                            key={meowEasterEgg.id}
                                            className="pointer-events-none absolute left-1/2 top-0 text-lg font-bold opacity-0 animate-[meow-pop_1.6s_ease-out_forwards]"
                                            style={{
                                                color: meowEasterEgg.color,
                                                textShadow: '0 0 12px rgba(255,255,255,0.35)',
                                            }}
                                        >
                                            喵
                                        </span>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={handleCopyVersionInfo}
                                    className="text-xs font-mono opacity-30 hover:opacity-70 transition-opacity cursor-copy"
                                    style={{ color: 'var(--text-secondary)' }}
                                    title={versionCopied ? '已复制' : '点击复制版本信息'}
                                    aria-label={versionCopied ? '已复制版本信息' : '点击复制版本信息'}
                                >
                                    {versionCopied
                                        ? '已复制'
                                        : `folia-major v${__APP_VERSION__} - ${__GIT_BRANCH__} - ${__COMMIT_HASH__}`}
                                </button>
                                <p className="text-xs font-mono opacity-30 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                    AI Service: {aiServiceLabel}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                            {/* Visual Settings */}
                            <section>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Sparkles size={14} /> {t('options.visualSettings') || "Visual Settings"}
                                </h3>
                                <div className="space-y-4">
                                    {/* Theme Presets */}
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {t('options.themePresets') || "Theme Presets"}
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowThemePark(true)}
                                                className="shrink-0 w-9 h-9 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
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
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                style={{
                                                    borderColor: bgMode === 'default' ? theme?.accentColor || 'transparent' : 'transparent',
                                                    backgroundColor: isDaylight ? 'rgba(245, 245, 244, 0.8)' : 'rgba(9, 9, 11, 0.5)'
                                                }}
                                            >
                                                <div className="w-6 h-6 rounded-full shadow-sm" style={{ background: `linear-gradient(135deg, ${themeParkInitialTheme.light.backgroundColor}, ${themeParkInitialTheme.dark.backgroundColor})`, borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.15)' }} />
                                                <span className="text-xs opacity-80" style={{ color: isDaylight ? '#27272a' : '#e4e4e7' }}>{t('options.themePresetsDefault') || "Default"}</span>
                                            </button>
                                            <button
                                                onClick={() => onApplyCustomTheme()}
                                                disabled={!hasCustomTheme}
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed"
                                                style={{
                                                    borderColor: bgMode === 'custom' ? theme?.accentColor || 'transparent' : 'transparent',
                                                    backgroundColor: isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.08)'
                                                }}
                                            >
                                                <div className="w-6 h-6 rounded-full" style={{ background: hasCustomTheme ? `linear-gradient(135deg, ${themeParkInitialTheme.light.accentColor}, ${themeParkInitialTheme.dark.accentColor})` : 'rgba(114,119,134,0.4)' }} />
                                                <span className="text-xs opacity-80" style={{ color: 'var(--text-primary)' }}>{t('options.customTheme') || "Custom"}</span>
                                            </button>
                                        </div>
                                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center justify-between gap-3">
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
                                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!isCustomThemePreferred ? 'bg-white/10' : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
                                                style={{ backgroundColor: isCustomThemePreferred ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isCustomThemePreferred ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.lyricsRenderer') || "Lyrics Renderer"}
                                                </div>
                                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.lyricsRendererDesc') || "Choose the lyrics rendering mode used on the playback page."}
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setShowVisPlayground(true)}
                                                className="shrink-0 w-9 h-9 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
                                                style={{ color: 'var(--text-primary)' }}
                                                title={t('options.openLyricsStyleSettings') || '打开歌词样式设置'}
                                                aria-label={t('options.openLyricsStyleSettings') || '打开歌词样式设置'}
                                            >
                                                <Settings2 size={16} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3">
                                            <button
                                                onClick={() => onVisualizerModeChange?.('classic')}
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                style={{
                                                    borderColor: visualizerMode === 'classic' ? theme?.accentColor || 'var(--text-accent)' : 'transparent',
                                                    backgroundColor: visualizerMode === 'classic' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
                                                }}
                                            >
                                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('ui.visualizerClassic')}
                                                </span>
                                            </button>
                                            <button
                                                onClick={() => onVisualizerModeChange?.('cadenza')}
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                style={{
                                                    borderColor: visualizerMode === 'cadenza' ? theme?.accentColor || 'var(--text-accent)' : 'transparent',
                                                    backgroundColor: visualizerMode === 'cadenza' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
                                                }}
                                            >
                                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('ui.visualizerCadenze')}
                                                </span>
                                            </button>
                                            <button
                                                onClick={() => onVisualizerModeChange?.('partita')}
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                style={{
                                                    borderColor: visualizerMode === 'partita' ? theme?.accentColor || 'var(--text-accent)' : 'transparent',
                                                    backgroundColor: visualizerMode === 'partita' ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
                                                }}
                                            >
                                                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('ui.visualizerPartita')}
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Opacity Slider */}
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-3">
                                        <div className="flex justify-between items-center">
                                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {t('options.backgroundOpacity') || "Background Opacity"}
                                            </div>
                                            <div className="text-xs font-mono opacity-50">
                                                {Math.round(backgroundOpacity * 100)}%
                                            </div>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="1"
                                            step="0.05"
                                            value={backgroundOpacity}
                                            onChange={(e) => setBackgroundOpacity?.(parseFloat(e.target.value))}
                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                        />
                                    </div>
                                </div>
                            </section>

                            {/* Cache Details */}
                            <section>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Database size={14} /> {t('options.cacheDetails') || "Cache Storage"}
                                    <button
                                        onClick={async () => {
                                            if (confirm(t('options.confirmClearAll') || '确定要清空所有缓存数据吗？此操作不可恢复。')) {
                                                setIsCleaning('all');
                                                await clearAllData();
                                                window.location.reload();
                                            }
                                        }}
                                        disabled={isCleaning === 'all'}
                                        className={`ml-auto text-xs font-normal normal-case tracking-normal px-2 py-1 hover:bg-white/10 rounded-lg ${errorTextColor} opacity-60 hover:opacity-100 transition-all disabled:opacity-20 flex items-center gap-1`}
                                    >
                                        {isCleaning === 'all' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                        {t('options.clearAll') || "清空所有"}
                                    </button>
                                </h3>

                                <div className="space-y-3">
                                    {[
                                        { id: 'playlist', label: t('options.playlistData') || "Playlist Data", size: cacheSizes.playlist, icon: Layers },
                                        { id: 'lyrics', label: t('options.lyrics') || "Lyrics", size: cacheSizes.lyrics, icon: Command },
                                        { id: 'cover', label: t('options.covers') || "Covers", size: cacheSizes.cover, icon: DiscIcon },
                                        { id: 'media', label: t('options.mediaFiles') || "Media Files", size: cacheSizes.media, icon: PlayCircle },
                                    ].map((item) => (
                                        <div key={item.id} className="flex items-center justify-between bg-white/5 p-3 rounded-xl border border-white/5">
                                            <div className="flex items-center gap-3">
                                                <div className="p-2 bg-white/5 rounded-lg opacity-60">
                                                    <item.icon size={16} />
                                                </div>
                                                <div>
                                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{item.label}</div>
                                                    <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>{item.size}</div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleClear(item.id as any)}
                                                disabled={isCleaning === item.id}
                                                className={`p-2 hover:bg-white/10 rounded-lg ${errorTextColor} opacity-60 hover:opacity-100 transition-all disabled:opacity-20`}
                                                title="Clear"
                                            >
                                                {isCleaning === item.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            {/* Media Cache Settings */}
                            <section>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Database size={14} /> {t('options.mediaCache') || "Media Cache"}
                                </h3>
                                <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                                    <div className="flex items-center justify-between">
                                        <div className="space-y-1">
                                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {t('options.enableMediaCache') || "Cache Songs"}
                                            </div>
                                            <div className="text-xs opacity-50 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.enableMediaCacheDesc') || "Cache audio after playback for offline listening."}
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => onToggleMediaCache && onToggleMediaCache(!enableMediaCache)}
                                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!enableMediaCache ? 'bg-white/20' : ''}`}
                                            style={{ backgroundColor: enableMediaCache ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                        >
                                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enableMediaCache ? 'translate-x-6' : 'translate-x-0'}`} />
                                        </button>
                                    </div>

                                    {isElectron && (
                                        <div className="pt-3 border-t border-white/10 space-y-3">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                                    <FolderOpen size={14} />
                                                    {t('options.cacheDirectory') || "Cache Directory"}
                                                </div>
                                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.cacheDirectoryDesc') || "Choose where large desktop cache files should be stored."}
                                                </div>
                                            </div>

                                            <div className="flex gap-2">
                                                <div className="flex-1 bg-black/10 rounded-lg border border-white/5 px-3 py-2 min-w-0">
                                                    <div className="text-[11px] break-all font-mono" style={{ color: 'var(--text-primary)' }}>
                                                        {cacheDirectory || '...'}
                                                    </div>
                                                    <div className="text-[10px] opacity-45 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                                        {cacheDirectoryIsDefault
                                                            ? (t('options.cacheDirectoryDefaultHint') || "Using the default desktop cache location.")
                                                            : (t('options.cacheDirectoryCustomHint') || "Using a custom cache location.")}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={handleChooseCacheDirectory}
                                                    disabled={cacheDirectoryStatus !== 'idle'}
                                                    className="shrink-0 w-12 rounded-lg text-sm font-medium transition-colors flex items-center justify-center bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                                                    style={{ color: 'var(--text-primary)' }}
                                                    title={t('options.chooseCacheDirectory') || 'Choose Folder'}
                                                    aria-label={t('options.chooseCacheDirectory') || 'Choose Folder'}
                                                >
                                                    {cacheDirectoryStatus === 'choosing' ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                                                </button>
                                            </div>

                                            {/* <div className="text-[10px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.cacheDirectoryPendingDesc') || "Electron now stores audio cache files in this directory. Lyrics, covers, and other browser-side caches still use the app data directory."}
                                            </div> */}
                                        </div>
                                    )}

                                    <div className="pt-3 border-t border-white/10 flex justify-between items-center text-xs opacity-50">
                                        <span>{t('options.cachedSongsCount') || "Cached Songs"}:</span>
                                        <span className="font-mono">{mediaCount}</span>
                                    </div>
                                </div>
                            </section>

                            {/* Navidrome Settings */}
                            <section>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Server size={14} /> {t('navidrome.settings') || "Navidrome Settings"}
                                    {navidromeEnabled && navidromeConfigured && (
                                        <span className={`ml-2 px-2 py-0.5 ${successBgColor} ${successTextColor} text-xs rounded-full font-normal normal-case`}>
                                            {t('navidrome.connectionSuccess') || "Connected"}
                                        </span>
                                    )}
                                </h3>
                                <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                                    {/* Enable Toggle */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('navidrome.enable') || "Enable Navidrome"}
                                        </span>
                                        <button
                                            onClick={() => handleToggleNavidromeEnabled(!navidromeEnabled)}
                                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!navidromeEnabled ? 'bg-white/10' : ''}`}
                                            style={{ backgroundColor: navidromeEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                        >
                                            <div
                                                className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-300 ${navidromeEnabled ? 'translate-x-6' : 'translate-x-0'
                                                    }`}
                                            />
                                        </button>
                                    </div>

                                    {/* Config (only show when enabled) */}
                                    {navidromeEnabled && (
                                        <>
                                            {/* Server URL */}
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('navidrome.serverUrl') || "Server URL"}
                                                </label>
                                                <input
                                                    type="url"
                                                    value={navidromeUrl}
                                                    onChange={(e) => setNavidromeUrl(e.target.value)}
                                                    placeholder={t('navidrome.serverUrlPlaceholder') || "e.g., http://localhost:4533"}
                                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                    style={{ color: 'var(--text-primary)' }}
                                                />
                                            </div>

                                            {/* Username */}
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('navidrome.username') || "Username"}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={navidromeUsername}
                                                    onChange={(e) => setNavidromeUsername(e.target.value)}
                                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                    style={{ color: 'var(--text-primary)' }}
                                                />
                                            </div>

                                            {/* Password */}
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('navidrome.password') || "Password"}
                                                </label>
                                                <input
                                                    type="password"
                                                    value={navidromePassword}
                                                    onChange={(e) => setNavidromePassword(e.target.value)}
                                                    placeholder={navidromeConfigured ? "••••••••" : ""}
                                                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                    style={{ color: 'var(--text-primary)' }}
                                                />
                                            </div>
                                        </>
                                    )}

                                    {/* Buttons (only show when enabled) */}
                                    {navidromeEnabled && (
                                        <div className="flex gap-2 pt-2">
                                            <button
                                                onClick={testNavidromeConnection}
                                                disabled={navidromeTestStatus === 'testing' || !navidromeUrl || !navidromeUsername || !navidromePassword}
                                                className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed"
                                                style={{ color: 'var(--text-primary)' }}
                                            >
                                                {navidromeTestStatus === 'testing' ? (
                                                    <>
                                                        <Loader2 size={16} className="animate-spin" />
                                                        {t('navidrome.testing') || "Connecting..."}
                                                    </>
                                                ) : navidromeTestStatus === 'success' ? (
                                                    <>
                                                        <Check size={16} className={successTextColor} />
                                                        {t('navidrome.connectionSuccess') || "Connected"}
                                                    </>
                                                ) : navidromeTestStatus === 'failed' ? (
                                                    <>
                                                        <AlertCircle size={16} className={errorTextColor} />
                                                        {t('navidrome.connectionFailed') || "Failed"}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Server size={16} />
                                                        {t('navidrome.testConnection') || "Test Connection"}
                                                    </>
                                                )}
                                            </button>

                                            {navidromeConfigured && (
                                                <button
                                                    onClick={handleClearNavidrome}
                                                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${errorBgColor} hover:bg-red-500/20 ${errorTextColor}`}
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Electron Settings */}
                            {isElectron && (
                                <section>
                                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                        <Command size={14} /> {t('options.electronSettings') || "Desktop App Settings"}
                                    </h3>
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                                        <div className="space-y-4">
                                            {/* AI Provider selector */}
                                            <div className="flex items-center justify-between">
                                                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.aiProvider') || "AI Provider"}
                                                </label>
                                                <div className="flex bg-white/5 rounded-lg border border-white/10 p-1">
                                                    <button
                                                        onClick={() => setElectronSettings({ ...electronSettings, AI_PROVIDER: 'gemini' })}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${electronSettings.AI_PROVIDER !== 'openai' ? 'bg-white/10 text-white shadow-sm' : 'opacity-50 hover:opacity-100'
                                                            }`}
                                                    >
                                                        Gemini
                                                    </button>
                                                    <button
                                                        onClick={() => setElectronSettings({ ...electronSettings, AI_PROVIDER: 'openai' })}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${electronSettings.AI_PROVIDER === 'openai' ? 'bg-white/10 text-white shadow-sm' : 'opacity-50 hover:opacity-100'
                                                            }`}
                                                    >
                                                        OpenAI
                                                    </button>
                                                </div>
                                            </div>

                                            {electronSettings.AI_PROVIDER !== 'openai' ? (
                                                <div className="space-y-2">
                                                    <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                        {t('options.geminiApiKey') || "Gemini API Key"}
                                                    </label>
                                                    <div className="flex gap-2">
                                                        <input
                                                            type="password"
                                                            value={electronSettings.GEMINI_API_KEY || ''}
                                                            onChange={(e) => setElectronSettings({ ...electronSettings, GEMINI_API_KEY: e.target.value })}
                                                            placeholder="AI Theme Generation Key"
                                                            className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                            style={{ color: 'var(--text-primary)' }}
                                                        />
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="space-y-2">
                                                        <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                            {t('options.openaiApiUrl') || "OpenAI API URL"}
                                                        </label>
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                value={electronSettings.OPENAI_API_URL || ''}
                                                                onChange={(e) => setElectronSettings({ ...electronSettings, OPENAI_API_URL: e.target.value })}
                                                                placeholder="https://api.openai.com/v1/chat/completions"
                                                                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                                style={{ color: 'var(--text-primary)' }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                            {t('options.openaiApiKey') || "OpenAI API Key"}
                                                        </label>
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="password"
                                                                value={electronSettings.OPENAI_API_KEY || ''}
                                                                onChange={(e) => setElectronSettings({ ...electronSettings, OPENAI_API_KEY: e.target.value })}
                                                                placeholder="sk-..."
                                                                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                                style={{ color: 'var(--text-primary)' }}
                                                            />
                                                        </div>
                                                    </div>
                                                </>
                                            )}

                                            <div className="flex items-center justify-between pt-3 pb-1">
                                                <div className="space-y-1">
                                                    <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                        {t('options.useSystemProxyAI') || "Use System Proxy for AI"}
                                                    </label>
                                                    <div className="text-[10px] opacity-40 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                                                        {t('options.useSystemProxyAIDesc') || "Route strictly AI requests through system proxy."}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => setElectronSettings({ ...electronSettings, USE_SYSTEM_PROXY_FOR_AI: !electronSettings.USE_SYSTEM_PROXY_FOR_AI })}
                                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${!electronSettings.USE_SYSTEM_PROXY_FOR_AI ? 'bg-white/10' : ''}`}
                                                    style={{ backgroundColor: electronSettings.USE_SYSTEM_PROXY_FOR_AI ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                                >
                                                    <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${electronSettings.USE_SYSTEM_PROXY_FOR_AI ? 'translate-x-6' : 'translate-x-0'}`} />
                                                </button>
                                            </div>

                                            <div className="flex justify-between items-center pt-3 border-t border-white/10">
                                                <div className="text-[10px] opacity-40 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.geminiApiKeyDesc') || "Netease API backend runs locally."}
                                                </div>
                                                <button
                                                    onClick={saveElectronSettings}
                                                    disabled={electronSaveStatus === 'saving'}
                                                    className="px-4 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    {electronSaveStatus === 'saved' ? <Check size={16} className={successTextColor} /> : (t('options.save') || "Save")}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            )}

                            {/* Static Mode */}
                            <section>
                                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                    <Monitor size={14} /> {t('options.staticMode') || "Static Mode"}
                                </h3>
                                <div className="bg-white/5 p-4 rounded-xl border border-white/5 flex items-center justify-between">
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('options.enableStaticMode') || "Static Mode"}
                                        </div>
                                        <div className="text-xs opacity-50 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.enableStaticModeDesc') || "Disable geometric backgrounds."}
                                        </div>
                                        <div className="text-[11px] opacity-40 max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.enableStaticModeDescSub') || "Does not affect lyric text effects or rendering."}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => onToggleStaticMode && onToggleStaticMode(!staticMode)}
                                        className={`w-12 h-6 rounded-full p-1 transition-colors ${!staticMode ? 'bg-white/10' : ''}`}
                                        style={{ backgroundColor: staticMode ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                    >
                                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${staticMode ? 'translate-x-6' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </section>
                        </div>
                    )}
                </div>

                {/* Footer (Empty now) */}
                {/* <div className="mt-8 pt-0 border-t-0 p-0" /> */}
            </div>
            {showVisPlayground && (
                <VisPlayground
                    theme={theme}
                    isDaylight={isDaylight}
                    visualizerMode={visualizerMode}
                    backgroundOpacity={backgroundOpacity}
                    staticMode={staticMode}
                    cadenzaTuning={cadenzaTuning}
                    partitaTuning={partitaTuning}
                    fontStyle={lyricsFontStyle}
                    fontScale={lyricsFontScale}
                    customFontFamily={lyricsCustomFontFamily}
                    customFontLabel={lyricsCustomFontLabel}
                    onFontStyleChange={onLyricsFontStyleChange}
                    onFontScaleChange={onLyricsFontScaleChange}
                    onCustomFontChange={onLyricsCustomFontChange}
                    onPartitaTuningChange={onPartitaTuningChange}
                    onResetPartitaTuning={onResetPartitaTuning}
                    onClose={() => setShowVisPlayground(false)}
                />
            )}
            {showThemePark && (
                <ThemePark
                    initialTheme={themeParkInitialTheme}
                    isDaylight={isDaylight}
                    visualizerMode={visualizerMode}
                    staticMode={staticMode}
                    backgroundOpacity={backgroundOpacity}
                    cadenzaTuning={cadenzaTuning}
                    partitaTuning={partitaTuning}
                    lyricsFontStyle={lyricsFontStyle}
                    lyricsFontScale={lyricsFontScale}
                    lyricsCustomFontFamily={lyricsCustomFontFamily}
                    onSaveTheme={(dualTheme) => {
                        onSaveCustomTheme(dualTheme);
                        setShowThemePark(false);
                    }}
                    onClose={() => setShowThemePark(false)}
                />
            )}
            <style>{`
                @keyframes meow-pop {
                    0% {
                        opacity: 0;
                        transform: translate(-50%, 10px) scale(0.8);
                    }
                    20% {
                        opacity: 1;
                        transform: translate(-50%, -6px) scale(1);
                    }
                    100% {
                        opacity: 0;
                        transform: translate(-50%, -24px) scale(1.08);
                    }
                }
            `}</style>
        </div>
    );
};

// Simple Disc Icon for Cover
const DiscIcon = ({ size, className }: { size: number, className?: string; }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

export default HelpModal;
