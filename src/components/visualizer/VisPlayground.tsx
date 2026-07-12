import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { ChevronLeft, Loader2, Search, Sparkles, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef } from 'react-window';
import VisualizerRenderer from './VisualizerRenderer';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_CLASSIC_TUNING,
    DEFAULT_CLADDAGH_TUNING,
    DEFAULT_DIORAMA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING,
    DEFAULT_MONET_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_TILT_TUNING,
    type AudioBands,
    type CappellaAvatarImage,
    type CappellaEmojiImage,
    type CappellaTuning,
    type CadenzaTuning,
    type ClassicTuning,
    type CladdaghTuning,
    type FumeTuning,
    type MonetBackgroundImage,
    type MonetBackgroundTuning,
    type MonetPortraitImage,
    type MonetTuning,
    type PartitaTuning,
    type StoredCustomLyricsFont,
    type Theme,
    type TiltTuning,
    type DioramaTuning,
    type UrlBackgroundItem,
    type VisualizerBackgroundMode,
    type VisualizerMode,
} from '../../types';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import { colorWithAlpha } from './colorMix';
import FontFallbackStackControl from './FontFallbackStackControl';
import {
    findPreviewPlaceholderLineIndex,
    getPreviewPlaceholderStartOffset,
    VIS_PLAYGROUND_PREVIEW_COVER_URL,
    VIS_PLAYGROUND_PREVIEW_LINES,
    VIS_PLAYGROUND_PREVIEW_LOOP_DURATION,
} from './PreviewPlaceholder';
import { getVisualizerModeLabel, getVisualizerRegistryEntry, getVisualizerScopedSeed } from './registry';
import VisPlaygroundPreviewHotspots, { type VisPlaygroundEditSection } from './VisPlaygroundPreviewHotspots';
import VisPlaygroundSettingsPanel from './VisPlaygroundSettingsPanel';

interface VisPlaygroundProps {
    theme?: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    initialEditSection?: VisPlaygroundEditSection;
    backgroundOpacity?: number;
    visualizerOpacity?: number;
    useCoverColorBg?: boolean;
    staticMode?: boolean;
    transparentPlayerBackground?: boolean;
    disableVisualizerVignette?: boolean;
    disableVisualizerGeometricBackground?: boolean;
    visualizerBackgroundMode?: VisualizerBackgroundMode | null;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleOverlayOpacity?: number;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    claddaghTuning?: CladdaghTuning;
    cappellaTuning?: CappellaTuning;
    tiltTuning?: TiltTuning;
    dioramaTuning?: DioramaTuning;
    monetBackgroundTuning?: MonetBackgroundTuning;
    monetTuning?: MonetTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    monetBackgroundImage?: MonetBackgroundImage | null;
    monetPortraitImage?: MonetPortraitImage | null;
    urlBackgroundList?: UrlBackgroundItem[];
    urlBackgroundSelectedId?: string | null;
    fontStyle: Theme['fontStyle'];
    fontScale: number;
    customFontFamily: string | null;
    customFontLabel: string | null;
    fontFallbackFamilies?: string[];
    subtitleFontInheritsLyrics?: boolean;
    subtitleFontStyle?: Theme['fontStyle'];
    subtitleFontFamily?: string | null;
    subtitleFontFallbackFamilies?: string[];
    onFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onFontScaleChange: (fontScale: number) => void;
    onCustomFontChange: (font: StoredCustomLyricsFont | null) => void;
    onUploadCustomFont?: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    onFontFallbackFamiliesChange?: (families: string[]) => void;
    onSubtitleFontInheritsLyricsChange?: (inheritsLyrics: boolean) => void;
    onSubtitleFontStyleChange?: (fontStyle: Theme['fontStyle']) => void;
    onSubtitleFontFamilyChange?: (fontFamily: string | null) => void;
    onSubtitleFontFallbackFamiliesChange?: (families: string[]) => void;
    onVisualizerModeChange?: (mode: VisualizerMode) => void;
    onBackgroundOpacityChange?: (opacity: number) => void;
    onVisualizerOpacityChange?: (opacity: number) => void;
    onToggleCoverColorBg?: (enabled: boolean) => void;
    onToggleDisableVisualizerVignette?: (disabled: boolean) => void;
    onToggleDisableVisualizerGeometricBackground?: (disabled: boolean) => void;
    onVisualizerBackgroundModeChange?: (mode: VisualizerBackgroundMode) => void;
    onResetVisualizerBackgroundMode?: () => void;
    onToggleHideTranslationSubtitle?: (hidden: boolean) => void;
    onToggleShowSubtitleTranslation?: (shown: boolean) => void;
    onSubtitleOverlayOpacityChange?: (opacity: number) => void;
    onClassicTuningChange?: (patch: Partial<ClassicTuning>) => void;
    onResetClassicTuning?: () => void;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    onResetPartitaTuning?: () => void;
    onFumeTuningChange?: (patch: Partial<FumeTuning>) => void;
    onResetFumeTuning?: () => void;
    onCladdaghTuningChange?: (patch: Partial<CladdaghTuning>) => void;
    onResetCladdaghTuning?: () => void;
    onCappellaTuningChange?: (patch: Partial<CappellaTuning>) => void;
    onResetCappellaTuning?: () => void;
    onTiltTuningChange?: (patch: Partial<TiltTuning>) => void;
    onResetTiltTuning?: () => void;
    onDioramaTuningChange?: (patch: Partial<DioramaTuning>) => void;
    onResetDioramaTuning?: () => void;
    onMonetBackgroundTuningChange?: (patch: Partial<MonetBackgroundTuning>) => void;
    onResetMonetBackgroundTuning?: () => void;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    onResetMonetTuning?: () => void;
    onUploadMonetBackgroundImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetBackgroundImage?: () => Promise<void> | void;
    isLoadingMonetBackgroundImage?: boolean;
    onUploadMonetPortraitImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetPortraitImage?: () => Promise<void> | void;
    isLoadingMonetPortraitImage?: boolean;
    onAddUrlBackgroundItem?: (item: UrlBackgroundItem) => void;
    onUpdateUrlBackgroundItem?: (id: string, patch: Partial<Omit<UrlBackgroundItem, 'id'>>) => void;
    onDeleteUrlBackgroundItem?: (id: string) => void;
    onSetUrlBackgroundSelectedId?: (id: string | null) => void;
    onImportCappellaCustomEmojiPack?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomEmojiPack?: () => Promise<void> | void;
    isLoadingCappellaCustomEmojiPack?: boolean;
    onImportCappellaCustomAvatar?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomAvatar?: () => Promise<void> | void;
    isLoadingCappellaCustomAvatarPack?: boolean;
    onClose: () => void;
}

interface PresetOption<T> {
    label: string;
    value: T;
}

interface LocalFontDataLike {
    family: string;
    fullName?: string;
    postscriptName?: string;
    style?: string;
}

