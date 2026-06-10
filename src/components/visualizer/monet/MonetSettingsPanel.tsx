import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { DEFAULT_MONET_TUNING, type MonetAudioStyle, type MonetBackgroundCropMode, type MonetBackgroundLayout, type MonetBackgroundSource } from '../../../types';
import { colorWithAlpha } from '../colorMix';
import { type VisualizerSettingsPanelProps } from '../definition';

// src/components/visualizer/monet/MonetSettingsPanel.tsx
// Monet owns its preview controls here so the main playground panel can stay registry-driven instead of growing more mode branches.
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
    theme: VisualizerSettingsPanelProps['theme'];
}

const PresetGroup = <T,>({
    label,
    value,
    options,
    onChange,
    isDaylight,
    theme,
}: PresetGroupProps<T>) => (
    <div className="space-y-2.5">
        <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
            {label}
        </div>
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

const clampMonetBackgroundBlur = (value: number) => Math.min(120, Math.max(0, value));
const clampUnitInterval = (value: number) => Math.min(1, Math.max(0, value));
const clampCoverPaneRatio = (value: number) => Math.min(0.68, Math.max(0.32, value));
const clampLyricsFocusScale = (value: number) => Math.min(1.3, Math.max(1, value));
const clampFontScale = (value: number) => Math.min(1.5, Math.max(0.7, value));

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
        backgroundBlurPx: clampMonetBackgroundBlur(monetTuning.backgroundBlurPx ?? DEFAULT_MONET_TUNING.backgroundBlurPx),
        backgroundOverlayOpacity: clampUnitInterval(
            monetTuning.backgroundOverlayOpacity ?? DEFAULT_MONET_TUNING.backgroundOverlayOpacity,
        ),
        backgroundCropMode: monetTuning.backgroundCropMode ?? DEFAULT_MONET_TUNING.backgroundCropMode,
        backgroundLayout: monetTuning.backgroundLayout ?? DEFAULT_MONET_TUNING.backgroundLayout,
        audioStyle: monetTuning.audioStyle ?? DEFAULT_MONET_TUNING.audioStyle,
        coverPaneRatio: clampCoverPaneRatio(monetTuning.coverPaneRatio ?? DEFAULT_MONET_TUNING.coverPaneRatio),
        lyricsFocusScale: clampLyricsFocusScale(monetTuning.lyricsFocusScale ?? DEFAULT_MONET_TUNING.lyricsFocusScale),
        fontScale: clampFontScale(monetTuning.fontScale ?? DEFAULT_MONET_TUNING.fontScale),
    };

    const backgroundSourceOptions = useMemo<PresetOption<MonetBackgroundSource>[]>(() => ([
        { value: 'cover-derived', label: t('options.monetBackgroundSourceCover') || '封面生成' },
        { value: 'uploaded-global', label: t('options.monetBackgroundSourceUploaded') || '上传图片' },
    ]), [t]);
    const audioStyleOptions = useMemo<PresetOption<MonetAudioStyle>[]>(() => ([
        { value: 'bar', label: t('options.monetAudioStyleBar') || '柱状' },
        { value: 'line', label: t('options.monetAudioStyleLine') || '线条' },
    ]), [t]);
    const cropModeOptions = useMemo<PresetOption<MonetBackgroundCropMode>[]>(() => ([
        { value: 'cover', label: t('options.monetCropCover') || '铺满' },
        { value: 'focus-cover', label: t('options.monetCropFocusCover') || '聚焦' },
        { value: 'full-artwork', label: t('options.monetCropFullArtwork') || '完整画面' },
    ]), [t]);
    const layoutOptions = useMemo<PresetOption<MonetBackgroundLayout>[]>(() => ([
        { value: 'full-overlay', label: t('options.monetLayoutFullOverlay') || '全屏叠色' },
        { value: 'half-pane-gradient', label: t('options.monetLayoutHalfPane') || '半屏渐变' },
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
                    {t('options.monetSettingsDesc') || '控制背景资源、舞台裁切和底部频谱样式。'}
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
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
                    {t('options.monetUploadBackground') || '上传背景图'}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isLoadingMonetBackgroundImage}
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
                        disabled={!monetBackgroundImage}
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
                label={t('options.monetBackgroundCropMode') || '背景裁切'}
                value={resolvedTuning.backgroundCropMode}
                options={cropModeOptions}
                onChange={(value) => onMonetTuningChange?.({ backgroundCropMode: value })}
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

            <PresetGroup
                label={t('options.monetAudioStyle') || '频谱样式'}
                value={resolvedTuning.audioStyle}
                options={audioStyleOptions}
                onChange={(value) => onMonetTuningChange?.({ audioStyle: value })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.monetBackgroundBlur') || '背景模糊'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.backgroundBlurPx)}px
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="120"
                    step="2"
                    value={resolvedTuning.backgroundBlurPx}
                    onChange={(event) => onMonetTuningChange?.({ backgroundBlurPx: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.monetBackgroundOverlayOpacity') || '叠色强度'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.backgroundOverlayOpacity * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.02"
                    value={resolvedTuning.backgroundOverlayOpacity}
                    onChange={(event) => onMonetTuningChange?.({ backgroundOverlayOpacity: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.monetCoverPaneRatio') || '封面区比例'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.coverPaneRatio * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0.32"
                    max="0.68"
                    step="0.01"
                    value={resolvedTuning.coverPaneRatio}
                    onChange={(event) => onMonetTuningChange?.({ coverPaneRatio: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.monetLyricsFocusScale') || '主歌词强调'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.lyricsFocusScale.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="1"
                    max="1.3"
                    step="0.01"
                    value={resolvedTuning.lyricsFocusScale}
                    onChange={(event) => onMonetTuningChange?.({ lyricsFocusScale: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.monetFontScale') || '字体缩放'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedTuning.fontScale.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0.7"
                    max="1.5"
                    step="0.05"
                    value={resolvedTuning.fontScale}
                    onChange={(event) => onMonetTuningChange?.({ fontScale: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};
