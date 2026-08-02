import React, { useState } from 'react';
import { Monitor, Palette, Settings2, LayoutGrid, Download, Copy, Check, ChevronRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    type DualTheme,
    type Theme,
    type ThemeMode,
    type UrlBackgroundItem,
} from '../../../types';
import { applyVisualizerTuningsToSettings } from '../../visualizer/tuningRegistry';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { mergeUrlBackgroundList } from '../../../utils/urlBackground';
import { compressConfig, decompressConfig, readSavedCustomTheme } from '../../../utils/appearanceCodec';
import { ACTIVATE_CUSTOM_THEME_KEY, buildImportPlan, THEME_DARK_KEY, THEME_LIGHT_KEY, type ImportPlan } from '../../../utils/appearanceImportPlan';
import { isFontFamilyAvailable } from '../../../utils/fontAvailability';
import ImportConfirmDialog from './ImportConfirmDialog';
import { extractCfgFromInput } from '../../../utils/obsUrl';
import { buildCurrentObsUrl } from '../../../utils/currentObsUrl';
import { ObsCopyUrlButton } from '../../shared/ObsCopyUrlButton';
import { resolveWebObsTarget, selectWebObsSource } from '../../../utils/webObsTarget';
import { buildVisualSettingsConfig, hasCustomObsFont } from '../../../utils/visualSettingsConfig';

// src/components/modal/settings/AppearanceSettingsSubview.tsx
// Visual settings subview for theme presets, lyric renderer entry, layout settings, and configurations import/export.

type AppearanceSettingsSubviewProps = {
    accentOutlineColor: string;
    bgMode: ThemeMode;
    hasCustomTheme: boolean;
    isCustomThemePreferred: boolean;
    isDaylight: boolean;
    onApplyCustomTheme: () => void;
    onApplyDefaultTheme: () => void;
    onOpenThemePark: () => void;
    onOpenVisPlayground: () => void;
    onToggleSongThemeAutoGenerate: (enabled: boolean) => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    onToggleTransparentPlayerBackground: (enabled: boolean) => void;
    onToggleAutoHidePlayerChrome: (enabled: boolean) => void;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    settingsCardClass: string;
    songThemeAutoSwitchEnabled: boolean;
    songThemeAutoGenerateEnabled: boolean;
    theme?: Theme;
    themeParkInitialTheme: DualTheme;
    toggleOffBackgroundClass: string;
    transparentPlayerBackground: boolean;
    autoHidePlayerChrome: boolean;
    utilityGhostButtonClass: string;
    grid3dCardStyle: 'image' | 'card';
    onChangeGrid3dCardStyle: (style: 'image' | 'card') => void;
    aiTheme?: DualTheme | null;
    customTheme?: DualTheme | null;
};

// ==========================================
// Component
// ==========================================