interface LocalFontEntry {
    family: string;
    label: string;
}

type QueryLocalFontsWindow = Window & {
    queryLocalFonts?: () => Promise<LocalFontDataLike[]>;
};

const PREVIEW_THEME: Theme = {
    name: 'Preview Theme',
    backgroundColor: '#09090b',
    primaryColor: '#f4f4f5',
    accentColor: '#f4f4f5',
    secondaryColor: '#71717a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
};

const FONT_SCALE_OPTIONS: PresetOption<number>[] = [
    { label: '90%', value: 0.9 },
    { label: '100%', value: 1 },
    { label: '110%', value: 1.1 },
    { label: '125%', value: 1.25 },
];

const FONT_ROW_HEIGHT = 94;

const clampFontScale = (value: number) => Math.min(1.4, Math.max(0.85, value));
const clampPartitaStagger = (value: number) => Math.min(180, Math.max(0, value));
const clampFumeCameraSpeed = (value: number) => Math.min(1.85, Math.max(0.55, value));
const clampFumeGlowIntensity = (value: number) => Math.min(1.8, Math.max(0, value));
const clampFumeBackgroundObjectOpacity = (value: number) => Math.min(1, Math.max(0, value));
const clampFumeHeroScale = (value: number) => Math.min(1.32, Math.max(0.82, value));
const clampFumeTextHoldRatio = (value: number) => Math.min(1, Math.max(0, value));
const clampCladdaghFocusScaleRatio = (val: number) => Math.min(1.5, Math.max(0.0, val));
const clampCladdaghRadiusScale = (val: number) => Math.min(1.5, Math.max(0.5, val));
const clampCladdaghEllipseTiltDeg = (val: number) => Math.min(60, Math.max(0, val));
const clampCladdaghLetterSpacingOffset = (val: number) => Math.min(20, Math.max(-5, val));
const isMobileBrowser = () => {
    if (typeof navigator === 'undefined') {
        return false;
    }

    const userAgent = navigator.userAgent;
    const platform = navigator.platform;
    const maxTouchPoints = navigator.maxTouchPoints ?? 0;
    const userAgentData = (navigator as Navigator & { userAgentData?: { mobile?: boolean; }; }).userAgentData;
    if (typeof userAgentData?.mobile === 'boolean') {
        return userAgentData.mobile;
    }

    if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) {
        return true;
    }

    if (/Macintosh/i.test(userAgent) && /Mac/i.test(platform) && maxTouchPoints > 1) {
        return true;
    }

    const hasCoarsePointer = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(pointer: coarse)').matches;
    const compactTouchScreen = typeof screen !== 'undefined'
        && Math.min(screen.width, screen.height) <= 820
        && maxTouchPoints > 0;

    return hasCoarsePointer && compactTouchScreen;
};
const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined): FumeTuning['cameraTrackingMode'] => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

