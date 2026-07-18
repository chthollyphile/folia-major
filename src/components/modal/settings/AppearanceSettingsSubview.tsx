import React, { useState } from 'react';
import { Monitor, Palette, Settings2, LayoutGrid, Download, Copy, Check, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import {
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_LATENT_BACKGROUND_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_NOMAND_BACKGROUND_TUNING,
    type DualTheme,
    type Theme,
    type ThemeMode,
    type UrlBackgroundItem,
} from '../../../types';
import { applyVisualizerTuningsToSettings, collectVisualizerTunings } from '../../visualizer/tuningRegistry';
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

const compressCladdagh = (t: any): any => ({
    fsr: t.focusScaleRatio,
    rs: t.radiusScale,
    etd: t.ellipseTiltDeg,
});
const decompressCladdagh = (o: any): any => ({
    focusScaleRatio: o.fsr !== undefined ? o.fsr : DEFAULT_CLADDAGH_TUNING.focusScaleRatio,
    radiusScale: o.rs !== undefined ? o.rs : DEFAULT_CLADDAGH_TUNING.radiusScale,
    ellipseTiltDeg: o.etd !== undefined ? o.etd : DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg,
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

const compressDiorama = (t: any): any => ({
    cs: t.cameraSpeed,
    ma: t.motionAmount,
    ar: t.audioReactivity,
    gv: t.geometryVisibility ? {
        e: t.geometryVisibility.enabled,
        m: t.geometryVisibility.mode,
        s: t.geometryVisibility.strands,
        b: t.geometryVisibility.blobs,
        r: t.geometryVisibility.ribbons,
        o: t.geometryVisibility.rings,
    } : undefined,
    pd: t.particleDensity,
        psz: t.particleScale,
    pge: t.particleGlowEnabled,
    pgi: t.particleGlowIntensity,
    spa: t.showParticles,
    bpc: t.backgroundParticleCircumference,
    bpr: t.backgroundParticleRadial,
    ge: t.glowEnabled,
    gi: t.glowIntensity,
    se: t.soulEnabled,
    si: t.soulIntensity,
    sae: t.soulActiveEnabled,
    gre: t.gradientEnabled,
    gri: t.gradientIntensity,
    kce: t.keywordColoringEnabled,
});
const decompressDiorama = (o: any): any => ({
    cameraSpeed: o.cs !== undefined ? o.cs : DEFAULT_DIORAMA_TUNING.cameraSpeed,
    motionAmount: o.ma !== undefined ? o.ma : DEFAULT_DIORAMA_TUNING.motionAmount,
    audioReactivity: o.ar !== undefined ? o.ar : DEFAULT_DIORAMA_TUNING.audioReactivity,
    geometryVisibility: {
        enabled: o.gv?.e !== undefined ? o.gv.e : DEFAULT_DIORAMA_TUNING.geometryVisibility.enabled,
        mode: o.gv?.m !== undefined ? o.gv.m : DEFAULT_DIORAMA_TUNING.geometryVisibility.mode,
        strands: o.gv?.s !== undefined ? o.gv.s : DEFAULT_DIORAMA_TUNING.geometryVisibility.strands,
        blobs: o.gv?.b !== undefined ? o.gv.b : DEFAULT_DIORAMA_TUNING.geometryVisibility.blobs,
        ribbons: o.gv?.r !== undefined ? o.gv.r : DEFAULT_DIORAMA_TUNING.geometryVisibility.ribbons,
        rings: o.gv?.o !== undefined ? o.gv.o : DEFAULT_DIORAMA_TUNING.geometryVisibility.rings,
    },
    particleDensity: o.pd !== undefined ? o.pd : DEFAULT_DIORAMA_TUNING.particleDensity,
        particleScale: o.psz !== undefined ? o.psz : DEFAULT_DIORAMA_TUNING.particleScale,
    particleGlowEnabled: o.pge !== undefined ? o.pge : DEFAULT_DIORAMA_TUNING.particleGlowEnabled,
    particleGlowIntensity: o.pgi !== undefined ? o.pgi : DEFAULT_DIORAMA_TUNING.particleGlowIntensity,
    showParticles: o.spa !== undefined ? o.spa : DEFAULT_DIORAMA_TUNING.showParticles,
    backgroundParticleCircumference: o.bpc !== undefined ? o.bpc : DEFAULT_DIORAMA_TUNING.backgroundParticleCircumference,
    backgroundParticleRadial: o.bpr !== undefined ? o.bpr : DEFAULT_DIORAMA_TUNING.backgroundParticleRadial,
    glowEnabled: o.ge !== undefined ? o.ge : DEFAULT_DIORAMA_TUNING.glowEnabled,
    glowIntensity: o.gi !== undefined ? o.gi : DEFAULT_DIORAMA_TUNING.glowIntensity,
    soulEnabled: o.se !== undefined ? o.se : DEFAULT_DIORAMA_TUNING.soulEnabled,
    soulIntensity: o.si !== undefined ? o.si : DEFAULT_DIORAMA_TUNING.soulIntensity,
    soulActiveEnabled: o.sae !== undefined ? o.sae : DEFAULT_DIORAMA_TUNING.soulActiveEnabled,
    gradientEnabled: o.gre !== undefined ? o.gre : DEFAULT_DIORAMA_TUNING.gradientEnabled,
    gradientIntensity: o.gri !== undefined ? o.gri : DEFAULT_DIORAMA_TUNING.gradientIntensity,
    keywordColoringEnabled: o.kce !== undefined ? o.kce : DEFAULT_DIORAMA_TUNING.keywordColoringEnabled,
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
    backgroundSource: o.mbs || DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource,
    backgroundLayout: o.mbl || DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout,
    backgroundBlurPx: o.mbb !== undefined ? o.mbb : DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
    backgroundOverlayOpacity: o.mbo !== undefined ? o.mbo : DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
    backgroundGrayscale: o.mbg !== undefined ? o.mbg : DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
    backgroundSaturation: o.mbsat !== undefined ? o.mbsat : DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
    backgroundWash: o.mbw !== undefined ? o.mbw : DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
    backgroundHalfPaneOffsetX: o.mbh !== undefined ? o.mbh : DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
    backgroundWashColorMode: o.mbwcm || DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode,
    backgroundWashCustomColor: o.mbwcc || DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
});

const compressNomandBackground = (t: any): any => ({
    is: t.imageSource,
    dt: t.ditheringType,
    s: t.size,
    cs: t.colorSteps,
    oc: t.originalColors,
    i: t.inverted,
    oe: t.overlayEnabled,
    oo: t.overlayOpacity,
});
const decompressNomandBackground = (o: any): any => ({
    imageSource: o.is || DEFAULT_NOMAND_BACKGROUND_TUNING.imageSource,
    ditheringType: o.dt === '2x2' || o.dt === '4x4' || o.dt === '8x8'
        ? o.dt
        : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType,
    size: o.s !== undefined ? o.s : DEFAULT_NOMAND_BACKGROUND_TUNING.size,
    colorSteps: o.cs !== undefined ? o.cs : DEFAULT_NOMAND_BACKGROUND_TUNING.colorSteps,
    originalColors: o.oc !== undefined ? o.oc : DEFAULT_NOMAND_BACKGROUND_TUNING.originalColors,
    inverted: o.i !== undefined ? o.i : DEFAULT_NOMAND_BACKGROUND_TUNING.inverted,
    overlayEnabled: o.oe !== undefined ? o.oe : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: o.oo !== undefined ? o.oo : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayOpacity,
});

const compressLatentBackground = (t: any): any => ({
    dm: t.displayMode,
    cs: t.colorSource,
    dopv: t.dynamicOnlyInPlayer,
    ebr: t.enhancedBeatResponse,
    ds: t.ditheringSpeed,
    das: t.ditheringAudioSpeed,
    dz: t.ditheringSize,
    dop: t.ditheringOpacity,
    ms: t.meshSpeed,
    mas: t.meshAudioSpeed,
    md: t.meshDistortion,
    mw: t.meshSwirl,
    oe: t.overlayEnabled,
    oo: t.overlayOpacity,
});
const decompressLatentBackground = (o: any): any => ({
    displayMode: o.dm || DEFAULT_LATENT_BACKGROUND_TUNING.displayMode,
    colorSource: o.cs || DEFAULT_LATENT_BACKGROUND_TUNING.colorSource,
    dynamicOnlyInPlayer: o.dopv !== undefined
        ? o.dopv
        : DEFAULT_LATENT_BACKGROUND_TUNING.dynamicOnlyInPlayer,
    enhancedBeatResponse: o.ebr !== undefined
        ? o.ebr
        : DEFAULT_LATENT_BACKGROUND_TUNING.enhancedBeatResponse,
    ditheringSpeed: o.ds !== undefined ? o.ds : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSpeed,
    ditheringAudioSpeed: o.das !== undefined ? o.das : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringAudioSpeed,
    ditheringSize: o.dz !== undefined ? o.dz : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSize,
    ditheringOpacity: o.dop !== undefined ? o.dop : DEFAULT_LATENT_BACKGROUND_TUNING.ditheringOpacity,
    meshSpeed: o.ms !== undefined ? o.ms : DEFAULT_LATENT_BACKGROUND_TUNING.meshSpeed,
    meshAudioSpeed: o.mas !== undefined ? o.mas : DEFAULT_LATENT_BACKGROUND_TUNING.meshAudioSpeed,
    meshDistortion: o.md !== undefined ? o.md : DEFAULT_LATENT_BACKGROUND_TUNING.meshDistortion,
    meshSwirl: o.mw !== undefined ? o.mw : DEFAULT_LATENT_BACKGROUND_TUNING.meshSwirl,
    overlayEnabled: o.oe !== undefined ? o.oe : DEFAULT_LATENT_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: o.oo !== undefined ? o.oo : DEFAULT_LATENT_BACKGROUND_TUNING.overlayOpacity,
});

const compressMonet = (t: any): any => ({
    kce: t.keywordColoringEnabled,
    msd: t.showDescription,
    mas: t.audioStyle,
    mfs: t.fontScale,
    mps: t.portraitSource,
    pox: t.portraitOffsetX,
    mpy: t.portraitStyle,
    mpdh: t.showPortraitDragHanger,
});
const decompressMonet = (o: any): any => ({
    keywordColoringEnabled: o.kce !== undefined ? o.kce : DEFAULT_MONET_TUNING.keywordColoringEnabled,
    showDescription: o.msd !== undefined ? o.msd : DEFAULT_MONET_TUNING.showDescription,
    audioStyle: o.mas || DEFAULT_MONET_TUNING.audioStyle,
    fontScale: o.mfs !== undefined ? o.mfs : DEFAULT_MONET_TUNING.fontScale,
    portraitSource: o.mps || DEFAULT_MONET_TUNING.portraitSource,
    portraitOffsetX: o.pox !== undefined ? o.pox : DEFAULT_MONET_TUNING.portraitOffsetX,
    portraitStyle: o.mpy || DEFAULT_MONET_TUNING.portraitStyle,
    showPortraitDragHanger: o.mpdh !== undefined ? o.mpdh : DEFAULT_MONET_TUNING.showPortraitDragHanger,
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
    if (config.randomVisualizerModePerSong !== undefined) minified.rvms = config.randomVisualizerModePerSong;
    if (config.visualizerBackgroundMode) minified.vbm = config.visualizerBackgroundMode;
    if (config.backgroundOpacity !== undefined) minified.bo = config.backgroundOpacity;
    if (config.visualizerOpacity !== undefined) minified.vo = config.visualizerOpacity;
    if (config.hidePlayerTranslationSubtitle !== undefined) minified.hpts = config.hidePlayerTranslationSubtitle;
    if (config.showSubtitleTranslation !== undefined) minified.sst = config.showSubtitleTranslation;
    if (config.subtitleOverlayBackground !== undefined) minified.sob = config.subtitleOverlayBackground;
    if (config.lyricsFontStyle) minified.lfs = config.lyricsFontStyle;
    if (config.lyricsFontScale !== undefined) minified.lfn = config.lyricsFontScale;
    if (config.lyricsFontFallbackFamilies?.length) minified.lff = config.lyricsFontFallbackFamilies;
    if (config.subtitleFontInheritsLyrics !== undefined) minified.sfi = config.subtitleFontInheritsLyrics;
    if (config.subtitleFontStyle) minified.sfs = config.subtitleFontStyle;
    if (config.subtitleFontFamily) minified.sff = config.subtitleFontFamily;
    if (config.subtitleFontFallbackFamilies?.length) minified.sfff = config.subtitleFontFallbackFamilies;

    if (config.visualizerTunings) minified.vt = config.visualizerTunings;
    if (config.classicTuning) minified.ct = compressClassic(config.classicTuning);
    if (config.cadenzaTuning) minified.cat = compressCadenza(config.cadenzaTuning);
    if (config.partitaTuning) minified.pt = compressPartita(config.partitaTuning);
    if (config.fumeTuning) minified.ft = compressFume(config.fumeTuning);
    if (config.claddaghTuning) minified.clt = compressCladdagh(config.claddaghTuning);
    if (config.cappellaTuning) minified.cpt = compressCappella(config.cappellaTuning);
    if (config.tiltTuning) minified.tt = compressTilt(config.tiltTuning);
    if (config.dioramaTuning) minified.dot = compressDiorama(config.dioramaTuning);
    if (config.monetBackgroundTuning) minified.mbt = compressMonetBackground(config.monetBackgroundTuning);
    if (config.nomandBackgroundTuning) minified.nbt = compressNomandBackground(config.nomandBackgroundTuning);
    if (config.latentBackgroundTuning) minified.lbt = compressLatentBackground(config.latentBackgroundTuning);
    if (config.monetTuning) minified.mt = compressMonet(config.monetTuning);
    if (config.urlBackgroundList) minified.ubl = config.urlBackgroundList;
    if (config.urlBackgroundSelectedId) minified.ubid = config.urlBackgroundSelectedId;
    if (config.songThemeAutoSwitchEnabled !== undefined) minified.stas = config.songThemeAutoSwitchEnabled;
    if (config.songThemeAutoGenerateEnabled !== undefined) minified.stag = config.songThemeAutoGenerateEnabled;

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

    const isMinified = parsed.t !== undefined
        || parsed.vm !== undefined
        || parsed.rvms !== undefined
        || parsed.ct !== undefined
        || parsed.cat !== undefined
        || parsed.dot !== undefined
        || parsed.nbt !== undefined
        || parsed.lbt !== undefined
        || parsed.hpts !== undefined
        || parsed.sst !== undefined
        || parsed.sob !== undefined
        || parsed.lff !== undefined
        || parsed.sfi !== undefined;
    if (isMinified) {
        const decompressed: any = {};
        if (parsed.t) {
            decompressed.theme = {
                light: decompressTheme(parsed.t.l),
                dark: decompressTheme(parsed.t.d),
            };
        }
        if (parsed.vm) decompressed.visualizerMode = parsed.vm;
        if (parsed.rvms !== undefined) decompressed.randomVisualizerModePerSong = parsed.rvms;
        if (parsed.vbm) decompressed.visualizerBackgroundMode = parsed.vbm;
        if (parsed.bo !== undefined) decompressed.backgroundOpacity = parsed.bo;
        if (parsed.vo !== undefined) decompressed.visualizerOpacity = parsed.vo;
        if (parsed.hpts !== undefined) decompressed.hidePlayerTranslationSubtitle = parsed.hpts;
        if (parsed.sst !== undefined) decompressed.showSubtitleTranslation = parsed.sst;
        if (parsed.sob !== undefined) decompressed.subtitleOverlayBackground = parsed.sob;
        if (parsed.lfs) decompressed.lyricsFontStyle = parsed.lfs;
        if (parsed.lfn !== undefined) decompressed.lyricsFontScale = parsed.lfn;
        if (parsed.lff) decompressed.lyricsFontFallbackFamilies = parsed.lff;
        if (parsed.sfi !== undefined) decompressed.subtitleFontInheritsLyrics = parsed.sfi;
        if (parsed.sfs) decompressed.subtitleFontStyle = parsed.sfs;
        if (parsed.sff) decompressed.subtitleFontFamily = parsed.sff;
        if (parsed.sfff) decompressed.subtitleFontFallbackFamilies = parsed.sfff;

        if (parsed.ct) decompressed.classicTuning = decompressClassic(parsed.ct);
        if (parsed.vt) decompressed.visualizerTunings = parsed.vt;
        if (parsed.cat) decompressed.cadenzaTuning = decompressCadenza(parsed.cat);
        if (parsed.pt) decompressed.partitaTuning = decompressPartita(parsed.pt);
        if (parsed.ft) decompressed.fumeTuning = decompressFume(parsed.ft);
        if (parsed.clt) decompressed.claddaghTuning = decompressCladdagh(parsed.clt);
        if (parsed.cpt) decompressed.cappellaTuning = decompressCappella(parsed.cpt);
        if (parsed.tt) decompressed.tiltTuning = decompressTilt(parsed.tt);
        if (parsed.dot) decompressed.dioramaTuning = decompressDiorama(parsed.dot);
        if (parsed.mbt) decompressed.monetBackgroundTuning = decompressMonetBackground(parsed.mbt);
        if (parsed.nbt) decompressed.nomandBackgroundTuning = decompressNomandBackground(parsed.nbt);
        if (parsed.lbt) decompressed.latentBackgroundTuning = decompressLatentBackground(parsed.lbt);
        if (parsed.mt) decompressed.monetTuning = decompressMonet(parsed.mt);
        if (parsed.ubl) decompressed.urlBackgroundList = parsed.ubl;
        if (parsed.ubid) decompressed.urlBackgroundSelectedId = parsed.ubid;
        if (parsed.stas !== undefined) decompressed.songThemeAutoSwitchEnabled = parsed.stas;
        if (parsed.stag !== undefined) decompressed.songThemeAutoGenerateEnabled = parsed.stag;

        return decompressed;
    } else {
        const validKeys = [
            'theme', 'visualizerMode', 'randomVisualizerModePerSong', 'visualizerBackgroundMode', 'backgroundOpacity',
            'visualizerOpacity', 'hidePlayerTranslationSubtitle', 'showSubtitleTranslation',
            'subtitleOverlayBackground',
            'lyricsFontStyle', 'lyricsFontScale', 'lyricsFontFallbackFamilies',
            'subtitleFontInheritsLyrics', 'subtitleFontStyle', 'subtitleFontFamily',
            'subtitleFontFallbackFamilies', 'visualizerTunings', 'classicTuning',
            'cadenzaTuning', 'partitaTuning', 'fumeTuning', 'claddaghTuning', 'cappellaTuning',
            'tiltTuning', 'dioramaTuning', 'monetBackgroundTuning', 'nomandBackgroundTuning', 'latentBackgroundTuning', 'monetTuning',
            'urlBackgroundList', 'urlBackgroundSelectedId',
            'songThemeAutoSwitchEnabled', 'songThemeAutoGenerateEnabled',
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
        randomVisualizerModePerSong: state.randomVisualizerModePerSong,
        visualizerBackgroundMode: state.visualizerBackgroundMode,
        backgroundOpacity: state.backgroundOpacity,
        visualizerOpacity: state.visualizerOpacity,
        hidePlayerTranslationSubtitle: state.hidePlayerTranslationSubtitle,
        showSubtitleTranslation: state.showSubtitleTranslation,
        subtitleOverlayBackground: state.subtitleOverlayBackground,
        lyricsFontStyle: state.lyricsFontStyle,
        lyricsFontScale: state.lyricsFontScale,
        lyricsFontFallbackFamilies: state.lyricsFontFallbackFamilies,
        subtitleFontInheritsLyrics: state.subtitleFontInheritsLyrics,
        subtitleFontStyle: state.subtitleFontStyle,
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
        urlBackgroundList: state.urlBackgroundList,
        urlBackgroundSelectedId: state.urlBackgroundSelectedId,

        handleSetVisualizerMode: state.handleSetVisualizerMode,
        handleToggleRandomVisualizerModePerSong: state.handleToggleRandomVisualizerModePerSong,
        handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
        handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
        handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
        handleToggleHidePlayerTranslationSubtitle: state.handleToggleHidePlayerTranslationSubtitle,
        handleToggleShowSubtitleTranslation: state.handleToggleShowSubtitleTranslation,
        handleToggleSubtitleOverlayBackground: state.handleToggleSubtitleOverlayBackground,
        handleSetLyricsFontStyle: state.handleSetLyricsFontStyle,
        handleSetLyricsFontScale: state.handleSetLyricsFontScale,
        handleSetLyricsFontFallbackFamilies: state.handleSetLyricsFontFallbackFamilies,
        handleSetSubtitleFontInheritsLyrics: state.handleSetSubtitleFontInheritsLyrics,
        handleSetSubtitleFontStyle: state.handleSetSubtitleFontStyle,
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
            visualizerMode: store.visualizerMode,
            randomVisualizerModePerSong: store.randomVisualizerModePerSong,
            visualizerBackgroundMode: store.visualizerBackgroundMode,
            backgroundOpacity: store.backgroundOpacity,
            visualizerOpacity: store.visualizerOpacity,
            hidePlayerTranslationSubtitle: store.hidePlayerTranslationSubtitle,
            showSubtitleTranslation: store.showSubtitleTranslation,
            subtitleOverlayBackground: store.subtitleOverlayBackground,
            lyricsFontStyle: store.lyricsFontStyle,
            lyricsFontScale: store.lyricsFontScale,
            lyricsFontFallbackFamilies: store.lyricsFontFallbackFamilies,
            subtitleFontInheritsLyrics: store.subtitleFontInheritsLyrics,
            subtitleFontStyle: store.subtitleFontStyle,
            subtitleFontFamily: store.subtitleFontFamily,
            subtitleFontFallbackFamilies: store.subtitleFontFallbackFamilies,
            visualizerTunings: collectVisualizerTunings(store as unknown as Record<string, unknown>),
            classicTuning: store.classicTuning,
            cadenzaTuning: store.cadenzaTuning,
            partitaTuning: store.partitaTuning,
            fumeTuning: store.fumeTuning,
            claddaghTuning: store.claddaghTuning,
            cappellaTuning: store.cappellaTuning,
            tiltTuning: store.tiltTuning,
            dioramaTuning: store.dioramaTuning,
            monetBackgroundTuning: store.monetBackgroundTuning,
            nomandBackgroundTuning: store.nomandBackgroundTuning,
            latentBackgroundTuning: store.latentBackgroundTuning,
            monetTuning: store.monetTuning,
            urlBackgroundList: store.urlBackgroundList,
            urlBackgroundSelectedId: store.urlBackgroundSelectedId,
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
            if (config.randomVisualizerModePerSong !== undefined) {
                store.handleToggleRandomVisualizerModePerSong(Boolean(config.randomVisualizerModePerSong));
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
            if (config.hidePlayerTranslationSubtitle !== undefined) {
                store.handleToggleHidePlayerTranslationSubtitle(Boolean(config.hidePlayerTranslationSubtitle));
            }
            if (config.showSubtitleTranslation !== undefined) {
                store.handleToggleShowSubtitleTranslation(Boolean(config.showSubtitleTranslation));
            }
            if (config.subtitleOverlayBackground !== undefined) {
                store.handleToggleSubtitleOverlayBackground(Boolean(config.subtitleOverlayBackground));
            }
            if (config.lyricsFontStyle) {
                store.handleSetLyricsFontStyle(config.lyricsFontStyle);
            }
            if (config.lyricsFontScale !== undefined) {
                store.handleSetLyricsFontScale(config.lyricsFontScale);
            }
            if (config.lyricsFontFallbackFamilies) {
                store.handleSetLyricsFontFallbackFamilies(config.lyricsFontFallbackFamilies);
            }
            if (config.subtitleFontInheritsLyrics !== undefined) {
                store.handleSetSubtitleFontInheritsLyrics(Boolean(config.subtitleFontInheritsLyrics));
            }
            if (config.subtitleFontStyle) {
                store.handleSetSubtitleFontStyle(config.subtitleFontStyle);
            }
            if (config.subtitleFontFamily !== undefined) {
                store.handleSetSubtitleFontFamily(config.subtitleFontFamily);
            }
            if (config.subtitleFontFallbackFamilies) {
                store.handleSetSubtitleFontFallbackFamilies(config.subtitleFontFallbackFamilies);
            }

            // Tunings
            if (config.visualizerTunings) {
                applyVisualizerTuningsToSettings(store as unknown as Record<string, unknown>, config.visualizerTunings);
            }
            if (!config.visualizerTunings && config.classicTuning) {
                store.handleSetClassicTuning(config.classicTuning);
            }
            if (!config.visualizerTunings && config.cadenzaTuning) {
                store.handleSetCadenzaTuning(config.cadenzaTuning);
            }
            if (!config.visualizerTunings && config.partitaTuning) {
                store.handleSetPartitaTuning(config.partitaTuning);
            }
            if (!config.visualizerTunings && config.fumeTuning) {
                store.handleSetFumeTuning(config.fumeTuning);
            }
            if (!config.visualizerTunings && config.claddaghTuning) {
                store.handleSetCladdaghTuning(config.claddaghTuning);
            }
            if (!config.visualizerTunings && config.cappellaTuning) {
                store.handleSetCappellaTuning(config.cappellaTuning);
            }
            if (!config.visualizerTunings && config.tiltTuning) {
                store.handleSetTiltTuning(config.tiltTuning);
            }
            if (!config.visualizerTunings && config.dioramaTuning) {
                store.handleSetDioramaTuning(config.dioramaTuning);
            }
            if (config.monetBackgroundTuning) {
                store.handleSetMonetBackgroundTuning(config.monetBackgroundTuning);
            }
            if (config.nomandBackgroundTuning) {
                store.handleSetNomandBackgroundTuning(config.nomandBackgroundTuning);
            }
            if (config.latentBackgroundTuning) {
                store.handleSetLatentBackgroundTuning(config.latentBackgroundTuning);
            }
            if (!config.visualizerTunings && config.monetTuning) {
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
            if (config.songThemeAutoSwitchEnabled !== undefined) {
                onToggleSongThemeAutoSwitch(Boolean(config.songThemeAutoSwitchEnabled));
            }
            if (config.songThemeAutoGenerateEnabled !== undefined) {
                onToggleSongThemeAutoGenerate(Boolean(config.songThemeAutoGenerateEnabled));
            }

            store.statusSetter?.({ type: 'success', text: t('options.importSuccess') });
            setImportText('');
        } catch (err) {
            console.error('Import settings failed:', err);
            store.statusSetter?.({ type: 'error', text: t('options.importFailed') });
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
                                    onClick={() => setExportThemeType('ai')}
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
                                    onClick={() => setExportThemeType('custom')}
                                    className="px-2.5 py-1.5 rounded-lg text-xs border transition-all flex items-center gap-1.5"
                                    style={getAccentOptionStyle(exportThemeType === 'custom')}
                                >
                                    <Palette size={12} className="opacity-70" />
                                    <span>{t('options.exportCustomTheme')}: {customTheme.light.name || 'Custom'}</span>
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setExportThemeType('none')}
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
                            <span>{copiedType === 'json' ? (t('status.copied')) : t('options.importBtn')}</span>
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
                            <span>{t('options.importBtn')}</span>
                        </button>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default AppearanceSettingsSubview;
