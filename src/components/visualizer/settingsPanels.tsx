import React, { useMemo, useRef, useState } from 'react';
import { DEFAULT_CAPPELLA_TUNING, DEFAULT_CLASSIC_TUNING, DEFAULT_FUME_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_TILT_TUNING, type CappellaTuning, type ClassicTuning, type FumeTuning, type PartitaTuning, type TiltColorScheme, type TiltTuning } from '../../types';
import { colorWithAlpha } from './colorMix';
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
    theme: VisualizerSettingsPanelProps['theme'];
}

const clampPartitaStagger = (value: number) => Math.min(180, Math.max(0, value));
const clampClassicBreathingFloatMultiplier = (value: number) => Math.min(2, Math.max(0, value));

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
                        className="px-3 py-2 rounded-full text-sm transition-all border"
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

export const ClassicSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    classicTuning = DEFAULT_CLASSIC_TUNING,
    onClassicTuningChange,
}) => {
    const resolvedClassicTuning: ClassicTuning = {
        enableWordRotation: classicTuning.enableWordRotation ?? DEFAULT_CLASSIC_TUNING.enableWordRotation,
        breathingFloatMultiplier: clampClassicBreathingFloatMultiplier(
            classicTuning.breathingFloatMultiplier ?? DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
        ),
    };
    const wordRotationOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.classicWordRotationOn') || '启用' },
        { value: false, label: t('options.classicWordRotationOff') || '关闭' },
    ]), [t]);

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.classicSettings') || '流光参数'}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.classicSettingsDesc') || '控制逐字旋转和整行呼吸浮动范围。'}
                </div>
            </div>

            <PresetGroup
                label={t('options.classicWordRotation') || '逐字旋转'}
                value={resolvedClassicTuning.enableWordRotation}
                options={wordRotationOptions}
                onChange={(enabled) => onClassicTuningChange?.({ enableWordRotation: enabled })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.classicBreathingFloatMultiplier') || '呼吸浮动范围'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {resolvedClassicTuning.breathingFloatMultiplier.toFixed(2)}x
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={resolvedClassicTuning.breathingFloatMultiplier}
                    onChange={(event) => onClassicTuningChange?.({ breathingFloatMultiplier: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};

export const PartitaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    partitaTuning = DEFAULT_PARTITA_TUNING,
    onPartitaTuningChange,
}) => {
    const rawMin = clampPartitaStagger(partitaTuning.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(partitaTuning.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax);
    const resolvedPartitaTuning: PartitaTuning = {
        showGuideLines: partitaTuning.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        useSemanticLayout: partitaTuning.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
    const guideLineOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaGuideLinesOn') || '显示' },
        { value: false, label: t('options.partitaGuideLinesOff') || '隐藏' },
    ]), [t]);
    const semanticLayoutOptions: PresetOption<boolean>[] = useMemo(() => ([
        { value: true, label: t('options.partitaSemanticLayoutOn') || '启用' },
        { value: false, label: t('options.partitaSemanticLayoutOff') || '关闭' },
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
                theme={theme}
            />

            <PresetGroup
                label={t('options.partitaSemanticLayout') || '语义排列'}
                value={resolvedPartitaTuning.useSemanticLayout}
                options={semanticLayoutOptions}
                onChange={(enabled) => onPartitaTuningChange?.({ useSemanticLayout: enabled })}
                isDaylight={isDaylight}
                theme={theme}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
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
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    fumeTuning = DEFAULT_FUME_TUNING,
    onFumeTuningChange,
}) => {
    const resolvedFumeTuning: FumeTuning = {
        hidePrintSymbols: fumeTuning.hidePrintSymbols,
        disableGeometricBackground: DEFAULT_FUME_TUNING.disableGeometricBackground,
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
                theme={theme}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <PresetGroup
                label={t('options.fumeCameraTrackingMode') || '摄影机追焦方式'}
                value={resolvedFumeTuning.cameraTrackingMode}
                options={fumeCameraTrackingOptions}
                onChange={(next) => handleFumeTuningChange({ cameraTrackingMode: next })}
                isDaylight={isDaylight}
                theme={theme}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
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
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
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
    avatarSource: tuning?.avatarSource === 'builtin' || tuning?.avatarSource === 'color' || tuning?.avatarSource === 'cover' || tuning?.avatarSource === 'custom'
        ? tuning.avatarSource
        : DEFAULT_CAPPELLA_TUNING.avatarSource,
});

export const CappellaSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    cappellaTuning,
    cappellaCustomEmojiImages = [],
    onCappellaTuningChange,
    cappellaCustomEmojiCount = 0,
    hasCappellaCustomEmojiPack = false,
    isCappellaCustomEmojiPackLoading = false,
    onImportCappellaCustomEmojiPack,
    onClearCappellaCustomEmojiPack,
    cappellaCustomAvatarImages = [],
    onImportCappellaCustomAvatar,
    onClearCappellaCustomAvatar,
    hasCappellaCustomAvatar = false,
    isCappellaCustomAvatarLoading = false,
}) => {
    const emojiFileInputRef = useRef<HTMLInputElement | null>(null);
    const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [isImportingAvatar, setIsImportingAvatar] = useState(false);
    const resolvedTuning = resolveCappellaTuning(cappellaTuning, hasCappellaCustomEmojiPack);
    const emojiSourceOptions: PresetOption<CappellaTuning['emojiPackSource']>[] = useMemo(() => ([
        { value: 'builtin', label: t('options.cappellaEmojiSourceBuiltin') || '内置' },
        { value: 'custom', label: t('options.cappellaEmojiSourceCustom') || '自定义' },
    ]), [t]);
    const avatarSourceOptions: PresetOption<CappellaTuning['avatarSource']>[] = useMemo(() => ([
        { value: 'cover', label: t('options.cappellaAvatarSourceCover') || '封面' },
        { value: 'builtin', label: t('options.cappellaAvatarSourceBuiltin') || '内置头像' },
        { value: 'color', label: t('options.cappellaAvatarSourceColor') || '色块' },
        { value: 'custom', label: t('options.cappellaAvatarSourceCustom') || '自定义' },
    ]), [t]);

    const handleImportClick = () => {
        setFeedback(null);
        emojiFileInputRef.current?.click();
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

    const handleAvatarImportClick = () => {
        setFeedback(null);
        avatarFileInputRef.current?.click();
    };

    const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = '';
        if (files.length === 0 || !onImportCappellaCustomAvatar) {
            return;
        }

        setIsImportingAvatar(true);
        setFeedback(null);
        try {
            const result = await onImportCappellaCustomAvatar(files);
            if (result.ok) {
                setFeedback(t('options.cappellaAvatarImportSuccess') || '自定义头像已更新。');
            } else {
                setFeedback(result.error || (t('options.cappellaAvatarImportFailed') || '导入失败。'));
            }
        } finally {
            setIsImportingAvatar(false);
        }
    };

    const handleClearCustomAvatar = async () => {
        if (!onClearCappellaCustomAvatar) {
            return;
        }

        setFeedback(null);
        await onClearCappellaCustomAvatar();
        setFeedback(t('options.cappellaAvatarCleared') || '自定义头像已清空。');
    };

    const avatarPreviewSlots = cappellaCustomAvatarImages.length > 0
        ? cappellaCustomAvatarImages
        : Array.from({ length: 5 }, (_, index) => cappellaCustomAvatarImages[index] ?? null);
    const previewSlots = cappellaCustomEmojiImages.length > 0
        ? cappellaCustomEmojiImages
        : Array.from({ length: 5 }, (_, index) => cappellaCustomEmojiImages[index] ?? null);

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
                theme={theme}
            />

<div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: theme.secondaryColor }}>
                    {t('options.cappellaAvatarSource') || '头像来源'}
                </div>
                <div className="flex flex-wrap gap-2">
                    {avatarSourceOptions.map(option => {
                        const isActive = option.value === resolvedTuning.avatarSource;
                        const isDisabled = option.value === 'custom' && !hasCappellaCustomAvatar;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => onCappellaTuningChange?.({ avatarSource: option.value })}
                                className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-45"
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

            <div className="space-y-2.5">
                <div className="text-xs font-medium uppercase tracking-[0.24em] opacity-45" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.cappellaAvatarPreview') || '自定义头像预览'}
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {avatarPreviewSlots.map((image, index) => (
                        <div
                            key={image?.id ?? `empty-${index}`}
                            className="aspect-square rounded-full border overflow-hidden flex items-center justify-center text-[11px] text-center"
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
                                    className="h-full w-full rounded-full object-cover"
                                />
                            ) : (
                                <span className="opacity-45">{index + 1}</span>
                            )}
                        </div>
                    ))}
                </div>
                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {hasCappellaCustomAvatar
                        ? `${t('options.cappellaEmojiCount') || '已上传'} ${cappellaCustomAvatarImages.length}`
                        : (t('options.cappellaAvatarUploadHint') || '还没有自定义头像，上传后可切换到自定义来源。')}
                </div>

                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handleAvatarImportClick}
                        disabled={isImportingAvatar || isCappellaCustomAvatarLoading}
                        className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                            color: 'var(--text-primary)',
                            borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                        }}
                    >
                        {isImportingAvatar
                            ? (t('options.cappellaAvatarUploading') || '导入中...')
                            : (t('options.cappellaAvatarUpload') || '上传自定义头像')}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleClearCustomAvatar()}
                        disabled={!hasCappellaCustomAvatar || isImportingAvatar || isCappellaCustomAvatarLoading}
                        className="px-3 py-2 rounded-full text-sm transition-all border disabled:cursor-not-allowed disabled:opacity-50"
                        style={{
                            color: 'var(--text-primary)',
                            borderColor: isDaylight ? 'rgba(24,24,27,0.08)' : 'rgba(255,255,255,0.08)',
                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.56)' : 'rgba(255,255,255,0.04)',
                        }}
                    >
                        {t('options.cappellaAvatarClear') || '清空自定义头像'}
                    </button>
                </div>

                <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg,image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => void handleAvatarFileChange(event)}
                />
            </div>

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
                <div className="text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                    {hasCappellaCustomEmojiPack
                        ? `${t('options.cappellaEmojiCount') || '已上传'} ${cappellaCustomEmojiCount}`
                        : (t('options.cappellaEmojiUploadHint') || '还没有自定义表情包，上传后才能切换到自定义。')}
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
                ref={emojiFileInputRef}
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