const resolvePartitaTuningPatch = (
    previous: PartitaTuning,
    patch: Partial<PartitaTuning>
): PartitaTuning => {
    const rawMin = clampPartitaStagger(patch.staggerMin ?? previous.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(patch.staggerMax ?? previous.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);

    return {
        showGuideLines: patch.showGuideLines ?? previous.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        useSemanticLayout: patch.useSemanticLayout ?? previous.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
};

const dedupeLocalFonts = (fonts: LocalFontDataLike[]) => {
    const entries = new Map<string, LocalFontEntry>();

    fonts.forEach(font => {
        const family = font.family?.trim();
        if (!family) {
            return;
        }

        const key = family.toLocaleLowerCase();
        if (!entries.has(key)) {
            entries.set(key, {
                family,
                label: family,
            });
        }
    });

    return Array.from(entries.values()).sort((left, right) => left.label.localeCompare(right.label));
};

const VisPlayground: React.FC<VisPlaygroundProps> = ({
    theme,
    isDaylight,
    visualizerMode,
    initialEditSection = 'common',
    backgroundOpacity = 0.75,
    visualizerOpacity = 1,
    useCoverColorBg = false,
    staticMode = false,
    transparentPlayerBackground = false,
    disableVisualizerVignette = false,
    disableVisualizerGeometricBackground = false,
    visualizerBackgroundMode = null,
    hideTranslationSubtitle = false,
    showSubtitleTranslation = true,
    subtitleOverlayOpacity = 0.6,
    classicTuning = DEFAULT_CLASSIC_TUNING,
    cadenzaTuning = DEFAULT_CADENZA_TUNING,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    fumeTuning = DEFAULT_FUME_TUNING,
    claddaghTuning = DEFAULT_CLADDAGH_TUNING,
    cappellaTuning = DEFAULT_CAPPELLA_TUNING,
    tiltTuning = DEFAULT_TILT_TUNING,
    dioramaTuning = DEFAULT_DIORAMA_TUNING,
    monetBackgroundTuning = DEFAULT_MONET_BACKGROUND_TUNING,
    monetTuning = DEFAULT_MONET_TUNING,
    cappellaCustomEmojiImages = [],
    cappellaCustomAvatarImages = [],
    monetBackgroundImage = null,
    monetPortraitImage = null,
    fontStyle,
    fontScale,
    customFontFamily,
    customFontLabel,
    fontFallbackFamilies = [],
    subtitleFontInheritsLyrics = true,
    subtitleFontStyle = 'sans',
    subtitleFontFamily = null,
    subtitleFontFallbackFamilies = [],
    onFontStyleChange,
    onFontScaleChange,
    onCustomFontChange,
    onUploadCustomFont,
    onFontFallbackFamiliesChange,
    onSubtitleFontInheritsLyricsChange,
    onSubtitleFontStyleChange,
    onSubtitleFontFamilyChange,
    onSubtitleFontFallbackFamiliesChange,
    onVisualizerModeChange,
    onBackgroundOpacityChange,
    onVisualizerOpacityChange,
    onToggleCoverColorBg,
    onToggleDisableVisualizerVignette,
    onToggleDisableVisualizerGeometricBackground,
    onVisualizerBackgroundModeChange,
    onResetVisualizerBackgroundMode,
    onToggleHideTranslationSubtitle,
    onToggleShowSubtitleTranslation,
    onSubtitleOverlayOpacityChange,
    onClassicTuningChange,
    onResetClassicTuning,
    onPartitaTuningChange,
    onResetPartitaTuning,
    onFumeTuningChange,
    onResetFumeTuning,
    onCladdaghTuningChange,
    onResetCladdaghTuning,
    onCappellaTuningChange,
    onResetCappellaTuning,
    onTiltTuningChange,
    onResetTiltTuning,
    onDioramaTuningChange,
    onResetDioramaTuning,
    onMonetBackgroundTuningChange,
    onResetMonetBackgroundTuning,
    onMonetTuningChange,
    onResetMonetTuning,
    onUploadMonetBackgroundImage,
    onClearMonetBackgroundImage,
    isLoadingMonetBackgroundImage = false,
    onUploadMonetPortraitImage,
    onClearMonetPortraitImage,
    isLoadingMonetPortraitImage = false,
    urlBackgroundList = [],
    urlBackgroundSelectedId = null,
    onAddUrlBackgroundItem,
    onUpdateUrlBackgroundItem,
    onDeleteUrlBackgroundItem,
    onSetUrlBackgroundSelectedId,
    onImportCappellaCustomEmojiPack,
    onClearCappellaCustomEmojiPack,
    isLoadingCappellaCustomEmojiPack = false,
    onImportCappellaCustomAvatar,
    onClearCappellaCustomAvatar,
    isLoadingCappellaCustomAvatarPack = false,
    onClose,
}) => {
    const { t } = useTranslation();
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0.24);
    const bass = useMotionValue(0.18);
    const lowMid = useMotionValue(0.15);
    const mid = useMotionValue(0.12);
    const vocal = useMotionValue(0.2);
    const treble = useMotionValue(0.1);
    const spectrum = useMotionValue(new Uint8Array(64));
    const [currentLineIndex, setCurrentLineIndex] = useState(() => findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, 0));
    const [fontPickerTarget, setFontPickerTarget] = useState<'lyrics' | 'subtitle' | 'none'>('none');
    const isFontPickerOpen = fontPickerTarget !== 'none';
    const setIsFontPickerOpen = (open: boolean) => setFontPickerTarget(open ? 'lyrics' : 'none');
    const [isLoadingSystemFonts, setIsLoadingSystemFonts] = useState(false);
    const [systemFonts, setSystemFonts] = useState<LocalFontEntry[]>([]);
    const [fontSearchQuery, setFontSearchQuery] = useState('');
    const [fontPickerError, setFontPickerError] = useState<string | null>(null);
    const [fontListHeight, setFontListHeight] = useState(420);
    const [isUploadingCustomFont, setIsUploadingCustomFont] = useState(false);
    const [draftBackgroundOpacity, setDraftBackgroundOpacity] = useState(backgroundOpacity);
    const [draftVisualizerOpacity, setDraftVisualizerOpacity] = useState(visualizerOpacity);
    const [draftSubtitleOverlayOpacity, setDraftSubtitleOverlayOpacity] = useState(subtitleOverlayOpacity);
    const [draftFontScale, setDraftFontScale] = useState(fontScale);
    const [draftClassicTuning, setDraftClassicTuning] = useState<ClassicTuning>(classicTuning);
    const [draftPartitaTuning, setDraftPartitaTuning] = useState<PartitaTuning>(partitaTuning);
    const [draftFumeTuning, setDraftFumeTuning] = useState<FumeTuning>(fumeTuning);
    const [draftCladdaghTuning, setDraftCladdaghTuning] = useState<CladdaghTuning>(claddaghTuning);
    const [draftTiltTuning, setDraftTiltTuning] = useState<TiltTuning>(tiltTuning);
    const [draftDioramaTuning, setDraftDioramaTuning] = useState<DioramaTuning>(dioramaTuning);
    const [draftMonetBackgroundTuning, setDraftMonetBackgroundTuning] = useState<MonetBackgroundTuning>(monetBackgroundTuning);
    const [draftMonetTuning, setDraftMonetTuning] = useState<MonetTuning>(monetTuning);
    const [activeEditSection, setActiveEditSection] = useState<VisPlaygroundEditSection>(initialEditSection);
    const fontListRef = React.useRef<HTMLDivElement>(null);
    const fontVirtualListRef = useListRef(null);
    const fontUploadInputRef = React.useRef<HTMLInputElement>(null);
    const isDraggingSlider = useRef(false);
    const pendingCommitRef = useRef<(() => void) | null>(null);

    const audioBands = useMemo<AudioBands>(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
        spectrum,
    }), [bass, lowMid, mid, spectrum, treble, vocal]);

    const normalizedFontScale = clampFontScale(draftFontScale);
    const builtinFontOptions: PresetOption<Theme['fontStyle']>[] = useMemo(() => ([
        { value: 'sans', label: t('options.fontSans') },
        { value: 'serif', label: t('options.fontSerif') },
        { value: 'mono', label: t('options.fontMono') },
    ]), [t]);
    const baseTheme = theme ?? PREVIEW_THEME;
    const previewTheme = useMemo<Theme>(() => ({
        ...baseTheme,
        fontStyle,
        fontFamily: customFontFamily ?? undefined,
        fontFamilyStack: fontFallbackFamilies,
    }), [baseTheme, customFontFamily, fontFallbackFamilies, fontStyle]);
    const previewSubtitleTheme = useMemo<Theme>(() => (
        subtitleFontInheritsLyrics
            ? previewTheme
            : {
                ...baseTheme,
                fontStyle: subtitleFontStyle,
                fontFamily: subtitleFontFamily ?? undefined,
                fontFamilyStack: subtitleFontFallbackFamilies,
            }
    ), [
        baseTheme,
        previewTheme,
        subtitleFontFallbackFamilies,
        subtitleFontFamily,
        subtitleFontInheritsLyrics,
        subtitleFontStyle,
    ]);
    const activePickerFontFamily = fontPickerTarget === 'subtitle' ? subtitleFontFamily : customFontFamily;
    const activePickerTheme = fontPickerTarget === 'subtitle' ? previewSubtitleTheme : previewTheme;
    const resolvedPartitaTuning = useMemo<PartitaTuning>(() => {
        const rawMin = clampPartitaStagger(draftPartitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
        const rawMax = clampPartitaStagger(draftPartitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);

        return {
            showGuideLines: draftPartitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
            useSemanticLayout: draftPartitaTuning.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
    }, [draftPartitaTuning]);
    const resolvedFumeTuning = useMemo<FumeTuning>(() => ({
        hidePrintSymbols: draftFumeTuning.hidePrintSymbols,
        disableGeometricBackground: draftFumeTuning.disableGeometricBackground,
        backgroundObjectOpacity: clampFumeBackgroundObjectOpacity(
            draftFumeTuning.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity,
        ),
        textHoldRatio: clampFumeTextHoldRatio(draftFumeTuning.textHoldRatio ?? DEFAULT_FUME_TUNING.textHoldRatio),
        cameraTrackingMode: resolveFumeCameraTrackingMode(draftFumeTuning.cameraTrackingMode),
        cameraSpeed: clampFumeCameraSpeed(draftFumeTuning.cameraSpeed),
        glowIntensity: clampFumeGlowIntensity(draftFumeTuning.glowIntensity),
        heroScale: clampFumeHeroScale(draftFumeTuning.heroScale),
    }), [draftFumeTuning]);
    const resolvedCladdaghTuning = useMemo<CladdaghTuning>(() => ({
        focusScaleRatio: clampCladdaghFocusScaleRatio(
            draftCladdaghTuning.focusScaleRatio ?? DEFAULT_CLADDAGH_TUNING.focusScaleRatio
        ),
        radiusScale: clampCladdaghRadiusScale(
            draftCladdaghTuning.radiusScale ?? DEFAULT_CLADDAGH_TUNING.radiusScale
        ),
        ellipseTiltDeg: clampCladdaghEllipseTiltDeg(
            draftCladdaghTuning.ellipseTiltDeg ?? DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg
        ),
        showAxisLine: draftCladdaghTuning.showAxisLine ?? DEFAULT_CLADDAGH_TUNING.showAxisLine,
        letterSpacingOffset: clampCladdaghLetterSpacingOffset(
            draftCladdaghTuning.letterSpacingOffset ?? DEFAULT_CLADDAGH_TUNING.letterSpacingOffset
        ),
    }), [draftCladdaghTuning]);
    const draftVisualizerTunings = useMemo(() => ({
        classic: draftClassicTuning,
        cadenza: cadenzaTuning,
        partita: resolvedPartitaTuning,
        fume: resolvedFumeTuning,
        claddagh: resolvedCladdaghTuning,
        cappella: cappellaTuning,
        tilt: draftTiltTuning,
        diorama: draftDioramaTuning,
        monet: draftMonetTuning,
    }), [cadenzaTuning, cappellaTuning, draftClassicTuning, draftDioramaTuning, draftMonetTuning, draftTiltTuning, resolvedCladdaghTuning, resolvedFumeTuning, resolvedPartitaTuning]);
    const currentFontLabel = customFontLabel || customFontFamily || t('options.customFont');
    const fontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[] = useMemo(() => ([
        ...builtinFontOptions,
        { value: 'custom', label: currentFontLabel },
    ]), [builtinFontOptions, currentFontLabel]);
    const currentSubtitleFontLabel = subtitleFontFamily || t('options.customFont');
    const subtitleFontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[] = useMemo(() => ([
        ...builtinFontOptions,
        { value: 'custom', label: currentSubtitleFontLabel },
    ]), [builtinFontOptions, currentSubtitleFontLabel]);
    const filteredSystemFonts = useMemo(() => {
        const query = fontSearchQuery.trim().toLocaleLowerCase();
        if (!query) {
            return systemFonts;
        }

        return systemFonts.filter(font => font.label.toLocaleLowerCase().includes(query));
    }, [fontSearchQuery, systemFonts]);
    const canQueryLocalFonts = typeof window !== 'undefined' && Boolean((window as QueryLocalFontsWindow).queryLocalFonts);
    const shouldShowUploadedFontFallback = !canQueryLocalFonts && isMobileBrowser() && Boolean(onUploadCustomFont);

    useEffect(() => { setDraftBackgroundOpacity(backgroundOpacity); }, [backgroundOpacity]);
    useEffect(() => { setDraftVisualizerOpacity(visualizerOpacity); }, [visualizerOpacity]);
    useEffect(() => { setDraftSubtitleOverlayOpacity(subtitleOverlayOpacity); }, [subtitleOverlayOpacity]);
    useEffect(() => { setDraftFontScale(fontScale); }, [fontScale]);
    useEffect(() => { setDraftClassicTuning(classicTuning); }, [classicTuning]);
    useEffect(() => { setDraftPartitaTuning(partitaTuning); }, [partitaTuning]);
    useEffect(() => { setDraftFumeTuning(fumeTuning); }, [fumeTuning]);
    useEffect(() => { setDraftCladdaghTuning(claddaghTuning); }, [claddaghTuning]);
    useEffect(() => { setDraftTiltTuning(tiltTuning); }, [tiltTuning]);
    useEffect(() => { setDraftDioramaTuning(dioramaTuning); }, [dioramaTuning]);
    useEffect(() => { setDraftMonetBackgroundTuning(monetBackgroundTuning); }, [monetBackgroundTuning]);
    useEffect(() => { setDraftMonetTuning(monetTuning); }, [monetTuning]);
    useEffect(() => { setActiveEditSection(initialEditSection); }, [initialEditSection]);

    useEffect(() => {
        let frameId = 0;
        const startedAt = performance.now();
        const previewOffset = getPreviewPlaceholderStartOffset(visualizerMode, VIS_PLAYGROUND_PREVIEW_LOOP_DURATION);

        const tick = (now: number) => {
            const elapsed = (previewOffset + (now - startedAt) / 1000) % VIS_PLAYGROUND_PREVIEW_LOOP_DURATION;
            currentTime.set(elapsed);

            const wave = (offset: number, speed: number, floor: number, amplitude: number) =>
                floor + (Math.sin(now * speed + offset) * 0.5 + 0.5) * amplitude;

            audioPower.set(wave(0.2, 0.0024, 0.16, 0.18));
            bass.set(wave(0.9, 0.0032, 0.14, 0.2));
            lowMid.set(wave(1.7, 0.0028, 0.12, 0.16));
            mid.set(wave(2.6, 0.0023, 0.1, 0.14));
            vocal.set(wave(3.4, 0.0038, 0.16, 0.22));
            treble.set(wave(4.2, 0.0046, 0.08, 0.14));

            const nextSpectrum = new Uint8Array(64);
            for (let index = 0; index < nextSpectrum.length; index += 1) {
                const normalizedIndex = index / Math.max(1, nextSpectrum.length - 1);
                const lowShape = Math.exp(-normalizedIndex * 2.4);
                const harmonic =
                    Math.sin(now * 0.0027 + normalizedIndex * Math.PI * 3.4) * 0.18 +
                    Math.sin(now * 0.0052 + normalizedIndex * Math.PI * 11.5) * 0.08;
                const shimmer = Math.sin(now * 0.0018 + normalizedIndex * Math.PI * 1.2) * 0.12;
                const amplitude = Math.max(0, Math.min(1, lowShape * 0.8 + 0.08 + harmonic + shimmer));
                nextSpectrum[index] = Math.round(amplitude * 255);
            }
            spectrum.set(nextSpectrum);

            frameId = window.requestAnimationFrame(tick);
        };

        frameId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frameId);
    }, [audioPower, bass, currentTime, lowMid, mid, spectrum, treble, visualizerMode, vocal]);

    useMotionValueEvent(currentTime, 'change', latest => {
        const nextIndex = findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, latest);
        setCurrentLineIndex(prev => (prev === nextIndex ? prev : nextIndex));
    });

    const visualizerEntry = getVisualizerRegistryEntry(visualizerMode);
    const modeLabel = getVisualizerModeLabel(visualizerMode, t);
    const hotspotLabels = useMemo<Record<Exclude<VisPlaygroundEditSection, 'common'>, string>>(() => ({
        background: t('options.previewBackgroundHotspot'),
        visualizer: t('options.previewVisualizerHotspot'),
        subtitle: t('options.previewSubtitleHotspot'),
    }), [t]);
    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-950/88';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const controlCardBg = colorWithAlpha(previewTheme.backgroundColor, isDaylight ? 0.42 : 0.52);
    const overlayBackground = isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';
    const rangeInputClass = [
        'w-full h-1.5 rounded-full appearance-none cursor-pointer',
        '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform',
        '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-transform',
        isDaylight
            ? 'bg-black/15 [&::-webkit-slider-thumb]:bg-zinc-700 [&::-moz-range-thumb]:bg-zinc-700'
            : 'bg-white/10 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white',
    ].join(' ');

    const handleResetVisualizerTuning = () => {
        visualizerEntry.resetSettings?.({
            resetClassicTuning: onResetClassicTuning,
            resetPartitaTuning: onResetPartitaTuning,
            resetFumeTuning: onResetFumeTuning,
            resetCladdaghTuning: onResetCladdaghTuning,
            resetCappellaTuning: onResetCappellaTuning,
            resetTiltTuning: onResetTiltTuning,
            resetDioramaTuning: onResetDioramaTuning,
            resetMonetTuning: onResetMonetTuning,
            setDraftFumeTuning,
            setDraftCladdaghTuning,
        });
    };

    const handleSelectBuiltinFont = (next: Theme['fontStyle']) => {
        onCustomFontChange(null);
        onFontStyleChange(next);
    };

    const loadSystemFonts = async (target: 'lyrics' | 'subtitle' = 'lyrics') => {
        setFontPickerTarget(target);
        setFontPickerError(null);

        if (systemFonts.length > 0 || isLoadingSystemFonts) {
            return;
        }

        const localFontWindow = window as QueryLocalFontsWindow;
        if (!localFontWindow.queryLocalFonts) {
            if (shouldShowUploadedFontFallback) {
                return;
            }

            setFontPickerError(t('options.systemFontUnsupported'));
            return;
        }

        setIsLoadingSystemFonts(true);
        try {
            const fonts = await localFontWindow.queryLocalFonts();
            const nextFonts = dedupeLocalFonts(fonts);
            setSystemFonts(nextFonts);
            if (nextFonts.length === 0) {
                setFontPickerError(t('options.systemFontEmpty'));
            }
        } catch (error) {
            console.error('[VisPlayground] Failed to query local fonts:', error);
            setFontPickerError(
                error instanceof Error && error.message
                    ? error.message
                    : t('options.systemFontPermissionDenied')
            );
        } finally {
            setIsLoadingSystemFonts(false);
        }
    };

    const handleChooseSystemFont = (font: LocalFontEntry) => {
        if (fontPickerTarget === 'lyrics') {
            onCustomFontChange({
                source: 'system',
                family: font.family,
                label: font.label,
            });
        } else if (fontPickerTarget === 'subtitle') {
            onSubtitleFontFamilyChange?.(font.family);
        }
    };

    const handleUploadFontFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';

        if (!file || !onUploadCustomFont) {
            return;
        }

        setFontPickerError(null);
        setIsUploadingCustomFont(true);
        try {
            const result = await onUploadCustomFont(file);
            if (result.ok) {
                setIsFontPickerOpen(false);
            } else {
                setFontPickerError(result.error || (t('options.uploadFontFailed')));
            }
        } finally {
            setIsUploadingCustomFont(false);
        }
    };

    useEffect(() => {
        if (!isFontPickerOpen || !fontListRef.current) {
            return;
        }

        const updateHeight = () => {
            if (fontListRef.current) {
                setFontListHeight(fontListRef.current.clientHeight);
            }
        };

        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(fontListRef.current);
        return () => observer.disconnect();
    }, [isFontPickerOpen]);

    useEffect(() => {
        if (!isFontPickerOpen || !fontVirtualListRef.current) {
            return;
        }

        fontVirtualListRef.current.scrollToRow({ index: 0, align: 'start', behavior: 'instant' });
    }, [filteredSystemFonts.length, fontSearchQuery, isFontPickerOpen, fontVirtualListRef]);

    const FontRow = React.useCallback(({ index, style, ariaAttributes }: {
        index: number;
        style: React.CSSProperties;
        ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem"; };
    }) => {
        const font = filteredSystemFonts[index];
        const isActive = activePickerFontFamily?.toLocaleLowerCase() === font.family.toLocaleLowerCase();

        return (
            <div style={style} {...ariaAttributes}>
                <button
                    type="button"
                    onClick={() => handleChooseSystemFont(font)}
                    className="w-full rounded-2xl border p-4 text-left transition-all"
                    style={{
                        color: 'var(--text-primary)',
                        borderColor: isActive ? 'var(--text-accent)' : (isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)'),
                        backgroundColor: isActive
                            ? (isDaylight ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.08)')
                            : (isDaylight ? 'rgba(255,255,255,0.58)' : 'rgba(255,255,255,0.03)'),
                        height: FONT_ROW_HEIGHT - 8,
                        marginBottom: 8,
                    }}
                >
                    <div
                        className="text-lg font-medium"
                        style={{
                            fontFamily: resolveThemeFontStack({
                                fontStyle: activePickerTheme.fontStyle,
                                fontFamily: font.family,
                            }),
                        }}
                    >
                        {font.label}
                    </div>
                    <div className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                        {font.family}
                    </div>
                </button>
            </div>
        );
    }, [activePickerFontFamily, activePickerTheme.fontStyle, filteredSystemFonts, handleChooseSystemFont, isDaylight]);

    const handleSelectFontStyle = (next: Theme['fontStyle'] | 'custom') => {
        if (next === 'custom') {
            void loadSystemFonts('lyrics');
            return;
        }

        handleSelectBuiltinFont(next);
    };

    /** Update draft only during slider drag; commit immediately for buttons. */
    const handleFumeTuningChange = (patch: Partial<FumeTuning>) => {
        setDraftFumeTuning(previous => ({ ...previous, ...patch }));
        if (!isDraggingSlider.current) {
            onFumeTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onFumeTuningChange?.(patch);
        }
    };

    const handleCladdaghTuningChange = (patch: Partial<CladdaghTuning>) => {
        setDraftCladdaghTuning(previous => ({ ...previous, ...patch }));
        if (!isDraggingSlider.current) {
            onCladdaghTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onCladdaghTuningChange?.(patch);
        }
    };

    const handleBackgroundOpacityDraft = (opacity: number) => {
        setDraftBackgroundOpacity(opacity);
        if (!isDraggingSlider.current) {
            onBackgroundOpacityChange?.(opacity);
        } else {
            pendingCommitRef.current = () => onBackgroundOpacityChange?.(opacity);
        }
    };

    const handleVisualizerOpacityDraft = (opacity: number) => {
        setDraftVisualizerOpacity(opacity);
        if (!isDraggingSlider.current) {
            onVisualizerOpacityChange?.(opacity);
        } else {
            pendingCommitRef.current = () => onVisualizerOpacityChange?.(opacity);
        }
    };

    const handleSubtitleOverlayOpacityDraft = (opacity: number) => {
        setDraftSubtitleOverlayOpacity(opacity);
        if (!isDraggingSlider.current) {
            onSubtitleOverlayOpacityChange?.(opacity);
        } else {
            pendingCommitRef.current = () => onSubtitleOverlayOpacityChange?.(opacity);
        }
    };

    const handleFontScaleDraft = (scale: number) => {
        setDraftFontScale(scale);
        if (!isDraggingSlider.current) {
            onFontScaleChange(scale);
        } else {
            pendingCommitRef.current = () => onFontScaleChange(scale);
        }
    };

    const handleClassicTuningDraft = (patch: Partial<ClassicTuning>) => {
        setDraftClassicTuning(prev => ({ ...prev, ...patch }));
        if (!isDraggingSlider.current) {
            onClassicTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onClassicTuningChange?.(patch);
        }
    };

    const handlePartitaTuningDraft = (patch: Partial<PartitaTuning>) => {
        const nextTuning = resolvePartitaTuningPatch(draftPartitaTuning, patch);
        setDraftPartitaTuning(nextTuning);
        if (!isDraggingSlider.current) {
            onPartitaTuningChange?.(nextTuning);
        } else {
            pendingCommitRef.current = () => onPartitaTuningChange?.(nextTuning);
        }
    };

    const handleTiltTuningDraft = (patch: Partial<TiltTuning>) => {
        setDraftTiltTuning(prev => ({ ...prev, ...patch }));
        if (!isDraggingSlider.current) {
            onTiltTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onTiltTuningChange?.(patch);
        }
    };

    const handleDioramaTuningDraft = (patch: Partial<DioramaTuning>) => {
        setDraftDioramaTuning(prev => ({ ...prev, ...patch }));
        if (!isDraggingSlider.current) {
            onDioramaTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onDioramaTuningChange?.(patch);
        }
    };

    const handleMonetBackgroundTuningDraft = (patch: Partial<MonetBackgroundTuning>) => {
        const next = { ...draftMonetBackgroundTuning, ...patch };
        setDraftMonetBackgroundTuning(next);
        if (!isDraggingSlider.current) {
            onMonetBackgroundTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onMonetBackgroundTuningChange?.(patch);
        }
    };

    const handleMonetTuningDraft = (patch: Partial<MonetTuning>) => {
        const next = { ...draftMonetTuning, ...patch };
        setDraftMonetTuning(next);
        if (!isDraggingSlider.current) {
            onMonetTuningChange?.(patch);
        } else {
            pendingCommitRef.current = () => onMonetTuningChange?.(patch);
        }
    };

    const handleResetBackgroundSettings = () => {
        setDraftBackgroundOpacity(0.75);
        onBackgroundOpacityChange?.(0.75);
        onToggleCoverColorBg?.(false);
        onToggleDisableVisualizerVignette?.(false);
        onToggleDisableVisualizerGeometricBackground?.(false);
        onResetVisualizerBackgroundMode?.();
        setDraftMonetBackgroundTuning(DEFAULT_MONET_BACKGROUND_TUNING);
        onResetMonetBackgroundTuning?.();
    };

    const handleResetSubtitleSettings = () => {
        setDraftSubtitleOverlayOpacity(0.6);
        onToggleHideTranslationSubtitle?.(false);
        onToggleShowSubtitleTranslation?.(true);
        onSubtitleOverlayOpacityChange?.(0.6);
        onSubtitleFontInheritsLyricsChange?.(true);
        onSubtitleFontStyleChange?.('sans');
        onSubtitleFontFamilyChange?.(null);
        onSubtitleFontFallbackFamiliesChange?.([]);
    };

    const handleResetCommonSettings = () => {
        setDraftFontScale(1);
        setDraftVisualizerOpacity(1);
        onCustomFontChange(null);
        onFontFallbackFamiliesChange?.([]);
        onFontStyleChange('sans');
        onFontScaleChange(1);
        onVisualizerOpacityChange?.(1);
    };

    /** Mark slider drag start so onChange only updates local draft. */
    const handleSliderPointerDown = useCallback(() => {
        isDraggingSlider.current = true;
    }, []);

    /** Commit pending draft value to persistent store on slider release. */
    const handleSliderCommit = useCallback(() => {
        if (!isDraggingSlider.current) return;
        isDraggingSlider.current = false;
        pendingCommitRef.current?.();
        pendingCommitRef.current = null;
    }, []);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed inset-0 z-[140] backdrop-blur-xl p-3 sm:p-5"
            style={{ backgroundColor: overlayBackground }}
            onClick={onClose}
        >
            <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                onClick={(event) => event.stopPropagation()}
                className={`mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-[32px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.28)]`}
            >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-4 sm:px-6">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="h-10 w-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center transition-colors hover:bg-white/10"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div className="min-w-0">
                            <div className="text-lg sm:text-xl font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                {t('options.lyricsStyleSettings')}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.25fr)_360px]">
                    <div className="relative min-h-[320px] overflow-hidden rounded-[28px] border border-white/10 bg-black/20">
                        <div className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs uppercase tracking-[0.22em] backdrop-blur-md" style={{ color: 'rgba(255,255,255,0.78)' }}>
                            <Sparkles size={13} />
                            <span>{t('ui.livePreview')}</span>
                        </div>
                        <div className="absolute right-4 top-4 z-20 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs backdrop-blur-md" style={{ color: 'rgba(255,255,255,0.78)' }}>
                            {modeLabel}
                        </div>

                        <div className="absolute inset-0">
                            <VisualizerRenderer
                                mode={visualizerMode}
                                currentTime={currentTime}
                                currentLineIndex={currentLineIndex}
                                lines={VIS_PLAYGROUND_PREVIEW_LINES}
                                theme={previewTheme}
                                subtitleTheme={previewSubtitleTheme}
                                isDaylight={isDaylight}
                                audioPower={audioPower}
                                audioBands={audioBands}
                                songTitle="Cappella Preview"
                                showText
                                staticMode={staticMode}
                                isPreviewMode
                                backgroundOpacity={draftBackgroundOpacity}
                                visualizerOpacity={draftVisualizerOpacity}
                                coverUrl={VIS_PLAYGROUND_PREVIEW_COVER_URL}
                                useCoverColorBg={useCoverColorBg}
                                transparentBackground={transparentPlayerBackground}
                                disableVignette={disableVisualizerVignette}
                                disableGeometricBackground={disableVisualizerGeometricBackground}
                                visualizerBackgroundMode={visualizerBackgroundMode}
                                lyricsFontScale={normalizedFontScale}
                                subtitleOverlayOpacity={draftSubtitleOverlayOpacity}
                                hideTranslationSubtitle={hideTranslationSubtitle}
                                showSubtitleTranslation={showSubtitleTranslation}
                                visualizerTunings={draftVisualizerTunings}
                                monetBackgroundTuning={draftMonetBackgroundTuning}
                                onMonetTuningChange={handleMonetTuningDraft}
                                cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                                cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                                monetBackgroundImage={monetBackgroundImage}
                                monetPortraitImage={monetPortraitImage}
                                urlBackgroundList={urlBackgroundList}
                                urlBackgroundSelectedId={urlBackgroundSelectedId}
                                seed={getVisualizerScopedSeed(visualizerMode, 'vis-playground')}
                            />
                        </div>
                        <VisPlaygroundPreviewHotspots
                            activeSection={activeEditSection}
                            onSectionChange={setActiveEditSection}
                            theme={previewTheme}
                            labels={hotspotLabels}
                        />
                    </div>

                    <VisPlaygroundSettingsPanel
                        activeSection={activeEditSection}
                        onSectionChange={setActiveEditSection}
                        t={t}
                        isDaylight={isDaylight}
                        theme={previewTheme}
                        visualizerMode={visualizerMode}
                        visualizerEntry={visualizerEntry}
                        onVisualizerModeChange={onVisualizerModeChange}
                        onResetVisualizerTuning={handleResetVisualizerTuning}
                        controlCardBg={controlCardBg}
                        rangeInputClass={rangeInputClass}
                        backgroundOpacity={draftBackgroundOpacity}
                        onBackgroundOpacityChange={handleBackgroundOpacityDraft}
                        visualizerOpacity={draftVisualizerOpacity}
                        onVisualizerOpacityChange={handleVisualizerOpacityDraft}
                        useCoverColorBg={useCoverColorBg}
                        onToggleCoverColorBg={onToggleCoverColorBg}
                        disableVisualizerVignette={disableVisualizerVignette}
                        onToggleDisableVisualizerVignette={onToggleDisableVisualizerVignette}
                        disableVisualizerGeometricBackground={disableVisualizerGeometricBackground}
                        onToggleDisableVisualizerGeometricBackground={onToggleDisableVisualizerGeometricBackground}
                        visualizerBackgroundMode={visualizerBackgroundMode}
                        onVisualizerBackgroundModeChange={onVisualizerBackgroundModeChange}
                        onResetBackgroundSettings={handleResetBackgroundSettings}
                        fontStyleValue={customFontFamily ? 'custom' : fontStyle}
                        builtinFontOptions={builtinFontOptions}
                        fontStyleOptions={fontStyleOptions}
                        subtitleFontStyleOptions={subtitleFontStyleOptions}
                        onFontStyleChange={handleSelectFontStyle}
                        fontScale={normalizedFontScale}
                        fontScaleOptions={FONT_SCALE_OPTIONS}
                        onFontScaleChange={handleFontScaleDraft}
                        onResetCommonSettings={handleResetCommonSettings}
                        classicTuning={draftClassicTuning}
                        onClassicTuningChange={handleClassicTuningDraft}
                        partitaTuning={resolvedPartitaTuning}
                        onPartitaTuningChange={handlePartitaTuningDraft}
                        fumeTuning={resolvedFumeTuning}
                        onFumeTuningChange={handleFumeTuningChange}
                        claddaghTuning={draftCladdaghTuning}
                        onCladdaghTuningChange={handleCladdaghTuningChange}
                        cappellaTuning={cappellaTuning}
                        cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                        onCappellaTuningChange={onCappellaTuningChange}
                        isLoadingCappellaCustomEmojiPack={isLoadingCappellaCustomEmojiPack}
                        onImportCappellaCustomEmojiPack={onImportCappellaCustomEmojiPack}
                        onClearCappellaCustomEmojiPack={onClearCappellaCustomEmojiPack}
                        cappellaCustomAvatarImages={cappellaCustomAvatarImages}
                        onImportCappellaCustomAvatar={onImportCappellaCustomAvatar}
                        onClearCappellaCustomAvatar={onClearCappellaCustomAvatar}
                        isLoadingCappellaCustomAvatarPack={isLoadingCappellaCustomAvatarPack}
                        tiltTuning={draftTiltTuning}
                        onTiltTuningChange={handleTiltTuningDraft}
                        dioramaTuning={draftDioramaTuning}
                        onDioramaTuningChange={handleDioramaTuningDraft}
                        monetBackgroundTuning={draftMonetBackgroundTuning}
                        onMonetBackgroundTuningChange={handleMonetBackgroundTuningDraft}
                        monetTuning={draftMonetTuning}
                        onMonetTuningChange={handleMonetTuningDraft}
                        onResetMonetTuning={onResetMonetTuning}
                        monetBackgroundImage={monetBackgroundImage}
                        onUploadMonetBackgroundImage={onUploadMonetBackgroundImage}
                        onClearMonetBackgroundImage={onClearMonetBackgroundImage}
                        isLoadingMonetBackgroundImage={isLoadingMonetBackgroundImage}
                        monetPortraitImage={monetPortraitImage}
                        onUploadMonetPortraitImage={onUploadMonetPortraitImage}
                        onClearMonetPortraitImage={onClearMonetPortraitImage}
                        isLoadingMonetPortraitImage={isLoadingMonetPortraitImage}
                        urlBackgroundList={urlBackgroundList}
                        urlBackgroundSelectedId={urlBackgroundSelectedId}
                        onAddUrlBackgroundItem={onAddUrlBackgroundItem}
                        onUpdateUrlBackgroundItem={onUpdateUrlBackgroundItem}
                        onDeleteUrlBackgroundItem={onDeleteUrlBackgroundItem}
                        onSetUrlBackgroundSelectedId={onSetUrlBackgroundSelectedId}
                        hideTranslationSubtitle={hideTranslationSubtitle}
                        onToggleHideTranslationSubtitle={onToggleHideTranslationSubtitle}
                        showSubtitleTranslation={showSubtitleTranslation}
                        onToggleShowSubtitleTranslation={onToggleShowSubtitleTranslation}
                        subtitleOverlayOpacity={draftSubtitleOverlayOpacity}
                        onSubtitleOverlayOpacityChange={handleSubtitleOverlayOpacityDraft}
                        subtitleFontInheritsLyrics={subtitleFontInheritsLyrics}
                        onSubtitleFontInheritsLyricsChange={onSubtitleFontInheritsLyricsChange}
                        subtitleFontStyle={subtitleFontStyle}
                        onSubtitleFontStyleChange={onSubtitleFontStyleChange}
                        subtitleFontFamily={subtitleFontFamily}
                        onSubtitleFontFamilyChange={onSubtitleFontFamilyChange}
                        subtitleFontFallbackFamilies={subtitleFontFallbackFamilies}
                        onSubtitleFontFallbackFamiliesChange={onSubtitleFontFallbackFamiliesChange}
                        onOpenSubtitleFontPicker={() => loadSystemFonts('subtitle')}
                        onResetSubtitleSettings={handleResetSubtitleSettings}
                        onSliderPointerDown={handleSliderPointerDown}
                        onSliderCommit={handleSliderCommit}
                    />
                </div>

                {isFontPickerOpen && (
                    <div className="absolute inset-0 z-30 bg-black/45 backdrop-blur-md p-4 sm:p-6">
                        <div className={`mx-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-[28px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.32)]`}>
                            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {shouldShowUploadedFontFallback
                                            ? t('options.uploadCustomFont')
                                            : t('options.chooseSystemFont')}
                                    </div>
                                    <div className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {shouldShowUploadedFontFallback
                                            ? (t('options.uploadCustomFontDesc'))
                                            : (t('options.chooseSystemFontDesc'))}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setIsFontPickerOpen(false)}
                                    className="h-10 w-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center transition-colors hover:bg-white/10"
                                    style={{ color: 'var(--text-primary)' }}
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {!shouldShowUploadedFontFallback && (
                                <div className="border-b border-white/10 px-5 py-4">
                                    <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                                        <Search size={16} style={{ color: 'var(--text-secondary)' }} />
                                        <input
                                            type="text"
                                            value={fontSearchQuery}
                                            onChange={(event) => setFontSearchQuery(event.target.value)}
                                            placeholder={t('options.searchSystemFont')}
                                            className="w-full bg-transparent text-sm outline-none placeholder:opacity-40"
                                            style={{ color: 'var(--text-primary)' }}
                                        />
                                    </label>
                                </div>
                            )}

                            <div ref={fontListRef} className="min-h-0 flex-1 overflow-hidden p-5">
                                {shouldShowUploadedFontFallback ? (
                                    <div className="space-y-4">
                                        <input
                                            ref={fontUploadInputRef}
                                            type="file"
                                            accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf,application/font-woff,application/font-woff2,application/x-font-ttf,application/x-font-otf,application/vnd.ms-opentype"
                                            className="hidden"
                                            onChange={handleUploadFontFile}
                                        />
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.currentFont')}
                                            </div>
                                            <div className="mt-1 text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {fontPickerTarget === 'subtitle'
                                                    ? (subtitleFontFamily || t('options.systemFontInactive'))
                                                    : (customFontFamily
                                                        ? currentFontLabel
                                                        : t('options.systemFontInactive'))}
                                            </div>
                                            <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                {fontPickerTarget === 'subtitle'
                                                    ? (subtitleFontFallbackFamilies.length > 0 ? subtitleFontFallbackFamilies.join(', ') : t('options.fontFallbackEmpty'))
                                                    : (fontFallbackFamilies.length > 0 ? fontFallbackFamilies.join(', ') : t('options.fontFallbackEmpty'))}
                                            </div>
                                        </div>
                                        <FontFallbackStackControl
                                            label={t('options.fontFallbackFamilies')}
                                            value={fontPickerTarget === 'subtitle' ? subtitleFontFallbackFamilies : fontFallbackFamilies}
                                            onChange={fontPickerTarget === 'subtitle' ? onSubtitleFontFallbackFamiliesChange : onFontFallbackFamiliesChange}
                                            theme={activePickerTheme}
                                            placeholder={t('options.fontFallbackFamiliesPlaceholder') || 'Songti SC, SimSun, serif'}
                                        />
                                        {fontPickerError && (
                                            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm leading-6 text-red-200">
                                                {fontPickerError}
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => fontUploadInputRef.current?.click()}
                                            disabled={isUploadingCustomFont}
                                            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-semibold text-zinc-950 transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-45"
                                        >
                                            {isUploadingCustomFont ? (
                                                <Loader2 size={17} className="animate-spin" />
                                            ) : (
                                                <Upload size={17} />
                                            )}
                                            {isUploadingCustomFont
                                                ? (t('options.uploadingCustomFont'))
                                                : t('options.uploadCustomFont')}
                                        </button>
                                        {activePickerFontFamily && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (fontPickerTarget === 'subtitle') {
                                                        onSubtitleFontFamilyChange?.(null);
                                                    } else {
                                                        onCustomFontChange(null);
                                                    }
                                                    setFontPickerTarget('none');
                                                }}
                                                className="flex h-11 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition hover:bg-white/10"
                                                style={{ color: 'var(--text-primary)' }}
                                            >
                                                {t('options.clearSystemFont')}
                                            </button>
                                        )}
                                    </div>
                                ) : isLoadingSystemFonts ? (
                                    <div className="h-full flex items-center justify-center text-sm gap-3" style={{ color: 'var(--text-secondary)' }}>
                                        <Loader2 size={18} className="animate-spin" />
                                        <span>{t('options.loadingSystemFonts')}</span>
                                    </div>
                                ) : fontPickerError ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                                        {fontPickerError}
                                    </div>
                                ) : filteredSystemFonts.length === 0 ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.systemFontNoResults')}
                                    </div>
                                ) : (
                                    <div className="flex h-full min-h-0 flex-col gap-4">
                                        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                                            <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                {t('options.currentFont')}
                                            </div>
                                            <div className="mt-1 text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {fontPickerTarget === 'subtitle'
                                                    ? (subtitleFontFamily || t('options.systemFontInactive'))
                                                    : (customFontFamily
                                                        ? currentFontLabel
                                                        : t('options.systemFontInactive'))}
                                            </div>
                                            <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                                {fontPickerTarget === 'subtitle'
                                                    ? (subtitleFontFallbackFamilies.length > 0 ? subtitleFontFallbackFamilies.join(', ') : t('options.fontFallbackEmpty'))
                                                    : (fontFallbackFamilies.length > 0 ? fontFallbackFamilies.join(', ') : t('options.fontFallbackEmpty'))}
                                            </div>
                                        </div>
                                        <FontFallbackStackControl
                                            label={t('options.fontFallbackFamilies')}
                                            value={fontPickerTarget === 'subtitle' ? subtitleFontFallbackFamilies : fontFallbackFamilies}
                                            onChange={fontPickerTarget === 'subtitle' ? onSubtitleFontFallbackFamiliesChange : onFontFallbackFamiliesChange}
                                            theme={activePickerTheme}
                                            placeholder={t('options.fontFallbackFamiliesPlaceholder') || 'Songti SC, SimSun, serif'}
                                        />
                                        <div className="min-h-0 flex-1">
                                            <List
                                                listRef={fontVirtualListRef}
                                                rowCount={filteredSystemFonts.length}
                                                rowHeight={FONT_ROW_HEIGHT}
                                                rowComponent={FontRow}
                                                rowProps={{}}
                                                overscanCount={6}
                                                className="custom-scrollbar"
                                                style={{ height: Math.max(160, fontListHeight - 168), width: '100%' }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </motion.div>
        </motion.div>
    );
};

export default VisPlayground;
