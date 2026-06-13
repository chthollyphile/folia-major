import React, { useState } from 'react';
import { Monitor, Palette, Settings2, LayoutGrid, Download, Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { DualTheme, Theme, ThemeMode, UrlBackgroundItem } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { sanitizeUrlBackgroundItem } from '../../../utils/urlBackground';

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
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    onToggleSongThemeAutoSwitch: (enabled: boolean) => void;
    onToggleTransparentPlayerBackground: (enabled: boolean) => void;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    settingsCardClass: string;
    songThemeAutoSwitchEnabled: boolean;
    theme?: Theme;
    themeParkInitialTheme: DualTheme;
    toggleOffBackgroundClass: string;
    transparentPlayerBackground: boolean;
    utilityGhostButtonClass: string;
    homeLayoutStyle: 'carousel' | 'grid';
    onChangeHomeLayoutStyle: (style: 'carousel' | 'grid') => void;
    grid3dCardStyle: 'image' | 'card';
    onChangeGrid3dCardStyle: (style: 'image' | 'card') => void;
    aiTheme?: DualTheme | null;
    customTheme?: DualTheme | null;
};

// ==========================================
// Mappers and Compression Helpers
// ==========================================

export const compressTheme = (t: Theme): any => ({
    n: t.name,
    bg: t.backgroundColor,
    pc: t.primaryColor,
    ac: t.accentColor,
    sc: t.secondaryColor,
    tfs: t.fontStyle,
    tff: t.fontFamily,
    ai: t.animationIntensity,
    wc: t.wordColors,
    li: t.lyricsIcons,
    pv: t.provider,
    tds: t.description,
});

export const decompressTheme = (o: any): Theme => ({
    name: o.n || 'Imported Theme',
    backgroundColor: o.bg || '#000000',
    primaryColor: o.pc || '#ffffff',
    accentColor: o.ac || '#ffffff',
    secondaryColor: o.sc || '#888888',
    fontStyle: o.tfs || 'sans',
    fontFamily: o.tff,
    animationIntensity: o.ai || 'normal',
    wordColors: o.wc || [],
    lyricsIcons: o.li || [],
    provider: o.pv,
    description: o.tds || '',
});

const compressClassic = (t: any): any => ({
    ewr: t.enableWordRotation,
    bfm: t.breathingFloatMultiplier,
    ull: t.useLegacyLayout,
    cws: t.wordSpacing,
});
const decompressClassic = (o: any): any => ({
    enableWordRotation: o.ewr !== undefined ? o.ewr : true,
    breathingFloatMultiplier: o.bfm !== undefined ? o.bfm : 1,
    useLegacyLayout: o.ull,
    wordSpacing: o.cws,
});

const compressCadenza = (t: any): any => ({
    cfs: t.fontScale,
    wr: t.widthRatio,
    ma: t.motionAmount,
    gi: t.glowIntensity,
    bi: t.beamIntensity,
});
const decompressCadenza = (o: any): any => ({
    fontScale: o.cfs !== undefined ? o.cfs : 1.12,
    widthRatio: o.wr !== undefined ? o.wr : 0.72,
    motionAmount: o.ma !== undefined ? o.ma : 1,
    glowIntensity: o.gi !== undefined ? o.gi : 1,
    beamIntensity: o.bi !== undefined ? o.bi : 0,
});

const compressPartita = (t: any): any => ({
    sgl: t.showGuideLines,
    usl: t.useSemanticLayout,
    smi: t.staggerMin,
    sma: t.staggerMax,
});
const decompressPartita = (o: any): any => ({
    showGuideLines: o.sgl !== undefined ? o.sgl : true,
    useSemanticLayout: o.usl !== undefined ? o.usl : true,
    staggerMin: o.smi !== undefined ? o.smi : 20,
    staggerMax: o.sma !== undefined ? o.sma : 100,
});