const AppearanceSettingsSubview: React.FC<AppearanceSettingsSubviewProps> = ({
    accentOutlineColor,
    bgMode,
    hasCustomTheme,
    isCustomThemePreferred,
    isDaylight,
    onApplyCustomTheme,
    onApplyDefaultTheme,
    onOpenThemePark,
    onOpenVisPlayground,
    onToggleSongThemeAutoGenerate,
    onToggleCustomThemePreferred,
    onToggleSongThemeAutoSwitch,
    onToggleTransparentPlayerBackground,
    onToggleAutoHidePlayerChrome,
    onSaveCustomTheme,
    settingsCardClass,
    songThemeAutoSwitchEnabled,
    songThemeAutoGenerateEnabled,
    theme,
    themeParkInitialTheme,
    toggleOffBackgroundClass,
    transparentPlayerBackground,
    autoHidePlayerChrome,
    utilityGhostButtonClass,
    grid3dCardStyle,
    onChangeGrid3dCardStyle,
    aiTheme,
    customTheme,
}) => {
    const { t } = useTranslation();
    // OBS static URL points to this web deploy, so the copy button is web-only (no shareable URL under Electron).
    // The link follows the selected web stage source (Now Playing / PlayerCap); disabled when none is on.
    const isElectron = typeof window !== 'undefined' && Boolean((window as { electron?: unknown }).electron);
    const webObsSource = useSettingsUiStore(selectWebObsSource);
    const [importText, setImportText] = useState('');
    const [copiedType, setCopiedType] = useState<'none' | 'shortcode' | 'json' | 'obsurl'>('none');
    // Parsed config held back until the user confirms which groups to take.
    const [pendingImport, setPendingImport] = useState<{ config: any; plan: ImportPlan; } | null>(null);

    const [exportThemeType, setExportThemeType] = useState<'custom' | 'ai' | 'none'>(() => {
        if (bgMode === 'ai' && aiTheme) return 'ai';
        if (customTheme) return 'custom';
        return 'none';
    });
    // A deliberate pick (clicking a theme button) freezes the auto-follow below; without it the
    // effect keeps overwriting the user's choice on any theme change.
    const exportThemePickedRef = React.useRef(false);
    const pickExportThemeType = (value: 'custom' | 'ai' | 'none') => {
        exportThemePickedRef.current = true;
        setExportThemeType(value);
    };

    // Until the user picks, track whichever theme is available (AI-preferred); after a pick, repair
    // only -- demote to 'none' when the picked option's theme disappears, but never override a
    // deliberate choice. bgMode is not a dependency -- the buttons are gated on the themes themselves.
    React.useEffect(() => {
        setExportThemeType(prev => {
            if (!exportThemePickedRef.current) return aiTheme ? 'ai' : customTheme ? 'custom' : 'none';
            return (prev === 'ai' && !aiTheme) || (prev === 'custom' && !customTheme) ? 'none' : prev;
        });
    }, [aiTheme, customTheme]);

    // Access ZUSTAND settings store directly for setters & configurations
    const store = useSettingsUiStore(useShallow(state => ({
        statusSetter: state.statusSetter,
        enablePlayerPageNativeBlur: state.enablePlayerPageNativeBlur,
        visualizerMode: state.visualizerMode,
        randomVisualizerModePerSong: state.randomVisualizerModePerSong,
        visualizerBackgroundMode: state.visualizerBackgroundMode,
        backgroundOpacity: state.backgroundOpacity,
        visualizerOpacity: state.visualizerOpacity,
        hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
        showSubtitleTranslation: state.showSubtitleTranslation,
        subtitleContentMode: state.subtitleContentMode,
        subtitleOverlayBackground: state.subtitleOverlayBackground,
        showHarmonySubtitle: state.showHarmonySubtitle,
        harmonySubtitleBackground: state.harmonySubtitleBackground,
        lyricsFontStyle: state.lyricsFontStyle,
        lyricsFontScale: state.lyricsFontScale,
        lyricsFontWeight: state.lyricsFontWeight,
        lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
        subtitleFontScale: state.subtitleFontScale,
        subtitleFontStyle: state.subtitleFontStyle,
        subtitleFontWeight: state.subtitleFontWeight,
        subtitleFontFamily: state.subtitleFontFamily,
        subtitleFontFallbackFamilies: state.subtitleFontFallbackFamilies,
        classicTuning: state.classicTuning,
        cadenzaTuning: state.cadenzaTuning,
        partitaTuning: state.partitaTuning,
        fumeTuning: state.fumeTuning,
        claddaghTuning: state.claddaghTuning,
        cappellaTuning: state.cappellaTuning,
        tiltTuning: state.tiltTuning,
        dioramaTuning: state.dioramaTuning,
        monetBackgroundTuning: state.monetBackgroundTuning,
        nomandBackgroundTuning: state.nomandBackgroundTuning,
        latentBackgroundTuning: state.latentBackgroundTuning,
        monetTuning: state.monetTuning,
        pendoloTuning: state.pendoloTuning,
        sonnetTuning: state.sonnetTuning,
        urlBackgroundList: state.urlBackgroundList,
        urlBackgroundSelectedId: state.urlBackgroundSelectedId,

        handleSetVisualizerMode: state.handleSetVisualizerMode,
        handleToggleRandomVisualizerModePerSong: state.handleToggleRandomVisualizerModePerSong,
        handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
        handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
        handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
        handleToggleHidePlayerTranslationSubtitle: state.handleToggleHidePlayerTranslationSubtitle,
        handleToggleShowSubtitleTranslation: state.handleToggleShowSubtitleTranslation,
        handleSetSubtitleContentMode: state.handleSetSubtitleContentMode,
        handleToggleSubtitleOverlayBackground: state.handleToggleSubtitleOverlayBackground,
        handleToggleShowHarmonySubtitle: state.handleToggleShowHarmonySubtitle,
        handleToggleHarmonySubtitleBackground: state.handleToggleHarmonySubtitleBackground,
        handleSetLyricsFontStyle: state.handleSetLyricsFontStyle,
        handleSetLyricsFontScale: state.handleSetLyricsFontScale,
        handleSetLyricsFontWeight: state.handleSetLyricsFontWeight,
        handleSetLyricsFontFallbackFamilies: state.handleSetLyricsFontFallbackFamilies,
        handleSetSubtitleFontInheritsLyrics: state.handleSetSubtitleFontInheritsLyrics,
        handleSetSubtitleFontScale: state.handleSetSubtitleFontScale,
        handleSetSubtitleFontStyle: state.handleSetSubtitleFontStyle,
        handleSetSubtitleFontWeight: state.handleSetSubtitleFontWeight,
        handleSetSubtitleFontFamily: state.handleSetSubtitleFontFamily,
        handleSetSubtitleFontFallbackFamilies: state.handleSetSubtitleFontFallbackFamilies,
        handleSetClassicTuning: state.handleSetClassicTuning,
        handleSetCadenzaTuning: state.handleSetCadenzaTuning,
        handleSetPartitaTuning: state.handleSetPartitaTuning,
        handleSetFumeTuning: state.handleSetFumeTuning,
        handleSetCladdaghTuning: state.handleSetCladdaghTuning,
        handleSetCappellaTuning: state.handleSetCappellaTuning,
        handleSetTiltTuning: state.handleSetTiltTuning,
        handleSetDioramaTuning: state.handleSetDioramaTuning,
        handleSetMonetBackgroundTuning: state.handleSetMonetBackgroundTuning,
        handleSetNomandBackgroundTuning: state.handleSetNomandBackgroundTuning,
        handleSetLatentBackgroundTuning: state.handleSetLatentBackgroundTuning,
        handleSetMonetTuning: state.handleSetMonetTuning,
        handleSetPendoloTuning: state.handleSetPendoloTuning,
        handleSetSonnetTuning: state.handleSetSonnetTuning,
        handleAddUrlBackgroundItem: state.handleAddUrlBackgroundItem,
        handleUpdateUrlBackgroundItem: state.handleUpdateUrlBackgroundItem,
        handleSetUrlBackgroundList: state.handleSetUrlBackgroundList,
        handleSetUrlBackgroundSelectedId: state.handleSetUrlBackgroundSelectedId,
    })));

    const getAccentOptionStyle = (selected: boolean) => (
        selected
            ? {
                borderColor: accentOutlineColor,
                boxShadow: `inset 0 0 0 1px ${accentOutlineColor}`,
                backgroundColor: isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`,
            }
            : {
                borderColor: isDaylight ? 'rgba(24, 24, 27, 0.12)' : 'rgba(255, 255, 255, 0.1)',
                backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.05)',
            }
    );
    const lyricsStyleBorderStart = theme?.accentColor || accentOutlineColor;
    const lyricsStyleBorderEnd = theme?.secondaryColor || theme?.primaryColor || accentOutlineColor;

    const buildCurrentConfig = () => {
        let exportTheme: DualTheme | null = null;
        if (exportThemeType === 'custom') {
            exportTheme = customTheme || readSavedCustomTheme() || null;
        } else if (exportThemeType === 'ai') {
            exportTheme = aiTheme || null;
        }
        return {
            theme: exportTheme,
            ...buildVisualSettingsConfig(),
            songThemeAutoSwitchEnabled,
            songThemeAutoGenerateEnabled,
        };
    };

    const handleCopyShortcode = async () => {
        const config = buildCurrentConfig();
        const code = compressConfig(config);
        try {
            await navigator.clipboard.writeText(code);
            setCopiedType('shortcode');
            setTimeout(() => setCopiedType('none'), 2000);
            store.statusSetter?.({ type: 'success', text: t('status.copied') });
        } catch (err) {
            console.error('Failed to copy shortcode:', err);
        }
    };

    const handleCopyJson = async () => {
        const config = buildCurrentConfig();
        const code = JSON.stringify(config, null, 2);
        try {
            await navigator.clipboard.writeText(code);
            setCopiedType('json');
            setTimeout(() => setCopiedType('none'), 2000);
            store.statusSetter?.({ type: 'success', text: t('status.copied') });
        } catch (err) {
            console.error('Failed to copy JSON:', err);
        }
    };

    // Copy the OBS overlay URL for the selected web stage source: burn the current appearance into a
    // link to paste into an OBS browser source. Bakes the current light/dark preference and the
    // transparent-background toggle (on → transparent=1, off → transparent=0 with the background
    // shown); PlayerCap carries its non-default connection params; warns when the link carries a
    // custom font.
    const handleCopyObsUrl = async () => {
        const target = resolveWebObsTarget();
        if (!target) return;
        // Same builder as the stage header's button, so both produce an identical link. The theme
        // follows the OBS theme mode and the applied theme -- not the export toggle below, which
        // governs the config code only. PlayerCap host/params come from the resolved target.
        const url = await buildCurrentObsUrl(target.source, target.host, target.extra);
        try {
            await navigator.clipboard.writeText(url);
            setCopiedType('obsurl');
            setTimeout(() => setCopiedType('none'), 2000);
            store.statusSetter?.(hasCustomObsFont()
                ? { type: 'info', text: t('options.obsUrlCustomFontHint') }
                : { type: 'success', text: t('status.copied') });
        } catch (err) {
            // The URL is built asynchronously, so a browser that requires the write to stay inside the
            // click's own task can reject here. Say so instead of leaving the button looking inert.
            console.error('Failed to copy OBS URL:', err);
            store.statusSetter?.({ type: 'error', text: t('status.copyFailed') });
        }
    };

    // Parse and diff only. Applying waits for the confirmation, because a config can change settings
    // it never mentions -- unpinning a custom theme, discarding an uploaded font.
    const handleImportConfig = () => {
        if (!importText.trim()) return;
        try {
            // Import accepts a bare shortcode/JSON or a full OBS URL (extracting its cfg param), so a look can be re-tuned from someone's link.
            const config = decompressConfig(extractCfgFromInput(importText));
            const uiStore = useSettingsUiStore.getState();
            const customFont = uiStore.lyricsCustomFont;
            const plan = buildImportPlan({
                incoming: config,
                current: { ...buildVisualSettingsConfig(), theme: customTheme ?? null },
                switches: { isCustomThemePreferred, songThemeAutoSwitchEnabled, songThemeAutoGenerateEnabled },
                customFontSource: customFont?.source ?? null,
                customFontLabel: customFont?.label ?? customFont?.family ?? null,
                incomingFontAvailable: config.lyricsCustomFontFamily
                    ? isFontFamilyAvailable(String(config.lyricsCustomFontFamily))
                    : undefined,
                isCustomThemeActive: bgMode === 'custom',
                // A config names an uploaded image or emoji pack by source, but never carries it.
                assets: {
                    hasCappellaEmojiPack: uiStore.storedCappellaEmojiPack.length > 0,
                    hasMonetBackgroundImage: Boolean(uiStore.storedMonetBackgroundImage),
                    hasMonetPortraitImage: Boolean(uiStore.storedMonetPortraitImage),
                },
            });

            // Shown even when nothing differs. Skipping straight to a toast reads as the dialog
            // having failed to appear, and "your settings already match this" is worth seeing.
            setPendingImport({ config, plan });
        } catch (err) {
            console.error('Import settings failed:', err);
            store.statusSetter?.({ type: 'error', text: t('options.importFailed') });
        }
    };

    // `keys` are the plan's change keys, which are the config field names apart from the two theme
    // sides. Anything not picked is left exactly as it is.
    const applyImportedConfig = (config: any, keys: string[]) => {
        const has = (key: string) => keys.includes(key);
        try {
            // 1. Restore Theme, per side: taking someone's night colours must not drag their day
            // ones along, so the side that was not picked keeps whatever is saved now.
            const savesTheme = Boolean(config.theme) && (has(THEME_LIGHT_KEY) || has(THEME_DARK_KEY));
            if (savesTheme) {
                const base = customTheme ?? config.theme;
                // Saving already switches the mode to custom (see saveCustomDualTheme), which is why
                // the plan links the activate row to the side rows instead of offering it separately.
                onSaveCustomTheme({
                    light: has(THEME_LIGHT_KEY) ? config.theme.light : base.light,
                    dark: has(THEME_DARK_KEY) ? config.theme.dark : base.dark,
                });
            } else if (has(ACTIVATE_CUSTOM_THEME_KEY)) {
                // Nothing to save -- the incoming theme is the one already stored, so this row is
                // the whole of what the user asked for.
                onApplyCustomTheme();
            }

            // 2. Restore Visualizer Setup
            if (has('visualizerMode') && config.visualizerMode) {
                store.handleSetVisualizerMode(config.visualizerMode);
            }
            if (has('randomVisualizerModePerSong')) {
                store.handleToggleRandomVisualizerModePerSong(Boolean(config.randomVisualizerModePerSong));
            }
            if (has('visualizerOpacity')) {
                store.handleSetVisualizerOpacity(config.visualizerOpacity);
            }
            if (has('hidePlayerTranslationSubtitle')) {
                store.handleToggleHidePlayerTranslationSubtitle(Boolean(config.hidePlayerTranslationSubtitle));
            }
            if (has('showSubtitleTranslation')) {
                store.handleToggleShowSubtitleTranslation(Boolean(config.showSubtitleTranslation));
            }
            if (has('subtitleContentMode')
                && (config.subtitleContentMode === 'translation'
                    || config.subtitleContentMode === 'romanization'
                    || config.subtitleContentMode === 'none')) {
                store.handleSetSubtitleContentMode(config.subtitleContentMode);
            }
            if (has('subtitleOverlayBackground')) {
                store.handleToggleSubtitleOverlayBackground(Boolean(config.subtitleOverlayBackground));
            }
            if (has('showHarmonySubtitle')) {
                store.handleToggleShowHarmonySubtitle(Boolean(config.showHarmonySubtitle));
            }
            if (has('harmonySubtitleBackground')) {
                store.handleToggleHarmonySubtitleBackground(Boolean(config.harmonySubtitleBackground));
            }

            if (has('visualizerBackgroundMode') && config.visualizerBackgroundMode) {
                store.handleSetVisualizerBackgroundMode(config.visualizerBackgroundMode);
            }
            if (has('backgroundOpacity')) {
                store.handleSetBackgroundOpacity(config.backgroundOpacity);
            }

            if (has('lyricsFontStyle') && config.lyricsFontStyle) {
                store.handleSetLyricsFontStyle(config.lyricsFontStyle);
            }
            if (has('lyricsFontScale')) {
                store.handleSetLyricsFontScale(config.lyricsFontScale);
            }
            if (has('lyricsFontWeight')) {
                store.handleSetLyricsFontWeight(config.lyricsFontWeight);
            }
            if (has('lyricsFontFallbackFamilies') && config.lyricsFontFallbackFamilies) {
                store.handleSetLyricsFontFallbackFamilies(config.lyricsFontFallbackFamilies);
            }
            // Only a system family is portable. Setting one evicts an uploaded font and deletes
            // its stored file, which is why the confirmation calls that out separately.
            if (has('lyricsCustomFontFamily') && config.lyricsCustomFontFamily) {
                const family = String(config.lyricsCustomFontFamily);
                useSettingsUiStore.getState().handleSetLyricsCustomFont({ source: 'system', family, label: family });
            }
            if (has('subtitleFontInheritsLyrics')) {
                store.handleSetSubtitleFontInheritsLyrics(Boolean(config.subtitleFontInheritsLyrics));
            }
            if (has('subtitleFontScale')) {
                store.handleSetSubtitleFontScale(config.subtitleFontScale);
            }
            if (has('subtitleFontStyle') && config.subtitleFontStyle) {
                store.handleSetSubtitleFontStyle(config.subtitleFontStyle);
            }
            if (has('subtitleFontWeight')) {
                store.handleSetSubtitleFontWeight(config.subtitleFontWeight);
            }
            if (has('subtitleFontFamily')) {
                store.handleSetSubtitleFontFamily(config.subtitleFontFamily);
            }
            if (has('subtitleFontFallbackFamilies') && config.subtitleFontFallbackFamilies) {
                store.handleSetSubtitleFontFallbackFamilies(config.subtitleFontFallbackFamilies);
            }

            // Tunings. The bundle wins over the individual ones, which is why the plan never offers
            // both -- picking the bundle is picking every renderer at once.
            if (has('visualizerTunings') && config.visualizerTunings) {
                applyVisualizerTuningsToSettings(store as unknown as Record<string, unknown>, config.visualizerTunings);
            }
            if (!config.visualizerTunings) {
                if (has('classicTuning') && config.classicTuning) store.handleSetClassicTuning(config.classicTuning);
                if (has('cadenzaTuning') && config.cadenzaTuning) store.handleSetCadenzaTuning(config.cadenzaTuning);
                if (has('partitaTuning') && config.partitaTuning) store.handleSetPartitaTuning(config.partitaTuning);
                if (has('fumeTuning') && config.fumeTuning) store.handleSetFumeTuning(config.fumeTuning);
                if (has('claddaghTuning') && config.claddaghTuning) store.handleSetCladdaghTuning(config.claddaghTuning);
                if (has('cappellaTuning') && config.cappellaTuning) store.handleSetCappellaTuning(config.cappellaTuning);
                if (has('tiltTuning') && config.tiltTuning) store.handleSetTiltTuning(config.tiltTuning);
                if (has('dioramaTuning') && config.dioramaTuning) store.handleSetDioramaTuning(config.dioramaTuning);
                if (has('monetTuning') && config.monetTuning) store.handleSetMonetTuning(config.monetTuning);
                if (has('pendoloTuning') && config.pendoloTuning) store.handleSetPendoloTuning(config.pendoloTuning);
                if (has('sonnetTuning') && config.sonnetTuning) store.handleSetSonnetTuning(config.sonnetTuning);
            }

            if (has('monetBackgroundTuning') && config.monetBackgroundTuning) {
                store.handleSetMonetBackgroundTuning(config.monetBackgroundTuning);
            }
            if (has('nomandBackgroundTuning') && config.nomandBackgroundTuning) {
                store.handleSetNomandBackgroundTuning(config.nomandBackgroundTuning);
            }
            if (has('latentBackgroundTuning') && config.latentBackgroundTuning) {
                store.handleSetLatentBackgroundTuning(config.latentBackgroundTuning);
            }

            let mergedUrlList: UrlBackgroundItem[] | undefined;

            if (has('urlBackgroundList') && Array.isArray(config.urlBackgroundList)) {
                // Batch merge: compute the final list once, then apply with a single store update to
                // avoid sequential localStorage writes per item. The plan diffs against this same
                // helper, so the row's count is the count that gets stored.
                mergedUrlList = mergeUrlBackgroundList(store.urlBackgroundList, config.urlBackgroundList);
                store.handleSetUrlBackgroundList(mergedUrlList);
            }
            // Validate that the imported selectedId still exists in the final list
            // to avoid a dangling reference that renders UrlBackgroundLayer blank.
            if (has('urlBackgroundSelectedId') && config.urlBackgroundSelectedId) {
                const list = mergedUrlList ?? store.urlBackgroundList;
                if (list.some(i => i.id === config.urlBackgroundSelectedId)) {
                    store.handleSetUrlBackgroundSelectedId(config.urlBackgroundSelectedId);
                }
            }

            if (has('songThemeAutoSwitchEnabled')) {
                onToggleSongThemeAutoSwitch(Boolean(config.songThemeAutoSwitchEnabled));
            }
            if (has('songThemeAutoGenerateEnabled')) {
                onToggleSongThemeAutoGenerate(Boolean(config.songThemeAutoGenerateEnabled));
            }

            store.statusSetter?.({ type: 'success', text: t('options.importSuccess') });
            setImportText('');
            setPendingImport(null);
        } catch (err) {
            console.error('Import settings failed:', err);
            store.statusSetter?.({ type: 'error', text: t('options.importFailed') });
            setPendingImport(null);
        }
    };

    return (
        <div className="space-y-6">
            {/* Section 1: Theme presets and edit options */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Palette size={14} /> {t('options.themePresets')}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.themePresets')}
                        </div>
                        <button
                            type="button"
                            onClick={onOpenThemePark}
                            className={`shrink-0 w-9 h-9 rounded-full border transition-colors flex items-center justify-center ${utilityGhostButtonClass}`}
                            style={{ color: 'var(--text-primary)' }}
                            title={t('options.openThemePark')}
                            aria-label={t('options.openThemePark')}
                        >
                            <Palette size={16} />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={onApplyDefaultTheme}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                            style={{
                                ...getAccentOptionStyle(bgMode === 'default'),
                                backgroundColor: bgMode === 'default'
                                    ? (isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`)
                                    : (isDaylight ? 'rgba(24, 24, 27, 0.035)' : 'rgba(9, 9, 11, 0.5)'),
                            }}
                        >
                            <div className="w-6 h-6 rounded-full shadow-sm" style={{ background: `linear-gradient(135deg, ${themeParkInitialTheme.light.backgroundColor}, ${themeParkInitialTheme.dark.backgroundColor})`, borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.15)' }} />
                            <span className="text-xs font-semibold" style={{ color: isDaylight ? '#27272a' : '#e4e4e7' }}>{t('options.themePresetsDefault') || 'Default'}</span>
                        </button>
                        <button
                            onClick={onApplyCustomTheme}
                            disabled={!hasCustomTheme}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            style={{
                                ...getAccentOptionStyle(bgMode === 'custom'),
                                backgroundColor: bgMode === 'custom'
                                    ? (isDaylight ? `${accentOutlineColor}12` : `${accentOutlineColor}18`)
                                    : (isDaylight ? 'rgba(255, 255, 255, 0.72)' : 'rgba(255, 255, 255, 0.08)'),
                            }}
                        >
                            <div className="w-6 h-6 rounded-full" style={{ background: hasCustomTheme ? `linear-gradient(135deg, ${themeParkInitialTheme.light.accentColor}, ${themeParkInitialTheme.dark.accentColor})` : 'rgba(114,119,134,0.4)' }} />
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{t('options.customTheme') || 'Custom'}</span>
                        </button>
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${settingsCardClass}`}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.preferCustomTheme')}
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.preferCustomThemeDesc')}
                            </div>
                        </div>
                        <button
                            onClick={() => hasCustomTheme && onToggleCustomThemePreferred(!isCustomThemePreferred)}
                            disabled={!hasCustomTheme}
                            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!isCustomThemePreferred ? toggleOffBackgroundClass : ''} disabled:opacity-40 disabled:cursor-not-allowed`}
                            style={{ backgroundColor: isCustomThemePreferred ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isCustomThemePreferred ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${settingsCardClass}`}>
                        <div className="space-y-1">
                            <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                {t('options.autoSwitchSongTheme')}
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.autoSwitchSongThemeDesc')}
                            </div>
                        </div>
                        <button
                            onClick={() => onToggleSongThemeAutoSwitch(!songThemeAutoSwitchEnabled)}
                            className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!songThemeAutoSwitchEnabled ? toggleOffBackgroundClass : ''}`}
                            style={{ backgroundColor: songThemeAutoSwitchEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                        >
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${songThemeAutoSwitchEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    {songThemeAutoSwitchEnabled && (
                        <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${settingsCardClass}`}>
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.autoGenerateSongTheme')}
                                </div>
                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.autoGenerateSongThemeDesc')}
                                </div>
                            </div>
                            <button
                                onClick={() => onToggleSongThemeAutoGenerate(!songThemeAutoGenerateEnabled)}
                                className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!songThemeAutoGenerateEnabled ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: songThemeAutoGenerateEnabled ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${songThemeAutoGenerateEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    )}
                </div>
            </section>

            {/* Section 2: Lyrics Animation & Player View */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Monitor size={14} /> {t('options.lyricsRenderer')}
                </h3>
                <div className="space-y-3">
                    {store.enablePlayerPageNativeBlur && (
                        <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs text-amber-500 dark:text-amber-400">
                            <AlertTriangle size={16} className="shrink-0 text-amber-500" />
                            <span>{t('options.nativeBlurBackgroundNotice')}</span>
                        </div>
                    )}
                    <button
                        type="button"
                        onClick={onOpenVisPlayground}
                        className="group flex w-full items-center gap-3 rounded-xl border-2 border-transparent p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
                        style={{
                            color: 'var(--text-primary)',
                            background: [
                                `linear-gradient(color-mix(in srgb, var(--bg-color) ${isDaylight ? '96%' : '92%'}, ${lyricsStyleBorderStart}), color-mix(in srgb, var(--bg-color) ${isDaylight ? '96%' : '92%'}, ${lyricsStyleBorderStart})) padding-box`,
                                `linear-gradient(120deg, ${lyricsStyleBorderStart}, ${lyricsStyleBorderEnd}) border-box`,
                            ].join(', '),
                        }}
                    >
                        <span
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
                            style={{
                                color: accentOutlineColor,
                                borderColor: `${accentOutlineColor}55`,
                                backgroundColor: `${accentOutlineColor}18`,
                            }}
                        >
                            <Settings2 size={19} />
                        </span>
                        <span className="min-w-0 flex-1 space-y-1">
                            <span className="block text-sm font-semibold">
                                {t('options.lyricsAnimationAdjust')}
                            </span>
                            <span className="block text-xs opacity-55" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.lyricsRendererDesc')}
                            </span>
                        </span>
                        <ChevronRight size={18} className="shrink-0 opacity-45 transition-transform group-hover:translate-x-0.5 group-hover:opacity-80" />
                    </button>
                    <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.transparentPlayerBackground')}
                                </div>
                                <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.transparentPlayerBackgroundDesc')}
                                </div>
                            </div>
                            <button
                                onClick={() => onToggleTransparentPlayerBackground(!transparentPlayerBackground)}
                                className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!transparentPlayerBackground ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: transparentPlayerBackground ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${transparentPlayerBackground ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.autoHidePlayerChrome')}
                                </div>
                                <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.autoHidePlayerChromeDesc')}
                                </div>
                            </div>
                            <button
                                onClick={() => onToggleAutoHidePlayerChrome(!autoHidePlayerChrome)}
                                className={`w-12 h-6 rounded-full p-1 transition-colors shrink-0 ${!autoHidePlayerChrome ? toggleOffBackgroundClass : ''}`}
                                style={{ backgroundColor: autoHidePlayerChrome ? theme?.secondaryColor || 'rgba(114, 119, 134, 1)' : undefined }}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${autoHidePlayerChrome ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>
                    </div>
                </div>
            </section>

            {/* Section 3: Grid card style */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <LayoutGrid size={14} /> {t('options.grid3dCardStyle')}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            {t('options.grid3dCardStyle')}
                        </div>
                        <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.grid3dCardStyleDesc')}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => onChangeGrid3dCardStyle('image')}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                            style={getAccentOptionStyle(grid3dCardStyle === 'image')}
                        >
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.grid3dCardStyleImage')}
                            </span>
                        </button>
                        <button
                            onClick={() => onChangeGrid3dCardStyle('card')}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                            style={getAccentOptionStyle(grid3dCardStyle === 'card')}
                        >
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.grid3dCardStyleCard')}
                            </span>
                        </button>
                    </div>
                </div>
            </section>

            {/* Section 4: Configurations Import/Export (New feature) */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Settings2 size={14} /> {t('options.importExportTitle')}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.importExportTitle')}
                        </div>
                        <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.importExportDesc')}
                        </div>
                    </div>

                    <div className="space-y-1.5 pt-1">
                        <div className="text-xs font-semibold opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.exportThemeLabel')}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1">
                            {aiTheme && (
                                <button
                                    type="button"
                                    onClick={() => pickExportThemeType('ai')}
                                    className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                    style={getAccentOptionStyle(exportThemeType === 'ai')}
                                >
                                    <Palette size={12} className="opacity-70" />
                                    <span>{t('options.exportAiTheme')}: {aiTheme.light.name || 'AI'}</span>
                                </button>
                            )}
                            {customTheme && (
                                <button
                                    type="button"
                                    onClick={() => pickExportThemeType('custom')}
                                    className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                    style={getAccentOptionStyle(exportThemeType === 'custom')}
                                >
                                    <Palette size={12} className="opacity-70" />
                                    <span>{t('options.exportCustomTheme')}: {customTheme.light.name || 'Custom'}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => pickExportThemeType('none')}
                                className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                style={getAccentOptionStyle(exportThemeType === 'none')}
                            >
                                <Settings2 size={12} className="opacity-70" />
                                <span>{t('options.exportNoTheme')}</span>
                            </button>
                        </div>
                    </div>

                    <textarea
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        placeholder={t('options.importPlaceholder')}
                        className="w-full h-24 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-white/30 transition-colors font-mono resize-none"
                        style={{ color: 'var(--text-primary)' }}
                    />

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={handleCopyShortcode}
                            className="px-3 py-2 bg-white/15 hover:bg-white/20 active:bg-white/10 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {copiedType === 'shortcode' ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                            <span>{copiedType === 'shortcode' ? (t('status.copied')) : t('options.exportBtn')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleCopyJson}
                            className="px-3 py-2 bg-white/10 hover:bg-white/15 active:bg-white/5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {copiedType === 'json' ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                            <span>{copiedType === 'json' ? (t('status.copied')) : t('options.copyJson')}</span>
                        </button>
                        {!isElectron && (
                            <ObsCopyUrlButton
                                onCopy={handleCopyObsUrl}
                                copied={copiedType === 'obsurl'}
                                disabled={webObsSource === null}
                            />
                        )}
                        <div className="flex-1 min-w-[20px]" />
                        <button
                            type="button"
                            onClick={handleImportConfig}
                            disabled={!importText.trim()}
                            className="px-4 py-2 bg-white/20 hover:bg-white/25 active:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                            style={{ color: 'var(--text-primary)', borderColor: accentOutlineColor }}
                        >
                            <Download size={13} />
                            <span>{t('options.importBtn')}</span>
                        </button>
                    </div>
                </div>
            </section>

            <ImportConfirmDialog
                isOpen={pendingImport !== null}
                plan={pendingImport?.plan ?? null}
                isDaylight={isDaylight}
                onCancel={() => setPendingImport(null)}
                onConfirm={(keys) => {
                    if (pendingImport) applyImportedConfig(pendingImport.config, keys);
                }}
            />
        </div>
    );
};

export default AppearanceSettingsSubview;
