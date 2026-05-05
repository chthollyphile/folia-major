import React, { useEffect, useMemo, useState } from 'react';
import { motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { ChevronLeft, Palette, RotateCcw, Sun, Moon, Check } from 'lucide-react';
import { HexColorPicker } from 'react-colorful';
import { useTranslation } from 'react-i18next';
import VisualizerRenderer from '../visualizer/VisualizerRenderer';
import {
    DEFAULT_CADENZA_TUNING,
    DEFAULT_FUME_TUNING,
    DEFAULT_LYRA_TUNING,
    DEFAULT_PARTITA_TUNING,
    AudioBands,
    CadenzaTuning,
    DualTheme,
    FumeTuning,
    LyraTuning,
    PartitaTuning,
    Theme,
    VisualizerMode,
} from '../../types';
import {
    findPreviewPlaceholderLineIndex,
    getPreviewPlaceholderStartOffset,
    VIS_PLAYGROUND_PREVIEW_LINES,
    VIS_PLAYGROUND_PREVIEW_LOOP_DURATION,
} from '../visualizer/PreviewPlaceholder';
import { getVisualizerModeLabel, getVisualizerScopedSeed } from '../visualizer/registry';

interface ThemeParkProps {
    initialTheme: DualTheme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    staticMode?: boolean;
    backgroundOpacity?: number;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    lyraTuning?: LyraTuning;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsCustomFontFamily?: string | null;
    onClose: () => void;
    onSaveTheme: (dualTheme: DualTheme) => void;
}

type EditableColorKey = 'backgroundColor' | 'primaryColor' | 'accentColor' | 'secondaryColor';
type EditableMode = 'light' | 'dark';

interface PickerState {
    mode: EditableMode;
    key: EditableColorKey;
}

const COLOR_FIELDS: Array<{ key: EditableColorKey; label: string; description: string; }> = [
    { key: 'backgroundColor', label: '背景', description: '页面主背景与大面积氛围色' },
    { key: 'primaryColor', label: '主文本', description: '主文本与歌词颜色' },
    { key: 'accentColor', label: '强调色', description: '高亮、按钮与歌词发光颜色' },
    { key: 'secondaryColor', label: '辅助色', description: '辅助文本与几何背景颜色' },
];

const normalizeTheme = (theme: Theme, fallbackName: string, provider: string): Theme => ({
    ...theme,
    name: fallbackName,
    provider,
    wordColors: [],
    lyricsIcons: [],
});

const normalizeDualTheme = (dualTheme: DualTheme): DualTheme => ({
    light: normalizeTheme(dualTheme.light, 'Theme Park Light', 'Custom'),
    dark: normalizeTheme(dualTheme.dark, 'Theme Park Dark', 'Custom'),
});

const ThemePreviewLayer: React.FC<{
    theme: Theme;
    mode: EditableMode;
    isActive: boolean;
    visualizerMode: VisualizerMode;
    visualizerModeLabel: string;
    staticMode: boolean;
    backgroundOpacity: number;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    lyraTuning: LyraTuning;
    lyricsFontScale: number;
    currentTime: ReturnType<typeof useMotionValue<number>>;
    currentLineIndex: number;
    audioPower: ReturnType<typeof useMotionValue<number>>;
    audioBands: AudioBands;
    clipPath: string;
    overlayAlign: 'top-left' | 'bottom-right';
}> = ({
    theme,
    mode,
    isActive,
    visualizerMode,
    visualizerModeLabel,
    staticMode,
    backgroundOpacity,
    cadenzaTuning,
    partitaTuning,
    fumeTuning,
    lyraTuning,
    lyricsFontScale,
    currentTime,
    currentLineIndex,
    audioPower,
    audioBands,
    clipPath,
    overlayAlign,
}) => {
    const isLight = mode === 'light';
    const overlayPositionClass = overlayAlign === 'top-left'
        ? 'items-start justify-start'
        : 'items-end justify-end';
    const badgeRowAlignmentClass = overlayAlign === 'top-left'
        ? 'justify-start'
        : 'justify-end';
    const isBottomRight = overlayAlign === 'bottom-right';

    return (
        <div
            className="absolute inset-0 overflow-hidden"
            style={{
                clipPath,
            }}
        >
            <div className="absolute inset-0">
                <VisualizerRenderer
                    mode={visualizerMode}
                    currentTime={currentTime}
                    currentLineIndex={currentLineIndex}
                    lines={VIS_PLAYGROUND_PREVIEW_LINES}
                    theme={theme}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    showText
                    staticMode={staticMode}
                    backgroundOpacity={backgroundOpacity}
                    lyricsFontScale={lyricsFontScale}
                    cadenzaTuning={cadenzaTuning}
                    partitaTuning={partitaTuning}
                    fumeTuning={fumeTuning}
                    lyraTuning={lyraTuning}
                    seed={getVisualizerScopedSeed(visualizerMode, `theme-park-${mode}`)}
                />
            </div>

            <div className={`relative z-10 flex h-full p-4 pointer-events-none ${overlayPositionClass}`}>
                <div className={`flex max-w-full flex-col gap-2 ${badgeRowAlignmentClass}`}>
                    {isBottomRight && (
                        <div className={`flex ${badgeRowAlignmentClass}`}>
                            <div className="inline-flex items-center gap-2 rounded-full px-3 py-2 backdrop-blur-md" style={{ backgroundColor: `${theme.backgroundColor}88` }}>
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.primaryColor }} />
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.secondaryColor }} />
                            </div>
                        </div>
                    )}
                    <div className={`flex max-w-full flex-wrap items-center gap-2 ${badgeRowAlignmentClass}`}>
                        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs uppercase tracking-[0.22em] backdrop-blur-md" style={{ color: theme.primaryColor, borderColor: `${theme.primaryColor}30`, backgroundColor: `${theme.backgroundColor}80` }}>
                            {isLight ? <Sun size={13} /> : <Moon size={13} />}
                            <span>{isLight ? 'Light' : 'Dark'}</span>
                        </div>
                        {isActive && (
                            <div className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs backdrop-blur-md" style={{ color: theme.backgroundColor, backgroundColor: theme.accentColor }}>
                                <Check size={12} />
                                <span>编辑中</span>
                            </div>
                        )}
                        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] uppercase tracking-[0.2em] backdrop-blur-md" style={{ color: theme.secondaryColor, borderColor: `${theme.secondaryColor}25`, backgroundColor: `${theme.backgroundColor}88` }}>
                            <span>{visualizerModeLabel}</span>
                        </div>
                    </div>
                    {!isBottomRight && (
                        <div className={`flex ${badgeRowAlignmentClass}`}>
                            <div className="inline-flex items-center gap-2 rounded-full px-3 py-2 backdrop-blur-md" style={{ backgroundColor: `${theme.backgroundColor}88` }}>
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.accentColor }} />
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.primaryColor }} />
                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: theme.secondaryColor }} />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const DiagonalThemePreview: React.FC<{
    lightTheme: Theme;
    darkTheme: Theme;
    activeMode: EditableMode;
    visualizerMode: VisualizerMode;
    visualizerModeLabel: string;
    staticMode: boolean;
    backgroundOpacity: number;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    lyraTuning: LyraTuning;
    lyricsFontScale: number;
    currentTime: ReturnType<typeof useMotionValue<number>>;
    currentLineIndex: number;
    audioPower: ReturnType<typeof useMotionValue<number>>;
    audioBands: AudioBands;
    onSelectMode: (mode: EditableMode) => void;
}> = ({
    lightTheme,
    darkTheme,
    activeMode,
    visualizerMode,
    visualizerModeLabel,
    staticMode,
    backgroundOpacity,
    cadenzaTuning,
    partitaTuning,
    fumeTuning,
    lyraTuning,
    lyricsFontScale,
    currentTime,
    currentLineIndex,
    audioPower,
    audioBands,
    onSelectMode,
}) => {
    const borderColor = activeMode === 'light' ? lightTheme.accentColor : darkTheme.accentColor;

    return (
        <div
            className="relative isolate h-[min(46vh,460px)] min-h-[300px] overflow-hidden rounded-[30px] border shadow-[0_18px_50px_rgba(0,0,0,0.18)] lg:h-full lg:min-h-0"
            style={{ borderColor }}
        >
            <button
                type="button"
                onClick={() => onSelectMode('light')}
                className="absolute left-0 top-0 z-20 h-[44%] w-[44%]"
                style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
                aria-label="Select light theme preview"
            />
            <button
                type="button"
                onClick={() => onSelectMode('dark')}
                className="absolute bottom-0 right-0 z-20 h-[44%] w-[44%]"
                style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }}
                aria-label="Select dark theme preview"
            />

            <ThemePreviewLayer
                theme={lightTheme}
                mode="light"
                isActive={activeMode === 'light'}
                visualizerMode={visualizerMode}
                visualizerModeLabel={visualizerModeLabel}
                staticMode={staticMode}
                backgroundOpacity={backgroundOpacity}
                cadenzaTuning={cadenzaTuning}
                partitaTuning={partitaTuning}
                fumeTuning={fumeTuning}
                lyraTuning={lyraTuning}
                lyricsFontScale={lyricsFontScale}
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                audioPower={audioPower}
                audioBands={audioBands}
                clipPath="polygon(0 0, 100% 0, 0 100%)"
                overlayAlign="top-left"
            />
            <ThemePreviewLayer
                theme={darkTheme}
                mode="dark"
                isActive={activeMode === 'dark'}
                visualizerMode={visualizerMode}
                visualizerModeLabel={visualizerModeLabel}
                staticMode={staticMode}
                backgroundOpacity={backgroundOpacity}
                cadenzaTuning={cadenzaTuning}
                partitaTuning={partitaTuning}
                fumeTuning={fumeTuning}
                lyraTuning={lyraTuning}
                lyricsFontScale={lyricsFontScale}
                currentTime={currentTime}
                currentLineIndex={currentLineIndex}
                audioPower={audioPower}
                audioBands={audioBands}
                clipPath="polygon(100% 0, 100% 100%, 0 100%)"
                overlayAlign="bottom-right"
            />

        </div>
    );
};