const compressFume = (t: any): any => ({
    hps: t.hidePrintSymbols,
    dgb: t.disableGeometricBackground,
    boo: t.backgroundObjectOpacity,
    thr: t.textHoldRatio,
    ctm: t.cameraTrackingMode,
    csp: t.cameraSpeed,
    gi: t.glowIntensity,
    hs: t.heroScale,
});
const decompressFume = (o: any): any => ({
    hidePrintSymbols: o.hps !== undefined ? o.hps : false,
    disableGeometricBackground: o.dgb !== undefined ? o.dgb : true,
    backgroundObjectOpacity: o.boo !== undefined ? o.boo : 0.5,
    textHoldRatio: o.thr !== undefined ? o.thr : 1,
    cameraTrackingMode: o.ctm || 'smooth',
    cameraSpeed: o.csp !== undefined ? o.csp : 1,
    glowIntensity: o.gi !== undefined ? o.gi : 1,
    heroScale: o.hs !== undefined ? o.hs : 1,
});

const compressCappella = (t: any): any => ({
    sem: t.showEmoMessages,
    eps: t.emojiPackSource,
    as: t.avatarSource,
});
const decompressCappella = (o: any): any => ({
    showEmoMessages: o.sem !== undefined ? o.sem : true,
    emojiPackSource: o.eps || 'builtin',
    avatarSource: o.as || 'cover',
});

const compressTilt = (t: any): any => ({
    sp: t.splitProbability,
    tsp: t.tiltStyleProbability,
    tcs: t.colorScheme,
});
const decompressTilt = (o: any): any => ({
    splitProbability: o.sp !== undefined ? o.sp : 0.75,
    tiltStyleProbability: o.tsp !== undefined ? o.tsp : 0.35,
    colorScheme: o.tcs || 'default',
});

const compressMonetBackground = (t: any): any => ({
    mbs: t.backgroundSource,
    mbl: t.backgroundLayout,
    mbb: t.backgroundBlurPx,
    mbo: t.backgroundOverlayOpacity,
    mbg: t.backgroundGrayscale,
    mbsat: t.backgroundSaturation,
    mbw: t.backgroundWash,
    mbh: t.backgroundHalfPaneOffsetX,
    mbwcm: t.backgroundWashColorMode,
    mbwcc: t.backgroundWashCustomColor,
});
const decompressMonetBackground = (o: any): any => ({
    backgroundSource: o.mbs || 'cover-derived',
    backgroundLayout: o.mbl || 'half-pane-gradient',
    backgroundBlurPx: o.mbb !== undefined ? o.mbb : 2,
    backgroundOverlayOpacity: o.mbo !== undefined ? o.mbo : 0.42,
    backgroundGrayscale: o.mbg !== undefined ? o.mbg : 0,
    backgroundSaturation: o.mbsat !== undefined ? o.mbsat : 1.05,
    backgroundWash: o.mbw !== undefined ? o.mbw : 0.16,
    backgroundHalfPaneOffsetX: o.mbh !== undefined ? o.mbh : 0,
    backgroundWashColorMode: o.mbwcm || 'theme',
    backgroundWashCustomColor: o.mbwcc || '#8fb7ff',
});

const compressMonet = (t: any): any => ({
    kce: t.keywordColoringEnabled,
    msd: t.showDescription,
    mas: t.audioStyle,
    mfs: t.fontScale,
    mps: t.portraitSource,
    pox: t.portraitOffsetX,
    mpy: t.portraitStyle,
});
const decompressMonet = (o: any): any => ({
    keywordColoringEnabled: o.kce !== undefined ? o.kce : true,
    showDescription: o.msd !== undefined ? o.msd : true,
    audioStyle: o.mas || 'bar',
    fontScale: o.mfs !== undefined ? o.mfs : 1.0,
    portraitSource: o.mps || 'cover',
    portraitOffsetX: o.pox !== undefined ? o.pox : 0,
    portraitStyle: o.mpy || 'rectangular',
});

