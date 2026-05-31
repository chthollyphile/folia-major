import React, { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { ChevronLeft, Loader2, RotateCcw, Search, Sparkles, Upload, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef } from 'react-window';
import VisualizerRenderer from './VisualizerRenderer';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_CAPPELLA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_PARTITA_TUNING,
    DEFAULT_TILT_TUNING,
    type AudioBands,
    type CappellaEmojiImage,
    type CappellaTuning,
    type CadenzaTuning,
    type FumeTuning,
    type PartitaTuning,
    type StoredCustomLyricsFont,
    type Theme,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import {
    findPreviewPlaceholderLineIndex,
    getPreviewPlaceholderStartOffset,
    VIS_PLAYGROUND_PREVIEW_LINES,
    VIS_PLAYGROUND_PREVIEW_LOOP_DURATION,
} from './PreviewPlaceholder';
import { getVisualizerModeLabel, getVisualizerRegistryEntry, getVisualizerScopedSeed } from './registry';

interface VisPlaygroundProps {
    theme?: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    backgroundOpacity?: number;
    staticMode?: boolean;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    cappellaTuning?: CappellaTuning;
    tiltTuning?: TiltTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    fontStyle: Theme['fontStyle'];
    fontScale: number;
    customFontFamily: string | null;
    customFontLabel: string | null;
    onFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onFontScaleChange: (fontScale: number) => void;
    onCustomFontChange: (font: StoredCustomLyricsFont | null) => void;
    onUploadCustomFont?: (file: File) => Promise<{ ok: boolean; error?: string; }>;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    onResetPartitaTuning?: () => void;
    onFumeTuningChange?: (patch: Partial<FumeTuning>) => void;
    onResetFumeTuning?: () => void;
    onCappellaTuningChange?: (patch: Partial<CappellaTuning>) => void;
    onResetCappellaTuning?: () => void;
    onTiltTuningChange?: (patch: Partial<TiltTuning>) => void;
    onResetTiltTuning?: () => void;
    onImportCappellaCustomEmojiPack?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearCappellaCustomEmojiPack?: () => Promise<void> | void;
    isLoadingCappellaCustomEmojiPack?: boolean;
    onClose: () => void;
}

interface PresetOption<T> {
    label: string;
    value: T;
}

interface PresetGroupProps<T> {
    label: string;
    value: T;
    options: PresetOption<T>[];
    onChange: (next: T) => void;
    isDaylight: boolean;
    isOptionActive?: (option: PresetOption<T>) => boolean;
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

const PresetGroup = <T,>({
    label,
    value,
    options,
    onChange,
    isDaylight,
    isOptionActive,
}: PresetGroupProps<T>) => (
    <div className="space-y-2.5">
        <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
            {label}
        </div>
        <div className="flex flex-wrap gap-2">
            {options.map(option => {
                const isActive = isOptionActive ? isOptionActive(option) : option.value === value;

                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => onChange(option.value)}
                        className="px-3 py-2 rounded-full text-sm transition-all border"
                        style={{
                            color: 'var(--text-primary)',
                            borderColor: isActive ? 'var(--text-accent)' : (isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)'),
                            backgroundColor: isActive
                                ? (isDaylight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)')
                                : (isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)'),
                            boxShadow: isActive ? '0 8px 22px rgba(0,0,0,0.14)' : 'none',
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

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
    backgroundOpacity = 0.75,
    staticMode = false,
    cadenzaTuning = DEFAULT_CADENZA_TUNING,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    fumeTuning = DEFAULT_FUME_TUNING,
    cappellaTuning = DEFAULT_CAPPELLA_TUNING,
    tiltTuning = DEFAULT_TILT_TUNING,
    cappellaCustomEmojiImages = [],
    fontStyle,
    fontScale,
    customFontFamily,
    customFontLabel,
    onFontStyleChange,
    onFontScaleChange,
    onCustomFontChange,
    onUploadCustomFont,
    onPartitaTuningChange,
    onResetPartitaTuning,
    onFumeTuningChange,
    onResetFumeTuning,
    onCappellaTuningChange,
    onResetCappellaTuning,
    onTiltTuningChange,
    onResetTiltTuning,
    onImportCappellaCustomEmojiPack,
    onClearCappellaCustomEmojiPack,
    isLoadingCappellaCustomEmojiPack = false,
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
    const [currentLineIndex, setCurrentLineIndex] = useState(() => findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, 0));
    const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
    const [isLoadingSystemFonts, setIsLoadingSystemFonts] = useState(false);
    const [systemFonts, setSystemFonts] = useState<LocalFontEntry[]>([]);
    const [fontSearchQuery, setFontSearchQuery] = useState('');
    const [fontPickerError, setFontPickerError] = useState<string | null>(null);
    const [fontListHeight, setFontListHeight] = useState(420);
    const [isUploadingCustomFont, setIsUploadingCustomFont] = useState(false);
    const [draftFumeTuning, setDraftFumeTuning] = useState<FumeTuning>(fumeTuning);
    const fontListRef = React.useRef<HTMLDivElement>(null);
    const fontVirtualListRef = useListRef(null);
    const fontUploadInputRef = React.useRef<HTMLInputElement>(null);

    const audioBands = useMemo<AudioBands>(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
    }), [bass, lowMid, mid, treble, vocal]);

    const normalizedFontScale = clampFontScale(fontScale);
    const builtinFontOptions: PresetOption<Theme['fontStyle']>[] = useMemo(() => ([
        { value: 'sans', label: t('options.fontSans') || '无衬线' },
        { value: 'serif', label: t('options.fontSerif') || '衬线' },
        { value: 'mono', label: t('options.fontMono') || '等宽' },
    ]), [t]);
    const baseTheme = theme ?? PREVIEW_THEME;
    const previewTheme = useMemo<Theme>(() => ({
        ...baseTheme,
        fontStyle,
        fontFamily: customFontFamily ?? undefined,
    }), [baseTheme, customFontFamily, fontStyle]);
    const resolvedPartitaTuning = useMemo<PartitaTuning>(() => {
        const rawMin = clampPartitaStagger(partitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
        const rawMax = clampPartitaStagger(partitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);

        return {
            showGuideLines: partitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
            useSemanticLayout: partitaTuning.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
    }, [partitaTuning]);
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
    const currentFontLabel = customFontLabel || customFontFamily || (t('options.customFont') || '自定义字体');
    const fontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[] = useMemo(() => ([
        ...builtinFontOptions,
        { value: 'custom', label: currentFontLabel },
    ]), [builtinFontOptions, currentFontLabel]);
    const filteredSystemFonts = useMemo(() => {
        const query = fontSearchQuery.trim().toLocaleLowerCase();
        if (!query) {
            return systemFonts;
        }

        return systemFonts.filter(font => font.label.toLocaleLowerCase().includes(query));
    }, [fontSearchQuery, systemFonts]);
    const canQueryLocalFonts = typeof window !== 'undefined' && Boolean((window as QueryLocalFontsWindow).queryLocalFonts);
    const shouldShowUploadedFontFallback = !canQueryLocalFonts && isMobileBrowser() && Boolean(onUploadCustomFont);

    useEffect(() => {
        setDraftFumeTuning(fumeTuning);
    }, [fumeTuning]);

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

            frameId = window.requestAnimationFrame(tick);
        };

        frameId = window.requestAnimationFrame(tick);
        return () => window.cancelAnimationFrame(frameId);
    }, [audioPower, bass, currentTime, lowMid, mid, treble, visualizerMode, vocal]);

    useMotionValueEvent(currentTime, 'change', latest => {
        const nextIndex = findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, latest);
        setCurrentLineIndex(prev => (prev === nextIndex ? prev : nextIndex));
    });

    const visualizerEntry = getVisualizerRegistryEntry(visualizerMode);
    const modeLabel = getVisualizerModeLabel(visualizerMode, t);
    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-950/88';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const tabSwitcherBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const activeTabBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const controlCardBg = isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)';
    const overlayBackground = isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';
    const rangeInputClass = [
        'w-full h-1.5 rounded-full appearance-none cursor-pointer',
        '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform',
        '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:transition-transform',
        isDaylight
            ? 'bg-black/15 [&::-webkit-slider-thumb]:bg-zinc-700 [&::-moz-range-thumb]:bg-zinc-700'
            : 'bg-white/10 [&::-webkit-slider-thumb]:bg-white [&::-moz-range-thumb]:bg-white',
    ].join(' ');

    const handleReset = () => {
        onCustomFontChange(null);
        onFontStyleChange('sans');
        onFontScaleChange(1);
        visualizerEntry.resetSettings?.({
            resetPartitaTuning: onResetPartitaTuning,
            resetFumeTuning: onResetFumeTuning,
            resetCappellaTuning: onResetCappellaTuning,
            resetTiltTuning: onResetTiltTuning,
            setDraftFumeTuning,
        });
    };

    const handleSelectBuiltinFont = (next: Theme['fontStyle']) => {
        onCustomFontChange(null);
        onFontStyleChange(next);
    };

    const loadSystemFonts = async () => {
        setIsFontPickerOpen(true);
        setFontPickerError(null);

        if (systemFonts.length > 0 || isLoadingSystemFonts) {
            return;
        }

        const localFontWindow = window as QueryLocalFontsWindow;
        if (!localFontWindow.queryLocalFonts) {
            if (shouldShowUploadedFontFallback) {
                return;
            }

            setFontPickerError(t('options.systemFontUnsupported') || '当前环境无法读取本机字体。');
            return;
        }

        setIsLoadingSystemFonts(true);
        try {
            const fonts = await localFontWindow.queryLocalFonts();
            const nextFonts = dedupeLocalFonts(fonts);
            setSystemFonts(nextFonts);
            if (nextFonts.length === 0) {
                setFontPickerError(t('options.systemFontEmpty') || '没有读取到可用字体。');
            }
        } catch (error) {
            console.error('[VisPlayground] Failed to query local fonts:', error);
            setFontPickerError(
                error instanceof Error && error.message
                    ? error.message
                    : (t('options.systemFontPermissionDenied') || '读取本机字体失败，请检查权限。')
            );
        } finally {
            setIsLoadingSystemFonts(false);
        }
    };

    const handleChooseSystemFont = (font: LocalFontEntry) => {
        onCustomFontChange({
            source: 'system',
            family: font.family,
            label: font.label,
        });
        setIsFontPickerOpen(false);
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
                setFontPickerError(result.error || (t('options.uploadFontFailed') || '上传字体失败。'));
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
        const isActive = customFontFamily?.toLocaleLowerCase() === font.family.toLocaleLowerCase();

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
                                fontStyle,
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
    }, [customFontFamily, filteredSystemFonts, fontStyle, handleChooseSystemFont, isDaylight]);

    const handleSelectFontStyle = (next: Theme['fontStyle'] | 'custom') => {
        if (next === 'custom') {
            void loadSystemFonts();
            return;
        }

        handleSelectBuiltinFont(next);
    };

    const handleFumeTuningChange = (patch: Partial<FumeTuning>) => {
        setDraftFumeTuning(previous => ({ ...previous, ...patch }));
        onFumeTuningChange?.(patch);
    };

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
                                {t('options.lyricsStyleSettings') || '歌词样式'}
                            </div>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleReset}
                        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm transition-colors hover:bg-white/10"
                        style={{ color: 'var(--text-primary)' }}
                    >
                        <RotateCcw size={14} />
                        <span>{t('ui.default') || '默认'}</span>
                    </button>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.25fr)_360px]">
                    <div className="relative min-h-[320px] overflow-hidden rounded-[28px] border border-white/10 bg-black/20">
                        <div className="absolute left-4 top-4 z-20 inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs uppercase tracking-[0.22em] backdrop-blur-md" style={{ color: 'rgba(255,255,255,0.78)' }}>
                            <Sparkles size={13} />
                            <span>{t('ui.livePreview') || '实时预览'}</span>
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
                                audioPower={audioPower}
                                audioBands={audioBands}
                                songTitle="Cappella Preview"
                                showText
                                staticMode={staticMode}
                                isPreviewMode
                                backgroundOpacity={backgroundOpacity}
                                lyricsFontScale={normalizedFontScale}
                                cadenzaTuning={cadenzaTuning}
                                partitaTuning={resolvedPartitaTuning}
                                fumeTuning={resolvedFumeTuning}
                                cappellaTuning={cappellaTuning}
                                tiltTuning={tiltTuning}
                                cappellaCustomEmojiImages={cappellaCustomEmojiImages}
                                seed={getVisualizerScopedSeed(visualizerMode, 'vis-playground')}
                            />
                        </div>
                    </div>

                    <div className="min-h-0 flex flex-col gap-4">
                        <div className={`inline-flex w-fit items-center gap-1 rounded-full p-1 ${tabSwitcherBg}`}>
                            <div className={`rounded-full px-3 py-1.5 text-sm ${activeTabBg}`} style={{ color: 'var(--text-primary)' }}>
                                {t('options.fontFamily') || '字体'}
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar space-y-4">
                            <div
                                className="rounded-[24px] border border-white/10 p-4 space-y-4"
                                style={{ backgroundColor: controlCardBg }}
                            >
                                <div className="space-y-1">
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.lyricsStyleSettings') || '歌词样式'}
                                    </div>
                                    <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.lyricsStyleSettingsDesc') || '字体、字号和当前渲染器附加参数'}
                                    </div>
                                </div>

                                <PresetGroup
                                    label={t('options.fontFamily') || '字体'}
                                    value={customFontFamily ? 'custom' : fontStyle}
                                    options={fontStyleOptions}
                                    onChange={handleSelectFontStyle}
                                    isDaylight={isDaylight}
                                    isOptionActive={(option) => option.value === (customFontFamily ? 'custom' : fontStyle)}
                                />

                                <PresetGroup
                                    label={t('options.fontSize') || '字号'}
                                    value={normalizedFontScale}
                                    options={FONT_SCALE_OPTIONS}
                                    onChange={onFontScaleChange}
                                    isDaylight={isDaylight}
                                />

                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                        <span>{t('options.fontSize') || '字号'}</span>
                                        <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                            {Math.round(normalizedFontScale * 100)}%
                                        </span>
                                    </div>
                                    <input
                                        type="range"
                                        min="0.85"
                                        max="1.4"
                                        step="0.05"
                                        value={normalizedFontScale}
                                        onChange={(event) => onFontScaleChange(parseFloat(event.target.value))}
                                        className={rangeInputClass}
                                    />
                                </div>
                            </div>

                            {visualizerEntry.renderSettingsPanel?.({
                                t,
                                isDaylight,
                                controlCardBg,
                                rangeInputClass,
                                partitaTuning: resolvedPartitaTuning,
                                onPartitaTuningChange,
                                fumeTuning: resolvedFumeTuning,
                                onFumeTuningChange: handleFumeTuningChange,
                                cappellaTuning,
                                cappellaCustomEmojiImages,
                                onCappellaTuningChange,
                                cappellaCustomEmojiCount: cappellaCustomEmojiImages.length,
                                hasCappellaCustomEmojiPack: cappellaCustomEmojiImages.length > 0,
                                isCappellaCustomEmojiPackLoading: isLoadingCappellaCustomEmojiPack,
                                onImportCappellaCustomEmojiPack,
                                onClearCappellaCustomEmojiPack,
                                tiltTuning,
                                onTiltTuningChange,
                            })}

                        </div>
                    </div>
                </div>

                {isFontPickerOpen && (
                    <div className="absolute inset-0 z-30 bg-black/45 backdrop-blur-md p-4 sm:p-6">
                        <div className={`mx-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-[28px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.32)]`}>
                            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {shouldShowUploadedFontFallback
                                            ? (t('options.uploadCustomFont') || '上传自定义字体')
                                            : (t('options.chooseSystemFont') || '选择自定义字体')}
                                    </div>
                                    <div className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {shouldShowUploadedFontFallback
                                            ? (t('options.uploadCustomFontDesc') || '当前移动浏览器无法读取系统字体，可上传一个字体文件作为 fallback。')
                                            : (t('options.chooseSystemFontDesc') || '从当前系统已安装字体中选择一个字体。')}
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
                                            placeholder={t('options.searchSystemFont') || '搜索字体'}
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
                                                {t('options.currentFont') || '当前字体'}
                                            </div>
                                            <div className="mt-1 text-base font-medium" style={{ color: 'var(--text-primary)' }}>
                                                {customFontFamily
                                                    ? currentFontLabel
                                                    : (t('options.systemFontInactive') || '未启用')}
                                            </div>
                                        </div>
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
                                                ? (t('options.uploadingCustomFont') || '上传中...')
                                                : (t('options.uploadCustomFont') || '上传自定义字体')}
                                        </button>
                                        {customFontFamily && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    onCustomFontChange(null);
                                                    setIsFontPickerOpen(false);
                                                }}
                                                className="flex h-11 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium transition hover:bg-white/10"
                                                style={{ color: 'var(--text-primary)' }}
                                            >
                                                {t('options.clearSystemFont') || '恢复内置字体'}
                                            </button>
                                        )}
                                    </div>
                                ) : isLoadingSystemFonts ? (
                                    <div className="h-full flex items-center justify-center text-sm gap-3" style={{ color: 'var(--text-secondary)' }}>
                                        <Loader2 size={18} className="animate-spin" />
                                        <span>{t('options.loadingSystemFonts') || '正在读取系统字体...'}</span>
                                    </div>
                                ) : fontPickerError ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                                        {fontPickerError}
                                    </div>
                                ) : filteredSystemFonts.length === 0 ? (
                                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.systemFontNoResults') || '没有找到匹配的系统字体。'}
                                    </div>
                                ) : (
                                    <List
                                        listRef={fontVirtualListRef}
                                        rowCount={filteredSystemFonts.length}
                                        rowHeight={FONT_ROW_HEIGHT}
                                        rowComponent={FontRow}
                                        rowProps={{}}
                                        overscanCount={6}
                                        className="custom-scrollbar"
                                        style={{ height: fontListHeight, width: '100%' }}
                                    />
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
