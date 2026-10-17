import { applyVisualizerTuningsToSettings } from '../../../../visualizer/tuningRegistry';
import { importFoliumParams, snapshotFoliumParams } from '../../../../../mods/params/paramStore';
import { buildVisualSettingsConfig } from '../../../../../services/obs/visualSettingsConfig';
import { isThemeGenerationSource, type ThemeGenerationSource } from '../../../../../services/themePreferences';
import { useLibraryWallLookStore } from '../../../../../stores/useLibraryWallLookStore';
import { useStageSettingsStore } from '../../../../../stores/useStageSettingsStore';
import { useThemeSettingsStore } from '../../../../../stores/useThemeSettingsStore';
import { useTypographySettingsStore } from '../../../../../stores/useTypographySettingsStore';
import { useVisualizerAssetStore } from '../../../../../stores/useVisualizerAssetStore';
import { useVisualizerSettingsStore } from '../../../../../stores/useVisualizerSettingsStore';
import type { DualTheme, ThemeMode, UrlBackgroundItem } from '../../../../../types';
import { decompressConfig, readSavedCustomTheme } from '../../../../../utils/appearanceCodec';
import { ACTIVATE_CUSTOM_THEME_KEY, buildImportPlan, THEME_DARK_KEY, THEME_LIGHT_KEY, type ImportPlan } from '../../../../../utils/appearanceImportPlan';
import { isFontFamilyAvailable } from '../../../../../utils/fontAvailability';
import { isLibraryWallSeamStyle } from '../../../../../utils/libraryWallSeamStyle';
import { extractCfgFromInput } from '../../../../../utils/obsUrl';
import { mergeUrlBackgroundList } from '../../../../../utils/urlBackground';

// src/components/modal/settings/pages/storage/visualConfigTransfer.ts
// The visual settings as one config: building it for a config code, working out what a pasted one
// would change, and applying the changes a person picked. Every visual setting that can be carried
// from one Folia to another passes through here, so a new one is added in buildVisualSettingsConfig
// (what is written) and in applyImportedConfig below (what is read back).
// The settings are read from and written to their stores when a function runs; the theme, which
// the app shell owns, is handed in.

/** The theme state and actions of the app shell that a config touches. */
export type ConfigThemeControls = {
    bgMode: ThemeMode;
    aiTheme?: DualTheme | null;
    customTheme?: DualTheme | null;
    isCustomThemePreferred: boolean;
    songThemeAutoSwitchEnabled: boolean;
    songThemeAutoGenerateEnabled: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onApplyCustomTheme: () => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    onToggleSongThemeAutoGenerate: (enabled: boolean) => void;
    onChangeThemeGenerationSource: (source: ThemeGenerationSource) => void;
};

/** Which theme a copied config carries. */
export type ExportThemeChoice = 'custom' | 'ai' | 'none';

/** The visual settings as they are now, with the chosen theme, in the shape a config code carries. */
export const buildCurrentConfig = (theme: ConfigThemeControls, exportThemeType: ExportThemeChoice) => {
    let exportTheme: DualTheme | null = null;
    if (exportThemeType === 'custom') {
        exportTheme = theme.customTheme || readSavedCustomTheme() || null;
    } else if (exportThemeType === 'ai') {
        exportTheme = theme.aiTheme || null;
    }
    const foliumParams = snapshotFoliumParams();
    return {
        theme: exportTheme,
        ...buildVisualSettingsConfig(),
        songThemeAutoSwitchEnabled: theme.songThemeAutoSwitchEnabled,
        songThemeAutoGenerateEnabled: theme.songThemeAutoGenerateEnabled,
        // Mod settings and tunings (Folium param store) are visual settings too.
        ...(Object.keys(foliumParams).length > 0 ? { foliumParams } : {}),
    };
};

/**
 * Reads a pasted config and works out what taking it would change. Parse and diff only: applying
 * waits for the confirmation, because a config can change settings it never mentions (unpinning a
 * custom theme, discarding an uploaded font). Throws when the text cannot be read.
 */
