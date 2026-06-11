import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { DEFAULT_MONET_TUNING, type MonetAudioStyle, type MonetBackgroundLayout, type MonetBackgroundSource } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSettingsPanelProps } from '../definition';

// src/components/visualizer/monet/MonetSettingsPanel.tsx
// Monet owns its preview controls here so the main playground panel can stay registry-driven instead of growing more mode branches.
type MonetSettingsTheme = VisualizerSettingsPanelProps['theme'];

interface PresetOption<T> {
    label: string;
    value: T;
}

interface PresetGroupProps<T> {
    label: string;
    value: T;
    options: PresetOption<T>[];
    onChange: (value: T) => void;
    isDaylight: boolean;
    theme: MonetSettingsTheme;
}

interface SectionLabelProps {
    children: React.ReactNode;
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

const SectionLabel: React.FC<SectionLabelProps> = ({ children, theme }) => (
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
                        onClick={() => onChange(option.value)}
                        className="rounded-full border px-3 py-2 text-sm transition-all"
                        style={{
                            color: theme.primaryColor,
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
        backgroundSource: monetTuning.backgroundSource ?? DEFAULT_MONET_TUNING.backgroundSource,
        backgroundLayout: monetTuning.backgroundLayout ?? DEFAULT_MONET_TUNING.backgroundLayout,
        backgroundBlurPx: clampValue(
            monetTuning.backgroundBlurPx ?? DEFAULT_MONET_TUNING.backgroundBlurPx,
            0,
            120,
            DEFAULT_MONET_TUNING.backgroundBlurPx,
        ),
        backgroundOverlayOpacity: clampValue(
            monetTuning.backgroundOverlayOpacity ?? DEFAULT_MONET_TUNING.backgroundOverlayOpacity,
            0,
            1,
            DEFAULT_MONET_TUNING.backgroundOverlayOpacity,
        ),
        backgroundGrayscale: clampValue(
            monetTuning.backgroundGrayscale ?? DEFAULT_MONET_TUNING.backgroundGrayscale,
            0,
            1,
            DEFAULT_MONET_TUNING.backgroundGrayscale,
        ),
        backgroundSaturation: clampValue(
            monetTuning.backgroundSaturation ?? DEFAULT_MONET_TUNING.backgroundSaturation,
            0,
            2,
            DEFAULT_MONET_TUNING.backgroundSaturation,
        ),
        backgroundWash: clampValue(
            monetTuning.backgroundWash ?? DEFAULT_MONET_TUNING.backgroundWash,
            0,
            1,
            DEFAULT_MONET_TUNING.backgroundWash,
        ),
        keywordColoringEnabled: monetTuning.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
        audioStyle: monetTuning.audioStyle ?? DEFAULT_MONET_TUNING.audioStyle,
        fontScale: clampValue(
            monetTuning.fontScale ?? DEFAULT_MONET_TUNING.fontScale,
            0.7,
            1.5,
            DEFAULT_MONET_TUNING.fontScale,
        ),
    };

    const backgroundSourceOptions = useMemo<PresetOption<MonetBackgroundSource>[]>(() => ([
        { value: 'cover-derived', label: t('options.monetBackgroundSourceCover') || '封面生成' },
        { value: 'uploaded-global', label: t('options.monetBackgroundSourceUploaded') || '上传图片' },
    ]), [t]);
    const keywordColoringOptions = useMemo<PresetOption<boolean>[]>(() => ([
        { value: true, label: t('options.monetKeywordColoringOn') || '启用' },
        { value: false, label: t('options.monetKeywordColoringOff') || '关闭' },
    ]), [t]);
    const layoutOptions = useMemo<PresetOption<MonetBackgroundLayout>[]>(() => ([
        { value: 'full-overlay', label: t('options.monetLayoutFullOverlay') || '全屏叠色' },
        { value: 'half-pane-gradient', label: t('options.monetLayoutHalfPane') || '半屏渐变' },
    ]), [t]);
    const audioStyleOptions = useMemo<PresetOption<MonetAudioStyle>[]>(() => ([
        { value: 'bar', label: t('options.monetAudioStyleBar') || '柱状' },
        { value: 'line', label: t('options.monetAudioStyleLine') || '线条' },
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
            onMonetTuningChange?.({ backgroundSource: 'uploaded-global' });
            setFeedback(monetBackgroundImage?.name || files[0].name);
        } else {
            setFeedback(result.error || (t('options.monetUploadBackground') || '上传失败'));
        }
    };

    return (
        <div
            className="space-y-4 rounded-[24px] border border-white/10 p-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.monetSettings') || 'Monet 参数'}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.monetSettingsDesc') || '控制背景资源、图片后处理和底部频谱样式。'}
                </div>
            </div>

            <PresetGroup
                label={t('options.monetBackgroundSource') || '背景来源'}
                value={resolvedTuning.backgroundSource}
                options={backgroundSourceOptions}
                onChange={(value) => onMonetTuningChange?.({ backgroundSource: value })}
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
                    {feedback || monetBackgroundImage?.name || '—'}
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                    className="hidden"
                    onChange={(event) => void handleFileChange(event)}
                />
            </div>

            <PresetGroup
                label={t('options.monetKeywordColoring') || '关键字着色'}
                value={resolvedTuning.keywordColoringEnabled}
                options={keywordColoringOptions}
                onChange={(value) => onMonetTuningChange?.({ keywordColoringEnabled: value })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <PresetGroup
                label={t('options.monetBackgroundLayout') || '布局模式'}
                value={resolvedTuning.backgroundLayout}
                options={layoutOptions}
                onChange={(value) => onMonetTuningChange?.({ backgroundLayout: value })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-3">
                <SectionLabel theme={theme}>{t('options.monetBackgroundPostProcessing') || '背景图片后处理'}</SectionLabel>
                <SliderControl
                    label={t('options.monetBackgroundBlur') || '背景模糊'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundBlurPx)}px`}
                    min={0}
                    max={120}
                    step={2}
                    value={resolvedTuning.backgroundBlurPx}
                    onChange={(value) => onMonetTuningChange?.({ backgroundBlurPx: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
                <SliderControl
                    label={t('options.monetBackgroundOverlayOpacity') || '叠色强度'}
                    valueLabel={`${Math.round(resolvedTuning.backgroundOverlayOpacity * 100)}%`}
                    min={0}
                    max={1}
                    step={0.02}
                    value={resolvedTuning.backgroundOverlayOpacity}
                    onChange={(value) => onMonetTuningChange?.({ backgroundOverlayOpacity: value })}
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
                    onChange={(value) => onMonetTuningChange?.({ backgroundGrayscale: value })}
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
                    onChange={(value) => onMonetTuningChange?.({ backgroundSaturation: value })}
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
                    onChange={(value) => onMonetTuningChange?.({ backgroundWash: value })}
                    rangeInputClass={rangeInputClass}
                    onSliderPointerDown={onSliderPointerDown}
                    onSliderCommit={onSliderCommit}
                />
            </div>

            <PresetGroup
                label={t('options.monetAudioStyle') || '频谱样式'}
                value={resolvedTuning.audioStyle}
                options={audioStyleOptions}
                onChange={(value) => onMonetTuningChange?.({ audioStyle: value })}
                isDaylight={isDaylight}
                theme={theme}
            />

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
        </div>
    );
};
