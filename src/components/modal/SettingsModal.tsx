import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X, Command, MousePointer2, Keyboard, Settings2, Trash2, Database, Monitor, PlayCircle, Loader2, Server, Check, AlertCircle, FlaskConical, ChevronLeft, ChevronRight, RefreshCw, Download, ExternalLink, Sparkles, Palette, CircleHelp, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCacheUsageByCategory, clearCacheByCategory, clearAllData } from '../../services/db';
import { DualTheme, StageStatus, StageSource, Theme, ThemeMode, type CadenzaTuning, type CappellaEmojiImage, type CappellaTuning, type FumeTuning, type NowPlayingConnectionStatus, type PartitaTuning, type TiltTuning, type StoredCustomLyricsFont, type VisualizerMode } from '../../types';
import { getNavidromeConfig, saveNavidromeConfig, clearNavidromeConfig, hashPassword, navidromeApi, isNavidromeEnabled, setNavidromeEnabled, getCachedNavidromeServerProfile, refreshNavidromeServerProfile } from '../../services/navidromeService';
import { NavidromeConfig, NavidromeServerProfile } from '../../types/navidrome';
import VisPlayground from '../visualizer/VisPlayground';
import { VISUALIZER_REGISTRY, getVisualizerModeLabel } from '../visualizer/registry';
import ThemePark from './ThemePark';
import LyricFilterSettingsModal from './LyricFilterSettingsModal';
import AppearanceSettingsSubview from './settings/AppearanceSettingsSubview';
import DesktopSettingsSubview from './settings/DesktopSettingsSubview';
import GeneralSettingsSubview from './settings/GeneralSettingsSubview';
import IntegrationSettingsSubview from './settings/IntegrationSettingsSubview';
import type { PlayerCapConnectionStatus } from '../../types/playerCap';
import LabSettingsModal from './settings/LabSettingsModal';
import PlaybackSettingsSubview from './settings/PlaybackSettingsSubview';
import StorageSettingsSection from './settings/StorageSettingsSection';
import { AiHelpPromptModal } from './AiHelpPromptModal';
import meowImageUrl from '../../../build/miao.png';
import type { LyricData } from '../../types';
import { selectSettingsUiSnapshot, type SettingsSubviewId, type VisualizerSettingsSection, useSettingsUiStore } from '../../stores/useSettingsUiStore';
import { useShallow } from 'zustand/react/shallow';
import type { ObsBrowserSourceStatus } from '../../types/obsBrowserSource';

const DEFAULT_OPENAI_TEMPERATURE = '0.7';

interface SettingsModalProps {
    onClose: () => void;
    initialTab?: 'help' | 'options';
    initialSubview?: SettingsSubviewId | null;
    initialVisualizerSection?: VisualizerSettingsSection | null;
    theme?: Theme;
    bgMode: ThemeMode;
    onApplyDefaultTheme: () => void;
    hasCustomTheme: boolean;
    themeParkInitialTheme: DualTheme;
    isCustomThemePreferred: boolean;
    songThemeAutoSwitchEnabled: boolean;
    songThemeAutoGenerateEnabled: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onApplyCustomTheme: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    onToggleSongThemeAutoGenerate: (enabled: boolean) => void;
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
    playerCapConnectionStatus?: PlayerCapConnectionStatus;
    playerCapPlayers?: string[];
    obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
    onToggleObsBrowserSource?: (enabled: boolean) => Promise<void> | void;
    onRegenerateObsBrowserSourceToken?: () => Promise<void> | void;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    onToggleTransparentPlayerBackground?: (enabled: boolean) => Promise<void> | void;
    aiTheme?: DualTheme | null;
    customTheme?: DualTheme | null;
}

const QUARK_DOWNLOAD_URL = 'https://pan.quark.cn/s/6e4c6fa3bc6f';
const DEFAULT_UPDATE_CHANNEL: 'realeco' | 'limo' | 'cielo' | 'internal' = __APP_RELEASE_CHANNEL__ === 'limo'
    ? 'limo'
    : __APP_RELEASE_CHANNEL__ === 'cielo'
        ? 'cielo'
        : __APP_RELEASE_CHANNEL__ === 'internal'
            ? 'internal'
            : 'realeco';

