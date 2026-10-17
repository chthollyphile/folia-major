import React, { useState, useEffect, useMemo, useRef, startTransition } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { MotionValue } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { getCacheUsageByCategory, clearCacheByCategory } from '../../services/db';
import { DualTheme, StageStatus, StageSource, Theme, ThemeMode, type NowPlayingConnectionStatus, type ReplayGainMode } from '../../types';
import { getNavidromeConfig, saveNavidromeConfig, clearNavidromeConfig, hashPassword, navidromeApi, setNavidromeEnabled, getCachedNavidromeServerProfile, refreshNavidromeServerProfile, getNavidromeConfigOrigin, dismissNavidromeServerPreset } from '../../services/navidromeService';
import { fetchNavidromeServerPreset, markNavidromeConfigAsPresetIfMatching, restoreNavidromeServerPreset } from '../../services/navidromeServerPreset';
import { NavidromeConfig, NavidromeServerProfile } from '../../types/navidrome';
import VisPlayground from '../visualizer/window/VisPlayground';
import FontPicker, { type LocalFontEntry } from '../visualizer/window/FontPicker';
import { useVisualizerTunings } from '../visualizer/useVisualizerTunings';
import ThemePark from './ThemePark';
import LyricFilterSettingsModal from './LyricFilterSettingsModal';
import type { LyricFilterDraft } from './LyricFilterSettingsModal';
import GlobalLyricOffsetModal from './settings/GlobalLyricOffsetModal';
import type { PlayerCapConnectionStatus } from '../../types/playerCap';
import { PageHeader } from './settings/kit';
import { SettingsKitThemeContext, settingsTokens } from './settings/kit/kitTheme';
import { kitMotionTokens, useKitReducedMotion } from './settings/kit/motion';
import { parseNumberText } from './settings/kit/numberText';
import { SETTINGS_PAGES, SETTINGS_PAGE_OPTIONS } from './settings/pages';
import HelpPage from './settings/pages/HelpPage';
import { SettingsPageContext, type CacheCategory, type SettingsPageContextValue } from './settings/pages/settingsPageContext';
import { AiHelpPromptModal } from './AiHelpPromptModal';
import ReleaseNotesDialog from './ReleaseNotesDialog';
import meowImageUrl from '../../../build/miao.png';
import type { LyricData } from '../../types';
import { type SettingsModalState, type SettingsSubviewId, type VisualizerSettingsSection } from '../../stores/useSettingsModalStore';
import { SettingsAnchorProvider, useSettingsAnchorList, useSettingsAnchorStore } from './settings/navigation/SettingsAnchorContext';
import SettingsSearchResults from './settings/navigation/SettingsSearchResults';
import SettingsSideList from './settings/navigation/SettingsSideList';
import { settingsAnchorSubview } from './settings/navigation/settingsAnchorModel';
import { buildSettingsNavGroups, findSettingsNavItem, type SettingsSectionId } from './settings/navigation/settingsNavModel';
import { buildSettingsSearchEntries, searchSettings, type SettingsSearchEntry } from './settings/navigation/settingsNavSearch';
import { isSettingsSectionSubview, resolveInitialSettingsSection, sectionForSettingsSubview, writeLastSettingsSection } from './settings/navigation/settingsLastSection';
import { useSettingsLanding, type SettingsLandingTarget } from './settings/navigation/useSettingsLanding';
import { runsOnWindows } from '../../utils/platform';
import { openOutsideLink } from '../../utils/system/outsideLink';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useSettingsScrollSpy } from '../../hooks/useSettingsScrollSpy';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { useShallow } from 'zustand/react/shallow';
import type { ObsBrowserSourceStatus } from '../../types/obsBrowserSource';
import type { LyricApiStatus } from '../../types/lyricApi';
import type { SongResult } from '../../types';
import type { ThemeCacheSongKey } from '../../services/themeCache';
import type { ThemeGenerationSource } from '../../services/themePreferences';
import { selectVisualizerSettingsSnapshot, useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { backgroundTuningConfig } from '../visualizer/tuningRegistry';
import { selectVisualizerAssetSnapshot, useVisualizerAssetStore } from '../../stores/useVisualizerAssetStore';
import { selectLyricSettingsSnapshot, useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { selectTypographySettingsSnapshot, useTypographySettingsStore } from '../../stores/useTypographySettingsStore';
import { selectPlayerChromeSettingsSnapshot, usePlayerChromeSettingsStore } from '../../stores/usePlayerChromeSettingsStore';
import { selectThemeSettingsSnapshot, useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { selectDesktopSettingsSnapshot, useDesktopSettingsStore } from '../../stores/useDesktopSettingsStore';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { setNavidromeEnabledState, useLibraryStore } from '../../stores/useLibraryStore';

const DEFAULT_OPENAI_TEMPERATURE = '0.7';

interface SettingsModalProps {
    onClose: () => void;
    initialTab?: 'help' | 'options';
    initialSubview?: SettingsSubviewId | null;
    initialVisualizerSection?: VisualizerSettingsSection | null;
    /** A section inside the subview to land on, rather than its top. */
    initialAnchor?: SettingsModalState['initialAnchor'];
    theme?: Theme;
    bgMode: ThemeMode;
    onApplyDefaultTheme: () => void;
    hasCustomTheme: boolean;
    themeParkInitialTheme: DualTheme;
    isCustomThemePreferred: boolean;
    songThemeAutoSwitchEnabled: boolean;
    songThemeAutoGenerateEnabled: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onSaveAiTheme: (dualTheme: DualTheme, song: SongResult | null, songKey: ThemeCacheSongKey | null) => void;
    onApplyCustomTheme: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    themeGenerationSource: ThemeGenerationSource;
    onChangeThemeGenerationSource: (source: ThemeGenerationSource) => void;
    onToggleSongThemeAutoGenerate: (enabled: boolean) => void;
    onToggleNavidrome?: (enabled: boolean) => void;
    loadLyricFilterPreview: () => Promise<LyricData | null>;
    currentLyrics: LyricData | null;
    lyricCurrentTime: MotionValue<number>;
    currentSongTitle?: string | null;
    onSaveLyricFilterPattern: (draft: LyricFilterDraft) => Promise<void> | void;
    stageStatus?: StageStatus | null;
    stageSource?: StageSource | null;
    onToggleStageMode?: (enabled: boolean) => Promise<void> | void;
    onStageSourceChange?: (source: StageSource) => Promise<void> | void;
    onRegenerateStageToken?: () => Promise<void> | void;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    playerCapConnectionStatus?: PlayerCapConnectionStatus;
    playerCapPlayers?: string[];
    obsBrowserSourceStatus?: ObsBrowserSourceStatus | null;
    onToggleObsBrowserSource?: (enabled: boolean) => Promise<void> | void;
    onRegenerateObsBrowserSourceToken?: () => Promise<void> | void;
    lyricApiStatus?: LyricApiStatus | null;
    onToggleLyricApi?: (enabled: boolean) => Promise<void> | void;
    onAudioOutputDeviceChange: (deviceId: string) => Promise<boolean> | boolean;
    replayGainMode: ReplayGainMode;
    onReplayGainModeChange: (mode: ReplayGainMode) => void;
    onToggleTransparentPlayerBackground?: (enabled: boolean) => Promise<void> | void;
    aiTheme?: DualTheme | null;
    customTheme?: DualTheme | null;
}

const QUARK_DOWNLOAD_URL = 'https://pan.quark.cn/s/6e4c6fa3bc6f';
const BAIDU_DOWNLOAD_URL = 'https://pan.baidu.com/s/1f0x3g-8PMcNCO-TJ5z1rPw?pwd=flia';
const DEFAULT_UPDATE_CHANNEL: 'realeco' | 'limo' | 'cielo' | 'internal' = __APP_RELEASE_CHANNEL__ === 'limo'
    ? 'limo'
    : __APP_RELEASE_CHANNEL__ === 'cielo'
        ? 'cielo'
        : __APP_RELEASE_CHANNEL__ === 'internal'
            ? 'internal'
            : 'realeco';

// Synchronous on purpose: the first render has to know which sections exist before the isElectron state below settles.
const hasElectronBridge = () => typeof window !== 'undefined' && Boolean((window as any).electron);

const SettingsModal: React.FC<SettingsModalProps> = ({
    onClose,
    initialTab = 'help',
    initialSubview = null,
    initialVisualizerSection = null,
    initialAnchor = null,
    theme,
    bgMode,
    onApplyDefaultTheme,
    hasCustomTheme,
    themeParkInitialTheme,
    isCustomThemePreferred,
    songThemeAutoSwitchEnabled,
    songThemeAutoGenerateEnabled,
    onSaveCustomTheme,
    onSaveAiTheme,
    onApplyCustomTheme,
    onToggleCustomThemePreferred,
    onToggleSongThemeAutoSwitch,
    themeGenerationSource,
    onChangeThemeGenerationSource,
    onToggleSongThemeAutoGenerate,
    onToggleNavidrome,
    loadLyricFilterPreview,
    currentLyrics,
    lyricCurrentTime,
    currentSongTitle,
    onSaveLyricFilterPattern,
    stageStatus = null,
    stageSource = null,
    onToggleStageMode,
    onStageSourceChange,
    onRegenerateStageToken,
    nowPlayingConnectionStatus = 'disabled',
    playerCapConnectionStatus = 'idle',
    playerCapPlayers = [],
    obsBrowserSourceStatus = null,
    onToggleObsBrowserSource,
    onRegenerateObsBrowserSourceToken,
    lyricApiStatus = null,
    onToggleLyricApi,
    onAudioOutputDeviceChange,
    replayGainMode,
    onReplayGainModeChange,
    onToggleTransparentPlayerBackground,
    aiTheme,
    customTheme,
}) => {
    const { t, i18n } = useTranslation();
    // Track the press origin per overlay so nested subview backdrops do not overwrite each other.
    const overlayMouseDownTargetsRef = useRef(new WeakSet<HTMLDivElement>());
    const {
        voiceInputPauseEnabled,
        openPlayerOnLaunch,
        handleToggleVoiceInputPause: onToggleVoiceInputPause,
        handleToggleOpenPlayerOnLaunch: onToggleOpenPlayerOnLaunch,
    } = useDesktopSettingsStore(useShallow(selectDesktopSettingsSnapshot));
    const {
        useCoverColorBg,
        staticMode,
        isDaylight,
        handleToggleCoverColorBg: onToggleCoverColorBg,
    } = useThemeSettingsStore(useShallow(selectThemeSettingsSnapshot));
    const {
        transparentPlayerBackground,
        handleToggleTransparentPlayerBackground: onToggleTransparentPlayerBackgroundFromStore,
    } = usePlayerChromeSettingsStore(useShallow(selectPlayerChromeSettingsSnapshot));
    const {
        lyricsCustomFontFamily,
        lyricsCustomFontLabel,
    } = useTypographySettingsStore(useShallow(selectTypographySettingsSnapshot));
    const {
        hidePlayerTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        showHarmonySubtitle,
        harmonySubtitleBackground,
        lyricsFontStyle,
        lyricsFontScale,
        subtitleFontScale,
        lyricsFontWeight,
        lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
        subtitleFontWeight,
        subtitleFontFamily,
        subtitleFontFallbackFamilies,
        handleToggleHidePlayerTranslationSubtitle: onToggleHidePlayerTranslationSubtitle,
        handleToggleShowSubtitleTranslation: onToggleShowSubtitleTranslation,
        handleSetSubtitleContentMode: onSubtitleContentModeChange,
        handleSetSubtitleOverlayOpacity: setSubtitleOverlayOpacity,
        handleToggleSubtitleOverlayBackground: onToggleSubtitleOverlayBackground,
        handleToggleSubtitleUpcomingLyricsBlur: onToggleSubtitleUpcomingLyricsBlur,
        handleToggleShowHarmonySubtitle: onToggleShowHarmonySubtitle,
        handleToggleHarmonySubtitleBackground: onToggleHarmonySubtitleBackground,
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
    } = useTypographySettingsStore(useShallow(selectTypographySettingsSnapshot));
    const {
        lyricFilterPattern,
        lyricFilterEnabled,
        lyricStaffPolicy,
        lyricStaffMinDwellSeconds,
        lyricStaffAbsorbMode,
        lyricStaffPattern,
    } = useLyricSettingsStore(useShallow(selectLyricSettingsSnapshot));
    const {
        handleToggleDisableVisualizerVignette: onToggleDisableVisualizerVignette,
        handleToggleDisableVisualizerGeometricBackground: onToggleDisableVisualizerGeometricBackground,
        handleSetBackgroundOpacity: setBackgroundOpacity,
        handleSetVisualizerOpacity: setVisualizerOpacity,
        handleSetVisualizerBackgroundMode: onVisualizerBackgroundModeChange,
        handleSetVisualizerMode: onVisualizerModeChange,
        handleUploadMonetBackgroundImage: onUploadMonetBackgroundImage,
        handleClearMonetBackgroundImage: onClearMonetBackgroundImage,
        handleAddUrlBackgroundItem: onAddUrlBackgroundItem,
        handleUpdateUrlBackgroundItem: onUpdateUrlBackgroundItem,
        handleDeleteUrlBackgroundItem: onDeleteUrlBackgroundItem,
        handleSetUrlBackgroundSelectedId: onSetUrlBackgroundSelectedId,
    } = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));
    const {
        disableVisualizerVignette,
        disableVisualizerGeometricBackground,
        backgroundOpacity,
        visualizerOpacity,
        visualizerBackgroundMode,
        visualizerMode,
        urlBackgroundList,
        urlBackgroundSelectedId,
    } = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));
    // The store's fields as one object: the backgrounds' tunings are taken from it by their declarations.
    const visualizerSettings = useVisualizerSettingsStore(useShallow(selectVisualizerSettingsSnapshot));
    const visualizerTunings = useVisualizerTunings();
    const {
        cappellaCustomEmojiImages,
        cappellaCustomAvatarImages,
        monetBackgroundImage,
        isLoadingMonetBackgroundImage,
        monetPortraitImage,
    } = useVisualizerAssetStore(useShallow(selectVisualizerAssetSnapshot));
    const resolvedToggleTransparentPlayerBackground = onToggleTransparentPlayerBackground ?? onToggleTransparentPlayerBackgroundFromStore;
    const setIsSubSettingsViewOpen = useSettingsModalStore(state => state.setIsSubSettingsViewOpen);
    // Help is a page of the same window, reached from the foot of the side list.
    const [activeTab, setActiveTab] = useState<'help' | 'options'>(initialTab);
    // A bare open (no subview, no anchor) restores the last section the user entered; any named target wins.
    const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>(() => resolveInitialSettingsSection({
        initialSubview,
        hasInitialAnchor: initialAnchor !== null,
        isElectron: hasElectronBridge(),
    }));
    const [searchQuery, setSearchQuery] = useState('');
    const isSearching = searchQuery.trim() !== '';
    // The group or row the dialog is asked to land on, from outside (a command, a link) or a search hit.
    const [landingTarget, setLandingTarget] = useState<SettingsLandingTarget | null>(null);
    const landingSeqRef = useRef(0);
    const landOn = (id: string, groupId?: string) => {
        landingSeqRef.current += 1;
        setLandingTarget({ id, groupId, seq: landingSeqRef.current });
    };
    const handleSelectSettingsSection = (section: SettingsSectionId) => {
        setActiveTab('options');
        setSearchQuery('');
        setLandingTarget(null);
        setActiveSettingsSection(section);
        writeLastSettingsSection(section, { isElectron: hasElectronBridge() });
    };
    const handleSelectHelp = () => {
        setActiveTab('help');
        setSearchQuery('');
        setLandingTarget(null);
    };
    const handleSearchQueryChange = (query: string) => {
        setSearchQuery(query);
        setLandingTarget(null);
    };
    const handleSelectSearchHit = (hit: SettingsSearchEntry) => {
        handleSelectSettingsSection(hit.sectionId);
        if (hit.targetId) {
            landOn(hit.targetId, hit.groupId);
        }
    };
    const contentScrollRef = useRef<HTMLDivElement>(null);
    // Matches the md: split of the window: under it the side list is a strip that scrolls sideways.
    const isWideSettingsLayout = useMediaQuery('(min-width: 768px)');
    const settingsAnchorStore = useSettingsAnchorStore();
    const settingsAnchors = useSettingsAnchorList(settingsAnchorStore);

    const [showVisPlayground, setShowVisPlayground] = useState(false);
    const [showLyricsFontPicker, setShowLyricsFontPicker] = useState(false);
    const [showThemePark, setShowThemePark] = useState(false);
    const [showLyricFilterSettings, setShowLyricFilterSettings] = useState(false);
    const [showGlobalLyricOffset, setShowGlobalLyricOffset] = useState(false);
    const [showAiHelpPrompt, setShowAiHelpPrompt] = useState(false);
    const [showReleaseNotes, setShowReleaseNotes] = useState(false);
    const [, setAuthorClickCount] = useState(0);
    const [meowEasterEgg, setMeowEasterEgg] = useState<{ id: number; } | null>(null);
    const shouldCloseModalOnSubviewBack = initialSubview !== null;

    useEffect(() => {
        setActiveTab(initialTab);
        setShowVisPlayground(initialSubview === 'visualizer');
        setShowThemePark(initialSubview === 'themePark');
        setShowLyricFilterSettings(initialSubview === 'lyricFilter');
        setShowGlobalLyricOffset(initialSubview === 'globalLyricOffset');

        const targetSection = sectionForSettingsSubview(initialSubview);
        if (targetSection) {
            // 这两个是播放页歌词区里的二级面板，关掉后应该落回它们的入口所在分区。
            setActiveSettingsSection(targetSection);
            // 只有真正进入某个分区页才记忆；二级面板和调参台不算「进入」分区。
            if (isSettingsSectionSubview(initialSubview)) {
                writeLastSettingsSection(targetSection, { isElectron: hasElectronBridge() });
            }
        } else {
            setActiveSettingsSection(prev => prev || 'appearance');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialSubview, initialTab]);

    // A request for one place in the settings: show the page settingsAnchorModel puts it on, then
    // land on it. Each request has its own seq, so naming the same place again lands again.
    useEffect(() => {
        if (!initialAnchor) {
            return;
        }
        const section = sectionForSettingsSubview(settingsAnchorSubview(initialAnchor.id));
        if (section) {
            setActiveSettingsSection(section);
        }
        setActiveTab('options');
        setSearchQuery('');
        // A request may name one row of the section; the section is where it lands while that row is not drawn.
        landOn(initialAnchor.rowId ?? initialAnchor.id, initialAnchor.id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialAnchor]);

    // Cache State
    const [cacheSizes, setCacheSizes] = useState({
        playlist: '0 B',
        lyrics: '0 B',
        cover: '0 B',
        media: '0 B',
        analysis: '0 B'
    });
    const [mediaCount, setMediaCount] = useState(0);
    const [isCleaning, setIsCleaning] = useState<CacheCategory | null>(null);

    // Electron Settings State
    // Seeded synchronously so a remembered desktop/mods section has its title on the first frame; the effect below still confirms it.
    const [isElectron, setIsElectron] = useState(hasElectronBridge);
    const [electronSettings, setElectronSettings] = useState({
        GEMINI_API_KEY: '',
        OPENAI_API_KEY: '',
        OPENAI_API_URL: '',
        OPENAI_API_MODEL: '',
        OPENAI_API_TEMPERATURE: DEFAULT_OPENAI_TEMPERATURE,
        OPENAI_API_STREAM: false,
        AI_PROVIDER: 'gemini',
        USE_SYSTEM_PROXY_FOR_AI: false,
        ENABLE_UPDATE_CHECK: true,
        ENABLE_AUTO_UPDATE: false,
        UPDATE_CHANNEL: DEFAULT_UPDATE_CHANNEL,
        STAGE_MODE_SOURCE: 'stage-api',
        DISCORD_RICH_PRESENCE_ENABLED: false,
    });
    const [electronSettingsLoaded, setElectronSettingsLoaded] = useState(false);
    // Keys stay in the main process; the renderer only knows which ones are saved, and the endpoint
    // the OpenAI-compatible key is bound to. The GEMINI_API_KEY / OPENAI_API_KEY fields in
    // electronSettings are drafts of a replacement key.
    const [savedElectronAiCredentials, setSavedElectronAiCredentials] = useState({
        AI_PROVIDER: 'gemini',
        GEMINI_API_KEY: false,
        OPENAI_API_KEY: false,
        OPENAI_API_KEY_ENDPOINT: null as string | null,
    });
    const [electronSaveStatus, setElectronSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [updateStatus, setUpdateStatus] = useState<ElectronUpdateStatus | null>(null);
    const [discordPresenceStatus, setDiscordPresenceStatus] = useState<ElectronDiscordPresenceStatus | null>(null);
    const [cacheDirectory, setCacheDirectory] = useState<string>('');
    const [cacheDirectoryIsDefault, setCacheDirectoryIsDefault] = useState(true);
    const [cacheDirectoryStatus, setCacheDirectoryStatus] = useState<'idle' | 'choosing'>('idle');
    const isElectronRuntime = typeof window !== 'undefined' && Boolean(window.electron);
    const savedAiApiKey = savedElectronAiCredentials.AI_PROVIDER === 'openai'
        ? savedElectronAiCredentials.OPENAI_API_KEY
        : savedElectronAiCredentials.GEMINI_API_KEY;
    const aiApiKeyStatus: 'loading' | 'configured' | 'missing' = !isElectronRuntime
        ? 'configured'
        : !electronSettingsLoaded
            ? 'loading'
            : savedAiApiKey
                ? 'configured'
                : 'missing';

    useEffect(() => {
        if (aiApiKeyStatus === 'missing' && themeGenerationSource === 'ai') {
            onChangeThemeGenerationSource('cover');
        }
    }, [aiApiKeyStatus, onChangeThemeGenerationSource, themeGenerationSource]);

    // The four answers land while the window is still opening, and each one alone rendered the whole
    // window again. Read together and applied as one transition, they render it once, between frames.
    // Together also because the key's status is read from the settings and their "loaded" at once.
    useEffect(() => {
        const electron = (window as any).electron;
        if (!electron) {
            return;
        }
        setIsElectron(true);
        void Promise.allSettled([
            electron.getSettings(),
            electron.getCacheDirectory(),
            electron.getUpdateStatus?.(),
            electron.getDiscordPresenceStatus?.(),
        ]).then(([settingsAnswer, cacheDirectoryAnswer, updateAnswer, discordAnswer]) => {
            const settings = settingsAnswer.status === 'fulfilled' ? settingsAnswer.value : null;
            const cacheDirectoryResult: ElectronCacheDirectoryResult | null = cacheDirectoryAnswer.status === 'fulfilled' ? cacheDirectoryAnswer.value : null;
            startTransition(() => {
                if (settings) {
                    const { AI_API_KEYS_CONFIGURED: configuredKeys, OPENAI_API_KEY_ENDPOINT: openaiKeyEndpoint, ...rest } = settings;
                    setElectronSettings(prev => ({
                        ...prev,
                        ...rest,
                        OPENAI_API_TEMPERATURE: String(rest.OPENAI_API_TEMPERATURE ?? '').trim() || DEFAULT_OPENAI_TEMPERATURE,
                    }));
                    setSavedElectronAiCredentials({
                        AI_PROVIDER: settings.AI_PROVIDER === 'openai' ? 'openai' : 'gemini',
                        GEMINI_API_KEY: configuredKeys?.GEMINI_API_KEY === true,
                        OPENAI_API_KEY: configuredKeys?.OPENAI_API_KEY === true,
                        OPENAI_API_KEY_ENDPOINT: typeof openaiKeyEndpoint === 'string' ? openaiKeyEndpoint : null,
                    });
                }
                setElectronSettingsLoaded(true);
                if (cacheDirectoryResult?.path) {
                    setCacheDirectory(cacheDirectoryResult.path);
                    setCacheDirectoryIsDefault(cacheDirectoryResult.isDefault);
                }
                if (electron.getUpdateStatus && updateAnswer.status === 'fulfilled') {
                    setUpdateStatus(updateAnswer.value as ElectronUpdateStatus);
                }
                if (electron.getDiscordPresenceStatus && discordAnswer.status === 'fulfilled') {
                    setDiscordPresenceStatus(discordAnswer.value as ElectronDiscordPresenceStatus);
                }
            });
        });
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
            // What is saved is the number that was typed, so "0,7" is kept as 0.7 and the main process
            // reads it as that; anything that is not a number from 0 to 2 falls back to the default.
            const configuredTemperature = parseNumberText(electronSettings.OPENAI_API_TEMPERATURE);
            const temperature = configuredTemperature !== null && configuredTemperature >= 0 && configuredTemperature <= 2
                ? String(configuredTemperature)
                : DEFAULT_OPENAI_TEMPERATURE;
            setElectronSaveStatus('saving');
            setElectronSettings(prev => ({ ...prev, OPENAI_API_TEMPERATURE: temperature }));
            // Only a newly typed key is sent; an empty field keeps the saved one (clearing is its own action).
            const geminiKeyDraft = electronSettings.GEMINI_API_KEY.trim();
            const openaiKeyDraft = electronSettings.OPENAI_API_KEY.trim();
            if (geminiKeyDraft) {
                await (window as any).electron.saveSettings('GEMINI_API_KEY', geminiKeyDraft);
            }
            // URL before key: a new OpenAI-compatible key is bound to the URL saved at that moment.
            await (window as any).electron.saveSettings('OPENAI_API_URL', electronSettings.OPENAI_API_URL);
            if (openaiKeyDraft) {
                await (window as any).electron.saveSettings('OPENAI_API_KEY', openaiKeyDraft);
            }
            await (window as any).electron.saveSettings('OPENAI_API_MODEL', electronSettings.OPENAI_API_MODEL);
            await (window as any).electron.saveSettings('OPENAI_API_TEMPERATURE', temperature);
            await (window as any).electron.saveSettings('OPENAI_API_STREAM', electronSettings.OPENAI_API_STREAM === true);
            await (window as any).electron.saveSettings('AI_PROVIDER', electronSettings.AI_PROVIDER);
            await (window as any).electron.saveSettings('USE_SYSTEM_PROXY_FOR_AI', electronSettings.USE_SYSTEM_PROXY_FOR_AI);
            await (window as any).electron.saveSettings('ENABLE_UPDATE_CHECK', electronSettings.ENABLE_UPDATE_CHECK);
            await (window as any).electron.saveSettings('ENABLE_AUTO_UPDATE', electronSettings.ENABLE_AUTO_UPDATE);
            await (window as any).electron.saveSettings('UPDATE_CHANNEL', electronSettings.UPDATE_CHANNEL);
            const savedSettings = await (window as any).electron.saveSettings('DISCORD_RICH_PRESENCE_ENABLED', electronSettings.DISCORD_RICH_PRESENCE_ENABLED);
            const configuredKeys = savedSettings?.AI_API_KEYS_CONFIGURED;
            setSavedElectronAiCredentials({
                AI_PROVIDER: electronSettings.AI_PROVIDER === 'openai' ? 'openai' : 'gemini',
                GEMINI_API_KEY: configuredKeys?.GEMINI_API_KEY === true,
                OPENAI_API_KEY: configuredKeys?.OPENAI_API_KEY === true,
                OPENAI_API_KEY_ENDPOINT: typeof savedSettings?.OPENAI_API_KEY_ENDPOINT === 'string'
                    ? savedSettings.OPENAI_API_KEY_ENDPOINT
                    : null,
            });
            // Drop the saved drafts so the field goes back to the "saved" placeholder; keep anything typed meanwhile.
            setElectronSettings(prev => ({
                ...prev,
                GEMINI_API_KEY: prev.GEMINI_API_KEY.trim() === geminiKeyDraft ? '' : prev.GEMINI_API_KEY,
                OPENAI_API_KEY: prev.OPENAI_API_KEY.trim() === openaiKeyDraft ? '' : prev.OPENAI_API_KEY,
            }));
            setElectronSaveStatus('saved');
            setTimeout(() => setElectronSaveStatus('idle'), 2000);
        }
    };

    const handleClearAiApiKey = async (key: 'GEMINI_API_KEY' | 'OPENAI_API_KEY') => {
        if (!window.electron?.saveSettings) {
            return;
        }
        const settings = await window.electron.saveSettings(key, '');
        setSavedElectronAiCredentials(prev => ({
            ...prev,
            [key]: settings?.AI_API_KEYS_CONFIGURED?.[key] === true,
            OPENAI_API_KEY_ENDPOINT: typeof settings?.OPENAI_API_KEY_ENDPOINT === 'string' ? settings.OPENAI_API_KEY_ENDPOINT : null,
        }));
        setElectronSettings(prev => ({ ...prev, [key]: '' }));
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
        if (!window.electron?.saveSettings || !electronSettings.ENABLE_UPDATE_CHECK || !updateStatus?.autoUpdateSupported) {
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

    const handleOpenChinaDownload = () => openOutsideLink(QUARK_DOWNLOAD_URL);
    const handleOpenBaiduDownload = () => openOutsideLink(BAIDU_DOWNLOAD_URL);

    // Navidrome Settings State
    // One truth: this used to be a second copy kept in step with App.tsx's by hand.
    const navidromeEnabled = useLibraryStore(state => state.navidromeEnabled);
    const [navidromeUrl, setNavidromeUrl] = useState('');
    const [navidromeUsername, setNavidromeUsername] = useState('');
    const [navidromePassword, setNavidromePassword] = useState('');
    const [navidromeTestStatus, setNavidromeTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
    const [navidromeConfigured, setNavidromeConfigured] = useState(false);
    const [navidromeServerProfile, setNavidromeServerProfile] = useState<NavidromeServerProfile | null>(null);
    // Docker 部署预置了凭据时，手动配置可以随时切回预置。
    const [navidromePresetAvailable, setNavidromePresetAvailable] = useState(false);
    const [navidromeUsesPreset, setNavidromeUsesPreset] = useState(false);
    const [navidromeRestoreFailed, setNavidromeRestoreFailed] = useState(false);
    const [navidromeRestoring, setNavidromeRestoring] = useState(false);

    // Load Navidrome config on mount
    useEffect(() => {
        const config = getNavidromeConfig();
        if (config) {
            setNavidromeUrl(config.serverUrl);
            setNavidromeUsername(config.username);
            setNavidromeConfigured(true);
            setNavidromeServerProfile(getCachedNavidromeServerProfile());
            setNavidromeUsesPreset(getNavidromeConfigOrigin() === 'server');
        }

        let cancelled = false;
        void fetchNavidromeServerPreset().then((preset) => {
            if (!cancelled) setNavidromePresetAvailable(Boolean(preset));
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const refreshServerProfile = (config: NavidromeConfig) => {
        void refreshNavidromeServerProfile(config)
            .then(setNavidromeServerProfile)
            .catch((error) => {
                console.warn('[Settings] Failed to refresh Navidrome server profile:', error);
                setNavidromeServerProfile(null);
            });
    };

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
            // 先按手动配置立刻存下，不让预置请求挡住保存；填的正好是预置的话，预置返回后再改标。
            saveNavidromeConfig(config);
            setNavidromeConfigured(true);
            setNavidromeUsesPreset(false);
            setNavidromeTestStatus('success');
            refreshServerProfile(config);
            void markNavidromeConfigAsPresetIfMatching(config).then((marked) => {
                if (marked) setNavidromeUsesPreset(true);
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
        dismissNavidromeServerPreset();
        setNavidromeUrl('');
        setNavidromeUsername('');
        setNavidromePassword('');
        setNavidromeConfigured(false);
        setNavidromeUsesPreset(false);
        setNavidromeServerProfile(null);
        setNavidromeTestStatus('idle');
    };

    // Drop the manual config and go back to the Docker preset
    const handleRestoreNavidromePreset = async () => {
        if (navidromeRestoring) return;
        setNavidromeRestoreFailed(false);
        setNavidromeRestoring(true);
        const config = await restoreNavidromeServerPreset().finally(() => setNavidromeRestoring(false));
        if (!config) {
            setNavidromeRestoreFailed(true);
            return;
        }
        setNavidromeUrl(config.serverUrl);
        setNavidromeUsername(config.username);
        setNavidromePassword('');
        setNavidromeConfigured(true);
        setNavidromeUsesPreset(true);
        setNavidromeTestStatus('idle');
        setNavidromeServerProfile(getCachedNavidromeServerProfile());
        refreshServerProfile(config);
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const applyCacheUsage = (usage: Awaited<ReturnType<typeof getCacheUsageByCategory>>) => {
        setCacheSizes({
            playlist: formatBytes(usage.playlist),
            lyrics: formatBytes(usage.lyrics),
            cover: formatBytes(usage.cover),
            media: formatBytes(usage.media),
            analysis: formatBytes(usage.analysis)
        });
        setMediaCount(usage.mediaCount);
    };

    const fetchCacheUsage = async () => {
        applyCacheUsage(await getCacheUsageByCategory());
    };

    useEffect(() => {
        if (activeTab === 'options') {
            // Like the answers above, it lands while the window is opening.
            void getCacheUsageByCategory().then(usage => startTransition(() => applyCacheUsage(usage)));
        }
    }, [activeTab]);

    const handleClear = async (category: CacheCategory) => {
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
    const overlayBackground = isDaylight ? 'rgba(0,0,0,0.32)' : 'rgba(0,0,0,0.5)';
    const shellTransition = { duration: 0.24, ease: 'easeOut' as const };
    // The move is one transform rather than y and scale. motion hands opacity and transform to the
    // browser's compositor but steps y and scale itself on the page's frames, so when the page was
    // busy while the window opened (opening on the options tab counts the cache, a 125-175 ms task
    // on a used install), the window faded in standing still and then jumped into place. The rest
    // value is written out: motion reads a 'none' target as the start with every number set to 0,
    // which is scale(0).
    const panelMotion = {
        initial: { opacity: 0, transform: 'translateY(20px) scale(0.98)' },
        animate: { opacity: 1, transform: 'translateY(0px) scale(1)' },
        exit: { opacity: 0, transform: 'translateY(16px) scale(0.985)' },
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
        || showGlobalLyricOffset
        || showAiHelpPrompt
        || showReleaseNotes;

    // Escape reaches this window only with none of its four dialogs open: they are sheets, and an
    // open sheet takes the key on the document and stops it (shared/Sheet.tsx). A menu or a pick
    // list that is open takes the key before this window hears it as well. The two work windows
    // leave Escape to their owner, so they are what it can find open here.
    const isWorkWindowOpen = showVisPlayground || showThemePark;

    const closeWorkWindows = () => {
        if (shouldCloseModalOnSubviewBack) {
            onClose();
            return;
        }
        setShowVisPlayground(false);
        setShowThemePark(false);
    };

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Not a held key: the first press may have closed a dialog over this window.
            if (event.key === 'Escape' && !event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                if (isWorkWindowOpen) {
                    closeWorkWindows();
                } else {
                    onClose();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isWorkWindowOpen, shouldCloseModalOnSubviewBack, onClose]);

    useEffect(() => {
        setIsSubSettingsViewOpen(isAnySubviewOpen);

        return () => {
            setIsSubSettingsViewOpen(false);
        };
    }, [isAnySubviewOpen, setIsSubSettingsViewOpen]);

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
    const canDownloadUpdate = Boolean(
        electronSettings.ENABLE_UPDATE_CHECK &&
        updateStatus?.autoUpdateSupported &&
        updateStatus?.availableVersion &&
        updateStatus.status !== 'downloading' &&
        updateStatus.status !== 'downloaded'
    );
    const canEnableAutoUpdate = Boolean(electronSettings.ENABLE_UPDATE_CHECK && updateStatus?.autoUpdateSupported);

    const settingsNavGroups = useMemo(
        () => buildSettingsNavGroups(t, { isElectron }),
        [t, isElectron],
    );
    const activeSettingsNavItem = findSettingsNavItem(settingsNavGroups, activeSettingsSection);
    // A category this build does not list (a desktop-only one on web) has no page to show.
    const ActivePage = activeSettingsNavItem ? SETTINGS_PAGES[activeSettingsSection] : null;
    const searchEntries = useMemo(
        () => buildSettingsSearchEntries(settingsNavGroups, SETTINGS_PAGE_OPTIONS, t, { isElectron }),
        [settingsNavGroups, t, isElectron],
    );
    const searchHits = useMemo(
        () => searchSettings(searchEntries, searchQuery, i18n.language),
        [searchEntries, searchQuery, i18n.language],
    );
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);
    const prefersReducedMotion = useReducedMotionFor('settingsScroll');
    const reducedKitMotion = useKitReducedMotion();
    const { activeAnchorId, scrollToAnchor } = useSettingsScrollSpy({
        containerRef: contentScrollRef,
        anchors: settingsAnchors,
        enabled: activeTab === 'options' && !isSearching,
        reducedMotion: prefersReducedMotion,
    });

    // Switching page swaps the whole column; keeping the old offset would land mid-content and
    // leave the contents line marking a group that is no longer on screen.
    useEffect(() => {
        if (contentScrollRef.current) {
            contentScrollRef.current.scrollTop = 0;
        }
    }, [activeSettingsSection, activeTab, isSearching]);

    // It runs after the reset above on purpose — that reset fires on the same commit the page
    // changes on, and a scrollTop write would abort the smooth scroll a landing starts.
    const landOnGroup = useSettingsLanding(landingTarget, contentScrollRef, settingsAnchors, scrollToAnchor, prefersReducedMotion);

    const pageContext: SettingsPageContextValue = {
        isElectron,
        themeControls: {
            bgMode,
            hasCustomTheme,
            isCustomThemePreferred,
            songThemeAutoSwitchEnabled,
            songThemeAutoGenerateEnabled,
            themeGenerationSource,
            aiApiKeyStatus,
            onApplyDefaultTheme,
            onApplyCustomTheme,
            onToggleCustomThemePreferred,
            onToggleSongThemeAutoSwitch,
            onToggleSongThemeAutoGenerate,
            onChangeThemeGenerationSource,
        },
        onOpenVisPlayground: () => setShowVisPlayground(true),
        onOpenLyricsFontPicker: () => setShowLyricsFontPicker(true),
        onOpenThemePark: () => setShowThemePark(true),
        onToggleTransparentPlayerBackground: resolvedToggleTransparentPlayerBackground,
        viewProps: {
            appearance: {
                bgMode,
                isCustomThemePreferred,
                onApplyCustomTheme,
                onToggleSongThemeAutoGenerate,
                onToggleSongThemeAutoSwitch,
                onChangeThemeGenerationSource,
                onSaveCustomTheme,
                songThemeAutoSwitchEnabled,
                songThemeAutoGenerateEnabled,
                aiTheme,
                customTheme,
            },
            playback: {
                onAudioOutputDeviceChange,
                onOpenGlobalLyricOffsetSettings: () => setShowGlobalLyricOffset(true),
                onOpenLyricFilterSettings: () => setShowLyricFilterSettings(true),
                replayGainMode,
                onReplayGainModeChange,
            },
            integration: {
                navidrome: {
                    navidromeConfigured,
                    navidromeEnabled,
                    navidromePassword,
                    navidromeServerProfile,
                    navidromeTestStatus,
                    navidromeUrl,
                    navidromeUsername,
                    navidromeCanRestorePreset: navidromePresetAvailable && !navidromeUsesPreset,
                    navidromeRestoreFailed,
                    navidromeRestoring,
                    navidromeUsesPreset,
                    onRestoreNavidromePreset: handleRestoreNavidromePreset,
                    onClearNavidrome: handleClearNavidrome,
                    onToggleNavidrome: handleToggleNavidromeEnabled,
                    setNavidromePassword,
                    setNavidromeUrl,
                    setNavidromeUsername,
                    testNavidromeConnection,
                },
                discord: {
                    enabled: electronSettings.DISCORD_RICH_PRESENCE_ENABLED,
                    onToggle: handleToggleDiscordPresence,
                    status: discordPresenceStatus,
                },
                lyricApi: {
                    status: lyricApiStatus,
                    onToggle: onToggleLyricApi,
                },
                stage: {
                    nowPlayingConnectionStatus,
                    playerCapConnectionStatus,
                    playerCapPlayers,
                    obsBrowserSourceStatus,
                    onRegenerateObsBrowserSourceToken,
                    onRegenerateStageToken,
                    onStageSourceChange,
                    onToggleObsBrowserSource,
                    onToggleStageMode,
                    stageSource,
                    stageStatus,
                },
            },
            storage: {
                cacheDirectory,
                cacheDirectoryIsDefault,
                cacheDirectoryStatus,
                cacheSizes,
                isCleaning,
                mediaCount,
                onChooseCacheDirectory: handleChooseCacheDirectory,
                onClear: handleClear,
            },
            desktop: {
                model: {
                    canDownloadUpdate,
                    canEnableAutoUpdate,
                    electronSaveStatus,
                    electronSettings,
                    onCheckForUpdates: handleCheckForUpdates,
                    onClearAiApiKey: handleClearAiApiKey,
                    onDownloadUpdate: handleDownloadUpdate,
                    onInstallUpdate: handleInstallUpdate,
                    onOpenBaiduDownload: handleOpenBaiduDownload,
                    onOpenChinaDownload: handleOpenChinaDownload,
                    onUpdateChannelChange: handleUpdateChannelChange,
                    onSaveElectronSettings: saveElectronSettings,
                    onToggleAutoUpdate: handleToggleAutoUpdate,
                    onToggleUpdateCheck: handleToggleUpdateCheck,
                    savedAiApiKeys: {
                        GEMINI_API_KEY: savedElectronAiCredentials.GEMINI_API_KEY,
                        OPENAI_API_KEY: savedElectronAiCredentials.OPENAI_API_KEY,
                    },
                    savedOpenAIKeyEndpoint: savedElectronAiCredentials.OPENAI_API_KEY_ENDPOINT,
                    setElectronSettings,
                    updateBadgeLabel,
                    updateStatus,
                },
                preferences: {
                    onToggleOpenPlayerOnLaunch,
                    openPlayerOnLaunch,
                },
            },
            lab: {
                voiceInputPause: {
                    enabled: voiceInputPauseEnabled,
                    supported: isElectron && runsOnWindows(),
                    onToggle: () => onToggleVoiceInputPause(!voiceInputPauseEnabled),
                },
            },
        },
    };


    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={shellTransition}
            data-folia-keyboard-window="true"
            data-ponder-page-scope={activeTab === 'help' ? 'help-page' : 'settings-page'}
            className="fixed inset-0 z-[100] flex items-center justify-center px-4 py-8 sm:px-5 sm:py-12"
            style={{ backgroundColor: overlayBackground }}
            onMouseDown={handleOverlayMouseDown}
            onClick={(event) => handleBackdropClose(event, onClose)}
        >
            <motion.div
                {...panelMotion}
                transition={shellTransition}
                role="dialog"
                aria-modal="true"
                aria-label={t('options.settingsWindowName')}
                className="st-window relative flex h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-[var(--st-win)] text-[color:var(--st-t1)] shadow-[0_36px_90px_rgba(0,0,0,0.5),0_0_0_1px_var(--st-line2)] md:grid md:h-[86vh] md:w-[960px] md:grid-cols-[212px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
                style={{ ...settingsTokens(isDaylight, theme), ...kitMotionTokens(reducedKitMotion) }}
                onClick={(event) => event.stopPropagation()}
            >
                <SettingsKitThemeContext.Provider value={kitTheme}>
                    <SettingsSideList
                        groups={settingsNavGroups}
                        activeId={isSearching ? null : activeTab === 'help' ? 'help' : activeSettingsSection}
                        onSelectSection={handleSelectSettingsSection}
                        onSelectHelp={handleSelectHelp}
                        query={searchQuery}
                        onQueryChange={handleSearchQueryChange}
                        onSubmitQuery={() => {
                            if (searchHits.length > 0) handleSelectSearchHit(searchHits[0]);
                        }}
                        isWide={isWideSettingsLayout}
                    />
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                        <PageHeader
                            title={isSearching
                                ? t('options.settingsSearchTitle')
                                : activeTab === 'help' ? t('help.title') : activeSettingsNavItem?.label ?? ''}
                            contents={settingsAnchors}
                            activeId={activeAnchorId}
                            onSelect={landOnGroup}
                            summary={isSearching
                                ? (searchHits.length > 0 ? t('options.settingsSearchCount', { n: searchHits.length }) : t('options.settingsSearchEmpty'))
                                : undefined}
                            closeLabel={t('ui.close')}
                            onClose={onClose}
                        />
                        <div
                            ref={contentScrollRef}
                            className="relative min-h-0 flex-1 overflow-y-auto px-4 pb-12 md:px-8 md:pb-16 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-4 [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:bg-[var(--st-fill2)] [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-3"
                        >
                            {isSearching ? (
                                <SettingsSearchResults hits={searchHits} onSelect={handleSelectSearchHit} />
                            ) : activeTab === 'help' ? (
                                <SettingsPageContext.Provider value={pageContext}>
                                    <div className="st-page-in">
                                        <HelpPage
                                            onOpenReleaseNotes={() => setShowReleaseNotes(true)}
                                            onOpenAiHelp={() => setShowAiHelpPrompt(true)}
                                            onProjectLabelClick={handleAuthorLabelClick}
                                        />
                                    </div>
                                </SettingsPageContext.Provider>
                            ) : ActivePage ? (
                                <SettingsAnchorProvider store={settingsAnchorStore} section={activeSettingsSection}>
                                    <SettingsPageContext.Provider value={pageContext}>
                                        {/* Keyed by the category, so each page comes in with the kit's motion. */}
                                        <div key={activeSettingsSection} className="st-page-in">
                                            <ActivePage />
                                        </div>
                                    </SettingsPageContext.Provider>
                                </SettingsAnchorProvider>
                            ) : null}
                        </div>
                    </div>
                </SettingsKitThemeContext.Provider>

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
                        initialEditSection={initialVisualizerSection ?? 'visualizer'}
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
                            ...backgroundTuningConfig(visualizerSettings),
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
                        subtitleUpcomingLyricsBlur={subtitleUpcomingLyricsBlur}
                        showHarmonySubtitle={showHarmonySubtitle}
                        harmonySubtitleBackground={harmonySubtitleBackground}
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
                        onToggleSubtitleUpcomingLyricsBlur={onToggleSubtitleUpcomingLyricsBlur}
                        onToggleShowHarmonySubtitle={onToggleShowHarmonySubtitle}
                        onToggleHarmonySubtitleBackground={onToggleHarmonySubtitleBackground}
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
                        visualizerTunings={visualizerTunings}
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
                            ...backgroundTuningConfig(visualizerSettings),
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
                        onSaveCustomTheme={(dualTheme) => {
                            onSaveCustomTheme(dualTheme);
                            setShowThemePark(false);
                        }}
                        onSaveAiTheme={(dualTheme, song, songKey) => {
                            onSaveAiTheme(dualTheme, song, songKey);
                            setShowThemePark(false);
                        }}
                        onClose={() => closeSubviewOrModal(() => setShowThemePark(false))}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence>
                {showLyricsFontPicker && (
                    <FontPicker
                        family={lyricsCustomFontFamily}
                        label={lyricsCustomFontLabel ?? ''}
                        fallbackFamilies={lyricsFontFallbackFamilies}
                        onFallbackFamiliesChange={onLyricsFontFallbackFamiliesChange}
                        fontStyle={lyricsFontStyle}
                        onChoose={(font: LocalFontEntry) => {
                            onLyricsCustomFontChange({
                                source: 'system',
                                family: font.family,
                                label: font.label,
                            });
                            setShowLyricsFontPicker(false);
                        }}
                        onClear={() => {
                            onLyricsCustomFontChange(null);
                            setShowLyricsFontPicker(false);
                        }}
                        onUpload={onLyricsCustomFontUpload}
                        onClose={() => setShowLyricsFontPicker(false)}
                    />
                )}
            </AnimatePresence>

            <LyricFilterSettingsModal
                isOpen={showLyricFilterSettings}
                isDaylight={isDaylight}
                currentSongTitle={currentSongTitle}
                initialPattern={lyricFilterPattern}
                initialFilterEnabled={lyricFilterEnabled}
                initialStaffPolicy={lyricStaffPolicy}
                initialStaffMinDwellSeconds={lyricStaffMinDwellSeconds}
                initialStaffAbsorbMode={lyricStaffAbsorbMode}
                initialStaffPattern={lyricStaffPattern}
                loadPreviewLyrics={loadLyricFilterPreview}
                onClose={() => closeSubviewOrModal(() => setShowLyricFilterSettings(false))}
                onSave={onSaveLyricFilterPattern}
            />
            <GlobalLyricOffsetModal
                isOpen={showGlobalLyricOffset}
                isDaylight={isDaylight}
                lyrics={currentLyrics}
                lyricCurrentTime={lyricCurrentTime}
                onClose={() => closeSubviewOrModal(() => setShowGlobalLyricOffset(false))}
            />
            <AiHelpPromptModal
                isOpen={showAiHelpPrompt}
                isDaylight={isDaylight}
                onClose={() => setShowAiHelpPrompt(false)}
            />
            <ReleaseNotesDialog
                isOpen={showReleaseNotes}
                isDaylight={isDaylight}
                onClose={() => setShowReleaseNotes(false)}
            />
        </motion.div>
    );
};

export default SettingsModal;
