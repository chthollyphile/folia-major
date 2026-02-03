import React, { useState, useEffect } from 'react';
import { X, Command, MousePointer2, Keyboard, Settings2, Trash2, Database, Layers, Monitor, PlayCircle, Loader2, Sparkles, Server, Check, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCacheUsageByCategory, clearCacheByCategory, clearAllData } from '../services/db';
import { Theme } from '../types';
import { getNavidromeConfig, saveNavidromeConfig, clearNavidromeConfig, hashPassword, navidromeApi, isNavidromeEnabled, setNavidromeEnabled } from '../services/navidromeService';
import { NavidromeConfig } from '../types/navidrome';

interface HelpModalProps {
    onClose: () => void;
    staticMode?: boolean;
    onToggleStaticMode?: (enable: boolean) => void;
    enableMediaCache?: boolean;
    onToggleMediaCache?: (enable: boolean) => void;
    theme?: Theme;
    backgroundOpacity?: number;
    setBackgroundOpacity?: (opacity: number) => void;
    onSetThemePreset?: (preset: 'midnight' | 'daylight') => void;
    isDaylight: boolean;
    onToggleNavidrome?: (enabled: boolean) => void;
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
    onSetThemePreset,
    isDaylight,
    onToggleNavidrome
}) => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'help' | 'options'>('help');

    // Cache State
    const [cacheSizes, setCacheSizes] = useState({
        playlist: '0 B',
        lyrics: '0 B',
        cover: '0 B',
        media: '0 B'
    });
    const [mediaCount, setMediaCount] = useState(0);
    const [isCleaning, setIsCleaning] = useState<string | null>(null);

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

    // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-900/90'; // Use slightly higher opacity for modal than panel
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const textColor = isDaylight ? 'text-zinc-800' : 'text-zinc-100';

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
                                <p className="text-sm opacity-60 mb-1" style={{ color: 'var(--text-secondary)' }}>
                                    {t('help.madeBy') || "Made by"} <a href="https://github.com/chthollyphile/folia-major" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors underline decoration-white/30 hover:decoration-white">chthollyphile</a>
                                </p>
                                <p className="text-xs font-mono opacity-30" style={{ color: 'var(--text-secondary)' }}>
                                    {t('help.version') || "Version"}: folia-major - {__GIT_BRANCH__} - {__COMMIT_HASH__}
                                </p>
                                {theme?.provider && (
                                    <p className="text-xs font-mono opacity-30 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                        AI Service: {theme.provider}
                                    </p>
                                )}
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
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('options.themePresets') || "Theme Presets"}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <button
                                                onClick={() => onSetThemePreset?.('midnight')}
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                style={{
                                                    borderColor: theme?.name === 'Midnight Default' ? theme.accentColor : 'transparent',
                                                    backgroundColor: 'rgba(9, 9, 11, 0.5)'
                                                }}
                                            >
                                                <div className="w-6 h-6 rounded-full bg-zinc-950 border border-zinc-700" />
                                                <span className="text-xs opacity-80 text-zinc-300">{t('options.themePresetsMidnight') || "Midnight"}</span>
                                            </button>
                                            <button
                                                onClick={() => onSetThemePreset?.('daylight')}
                                                className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                style={{
                                                    borderColor: theme?.name === 'Daylight Default' ? theme.accentColor : 'transparent',
                                                    backgroundColor: 'rgba(245, 245, 244, 0.8)'
                                                }}
                                            >
                                                <div className="w-6 h-6 rounded-full bg-[#f5f5f4] border border-zinc-300 shadow-sm" />
                                                <span className="text-xs opacity-80 text-zinc-800">{t('options.themePresetsDaylight') || "Daylight"}</span>
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
                                        className="ml-auto text-xs font-normal normal-case tracking-normal px-2 py-1 hover:bg-white/10 rounded-lg text-red-400 opacity-60 hover:opacity-100 transition-all disabled:opacity-20 flex items-center gap-1"
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
                                                className="p-2 hover:bg-white/10 rounded-lg text-red-400 opacity-60 hover:opacity-100 transition-all disabled:opacity-20"
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
                                        <span className="ml-2 px-2 py-0.5 bg-green-500/20 text-green-400 text-xs rounded-full font-normal normal-case">
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
                                                        <Check size={16} className="text-green-400" />
                                                        {t('navidrome.connectionSuccess') || "Connected"}
                                                    </>
                                                ) : navidromeTestStatus === 'failed' ? (
                                                    <>
                                                        <AlertCircle size={16} className="text-red-400" />
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
                                                    className="px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 bg-red-500/10 hover:bg-red-500/20 text-red-400"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </section>

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
                                            {t('options.enableStaticModeDesc') || "Disable geometric backgrounds and dynamic lyrics."}
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