export const TiltSettingsPanel: React.FC<VisualizerSettingsPanelProps> = ({
    t,
    isDaylight,
    theme,
    controlCardBg,
    rangeInputClass,
    onSliderPointerDown,
    onSliderCommit,
    tiltTuning = DEFAULT_TILT_TUNING,
    onTiltTuningChange,
}) => {
    const resolvedTuning: TiltTuning = {
        splitProbability: Math.min(1, Math.max(0, tiltTuning.splitProbability ?? DEFAULT_TILT_TUNING.splitProbability)),
        tiltStyleProbability: Math.min(1, Math.max(0, tiltTuning.tiltStyleProbability ?? DEFAULT_TILT_TUNING.tiltStyleProbability)),
        colorScheme: tiltTuning?.colorScheme ?? DEFAULT_TILT_TUNING.colorScheme ?? 'default',
    };

    const colorSchemeOptions: PresetOption<TiltColorScheme>[] = useMemo(() => ([
        { label: t('options.tiltColorSchemeDefault') || '双色1', value: 'default' },
        { label: t('options.tiltColorSchemeSwap') || '双色2', value: 'swap' },
        { label: t('options.tiltColorSchemeAccentAll') || '单色1', value: 'accentAll' },
        { label: t('options.tiltColorSchemePrimaryAll') || '单色2', value: 'primaryAll' },
    ]), [t]);

    const handleTiltTuningChange = (patch: Partial<TiltTuning>) => {
        onTiltTuningChange?.(patch);
    };

    return (
        <div
            className="rounded-[24px] border border-white/10 p-4 space-y-4"
            style={{ backgroundColor: controlCardBg }}
        >
            <div className="space-y-1">
                <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {t('options.tiltSettings') || '倾诉参数'}
                </div>
                <div className="text-xs opacity-50" style={{ color: 'var(--text-secondary)' }}>
                    {t('options.tiltSettingsDesc') || '控制歌词分行概率和斜体强调样式的出现频率。'}
                </div>
            </div>

            <PresetGroup<TiltColorScheme>
                label={t('options.tiltColorScheme') || '配色方案'}
                value={resolvedTuning.colorScheme}
                options={colorSchemeOptions}
                onChange={(next) => handleTiltTuningChange({ colorScheme: next })}
                isDaylight={isDaylight}
                theme={theme}
            />

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.tiltSplitProbability') || '分行概率'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.splitProbability * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedTuning.splitProbability}
                    onChange={(event) => handleTiltTuningChange({ splitProbability: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-primary)' }}>
                    <span>{t('options.tiltStyleProbability') || '斜体强调概率'}</span>
                    <span className="font-mono opacity-70" style={{ color: 'var(--text-secondary)' }}>
                        {Math.round(resolvedTuning.tiltStyleProbability * 100)}%
                    </span>
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={resolvedTuning.tiltStyleProbability}
                    onChange={(event) => handleTiltTuningChange({ tiltStyleProbability: parseFloat(event.target.value) })}
                    onPointerDown={onSliderPointerDown}
                    onPointerUp={onSliderCommit}
                    className={rangeInputClass}
                />
            </div>
        </div>
    );
};
