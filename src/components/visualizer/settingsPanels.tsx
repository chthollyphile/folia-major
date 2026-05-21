import React, { useMemo, useRef, useState } from 'react';
import { DEFAULT_CAPPELLA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_PARTITA_TUNING, type CappellaTuning, type FumeTuning, type PartitaTuning } from '../../types';
import { type VisualizerSettingsPanelProps } from './definition';

// src/components/visualizer/settingsPanels.tsx
// Mode-owned preview settings panels used by discoverable visualizer entries.
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
}

const clampPartitaStagger = (value: number) => Math.min(180, Math.max(0, value));

const PresetGroup = <T,>({
    label,
    value,
    options,
    onChange,
    isDaylight,
}: PresetGroupProps<T>) => (
    <div className="space-y-2.5">
        <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
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

export const PartitaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    controlCardBg,
    rangeInputClass,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    onPartitaTuningChange,
}) => {
    const rawMin = clampPartitaStagger(partitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(partitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);
    const resolvedPartitaTuning: PartitaTuning = {
        showGuideLines: partitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
    const guideLineOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: false, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);
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

    return (
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
                onChange={(enabled) => onPartitaTuningChange?.({ showGuideLines: enabled })}
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
                    className={rangeInputClass}
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
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};

const resolveFumeCameraTrackingMode = (value: FumeTuning['cameraTrackingMode'] | undefined): FumeTuning['cameraTrackingMode'] => (
    value === 'stepped' || value === 'smooth'
        ? value
        : DEFAULT_FUME_TUNING.cameraTrackingMode
);

export const FumeSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    controlCardBg,
    rangeInputClass,
    fumeTuning = DEFAULT_FUME_TUNING,
    onFumeTuningChange,
}) => {
    const resolvedFumeTuning: FumeTuning = {
        hidePrintSymbols: fumeTuning.hidePrintSymbols,
        disableGeometricBackground: fumeTuning.disableGeometricBackground,
        backgroundObjectOpacity: Math.min(1, Math.max(0, fumeTuning.backgroundObjectOpacity ?? DEFAULT_FUME_TUNING.backgroundObjectOpacity)),
        textHoldRatio: Math.min(1, Math.max(0, fumeTuning.textHoldRatio ?? DEFAULT_FUME_TUNING.textHoldRatio)),
        cameraTrackingMode: resolveFumeCameraTrackingMode(fumeTuning.cameraTrackingMode),
        cameraSpeed: Math.min(1.85, Math.max(0.55, fumeTuning.cameraSpeed)),
        glowIntensity: Math.min(1.8, Math.max(0, fumeTuning.glowIntensity)),
        heroScale: Math.min(1.32, Math.max(0.82, fumeTuning.heroScale)),
    };
    const visibilityOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: false, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: true, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);
    const fumeCameraTrackingOptions: PresetOption<FumeTuning['cameraTrackingMode']>[] = useMemo(() => ([
        { value: 'stepped', label: t('options.fumeCameraTrackingStepped') || '定格' },
        { value: 'smooth', label: t('options.fumeCameraTrackingSmooth') || '平滑' },
    ]), [t]);
    const handleFumeTuningChange = (patch: Partial<FumeTuning>) => {
        onFumeTuningChange?.(patch);
    };

    return (
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

            <PresetGroup
                label={t('options.fumeGeometricBackground') || '通用几何图形'}
                value={resolvedFumeTuning.disableGeometricBackground}
                options={visibilityOptions}
                onChange={(next) => handleFumeTuningChange({ disableGeometricBackground: next })}
                isDaylight={isDaylight}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeBackgroundObjectOpacity') || '世界背景物体透明度'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedFumeTuning.backgroundObjectOpacity * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedFumeTuning.backgroundObjectOpacity}
                    onChange={(event) => handleFumeTuningChange({ backgroundObjectOpacity: parseFloat(event.target.value) })}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.fumeTextHoldRatio') || '文字停留比例'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedFumeTuning.textHoldRatio * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedFumeTuning.textHoldRatio}
                    onChange={(event) => handleFumeTuningChange({ textHoldRatio: parseFloat(event.target.value) })}
                    className={rangeInputClass}
                />
            </div>

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
                    className={rangeInputClass}
                />
            </div>

            <PresetGroup
                label={t('options.fumeCameraTrackingMode') || '摄影机追焦方式'}
                value={resolvedFumeTuning.cameraTrackingMode}
                options={fumeCameraTrackingOptions}
                onChange={(next) => handleFumeTuningChange({ cameraTrackingMode: next })}
                isDaylight={isDaylight}
            />

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
                    className={rangeInputClass}
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
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};

const resolveCappellaTuning = (
    tuning: CappellaTuning | undefined,
    hasCustomEmojiPack: boolean,
): CappellaTuning => ({
    showEmoMessages: tuning?.showEmoMessages ?? DEFAULT_CAPPELLA_TUNING.showEmoMessages,
    emojiPackSource: tuning?.emojiPackSource === 'custom' && hasCustomEmojiPack
        ? 'custom'
        : 'builtin',
});

