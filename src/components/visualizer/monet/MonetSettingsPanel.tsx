import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { DEFAULT_MONET_TUNING, type MonetAudioStyle, type MonetPortraitSource } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSettingsPanelProps } from '../definition';

// src/components/visualizer/monet/MonetSettingsPanel.tsx
// Monet-specific lyric, audio, and portrait controls. Background controls live in the shared background panel.
type MonetSettingsTheme = VisualizerSettingsPanelProps['theme'];

interface PresetOption<T> {
    label: string;
    value: T;
    disabled?: boolean;
}

interface PresetGroupProps<T> {
    label: string;
    value: T;
    options: PresetOption<T>[];
    onChange: (value: T) => void;
    isDaylight: boolean;
    theme: MonetSettingsTheme;
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

const clampValue = (value: number, min: number, max: number, fallback: number) => (
    Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback
);

const SectionLabel: React.FC<{ children: React.ReactNode; theme: MonetSettingsTheme; }> = ({ children, theme }) => (
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
}: PresetGroupProps<T>) => (
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

export const MonetSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    monetTuning = DEFAULT_MONET_TUNING,
    onMonetTuningChange,
    monetPortraitImage,
    onUploadMonetPortraitImage,
    onClearMonetPortraitImage,
    isLoadingMonetPortraitImage = false,
    onSliderPointerDown,
    onSliderCommit,
}) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const resolvedTuning = {
        keywordColoringEnabled: monetTuning.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
        showDescription: monetTuning.showDescription ?? DEFAULT_MONET_TUNING.showDescription,
        audioStyle: monetTuning.audioStyle ?? DEFAULT_MONET_TUNING.audioStyle,
        fontScale: clampValue(monetTuning.fontScale ?? DEFAULT_MONET_TUNING.fontScale, 0.7, 1.5, DEFAULT_MONET_TUNING.fontScale),
        portraitSource: monetTuning.portraitSource ?? DEFAULT_MONET_TUNING.portraitSource,
    };

    const keywordColoringOptions = useMemo<PresetOption<boolean>[]>(() => ([
        { value: true, label: t('options.monetKeywordColoringOn') || '启用' },
        { value: false, label: t('options.monetKeywordColoringOff') || '关闭' },
    ]), [t]);
    const showDescriptionOptions = useMemo<PresetOption<boolean>[]>(() => ([
        { value: true, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: false, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);
    const portraitSourceOptions = useMemo<PresetOption<MonetPortraitSource>[]>(() => ([
        { value: 'cover', label: t('options.monetPortraitSourceCover') || '封面' },
        {
            value: 'custom',
            label: t('options.monetPortraitSourceCustom') || '自定义图片',
            disabled: !monetPortraitImage && !isLoadingMonetPortraitImage,
        },
    ]), [isLoadingMonetPortraitImage, monetPortraitImage, t]);
    const audioStyleOptions = useMemo<PresetOption<MonetAudioStyle>[]>(() => ([
        { value: 'bar', label: t('options.monetAudioStyleBar') || '柱状' },
        { value: 'line', label: t('options.monetAudioStyleLine') || '线条' },
    ]), [t]);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        setFeedback(null);
        if (!files.length || !onUploadMonetPortraitImage) {
            return;
        }

        const result = await onUploadMonetPortraitImage(files);
        if (result.ok) {
            onMonetTuningChange?.({ portraitSource: 'custom' });
            setFeedback(files[0].name);
        } else {
            setFeedback(result.error || (t('options.monetUploadPortrait') || '上传失败'));
        }
    };

    return (
        <div
            className="space-y-4 rounded-[24px] border border-white/10 p-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.monetSettings') || '莫奈参数'}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.monetSettingsDesc') || '控制关键字、右侧肖像和底部频谱样式。'}
                </div>
            </div>

            {/* Section 1: Lyrics & Typography */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.lyricsStyleSettings') || '歌词与排版'}
                </div>
                
                <SliderControl
                    label={t('options.monetFontScale') || '字体缩放'}
                    valueLabel={`${resolvedTuning.fontScale.toFixed(2)}x`}
                    min={0.7}
                    max={1.5}
                    step={0.05}
                    value={resolvedTuning.fontScale}
                    onChange={(value) => onMonetTuningChange?.({ fontScale: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />

                <PresetGroup
                    label={t('options.monetKeywordColoring') || '关键字着色'}
                    value={resolvedTuning.keywordColoringEnabled}
                    options={keywordColoringOptions}
                    onChange={(value) => onMonetTuningChange?.({ keywordColoringEnabled: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />

                <PresetGroup
                    label={t('options.monetShowDescription') || '显示歌曲描述'}
                    value={resolvedTuning.showDescription}
                    options={showDescriptionOptions}
                    onChange={(value) => onMonetTuningChange?.({ showDescription: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />
            </div>

            {/* Section 2: Portrait Character */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.cappellaAvatarSource') || '肖像展示'}
                </div>

                <PresetGroup
                    label={t('options.monetPortraitSource') || '右侧肖像来源'}
                    value={resolvedTuning.portraitSource}
                    options={portraitSourceOptions}
                    onChange={(value) => onMonetTuningChange?.({ portraitSource: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />

                <div className="space-y-2.5">
                    <SectionLabel theme={theme}>{t('options.monetUploadPortrait') || '上传肖像图'}</SectionLabel>
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isLoadingMonetPortraitImage || !onUploadMonetPortraitImage}
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45"
                            style={{
                                color: theme.primaryColor,
                                borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                            }}
                        >
                            <ImagePlus size={15} />
                            <span>{t('options.monetUploadPortrait') || '上传肖像图'}</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => void onClearMonetPortraitImage?.()}
                            disabled={!monetPortraitImage || !onClearMonetPortraitImage}
                            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-45"
                            style={{
                                color: theme.primaryColor,
                                borderColor: colorWithAlpha(theme.secondaryColor, isDaylight ? 0.18 : 0.14),
                                backgroundColor: colorWithAlpha(theme.backgroundColor, isDaylight ? 0.24 : 0.34),
                            }}
                        >
                            <Trash2 size={15} />
                            <span>{t('options.monetClearPortrait') || '清空肖像图'}</span>
                        </button>
                    </div>
                    <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                        {feedback || monetPortraitImage?.name || '-'}
                    </div>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                    className="hidden"
                    onChange={(event) => void handleFileChange(event)}
                />
            </div>

            {/* Section 3: Audio Spectrum */}
            <div className="space-y-3.5 rounded-[18px] border border-white/5 p-3.5 bg-black/5 dark:bg-white/5">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-65" style={{ color: theme.accentColor }}>
                    {t('options.monetAudioStyle') || '频谱反馈'}
                </div>

                <PresetGroup
                    label={t('options.monetAudioStyle') || '频谱样式'}
                    value={resolvedTuning.audioStyle}
                    options={audioStyleOptions}
                    onChange={(value) => onMonetTuningChange?.({ audioStyle: value })}
                    isDaylight={isDaylight}
                    theme={theme}
                />
            </div>
        </div>
    );
};