export const planConfigImport = (text: string, theme: ConfigThemeControls): { config: any; plan: ImportPlan } => {
    // Import accepts a bare shortcode/JSON or a full OBS URL (extracting its cfg param), so a look can be re-tuned from someone's link.
    const config = decompressConfig(extractCfgFromInput(text));
    const customFont = useTypographySettingsStore.getState().lyricsCustomFont;
    const plan = buildImportPlan({
        incoming: config,
        current: { ...buildVisualSettingsConfig(), theme: theme.customTheme ?? null },
        switches: {
            isCustomThemePreferred: theme.isCustomThemePreferred,
            songThemeAutoSwitchEnabled: theme.songThemeAutoSwitchEnabled,
            songThemeAutoGenerateEnabled: theme.songThemeAutoGenerateEnabled,
        },
        customFontSource: customFont?.source ?? null,
        customFontLabel: customFont?.label ?? customFont?.family ?? null,
        incomingFontAvailable: config.lyricsCustomFontFamily
            ? isFontFamilyAvailable(String(config.lyricsCustomFontFamily))
            : undefined,
        isCustomThemeActive: theme.bgMode === 'custom',
        // A config names an uploaded image or emoji pack by source, but never carries it.
        assets: {
            hasCappellaEmojiPack: useVisualizerAssetStore.getState().storedCappellaEmojiPack.length > 0,
            hasMonetBackgroundImage: Boolean(useVisualizerAssetStore.getState().storedMonetBackgroundImage),
            hasMonetPortraitImage: Boolean(useVisualizerAssetStore.getState().storedMonetPortraitImage),
        },
    });
    return { config, plan };
};

/**
 * Applies the picked changes of a config. `keys` are the plan's change keys, which are the config
 * field names apart from the two theme sides. Anything not picked is left exactly as it is.
 */
