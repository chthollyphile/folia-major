import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Command, MousePointer2, Keyboard, Settings2, Trash2, Database, Monitor, PlayCircle, Loader2, Server, Check, AlertCircle, FlaskConical, ChevronLeft, ChevronRight, RefreshCw, Download, ExternalLink, Sparkles, Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCacheUsageByCategory, clearCacheByCategory, clearAllData } from '../../services/db';
import { DualTheme, StageStatus, StageSource, Theme, ThemeMode, type CadenzaTuning, type CappellaEmojiImage, type CappellaTuning, type FumeTuning, type NowPlayingConnectionStatus, type PartitaTuning, type TiltTuning, type StoredCustomLyricsFont, type VisualizerMode } from '../../types';
import { getNavidromeConfig, saveNavidromeConfig, clearNavidromeConfig, hashPassword, navidromeApi, isNavidromeEnabled, setNavidromeEnabled } from '../../services/navidromeService';
import { NavidromeConfig } from '../../types/navidrome';
import VisPlayground from '../visualizer/VisPlayground';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel } from '../visualizer/registry';
import ThemePark from './ThemePark';
import LyricFilterSettingsModal from './LyricFilterSettingsModal';
import AppearanceSettingsSubview from './settings/AppearanceSettingsSubview';
import DesktopSettingsSubview from './settings/DesktopSettingsSubview';
import IntegrationSettingsSubview from './settings/IntegrationSettingsSubview';
import LabSettingsModal from './settings/LabSettingsModal';
import PlaybackSettingsSubview from './settings/PlaybackSettingsSubview';
import StorageSettingsSection from './settings/StorageSettingsSection';
import meowImageUrl from '../../../build/miao.png';
import type { LyricData } from '../../types';
import { selectSettingsUiSnapshot, type SettingsSubviewId, useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { useShallow } from 'zustand/react/shallow';


interface SettingsModalProps {
    onClose: () => void;
    initialTab?: 'help' | 'options';
    initialSubview?: SettingsSubviewId | null;
    theme?: Theme;
    bgMode: ThemeMode;
    onApplyDefaultTheme: () => void;
    hasCustomTheme: boolean;
    themeParkInitialTheme: DualTheme;
    isCustomThemePreferred: boolean;
    songThemeAutoSwitchEnabled: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onApplyCustomTheme: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    onToggleNavidrome?: (enabled: boolean) => void;
    loadLyricFilterPreview: () => Promise<LyricData | null>;
    currentSongTitle?: string | null;
    onSaveLyricFilterPattern: (pattern: string) => Promise<void> | void;
    stageStatus?: StageStatus | null;
    stageSource?: StageSource | null;
    onToggleStageMode?: (enabled: boolean) => Promise<void> | void;
    onStageSourceChange?: (source: StageSource) => Promise<void> | void;
    onRegenerateStageToken?: () => Promise<void> | void;
    onClearStageState?: () => Promise<void> | void;
    onToggleNowPlayingStage?: (enabled: boolean) => Promise<void> | void;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    aiTheme?: DualTheme | null;
    customTheme?: DualTheme | null;
}

const QUARK_DOWNLOAD_URL = 'https://pan.quark.cn/s/6e4c6fa3bc6f';

const SettingsModal: React.FC<SettingsModalProps> = ({
    onClose,
    initialTab = 'help',
    initialSubview = null,
    theme,
    bgMode,
    onApplyDefaultTheme,
    hasCustomTheme,
    themeParkInitialTheme,
    isCustomThemePreferred,
    songThemeAutoSwitchEnabled,
    onSaveCustomTheme,
    onApplyCustomTheme,
    onToggleCustomThemePreferred,
    onToggleSongThemeAutoSwitch,
    onToggleNavidrome,
    loadLyricFilterPreview,
    currentSongTitle,
    onSaveLyricFilterPattern,
    stageStatus = null,
    stageSource = null,
    onToggleStageMode,
    onStageSourceChange,
    onRegenerateStageToken,
    onClearStageState,
    onToggleNowPlayingStage,
    nowPlayingConnectionStatus = 'disabled',
    onAudioOutputDeviceChange,
    aiTheme,
    customTheme,
}) => {
    const { t } = useTranslation();
    const {
        useCoverColorBg,
        staticMode,
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerTranslationSubtitle,
        hidePlayerRightPanelButton,
        transparentPlayerBackground,
        disableVisualizerVignette,
        disableVisualizerGeometricBackground,
        minimizeToTray,
        hideTaskbarIcon,
        openPlayerOnLaunch,
        enableMediaCache,
        backgroundOpacity,
        subtitleOverlayOpacity,
        visualizerOpacity,
        visualizerBackgroundMode,
        isDaylight,
        visualizerMode,
        homeLayoutStyle,
        grid3dCardStyle,
        classicTuning,
        cadenzaTuning,
        partitaTuning,
        fumeTuning,
        cappellaTuning,
        tiltTuning,
        monetBackgroundTuning,
        monetTuning,
        cappellaCustomEmojiImages,
        isLoadingCappellaCustomEmojiPack,
        cappellaCustomAvatarImages,
        isLoadingCappellaCustomAvatarPack,
        monetBackgroundImage,
        isLoadingMonetBackgroundImage,
        monetPortraitImage,
        isLoadingMonetPortraitImage,
        urlBackgroundList,
        urlBackgroundSelectedId,
        lyricsFontStyle,
        lyricsFontScale,
        lyricsCustomFontFamily,
        lyricsCustomFontLabel,
        lyricFilterPattern,
        showOpenPanelCloseButton,
        enableNowPlayingStage,
        handleToggleCoverColorBg: onToggleCoverColorBg,
        handleToggleStaticMode: onToggleStaticMode,
        handleToggleDisableHomeDynamicBackground: onToggleDisableHomeDynamicBackground,
        handleToggleHidePlayerProgressBar: onToggleHidePlayerProgressBar,
        handleToggleHidePlayerTranslationSubtitle: onToggleHidePlayerTranslationSubtitle,
        handleToggleHidePlayerRightPanelButton: onToggleHidePlayerRightPanelButton,
        handleToggleTransparentPlayerBackground: onToggleTransparentPlayerBackground,
        handleToggleDisableVisualizerVignette: onToggleDisableVisualizerVignette,
        handleToggleDisableVisualizerGeometricBackground: onToggleDisableVisualizerGeometricBackground,
        handleToggleMinimizeToTray: onToggleMinimizeToTray,
        handleToggleHideTaskbarIcon: onToggleHideTaskbarIcon,
        handleToggleOpenPlayerOnLaunch: onToggleOpenPlayerOnLaunch,
        handleToggleMediaCache: onToggleMediaCache,
        handleSetBackgroundOpacity: setBackgroundOpacity,
        handleSetSubtitleOverlayOpacity: setSubtitleOverlayOpacity,
        handleSetVisualizerOpacity: setVisualizerOpacity,
        handleSetVisualizerBackgroundMode: onVisualizerBackgroundModeChange,
        handleResetVisualizerBackgroundMode: onResetVisualizerBackgroundMode,
        handleSetVisualizerMode: onVisualizerModeChange,
        handleSetClassicTuning: onClassicTuningChange,
        handleResetClassicTuning: onResetClassicTuning,
        handleSetPartitaTuning: onPartitaTuningChange,
        handleResetPartitaTuning: onResetPartitaTuning,
        handleSetFumeTuning: onFumeTuningChange,
        handleResetFumeTuning: onResetFumeTuning,
        handleSetCappellaTuning: onCappellaTuningChange,
        handleResetCappellaTuning: onResetCappellaTuning,
        handleSetTiltTuning: onTiltTuningChange,
        handleResetTiltTuning: onResetTiltTuning,
        handleSetMonetBackgroundTuning: onMonetBackgroundTuningChange,
        handleResetMonetBackgroundTuning: onResetMonetBackgroundTuning,
        handleSetMonetTuning: onMonetTuningChange,
        handleResetMonetTuning: onResetMonetTuning,
        handleUploadMonetBackgroundImage: onUploadMonetBackgroundImage,
        handleClearMonetBackgroundImage: onClearMonetBackgroundImage,
        handleUploadMonetPortraitImage: onUploadMonetPortraitImage,
        handleClearMonetPortraitImage: onClearMonetPortraitImage,
        handleAddUrlBackgroundItem: onAddUrlBackgroundItem,
        handleUpdateUrlBackgroundItem: onUpdateUrlBackgroundItem,
        handleDeleteUrlBackgroundItem: onDeleteUrlBackgroundItem,
        handleSetUrlBackgroundSelectedId: onSetUrlBackgroundSelectedId,
        handleImportCustomCappellaEmojiPack: onImportCappellaCustomEmojiPack,
        handleClearCustomCappellaEmojiPack: onClearCappellaCustomEmojiPack,
        handleImportCustomCappellaAvatar: onImportCappellaCustomAvatar,
        handleClearCustomCappellaAvatar: onClearCappellaCustomAvatar,
        handleSetLyricsFontStyle: onLyricsFontStyleChange,
        handleSetLyricsFontScale: onLyricsFontScaleChange,
        handleSetLyricsCustomFont: onLyricsCustomFontChange,
        handleUploadLyricsCustomFont: onLyricsCustomFontUpload,
        handleToggleOpenPanelCloseButton: onToggleOpenPanelCloseButton,
        handleSetHomeLayoutStyle: onChangeHomeLayoutStyle,
        handleSetGrid3dCardStyle: onChangeGrid3dCardStyle,
    } = useSettingsUiStore(useShallow(selectSettingsUiSnapshot));
    const setIsSubSettingsViewOpen = useSettingsUiStore(state => state.setIsSubSettingsViewOpen);
    const [activeTab, setActiveTab] = useState<'help' | 'options'>(initialTab);
    const [showVisPlayground, setShowVisPlayground] = useState(false);
    const [showThemePark, setShowThemePark] = useState(false);
    const [showAppearanceSettings, setShowAppearanceSettings] = useState(false);
    const [showPlaybackSettings, setShowPlaybackSettings] = useState(false);
    const [showIntegrationSettings, setShowIntegrationSettings] = useState(false);
    const [showStorageSettings, setShowStorageSettings] = useState(false);
    const [showDesktopSettings, setShowDesktopSettings] = useState(false);
    const [showLabSettings, setShowLabSettings] = useState(false);
    const [showLyricFilterSettings, setShowLyricFilterSettings] = useState(false);
    const [versionCopied, setVersionCopied] = useState(false);
    const [stageAddressCopied, setStageAddressCopied] = useState(false);
    const [authorClickCount, setAuthorClickCount] = useState(0);
    const [meowEasterEgg, setMeowEasterEgg] = useState<{ id: number; } | null>(null);
    const shouldCloseModalOnSubviewBack = initialSubview !== null;

    useEffect(() => {
        setActiveTab(initialTab);
        setShowVisPlayground(initialSubview === 'visualizer');
        setShowThemePark(initialSubview === 'themePark');
        setShowAppearanceSettings(initialSubview === 'appearance');
        setShowPlaybackSettings(initialSubview === 'playback');
        setShowIntegrationSettings(initialSubview === 'integration');
        setShowStorageSettings(initialSubview === 'storage');
        setShowDesktopSettings(initialSubview === 'desktop');
        setShowLabSettings(initialSubview === 'lab');
        setShowLyricFilterSettings(initialSubview === 'lyricFilter');
    }, [initialSubview, initialTab]);

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
        OPENAI_API_MODEL: '',
        AI_PROVIDER: 'gemini',
        USE_SYSTEM_PROXY_FOR_AI: false,
        ENABLE_UPDATE_CHECK: true,
        ENABLE_AUTO_UPDATE: false,
        STAGE_MODE_SOURCE: 'stage-api'
    });
    const [electronSaveStatus, setElectronSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [updateStatus, setUpdateStatus] = useState<ElectronUpdateStatus | null>(null);
    const [cacheDirectory, setCacheDirectory] = useState<string>('');
    const [cacheDirectoryIsDefault, setCacheDirectoryIsDefault] = useState(true);
    const [cacheDirectoryStatus, setCacheDirectoryStatus] = useState<'idle' | 'choosing'>('idle');
    const [stageActionStatus, setStageActionStatus] = useState<'idle' | 'regenerating'>('idle');
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
            (window as any).electron.getUpdateStatus?.().then((status: ElectronUpdateStatus) => {
                setUpdateStatus(status);
            });
        }
    }, []);

    useEffect(() => {
        if (!window.electron?.onUpdateStatusChanged) {
            return;
        }

        return window.electron.onUpdateStatusChanged((status) => {
            setUpdateStatus(status);
        });
    }, []);

    useEffect(() => {
        if (!updateStatus?.availableVersion || updateStatus.updateSeen || !window.electron?.markUpdateSeen) {
            return;
        }

        window.electron.markUpdateSeen(updateStatus.availableVersion).then(setUpdateStatus).catch(() => {
            // Seeing the settings panel should never fail the panel itself.
        });
    }, [updateStatus?.availableVersion, updateStatus?.updateSeen]);

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
        const versionInfo = `${__APP_VERSION_LABEL__} v${__APP_VERSION__} - ${__GIT_BRANCH__} - ${__COMMIT_HASH__}`;

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

            if (nextCount >= 7) {
                const id = Date.now();
                setMeowEasterEgg({ id });
                window.setTimeout(() => {
                    setMeowEasterEgg((current) => (current?.id === id ? null : current));
                }, 2200);
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
            await (window as any).electron.saveSettings('OPENAI_API_MODEL', electronSettings.OPENAI_API_MODEL);
            await (window as any).electron.saveSettings('AI_PROVIDER', electronSettings.AI_PROVIDER);
            await (window as any).electron.saveSettings('USE_SYSTEM_PROXY_FOR_AI', electronSettings.USE_SYSTEM_PROXY_FOR_AI);
            await (window as any).electron.saveSettings('ENABLE_UPDATE_CHECK', electronSettings.ENABLE_UPDATE_CHECK);
            await (window as any).electron.saveSettings('ENABLE_AUTO_UPDATE', electronSettings.ENABLE_AUTO_UPDATE);
            setElectronSaveStatus('saved');
            setTimeout(() => setElectronSaveStatus('idle'), 2000);
        }
    };

    const handleToggleUpdateCheck = async () => {
        if (!window.electron?.saveSettings) {
            return;
        }

        const nextEnabled = !electronSettings.ENABLE_UPDATE_CHECK;
        const nextSettings = {
            ...electronSettings,
            ENABLE_UPDATE_CHECK: nextEnabled,
            ENABLE_AUTO_UPDATE: nextEnabled ? electronSettings.ENABLE_AUTO_UPDATE : false,
        };

        setElectronSettings(nextSettings);
        await window.electron.saveSettings('ENABLE_UPDATE_CHECK', nextSettings.ENABLE_UPDATE_CHECK);
        if (!nextSettings.ENABLE_AUTO_UPDATE) {
            await window.electron.saveSettings('ENABLE_AUTO_UPDATE', false);
        }

        const status = await window.electron.getUpdateStatus?.();
        if (status) {
            setUpdateStatus(status);
        }
    };

    const handleToggleAutoUpdate = async () => {
        if (!window.electron?.saveSettings || !electronSettings.ENABLE_UPDATE_CHECK || !updateStatus?.supported) {
            return;
        }

        const nextEnabled = !electronSettings.ENABLE_AUTO_UPDATE;
        setElectronSettings({ ...electronSettings, ENABLE_AUTO_UPDATE: nextEnabled });
        await window.electron.saveSettings('ENABLE_AUTO_UPDATE', nextEnabled);

        const status = await window.electron.getUpdateStatus?.();
        if (status) {
            setUpdateStatus(status);
        }
    };

    const handleCheckForUpdates = async () => {
        if (!window.electron?.checkForUpdates) {
            return;
        }

        const status = await window.electron.checkForUpdates();
        setUpdateStatus(status);
    };

    const handleDownloadUpdate = async () => {
        if (!window.electron?.downloadUpdate) {
            return;
        }

        const status = await window.electron.downloadUpdate();
        setUpdateStatus(status);
    };

    const handleInstallUpdate = async () => {
        await window.electron?.quitAndInstallUpdate?.();
    };

    const handleOpenChinaDownload = async () => {
        if (window.electron?.openExternalUrl) {
            await window.electron.openExternalUrl(QUARK_DOWNLOAD_URL);
            return;
        }

        window.open(QUARK_DOWNLOAD_URL, '_blank', 'noopener,noreferrer');
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

    const handleClearAllCache = async () => {
        if (confirm(t('options.confirmClearAll') || '确定要清空所有缓存数据吗？此操作不可恢复。')) {
            setIsCleaning('all');
            await clearAllData();
            window.location.reload();
        }
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

    const handleCopyStageAddress = async (address: string) => {
        try {
            await copyText(address);
            setStageAddressCopied(true);
            window.setTimeout(() => setStageAddressCopied(false), 1800);
        } catch (error) {
            console.error('Failed to copy stage address:', error);
            setStageAddressCopied(false);
        }
    };

    const maskStageToken = (token: string | null | undefined) => {
        if (!token) return t('options.stageTokenMissing') || 'Not generated';
        if (token.length <= 12) return token;
        return `${token.slice(0, 6)}...${token.slice(-6)}`;
    };

    const nowPlayingStatusLabel = (() => {
        switch (nowPlayingConnectionStatus) {
            case 'connected':
                return '已连接';
            case 'connecting':
                return '连接中';
            case 'error':
                return '未连接';
            default:
                return '未启用';
        }
    })();
    const stageEnabled = Boolean(stageStatus?.modeEnabled);
    const activeStageSource = stageStatus?.source ?? stageSource;
    const stageHasActiveSession = Boolean(stageStatus?.lyricsSession || stageStatus?.mediaSession);
    const nowPlayingEnabled = Boolean(
        isElectron
            ? (stageStatus?.modeEnabled && activeStageSource === 'now-playing')
            : enableNowPlayingStage
    );
    const nowPlayingConnected = nowPlayingEnabled && nowPlayingConnectionStatus === 'connected';
    const stageConnected = stageEnabled && (
        activeStageSource === 'now-playing'
            ? nowPlayingConnected
            : stageHasActiveSession
    );
    const integrationStatusItems = [
        ...(stageEnabled
            ? [{
                key: 'stage',
                label: stageConnected ? 'Stage 已连接' : 'Stage 未连接',
                tone: stageConnected ? 'success' as const : 'error' as const,
            }]
            : []),
        ...(nowPlayingEnabled
            ? [{
                key: 'now-playing',
                label: nowPlayingConnected ? 'Now Playing 已连接' : 'Now Playing 未连接',
                tone: nowPlayingConnected ? 'success' as const : 'error' as const,
            }]
            : []),
    ];

    // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
    const glassBg = isDaylight ? 'bg-white/82' : 'bg-zinc-900/95';
    const subviewPanelBg = isDaylight ? 'bg-zinc-200' : 'bg-zinc-900';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const textColor = isDaylight ? 'text-zinc-800' : 'text-zinc-100';
    const successTextColor = isDaylight ? 'text-green-600' : 'text-green-400';
    const successBgColor = isDaylight ? 'bg-green-500/10' : 'bg-green-500/20';
    const errorTextColor = isDaylight ? 'text-red-600' : 'text-red-400';
    const errorBgColor = isDaylight ? 'bg-red-500/10' : 'bg-red-500/10';
    const overlayBackground = isDaylight ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.5)';
    const toggleOffBackgroundClass = isDaylight ? 'bg-zinc-300/90' : 'bg-white/10';
    const accentOutlineColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');
    const settingsCardClass = isDaylight
        ? 'bg-black/[0.025] border-black/10'
        : 'bg-white/5 border-white/5';
    const settingsCardInteractiveClass = isDaylight
        ? 'bg-black/[0.025] border-black/10 hover:bg-black/[0.055]'
        : 'bg-white/5 border-white/5 hover:bg-white/8';
    const settingsIconClass = isDaylight
        ? 'bg-black/[0.04] border-black/10'
        : 'bg-white/8 border-white/10';
    const utilityGhostButtonClass = isDaylight
        ? 'border-black/10 bg-black/[0.025] hover:bg-black/[0.055]'
        : 'border-white/10 bg-white/5 hover:bg-white/10';
    const unselectedOptionStyle = {
        borderColor: isDaylight ? 'rgba(24, 24, 27, 0.10)' : 'rgba(255, 255, 255, 0.10)',
        backgroundColor: isDaylight ? 'rgba(24, 24, 27, 0.035)' : 'rgba(255, 255, 255, 0.04)',
    };
    const getAccentOptionStyle = (selected: boolean) => (
        selected
            ? {
                borderColor: accentOutlineColor,
                boxShadow: `inset 0 0 0 1px ${accentOutlineColor}`,
                backgroundColor: isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`,
            }
            : unselectedOptionStyle
    );
    const rangeInputClass = [
        'w-full h-1.5 rounded-full appearance-none cursor-pointer',
        '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform',
        '[&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-transform',
        isDaylight
            ? 'bg-black/15 [&::-webkit-slider-thumb]:bg-zinc-700 [&::-moz-range-thumb]:bg-zinc-700'
            : 'bg-white/10 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white',
    ].join(' ');
    const shellTransition = { duration: 0.24, ease: 'easeOut' as const };
    const panelMotion = {
        initial: { opacity: 0, y: 20, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 16, scale: 0.985 },
    };
    const contentMotion = {
        initial: { opacity: 0, x: 18 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -18 },
    };
    // Close only the active overlay layer when its own backdrop is clicked.
    const handleBackdropClose = (event: React.MouseEvent<HTMLDivElement>, onCloseOverlay: () => void) => {
        if (event.target !== event.currentTarget) {
            return;
        }

        event.stopPropagation();
        onCloseOverlay();
    };
    const isSubSettingsViewOpen = showVisPlayground
        || showThemePark
        || showAppearanceSettings
        || showPlaybackSettings
        || showIntegrationSettings
        || showStorageSettings
        || showDesktopSettings
        || showLabSettings
        || showLyricFilterSettings;

    const closeAllSubviews = () => {
        if (shouldCloseModalOnSubviewBack) {
            onClose();
            return;
        }
        setShowVisPlayground(false);
        setShowThemePark(false);
        setShowAppearanceSettings(false);
        setShowPlaybackSettings(false);
        setShowIntegrationSettings(false);
        setShowStorageSettings(false);
        setShowDesktopSettings(false);
        setShowLabSettings(false);
        setShowLyricFilterSettings(false);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (isSubSettingsViewOpen) {
                    closeAllSubviews();
                } else {
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isSubSettingsViewOpen, shouldCloseModalOnSubviewBack, onClose]);

    useEffect(() => {
        setIsSubSettingsViewOpen(isSubSettingsViewOpen);

        return () => {
            setIsSubSettingsViewOpen(false);
        };
    }, [isSubSettingsViewOpen, setIsSubSettingsViewOpen]);

    const visualizerModeOptions = VISUALIZER_REGISTRY.map(entry => ({
        mode: entry.mode,
        label: getVisualizerModeLabel(entry.mode, t),
    }));

    const renderToggle = (checked: boolean, onChange: () => void, disabled?: boolean) => {
        return (
            <button
                type="button"
                onClick={onChange}
                disabled={disabled}
                className={`relative w-11 h-6 rounded-full transition-all duration-300 shrink-0 ${
                    disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-95'
                } ${checked ? '' : toggleOffBackgroundClass}`}
                style={{
                    backgroundColor: checked
                        ? (theme?.accentColor || (isDaylight ? '#18181b' : '#f4f4f5'))
                        : undefined
                }}
            >
                <div
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform duration-300 shadow-sm ${
                        isDaylight ? 'bg-white' : 'bg-zinc-100'
                    } ${checked ? 'translate-x-5' : 'translate-x-0'}`}
                />
            </button>
        );
    };

    const renderSettingsSubview = ({
        isOpen,
        onClose: handleClose,
        title,
        description,
        children,
        action,
        zIndex = 136,
    }: {
        isOpen: boolean;
        onClose: () => void;
        title: string;
        description: string;
        children: React.ReactNode;
        action?: React.ReactNode;
        zIndex?: number;
    }) => (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={shellTransition}
                    className="fixed inset-0 backdrop-blur-xl p-3 sm:p-5"
                    style={{ backgroundColor: overlayBackground, zIndex }}
                    onClick={(event) => handleBackdropClose(event, handleClose)}
                >
                    <motion.div
                        {...panelMotion}
                        transition={shellTransition}
                        className={`mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${subviewPanelBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6">
                            <div className="flex items-center gap-3 min-w-0">
                                <button
                                    type="button"
                                    onClick={handleClose}
                                    className="h-10 w-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center transition-colors hover:bg-white/10"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <div className="min-w-0">
                                    <div className="text-lg sm:text-xl font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                        {title}
                                    </div>
                                    <div className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {description}
                                    </div>
                                </div>
                            </div>
                            {action ?? null}
                        </div>
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-5 sm:px-6">
                            <div className="space-y-8">
                                {children}
                            </div>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
    const closeSubviewOrModal = (closeSubview: () => void) => {
        if (shouldCloseModalOnSubviewBack) {
            onClose();
            return;
        }

        closeSubview();
    };
    const updateBadgeLabel = (() => {
        if (!electronSettings.ENABLE_UPDATE_CHECK || updateStatus?.status === 'disabled') {
            return t('options.updateCheckDisabled') || 'Disabled';
        }

        if (updateStatus?.status === 'checking') {
            return t('options.updateChecking') || 'Checking...';
        }

        if (updateStatus?.availableVersion) {
            return `${t('options.updateAvailable') || 'Found'} v${updateStatus.availableVersion}`;
        }

        if (updateStatus?.status === 'latest') {
            return t('options.updateLatest') || 'Up to date';
        }

        if (updateStatus?.status === 'error') {
            return t('options.updateCheckFailed') || 'Check failed';
        }

        if (updateStatus?.status === 'unsupported') {
            return t('options.updateUnsupported') || 'Unavailable';
        }

        return t('options.updateLatest') || 'Up to date';
    })();
    const updateBadgeIcon = updateStatus?.status === 'checking'
        ? <Loader2 size={13} className="animate-spin" />
        : updateStatus?.availableVersion
            ? <Download size={13} />
            : updateStatus?.status === 'error'
                ? <AlertCircle size={13} />
                : <Check size={13} />;
    const canDownloadUpdate = Boolean(
        electronSettings.ENABLE_UPDATE_CHECK &&
        updateStatus?.supported &&
        updateStatus?.availableVersion &&
        updateStatus.status !== 'downloading' &&
        updateStatus.status !== 'downloaded'
    );
    const canEnableAutoUpdate = Boolean(electronSettings.ENABLE_UPDATE_CHECK && updateStatus?.supported);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={shellTransition}
            data-folia-keyboard-window="true"
            className="fixed inset-0 z-[100] flex items-center justify-center backdrop-blur-xl px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:pt-5 sm:pb-[calc(6.5rem+env(safe-area-inset-bottom))]"
            style={{ backgroundColor: overlayBackground }}
            onClick={(event) => handleBackdropClose(event, onClose)}
        >
            <motion.div
                {...panelMotion}
                transition={shellTransition}
                className={`${glassBg} border ${borderColor} p-8 rounded-3xl max-w-lg w-full relative shadow-2xl overflow-hidden flex flex-col max-h-[85vh]`}
                onClick={(event) => event.stopPropagation()}
            >
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
                    <AnimatePresence mode="wait" initial={false}>
                    {activeTab === 'help' ? (
                        <motion.div
                            key="help-tab"
                            {...contentMotion}
                            transition={shellTransition}
                            className="space-y-6"
                        >
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
                                        <span>{t('help.previousTrack')} / {t('help.nextTrack')}</span>
                                        <div className="flex items-center gap-1">
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">Ctrl</kbd>
                                            <span className="text-xs opacity-50">+</span>
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">← / →</kbd>
                                        </div>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.seekBackward')} / {t('help.seekForward')}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">← / →</kbd>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.hidePlayerChrome')}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">H</kbd>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.toggleRightPanel') || '切换右侧面板'}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">P</kbd>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.openCommandPalette') || '打开命令面板'}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">S</kbd>
                                    </li>
                                    <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                        <span>{t('help.browserFullscreen')}</span>
                                        <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">F11</kbd>
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
                                        <a href="https://github.com/chthollyphile/folia-major" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors underline decoration-white/30 hover:decoration-white">chthollyphile/folia-major</a>
                                    </p>
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
                                        : `${__APP_VERSION_LABEL__} v${__APP_VERSION__} - ${__GIT_BRANCH__} - ${__COMMIT_HASH__}`}
                                </button>
                                {updateStatus?.availableVersion && (
                                    <div className="mt-1 flex items-center justify-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                                        <span className="opacity-60">
                                            {(t('options.updateAvailable') || 'Found')} v{updateStatus.availableVersion}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => window.electron?.openUpdateReleasePage(updateStatus.availableVersion)}
                                            className="inline-flex items-center gap-1 opacity-50 transition-opacity hover:opacity-90"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <ExternalLink size={12} />
                                            {t('options.openReleasePage') || 'Open Release Page'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handleOpenChinaDownload}
                                            className="inline-flex items-center gap-1 opacity-50 transition-opacity hover:opacity-90"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            <ExternalLink size={12} />
                                            {t('options.downloadChina') || 'CN Download'}
                                        </button>
                                    </div>
                                )}
                                <p className="text-xs font-mono opacity-30 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                    AI Service: {aiServiceLabel}
                                </p>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="options-tab"
                            {...contentMotion}
                            transition={shellTransition}
                            className="space-y-8"
                        >
                            <section className="space-y-3">
                                <button
                                    type="button"
                                    onClick={() => setShowAppearanceSettings(true)}
                                    className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-start gap-3 text-left">
                                            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                <Sparkles size={18} />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.visualSettings') || '视觉设置'}
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    主题、歌词渲染模式、样式入口和背景透明度。
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setShowPlaybackSettings(true)}
                                    className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-start gap-3 text-left">
                                            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                <PlayCircle size={18} />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    播放控制
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    播放队列，行为，音频
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setShowIntegrationSettings(true)}
                                    className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-start gap-3 text-left">
                                            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                <Server size={18} />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    连接与集成
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    Stage、Now Playing 和 Navidrome 相关设置。
                                                </div>
                                                {integrationStatusItems.length > 0 && (
                                                    <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
                                                        {integrationStatusItems.map((item) => (
                                                            <div
                                                                key={item.key}
                                                                className="inline-flex items-center gap-1.5 text-[11px] font-medium"
                                                                style={{
                                                                    color: item.tone === 'success'
                                                                        ? (isDaylight ? '#15803d' : '#86efac')
                                                                        : (isDaylight ? '#b91c1c' : '#fca5a5'),
                                                                }}
                                                            >
                                                                <span
                                                                    className="w-1.5 h-1.5 rounded-full"
                                                                    style={{
                                                                        backgroundColor: item.tone === 'success'
                                                                            ? (isDaylight ? '#16a34a' : '#4ade80')
                                                                            : (isDaylight ? '#dc2626' : '#f87171'),
                                                                    }}
                                                                />
                                                                <span>{item.label}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setShowStorageSettings(true)}
                                    className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-start gap-3 text-left">
                                            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                <Database size={18} />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    存储与缓存
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    缓存占用、清理、媒体缓存和缓存目录。
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>

                                {isElectron && (
                                    <button
                                        type="button"
                                        onClick={() => setShowDesktopSettings(true)}
                                        className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                    >
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-start gap-3 text-left">
                                                <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                    <Command size={18} />
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                        桌面端设置
                                                    </div>
                                                    <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                        更新检查、自动更新和桌面端 AI 配置。
                                                    </div>
                                                </div>
                                            </div>
                                            <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                        </div>
                                    </button>
                                )}

                                <button
                                    type="button"
                                    onClick={() => setShowLabSettings(true)}
                                    className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-start gap-3 text-left">
                                            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                <FlaskConical size={18} />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.labSettings') || '实验室'}
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.labSettingsDesc') || '高级自定义功能'}
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>
                            </section>

                            <div className="hidden">
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
                                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!isCustomThemePreferred ? toggleOffBackgroundClass : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
                                                style={{ backgroundColor: isCustomThemePreferred ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isCustomThemePreferred ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                        <div className="bg-white/5 p-3 rounded-xl border border-white/5 flex items-center justify-between gap-3">
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

                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.lyricsRenderer') || "歌词动画"}
                                                </div>
                                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.lyricsRendererDesc') || "选择播放页使用的歌词动画模式。"}
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
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                            {visualizerModeOptions.map(option => (
                                                <button
                                                    key={option.mode}
                                                    onClick={() => onVisualizerModeChange?.(option.mode)}
                                                    className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all hover:bg-white/5"
                                                    style={{
                                                        borderColor: visualizerMode === option.mode ? theme?.accentColor || 'var(--text-accent)' : 'transparent',
                                                        backgroundColor: visualizerMode === option.mode ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)'
                                                    }}
                                                >
                                                    <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                        {option.label}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                </div>
                            </section>

                            <StorageSettingsSection
                                cacheDirectory={cacheDirectory}
                                cacheDirectoryIsDefault={cacheDirectoryIsDefault}
                                cacheDirectoryStatus={cacheDirectoryStatus}
                                cacheSizes={cacheSizes}
                                enableMediaCache={enableMediaCache}
                                errorTextColor={errorTextColor}
                                isCleaning={isCleaning}
                                isElectron={isElectron}
                                mediaCount={mediaCount}
                                onChooseCacheDirectory={handleChooseCacheDirectory}
                                onClear={handleClear}
                                onClearAll={handleClearAllCache}
                                onToggleMediaCache={onToggleMediaCache}
                                settingsCardClass={settingsCardClass}
                                theme={theme}
                                toggleOffBackgroundClass={toggleOffBackgroundClass}
                            />

                            {isElectron && stageStatus && (
                                <section>
                                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                        <Server size={14} /> {t('options.stageMode') || 'Stage Mode'}
                                    </h3>
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.enableStageMode') || 'Enable Stage Mode'}
                                                </div>
                                                <div className="text-[10px] opacity-40 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                                    {stageStatus.modeEnabled
                                                        ? '舞台视图已启用，请在下方选择 Stage API 或 Now Playing。'
                                                        : (t('options.enableStageModeDescDisabled') || '启用后可在舞台视图中选择 Stage API 或 Now Playing。')}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => void onToggleStageMode?.(!(stageStatus.modeEnabled ?? false))}
                                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!(stageStatus.modeEnabled ?? false) ? toggleOffBackgroundClass : ''}`}
                                                style={{ backgroundColor: (stageStatus.modeEnabled ?? false) ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${(stageStatus.modeEnabled ?? false) ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                        {(stageStatus.modeEnabled ?? false) && (
                                            <div className="space-y-3">
                                                <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                                                    <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                                        舞台来源
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        {([
                                                            { value: 'stage-api', label: 'Stage API' },
                                                            { value: 'now-playing', label: 'Now Playing' },
                                                        ] as Array<{ value: StageSource; label: string }>).map((option) => {
                                                            const selected = stageSource === option.value;
                                                            return (
                                                                <button
                                                                    key={option.value}
                                                                    type="button"
                                                                    onClick={() => void onStageSourceChange?.(option.value)}
                                                                    className={`rounded-xl border px-3 py-3 text-sm transition-colors ${selected ? 'bg-white/12 border-white/20' : 'bg-white/5 border-white/10 hover:bg-white/8'}`}
                                                                    style={{ color: 'var(--text-primary)' }}
                                                                >
                                                                    {option.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {stageSource === 'now-playing' ? (
                                                    <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                                        <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                                            Now Playing
                                                        </div>
                                                        <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                                            连接状态：{nowPlayingStatusLabel}
                                                        </div>
                                                        <div className="text-[11px] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                            固定连接 `ws://localhost:9863/api/ws/lyric`，请先在本机启动 now-playing 服务。
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                                                            <div>
                                                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                                    {t('options.stageAddress') || 'Stage Address'}
                                                                </div>
                                                                <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                                                    {`http://127.0.0.1:${stageStatus.port}`}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void handleCopyStageAddress(`http://127.0.0.1:${stageStatus.port}`)}
                                                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors flex items-center gap-2"
                                                                    style={{ color: stageAddressCopied ? '#86efac' : 'var(--text-primary)' }}
                                                                >
                                                                    {stageAddressCopied ? <Check size={14} /> : null}
                                                                    {stageAddressCopied
                                                                        ? (t('options.stageAddressCopied') || 'Copied')
                                                                        : (t('options.copyStageAddress') || 'Copy Address')}
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-3">
                                                            <div>
                                                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40 mb-2" style={{ color: 'var(--text-secondary)' }}>
                                                                    {t('options.stageToken') || 'Bearer Token'}
                                                                </div>
                                                                <div className="text-sm break-all" style={{ color: 'var(--text-primary)' }}>
                                                                    {maskStageToken(stageStatus.token)}
                                                                </div>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => void copyText(stageStatus.token || '')}
                                                                    disabled={!stageStatus.token}
                                                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors disabled:opacity-40"
                                                                    style={{ color: 'var(--text-primary)' }}
                                                                >
                                                                    {t('options.copyStageToken') || 'Copy Token'}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        setStageActionStatus('regenerating');
                                                                        try {
                                                                            await onRegenerateStageToken?.();
                                                                        } finally {
                                                                            setStageActionStatus('idle');
                                                                        }
                                                                    }}
                                                                    disabled={stageActionStatus !== 'idle'}
                                                                    className="px-3 py-2 bg-white/10 hover:bg-white/15 rounded-lg text-xs transition-colors disabled:opacity-40"
                                                                    style={{ color: 'var(--text-primary)' }}
                                                                >
                                                                    {stageActionStatus === 'regenerating'
                                                                        ? (t('options.stageTokenRegenerating') || 'Regenerating...')
                                                                        : (t('options.regenerateStageToken') || 'Regenerate Token')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </section>
                            )}

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
                                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                                    {/* Enable Toggle */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('navidrome.enable') || "Enable Navidrome"}
                                        </span>
                                        <button
                                            onClick={() => handleToggleNavidromeEnabled(!navidromeEnabled)}
                                            className={`w-12 h-6 rounded-full p-1 transition-colors ${!navidromeEnabled ? toggleOffBackgroundClass : ''}`}
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

                            {/* Update Settings */}
                            {isElectron && (
                                <section>
                                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center justify-between gap-3" style={{ color: 'var(--text-secondary)' }}>
                                        <span className="flex items-center gap-2">
                                            <RefreshCw size={14} /> {t('options.updateCheck') || "Update Check"}
                                        </span>
                                        <button
                                            type="button"
                                            onClick={handleCheckForUpdates}
                                            disabled={!electronSettings.ENABLE_UPDATE_CHECK || updateStatus?.status === 'checking'}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium normal-case tracking-normal transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                            style={{ color: 'var(--text-primary)' }}
                                        >
                                            {updateBadgeIcon}
                                            <span>{updateBadgeLabel}</span>
                                        </button>
                                    </h3>
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.enableUpdateCheck') || "Enable Update Check"}
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.enableUpdateCheckDesc') || "Check GitHub releases through the system proxy when the desktop app starts."}
                                                </div>
                                            </div>
                                            <button
                                                onClick={handleToggleUpdateCheck}
                                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!electronSettings.ENABLE_UPDATE_CHECK ? toggleOffBackgroundClass : ''}`}
                                                style={{ backgroundColor: electronSettings.ENABLE_UPDATE_CHECK ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${electronSettings.ENABLE_UPDATE_CHECK ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        </div>

                                        <div className="flex items-center justify-between gap-4 pt-3 border-t border-white/10">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.enableAutoUpdate') || "Enable Auto Update"}
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.enableAutoUpdateDesc') || "Automatically download updates after a new version is found."}
                                                </div>
                                            </div>
                                            <button
                                                onClick={handleToggleAutoUpdate}
                                                disabled={!canEnableAutoUpdate}
                                                className={`w-12 h-6 rounded-full p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${!electronSettings.ENABLE_AUTO_UPDATE ? toggleOffBackgroundClass : ''}`}
                                                style={{ backgroundColor: electronSettings.ENABLE_AUTO_UPDATE ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${electronSettings.ENABLE_AUTO_UPDATE ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        </div>

                                        <div className="text-[10px] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.autoUpdateGithubNotice') || "Auto update needs access to GitHub; if the network is unstable, keep a system proxy enabled."}
                                        </div>

                                        {updateStatus?.availableVersion && (
                                            <div className="flex flex-wrap gap-2 pt-3 border-t border-white/10">
                                                <button
                                                    type="button"
                                                    onClick={() => window.electron?.openUpdateReleasePage(updateStatus.availableVersion)}
                                                    className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium transition-colors hover:bg-white/15"
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    <ExternalLink size={14} />
                                                    {t('options.openReleasePage') || "Open Release Page"}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={handleOpenChinaDownload}
                                                    className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium transition-colors hover:bg-white/15"
                                                    style={{ color: 'var(--text-primary)' }}
                                                >
                                                    <ExternalLink size={14} />
                                                    {t('options.downloadChina') || "CN Download"}
                                                </button>
                                                {!electronSettings.ENABLE_AUTO_UPDATE && (
                                                    <button
                                                        type="button"
                                                        onClick={handleDownloadUpdate}
                                                        disabled={!canDownloadUpdate}
                                                        className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
                                                        style={{ color: 'var(--text-primary)' }}
                                                    >
                                                        <Download size={14} />
                                                        {t('options.downloadUpdate') || "Download Update"}
                                                    </button>
                                                )}
                                                {updateStatus.status === 'downloaded' && (
                                                    <button
                                                        type="button"
                                                        onClick={handleInstallUpdate}
                                                        className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium transition-colors hover:bg-white/15"
                                                        style={{ color: 'var(--text-primary)' }}
                                                    >
                                                        <RefreshCw size={14} />
                                                        {t('options.restartToInstallUpdate') || "Restart to Install"}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </section>
                            )}

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
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${electronSettings.AI_PROVIDER !== 'openai' ? 'bg-white/10 shadow-sm' : 'opacity-50 hover:opacity-100'
                                                            }`}
                                                        style={{ color: 'var(--text-primary)' }}
                                                    >
                                                        Gemini
                                                    </button>
                                                    <button
                                                        onClick={() => setElectronSettings({ ...electronSettings, AI_PROVIDER: 'openai' })}
                                                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${electronSettings.AI_PROVIDER === 'openai' ? 'bg-white/10 shadow-sm' : 'opacity-50 hover:opacity-100'
                                                            }`}
                                                        style={{ color: 'var(--text-primary)' }}
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
                                                                placeholder="https://api.openai.com/v1 or https://api.deepseek.com"
                                                                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                                style={{ color: 'var(--text-primary)' }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                            {t('options.openaiApiModel') || "OpenAI Model"}
                                                        </label>
                                                        <div className="flex gap-2">
                                                            <input
                                                                type="text"
                                                                value={electronSettings.OPENAI_API_MODEL || ''}
                                                                onChange={(e) => setElectronSettings({ ...electronSettings, OPENAI_API_MODEL: e.target.value })}
                                                                placeholder="gpt-4o / gpt-4.1-mini / deepseek-v4-flash"
                                                                className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-white/30 transition-colors"
                                                                style={{ color: 'var(--text-primary)' }}
                                                            />
                                                        </div>
                                                        <div className="text-[10px] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                                            {t('options.openaiApiModelDesc') || "Required for many OpenAI-compatible providers. DeepSeek models like deepseek-v4-flash must be filled explicitly if auto-detection does not apply."}
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
                                                    className={`w-12 h-6 rounded-full p-1 transition-colors ${!electronSettings.USE_SYSTEM_PROXY_FOR_AI ? toggleOffBackgroundClass : ''}`}
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

                            {!isElectron && (
                                <section>
                                    <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                                        <Server size={14} /> 舞台
                                    </h3>
                                    <div className="bg-white/5 p-4 rounded-xl border border-white/5 space-y-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    启用 Now Playing
                                                </div>
                                                <div className="text-[10px] opacity-40 max-w-[320px]" style={{ color: 'var(--text-secondary)' }}>
                                                    开启后首页显示舞台入口，并通过本机 localhost 连接 now-playing 服务。
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => void onToggleNowPlayingStage?.(!enableNowPlayingStage)}
                                                className={`w-12 h-6 rounded-full p-1 transition-colors ${!enableNowPlayingStage ? toggleOffBackgroundClass : ''}`}
                                                style={{ backgroundColor: enableNowPlayingStage ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                                            >
                                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${enableNowPlayingStage ? 'translate-x-6' : 'translate-x-0'}`} />
                                            </button>
                                        </div>
                                        {enableNowPlayingStage && (
                                            <div className="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2">
                                                <div className="text-[10px] uppercase tracking-[0.16em] opacity-40" style={{ color: 'var(--text-secondary)' }}>
                                                    Now Playing
                                                </div>
                                                <div className="text-sm" style={{ color: 'var(--text-primary)' }}>
                                                    连接状态：{nowPlayingStatusLabel}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </section>
                            )}

                            {/* 保持实验室入口位于整个 options 列表最底部；Electron 版本下还会多出桌面端专属设置，所以这里必须放在 Electron Settings 之后。 */}
                            <section>
                                <button
                                    type="button"
                                    onClick={() => setShowLabSettings(true)}
                                    className={`w-full p-4 rounded-xl border transition-colors ${settingsCardInteractiveClass}`}
                                >
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-start gap-3 text-left">
                                            <div className={`w-10 h-10 rounded-full border flex items-center justify-center shrink-0 ${settingsIconClass}`} style={{ color: 'var(--text-primary)' }}>
                                                <FlaskConical size={18} />
                                            </div>
                                            <div className="space-y-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {t('options.labSettings') || "Lab Settings"}
                                                </div>
                                                <div className="text-xs opacity-50 max-w-[260px]" style={{ color: 'var(--text-secondary)' }}>
                                                    {t('options.labSettingsDesc') || "Open a separate page for experimental playback and panel behavior settings."}
                                                </div>
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="shrink-0 opacity-60" style={{ color: 'var(--text-primary)' }} />
                                    </div>
                                </button>
                            </section>
                            </div>
                        </motion.div>
                    )}
                    </AnimatePresence>
                </div>

                {/* Footer (Empty now) */}
                {/* <div className="mt-8 pt-0 border-t-0 p-0" /> */}
                <AnimatePresence>
                    {meowEasterEgg && (
                        <motion.img
                            key={meowEasterEgg.id}
                            src={meowImageUrl}
                            alt=""
                            aria-hidden="true"
                            className="pointer-events-none absolute bottom-5 left-1/2 z-20 w-28 -translate-x-1/2 drop-shadow-[0_18px_32px_rgba(0,0,0,0.4)] select-none sm:w-32"
                            initial={{ opacity: 0, y: 140, scale: 0.92 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 120, scale: 0.96 }}
                            transition={{
                                duration: 0.6,
                                ease: [0.22, 1, 0.36, 1],
                            }}
                        />
                    )}
                </AnimatePresence>
            </motion.div>
            <AnimatePresence>
                {showVisPlayground && (
                    <VisPlayground
                        theme={theme}
                        isDaylight={isDaylight}
                        visualizerMode={visualizerMode}
                        backgroundOpacity={backgroundOpacity}
                        visualizerOpacity={visualizerOpacity}
                        visualizerBackgroundMode={visualizerBackgroundMode}
                        useCoverColorBg={useCoverColorBg}
                        staticMode={staticMode}
                        transparentPlayerBackground={transparentPlayerBackground}
                        disableVisualizerVignette={disableVisualizerVignette}
                        disableVisualizerGeometricBackground={disableVisualizerGeometricBackground}
                        hideTranslationSubtitle={hidePlayerTranslationSubtitle}
                        subtitleOverlayOpacity={subtitleOverlayOpacity}
                        classicTuning={classicTuning}
                        cadenzaTuning={cadenzaTuning}
                        partitaTuning={partitaTuning}
                        fumeTuning={fumeTuning}
                        cappellaTuning={cappellaTuning}
                        tiltTuning={tiltTuning}
                        monetBackgroundTuning={monetBackgroundTuning}
                        monetTuning={monetTuning}
                        cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                        cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                        monetBackgroundImage={monetBackgroundImage}
                        monetPortraitImage={monetPortraitImage}
                        fontStyle={lyricsFontStyle}
                        fontScale={lyricsFontScale}
                        customFontFamily={lyricsCustomFontFamily}
                        customFontLabel={lyricsCustomFontLabel}
                        onFontStyleChange={onLyricsFontStyleChange}
                        onFontScaleChange={onLyricsFontScaleChange}
                        onCustomFontChange={onLyricsCustomFontChange}
                        onUploadCustomFont={onLyricsCustomFontUpload}
                        onVisualizerModeChange={onVisualizerModeChange}
                        onBackgroundOpacityChange={setBackgroundOpacity}
                        onVisualizerOpacityChange={setVisualizerOpacity}
                        onToggleCoverColorBg={onToggleCoverColorBg}
                        onToggleDisableVisualizerVignette={onToggleDisableVisualizerVignette}
                        onToggleDisableVisualizerGeometricBackground={onToggleDisableVisualizerGeometricBackground}
                        onVisualizerBackgroundModeChange={onVisualizerBackgroundModeChange}
                        onResetVisualizerBackgroundMode={onResetVisualizerBackgroundMode}
                        onToggleHideTranslationSubtitle={onToggleHidePlayerTranslationSubtitle}
                        onSubtitleOverlayOpacityChange={setSubtitleOverlayOpacity}
                        onClassicTuningChange={onClassicTuningChange}
                        onResetClassicTuning={onResetClassicTuning}
                        onPartitaTuningChange={onPartitaTuningChange}
                        onResetPartitaTuning={onResetPartitaTuning}
                        onFumeTuningChange={onFumeTuningChange}
                        onResetFumeTuning={onResetFumeTuning}
                        onCappellaTuningChange={onCappellaTuningChange}
                        onResetCappellaTuning={onResetCappellaTuning}
                        onTiltTuningChange={onTiltTuningChange}
                        onResetTiltTuning={onResetTiltTuning}
                        onMonetBackgroundTuningChange={onMonetBackgroundTuningChange}
                        onResetMonetBackgroundTuning={onResetMonetBackgroundTuning}
                        onMonetTuningChange={onMonetTuningChange}
                        onResetMonetTuning={onResetMonetTuning}
                        onUploadMonetBackgroundImage={onUploadMonetBackgroundImage}
                        onClearMonetBackgroundImage={onClearMonetBackgroundImage}
                        isLoadingMonetBackgroundImage={isLoadingMonetBackgroundImage}
                        onUploadMonetPortraitImage={onUploadMonetPortraitImage}
                        onClearMonetPortraitImage={onClearMonetPortraitImage}
                        isLoadingMonetPortraitImage={isLoadingMonetPortraitImage}
                        urlBackgroundList={urlBackgroundList}
                        urlBackgroundSelectedId={urlBackgroundSelectedId}
                        onAddUrlBackgroundItem={onAddUrlBackgroundItem}
                        onUpdateUrlBackgroundItem={onUpdateUrlBackgroundItem}
                        onDeleteUrlBackgroundItem={onDeleteUrlBackgroundItem}
                        onSetUrlBackgroundSelectedId={onSetUrlBackgroundSelectedId}
                        onImportCappellaCustomEmojiPack={onImportCappellaCustomEmojiPack}
                        onClearCappellaCustomEmojiPack={onClearCappellaCustomEmojiPack}
                        isLoadingCappellaCustomEmojiPack={isLoadingCappellaCustomEmojiPack}
                        onImportCappellaCustomAvatar={onImportCappellaCustomAvatar}
                        onClearCappellaCustomAvatar={onClearCappellaCustomAvatar}
                        isLoadingCappellaCustomAvatarPack={isLoadingCappellaCustomAvatarPack}
                        onClose={() => closeSubviewOrModal(() => setShowVisPlayground(false))}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {showThemePark && (
                    <ThemePark
                        initialTheme={themeParkInitialTheme}
                        isDaylight={isDaylight}
                        visualizerMode={visualizerMode}
                        staticMode={staticMode}
                        backgroundOpacity={backgroundOpacity}
                        visualizerOpacity={visualizerOpacity}
                        visualizerBackgroundMode={visualizerBackgroundMode}
                        urlBackgroundList={urlBackgroundList}
                        urlBackgroundSelectedId={urlBackgroundSelectedId}
                        classicTuning={classicTuning}
                        cadenzaTuning={cadenzaTuning}
                        partitaTuning={partitaTuning}
                        fumeTuning={fumeTuning}
                        cappellaTuning={cappellaTuning}
                        monetBackgroundTuning={monetBackgroundTuning}
                        monetTuning={monetTuning}
                        cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                        cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                        monetBackgroundImage={monetBackgroundImage}
                        monetPortraitImage={monetPortraitImage}
                        lyricsFontStyle={lyricsFontStyle}
                        lyricsFontScale={lyricsFontScale}
                        lyricsCustomFontFamily={lyricsCustomFontFamily}
                        onSaveTheme={(dualTheme) => {
                            onSaveCustomTheme(dualTheme);
                            setShowThemePark(false);
                        }}
                        onClose={() => closeSubviewOrModal(() => setShowThemePark(false))}
                    />
                )}
            </AnimatePresence>
            {renderSettingsSubview({
                isOpen: showPlaybackSettings,
                onClose: () => closeSubviewOrModal(() => setShowPlaybackSettings(false)),
                title: '播放控制',
                description: '播放队列，行为，音频输出等设置。',
                children: (
                    <PlaybackSettingsSubview
                        isOpen={showPlaybackSettings}
                        isDaylight={isDaylight}
                        onAudioOutputDeviceChange={onAudioOutputDeviceChange}
                        settingsCardClass={settingsCardClass}
                        theme={theme}
                        utilityGhostButtonClass={utilityGhostButtonClass}
                    />
                ),
            })}
            {renderSettingsSubview({
                isOpen: showAppearanceSettings,
                onClose: () => closeSubviewOrModal(() => setShowAppearanceSettings(false)),
                title: t('options.visualSettings') || '视觉设置',
                description: '主题、歌词渲染和背景外观。',
                children: (
                    <AppearanceSettingsSubview
                        accentOutlineColor={accentOutlineColor}
                        bgMode={bgMode}
                        hasCustomTheme={hasCustomTheme}
                        isCustomThemePreferred={isCustomThemePreferred}
                        isDaylight={isDaylight}
                        onApplyCustomTheme={onApplyCustomTheme}
                        onApplyDefaultTheme={onApplyDefaultTheme}
                        onOpenThemePark={() => setShowThemePark(true)}
                        onOpenVisPlayground={() => setShowVisPlayground(true)}
                        onToggleCustomThemePreferred={onToggleCustomThemePreferred}
                        onToggleSongThemeAutoSwitch={onToggleSongThemeAutoSwitch}
                        onToggleTransparentPlayerBackground={onToggleTransparentPlayerBackground}
                        onSaveCustomTheme={onSaveCustomTheme}
                        settingsCardClass={settingsCardClass}
                        songThemeAutoSwitchEnabled={songThemeAutoSwitchEnabled}
                        theme={theme}
                        themeParkInitialTheme={themeParkInitialTheme}
                        toggleOffBackgroundClass={toggleOffBackgroundClass}
                        transparentPlayerBackground={transparentPlayerBackground}
                        utilityGhostButtonClass={utilityGhostButtonClass}
                        homeLayoutStyle={homeLayoutStyle}
                        onChangeHomeLayoutStyle={onChangeHomeLayoutStyle}
                        grid3dCardStyle={grid3dCardStyle}
                        onChangeGrid3dCardStyle={onChangeGrid3dCardStyle}
                        aiTheme={aiTheme}
                        customTheme={customTheme}
                    />
                ),
            })}
            {renderSettingsSubview({
                isOpen: showStorageSettings,
                onClose: () => closeSubviewOrModal(() => setShowStorageSettings(false)),
                title: '存储与缓存',
                description: '缓存占用、清理和媒体缓存行为。',
                children: (
                    <StorageSettingsSection
                        cacheDirectory={cacheDirectory}
                        cacheDirectoryIsDefault={cacheDirectoryIsDefault}
                        cacheDirectoryStatus={cacheDirectoryStatus}
                        cacheSizes={cacheSizes}
                        enableMediaCache={enableMediaCache}
                        errorTextColor={errorTextColor}
                        isCleaning={isCleaning}
                        isElectron={isElectron}
                        mediaCount={mediaCount}
                        onChooseCacheDirectory={handleChooseCacheDirectory}
                        onClear={handleClear}
                        onClearAll={handleClearAllCache}
                        onToggleMediaCache={onToggleMediaCache}
                        settingsCardClass={settingsCardClass}
                        settingsIconClass={settingsIconClass}
                        theme={theme}
                        toggleOffBackgroundClass={toggleOffBackgroundClass}
                        useInsetCacheRows
                    />
                ),
            })}
            {renderSettingsSubview({
                isOpen: showIntegrationSettings,
                onClose: () => closeSubviewOrModal(() => setShowIntegrationSettings(false)),
                title: '集成设置',
                description: 'Stage、Now Playing 和 Navidrome 连接。',
                children: (
                    <IntegrationSettingsSubview
                        chrome={{
                            errorBgColor,
                            errorTextColor,
                            getAccentOptionStyle,
                            isElectron,
                            settingsCardClass,
                            successBgColor,
                            successTextColor,
                            theme,
                            toggleOffBackgroundClass,
                        }}
                        navidrome={{
                            navidromeConfigured,
                            navidromeEnabled,
                            navidromePassword,
                            navidromeTestStatus,
                            navidromeUrl,
                            navidromeUsername,
                            onClearNavidrome: handleClearNavidrome,
                            onToggleNavidrome: handleToggleNavidromeEnabled,
                            setNavidromePassword,
                            setNavidromeUrl,
                            setNavidromeUsername,
                            testNavidromeConnection,
                        }}
                        stage={{
                            enableNowPlayingStage,
                            nowPlayingConnectionStatus,
                            onCopyText: copyText,
                            onRegenerateStageToken,
                            onStageSourceChange,
                            onToggleNowPlayingStage,
                            onToggleStageMode,
                            setStageActionStatus,
                            setStageAddressCopied,
                            stageActionStatus,
                            stageAddressCopied,
                            stageSource,
                            stageStatus,
                        }}
                    />
                ),
            })}
            {renderSettingsSubview({
                isOpen: showDesktopSettings,
                onClose: () => closeSubviewOrModal(() => setShowDesktopSettings(false)),
                title: '桌面端设置',
                description: '桌面窗口行为、更新检查、自动更新和 AI 配置。',
                children: (
                    <DesktopSettingsSubview
                        chrome={{
                            borderColor,
                            isDaylight,
                            isElectron,
                            settingsCardClass,
                            settingsIconClass,
                            successTextColor,
                            theme,
                            toggleOffBackgroundClass,
                        }}
                        model={{
                            canDownloadUpdate,
                            canEnableAutoUpdate,
                            electronSaveStatus,
                            electronSettings,
                            onCheckForUpdates: handleCheckForUpdates,
                            onDownloadUpdate: handleDownloadUpdate,
                            onInstallUpdate: handleInstallUpdate,
                            onOpenChinaDownload: handleOpenChinaDownload,
                            onSaveElectronSettings: saveElectronSettings,
                            onToggleAutoUpdate: handleToggleAutoUpdate,
                            onToggleUpdateCheck: handleToggleUpdateCheck,
                            setElectronSettings,
                            updateBadgeIcon,
                            updateBadgeLabel,
                            updateStatus,
                        }}
                        preferences={{
                            hideTaskbarIcon,
                            minimizeToTray,
                            onToggleHideTaskbarIcon,
                            onToggleMinimizeToTray,
                            onToggleOpenPlayerOnLaunch,
                            openPlayerOnLaunch,
                        }}
                    />
                ),
            })}<LabSettingsModal
                isOpen={showLabSettings}
                onClose={() => closeSubviewOrModal(() => setShowLabSettings(false))}
                onOpenLyricFilterSettings={() => setShowLyricFilterSettings(true)}
                theme={theme}
            />
            <LyricFilterSettingsModal
                isOpen={showLyricFilterSettings}
                isDaylight={isDaylight}
                currentSongTitle={currentSongTitle}
                initialPattern={lyricFilterPattern}
                loadPreviewLyrics={loadLyricFilterPreview}
                onClose={() => closeSubviewOrModal(() => setShowLyricFilterSettings(false))}
                onSave={onSaveLyricFilterPattern}
            />
        </motion.div>
    );
};

export default SettingsModal;