export const CappellaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    controlCardBg,
    cappellaTuning,
    cappellaCustomEmojiImages = [],
    onCappellaTuningChange,
    cappellaCustomEmojiCount = 0,
    hasCappellaCustomEmojiPack = false,
    isCappellaCustomEmojiPackLoading = false,
    onImportCappellaCustomEmojiPack,
    onClearCappellaCustomEmojiPack,
}) => {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const resolvedTuning = resolveCappellaTuning(cappellaTuning, hasCappellaCustomEmojiPack);
    const emojiSourceOptions: PresetOption<CappellaTuning['emojiPackSource']>[] = useMemo(() => ([
        { value: 'builtin', label: t('options.cappellaEmojiSourceBuiltin') || '内置' },
        { value: 'custom', label: t('options.cappellaEmojiSourceCustom') || '自定义' },
    ]), [t]);

    const handleImportClick = () => {
        setFeedback(null);
        fileInputRef.current?.click();
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0 || !onImportCappellaCustomEmojiPack) {
            return;
        }

        setIsImporting(true);
        setFeedback(null);
        try {
            const result = await onImportCappellaCustomEmojiPack(files);
            if (result.ok) {
                setFeedback(t('options.cappellaEmojiImportSuccess') || '自定义表情包已更新。');
            } else {
                setFeedback(result.error || (t('options.cappellaEmojiImportFailed') || '导入失败。'));
            }
        } finally {
            setIsImporting(false);
        }
    };

    const handleClearCustomPack = async () => {
        if (!onClearCappellaCustomEmojiPack) {
            return;
        }

        setFeedback(null);
        await onClearCappellaCustomEmojiPack();
        setFeedback(t('options.cappellaEmojiCleared') || '自定义表情包已清空。');
    };

    const previewSlots = Array.from({ length: 5 }, (_, index) => cappellaCustomEmojiImages[index] ?? null);

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.cappellaSettings') || '群唱参数'}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaSettingsDesc') || '控制表情包显示与自定义表情包来源。'}
                </div>
            </div>

            <PresetGroup
                label={t('options.cappellaShowEmoMessages') || '显示表情包'}
                value={resolvedTuning.showEmoMessages}
                options={[
                    { value: true, label: t('options.partitaGuideLinesOn') || '显示' },
                    { value: false, label: t('options.partitaGuideLinesOff') || '隐藏' },
                ]}
                onChange={(next) => onCappellaTuningChange?.({ showEmoMessages: next })}
                isDaylight={isDaylight}
            />

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaEmojiSource') || '表情包来源'}
                </div>
                <div className="flex flex-wrap gap-2">
                    {emojiSourceOptions.map(option => {
                        const isActive = option.value === resolvedTuning.emojiPackSource;
                        const isDisabled = option.value === 'custom' && !hasCappellaCustomEmojiPack;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => onCappellaTuningChange?.({ emojiPackSource: option.value })}
                                className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-45"
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
                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {hasCappellaCustomEmojiPack
                        ? `${t('options.cappellaEmojiCount') || '已上传'} ${cappellaCustomEmojiCount} / 5`
                        : (t('options.cappellaEmojiUploadHint') || '还没有自定义表情包，上传后才能切换到自定义。')}
                </div>
            </div>

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaEmojiPreview') || '自定义表情预览'}
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {previewSlots.map((image, index) => (
                        <div
                            key={image?.id ?? `empty-${index}`}
                            className="aspect-square rounded-2xl border overflow-hidden flex items-center justify-center text-[11px] text-center px-1"
                            style={{
                                borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                                backgroundColor: isDaylight ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.04)',
                                color: 'var(--text-secondary)',
                            }}
                            title={image?.name ?? (t('options.cappellaEmojiEmptySlot') || '空槽位')}
                        >
                            {image ? (
                                <img
                                    src={image.url}
                                    alt={image.name}
                                    className="h-full w-full object-contain"
                                />
                            ) : (
                                <span className="opacity-45">{index + 1}</span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={handleImportClick}
                    disabled={isImporting || isCappellaCustomEmojiPackLoading}
                    className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                        color: 'var(--text-primary)',
                        borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                        backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                    }}
                >
                    {isImporting
                        ? (t('options.cappellaEmojiUploading') || '导入中...')
                        : (t('options.cappellaEmojiUpload') || '上传自定义表情包')}
                </button>
                <button
                    type="button"
                    onClick={() => void handleClearCustomPack()}
                    disabled={!hasCappellaCustomEmojiPack || isImporting || isCappellaCustomEmojiPackLoading}
                    className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                    style={{
                        color: 'var(--text-primary)',
                        borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                        backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                    }}
                >
                    {t('options.cappellaEmojiClear') || '清空自定义表情包'}
                </button>
            </div>

            <input
                ref={fileInputRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                multiple
                className="hidden"
                onChange={(event) => void handleFileChange(event)}
            />

            {feedback && (
                <div className="text-xs leading-5 opacity-70" style={{ color: 'var(--text-secondary)' }}>
                    {feedback}
                </div>
            )}
        </div>
    );
};