export const applyImportedConfig = (config: any, keys: string[], theme: ConfigThemeControls): void => {
    const has = (key: string) => keys.includes(key);
    const storeVisualizer = useVisualizerSettingsStore.getState();
    const storeTypographySettings = useTypographySettingsStore.getState();
    const storeThemeSettings = useThemeSettingsStore.getState();
    const storeStageSettings = useStageSettingsStore.getState();

    // 1. Restore Theme, per side: taking someone's night colours must not drag their day
    // ones along, so the side that was not picked keeps whatever is saved now.
    const savesTheme = Boolean(config.theme) && (has(THEME_LIGHT_KEY) || has(THEME_DARK_KEY));
    if (savesTheme) {
        const base = theme.customTheme ?? config.theme;
        // Saving already switches the mode to custom (see saveCustomDualTheme), which is why
        // the plan links the activate row to the side rows instead of offering it separately.
        theme.onSaveCustomTheme({
            light: has(THEME_LIGHT_KEY) ? config.theme.light : base.light,
            dark: has(THEME_DARK_KEY) ? config.theme.dark : base.dark,
        });
    } else if (has(ACTIVATE_CUSTOM_THEME_KEY)) {
        // Nothing to save -- the incoming theme is the one already stored, so this row is
        // the whole of what the user asked for.
        theme.onApplyCustomTheme();
    }

    // 2. Restore Visualizer Setup
    if (has('visualizerMode') && config.visualizerMode) {
        storeVisualizer.handleSetVisualizerMode(config.visualizerMode);
    }
    if (has('randomVisualizerModePerSong')) {
        storeVisualizer.handleToggleRandomVisualizerModePerSong(Boolean(config.randomVisualizerModePerSong));
    }
    if (has('visualizerOpacity')) {
        storeVisualizer.handleSetVisualizerOpacity(config.visualizerOpacity);
    }
    if (has('hidePlayerTranslationSubtitle')) {
        storeTypographySettings.handleToggleHidePlayerTranslationSubtitle(Boolean(config.hidePlayerTranslationSubtitle));
    }
    if (has('showSubtitleTranslation')) {
        storeTypographySettings.handleToggleShowSubtitleTranslation(Boolean(config.showSubtitleTranslation));
    }
    if (has('subtitleContentMode')
        && (config.subtitleContentMode === 'translation'
            || config.subtitleContentMode === 'romanization'
            || config.subtitleContentMode === 'both'
            || config.subtitleContentMode === 'none')) {
        storeTypographySettings.handleSetSubtitleContentMode(config.subtitleContentMode);
    }
    if (has('subtitleOverlayBackground')) {
        storeTypographySettings.handleToggleSubtitleOverlayBackground(Boolean(config.subtitleOverlayBackground));
    }
    if (has('subtitleUpcomingLyricsBlur')) {
        storeTypographySettings.handleToggleSubtitleUpcomingLyricsBlur(Boolean(config.subtitleUpcomingLyricsBlur));
    }
    if (has('subtitleOverlayOpacity')) {
        storeTypographySettings.handleSetSubtitleOverlayOpacity(config.subtitleOverlayOpacity);
    }
    if (has('showHarmonySubtitle')) {
        storeTypographySettings.handleToggleShowHarmonySubtitle(Boolean(config.showHarmonySubtitle));
    }
    if (has('harmonySubtitleBackground')) {
        storeTypographySettings.handleToggleHarmonySubtitleBackground(Boolean(config.harmonySubtitleBackground));
    }

    if (has('visualizerBackgroundMode') && config.visualizerBackgroundMode) {
        storeVisualizer.handleSetVisualizerBackgroundMode(config.visualizerBackgroundMode);
    }
    if (has('backgroundOpacity')) {
        storeVisualizer.handleSetBackgroundOpacity(config.backgroundOpacity);
    }
    // Each of these four setters raises its own toast. They fire before the importSuccess
    // message below, which writes the same single status slot last, so the user still ends
    // on "imported" rather than on whichever toggle happened to be applied last.
    if (has('useCoverColorBg')) {
        storeThemeSettings.handleToggleCoverColorBg(Boolean(config.useCoverColorBg));
    }
    if (has('disableVisualizerGeometricBackground')) {
        storeVisualizer.handleToggleDisableVisualizerGeometricBackground(Boolean(config.disableVisualizerGeometricBackground));
    }
    if (has('disableVisualizerVignette')) {
        storeVisualizer.handleToggleDisableVisualizerVignette(Boolean(config.disableVisualizerVignette));
    }
    if (has('staticMode')) {
        storeThemeSettings.handleToggleStaticMode(Boolean(config.staticMode));
    }

    if (has('lyricsFontStyle') && config.lyricsFontStyle) {
        storeTypographySettings.handleSetLyricsFontStyle(config.lyricsFontStyle);
    }
    if (has('lyricsFontScale')) {
        storeTypographySettings.handleSetLyricsFontScale(config.lyricsFontScale);
    }
    if (has('lyricsFontWeight')) {
        storeTypographySettings.handleSetLyricsFontWeight(config.lyricsFontWeight);
    }
    if (has('lyricsFontFallbackFamilies') && config.lyricsFontFallbackFamilies) {
        storeTypographySettings.handleSetLyricsFontFallbackFamilies(config.lyricsFontFallbackFamilies);
    }
    // Only a system family is portable. Setting one evicts an uploaded font and deletes
    // its stored file, which is why the confirmation calls that out separately.
    if (has('lyricsCustomFontFamily') && config.lyricsCustomFontFamily) {
        const family = String(config.lyricsCustomFontFamily);
        useTypographySettingsStore.getState().handleSetLyricsCustomFont({ source: 'system', family, label: family });
    }
    if (has('subtitleFontInheritsLyrics')) {
        storeTypographySettings.handleSetSubtitleFontInheritsLyrics(Boolean(config.subtitleFontInheritsLyrics));
    }
    if (has('subtitleFontScale')) {
        storeTypographySettings.handleSetSubtitleFontScale(config.subtitleFontScale);
    }
    if (has('subtitleFontStyle') && config.subtitleFontStyle) {
        storeTypographySettings.handleSetSubtitleFontStyle(config.subtitleFontStyle);
    }
    if (has('subtitleFontWeight')) {
        storeTypographySettings.handleSetSubtitleFontWeight(config.subtitleFontWeight);
    }
    if (has('subtitleFontFamily')) {
        storeTypographySettings.handleSetSubtitleFontFamily(config.subtitleFontFamily);
    }
    if (has('subtitleFontFallbackFamilies') && config.subtitleFontFallbackFamilies) {
        storeTypographySettings.handleSetSubtitleFontFallbackFamilies(config.subtitleFontFallbackFamilies);
    }

    // Tunings. The bundle wins over the individual ones, which is why the plan never offers
    // both -- picking the bundle is picking every renderer at once.
    // Outside the visualizerTunings bundle: it belongs to no one mode.
    if (has('smartBeat') && config.smartBeat) {
        storeVisualizer.handleSetSmartBeat(config.smartBeat);
    }
    if (has('visualizerTunings') && config.visualizerTunings) {
        applyVisualizerTuningsToSettings(useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>, config.visualizerTunings);
    }
    if (!config.visualizerTunings) {
        // Frozen: the 13 lyric-style tunings below predate the visualizerTunings bundle, which carries any
        // new style. Do not add a lyric style here.
        if (has('classicTuning') && config.classicTuning) storeVisualizer.handleSetClassicTuning(config.classicTuning);
        if (has('cadenzaTuning') && config.cadenzaTuning) storeVisualizer.handleSetCadenzaTuning(config.cadenzaTuning);
        if (has('partitaTuning') && config.partitaTuning) storeVisualizer.handleSetPartitaTuning(config.partitaTuning);
        if (has('fumeTuning') && config.fumeTuning) storeVisualizer.handleSetFumeTuning(config.fumeTuning);
        if (has('claddaghTuning') && config.claddaghTuning) storeVisualizer.handleSetCladdaghTuning(config.claddaghTuning);
        if (has('cappellaTuning') && config.cappellaTuning) storeVisualizer.handleSetCappellaTuning(config.cappellaTuning);
        if (has('tiltTuning') && config.tiltTuning) storeVisualizer.handleSetTiltTuning(config.tiltTuning);
        if (has('dioramaTuning') && config.dioramaTuning) storeVisualizer.handleSetDioramaTuning(config.dioramaTuning);
        if (has('monetTuning') && config.monetTuning) storeVisualizer.handleSetMonetTuning(config.monetTuning);
        if (has('pendoloTuning') && config.pendoloTuning) storeVisualizer.handleSetPendoloTuning(config.pendoloTuning);
        if (has('sonnetTuning') && config.sonnetTuning) storeVisualizer.handleSetSonnetTuning(config.sonnetTuning);
        if (has('temperaTuning') && config.temperaTuning) storeVisualizer.handleSetTemperaTuning(config.temperaTuning);
        if (has('lumiereTuning') && config.lumiereTuning) storeVisualizer.handleSetLumiereTuning(config.lumiereTuning);
    }

    if (has('monetBackgroundTuning') && config.monetBackgroundTuning) {
        storeVisualizer.handleSetMonetBackgroundTuning(config.monetBackgroundTuning);
    }
    if (has('nomandBackgroundTuning') && config.nomandBackgroundTuning) {
        storeVisualizer.handleSetNomandBackgroundTuning(config.nomandBackgroundTuning);
    }
    if (has('latentBackgroundTuning') && config.latentBackgroundTuning) {
        storeVisualizer.handleSetLatentBackgroundTuning(config.latentBackgroundTuning);
    }
    if (has('soraBackgroundTuning') && config.soraBackgroundTuning) {
        storeVisualizer.handleSetSoraBackgroundTuning(config.soraBackgroundTuning);
    }
    if (has('foliumParams') && config.foliumParams) {
        importFoliumParams(config.foliumParams);
    }

    let mergedUrlList: UrlBackgroundItem[] | undefined;

    if (has('urlBackgroundList') && Array.isArray(config.urlBackgroundList)) {
        // Batch merge: compute the final list once, then apply with a single store update to
        // avoid sequential localStorage writes per item. The plan diffs against this same
        // helper, so the row's count is the count that gets stored.
        mergedUrlList = mergeUrlBackgroundList(storeVisualizer.urlBackgroundList, config.urlBackgroundList);
        storeVisualizer.handleSetUrlBackgroundList(mergedUrlList);
    }
    // Validate that the imported selectedId still exists in the final list
    // to avoid a dangling reference that renders UrlBackgroundLayer blank.
    if (has('urlBackgroundSelectedId') && config.urlBackgroundSelectedId) {
        const list = mergedUrlList ?? storeVisualizer.urlBackgroundList;
        if (list.some(i => i.id === config.urlBackgroundSelectedId)) {
            storeVisualizer.handleSetUrlBackgroundSelectedId(config.urlBackgroundSelectedId);
        }
    }

    if (has('songThemeAutoSwitchEnabled')) {
        theme.onToggleSongThemeAutoSwitch(Boolean(config.songThemeAutoSwitchEnabled));
    }
    if (has('songThemeAutoGenerateEnabled')) {
        theme.onToggleSongThemeAutoGenerate(Boolean(config.songThemeAutoGenerateEnabled));
    }
    if (has('themeGenerationSource') && isThemeGenerationSource(config.themeGenerationSource)) {
        theme.onChangeThemeGenerationSource(config.themeGenerationSource);
    }
    if (has('followSystemTheme')) {
        storeThemeSettings.setFollowSystemTheme(Boolean(config.followSystemTheme));
    }

    // The now playing card. Applied through the store's own setters, the ones its three controls
    // on the 播放页 page use, so an import and a click land in the same place.
    //
    // The mode is checked against the three known values rather than handed straight to the
    // setter: it is persisted verbatim, so an unknown string would be stored and only fall
    // back to 'auto' on the next read - a setting that says one thing and behaves another.
    // A malformed timeout is skipped rather than defaulted, so the import never applies a
    // number that was in neither configuration; the setter clamps the rest to 3-60 itself.
    if (has('stageTrackPillMode')
        && (config.stageTrackPillMode === 'auto'
            || config.stageTrackPillMode === 'always'
            || config.stageTrackPillMode === 'never')) {
        storeStageSettings.handleSetStageTrackPillMode(config.stageTrackPillMode);
    }
    if (has('stageTrackPillTimeoutSec') && Number.isFinite(Number(config.stageTrackPillTimeoutSec))) {
        storeStageSettings.handleSetStageTrackPillTimeoutSec(Number(config.stageTrackPillTimeoutSec));
    }
    if (has('stageTrackPillOnHome')) {
        storeStageSettings.handleToggleStageTrackPillOnHome(Boolean(config.stageTrackPillOnHome));
    }
    // The bravais wall: the collections' stack edges, the seam's material and the picture behind
    // the wall, through the setters the Bravais group on the 主页与歌单 page uses. The seam style
    // is taken only when it is a known preset, as the import plan's guard does.
    const storeLibraryWall = useLibraryWallLookStore.getState();
    if (has('libraryWallStackEdges')) {
        storeLibraryWall.setCollectionStackEdges(Boolean(config.libraryWallStackEdges));
    }
    if (has('libraryWallSeamClear')) {
        storeLibraryWall.setSeamClear(Boolean(config.libraryWallSeamClear));
    }
    if (has('libraryWallSeamStyle') && isLibraryWallSeamStyle(config.libraryWallSeamStyle)) {
        storeLibraryWall.setSeamStyle(config.libraryWallSeamStyle);
    }
    if (has('libraryWallBackdropLyrics')) {
        storeLibraryWall.setBackdropLyrics(Boolean(config.libraryWallBackdropLyrics));
    }
    if (has('libraryWallBackdropBlur')) {
        storeLibraryWall.setBackdropBlur(Boolean(config.libraryWallBackdropBlur));
    }
};
