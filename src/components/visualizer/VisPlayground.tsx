import React, { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { ChevronLeft, Loader2, RotateCcw, Search, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { List, useListRef } from 'react-window';
import Visualizer from './Visualizer';
import VisualizerCadenza from './VisualizerCadenza';
import VisualizerPartita from './VisualizerPartita';
import VisualizerFume from './VisualizerFume';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_PARTITA_TUNING,
    type AudioBands,
    type CadenzaTuning,
    type FumeTuning,
    type Line,
    type PartitaTuning,
    type Theme,
    type VisualizerMode,
} from '../../types';
import { getLineRenderEndTime } from '../../utils/lyrics/renderHints';
import { resolveThemeFontStack } from '../../utils/fontStacks';
import {
    getVisPlaygroundPreviewStartOffset,
    VIS_PLAYGROUND_PREVIEW_LINES,
    VIS_PLAYGROUND_PREVIEW_LOOP_DURATION,
} from './visPlaygroundPreview';

interface VisPlaygroundProps {
    theme?: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    backgroundOpacity?: number;
    staticMode?: boolean;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    fontStyle: Theme['fontStyle'];
    fontScale: number;
    customFontFamily: string | null;
    customFontLabel: string | null;
    onFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onFontScaleChange: (fontScale: number) => void;
    onCustomFontChange: (font: { family: string; label?: string | null; } | null) => void;
    onPartitaTuningChange?: (patch: Partial<PartitaTuning>) => void;
    onResetPartitaTuning?: () => void;
    onFumeTuningChange?: (patch: Partial<FumeTuning>) => void;
    onResetFumeTuning?: () => void;
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
const clampFumeHeroScale = (value: number) => Math.min(1.32, Math.max(0.82, value));

const findPreviewLineIndex = (lines: Line[], time: number) => {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index];
        if (!line || time < line.startTime) {
            continue;
        }

        if (time <= getLineRenderEndTime(line)) {
            return index;
        }
    }

    return -1;
};

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
    fontStyle,
    fontScale,
    customFontFamily,
    customFontLabel,
    onFontStyleChange,
    onFontScaleChange,
    onCustomFontChange,
    onPartitaTuningChange,
    onResetPartitaTuning,
    onFumeTuningChange,
    onResetFumeTuning,
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
    const [currentLineIndex, setCurrentLineIndex] = useState(() => findPreviewLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, 0));
    const [isFontPickerOpen, setIsFontPickerOpen] = useState(false);
    const [isLoadingSystemFonts, setIsLoadingSystemFonts] = useState(false);
    const [systemFonts, setSystemFonts] = useState<LocalFontEntry[]>([]);
    const [fontSearchQuery, setFontSearchQuery] = useState('');
    const [fontPickerError, setFontPickerError] = useState<string | null>(null);
    const [fontListHeight, setFontListHeight] = useState(420);
    const [draftFumeTuning, setDraftFumeTuning] = useState<FumeTuning>(fumeTuning);
    const fontListRef = React.useRef<HTMLDivElement>(null);
    const fontVirtualListRef = useListRef(null);

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
    const effectiveCadenzaTuning = useMemo<CadenzaTuning>(() => ({
        ...cadenzaTuning,
        fontScale: cadenzaTuning.fontScale * normalizedFontScale,
    }), [cadenzaTuning, normalizedFontScale]);
    const resolvedPartitaTuning = useMemo<PartitaTuning>(() => {
        const rawMin = clampPartitaStagger(partitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
        const rawMax = clampPartitaStagger(partitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);

        return {
            showGuideLines: partitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
            staggerMin: Math.min(rawMin, rawMax),
            staggerMax: Math.max(rawMin, rawMax),
        };
    }, [partitaTuning]);
    const resolvedFumeTuning = useMemo<FumeTuning>(() => ({
        hidePrintSymbols: draftFumeTuning.hidePrintSymbols,
        cameraSpeed: clampFumeCameraSpeed(draftFumeTuning.cameraSpeed),
        glowIntensity: clampFumeGlowIntensity(draftFumeTuning.glowIntensity),
        heroScale: clampFumeHeroScale(draftFumeTuning.heroScale),
    }), [draftFumeTuning]);
    const currentFontLabel = customFontLabel || customFontFamily || (t('options.customFont') || '自定义字体');
    const fontStyleOptions: PresetOption<Theme['fontStyle'] | 'custom'>[] = useMemo(() => ([
        ...builtinFontOptions,
        { value: 'custom', label: currentFontLabel },
    ]), [builtinFontOptions, currentFontLabel]);
    const guideLineOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: false, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);
    const visibilityOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: false, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: true, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);
    const filteredSystemFonts = useMemo(() => {
        const query = fontSearchQuery.trim().toLocaleLowerCase();
        if (!query) {
            return systemFonts;
        }

        return systemFonts.filter(font => font.label.toLocaleLowerCase().includes(query));
    }, [fontSearchQuery, systemFonts]);

    useEffect(() => {
        setDraftFumeTuning(fumeTuning);
    }, [fumeTuning]);

    useEffect(() => {
        let frameId = 0;
        const startedAt = performance.now();
        const previewOffset = getVisPlaygroundPreviewStartOffset(visualizerMode);

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
        const nextIndex = findPreviewLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, latest);
        setCurrentLineIndex(prev => (prev === nextIndex ? prev : nextIndex));
    });

    const modeLabel = visualizerMode === 'classic'
        ? (t('ui.visualizerClassic') || '流光')
        : visualizerMode === 'cadenza'
            ? (t('ui.visualizerCadenze') || '心象')
            : visualizerMode === 'partita'
                ? (t('ui.visualizerPartita') || '云阶')
                : (t('ui.visualizerFume') || '浮名');
    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-950/88';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const tabSwitcherBg = isDaylight ? 'bg-black/5' : 'bg-white/5';
    const activeTabBg = isDaylight ? 'bg-black/10' : 'bg-white/10';
    const controlCardBg = isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)';
    const overlayBackground = isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';

    const handleReset = () => {
        onCustomFontChange(null);
        onFontStyleChange('sans');
        onFontScaleChange(1);
        if (visualizerMode === 'partita') {
            onResetPartitaTuning?.();
        }
        if (visualizerMode === 'fume') {
            setDraftFumeTuning(DEFAULT_FUME_TUNING);
            onResetFumeTuning?.();
        }
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
            family: font.family,
            label: font.label,
        });
        setIsFontPickerOpen(false);
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

    const handlePartitaGuideLinesChange = (enabled: boolean) => {
        onPartitaTuningChange?.({ showGuideLines: enabled });
    };

    const handlePartitaMinChange = (next: number) => {
        const clampedNext = clampPartitaStagger(next);
        onPartitaTuningChange?.({
            staggerMin: clampedNext,
            staggerMax: Math.max(clampedNext, resolvedPartitaTuning.staggerMax),
        });
    };

    const handlePartitaMaxChange = (next: number) => {
        const clampedNext = clampPartitaStagger(next);
        onPartitaTuningChange?.({
            staggerMin: Math.min(resolvedPartitaTuning.staggerMin, clampedNext),
            staggerMax: clampedNext,
        });
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
            className="fixed inset-0 z-[130] backdrop-blur-xl px-3 pt-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-5"
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
                            {visualizerMode === 'classic' ? (
                                <Visualizer
                                    currentTime={currentTime}
                                    currentLineIndex={currentLineIndex}
                                    lines={VIS_PLAYGROUND_PREVIEW_LINES}
                                    theme={previewTheme}
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    showText
                                    staticMode={staticMode}
                                    backgroundOpacity={backgroundOpacity}
                                    lyricsFontScale={normalizedFontScale}
                                    seed="vis-playground-classic"
                                />
                            ) : visualizerMode === 'cadenza' ? (
                                <VisualizerCadenza
                                    currentTime={currentTime}
                                    currentLineIndex={currentLineIndex}
                                    lines={VIS_PLAYGROUND_PREVIEW_LINES}
                                    theme={previewTheme}
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    showText
                                    staticMode={staticMode}
                                    backgroundOpacity={backgroundOpacity}
                                    cadenzaTuning={effectiveCadenzaTuning}
                                    lyricsFontScale={normalizedFontScale}
                                    seed="vis-playground-cadenza"
                                />
                            ) : visualizerMode === 'partita' ? (
                                <VisualizerPartita
                                    currentTime={currentTime}
                                    currentLineIndex={currentLineIndex}
                                    lines={VIS_PLAYGROUND_PREVIEW_LINES}
                                    theme={previewTheme}
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    showText
                                    staticMode={staticMode}
                                    backgroundOpacity={backgroundOpacity}
                                    partitaTuning={resolvedPartitaTuning}
                                    lyricsFontScale={normalizedFontScale}
                                    seed="vis-playground-partita"
                                />
                            ) : (
                                <VisualizerFume
                                    currentTime={currentTime}
                                    currentLineIndex={currentLineIndex}
                                    lines={VIS_PLAYGROUND_PREVIEW_LINES}
                                    theme={previewTheme}
                                    audioPower={audioPower}
                                    audioBands={audioBands}
                                    showText
                                    staticMode={staticMode}
                                    backgroundOpacity={backgroundOpacity}
                                    lyricsFontScale={normalizedFontScale}
                                    fumeTuning={resolvedFumeTuning}
                                    seed="vis-playground-fume"
                                />
                            )}
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
                                        className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                    />
                                </div>
                            </div>

                            {visualizerMode === 'partita' && (
                                <div
                                    className="rounded-[24px] border border-white/10 p-4 space-y-4"
                                    style={{ backgroundColor: controlCardBg }}
                                >
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('options.partitaSettings') || '云阶参数'}
                                        </div>
                                        <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.partitaSettingsDesc') || '控制引导线显示和分块横向错位范围。'}
                                        </div>
                                    </div>

                                    <PresetGroup
                                        label={t('options.partitaGuideLines') || '引导线'}
                                        value={resolvedPartitaTuning.showGuideLines}
                                        options={guideLineOptions}
                                        onChange={handlePartitaGuideLinesChange}
                                        isDaylight={isDaylight}
                                    />

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                            <span>{t('options.partitaStaggerMin') || '错位最小值'}</span>
                                            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {resolvedPartitaTuning.staggerMin}px
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="180"
                                            step="5"
                                            value={resolvedPartitaTuning.staggerMin}
                                            onChange={(event) => handlePartitaMinChange(parseFloat(event.target.value))}
                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                            <span>{t('options.partitaStaggerMax') || '错位最大值'}</span>
                                            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {resolvedPartitaTuning.staggerMax}px
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="180"
                                            step="5"
                                            value={resolvedPartitaTuning.staggerMax}
                                            onChange={(event) => handlePartitaMaxChange(parseFloat(event.target.value))}
                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                        />
                                    </div>
                                </div>
                            )}

                            {visualizerMode === 'fume' && (
                                <div
                                    className="rounded-[24px] border border-white/10 p-4 space-y-4"
                                    style={{ backgroundColor: controlCardBg }}
                                >
                                    <div className="space-y-1">
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {t('options.fumeSettings') || '浮名参数'}
                                        </div>
                                        <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                            {t('options.fumeSettingsDesc') || '控制打印方块、镜头节奏、辉光和大标题比例。'}
                                        </div>
                                    </div>

                                    <PresetGroup
                                        label={t('options.fumeHidePrintSymbols') || '隐藏打印方块'}
                                        value={resolvedFumeTuning.hidePrintSymbols}
                                        options={visibilityOptions}
                                        onChange={(next) => handleFumeTuningChange({ hidePrintSymbols: next })}
                                        isDaylight={isDaylight}
                                    />

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                            <span>{t('options.fumeCameraSpeed') || '摄影机移动速度'}</span>
                                            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {resolvedFumeTuning.cameraSpeed.toFixed(2)}x
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.55"
                                            max="1.85"
                                            step="0.05"
                                            value={resolvedFumeTuning.cameraSpeed}
                                            onChange={(event) => handleFumeTuningChange({ cameraSpeed: parseFloat(event.target.value) })}
                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                            <span>{t('options.fumeGlowIntensity') || '当前句辉光强度'}</span>
                                            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {resolvedFumeTuning.glowIntensity.toFixed(2)}x
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0"
                                            max="1.8"
                                            step="0.05"
                                            value={resolvedFumeTuning.glowIntensity}
                                            onChange={(event) => handleFumeTuningChange({ glowIntensity: parseFloat(event.target.value) })}
                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                                            <span>{t('options.fumeHeroScale') || '大标题比例'}</span>
                                            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {resolvedFumeTuning.heroScale.toFixed(2)}x
                                            </span>
                                        </div>
                                        <input
                                            type="range"
                                            min="0.82"
                                            max="1.32"
                                            step="0.02"
                                            value={resolvedFumeTuning.heroScale}
                                            onChange={(event) => handleFumeTuningChange({ heroScale: parseFloat(event.target.value) })}
                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:transition-transform"
                                        />
                                    </div>
                                </div>
                            )}

                        </div>
                    </div>
                </div>

                {isFontPickerOpen && (
                    <div className="absolute inset-0 z-30 bg-black/45 backdrop-blur-md p-4 sm:p-6">
                        <div className={`mx-auto flex h-full max-w-2xl flex-col overflow-hidden rounded-[28px] border ${borderColor} ${glassBg} shadow-[0_24px_80px_rgba(0,0,0,0.32)]`}>
                            <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4">
                                <div className="min-w-0">
                                    <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                        {t('options.chooseSystemFont') || '选择自定义字体'}
                                    </div>
                                    <div className="text-xs opacity-50 mt-1" style={{ color: 'var(--text-secondary)' }}>
                                        {t('options.chooseSystemFontDesc') || '从当前系统已安装字体中选择一个字体。'}
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

                            <div ref={fontListRef} className="min-h-0 flex-1 overflow-hidden p-5">
                                {isLoadingSystemFonts ? (
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