const SettingsModal: React.FC<SettingsModalProps> = ({
    onClose,
    initialTab = 'help',
    initialSubview = null,
    initialVisualizerSection = null,
    theme,
    bgMode,
    onApplyDefaultTheme,
    hasCustomTheme,
    themeParkInitialTheme,
    isCustomThemePreferred,
    songThemeAutoSwitchEnabled,
    songThemeAutoGenerateEnabled,
    onSaveCustomTheme,
    onApplyCustomTheme,
    onToggleCustomThemePreferred,
    onToggleSongThemeAutoSwitch,
    onToggleSongThemeAutoGenerate,
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
    playerCapConnectionStatus = 'idle',
    playerCapPlayers = [],
    obsBrowserSourceStatus = null,
    onToggleObsBrowserSource,
    onRegenerateObsBrowserSourceToken,
    onAudioOutputDeviceChange,
    onToggleTransparentPlayerBackground,
    aiTheme,
    customTheme,
}) => {
    const { t } = useTranslation();
    // Track the press origin per overlay so nested subview backdrops do not overwrite each other.
    const overlayMouseDownTargetsRef = useRef(new WeakSet<HTMLDivElement>());
    const {
        useCoverColorBg,
        staticMode,
        disableHomeDynamicBackground,
        hidePlayerProgressBar,
        hidePlayerTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
        hidePlayerRightPanelButton,
        transparentPlayerBackground,
        autoHidePlayerChrome,
        disableVisualizerVignette,
        disableVisualizerGeometricBackground,
        minimizeToTray,
        voiceInputPauseEnabled,
        hideTaskbarIcon,
        hideRemoteControlTaskbarIcon,
        openPlayerOnLaunch,
        enableMediaCache,
        backgroundOpacity,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        showHarmonySubtitle,
        harmonySubtitleBackground,
        visualizerOpacity,
        visualizerBackgroundMode,
        isDaylight,
        visualizerMode,
        grid3dCardStyle,
        classicTuning,
        cadenzaTuning,
        partitaTuning,
        fumeTuning,
        claddaghTuning,
        cappellaTuning,
        tiltTuning,
        dioramaTuning,
        monetBackgroundTuning,
        nomandBackgroundTuning,
        latentBackgroundTuning,
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
        subtitleFontScale,
        lyricsFontWeight,
        lyricsCustomFontFamily,
        lyricsCustomFontLabel,
        lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
        subtitleFontWeight,
        subtitleFontFamily,
        subtitleFontFallbackFamilies,
        lyricFilterPattern,
        showOpenPanelCloseButton,
        handleToggleCoverColorBg: onToggleCoverColorBg,
        handleToggleStaticMode: onToggleStaticMode,
        handleToggleDisableHomeDynamicBackground: onToggleDisableHomeDynamicBackground,
        handleToggleHidePlayerProgressBar: onToggleHidePlayerProgressBar,
        handleToggleHidePlayerTranslationSubtitle: onToggleHidePlayerTranslationSubtitle,
        handleToggleShowSubtitleTranslation: onToggleShowSubtitleTranslation,
        handleSetSubtitleContentMode: onSubtitleContentModeChange,
        handleToggleHidePlayerRightPanelButton: onToggleHidePlayerRightPanelButton,
        handleToggleTransparentPlayerBackground: onToggleTransparentPlayerBackgroundFromStore,
        handleToggleAutoHidePlayerChrome: onToggleAutoHidePlayerChrome,
        handleToggleDisableVisualizerVignette: onToggleDisableVisualizerVignette,
        handleToggleDisableVisualizerGeometricBackground: onToggleDisableVisualizerGeometricBackground,
        handleToggleMinimizeToTray: onToggleMinimizeToTray,
        handleToggleVoiceInputPause: onToggleVoiceInputPause,
        handleToggleHideTaskbarIcon: onToggleHideTaskbarIcon,
        handleToggleHideRemoteControlTaskbarIcon: onToggleHideRemoteControlTaskbarIcon,
        handleToggleOpenPlayerOnLaunch: onToggleOpenPlayerOnLaunch,
        handleToggleMediaCache: onToggleMediaCache,
        handleSetBackgroundOpacity: setBackgroundOpacity,
        handleSetSubtitleOverlayOpacity: setSubtitleOverlayOpacity,
        handleToggleSubtitleOverlayBackground: onToggleSubtitleOverlayBackground,
        handleToggleShowHarmonySubtitle: onToggleShowHarmonySubtitle,
        handleToggleHarmonySubtitleBackground: onToggleHarmonySubtitleBackground,
        handleSetVisualizerOpacity: setVisualizerOpacity,
        handleSetVisualizerBackgroundMode: onVisualizerBackgroundModeChange,
        handleSetVisualizerMode: onVisualizerModeChange,
        handleSetClassicTuning: onClassicTuningChange,
        handleResetClassicTuning: onResetClassicTuning,
        handleSetPartitaTuning: onPartitaTuningChange,
        handleResetPartitaTuning: onResetPartitaTuning,
        handleSetFumeTuning: onFumeTuningChange,
        handleResetFumeTuning: onResetFumeTuning,
        handleSetCladdaghTuning: onCladdaghTuningChange,
        handleResetCladdaghTuning: onResetCladdaghTuning,
        handleSetCappellaTuning: onCappellaTuningChange,
        handleResetCappellaTuning: onResetCappellaTuning,
        handleSetTiltTuning: onTiltTuningChange,
        handleResetTiltTuning: onResetTiltTuning,
        handleSetDioramaTuning: onDioramaTuningChange,
        handleResetDioramaTuning: onResetDioramaTuning,
        handleSetMonetBackgroundTuning: onMonetBackgroundTuningChange,
        handleResetMonetBackgroundTuning: onResetMonetBackgroundTuning,
        handleSetNomandBackgroundTuning: onNomandBackgroundTuningChange,
        handleResetNomandBackgroundTuning: onResetNomandBackgroundTuning,
        handleSetLatentBackgroundTuning: onLatentBackgroundTuningChange,
        handleResetLatentBackgroundTuning: onResetLatentBackgroundTuning,
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
        handleSetSubtitleFontScale: onSubtitleFontScaleChange,
        handleSetLyricsFontWeight: onLyricsFontWeightChange,
        handleSetLyricsCustomFont: onLyricsCustomFontChange,
        handleUploadLyricsCustomFont: onLyricsCustomFontUpload,
        handleSetLyricsFontFallbackFamilies: onLyricsFontFallbackFamiliesChange,
        handleSetSubtitleFontInheritsLyrics: onSubtitleFontInheritsLyricsChange,
        handleSetSubtitleFontStyle: onSubtitleFontStyleChange,
        handleSetSubtitleFontWeight: onSubtitleFontWeightChange,
        handleSetSubtitleFontFamily: onSubtitleFontFamilyChange,
        handleSetSubtitleFontFallbackFamilies: onSubtitleFontFallbackFamiliesChange,
        handleToggleOpenPanelCloseButton: onToggleOpenPanelCloseButton,
        handleSetGrid3dCardStyle: onChangeGrid3dCardStyle,
    } = useSettingsUiStore(useShallow(selectSettingsUiSnapshot));
    const resolvedToggleTransparentPlayerBackground = onToggleTransparentPlayerBackground ?? onToggleTransparentPlayerBackgroundFromStore;
    const setIsSubSettingsViewOpen = useSettingsUiStore(state => state.setIsSubSettingsViewOpen);
    const setIsUserGuideModalOpen = useSettingsUiStore(state => state.setIsUserGuideModalOpen);
    const [activeTab, setActiveTab] = useState<'help' | 'options'>(initialTab);
    const [tabDirection, setTabDirection] = useState<'left' | 'right'>('right');
    const handleTabChange = (tab: 'help' | 'options') => {
        setTabDirection(tab === 'options' ? 'left' : 'right');
        setActiveTab(tab);
    };
    const [activeSettingsSection, setActiveSettingsSection] = useState<string>('appearance');

    // Drag to scroll logic for mobile pill tabs
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [scrollLeft, setScrollLeft] = useState(0);
    const hasDraggedRef = useRef(false);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!scrollContainerRef.current) return;
        setIsDragging(true);
        hasDraggedRef.current = false;
        setStartX(e.pageX - scrollContainerRef.current.offsetLeft);
        setScrollLeft(scrollContainerRef.current.scrollLeft);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !scrollContainerRef.current) return;
        e.preventDefault();
        const x = e.pageX - scrollContainerRef.current.offsetLeft;
        const walk = (x - startX) * 1.5;
        if (Math.abs(walk) > 5) {
            hasDraggedRef.current = true;
        }
        scrollContainerRef.current.scrollLeft = scrollLeft - walk;
    };



    const [showVisPlayground, setShowVisPlayground] = useState(false);
    const [showThemePark, setShowThemePark] = useState(false);
    const [showLyricFilterSettings, setShowLyricFilterSettings] = useState(false);
    const [showAiHelpPrompt, setShowAiHelpPrompt] = useState(false);
    const [versionCopied, setVersionCopied] = useState(false);
    const [stageAddressCopied, setStageAddressCopied] = useState(false);
    const [authorClickCount, setAuthorClickCount] = useState(0);
    const [meowEasterEgg, setMeowEasterEgg] = useState<{ id: number; } | null>(null);
    const shouldCloseModalOnSubviewBack = initialSubview !== null;

    useEffect(() => {
        setActiveTab(initialTab);
        setShowVisPlayground(initialSubview === 'visualizer');
        setShowThemePark(initialSubview === 'themePark');
        setShowLyricFilterSettings(initialSubview === 'lyricFilter');

        if (
            initialSubview === 'appearance' ||
            initialSubview === 'general' ||
            initialSubview === 'playback' ||
            initialSubview === 'integration' ||
            initialSubview === 'storage' ||
            initialSubview === 'desktop' ||
            initialSubview === 'lab'
        ) {
            setActiveSettingsSection(initialSubview);
        } else {
            setActiveSettingsSection(prev => prev || 'appearance');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
        OPENAI_API_TEMPERATURE: DEFAULT_OPENAI_TEMPERATURE,
        AI_PROVIDER: 'gemini',
        USE_SYSTEM_PROXY_FOR_AI: false,
        ENABLE_UPDATE_CHECK: true,
        ENABLE_AUTO_UPDATE: false,
        UPDATE_CHANNEL: DEFAULT_UPDATE_CHANNEL,
        STAGE_MODE_SOURCE: 'stage-api',
        DISCORD_RICH_PRESENCE_ENABLED: false,
    });
    const [electronSaveStatus, setElectronSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [updateStatus, setUpdateStatus] = useState<ElectronUpdateStatus | null>(null);
    const [discordPresenceStatus, setDiscordPresenceStatus] = useState<ElectronDiscordPresenceStatus | null>(null);
    const [cacheDirectory, setCacheDirectory] = useState<string>('');
    const [cacheDirectoryIsDefault, setCacheDirectoryIsDefault] = useState(true);
    const [cacheDirectoryStatus, setCacheDirectoryStatus] = useState<'idle' | 'choosing'>('idle');
    const [stageActionStatus, setStageActionStatus] = useState<'idle' | 'regenerating'>('idle');
    const configuredAiProvider = isElectron ? electronSettings.AI_PROVIDER : import.meta.env.VITE_AI_PROVIDER;
    const aiServiceLabel = configuredAiProvider === 'openai' ? 'OpenAI Compatible' : 'Google Gemini';
    const showQuarkDownload = electronSettings.UPDATE_CHANNEL === 'realeco';
    useEffect(() => {
        if ((window as any).electron) {
            setIsElectron(true);
            (window as any).electron.getSettings().then((settings: any) => {
                if (settings) {
                    setElectronSettings(prev => ({
                        ...prev,
                        ...settings,
                        OPENAI_API_TEMPERATURE: String(settings.OPENAI_API_TEMPERATURE ?? '').trim() || DEFAULT_OPENAI_TEMPERATURE,
                    }));
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
            (window as any).electron.getDiscordPresenceStatus?.().then((status: ElectronDiscordPresenceStatus) => {
                setDiscordPresenceStatus(status);
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
        if (!window.electron?.onDiscordPresenceStatusChanged) {
            return;
        }

        return window.electron.onDiscordPresenceStatusChanged((status) => {
            setDiscordPresenceStatus(status);
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
            const configuredTemperature = Number.parseFloat(electronSettings.OPENAI_API_TEMPERATURE.trim());
            const temperature = Number.isFinite(configuredTemperature) && configuredTemperature >= 0 && configuredTemperature <= 2
                ? electronSettings.OPENAI_API_TEMPERATURE.trim()
                : DEFAULT_OPENAI_TEMPERATURE;
            setElectronSaveStatus('saving');
            setElectronSettings(prev => ({ ...prev, OPENAI_API_TEMPERATURE: temperature }));
            await (window as any).electron.saveSettings('GEMINI_API_KEY', electronSettings.GEMINI_API_KEY);
            await (window as any).electron.saveSettings('OPENAI_API_KEY', electronSettings.OPENAI_API_KEY);
            await (window as any).electron.saveSettings('OPENAI_API_URL', electronSettings.OPENAI_API_URL);
            await (window as any).electron.saveSettings('OPENAI_API_MODEL', electronSettings.OPENAI_API_MODEL);
            await (window as any).electron.saveSettings('OPENAI_API_TEMPERATURE', temperature);
            await (window as any).electron.saveSettings('AI_PROVIDER', electronSettings.AI_PROVIDER);
            await (window as any).electron.saveSettings('USE_SYSTEM_PROXY_FOR_AI', electronSettings.USE_SYSTEM_PROXY_FOR_AI);
            await (window as any).electron.saveSettings('ENABLE_UPDATE_CHECK', electronSettings.ENABLE_UPDATE_CHECK);
            await (window as any).electron.saveSettings('ENABLE_AUTO_UPDATE', electronSettings.ENABLE_AUTO_UPDATE);
            await (window as any).electron.saveSettings('UPDATE_CHANNEL', electronSettings.UPDATE_CHANNEL);
            await (window as any).electron.saveSettings('DISCORD_RICH_PRESENCE_ENABLED', electronSettings.DISCORD_RICH_PRESENCE_ENABLED);
            setElectronSaveStatus('saved');
            setTimeout(() => setElectronSaveStatus('idle'), 2000);
        }
    };

    const handleToggleDiscordPresence = async (enabled: boolean) => {
        const nextSettings = {
            ...electronSettings,
            DISCORD_RICH_PRESENCE_ENABLED: enabled,
        };
        setElectronSettings(nextSettings);
        await window.electron?.saveSettings?.('DISCORD_RICH_PRESENCE_ENABLED', enabled);
        const status = await window.electron?.getDiscordPresenceStatus?.();
        if (status) {
            setDiscordPresenceStatus(status);
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

    const handleUpdateChannelChange = async (channel: 'realeco' | 'limo' | 'cielo') => {
        if (!window.electron?.saveSettings) {
            return;
        }

        setElectronSettings((current) => ({ ...current, UPDATE_CHANNEL: channel }));
        await window.electron.saveSettings('UPDATE_CHANNEL', channel);

        const status = await window.electron.getUpdateStatus?.();
        if (status) {
            setUpdateStatus(status);
        }
    };

    const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');
    const isWin = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win');


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
    const [navidromeServerProfile, setNavidromeServerProfile] = useState<NavidromeServerProfile | null>(null);

    // Load Navidrome config on mount
    useEffect(() => {
        setNavidromeEnabledState(isNavidromeEnabled());
        const config = getNavidromeConfig();
        if (config) {
            setNavidromeUrl(config.serverUrl);
            setNavidromeUsername(config.username);
            setNavidromeConfigured(true);
            setNavidromeServerProfile(getCachedNavidromeServerProfile());
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
            void refreshNavidromeServerProfile(config)
                .then(setNavidromeServerProfile)
                .catch((error) => {
                    console.warn('[Settings] Failed to refresh Navidrome server profile:', error);
                    setNavidromeServerProfile(null);
                });
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
        setNavidromeServerProfile(null);
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
        if (confirm(t('options.confirmClearAll'))) {
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
                return t('status.connected');
            case 'connecting':
                return t('status.connecting');
            case 'error':
                return t('status.disconnected');
            default:
                return t('options.updateCheckDisabled');
        }
    })();
    const stageEnabled = Boolean(stageStatus?.modeEnabled);
    const activeStageSource = stageStatus?.source ?? stageSource;
    const stageHasActiveSession = Boolean(stageStatus?.lyricsSession || stageStatus?.mediaSession);
    // now-playing 与 playercap 是互斥的舞台源：两颗状态指示都只认当前选中源 activeStageSource，
    // 保证同一时刻至多显示一个（web 端即便两个 enable 标志同时为真，也以派生出的选中源为准）。
    const nowPlayingEnabled = Boolean(
        isElectron
            ? (stageStatus?.modeEnabled && activeStageSource === 'now-playing')
            : activeStageSource === 'now-playing'
    );
    const nowPlayingConnected = nowPlayingEnabled && nowPlayingConnectionStatus === 'connected';
    const stageConnected = stageEnabled && activeStageSource === 'stage-api';
    const playerCapEnabled = Boolean(
        isElectron
            ? (stageStatus?.modeEnabled && activeStageSource === 'playercap')
            : activeStageSource === 'playercap'
    );
    const playerCapConnected = playerCapEnabled && playerCapConnectionStatus === 'connected';
    const integrationStatusItems = [
        ...(stageConnected
            ? [{
                key: 'stage',
                label: t('options.stageConnected'),
                tone: 'success' as const,
            }]
            : []),
        ...(nowPlayingEnabled
            ? [{
                key: 'now-playing',
                label: nowPlayingConnected ? t('options.nowPlayingConnectedStatus') : t('options.nowPlayingDisconnectedStatus'),
                tone: nowPlayingConnected ? 'success' as const : 'error' as const,
            }]
            : []),
        ...(playerCapEnabled
            ? [{
                key: 'playercap',
                label: playerCapConnected ? t('options.playerCapConnectedStatus') : t('options.playerCapDisconnectedStatus'),
                tone: playerCapConnected ? 'success' as const : 'error' as const,
            }]
            : []),
    ];
    const navidromeExtensionCount = navidromeServerProfile?.openSubsonicExtensions.length ?? 0;
    const navidromeFolderCount = navidromeServerProfile?.musicFolders.length ?? 0;
    const navidromeServerLabel = navidromeServerProfile?.serverVersion
        || navidromeServerProfile?.serverType
        || t('navidrome.serverProfileUnavailable')
        || 'Unknown server';

    // const isDaylight = theme?.name === 'Daylight Default'; // Deprecated, passed as prop
    const glassBg = isDaylight ? 'bg-white' : 'bg-[#18181b]';
    const subviewPanelBg = isDaylight ? 'bg-zinc-50' : 'bg-[#18181b]';
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
    const tabVariants = {
        enter: (direction: 'left' | 'right') => ({
            x: direction === 'right' ? 60 : -60,
            opacity: 0,
        }),
        center: {
            x: 0,
            opacity: 1,
        },
        exit: (direction: 'left' | 'right') => ({
            x: direction === 'right' ? -60 : 60,
            opacity: 0,
        }),
    };

    const handleOverlayMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            overlayMouseDownTargetsRef.current.add(event.currentTarget);
            return;
        }

        overlayMouseDownTargetsRef.current.delete(event.currentTarget);
    };

    // Close only the active overlay layer when its own backdrop is clicked.
    const handleBackdropClose = (event: React.MouseEvent<HTMLDivElement>, onCloseOverlay: () => void) => {
        const wasMouseDownOnOverlay = overlayMouseDownTargetsRef.current.has(event.currentTarget);
        overlayMouseDownTargetsRef.current.delete(event.currentTarget);

        if (event.target !== event.currentTarget || !wasMouseDownOnOverlay) {
            return;
        }

        event.stopPropagation();
        onCloseOverlay();
    };
    const isAnySubviewOpen = showVisPlayground
        || showThemePark
        || showLyricFilterSettings
        || showAiHelpPrompt;

    const closeAllSubviews = () => {
        if (shouldCloseModalOnSubviewBack) {
            onClose();
            return;
        }
        setShowVisPlayground(false);
        setShowThemePark(false);
        setShowLyricFilterSettings(false);
        setShowAiHelpPrompt(false);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (isAnySubviewOpen) {
                    closeAllSubviews();
                } else {
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isAnySubviewOpen, shouldCloseModalOnSubviewBack, onClose]);

    useEffect(() => {
        setIsSubSettingsViewOpen(isAnySubviewOpen);

        return () => {
            setIsSubSettingsViewOpen(false);
        };
    }, [isAnySubviewOpen, setIsSubSettingsViewOpen]);

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
                className={`relative w-11 h-6 rounded-full transition-all duration-300 shrink-0 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-95'
                    } ${checked ? '' : toggleOffBackgroundClass}`}
                style={{
                    backgroundColor: checked
                        ? (theme?.accentColor || (isDaylight ? '#18181b' : '#f4f4f5'))
                        : undefined
                }}
            >
                <div
                    className={`absolute top-1 left-1 w-4 h-4 rounded-full transition-transform duration-300 shadow-sm ${isDaylight ? 'bg-white' : 'bg-zinc-100'
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
                    className="fixed inset-0 p-3 sm:p-5"
                    style={{ backgroundColor: overlayBackground, zIndex }}
                    onMouseDown={handleOverlayMouseDown}
                    onClick={(event) => handleBackdropClose(event, handleClose)}
                >
                    <motion.div
                        {...panelMotion}
                        transition={shellTransition}
                        className={`mx-auto flex h-full max-w-3xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${subviewPanelBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)] relative`}
                        onClick={(event) => event.stopPropagation()}
                    >
                        {/* Decorative background blobs */}
                        <div className="absolute inset-0 pointer-events-none z-0">
                            <div
                                className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[80px] ${isDaylight ? 'opacity-20' : 'opacity-10'}`}
                                style={{ backgroundColor: theme?.accentColor || (isDaylight ? '#60a5fa' : '#3b82f6') }}
                            />
                            <div
                                className={`absolute -bottom-24 -left-24 w-64 h-64 rounded-full blur-[80px] ${isDaylight ? 'opacity-20' : 'opacity-10'}`}
                                style={{ backgroundColor: theme?.secondaryColor || theme?.accentColor || (isDaylight ? '#c084fc' : '#a855f7') }}
                            />
                        </div>
                        <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6 relative z-10">
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
                        <div className="flex-1 overflow-y-auto custom-scrollbar px-4 py-5 sm:px-6 relative z-10">
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

    const SETTINGS_SECTIONS = [
        { id: 'appearance', icon: Sparkles, label: t('options.visualSettings') },
        { id: 'general', icon: Languages, label: t('options.generalSettings') },
        { id: 'playback', icon: PlayCircle, label: t('options.playbackSettings') },
        { id: 'integration', icon: Server, label: t('options.integrationSettings') },
        { id: 'storage', icon: Database, label: t('options.storageSettings') },
        ...(isElectron ? [{ id: 'desktop', icon: Command, label: t('options.desktopSettings') }] : []),
        { id: 'lab', icon: FlaskConical, label: t('options.labSettings') }
    ];

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={shellTransition}
            data-folia-keyboard-window="true"
            className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8 sm:px-5 sm:py-12"
            style={{ backgroundColor: overlayBackground }}
            onMouseDown={handleOverlayMouseDown}
            onClick={(event) => handleBackdropClose(event, onClose)}
        >
            <motion.div
                {...panelMotion}
                transition={shellTransition}
                className={`${glassBg} border ${borderColor} p-6 md:p-8 rounded-3xl ${activeTab === 'options' ? 'w-full md:max-w-4xl md:w-[900px] h-[90vh] md:h-[85vh]' : 'w-full md:max-w-lg'} relative shadow-2xl overflow-hidden flex flex-col max-h-[90vh] transition-all duration-300`}
                onClick={(event) => event.stopPropagation()}
            >
                {/* Decorative background blobs */}
                <div className="absolute inset-0 pointer-events-none z-0">
                    <div
                        className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-[80px] ${isDaylight ? 'opacity-20' : 'opacity-10'}`}
                        style={{ backgroundColor: theme?.accentColor || (isDaylight ? '#60a5fa' : '#3b82f6') }}
                    />
                    <div
                        className={`absolute -bottom-24 -left-24 w-64 h-64 rounded-full blur-[80px] ${isDaylight ? 'opacity-20' : 'opacity-10'}`}
                        style={{ backgroundColor: theme?.secondaryColor || theme?.accentColor || (isDaylight ? '#c084fc' : '#a855f7') }}
                    />
                </div>

                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 opacity-30 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors z-20"
                    style={{ color: 'var(--text-primary)' }}
                >
                    <X size={20} />
                </button>

                {/* Header / Tabs */}
                <div className="relative shrink-0 z-10 mb-6 select-none">
                    <div className="flex items-center gap-6">
                        <button
                            onClick={() => handleTabChange('help')}
                            className={`relative text-2xl font-bold transition-colors pb-2 ${activeTab === 'help' ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('help.title') || "Help"}
                            {activeTab === 'help' && (
                                <motion.div
                                    className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full"
                                    style={{ backgroundColor: theme?.accentColor || (isDaylight ? '#18181b' : '#f4f4f5') }}
                                    initial={{ opacity: 0, scaleX: 0.65 }}
                                    animate={{ opacity: 1, scaleX: 1 }}
                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                />
                            )}
                        </button>
                        <button
                            onClick={() => handleTabChange('options')}
                            className={`relative text-2xl font-bold transition-colors pb-2 ${activeTab === 'options' ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {t('ui.options') || "Options"}
                            {activeTab === 'options' && (
                                <motion.div
                                    className="absolute bottom-0 left-0 right-0 h-[3px] rounded-full"
                                    style={{ backgroundColor: theme?.accentColor || (isDaylight ? '#18181b' : '#f4f4f5') }}
                                    initial={{ opacity: 0, scaleX: 0.65 }}
                                    animate={{ opacity: 1, scaleX: 1 }}
                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                />
                            )}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden relative z-10">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {activeTab === 'help' ? (
                            <motion.div
                                key="help-tab"
                                custom={tabDirection}
                                variants={tabVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={shellTransition}
                                className="space-y-6 select-none h-full overflow-y-auto custom-scrollbar pr-2 pb-4"
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
                                                <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">{isMac ? 'Cmd' : 'Ctrl'}</kbd>
                                                <span className="text-xs opacity-50">+</span>
                                                <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">← / →</kbd>
                                            </div>
                                        </li>
                                        <li className="flex items-center justify-between bg-white/5 p-2 rounded-lg">
                                            <span>{t('help.seekBackward')} / {t('help.seekForward')}</span>
                                            <kbd className="px-2 py-0.5 bg-white/10 rounded text-xs font-mono">← / →</kbd>
                                        </li>

                                    </ul>
                                </div>

                                {/* User Guide Button */}
                                <div className="mt-6 flex flex-wrap justify-center gap-3">
                                    <button
                                        onClick={() => {
                                            setIsUserGuideModalOpen(true);
                                            onClose();
                                        }}
                                        className="px-6 py-2 bg-white/10 hover:bg-white/20 transition-colors rounded-full text-sm font-medium flex items-center gap-2"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        <Command size={16} />
                                        {t('userGuide.showGuide', 'Show User Guide')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowAiHelpPrompt(true)}
                                        className="px-6 py-2 bg-white/10 hover:bg-white/20 transition-colors rounded-full text-sm font-medium flex items-center gap-2"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        <CircleHelp size={16} />
                                        {t('aiHelp.openButton', 'Need help?')}
                                    </button>
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
                                    <div className="flex flex-col items-center gap-2 mt-6 mb-2 text-xs font-mono text-center">
                                        {/* 第一行：原本的版本信息按钮 */}
                                        <button
                                            type="button"
                                            onClick={handleCopyVersionInfo}
                                            className="opacity-45 hover:opacity-100 transition-opacity cursor-copy hover:underline"
                                            style={{ color: 'var(--text-secondary)' }}
                                            title={versionCopied ? t('status.copied') : t('options.versionCopiedHint')}
                                            aria-label={versionCopied ? t('options.versionCopiedHint') : t('options.versionCopiedHint')}
                                        >
                                            {versionCopied
                                                ? t('status.copied')
                                                : `${__APP_VERSION_LABEL__} v${__APP_VERSION__} - ${__GIT_BRANCH__} - ${__COMMIT_HASH__}`}
                                        </button>

                                        {/* 第二行：发现新版本与操作按钮 */}
                                        {updateStatus?.availableVersion && (
                                            <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 mt-0.5">
                                                <span className="text-amber-500 font-semibold">
                                                    {t('options.newVersionFound', { version: updateStatus.availableVersion })}
                                                </span>

                                                {updateStatus.status === 'downloaded' ? (
                                                    <button
                                                        type="button"
                                                        onClick={handleInstallUpdate}
                                                        className="text-green-400 font-bold hover:underline ml-1"
                                                    >
                                                        {t('options.restartToInstallUpdate')}
                                                    </button>
                                                ) : updateStatus.status === 'downloading' ? (
                                                    <span className="text-zinc-300 opacity-80 ml-1">
                                                        {t('options.downloadingProgress', { percent: Math.round(updateStatus.downloadProgress?.percent || 0) })}
                                                    </span>
                                                ) : (
                                                    !electronSettings.ENABLE_AUTO_UPDATE && (
                                                        <button
                                                            type="button"
                                                            onClick={handleDownloadUpdate}
                                                            disabled={!canDownloadUpdate}
                                                            className="text-zinc-100 hover:text-white font-bold flex items-center justify-center transition-colors disabled:opacity-40 ml-1"
                                                            title="立即下载"
                                                            aria-label="立即下载"
                                                        >
                                                            <Download size={13} />
                                                        </button>
                                                    )
                                                )}

                                                {showQuarkDownload && updateStatus.platform !== 'linux' && (
                                                    <>
                                                        <span className="opacity-25 select-none" style={{ color: 'var(--text-secondary)' }}>|</span>

                                                        <button
                                                            type="button"
                                                            onClick={handleOpenChinaDownload}
                                                            className="opacity-55 hover:opacity-100 transition-opacity hover:underline"
                                                            style={{ color: 'var(--text-secondary)' }}
                                                        >
                                                            {t('options.downloadChina')}
                                                        </button>
                                                    </>
                                                )}

                                                <span className="opacity-25 select-none" style={{ color: 'var(--text-secondary)' }}>|</span>

                                                <button
                                                    type="button"
                                                    onClick={() => window.electron?.openUpdateReleasePage(updateStatus.availableVersion)}
                                                    className="opacity-55 hover:opacity-100 transition-opacity hover:underline"
                                                    style={{ color: 'var(--text-secondary)' }}
                                                >
                                                    {t('options.goToGithubRelease')}
                                                </button>
                                            </div>
                                        )}

                                        {/* 第三行：多平台网络与手动下载提醒小字 */}
                                        {updateStatus?.availableVersion && (
                                            <div className="text-xs opacity-60 mt-0.5 space-y-0.5" style={{ color: 'var(--text-secondary)' }}>
                                                {(updateStatus.platform === 'darwin' || updateStatus.platform === 'linux' || !updateStatus.supported) && (
                                                    <div>
                                                        {updateStatus.platform === 'darwin'
                                                            ? t('options.macManualUpdateNotice')
                                                            : updateStatus.platform === 'linux'
                                                            ? t('options.linuxManualUpdateNotice')
                                                            : t('options.manualUpdateNotice')}
                                                    </div>
                                                )}
                                                {showQuarkDownload && updateStatus.platform !== 'linux' && (
                                                    <div>{t('options.chinaDownloadHint')}</div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="options-tab"
                                custom={tabDirection}
                                variants={tabVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={shellTransition}
                                className="flex flex-col md:flex-row gap-4 md:gap-6 h-full"
                            >
                                <div
                                    ref={scrollContainerRef}
                                    onMouseDown={handleMouseDown}
                                    onMouseLeave={handleMouseLeave}
                                    onMouseUp={handleMouseUp}
                                    onMouseMove={handleMouseMove}
                                    className={`w-full md:w-1/3 md:max-w-[240px] shrink-0 overflow-x-auto md:overflow-x-hidden md:overflow-y-auto mobile-hide-scrollbar custom-scrollbar pr-0 md:pr-3 flex flex-row md:flex-col space-x-2 md:space-x-0 space-y-0 md:space-y-2 border-b md:border-b-0 md:border-r border-white/10 pb-3 md:pb-4 mb-2 md:mb-0 items-center md:items-stretch ${isDragging ? 'cursor-grabbing select-none' : 'cursor-default'}`}
                                >
                                    {SETTINGS_SECTIONS.map((section) => {
                                        const Icon = section.icon;
                                        const isActive = activeSettingsSection === section.id;
                                        return (
                                            <button
                                                key={section.id}
                                                type="button"
                                                onClick={() => {
                                                    if (hasDraggedRef.current) return;
                                                    setActiveSettingsSection(section.id);
                                                }}
                                                className={`shrink-0 w-auto md:w-full p-2 md:p-3 rounded-xl border transition-colors flex items-center justify-center md:justify-between gap-2 md:gap-3 text-left ${isActive ? (isDaylight ? 'border-zinc-300/70 bg-white/80' : 'border-white/20 bg-white/10') : (isDaylight ? 'border-transparent hover:bg-white/50' : 'border-transparent hover:bg-white/5')}`}
                                            >
                                                <div className="flex items-center gap-2 md:gap-3">
                                                    <div className="opacity-70" style={{ color: 'var(--text-primary)' }}>
                                                        <Icon size={18} />
                                                    </div>
                                                    <div className="text-sm font-medium whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                                                        {section.label}
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar pl-1 md:pl-2 pr-2 md:pr-4 relative pb-4">
                                    <div className="mb-4 md:mb-6 border-b border-white/10 pb-3 md:pb-4">
                                        <h2 className="text-lg md:text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
                                            {activeSettingsSection === 'appearance' && (t('options.visualSettings') || "Visual Settings")}
                                            {activeSettingsSection === 'general' && (t('options.generalSettings') || "General Settings")}
                                            {activeSettingsSection === 'playback' && (t('options.playbackSettings') || "Playback Settings")}
                                            {activeSettingsSection === 'integration' && (t('options.integrationSettings') || "Integration Settings")}
                                            {activeSettingsSection === 'storage' && (t('options.storageSettings') || "Storage Settings")}
                                            {activeSettingsSection === 'desktop' && (t('options.desktopSettings') || "Desktop Settings")}
                                            {activeSettingsSection === 'lab' && (t('options.labSettings') || "Lab Settings")}
                                        </h2>
                                        <p className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                            {activeSettingsSection === 'appearance' && (t('options.visualSettingsPanelDesc') || "Customize the look and feel of Folia.")}
                                            {activeSettingsSection === 'general' && (t('options.generalSettingsDesc') || "Basic application preferences.")}
                                            {activeSettingsSection === 'playback' && (t('options.playbackSettingsPanelDesc') || "Audio output and playback behavior.")}
                                            {activeSettingsSection === 'integration' && (t('options.integrationSettingsDesc') || "Connect with external services.")}
                                            {activeSettingsSection === 'storage' && (t('options.storageSettingsPanelDesc') || "Manage cache and local data.")}
                                            {activeSettingsSection === 'desktop' && (t('options.desktopSettingsPanelDesc') || "System integration and updates.")}
                                            {activeSettingsSection === 'lab' && (t('options.labSettingsDesc') || "Experimental features.")}
                                        </p>
                                    </div>
                                    <div className="space-y-8">
                                        {activeSettingsSection === 'appearance' && (
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
                                                onToggleSongThemeAutoGenerate={onToggleSongThemeAutoGenerate}
                                                onToggleCustomThemePreferred={onToggleCustomThemePreferred}
                                                onToggleSongThemeAutoSwitch={onToggleSongThemeAutoSwitch}
                                                onToggleTransparentPlayerBackground={resolvedToggleTransparentPlayerBackground}
                                                onToggleAutoHidePlayerChrome={onToggleAutoHidePlayerChrome}
                                                onSaveCustomTheme={onSaveCustomTheme}
                                                settingsCardClass={settingsCardClass}
                                                songThemeAutoSwitchEnabled={songThemeAutoSwitchEnabled}
                                                songThemeAutoGenerateEnabled={songThemeAutoGenerateEnabled}
                                                theme={theme}
                                                themeParkInitialTheme={themeParkInitialTheme}
                                                toggleOffBackgroundClass={toggleOffBackgroundClass}
                                                transparentPlayerBackground={transparentPlayerBackground}
                                                autoHidePlayerChrome={autoHidePlayerChrome}
                                                utilityGhostButtonClass={utilityGhostButtonClass}
                                                grid3dCardStyle={grid3dCardStyle}
                                                onChangeGrid3dCardStyle={onChangeGrid3dCardStyle}
                                                aiTheme={aiTheme}
                                                customTheme={customTheme}
                                            />
                                        )}
                                        {activeSettingsSection === 'general' && (
                                            <GeneralSettingsSubview
                                                isDaylight={isDaylight}
                                                settingsCardClass={settingsCardClass}
                                                theme={theme}
                                            />
                                        )}
                                        {activeSettingsSection === 'playback' && (
                                            <PlaybackSettingsSubview
                                                isOpen={true}
                                                isDaylight={isDaylight}
                                                onAudioOutputDeviceChange={onAudioOutputDeviceChange}
                                                settingsCardClass={settingsCardClass}
                                                theme={theme}
                                                utilityGhostButtonClass={utilityGhostButtonClass}
                                            />
                                        )}
                                        {activeSettingsSection === 'integration' && (
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
                                                    navidromeServerProfile,
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
                                                discord={{
                                                    enabled: electronSettings.DISCORD_RICH_PRESENCE_ENABLED,
                                                    onToggle: handleToggleDiscordPresence,
                                                    status: discordPresenceStatus,
                                                }}
                                                stage={{
                                                    nowPlayingConnectionStatus,
                                                    playerCapConnectionStatus,
                                                    playerCapPlayers,
                                                    obsBrowserSourceStatus,
                                                    onCopyText: copyText,
                                                    onRegenerateObsBrowserSourceToken,
                                                    onRegenerateStageToken,
                                                    onStageSourceChange,
                                                    onToggleObsBrowserSource,
                                                    onToggleStageMode,
                                                    setStageActionStatus,
                                                    setStageAddressCopied,
                                                    stageActionStatus,
                                                    stageAddressCopied,
                                                    stageSource,
                                                    stageStatus,
                                                }}
                                            />
                                        )}
                                        {activeSettingsSection === 'storage' && (
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
                                        )}
                                        {activeSettingsSection === 'desktop' && isElectron && (
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
                                                    onUpdateChannelChange: handleUpdateChannelChange,
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
                                                    hideRemoteControlTaskbarIcon,
                                                    minimizeToTray,
                                                    onToggleHideTaskbarIcon,
                                                    onToggleHideRemoteControlTaskbarIcon,
                                                    onToggleMinimizeToTray,
                                                    onToggleOpenPlayerOnLaunch,
                                                    openPlayerOnLaunch,
                                                }}
                                            />
                                        )}
                                        {activeSettingsSection === 'lab' && (
                                            <LabSettingsModal
                                                isOpen={true}
                                                onClose={() => { }}
                                                onOpenLyricFilterSettings={() => setShowLyricFilterSettings(true)}
                                                theme={theme}
                                                embedded={true}
                                                voiceInputPause={{
                                                    enabled: voiceInputPauseEnabled,
                                                    supported: isElectron && typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win'),
                                                    onToggle: () => onToggleVoiceInputPause(!voiceInputPauseEnabled),
                                                }}
                                            />
                                        )}
                                    </div>
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
                        initialEditSection={initialVisualizerSection ?? 'common'}
                        visualizerOpacity={visualizerOpacity}
                        staticMode={staticMode}
                        backgroundConfig={{
                            mode: visualizerBackgroundMode,
                            transparent: transparentPlayerBackground,
                            common: {
                                useCoverColorBg,
                                opacity: backgroundOpacity,
                                disableVignette: disableVisualizerVignette,
                                disableGeometricBackground: disableVisualizerGeometricBackground,
                            },
                            customImage: monetBackgroundImage,
                            monet: { tuning: monetBackgroundTuning },
                            nomand: { tuning: nomandBackgroundTuning },
                            latent: { tuning: latentBackgroundTuning },
                            url: {
                                items: urlBackgroundList,
                                selectedId: urlBackgroundSelectedId,
                            },
                        }}
                        backgroundActions={{
                            onModeChange: onVisualizerBackgroundModeChange,
                            common: {
                                onCoverColorChange: onToggleCoverColorBg,
                                onOpacityChange: setBackgroundOpacity,
                                onDisableVignetteChange: onToggleDisableVisualizerVignette,
                                onDisableGeometricChange: onToggleDisableVisualizerGeometricBackground,
                            },
                            customImage: {
                                onUpload: onUploadMonetBackgroundImage,
                                onClear: onClearMonetBackgroundImage,
                                isLoading: isLoadingMonetBackgroundImage,
                            },
                            monet: {
                                onTuningChange: onMonetBackgroundTuningChange,
                                onResetTuning: onResetMonetBackgroundTuning,
                            },
                            nomand: {
                                onTuningChange: onNomandBackgroundTuningChange,
                                onResetTuning: onResetNomandBackgroundTuning,
                            },
                            latent: {
                                onTuningChange: onLatentBackgroundTuningChange,
                                onResetTuning: onResetLatentBackgroundTuning,
                            },
                            url: {
                                onAdd: onAddUrlBackgroundItem,
                                onUpdate: onUpdateUrlBackgroundItem,
                                onDelete: onDeleteUrlBackgroundItem,
                                onSelect: onSetUrlBackgroundSelectedId,
                            },
                        }}
                        hideTranslationSubtitle={hidePlayerTranslationSubtitle}
                        showSubtitleTranslation={showSubtitleTranslation}
                        subtitleContentMode={subtitleContentMode}
                        subtitleOverlayOpacity={subtitleOverlayOpacity}
                        subtitleOverlayBackground={subtitleOverlayBackground}
                        showHarmonySubtitle={showHarmonySubtitle}
                        harmonySubtitleBackground={harmonySubtitleBackground}
                        classicTuning={classicTuning}
                        cadenzaTuning={cadenzaTuning}
                        partitaTuning={partitaTuning}
                        fumeTuning={fumeTuning}
                        claddaghTuning={claddaghTuning}
                        cappellaTuning={cappellaTuning}
                        tiltTuning={tiltTuning}
                        dioramaTuning={dioramaTuning}
                        monetTuning={monetTuning}
                        cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                        cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                        monetPortraitImage={monetPortraitImage}
                        fontStyle={lyricsFontStyle}
                        fontScale={lyricsFontScale}
                        subtitleFontScale={subtitleFontScale}
                        fontWeight={lyricsFontWeight}
                        customFontFamily={lyricsCustomFontFamily}
                        customFontLabel={lyricsCustomFontLabel}
                        fontFallbackFamilies={lyricsFontFallbackFamilies}
                        subtitleFontInheritsLyrics={subtitleFontInheritsLyrics}
                        subtitleFontStyle={subtitleFontStyle}
                        subtitleFontWeight={subtitleFontWeight}
                        subtitleFontFamily={subtitleFontFamily}
                        subtitleFontFallbackFamilies={subtitleFontFallbackFamilies}
                        onFontStyleChange={onLyricsFontStyleChange}
                        onFontScaleChange={onLyricsFontScaleChange}
                        onSubtitleFontScaleChange={onSubtitleFontScaleChange}
                        onFontWeightChange={onLyricsFontWeightChange}
                        onCustomFontChange={onLyricsCustomFontChange}
                        onUploadCustomFont={onLyricsCustomFontUpload}
                        onFontFallbackFamiliesChange={onLyricsFontFallbackFamiliesChange}
                        onSubtitleFontInheritsLyricsChange={onSubtitleFontInheritsLyricsChange}
                        onSubtitleFontStyleChange={onSubtitleFontStyleChange}
                        onSubtitleFontWeightChange={onSubtitleFontWeightChange}
                        onSubtitleFontFamilyChange={onSubtitleFontFamilyChange}
                        onSubtitleFontFallbackFamiliesChange={onSubtitleFontFallbackFamiliesChange}
                        onVisualizerModeChange={onVisualizerModeChange}
                        onVisualizerOpacityChange={setVisualizerOpacity}
                        onToggleHideTranslationSubtitle={onToggleHidePlayerTranslationSubtitle}
                        onToggleShowSubtitleTranslation={onToggleShowSubtitleTranslation}
                        onSubtitleContentModeChange={onSubtitleContentModeChange}
                        onSubtitleOverlayOpacityChange={setSubtitleOverlayOpacity}
                        onToggleSubtitleOverlayBackground={onToggleSubtitleOverlayBackground}
                        onToggleShowHarmonySubtitle={onToggleShowHarmonySubtitle}
                        onToggleHarmonySubtitleBackground={onToggleHarmonySubtitleBackground}
                        onClassicTuningChange={onClassicTuningChange}
                        onResetClassicTuning={onResetClassicTuning}
                        onPartitaTuningChange={onPartitaTuningChange}
                        onResetPartitaTuning={onResetPartitaTuning}
                        onFumeTuningChange={onFumeTuningChange}
                        onResetFumeTuning={onResetFumeTuning}
                        onCladdaghTuningChange={onCladdaghTuningChange}
                        onResetCladdaghTuning={onResetCladdaghTuning}
                        onCappellaTuningChange={onCappellaTuningChange}
                        onResetCappellaTuning={onResetCappellaTuning}
                        onTiltTuningChange={onTiltTuningChange}
                        onResetTiltTuning={onResetTiltTuning}
                        onDioramaTuningChange={onDioramaTuningChange}
                        onResetDioramaTuning={onResetDioramaTuning}
                        onMonetTuningChange={onMonetTuningChange}
                        onResetMonetTuning={onResetMonetTuning}
                        onUploadMonetPortraitImage={onUploadMonetPortraitImage}
                        onClearMonetPortraitImage={onClearMonetPortraitImage}
                        isLoadingMonetPortraitImage={isLoadingMonetPortraitImage}
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
                        visualizerTunings={{
                            classic: classicTuning,
                            cadenza: cadenzaTuning,
                            partita: partitaTuning,
                            fume: fumeTuning,
                            claddagh: claddaghTuning,
                            cappella: cappellaTuning,
                            tilt: tiltTuning,
                            diorama: dioramaTuning,
                            monet: monetTuning,
                        }}
                        staticMode={staticMode}
                        visualizerOpacity={visualizerOpacity}
                        backgroundConfig={{
                            mode: visualizerBackgroundMode,
                            common: {
                                useCoverColorBg,
                                opacity: backgroundOpacity,
                                disableVignette: disableVisualizerVignette,
                                disableGeometricBackground: disableVisualizerGeometricBackground,
                            },
                            customImage: monetBackgroundImage,
                            monet: { tuning: monetBackgroundTuning },
                            nomand: { tuning: nomandBackgroundTuning },
                            latent: { tuning: latentBackgroundTuning },
                            url: {
                                items: urlBackgroundList,
                                selectedId: urlBackgroundSelectedId,
                            },
                        }}
                        cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                        cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                        monetPortraitImage={monetPortraitImage}
                        showSubtitleTranslation={showSubtitleTranslation}
                        subtitleContentMode={subtitleContentMode}
                        lyricsFontStyle={lyricsFontStyle}
                        lyricsFontScale={lyricsFontScale}
                        lyricsFontWeight={lyricsFontWeight}
                        lyricsCustomFontFamily={lyricsCustomFontFamily}
                        onSaveTheme={(dualTheme) => {
                            onSaveCustomTheme(dualTheme);
                            setShowThemePark(false);
                        }}
                        onClose={() => closeSubviewOrModal(() => setShowThemePark(false))}
                    />
                )}
            </AnimatePresence>

            <LyricFilterSettingsModal
                isOpen={showLyricFilterSettings}
                isDaylight={isDaylight}
                currentSongTitle={currentSongTitle}
                initialPattern={lyricFilterPattern}
                loadPreviewLyrics={loadLyricFilterPreview}
                onClose={() => closeSubviewOrModal(() => setShowLyricFilterSettings(false))}
                onSave={onSaveLyricFilterPattern}
            />
            <AiHelpPromptModal
                isOpen={showAiHelpPrompt}
                isDaylight={isDaylight}
                theme={theme}
                onClose={() => setShowAiHelpPrompt(false)}
                onCopyText={copyText}
            />
        </motion.div>
    );
};

export default SettingsModal;