export const compressConfig = (config: any): string => {
    const minified: any = {};
    if (config.theme) {
        minified.t = {
            l: compressTheme(config.theme.light),
            d: compressTheme(config.theme.dark),
        };
    }
    if (config.visualizerMode) minified.vm = config.visualizerMode;
    if (config.visualizerBackgroundMode) minified.vbm = config.visualizerBackgroundMode;
    if (config.backgroundOpacity !== undefined) minified.bo = config.backgroundOpacity;
    if (config.visualizerOpacity !== undefined) minified.vo = config.visualizerOpacity;
    if (config.lyricsFontStyle) minified.lfs = config.lyricsFontStyle;
    if (config.lyricsFontScale !== undefined) minified.lfn = config.lyricsFontScale;

    if (config.classicTuning) minified.ct = compressClassic(config.classicTuning);
    if (config.cadenzaTuning) minified.cat = compressCadenza(config.cadenzaTuning);
    if (config.partitaTuning) minified.pt = compressPartita(config.partitaTuning);
    if (config.fumeTuning) minified.ft = compressFume(config.fumeTuning);
    if (config.cappellaTuning) minified.cpt = compressCappella(config.cappellaTuning);
    if (config.tiltTuning) minified.tt = compressTilt(config.tiltTuning);
    if (config.monetBackgroundTuning) minified.mbt = compressMonetBackground(config.monetBackgroundTuning);
    if (config.monetTuning) minified.mt = compressMonet(config.monetTuning);
    if (config.urlBackgroundList) minified.ubl = config.urlBackgroundList;
    if (config.urlBackgroundSelectedId) minified.ubid = config.urlBackgroundSelectedId;

    const jsonStr = JSON.stringify(minified);
    const bytes = new TextEncoder().encode(jsonStr);
    const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    const base64 = btoa(binaryString);
    return `folia-theme://${base64}`;
};

/**
 * Decodes and restores a configuration object from either raw JSON or a compressed base64 string starting with 'folia-theme://'.
 */
export const decompressConfig = (str: string): any => {
    let parsed: any = null;
    const trimmed = str.trim();
    if (trimmed.startsWith('folia-theme://')) {
        const base64 = trimmed.slice('folia-theme://'.length);
        const binaryString = atob(base64);
        const bytes = Uint8Array.from(binaryString, char => char.charCodeAt(0));
        const jsonStr = new TextDecoder().decode(bytes);
        parsed = JSON.parse(jsonStr);
    } else {
        parsed = JSON.parse(trimmed);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Invalid format');
    }

    const isMinified = parsed.t !== undefined || parsed.vm !== undefined || parsed.ct !== undefined || parsed.cat !== undefined;
    if (isMinified) {
        const decompressed: any = {};
        if (parsed.t) {
            decompressed.theme = {
                light: decompressTheme(parsed.t.l),
                dark: decompressTheme(parsed.t.d),
            };
        }
        if (parsed.vm) decompressed.visualizerMode = parsed.vm;
        if (parsed.vbm) decompressed.visualizerBackgroundMode = parsed.vbm;
        if (parsed.bo !== undefined) decompressed.backgroundOpacity = parsed.bo;
        if (parsed.vo !== undefined) decompressed.visualizerOpacity = parsed.vo;
        if (parsed.lfs) decompressed.lyricsFontStyle = parsed.lfs;
        if (parsed.lfn !== undefined) decompressed.lyricsFontScale = parsed.lfn;

        if (parsed.ct) decompressed.classicTuning = decompressClassic(parsed.ct);
        if (parsed.cat) decompressed.cadenzaTuning = decompressCadenza(parsed.cat);
        if (parsed.pt) decompressed.partitaTuning = decompressPartita(parsed.pt);
        if (parsed.ft) decompressed.fumeTuning = decompressFume(parsed.ft);
        if (parsed.cpt) decompressed.cappellaTuning = decompressCappella(parsed.cpt);
        if (parsed.tt) decompressed.tiltTuning = decompressTilt(parsed.tt);
        if (parsed.mbt) decompressed.monetBackgroundTuning = decompressMonetBackground(parsed.mbt);
        if (parsed.mt) decompressed.monetTuning = decompressMonet(parsed.mt);
        if (parsed.ubl) decompressed.urlBackgroundList = parsed.ubl;
        if (parsed.ubid) decompressed.urlBackgroundSelectedId = parsed.ubid;

        return decompressed;
    } else {
        const validKeys = [
            'theme', 'visualizerMode', 'visualizerBackgroundMode', 'backgroundOpacity',
            'visualizerOpacity', 'lyricsFontStyle', 'lyricsFontScale', 'classicTuning',
            'cadenzaTuning', 'partitaTuning', 'fumeTuning', 'cappellaTuning',
            'tiltTuning', 'monetBackgroundTuning', 'monetTuning',
            'urlBackgroundList', 'urlBackgroundSelectedId'
        ];
        const hasValidKey = validKeys.some(k => parsed[k] !== undefined);
        if (!hasValidKey) {
            throw new Error('Invalid visual settings configuration');
        }
        return parsed;
    }
};