const ThemePark: React.FC<ThemeParkProps> = ({
    initialTheme,
    isDaylight,
    visualizerMode,
    staticMode = false,
    backgroundOpacity = 0.75,
    cadenzaTuning = DEFAULT_CADENZA_TUNING,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    fumeTuning = DEFAULT_FUME_TUNING,
    lyraTuning = DEFAULT_LYRA_TUNING,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsCustomFontFamily,
    onClose,
    onSaveTheme,
}) => {
    const { t } = useTranslation();
    const currentTime = useMotionValue(0);
    const audioPower = useMotionValue(0.24);
    const bass = useMotionValue(0.18);
    const lowMid = useMotionValue(0.15);
    const mid = useMotionValue(0.12);
    const vocal = useMotionValue(0.2);
    const treble = useMotionValue(0.1);
    const [draftTheme, setDraftTheme] = useState<DualTheme>(() => normalizeDualTheme(initialTheme));
    const [currentLineIndex, setCurrentLineIndex] = useState(() => findPreviewPlaceholderLineIndex(VIS_PLAYGROUND_PREVIEW_LINES, 0));
    const [pickerState, setPickerState] = useState<PickerState>({
        mode: isDaylight ? 'light' : 'dark',
        key: 'accentColor',
    });

    useEffect(() => {
        setPickerState(previous => ({
            ...previous,
            mode: isDaylight ? 'light' : previous.mode,
        }));
    }, [isDaylight]);

    const audioBands = useMemo<AudioBands>(() => ({
        bass,
        lowMid,
        mid,
        vocal,
        treble,
    }), [bass, lowMid, mid, vocal, treble]);

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
        setCurrentLineIndex(previous => (previous === nextIndex ? previous : nextIndex));
    });

    const glassBg = isDaylight ? 'bg-white/70' : 'bg-zinc-950/88';
    const borderColor = isDaylight ? 'border-black/5' : 'border-white/10';
    const controlCardBg = isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)';
    const overlayBackground = isDaylight ? 'rgba(255,255,255,0.72)' : 'rgba(0,0,0,0.65)';
    const visualizerModeLabel = getVisualizerModeLabel(visualizerMode, t);
    const activeTheme = draftTheme[pickerState.mode];
    const activeColor = activeTheme[pickerState.key];
    const pickerField = COLOR_FIELDS.find(field => field.key === pickerState.key) ?? COLOR_FIELDS[0];
    const previewTheme = useMemo<DualTheme>(() => ({
        light: {
            ...draftTheme.light,
            fontStyle: lyricsFontStyle,
            fontFamily: lyricsCustomFontFamily ?? undefined,
        },
        dark: {
            ...draftTheme.dark,
            fontStyle: lyricsFontStyle,
            fontFamily: lyricsCustomFontFamily ?? undefined,
        },
    }), [draftTheme, lyricsCustomFontFamily, lyricsFontStyle]);

    const updateColor = (mode: EditableMode, key: EditableColorKey, value: string) => {
        setDraftTheme(previous => ({
            ...previous,
            [mode]: {
                ...previous[mode],
                [key]: value,
            },
        }));
    };

    const handleReset = () => {
        setDraftTheme(normalizeDualTheme(initialTheme));
    };

    const handleSave = () => {
        onSaveTheme(normalizeDualTheme(draftTheme));
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="fixed inset-0 z-[135] backdrop-blur-xl px-3 pt-3 pb-[calc(8.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:pt-5 sm:pb-[calc(5rem+env(safe-area-inset-bottom))]"
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
                <div className="flex flex-col gap-4 border-b border-white/10 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <div className="min-w-0">
                            <div className="truncate text-lg font-semibold sm:text-xl" style={{ color: 'var(--text-primary)' }}>
                                Theme Park
                            </div>
                            <div className="mt-1 text-xs opacity-55" style={{ color: 'var(--text-secondary)' }}>
                                {t('options.themeParkDesc') || '手动创建一套只包含颜色的 dual themes，亮暗模式分别预览。'}
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <button
                            type="button"
                            onClick={handleReset}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm leading-none whitespace-nowrap transition-colors hover:bg-white/10"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <RotateCcw size={14} />
                            <span>{t('ui.resetToDefaultTheme') || '重置'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm leading-none whitespace-nowrap transition-colors hover:bg-white/10"
                            style={{ color: 'var(--text-primary)' }}
                        >
                            <Palette size={14} />
                            <span>{t('options.saveAndApplyCustomTheme') || '保存并应用自定义主题'}</span>
                        </button>
                    </div>
                </div>

                <div className="grid min-h-0 flex-1 gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_380px] lg:items-stretch">
                    <div className="min-h-[300px] lg:min-h-0 lg:h-full">
                        <DiagonalThemePreview
                            lightTheme={previewTheme.light}
                            darkTheme={previewTheme.dark}
                            activeMode={pickerState.mode}
                            visualizerMode={visualizerMode}
                            visualizerModeLabel={visualizerModeLabel}
                            staticMode={staticMode}
                            backgroundOpacity={backgroundOpacity}
                            cadenzaTuning={cadenzaTuning}
                            partitaTuning={partitaTuning}
                            fumeTuning={fumeTuning}
                            lyraTuning={lyraTuning}
                            lyricsFontScale={lyricsFontScale}
                            currentTime={currentTime}
                            currentLineIndex={currentLineIndex}
                            audioPower={audioPower}
                            audioBands={audioBands}
                            onSelectMode={(mode) => setPickerState(previous => ({ ...previous, mode }))}
                        />
                    </div>

                    <div className="relative z-30 min-h-0 overflow-y-auto pr-1 custom-scrollbar">
                        <div
                            className="space-y-4 rounded-[24px] border border-white/10 p-4"
                            style={{ backgroundColor: controlCardBg }}
                        >
                            <div className="space-y-1">
                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                    {pickerState.mode === 'light' ? (t('options.lightTheme') || '亮色主题') : (t('options.darkTheme') || '暗色主题')}
                                </div>
                                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                    {t('options.themeParkPickerDesc') || '编辑颜色字段。'}
                                </div>
                            </div>

                            <div className="flex items-center gap-2 rounded-full bg-white/5 p-1">
                                <button
                                    type="button"
                                    onClick={() => setPickerState(previous => ({ ...previous, mode: 'light' }))}
                                    className="flex-1 rounded-full px-3 py-2 text-sm transition-colors"
                                    style={{
                                        color: 'var(--text-primary)',
                                        backgroundColor: pickerState.mode === 'light' ? (isDaylight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.12)') : 'transparent',
                                    }}
                                >
                                    {t('options.lightTheme') || '亮色'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPickerState(previous => ({ ...previous, mode: 'dark' }))}
                                    className="flex-1 rounded-full px-3 py-2 text-sm transition-colors"
                                    style={{
                                        color: 'var(--text-primary)',
                                        backgroundColor: pickerState.mode === 'dark' ? (isDaylight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.12)') : 'transparent',
                                    }}
                                >
                                    {t('options.darkTheme') || '暗色'}
                                </button>
                            </div>

                            <div className="space-y-3">
                                {COLOR_FIELDS.map(field => {
                                    const colorValue = draftTheme[pickerState.mode][field.key];
                                    const isActive = pickerState.key === field.key;

                                    return (
                                        <button
                                            key={`${pickerState.mode}-${field.key}`}
                                            type="button"
                                            onClick={() => setPickerState(previous => ({ ...previous, key: field.key }))}
                                            className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-all"
                                            style={{
                                                borderColor: isActive ? activeTheme.accentColor : (isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)'),
                                                backgroundColor: isActive ? (isDaylight ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.07)') : 'transparent',
                                            }}
                                        >
                                            <div className="h-10 w-10 rounded-xl border border-black/10" style={{ backgroundColor: colorValue }} />
                                            <div className="min-w-0 flex-1">
                                                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                                    {field.label}
                                                </div>
                                                <div className="mt-0.5 text-xs opacity-55" style={{ color: 'var(--text-secondary)' }}>
                                                    {field.description}
                                                </div>
                                            </div>
                                            <div className="text-xs font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                                                {colorValue.toUpperCase()}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div className="relative z-40 space-y-3 rounded-[24px] border border-white/10 p-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                                            {pickerField.label}
                                        </div>
                                        <div className="mt-1 text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                            {pickerField.description}
                                        </div>
                                    </div>
                                    <div className="rounded-full px-3 py-1 text-xs font-mono" style={{ color: activeTheme.backgroundColor, backgroundColor: activeColor }}>
                                        {activeColor.toUpperCase()}
                                    </div>
                                </div>

                                <div className="rounded-[22px] border border-white/10 bg-black/10 p-3">
                                    <HexColorPicker
                                        color={activeColor}
                                        onChange={(value) => updateColor(pickerState.mode, pickerState.key, value)}
                                        style={{ width: '100%', height: 220 }}
                                    />
                                </div>

                                <label className="block space-y-2">
                                    <div className="text-xs font-medium uppercase tracking-[0.22em] opacity-50" style={{ color: 'var(--text-secondary)' }}>
                                        HEX
                                    </div>
                                    <input
                                        type="text"
                                        value={activeColor}
                                        onChange={(event) => updateColor(pickerState.mode, pickerState.key, event.target.value)}
                                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm outline-none transition-colors focus:border-white/20"
                                        style={{ color: 'var(--text-primary)' }}
                                        spellCheck={false}
                                    />
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default ThemePark;
