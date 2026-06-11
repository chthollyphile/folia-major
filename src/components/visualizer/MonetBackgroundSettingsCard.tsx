import React, { useMemo, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import { ImagePlus, Trash2 } from 'lucide-react';
import {
    DEFAULT_MONET_BACKGROUND_TUNING,
    type MonetBackgroundImage,
    type MonetBackgroundLayout,
    type MonetBackgroundSource,
    type MonetBackgroundTuning,
    type MonetBackgroundWashColorMode,
    type Theme,
} from '../../types';
import { colorWithAlpha } from './colorMix';

// src/components/visualizer/MonetBackgroundSettingsCard.tsx
// Background settings for the shell-level Monet image layer.
interface PresetOption<T> {
    label: string;
    value: T;
    disabled?: boolean;
}

interface MonetBackgroundSettingsCardProps {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    tuning?: MonetBackgroundTuning;
    onTuningChange?: (patch: Partial<MonetBackgroundTuning>) => void;
    monetBackgroundImage?: MonetBackgroundImage | null;
    onUploadMonetBackgroundImage?: (files: File[]) => Promise<{ ok: boolean; error?: string; }>;
    onClearMonetBackgroundImage?: () => Promise<void> | void;
    isLoadingMonetBackgroundImage?: boolean;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

interface SliderControlProps {
    label: string;
    valueLabel: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    rangeInputClass: string;
    onSliderPointerDown?: () => void;
    onSliderCommit?: () => void;
}

const SectionLabel: React.FC<{ children: React.ReactNode; theme: Theme; }> = ({ children, theme }) => (
    <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
        {children}
    </div>
);

const PresetGroup = <T,>({
    label,
    value,
    options,
    onChange,
    isDaylight,
    theme,
}: {
    label: string;
    value: T;
    options: PresetOption<T>[];
    onChange: (value: T) => void;
    isDaylight: boolean;
    theme: Theme;
}) => (
    <div className="space-y-2.5">
        <SectionLabel theme={theme}>{label}</SectionLabel>
        <div className="flex flex-wrap gap-2">
            {options.map(option => {
                const isActive = option.value === value;
                return (
                    <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => {
                            if (!option.disabled) {
                                onChange(option.value);
                            }
                        }}
                        disabled={option.disabled}
                        className="rounded-full border px-3 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45"
                        style={{
                            color: option.disabled ? colorWithAlpha(theme.secondaryColor, 0.72) : theme.primaryColor,
                            borderColor: isActive ? theme.accentColor : colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                            backgroundColor: isActive
                                ? colorWithAlpha(theme.accentColor, isDaylight ? 0.1 : 0.16)
                                : colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                            boxShadow: isActive ? `inset 0 0 0 1px ${theme.accentColor}` : 'none',
                        }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    </div>
);

const SliderControl: React.FC<SliderControlProps> = ({
    label,
    valueLabel,
    value,
    min,
    max,
    step,
    onChange,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
}) => (
    <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm" style={{ color: 'var(--text-primary)' }}>
            <span>{label}</span>
            <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                {valueLabel}
            </span>
        </div>
        <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(event) => onChange(parseFloat(event.target.value))}
            onPointerDown={onSliderPointerDown}
            onPointerUp={onSliderCommit}
            onPointerCancel={onSliderCommit}
            onBlur={onSliderCommit}
            className={rangeInputClass}
        />
    </div>
);

const clampValue = (value: number, min: number, max: number, fallback: number) => (
    Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

const normalizeHexInput = (value: string) => {
    const withoutHash = value.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
        return `#${withoutHash.toLowerCase()}`;
    }

    return null;
};

export const MonetBackgroundSettingsCard: React.FC<MonetBackgroundSettingsCardProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    tuning = DEFAULT_MONET_BACKGROUND_TUNING,
    onTuningChange,
    monetBackgroundImage,
    onUploadMonetBackgroundImage,
    onClearMonetBackgroundImage,
    isLoadingMonetBackgroundImage = false,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const resolvedTuning = {
        backgroundSource: tuning.backgroundSource ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource,
        backgroundLayout: tuning.backgroundLayout ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout,
        backgroundBlurPx: clampValue(tuning.backgroundBlurPx ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx, 0, 60, DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx),
        backgroundOverlayOpacity: clampValue(tuning.backgroundOverlayOpacity ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity),
        backgroundGrayscale: clampValue(tuning.backgroundGrayscale ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale),
        backgroundSaturation: clampValue(tuning.backgroundSaturation ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation, 0, 2, DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation),
        backgroundWash: clampValue(tuning.backgroundWash ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash, 0, 1, DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash),
        backgroundHalfPaneOffsetX: clampValue(tuning.backgroundHalfPaneOffsetX ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX, -40, 40, DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX),
        backgroundWashColorMode: tuning.backgroundWashColorMode ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode,
        backgroundWashCustomColor: normalizeHexInput(tuning.backgroundWashCustomColor) ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
    };

    const sourceOptions = useMemo<PresetOption<MonetBackgroundSource>[]>(() => ([
        { value: 'cover-derived', label: t('options.monetBackgroundSourceCover') || '封面' },
        {
            value: 'uploaded-global',
            label: t('options.monetBackgroundSourceUploaded') || '自定义图片',
            disabled: !monetBackgroundImage && !isLoadingMonetBackgroundImage,
        },
    ]), [isLoadingMonetBackgroundImage, monetBackgroundImage, t]);
    const layoutOptions = useMemo<PresetOption<MonetBackgroundLayout>[]>(() => ([
        { value: 'half-pane-gradient', label: t('options.monetLayoutHalfPane') || '半屏渐变' },
        { value: 'full-overlay', label: t('options.monetLayoutFullOverlay') || '全屏叠色' },
    ]), [t]);
    const washModeOptions = useMemo<PresetOption<MonetBackgroundWashColorMode>[]>(() => ([
        { value: 'theme', label: t('options.monetBackgroundWashTheme') || '主题色' },
        { value: 'custom', label: t('options.monetBackgroundWashCustom') || '自定义' },
    ]), [t]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        setFeedback(null);
        if (!files.length || !onUploadMonetBackgroundImage) {
            return;
        }

        const result = await onUploadMonetBackgroundImage(files);
        if (result.ok) {
            onTuningChange?.({ backgroundSource: 'uploaded-global' });
            setFeedback(files[0].name);
        } else {
            setFeedback(result.error || (t('options.monetUploadBackground') || '上传失败'));
        }
    };

    return (
        <div className="rounded-[24px] border p-4 space-y-4" style={{ backgroundColor: controlCardBg, borderColor: colorWithAlpha(theme.secondaryColor, 0.16) }}>
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: theme.primaryColor }}>
                    {t('options.monetBackgroundSettings') || '莫奈背景'}
                </div>
                <div className="text-xs opacity-70" style={{ color: theme.secondaryColor }}>
                    {t('options.monetBackgroundSettingsDesc') || '调整莫奈背景图片来源、布局和后处理。'}
                </div>
            </div>

            {/* Section 1: Background Source */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.monetGroupBackgroundSource') || '背景来源'}
                </div>
                <PresetGroup
                    label={t('options.monetBackgroundSource') || '背景来源'}
                    value={resolvedTuning.backgroundSource}
                    options={sourceOptions}
                    onChange={(value) => onTuningChange?.({ backgroundSource: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />

                <div className="space-y-2.5">
                    <SectionLabel theme={theme}>{t('options.monetUploadBackground') || '上传背景图'}</SectionLabel>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoadingMonetBackgroundImage || !onUploadMonetBackgroundImage}
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45"
                            style={{
                                color: theme.primaryColor,
                                borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                            }}
                        >
                            <ImagePlus size={15} />
                            <span>{t('options.monetUploadBackground') || '上传背景图'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => void onClearMonetBackgroundImage?.()}
                            disabled={!monetBackgroundImage || !onClearMonetBackgroundImage}
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45"
                            style={{
                                color: theme.primaryColor,
                                borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                            }}
                        >
                            <Trash2 size={15} />
                            <span>{t('options.monetClearBackground') || '清空背景图'}</span>
                        </button>
                    </div>
                    <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        {feedback || monetBackgroundImage?.name || '-'}
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                        className="hidden"
                        onChange={(event) => void handleFileChange(event)}
                    />
                </div>
            </div>

            {/* Section 2: Layout & Position */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.monetGroupLayoutPosition') || '布局与对齐'}
                </div>
                <PresetGroup
                    label={t('options.monetBackgroundLayout') || '布局模式'}
                    value={resolvedTuning.backgroundLayout}
                    options={layoutOptions}
                    onChange={(value) => onTuningChange?.({ backgroundLayout: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />

                {resolvedTuning.backgroundLayout === 'half-pane-gradient' && (
                    <SliderControl
                        label={t('options.monetHalfPaneOffsetX') || '图片水平偏移'}
                        valueLabel={`${Math.round(resolvedTuning.backgroundHalfPaneOffsetX)}%`}
                        min={-40}
                        max={40}
                        step={2}
                        value={resolvedTuning.backgroundHalfPaneOffsetX}
                        onChange={(value) => onTuningChange?.({ backgroundHalfPaneOffsetX: value })}
                        rangeInputClass={rangeInputClass}
                        onSliderPointerDown={onSliderPointerDown}
                        onSliderCommit={onSliderCommit}
                    />
                )}
            </div>

            {/* Section 3: Filters & Post-processing */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.monetGroupFiltersPostProcessing') || '视觉增强与滤镜'}
                </div>
                <SliderControl
                    label={t('options.monetBackgroundBlur') || '背景模糊'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundBlurPx)}px`}
                    min={0}
                    max={60}
                    step={2}
                    value={resolvedTuning.backgroundBlurPx}
                    onChange={(value) => onTuningChange?.({ backgroundBlurPx: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
                <SliderControl
                    label={t('options.monetBackgroundSaturation') || '饱和度'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundSaturation * 100)}%`}
                    min={0}
                    max={2}
                    step={0.05}
                    value={resolvedTuning.backgroundSaturation}
                    onChange={(value) => onTuningChange?.({ backgroundSaturation: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
                <SliderControl
                    label={t('options.monetBackgroundGrayscale') || '去色'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundGrayscale * 100)}%`}
                    min={0}
                    max={1}
                    step={0.02}
                    value={resolvedTuning.backgroundGrayscale}
                    onChange={(value) => onTuningChange?.({ backgroundGrayscale: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
            </div>

            {/* Section 4: Color Tint & Wash */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.monetGroupColorTintWash') || '叠色与水洗'}
                </div>
                <SliderControl
                    label={t('options.monetBackgroundOverlayOpacity') || '主题叠色强度'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundOverlayOpacity * 100)}%`}
                    min={0}
                    max={1}
                    step={0.02}
                    value={resolvedTuning.backgroundOverlayOpacity}
                    onChange={(value) => onTuningChange?.({ backgroundOverlayOpacity: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
                <SliderControl
                    label={t('options.monetBackgroundWash') || '水洗重着色'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundWash * 100)}%`}
                    min={0}
                    max={1}
                    step={0.02}
                    value={resolvedTuning.backgroundWash}
                    onChange={(value) => onTuningChange?.({ backgroundWash: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />

                <PresetGroup
                    label={t('options.monetBackgroundWashColorMode') || '水洗色彩'}
                    value={resolvedTuning.backgroundWashColorMode}
                    options={washModeOptions}
                    onChange={(value) => onTuningChange?.({ backgroundWashColorMode: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />

                {resolvedTuning.backgroundWashColorMode === 'custom' && (
                    <div className="space-y-3 rounded-[20px] border p-3" style={{ borderColor: colorWithAlpha(theme.secondaryColor, 0.14), backgroundColor: colorWithAlpha(theme.backgroundColor, 0.2) }}>
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-sm" style={{ color: theme.primaryColor }}>
                                {t('options.monetBackgroundWashCustomColor') || '自定义水洗色'}
                            </div>
                            <div className="rounded-full px-3 py-1 text-xs font-mono" style={{ color: theme.backgroundColor, backgroundColor: resolvedTuning.backgroundWashCustomColor }}>
                                {resolvedTuning.backgroundWashCustomColor.toUpperCase()}
                            </div>
                        </div>
                        <HexColorPicker
                            color={resolvedTuning.backgroundWashCustomColor}
                            onChange={(value) => onTuningChange?.({ backgroundWashCustomColor: value })}
                            style={{ width: '100%', height: 180 }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