const readSavedCustomTheme = (): DualTheme | undefined => {
    if (typeof window === 'undefined') return undefined;
    const saved = localStorage.getItem('custom_dual_theme');
    if (!saved) return undefined;
    try {
        return JSON.parse(saved) as DualTheme;
    } catch {
        return undefined;
    }
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
    onToggleCustomThemePreferred,
    onToggleSongThemeAutoSwitch,
    onToggleTransparentPlayerBackground,
    onSaveCustomTheme,
    settingsCardClass,
    songThemeAutoSwitchEnabled,
    theme,
    themeParkInitialTheme,
    toggleOffBackgroundClass,
    transparentPlayerBackground,
    utilityGhostButtonClass,
    homeLayoutStyle,
    onChangeHomeLayoutStyle,
    grid3dCardStyle,
    onChangeGrid3dCardStyle,
    aiTheme,
    customTheme,
}) => {
    const { t } = useTranslation();
    const [importText, setImportText] = useState('');
    const [copiedType, setCopiedType] = useState<'none' | 'shortcode' | 'json'>('none');

    const [exportThemeType, setExportThemeType] = useState<'custom' | 'ai' | 'none'>(() => {
        if (bgMode === 'ai' && aiTheme) return 'ai';
        if (customTheme) return 'custom';
        return 'none';
    });

    React.useEffect(() => {
        if (bgMode === 'ai' && aiTheme) {
            setExportThemeType('ai');
        } else if (customTheme) {
            setExportThemeType('custom');
        } else {
            setExportThemeType('none');
        }
    }, [aiTheme, customTheme, bgMode]);

    // Access ZUSTAND settings store directly for setters & configurations
    const store = useSettingsUiStore(useShallow(state => ({
        statusSetter: state.statusSetter,
        visualizerMode: state.visualizerMode,
        visualizerBackgroundMode: state.visualizerBackgroundMode,
        backgroundOpacity: state.backgroundOpacity,
        visualizerOpacity: state.visualizerOpacity,
        lyricsFontStyle: state.lyricsFontStyle,
        lyricsFontScale: state.lyricsFontScale,
        classicTuning: state.classicTuning,
        cadenzaTuning: state.cadenzaTuning,
        partitaTuning: state.partitaTuning,
        fumeTuning: state.fumeTuning,
        cappellaTuning: state.cappellaTuning,
        tiltTuning: state.tiltTuning,
        monetBackgroundTuning: state.monetBackgroundTuning,
        monetTuning: state.monetTuning,
        urlBackgroundList: state.urlBackgroundList,
        urlBackgroundSelectedId: state.urlBackgroundSelectedId,

        handleSetVisualizerMode: state.handleSetVisualizerMode,
        handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
        handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
        handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
        handleSetLyricsFontStyle: state.handleSetLyricsFontStyle,
        handleSetLyricsFontScale: state.handleSetLyricsFontScale,
        handleSetClassicTuning: state.handleSetClassicTuning,
        handleSetCadenzaTuning: state.handleSetCadenzaTuning,
        handleSetPartitaTuning: state.handleSetPartitaTuning,
        handleSetFumeTuning: state.handleSetFumeTuning,
        handleSetCappellaTuning: state.handleSetCappellaTuning,
        handleSetTiltTuning: state.handleSetTiltTuning,
        handleSetMonetBackgroundTuning: state.handleSetMonetBackgroundTuning,
        handleSetMonetTuning: state.handleSetMonetTuning,
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

    const buildCurrentConfig = () => {
        let exportTheme: DualTheme | null = null;
        if (exportThemeType === 'custom') {
            exportTheme = customTheme || readSavedCustomTheme() || null;
        } else if (exportThemeType === 'ai') {
            exportTheme = aiTheme || null;
        }
        return {
            theme: exportTheme,
            visualizerMode: store.visualizerMode,
            visualizerBackgroundMode: store.visualizerBackgroundMode,
            backgroundOpacity: store.backgroundOpacity,
            visualizerOpacity: store.visualizerOpacity,
            lyricsFontStyle: store.lyricsFontStyle,
            lyricsFontScale: store.lyricsFontScale,
            classicTuning: store.classicTuning,
            cadenzaTuning: store.cadenzaTuning,
            partitaTuning: store.partitaTuning,
            fumeTuning: store.fumeTuning,
            cappellaTuning: store.cappellaTuning,
            tiltTuning: store.tiltTuning,
            monetBackgroundTuning: store.monetBackgroundTuning,
            monetTuning: store.monetTuning,
            urlBackgroundList: store.urlBackgroundList,
            urlBackgroundSelectedId: store.urlBackgroundSelectedId,
        };
    };

    const handleCopyShortcode = async () => {
        const config = buildCurrentConfig();
        const code = compressConfig(config);
        try {
            await navigator.clipboard.writeText(code);
            setCopiedType('shortcode');
            setTimeout(() => setCopiedType('none'), 2000);
            store.statusSetter?.({ type: 'success', text: t('status.copied') || '已复制' });
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
            store.statusSetter?.({ type: 'success', text: t('status.copied') || '已复制' });
        } catch (err) {
            console.error('Failed to copy JSON:', err);
        }
    };

    const handleImportConfig = () => {
        if (!importText.trim()) return;
        try {
            const config = decompressConfig(importText);

            // 1. Restore Theme
            if (config.theme) {
                onSaveCustomTheme(config.theme);
                onApplyCustomTheme();
            }

            // 2. Restore Visualizer Setup
            if (config.visualizerMode) {
                store.handleSetVisualizerMode(config.visualizerMode);
            }
            if (config.visualizerBackgroundMode) {
                store.handleSetVisualizerBackgroundMode(config.visualizerBackgroundMode);
            }
            if (config.backgroundOpacity !== undefined) {
                store.handleSetBackgroundOpacity(config.backgroundOpacity);
            }
            if (config.visualizerOpacity !== undefined) {
                store.handleSetVisualizerOpacity(config.visualizerOpacity);
            }
            if (config.lyricsFontStyle) {
                store.handleSetLyricsFontStyle(config.lyricsFontStyle);
            }
            if (config.lyricsFontScale !== undefined) {
                store.handleSetLyricsFontScale(config.lyricsFontScale);
            }

            // Tunings
            if (config.classicTuning) {
                store.handleSetClassicTuning(config.classicTuning);
            }
            if (config.cadenzaTuning) {
                store.handleSetCadenzaTuning(config.cadenzaTuning);
            }
            if (config.partitaTuning) {
                store.handleSetPartitaTuning(config.partitaTuning);
            }
            if (config.fumeTuning) {
                store.handleSetFumeTuning(config.fumeTuning);
            }
            if (config.cappellaTuning) {
                store.handleSetCappellaTuning(config.cappellaTuning);
            }
            if (config.tiltTuning) {
                store.handleSetTiltTuning(config.tiltTuning);
            }
            if (config.monetBackgroundTuning) {
                store.handleSetMonetBackgroundTuning(config.monetBackgroundTuning);
            }
            if (config.monetTuning) {
                store.handleSetMonetTuning(config.monetTuning);
            }
            let mergedUrlList: UrlBackgroundItem[] | undefined;

            if (config.urlBackgroundList && Array.isArray(config.urlBackgroundList)) {
                // Batch merge: compute the final list once, then apply with a single
                // store update to avoid sequential localStorage writes per item.
                const existingMap = new Map(store.urlBackgroundList.map(i => [i.id, { ...i }]));
                for (const item of config.urlBackgroundList) {
                    const sanitized = sanitizeUrlBackgroundItem(item);
                    if (!sanitized) {
                        continue;
                    }

                    const existing = existingMap.get(sanitized.id);
                    existingMap.set(sanitized.id, {
                        ...(existing ?? { id: sanitized.id }),
                        url: sanitized.url,
                        note: sanitized.note,
                    });
                }
                mergedUrlList = Array.from(existingMap.values());
                store.handleSetUrlBackgroundList(mergedUrlList);
            }
            // Validate that the imported selectedId still exists in the final list
            // to avoid a dangling reference that renders UrlBackgroundLayer blank.
            if (config.urlBackgroundSelectedId) {
                const list = mergedUrlList ?? store.urlBackgroundList;
                if (list.some(i => i.id === config.urlBackgroundSelectedId)) {
                    store.handleSetUrlBackgroundSelectedId(config.urlBackgroundSelectedId);
                }
            }

            store.statusSetter?.({ type: 'success', text: t('options.importSuccess') || '配置导入成功！' });
            setImportText('');
        } catch (err) {
            console.error('Import settings failed:', err);
            store.statusSetter?.({ type: 'error', text: t('options.importFailed') || '配置导入失败，请检查格式是否正确。' });
        }
    };

    return (
        <div className="space-y-6">
            {/* Section 1: Theme presets and edit options */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Palette size={14} /> {t('options.themePresets') || '主题与配色'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.themePresets') || '主题配色预设'}
                        </div>
                        <button
                            type="button"
                            onClick={onOpenThemePark}
                            className={`shrink-0 w-9 h-9 rounded-full border transition-colors flex items-center justify-center ${utilityGhostButtonClass}`}
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
                                {t('options.preferCustomTheme') || '优先使用自定义主题'}
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.preferCustomThemeDesc') || '保存后，后续主题切换会优先保留自定义主题。'}
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
                                {t('options.autoSwitchSongTheme') || '主题自动切换'}
                            </div>
                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.autoSwitchSongThemeDesc') || '当切换到的歌曲曾经生成过 AI 主题的时候，自动应用 AI 主题。'}
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
                </div>
            </section>

            {/* Section 2: Lyrics Animation & Player View */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Monitor size={14} /> {t('options.lyricsRenderer') || '歌词与播放页'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.lyricsRenderer') || '歌词动画'}
                        </div>
                        <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.lyricsRendererDesc') || '选择播放页使用的歌词渲染模式。'}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onOpenVisPlayground}
                        className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors ${utilityGhostButtonClass}`}
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <Settings2 size={16} />
                        <span>{t('options.lyricsAnimationAdjust') || '歌词动画样式'}</span>
                    </button>
                    <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-4">
                        <div className="space-y-1">
                            <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                {t('options.transparentPlayerBackground') || '播放页透明背景'}
                            </div>
                            <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.transparentPlayerBackgroundDesc') || '仅对播放页生效。开启后会切换到透明窗口模式，适合 OBS 抠像。'}
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
                </div>
            </section>

            {/* Section 3: Home Layout styles */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <LayoutGrid size={14} /> {t('options.homeLayoutStyle') || '主页布局与风格'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                            {t('options.homeLayoutStyle') || '首页布局样式'}
                        </div>
                        <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.homeLayoutStyleDesc') || '选择首页展示的样式风格：经典(旧版)或万象(新版)透明桌面（支持拍立得单曲网格）。'}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            onClick={() => onChangeHomeLayoutStyle('carousel')}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                            style={getAccentOptionStyle(homeLayoutStyle === 'carousel')}
                        >
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.homeLayoutStyleCarousel') || '经典(旧版)'}
                            </span>
                        </button>
                        <button
                            onClick={() => onChangeHomeLayoutStyle('grid')}
                            className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                            style={getAccentOptionStyle(homeLayoutStyle === 'grid')}
                        >
                            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                {t('options.homeLayoutStyleGrid') || '万象(新版)'}
                            </span>
                        </button>
                    </div>

                    {homeLayoutStyle === 'grid' && (
                        <div className="pt-4 border-t border-white/5 space-y-3">
                            <div className="space-y-1">
                                <div className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                                    {t('options.grid3dCardStyle') || '3D 网格卡片样式'}
                                </div>
                                <div className="text-xs opacity-50 max-w-[360px]" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.grid3dCardStyleDesc') || '选择 3D 网格中每张卡片的外观：纯图片封面或经典的拍立得文本卡片。'}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mt-1">
                                <button
                                    onClick={() => onChangeGrid3dCardStyle('image')}
                                    className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                                    style={getAccentOptionStyle(grid3dCardStyle === 'image')}
                                >
                                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.grid3dCardStyleImage') || '纯图片封面'}
                                    </span>
                                </button>
                                <button
                                    onClick={() => onChangeGrid3dCardStyle('card')}
                                    className="flex flex-col items-center gap-2 p-3 rounded-lg border transition-all"
                                    style={getAccentOptionStyle(grid3dCardStyle === 'card')}
                                >
                                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.grid3dCardStyleCard') || '拍立得卡片'}
                                    </span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* Section 4: Configurations Import/Export (New feature) */}
            <section>
                <h3 className="text-sm font-bold uppercase tracking-wider opacity-50 mb-3 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Settings2 size={14} /> {t('options.importExportTitle') || '备份与导入'}
                </h3>
                <div className={`p-4 rounded-xl border space-y-4 ${settingsCardClass}`}>
                    <div className="space-y-1">
                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                            {t('options.importExportTitle') || '备份与导入配置'}
                        </div>
                        <div className="text-xs opacity-50 max-w-[400px]" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.importExportDesc') || '通过标准 JSON 或 folia-theme 文本导入/导出配色主题与歌词动画设置。'}
                        </div>
                    </div>

                    <div className="space-y-1.5 pt-1">
                        <div className="text-xs font-semibold opacity-60" style={{ color: 'var(--text-secondary)' }}>
                            {t('options.exportThemeLabel') || '导出时包含的主题'}
                        </div>
                        <div className="flex flex-wrap gap-2 mt-1">
                            {aiTheme && (
                                <button
                                    type="button"
                                    onClick={() => setExportThemeType('ai')}
                                    className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                    style={getAccentOptionStyle(exportThemeType === 'ai')}
                                >
                                    <Palette size={12} className="opacity-70" />
                                    <span>{t('options.exportAiTheme') || 'AI 主题'}: {aiTheme.light.name || 'AI'}</span>
                                </button>
                            )}
                            {customTheme && (
                                <button
                                    type="button"
                                    onClick={() => setExportThemeType('custom')}
                                    className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                    style={getAccentOptionStyle(exportThemeType === 'custom')}
                                >
                                    <Palette size={12} className="opacity-70" />
                                    <span>{t('options.exportCustomTheme') || '自定义主题'}: {customTheme.light.name || 'Custom'}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setExportThemeType('none')}
                                className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                style={getAccentOptionStyle(exportThemeType === 'none')}
                            >
                                <Settings2 size={12} className="opacity-70" />
                                <span>{t('options.exportNoTheme') || '不包含主题'}</span>
                            </button>
                        </div>
                    </div>

                    <textarea
                        value={importText}
                        onChange={(e) => setImportText(e.target.value)}
                        placeholder={t('options.importPlaceholder') || '在此处粘贴备份文本，或直接输入标准 JSON...'}
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
                            <span>{copiedType === 'shortcode' ? (t('status.copied') || '已复制') : (t('options.exportBtn') || '复制配置码')}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleCopyJson}
                            className="px-3 py-2 bg-white/10 hover:bg-white/15 active:bg-white/5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            {copiedType === 'json' ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                            <span>{copiedType === 'json' ? (t('status.copied') || '已复制') : '复制 JSON'}</span>
                        </button>
                        <div className="flex-1 min-w-[20px]" />
                        <button
                            type="button"
                            onClick={handleImportConfig}
                            disabled={!importText.trim()}
                            className="px-4 py-2 bg-white/20 hover:bg-white/25 active:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                            style={{ color: 'var(--text-primary)', borderColor: accentOutlineColor }}
                        >
                            <Download size={13} />
                            <span>{t('options.importBtn') || '导入配置'}</span>
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default AppearanceSettingsSubview;
